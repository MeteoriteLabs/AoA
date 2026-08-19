import { createHash } from "node:crypto";

/**
 * MIG-008 (E10 desktop-migration) — legacy E2B lease/resource RECONCILER.
 *
 * A pre-cutover, ADDITIVE reconciliation pass over the LIVE-deployed
 * `environment_leases` model (PR#320). It inventories every lease row (all 5
 * types) + the platform-default `environments` resource and emits exactly ONE
 * append-only crosswalk record per resource — a MAPPING or a TERMINAL cleanup
 * record — into `legacy_resource_reconciliation`.
 *
 * The core safety invariant (MIG-008 Invariant #2): an ACTIVE/live legacy lease
 * (a sandbox a legacy `adapter.execute` is running in) is NEVER assigned a
 * synthesized distributed `ResourceLabels` fence — it gets a MAPPING record
 * that carries ONLY a partial-attribution HASH (a string), never a leasable
 * fence object, and is left for drain. No legacy row is ever routed into
 * `EffectAuthority` (the reconciler has no dependency on it — the invariant
 * holds structurally). Only genuinely terminal / no-live-handle rows get a
 * terminal cleanup record; `cleanupStatus='failed'` composes CLI-004's reconcile
 * as the terminal record (no duplicate cleanup path).
 *
 * Paused rows are claimed via the SAME `AND status='paused'` compare-and-swap the
 * warm reaper uses (`expireLeaseIfPaused`), so the reconciler can never race a
 * concurrent warm-resume: the CAS loser no-ops on the resumed row.
 *
 * This module is deliberately DB-internals-free: it exposes pure classification +
 * record-building + closure helpers and a reconciler pass that drives an injected
 * {@link LegacyReconciliationStore} seam (drizzle wiring lives with the caller).
 */

export const LEGACY_RESOURCE_TYPES = [
  "ephemeral",
  "warm_org",
  "warm_commander",
  "workspace_ref",
  "platform_default_env",
] as const;
export type LegacyResourceType = (typeof LEGACY_RESOURCE_TYPES)[number];

export const RECONCILIATION_DISPOSITIONS = [
  "mapped",
  "terminal_cleanup",
  "unattributable",
] as const;
export type ReconciliationDisposition = (typeof RECONCILIATION_DISPOSITIONS)[number];

export interface LegacyLeaseInput {
  readonly id: string;
  readonly companyId: string;
  readonly environmentId: string | null;
  readonly status: string;
  readonly leasePolicy: string;
  readonly provider: string | null;
  readonly providerLeaseId: string | null;
  readonly agentId: string | null;
  readonly commanderConversationId: string | null;
  readonly executionWorkspaceId: string | null;
  readonly issueId: string | null;
  readonly heartbeatRunId: string | null;
  readonly cleanupStatus: string | null;
}

export interface LeaseClassification {
  /** null resourceType ⇒ the owner shape is unclassifiable (unattributable). */
  readonly resourceType: LegacyResourceType | null;
  readonly disposition: ReconciliationDisposition;
  readonly hasLiveHandle: boolean;
  /** Only a paused live row must be claimed via the status='paused' CAS. */
  readonly requiresPausedClaim: boolean;
  readonly cleanupOutcome: string | null;
  readonly reason: string;
}

/** A crosswalk record shape (append-only). NEVER carries a fence or key material. */
export interface ReconciliationRecord {
  readonly companyId: string;
  readonly environmentLeaseId: string | null;
  readonly environmentId: string | null;
  readonly resourceKey: string;
  // A resolved 5-type value, or "unattributable" when the owner shape is unclassifiable.
  readonly resourceType: LegacyResourceType | "unattributable";
  readonly legacyStatus: string | null;
  readonly provider: string | null;
  readonly providerLeaseId: string | null;
  readonly disposition: ReconciliationDisposition;
  readonly resourceLabelsHash: string | null;
  readonly keyGeneration: string | null;
  readonly cleanupOutcome: string | null;
  readonly reason: string;
}

const TERMINAL_STATUSES = new Set(["released", "expired", "failed", "retained"]);

/** Determine the resource TYPE from lease policy + owner FKs (5-type model). */
function resolveResourceType(lease: LegacyLeaseInput): LegacyResourceType | null {
  if (lease.leasePolicy === "ephemeral") return "ephemeral";
  if (lease.commanderConversationId) return "warm_commander";
  if (lease.agentId) return "warm_org";
  if (lease.executionWorkspaceId) return "workspace_ref";
  return null;
}

/**
 * Pure classification of one legacy lease into a type + disposition. NEVER
 * synthesizes a fence: a live active row is `mapped` (drain, hash-only); a paused
 * row is `terminal_cleanup` but requires the status='paused' CAS before recording;
 * terminal / no-handle rows are `terminal_cleanup`; an unclassifiable owner shape
 * is `unattributable` (surfaced, never dropped).
 */
export function classifyLease(lease: LegacyLeaseInput): LeaseClassification {
  const resourceType = resolveResourceType(lease);
  const hasLiveHandle =
    (lease.status === "active" || lease.status === "paused") &&
    typeof lease.providerLeaseId === "string" &&
    lease.providerLeaseId.length > 0;

  if (resourceType === null) {
    return {
      resourceType: null,
      disposition: "unattributable",
      hasLiveHandle,
      requiresPausedClaim: false,
      cleanupOutcome: null,
      reason: "unclassifiable owner shape — surfaced for manual attribution (never dropped)",
    };
  }

  const failedCleanup = lease.cleanupStatus === "failed";

  if (lease.status === "active" && hasLiveHandle) {
    // Live legacy execution — left for drain. Mapping record carries ONLY a
    // partial-attribution hash; NEVER a synthesized live fence (Invariant #2).
    return {
      resourceType,
      disposition: "mapped",
      hasLiveHandle: true,
      requiresPausedClaim: false,
      cleanupOutcome: null,
      reason: "active legacy execution — left for drain, no fence synthesized",
    };
  }

  if (lease.status === "paused") {
    // A held warm snapshot: reconciled terminally, but ONLY after the status=
    // 'paused' CAS claim (so a concurrent warm-resume can never be clobbered).
    return {
      resourceType,
      disposition: "terminal_cleanup",
      hasLiveHandle,
      requiresPausedClaim: true,
      cleanupOutcome: failedCleanup ? "delegated_cli004" : "paused_snapshot_reconciled",
      reason: failedCleanup
        ? "paused warm snapshot with failed cleanup — terminal via CLI-004 reconcile"
        : "paused warm snapshot — terminal cleanup after status='paused' CAS claim",
    };
  }

  // Terminal status OR no live handle. Any row reaching here has hasLiveHandle=false
  // (active+handle returns above; paused returns above), so the only non-failed outcome
  // is `no_handle` (the earlier `already_terminal` arm was dead — removed).
  const cleanupOutcome = failedCleanup ? "delegated_cli004" : "no_handle";
  return {
    resourceType,
    disposition: "terminal_cleanup",
    hasLiveHandle,
    requiresPausedClaim: false,
    cleanupOutcome,
    reason: failedCleanup
      ? "failed cleanup — terminal via CLI-004 reconcile composition"
      : TERMINAL_STATUSES.has(lease.status)
        ? "terminal lease — terminal cleanup record"
        : "no live provider handle — terminal cleanup record",
  };
}

/**
 * Deterministic partial-attribution HASH of a lease's owner FKs. This is the ONLY
 * distributed-attribution artifact a mapping record carries — never a leasable
 * `ResourceLabels` fence object (Invariant #2). No key material participates.
 */
export function computeResourceLabelsHash(lease: LegacyLeaseInput): string {
  const canonical = JSON.stringify([
    lease.companyId,
    lease.environmentId,
    lease.agentId,
    lease.commanderConversationId,
    lease.executionWorkspaceId,
    lease.provider,
    lease.providerLeaseId,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

export function resourceKeyForLease(leaseId: string): string {
  return leaseId;
}

export function resourceKeyForPlatformDefaultEnv(environmentId: string): string {
  return `platform-default-env:${environmentId}`;
}

/** Build the append-only crosswalk record for a classified lease. */
export function buildLeaseRecord(
  lease: LegacyLeaseInput,
  classification: LeaseClassification,
  opts: { keyGeneration: string | null },
): ReconciliationRecord {
  // A mapping record carries the attribution hash; a terminal/unattributable
  // record does not need it (no live handle to attribute).
  const resourceLabelsHash =
    classification.disposition === "mapped" ? computeResourceLabelsHash(lease) : null;
  return {
    companyId: lease.companyId,
    environmentLeaseId: lease.id,
    environmentId: lease.environmentId,
    resourceKey: resourceKeyForLease(lease.id),
    // A null resourceType only reaches here for an `unattributable` disposition —
    // record the honest "unattributable" sentinel (never a misleading real bucket).
    resourceType: classification.resourceType ?? "unattributable",
    legacyStatus: lease.status,
    provider: lease.provider,
    providerLeaseId: lease.providerLeaseId,
    disposition: classification.disposition,
    resourceLabelsHash,
    keyGeneration: opts.keyGeneration,
    cleanupOutcome: classification.cleanupOutcome,
    reason: classification.reason,
  };
}

/** Build the append-only record for the platform-default env resource. */
export function buildPlatformDefaultEnvRecord(input: {
  companyId: string;
  environmentId: string;
  keyGeneration: string | null;
}): ReconciliationRecord {
  return {
    companyId: input.companyId,
    environmentLeaseId: null,
    environmentId: input.environmentId,
    resourceKey: resourceKeyForPlatformDefaultEnv(input.environmentId),
    resourceType: "platform_default_env",
    legacyStatus: null,
    provider: "e2b",
    providerLeaseId: null,
    disposition: "mapped",
    // No live handle to attribute; the operator key is NEVER stored (parity with
    // platform-default-environment.ts, which keeps E2B_API_KEY out of the row).
    resourceLabelsHash: null,
    keyGeneration: input.keyGeneration,
    cleanupOutcome: null,
    reason: "platform-default environment resource — accounted, operator key never persisted",
  };
}

// --- closure gate ------------------------------------------------------------

export interface ClosureResult {
  readonly ok: boolean;
  readonly unmapped: readonly string[];
  readonly unattributable: readonly string[];
  readonly duplicates: readonly string[];
}

/**
 * Assert every inventoried resource has EXACTLY one crosswalk record and surface
 * any `unattributable` disposition. `ok` is false if any resource is unmapped,
 * duplicated, or unattributable (none is ever silently tolerated).
 */
export function assertClosure(input: {
  inventoryKeys: readonly string[];
  records: readonly { resourceKey: string; disposition: string }[];
}): ClosureResult {
  const countByKey = new Map<string, number>();
  const unattributableSet = new Set<string>();
  for (const record of input.records) {
    countByKey.set(record.resourceKey, (countByKey.get(record.resourceKey) ?? 0) + 1);
    if (record.disposition === "unattributable") unattributableSet.add(record.resourceKey);
  }
  const unmapped: string[] = [];
  for (const key of input.inventoryKeys) {
    if (!countByKey.has(key)) unmapped.push(key);
  }
  const duplicates: string[] = [];
  for (const [key, count] of countByKey) {
    if (count > 1) duplicates.push(key);
  }
  const unattributable = [...unattributableSet];
  return {
    ok: unmapped.length === 0 && duplicates.length === 0 && unattributable.length === 0,
    unmapped,
    unattributable,
    duplicates,
  };
}

// --- reconciler pass ---------------------------------------------------------

export interface LegacyReconciliationStore {
  /** All `environment_leases` rows for the company (owner-served). */
  listLeases(companyId: string): Promise<readonly LegacyLeaseInput[]>;
  /** The materialized platform-default env row id, or null when none exists. */
  platformDefaultEnv(companyId: string): Promise<{ environmentId: string } | null>;
  /** The current per-company key generation (D3 attribution tag), or null. */
  currentKeyGeneration(companyId: string): Promise<string | null>;
  /** Status='paused' CAS claim (paused → expired). true = claimed, false = lost. */
  casClaimPaused(leaseId: string): Promise<boolean>;
  /** Append-only insert; false when a record for that resourceKey already exists. */
  insertRecordIfAbsent(record: ReconciliationRecord): Promise<boolean>;
}

export interface ReconcileResult {
  readonly closure: ClosureResult;
  readonly insertedKeys: readonly string[];
  readonly skippedResumed: readonly string[];
  readonly unattributableKeys: readonly string[];
}

/**
 * Reconcile one company's legacy E2B leases + platform-default env resource into
 * the append-only crosswalk. Idempotent (append-only insert-if-absent). Paused
 * rows are CAS-claimed; a lost CAS (concurrent resume) no-ops on that row.
 */
export async function reconcileCompanyLegacyResources(
  companyId: string,
  deps: { store: LegacyReconciliationStore },
): Promise<ReconcileResult> {
  const { store } = deps;
  const [leases, platformDefault, keyGeneration] = await Promise.all([
    store.listLeases(companyId),
    store.platformDefaultEnv(companyId),
    store.currentKeyGeneration(companyId),
  ]);

  const inventoryKeys: string[] = [];
  const records: ReconciliationRecord[] = [];
  const insertedKeys: string[] = [];
  const skippedResumed: string[] = [];

  for (const lease of leases) {
    const classification = classifyLease(lease);

    // A paused live row must win the status='paused' CAS before we record a
    // terminal disposition — else a concurrent warm-resume owns it; no-op.
    if (classification.requiresPausedClaim) {
      const claimed = await store.casClaimPaused(lease.id);
      if (!claimed) {
        skippedResumed.push(lease.id);
        continue; // resumed row: not part of this pass's closure inventory
      }
    }

    inventoryKeys.push(resourceKeyForLease(lease.id));
    const record = buildLeaseRecord(lease, classification, { keyGeneration });
    records.push(record);
    if (await store.insertRecordIfAbsent(record)) insertedKeys.push(record.resourceKey);
  }

  if (platformDefault) {
    const record = buildPlatformDefaultEnvRecord({
      companyId,
      environmentId: platformDefault.environmentId,
      keyGeneration,
    });
    inventoryKeys.push(record.resourceKey);
    records.push(record);
    if (await store.insertRecordIfAbsent(record)) insertedKeys.push(record.resourceKey);
  }

  const closure = assertClosure({ inventoryKeys, records });
  return {
    closure,
    insertedKeys,
    skippedResumed,
    unattributableKeys: closure.unattributable,
  };
}
