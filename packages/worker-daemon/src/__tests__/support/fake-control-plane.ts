/**
 * fake-control-plane.ts — a real in-process `node:http` control-plane double for
 * the WRK-002 enroll/renew/revoke AND the WRK-003 poll/ACK component + session
 * tests.
 *
 * It is boundary-clean by construction (only Node builtins, the frozen
 * `@armyofagents/worker-protocol`, and the worker's own relative modules), so the
 * `check:worker-daemon-boundary` gate — which scans every non-`*.test.ts` source
 * under `src` — passes. It VERIFIES the worker's device proof INDEPENDENTLY: it
 * recomputes the canonical string from scratch (a fourth implementation, mirror
 * of `scripts/check-device-proof-vectors.mjs`) and calls `crypto.verify`, so a
 * broken worker signer fails the component test — the double never accepts a
 * proof unconditionally.
 *
 * Enroll (JOB-002 as-built) models the code-route TTL, lost-response recovery,
 * and the revocation→401 collapse (see WRK-002-result.md).
 *
 * Poll/ACK (JOB-003 as-built, verified against `server/src/routes/worker-control.ts`
 * + `server/src/middleware/worker-operation-proof.ts`) is a DUAL-auth independent
 * verifier that mirrors `verifyWorkerOperationProof`:
 *   - it extracts `authorization: Bearer <sessionToken>`, looks the token up in
 *     its own issued-session table, and rejects an unknown/expired session with
 *     401 `unauthorized` (there is NO session re-issue on poll/ack — E4-D11);
 *   - it INDEPENDENTLY verifies the `aoa-device-*` proof over the EXACT method +
 *     path (`req.url`) + raw body + correlationId, and binds
 *     `proof.deviceThumbprint === session.deviceThumbprint` (a stolen session
 *     without the device key is rejected 401);
 *   - target revocation surfaces as 409 `target_revoked` (a poll/ack-only signal);
 *   - the ACK body `leaseId` MUST equal the `:leaseId` URL param (else malformed);
 *   - a fake that accepted an invalid session/proof, or returned an offer the
 *     worker's capability self-check should reject, would itself be the defect.
 */

import { createHash, createPublicKey, verify as edVerify } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import {
  OPERATION_DESCRIPTORS,
  enrollmentRequestV1Schema,
  enrollmentResponseV1Schema,
  isRetryableProtocolErrorCode,
  leaseAckOperationRequestV1Schema,
  leaseOfferV1Schema,
  leaseRenewOperationRequestV1Schema,
  pollRequestV1Schema,
  quarantineFinalizeOperationRequestV1Schema,
  quarantineGrantOperationRequestV1Schema,
  quarantineUploadGrantV1Schema,
  quarantineUploadReceiptV1Schema,
  type LeaseOfferV1,
  type ProtocolErrorCode,
  type ProviderConstraintRefV1,
} from "@armyofagents/worker-protocol";

import { WORKER_CONTROL_HEADERS } from "../../transport/headers.js";

const DEVICE_PROOF_PREFIX = "AOA-DEVICE-PROOF-V1";
const PROOF_ORIGIN = "https://aoa.invalid";
const SHA256_HEX = /^[0-9a-f]{64}$/;
const PROOF_ID = /^[A-Za-z0-9_-]{8,128}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const DEFAULT_ENROLL_PATH = "/api/worker-control/enroll";
export const POLL_PATH = "/api/worker-control/poll";
const LEASE_ACK_RE = /^\/api\/worker-control\/leases\/([^/]+)\/ack$/;
// WRK-005: the renew action hangs off the same lease base as ack.
const LEASE_RENEW_RE = /^\/api\/worker-control\/leases\/([^/]+)\/renew$/;
// WRK-005: device-session quarantine routes (PROVISIONAL paths; mirror the client).
const QUARANTINE_GRANT_PATH = "/api/worker-control/quarantine/grant";
const QUARANTINE_FINALIZE_PATH = "/api/worker-control/quarantine/finalize";

/** The lease-renew window the fake selects on a `renewed` outcome. */
const DEFAULT_RENEW_WINDOW_MS = 60_000;
/** The quarantine PUT-grant TTL the fake issues (≤5-min ceiling; the schema caps it). */
const QUARANTINE_GRANT_TTL_MS = 5 * 60_000;

/**
 * The enrollment CODE ROUTE TTL, mirroring the real server's `CODE_TTL_MS`
 * (`server/src/services/worker-enrollment.ts` = 10 min). Set once at issuance,
 * never extended, and shorter than the 15-min session (E4-D11).
 */
export const DEFAULT_CODE_TTL_MS = 10 * 60_000;
/** Session TTL, mirroring the real server's `SESSION_TTL_MS` (15 min). */
export const DEFAULT_SESSION_TTL_MS = 15 * 60_000;

export interface FakeEnrollmentCodeConfig {
  readonly code: string;
  readonly targetId: string;
  readonly deviceGeneration: number;
  readonly providerConstraints: ProviderConstraintRefV1;
  readonly scope?: string;
  readonly codeTtlMs?: number;
}

export interface FakeControlPlaneOptions {
  readonly enrollments?: readonly FakeEnrollmentCodeConfig[];
  readonly path?: string;
  readonly now?: () => number;
  readonly codeTtlMs?: number;
  readonly sessionTtlMs?: number;
}

export interface FakeRequestRecord {
  readonly method: string;
  readonly url: string;
  readonly status: number;
  readonly outcome: string;
  readonly proofId: string | null;
  readonly deviceThumbprint: string | null;
}

export interface FakeAckRecord {
  readonly leaseId: string;
  readonly workerId: string;
  readonly fenceToken: string;
  readonly deviceThumbprint: string;
}

/** A programmed poll response (FIFO). When the queue is empty, the plane returns
 * `no_work` with `defaultRetryAfterMs`. */
export type FakePollDirective =
  | { readonly kind: "offer"; readonly offer: unknown }
  | { readonly kind: "no_work"; readonly retryAfterMs?: number }
  | { readonly kind: "drain"; readonly retryAfterMs?: number | null; readonly reason?: string | null }
  | { readonly kind: "error"; readonly status: number; readonly code: ProtocolErrorCode; readonly retryAfterMs?: number | null }
  | { readonly kind: "socket" }
  | { readonly kind: "hang" };

/**
 * A programmed ACK response (FIFO), mirroring `FakePollDirective`. Consumed by
 * `handleAck` AFTER the request is well-formed AND dual-authenticated, so a
 * directive models the SERVER choosing to reject an otherwise-valid ACK (a 401
 * audience/clock desync, a 409 revocation, a transient 429/503, a socket drop, or
 * a 200 `rejected` with a `stale_fence`-class reason). When the queue is empty the
 * plane ACKs normally. */
export type FakeAckDirective =
  | { readonly kind: "acknowledged" }
  | { readonly kind: "rejected"; readonly reason: ProtocolErrorCode }
  | { readonly kind: "error"; readonly status: number; readonly code: ProtocolErrorCode; readonly retryAfterMs?: number | null }
  | { readonly kind: "socket" };

/**
 * A programmed RENEW response (FIFO), consumed AFTER the request is well-formed +
 * dual-authenticated. `renewed` models the server extending the lease (optionally
 * with `cancelRequested`/`cancelReason` to order a cooperative cancel, or an
 * explicit `expiresAt` to inject clock skew); the rest mirror the ack/poll
 * directives. When the queue is empty the plane renews idempotently (a key it has
 * already recorded returns the SAME expiry — no double-extend). */
export type FakeRenewDirective =
  | {
      readonly kind: "renewed";
      readonly expiresAt?: string;
      readonly cancelRequested?: boolean;
      readonly cancelReason?: string | null;
    }
  | { readonly kind: "rejected"; readonly reason: ProtocolErrorCode }
  | { readonly kind: "error"; readonly status: number; readonly code: ProtocolErrorCode; readonly retryAfterMs?: number | null }
  | { readonly kind: "socket" };

/** A programmed quarantine response (FIFO) for both the grant and finalize routes. */
export type FakeQuarantineDirective =
  | { readonly kind: "ok" }
  | { readonly kind: "rejected"; readonly reason: ProtocolErrorCode }
  | { readonly kind: "error"; readonly status: number; readonly code: ProtocolErrorCode; readonly retryAfterMs?: number | null }
  | { readonly kind: "socket" };

export interface FakeRenewRecord {
  readonly leaseId: string;
  readonly idempotencyKey: string;
  readonly expiresAt: string;
  readonly deviceThumbprint: string;
}

export interface FakeQuarantineRecord {
  readonly kind: "grant" | "finalize";
  readonly idempotencyKey: string;
  readonly artifactId: string;
  readonly quarantineObjectKey: string;
  readonly deviceThumbprint: string;
}

export interface FakeControlPlane {
  readonly baseUrl: string;
  readonly enrollPath: string;
  readonly pollPath: string;
  readonly requests: readonly FakeRequestRecord[];
  addCode(config: FakeEnrollmentCodeConfig): void;
  consumeCountFor(code: string): number;
  usedProofIdCount(): number;
  sessionsIssuedFor(code: string): number;
  sessionsIssuedTotal(): number;
  revoke(code: string): void;
  replaceGeneration(code: string, generation: number): void;
  // --- WRK-003 poll/ack controls ---
  enqueuePoll(directive: FakePollDirective): void;
  enqueueAck(directive: FakeAckDirective): void;
  /** Force EVERY poll to respond 401 `unauthorized` (models a session that
   * authenticates on enroll but is persistently rejected on poll/ack — clock
   * skew / audience desync). The poll is still counted as an attempt. */
  forcePollUnauthorized(on: boolean): void;
  pollCount(): number;
  ackCountFor(leaseId: string): number;
  acks(): readonly FakeAckRecord[];
  // --- WRK-005 renew controls ---
  enqueueRenew(directive: FakeRenewDirective): void;
  /** Force EVERY renew to respond 401 `unauthorized` (models a persistent poll/ack
   * rejection that recovery cannot clear — drives the recovery-cap trip). */
  forceRenewUnauthorized(on: boolean): void;
  renewCount(): number;
  renewCountFor(leaseId: string): number;
  renews(): readonly FakeRenewRecord[];
  /** Distinct idempotency keys the plane has seen across all renews (order-preserved). */
  renewKeys(): readonly string[];
  /** The expiry the plane recorded for a renew idempotency key (idempotent replay). */
  renewExpiryForKey(idempotencyKey: string): string | null;
  // --- WRK-005 device-session quarantine controls ---
  enqueueQuarantineGrant(directive: FakeQuarantineDirective): void;
  enqueueQuarantineFinalize(directive: FakeQuarantineDirective): void;
  quarantineGrantCount(): number;
  quarantineFinalizeCount(): number;
  quarantineRecords(): readonly FakeQuarantineRecord[];
  expireSession(token: string): void;
  expireCode(code: string): void;
  revokeTarget(): void;
  lastSessionToken(): string | null;
  close(): Promise<void>;
}

interface CodeState {
  config: FakeEnrollmentCodeConfig;
  codeRouteExpiresAtMs: number;
  consumed: boolean;
  consumeCount: number;
  sessionsIssued: number;
  revoked: boolean;
  idempotencyKey: string | null;
  semanticDigest: string | null;
  deviceThumbprint: string | null;
  workerId: string | null;
}

interface SessionRecord {
  token: string;
  deviceThumbprint: string;
  targetId: string;
  deviceGeneration: number;
  workerId: string;
  expiresAtMs: number;
}

interface DeviceProofHeaders {
  version: string;
  publicKey: string;
  signature: string;
  issuedAt: string;
  proofId: string;
}

class FakeProofError extends Error {}

/** Independent AOA-DEVICE-PROOF-V1 canonicalization — re-derived, not imported. */
function referenceCanonical(input: {
  method: string;
  path: string;
  bodyDigest: string;
  correlationId: string;
  issuedAt: string;
  proofId: string;
}): string {
  if (!SHA256_HEX.test(input.bodyDigest)) throw new FakeProofError("bad body digest");
  if (!PROOF_ID.test(input.proofId)) throw new FakeProofError("bad proof id");
  if (input.correlationId.length === 0 || input.correlationId.includes("\n") || input.issuedAt.includes("\n")) {
    throw new FakeProofError("bad correlation/issuedAt");
  }
  const parsed = new URL(input.path, PROOF_ORIGIN);
  if (parsed.origin !== PROOF_ORIGIN) throw new FakeProofError("foreign origin");
  return [
    DEVICE_PROOF_PREFIX,
    input.method.toUpperCase(),
    parsed.pathname,
    input.bodyDigest,
    input.correlationId,
    input.issuedAt,
    input.proofId,
  ].join("\n");
}

function header(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

function readProofHeaders(req: IncomingMessage): DeviceProofHeaders | null {
  const version = header(req, WORKER_CONTROL_HEADERS.proofVersion);
  const publicKey = header(req, WORKER_CONTROL_HEADERS.publicKey);
  const signature = header(req, WORKER_CONTROL_HEADERS.signature);
  const issuedAt = header(req, WORKER_CONTROL_HEADERS.issuedAt);
  const proofId = header(req, WORKER_CONTROL_HEADERS.proofId);
  if (!version || !publicKey || !signature || !issuedAt || !proofId) return null;
  return { version, publicKey, signature, issuedAt, proofId };
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sha256Hex(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Independently verify the device proof against the EXACT request bytes/path/
 * method. Returns the device thumbprint on success, or `null` — a broken signer,
 * a tampered body/path/method, or a foreign key all resolve to `null`.
 */
function verifyDeviceProof(
  method: string,
  urlPath: string,
  rawBody: Buffer,
  correlationId: string,
  proof: DeviceProofHeaders,
): string | null {
  if (proof.version !== "1") return null;
  if (!BASE64URL.test(proof.publicKey) || !BASE64URL.test(proof.signature) || !PROOF_ID.test(proof.proofId)) {
    return null;
  }
  const issued = new Date(proof.issuedAt);
  if (!Number.isFinite(issued.getTime()) || issued.toISOString() !== proof.issuedAt) return null;
  let canonical: string;
  try {
    canonical = referenceCanonical({
      method,
      path: urlPath,
      bodyDigest: sha256Hex(rawBody),
      correlationId,
      issuedAt: proof.issuedAt,
      proofId: proof.proofId,
    });
  } catch {
    return null;
  }
  let publicKey;
  try {
    const der = Buffer.from(proof.publicKey, "base64url");
    publicKey = createPublicKey({ key: der, format: "der", type: "spki" });
    if (publicKey.asymmetricKeyType !== "ed25519") return null;
    const signature = Buffer.from(proof.signature, "base64url");
    if (!edVerify(null, Buffer.from(canonical, "utf8"), publicKey, signature)) return null;
    return sha256Hex(der);
  } catch {
    return null;
  }
}

function bearer(req: IncomingMessage): string | null {
  const authorization = header(req, "authorization");
  if (!authorization) return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization.trim());
  return match ? match[1]! : null;
}

export async function startFakeControlPlane(opts: FakeControlPlaneOptions = {}): Promise<FakeControlPlane> {
  const enrollPath = opts.path ?? DEFAULT_ENROLL_PATH;
  const now = opts.now ?? (() => Date.now());
  const defaultCodeTtlMs = opts.codeTtlMs ?? DEFAULT_CODE_TTL_MS;
  const sessionTtlMs = opts.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  const codes = new Map<string, CodeState>();
  for (const config of opts.enrollments ?? []) {
    codes.set(config.code, freshState(config));
  }
  const usedProofIds = new Set<string>();
  const requests: FakeRequestRecord[] = [];
  const sessions = new Map<string, SessionRecord>();
  const pollDirectives: FakePollDirective[] = [];
  const ackDirectives: FakeAckDirective[] = [];
  const ackRecords: FakeAckRecord[] = [];
  const renewDirectives: FakeRenewDirective[] = [];
  const renewRecords: FakeRenewRecord[] = [];
  // Idempotency ledger: an already-seen renew key returns the SAME expiry.
  const renewExpiryByKey = new Map<string, string>();
  const quarantineGrantDirectives: FakeQuarantineDirective[] = [];
  const quarantineFinalizeDirectives: FakeQuarantineDirective[] = [];
  const quarantineRecordList: FakeQuarantineRecord[] = [];
  const hanging = new Set<ServerResponse>();
  let pollRequestCount = 0;
  let renewRequestCount = 0;
  let quarantineGrantRequestCount = 0;
  let quarantineFinalizeRequestCount = 0;
  let totalSessionsIssued = 0;
  let lastSession: string | null = null;
  let targetRevoked = false;
  let pollUnauthorizedForced = false;
  let renewUnauthorizedForced = false;

  function freshState(config: FakeEnrollmentCodeConfig): CodeState {
    return {
      config,
      codeRouteExpiresAtMs: now() + (config.codeTtlMs ?? defaultCodeTtlMs),
      consumed: false,
      consumeCount: 0,
      sessionsIssued: 0,
      revoked: false,
      idempotencyKey: null,
      semanticDigest: null,
      deviceThumbprint: null,
      workerId: null,
    };
  }

  function issueSession(state: CodeState): string {
    state.sessionsIssued += 1;
    totalSessionsIssued += 1;
    const token = `sess_${sha256Hex(`${state.config.code}:${state.sessionsIssued}:${now()}:${Math.random()}`)}`;
    sessions.set(token, {
      token,
      deviceThumbprint: state.deviceThumbprint ?? "",
      targetId: state.config.targetId,
      deviceGeneration: state.config.deviceGeneration,
      workerId: state.workerId ?? "",
      expiresAtMs: now() + sessionTtlMs,
    });
    lastSession = token;
    return token;
  }

  function sendJson(
    res: ServerResponse,
    status: number,
    body: unknown,
    extraHeaders: Record<string, string> = {},
  ): void {
    res.writeHead(status, { "content-type": "application/json", ...extraHeaders });
    res.end(JSON.stringify(body));
  }

  function protocolError(res: ServerResponse, status: number, code: string, correlationId: string | null): void {
    sendJson(res, status, {
      protocolVersion: 1,
      code,
      correlationId,
      serverTime: new Date(now()).toISOString(),
    });
  }

  /** The exact operation error envelope shape the real server emits (mirrors
   * `workerOperationProtocolErrorV1`) so the worker can parse `code`+`retryAfterMs`. */
  function operationError(
    res: ServerResponse,
    status: number,
    code: ProtocolErrorCode,
    correlationId: string | null,
    retryAfterMs?: number | null,
  ): void {
    const retry = retryAfterMs !== undefined && retryAfterMs !== null
      ? retryAfterMs
      : isRetryableProtocolErrorCode(code)
        ? 1_000
        : null;
    sendJson(res, status, {
      protocolVersion: 1,
      code,
      correlationId,
      message: "Worker control request denied",
      retryAfterMs: retry,
      serverTime: new Date(now()).toISOString(),
      redaction: "secret",
      detail: {},
    });
  }

  function enrolledResponse(state: CodeState, correlationId: string, workerId: string): unknown {
    return enrollmentResponseV1Schema.parse({
      protocolVersion: 1,
      correlationId,
      serverTime: new Date(now()).toISOString(),
      outcome: "enrolled",
      workerId,
      targetId: state.config.targetId,
      deviceGeneration: state.config.deviceGeneration,
      providerConstraints: state.config.providerConstraints,
    });
  }

  const server: Server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) protocolError(res, 503, "internal_unavailable", null);
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? "";
    const method = req.method ?? "GET";
    const pathname = new URL(url, "http://127.0.0.1").pathname;

    if (method === "POST" && pathname === enrollPath) {
      await handleEnroll(req, res, url, method);
      return;
    }
    if (method === "POST" && pathname === POLL_PATH) {
      await handlePoll(req, res, url, method);
      return;
    }
    const ackMatch = LEASE_ACK_RE.exec(pathname);
    if (method === "POST" && ackMatch) {
      await handleAck(req, res, url, method, ackMatch[1]!);
      return;
    }
    const renewMatch = LEASE_RENEW_RE.exec(pathname);
    if (method === "POST" && renewMatch) {
      await handleRenew(req, res, url, method, renewMatch[1]!);
      return;
    }
    if (method === "POST" && pathname === QUARANTINE_GRANT_PATH) {
      await handleQuarantine(req, res, url, method, "grant");
      return;
    }
    if (method === "POST" && pathname === QUARANTINE_FINALIZE_PATH) {
      await handleQuarantine(req, res, url, method, "finalize");
      return;
    }
    record(method, url, 404, "not_found", null, null);
    protocolError(res, 404, "not_found", null);
  }

  function record(
    method: string,
    url: string,
    status: number,
    outcome: string,
    proofId: string | null,
    deviceThumbprint: string | null,
  ): void {
    requests.push({ method, url, status, outcome, proofId, deviceThumbprint });
  }

  async function handleEnroll(req: IncomingMessage, res: ServerResponse, url: string, method: string): Promise<void> {
    let status = 200;
    let outcome = "enrolled";
    let recordedProofId: string | null = null;
    let recordedThumbprint: string | null = null;
    const finish = (): void => record(method, url, status, outcome, recordedProofId, recordedThumbprint);

    const rawBody = await readBody(req);
    const code = header(req, WORKER_CONTROL_HEADERS.enrollmentCode);
    const proof = readProofHeaders(req);

    const parsed = enrollmentRequestV1Schema.safeParse(safeJson(rawBody));
    if (!parsed.success) {
      status = 400;
      outcome = "malformed";
      protocolError(res, 400, "malformed", null);
      finish();
      return;
    }
    const request = parsed.data;
    const correlationId = request.correlationId;

    if (!code || !proof) {
      status = 401;
      outcome = "unauthorized";
      protocolError(res, 401, "unauthorized", correlationId);
      finish();
      return;
    }
    recordedProofId = proof.proofId;

    const thumbprint = verifyDeviceProof(method, url, rawBody, correlationId, proof);
    if (thumbprint === null) {
      status = 401;
      outcome = "unauthorized";
      protocolError(res, 401, "unauthorized", correlationId);
      finish();
      return;
    }
    recordedThumbprint = thumbprint;

    if (usedProofIds.has(proof.proofId)) {
      status = 401;
      outcome = "unauthorized";
      protocolError(res, 401, "unauthorized", correlationId);
      finish();
      return;
    }
    usedProofIds.add(proof.proofId);

    const state = codes.get(code);
    if (!state) {
      status = 401;
      outcome = "unauthorized";
      protocolError(res, 401, "unauthorized", correlationId);
      finish();
      return;
    }

    if (now() >= state.codeRouteExpiresAtMs) {
      status = 401;
      outcome = "code_route_expired";
      protocolError(res, 401, "unauthorized", correlationId);
      finish();
      return;
    }

    const semanticDigest = sha256Hex(
      JSON.stringify({
        idempotencyKey: request.idempotencyKey,
        hello: request.hello,
        deviceThumbprint: thumbprint,
        targetId: state.config.targetId,
        scope: state.config.scope ?? "organization",
      }),
    );

    if (state.consumed) {
      if (state.revoked) {
        status = 401;
        outcome = "revoked_unauthorized";
        protocolError(res, 401, "unauthorized", correlationId);
        finish();
        return;
      }
      if (state.idempotencyKey !== request.idempotencyKey) {
        status = 400;
        outcome = "malformed";
        protocolError(res, 400, "malformed", correlationId);
        finish();
        return;
      }
      if (state.deviceThumbprint !== thumbprint) {
        status = 401;
        outcome = "unauthorized";
        protocolError(res, 401, "unauthorized", correlationId);
        finish();
        return;
      }
      if (state.semanticDigest !== semanticDigest) {
        status = 400;
        outcome = "malformed";
        protocolError(res, 400, "malformed", correlationId);
        finish();
        return;
      }
      const token = issueSession(state);
      status = 200;
      outcome = "replayed";
      sendJson(res, 200, enrolledResponse(state, correlationId, state.workerId ?? request.hello.workerId), {
        [WORKER_CONTROL_HEADERS.session]: token,
      });
      finish();
      return;
    }

    if (request.hello.targetId !== state.config.targetId || request.hello.deviceGeneration !== state.config.deviceGeneration) {
      status = 401;
      outcome = "unauthorized";
      protocolError(res, 401, "unauthorized", correlationId);
      finish();
      return;
    }
    state.consumed = true;
    state.consumeCount += 1;
    state.idempotencyKey = request.idempotencyKey;
    state.semanticDigest = semanticDigest;
    state.deviceThumbprint = thumbprint;
    state.workerId = request.hello.workerId;

    const token = issueSession(state);
    status = 200;
    outcome = "enrolled";
    sendJson(res, 200, enrolledResponse(state, correlationId, request.hello.workerId), {
      [WORKER_CONTROL_HEADERS.session]: token,
    });
    finish();
  }

  /**
   * Dual-auth verifier shared by poll + ack: Bearer session lookup (+ expiry),
   * independent device-proof verification, and the thumbprint binding. Returns
   * the bound session or a `{ status, code }` rejection.
   */
  function authenticateOperation(
    req: IncomingMessage,
    method: string,
    url: string,
    rawBody: Buffer,
    correlationId: string,
    proof: DeviceProofHeaders | null,
  ): { ok: true; session: SessionRecord; thumbprint: string } | { ok: false; status: number; code: ProtocolErrorCode; thumbprint: string | null } {
    const token = bearer(req);
    if (!token || !proof) return { ok: false, status: 401, code: "unauthorized", thumbprint: null };
    const session = sessions.get(token);
    if (!session || now() >= session.expiresAtMs) return { ok: false, status: 401, code: "unauthorized", thumbprint: null };
    const thumbprint = verifyDeviceProof(method, url, rawBody, correlationId, proof);
    if (thumbprint === null) return { ok: false, status: 401, code: "unauthorized", thumbprint: null };
    if (thumbprint !== session.deviceThumbprint) return { ok: false, status: 401, code: "unauthorized", thumbprint };
    return { ok: true, session, thumbprint };
  }

  async function handlePoll(req: IncomingMessage, res: ServerResponse, url: string, method: string): Promise<void> {
    let status = 200;
    let outcome = "poll";
    let recordedProofId: string | null = null;
    let recordedThumbprint: string | null = null;
    const finish = (): void => record(method, url, status, outcome, recordedProofId, recordedThumbprint);

    const rawBody = await readBody(req);
    const proof = readProofHeaders(req);
    recordedProofId = proof?.proofId ?? null;
    const parsed = pollRequestV1Schema.safeParse(safeJson(rawBody));
    if (!parsed.success || rawBody.byteLength > OPERATION_DESCRIPTORS.poll.maxRequestBytes) {
      status = 400;
      outcome = "malformed";
      operationError(res, 400, "malformed", null);
      finish();
      return;
    }
    // Every well-formed poll REQUEST counts as an attempt — including one that is
    // then rejected 401 for an expired session (the worker's "no busy-spin"
    // invariant is observed by counting attempts, not just accepted polls).
    pollRequestCount += 1;
    const correlationId = parsed.data.correlationId;
    // Forced-401 models a persistent poll/ack rejection (clock skew / audience
    // desync) even though the session authenticated on enroll. The attempt was
    // already counted above so a "no busy-spin" assertion sees the real poll count.
    if (pollUnauthorizedForced) {
      status = 401;
      outcome = "unauthorized";
      operationError(res, 401, "unauthorized", correlationId);
      finish();
      return;
    }
    const auth = authenticateOperation(req, method, url, rawBody, correlationId, proof);
    if (!auth.ok) {
      recordedThumbprint = auth.thumbprint;
      status = auth.status;
      outcome = "unauthorized";
      operationError(res, auth.status, auth.code, correlationId);
      finish();
      return;
    }
    recordedThumbprint = auth.thumbprint;

    if (targetRevoked) {
      status = 409;
      outcome = "target_revoked";
      operationError(res, 409, "target_revoked", correlationId);
      finish();
      return;
    }

    const directive: FakePollDirective = pollDirectives.shift() ?? { kind: "no_work", retryAfterMs: 1_000 };

    if (directive.kind === "socket") {
      outcome = "socket";
      status = 0;
      finish();
      req.socket.destroy();
      return;
    }
    if (directive.kind === "hang") {
      outcome = "hang";
      status = 0;
      finish();
      hanging.add(res);
      return;
    }
    if (directive.kind === "error") {
      status = directive.status;
      outcome = directive.code;
      operationError(res, directive.status, directive.code, correlationId, directive.retryAfterMs ?? null);
      finish();
      return;
    }
    if (directive.kind === "no_work") {
      status = 200;
      outcome = "no_work";
      sendJson(res, 200, {
        protocolVersion: 1,
        correlationId,
        serverTime: new Date(now()).toISOString(),
        outcome: "no_work",
        retryAfterMs: directive.retryAfterMs ?? 1_000,
      });
      finish();
      return;
    }
    if (directive.kind === "drain") {
      status = 200;
      outcome = "drain";
      sendJson(res, 200, {
        protocolVersion: 1,
        correlationId,
        serverTime: new Date(now()).toISOString(),
        outcome: "drain",
        retryAfterMs: directive.retryAfterMs ?? null,
        reason: directive.reason ?? null,
      });
      finish();
      return;
    }
    // offer — validate the programmed offer through the frozen schema so a
    // malformed test fixture fails here, not silently on the worker.
    const offer = leaseOfferV1Schema.parse(directive.offer);
    status = 200;
    outcome = "offer";
    sendJson(res, 200, {
      protocolVersion: 1,
      correlationId,
      serverTime: new Date(now()).toISOString(),
      outcome: "offer",
      body: offer,
    });
    finish();
  }

  async function handleAck(
    req: IncomingMessage,
    res: ServerResponse,
    url: string,
    method: string,
    leaseIdParam: string,
  ): Promise<void> {
    let status = 200;
    let outcome = "acknowledged";
    let recordedProofId: string | null = null;
    let recordedThumbprint: string | null = null;
    const finish = (): void => record(method, url, status, outcome, recordedProofId, recordedThumbprint);

    const rawBody = await readBody(req);
    const proof = readProofHeaders(req);
    recordedProofId = proof?.proofId ?? null;
    const parsed = leaseAckOperationRequestV1Schema.safeParse(safeJson(rawBody));
    if (
      !parsed.success ||
      !UUID.test(leaseIdParam) ||
      parsed.data.body.leaseId !== leaseIdParam ||
      rawBody.byteLength > OPERATION_DESCRIPTORS.lease_ack.maxRequestBytes
    ) {
      status = 400;
      outcome = "malformed";
      operationError(res, 400, "malformed", null);
      finish();
      return;
    }
    const correlationId = parsed.data.correlationId;
    const auth = authenticateOperation(req, method, url, rawBody, correlationId, proof);
    if (!auth.ok) {
      recordedThumbprint = auth.thumbprint;
      status = auth.status;
      outcome = "unauthorized";
      operationError(res, auth.status, auth.code, correlationId);
      finish();
      return;
    }
    recordedThumbprint = auth.thumbprint;

    if (targetRevoked) {
      status = 409;
      outcome = "target_revoked";
      operationError(res, 409, "target_revoked", correlationId);
      finish();
      return;
    }

    // A programmed ACK directive overrides the default acknowledge — the request is
    // well-formed AND authenticated, so this models the SERVER rejecting an
    // otherwise-valid ACK. `acknowledged` (or an empty queue) falls through.
    const ackDirective = ackDirectives.shift();
    if (ackDirective && ackDirective.kind !== "acknowledged") {
      if (ackDirective.kind === "socket") {
        outcome = "socket";
        status = 0;
        finish();
        req.socket.destroy();
        return;
      }
      if (ackDirective.kind === "error") {
        status = ackDirective.status;
        outcome = ackDirective.code;
        operationError(res, ackDirective.status, ackDirective.code, correlationId, ackDirective.retryAfterMs ?? null);
        finish();
        return;
      }
      // rejected — a 200 with a non-acknowledged outcome + a protocol-error reason.
      status = 200;
      outcome = "rejected";
      sendJson(res, 200, {
        protocolVersion: 1,
        correlationId,
        serverTime: new Date(now()).toISOString(),
        outcome: "rejected",
        reason: ackDirective.reason,
      });
      finish();
      return;
    }

    const body = parsed.data.body;
    ackRecords.push({
      leaseId: body.leaseId,
      workerId: body.workerId,
      fenceToken: body.fenceToken,
      deviceThumbprint: auth.thumbprint,
    });
    status = 200;
    outcome = "acknowledged";
    sendJson(res, 200, {
      protocolVersion: 1,
      correlationId,
      serverTime: new Date(now()).toISOString(),
      outcome: "acknowledged",
      leaseId: body.leaseId,
      expiresAt: new Date(now() + 60_000).toISOString(),
    });
    finish();
  }

  /**
   * WRK-005 renew: dual-auth (Bearer session + device proof over `…/renew`),
   * body `leaseId` must equal the URL param, then FIFO directive or an idempotent
   * default extension. A key already recorded returns the SAME expiry so a replayed
   * renewal never double-extends. */
  async function handleRenew(
    req: IncomingMessage,
    res: ServerResponse,
    url: string,
    method: string,
    leaseIdParam: string,
  ): Promise<void> {
    let status = 200;
    let outcome = "renewed";
    let recordedProofId: string | null = null;
    let recordedThumbprint: string | null = null;
    const finish = (): void => record(method, url, status, outcome, recordedProofId, recordedThumbprint);

    const rawBody = await readBody(req);
    const proof = readProofHeaders(req);
    recordedProofId = proof?.proofId ?? null;
    const parsed = leaseRenewOperationRequestV1Schema.safeParse(safeJson(rawBody));
    if (
      !parsed.success ||
      !UUID.test(leaseIdParam) ||
      parsed.data.body.leaseId !== leaseIdParam ||
      rawBody.byteLength > OPERATION_DESCRIPTORS.lease_renew.maxRequestBytes
    ) {
      status = 400;
      outcome = "malformed";
      operationError(res, 400, "malformed", null);
      finish();
      return;
    }
    const correlationId = parsed.data.correlationId;
    // Every well-formed renew REQUEST counts as an attempt (so a "no busy-spin"
    // assertion sees the real renew count, exactly like poll).
    renewRequestCount += 1;
    if (renewUnauthorizedForced) {
      status = 401;
      outcome = "unauthorized";
      operationError(res, 401, "unauthorized", correlationId);
      finish();
      return;
    }
    const auth = authenticateOperation(req, method, url, rawBody, correlationId, proof);
    if (!auth.ok) {
      recordedThumbprint = auth.thumbprint;
      status = auth.status;
      outcome = "unauthorized";
      operationError(res, auth.status, auth.code, correlationId);
      finish();
      return;
    }
    recordedThumbprint = auth.thumbprint;

    if (targetRevoked) {
      status = 409;
      outcome = "target_revoked";
      operationError(res, 409, "target_revoked", correlationId);
      finish();
      return;
    }

    const body = parsed.data.body;
    const idempotencyKey = parsed.data.idempotencyKey;
    const directive = renewDirectives.shift();

    if (directive && directive.kind === "socket") {
      outcome = "socket";
      status = 0;
      finish();
      req.socket.destroy();
      return;
    }
    if (directive && directive.kind === "error") {
      status = directive.status;
      outcome = directive.code;
      operationError(res, directive.status, directive.code, correlationId, directive.retryAfterMs ?? null);
      finish();
      return;
    }
    if (directive && directive.kind === "rejected") {
      status = 200;
      outcome = "rejected";
      sendJson(res, 200, {
        protocolVersion: 1,
        correlationId,
        serverTime: new Date(now()).toISOString(),
        outcome: "rejected",
        reason: directive.reason,
      });
      finish();
      return;
    }

    // renewed (directive override) or the idempotent default. A previously-seen
    // idempotency key returns the recorded expiry — no double-extend.
    let expiresAt: string;
    const recorded = renewExpiryByKey.get(idempotencyKey);
    if (recorded !== undefined) {
      expiresAt = recorded;
    } else {
      expiresAt =
        directive && directive.kind === "renewed" && directive.expiresAt !== undefined
          ? directive.expiresAt
          : new Date(now() + DEFAULT_RENEW_WINDOW_MS).toISOString();
      renewExpiryByKey.set(idempotencyKey, expiresAt);
    }
    const cancelRequested = directive && directive.kind === "renewed" ? directive.cancelRequested ?? false : false;
    const cancelReason =
      directive && directive.kind === "renewed" ? directive.cancelReason ?? null : null;

    renewRecords.push({ leaseId: body.leaseId, idempotencyKey, expiresAt, deviceThumbprint: auth.thumbprint });
    status = 200;
    outcome = "renewed";
    sendJson(res, 200, {
      protocolVersion: 1,
      correlationId,
      serverTime: new Date(now()).toISOString(),
      outcome: "renewed",
      body: {
        protocolVersion: 1,
        workerId: body.workerId,
        jobId: body.jobId,
        attempt: body.attempt,
        leaseId: body.leaseId,
        fenceToken: body.fenceToken,
        expiresAt,
        cancelRequested,
        cancelReason,
      },
    });
    finish();
  }

  /**
   * WRK-005 device-session quarantine (grant + finalize). Authenticated by the
   * SAME dual-auth binding the worker_run ops use (the PROVISIONAL device-session
   * binding pending E5/DAT). It validates the frozen payload, enforces the distinct
   * `quarantine/` prefix + ≤5-min grant via the frozen response schemas, and NEVER
   * carries a promote/apply disposition (the CAV-004 non-promotion invariant). */
  async function handleQuarantine(
    req: IncomingMessage,
    res: ServerResponse,
    url: string,
    method: string,
    kind: "grant" | "finalize",
  ): Promise<void> {
    let status = 200;
    let outcome = kind === "grant" ? "quarantine_upload_granted" : "quarantined";
    let recordedProofId: string | null = null;
    let recordedThumbprint: string | null = null;
    const finish = (): void => record(method, url, status, outcome, recordedProofId, recordedThumbprint);

    const rawBody = await readBody(req);
    const proof = readProofHeaders(req);
    recordedProofId = proof?.proofId ?? null;
    const schema = kind === "grant" ? quarantineGrantOperationRequestV1Schema : quarantineFinalizeOperationRequestV1Schema;
    const maxBytes = kind === "grant" ? OPERATION_DESCRIPTORS.quarantine_grant.maxRequestBytes : OPERATION_DESCRIPTORS.quarantine_finalize.maxRequestBytes;
    const parsed = schema.safeParse(safeJson(rawBody));
    if (!parsed.success || rawBody.byteLength > maxBytes) {
      status = 400;
      outcome = "malformed";
      operationError(res, 400, "malformed", null);
      finish();
      return;
    }
    const correlationId = parsed.data.correlationId;
    if (kind === "grant") quarantineGrantRequestCount += 1;
    else quarantineFinalizeRequestCount += 1;

    const auth = authenticateOperation(req, method, url, rawBody, correlationId, proof);
    if (!auth.ok) {
      recordedThumbprint = auth.thumbprint;
      status = auth.status;
      outcome = "unauthorized";
      operationError(res, auth.status, auth.code, correlationId);
      finish();
      return;
    }
    recordedThumbprint = auth.thumbprint;

    const directives = kind === "grant" ? quarantineGrantDirectives : quarantineFinalizeDirectives;
    const directive = directives.shift();
    if (directive && directive.kind === "socket") {
      outcome = "socket";
      status = 0;
      finish();
      req.socket.destroy();
      return;
    }
    if (directive && directive.kind === "error") {
      status = directive.status;
      outcome = directive.code;
      operationError(res, directive.status, directive.code, correlationId, directive.retryAfterMs ?? null);
      finish();
      return;
    }
    if (directive && directive.kind === "rejected") {
      status = 200;
      outcome = "rejected";
      sendJson(res, 200, {
        protocolVersion: 1,
        correlationId,
        serverTime: new Date(now()).toISOString(),
        outcome: "rejected",
        reason: directive.reason,
      });
      finish();
      return;
    }

    if (kind === "grant") {
      const g = parsed.data.body;
      const issuedAt = new Date(now()).toISOString();
      const grant = quarantineUploadGrantV1Schema.parse({
        protocolVersion: 1,
        operation: "quarantine_upload",
        artifactId: g.artifactId,
        method: "PUT",
        url: "https://quarantine.aoa.invalid/put",
        headers: {},
        issuedAt,
        expiresAt: new Date(now() + QUARANTINE_GRANT_TTL_MS).toISOString(),
        maxBytes: g.sizeBytes,
        expectedSha256: g.expectedSha256,
        quarantineObjectKey: g.expectedObjectKey,
        redaction: "secret",
      });
      quarantineRecordList.push({
        kind: "grant",
        idempotencyKey: parsed.data.idempotencyKey,
        artifactId: String(g.artifactId),
        quarantineObjectKey: g.expectedObjectKey,
        deviceThumbprint: auth.thumbprint,
      });
      status = 200;
      outcome = "quarantine_upload_granted";
      sendJson(res, 200, {
        protocolVersion: 1,
        correlationId,
        serverTime: new Date(now()).toISOString(),
        outcome: "quarantine_upload_granted",
        grant,
      });
      finish();
      return;
    }

    // finalize
    const f = parsed.data.body;
    const receipt = quarantineUploadReceiptV1Schema.parse({
      protocolVersion: 1,
      receiptId: "00000000-0000-4000-8000-00000000f001",
      quarantineObjectKey: f.quarantineObjectKey,
      observed: {
        workerId: f.workerId,
        targetId: f.targetId,
        deviceGeneration: f.deviceGeneration,
        jobId: f.jobId,
        attempt: f.attempt,
        leaseId: f.observedLeaseId,
        fenceToken: f.observedFenceToken,
      },
      artifact: {
        artifactId: f.artifactId,
        sha256: f.expectedSha256,
        sizeBytes: f.sizeBytes,
        sensitivity: f.manifest.sensitivity,
        provenance: "generated",
      },
      reason: f.reason,
      receivedAt: new Date(now()).toISOString(),
      disposition: "quarantined",
    });
    quarantineRecordList.push({
      kind: "finalize",
      idempotencyKey: parsed.data.idempotencyKey,
      artifactId: String(f.artifactId),
      quarantineObjectKey: f.quarantineObjectKey,
      deviceThumbprint: auth.thumbprint,
    });
    status = 200;
    outcome = "quarantined";
    sendJson(res, 200, {
      protocolVersion: 1,
      correlationId,
      serverTime: new Date(now()).toISOString(),
      outcome: "quarantined",
      receipt,
    });
    finish();
  }

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    enrollPath,
    pollPath: POLL_PATH,
    requests,
    addCode(config: FakeEnrollmentCodeConfig): void {
      codes.set(config.code, freshState(config));
    },
    consumeCountFor(code: string): number {
      return codes.get(code)?.consumeCount ?? 0;
    },
    usedProofIdCount(): number {
      return usedProofIds.size;
    },
    sessionsIssuedFor(code: string): number {
      return codes.get(code)?.sessionsIssued ?? 0;
    },
    sessionsIssuedTotal(): number {
      return totalSessionsIssued;
    },
    revoke(code: string): void {
      const state = codes.get(code);
      if (state) state.revoked = true;
    },
    replaceGeneration(code: string, generation: number): void {
      const state = codes.get(code);
      if (state) {
        state.revoked = true;
        state.config = { ...state.config, deviceGeneration: generation };
      }
    },
    enqueuePoll(directive: FakePollDirective): void {
      pollDirectives.push(directive);
    },
    enqueueAck(directive: FakeAckDirective): void {
      ackDirectives.push(directive);
    },
    forcePollUnauthorized(on: boolean): void {
      pollUnauthorizedForced = on;
    },
    pollCount(): number {
      return pollRequestCount;
    },
    ackCountFor(leaseId: string): number {
      return ackRecords.filter((a) => a.leaseId === leaseId).length;
    },
    acks(): readonly FakeAckRecord[] {
      return ackRecords;
    },
    enqueueRenew(directive: FakeRenewDirective): void {
      renewDirectives.push(directive);
    },
    forceRenewUnauthorized(on: boolean): void {
      renewUnauthorizedForced = on;
    },
    renewCount(): number {
      return renewRequestCount;
    },
    renewCountFor(leaseId: string): number {
      return renewRecords.filter((r) => r.leaseId === leaseId).length;
    },
    renews(): readonly FakeRenewRecord[] {
      return renewRecords;
    },
    renewKeys(): readonly string[] {
      const seen: string[] = [];
      for (const r of renewRecords) if (!seen.includes(r.idempotencyKey)) seen.push(r.idempotencyKey);
      return seen;
    },
    renewExpiryForKey(idempotencyKey: string): string | null {
      return renewExpiryByKey.get(idempotencyKey) ?? null;
    },
    enqueueQuarantineGrant(directive: FakeQuarantineDirective): void {
      quarantineGrantDirectives.push(directive);
    },
    enqueueQuarantineFinalize(directive: FakeQuarantineDirective): void {
      quarantineFinalizeDirectives.push(directive);
    },
    quarantineGrantCount(): number {
      return quarantineGrantRequestCount;
    },
    quarantineFinalizeCount(): number {
      return quarantineFinalizeRequestCount;
    },
    quarantineRecords(): readonly FakeQuarantineRecord[] {
      return quarantineRecordList;
    },
    expireSession(token: string): void {
      const session = sessions.get(token);
      if (session) session.expiresAtMs = 0;
    },
    expireCode(code: string): void {
      const state = codes.get(code);
      if (state) state.codeRouteExpiresAtMs = 0;
    },
    revokeTarget(): void {
      targetRevoked = true;
    },
    lastSessionToken(): string | null {
      return lastSession;
    },
    close(): Promise<void> {
      for (const res of hanging) {
        try {
          res.socket?.destroy();
        } catch {
          // best-effort teardown of a hung response
        }
      }
      hanging.clear();
      return new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        // Force idle keep-alive + any half-open sockets shut so `server.close`
        // resolves promptly instead of waiting out the client keep-alive window.
        server.closeAllConnections?.();
      });
    },
  };
}

function safeJson(bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    return null;
  }
}
