/**
 * Control-plane HTTP client for the enroll operation (WRK-002).
 *
 * A thin POST client that obeys `OPERATION_DESCRIPTORS.enrollment` (audience
 * `target_enrollment`, 256 KiB request ceiling, 15s client timeout). It attaches
 * the enrollment-code + `aoa-device-*` proof headers, sends the exact signed
 * bytes, and returns the raw status + parsed body + `aoa-worker-session` header
 * for the enroll flow to interpret. HTTP method/path/status live HERE (kept out
 * of the frozen protocol package); the enroll path is exposed so the proof is
 * signed over the SAME path the request is sent to.
 */

import { OPERATION_DESCRIPTORS } from "@armyofagents/worker-protocol";

import { WORKER_CONTROL_HEADERS } from "./headers.js";

/** The mounted enroll route path (server: `api.use(...)` at `/api`). */
export const ENROLL_PATH = "/api/worker-control/enroll";
/** The mounted poll route path (audience `worker_poll`). */
export const POLL_PATH = "/api/worker-control/poll";
/** The mounted lease-ack route base (audience `worker_run`). Both the ack and the
 * WRK-005 renew route hang off this base (`…/leases/:id/ack`, `…/leases/:id/renew`). */
export const LEASE_ACK_BASE_PATH = "/api/worker-control/leases";

/**
 * The mounted quarantine route paths (audience `device_session`, WRK-005). These
 * path strings are PROVISIONAL: the concrete E5/DAT server contract (route strings
 * + the exact device-session header binding) is not built yet. WRK-005 shapes the
 * client to the frozen `quarantine_*` v1 schemas and tests against the fake plane's
 * chosen binding; the live round-trip is E5/DAT.
 */
export const QUARANTINE_GRANT_PATH = "/api/worker-control/quarantine/grant";
export const QUARANTINE_FINALIZE_PATH = "/api/worker-control/quarantine/finalize";

/**
 * The mounted event-upload route path (audience `worker_run`, WRK-006). Fixed
 * (no id-in-path), so the device proof is signed over this EXACT `/api/...`
 * pathname. The daemon is a PURE CONSUMER of the frozen `event_upload` op.
 */
export const EVENT_UPLOAD_PATH = "/api/worker-control/events";

/**
 * The lease-ack route path for `leaseId`. The device proof MUST be signed over
 * this EXACT string — it is the request path the server verifies against
 * (`req.originalUrl`). `leaseId` is a UUID, so encoding is a no-op, but we encode
 * defensively so a stray character can never break out of the path segment.
 */
export function leaseAckPath(leaseId: string): string {
  return `${LEASE_ACK_BASE_PATH}/${encodeURIComponent(leaseId)}/ack`;
}

/**
 * The lease-RENEW route path for `leaseId` (audience `worker_run`, WRK-005). The
 * device proof is signed over this EXACT string, exactly as `leaseAckPath`. It
 * shares the ack base but a distinct `/renew` action so the server can route the
 * frozen `lease_renew` op separately from `lease_ack`.
 */
export function leaseRenewPath(leaseId: string): string {
  return `${LEASE_ACK_BASE_PATH}/${encodeURIComponent(leaseId)}/renew`;
}

export type ControlPlaneTransportErrorKind = "timeout" | "network" | "request_too_large";

/** A transport-layer failure (no HTTP status) — retryable via backoff. */
export class ControlPlaneTransportError extends Error {
  constructor(
    public readonly kind: ControlPlaneTransportErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "ControlPlaneTransportError";
  }
}

export interface EnrollHttpRequest {
  readonly bytes: Buffer;
  readonly enrollmentCode: string;
  /** The five `aoa-device-*` proof headers from `signDeviceProof`. */
  readonly proofHeaders: Readonly<Record<string, string>>;
  /** Optional `aoa-device-request-id` echo (tracing). */
  readonly requestId?: string;
}

export interface EnrollHttpResponse {
  readonly status: number;
  readonly body: unknown;
  readonly sessionHeader: string | null;
}

/**
 * A dual-authenticated worker operation request (poll / lease_ack). The caller
 * signs the device proof over the operation's EXACT path + these exact `bytes`
 * and presents the stored `aoa-worker-session` as the Bearer token; the server
 * verifies BOTH (`verifyWorkerOperationProof`) and binds the proof's device
 * thumbprint to the session's. HTTP method/path/status live HERE, out of the
 * frozen protocol package.
 */
export interface WorkerOperationHttpRequest {
  readonly bytes: Buffer;
  /** The opaque `aoa-worker-session` token → `authorization: Bearer <token>`. */
  readonly sessionToken: string;
  /** The five `aoa-device-*` proof headers from `signDeviceProof`. */
  readonly proofHeaders: Readonly<Record<string, string>>;
  /** Optional `aoa-device-request-id` echo (tracing). */
  readonly requestId?: string;
}

export interface WorkerOperationHttpResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface ControlPlaneClient {
  /** The enroll path the proof must be signed over (equals the request path). */
  readonly path: string;
  /** The poll path the proof must be signed over (equals the request path). */
  readonly pollPath: string;
  /** The quarantine grant path (audience `device_session`; PROVISIONAL, WRK-005). */
  readonly quarantineGrantPath: string;
  /** The quarantine finalize path (audience `device_session`; PROVISIONAL, WRK-005). */
  readonly quarantineFinalizePath: string;
  /** The event-upload path the proof must be signed over (equals the request path, WRK-006). */
  readonly eventUploadPath: string;
  /** The lease-ack path for `leaseId` (the proof must be signed over it). */
  leaseAckPath(leaseId: string): string;
  /** The lease-renew path for `leaseId` (the proof must be signed over it, WRK-005). */
  leaseRenewPath(leaseId: string): string;
  enroll(request: EnrollHttpRequest): Promise<EnrollHttpResponse>;
  /** POST a signed poll request (audience `worker_poll`, 64 KiB / 30s). */
  poll(request: WorkerOperationHttpRequest): Promise<WorkerOperationHttpResponse>;
  /** POST a signed lease ACK to `:leaseId` (audience `worker_run`, 64 KiB / 15s). */
  leaseAck(leaseId: string, request: WorkerOperationHttpRequest): Promise<WorkerOperationHttpResponse>;
  /** POST a signed lease RENEW to `:leaseId` (audience `worker_run`, 64 KiB / 15s, WRK-005). */
  leaseRenew(leaseId: string, request: WorkerOperationHttpRequest): Promise<WorkerOperationHttpResponse>;
  /** POST a device-authenticated quarantine grant request (audience `device_session`,
   * 64 KiB / 15s, WRK-005). Survives lease loss — it is NOT a lease grant. */
  quarantineGrant(request: WorkerOperationHttpRequest): Promise<WorkerOperationHttpResponse>;
  /** POST a device-authenticated quarantine finalize (audience `device_session`,
   * 256 KiB / 15s, WRK-005). */
  quarantineFinalize(request: WorkerOperationHttpRequest): Promise<WorkerOperationHttpResponse>;
  /** POST a signed event batch (audience `worker_run`, 4 MiB / 30s, WRK-006). */
  eventUpload(request: WorkerOperationHttpRequest): Promise<WorkerOperationHttpResponse>;
}

export interface ControlPlaneClientOptions {
  readonly baseUrl: string;
  readonly path?: string;
  /** Injectable fetch (tests); defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /** Client timeout for enroll; defaults to the enrollment descriptor's 15s. */
  readonly timeoutMs?: number;
  /** Client timeout for poll; defaults to the poll descriptor's 30s. */
  readonly pollTimeoutMs?: number;
  /** Client timeout for lease_ack; defaults to the lease_ack descriptor's 15s. */
  readonly leaseAckTimeoutMs?: number;
  /** Client timeout for lease_renew; defaults to the lease_renew descriptor's 15s. */
  readonly leaseRenewTimeoutMs?: number;
  /** Client timeout for quarantine_grant; defaults to the descriptor's 15s. */
  readonly quarantineGrantTimeoutMs?: number;
  /** Client timeout for quarantine_finalize; defaults to the descriptor's 15s. */
  readonly quarantineFinalizeTimeoutMs?: number;
  /** Client timeout for event_upload; defaults to the event_upload descriptor's 30s. */
  readonly eventUploadTimeoutMs?: number;
}

export function createControlPlaneClient(opts: ControlPlaneClientOptions): ControlPlaneClient {
  const path = opts.path ?? ENROLL_PATH;
  const timeoutMs = opts.timeoutMs ?? OPERATION_DESCRIPTORS.enrollment.timeoutMs;
  const maxRequestBytes = OPERATION_DESCRIPTORS.enrollment.maxRequestBytes;
  const doFetch = opts.fetchImpl ?? fetch;
  const endpoint = new URL(path, opts.baseUrl).toString();
  const pollTimeoutMs = opts.pollTimeoutMs ?? OPERATION_DESCRIPTORS.poll.timeoutMs;
  const leaseAckTimeoutMs = opts.leaseAckTimeoutMs ?? OPERATION_DESCRIPTORS.lease_ack.timeoutMs;
  const leaseRenewTimeoutMs = opts.leaseRenewTimeoutMs ?? OPERATION_DESCRIPTORS.lease_renew.timeoutMs;
  const quarantineGrantTimeoutMs = opts.quarantineGrantTimeoutMs ?? OPERATION_DESCRIPTORS.quarantine_grant.timeoutMs;
  const quarantineFinalizeTimeoutMs =
    opts.quarantineFinalizeTimeoutMs ?? OPERATION_DESCRIPTORS.quarantine_finalize.timeoutMs;
  const eventUploadTimeoutMs = opts.eventUploadTimeoutMs ?? OPERATION_DESCRIPTORS.event_upload.timeoutMs;

  /** POST a dual-authed worker operation (poll / lease_ack / lease_renew /
   * quarantine_*); classify transport failures the same way the enroll path does
   * (timeout vs network). The device-session quarantine ops reuse this exact
   * signed-bytes + proof-header path; only the audience literal + auth binding
   * differ (server-side, E5/DAT). */
  async function postOperation(
    operation: "poll" | "lease_ack" | "lease_renew" | "quarantine_grant" | "quarantine_finalize" | "event_upload",
    targetPath: string,
    perOpTimeoutMs: number,
    maxBytes: number,
    request: WorkerOperationHttpRequest,
  ): Promise<WorkerOperationHttpResponse> {
    if (request.bytes.byteLength > maxBytes) {
      throw new ControlPlaneTransportError(
        "request_too_large",
        `${operation} request exceeds the ${maxBytes}-byte descriptor ceiling`,
      );
    }
    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${request.sessionToken}`,
      ...request.proofHeaders,
    };
    if (request.requestId !== undefined) {
      headers[WORKER_CONTROL_HEADERS.requestId] = request.requestId;
    }
    let response: Response;
    try {
      response = await doFetch(new URL(targetPath, opts.baseUrl).toString(), {
        method: "POST",
        headers,
        body: new Uint8Array(request.bytes),
        signal: AbortSignal.timeout(perOpTimeoutMs),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        throw new ControlPlaneTransportError("timeout", `${operation} request timed out`);
      }
      throw new ControlPlaneTransportError("network", `${operation} request transport failure`);
    }
    const text = await response.text();
    let body: unknown = null;
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    return { status: response.status, body };
  }

  return {
    path,
    pollPath: POLL_PATH,
    quarantineGrantPath: QUARANTINE_GRANT_PATH,
    quarantineFinalizePath: QUARANTINE_FINALIZE_PATH,
    eventUploadPath: EVENT_UPLOAD_PATH,
    leaseAckPath,
    leaseRenewPath,
    poll(request: WorkerOperationHttpRequest): Promise<WorkerOperationHttpResponse> {
      return postOperation("poll", POLL_PATH, pollTimeoutMs, OPERATION_DESCRIPTORS.poll.maxRequestBytes, request);
    },
    leaseAck(leaseId: string, request: WorkerOperationHttpRequest): Promise<WorkerOperationHttpResponse> {
      return postOperation(
        "lease_ack",
        leaseAckPath(leaseId),
        leaseAckTimeoutMs,
        OPERATION_DESCRIPTORS.lease_ack.maxRequestBytes,
        request,
      );
    },
    leaseRenew(leaseId: string, request: WorkerOperationHttpRequest): Promise<WorkerOperationHttpResponse> {
      return postOperation(
        "lease_renew",
        leaseRenewPath(leaseId),
        leaseRenewTimeoutMs,
        OPERATION_DESCRIPTORS.lease_renew.maxRequestBytes,
        request,
      );
    },
    quarantineGrant(request: WorkerOperationHttpRequest): Promise<WorkerOperationHttpResponse> {
      return postOperation(
        "quarantine_grant",
        QUARANTINE_GRANT_PATH,
        quarantineGrantTimeoutMs,
        OPERATION_DESCRIPTORS.quarantine_grant.maxRequestBytes,
        request,
      );
    },
    quarantineFinalize(request: WorkerOperationHttpRequest): Promise<WorkerOperationHttpResponse> {
      return postOperation(
        "quarantine_finalize",
        QUARANTINE_FINALIZE_PATH,
        quarantineFinalizeTimeoutMs,
        OPERATION_DESCRIPTORS.quarantine_finalize.maxRequestBytes,
        request,
      );
    },
    eventUpload(request: WorkerOperationHttpRequest): Promise<WorkerOperationHttpResponse> {
      return postOperation(
        "event_upload",
        EVENT_UPLOAD_PATH,
        eventUploadTimeoutMs,
        OPERATION_DESCRIPTORS.event_upload.maxRequestBytes,
        request,
      );
    },
    async enroll(request: EnrollHttpRequest): Promise<EnrollHttpResponse> {
      if (request.bytes.byteLength > maxRequestBytes) {
        throw new ControlPlaneTransportError(
          "request_too_large",
          `enrollment request exceeds the ${maxRequestBytes}-byte descriptor ceiling`,
        );
      }
      const headers: Record<string, string> = {
        "content-type": "application/json",
        [WORKER_CONTROL_HEADERS.enrollmentCode]: request.enrollmentCode,
        ...request.proofHeaders,
      };
      if (request.requestId !== undefined) {
        headers[WORKER_CONTROL_HEADERS.requestId] = request.requestId;
      }

      let response: Response;
      try {
        response = await doFetch(endpoint, {
          method: "POST",
          headers,
          // A plain Uint8Array view (not a branded Buffer) satisfies `BodyInit`
          // and sends the exact signed bytes byte-for-byte.
          body: new Uint8Array(request.bytes),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        const name = err instanceof Error ? err.name : "";
        if (name === "TimeoutError" || name === "AbortError") {
          throw new ControlPlaneTransportError("timeout", "enrollment request timed out");
        }
        throw new ControlPlaneTransportError("network", "enrollment request transport failure");
      }

      const sessionHeader = response.headers.get(WORKER_CONTROL_HEADERS.session);
      const text = await response.text();
      let body: unknown = null;
      if (text.length > 0) {
        try {
          body = JSON.parse(text);
        } catch {
          body = null;
        }
      }
      return { status: response.status, body, sessionHeader };
    },
  };
}
