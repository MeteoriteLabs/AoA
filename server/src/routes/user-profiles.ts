import { Router, type Request, type Response } from "express";
import type { Db } from "@armyofagents/db";
import {
  getUserProfile,
  upsertUserProfile,
  type UserProfileInput,
} from "../services/user-profiles.js";

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
    const input: UserProfileInput = {};
    if (typeof body.displayName === "string" || body.displayName === null) {
      input.displayName = body.displayName;
    }
    if (typeof body.avatarUrl === "string" || body.avatarUrl === null) {
      input.avatarUrl = body.avatarUrl;
    }
    if (typeof body.title === "string" || body.title === null) input.title = body.title;
    if (typeof body.bio === "string" || body.bio === null) input.bio = body.bio;
    if (Array.isArray(body.socialLinks)) input.socialLinks = body.socialLinks as never[];

    const profile = await upsertUserProfile(db, actor.userId, input);
    res.json({ profile });
  });

  return router;
}
