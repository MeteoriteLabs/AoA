import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { updateBriefItemSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { briefService, logActivity } from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

export function briefRoutes(db: Db) {
  const router = Router();
  const svc = briefService(db);

  // GET /companies/:companyId/briefs — list briefs
  router.get("/companies/:companyId/briefs", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const { status, departmentId } = req.query as Record<string, string | undefined>;
    const result = await svc.list(companyId, { status, departmentId });
    res.json(result);
  });

  // GET /companies/:companyId/briefs/:id — get brief with items
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

  // PATCH /companies/:companyId/briefs/:briefId/items/:itemId — update item
  router.patch(
    "/companies/:companyId/briefs/:briefId/items/:itemId",
    validate(updateBriefItemSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const briefId = req.params.briefId as string;
      const itemId = req.params.itemId as string;
      assertCompanyAccess(req, companyId);

      const { status, title, description, ...rest } = req.body;
      const edits = title || description !== undefined ? { title, description } : undefined;

      // If the full updateBriefItemSchema body is used, apply all fields
      const item = await svc.updateItemStatus(
        companyId,
        briefId,
        itemId,
        status ?? req.body.status,
        edits,
      );

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
        details: { briefId, status, title, description },
      });

      res.json(item);
    },
  );

  // POST /companies/:companyId/briefs/:id/approve — approve brief
  router.post("/companies/:companyId/briefs/:id/approve", async (req, res) => {
    const companyId = req.params.companyId as string;
    const briefId = req.params.id as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);

    const result = await svc.approveBrief(companyId, briefId, actor.actorId);
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
