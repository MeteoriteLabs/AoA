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

export interface ControlPlaneClient {
  /** The path the proof must be signed over (equals the request path). */
  readonly path: string;
  enroll(request: EnrollHttpRequest): Promise<EnrollHttpResponse>;
}

export interface ControlPlaneClientOptions {
  readonly baseUrl: string;
  readonly path?: string;
  /** Injectable fetch (tests); defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /** Client timeout; defaults to the enrollment descriptor's 15s. */
  readonly timeoutMs?: number;
}

export function createControlPlaneClient(opts: ControlPlaneClientOptions): ControlPlaneClient {
  const path = opts.path ?? ENROLL_PATH;
  const timeoutMs = opts.timeoutMs ?? OPERATION_DESCRIPTORS.enrollment.timeoutMs;
  const maxRequestBytes = OPERATION_DESCRIPTORS.enrollment.maxRequestBytes;
  const doFetch = opts.fetchImpl ?? fetch;
  const endpoint = new URL(path, opts.baseUrl).toString();

  return {
    path,
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
