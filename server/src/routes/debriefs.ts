import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { createDebriefSchema, updateDebriefSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { debriefService, logActivity } from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

export function debriefRoutes(db: Db) {
  const router = Router();
  const svc = debriefService(db);

  router.get("/companies/:companyId/debriefs", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const { status, departmentId, inputType } = req.query as Record<string, string | undefined>;
    const result = await svc.list(companyId, { status, departmentId, inputType });
    res.json(result);
  });

  router.get("/companies/:companyId/debriefs/:id", async (req, res) => {
    const companyId = req.params.companyId as string;
    const id = req.params.id as string;
    assertCompanyAccess(req, companyId);
    const debrief = await svc.getById(companyId, id);
    if (!debrief) {
      res.status(404).json({ error: "Debrief not found" });
      return;
    }
    res.json(debrief);
  });

  router.post("/companies/:companyId/debriefs", validate(createDebriefSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const debrief = await svc.create(companyId, {
      ...req.body,
      createdBy: actor.actorId,
    });
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "debrief.created",
      entityType: "debrief",
      entityId: debrief.id,
      details: { title: debrief.title, inputType: debrief.inputType },
    });
    res.status(201).json(debrief);
  });

  router.patch("/companies/:companyId/debriefs/:id", validate(updateDebriefSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    const id = req.params.id as string;
    assertCompanyAccess(req, companyId);
    const existing = await svc.getById(companyId, id);
    if (!existing) {
      res.status(404).json({ error: "Debrief not found" });
      return;
    }
    const debrief = await svc.update(companyId, id, req.body);
    if (!debrief) {
      res.status(404).json({ error: "Debrief not found" });
      return;
    }
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "debrief.updated",
      entityType: "debrief",
      entityId: debrief.id,
      details: req.body,
    });
    res.json(debrief);
  });

  return router;
}
