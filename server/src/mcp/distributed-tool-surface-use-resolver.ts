// server/src/mcp/distributed-tool-surface-use-resolver.ts
//
// CLI-016 (M1b, founder ruling F10) — the DB reader for the per-Organization tool-surface gate
// at `/mcp` authorization. It resolves the SIGNED run id to its run row and its company's
// Organization, then hands the pure `classifyToolSurfaceAtUse` the facts plus the tenant's
// armed state (`resolveDistributedToolSurface`: deployment kill switch AND `tools: true`).
//
// Kept apart from the classifier so the classifier's Tier-1 test never drags drizzle-orm into
// the vitest ESM cycle (the isolation `distributed-run-currency-resolver.ts` uses).
//
// READ PER CALL, on purpose. The flag and the rollout map are read on every call (the rollout
// source memoizes on the raw string), so an Organization's `tools` removed from the rollout map
// denies that tenant's already-dispatched runs on their NEXT call, with no restart.
//
// FAIL-CLOSED: a DB error, or a tool-surface flag value the parser refuses, propagates. The
// `/mcp` mount runs this inside the route's try/catch (server.ts), so a throw becomes a 500 that
// DENIES access. A malformed rollout map fails closed to "no Organization armed".

import type { Db } from "@armyofagents/db";
import { companies, heartbeatRuns } from "@armyofagents/db";
import { eq } from "drizzle-orm";

import {
  readDistributedToolSurfaceFlag,
  resolveDistributedToolSurface,
} from "../config/distributed-execution.js";
import {
  createDistributedExecutionRolloutSource,
  type DistributedExecutionRolloutSource,
} from "../config/distributed-execution-rollout-source.js";
import type { RunCurrencyVerdict } from "./distributed-run-currency.js";
import { classifyToolSurfaceAtUse } from "./distributed-tool-surface-use.js";

type Env = Record<string, string | undefined>;

export interface DistributedToolSurfaceUseResolver {
  /** `signedRunId` is the SIGNED `run_id` claim, never the header-overridable `req.actor.runId`. */
  resolve(input: { signedRunId: string; companyId: string }): Promise<RunCurrencyVerdict>;
}

export function createDistributedToolSurfaceUseResolver(
  db: Db,
  options: { env?: Env; rolloutSource?: DistributedExecutionRolloutSource } = {},
): DistributedToolSurfaceUseResolver {
  const env = options.env ?? process.env;
  const rolloutSource = options.rolloutSource ?? createDistributedExecutionRolloutSource(env);
  return {
    async resolve({ signedRunId, companyId }): Promise<RunCurrencyVerdict> {
      const [row] = await db
        .select({
          runCompanyId: heartbeatRuns.companyId,
          executionOwner: heartbeatRuns.executionOwner,
          organizationId: companies.organizationId,
        })
        .from(heartbeatRuns)
        // The company -> Organization edge of the RUN's company (not the URL's): the tenant
        // whose policy decides is the one the run belongs to.
        .leftJoin(companies, eq(companies.id, heartbeatRuns.companyId))
        .where(eq(heartbeatRuns.id, signedRunId))
        .limit(1);

      if (!row) {
        return classifyToolSurfaceAtUse(
          { runFound: false, runCompanyId: null, executionOwner: null, organizationArmed: false },
          companyId,
        );
      }

      // Only a distributed run consults the flag and the policy; a local run never can be
      // denied by a tool-surface value it does not use.
      const organizationArmed =
        row.executionOwner === "distributed" &&
        resolveDistributedToolSurface({
          deploymentArmed: readDistributedToolSurfaceFlag(env),
          organizationToolsEnabled: row.organizationId
            ? rolloutSource.resolveOrganizationToolSurface({ organizationId: row.organizationId })
            : false,
        }).authorized;

      return classifyToolSurfaceAtUse(
        {
          runFound: true,
          runCompanyId: row.runCompanyId,
          executionOwner: row.executionOwner,
          organizationArmed,
        },
        companyId,
      );
    },
  };
}
