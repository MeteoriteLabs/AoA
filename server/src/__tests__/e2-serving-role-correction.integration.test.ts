import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import postgres, { type Sql } from "postgres";
import { sql } from "drizzle-orm";
import {
  applyPendingMigrations,
  createDb,
  createTenantAppDb,
  type Db,
} from "@armyofagents/db";
import { allocateEmbeddedPgPort } from "./helpers/embedded-pg-port.js";
import { runInTenant } from "../db/tenant-context.js";
import {
  provisionTenantAppRoleLoginSql,
  TENANT_APP_ROLE,
} from "../db/rls-tenant.js";

type EmbeddedPostgresInstance = { initialise(): Promise<void>; start(): Promise<void>; stop(): Promise<void> };
type EmbeddedPostgresCtor = new (opts: Record<string, unknown>) => EmbeddedPostgresInstance;

const APP_PASSWORD = "app-role-test-password";
const OPERATOR_PASSWORD = "operator-role-test-password";
const ORG_A = "10000000-0000-4000-8000-000000000001";
const ORG_B = "10000000-0000-4000-8000-000000000002";
const COMPANY_A = "20000000-0000-4000-8000-000000000001";
const COMPANY_B = "20000000-0000-4000-8000-000000000002";

const expectedLegacyPrivileges = {
  issues: ["SELECT", "UPDATE"],
  agents: ["SELECT", "UPDATE"],
  task_dependencies: ["SELECT"],
  issue_labels: ["SELECT"],
  labels: ["SELECT"],
  notifications: ["SELECT", "UPDATE"],
  hub_audit: ["INSERT"],
  heartbeat_runs: ["SELECT", "INSERT", "UPDATE"],
  agent_wakeup_requests: ["SELECT", "INSERT", "UPDATE"],
  discussion_entries: ["SELECT", "UPDATE"],
  internal_agent_runs: ["SELECT", "INSERT", "UPDATE"],
  thread_orchestration_state: ["SELECT", "UPDATE"],
  internal_agent_conversations: ["SELECT"],
  internal_agent_messages: ["SELECT"],
  internal_agent_config: ["SELECT"],
  companies: ["SELECT", "UPDATE"],
  organizations: ["SELECT"],
  approvals: ["SELECT", "INSERT", "UPDATE"],
  agent_runtime_decisions: ["SELECT", "INSERT", "UPDATE"],
  agent_runtime_trust_rules: ["SELECT", "INSERT", "UPDATE"],
  internal_agent_runtime_approvals: ["SELECT", "INSERT", "UPDATE"],
  internal_agent_tool_trust_rules: ["SELECT", "INSERT", "UPDATE"],
  budget_policies: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  budget_incidents: ["SELECT", "INSERT", "UPDATE"],
  cost_events: ["SELECT", "INSERT"],
  activity_log: ["SELECT", "INSERT"],
  run_project_links: ["SELECT"],
  projects: ["SELECT"],
  task_outputs: ["SELECT", "INSERT", "UPDATE"],
  issue_comments: ["INSERT"],
  artifacts: ["SELECT"],
  artifact_versions: ["SELECT"],
  assets: ["SELECT"],
  execution_workspaces: ["SELECT"],
  workspace_runtime_services: ["SELECT"],
} as const;

let embedded: EmbeddedPostgresInstance | null = null;
let dataDir = "";
let adminUrl = "";
let appUrl = "";
let operatorUrl = "";
let admin: Sql | null = null;
let ownerDb: Db;
let appDb: Db;
let operator: Sql | null = null;
let setupError: unknown = null;

function rowsOf<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[];
}

function errorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current && typeof current === "object"; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

function guard(): void {
  if (setupError) throw new Error(`embedded-postgres setup failed: ${String(setupError)}`);
}

beforeAll(async () => {
  try {
    dataDir = await mkdtemp(join(tmpdir(), "aoa-e2-role-correction-"));
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
    adminUrl = `postgres://test:test@127.0.0.1:${port}/postgres`;
    await applyPendingMigrations(adminUrl);
    admin = postgres(adminUrl, { max: 1 });
    ownerDb = createDb(adminUrl);

    await admin.unsafe(provisionTenantAppRoleLoginSql(TENANT_APP_ROLE, APP_PASSWORD));
    const operatorRole = await admin<{ exists: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aoa_operator') AS exists
    `;
    if (!operatorRole[0]?.exists) {
      // RED setup only: let the pre-correction migration reach the policy/grant assertions
      // instead of failing merely because the future role does not exist yet.
      await admin.unsafe(
        `CREATE ROLE "aoa_operator" LOGIN PASSWORD '${OPERATOR_PASSWORD}' ` +
          "NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE",
      );
    } else {
      await admin.unsafe(provisionTenantAppRoleLoginSql("aoa_operator", OPERATOR_PASSWORD));
    }

    appUrl = adminUrl.replace("test:test", `aoa_app:${APP_PASSWORD}`);
    operatorUrl = adminUrl.replace("test:test", `aoa_operator:${OPERATOR_PASSWORD}`);
    appDb = createTenantAppDb(appUrl, { max: 1 });
    operator = postgres(operatorUrl, { max: 1 });

    await admin`
      INSERT INTO organizations (id, name, slug)
      VALUES (${ORG_A}, 'Org A', 'role-correction-a'), (${ORG_B}, 'Org B', 'role-correction-b')
    `;
    await admin`
      INSERT INTO companies (id, name, issue_prefix, organization_id)
      VALUES
        (${COMPANY_A}, 'Company A', 'RCA', ${ORG_A}),
        (${COMPANY_B}, 'Company B', 'RCB', ${ORG_B})
    `;
    await admin`
      INSERT INTO workers (scope, organization_id, label)
      VALUES
        ('platform', NULL, 'platform-existing'),
        ('organization', ${ORG_A}, 'tenant-a-worker'),
        ('organization', ${ORG_B}, 'tenant-b-worker')
    `;
    await admin`
      INSERT INTO execution_targets
        (organization_id, slug, kind, trust_class, status, capabilities, config)
      VALUES
        (NULL, 'platform-existing', 'pooled_gvisor', 'shared_multitenant', 'active', '{}', '{}'),
        (${ORG_A}, 'tenant-a-target', 'dedicated_worker', 'dedicated_tenant', 'active', '{}', '{}'),
        (${ORG_B}, 'tenant-b-target', 'dedicated_worker', 'dedicated_tenant', 'active', '{}', '{}')
      ON CONFLICT DO NOTHING
    `;
  } catch (error) {
    setupError = error;
  }
}, 180_000);

afterAll(async () => {
  try { await operator?.end(); } catch { /* ignore */ }
  try { await admin?.end(); } catch { /* ignore */ }
  try { await embedded?.stop(); } catch { /* ignore */ }
  try { if (dataDir) await rm(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
}, 60_000);

describe.skipIf(process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1")(
  "P1 corrective E2 bounded serving/operator roles",
  () => {
    it("grants aoa_app every traced JOB-010..014 legacy operation and denies an unapproved table", async () => {
      guard();
      for (const [table, privileges] of Object.entries(expectedLegacyPrivileges)) {
        for (const privilege of privileges) {
          const [row] = rowsOf<{ allowed: boolean }>(
            await appDb.execute(
              sql`SELECT has_table_privilege(current_user, ${`public.${table}`}, ${privilege}) AS allowed`,
            ),
          );
          expect(row?.allowed, `${table} requires ${privilege}`).toBe(true);
        }
      }

      const [denied] = rowsOf<{ allowed: boolean }>(
        await appDb.execute(
          sql`SELECT has_table_privilege(current_user, 'public.company_secrets', 'SELECT') AS allowed`,
        ),
      );
      expect(denied?.allowed).toBe(false);
      await expect(appDb.execute(sql`SELECT id FROM company_secrets LIMIT 1`)).rejects.toSatisfy(
        (error: unknown) => errorCode(error) === "42501",
      );
    });

    it("keeps tenant RLS and composite-FK enforcement H-01 safe through runInTenant", async () => {
      guard();
      const own = await runInTenant(appDb, ORG_A, (repos) =>
        repos.jobs.insert({ organizationId: ORG_A, companyId: COMPANY_A }),
      );
      expect(own.organizationId).toBe(ORG_A);
      expect(await runInTenant(appDb, ORG_B, (repos) => repos.jobs.getById(own.id))).toBeNull();
      await expect(
        runInTenant(appDb, ORG_A, (repos) =>
          repos.jobs.insert({ organizationId: ORG_A, companyId: COMPANY_B }),
        ),
      ).rejects.toSatisfy((error: unknown) => errorCode(error) === "23503");
    });

    it("restricts aoa_operator reads and writes to null-Organization platform metadata", async () => {
      guard();
      const op = operator!;
      const roles = await admin!<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
        SELECT rolname, rolsuper, rolbypassrls
        FROM pg_roles
        WHERE rolname IN ('aoa_app', 'aoa_operator')
        ORDER BY rolname
      `;
      expect(roles).toEqual([
        { rolname: "aoa_app", rolsuper: false, rolbypassrls: false },
        { rolname: "aoa_operator", rolsuper: false, rolbypassrls: false },
      ]);

      const workers = await op<{ organization_id: string | null; label: string }[]>`
        SELECT organization_id, label FROM workers ORDER BY label
      `;
      expect(workers).toEqual([{ organization_id: null, label: "platform-existing" }]);
      const targets = await op<{ organization_id: string | null; slug: string }[]>`
        SELECT organization_id, slug FROM execution_targets ORDER BY slug
      `;
      expect(targets).toEqual([{ organization_id: null, slug: "platform-existing" }]);

      await op`
        INSERT INTO workers (scope, organization_id, label)
        VALUES ('platform', NULL, 'platform-created')
      `;
      await op`
        INSERT INTO execution_targets
          (organization_id, slug, kind, trust_class, status, capabilities, config)
        VALUES
          (NULL, 'platform-created', 'pooled_gvisor', 'shared_multitenant', 'active', '{}', '{}')
      `;
      await op`UPDATE workers SET status = 'active' WHERE label = 'platform-created'`;
      await op`UPDATE execution_targets SET status = 'draining' WHERE slug = 'platform-created'`;
      expect((await op<{ c: number }[]>`SELECT count(*)::int AS c FROM workers`)[0]?.c).toBe(2);
      expect((await op<{ c: number }[]>`SELECT count(*)::int AS c FROM execution_targets`)[0]?.c).toBe(2);

      await expect(
        op`INSERT INTO workers (scope, organization_id, label) VALUES ('organization', ${ORG_A}, 'forbidden')`,
      ).rejects.toSatisfy((error: unknown) => errorCode(error) === "42501");
      await expect(
        op`
          INSERT INTO execution_targets
            (organization_id, slug, kind, trust_class, status, capabilities, config)
          VALUES
            (${ORG_A}, 'forbidden', 'dedicated_worker', 'dedicated_tenant', 'active', '{}', '{}')
        `,
      ).rejects.toSatisfy((error: unknown) => errorCode(error) === "42501");
    });

    it.each([
      "jobs",
      "job_attempts",
      "leases",
      "services",
      "service_instances",
      "job_artifacts",
      "job_secret_handles",
      "heartbeat_run_events",
      "artifacts",
      "company_secrets",
    ])("denies aoa_operator any access to %s", async (table) => {
      guard();
      await expect(operator!.unsafe(`SELECT * FROM "${table}" LIMIT 1`)).rejects.toSatisfy(
        (error: unknown) => errorCode(error) === "42501",
      );
    });
  },
);
