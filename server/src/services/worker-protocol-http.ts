import type { Request, Response } from "express";
import {
  OPERATION_DESCRIPTORS,
  protocolErrorV1Schema,
  type ProtocolErrorCode,
  type ProtocolErrorV1,
} from "@armyofagents/worker-protocol";
import { WORKER_CONTROL_HEADERS } from "@armyofagents/shared";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENROLLMENT_ERRORS: ReadonlySet<string> = new Set(OPERATION_DESCRIPTORS.enrollment.errors);

export type WorkerHttpProtocolErrorCode = Extract<
  ProtocolErrorCode,
  "malformed" | "unauthorized" | "internal_unavailable"
>;

function correlationId(req: Request): string | null {
  const bodyValue = req.body && typeof req.body === "object"
    ? (req.body as Record<string, unknown>).correlationId
    : null;
  const headerValue = req.header(WORKER_CONTROL_HEADERS.requestId);
  const candidate = typeof bodyValue === "string" ? bodyValue : headerValue;
  return candidate && UUID.test(candidate) ? candidate : null;
}

export function workerProtocolErrorV1(
  req: Request,
  code: WorkerHttpProtocolErrorCode,
  now: Date = new Date(),
): ProtocolErrorV1 {
  if (!ENROLLMENT_ERRORS.has(code)) throw new Error(`Unsupported enrollment protocol error code: ${code}`);
  return protocolErrorV1Schema.parse({
    protocolVersion: 1,
    code,
    correlationId: correlationId(req),
    message: code === "malformed"
      ? "Worker control request malformed"
      : code === "internal_unavailable"
        ? "Worker control temporarily unavailable"
        : "Worker control request denied",
    retryAfterMs: code === "internal_unavailable" ? 1_000 : null,
    serverTime: now.toISOString(),
    redaction: "secret",
    detail: {},
  });
}

export function sendWorkerProtocolError(
  req: Request,
  res: Response,
  code: WorkerHttpProtocolErrorCode,
  now: Date = new Date(),
): void {
  const status = code === "malformed" ? 400 : code === "internal_unavailable" ? 503 : 401;
  res.status(status).json(workerProtocolErrorV1(req, code, now));
}

export function isEnrollmentWorkerControlPath(url: string): boolean {
  return /^\/(?:api\/)?worker-control\/enroll(?:\?|$)/.test(url);
}
