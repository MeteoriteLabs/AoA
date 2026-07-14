import { Router, type Request, type Response } from "express";
import type { Db } from "@armyofagents/db";
import {
  ONBOARDING_JOURNEYS,
  ONBOARDING_STATES,
  type OnboardingJourney,
  type OnboardingState,
} from "@armyofagents/shared";
import { getProgress, advanceState } from "../services/onboarding.js";
import { assertCompanyAccess } from "./authz.js";

/**
 * Progress routes (Stage B / B4 + revB RB4/R3). userId is ALWAYS the actor
 * (never the body) — a user can only read/write their own progress. For a
 * company-scoped row, the board actor must have standard company access
 * (active membership, instance-admin access, or local-implicit access).
 */
export function onboardingRoutes(db: Db): Router {
  const router = Router();

  router.get("/onboarding/progress", async (req: Request, res: Response) => {
    const actor = req.actor;
    if (actor.type !== "board" || !actor.userId) {
      res.status(401).json({ error: "authentication required" });
      return;
    }
    const raw = req.query.companyId;
    const companyId = typeof raw === "string" && raw.length > 0 ? raw : null;
    if (companyId) assertCompanyAccess(req, companyId);
    const progress = await getProgress(db, actor.userId, companyId);
    res.json({ progress });
  });

  router.patch("/onboarding/progress", async (req: Request, res: Response) => {
    const actor = req.actor;
    if (actor.type !== "board" || !actor.userId) {
      res.status(401).json({ error: "authentication required" });
      return;
    }
    const body = (req.body ?? {}) as { companyId?: string | null; journey?: string; requestedState?: string };
    const journey = body.journey as OnboardingJourney;
    const requestedState = body.requestedState as OnboardingState;
    if (!ONBOARDING_JOURNEYS.includes(journey)) {
      res.status(400).json({ error: "invalid journey" });
      return;
    }
    if (!ONBOARDING_STATES.includes(requestedState)) {
      res.status(400).json({ error: "invalid state" });
      return;
    }
    const companyId = typeof body.companyId === "string" && body.companyId.length > 0 ? body.companyId : null;
    if (companyId) assertCompanyAccess(req, companyId);
    const result = await advanceState(db, { userId: actor.userId, companyId, journey, requestedState });
    if (result.status === "illegal") {
      res.status(409).json({ error: "illegal transition", reason: result.reason });
      return;
    }
    if (result.status === "conflict") {
      res.status(409).json({ error: "version conflict, retry" });
      return;
    }
    res.json({ progress: result.row });
  });

  return router;
}
