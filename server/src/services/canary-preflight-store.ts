// server/src/services/canary-preflight-store.ts
//
// CLI-006 (D2) — drizzle wiring for the canary preflight's read-only store.
//
// Kept OUT of the pure `canary-preflight.ts` acceptance module so its fail-first
// unit tests never load drizzle internals (Test Patterns rule), exactly as MIG-008
// keeps `legacy-resource-reconciliation-store.ts` out of its acceptance module.
//
// It ONCE delegated `listLeases` / `platformDefaultEnv` / `currentKeyGeneration` to
// MIG-008's own `createDrizzleReconciliationStore` rather than re-querying, so the gate
// would see exactly the inventory the reconciler recorded. BLOCKER E (E-1) inverted that
// rationale: the delegation was right about WHAT to read and wrong about WHO reads it.
// That store queries `environment_leases` / `environments` / `runtime_provider_keys` /
// `company_secret_versions` DIRECTLY, while THIS store runs on the NON-OWNER `aoa_app`
// pool, which holds ZERO privileges on all four. Every call raised 42501, the catch at
// `canary-preflight.ts:191-200` folded it into `preflight_error`, and the gate could not
// even say why it was closed.
//
// The three reads now go through an owner-owned SECURITY DEFINER function
// (`canary-preflight-evidence.ts`, migration 0266). The original guarantee is PRESERVED:
// the function reads the same rows with the same predicates. It changes WHO may read
// them, not WHAT is read. A table grant was not an option — `company_secret_versions.material`
// is AES-256-GCM secret material and `environment_leases.metadata` is secret-bearing at rest.
//
// Only two reads are genuinely new, and neither exists on the reconciler's store
// because the reconciler never needs them: it works one Company at a time and
// computes closure over records it is building, not over records already persisted.
//
// The mutating half of the reconciler's store (`casClaimPaused`,
// `insertRecordIfAbsent`) is NOT re-exposed here — `CanaryPreflightStore` has no
// such members, so the gate structurally cannot reconcile as a side effect of being
// consulted.

import { and, eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { companies, legacyResourceReconciliation } from "@armyofagents/db";
import { readCanaryPreflightEvidence } from "./canary-preflight-evidence.js";
import type { CanaryPreflightStore } from "./canary-preflight.js";
import type {
  LegacyLeaseInput,
  ReconciliationRecord,
} from "./legacy-resource-reconciliation.js";

export function createDrizzleCanaryPreflightStore(db: Db): CanaryPreflightStore {
  return {
    // NEW. The canary flag is Organization-scoped while reconciliation closure is
    // Company-scoped, and one Organization may hold many Companies — so the gate
    // must enumerate all of them. Checking only the run's Company would let an
    // Organization be canaried while a sibling Company's legacy leases stay
    // unreconciled (design §2.8).
    listOrganizationCompanyIds: async (organizationId: string) => {
      const rows = await db
        .select({ id: companies.id })
        .from(companies)
        .where(eq(companies.organizationId, organizationId));
      return rows.map((row) => row.id);
    },

    // NEW. The reconciler only ever inserts; nothing needed to READ the persisted
    // crosswalk back until a gate had to recompute closure without mutating.
    listRecords: async (companyId: string): Promise<readonly ReconciliationRecord[]> => {
      const rows = await db
        .select()
        .from(legacyResourceReconciliation)
        .where(and(eq(legacyResourceReconciliation.companyId, companyId)));
      return rows.map((row) => ({
        companyId: row.companyId,
        environmentLeaseId: row.environmentLeaseId,
        environmentId: row.environmentId,
        resourceKey: row.resourceKey,
        resourceType: row.resourceType as ReconciliationRecord["resourceType"],
        legacyStatus: row.legacyStatus,
        provider: row.provider,
        providerLeaseId: row.providerLeaseId,
        disposition: row.disposition as ReconciliationRecord["disposition"],
        resourceLabelsHash: row.resourceLabelsHash,
        keyGeneration: row.keyGeneration,
        cleanupOutcome: row.cleanupOutcome,
        reason: row.reason,
      }));
    },

    // BLOCKER E — these three no longer delegate to the reconciler's drizzle store (see
    // the file header). They read the SAME rows with the SAME predicates, through the
    // owner-owned SECURITY DEFINER function, on the pool that is actually allowed to.
    listLeases: async (companyId: string): Promise<readonly LegacyLeaseInput[]> => {
      const evidence = await readCanaryPreflightEvidence(db, companyId);
      // The gate consumes ONLY `lease.id`: `inventoryKeysForCompany`
      // (canary-preflight.ts:115-122) maps `resourceKeyForLease(lease.id)`, and
      // `resourceKeyForLease` is the identity function
      // (legacy-resource-reconciliation.ts:194-196). The other twelve fields on
      // LegacyLeaseInput serve the reconciler's CLASSIFIER, which this gate never runs.
      // `cli-006-canary-preflight.test.ts` pins that narrowing, so a future gate change
      // that reads another field fails there instead of seeing `undefined` in production.
      return evidence.leaseIds.map((id) => ({ id }) as LegacyLeaseInput);
    },
    platformDefaultEnv: async (companyId: string) => {
      const evidence = await readCanaryPreflightEvidence(db, companyId);
      return evidence.platformDefaultEnvironmentId
        ? { environmentId: evidence.platformDefaultEnvironmentId }
        : null;
    },
    currentKeyGeneration: async (companyId: string) => {
      const evidence = await readCanaryPreflightEvidence(db, companyId);
      return evidence.keyGeneration;
    },
  };
}
