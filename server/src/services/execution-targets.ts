import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { executionTargets } from "@armyofagents/db";

// Rotatable worker credential (Finding #3). The row id is NOT a credential;
// this token is. Only its hash is persisted (execution_targets.worker_token_hash);
// the plaintext is shown once at registration.
export function createWorkerToken(): string {
  return `aoa_wtk_${randomBytes(24).toString("hex")}`;
}
export function hashWorkerToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
export async function resolveWorkerTargetId(db: Db, token: string): Promise<string | null> {
  const trimmed = token.trim();
  if (!trimmed) return null;
  const rows = await db
    .select({ id: executionTargets.id })
    .from(executionTargets)
    .where(eq(executionTargets.workerTokenHash, hashWorkerToken(trimmed)));
  return rows[0]?.id ?? null;
}
export function stripWorkerSecret<T extends { workerTokenHash?: unknown }>(row: T): Omit<T, "workerTokenHash"> {
  const { workerTokenHash: _omit, ...rest } = row;
  return rest;
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
export async function registerWorkerHeartbeat(
  db: Db,
  input: { targetId: string; status?: "active" | "draining" | "offline"; capabilities?: Record<string, unknown> },
): Promise<{ updated: number }> {
  const rows = await db
    .update(executionTargets)
    .set({
      lastSeenAt: new Date(),
      status: input.status ?? "active",
      ...(input.capabilities ? { capabilities: input.capabilities } : {}),
      updatedAt: new Date(),
    })
    .where(eq(executionTargets.id, input.targetId))
    .returning({ id: executionTargets.id });
  return { updated: rows.length };
}

/**
 * List execution targets an org ADMIN may see/manage: ONLY the org's own rows.
 *
 * SECURITY (P5 review, finding #1): this list must NOT include system/shared rows
 * (organizationId = NULL — the seeded control-plane target + operator-registered
 * pool targets). Their primary-key UUID doubles as the worker bearer token
 * (routes/execution-targets.ts:16-27), so returning a system row to a tenant admin
 * hands them a credential to mutate/offline an operator-owned target they do not
 * own (cross-tenant DoS). The run-routing read path (execution-target-resolver.ts
 * resolveExecutionTargetForRun) reads system rows SEPARATELY and never exposes
 * their ids to a caller, so routing to the shared pool is unaffected.
 */
export async function listExecutionTargets(db: Db, organizationId: string | null) {
  // organizationId is required to see any target; a null org sees nothing — and
  // must not even scan the table (its id doubles as the worker bearer token).
  if (organizationId == null) return [];
  // Scope in SQL (index execution_targets_org_idx); the no-system/cross-org
  // guarantee is the WHERE clause, not a JS post-filter.
  return (await db.select().from(executionTargets).where(eq(executionTargets.organizationId, organizationId))).map(
    stripWorkerSecret,
  );
}
