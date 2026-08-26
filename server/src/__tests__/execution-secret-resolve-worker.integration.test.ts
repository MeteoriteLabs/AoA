import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import net, { type AddressInfo } from "node:net";
import type { Server } from "node:http";
import postgres, { type Sql } from "postgres";
import express from "express";
import {
  applyPendingMigrations,
  createDb,
  createOperatorDbConnection,
  createTenantAppDbConnection,
  type NonOwnerDbConnection,
} from "@armyofagents/db";
import {
  createControlPlaneClient,
  createEnroller,
  createRedeemer,
  deviceKeyFromPkcs8Der,
  enrollOnce,
  synthesiseRunSecrets,
  SecretMaterializationError,
  type DeviceEnrollmentReceipt,
  type DeviceIdentityRecord,
  type DeviceRecordStore,
  type WorkerSession,
} from "@armyofagents/worker-daemon";
import { secretHandleRefSchema, type SecretHandleRef } from "@armyofagents/worker-protocol";
import { provisionTenantAppRoleLoginSql } from "../db/rls-tenant.js";
import { workerControlRoutes } from "../routes/worker-control.js";
import { createWorkerEnrollmentService } from "../services/worker-enrollment.js";
import { errorHandler } from "../middleware/error-handler.js";

// ★ DAT-008 slice 5 (go-book Sprint 4) — the WORKER'S redeem client round-trips against the REAL
// resolve route. This proves the cross-package wire the unit tests fake: the device proof signed
// OVER the resolve path VERIFIES server-side, the live session is accepted as Bearer, the real
// broker + fence-first authz run, and the worker FAILS CLOSED on a denial (which the route returns
// as HTTP 200, not a 4xx — a status-only worker would fail open). The RESOLVED-path value return
// over a live fence + real E2B is Sprint 5's journey (parent §9 limit 3); here we prove the wire +
// the fail-closed classification against the real server, end to end.

const SIGNING_KEY = "test-signing-key-at-least-32-bytes";
const ORG_A = "71000000-0000-4000-8000-000000000001";
const TARGET_A = "72000000-0000-4000-8000-000000000001";
const OWNER_USER = "dat-008-s5-owner";
const COMPANY_A = "76000000-0000-4000-8000-000000000001";
const PASSWORD = "dat-008-s5-role";
const NOW = new Date(Date.UTC(2026, 7, 26, 0, 0, 0));

type EmbeddedPostgresInstance = { initialise(): Promise<void>; start(): Promise<void>; stop(): Promise<void> };
type EmbeddedPostgresCtor = new (opts: Record<string, unknown>) => EmbeddedPostgresInstance;

let embedded: EmbeddedPostgresInstance | null = null;
let dataDir = "";
let admin: Sql | null = null;
let appConn: NonOwnerDbConnection | null = null;
let operatorConn: NonOwnerDbConnection | null = null;
let ownerDb: ReturnType<typeof createDb> | null = null;
let setupError: unknown = null;
let clock = NOW.getTime();
let httpServer: Server | null = null;
let baseUrl = "";
let enrollmentService: ReturnType<typeof createWorkerEnrollmentService> | null = null;

const now = () => new Date(clock);

async function allocatePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) =>
        error
          ? reject(error)
          : !address || typeof address === "string"
            ? reject(new Error("port allocation failed"))
            : resolve(address.port),
      );
    });
    server.on("error", reject);
  });
}

function guard() {
  if (setupError) throw new Error(`embedded-postgres setup failed: ${String(setupError)}`);
  if (!admin || !enrollmentService || !baseUrl) throw new Error("test setup incomplete");
  return { admin, enrollment: enrollmentService };
}

function memoryStore<T>(): DeviceRecordStore<T> & { peek: () => T | null } {
  let value: T | null = null;
  return {
    load: () => value,
    saveIfAbsent: (r: T) => {
      if (value !== null) return "already_present";
      value = r;
      return "stored";
    },
    clear: () => {
      value = null;
    },
    peek: () => value,
  };
}

const clockEnroller: NonNullable<Parameters<typeof enrollOnce>[0]["createEnrollerFn"]> = (d) =>
  createEnroller({ keyStore: d.keyStore, client: d.client, now: () => clock });

async function issueCode(): Promise<string> {
  const { enrollment } = guard();
  const issued = await enrollment.issueTenantCode({
    organizationId: ORG_A,
    executionTargetId: TARGET_A,
    scope: "organization",
    ownerUserId: null,
    createdByPrincipalKind: "user",
    createdByPrincipalId: OWNER_USER,
  });
  return issued.code;
}

function envHandle(handleId: string): SecretHandleRef {
  return secretHandleRefSchema.parse({
    handleId,
    materialization: { kind: "env", target: "ANTHROPIC_API_KEY" },
    usePolicy: "sandbox_local_only",
  });
}

beforeAll(async () => {
  try {
    dataDir = await mkdtemp(join(tmpdir(), "aoa-dat008-s5-"));
    const { default: EmbeddedPostgres } = (await import("embedded-postgres")) as { default: EmbeddedPostgresCtor };
    const pgPort = await allocatePort();
    embedded = new EmbeddedPostgres({
      databaseDir: join(dataDir, "db"),
      user: "test",
      password: "test",
      port: pgPort,
      persistent: false,
      initdbFlags: ["--encoding=UTF8", "--locale=C"],
    });
    await embedded.initialise();
    await embedded.start();
    const adminUrl = `postgres://test:test@127.0.0.1:${pgPort}/postgres`;
    await applyPendingMigrations(adminUrl);
    admin = postgres(adminUrl, { max: 1 });
    ownerDb = createDb(adminUrl);
    await admin.unsafe(provisionTenantAppRoleLoginSql("aoa_app", PASSWORD));
    await admin.unsafe(provisionTenantAppRoleLoginSql("aoa_operator", PASSWORD));
    appConn = createTenantAppDbConnection(adminUrl.replace("test:test", `aoa_app:${PASSWORD}`));
    operatorConn = createOperatorDbConnection(adminUrl.replace("test:test", `aoa_operator:${PASSWORD}`));
    await admin`INSERT INTO organizations (id, name, slug) VALUES (${ORG_A}, 'DAT-008 S5', 'dat-008-s5')`;
    await admin`INSERT INTO companies (id, organization_id, name, issue_prefix) VALUES (${COMPANY_A}, ${ORG_A}, 'S5 Co', 'DPS')`;
    await admin`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
      VALUES (${OWNER_USER}, 'Owner', 'dat-008-s5-owner@example.invalid', true, now(), now())`;
    await admin`INSERT INTO organization_memberships (organization_id, user_id, role, status, joined_at)
      VALUES (${ORG_A}, ${OWNER_USER}, 'owner', 'active', now())`;
    await admin`INSERT INTO execution_targets
      (id, organization_id, owner_user_id, slug, kind, trust_class, status, capabilities, config, scope, target_authority_key)
      VALUES (${TARGET_A}, ${ORG_A}, NULL, 'target-a', 'dedicated_worker', 'dedicated_tenant', 'active',
        ${{ providerConstraints: { profileId: "desktop-v1", version: 1, digest: "b".repeat(64) } }}, '{}',
        'organization', ${`organization:${ORG_A}`})`;

    const app = express();
    app.use(
      express.json({
        verify: (req, _res, bytes) => {
          (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(bytes);
        },
      }),
    );
    app.use(
      "/api",
      workerControlRoutes({
        db: ownerDb,
        appDb: appConn.db,
        operatorDb: operatorConn.db,
        sessionSigningKey: SIGNING_KEY,
        now,
      }),
    );
    app.use(errorHandler);
    enrollmentService = createWorkerEnrollmentService({
      appDb: appConn.db,
      operatorDb: operatorConn.db,
      sessionSigningKey: SIGNING_KEY,
      now,
    });

    httpServer = app.listen(0, "127.0.0.1");
    await new Promise<void>((res) => httpServer!.once("listening", () => res()));
    baseUrl = `http://127.0.0.1:${(httpServer!.address() as AddressInfo).port}`;
  } catch (error) {
    setupError = error;
  }
}, 180_000);

afterAll(async () => {
  try {
    await new Promise<void>((res) => (httpServer ? httpServer.close(() => res()) : res()));
  } catch {
    /* ignore */
  }
  try {
    await ownerDb?.$client.end();
  } catch {
    /* ignore */
  }
  try {
    await operatorConn?.close({ timeoutSeconds: 5 });
  } catch {
    /* ignore */
  }
  try {
    await appConn?.close({ timeoutSeconds: 5 });
  } catch {
    /* ignore */
  }
  try {
    await admin?.end();
  } catch {
    /* ignore */
  }
  try {
    await embedded?.stop();
  } catch {
    /* ignore */
  }
  try {
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}, 60_000);

beforeEach(async () => {
  clock = NOW.getTime();
  if (!admin) return;
  await admin`DELETE FROM worker_proof_replays`;
  await admin`DELETE FROM worker_enrollment_codes`;
  await admin`DELETE FROM worker_enrollment_code_routes`;
  await admin`DELETE FROM workers`;
  await admin`UPDATE execution_targets SET device_generation = 1, status = 'active', last_seen_at = NULL WHERE id = ${TARGET_A}`;
  await admin`UPDATE organization_memberships SET status = 'active' WHERE organization_id = ${ORG_A} AND user_id = ${OWNER_USER}`;
});

describe.skipIf(process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1")(
  "DAT-008 slice 5 — the worker redeem client round-trips against the REAL resolve route (embedded PostgreSQL)",
  () => {
    async function enrolledWorker() {
      const code = await issueCode();
      const identityStore = memoryStore<DeviceIdentityRecord>();
      const receiptStore = memoryStore<DeviceEnrollmentReceipt>();
      const client = createControlPlaneClient({ baseUrl });
      let session: WorkerSession | null = null;
      const outcome = await enrollOnce({
        identityStore,
        receiptStore,
        client,
        readInput: () => ({ targetId: TARGET_A, enrollmentCode: code }),
        platform: process.platform,
        arch: process.arch,
        createEnrollerFn: clockEnroller,
        onSessionMinted: (s) => {
          session = s;
        },
      });
      expect(outcome.enrolled).toBe(true);
      const identity = identityStore.peek();
      expect(identity, "enrolment must persist a device identity").not.toBeNull();
      expect(session, "the sink must have delivered a session").not.toBeNull();
      const key = deviceKeyFromPkcs8Der(Buffer.from(identity!.privateKeyPkcs8Der));
      return { client, key, session: session! };
    }

    it("device proof over the resolve path VERIFIES and a no-fence handle is DENIED (200, not 401)", async () => {
      const { client, key, session } = await enrolledWorker();
      const redeem = createRedeemer({
        client,
        key,
        session,
        fence: {
          workerId: session.workerId,
          jobId: "8f000000-0000-4000-8000-000000000abc",
          attempt: 1,
          leaseId: "8f000000-0000-4000-8000-000000000def",
          fenceToken: "no-such-fence",
        },
      });
      // A `denied` classification (not `malformed`) proves the response was HTTP 200 with
      // outcome:"denied" — i.e. the device proof VERIFIED (else 401 → `malformed`) and the
      // real broker/fence-first path ran and refused. This is the whole cross-package wire.
      const c = await redeem("9f000000-0000-4000-8000-000000000fed");
      expect(c.kind).toBe("denied");
    });

    it("a denied round-trip FAILS THE RUN CLOSED (synthesiseRunSecrets throws, no env produced)", async () => {
      const { client, key, session } = await enrolledWorker();
      const handleId = "9f000000-0000-4000-8000-000000000fed";
      const redeem = createRedeemer({
        client,
        key,
        session,
        fence: {
          workerId: session.workerId,
          jobId: "8f000000-0000-4000-8000-000000000abc",
          attempt: 1,
          leaseId: "8f000000-0000-4000-8000-000000000def",
          fenceToken: "no-such-fence",
        },
      });
      await expect(synthesiseRunSecrets([envHandle(handleId)], redeem)).rejects.toBeInstanceOf(
        SecretMaterializationError,
      );
    });
  },
);
