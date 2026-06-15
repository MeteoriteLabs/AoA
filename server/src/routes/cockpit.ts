/**
 * cockpit route factory — Phase 3b.
 *
 * GET /companies/:companyId/cockpit → CockpitData
 *
 * BOARD-ONLY: this endpoint is a person's mission control. We layer two
 * guards:
 *   1. assertCompanyAccess — same-company check; gives unauthed actors 401.
 *   2. assertBoard — throws 403 for non-board actors (agents, MCP tokens).
 *
 * This mirrors the requireBoardUserId pattern in sidebar-preferences and
 * inbox-dismissals. An explicit type check after assertBoard (belt-and-
 * suspenders) ensures we have a userId before calling the service.
 *
 * Mirrors scaffold: server/src/routes/sidebar-badges.ts
 */

import { Router } from "express";
import type { Db } from "@armyofagents/db";
import { assertCompanyAccess, assertBoard } from "./authz.js";
import { unauthorized } from "../errors.js";
import { cockpitService } from "../services/cockpit.js";

export function cockpitRoutes(db: Db) {
  const router = Router();
  const svc = cockpitService(db);

  router.get("/companies/:companyId/cockpit", async (req, res) => {
    const companyId = req.params.companyId as string;

    // Guard 1: company-level access check (rejects cross-company and unauthed).
    // Ordered FIRST so an unauthenticated actor (type=none) gets 401, not 403.
    assertCompanyAccess(req, companyId);

    // Guard 2: BOARD-ONLY — reject agent/MCP actors (Codex #1).
    // assertBoard throws forbidden (403) for non-board actors.
    assertBoard(req);

    // Belt-and-suspenders: assertBoard guarantees type === "board", but we
    // also need a userId to build the cockpit scope.
    if (req.actor.type !== "board" || !req.actor.userId) {
      throw unauthorized("Board authentication required");
    }

    const data = await svc.get(companyId, {
      actorId: req.actor.userId,
      source: req.actor.source,
      isInstanceAdmin: req.actor.isInstanceAdmin,
    });

    res.json(data);
  });

  return router;
}
