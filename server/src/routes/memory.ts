import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  createMemoryItemSchema,
  suggestMemoryArchiveSchema,
  suggestMemoryUpdateSchema,
  updateMemoryItemSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { forbidden } from "../errors.js";
import { memoryService, logActivity } from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { assertMemoryAccess, assertMemoryApproval } from "../middleware/rbac.js";

function resolveAgentRequestId(
  req: Parameters<typeof getActorInfo>[0],
  requestedAgentId?: string,
) {
  if (req.actor.type !== "agent") {
    return requestedAgentId ?? null;
  }

  const authenticatedAgentId = req.actor.agentId ?? null;
  if (!authenticatedAgentId) {
    throw forbidden("Authenticated agent is missing an agentId");
  }
  if (requestedAgentId && requestedAgentId !== authenticatedAgentId) {
    throw forbidden("Agents may only submit suggestions for themselves");
  }

  return authenticatedAgentId;
}

export function memoryRoutes(db: Db) {
  const router = Router();
  const svc = memoryService(db);

  // Semantic search — must be before /:id route
  router.get("/companies/:companyId/memory/search", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const q = req.query.q as string | undefined;
    if (!q || !q.trim()) {
      res.status(400).json({ error: "Query parameter 'q' is required" });
      return;
    }
    const filters = {
      layer: req.query.layer as string | undefined,
      departmentId: req.query.departmentId as string | undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    };
    const results = await svc.searchSemantic(companyId, q.trim(), filters);
    res.json(results);
  });

  // Find similar items — must be before /:id route
  router.get("/companies/:companyId/memory/find-similar", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const content = req.query.content as string | undefined;
    if (!content || !content.trim()) {
      res.status(400).json({ error: "Query parameter 'content' is required" });
      return;
    }
    const scope = {
      companyId,
      departmentId: req.query.departmentId as string | undefined,
      layer: req.query.layer as string | undefined,
    };
    const results = await svc.findSimilarItems(content.trim(), scope);
    res.json(results);
  });

  router.get("/companies/:companyId/memory", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    await assertMemoryAccess(db, req, companyId, "read");
    const filters = {
      category: req.query.category as string | undefined,
      status: req.query.status as string | undefined,
      source: req.query.source as string | undefined,
      departmentId: req.query.departmentId as string | undefined,
      projectId: req.query.projectId as string | undefined,
      layer: req.query.layer as string | undefined,
      tags: req.query.tags ? (req.query.tags as string).split(",") : undefined,
      search: req.query.search as string | undefined,
    };
    const result = await svc.list(companyId, filters);
    res.json(result);
  });

  router.get("/companies/:companyId/memory-pending", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    await assertMemoryAccess(db, req, companyId, "read");
    const result = await svc.listPending(companyId);
    res.json(result);
  });

  router.get("/companies/:companyId/memory/:id", async (req, res) => {
    const companyId = req.params.companyId as string;
    const id = req.params.id as string;
    assertCompanyAccess(req, companyId);
    await assertMemoryAccess(db, req, companyId, "read");
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
    await assertMemoryAccess(db, req, companyId, "create", {
      layer: req.body.layer,
      departmentId: req.body.departmentId,
    });
    const actor = getActorInfo(req);
    const source = req.actor.type === "agent" ? "agent" : req.body.source;
    const item = await svc.create(companyId, {
      ...req.body,
      source,
      createdBy: actor.actorId,
    });
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
    await assertMemoryAccess(db, req, companyId, "update", {
      layer: existing.layer,
      departmentId: existing.departmentId,
      visibility: existing.visibility,
    });
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
    await assertMemoryAccess(db, req, companyId, "delete", {
      layer: existing.layer,
      departmentId: existing.departmentId,
      visibility: existing.visibility,
    });
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
    await assertMemoryApproval(db, req, companyId, {
      layer: existing.layer,
      departmentId: existing.departmentId,
    });
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
    await assertMemoryApproval(db, req, companyId, {
      layer: existing.layer,
      departmentId: existing.departmentId,
    });
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

  router.post(
    "/companies/:companyId/memory/:id/suggest-update",
    validate(suggestMemoryUpdateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const existing = await svc.getById(companyId, id);
      if (!existing) {
        res.status(404).json({ error: "Memory item not found" });
        return;
      }
      await assertMemoryAccess(db, req, companyId, "create", {
        layer: existing.layer,
        departmentId: existing.departmentId,
        visibility: existing.visibility,
      });
      const actor = getActorInfo(req);
      const agentId = resolveAgentRequestId(req, req.body.agentId);
      if (!agentId) {
        throw forbidden("agentId is required");
      }
      const version = await svc.suggestUpdate(
        companyId,
        id,
        req.body.content,
        req.body.sourceContext,
        agentId,
      );
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "memory.update_suggested",
        entityType: "memory_item",
        entityId: id,
        details: {
          versionId: version.id,
          versionNumber: version.versionNumber,
          agentId,
          sourceContext: req.body.sourceContext,
        },
      });
      res.status(201).json(version);
    },
  );

  router.post(
    "/companies/:companyId/memory/:id/suggest-archive",
    validate(suggestMemoryArchiveSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const existing = await svc.getById(companyId, id);
      if (!existing) {
        res.status(404).json({ error: "Memory item not found" });
        return;
      }
      await assertMemoryAccess(db, req, companyId, "create", {
        layer: existing.layer,
        departmentId: existing.departmentId,
        visibility: existing.visibility,
      });
      const actor = getActorInfo(req);
      const agentId = resolveAgentRequestId(req, req.body.agentId);
      if (!agentId) {
        throw forbidden("agentId is required");
      }
      const suggestion = await svc.suggestArchive(
        companyId,
        id,
        req.body.sourceContext,
        agentId,
      );
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "memory.archive_suggested",
        entityType: "memory_item",
        entityId: id,
        details: {
          suggestionId: suggestion.id,
          agentId,
          sourceContext: req.body.sourceContext,
        },
      });
      res.status(201).json(suggestion);
    },
  );

  // ── Version management ──────────────────────────────────────────────

  router.get("/companies/:companyId/memory/:id/versions", async (req, res) => {
    const companyId = req.params.companyId as string;
    const id = req.params.id as string;
    assertCompanyAccess(req, companyId);
    const item = await svc.getById(companyId, id);
    if (!item) {
      res.status(404).json({ error: "Memory item not found" });
      return;
    }
    const versions = await svc.getVersionHistory(id);
    res.json(versions);
  });

  router.post("/companies/:companyId/memory/:id/draft", async (req, res) => {
    const companyId = req.params.companyId as string;
    const id = req.params.id as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const { content } = req.body;
    if (!content || typeof content !== "string") {
      res.status(400).json({ error: "content is required" });
      return;
    }
    const version = await svc.saveDraft(companyId, id, content, actor.actorId);
    if (!version) {
      res.status(404).json({ error: "Memory item not found" });
      return;
    }
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "memory.draft_saved",
      entityType: "memory_item",
      entityId: id,
      details: { versionNumber: version.versionNumber },
    });
    res.json(version);
  });

  router.post("/companies/:companyId/memory/:id/publish", async (req, res) => {
    const companyId = req.params.companyId as string;
    const id = req.params.id as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const version = await svc.publishDraft(companyId, id, actor.actorId);
    if (!version) {
      res.status(404).json({ error: "Memory item or draft not found" });
      return;
    }
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "memory.draft_published",
      entityType: "memory_item",
      entityId: id,
      details: { versionNumber: version.versionNumber },
    });
    res.json(version);
  });

  router.post("/companies/:companyId/memory/:id/versions/:versionId/approve", async (req, res) => {
    const companyId = req.params.companyId as string;
    const id = req.params.id as string;
    const versionId = req.params.versionId as string;
    assertCompanyAccess(req, companyId);
    const existing = await svc.getById(companyId, id);
    if (!existing) {
      res.status(404).json({ error: "Memory item not found" });
      return;
    }
    await assertMemoryApproval(db, req, companyId, {
      layer: existing.layer,
      departmentId: existing.departmentId,
    });
    const actor = getActorInfo(req);
    const version = await svc.approveSuggestedVersion(companyId, id, versionId);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "memory.version_approved",
      entityType: "memory_item",
      entityId: id,
      details: {
        versionId: version.id,
        versionNumber: version.versionNumber,
      },
    });
    res.json(version);
  });

  router.post("/companies/:companyId/memory/:id/versions/:versionId/reject", async (req, res) => {
    const companyId = req.params.companyId as string;
    const id = req.params.id as string;
    const versionId = req.params.versionId as string;
    assertCompanyAccess(req, companyId);
    const existing = await svc.getById(companyId, id);
    if (!existing) {
      res.status(404).json({ error: "Memory item not found" });
      return;
    }
    await assertMemoryApproval(db, req, companyId, {
      layer: existing.layer,
      departmentId: existing.departmentId,
    });
    const actor = getActorInfo(req);
    const version = await svc.rejectSuggestedVersion(companyId, id, versionId);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "memory.version_rejected",
      entityType: "memory_item",
      entityId: id,
      details: {
        versionId: version.id,
        versionNumber: version.versionNumber,
      },
    });
    res.json(version);
  });

  router.post("/companies/:companyId/memory/:id/restore", async (req, res) => {
    const companyId = req.params.companyId as string;
    const id = req.params.id as string;
    assertCompanyAccess(req, companyId);
    const item = await svc.restore(companyId, id);
    if (!item) {
      res.status(404).json({ error: "Memory item not found or not archived" });
      return;
    }
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "memory.restored",
      entityType: "memory_item",
      entityId: item.id,
      details: { title: item.title },
    });
    res.json(item);
  });

  router.post("/companies/:companyId/memory/:id/touch", async (req, res) => {
    const companyId = req.params.companyId as string;
    const id = req.params.id as string;
    assertCompanyAccess(req, companyId);
    const item = await svc.touchAccessedAt(companyId, id);
    if (!item) {
      res.status(404).json({ error: "Memory item not found" });
      return;
    }
    res.json(item);
  });

  return router;
}
