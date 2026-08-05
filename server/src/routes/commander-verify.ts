import { Router, type Request, type Response } from "express";
import type { Db } from "@armyofagents/db";
import {
  classifyCommanderProbe,
  commanderProbeUsesApiKey,
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
import { redactChecks } from "../services/providers/readiness.js";
import { verifyAndBindCommanderSubscriptionCredential } from "../services/provider-credentials.js";
import { assertUnsandboxedMultitenantAllowed } from "../services/unsandboxed-multitenant-guard.js";
import { tenantIsolationEnforced } from "../config/deployment-mode.js";

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
    await assertCompanyAccess(db, req, companyId);
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
      // D1 (cloud isolation): Commander Verify drives the SAME adapter probe,
      // which spawns a REAL `claude --print` / `codex exec` generation. This sink
      // has NO execution target — it always runs on the local, unsandboxed
      // control-plane host — so on `cloud_auth` it would run under the OPERATOR's
      // login on the shared host (reachable by every founder during onboarding
      // Verify). Refuse before spawning; return the route's own blocking result
      // (422 + status:"fail") so onboarding stays on Verify. No-op self-hosted.
      try {
        assertUnsandboxedMultitenantAllowed(null, {
          tenantIsolationEnforced: tenantIsolationEnforced(),
          sink: "adapter readiness probe",
        });
      } catch {
        res.status(422).json({
          outcome: "failed" as const,
          result: {
            adapterType,
            status: "fail" as const,
            checks: [
              {
                code: "readiness_unavailable_on_cloud",
                level: "error" as const,
                message:
                  "Commander readiness testing is unavailable on AoA Cloud (a local probe would run on the shared host).",
              },
            ],
            testedAt: new Date().toISOString(),
          },
        });
        return;
      }
      const result = await adapter.testEnvironment({ companyId, adapterType, config: probeConfig });
      // Probe output is CLI-controlled and may echo keys or tokens. The generic
      // agent-test and Providers paths already redact this boundary; Commander
      // Verify must do the same before returning details to onboarding.
      const safeResult = { ...result, checks: redactChecks(result.checks) };
      const classified = classifyCommanderProbe(safeResult);
      if (
        classified.outcome === "verified" &&
        !commanderProbeUsesApiKey(probeConfig, adapterType) &&
        (adapterType === "codex_local" || adapterType === "claude_local")
      ) {
        const provider = adapterType === "codex_local" ? "openai" : "anthropic";
        const executionTargetId = process.env.AOA_EXECUTION_TARGET_ID?.trim() || "control-plane";
        await verifyAndBindCommanderSubscriptionCredential(db, {
          companyId,
          userId: actor.userId,
          actorUserId: actor.userId,
          provider,
          executionTargetId,
        });
      }
      res.status(classified.outcome === "verified" ? 200 : 422).json(classified);
    } finally {
      releaseProbeSlot();
    }
  });

  return router;
}
