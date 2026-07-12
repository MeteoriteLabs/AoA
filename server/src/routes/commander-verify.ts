import { Router, type Request, type Response } from "express";
import type { Db } from "@armyofagents/db";
import { companyMemberships } from "@armyofagents/db";
import { and, eq } from "drizzle-orm";
import { classifyCommanderProbe, resolveCommanderAdapterType } from "../services/commander-verify.js";
import { findServerAdapter } from "../adapters/registry.js";

async function userHasCompanyAccess(db: Db, userId: string, companyId: string): Promise<boolean> {
  const rows = await db
    .select({ id: companyMemberships.companyId })
    .from(companyMemberships)
    .where(
      and(
        eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, userId),
        eq(companyMemberships.companyId, companyId),
        eq(companyMemberships.status, "active"),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Commander verify (Stage C / C7-C8, revA R14). Drives the SAME adapter
 * `testEnvironment` probe the agent test-connection route uses, resolving the
 * Commander's adapter type from internal_agent_config.cliTool. BLOCKING: only a
 * `verified` outcome returns 200; needs_auth / not_installed / failed → 422 so
 * the founder stays on the Verify step and can install / sign in / retry.
 */
export function commanderVerifyRoutes(db: Db): Router {
  const router = Router();

  router.post("/companies/:companyId/internal-agent/verify", async (req: Request, res: Response) => {
    const actor = req.actor;
    if (actor.type !== "board" || !actor.userId) {
      res.status(401).json({ error: "authentication required" });
      return;
    }
    const companyId = req.params.companyId as string;
    if (!(await userHasCompanyAccess(db, actor.userId, companyId))) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const adapterType = await resolveCommanderAdapterType(db, companyId);
    const adapter = findServerAdapter(adapterType);
    if (!adapter?.testEnvironment) {
      res.status(404).json({ error: `No probe available for ${adapterType}` });
      return;
    }
    // Empty config → CLI defaults (subscription-login path), which is what
    // Commander verify should test.
    const result = await adapter.testEnvironment({ companyId, adapterType, config: {} });
    const classified = classifyCommanderProbe(result);
    res.status(classified.outcome === "verified" ? 200 : 422).json(classified);
  });

  return router;
}
