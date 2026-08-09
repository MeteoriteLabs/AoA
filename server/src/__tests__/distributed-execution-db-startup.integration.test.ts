import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import postgres, { type Sql } from "postgres";
import { applyPendingMigrations } from "@armyofagents/db";
import { allocateEmbeddedPgPort } from "./helpers/embedded-pg-port.js";
import {
  provisionTenantAppRoleLoginSql,
  TENANT_APP_ROLE,
} from "../db/rls-tenant.js";

type EmbeddedPostgresInstance = { initialise(): Promise<void>; start(): Promise<void>; stop(): Promise<void> };
type EmbeddedPostgresCtor = new (opts: Record<string, unknown>) => EmbeddedPostgresInstance;

const APP_PASSWORD = "startup-app-password";
const OPERATOR_PASSWORD = "startup-operator-password";
const LEGACY_OWNER_PASSWORD = "startup-legacy-owner-password";

let embedded: EmbeddedPostgresInstance | null = null;
let dataDir = "";
let adminUrl = "";
let appUrl = "";
let operatorUrl = "";
let legacyOwnerUrl = "";
let admin: Sql | null = null;
let setupError: unknown = null;

function guard(): void {
  if (setupError) throw new Error(`embedded-postgres setup failed: ${String(setupError)}`);
}

beforeAll(async () => {
  try {
    dataDir = await mkdtemp(join(tmpdir(), "aoa-distributed-startup-"));
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
    await admin.unsafe(provisionTenantAppRoleLoginSql(TENANT_APP_ROLE, APP_PASSWORD));
    const exists = await admin<{ exists: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aoa_operator') AS exists
    `;
    if (!exists[0]?.exists) {
      await admin.unsafe(
        `CREATE ROLE "aoa_operator" LOGIN PASSWORD '${OPERATOR_PASSWORD}' ` +
          "NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE",
      );
    } else {
      await admin.unsafe(provisionTenantAppRoleLoginSql("aoa_operator", OPERATOR_PASSWORD));
    }
    appUrl = adminUrl.replace("test:test", `aoa_app:${APP_PASSWORD}`);
    operatorUrl = adminUrl.replace("test:test", `aoa_operator:${OPERATOR_PASSWORD}`);
    await admin.unsafe(
      `CREATE ROLE "aoa_legacy_table_owner" LOGIN PASSWORD '${LEGACY_OWNER_PASSWORD}' ` +
        "NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION",
    );
    await admin.unsafe(`GRANT USAGE ON SCHEMA public, drizzle TO "aoa_legacy_table_owner"`);
    await admin.unsafe(`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "aoa_legacy_table_owner"`);
    await admin.unsafe(`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO "aoa_legacy_table_owner"`);
    await admin.unsafe(`GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO "aoa_legacy_table_owner"`);
    await admin.unsafe(`ALTER TABLE execution_targets OWNER TO "aoa_legacy_table_owner"`);
    legacyOwnerUrl = adminUrl.replace("test:test", `aoa_legacy_table_owner:${LEGACY_OWNER_PASSWORD}`);
  } catch (error) {
    setupError = error;
  }
}, 180_000);

afterAll(async () => {
  try { await admin?.end(); } catch { /* ignore */ }
  try { await embedded?.stop(); } catch { /* ignore */ }
  try { if (dataDir) await rm(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
}, 60_000);

async function observeStartup(input: {
  appDatabaseUrl: string;
  operatorDatabaseUrl: string;
  expectedRole: "aoa_app" | "aoa_operator";
}): Promise<{ exited: boolean; code: number | null; output: string }> {
  return observeServer({
    databaseUrl: adminUrl,
    distributedEnabled: true,
    appDatabaseUrl: input.appDatabaseUrl,
    operatorDatabaseUrl: input.operatorDatabaseUrl,
    expectedFailureText: input.expectedRole,
  });
}

async function observeServer(input: {
  databaseUrl: string;
  distributedEnabled: boolean;
  appDatabaseUrl?: string;
  operatorDatabaseUrl?: string;
  expectedFailureText?: string;
}): Promise<{ exited: boolean; code: number | null; output: string }> {
  const httpPort = await allocateEmbeddedPgPort();
  const serverEntry = resolve(process.cwd(), "src/index.ts");
  const child = spawn(process.execPath, ["--import", "tsx", serverEntry], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: input.databaseUrl,
      AOA_DISTRIBUTED_EXECUTION_ENABLED: input.distributedEnabled ? "true" : "false",
      ...(input.appDatabaseUrl ? { AOA_APP_DATABASE_URL: input.appDatabaseUrl } : {}),
      ...(input.operatorDatabaseUrl ? { AOA_OPERATOR_DATABASE_URL: input.operatorDatabaseUrl } : {}),
      AOA_DEPLOYMENT_MODE: "local_trusted",
      AOA_DEV_LOCAL_IDENTITY: "1",
      AOA_MIGRATION_AUTO_APPLY: "true",
      SERVE_UI: "false",
      HOST: "127.0.0.1",
      PORT: String(httpPort),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  const exit = new Promise<{ kind: "exit"; code: number | null }>((resolveExit) => {
    child.once("exit", (code) => resolveExit({ kind: "exit", code }));
  });
  const pollAbort = new AbortController();
  const started = (async (): Promise<{ kind: "started"; code: null } | never> => {
    while (!pollAbort.signal.aborted) {
      try {
        const response = await fetch(`http://127.0.0.1:${httpPort}/api/health`);
        if (response.ok) return { kind: "started", code: null };
      } catch {
        // Startup is still in progress or has failed; the exit promise wins on failure.
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
    return await new Promise<never>(() => {});
  })();
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<{ kind: "timeout"; code: null }>((resolveTimeout) => {
    timeoutHandle = setTimeout(() => resolveTimeout({ kind: "timeout", code: null }), 30_000);
  });

  const outcome = await Promise.race([exit, started, timeout]);
  pollAbort.abort();
  if (timeoutHandle) clearTimeout(timeoutHandle);
  if (outcome.kind === "timeout") {
    child.kill("SIGTERM");
    await Promise.race([exit, new Promise((resolveDelay) => setTimeout(resolveDelay, 5_000))]);
    throw new Error(`server startup timed out before health or exit:\n${output}`);
  }
  if (outcome.kind === "started") {
    child.kill("SIGTERM");
    await Promise.race([exit, new Promise((resolveDelay) => setTimeout(resolveDelay, 5_000))]);
    return { exited: false, code: null, output };
  }
  if (input.expectedFailureText) {
    expect(output.toLowerCase()).toContain(input.expectedFailureText.toLowerCase());
  }
  return { exited: true, code: outcome.code, output };
}

describe.skipIf(process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1")(
  "distributed-execution non-owner startup gate",
  () => {
    it("keeps the real flag-off server usable with a non-superuser execution_targets owner", async () => {
      guard();
      const result = await observeServer({
        databaseUrl: legacyOwnerUrl,
        distributedEnabled: false,
      });
      expect(result.exited, result.output).toBe(false);

      const legacyOwner = postgres(legacyOwnerUrl, { max: 1 });
      try {
        await legacyOwner`
          INSERT INTO execution_targets
            (organization_id, slug, kind, trust_class, status, capabilities, config)
          VALUES
            (NULL, 'flag-off-legacy-owner', 'local_host', 'local_trusted', 'active', '{}', '{}')
          ON CONFLICT DO NOTHING
        `;
        const rows = await legacyOwner<{ slug: string }[]>`
          SELECT slug FROM execution_targets WHERE slug = 'flag-off-legacy-owner'
        `;
        expect(rows).toEqual([{ slug: "flag-off-legacy-owner" }]);
      } finally {
        await legacyOwner.end();
      }
    }, 60_000);

    it("fails closed before serving when the aoa_app connection cannot open", async () => {
      guard();
      const result = await observeStartup({
        appDatabaseUrl: appUrl.replace(APP_PASSWORD, "wrong-password"),
        operatorDatabaseUrl: operatorUrl,
        expectedRole: "aoa_app",
      });
      expect(result.exited).toBe(true);
      expect(result.code).not.toBe(0);
    }, 60_000);

    it("fails closed before serving when the aoa_operator connection cannot open", async () => {
      guard();
      const result = await observeStartup({
        appDatabaseUrl: appUrl,
        operatorDatabaseUrl: operatorUrl.replace(OPERATOR_PASSWORD, "wrong-password"),
        expectedRole: "aoa_operator",
      });
      expect(result.exited).toBe(true);
      expect(result.code).not.toBe(0);
    }, 60_000);

    it.each(["aoa_app", "aoa_operator"] as const)(
      "rejects an owner-pool fallback for %s even when that connection opens",
      async (expectedRole) => {
      guard();
      const result = await observeStartup({
        appDatabaseUrl: expectedRole === "aoa_app" ? adminUrl : appUrl,
        operatorDatabaseUrl: expectedRole === "aoa_operator" ? adminUrl : operatorUrl,
        expectedRole,
      });
      expect(result.exited).toBe(true);
      expect(result.code).not.toBe(0);
      },
      60_000,
    );

    it("rejects an exact-named app role with inherited secret authority", async () => {
      guard();
      await admin!.unsafe(`CREATE ROLE "aoa_startup_drift_parent" NOLOGIN`);
      await admin!.unsafe(`GRANT SELECT ON company_secrets TO "aoa_startup_drift_parent"`);
      await admin!.unsafe(`GRANT "aoa_startup_drift_parent" TO aoa_app`);
      try {
        const result = await observeStartup({
          appDatabaseUrl: appUrl,
          operatorDatabaseUrl: operatorUrl,
          expectedRole: "aoa_app",
        });
        expect(result.exited).toBe(true);
        expect(result.code).not.toBe(0);
      } finally {
        await admin!.unsafe(`REVOKE "aoa_startup_drift_parent" FROM aoa_app`).catch(() => {});
        await admin!.unsafe(`DROP ROLE IF EXISTS "aoa_startup_drift_parent"`).catch(() => {});
      }
    }, 60_000);

    it("rejects an exact-named operator role with a stale table grant", async () => {
      guard();
      await admin!.unsafe(`GRANT SELECT ON company_secrets TO aoa_operator`);
      try {
        const result = await observeStartup({
          appDatabaseUrl: appUrl,
          operatorDatabaseUrl: operatorUrl,
          expectedRole: "aoa_operator",
        });
        expect(result.exited).toBe(true);
        expect(result.code).not.toBe(0);
      } finally {
        await admin!.unsafe(`REVOKE SELECT ON company_secrets FROM aoa_operator`).catch(() => {});
      }
    }, 60_000);

    it("rejects an exact-named operator role that owns an application object", async () => {
      guard();
      await admin!.unsafe(`CREATE TABLE startup_owned_drift_probe (id integer)`);
      await admin!.unsafe(`ALTER TABLE startup_owned_drift_probe OWNER TO aoa_operator`);
      try {
        const result = await observeStartup({
          appDatabaseUrl: appUrl,
          operatorDatabaseUrl: operatorUrl,
          expectedRole: "aoa_operator",
        });
        expect(result.exited).toBe(true);
        expect(result.code).not.toBe(0);
      } finally {
        await admin!.unsafe(`DROP TABLE IF EXISTS startup_owned_drift_probe`).catch(() => {});
      }
    }, 60_000);

    it("rejects replication authority on an exact-named serving role", async () => {
      guard();
      await admin!.unsafe(`ALTER ROLE aoa_operator REPLICATION`);
      try {
        const result = await observeStartup({
          appDatabaseUrl: appUrl,
          operatorDatabaseUrl: operatorUrl,
          expectedRole: "aoa_operator",
        });
        expect(result.exited).toBe(true);
        expect(result.code).not.toBe(0);
      } finally {
        await admin!.unsafe(`ALTER ROLE aoa_operator NOREPLICATION`).catch(() => {});
      }
    }, 60_000);
  },
);
