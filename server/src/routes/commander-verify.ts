import { Router, type Request, type Response } from "express";
import type { Db } from "@armyofagents/db";
import {
  classifyCommanderProbe,
  resolveCommanderAdapterType,
  resolveCommanderProbeConfig,
} from "../services/commander-verify.js";
import { findServerAdapter } from "../adapters/registry.js";
import {
  ADAPTER_PROBE_BUSY_ERROR,
  ADAPTER_PROBE_RETRY_AFTER_SECONDS,
  tryAcquireAdapterProbeSlot,
} from "../services/adapter-probe-concurrency.js";
import { assertRole } from "../middleware/rbac.js";
import { assertCompanyAccess } from "./authz.js";

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
    assertCompanyAccess(req, companyId);
    await assertRole(db, req, companyId, "founder");
    const adapterType = await resolveCommanderAdapterType(db, companyId);
    const adapter = findServerAdapter(adapterType);
    if (!adapter?.testEnvironment) {
      res.status(404).json({ error: `No probe available for ${adapterType}` });
      return;
    }
    // §6.1 (Codex P1 #8): probe the RESOLVED Commander config (its adapter env
    // secret_refs resolved) so a saved API key unblocks re-probe; falls back to
    // {} = CLI defaults / subscription-login path when no key/agent is set.
    const probeConfig = await resolveCommanderProbeConfig(db, companyId, adapterType, actor.userId);
    const releaseProbeSlot = tryAcquireAdapterProbeSlot(companyId);
    if (!releaseProbeSlot) {
      res
        .status(429)
        .set("Retry-After", String(ADAPTER_PROBE_RETRY_AFTER_SECONDS))
        .json({ error: ADAPTER_PROBE_BUSY_ERROR });
      return;
    }

    try {
      const result = await adapter.testEnvironment({ companyId, adapterType, config: probeConfig });
      const classified = classifyCommanderProbe(result);
      res.status(classified.outcome === "verified" ? 200 : 422).json(classified);
    } finally {
      releaseProbeSlot();
    }
  });

  return router;
}
