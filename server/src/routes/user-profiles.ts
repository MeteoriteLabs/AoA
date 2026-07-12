import { Router, type Request, type Response } from "express";
import type { Db } from "@armyofagents/db";
import { getUserProfile, upsertUserProfile } from "../services/user-profiles.js";

/** Own global profile (Stage C / C1-C3). Board-scoped, self-only. */
export function userProfileRoutes(db: Db): Router {
  const router = Router();

  router.get("/user-profile", async (req: Request, res: Response) => {
    const actor = req.actor;
    if (actor.type !== "board" || !actor.userId) {
      res.status(401).json({ error: "authentication required" });
      return;
    }
    res.json({ profile: await getUserProfile(db, actor.userId) });
  });

  router.patch("/user-profile", async (req: Request, res: Response) => {
    const actor = req.actor;
    if (actor.type !== "board" || !actor.userId) {
      res.status(401).json({ error: "authentication required" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const profile = await upsertUserProfile(db, actor.userId, {
      displayName: typeof body.displayName === "string" ? body.displayName : null,
      avatarUrl: typeof body.avatarUrl === "string" ? body.avatarUrl : null,
      title: typeof body.title === "string" ? body.title : null,
      bio: typeof body.bio === "string" ? body.bio : null,
      socialLinks: Array.isArray(body.socialLinks) ? (body.socialLinks as never[]) : undefined,
    });
    res.json({ profile });
  });

  return router;
}
