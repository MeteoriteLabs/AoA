import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNotNull, isNull, ne, notExists } from "drizzle-orm";
import {
  acquirePlatformTargetAuthorityExclusive,
  configurePlatformTargetAuthorityLockTimeout,
  executionTargets,
  operatorJobLeasingRepository,
  workers,
  type Db,
} from "@armyofagents/db";
import {
  canonicalizeJsonV1,
  registeredTargetProfileV1Schema,
  verifyAndBrandProviderConstraintProfileV1,
} from "@armyofagents/worker-protocol";
import { runInTenant } from "../db/tenant-context.js";
import { normalizePlacementRegistryTarget, type ExecutionTargetRow } from "./execution-target-resolver.js";

// Rotatable worker credential (Finding #3). The row id is NOT a credential;
// this token is. Only its hash is persisted (execution_targets.worker_token_hash);
// the plaintext is shown once at registration.
export function createWorkerToken(): string {
  return `aoa_wtk_${randomBytes(24).toString("hex")}`;
}
export function hashWorkerToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
export interface LegacyWorkerHeartbeatAuthority {
  targetId: string;
  organizationId: string;
}

export async function resolveWorkerTargetId(db: Db, token: string): Promise<string | null> {
  return (await resolveWorkerHeartbeatAuthority(db, token))?.targetId ?? null;
}

export async function resolveWorkerHeartbeatAuthority(
  db: Db,
  token: string,
): Promise<LegacyWorkerHeartbeatAuthority | null> {
  const trimmed = token.trim();
  if (!trimmed) return null;
  const rows = await db
    .select({
      targetId: executionTargets.id,
      organizationId: executionTargets.organizationId,
    })
    .from(executionTargets)
    .where(
      and(
        eq(executionTargets.workerTokenHash, hashWorkerToken(trimmed)),
        ne(executionTargets.status, "disabled"),
        isNotNull(executionTargets.organizationId),
      ),
    );
  const row = rows[0];
  return row?.organizationId
    ? { targetId: row.targetId, organizationId: row.organizationId }
    : null;
}
export function stripWorkerSecret<T extends { workerTokenHash?: unknown }>(row: T): Omit<T, "workerTokenHash"> {
  const { workerTokenHash: _omit, ...rest } = row;
  return rest;
}

const placementProfileTargetColumns = {
  id: executionTargets.id,
  organizationId: executionTargets.organizationId,
  ownerUserId: executionTargets.ownerUserId,
  scope: executionTargets.scope,
  targetAuthorityKey: executionTargets.targetAuthorityKey,
  deviceGeneration: executionTargets.deviceGeneration,
  slug: executionTargets.slug,
  kind: executionTargets.kind,
  trustClass: executionTargets.trustClass,
  status: executionTargets.status,
  registeredProfile: executionTargets.registeredProfile,
  registeredProfileHash: executionTargets.registeredProfileHash,
  providerConstraintProfile: executionTargets.providerConstraintProfile,
};

async function validatedPlacementProfiles(input: {
  target: ExecutionTargetRow;
  registeredProfile: unknown;
  providerConstraintProfile: unknown;
}) {
  const registered = registeredTargetProfileV1Schema.safeParse(input.registeredProfile);
  const provider = await verifyAndBrandProviderConstraintProfileV1(
    input.providerConstraintProfile,
    (bytes) => createHash("sha256").update(bytes).digest("hex"),
  );
  if (!registered.success || !provider || registered.data.revokedAt !== null) {
    throw new Error("invalid_execution_target_placement_profile");
  }
  const registeredProfileHash = createHash("sha256")
    .update(canonicalizeJsonV1(registered.data))
    .digest("hex");
  const normalized = await normalizePlacementRegistryTarget({
    ...input.target,
    registeredProfile: registered.data,
    registeredProfileHash,
    providerConstraintProfile: provider,
  });
  if (!normalized) throw new Error("invalid_execution_target_placement_profile");
  return {
    registeredProfile: registered.data as unknown as Record<string, unknown>,
    registeredProfileHash,
    providerConstraintProfile: provider as unknown as Record<string, unknown>,
  };
}

/** Tenant-admin writer: runInTenant + FORCE RLS are the authority boundary. */
export async function ratifyTenantExecutionTargetPlacementProfile(input: {
  appDb: Db;
  organizationId: string;
  executionTargetId: string;
  registeredProfile: unknown;
  providerConstraintProfile: unknown;
  now?: Date;
}) {
  return runInTenant(input.appDb, input.organizationId, async (repos) => {
    const target = await repos.workerEnrollment.lockPlacementProfileTarget(input.executionTargetId);
    if (!target || target.organizationId !== input.organizationId || target.scope === "platform") {
      throw new Error("execution_target_not_found");
    }
    const profiles = await validatedPlacementProfiles({ target, ...input });
    const updated = await repos.workerEnrollment.ratifyPlacementProfile({
      executionTargetId: target.id,
      expectedGeneration: target.deviceGeneration,
      ...profiles,
      now: input.now ?? new Date(),
    });
    if (!updated) throw new Error("execution_target_profile_update_conflict");
    return updated;
  });
}

/** Platform-admin writer: the operator projection can see/update only null-org rows. */
export async function ratifyPlatformExecutionTargetPlacementProfile(input: {
  operatorDb: Db;
  executionTargetId: string;
  registeredProfile: unknown;
  providerConstraintProfile: unknown;
  now?: Date;
}) {
  return input.operatorDb.transaction(async (tx) => {
    await configurePlatformTargetAuthorityLockTimeout(tx as unknown as Db);
    const authority = await operatorJobLeasingRepository(tx as unknown as Db)
      .lockPlatformAuthorityForMutation(input.executionTargetId);
    if (!authority) throw new Error("execution_target_not_found");
    await acquirePlatformTargetAuthorityExclusive(tx as unknown as Db, input.executionTargetId);
    const [target] = await tx.select(placementProfileTargetColumns).from(executionTargets).where(and(
      eq(executionTargets.id, input.executionTargetId),
      isNull(executionTargets.organizationId),
      eq(executionTargets.scope, "platform"),
      ne(executionTargets.status, "disabled"),
    )).limit(1).for("update");
    if (!target) throw new Error("execution_target_not_found");
    const profiles = await validatedPlacementProfiles({ target, ...input });
    const [updated] = await tx.update(executionTargets).set({
      ...profiles,
      updatedAt: input.now ?? new Date(),
    }).where(and(
      eq(executionTargets.id, target.id),
      isNull(executionTargets.organizationId),
      eq(executionTargets.deviceGeneration, target.deviceGeneration),
      ne(executionTargets.status, "disabled"),
    )).returning(placementProfileTargetColumns);
    if (!updated) throw new Error("execution_target_profile_update_conflict");
    return updated;
  });
}

export async function rotateExecutionTargetWorkerToken(
  db: Db,
  input: { organizationId: string; targetId: string },
) {
  const workerToken = createWorkerToken();
  const [row] = await db
    .update(executionTargets)
    .set({
      workerTokenHash: hashWorkerToken(workerToken),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(executionTargets.id, input.targetId),
        eq(executionTargets.organizationId, input.organizationId),
        isNotNull(executionTargets.organizationId),
        ne(executionTargets.status, "disabled"),
        notExists(
          db.select({ id: workers.id }).from(workers).where(and(
            eq(workers.executionTargetId, input.targetId),
            ne(workers.status, "revoked"),
          )),
        ),
      ),
    )
    .returning();

  if (!row) return null;
  return { target: stripWorkerSecret(row), workerToken };
}

export async function revokeExecutionTargetWorkerToken(
  db: Db,
  input: { organizationId: string; targetId: string },
) {
  const [row] = await db
    .update(executionTargets)
    .set({
      workerTokenHash: null,
      status: "disabled",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(executionTargets.id, input.targetId),
        eq(executionTargets.organizationId, input.organizationId),
      ),
    )
    .returning();

  return row ? stripWorkerSecret(row) : null;
}

/**
 * M5: idempotent only because execution_targets_org_slug_uq is NULLS NOT DISTINCT
 * (Task 4). With default NULLS DISTINCT this onConflict target would never match a
 * system row (organization_id = NULL) and would insert a duplicate every boot.
 */
export async function ensureControlPlaneExecutionTarget(db: Db): Promise<void> {
  await db
    .insert(executionTargets)
    .values({
      organizationId: null,
      scope: "platform",
      targetAuthorityKey: "platform",
      slug: "control-plane",
      kind: "local_host",
      trustClass: "local_trusted",
      status: "active",
      capabilities: { runtimes: ["runc"], adapters: ["claude_local", "codex_local", "process"] },
      config: { transport: "local_host" },
    })
    .onConflictDoNothing({ target: [executionTargets.organizationId, executionTargets.slug] });
}

// M6: heartbeat is scoped to the authenticated worker's TARGET ID, never the
// slug. slug is unique only per (organization_id, slug), so a slug-scoped update
// would let org-1's worker token flip org-2's identically-slugged pool row. The
// worker token resolves to exactly one target id; update by that id only.
//
// A `disabled` target is out of rotation by operator decision. The status guard
// (ne status 'disabled') keeps disabling DURABLE: a disabled worker's own
// heartbeat matches nothing → updated === 0, so the row is never resurrected to
// 'active'. The route returns 404 on updated === 0, telling the worker it was
// deactivated. (The resolver already excludes disabled rows from routing.)
export async function registerWorkerHeartbeat(
  db: Db,
  input: {
    targetId: string;
    organizationId?: string;
    status?: "active" | "draining" | "offline";
    capabilities?: Record<string, unknown>;
    now?: Date;
  },
): Promise<{ updated: number }> {
  const heartbeatAt = input.now ?? new Date();
  const rows = await db
    .update(executionTargets)
    .set({
      lastSeenAt: heartbeatAt,
      status: input.status ?? "active",
      ...(input.capabilities ? { capabilities: input.capabilities } : {}),
      updatedAt: heartbeatAt,
    })
    .where(and(
      eq(executionTargets.id, input.targetId),
      input.organizationId
        ? eq(executionTargets.organizationId, input.organizationId)
        : isNotNull(executionTargets.organizationId),
      ne(executionTargets.status, "disabled"),
    ))
    .returning({ id: executionTargets.id });
  return { updated: rows.length };
}

/**
 * List execution targets an org ADMIN may see/manage: ONLY the org's own rows.
 *
 * SECURITY (P5 review, finding #1): this list must NOT include system/shared rows
 * (organizationId = NULL — the seeded control-plane target + operator-registered
 * pool targets). The row id is NO LONGER a credential — worker auth is by the
 * SHA-256 worker_token_hash (resolveWorkerTargetId/requireWorkerToken,
 * routes/execution-targets.ts:22-27) — but a system/operator-owned row still must
 * not be returned to a tenant admin: the row id is the sole selector for
 * registerWorkerHeartbeat, so leaking a system row's id lets a tenant admin
 * mutate/offline an operator-owned target they do not own (cross-tenant DoS).
 * The run-routing read path (execution-target-resolver.ts
 * resolveExecutionTargetForRun) reads system rows SEPARATELY and never exposes
 * their ids to a caller, so routing to the shared pool is unaffected.
 */
export async function listExecutionTargets(db: Db, organizationId: string | null) {
  // organizationId is required to see any target; a null org sees nothing — and
  // must not even scan the table (system rows must never surface to a tenant admin;
  // the row id is the sole selector for registerWorkerHeartbeat, not a credential).
  if (organizationId == null) return [];
  // Scope in SQL (index execution_targets_org_idx); the no-system/cross-org
  // guarantee is the WHERE clause, not a JS post-filter.
  return (await db.select().from(executionTargets).where(eq(executionTargets.organizationId, organizationId))).map(
    stripWorkerSecret,
  );
}
