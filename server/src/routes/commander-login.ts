import { Router, type Request, type Response } from "express";
import type { Db } from "@armyofagents/db";
import { assertRole } from "../middleware/rbac.js";
import { assertCompanyAccess } from "./authz.js";
import { buildCommanderLoginService } from "../services/commander-login-runtime.js";
import { LoginChallengeConflictError, type CommanderLoginProvider } from "../services/commander-login.js";

/**
 * Interactive CLI-login routes (Plan 3 / §6.2 Task 4). Founder-scoped: an
 * EXPLICIT board-actor check precedes assertRole (agents bypass assertRole —
 * Codex #10), then `assertRole("founder")`. `start` spawns `claude login` /
 * `codex login` and returns the verification URL for the founder to open; the
 * UI polls `status` and, on `completed`, re-runs the Commander probe.
 */
export function commanderLoginRoutes(db: Db): Router {
  const router = Router();
  const service = buildCommanderLoginService(db);

  async function gate(req: Request, res: Response, companyId: string): Promise<boolean> {
    const actor = req.actor;
    if (actor.type !== "board" || !actor.userId) {
      res.status(401).json({ error: "authentication required" });
      return false;
    }
    assertCompanyAccess(req, companyId);
    await assertRole(db, req, companyId, "founder");
    return true;
  }

  router.post(
    "/companies/:companyId/internal-agent/commander-login/start",
    async (req: Request, res: Response) => {
      const companyId = req.params.companyId as string;
      if (!(await gate(req, res, companyId))) return;

      const provider = req.body?.provider as CommanderLoginProvider;
      if (provider !== "anthropic" && provider !== "openai") {
        res.status(400).json({ error: "provider must be 'anthropic' or 'openai'" });
        return;
      }

      try {
        const { challengeId, loginUrl } = await service.startChallenge({
          companyId,
          provider,
          startedByUserId: req.actor.userId ?? null,
        });
        res.json({ challengeId, loginUrl });
      } catch (err) {
        if (err instanceof LoginChallengeConflictError) {
          res.status(409).json({ error: err.message });
          return;
        }
        res.status(502).json({ error: "login could not start (no verification URL)" });
      }
    },
  );

  router.post(
    "/companies/:companyId/internal-agent/commander-login/:id/code",
    async (req: Request, res: Response) => {
      const companyId = req.params.companyId as string;
      if (!(await gate(req, res, companyId))) return;

      const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
      if (!code) {
        res.status(400).json({ error: "code is required" });
        return;
      }

      // NB: never log `code` — it exchanges for a live credential.
      const result = service.submitCode(companyId, req.params.id as string, code);
      if (result === "not-live") {
        res.status(404).json({
          error: "This sign-in session is no longer active. Start sign-in again.",
        });
        return;
      }
      if (result === "write-failed") {
        res.status(410).json({
          error: "The sign-in process has exited. Start sign-in again.",
        });
        return;
      }
      if (result === "unsupported") {
        res.status(409).json({
          error: "This provider completes sign-in in the browser and does not take a pasted code.",
        });
        return;
      }
      res.status(202).json({ ok: true });
    },
  );

  router.get(
    "/companies/:companyId/internal-agent/commander-login/:id",
    async (req: Request, res: Response) => {
      const companyId = req.params.companyId as string;
      if (!(await gate(req, res, companyId))) return;
      // Company-scoped lookup (Codex P1) — another tenant's challenge id 404s
      // instead of leaking its status/loginUrl.
      const status = await service.getStatus(companyId, req.params.id as string);
      if (!status) {
        res.status(404).json({ error: "challenge not found" });
        return;
      }
      res.json(status);
    },
  );

  router.post(
    "/companies/:companyId/internal-agent/commander-login/:id/cancel",
    async (req: Request, res: Response) => {
      const companyId = req.params.companyId as string;
      if (!(await gate(req, res, companyId))) return;
      // Company-scoped (Codex P1) — a cross-tenant cancel is a silent no-op,
      // never terminating another company's login child.
      await service.cancel(companyId, req.params.id as string);
      res.json({ ok: true });
    },
  );

  return router;
}
