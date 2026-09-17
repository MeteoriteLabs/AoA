import { Router, type Request, type Response } from "express";
import type { Db } from "@armyofagents/db";
import { layoutPatchSchema } from "@armyofagents/shared";
import { validate } from "../middleware/validate.js";
import { universeLayoutService } from "../services/universe-layout.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { unauthorized } from "../errors.js";

function requireBoardUserId(req: Request): string {
  // rbac: paired-via-helper — every route below pairs assertCompanyAccess with
  // this helper; the assertBoard here is the helper's own actor-type guard.
  assertBoard(req);
  if (req.actor.type !== "board" || !req.actor.userId) {
    throw unauthorized("Board authentication required");
  }
  return req.actor.userId;
}

/**
 * Owner-scoped Universe canvas layout persistence for one conversation. Personal
 * presentation state (like home-board-layout / sidebar-preferences): company
 * access-gated, owner-only, no role gate and no activity log. The scope's userId
 * comes from the authenticated board actor and conversationId from the path — the
 * body never supplies actor/company/conversation. Revision conflicts and reused
 * operation ids surface as 409 through the global error handler.
 */
export function universeLayoutRoutes(db: Db) {
  const router = Router();
  const svc = universeLayoutService(db);
  const base =
    "/companies/:companyId/universe/conversations/:conversationId/layout";

  const scopeFrom = (req: Request) => ({
    companyId: req.params.companyId as string,
    conversationId: req.params.conversationId as string,
    userId: requireBoardUserId(req),
  });

  router.get(base, async (req, res) => {
    await assertCompanyAccess(db, req, req.params.companyId as string);
    res.json(await svc.get(scopeFrom(req)));
  });

  router.patch(base, validate(layoutPatchSchema), async (req, res) => {
    await assertCompanyAccess(db, req, req.params.companyId as string);
    res.json(await svc.apply(scopeFrom(req), req.body));
  });

  router.get(`${base}/operations/:operationId`, async (req, res) => {
    await assertCompanyAccess(db, req, req.params.companyId as string);
    const ack = await svc.getReceipt(
      scopeFrom(req),
      req.params.operationId as string,
    );
    if (!ack) {
      res.status(404).json({ error: "Operation not found" });
      return;
    }
    res.json(ack);
  });

  return router;
}
