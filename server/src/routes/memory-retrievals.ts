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
 * Phase 7 — also powers the Commander cockpit Memory card:
 *
 *   GET /companies/:companyId/issues/:issueId/memory-retrievals?limit=N
 *     Returns retrievals for a single task (across all its heartbeat
 *     runs), newest first, joined with memory_items title/category/
 *     layer. Default limit 100, hard cap 500.
 *
 *   GET /companies/:companyId/conversations/:conversationId/memory-retrievals?limit=N
 *     Returns retrievals linked to a Commander conversation
 *     (triggeredBy:"commander_query", conversationId set via [A3] fix).
 *     Same shape as the issue route; newest first.
 *
 * RBAC: assertCompanyAccess (board / agent / mcp matched to companyId).
 * No additional gating — retrievals are scoped to the resource, and any
 * caller who can read the resource can see what was searched against it.
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

  // Phase 7: Commander conversation retrieval audit for the Memory cockpit card.
  router.get("/companies/:companyId/conversations/:conversationId/memory-retrievals", async (req, res) => {
    const companyId = req.params.companyId as string;
    const conversationId = req.params.conversationId as string;
    assertCompanyAccess(req, companyId);

    const limitRaw = req.query.limit as string | undefined;
    const limit = limitRaw ? Math.max(1, parseInt(limitRaw, 10) || 0) : undefined;

    const rows = await svc.listRetrievalsForConversation(companyId, conversationId, { limit });
    res.json(rows);
  });

  return router;
}
