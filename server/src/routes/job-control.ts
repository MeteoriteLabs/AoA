import { Router, type Request } from "express";
import type { Db } from "@armyofagents/db";
import { submitJobCommandSchema, type SubmitJobCommand } from "@armyofagents/shared";
import { validate } from "../middleware/validate.js";
import { HttpError } from "../errors.js";
import { jobSubmissionService, type AuthenticatedJobPrincipal } from "../services/job-submission.js";
import { TenantAdmissionDeniedError } from "../services/tenant-admission.js";
import { logger } from "../middleware/logger.js";

function principalFor(req: Request, companyId: string, organizationId: string): AuthenticatedJobPrincipal | null {
  const actor = req.actor;
  if (actor.type === "board" && actor.userId) {
    const scoped = actor.isInstanceAdmin === true || (
      actor.companyIds?.includes(companyId) === true &&
      actor.organizationIds?.includes(organizationId) === true
    );
    if (!scoped) return null;
    return {
      kind: actor.source === "local_implicit" || actor.isInstanceAdmin === true
        ? "local_board"
        : "user",
      id: actor.userId,
    };
  }
  if (actor.type === "agent" && actor.agentId && actor.companyId === companyId) {
    return { kind: "agent", id: actor.agentId };
  }
  if (actor.type === "mcp" && actor.companyId === companyId && actor.keyId) {
    return { kind: "mcp", id: actor.keyId };
  }
  if (actor.type === "commander" && actor.companyId === companyId) {
    return { kind: "commander", id: actor.userId ?? actor.keyId ?? "commander" };
  }
  return null;
}

export function jobControlRoutes(appDb: Db) {
  const router = Router();
  const service = jobSubmissionService(appDb);

  router.post(
    "/organizations/:organizationId/companies/:companyId/jobs",
    validate(submitJobCommandSchema),
    async (req, res) => {
      const organizationId = req.params.organizationId as string;
      const companyId = req.params.companyId as string;
      const principal = principalFor(req, companyId, organizationId);
      if (!principal) {
        logger.warn({
          organizationId,
          companyId,
          sourceKind: req.body?.source?.kind,
          replayed: false,
          reasonCode: "job_submission_principal_denied",
        }, "job submission denied");
        res.status(403).json({ error: "Job submission denied" });
        return;
      }
      try {
        const result = await service.submit({
          organizationId,
          companyId,
          principal,
          command: req.body as SubmitJobCommand,
        });
        logger.info({
          organizationId,
          companyId,
          jobId: result.jobId,
          attemptId: result.attemptId,
          sourceKind: req.body.source.kind,
          replayed: result.replayed,
          reasonCode: result.replayed ? "job_submission_replayed" : "job_submission_created",
        }, "job submission accepted");
        res.status(result.replayed ? 200 : 201).json(result);
      } catch (error) {
        if (error instanceof TenantAdmissionDeniedError) {
          logger.warn({
            organizationId,
            companyId,
            sourceKind: req.body.source.kind,
            replayed: false,
            reasonCode: "job_submission_tenant_denied",
          }, "job submission denied");
          res.status(403).json({ error: "Job submission denied" });
          return;
        }
        if (error instanceof HttpError) {
          logger.warn({
            organizationId,
            companyId,
            sourceKind: req.body.source.kind,
            replayed: false,
            reasonCode: error.status === 409
              ? "job_submission_idempotency_conflict"
              : "job_submission_rejected",
          }, "job submission rejected");
          res.status(error.status).json({ error: error.message });
          return;
        }
        throw error;
      }
    },
  );
  return router;
}
