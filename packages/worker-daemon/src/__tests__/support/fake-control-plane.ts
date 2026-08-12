/**
 * fake-control-plane.ts — a real in-process `node:http` control-plane double for
 * the WRK-002 enroll/renew/revoke component + session tests.
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
 * It models the JOB-002 as-built enroll route contract, including the behaviours
 * WRK-002 depends on:
 *   - code-route TTL: EVERY enroll (initial consume AND replay) is gated on the
 *     enrollment code route's expiry (`DEFAULT_CODE_TTL_MS` = 10 min, stamped
 *     once at issuance, never extended — mirrors `worker-enrollment.ts:295`). A
 *     replay past that window is 401 `unauthorized`, exactly as the real server
 *     rejects it. This is what makes replay a LOST-RESPONSE RECOVERY mechanism
 *     (live only within the window), NOT sustained session renewal (E4-D11); a
 *     fake that accepted a post-window replay would itself be the defect;
 *   - lost-response recovery: within the window, a re-POST with the same code +
 *     idempotency key + unchanged semantic digest + a FRESH proof replays the
 *     stored identity and mints a NEW session WITHOUT double-consuming; a reused
 *     proof id, a changed digest, an unrelated device key, or a changed
 *     idempotency key are refused;
 *   - revocation collapse: the enroll route surfaces a revoked/replaced
 *     generation as HTTP 401 `unauthorized` (NOT 409 `target_revoked`, which the
 *     server only emits on poll/lease_ack) — see E4-F002 note in WRK-002-result.
 */

import { createHash, createPublicKey, verify as edVerify } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import {
  enrollmentRequestV1Schema,
  enrollmentResponseV1Schema,
  type ProviderConstraintRefV1,
} from "@armyofagents/worker-protocol";

import { WORKER_CONTROL_HEADERS } from "../../transport/headers.js";

const DEVICE_PROOF_PREFIX = "AOA-DEVICE-PROOF-V1";
const PROOF_ORIGIN = "https://aoa.invalid";
const SHA256_HEX = /^[0-9a-f]{64}$/;
const PROOF_ID = /^[A-Za-z0-9_-]{8,128}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export const DEFAULT_ENROLL_PATH = "/api/worker-control/enroll";

/**
 * The enrollment CODE ROUTE TTL, mirroring the real server's `CODE_TTL_MS`
 * (`server/src/services/worker-enrollment.ts` = 10 min). Set once at issuance,
 * never extended, and shorter than the 15-min session (E4-D11). The fake gates
 * EVERY enroll — initial consume AND replay — on this window, exactly like
 * `worker-enrollment.ts:295`.
 */
export const DEFAULT_CODE_TTL_MS = 10 * 60_000;

export interface FakeEnrollmentCodeConfig {
  readonly code: string;
  readonly targetId: string;
  readonly deviceGeneration: number;
  readonly providerConstraints: ProviderConstraintRefV1;
  readonly scope?: string;
  /** Per-code override of the code-route TTL (defaults to the plane's TTL). */
  readonly codeTtlMs?: number;
}

export interface FakeControlPlaneOptions {
  readonly enrollments?: readonly FakeEnrollmentCodeConfig[];
  readonly path?: string;
  readonly now?: () => number;
  /** Default code-route TTL for every code (defaults to DEFAULT_CODE_TTL_MS). */
  readonly codeTtlMs?: number;
}

export interface FakeRequestRecord {
  readonly method: string;
  readonly url: string;
  readonly status: number;
  readonly outcome: string;
  readonly proofId: string | null;
  readonly deviceThumbprint: string | null;
}

export interface FakeControlPlane {
  readonly baseUrl: string;
  readonly enrollPath: string;
  readonly requests: readonly FakeRequestRecord[];
  addCode(config: FakeEnrollmentCodeConfig): void;
  consumeCountFor(code: string): number;
  usedProofIdCount(): number;
  sessionsIssuedFor(code: string): number;
  revoke(code: string): void;
  replaceGeneration(code: string, generation: number): void;
  close(): Promise<void>;
}

interface CodeState {
  config: FakeEnrollmentCodeConfig;
  /** Absolute ms at which the code route expires (issuance + TTL, never extended). */
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

export async function startFakeControlPlane(opts: FakeControlPlaneOptions = {}): Promise<FakeControlPlane> {
  const enrollPath = opts.path ?? DEFAULT_ENROLL_PATH;
  const now = opts.now ?? (() => Date.now());
  const defaultCodeTtlMs = opts.codeTtlMs ?? DEFAULT_CODE_TTL_MS;
  const codes = new Map<string, CodeState>();
  for (const config of opts.enrollments ?? []) {
    codes.set(config.code, freshState(config));
  }
  const usedProofIds = new Set<string>();
  const requests: FakeRequestRecord[] = [];

  function freshState(config: FakeEnrollmentCodeConfig): CodeState {
    // Code-route expiry is stamped once at issuance (now) and never extended.
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
    // Opaque to the worker; unique per issuance.
    return `sess_${sha256Hex(`${state.config.code}:${state.sessionsIssued}:${now()}:${Math.random()}`)}`;
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
    let status = 200;
    let outcome = "enrolled";
    let recordedProofId: string | null = null;
    let recordedThumbprint: string | null = null;

    const finish = (): void => {
      requests.push({ method, url, status, outcome, proofId: recordedProofId, deviceThumbprint: recordedThumbprint });
    };

    if (method !== "POST" || new URL(url, "http://127.0.0.1").pathname !== enrollPath) {
      status = 404;
      outcome = "not_found";
      protocolError(res, 404, "not_found", null);
      finish();
      return;
    }

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

    // Fresh-proof requirement: a reused proof id is refused (mirrors recordProof).
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

    // Code-route TTL gate (mirrors worker-enrollment.ts:295): EVERY enroll —
    // initial consume AND replay — is 401 `unauthorized` once the code route has
    // expired. The window is stamped once at issuance and never extended, so a
    // replay past it (an attempt at sustained renewal) is rejected exactly like
    // the real server would (E4-D11). A fake that accepted it would be the defect.
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
        // As-built enroll route COLLAPSES target_revoked → unauthorized (401).
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
      // Replay: NEW session, NO double-consume.
      const token = issueSession(state);
      status = 200;
      outcome = "replayed";
      sendJson(res, 200, enrolledResponse(state, correlationId, state.workerId ?? request.hello.workerId), {
        [WORKER_CONTROL_HEADERS.session]: token,
      });
      finish();
      return;
    }

    // First consume: bind whichever valid device+code presents, after checking
    // the frozen hello identity fields against the code's target/generation.
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

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    enrollPath,
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
    close(): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
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
