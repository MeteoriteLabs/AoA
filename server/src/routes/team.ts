import { Router, type NextFunction, type Request, type Response } from "express";
import type { Db } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { validate } from "../middleware/validate.js";
import { logActivity, teamService } from "../services/index.js";
import { assertCompanyAccess } from "./authz.js";
import { updateTeamMemberRoleSchema } from "@paperclipai/shared";

export function teamRoutes(db: Db) {
  const router = Router();
  const team = teamService(db);

  router.get("/companies/:companyId/team", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const summary = await team.listTeam(companyId, req.actor.type === "board" ? req.actor.userId ?? null : null);
    res.json(summary);
  });

  router.patch(
    "/companies/:companyId/team/users/:userId/role",
    validate(updateTeamMemberRoleSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const userId = req.params.userId as string;
      assertCompanyAccess(req, companyId);
      if (req.actor.type !== "board" || !req.actor.userId) {
        res.status(403).json({ error: "Board authentication required" });
        return;
      }
      await team.assertFounder(companyId, req.actor.userId);
      const updated = await team.updateUserRole(
        companyId,
        userId,
        {
          role: req.body.role,
          projectId: req.body.role === "founder" ? null : (req.body.projectId ?? null),
          parentType: req.body.parentType,
          parentId: req.body.parentId,
        },
        req.actor.userId,
      );

      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId: req.actor.userId,
        action: "team.role_updated",
        entityType: "user_role",
        entityId: userId,
        details: {
          role: updated.role,
          projectId: updated.projectId,
        },
      });

      res.json(updated);
    },
  );

  router.delete("/companies/:companyId/team/users/:userId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const userId = req.params.userId as string;
    assertCompanyAccess(req, companyId);
    if (req.actor.type !== "board" || !req.actor.userId) {
      res.status(403).json({ error: "Board authentication required" });
      return;
    }
    await team.removeMember(companyId, userId, req.actor.userId);

    await logActivity(db, {
      companyId,
      actorType: "user",
      actorId: req.actor.userId,
      action: "team.member_removed",
      entityType: "user_role",
      entityId: userId,
      details: {},
    });

    res.json({ ok: true });
  });

  router.use((err: unknown, _req: Request, _res: Response, next: NextFunction) => {
    logger.warn({ err }, "team route failed");
    next(err);
  });

  return router;
}
