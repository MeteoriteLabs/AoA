import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import postgres, { type Sql } from "postgres";
import request from "supertest";
import {
  applyPendingMigrations,
  createDb,
  createTenantAppDbConnection,
  type NonOwnerDbConnection,
} from "@armyofagents/db";
import type { StorageService } from "../storage/types.js";
import { allocateEmbeddedPgPort } from "./helpers/embedded-pg-port.js";
import { provisionTenantAppRoleLoginSql, TENANT_APP_ROLE } from "../db/rls-tenant.js";
import { createCommanderRunJwt } from "../agent-auth-jwt.js";

vi.mock("../services/aoa-marketplace.js", async (importActual) => {
  const actual = await importActual<typeof import("../services/aoa-marketplace.js")>();
  class NoopMarketplaceCatalogService {
    constructor(_deps: unknown) {}
    startSyncLoop(): void {}
    stopSyncLoop(): void {}
  }
  return { ...actual, MarketplaceCatalogService: NoopMarketplaceCatalogService };
});

const { createApp } = await import("../app.js");

type EmbeddedPostgresInstance = { initialise(): Promise<void>; start(): Promise<void>; stop(): Promise<void> };
type EmbeddedPostgresCtor = new (opts: Record<string, unknown>) => EmbeddedPostgresInstance;

const APP_PASSWORD = "job-submission-app-password";
const ORG_A = "10000000-0000-4000-8000-000000000001";
const ORG_B = "10000000-0000-4000-8000-000000000002";
const COMPANY_A = "20000000-0000-4000-8000-000000000001";
const COMPANY_B = "20000000-0000-4000-8000-000000000002";
const USER_A = "job-submission-user-a";
const USER_B = "job-submission-user-b";
const AGENT_A = "30000000-0000-4000-8000-000000000001";
const AGENT_B = "30000000-0000-4000-8000-000000000002";
const RUN_A = "40000000-0000-4000-8000-000000000001";
const ISSUE_A = "50000000-0000-4000-8000-000000000001";
const ISSUE_B = "50000000-0000-4000-8000-000000000002";
const MCP_KEY_A = "d0000000-0000-4000-8000-000000000001";
const MCP_TOKEN_A = "job-submission-mcp-token-a";

const SOURCE_CASES = [
  { kind: "task_run", runId: RUN_A, issueId: ISSUE_A, assigneeAgentId: AGENT_A },
  {
    kind: "commander_turn",
    internalAgentRunId: "60000000-0000-4000-8000-000000000001",
    conversationId: "70000000-0000-4000-8000-000000000001",
  },
  { kind: "crew_run", crewRunId: "80000000-0000-4000-8000-000000000001" },
  {
    kind: "one_shot",
    operationId: "90000000-0000-4000-8000-000000000001",
    operationKind: "extraction",
  },
  {
    kind: "browser_request",
    browserRequestId: "a0000000-0000-4000-8000-000000000001",
    parentJobId: null,
  },
  {
    kind: "service_reconcile",
    serviceId: "b0000000-0000-4000-8000-000000000001",
    generation: 1,
    reconciliationId: "c0000000-0000-4000-8000-000000000001",
  },
] as const;

let embedded: EmbeddedPostgresInstance | null = null;
let dataDir = "";
let admin: Sql | null = null;
let appConnection: NonOwnerDbConnection | null = null;
let app: Awaited<ReturnType<typeof createApp>>;
let localBoardApp: Awaited<ReturnType<typeof createApp>>;
let flagOffApp: Awaited<ReturnType<typeof createApp>>;
let setupError: unknown = null;

function guard(): void {
  if (setupError) throw new Error(`embedded-postgres setup failed: ${String(setupError)}`);
}

function route(orgId = ORG_A, companyId = COMPANY_A): string {
  return `/api/organizations/${orgId}/companies/${companyId}/jobs`;
}

function command(idempotencyKey: string, source: Record<string, unknown> = SOURCE_CASES[0], value = "alpha") {
  return { idempotencyKey, source, input: { value, nested: { stable: true } } };
}

function asUser(userId = USER_A) {
  return { "x-test-user": userId, origin: "http://127.0.0.1", host: "127.0.0.1" };
}

async function counts(key: string) {
  const [row] = await admin!<{ jobs: number; attempts: number; outbox: number }[]>`
    SELECT
      (SELECT count(*)::int FROM jobs WHERE idempotency_key = ${key}) AS jobs,
      (SELECT count(*)::int FROM job_attempts a JOIN jobs j ON j.id = a.job_id WHERE j.idempotency_key = ${key}) AS attempts,
      (SELECT count(*)::int FROM job_outbox o JOIN jobs j ON j.id = o.job_id WHERE j.idempotency_key = ${key}) AS outbox
  `;
  return row!;
}

async function installFailureTrigger(table: "jobs" | "job_attempts" | "job_outbox") {
  await admin!.unsafe(`
    CREATE OR REPLACE FUNCTION job_submission_test_failure() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced ${table} insert failure'; END $$;
    DROP TRIGGER IF EXISTS job_submission_test_failure_trigger ON ${table};
    CREATE TRIGGER job_submission_test_failure_trigger BEFORE INSERT ON ${table}
    FOR EACH ROW EXECUTE FUNCTION job_submission_test_failure();
  `);
}

async function clearFailureTriggers() {
  for (const table of ["jobs", "job_attempts", "job_outbox"]) {
    await admin!.unsafe(`DROP TRIGGER IF EXISTS job_submission_test_failure_trigger ON ${table}`);
  }
}

beforeAll(async () => {
  try {
    process.env.AOA_AGENT_JWT_SECRET = "job-submission-commander-jwt-secret";
    dataDir = await mkdtemp(join(tmpdir(), "aoa-job-submission-"));
    const { default: EmbeddedPostgres } = (await import("embedded-postgres")) as {
      default: EmbeddedPostgresCtor;
    };
    const port = await allocateEmbeddedPgPort();
    embedded = new EmbeddedPostgres({
      databaseDir: join(dataDir, "db"),
      user: "test",
      password: "test",
      port,
      persistent: false,
      initdbFlags: ["--encoding=UTF8", "--locale=C"],
    });
    await embedded.initialise();
    await embedded.start();
    const adminUrl = `postgres://test:test@127.0.0.1:${port}/postgres`;
    await applyPendingMigrations(adminUrl);
    admin = postgres(adminUrl, { max: 4 });
    await admin.unsafe(provisionTenantAppRoleLoginSql(TENANT_APP_ROLE, APP_PASSWORD));
    const appUrl = adminUrl.replace("test:test", `aoa_app:${APP_PASSWORD}`);
    appConnection = createTenantAppDbConnection(appUrl, { max: 8 });

    await admin`
      INSERT INTO organizations (id, name, slug)
      VALUES (${ORG_A}, 'Job Org A', 'job-org-a'), (${ORG_B}, 'Job Org B', 'job-org-b')
    `;
    await admin`
      INSERT INTO companies (id, name, issue_prefix, organization_id)
      VALUES
        (${COMPANY_A}, 'Job Company A', 'JCA', ${ORG_A}),
        (${COMPANY_B}, 'Job Company B', 'JCB', ${ORG_B})
    `;
    await admin`
      INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
      VALUES
        (${USER_A}, 'User A', 'job-a@example.test', true, now(), now()),
        (${USER_B}, 'User B', 'job-b@example.test', true, now(), now())
    `;
    await admin`
      INSERT INTO organization_memberships (organization_id, user_id, role, status)
      VALUES (${ORG_A}, ${USER_A}, 'owner', 'active'), (${ORG_A}, ${USER_B}, 'member', 'active')
    `;
    await admin`
      INSERT INTO company_memberships
        (company_id, principal_type, principal_id, status, membership_role)
      VALUES
        (${COMPANY_A}, 'user', ${USER_A}, 'active', 'owner'),
        (${COMPANY_A}, 'user', ${USER_B}, 'active', 'member')
    `;
    await admin`
      INSERT INTO mcp_api_keys (id, company_id, user_id, name, key_hash)
      VALUES (
        ${MCP_KEY_A}, ${COMPANY_A}, ${USER_A}, 'Job submission MCP key',
        ${createHash("sha256").update(MCP_TOKEN_A).digest("hex")}
      )
    `;
    await admin`
      INSERT INTO agents (id, company_id, name, kind, status, adapter_type, adapter_config)
      VALUES
        (${AGENT_A}, ${COMPANY_A}, 'Job agent A', 'org', 'idle', 'http', ${admin.json({ url: "http://127.0.0.1:1/must-not-contact" })}),
        (${AGENT_B}, ${COMPANY_A}, 'Job agent B', 'org', 'idle', 'http', ${admin.json({ url: "http://127.0.0.1:1/must-not-contact" })})
    `;
    await admin`
      INSERT INTO heartbeat_runs (id, company_id, agent_id, status, started_at)
      VALUES (${RUN_A}, ${COMPANY_A}, ${AGENT_A}, 'running', now())
    `;
    await admin`
      INSERT INTO issues
        (id, company_id, title, status, assignee_agent_id, checkout_run_id, execution_run_id, updated_at)
      VALUES
        (${ISSUE_A}, ${COMPANY_A}, 'Submit immutable job', 'in_progress', ${AGENT_A}, ${RUN_A}, ${RUN_A}, now()),
        (${ISSUE_B}, ${COMPANY_A}, 'Other agent task', 'in_progress', ${AGENT_B}, null, null, now())
    `;

    const ownerDb = createDb(adminUrl);
    const baseOptions = {
      uiMode: "none",
      storageService: {} as StorageService,
      deploymentMode: "local_trusted",
      deploymentExposure: "private",
      companyWorkspaceBaseDir: join(dataDir, "workspaces"),
      allowedHostnames: [],
      bindHost: "127.0.0.1",
      authReady: true,
      companyDeletionEnabled: true,
      trustProxy: false,
      resolveSession: async (req) => {
        const userId = req.header("x-test-user");
        return userId
          ? { session: { id: `session-${userId}`, userId }, user: { id: userId } as never }
          : null;
      },
    } as const;
    app = await createApp(ownerDb, {
      ...baseOptions,
      distributedExecutionEnabled: true,
      tenantAppDb: appConnection.db,
    } as Parameters<typeof createApp>[1]);
    localBoardApp = await createApp(ownerDb, {
      ...baseOptions,
      resolveSession: undefined,
      devLocalIdentity: true,
      distributedExecutionEnabled: true,
      tenantAppDb: appConnection.db,
    } as Parameters<typeof createApp>[1]);
    flagOffApp = await createApp(ownerDb, {
      ...baseOptions,
      distributedExecutionEnabled: false,
      tenantAppDb: undefined,
    } as Parameters<typeof createApp>[1]);
  } catch (error) {
    setupError = error;
  }
}, 180_000);

beforeEach(async () => {
  if (admin) await clearFailureTriggers();
});

afterAll(async () => {
  try { if (admin) await clearFailureTriggers(); } catch { /* ignore */ }
  try { await appConnection?.close(); } catch { /* ignore */ }
  try { await admin?.end(); } catch { /* ignore */ }
  try { await embedded?.stop(); } catch { /* ignore */ }
  try { if (dataDir) await rm(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
}, 60_000);

describe.skipIf(process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1")(
  "JOB-001 transactional job submission",
  () => {
    it("returns the original IDs for an identical replay and 409 for a changed digest", async () => {
      guard();
      const body = command("replay-key");
      const first = await request(app).post(route()).set(asUser()).send(body);
      expect(first.status).toBe(201);
      expect(first.body).toEqual({
        jobId: expect.any(String), attemptId: expect.any(String), status: "queued", replayed: false,
      });
      const replay = await request(app).post(route()).set(asUser()).send(body);
      expect(replay.status).toBe(200);
      expect(replay.body).toEqual({ ...first.body, replayed: true });
      const conflict = await request(app).post(route()).set(asUser()).send(command("replay-key", SOURCE_CASES[0], "changed"));
      expect(conflict.status).toBe(409);
      expect(await counts("replay-key")).toEqual({ jobs: 1, attempts: 1, outbox: 1 });
    });

    it("scopes the same client key to the authenticated principal", async () => {
      guard();
      const key = "two-principals";
      const [a, b] = await Promise.all([
        request(app).post(route()).set(asUser(USER_A)).send(command(key)),
        request(app).post(route()).set(asUser(USER_B)).send(command(key)),
      ]);
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(a.body.jobId).not.toBe(b.body.jobId);
      expect(await counts(key)).toEqual({ jobs: 2, attempts: 2, outbox: 2 });
    });

    it("admits the trusted local board without fabricating a membership row", async () => {
      guard();
      const response = await request(localBoardApp).post(route()).send(command("local-board"));
      expect(response.status).toBe(201);
      expect(await counts("local-board")).toEqual({ jobs: 1, attempts: 1, outbox: 1 });
    });

    it("revalidates an authenticated MCP key inside the tenant transaction", async () => {
      guard();
      const response = await request(app)
        .post(route())
        .set("authorization", `Bearer ${MCP_TOKEN_A}`)
        .send(command("mcp-key", SOURCE_CASES[2]));
      expect(response.status).toBe(201);
      expect(await counts("mcp-key")).toEqual({ jobs: 1, attempts: 1, outbox: 1 });
    });

    it("admits a same-company Commander run JWT inside the tenant transaction", async () => {
      guard();
      const source = SOURCE_CASES[1];
      const token = createCommanderRunJwt({
        companyId: COMPANY_A,
        userId: USER_A,
        userRole: "founder",
        conversationId: source.conversationId,
        turnId: source.internalAgentRunId,
      });
      expect(token).toEqual(expect.any(String));
      const response = await request(app)
        .post(route())
        .set("authorization", `Bearer ${token}`)
        .send(command("commander-jwt", source));
      expect(response.status).toBe(201);
      expect(await counts("commander-jwt")).toEqual({ jobs: 1, attempts: 1, outbox: 1 });
    });

    it("does not mount the distributed job route while the flag is off", async () => {
      guard();
      const response = await request(flagOffApp).post(route()).set(asUser()).send(command("flag-off"));
      expect(response.status).toBe(404);
      expect(await counts("flag-off")).toEqual({ jobs: 0, attempts: 0, outbox: 0 });
    });

    it("collapses 32 concurrent identical submissions to one aggregate", async () => {
      guard();
      const key = "concurrent-32";
      const responses = await Promise.all(
        Array.from({ length: 32 }, () => request(app).post(route()).set(asUser()).send(command(key))),
      );
      expect(new Set(responses.map((response) => response.body.jobId))).toHaveLength(1);
      expect(responses.filter((response) => response.body.replayed === false)).toHaveLength(1);
      expect(responses.every((response) => [200, 201].includes(response.status))).toBe(true);
      expect(await counts(key)).toEqual({ jobs: 1, attempts: 1, outbox: 1 });
    });

    it.each(SOURCE_CASES)("accepts authenticated $kind source intent without delivery authority", async (source) => {
      guard();
      const response = await request(app)
        .post(route())
        .set(asUser())
        .send(command(`source-${source.kind}`, source));
      expect(response.status).toBe(201);
      const [job] = await admin!<Record<string, unknown>[]>
        `SELECT * FROM jobs WHERE id = ${response.body.jobId}`;
      expect(job).toMatchObject({
        organization_id: ORG_A,
        company_id: COMPANY_A,
        authenticated_principal_kind: "user",
        authenticated_principal_id: USER_A,
        source_kind: source.kind,
      });
      expect(job).toHaveProperty("input_hash");
      expect(job).toHaveProperty("policy_hash");
      expect(job).toHaveProperty("requirements");
      expect(job).toHaveProperty("placement_request");
    });

    it.each(["jobs", "job_attempts", "job_outbox"] as const)(
      "rolls back the complete aggregate when the %s statement fails",
      async (table) => {
        guard();
        const key = `rollback-${table}`;
        await installFailureTrigger(table);
        const response = await request(app).post(route()).set(asUser()).send(command(key));
        expect(response.status).toBe(500);
        expect(await counts(key)).toEqual({ jobs: 0, attempts: 0, outbox: 0 });
      },
    );

    it("denies requester/assignee mismatch uniformly before persistence", async () => {
      guard();
      const body = command("assignee-mismatch", {
        kind: "task_run", runId: RUN_A, issueId: ISSUE_A, assigneeAgentId: AGENT_B,
      });
      const response = await request(app).post(route()).set("x-aoa-run-id", RUN_A).send(body);
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: "Job submission denied" });
      expect(await counts("assignee-mismatch")).toEqual({ jobs: 0, attempts: 0, outbox: 0 });
    });

    it("denies a task source whose issue is not checked out to the claimed run and assignee", async () => {
      guard();
      const body = command("issue-source-mismatch", {
        kind: "task_run", runId: RUN_A, issueId: ISSUE_B, assigneeAgentId: AGENT_A,
      });
      const response = await request(app).post(route()).set(asUser()).send(body);
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: "Job submission denied" });
      expect(await counts("issue-source-mismatch")).toEqual({ jobs: 0, attempts: 0, outbox: 0 });
    });

    it.each([
      ["sentinel-org", "00000000-0000-0000-0000-000000000001", COMPANY_A],
      ["nonexistent-org", "d0000000-0000-4000-8000-000000000001", COMPANY_A],
      ["foreign-company", ORG_A, COMPANY_B],
    ])("denies %s with one response and no persistence", async (key, organizationId, companyId) => {
      guard();
      const response = await request(app)
        .post(route(organizationId, companyId))
        .set(asUser())
        .send(command(key));
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: "Job submission denied" });
      expect(await counts(key)).toEqual({ jobs: 0, attempts: 0, outbox: 0 });
    });

    it("does not expose an existing submission through a cross-Organization replay", async () => {
      guard();
      const body = command("h01-cross-org-replay");
      const accepted = await request(app).post(route()).set(asUser()).send(body);
      expect(accepted.status).toBe(201);
      const denied = await request(app).post(route(ORG_B, COMPANY_A)).set(asUser()).send(body);
      expect(denied.status).toBe(403);
      expect(denied.body).toEqual({ error: "Job submission denied" });
      expect(await counts("h01-cross-org-replay")).toEqual({ jobs: 1, attempts: 1, outbox: 1 });
    });

    it("rejects malformed and server-authoritative delivery fields", async () => {
      guard();
      const malformed = await request(app).post(route()).set(asUser()).send({
        ...command("malformed"),
        jobId: "e0000000-0000-4000-8000-000000000001",
      });
      expect(malformed.status).toBe(400);
      expect(await counts("malformed")).toEqual({ jobs: 0, attempts: 0, outbox: 0 });
    });

    it("persists one identifier-only ready outbox and creates no lease or adapter effect", async () => {
      guard();
      const response = await request(app).post(route()).set(asUser()).send(command("no-contact"));
      expect(response.status).toBe(201);
      const [outbox] = await admin!<{ kind: string; payload: Record<string, unknown> }[]>`
        SELECT kind, payload FROM job_outbox WHERE job_id = ${response.body.jobId}
      `;
      expect(outbox?.kind).toBe("attempt_ready");
      expect(Object.keys(outbox?.payload ?? {}).sort()).toEqual([
        "attemptId", "companyId", "jobId", "organizationId", "sourceKind",
      ]);
      const [leaseCount] = await admin!<{ count: number }[]>`
        SELECT count(*)::int AS count FROM leases WHERE attempt_id = ${response.body.attemptId}
      `;
      expect(leaseCount?.count).toBe(0);
    });
  },
);
