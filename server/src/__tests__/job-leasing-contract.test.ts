import { describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  OPERATION_DESCRIPTORS,
  pollRequestV1Schema,
  protocolErrorV1Schema,
} from "@armyofagents/worker-protocol";
import { createWorkerSessionToken } from "../middleware/worker-session-auth.js";
import {
  verifyWorkerOperationProof,
  WorkerOperationProofError,
} from "../middleware/worker-operation-proof.js";
import { buildDeviceProofCanonicalInput } from "../services/worker-device-proof.js";
import { workerOperationProtocolErrorV1 } from "../services/worker-protocol-http.js";

function signedPoll() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyBytes = publicKey.export({ format: "der", type: "spki" });
  const publicKeyHeader = publicKeyBytes.toString("base64url");
  const deviceThumbprint = createHash("sha256").update(publicKeyBytes).digest("hex");
  const now = new Date();
  const request = pollRequestV1Schema.parse({
    protocolVersion: 1,
    correlationId: randomUUID(),
    issuedAt: now.toISOString(),
    nonce: "job-003-contract-poll",
    audience: "worker_poll",
    workerId: "b3000000-0000-4000-8000-000000000001",
    targetId: "b3000000-0000-4000-8000-000000000002",
    deviceGeneration: 3,
    capacity: {
      batchSlots: 1,
      browserSessionSlots: 0,
      serviceSlots: 0,
      freeCpuMillis: 1_000,
      freeMemoryMiB: 1_024,
      freeDiskMiB: 2_048,
    },
  });
  const rawBody = Buffer.from(JSON.stringify(request));
  const proofId = "job-003-contract-proof";
  const canonical = buildDeviceProofCanonicalInput({
    method: "POST",
    path: "/api/worker-control/poll",
    bodyDigest: createHash("sha256").update(rawBody).digest("hex"),
    correlationId: request.correlationId,
    issuedAt: now.toISOString(),
    proofId,
  });
  const sessionKey = "job-003-contract-session-signing-key-which-is-long-enough";
  return {
    now,
    request,
    rawBody,
    authorization: `Bearer ${createWorkerSessionToken(sessionKey, {
      aud: "device_session",
      sub: request.workerId,
      organizationId: "b3000000-0000-4000-8000-000000000003",
      targetId: request.targetId,
      generation: 3,
      scope: "organization",
      deviceThumbprint,
      profileHash: "9".repeat(64),
      iat: Math.floor(now.getTime() / 1000),
      exp: Math.floor((now.getTime() + 10 * 60_000) / 1000),
    })}`,
    sessionKey,
    proof: {
      version: "1",
      publicKey: publicKeyHeader,
      signature: sign(null, Buffer.from(canonical), privateKey).toString("base64url"),
      issuedAt: now.toISOString(),
      proofId,
    },
  };
}

describe("JOB-003 frozen worker-operation HTTP contract", () => {
  it("verifies the session and Ed25519 proof without opening a database transaction", () => {
    const signed = signedPoll();
    const verified = verifyWorkerOperationProof({
      sessionSigningKey: signed.sessionKey,
      authorization: signed.authorization,
      rawBody: signed.rawBody,
      proof: signed.proof,
      method: "POST",
      path: "/api/worker-control/poll",
      correlationId: signed.request.correlationId,
      now: signed.now,
    });
    expect(verified).toMatchObject({
      organizationId: "b3000000-0000-4000-8000-000000000003",
      workerId: signed.request.workerId,
      targetId: signed.request.targetId,
      targetGeneration: 3,
      profileHash: "9".repeat(64),
      proofId: "job-003-contract-proof",
    });
    expect(Object.keys(verified)).not.toContain("fenceToken");
  });

  it("binds proof to method/path/body/correlation and denies a copied bearer token", () => {
    const signed = signedPoll();
    const base = {
      sessionSigningKey: signed.sessionKey,
      authorization: signed.authorization,
      rawBody: signed.rawBody,
      proof: signed.proof,
      method: "POST",
      path: "/api/worker-control/poll",
      correlationId: signed.request.correlationId,
      now: signed.now,
    };
    expect(() => verifyWorkerOperationProof({ ...base, method: "PUT" })).toThrow(WorkerOperationProofError);
    expect(() => verifyWorkerOperationProof({ ...base, path: "/api/worker-control/lease-ack" })).toThrow(WorkerOperationProofError);
    expect(() => verifyWorkerOperationProof({ ...base, rawBody: Buffer.from("{}") })).toThrow(WorkerOperationProofError);
    expect(() => verifyWorkerOperationProof({
      ...base,
      proof: { ...signed.proof, signature: "copied-session-without-device-key" },
    })).toThrow(WorkerOperationProofError);
  });

  it("uses only descriptor-allowed frozen poll errors with redacted detail", () => {
    const request = {
      body: { correlationId: randomUUID() },
      header: () => undefined,
    } as never;
    for (const code of OPERATION_DESCRIPTORS.poll.errors) {
      const error = workerOperationProtocolErrorV1(request, "poll", code, new Date());
      expect(protocolErrorV1Schema.parse(error)).toEqual(error);
      expect(error.detail).toEqual({});
      expect(error.redaction).toBe("secret");
    }
  });

  it("keeps worker routes behind the default-off distributed execution composition", () => {
    const source = readFileSync(new URL("../app.ts", import.meta.url), "utf8");
    const flagBlock = source.slice(
      source.indexOf("if (opts.distributedExecutionEnabled)"),
      source.indexOf("// Settings -> Providers"),
    );
    expect(flagBlock).toContain("workerControlRoutes");
    expect(flagBlock).toContain("tenantAppDb");
    expect(flagBlock).toContain("operatorDb");
    expect(flagBlock).toContain("workerSessionSigningKey");
    expect(flagBlock).toContain("owner fallback is forbidden");
    expect(flagBlock).not.toContain("appDb: db");
  });
});
