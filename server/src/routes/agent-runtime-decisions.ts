import { Router, type Request } from "express";
import type { Db } from "@armyofagents/db";
import { runtimeDecisionAnswerSchema } from "@armyofagents/shared";
import { validate } from "../middleware/validate.js";
import { agentRuntimeDecisionService, permissionService } from "../services/index.js";
import { assertCompanyAccess } from "./authz.js";
import { forbidden, unauthorized } from "../errors.js";

function requireBoardUserId(req: Request): string {
  if (req.actor.type !== "board" || !req.actor.userId) {
    throw unauthorized("Board authentication required");
  }
  return req.actor.userId;
}

function hasImplicitFounderAuthority(req: Request): boolean {
  return req.actor.source === "local_implicit" || req.actor.isInstanceAdmin === true;
}

export function agentRuntimeDecisionRoutes(db: Db) {
  const router = Router();
  const runtimeDecisions = agentRuntimeDecisionService(db);
  const perms = permissionService(db);

  async function requireFounderAuthority(req: Request, companyId: string, userId: string) {
    if (hasImplicitFounderAuthority(req)) return;
    if (await perms.isFounder(companyId, userId)) return;
    throw forbidden("Runtime decisions require founder authority");
  }

  router.get("/companies/:companyId/agent-runtime-decisions/:id", async (req, res) => {
    const companyId = req.params.companyId as string;
    const decisionId = req.params.id as string;
    assertCompanyAccess(req, companyId);
    requireBoardUserId(req);

    const detail = await runtimeDecisions.getDetail(companyId, decisionId);
    res.json(detail);
  });

  router.post(
    "/companies/:companyId/agent-runtime-decisions/:id/answer",
    validate(runtimeDecisionAnswerSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const decisionId = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const userId = requireBoardUserId(req);
      await requireFounderAuthority(req, companyId, userId);

      const answered = await runtimeDecisions.answerPrompt({
        companyId,
        decisionId,
        actorUserId: userId,
        ...req.body,
      });
      res.json(answered);
    },
  );

  return router;
}
