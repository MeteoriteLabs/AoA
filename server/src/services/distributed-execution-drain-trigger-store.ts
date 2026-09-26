// server/src/services/distributed-execution-drain-trigger-store.ts
//
// MIG-009 (M1a) — the drizzle composition for the operator drain trigger, kept OUT of the pure
// `distributed-execution-drain-trigger.ts` module so its unit tests never load drizzle internals
// (Test Patterns rule; the same split as `job-distributed-drain-store.ts`).
//
// Every dependency is the REAL production one, reused by reference — nothing is re-derived:
//
//   * listAdmittedOrganizationIds — `createAdmittedOrganizationIdsLister`, the one enumerator the
//     server's outbox worker, convergence sweeper and revocation fanout use (bounded `aoa_app`).
//   * listOrganizationCompanyIds / listActiveAttempts — `createDistributedExecutionDrainStore`,
//     shipped by MIG-009 (operator pool for the SECURITY DEFINER Company enumeration, app pool for
//     the tenant-scoped attempt read).
//   * assertRollbackSafe — the REAL budget-cost bridge's per-Company authoritative-cost gate.
//   * withTenant — `runInTenant` on the `aoa_app` pool: the attempt's cancel
//     (`repos.jobControl.requestCancellation`) and its `job.drain.requested` activity_log row
//     (`recordJobDrainActivity`, the E9-F010 helper the HTTP drain route already uses) share ONE
//     tenant transaction bound to that attempt's organization (decision E10-D002).
//
// The activity row is NOT published to the live-event channel: a CLI process has no subscribers,
// and a pre-commit publish would be wrong anyway. The durable row is the record.

import type { Db } from "@armyofagents/db";
import { runInTenant } from "../db/tenant-context.js";
import { createAdmittedOrganizationIdsLister } from "./admitted-organizations.js";
import type { DrainTriggerDeps } from "./distributed-execution-drain-trigger.js";
import { jobBudgetCostBridge } from "./job-budget-cost-bridge.js";
import { recordJobDrainActivity } from "./job-control-audit.js";
import { createDistributedExecutionDrainStore } from "./job-distributed-drain-store.js";

export function composeDistributedExecutionDrainTriggerDeps(input: {
  appDb: Db;
  operatorDb: Db;
  env?: Record<string, string | undefined>;
}): DrainTriggerDeps {
  const store = createDistributedExecutionDrainStore(input.appDb, input.operatorDb);
  const bridge = jobBudgetCostBridge(input.appDb, input.env ? { env: input.env } : undefined);
  return {
    listAdmittedOrganizationIds: createAdmittedOrganizationIdsLister(input.appDb),
    listOrganizationCompanyIds: (organizationId) => store.listOrganizationCompanyIds(organizationId),
    listActiveAttempts: (organizationId) => store.listActiveAttempts(organizationId),
    assertRollbackSafe: (companyId) => bridge.assertRollbackSafe(companyId),
    withTenant: (organizationId, work) =>
      runInTenant(input.appDb, organizationId, async (repos, tx) =>
        work({
          currentDatabaseTime: () => repos.jobControl.currentDatabaseTime(),
          requestCancellation: (cancel) => repos.jobControl.requestCancellation(cancel),
          recordDrainAudit: async (audit) => {
            await recordJobDrainActivity(tx, {
              actor: audit.actor,
              companyId: audit.companyId,
              organizationId: audit.organizationId,
              jobId: audit.jobId,
              outcome: audit.outcome,
              commandId: audit.commandId,
              reason: audit.reason,
            });
          },
        }),
      ),
  };
}
