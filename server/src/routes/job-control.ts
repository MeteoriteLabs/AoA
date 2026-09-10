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
import {
  CONTROLLABLE_DESIRED_STATES,
  CREATABLE_DESIRED_STATES,
  createService,
  listServices,
  normalizeServiceDefinition,
  readService,
  setServiceDesiredState,
} from "../services/service-management.js";
import {
  SERVICE_CREATE_ACTION,
  SERVICE_DESIRED_STATE_ACTION,
} from "../services/service-control-audit.js";
import { logger } from "../middleware/logger.js";

const uuid = z.string().uuid();

/** JOB-008 operator mutation body: a bounded human-readable reason. */
const operatorReasonSchema = z
  .object({ reason: z.string().min(1).max(1000) })
  .strict();

/**
 * SVC-007 create body. `definition` is deliberately `unknown` here and validated by
 * `normalizeServiceDefinition` INSIDE the handler, after the authority gate — so an
 * unauthorized caller cannot tell a malformed definition from a valid one, which is the
 * ordering constraint BRW-001 established and `service-job-config.ts` restates.
 *
 * The desired-state enum comes from the shipped constant rather than a second literal list,
 * so the route cannot admit a state the service layer refuses.
 */
const createServiceBodySchema = z
  .object({
    definition: z.unknown(),
    desiredState: z
      .enum(CREATABLE_DESIRED_STATES as unknown as [string, ...string[]])
      .optional(),
  })
  .strict();

/** SVC-007 desired-state control body: the target state plus the same bounded reason every
 *  other operator mutation on this router carries into its audit line. */
const serviceDesiredStateBodySchema = z
  .object({
    desiredState: z.enum(CONTROLLABLE_DESIRED_STATES as unknown as [string, ...string[]]),
    reason: z.string().min(1).max(1000),
  })
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

  // ── SVC-007 service management (create + desired-state control + the operator view) ──
  //
  // ★ THIS ROUTER IS THE COMPOSITION ROOT FOR THE E9 CONTROL PLANE, and these four routes are
  // the first ones that let a human reach it. Before them `repos.services.insert` had ZERO
  // production callers and `service_generations` had ZERO writers, so SVC-002's reconciler
  // read an empty window on every tick and SVC-003a's projection had no instance to move —
  // both shipped, both unreachable. `jobControlRoutes` is mounted by `createApp` inside the
  // `opts.distributedExecutionEnabled` block over the non-owner `aoa_app` pool, which is why
  // the create path needs no flag check of its own: flag-off, this router is never built.
  //
  // Authority is `assertOrgAdmin` — the SAME `execution_target:manage` org-owner/admin gate
  // every JOB-008 operator mutation above uses, run FIRST so a caller without it gets a
  // uniform 403 whether or not the org, company or service exists.

  /**
   * The tenant-pair FK. A create whose `companyId` does not belong to `organizationId` fails
   * `services_org_company_fk` at the database — which is the fail-closed answer, since
   * `aoa.organization_id` is the only GUC and no app-layer read could prove the pair without
   * a second query that would itself be an existence oracle. Mapped to the SAME uniform 404
   * an absent company would produce, so the two are indistinguishable to the caller.
   */
  function isTenantPairViolation(error: unknown): boolean {
    let current: unknown = error;
    for (let depth = 0; depth < 8 && current && typeof current === "object"; depth += 1) {
      const record = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
      if (record.code === "23503" && record.constraint_name === "services_org_company_fk") return true;
      current = record.cause;
    }
    return false;
  }

  // ★★★ WHAT ON THIS ROUTER IS AUDITED DURABLY, AND WHAT IS STILL ONLY LOGGED.
  //
  // AGENTS.md §9 requires an activity-log entry for every mutating endpoint. Read this before
  // adding a mutation here, because the router is currently SPLIT and the split is not
  // obvious from any one handler:
  //
  //   AUDITED (one `activity_log` row, in the mutation's OWN tenant transaction):
  //     POST …/services                       → `service.create`
  //     POST …/services/:serviceId/desired-state → `service.desired_state`
  //                                              (on `updated` and `unchanged` only —
  //                                               `illegal`/`conflict`/`absent` mutate nothing)
  //
  //   NOT AUDITED — structured logger lines only, which do not outlive the process. Measured
  //   at this commit: neither `jobSubmissionService` nor `createJobOperationsService` contains
  //   any `activityLog` / `insertActivity` / `logActivity` reference, so the handler's logger
  //   line is the whole record.
  //     POST …/companies/:companyId/jobs                  → logs a line with NO `action` at
  //                                                          all (`reasonCode:
  //                                                          "job_submission_created"`)
  //     POST …/companies/:companyId/jobs/:jobId/drain     → logs `job.drain.requested` only
  //     POST …/organizations/:organizationId/workers/:workerId/revoke
  //                                                       → logs `worker.revoke.requested` only
  //
  // ★ THE REASON THE SECOND GROUP IS SILENT IS NOT THE REASON THAT WAS RECORDED FOR IT.
  // `SVC-007a-result.md` §4a(iii)/§7 said an `activity_log` row was "currently unwritable
  // from here" because `jobAuditBridge.recordAcceptedActivity` requires an
  // `ActiveFenceRequest`. That reason is refuted at source in `service-control-audit.ts`'s
  // header (and filed as `E9-F010`): the fence is the BRIDGE's requirement, not the TABLE's,
  // `aoa_app` holds `SELECT, INSERT ON activity_log` under no RLS, and a fenceless
  // transactional write of that table already ships on the distributed path
  // (`stageJobInputFiles`). So the JOB-008 mutations are unaudited because nobody has wired
  // them, and wiring them is a small, unblocked job — not a blocked one. It is left OPEN as
  // `E9-F010`'s remaining conjunct rather than done here, because each needs its own red.
  //
  // ★ NO `validate(...)` MIDDLEWARE ON THESE TWO ROUTES, and the omission is the point.
  // `validate` runs BEFORE the handler, so it would answer an unauthorized caller with a 400
  // describing their body while a well-shaped request from the same caller got the 403 — which
  // contradicts the "authority first" sentence above it. Raised by external review of PR #412
  // (P2). The schema is parsed INSIDE the handler, AFTER `assertOrgAdmin`; a thrown `ZodError`
  // reaches the same error handler `validate` relied on, so the 400 body is unchanged and only
  // the ORDER moves. The sibling JOB-008 mutations still use the middleware; changing them is
  // not this ticket's, and is noted rather than done silently.
  router.post(
    "/organizations/:organizationId/companies/:companyId/services",
    async (req, res, next) => {
      try {
        const organizationId = uuid.parse(req.params.organizationId);
        const companyId = uuid.parse(req.params.companyId);
        await assertOrgAdmin(req, organizationId);
        const body = createServiceBodySchema.parse(req.body) as {
          definition: unknown;
          desiredState?: string;
        };
        const definition = normalizeServiceDefinition(body.definition);
        if (!definition.ok) {
          res.status(400).json({ error: "Service definition rejected", reason: definition.reason });
          return;
        }
        const created = await createService(opts.appDb, {
          organizationId,
          companyId,
          definition: definition.value,
          desiredState: (body.desiredState ?? "running") as "running" | "paused",
          createdBy: operatorUserId(req),
          // SVC-007 Unit B — WHO the durable `activity_log` row attributes this to.
          // `assertOrgAdmin` above has already refused any caller without a board `userId`,
          // so `operatorUserId` is a real user id here and never its `"board"` fallback.
          actor: { actorType: "user", actorId: operatorUserId(req) },
        }).catch((error: unknown) => {
          if (isTenantPairViolation(error)) throw notFound("Company not found");
          throw error;
        });
        if (!created) {
          // The generation insert lost a race against
          // `service_generations_service_generation_uq` for a service id minted moments
          // earlier. Unreachable by construction; reported as a definite refusal rather than
          // retried, because a reachable version of it would mean the id was not fresh.
          throw new HttpError(409, "Service generation already exists");
        }
        logger.info(
          {
            // The SAME constant the durable `activity_log` row carries, so the structured log
            // line and the audit row cannot drift into two names for one act.
            action: SERVICE_CREATE_ACTION,
            organizationId,
            companyId,
            serviceId: created.serviceId,
            generation: created.generation,
            desiredState: created.desiredState,
            operatorUserId: operatorUserId(req),
            reasonCode: "service_created",
          },
          "service created",
        );
        res.status(201).json(created);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/organizations/:organizationId/companies/:companyId/services/:serviceId/desired-state",
    async (req, res, next) => {
      try {
        const organizationId = uuid.parse(req.params.organizationId);
        const companyId = uuid.parse(req.params.companyId);
        const serviceId = uuid.parse(req.params.serviceId);
        await assertOrgAdmin(req, organizationId);
        const { desiredState, reason } = serviceDesiredStateBodySchema.parse(req.body) as {
          desiredState: "running" | "paused" | "stopped";
          reason: string;
        };
        // The whole control — the desired-state write, the graceful cancellation of the live
        // instance's job, and the instance terminalization — runs in ONE tenant transaction
        // under the service's row lock. It reaches `requestCancellation` (graceful) directly
        // rather than through `operations.drainJob`, which opens its own transaction: holding
        // the lock across the cancellation is what stops a concurrent resume from being
        // overtaken by an in-flight stop (external review of PR #412, P1).
        const result = await setServiceDesiredState(
          { appDb: opts.appDb },
          {
            organizationId,
            companyId,
            serviceId,
            desiredState,
            reason,
            // SVC-007 Unit B — see the create route above.
            actor: { actorType: "user", actorId: operatorUserId(req) },
          },
        );
        if (result.verdict.outcome === "absent") {
          // Uniform 404, no audit line — absent is indistinguishable from cross-tenant.
          throw notFound("Service not found");
        }
        if (result.verdict.outcome === "illegal") {
          throw new HttpError(
            409,
            `Service desired state cannot move from ${result.verdict.from} to ${result.verdict.to}`,
          );
        }
        if (result.verdict.outcome === "conflict") {
          throw new HttpError(409, "Service desired state changed concurrently");
        }
        logger.info(
          {
            // See the create route: one constant, shared with the durable audit row.
            action: SERVICE_DESIRED_STATE_ACTION,
            organizationId,
            companyId,
            serviceId,
            desiredState,
            outcome: result.verdict.outcome,
            stopStatus: result.stop?.status ?? null,
            stopInstance: result.stop?.status === "requested" ? result.stop.instance : null,
            // ★ THE OPERATOR'S REASON, RECORDED. Raised by external review of PR #412 (P1): the
            // route REQUIRED a reason and then discarded it on every transition to `running`.
            // A stop carries it into `job_control_commands.body` through `requestCancellation`,
            // but a resume reached no durable sink at all — so a field the caller was forced to
            // supply went nowhere. It is bounded to 1000 characters by the body schema. SVC-007
            // Unit B puts it on the DURABLE `activity_log` row too; this line is the process
            // log, which does not outlive the process.
            reason,
            operatorUserId: operatorUserId(req),
            reasonCode: "service_desired_state_set",
          },
          "service desired state set",
        );
        res.status(200).json({ ...result.verdict, stop: result.stop });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/organizations/:organizationId/companies/:companyId/services",
    async (req, res, next) => {
      try {
        const organizationId = uuid.parse(req.params.organizationId);
        const companyId = uuid.parse(req.params.companyId);
        await assertOrgAdmin(req, organizationId);
        const after = req.query.after === undefined ? null : uuid.parse(req.query.after);
        res.json(await listServices(opts.appDb, {
          organizationId,
          companyId,
          afterServiceId: after,
          limit: 100,
        }));
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/organizations/:organizationId/companies/:companyId/services/:serviceId",
    async (req, res, next) => {
      try {
        const organizationId = uuid.parse(req.params.organizationId);
        const companyId = uuid.parse(req.params.companyId);
        const serviceId = uuid.parse(req.params.serviceId);
        await assertOrgAdmin(req, organizationId);
        const view = await readService(opts.appDb, { organizationId, companyId, serviceId });
        if (!view) throw notFound("Service not found");
        res.json(view);
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
