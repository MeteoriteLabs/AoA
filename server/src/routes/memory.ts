import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { createMemoryItemSchema, updateMemoryItemSchema } from "@paperclipai/shared";
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
    const item = await svc.create(companyId, { ...req.body, createdBy: actor.actorId });
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
    const item = await svc.update(companyId, id, req.body);
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

  return router;
}
