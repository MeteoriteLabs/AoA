import { Router } from "express";
import type { Db } from "@armyofagents/db";
import { memoryService } from "../services/index.js";
import { assertCompanyAccess } from "./authz.js";

/**
 * V2.6 Phase 3 — read-only API for memory_retrievals audit rows.
 *
 * Powers the workspace right-panel MemorySection so founders can see
 * exactly what memory each agent run actually queried + got back.
 *
 * Surface (small on purpose — UI is the only consumer):
 *
 *   GET /companies/:companyId/issues/:issueId/memory-retrievals?limit=N
 *     Returns retrievals for a single task (across all its heartbeat
 *     runs), newest first, joined with memory_items title/category/
 *     layer. Default limit 100, hard cap 500.
 *
 * RBAC: assertCompanyAccess (board / agent / mcp matched to companyId).
 * No additional gating — retrievals are scoped to the task, and any
 * caller who can read the task can see what was searched against it.
 */
export function memoryRetrievalsRoutes(db: Db) {
  const router = Router();
  const svc = memoryService(db);

  router.get("/companies/:companyId/issues/:issueId/memory-retrievals", async (req, res) => {
    const companyId = req.params.companyId as string;
    const issueId = req.params.issueId as string;
    assertCompanyAccess(req, companyId);

    const limitRaw = req.query.limit as string | undefined;
    const limit = limitRaw ? Math.max(1, parseInt(limitRaw, 10) || 0) : undefined;

    const rows = await svc.listRetrievalsForIssue(companyId, issueId, { limit });
    res.json(rows);
  });

  return router;
}
