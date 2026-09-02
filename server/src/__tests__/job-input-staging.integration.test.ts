// server/src/__tests__/job-input-staging.integration.test.ts
//
// CLI-008 Unit B · Task 2 Step 2 — the control-plane staging write, on REAL SERVING ROLES.
//
// ★ THE LOAD-BEARING ASSERTION IS "NO LEASE ROW, NO FENCE EVER". That property is the whole
// reason this path was chosen over the fenced mutators, and it is the one a future refactor
// is most likely to break by "tidying" the write behind `guardActiveFence` — a guard that
// CANNOT be satisfied before placement, so adding it would silently remove the capability
// rather than secure it. Every other case here is about the two barriers that ARE real:
// RLS (a foreign organization fails 42501) and the composite FK (a ghost job fails 23503).
//
// Embedded PostgreSQL against HEAD's migrations, `aoa_app` (NOSUPERUSER/NOBYPASSRLS) —
// reading the code proves nothing about either barrier.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import postgres, { type Sql } from "postgres";
import {
  applyPendingMigrations,
  createTenantAppDbConnection,
  type NonOwnerDbConnection,
} from "@armyofagents/db";
import { canonicalizeJsonV1 } from "@armyofagents/worker-protocol";

import { provisionTenantAppRoleLoginSql } from "../db/rls-tenant.js";
import { runInTenant } from "../db/tenant-context.js";
import {
  STAGED_INPUT_ARTIFACT_KIND,
  stageJobInputFiles,
  stagedPathFromMarker,
} from "../services/job-input-staging.js";
import type { PutObjectInput, StorageProvider } from "../storage/types.js";
import { allocateEmbeddedPgPort } from "./helpers/embedded-pg-port.js";

type EmbeddedPostgresInstance = { initialise(): Promise<void>; start(): Promise<void>; stop(): Promise<void> };
type EmbeddedPostgresCtor = new (opts: Record<string, unknown>) => EmbeddedPostgresInstance;

const ORG = "c8000000-0000-4000-8000-000000000001";
const COMPANY = "c8000000-0000-4000-8000-000000000002";
const OTHER_ORG = "c8000000-0000-4000-8000-0000000000aa";
const OTHER_COMPANY = "c8000000-0000-4000-8000-0000000000bb";
const PASSWORD = "cli-008-role-password";
const POLICY_HASH = "3".repeat(64);

const integration = describe.skipIf(
  process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1",
);

const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

/** An in-memory object store that records exactly what crossed the storage port. */
function makeStubStorage(): StorageProvider & {
  objects: Map<string, Buffer>;
  puts: PutObjectInput[];
  deletes: string[];
  failNextPut: boolean;
} {
  const state = {
    objects: new Map<string, Buffer>(),
    puts: [] as PutObjectInput[],
    deletes: [] as string[],
    failNextPut: false,
  };
  return {
    id: "s3",
    get objects() { return state.objects; },
    get puts() { return state.puts; },
    get deletes() { return state.deletes; },
    get failNextPut() { return state.failNextPut; },
    set failNextPut(v: boolean) { state.failNextPut = v; },
    async putObject(input) {
      if (state.failNextPut) {
        state.failNextPut = false;
        throw new Error("stub store refused the put");
      }
      state.puts.push(input);
      state.objects.set(input.objectKey, Buffer.from(input.body));
    },
    async getObject() { throw new Error("not used"); },
    async headObject(input) {
      const object = state.objects.get(input.objectKey);
      return object ? { exists: true, contentLength: object.byteLength } : { exists: false };
    },
    async deleteObject(input) {
      state.deletes.push(input.objectKey);
      state.objects.delete(input.objectKey);
    },
  };
}

/** Postgres errors reach the caller wrapped (drizzle nests the driver error on `cause`), so
 * assert on the SQLSTATE anywhere in the chain rather than on the top-level shape. */
async function expectSqlState(promise: Promise<unknown>, sqlState: string): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught, "expected the write to be refused").toBeDefined();
  const codes: string[] = [];
  for (let error: unknown = caught; error && typeof error === "object"; error = (error as { cause?: unknown }).cause) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") codes.push(code);
  }
  expect(codes).toContain(sqlState);
}

integration("CLI-008 Unit B — the control-plane staging write on real serving roles", () => {
  let embedded: EmbeddedPostgresInstance | null = null;
  let dataDir = "";
  let admin: Sql | null = null;
  let app: NonOwnerDbConnection | null = null;
  let setupError: unknown = null;
  let ordinal = 0;

  function ctx() {
    if (setupError) throw new Error(`embedded-postgres setup failed: ${String(setupError)}`);
    if (!admin || !app) throw new Error("test setup incomplete");
    return { admin, app };
  }

  /** A job + attempt with NO lease, NO placement lease-eligibility and NO fence — the state
   * the control plane actually stages in. */
  async function seedJob(organizationId = ORG, companyId = COMPANY): Promise<{ jobId: string; attemptId: string }> {
    const { admin } = ctx();
    ordinal += 1;
    const suffix = ordinal.toString().padStart(12, "0");
    const jobId = `c8100000-0000-4000-8000-${suffix}`;
    const attemptId = `c8200000-0000-4000-8000-${suffix}`;
    const workload = { command: "claude", args: ["--print", "hi"], stdinArtifactId: null, maxRuntimeSeconds: 240 };
    const at = new Date(Date.now() - 60_000 + ordinal);
    await admin`INSERT INTO jobs
      (id, organization_id, company_id, workload_type, source_kind, source_identity, source_intent,
       requester_principal_kind, requester_principal_id, executor_principal_kind, executor_principal_id,
       input, input_hash, policy_snapshot, policy_hash, requirements, placement_request,
       available_at, priority, status, created_at, updated_at)
      VALUES (${jobId}, ${organizationId}, ${companyId}, 'batch', 'one_shot', ${jobId},
        ${{ kind: "one_shot", operationId: jobId, operationKind: "extraction" }},
        'system', 'cli-008-test', 'system', 'cli-008-test', ${workload},
        ${sha256(canonicalizeJsonV1(workload))},
        ${{ policyId: "job-submission-default", version: 1 }}, ${POLICY_HASH},
        ${{ workloadType: "batch", requiredCapabilities: ["sandbox.process_isolated"] }},
        ${{ policyId: "job-submission-default", policyVersion: 1 }},
        ${at}, 50, 'queued', ${at}, ${at})`;
    await admin`INSERT INTO job_attempts
      (id, organization_id, company_id, job_id, attempt_number, status, created_at, updated_at)
      VALUES (${attemptId}, ${organizationId}, ${companyId}, ${jobId}, 1, 'pending', ${at}, ${at})`;
    return { jobId, attemptId };
  }

  beforeAll(async () => {
    try {
      dataDir = await mkdtemp(join(tmpdir(), "aoa-cli008-"));
      const { default: EmbeddedPostgres } = (await import("embedded-postgres")) as { default: EmbeddedPostgresCtor };
      const port = await allocateEmbeddedPgPort();
      embedded = new EmbeddedPostgres({
        databaseDir: join(dataDir, "db"), user: "test", password: "test", port,
        persistent: false, initdbFlags: ["--encoding=UTF8", "--locale=C"],
      });
      await embedded.initialise();
      await embedded.start();
      const adminUrl = `postgres://test:test@127.0.0.1:${port}/postgres`;
      await applyPendingMigrations(adminUrl);
      admin = postgres(adminUrl, { max: 4 });
      await admin.unsafe(provisionTenantAppRoleLoginSql("aoa_app", PASSWORD));
      app = createTenantAppDbConnection(adminUrl.replace("test:test", `aoa_app:${PASSWORD}`), { max: 8 });
      await admin`INSERT INTO organizations (id, name, slug) VALUES (${ORG}, 'CLI-008 org', 'cli-008-org')`;
      await admin`INSERT INTO organizations (id, name, slug) VALUES (${OTHER_ORG}, 'CLI-008 other', 'cli-008-other')`;
      await admin`INSERT INTO companies (id, organization_id, name, issue_prefix)
        VALUES (${COMPANY}, ${ORG}, 'CLI-008 company', 'C008')`;
      await admin`INSERT INTO companies (id, organization_id, name, issue_prefix)
        VALUES (${OTHER_COMPANY}, ${OTHER_ORG}, 'CLI-008 other company', 'C008O')`;
    } catch (error) {
      setupError = error;
    }
  }, 180_000);

  afterAll(async () => {
    await app?.close({ timeoutSeconds: 5 }).catch(() => {});
    await admin?.end().catch(() => {});
    await embedded?.stop().catch(() => {});
    if (dataDir) await rm(dataDir, { recursive: true, force: true }).catch(() => {});
  });

  it("★ stages a file with NO LEASE ROW and NO FENCE EVER HAVING EXISTED", async () => {
    const { admin, app } = ctx();
    const { jobId, attemptId } = await seedJob();
    const storage = makeStubStorage();
    const content = "# staged by the control plane\n";

    // The precondition, asserted rather than assumed: this attempt has no lease at all.
    const leasesBefore = await admin`SELECT count(*)::int AS n FROM leases WHERE job_id = ${jobId}`;
    expect(leasesBefore[0]?.n).toBe(0);

    const result = await stageJobInputFiles({
      appDb: app.db, storage, organizationId: ORG, jobId, attemptId,
      files: [{ path: "/home/user/.aoa/staged.md", bytes: bytes(content), contentType: "text/markdown" }],
    });

    expect(result.staged).toBe(true);
    if (!result.staged) return;
    expect(result.attempt).toBe(1);
    expect(result.pointers).toHaveLength(1);
    const pointer = result.pointers[0]!;
    expect(pointer.objectKey).toBe(
      `organizations/${ORG}/jobs/${jobId}/attempts/1/${pointer.artifactId}`,
    );
    expect(pointer.sha256).toBe(sha256(content));
    expect(pointer.sizeBytes).toBe(Buffer.byteLength(content));
    // The bytes really crossed the storage port, and they are the file's bytes.
    expect(storage.objects.get(pointer.objectKey)?.toString("utf8")).toBe(content);

    // ★ The committed row exists, carries NO lease and NO fence, and STILL no lease row
    // exists for this job — so no fence has ever existed for it.
    const rows = await admin`SELECT * FROM job_artifacts WHERE job_id = ${jobId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("committed");
    expect(rows[0]?.lease_id).toBeNull();
    expect(rows[0]?.fence_token).toBeNull();
    expect(rows[0]?.kind).toBe(STAGED_INPUT_ARTIFACT_KIND);
    expect(stagedPathFromMarker(rows[0]?.content_type as string)).toBe("/home/user/.aoa/staged.md");
    const leasesAfter = await admin`SELECT count(*)::int AS n FROM leases WHERE job_id = ${jobId}`;
    expect(leasesAfter[0]?.n).toBe(0);

    // And it is exactly what the download branch's precondition looks for.
    const found = await runInTenant(app.db, ORG, async (repos) =>
      repos.jobArtifacts.findCommitted({ jobId, attempt: 1, identifier: pointer.artifactId }),
    );
    expect(found?.objectKey).toBe(pointer.objectKey);
  });

  it("is idempotent per (attempt, path, digest) — a replay writes no second object", async () => {
    const { admin, app } = ctx();
    const { jobId, attemptId } = await seedJob();
    const storage = makeStubStorage();
    const files = [{ path: "/home/user/.aoa/staged.md", bytes: bytes("same bytes") }];

    const first = await stageJobInputFiles({ appDb: app.db, storage, organizationId: ORG, jobId, attemptId, files });
    const second = await stageJobInputFiles({ appDb: app.db, storage, organizationId: ORG, jobId, attemptId, files });

    expect(first.staged && second.staged).toBe(true);
    if (!first.staged || !second.staged) return;
    expect(second.pointers[0]).toEqual(first.pointers[0]);
    expect(storage.puts).toHaveLength(1);
    const rows = await admin`SELECT count(*)::int AS n FROM job_artifacts WHERE job_id = ${jobId}`;
    expect(rows[0]?.n).toBe(1);
  });

  it("★ RLS is real — staging into a FOREIGN organization fails 42501 and writes nothing", async () => {
    const { admin, app } = ctx();
    // A job that belongs to OTHER_ORG, staged from inside ORG's tenant context.
    const { jobId, attemptId } = await seedJob(OTHER_ORG, OTHER_COMPANY);
    const storage = makeStubStorage();

    // The attempt is invisible under ORG's context, so the resolve step already refuses —
    // which is the fail-closed direction. Prove the deeper barrier too, by asking the
    // repository to insert an artifact for a FOREIGN organization directly.
    const refused = await stageJobInputFiles({
      appDb: app.db, storage, organizationId: ORG, jobId, attemptId,
      files: [{ path: "/home/user/.aoa/x.md", bytes: bytes("x") }],
    });
    expect(refused).toEqual({ staged: false, reason: "unknown_attempt" });
    expect(storage.puts).toHaveLength(0);

    await expectSqlState(
      runInTenant(app.db, ORG, async (repos) =>
        repos.jobArtifacts.insert({
          organizationId: OTHER_ORG, jobId, identifier: crypto.randomUUID(), attempt: 1,
          objectKey: `organizations/${OTHER_ORG}/jobs/${jobId}/attempts/1/x`,
          sha256: sha256("x"), sizeBytes: 1, kind: STAGED_INPUT_ARTIFACT_KIND,
          status: "committed", leaseId: null, fenceToken: null,
        }),
      ),
      "42501",
    );

    const rows = await admin`SELECT count(*)::int AS n FROM job_artifacts WHERE job_id = ${jobId}`;
    expect(rows[0]?.n).toBe(0);
  });

  it("★ the composite FK is real — staging for a GHOST job fails 23503", async () => {
    const { app } = ctx();
    const ghostJobId = "c8100000-0000-4000-8000-0000000f0000";
    await expectSqlState(
      runInTenant(app.db, ORG, async (repos) =>
        repos.jobArtifacts.insert({
          organizationId: ORG, jobId: ghostJobId, identifier: crypto.randomUUID(), attempt: 1,
          objectKey: `organizations/${ORG}/jobs/${ghostJobId}/attempts/1/x`,
          sha256: sha256("x"), sizeBytes: 1, kind: STAGED_INPUT_ARTIFACT_KIND,
          status: "committed", leaseId: null, fenceToken: null,
        }),
      ),
      "23503",
    );
  });

  it("deletes the object when the row write fails — no undiscoverable orphan", async () => {
    const { admin, app } = ctx();
    const { jobId, attemptId } = await seedJob();
    const storage = makeStubStorage();
    // A duplicate identifier collides with `job_artifacts_committed_identity_uidx`, which is
    // the realistic way the row write fails after the object has already landed.
    const fixedId = crypto.randomUUID();
    await stageJobInputFiles({
      appDb: app.db, storage, organizationId: ORG, jobId, attemptId,
      newArtifactId: () => fixedId,
      files: [{ path: "/a.md", bytes: bytes("a") }],
    });
    await expect(
      stageJobInputFiles({
        appDb: app.db, storage, organizationId: ORG, jobId, attemptId,
        newArtifactId: () => fixedId,
        // A DIFFERENT path/digest, so the idempotency short-circuit does not fire and the
        // insert genuinely collides.
        files: [{ path: "/b.md", bytes: bytes("b") }],
      }),
    ).rejects.toThrow();

    expect(storage.deletes).toContain(`organizations/${ORG}/jobs/${jobId}/attempts/1/${fixedId}`);
    const rows = await admin`SELECT count(*)::int AS n FROM job_artifacts WHERE job_id = ${jobId}`;
    expect(rows[0]?.n).toBe(1);
  });

  it("stages nothing for an empty file list, and never touches the store", async () => {
    const { app } = ctx();
    const { jobId, attemptId } = await seedJob();
    const storage = makeStubStorage();
    const result = await stageJobInputFiles({
      appDb: app.db, storage, organizationId: ORG, jobId, attemptId, files: [],
    });
    expect(result).toEqual({ staged: false, reason: "no_files" });
    expect(storage.puts).toHaveLength(0);
  });
});
