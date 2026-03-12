import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { dependencyService, logActivity } from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

export function dependencyRoutes(db: Db) {
  const router = Router();
  const deps = dependencyService(db);

  // GET /companies/:companyId/issues/:issueId/dependencies
  router.get("/companies/:companyId/issues/:issueId/dependencies", async (req, res) => {
    const { companyId, issueId } = req.params;
    assertCompanyAccess(req, companyId);

    const [upstream, downstream] = await Promise.all([
      deps.getDependencies(companyId, issueId),
      deps.getDependents(companyId, issueId),
    ]);

    res.json({ upstream, downstream });
  });

  // POST /companies/:companyId/issues/:issueId/dependencies
  router.post("/companies/:companyId/issues/:issueId/dependencies", async (req, res) => {
    const { companyId, issueId } = req.params;
    assertCompanyAccess(req, companyId);

    const { dependencyIssueId } = req.body;
    if (!dependencyIssueId || typeof dependencyIssueId !== "string") {
      res.status(400).json({ error: "dependencyIssueId is required" });
      return;
    }

    const row = await deps.addDependency(companyId, issueId, dependencyIssueId);

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "dependency.added",
      entityType: "issue",
      entityId: issueId,
      details: { dependencyIssueId },
    });

    res.status(201).json(row);
  });

  // DELETE /companies/:companyId/issues/:issueId/dependencies/:dependencyIssueId
  router.delete("/companies/:companyId/issues/:issueId/dependencies/:dependencyIssueId", async (req, res) => {
    const { companyId, issueId, dependencyIssueId } = req.params;
    assertCompanyAccess(req, companyId);

    const deleted = await deps.removeDependency(companyId, issueId, dependencyIssueId);

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "dependency.removed",
      entityType: "issue",
      entityId: issueId,
      details: { dependencyIssueId },
    });

    res.json(deleted);
  });

  return router;
}
