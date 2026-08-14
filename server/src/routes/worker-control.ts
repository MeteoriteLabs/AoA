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
import { sendWorkerProtocolError } from "../services/worker-protocol-http.js";
import { sendWorkerOperationProtocolError } from "../services/worker-protocol-http.js";
import {
  verifyWorkerOperationProof,
  WorkerOperationProofError,
} from "../middleware/worker-operation-proof.js";
import { createJobLeasingService, JobLeasingError } from "../services/job-leasing.js";
import { createJobLeaseRenewalService } from "../services/job-fencing.js";
import { createJobEventIngestService } from "../services/job-events.js";
import { createArtifactTransferGrantService } from "../services/artifact-transfer-grant.js";
import { createArtifactCommitService } from "../services/artifact-commit.js";
import { createStorageProviderFromConfig } from "../storage/provider-registry.js";
import { loadConfig } from "../config.js";
import {
  createJobControlAckService,
  controlAckOperationRequestV1Schema,
} from "../services/job-control-ack.js";
import { createJobReconciliationService } from "../services/job-reconciliation.js";
import type { JobReadyScheduler } from "../services/job-ready-scheduler.js";
import type { JobControlMetrics } from "../services/job-control-metrics.js";
import { deviceProofHeaders } from "./worker-proof-headers.js";

const uuid = z.string().uuid();

/** JOB-006 operator cancellation body: a bounded reason + optional graceful flag. */
const cancelJobSchema = z
  .object({
    reason: z.string().min(1).max(1000),
    graceful: z.boolean().optional(),
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
  const events = createJobEventIngestService({ appDb: opts.appDb });
  // DAT-002 — the raw storage provider (full-object-key, no company prefixing) used
  // to presign worker grants and headObject-verify commits.
  const storage = createStorageProviderFromConfig(loadConfig());
  const transferGrants = createArtifactTransferGrantService({ appDb: opts.appDb, storage });
  const artifactCommits = createArtifactCommitService({ appDb: opts.appDb, storage });
  const controlAck = createJobControlAckService({ appDb: opts.appDb });
  const reconciliation = createJobReconciliationService({ appDb: opts.appDb });

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
      const response = await leasing.poll({ auth, request: parsed.data });
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
