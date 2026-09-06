import { Router, type Request } from "express";
import type { Db } from "@armyofagents/db";
import { submitJobCommandSchema, type SubmitJobCommand } from "@armyofagents/shared";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { HttpError, forbidden, notFound } from "../errors.js";
import { assertBoard } from "./authz.js";
import { organizationAccessService } from "../services/organization-access.js";
import { jobSubmissionService, type AuthenticatedJobPrincipal } from "../services/job-submission.js";
import { createJobOperationsService } from "../services/job-operations.js";
import { TenantAdmissionDeniedError } from "../services/tenant-admission.js";
import { logger } from "../middleware/logger.js";

const uuid = z.string().uuid();

/** JOB-008 operator mutation body: a bounded human-readable reason. */
const operatorReasonSchema = z
  .object({ reason: z.string().min(1).max(1000) })
  .strict();

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
  if (
    actor.type === "commander" &&
    actor.companyId === companyId &&
    actor.userId &&
    actor.userRole &&
    actor.conversationId &&
    actor.turnId
  ) {
    return {
      kind: "commander",
      id: actor.userId,
      role: actor.userRole,
      commanderClaims: {
        userId: actor.userId,
        conversationId: actor.conversationId,
        turnId: actor.turnId,
      },
    };
  }
  return null;
}

export function jobControlRoutes(opts: { db: Db; appDb: Db; operatorDb: Db }) {
  const router = Router();
  const service = jobSubmissionService(opts.appDb);
  const operations = createJobOperationsService({ appDb: opts.appDb, operatorDb: opts.operatorDb });
  const orgAccess = organizationAccessService(opts.db);

  // JOB-008 authority gate — replicates execution-targets.ts assertOrgAdmin. Runs FIRST
  // on every operator route so a caller lacking authority gets a uniform 403 whether or
  // not the org/resource exists (no cross-tenant existence disclosure). `assertBoard`
  // yields 401 for an unauthenticated actor and 403 for a non-board actor; the org
  // fleet-management cap (`execution_target:manage`, owner/admin only) is the real gate.
  async function assertOrgAdmin(req: Request, organizationId: string): Promise<void> {
    // rbac: paired-via-helper — orgAccess.canOrg below is the scoped gate.
    assertBoard(req);
    const userId = req.actor.type === "board" ? (req.actor.userId ?? null) : null;
    if (!userId) throw forbidden("Sign in to manage job operations");
    if (!(await orgAccess.canOrg(organizationId, userId, "execution_target:manage"))) {
      throw forbidden("You are not an owner/admin of this organization");
    }
  }

  function operatorUserId(req: Request): string {
    return req.actor.type === "board" ? (req.actor.userId ?? "board") : "board";
  }

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
        (res as typeof res & { __jobSubmissionLogContext?: Record<string, unknown> })
          .__jobSubmissionLogContext = {
            organizationId,
            companyId,
            sourceKind: req.body.source.kind,
            replayed: false,
            reasonCode: "job_submission_internal_error",
          };
        throw error;
      }
    },
  );

  // ── JOB-008 operator READ surface (redacted; manual Refresh only — no realtime) ──

  // List the tenant's jobs (redacted aggregate rows).
  router.get(
    "/organizations/:organizationId/companies/:companyId/jobs",
    async (req, res, next) => {
      try {
        const organizationId = uuid.parse(req.params.organizationId);
        const companyId = uuid.parse(req.params.companyId);
        await assertOrgAdmin(req, organizationId);
        res.json(await operations.listJobs(organizationId, companyId));
      } catch (error) {
        next(error);
      }
    },
  );

  // A single job's redacted detail (job + attempts + leases + event metadata).
  router.get(
    "/organizations/:organizationId/companies/:companyId/jobs/:jobId",
    async (req, res, next) => {
      try {
        const organizationId = uuid.parse(req.params.organizationId);
        const companyId = uuid.parse(req.params.companyId);
        const jobId = uuid.parse(req.params.jobId);
        await assertOrgAdmin(req, organizationId);
        const detail = await operations.getJobDetail(organizationId, companyId, jobId);
        // Uniform 404 — indistinguishable from a cross-tenant-existing job (no oracle).
        if (!detail) throw notFound("Job not found");
        res.json(detail);
      } catch (error) {
        next(error);
      }
    },
  );

  // List the tenant's workers (redacted; org-scoped, never platform/null-org rows).
  router.get("/organizations/:organizationId/workers", async (req, res, next) => {
    try {
      const organizationId = uuid.parse(req.params.organizationId);
      await assertOrgAdmin(req, organizationId);
      res.json(await operations.listWorkers(organizationId));
    } catch (error) {
      next(error);
    }
  });

  // ── JOB-008 operator MUTATION surface (delegate to JOB-006/007; audit every success) ──
  //
  // NOTE: the operator CANCEL route lives in worker-control.ts (JOB-006's existing
  //   POST .../jobs/:jobId/cancel — board-auth'd, execution_target:manage scoped,
  //   requestCancellation-delegating, audited). It is REUSED, not duplicated here, so the
  //   same path is never double-registered across two /api routers. DRAIN below is the
  //   job-level GRACEFUL variant (requestCancellation graceful:true) with its own audit.

  router.post(
    "/organizations/:organizationId/companies/:companyId/jobs/:jobId/drain",
    validate(operatorReasonSchema),
    async (req, res, next) => {
      try {
        const organizationId = uuid.parse(req.params.organizationId);
        const companyId = uuid.parse(req.params.companyId);
        const jobId = uuid.parse(req.params.jobId);
        await assertOrgAdmin(req, organizationId);
        const { reason } = req.body as { reason: string };
        const outcome = await operations.drainJob(organizationId, companyId, jobId, reason);
        if (outcome.status === "not_found") {
          // Uniform 404, no audit line (absent === cross-tenant-existing).
          throw notFound("Job not found");
        }
        logger.info(
          {
            action: "job.drain.requested",
            organizationId,
            companyId,
            jobId,
            operatorUserId: operatorUserId(req),
            outcome: outcome.status,
            reasonCode: "job_drain_requested",
          },
          "job drain requested",
        );
        res.status(202).json({
          status: outcome.status,
          command: outcome.command
            ? { commandId: outcome.command.commandId, commandSeq: outcome.command.commandSeq }
            : null,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  // Worker-scoped revocation (R2): the cross-tenant execution target id is resolved
  // server-side inside the tenant and never received from the client.
  router.post(
    "/organizations/:organizationId/workers/:workerId/revoke",
    validate(operatorReasonSchema),
    async (req, res, next) => {
      try {
        const organizationId = uuid.parse(req.params.organizationId);
        const workerId = uuid.parse(req.params.workerId);
        await assertOrgAdmin(req, organizationId);
        const { reason } = req.body as { reason: string };
        const result = await operations.revokeWorker(organizationId, workerId, reason);
        if (result.reason === "not_found") {
          // Uniform 404, no audit line, no delegate call.
          throw notFound("Worker not found");
        }
        logger.info(
          {
            action: "worker.revoke.requested",
            organizationId,
            workerId,
            operatorUserId: operatorUserId(req),
            outcome: result.revoked ? "revoked" : (result.reason ?? "noop"),
            reasonCode: "worker_revoke_requested",
          },
          "worker revocation requested",
        );
        res.status(200).json({
          revoked: result.revoked,
          reason: result.reason,
          revokedGeneration: result.revokedGeneration,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
