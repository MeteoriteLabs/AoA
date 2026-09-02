import { eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { environmentLeases, environments, legacyResourceReconciliation } from "@armyofagents/db";
import { derivePlatformDefaultEnvironmentId } from "./platform-default-environment.js";
import { deriveE2bKeyGeneration } from "./e2b-credential-authority-wiring.js";
import { readCanaryPreflightCompanyIds } from "./canary-preflight-evidence.js";
import type {
  LegacyLeaseInput,
  LegacyReconciliationStore,
  ReconciliationRecord,
} from "./legacy-resource-reconciliation.js";

/**
 * MIG-008 drizzle wiring for the reconciler's {@link LegacyReconciliationStore}
 * seam. Kept OUT of the pure `legacy-resource-reconciliation.ts` acceptance module
 * so the fail-first unit tests never load drizzle internals (Test Patterns rule).
 *
 * ADDITIVE and, since Option R (MIG-010 Unit 2.3), READ-ONLY against tenant data: it
 * reads the LIVE `environment_leases` model and appends idempotently to the crosswalk.
 * It no longer claims paused rows via `expireLeaseIfPaused` — that CAS was an UPDATE on
 * a relation `aoa_operator` holds no write grant on, so it made the pass unrunnable. It
 * NEVER kills a live sandbox and NEVER removes a legacy path (that retires at
 * MIG-006/007).
 */
export function createDrizzleReconciliationStore(db: Db): LegacyReconciliationStore {
  return {
    // Org->companies through the `0267` definer function, not a direct `companies` select:
    // `aoa_operator` holds no grant on `companies` or `organizations` at all. This is the
    // same read the gate uses, so the pass and the gate enumerate the identical set.
    listOrganizationCompanyIds: async (organizationId: string) =>
      readCanaryPreflightCompanyIds(db, organizationId),

    // ★ `organizationId` is accepted and NOT YET USED by the three reads below. They still
    // query the tenant tables directly, which is exactly why the pass cannot run as
    // `aoa_operator` (42501 on the first read). Task 7 points them at the definer functions,
    // which is where the parameter becomes load-bearing. It is named `_organizationId` so
    // the unused-parameter rule states the gap rather than hiding it.
    listLeases: async (
      _organizationId: string,
      companyId: string,
    ): Promise<readonly LegacyLeaseInput[]> => {
      const rows = await db
        .select()
        .from(environmentLeases)
        .where(eq(environmentLeases.companyId, companyId));
      return rows.map((row) => ({
        id: row.id,
        companyId: row.companyId,
        environmentId: row.environmentId,
        status: row.status,
        leasePolicy: row.leasePolicy,
        provider: row.provider,
        providerLeaseId: row.providerLeaseId,
        agentId: row.agentId,
        commanderConversationId: row.commanderConversationId,
        executionWorkspaceId: row.executionWorkspaceId,
        issueId: row.issueId,
        heartbeatRunId: row.heartbeatRunId,
        cleanupStatus: row.cleanupStatus,
      }));
    },
    platformDefaultEnv: async (_organizationId: string, companyId: string) => {
      const id = derivePlatformDefaultEnvironmentId(companyId);
      const [row] = await db
        .select({ id: environments.id })
        .from(environments)
        .where(eq(environments.id, id))
        .limit(1);
      return row ? { environmentId: row.id } : null;
    },
    currentKeyGeneration: (_organizationId: string, companyId: string) =>
      deriveE2bKeyGeneration(db, companyId),
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
