import type { Db } from "@armyofagents/db";
import { legacyResourceReconciliation } from "@armyofagents/db";
import {
  readCanaryPreflightCompanyIds,
  readCanaryPreflightScalars,
} from "./canary-preflight-evidence.js";
import { readLegacyReconciliationLeases } from "./legacy-reconciliation-evidence.js";
import type {
  LegacyReconciliationStore,
  ReconciliationRecord,
} from "./legacy-resource-reconciliation.js";

/**
 * MIG-008 drizzle wiring for the reconciler's {@link LegacyReconciliationStore}
 * seam. Kept OUT of the pure `legacy-resource-reconciliation.ts` acceptance module
 * so the fail-first unit tests never load drizzle internals (Test Patterns rule).
 *
 * ADDITIVE and, since Option R (MIG-010 Unit 2.3), READ-ONLY against tenant data: it reads
 * the LIVE `environment_leases` model and appends idempotently to the crosswalk. It no
 * longer claims paused rows via `expireLeaseIfPaused` — that CAS was an UPDATE on a relation
 * `aoa_operator` holds no write grant on, so it made the pass unrunnable. It NEVER kills a
 * live sandbox and NEVER removes a legacy path (that retires at MIG-006/007).
 *
 * ★ EVERY TENANT READ NOW GOES THROUGH OWNER AUTHORITY, exactly as BLOCKER E-1 did for the
 * gate. This store once queried `environment_leases` / `environments` /
 * `runtime_provider_keys` / `company_secret_versions` DIRECTLY while running on
 * `aoa_operator`, which holds ZERO privileges on all four — so every call raised 42501 and
 * the pass could not have run even with the caller E10-F002 asks for. The three reads are
 * now definer calls: `legacy_reconciliation_leases` (0268) for the classification columns,
 * and `canary_preflight_evidence_scalars` (0267) for the default env + key generation. The
 * only write left is the crosswalk insert, on the one relation the operator role is granted.
 *
 * ★ THE KEY GENERATION IS THE GATE'S READ, NOT A SECOND DERIVATION. It previously called
 * `deriveE2bKeyGeneration`; the gate reads `canary_preflight_evidence_scalars`. Two
 * derivations of the same fact can disagree — and if they do, the pass tags its records with
 * one generation while the gate compares against another, and every company refuses as
 * `credential_authority_not_moved` with records that look correct. Same function, same
 * predicates, one answer.
 */
export function createDrizzleReconciliationStore(db: Db): LegacyReconciliationStore {
  return {
    // Org->companies through the `0267` definer function, not a direct `companies` select:
    // `aoa_operator` holds no grant on `companies` or `organizations` at all. This is the
    // same read the gate uses, so the pass and the gate enumerate the identical set.
    listOrganizationCompanyIds: async (organizationId: string) =>
      readCanaryPreflightCompanyIds(db, organizationId),

    // The classification read, through the 0268 definer function. `organizationId` is
    // load-bearing now: the function is organization-bound.
    listLeases: (organizationId: string, companyId: string) =>
      readLegacyReconciliationLeases(db, organizationId, companyId),

    platformDefaultEnv: async (organizationId: string, companyId: string) => {
      const scalars = await readCanaryPreflightScalars(db, organizationId, companyId);
      return scalars.platformDefaultEnvironmentId
        ? { environmentId: scalars.platformDefaultEnvironmentId }
        : null;
    },

    // ★ THE GATE'S READ, DELIBERATELY. See the header: a second derivation that drifts makes
    // every company refuse as `credential_authority_not_moved` while its records look right.
    currentKeyGeneration: async (organizationId: string, companyId: string) => {
      const scalars = await readCanaryPreflightScalars(db, organizationId, companyId);
      return scalars.keyGeneration;
    },

    // `casClaimPaused` lived here, calling `environments$.expireLeaseIfPaused`. Option R
    // (MIG-010 Unit 2.3) removed it: it was an UPDATE on `environment_leases`, and
    // `aoa_operator` — the role this store must run as — holds no write grant there. The
    // pass could not run while it existed.
    insertRecordIfAbsent: async (record: ReconciliationRecord): Promise<boolean> => {
      const inserted = await db
        .insert(legacyResourceReconciliation)
        .values({
          companyId: record.companyId,
          environmentLeaseId: record.environmentLeaseId,
          environmentId: record.environmentId,
          resourceKey: record.resourceKey,
          resourceType: record.resourceType,
          legacyStatus: record.legacyStatus,
          provider: record.provider,
          providerLeaseId: record.providerLeaseId,
          disposition: record.disposition,
          resourceLabelsHash: record.resourceLabelsHash,
          keyGeneration: record.keyGeneration,
          cleanupOutcome: record.cleanupOutcome,
          reason: record.reason,
        })
        .onConflictDoNothing({
          target: [legacyResourceReconciliation.companyId, legacyResourceReconciliation.resourceKey],
        })
        .returning({ id: legacyResourceReconciliation.id });
      return inserted.length > 0;
    },
  };
}
