import { Router, type Request } from "express";
import type { Db } from "@armyofagents/db";
import {
  issueWorkerEnrollmentCodeSchema,
  WORKER_CONTROL_HEADERS,
  type IssueWorkerEnrollmentCodeInput,
} from "@armyofagents/shared";
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
import type { DeviceProofHeaders } from "../services/worker-device-proof.js";

const uuid = z.string().uuid();

export function deviceProofHeaders(req: Request): DeviceProofHeaders | null {
  const proof = {
    version: req.header(WORKER_CONTROL_HEADERS.proofVersion),
    publicKey: req.header(WORKER_CONTROL_HEADERS.publicKey),
    signature: req.header(WORKER_CONTROL_HEADERS.signature),
    issuedAt: req.header(WORKER_CONTROL_HEADERS.issuedAt),
    proofId: req.header(WORKER_CONTROL_HEADERS.proofId),
  };
  if (Object.values(proof).some((value) => typeof value !== "string" || value.length === 0)) return null;
  return proof as DeviceProofHeaders;
}

export function workerControlRoutes(opts: {
  db: Db;
  appDb: Db;
  operatorDb: Db;
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
        res.status(401).json({ error: "Worker enrollment denied" });
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
        res.status(error.code === "malformed" ? 400 : 401).json({
          error: error.code === "malformed" ? "Worker enrollment malformed" : "Worker enrollment denied",
        });
        return;
      }
      next(error);
    }
  });

  return router;
}
