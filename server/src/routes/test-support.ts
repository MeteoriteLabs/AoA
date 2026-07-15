import { Router, type Request, type Response } from "express";
import type { Db } from "@armyofagents/db";
import { onboardingProgress } from "@armyofagents/db";
import { eq } from "drizzle-orm";

/**
 * Test-only routes for e2e isolation. MOUNTED ONLY in local_trusted + the e2e
 * escape hatch (see app.ts) — never in authenticated mode. Each route is
 * self-scoped to req.actor (a spec can only reset its own state).
 */
export function testSupportRoutes(db: Db): Router {
  const router = Router();

  // Clear the acting user's onboarding_progress (user + org layers) so the next
  // spec starts clean.
  router.delete("/test/onboarding-progress", async (req: Request, res: Response) => {
    const actor = req.actor;
    if (actor.type !== "board" || !actor.userId) {
      res.status(401).json({ error: "authentication required" });
      return;
    }
    await db.delete(onboardingProgress).where(eq(onboardingProgress.userId, actor.userId));
    res.json({ ok: true });
  });

  return router;
}
