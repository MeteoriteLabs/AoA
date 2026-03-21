import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { updateBriefSchema, updateBriefItemSchema, approveBriefSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { briefService, logActivity } from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

export function briefRoutes(db: Db) {
  const router = Router();
  const svc = briefService(db);

  router.get("/companies/:companyId/briefs", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const { status, departmentId } = req.query as Record<string, string | undefined>;
    const result = await svc.list(companyId, { status, departmentId });
    res.json(result);
  });

  router.get("/companies/:companyId/briefs/:id", async (req, res) => {
    const companyId = req.params.companyId as string;
    const id = req.params.id as string;
    assertCompanyAccess(req, companyId);
    const brief = await svc.getById(companyId, id);
    if (!brief) {
      res.status(404).json({ error: "Brief not found" });
      return;
    }
    res.json(brief);
  });

  router.patch(
    "/companies/:companyId/briefs/:id",
    validate(updateBriefSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);

      const brief = await svc.updateBrief(companyId, id, req.body);
      if (!brief) {
        res.status(404).json({ error: "Brief not found" });
        return;
      }

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "brief.updated",
        entityType: "brief",
        entityId: id,
        details: req.body,
      });

      res.json(brief);
    },
  );

  router.patch(
    "/companies/:companyId/briefs/:briefId/items/:itemId",
    validate(updateBriefItemSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const briefId = req.params.briefId as string;
      const itemId = req.params.itemId as string;
      assertCompanyAccess(req, companyId);

      const originalItem = await svc.getItemById(briefId, itemId);
      const item = await svc.updateItemStatus(companyId, briefId, itemId, req.body);

      if (!item) {
        res.status(404).json({ error: "Brief or item not found" });
        return;
      }

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "brief_item.updated",
        entityType: "brief_item",
        entityId: itemId,
        details: {
          briefId,
          ...req.body,
          originalTitle: originalItem?.title,
          originalDescription: originalItem?.description,
        },
      });

      res.json(item);
    },
  );

  router.post("/companies/:companyId/briefs/:id/approve", validate(approveBriefSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    const briefId = req.params.id as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);

    const { dependencies } = req.body;
    const result = await svc.approveBrief(companyId, briefId, actor.actorId, dependencies);
    if (!result) {
      res.status(404).json({ error: "Brief not found" });
      return;
    }

    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "brief.approved",
      entityType: "brief",
      entityId: briefId,
      details: {
        status: result.brief.status,
        taskCount: result.createdTaskIds.length,
        memoryCount: result.createdMemoryIds.length,
      },
    });

    res.json(result);
  });

  return router;
}
