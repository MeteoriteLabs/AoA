import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  createArtifactSchema,
  updateArtifactSchema,
  createArtifactVersionSchema,
  mcpArtifactVersionSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { artifactService, logActivity } from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

export function artifactRoutes(db: Db) {
  const router = Router();
  const svc = artifactService(db);

  // List artifacts for a company
  router.get("/companies/:companyId/artifacts", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const result = await svc.list(companyId);
    res.json(result);
  });

  // Get artifact with versions
  router.get("/artifacts/:id", async (req, res) => {
    const id = req.params.id as string;
    const artifact = await svc.getById(id);
    if (!artifact) {
      res.status(404).json({ error: "Artifact not found" });
      return;
    }
    assertCompanyAccess(req, artifact.companyId);
    res.json(artifact);
  });

  // Create artifact (optionally with initial version)
  router.post(
    "/companies/:companyId/artifacts",
    validate(createArtifactSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      const actor = getActorInfo(req);
      const artifact = await svc.create(companyId, actor.actorId, req.body);

      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "artifact.created",
        entityType: "artifact",
        entityId: artifact.id,
        details: { title: artifact.title, type: artifact.type },
      });

      res.status(201).json(artifact);
    },
  );

  // Update artifact metadata
  router.patch(
    "/artifacts/:id",
    validate(updateArtifactSchema),
    async (req, res) => {
      const id = req.params.id as string;
      const existing = await svc.getById(id);
      if (!existing) {
        res.status(404).json({ error: "Artifact not found" });
        return;
      }
      assertCompanyAccess(req, existing.companyId);

      const artifact = await svc.update(id, req.body);
      if (!artifact) {
        res.status(404).json({ error: "Artifact not found" });
        return;
      }

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId: artifact.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "artifact.updated",
        entityType: "artifact",
        entityId: artifact.id,
        details: req.body,
      });

      res.json(artifact);
    },
  );

  // Add immutable version to artifact
  router.post(
    "/artifacts/:id/versions",
    validate(createArtifactVersionSchema),
    async (req, res) => {
      const id = req.params.id as string;
      const existing = await svc.getById(id);
      if (!existing) {
        res.status(404).json({ error: "Artifact not found" });
        return;
      }
      assertCompanyAccess(req, existing.companyId);

      const version = await svc.addVersion(id, req.body);

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId: existing.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "artifact.version_added",
        entityType: "artifact",
        entityId: existing.id,
        details: {
          versionId: version.id,
          versionNumber: version.versionNumber,
          source: version.source,
        },
      });

      res.status(201).json(version);
    },
  );

  // MCP inbound: push artifact version from external tool (Decision #69, #70)
  // TODO(V2-RBAC): Check role permissions; enter pending state if non-founder pushes version
  router.post(
    "/mcp/artifacts/:id/versions",
    validate(mcpArtifactVersionSchema),
    async (req, res) => {
      const id = req.params.id as string;
      const existing = await svc.getById(id);
      if (!existing) {
        res.status(404).json({ error: "Artifact not found" });
        return;
      }
      assertCompanyAccess(req, existing.companyId);

      const { sourceDetail, changelog, parentVersionId, content, fileUrl } = req.body;

      const version = await svc.addVersion(id, {
        source: "mcp",
        sourceDetail,
        changelog: changelog ?? null,
        parentVersionId: parentVersionId ?? null,
        content: content ?? null,
        fileUrl: fileUrl ?? null,
      });

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId: existing.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "artifact.version_added",
        entityType: "artifact",
        entityId: existing.id,
        details: {
          versionId: version.id,
          versionNumber: version.versionNumber,
          source: "mcp",
          sourceDetail,
        },
      });

      res.status(201).json(version);
    },
  );

  // Get artifact linked to a task
  router.get("/issues/:issueId/artifacts", async (req, res) => {
    const issueId = req.params.issueId as string;
    const issueInfo = await svc.getIssueCompanyId(issueId);
    if (!issueInfo) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    assertCompanyAccess(req, issueInfo.companyId);
    const artifact = await svc.getByIssueId(issueId);
    res.json(artifact);
  });

  return router;
}
