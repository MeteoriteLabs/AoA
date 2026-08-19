// server/src/services/canary-preflight-store.ts
//
// CLI-006 (D2) — drizzle wiring for the canary preflight's read-only store.
//
// Kept OUT of the pure `canary-preflight.ts` acceptance module so its fail-first
// unit tests never load drizzle internals (Test Patterns rule), exactly as MIG-008
// keeps `legacy-resource-reconciliation-store.ts` out of its acceptance module.
//
// It DELEGATES `listLeases` / `platformDefaultEnv` / `currentKeyGeneration` to
// MIG-008's own `createDrizzleReconciliationStore` rather than re-querying. That is
// deliberate: the gate must see exactly the inventory the reconciler recorded, and a
// parallel re-implementation is precisely how CLI-002's memory bundle drifted from
// the crew lineage it claimed parity with and silently dropped a security predicate.
// Reuse makes divergence impossible rather than merely unlikely.
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
import { createDrizzleReconciliationStore } from "./legacy-resource-reconciliation-store.js";
import type { CanaryPreflightStore } from "./canary-preflight.js";
import type { ReconciliationRecord } from "./legacy-resource-reconciliation.js";

export function createDrizzleCanaryPreflightStore(db: Db): CanaryPreflightStore {
  const reconciliation = createDrizzleReconciliationStore(db);

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

    // Delegated — same inventory the reconciler wrote from.
    listLeases: reconciliation.listLeases,
    platformDefaultEnv: reconciliation.platformDefaultEnv,
    currentKeyGeneration: reconciliation.currentKeyGeneration,
  };
}
