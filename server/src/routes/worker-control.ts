import { Router, type Request } from "express";
import type { Db } from "@armyofagents/db";
import {
  issueWorkerEnrollmentCodeSchema,
  WORKER_CONTROL_HEADERS,
  type IssueWorkerEnrollmentCodeInput,
} from "@armyofagents/shared";
import {
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
import type { JobReadyScheduler } from "../services/job-ready-scheduler.js";
import type { JobControlMetrics } from "../services/job-control-metrics.js";
import { deviceProofHeaders } from "./worker-proof-headers.js";

const uuid = z.string().uuid();

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

  return router;
}
