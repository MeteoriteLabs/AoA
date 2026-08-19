import { eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { environmentLeases, environments, legacyResourceReconciliation } from "@armyofagents/db";
import { environmentService } from "./environments.js";
import { derivePlatformDefaultEnvironmentId } from "./platform-default-environment.js";
import { deriveE2bKeyGeneration } from "./e2b-credential-authority-wiring.js";
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
 * ADDITIVE: reads the LIVE `environment_leases` model, claims paused rows via the
 * SAME `status='paused'` CAS the warm reaper uses (`expireLeaseIfPaused`), and
 * appends idempotently to the crosswalk. It NEVER kills a live sandbox and NEVER
 * removes a legacy path (that retires at MIG-006/007).
 */
export function createDrizzleReconciliationStore(db: Db): LegacyReconciliationStore {
  const environments$ = environmentService(db);
  return {
    listLeases: async (companyId: string): Promise<readonly LegacyLeaseInput[]> => {
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
    platformDefaultEnv: async (companyId: string) => {
      const id = derivePlatformDefaultEnvironmentId(companyId);
      const [row] = await db
        .select({ id: environments.id })
        .from(environments)
        .where(eq(environments.id, id))
        .limit(1);
      return row ? { environmentId: row.id } : null;
    },
    currentKeyGeneration: (companyId: string) => deriveE2bKeyGeneration(db, companyId),
    casClaimPaused: async (leaseId: string): Promise<boolean> => {
      // paused → expired status-guarded CAS (the DESTROY-side latch). No provider
      // kill here: the reconciler records a terminal disposition; the actual sandbox
      // teardown is CLI-004's job at cutover.
      const claimed = await environments$.expireLeaseIfPaused(leaseId, {
        cleanupStatus: "pending",
      });
      return claimed !== null;
    },
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
