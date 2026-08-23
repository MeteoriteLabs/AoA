import { Router, type Request } from "express";
import type { Db } from "@armyofagents/db";
import {
  issueWorkerEnrollmentCodeSchema,
  WORKER_CONTROL_HEADERS,
  type IssueWorkerEnrollmentCodeInput,
} from "@armyofagents/shared";
import {
  artifactCommitOperationRequestV1Schema,
  artifactTransferGrantOperationRequestV1Schema,
  eventUploadOperationRequestV1Schema,
  leaseAckOperationRequestV1Schema,
  leaseRenewOperationRequestV1Schema,
  OPERATION_DESCRIPTORS,
  pollRequestV1Schema,
  quarantineGrantOperationRequestV1Schema,
  quarantineFinalizeOperationRequestV1Schema,
} from "@armyofagents/worker-protocol";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { assertBoard } from "./authz.js";
import { forbidden } from "../errors.js";
import { organizationAccessService } from "../services/organization-access.js";
import {
  createWorkerEnrollmentService,
  WorkerEnrollmentError,
} from "../services/worker-enrollment.js";
import { logger } from "../middleware/logger.js";
import { bindJobTraceLogger } from "../services/job-trace-log.js";
import { sendWorkerProtocolError } from "../services/worker-protocol-http.js";
import { sendWorkerOperationProtocolError } from "../services/worker-protocol-http.js";
import {
  verifyWorkerOperationProof,
  WorkerOperationProofError,
} from "../middleware/worker-operation-proof.js";
import { createJobLeasingService, JobLeasingError } from "../services/job-leasing.js";
import { createJobLeaseRenewalService } from "../services/job-fencing.js";
import { createJobEventIngestService, type JobEventIngestTerminalHook } from "../services/job-events.js";
import { createArtifactTransferGrantService } from "../services/artifact-transfer-grant.js";
import { createArtifactCommitService } from "../services/artifact-commit.js";
import { createQuarantineGrantService } from "../services/quarantine-grant.js";
import { createQuarantineFinalizeService } from "../services/quarantine-finalize.js";
import { createSecretBrokerService } from "../services/secret-broker.js";
import { createExecutionSecretBrokers } from "../services/execution-secret-brokers.js";
import {
  admitSandboxLocalResolution,
  executionSecretResolveRequestSchema,
  EXECUTION_SECRET_RESOLVE_DESCRIPTOR,
} from "../services/execution-secret-resolve.js";
import { createStorageProviderFromConfig } from "../storage/provider-registry.js";
import { loadConfig } from "../config.js";
import {
  createJobControlAckService,
  controlAckOperationRequestV1Schema,
} from "../services/job-control-ack.js";
import { createJobReconciliationService } from "../services/job-reconciliation.js";
import type { JobReadyScheduler } from "../services/job-ready-scheduler.js";
import type { JobControlMetrics } from "../services/job-control-metrics.js";
import { readDistributedExecutionDeploymentFlag } from "../config/distributed-execution.js";
import { createWorkerAdmissionRateLimiter } from "../services/worker-admission-rate-limit.js";
import { deviceProofHeaders } from "./worker-proof-headers.js";

const uuid = z.string().uuid();

/** JOB-006 operator cancellation body: a bounded reason + optional graceful flag. */
const cancelJobSchema = z
  .object({
    reason: z.string().min(1).max(1000),
    graceful: z.boolean().optional(),
  })
  .strict();

/** DEP-005 dormant reaper-trigger body: the org to reap + an optional bounded batch. */
const reapTestSchema = z
  .object({
    organizationId: z.string().uuid(),
    limit: z.number().int().positive().max(128).optional(),
  })
  .strict();

export function workerControlRoutes(opts: {
  db: Db;
  appDb: Db;
  operatorDb: Db;
  jobReadyScheduler?: JobReadyScheduler;
  jobControlMetrics?: JobControlMetrics;
  sessionSigningKey: string;
  now?: () => Date;
  /** CLI-006 (2b) — see the note on the same field in `createApp`'s opts. */
  onAttemptTerminal?: JobEventIngestTerminalHook;
}) {
  const router = Router();
  const orgAccess = organizationAccessService(opts.db);
  const enrollment = createWorkerEnrollmentService({
    appDb: opts.appDb,
    operatorDb: opts.operatorDb,
    sessionSigningKey: opts.sessionSigningKey,
    now: opts.now,
  });
  const leasing = createJobLeasingService({
    appDb: opts.appDb,
    operatorDb: opts.operatorDb,
    scheduler: opts.jobReadyScheduler,
    metrics: opts.jobControlMetrics,
  });
  const renewal = createJobLeaseRenewalService({ appDb: opts.appDb });
  const events = createJobEventIngestService({ appDb: opts.appDb, onAttemptTerminal: opts.onAttemptTerminal });
  // DAT-002 — the raw storage provider (full-object-key, no company prefixing) used
  // to presign worker grants and headObject-verify commits.
  const storage = createStorageProviderFromConfig(loadConfig());
  const transferGrants = createArtifactTransferGrantService({ appDb: opts.appDb, storage });
  const artifactCommits = createArtifactCommitService({ appDb: opts.appDb, storage, metrics: opts.jobControlMetrics });
  // DAT-006 — device-authenticated orphan quarantine (distinct `quarantine/` prefix,
  // no live fence). The daemon already builds/signs/POSTs both ops (worker-daemon
  // WRK-007); these stand up the server end.
  const quarantineGrants = createQuarantineGrantService({ appDb: opts.appDb, storage });
  const quarantineFinalize = createQuarantineFinalizeService({ appDb: opts.appDb, storage });
  // DAT-008 — the BOOT ROOT the DAT-004 broker never had. Its only other constructor
  // chain (`createFenceAwareEgressProxy`) has zero callers, so `resolveExecutionSecret`
  // has never executed in production. The brokers are the real value stores for the two
  // sandbox-local ref kinds; `connector_oauth` stays fail-closed by construction.
  const executionSecrets = createSecretBrokerService({
    appDb: opts.appDb,
    brokers: createExecutionSecretBrokers(opts.db),
    metrics: opts.jobControlMetrics,
  });
  const controlAck = createJobControlAckService({ appDb: opts.appDb });
  const reconciliation = createJobReconciliationService({ appDb: opts.appDb });
  // DEP-009 — the SHARED, DB-backed admission rate limiter for the worker poll. Both
  // control-plane replicas increment ONE per-org fixed-window counter, so a burst split
  // across replicas observes one limit. Fail-CLOSED (a shared-store error denies). This
  // route is mounted only under AOA_DISTRIBUTED_EXECUTION_ENABLED, so the limiter is dormant.
  const pollRateLimiter = createWorkerAdmissionRateLimiter({ appDb: opts.appDb });

  router.post(
    "/organizations/:organizationId/execution-targets/:targetId/enrollment-codes",
    validate(issueWorkerEnrollmentCodeSchema),
    async (req, res, next) => {
      try {
        // rbac: paired-via-helper — organizationAccessService.canOrg below is the scoped check.
        assertBoard(req);
        const organizationId = uuid.parse(req.params.organizationId);
        const executionTargetId = uuid.parse(req.params.targetId);
        const userId = req.actor.type === "board" ? req.actor.userId : null;
        if (!userId || !(await orgAccess.canOrg(organizationId, userId, "execution_target:manage"))) {
          throw forbidden("You are not an owner/admin of this organization");
        }
        const body = req.body as IssueWorkerEnrollmentCodeInput;
        const issued = await enrollment.issueTenantCode({
          organizationId,
          executionTargetId,
          scope: body.scope,
          ownerUserId: body.ownerUserId,
          createdByPrincipalKind: "user",
          createdByPrincipalId: userId,
        });
        logger.info({
          action: "worker.enrollment_code.issued",
          organizationId,
          executionTargetId,
          scope: body.scope,
          operatorUserId: userId,
          reasonCode: "enrollment_code_issued",
        }, "worker enrollment code issued");
        res.status(201).json(issued);
      } catch (error) {
        if (error instanceof WorkerEnrollmentError) {
          res.status(403).json({ error: "Worker enrollment denied" });
          return;
        }
        next(error);
      }
    },
  );

  router.post("/worker-control/enroll", async (req, res, next) => {
    try {
      const code = req.header(WORKER_CONTROL_HEADERS.enrollmentCode);
      const proof = deviceProofHeaders(req);
      const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
      if (!code || !proof || !rawBody) {
        sendWorkerProtocolError(req, res, "unauthorized", opts.now?.() ?? new Date());
        return;
      }
      const result = await enrollment.enroll({
        code,
        request: req.body,
        rawBody,
        proof,
        method: req.method,
        path: req.originalUrl,
      });
      res.setHeader(WORKER_CONTROL_HEADERS.session, result.session);
      const replayed = result.auditAction === "replay";
      const rotated = result.auditAction === "rotate";
      logger.info({
        action: replayed
          ? "worker.enrollment.replayed"
          : rotated ? "worker.enrollment.rotated" : "worker.enrollment.consumed",
        workerId: result.response.outcome === "enrolled" ? result.response.workerId : null,
        executionTargetId: result.response.outcome === "enrolled" ? result.response.targetId : null,
        reasonCode: replayed
          ? "worker_enrollment_replayed"
          : rotated ? "worker_rotated" : "worker_enrolled",
      }, "worker enrollment accepted");
      res.status(200).json(result.response);
    } catch (error) {
      if (error instanceof WorkerEnrollmentError) {
        logger.warn({
          action: "worker.enrollment.denied",
          workerId: error.auditIdentifiers?.workerId ?? null,
          executionTargetId: error.auditIdentifiers?.executionTargetId ?? null,
          reasonCode: error.auditReasonCode,
        }, "worker enrollment denied");
        sendWorkerProtocolError(
          req,
          res,
          error.code === "malformed" ? "malformed" : "unauthorized",
          opts.now?.() ?? new Date(),
        );
        return;
      }
      logger.error({
        action: "worker.enrollment.failed",
        reasonCode: "worker_enrollment_internal_unavailable",
      }, "worker enrollment unavailable");
      sendWorkerProtocolError(req, res, "internal_unavailable", opts.now?.() ?? new Date());
    }
  });

  router.post("/worker-control/poll", async (req, res) => {
    try {
      const parsed = pollRequestV1Schema.safeParse(req.body);
      const authorization = req.header("authorization");
      const proof = deviceProofHeaders(req);
      const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
      if (!parsed.success || (rawBody && rawBody.length > OPERATION_DESCRIPTORS.poll.maxRequestBytes)) {
        sendWorkerOperationProtocolError(req, res, "poll", "malformed", opts.now?.() ?? new Date());
        return;
      }
      if (!authorization || !proof || !rawBody) {
        sendWorkerOperationProtocolError(req, res, "poll", "unauthorized", opts.now?.() ?? new Date());
        return;
      }
      const auth = verifyWorkerOperationProof({
        sessionSigningKey: opts.sessionSigningKey,
        authorization,
        rawBody,
        proof,
        method: req.method,
        path: req.originalUrl,
        correlationId: parsed.data.correlationId,
        now: opts.now?.(),
      });
      // DEP-009 — SHARED admission rate limit BEFORE the (frozen) poll authority. Over the
      // per-org window cap, or on a shared-store error (fail-closed), deny with `throttled`
      // (429, retryable) — never a per-process fallback. The DB counter is the sole authority
      // both replicas share, so this is not process-local admission state.
      const admission = await pollRateLimiter.admit(auth.organizationId);
      if (!admission.allowed) {
        sendWorkerOperationProtocolError(req, res, "poll", "throttled", opts.now?.() ?? new Date());
        return;
      }
      const response = await leasing.poll({ auth, request: parsed.data });
      // DEP-007 — bind the trace spine on the offer hop so the poll line is join-able on
      // `jobId` with the ingest/ack hops. Ids go to the operator-only log sink only.
      if (response.outcome === "offer") {
        try {
          bindJobTraceLogger(logger, {
            organizationId: auth.organizationId,
            jobId: response.body.job.jobId,
            attemptNumber: response.body.job.attempt,
            leaseId: response.body.leaseId,
            fence: response.body.fenceToken,
            executionSourceKind: "distributed_worker",
          }).debug("worker poll lease offered");
        } catch {
          // Best-effort trace binding: never alter the poll path (invariant #8).
        }
      }
      res.status(200).json(response);
    } catch (error) {
      if (error instanceof WorkerOperationProofError) {
        sendWorkerOperationProtocolError(req, res, "poll", "unauthorized", opts.now?.() ?? new Date());
        return;
      }
      if (error instanceof JobLeasingError) {
        sendWorkerOperationProtocolError(req, res, "poll", error.code, opts.now?.() ?? new Date());
        return;
      }
      logger.error({
        action: "worker.poll.failed",
        reasonCode: "worker_poll_internal_unavailable",
      }, "worker poll unavailable");
      sendWorkerOperationProtocolError(req, res, "poll", "internal_unavailable", opts.now?.() ?? new Date());
    }
  });

  router.post("/worker-control/leases/:leaseId/ack", async (req, res) => {
    try {
      const parsed = leaseAckOperationRequestV1Schema.safeParse(req.body);
      const leaseId = uuid.safeParse(req.params.leaseId);
      const authorization = req.header("authorization");
      const proof = deviceProofHeaders(req);
      const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
      if (!parsed.success || !leaseId.success || parsed.data.body.leaseId !== leaseId.data
        || (rawBody && rawBody.length > OPERATION_DESCRIPTORS.lease_ack.maxRequestBytes)) {
        sendWorkerOperationProtocolError(req, res, "lease_ack", "malformed", opts.now?.() ?? new Date());
        return;
      }
      if (!authorization || !proof || !rawBody) {
        sendWorkerOperationProtocolError(req, res, "lease_ack", "unauthorized", opts.now?.() ?? new Date());
        return;
      }
      const auth = verifyWorkerOperationProof({
        sessionSigningKey: opts.sessionSigningKey,
        authorization,
        rawBody,
        proof,
        method: req.method,
        path: req.originalUrl,
        correlationId: parsed.data.correlationId,
        now: opts.now?.(),
      });
      const response = await leasing.ack({ auth, request: parsed.data });
      // DEP-007 — bind the trace spine on the ack hop (from the acked delivery identity)
      // so the ack line joins the ingest/poll hops on `jobId`.
      try {
        bindJobTraceLogger(logger, {
          organizationId: auth.organizationId,
          jobId: parsed.data.body.jobId,
          attemptNumber: parsed.data.body.attempt,
          leaseId: parsed.data.body.leaseId,
          fence: parsed.data.body.fenceToken,
          executionSourceKind: "distributed_worker",
        }).debug("worker lease ack");
      } catch {
        // Best-effort trace binding: never alter the ack path (invariant #8).
      }
      res.status(200).json(response);
    } catch (error) {
      if (error instanceof WorkerOperationProofError) {
        sendWorkerOperationProtocolError(req, res, "lease_ack", "unauthorized", opts.now?.() ?? new Date());
        return;
      }
      if (error instanceof JobLeasingError) {
        sendWorkerOperationProtocolError(req, res, "lease_ack", error.code, opts.now?.() ?? new Date());
        return;
      }
      logger.error({
        action: "worker.lease_ack.failed",
        reasonCode: "worker_lease_ack_internal_unavailable",
      }, "worker lease ACK unavailable");
      sendWorkerOperationProtocolError(req, res, "lease_ack", "internal_unavailable", opts.now?.() ?? new Date());
    }
  });

  router.post("/worker-control/leases/:leaseId/renew", async (req, res) => {
    try {
      const parsed = leaseRenewOperationRequestV1Schema.safeParse(req.body);
      const leaseId = uuid.safeParse(req.params.leaseId);
      const authorization = req.header("authorization");
      const proof = deviceProofHeaders(req);
      const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
      if (!parsed.success || !leaseId.success || parsed.data.body.leaseId !== leaseId.data
        || (rawBody && rawBody.length > OPERATION_DESCRIPTORS.lease_renew.maxRequestBytes)) {
        sendWorkerOperationProtocolError(req, res, "lease_renew", "malformed", opts.now?.() ?? new Date());
        return;
      }
      if (!authorization || !proof || !rawBody) {
        sendWorkerOperationProtocolError(req, res, "lease_renew", "unauthorized", opts.now?.() ?? new Date());
        return;
      }
      const auth = verifyWorkerOperationProof({
        sessionSigningKey: opts.sessionSigningKey,
        authorization,
        rawBody,
        proof,
        method: req.method,
        path: req.originalUrl,
        correlationId: parsed.data.correlationId,
        now: opts.now?.(),
      });
      const response = await renewal.renew({ auth, request: parsed.data });
      res.status(200).json(response);
    } catch (error) {
      if (error instanceof WorkerOperationProofError) {
        sendWorkerOperationProtocolError(req, res, "lease_renew", "unauthorized", opts.now?.() ?? new Date());
        return;
      }
      if (error instanceof JobLeasingError) {
        sendWorkerOperationProtocolError(req, res, "lease_renew", error.code, opts.now?.() ?? new Date());
        return;
      }
      logger.error({
        action: "worker.lease_renew.failed",
        reasonCode: "worker_lease_renew_internal_unavailable",
      }, "worker lease renew unavailable");
      sendWorkerOperationProtocolError(req, res, "lease_renew", "internal_unavailable", opts.now?.() ?? new Date());
    }
  });

  router.post("/worker-control/events", async (req, res) => {
    try {
      const parsed = eventUploadOperationRequestV1Schema.safeParse(req.body);
      const authorization = req.header("authorization");
      const proof = deviceProofHeaders(req);
      const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
      if (!parsed.success
        || (rawBody && rawBody.length > OPERATION_DESCRIPTORS.event_upload.maxRequestBytes)) {
        sendWorkerOperationProtocolError(req, res, "event_upload",
          rawBody && rawBody.length > OPERATION_DESCRIPTORS.event_upload.maxRequestBytes
            ? "payload_too_large" : "malformed", opts.now?.() ?? new Date());
        return;
      }
      if (!authorization || !proof || !rawBody) {
        sendWorkerOperationProtocolError(req, res, "event_upload", "unauthorized", opts.now?.() ?? new Date());
        return;
      }
      const auth = verifyWorkerOperationProof({
        sessionSigningKey: opts.sessionSigningKey,
        authorization,
        rawBody,
        proof,
        method: req.method,
        path: req.originalUrl,
        correlationId: parsed.data.correlationId,
        now: opts.now?.(),
      });
      const response = await events.ingest({ auth, request: parsed.data });
      res.status(200).json(response);
    } catch (error) {
      if (error instanceof WorkerOperationProofError) {
        sendWorkerOperationProtocolError(req, res, "event_upload", "unauthorized", opts.now?.() ?? new Date());
        return;
      }
      if (error instanceof JobLeasingError) {
        sendWorkerOperationProtocolError(req, res, "event_upload", error.code, opts.now?.() ?? new Date());
        return;
      }
      logger.error({
        action: "worker.event_upload.failed",
        reasonCode: "worker_event_upload_internal_unavailable",
      }, "worker event upload unavailable");
      sendWorkerOperationProtocolError(req, res, "event_upload", "internal_unavailable", opts.now?.() ?? new Date());
    }
  });

  // DAT-002 — worker requests a scoped presigned upload/download grant. Direct-to-
  // store bypass: the bytes never traverse this API body path. Upload requires a
  // live fence; download is tenant-scoped + object-existence (survives lease loss).
  router.post("/worker-control/artifact-transfer-grants", async (req, res) => {
    try {
      const parsed = artifactTransferGrantOperationRequestV1Schema.safeParse(req.body);
      const authorization = req.header("authorization");
      const proof = deviceProofHeaders(req);
      const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
      if (!parsed.success
        || (rawBody && rawBody.length > OPERATION_DESCRIPTORS.artifact_transfer_grant.maxRequestBytes)) {
        sendWorkerOperationProtocolError(req, res, "artifact_transfer_grant",
          rawBody && rawBody.length > OPERATION_DESCRIPTORS.artifact_transfer_grant.maxRequestBytes
            ? "payload_too_large" : "malformed", opts.now?.() ?? new Date());
        return;
      }
      if (!authorization || !proof || !rawBody) {
        sendWorkerOperationProtocolError(req, res, "artifact_transfer_grant", "unauthorized", opts.now?.() ?? new Date());
        return;
      }
      const auth = verifyWorkerOperationProof({
        sessionSigningKey: opts.sessionSigningKey,
        authorization,
        rawBody,
        proof,
        method: req.method,
        path: req.originalUrl,
        correlationId: parsed.data.correlationId,
        now: opts.now?.(),
      });
      const response = await transferGrants.grant({ auth, request: parsed.data });
      res.status(200).json(response);
    } catch (error) {
      if (error instanceof WorkerOperationProofError) {
        sendWorkerOperationProtocolError(req, res, "artifact_transfer_grant", "unauthorized", opts.now?.() ?? new Date());
        return;
      }
      if (error instanceof JobLeasingError) {
        sendWorkerOperationProtocolError(req, res, "artifact_transfer_grant", error.code, opts.now?.() ?? new Date());
        return;
      }
      logger.error({
        action: "worker.artifact_transfer_grant.failed",
        reasonCode: "worker_artifact_transfer_grant_internal_unavailable",
      }, "worker artifact transfer grant unavailable");
      sendWorkerOperationProtocolError(req, res, "artifact_transfer_grant", "internal_unavailable", opts.now?.() ?? new Date());
    }
  });

  // DAT-002 — worker commits a verified artifact manifest. One-tx, fence-first:
  // fence staleness precedes hash/size; wrong prefix/hash/size/tenant/fence cannot
  // commit; the commit itself is the completion event (idempotent on the natural key).
  router.post("/worker-control/artifact-commits", async (req, res) => {
    try {
      const parsed = artifactCommitOperationRequestV1Schema.safeParse(req.body);
      const authorization = req.header("authorization");
      const proof = deviceProofHeaders(req);
      const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
      if (!parsed.success
        || (rawBody && rawBody.length > OPERATION_DESCRIPTORS.artifact_commit.maxRequestBytes)) {
        sendWorkerOperationProtocolError(req, res, "artifact_commit",
          rawBody && rawBody.length > OPERATION_DESCRIPTORS.artifact_commit.maxRequestBytes
            ? "payload_too_large" : "malformed", opts.now?.() ?? new Date());
        return;
      }
      if (!authorization || !proof || !rawBody) {
        sendWorkerOperationProtocolError(req, res, "artifact_commit", "unauthorized", opts.now?.() ?? new Date());
        return;
      }
      const auth = verifyWorkerOperationProof({
        sessionSigningKey: opts.sessionSigningKey,
        authorization,
        rawBody,
        proof,
        method: req.method,
        path: req.originalUrl,
        correlationId: parsed.data.correlationId,
        now: opts.now?.(),
      });
      const response = await artifactCommits.commit({ auth, request: parsed.data });
      res.status(200).json(response);
    } catch (error) {
      if (error instanceof WorkerOperationProofError) {
        sendWorkerOperationProtocolError(req, res, "artifact_commit", "unauthorized", opts.now?.() ?? new Date());
        return;
      }
      if (error instanceof JobLeasingError) {
        sendWorkerOperationProtocolError(req, res, "artifact_commit", error.code, opts.now?.() ?? new Date());
        return;
      }
      logger.error({
        action: "worker.artifact_commit.failed",
        reasonCode: "worker_artifact_commit_internal_unavailable",
      }, "worker artifact commit unavailable");
      sendWorkerOperationProtocolError(req, res, "artifact_commit", "internal_unavailable", opts.now?.() ?? new Date());
    }
  });

  // DAT-008 — redeem ONE sandbox-local execution-secret handle. NOT a frozen wire op
  // (E4-D02 keeps the ten closed; E4's WRK-005 non-goals assign the live
  // secret-materialization transport op and its server route to E5/DAT), so the
  // descriptor is local — but it exists, because a route without one silently has no
  // size ceiling, no timeout, no typed error emitter and no audience declaration.
  //
  // The response carries a live credential, so every failure path below returns the
  // SAME coarse shape a denial does. A caller learns the resolve was refused, never
  // which invariant it tripped or whether a foreign handle exists.
  router.post("/worker-control/execution-secrets/resolve", async (req, res) => {
    const denyMalformed = () => res.status(200).json({
      protocolVersion: 1,
      outcome: "denied",
      reason: "malformed",
      serverTime: (opts.now?.() ?? new Date()).toISOString(),
    });
    try {
      const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
      if (rawBody && rawBody.length > EXECUTION_SECRET_RESOLVE_DESCRIPTOR.maxRequestBytes) {
        return denyMalformed();
      }
      const parsed = executionSecretResolveRequestSchema.safeParse(req.body);
      const authorization = req.header("authorization");
      const proof = deviceProofHeaders(req);
      if (!parsed.success || !authorization || !proof || !rawBody) return denyMalformed();

      const auth = verifyWorkerOperationProof({
        sessionSigningKey: opts.sessionSigningKey,
        authorization,
        rawBody,
        proof,
        method: req.method,
        path: req.originalUrl,
        correlationId: parsed.data.correlationId,
        now: opts.now?.(),
      });

      const outcome = await executionSecrets.resolve({
        auth,
        request: {
          workerId: parsed.data.workerId,
          jobId: parsed.data.jobId,
          attempt: parsed.data.attempt,
          leaseId: parsed.data.leaseId,
          fenceToken: parsed.data.fenceToken,
          handleId: parsed.data.handleId,
        },
      });
      const admitted = admitSandboxLocalResolution(outcome);
      if (admitted.outcome === "denied") {
        return res.status(200).json({
          protocolVersion: 1,
          outcome: "denied",
          reason: admitted.reason,
          serverTime: (opts.now?.() ?? new Date()).toISOString(),
        });
      }
      return res.status(200).json({
        protocolVersion: 1,
        outcome: "resolved",
        envTarget: admitted.envTarget,
        value: admitted.value,
        serverTime: (opts.now?.() ?? new Date()).toISOString(),
      });
    } catch {
      // Includes an auth-layer JobLeasingError and a proof failure. Both collapse to
      // the same coarse denial: distinguishing them would turn this route into an
      // oracle for which worker/lease/handle exists.
      return denyMalformed();
    }
  });

  // DAT-006 — device-authenticated request for a scoped presigned PUT grant to the
  // DISTINCT `quarantine/` prefix (a dead-fence orphan; no live fence). ≤5-minute grant.
  // The path mirrors the frozen daemon's `/api/worker-control/quarantine/grant`.
  router.post("/worker-control/quarantine/grant", async (req, res) => {
    try {
      const parsed = quarantineGrantOperationRequestV1Schema.safeParse(req.body);
      const authorization = req.header("authorization");
      const proof = deviceProofHeaders(req);
      const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
      if (!parsed.success
        || (rawBody && rawBody.length > OPERATION_DESCRIPTORS.quarantine_grant.maxRequestBytes)) {
        sendWorkerOperationProtocolError(req, res, "quarantine_grant",
          rawBody && rawBody.length > OPERATION_DESCRIPTORS.quarantine_grant.maxRequestBytes
            ? "payload_too_large" : "malformed", opts.now?.() ?? new Date());
        return;
      }
      if (!authorization || !proof || !rawBody) {
        sendWorkerOperationProtocolError(req, res, "quarantine_grant", "unauthorized", opts.now?.() ?? new Date());
        return;
      }
      const auth = verifyWorkerOperationProof({
        sessionSigningKey: opts.sessionSigningKey,
        authorization,
        rawBody,
        proof,
        method: req.method,
        path: req.originalUrl,
        correlationId: parsed.data.correlationId,
        now: opts.now?.(),
      });
      const response = await quarantineGrants.grant({ auth, request: parsed.data });
      res.status(200).json(response);
    } catch (error) {
      if (error instanceof WorkerOperationProofError) {
        sendWorkerOperationProtocolError(req, res, "quarantine_grant", "unauthorized", opts.now?.() ?? new Date());
        return;
      }
      if (error instanceof JobLeasingError) {
        // Device-auth surface: only unauthorized/target_revoked/malformed reach here —
        // `stale_fence` is not even in the frozen quarantine_grant error set.
        sendWorkerOperationProtocolError(req, res, "quarantine_grant", error.code, opts.now?.() ?? new Date());
        return;
      }
      logger.error({
        action: "worker.quarantine_grant.failed",
        reasonCode: "worker_quarantine_grant_internal_unavailable",
      }, "worker quarantine grant unavailable");
      sendWorkerOperationProtocolError(req, res, "quarantine_grant", "internal_unavailable", opts.now?.() ?? new Date());
    }
  });

  // DAT-006 — device-authenticated finalize of an uploaded orphan: headObject integrity
  // (fail-closed), then record the `status='quarantined'` orphan row. Structurally cannot
  // touch a committed attempt. Mirrors `/api/worker-control/quarantine/finalize`.
  router.post("/worker-control/quarantine/finalize", async (req, res) => {
    try {
      const parsed = quarantineFinalizeOperationRequestV1Schema.safeParse(req.body);
      const authorization = req.header("authorization");
      const proof = deviceProofHeaders(req);
      const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
      if (!parsed.success
        || (rawBody && rawBody.length > OPERATION_DESCRIPTORS.quarantine_finalize.maxRequestBytes)) {
        sendWorkerOperationProtocolError(req, res, "quarantine_finalize",
          rawBody && rawBody.length > OPERATION_DESCRIPTORS.quarantine_finalize.maxRequestBytes
            ? "payload_too_large" : "malformed", opts.now?.() ?? new Date());
        return;
      }
      if (!authorization || !proof || !rawBody) {
        sendWorkerOperationProtocolError(req, res, "quarantine_finalize", "unauthorized", opts.now?.() ?? new Date());
        return;
      }
      const auth = verifyWorkerOperationProof({
        sessionSigningKey: opts.sessionSigningKey,
        authorization,
        rawBody,
        proof,
        method: req.method,
        path: req.originalUrl,
        correlationId: parsed.data.correlationId,
        now: opts.now?.(),
      });
      const response = await quarantineFinalize.finalize({ auth, request: parsed.data });
      res.status(200).json(response);
    } catch (error) {
      if (error instanceof WorkerOperationProofError) {
        sendWorkerOperationProtocolError(req, res, "quarantine_finalize", "unauthorized", opts.now?.() ?? new Date());
        return;
      }
      if (error instanceof JobLeasingError) {
        sendWorkerOperationProtocolError(req, res, "quarantine_finalize", error.code, opts.now?.() ?? new Date());
        return;
      }
      logger.error({
        action: "worker.quarantine_finalize.failed",
        reasonCode: "worker_quarantine_finalize_internal_unavailable",
      }, "worker quarantine finalize unavailable");
      sendWorkerOperationProtocolError(req, res, "quarantine_finalize", "internal_unavailable", opts.now?.() ?? new Date());
    }
  });

  // JOB-006 — worker uploads its ACK for a delivered control command. Fence-guarded
  // (a stale/superseded fence is rejected stale_fence), idempotent (first terminal
  // ACK wins). No frozen v1 request envelope exists for this direction, so the
  // service defines a thin one (the frozen ACK payload + echoed delivery identity).
  router.post("/worker-control/control-acks", async (req, res) => {
    try {
      const parsed = controlAckOperationRequestV1Schema.safeParse(req.body);
      const authorization = req.header("authorization");
      const proof = deviceProofHeaders(req);
      const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
      if (!parsed.success
        || (rawBody && rawBody.length > OPERATION_DESCRIPTORS.control_command.maxRequestBytes)) {
        sendWorkerOperationProtocolError(req, res, "control_command",
          rawBody && rawBody.length > OPERATION_DESCRIPTORS.control_command.maxRequestBytes
            ? "payload_too_large" : "malformed", opts.now?.() ?? new Date());
        return;
      }
      if (!authorization || !proof || !rawBody) {
        sendWorkerOperationProtocolError(req, res, "control_command", "unauthorized", opts.now?.() ?? new Date());
        return;
      }
      const auth = verifyWorkerOperationProof({
        sessionSigningKey: opts.sessionSigningKey,
        authorization,
        rawBody,
        proof,
        method: req.method,
        path: req.originalUrl,
        correlationId: parsed.data.correlationId,
        now: opts.now?.(),
      });
      const response = await controlAck.ack({ auth, request: parsed.data });
      res.status(200).json(response);
    } catch (error) {
      if (error instanceof WorkerOperationProofError) {
        sendWorkerOperationProtocolError(req, res, "control_command", "unauthorized", opts.now?.() ?? new Date());
        return;
      }
      if (error instanceof JobLeasingError) {
        sendWorkerOperationProtocolError(req, res, "control_command", error.code, opts.now?.() ?? new Date());
        return;
      }
      logger.error({
        action: "worker.control_ack.failed",
        reasonCode: "worker_control_ack_internal_unavailable",
      }, "worker control ack unavailable");
      sendWorkerOperationProtocolError(req, res, "control_command", "internal_unavailable", opts.now?.() ?? new Date());
    }
  });

  // DEP-005 — DORMANT, flag-gated test-only reaper trigger. The lease reaper
  // (reconciliation.reapOrganization) has NO live trigger in the running stack
  // (index.ts schedules only outbox.tick; the `reconciliation` instance above is used
  // only for operator cancellation), so a back-dated lease never converges on its own.
  // The D1 network/clock fault harness needs to cross a lease deadline SYNCHRONOUSLY:
  // back-date the durable lease row, then fire exactly one reap. This route is that
  // trigger. It adds NO new authority, table, or migration — it calls the already-
  // instantiated reconciliation service (proper runInTenant/RLS + a fresh DB clock).
  //
  // Dormancy: DOUBLE-gated at request time on BOTH the distributed-execution flag AND a
  // dedicated test-only flag AOA_D1_TEST_REAP_ENABLED. These are intentionally decoupled:
  // this route has NO authentication (the D1 harness calls it as an unauthenticated
  // control-net peer), so it must NOT become reachable merely because a real deployment
  // turns AOA_DISTRIBUTED_EXECUTION_ENABLED on — only the D1 compose (docker-compose.d1.yml)
  // also sets AOA_D1_TEST_REAP_ENABLED=1. With EITHER flag off the route 404s as if it does
  // not exist. Belt-and-suspenders: app.ts only mounts workerControlRoutes inside the
  // distributed-execution block, and the gate runs BEFORE validation so a dormant route is
  // indistinguishable from an absent one for any body. `_test/`-namespaced so it can never
  // be mistaken for a worker/operator surface. (If this ever needs to run in a real
  // distributed deployment, add assertBoard + orgAccess.canOrg like the cancel route below.)
  router.post(
    "/worker-control/_test/reap",
    (_req, res, next) => {
      if (!readDistributedExecutionDeploymentFlag(process.env) || process.env.AOA_D1_TEST_REAP_ENABLED !== "1") {
        res.status(404).json({ error: "Not found" });
        return;
      }
      next();
    },
    validate(reapTestSchema),
    async (req, res, next) => {
      try {
        const body = req.body as { organizationId: string; limit?: number };
        const result = await reconciliation.reapOrganization(
          body.organizationId,
          body.limit !== undefined ? { limit: body.limit } : undefined,
        );
        res.status(200).json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  // JOB-006 — operator-initiated durable cancellation. Board-authenticated + org
  // fleet-management scoped (owner/admin). Marks the requested state and queues a
  // monotonically-sequenced cancel command bound to the current lease fence.
  router.post(
    "/organizations/:organizationId/companies/:companyId/jobs/:jobId/cancel",
    validate(cancelJobSchema),
    async (req, res, next) => {
      try {
        // rbac: paired-via-helper — organizationAccessService.canOrg below is the scoped check.
        assertBoard(req);
        const organizationId = uuid.parse(req.params.organizationId);
        const companyId = uuid.parse(req.params.companyId);
        const jobId = uuid.parse(req.params.jobId);
        const userId = req.actor.type === "board" ? req.actor.userId : null;
        if (!userId || !(await orgAccess.canOrg(organizationId, userId, "execution_target:manage"))) {
          throw forbidden("You are not an owner/admin of this organization");
        }
        const body = req.body as { reason: string; graceful?: boolean };
        const outcome = await reconciliation.requestCancellation({
          organizationId,
          companyId,
          jobId,
          reason: body.reason,
          graceful: body.graceful ?? true,
        });
        logger.info({
          action: "job.cancellation.requested",
          organizationId,
          companyId,
          jobId,
          operatorUserId: userId,
          outcome: outcome.status,
          reasonCode: "job_cancellation_requested",
        }, "job cancellation requested");
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

  return router;
}
