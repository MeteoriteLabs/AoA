import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import net from "node:net";
import postgres, { type Sql } from "postgres";
import { applyPendingMigrations } from "../client.js";

type EmbeddedPostgresInstance = { initialise(): Promise<void>; start(): Promise<void>; stop(): Promise<void> };
type EmbeddedPostgresCtor = new (opts: Record<string, unknown>) => EmbeddedPostgresInstance;

let embedded: EmbeddedPostgresInstance | null = null;
let dataDir = "";
let db: Sql | null = null;
let setupError: unknown = null;

async function allocatePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else if (!address || typeof address === "string") reject(new Error("port allocation failed"));
        else resolve(address.port);
      });
    });
    server.on("error", reject);
  });
}

function database(): Sql {
  if (setupError) throw new Error(`embedded-postgres setup failed: ${String(setupError)}`);
  if (!db) throw new Error("database was not initialized");
  return db;
}

async function replayMigration(client: Sql, fileName: string): Promise<void> {
  const source = readFileSync(new URL(`../migrations/${fileName}`, import.meta.url), "utf8");
  for (const statement of source.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) {
    await client.unsafe(statement);
  }
}

beforeAll(async () => {
  try {
    dataDir = await mkdtemp(join(tmpdir(), "aoa-job-leasing-schema-"));
    const { default: EmbeddedPostgres } = (await import("embedded-postgres")) as {
      default: EmbeddedPostgresCtor;
    };
    const port = await allocatePort();
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
    const url = `postgres://test:test@127.0.0.1:${port}/postgres`;
    await applyPendingMigrations(url);
    db = postgres(url, { max: 1 });
  } catch (error) {
    setupError = error;
  }
}, 180_000);

afterAll(async () => {
  try { await db?.end(); } catch { /* ignore */ }
  try { await embedded?.stop(); } catch { /* ignore */ }
  try { if (dataDir) await rm(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
}, 60_000);

describe.skipIf(process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1")(
  "JOB-003 lease and operation-receipt authority schema",
  () => {
    it("persists the complete tenant lease identity and bounded semantic receipt facts", async () => {
      const client = database();
      const columns = await client<{ table_name: string; column_name: string }[]>`
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('leases', 'worker_operation_receipts')
      `;
      const names = new Set(columns.map((row) => `${row.table_name}.${row.column_name}`));
      for (const name of [
        "leases.company_id",
        "leases.job_id",
        "leases.attempt_number",
        "leases.worker_id",
        "leases.target_id",
        "leases.target_authority_key",
        "leases.target_generation",
        "leases.profile_hash",
        "leases.provider_constraint_hash",
        "leases.ack_deadline",
        "leases.expires_at",
        "leases.activated_at",
        "worker_operation_receipts.organization_id",
        "worker_operation_receipts.company_id",
        "worker_operation_receipts.operation",
        "worker_operation_receipts.worker_id",
        "worker_operation_receipts.target_id",
        "worker_operation_receipts.target_generation",
        "worker_operation_receipts.profile_hash",
        "worker_operation_receipts.idempotency_key",
        "worker_operation_receipts.semantic_digest",
        "worker_operation_receipts.outcome",
        "worker_operation_receipts.expires_at",
      ]) expect(names, name).toContain(name);
      expect(names).not.toContain("worker_operation_receipts.fence");
      expect(names).not.toContain("worker_operation_receipts.session");
      expect(names).not.toContain("worker_operation_receipts.proof_id");
    });

    it("binds leases and receipts to one organization/company/job/attempt/worker/target chain", async () => {
      const client = database();
      const constraints = await client<{ table_name: string; constraint_name: string; definition: string }[]>`
        SELECT rel.relname AS table_name, con.conname AS constraint_name,
          pg_get_constraintdef(con.oid) AS definition
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        WHERE rel.relname IN ('leases', 'worker_operation_receipts')
      `;
      const byName = new Map(constraints.map((row) => [row.constraint_name, row]));
      expect(byName.get("leases_org_company_job_attempt_fk")?.definition).toContain(
        "FOREIGN KEY (organization_id, company_id, job_id, attempt_id) REFERENCES job_attempts(organization_id, company_id, job_id, id)",
      );
      expect(byName.get("leases_org_worker_fk")?.definition).toContain(
        "FOREIGN KEY (organization_id, worker_id) REFERENCES workers(organization_id, id)",
      );
      expect(byName.get("leases_target_authority_fk")?.definition).toContain(
        "FOREIGN KEY (target_authority_key, target_id) REFERENCES execution_targets(target_authority_key, id)",
      );
      expect(byName.get("worker_operation_receipts_lease_fk")?.definition).toContain(
        "FOREIGN KEY (organization_id, company_id, job_id, attempt_id, lease_id)",
      );
    });

    it("keeps one offered or active lease per attempt and one semantic key per authenticated scope", async () => {
      const client = database();
      const indexes = await client<{ tablename: string; indexname: string; indexdef: string }[]>`
        SELECT tablename, indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename IN ('leases', 'worker_operation_receipts')
      `;
      const active = indexes.find((row) => row.indexname === "leases_active_per_attempt_idx")?.indexdef ?? "";
      const receipt = indexes.find((row) => row.indexname === "worker_operation_receipts_scope_key_uq")?.indexdef ?? "";
      expect(active).toContain("UNIQUE");
      expect(active).toContain("status = ANY");
      expect(active).toContain("offered");
      expect(active).toContain("active");
      expect(receipt).toContain("organization_id");
      expect(receipt).toContain("worker_id");
      expect(receipt).toContain("target_id");
      expect(receipt).toContain("target_generation");
      expect(receipt).toContain("profile_hash");
      expect(receipt).toContain("operation");
      expect(receipt).toContain("idempotency_key");
    });

    it("retains activation history when an active lease reaches a terminal state", async () => {
      const client = database();
      const organizationId = "30000000-0000-4000-8000-000000000001";
      const companyId = "30000000-0000-4000-8000-000000000002";
      const jobId = "30000000-0000-4000-8000-000000000003";
      const attemptId = "30000000-0000-4000-8000-000000000004";
      const leaseId = "30000000-0000-4000-8000-000000000005";

      await client`INSERT INTO organizations (id, name, slug) VALUES (${organizationId}, 'Lease history org', 'lease-history-org')`;
      await client`INSERT INTO companies (id, organization_id, name, issue_prefix) VALUES (${companyId}, ${organizationId}, 'Lease history company', 'LHIST')`;
      await client`INSERT INTO jobs (id, organization_id, company_id) VALUES (${jobId}, ${organizationId}, ${companyId})`;
      await client`INSERT INTO job_attempts (id, organization_id, company_id, job_id) VALUES (${attemptId}, ${organizationId}, ${companyId}, ${jobId})`;
      await client`
        INSERT INTO leases (id, organization_id, attempt_id, status, fence, activated_at)
        VALUES (${leaseId}, ${organizationId}, ${attemptId}, 'active', 'legacy-history-fence', clock_timestamp())
      `;
      await expect(client`
        UPDATE leases SET status = 'released', released_at = clock_timestamp()
        WHERE id = ${leaseId}
        RETURNING id
      `).resolves.toHaveLength(1);
    });

    it("forces tenant RLS, grants no operator access, and replays both JOB-003 migrations", async () => {
      const client = database();
      const [security] = await client<{
        rls: boolean;
        forced: boolean;
        app_select: boolean;
        app_insert: boolean;
        operator_select: boolean;
      }[]>`
        SELECT rel.relrowsecurity AS rls, rel.relforcerowsecurity AS forced,
          has_table_privilege('aoa_app', 'worker_operation_receipts', 'SELECT') AS app_select,
          has_table_privilege('aoa_app', 'worker_operation_receipts', 'INSERT') AS app_insert,
          has_table_privilege('aoa_operator', 'worker_operation_receipts', 'SELECT') AS operator_select
        FROM pg_class rel
        WHERE rel.relname = 'worker_operation_receipts'
      `;
      expect(security).toEqual({
        rls: true,
        forced: true,
        app_select: true,
        app_insert: true,
        operator_select: false,
      });
      await replayMigration(client, "0227_job_leasing_authority.sql");
      await replayMigration(client, "0228_job_leasing_rls.sql");
    });
  },
);
