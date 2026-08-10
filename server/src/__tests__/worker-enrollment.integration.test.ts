import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { generateKeyPairSync, sign, createHash, type KeyObject } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import net from "node:net";
import postgres, { type Sql } from "postgres";
import {
  applyPendingMigrations,
  createOperatorDbConnection,
  createTenantAppDbConnection,
  type NonOwnerDbConnection,
} from "@armyofagents/db";
import { provisionTenantAppRoleLoginSql } from "../db/rls-tenant.js";

type EmbeddedPostgresInstance = { initialise(): Promise<void>; start(): Promise<void>; stop(): Promise<void> };
type EmbeddedPostgresCtor = new (opts: Record<string, unknown>) => EmbeddedPostgresInstance;

const ORG_A = "71000000-0000-4000-8000-000000000001";
const ORG_B = "71000000-0000-4000-8000-000000000002";
const TARGET_A = "72000000-0000-4000-8000-000000000001";
const TARGET_B = "72000000-0000-4000-8000-000000000002";
const WORKER_A = "73000000-0000-4000-8000-000000000001";
const WORKER_REPLAY = "73000000-0000-4000-8000-000000000002";
const WORKER_UNIFORM = "73000000-0000-4000-8000-000000000003";
const PASSWORD = "job-002-role-test";
const NOW = new Date("2026-08-10T00:00:00.000Z");

let embedded: EmbeddedPostgresInstance | null = null;
let dataDir = "";
let admin: Sql | null = null;
let app: NonOwnerDbConnection | null = null;
let operator: NonOwnerDbConnection | null = null;
let setupError: unknown = null;
let enrollmentModule: Awaited<ReturnType<typeof loadEnrollmentModule>> = null;
let sessionModule: Awaited<ReturnType<typeof loadSessionModule>> = null;

async function allocatePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error ? reject(error) :
        !address || typeof address === "string" ? reject(new Error("port allocation failed")) : resolve(address.port));
    });
    server.on("error", reject);
  });
}

async function loadEnrollmentModule() {
  return import("../services/worker-enrollment.js").catch(() => null);
}

async function loadSessionModule() {
  return import("../middleware/worker-session-auth.js").catch(() => null);
}

function guard() {
  if (setupError) throw new Error(`embedded-postgres setup failed: ${String(setupError)}`);
  expect(enrollmentModule, "worker-enrollment module is not implemented").not.toBeNull();
  if (!admin || !app || !operator || !enrollmentModule) throw new Error("test setup incomplete");
  return { admin, appDb: app.db, operatorDb: operator.db, mod: enrollmentModule };
}

function enrollmentBody(workerId = WORKER_A) {
  return {
    protocolVersion: 1,
    correlationId: "74000000-0000-4000-8000-000000000001",
    issuedAt: NOW.toISOString(),
    nonce: "enrollment-nonce-1",
    audience: "target_enrollment",
    idempotencyKey: "75000000-0000-4000-8000-000000000001",
    hello: {
      protocolVersion: 1,
      workerId,
      targetId: TARGET_A,
      deviceGeneration: 1,
      agentVersion: "job-002-test",
      supportedProtocol: { min: 1, max: 1 },
      platform: { os: "windows", arch: "x64", runtime: "desktop" },
      reportedCapabilities: ["workload.batch"],
      capacity: {
        batchSlots: 1, browserSessionSlots: 0, serviceSlots: 0,
        freeCpuMillis: 1000, freeMemoryMiB: 1024, freeDiskMiB: 1024,
      },
      policyHash: "a".repeat(64),
    },
  };
}

function rawBody(body: unknown): Buffer {
  return Buffer.from(JSON.stringify(body));
}

function deviceProof(body: ReturnType<typeof enrollmentBody>, privateKey: KeyObject, publicKey: KeyObject, proofId: string) {
  const bytes = rawBody(body);
  const issuedAt = NOW.toISOString();
  const publicKeyDer = publicKey.export({ format: "der", type: "spki" }).toString("base64url");
  const canonical = [
    "AOA-DEVICE-PROOF-V1", "POST", "/api/worker-control/enroll",
    createHash("sha256").update(bytes).digest("hex"), body.correlationId, issuedAt, proofId,
  ].join("\n");
  return {
    rawBody: bytes,
    proof: {
      version: "1", publicKey: publicKeyDer,
      signature: sign(null, Buffer.from(canonical), privateKey).toString("base64url"),
      issuedAt, proofId,
    },
  };
}

beforeAll(async () => {
  enrollmentModule = await loadEnrollmentModule();
  sessionModule = await loadSessionModule();
  try {
    dataDir = await mkdtemp(join(tmpdir(), "aoa-worker-enrollment-"));
    const { default: EmbeddedPostgres } = (await import("embedded-postgres")) as { default: EmbeddedPostgresCtor };
    const port = await allocatePort();
    embedded = new EmbeddedPostgres({
      databaseDir: join(dataDir, "db"), user: "test", password: "test", port,
      persistent: false, initdbFlags: ["--encoding=UTF8", "--locale=C"],
    });
    await embedded.initialise();
    await embedded.start();
    const adminUrl = `postgres://test:test@127.0.0.1:${port}/postgres`;
    await applyPendingMigrations(adminUrl);
    admin = postgres(adminUrl, { max: 1 });
    await admin.unsafe(provisionTenantAppRoleLoginSql("aoa_app", PASSWORD));
    await admin.unsafe(provisionTenantAppRoleLoginSql("aoa_operator", PASSWORD));
    app = createTenantAppDbConnection(adminUrl.replace("test:test", `aoa_app:${PASSWORD}`));
    operator = createOperatorDbConnection(adminUrl.replace("test:test", `aoa_operator:${PASSWORD}`));
    await admin`INSERT INTO organizations (id, name, slug) VALUES
      (${ORG_A}, 'Enrollment A', 'worker-enrollment-a'), (${ORG_B}, 'Enrollment B', 'worker-enrollment-b')`;
    await admin`INSERT INTO execution_targets
      (id, organization_id, slug, kind, trust_class, status, capabilities, config, scope, target_authority_key)
      VALUES
      (${TARGET_A}, ${ORG_A}, 'target-a', 'dedicated_worker', 'dedicated_tenant', 'active',
        ${{ providerConstraints: { profileId: "desktop-v1", version: 1, digest: "b".repeat(64) } }}, '{}',
        'organization', ${`organization:${ORG_A}`}),
      (${TARGET_B}, ${ORG_B}, 'target-b', 'dedicated_worker', 'dedicated_tenant', 'active',
        ${{ providerConstraints: { profileId: "desktop-v1", version: 1, digest: "b".repeat(64) } }}, '{}',
        'organization', ${`organization:${ORG_B}`})`;
  } catch (error) {
    setupError = error;
  }
}, 180_000);

afterAll(async () => {
  try { await operator?.close(); } catch { /* ignore */ }
  try { await app?.close(); } catch { /* ignore */ }
  try { await admin?.end(); } catch { /* ignore */ }
  try { await embedded?.stop(); } catch { /* ignore */ }
  try { if (dataDir) await rm(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
}, 60_000);

beforeEach(async () => {
  if (!admin) return;
  await admin`DELETE FROM worker_proof_replays`;
  await admin`DELETE FROM worker_enrollment_codes`;
  await admin`DELETE FROM worker_enrollment_code_routes`;
  await admin`DELETE FROM workers`;
});

describe.skipIf(process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1")(
  "JOB-002 tenant enrollment transaction",
  () => {
    it("issues a raw code once and atomically enrolls a device-bound logical profile", async () => {
      const { appDb, operatorDb, mod } = guard();
      const service = mod.createWorkerEnrollmentService({
        appDb, operatorDb, sessionSigningKey: "test-signing-key-at-least-32-bytes", now: () => NOW,
      });
      const issued = await service.issueTenantCode({
        organizationId: ORG_A, executionTargetId: TARGET_A, scope: "organization",
        ownerUserId: null, createdByPrincipalKind: "user", createdByPrincipalId: "founder-a",
      });
      expect(issued.code).toMatch(/^aoa_enr_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      const { privateKey, publicKey } = generateKeyPairSync("ed25519");
      const body = enrollmentBody(WORKER_A);
      const proof = deviceProof(body, privateKey, publicKey, "proof-enroll-1");
      const result = await service.enroll({
        code: issued.code, request: body, ...proof, method: "POST", path: "/api/worker-control/enroll",
      });
      expect(result.response).toMatchObject({ outcome: "enrolled", workerId: WORKER_A, targetId: TARGET_A, deviceGeneration: 1 });
      expect(result.session).toEqual(expect.any(String));
    });

    it("replays the semantic result only for same key/digest with a fresh proof and rejects proof replay", async () => {
      const { appDb, operatorDb, mod } = guard();
      const service = mod.createWorkerEnrollmentService({
        appDb, operatorDb, sessionSigningKey: "test-signing-key-at-least-32-bytes", now: () => NOW,
      });
      const issued = await service.issueTenantCode({
        organizationId: ORG_A, executionTargetId: TARGET_A, scope: "organization",
        ownerUserId: null, createdByPrincipalKind: "user", createdByPrincipalId: "founder-a",
      });
      const keys = generateKeyPairSync("ed25519");
      const body = enrollmentBody(WORKER_REPLAY);
      const firstProof = deviceProof(body, keys.privateKey, keys.publicKey, "proof-replay-1");
      const first = await service.enroll({ code: issued.code, request: body, ...firstProof, method: "POST", path: "/api/worker-control/enroll" });
      const freshProof = deviceProof(body, keys.privateKey, keys.publicKey, "proof-replay-2");
      const replay = await service.enroll({ code: issued.code, request: body, ...freshProof, method: "POST", path: "/api/worker-control/enroll" });
      expect(replay.response).toEqual(first.response);
      await expect(service.enroll({ code: issued.code, request: body, ...freshProof, method: "POST", path: "/api/worker-control/enroll" }))
        .rejects.toMatchObject({ code: "unauthorized" });
    });

    it("fails uniformly for expired, wrong-shard, unrelated-key, and changed-digest attempts", async () => {
      const { appDb, operatorDb, mod } = guard();
      const service = mod.createWorkerEnrollmentService({
        appDb, operatorDb, sessionSigningKey: "test-signing-key-at-least-32-bytes", now: () => NOW,
      });
      const issued = await service.issueTenantCode({
        organizationId: ORG_A, executionTargetId: TARGET_A, scope: "organization",
        ownerUserId: null, createdByPrincipalKind: "user", createdByPrincipalId: "founder-a",
      });
      const keys = generateKeyPairSync("ed25519");
      const body = enrollmentBody(WORKER_UNIFORM);
      await service.enroll({ code: issued.code, request: body, ...deviceProof(body, keys.privateKey, keys.publicKey, "proof-uniform-1"), method: "POST", path: "/api/worker-control/enroll" });
      const changed = { ...body, nonce: "changed-semantic-body" };
      await expect(service.enroll({ code: issued.code, request: changed, ...deviceProof(changed, keys.privateKey, keys.publicKey, "proof-uniform-2"), method: "POST", path: "/api/worker-control/enroll" }))
        .rejects.toMatchObject({ code: "malformed" });
      const unrelated = generateKeyPairSync("ed25519");
      await expect(service.enroll({ code: issued.code, request: body, ...deviceProof(body, unrelated.privateKey, unrelated.publicKey, "proof-uniform-3"), method: "POST", path: "/api/worker-control/enroll" }))
        .rejects.toMatchObject({ code: "unauthorized" });
    });

    it("requires fresh device possession and current target generation for a copied session", async () => {
      const { admin, appDb, operatorDb, mod } = guard();
      expect(sessionModule, "worker-session-auth module is not implemented").not.toBeNull();
      const service = mod.createWorkerEnrollmentService({
        appDb, operatorDb, sessionSigningKey: "test-signing-key-at-least-32-bytes", now: () => NOW,
      });
      const issued = await service.issueTenantCode({
        organizationId: ORG_A, executionTargetId: TARGET_A, scope: "organization",
        ownerUserId: null, createdByPrincipalKind: "user", createdByPrincipalId: "founder-a",
      });
      const keys = generateKeyPairSync("ed25519");
      const enrollment = enrollmentBody(WORKER_A);
      const enrolled = await service.enroll({
        code: issued.code, request: enrollment,
        ...deviceProof(enrollment, keys.privateKey, keys.publicKey, "proof-session-enroll"),
        method: "POST", path: "/api/worker-control/enroll",
      });
      const authenticator = sessionModule!.createWorkerSessionAuthenticator({
        appDb, operatorDb, sessionSigningKey: "test-signing-key-at-least-32-bytes", now: () => NOW,
      });
      const heartbeatBytes = Buffer.from(JSON.stringify({ status: "active" }));
      const correlationId = "74000000-0000-4000-8000-000000000099";
      const sessionProof = deviceProofFor(
        heartbeatBytes, correlationId, keys.privateKey, keys.publicKey, "proof-session-1",
        "/api/execution-targets/heartbeat",
      );
      await expect(authenticator.authenticate({
        authorization: `Bearer ${enrolled.session}`,
        rawBody: heartbeatBytes, proof: sessionProof, method: "POST",
        path: "/api/execution-targets/heartbeat", correlationId,
      })).resolves.toMatchObject({ workerId: WORKER_A, targetId: TARGET_A, targetGeneration: 1 });
      await expect(authenticator.authenticate({
        authorization: `Bearer ${enrolled.session}`,
        rawBody: heartbeatBytes, proof: sessionProof, method: "POST",
        path: "/api/execution-targets/heartbeat", correlationId,
      })).rejects.toMatchObject({ code: "unauthorized" });
      const copied = generateKeyPairSync("ed25519");
      await expect(authenticator.authenticate({
        authorization: `Bearer ${enrolled.session}`,
        rawBody: heartbeatBytes,
        proof: deviceProofFor(heartbeatBytes, correlationId, copied.privateKey, copied.publicKey, "proof-session-2", "/api/execution-targets/heartbeat"),
        method: "POST", path: "/api/execution-targets/heartbeat", correlationId,
      })).rejects.toMatchObject({ code: "unauthorized" });
      await admin`UPDATE execution_targets SET device_generation = 2 WHERE id = ${TARGET_A}`;
      await expect(authenticator.authenticate({
        authorization: `Bearer ${enrolled.session}`,
        rawBody: heartbeatBytes,
        proof: deviceProofFor(heartbeatBytes, correlationId, keys.privateKey, keys.publicKey, "proof-session-3", "/api/execution-targets/heartbeat"),
        method: "POST", path: "/api/execution-targets/heartbeat", correlationId,
      })).rejects.toMatchObject({ code: "target_revoked" });
    });
  },
);

function deviceProofFor(
  bytes: Buffer,
  correlationId: string,
  privateKey: KeyObject,
  publicKey: KeyObject,
  proofId: string,
  path: string,
) {
  const issuedAt = NOW.toISOString();
  const publicKeyDer = publicKey.export({ format: "der", type: "spki" }).toString("base64url");
  const canonical = [
    "AOA-DEVICE-PROOF-V1", "POST", path,
    createHash("sha256").update(bytes).digest("hex"), correlationId, issuedAt, proofId,
  ].join("\n");
  return {
    version: "1", publicKey: publicKeyDer,
    signature: sign(null, Buffer.from(canonical), privateKey).toString("base64url"),
    issuedAt, proofId,
  };
}
