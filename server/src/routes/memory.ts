import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  createMemoryItemSchema,
  updateMemoryItemSchema,
  saveDraftSchema,
  createVersionSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { memoryService, logActivity } from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

export function memoryRoutes(db: Db) {
  const router = Router();
  const svc = memoryService(db);

  router.get("/companies/:companyId/memory", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const filters = {
      category: req.query.category as string | undefined,
      status: req.query.status as string | undefined,
      source: req.query.source as string | undefined,
      departmentId: req.query.departmentId as string | undefined,
      projectId: req.query.projectId as string | undefined,
      tags: req.query.tags ? (req.query.tags as string).split(",") : undefined,
      search: req.query.search as string | undefined,
      layer: req.query.layer as string | undefined,
    };
    const result = await svc.list(companyId, filters);
    res.json(result);
  });

  router.get("/companies/:companyId/memory/:id", async (req, res) => {
    const companyId = req.params.companyId as string;
    const id = req.params.id as string;
    assertCompanyAccess(req, companyId);
    const item = await svc.getById(companyId, id);
    if (!item) {
      res.status(404).json({ error: "Memory item not found" });
      return;
    }
    res.json(item);
  });

  router.post("/companies/:companyId/memory", validate(createMemoryItemSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const isFounder = actor.actorType === "user";
    const item = await svc.create(companyId, req.body, actor.actorId, isFounder);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "memory.created",
      entityType: "memory_item",
      entityId: item.id,
      details: { title: item.title, category: item.category, source: item.source, status: item.status },
    });
    res.status(201).json(item);
  });

  router.patch("/companies/:companyId/memory/:id", validate(updateMemoryItemSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    const id = req.params.id as string;
    assertCompanyAccess(req, companyId);
    const existing = await svc.getById(companyId, id);
    if (!existing) {
      res.status(404).json({ error: "Memory item not found" });
      return;
    }
    const actor = getActorInfo(req);
    const isFounder = actor.actorType === "user";
    const item = await svc.update(companyId, id, req.body, actor.actorId, isFounder);
    if (!item) {
      res.status(404).json({ error: "Memory item not found" });
      return;
    }
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "memory.updated",
      entityType: "memory_item",
      entityId: item.id,
      details: req.body,
    });
    res.json(item);
  });

  router.delete("/companies/:companyId/memory/:id", async (req, res) => {
    const companyId = req.params.companyId as string;
    const id = req.params.id as string;
    assertCompanyAccess(req, companyId);
    const existing = await svc.getById(companyId, id);
    if (!existing) {
      res.status(404).json({ error: "Memory item not found" });
      return;
    }
    const item = await svc.remove(companyId, id);
    if (!item) {
      res.status(404).json({ error: "Memory item not found" });
      return;
    }
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "memory.deleted",
      entityType: "memory_item",
      entityId: item.id,
      details: { title: item.title },
    });
    res.json(item);
  });

  router.post("/companies/:companyId/memory/:id/approve", async (req, res) => {
    const companyId = req.params.companyId as string;
    const id = req.params.id as string;
    assertCompanyAccess(req, companyId);
    const existing = await svc.getById(companyId, id);
    if (!existing) {
      res.status(404).json({ error: "Memory item not found" });
      return;
    }
    const item = await svc.approve(companyId, id);
    if (!item) {
      res.status(404).json({ error: "Memory item not found" });
      return;
    }
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "memory.approved",
      entityType: "memory_item",
      entityId: item.id,
      details: { title: item.title },
    });
    res.json(item);
  });

  router.post("/companies/:companyId/memory/:id/reject", async (req, res) => {
    const companyId = req.params.companyId as string;
    const id = req.params.id as string;
    assertCompanyAccess(req, companyId);
    const existing = await svc.getById(companyId, id);
    if (!existing) {
      res.status(404).json({ error: "Memory item not found" });
      return;
    }
    const item = await svc.reject(companyId, id);
    if (!item) {
      res.status(404).json({ error: "Memory item not found" });
      return;
    }
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "memory.rejected",
      entityType: "memory_item",
      entityId: item.id,
      details: { title: item.title },
    });
    res.json(item);
  });

  router.get("/companies/:companyId/memory/:id/versions", async (req, res) => {
    const companyId = req.params.companyId as string;
    const itemId = req.params.id as string;
    assertCompanyAccess(req, companyId);
    const versions = await svc.getVersionHistory(companyId, itemId);
    if (versions === null) {
      res.status(404).json({ error: "Memory item not found" });
      return;
    }
    res.json(versions);
  });

  router.post(
    "/companies/:companyId/memory/:id/versions",
    validate(createVersionSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const itemId = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const existing = await svc.getById(companyId, itemId);
      if (!existing) {
        res.status(404).json({ error: "Memory item not found" });
        return;
      }
      const actor = getActorInfo(req);
      const isFounder = actor.actorType === "user";

      if (isFounder) {
        const item = await svc.update(companyId, itemId, { content: req.body.content }, actor.actorId, true);
        await logActivity(db, {
          companyId, actorType: actor.actorType, actorId: actor.actorId,
          agentId: actor.agentId, runId: actor.runId,
          action: "memory.updated", entityType: "memory_item", entityId: itemId,
          details: { content: req.body.content },
        });
        res.status(201).json(item);
      } else {
        const version = await svc.suggestUpdate(companyId, itemId, req.body.content, req.body.sourceContext, actor.actorId);
        if (!version) {
          res.status(404).json({ error: "Memory item not found" });
          return;
        }
        await logActivity(db, {
          companyId, actorType: actor.actorType, actorId: actor.actorId,
          agentId: actor.agentId, runId: actor.runId,
          action: "memory.version_suggested", entityType: "memory_item", entityId: itemId,
          details: { versionId: version.id, versionNumber: version.versionNumber },
        });
        res.status(201).json(version);
      }
    },
  );

  router.post(
    "/companies/:companyId/memory/:id/draft",
    validate(saveDraftSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const itemId = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const version = await svc.saveDraft(companyId, itemId, req.body.content, actor.actorId);
      if (!version) {
        res.status(404).json({ error: "Memory item not found" });
        return;
      }
      await logActivity(db, {
        companyId, actorType: actor.actorType, actorId: actor.actorId,
        agentId: actor.agentId, runId: actor.runId,
        action: "memory.draft_saved", entityType: "memory_item", entityId: itemId,
        details: { versionId: version.id, versionNumber: version.versionNumber },
      });
      res.json(version);
    },
  );

  router.post("/companies/:companyId/memory/:id/draft/discard", async (req, res) => {
    const companyId = req.params.companyId as string;
    const itemId = req.params.id as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const version = await svc.discardDraft(companyId, itemId, actor.actorId);
    if (!version) {
      res.status(404).json({ error: "No draft found" });
      return;
    }
    await logActivity(db, {
      companyId, actorType: actor.actorType, actorId: actor.actorId,
      agentId: actor.agentId, runId: actor.runId,
      action: "memory.draft_discarded", entityType: "memory_item", entityId: itemId,
      details: { versionId: version.id },
    });
    res.json(version);
  });

  router.post("/companies/:companyId/memory/:id/publish", async (req, res) => {
    const companyId = req.params.companyId as string;
    const itemId = req.params.id as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const item = await svc.publishDraft(companyId, itemId, actor.actorId);
    if (!item) {
      res.status(404).json({ error: "No draft found to publish" });
      return;
    }
    await logActivity(db, {
      companyId, actorType: actor.actorType, actorId: actor.actorId,
      agentId: actor.agentId, runId: actor.runId,
      action: "memory.draft_published", entityType: "memory_item", entityId: itemId,
      details: { title: item.title },
    });
    res.json(item);
  });

  router.post("/companies/:companyId/memory/:id/restore", async (req, res) => {
    const companyId = req.params.companyId as string;
    const id = req.params.id as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const item = await svc.restore(companyId, id, actor.actorId);
    if (!item) {
      res.status(404).json({ error: "Item not found or not archived" });
      return;
    }
    await logActivity(db, {
      companyId, actorType: actor.actorType, actorId: actor.actorId,
      agentId: actor.agentId, runId: actor.runId,
      action: "memory.restored", entityType: "memory_item", entityId: id,
      details: { title: item.title },
    });
    res.json(item);
  });

  router.post("/companies/:companyId/memory/:id/versions/:versionId/approve", async (req, res) => {
    const companyId = req.params.companyId as string;
    const itemId = req.params.id as string;
    const versionId = req.params.versionId as string;
    assertCompanyAccess(req, companyId);
    const item = await svc.approveVersion(companyId, itemId, versionId);
    if (!item) {
      res.status(404).json({ error: "Version not found or not pending" });
      return;
    }
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId, actorType: actor.actorType, actorId: actor.actorId,
      agentId: actor.agentId, runId: actor.runId,
      action: "memory.version_approved", entityType: "memory_item", entityId: itemId,
      details: { versionId },
    });
    res.json(item);
  });

  router.post("/companies/:companyId/memory/:id/versions/:versionId/reject", async (req, res) => {
    const companyId = req.params.companyId as string;
    const itemId = req.params.id as string;
    const versionId = req.params.versionId as string;
    assertCompanyAccess(req, companyId);
    const version = await svc.rejectVersion(companyId, itemId, versionId);
    if (!version) {
      res.status(404).json({ error: "Version not found or not pending" });
      return;
    }
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId, actorType: actor.actorType, actorId: actor.actorId,
      agentId: actor.agentId, runId: actor.runId,
      action: "memory.version_rejected", entityType: "memory_item", entityId: itemId,
      details: { versionId },
    });
    res.json(version);
  });

  router.get("/companies/:companyId/memory-pending", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const items = await svc.listPending(companyId);
    res.json(items);
  });

  return router;
}
