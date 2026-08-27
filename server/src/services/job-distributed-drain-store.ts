// server/src/services/job-distributed-drain-store.ts
//
// MIG-009 — drizzle wiring for the flag-disable drain's two read-only deps, kept OUT of
// the pure `job-distributed-drain.ts` module so that module's fail-first unit tests never
// load drizzle internals (Test Patterns rule), exactly as `canary-preflight-store.ts`
// keeps the drizzle reads out of the pure `canary-preflight.ts` acceptance module.
//
//   * listOrganizationCompanyIds — REUSES the canary-preflight primitive by reference
//     (`createDrizzleCanaryPreflightStore`) so the "enumerate an Organization's Companies"
//     query cannot drift from the one the canary gate already ships. A parallel
//     re-implementation is precisely how CLI-002's memory bundle silently dropped a
//     security predicate; reuse makes divergence impossible rather than merely unlikely.
//     Plain read on `appDb` — `companies` carries no row-level security and `aoa_app`
//     holds SELECT (migrations 0213/0214) — matching the production composition
//     (`index.ts` builds the canary store with `appDb`).
//
//   * listActiveAttempts — the missing per-org non-terminal-attempt iterator (the
//     interface member the pure module declared with no SQL impl). A TENANT-SCOPED read
//     under `runInTenant` (RLS as the non-owner `aoa_app` role — the same context the
//     bridges' `assertRollbackSafe` runs in), `selectDistinct` on (company_id, job_id) so
//     a job carrying two simultaneously non-terminal attempts is cancelled ONCE rather
//     than double-counted (`requestCancellation` is keyed by job and idempotent), and
//     `notInArray(TERMINAL_ATTEMPT_STATUSES)` — the complement of the terminal set — so a
//     status later added to the `job_attempts` check constraint is treated as non-terminal
//     by default, fail-safe toward DRAINING an unknown live state rather than stranding it.
//     NO `FOR UPDATE`: `requestCancellation` takes its own per-job lock, so holding a lock
//     across the whole cancel loop would be a fleet-wide long-lived lock. This is a read,
//     not a schema change — no migration, and no `packages/worker-protocol` change (FROZEN).

import { and, eq, notInArray } from "drizzle-orm";
import { jobAttempts, TERMINAL_ATTEMPT_STATUSES, type Db } from "@armyofagents/db";
import { runInTenant } from "../db/tenant-context.js";
import { createDrizzleCanaryPreflightStore } from "./canary-preflight-store.js";
import type { DistributedExecutionActiveAttempt } from "./job-distributed-drain.js";

/** The two read-only deps the flag-disable drain needs from the database. Structurally a
 * subset of `DistributedExecutionDrainDeps` — the remaining deps
 * (`listAdmittedOrganizationIds`, `requestCancellation`, `assertRollbackSafe`) are the
 * shared org enumerator + the fence-revoking cancel + the bridge gate, wired at the
 * composition site (a `drainAll` trigger owed to REL-005). */
export interface DistributedExecutionDrainStore {
  listOrganizationCompanyIds(organizationId: string): Promise<readonly string[]>;
  listActiveAttempts(organizationId: string): Promise<DistributedExecutionActiveAttempt[]>;
}

export function createDistributedExecutionDrainStore(appDb: Db): DistributedExecutionDrainStore {
  // Reuse the canary gate's Company enumeration BY REFERENCE — never a re-implementation.
  const { listOrganizationCompanyIds } = createDrizzleCanaryPreflightStore(appDb);

  return {
    listOrganizationCompanyIds,

    async listActiveAttempts(organizationId) {
      return runInTenant(appDb, organizationId, async (_repos, tx) => {
        const rows = await tx
          .selectDistinct({
            organizationId: jobAttempts.organizationId,
            companyId: jobAttempts.companyId,
            jobId: jobAttempts.jobId,
          })
          .from(jobAttempts)
          .where(
            and(
              eq(jobAttempts.organizationId, organizationId),
              notInArray(jobAttempts.status, [...TERMINAL_ATTEMPT_STATUSES]),
            ),
          );
        return rows.map((row) => ({
          organizationId: row.organizationId,
          companyId: row.companyId,
          jobId: row.jobId,
        }));
      });
    },
  };
}
