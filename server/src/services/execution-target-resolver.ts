// server/src/services/execution-target-resolver.ts
import { or, isNull, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { Db } from "@armyofagents/db";
import { executionTargets } from "@armyofagents/db";
import {
  canonicalizeJsonV1,
  registeredTargetProfileV1Schema,
  verifyAndBrandProviderConstraintProfileV1,
  type RegisteredTargetProfileV1,
  type VerifiedProviderConstraintProfileV1,
} from "@armyofagents/worker-protocol";

export interface ExecutionTargetRow {
  id: string;
  slug: string;
  kind: string;
  trustClass: string;
  status: string;
  organizationId: string | null;
  ownerUserId?: string | null;
  scope?: string;
  targetAuthorityKey?: string;
  deviceGeneration?: number;
  registeredProfile?: Record<string, unknown> | null;
  registeredProfileHash?: string | null;
  providerConstraintProfile?: Record<string, unknown> | null;
  lastSeenAt?: Date | null;
  config?: Record<string, unknown>;
}

export interface NormalizedPlacementRegistryTarget {
  targetId: string;
  targetSlug: string;
  targetClass: RegisteredTargetProfileV1["targetClass"];
  targetScope: RegisteredTargetProfileV1["scope"];
  targetGeneration: number;
  profileHash: string;
  providerConstraintHash: string;
  status: string;
  lastSeenAt: Date | null;
  registeredProfile: RegisteredTargetProfileV1;
  providerConstraintProfile: VerifiedProviderConstraintProfileV1;
}

const TARGET_KIND_BY_CLASS = {
  managed_cloud: new Set(["pooled_gvisor", "e2b"]),
  organization_dedicated: new Set(["dedicated_worker"]),
  owner_desktop: new Set(["desktop", "local_host"]),
} as const;

const LEGACY_TRUST_BY_CLASS = {
  managed_cloud: "shared_multitenant",
  organization_dedicated: "dedicated_tenant",
  owner_desktop: "local_trusted",
} as const;

const PLACEMENT_SCOPE_PRIORITY = {
  platform: 0,
  organization: 1,
  owner: 2,
} as const;

const PLACEMENT_CLASS_PRIORITY = {
  managed_cloud: 0,
  organization_dedicated: 1,
  owner_desktop: 2,
} as const;

function compareStableText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Stable pre-resolution order for Decision #117. The resolver keeps all of
 * its existing pin/credential semantics; this only removes repository/heap
 * enumeration as an authority input. Invalid or missing registered profiles
 * sort after mapped authority and still fail closed during normalization.
 */
export function sortExecutionTargetRowsForPlacement(
  targets: readonly ExecutionTargetRow[],
): ExecutionTargetRow[] {
  const authority = (target: ExecutionTargetRow) => {
    const parsed = registeredTargetProfileV1Schema.safeParse(target.registeredProfile);
    if (!parsed.success) return { scope: 3, targetClass: 3 };
    return {
      scope: PLACEMENT_SCOPE_PRIORITY[parsed.data.scope],
      targetClass: PLACEMENT_CLASS_PRIORITY[parsed.data.targetClass],
    };
  };
  return [...targets].sort((left, right) => {
    const leftAuthority = authority(left);
    const rightAuthority = authority(right);
    return leftAuthority.scope - rightAuthority.scope
      || leftAuthority.targetClass - rightAuthority.targetClass
      || compareStableText(left.slug, right.slug)
      || compareStableText(left.id, right.id);
  });
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Normalize one bounded registry row into the frozen E1 placement vocabulary.
 * Missing legacy profiles stay unmapped. Every duplicated identity/scope/class
 * fact must agree, so neither a legacy row nor a worker report can promote it.
 */
export async function normalizePlacementRegistryTarget(
  row: ExecutionTargetRow,
): Promise<NormalizedPlacementRegistryTarget | null> {
  if (!row.registeredProfile || !row.providerConstraintProfile || !row.registeredProfileHash) {
    return null;
  }
  const parsed = registeredTargetProfileV1Schema.safeParse(row.registeredProfile);
  if (!parsed.success) return null;
  const profile = parsed.data;
  const provider = await verifyAndBrandProviderConstraintProfileV1(
    row.providerConstraintProfile,
    (bytes) => sha256(bytes),
  );
  if (!provider) return null;

  const calculatedProfileHash = sha256(canonicalizeJsonV1(profile));
  if (calculatedProfileHash !== row.registeredProfileHash) return null;
  if (String(profile.targetId) !== row.id) return null;
  if (profile.organizationId !== row.organizationId) return null;
  if (profile.ownerPrincipalId !== (row.ownerUserId ?? null)) return null;
  if (profile.scope !== row.scope) return null;
  if (profile.deviceGeneration !== row.deviceGeneration) return null;
  if (!TARGET_KIND_BY_CLASS[profile.targetClass].has(row.kind as never)) return null;
  if (LEGACY_TRUST_BY_CLASS[profile.targetClass] !== row.trustClass) return null;
  if (profile.providerConstraints.profileId !== provider.profileId) return null;
  if (profile.providerConstraints.version !== provider.version) return null;
  if (profile.providerConstraints.digest !== provider.digest) return null;

  const expectedAuthority = profile.scope === "platform"
    ? "platform"
    : profile.scope === "organization"
      ? `organization:${profile.organizationId}`
      : `owner:${profile.organizationId}:${profile.ownerPrincipalId}`;
  if (row.targetAuthorityKey !== expectedAuthority) return null;

  return {
    targetId: row.id,
    targetSlug: row.slug,
    targetClass: profile.targetClass,
    targetScope: profile.scope,
    targetGeneration: profile.deviceGeneration,
    profileHash: calculatedProfileHash,
    providerConstraintHash: String(provider.digest),
    status: row.status,
    lastSeenAt: row.lastSeenAt ?? null,
    registeredProfile: profile,
    providerConstraintProfile: provider,
  };
}

// `credentialKind` + `executionTargetSlug` are P4's normalized seam field names.
export function chooseExecutionTargetRow(input: {
  credentialKind: "company_api_key" | "personal_subscription" | null;
  pinnedTargetId: string | null;
  executionTargetSlug: string | null;
  targets: ExecutionTargetRow[];
}): ExecutionTargetRow | null {
  const active = input.targets.filter((t) => t.status === "active");
  if (input.pinnedTargetId) {
    const pinned = active.find((t) => t.id === input.pinnedTargetId);
    if (!pinned) throw new Error(`Pinned execution target ${input.pinnedTargetId} is not available.`);
    if (input.credentialKind === "personal_subscription" && input.executionTargetSlug && pinned.slug !== input.executionTargetSlug) {
      throw new Error("Pinned target does not match the subscription credential's execution target.");
    }
    return pinned;
  }
  if (input.credentialKind === "personal_subscription") {
    if (!input.executionTargetSlug) throw new Error("Personal subscription run has no bound execution target.");
    const match = active.find((t) => t.slug === input.executionTargetSlug && (t.kind === "dedicated_worker" || t.kind === "local_host"));
    if (!match) throw new Error(`No dedicated execution target matches credential target "${input.executionTargetSlug}".`);
    return match;
  }
  // company_api_key (business key) -> shared pool
  const pool = active.find((t) => t.kind === "pooled_gvisor");
  return pool ?? null; // null => caller falls back to local (self-hosted single tenant)
}

export async function resolveExecutionTargetForRun(
  db: Db,
  input: {
    organizationId: string | null;
    companyId: string;
    // credentialKind + executionTargetSlug come straight off P4's resolver seam.
    credentialKind: "company_api_key" | "personal_subscription" | null;
    pinnedTargetId: string | null;
    executionTargetSlug: string | null;
  },
): Promise<ExecutionTargetRow | null> {
  // System/shared targets (organizationId null) + this org's targets are both
  // eligible — scoped in SQL (index execution_targets_org_idx) rather than a
  // full-table scan + JS filter. For a null org, isNull() alone yields the system
  // rows (preserving the prior JS-filter behavior; eq() cannot take a null value,
  // and `col = NULL` would never match anyway).
  const orgScope =
    input.organizationId == null
      ? isNull(executionTargets.organizationId)
      : or(
          isNull(executionTargets.organizationId),
          eq(executionTargets.organizationId, input.organizationId),
        );
  const scoped = (await db
    .select({
      id: executionTargets.id,
      slug: executionTargets.slug,
      kind: executionTargets.kind,
      trustClass: executionTargets.trustClass,
      status: executionTargets.status,
      organizationId: executionTargets.organizationId,
      config: executionTargets.config,
    })
    .from(executionTargets)
    .where(orgScope)) as ExecutionTargetRow[];
  return chooseExecutionTargetRow({
    credentialKind: input.credentialKind,
    pinnedTargetId: input.pinnedTargetId,
    executionTargetSlug: input.executionTargetSlug,
    targets: scoped,
  });
}

const HARDENED_ISOLATION = {
  user: "1000:1000",
  capDropAll: true,
  noNewPrivileges: true,
  readOnlyRootfs: true,
  tmpfs: ["/tmp:rw,noexec,nosuid,size=64m", "/home/agent:rw,nosuid,size=256m"],
  memory: "2g",
  cpus: "2",
  pidsLimit: 512,
  ipcPrivate: true,
} as const;

export function executionTargetToAdapterConfig(
  target: ExecutionTargetRow,
  // Whether this run executes on SHARED multi-tenant infra. The security boundary
  // is deployment-mode, NOT organizationId: on a founder's OWN box (self-hosted
  // single_user/single_tenant) the config is trusted and must be honored, while on
  // shared infra this registry path must never execute in the control plane.
  // Fail-closed default (`true`) rejects when a caller forgets to pass; the sole
  // production caller (heartbeat) passes the resolved trust boundary explicitly.
  multiTenant = true,
): Record<string, unknown> | null {
  const cfg = target.config ?? {};
  if (target.kind === "local_host") return null; // local driver, no override
  if (target.kind === "pooled_gvisor" || target.kind === "dedicated_worker") {
    if (multiTenant) {
      throw new Error(
        "Cloud execution targets are registry-only until the gVisor worker pool and Gate-B hardware validation are complete.",
      );
    }
    // Self-hosted single-tenant execution is the only direct Docker path. The
    // founder owns this host, so preserve its authored callback/network profile.
    return {
      type: "sandbox-docker",
      image: (cfg.image as string) ?? "aoa/agent-base:latest",
      runtime: "runsc",
      network: (cfg.network as string) ?? "none",
      allowHostGateway: cfg.allowHostGateway === true,
      isolation: cfg.isolation ?? HARDENED_ISOLATION,
    };
  }
  return null;
}
