import { Router, type Request, type Response } from "express";
import type { Db } from "@armyofagents/db";
import { companyMemberships } from "@armyofagents/db";
import { and, eq } from "drizzle-orm";
import {
  ONBOARDING_JOURNEYS,
  ONBOARDING_STATES,
  type OnboardingJourney,
  type OnboardingState,
} from "@armyofagents/shared";
import { getProgress, advanceState } from "../services/onboarding.js";

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
 * Progress routes (Stage B / B4 + revB RB4/R3). userId is ALWAYS the actor
 * (never the body) — a user can only read/write their own progress. For a
 * company-scoped row, the user must be an active member of that company.
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
    if (companyId && !(await userHasCompanyAccess(db, actor.userId, companyId))) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
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
    if (companyId && !(await userHasCompanyAccess(db, actor.userId, companyId))) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
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
