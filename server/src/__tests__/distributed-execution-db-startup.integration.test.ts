import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import postgres, { type Sql } from "postgres";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { applyPendingMigrations, type Db } from "@armyofagents/db";
import * as dbSchema from "@armyofagents/db";
import { allocateEmbeddedPgPort } from "./helpers/embedded-pg-port.js";
import {
  provisionTenantAppRoleLoginSql,
  TENANT_APP_ROLE,
} from "../db/rls-tenant.js";
import { openDistributedExecutionDatabases } from "../db/distributed-execution-databases.js";

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
let otherAdminUrl = "";
let otherAppUrl = "";
let otherOperatorUrl = "";
let admin: Sql | null = null;
let ownerClient: Sql | null = null;
let ownerDb: Db | null = null;
let setupError: unknown = null;

function guard(): void {
  if (setupError) throw new Error(`embedded-postgres setup failed: ${String(setupError)}`);
}

function withStartupRole(url: string, role: "aoa_app" | "aoa_operator"): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}options=${encodeURIComponent(`-c role=${role}`)}`;
}

type RequiredMigrationIdentity = { orderedHashes: readonly string[]; ledgerSha256: string };

function checkedInMigrationIdentity(): RequiredMigrationIdentity {
  const journal = JSON.parse(readFileSync(
    new URL("../../../packages/db/src/migrations/meta/_journal.json", import.meta.url),
    "utf8",
  )) as { entries?: Array<{ idx?: number; tag?: string }> };
  const orderedHashes = [...(journal.entries ?? [])]
    .sort((left, right) => Number(left.idx) - Number(right.idx))
    .map((entry) => createHash("sha256").update(readFileSync(
      new URL(`../../../packages/db/src/migrations/${entry.tag}.sql`, import.meta.url),
    )).digest("hex"));
  return {
    orderedHashes,
    ledgerSha256: createHash("sha256").update(JSON.stringify(orderedHashes)).digest("hex"),
  };
}

const openFinalStartup = openDistributedExecutionDatabases as unknown as (input: {
  enabled: boolean;
  ownerDb: Db;
  requiredMigrationIdentity: RequiredMigrationIdentity;
  appDatabaseUrl: string | undefined;
  operatorDatabaseUrl: string | undefined;
}) => ReturnType<typeof openDistributedExecutionDatabases>;

function finalStartupInput(input: {
  appDatabaseUrl: string;
  operatorDatabaseUrl: string;
}) {
  if (!ownerDb) throw new Error("owner database was not initialized");
  return {
    enabled: true,
    ownerDb,
    requiredMigrationIdentity: checkedInMigrationIdentity(),
    ...input,
  };
}

async function captureFinalStartupFailure(): Promise<unknown> {
  let accepted: Awaited<ReturnType<typeof openDistributedExecutionDatabases>> = null;
  try {
    accepted = await openFinalStartup(finalStartupInput({
      appDatabaseUrl: appUrl,
      operatorDatabaseUrl: operatorUrl,
    }));
    return undefined;
  } catch (error) {
    return error;
  } finally {
    await accepted?.close().catch(() => {});
  }
}

const LEASE_REJECTION_POLICY_SQL = `CREATE POLICY worker_lease_rejections_tenant_isolation
  ON worker_lease_rejections AS PERMISSIVE FOR ALL TO aoa_app
  USING (organization_id = current_setting('aoa.organization_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('aoa.organization_id', true)::uuid)`;

async function restoreLeaseRejectionPolicy(): Promise<void> {
  await admin!.unsafe(`DROP POLICY IF EXISTS worker_lease_rejections_tenant_isolation
    ON worker_lease_rejections`);
  await admin!.unsafe(LEASE_REJECTION_POLICY_SQL);
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
    ownerClient = postgres(adminUrl, { max: 4 });
    ownerDb = drizzlePg(ownerClient, { schema: dbSchema }) as unknown as Db;
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
    await admin.unsafe(`CREATE DATABASE startup_other`);
    otherAdminUrl = adminUrl.replace(/\/postgres$/, "/startup_other");
    await applyPendingMigrations(otherAdminUrl);
    otherAppUrl = otherAdminUrl.replace("test:test", `aoa_app:${APP_PASSWORD}`);
    otherOperatorUrl = otherAdminUrl.replace("test:test", `aoa_operator:${OPERATOR_PASSWORD}`);
  } catch (error) {
    setupError = error;
  }
}, 180_000);

afterAll(async () => {
  try { await ownerClient?.end(); } catch { /* ignore */ }
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
  sentinelMode?: "deny" | "record";
}): Promise<{ exited: boolean; code: number | null; output: string }> {
  const httpPort = await allocateEmbeddedPgPort();
  const serverEntry = fileURLToPath(new URL("../index.ts", import.meta.url));
  const sentinel = pathToFileURL(
    fileURLToPath(new URL("./fixtures/job-control-module-load-sentinel.mjs", import.meta.url)),
  ).href;
  const child = spawn(process.execPath, [
    ...(input.sentinelMode ? ["--import", sentinel] : []),
    "--import", "tsx", serverEntry,
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: input.databaseUrl,
      AOA_DISTRIBUTED_EXECUTION_ENABLED: input.distributedEnabled ? "true" : "false",
      ...(input.distributedEnabled
        ? { AOA_WORKER_SESSION_SIGNING_KEY: "job003-startup-fixture-signing-key-0001" }
        : {}),
      ...(input.appDatabaseUrl ? { AOA_APP_DATABASE_URL: input.appDatabaseUrl } : {}),
      ...(input.operatorDatabaseUrl ? { AOA_OPERATOR_DATABASE_URL: input.operatorDatabaseUrl } : {}),
      AOA_DEPLOYMENT_MODE: "local_trusted",
      AOA_DEV_LOCAL_IDENTITY: "1",
      AOA_MIGRATION_AUTO_APPLY: "true",
      SERVE_UI: "false",
      HOST: "127.0.0.1",
      PORT: String(httpPort),
      ...(input.sentinelMode ? { AOA_JOB_CONTROL_MODULE_LOAD_SENTINEL: input.sentinelMode } : {}),
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
            (organization_id, slug, kind, trust_class, status, capabilities, config, scope, target_authority_key)
          VALUES
            (NULL, 'flag-off-legacy-owner', 'local_host', 'local_trusted', 'active', '{}', '{}', 'platform', 'platform')
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

    it("accepts only the exact aoa_app certificate DML allowlist and denies operator access", async () => {
      guard();
      const [certificate] = await admin!<{
        relation: string | null;
        app_privileges: string[] | null;
        operator_privileges: string[] | null;
      }[]>`
        SELECT to_regclass('public.worker_lease_rejections')::text AS relation,
          CASE WHEN to_regclass('public.worker_lease_rejections') IS NULL THEN NULL ELSE ARRAY(
            SELECT privilege_type FROM information_schema.role_table_grants
            WHERE grantee = 'aoa_app' AND table_schema = 'public'
              AND table_name = 'worker_lease_rejections'
            ORDER BY privilege_type
          ) END AS app_privileges,
          CASE WHEN to_regclass('public.worker_lease_rejections') IS NULL THEN NULL ELSE ARRAY(
            SELECT privilege_type FROM information_schema.role_table_grants
            WHERE grantee = 'aoa_operator' AND table_schema = 'public'
              AND table_name = 'worker_lease_rejections'
            ORDER BY privilege_type
          ) END AS operator_privileges
      `;
      expect.soft(certificate).toEqual({
        relation: "worker_lease_rejections",
        app_privileges: ["DELETE", "INSERT", "SELECT", "UPDATE"],
        operator_privileges: [],
      });
      if (certificate?.relation !== "worker_lease_rejections") return;

      const result = await observeStartup({
        appDatabaseUrl: appUrl,
        operatorDatabaseUrl: operatorUrl,
        expectedRole: "aoa_app",
      });
      expect(result.exited, result.output).toBe(false);
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

    it.each(["aoa_app", "aoa_operator"] as const)(
      "rejects a superuser session masked as %s by a startup role option in the direct pool gate",
      async (expectedRole) => {
        guard();
        const maskedOwnerUrl = withStartupRole(adminUrl, expectedRole);
        const maskedOwner = postgres(maskedOwnerUrl, { max: 1 });
        try {
          const [masked] = await maskedOwner<{
            session_user: string;
            current_user: string;
          }[]>`SELECT session_user, current_user`;
          expect(masked).toEqual({ session_user: "test", current_user: expectedRole });
          await maskedOwner`SET ROLE NONE`;
          const [restored] = await maskedOwner<{
            session_user: string;
            current_user: string;
            rolsuper: boolean;
          }[]>`
            SELECT session_user, current_user, role.rolsuper
            FROM pg_roles role
            WHERE role.rolname = current_user
          `;
          expect(restored).toEqual({ session_user: "test", current_user: "test", rolsuper: true });
        } finally {
          await maskedOwner.end();
        }

        let accepted: Awaited<ReturnType<typeof openDistributedExecutionDatabases>> = null;
        let failure: unknown;
        try {
          accepted = await openFinalStartup(finalStartupInput({
            appDatabaseUrl: expectedRole === "aoa_app" ? maskedOwnerUrl : appUrl,
            operatorDatabaseUrl: expectedRole === "aoa_operator" ? maskedOwnerUrl : operatorUrl,
          }));
        } catch (error) {
          failure = error;
        } finally {
          await accepted?.close();
        }
        expect(failure).toBeInstanceOf(Error);
        expect(String(failure)).toContain(expectedRole);
      },
      60_000,
    );

    it.each(["aoa_app", "aoa_operator"] as const)(
      "rejects a superuser session masked as %s before the real server reaches health",
      async (expectedRole) => {
        guard();
        const maskedOwnerUrl = withStartupRole(adminUrl, expectedRole);
        const result = await observeStartup({
          appDatabaseUrl: expectedRole === "aoa_app" ? maskedOwnerUrl : appUrl,
          operatorDatabaseUrl: expectedRole === "aoa_operator" ? maskedOwnerUrl : operatorUrl,
          expectedRole,
        });
        expect(result.exited, result.output).toBe(true);
        expect(result.code).not.toBe(0);
      },
      60_000,
    );

    it("rejects an operator-granted view over company_secrets before serving", async () => {
      guard();
      await admin!.unsafe(`CREATE VIEW operator_secret_view AS SELECT id FROM company_secrets`);
      await admin!.unsafe(`GRANT SELECT ON operator_secret_view TO aoa_operator`);
      try {
        const result = await observeStartup({
          appDatabaseUrl: appUrl,
          operatorDatabaseUrl: operatorUrl,
          expectedRole: "aoa_operator",
        });
        expect(result.exited, result.output).toBe(true);
        expect(result.code).not.toBe(0);
      } finally {
        await admin!.unsafe(`DROP VIEW IF EXISTS operator_secret_view`).catch(() => {});
      }
    }, 60_000);

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
        await admin!.unsafe(`REVOKE SELECT ON company_secrets FROM "aoa_startup_drift_parent"`).catch(() => {});
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

    it.each([
      ["app", () => otherAppUrl, () => operatorUrl],
      ["operator", () => appUrl, () => otherOperatorUrl],
    ] as const)("rejects a fully migrated %s pool on another valid database before returning either pool", async (
      _participant,
      appDatabaseUrl,
      operatorDatabaseUrl,
    ) => {
      guard();
      const selectedAppUrl = appDatabaseUrl();
      const selectedOperatorUrl = operatorDatabaseUrl();
      let accepted: Awaited<ReturnType<typeof openDistributedExecutionDatabases>> = null;
      let failure: unknown;
      try {
        accepted = await openFinalStartup(finalStartupInput({
          appDatabaseUrl: selectedAppUrl,
          operatorDatabaseUrl: selectedOperatorUrl,
        }));
      } catch (error) {
        failure = error;
      } finally {
        await accepted?.close().catch(() => {});
      }
      expect(failure).toMatchObject({ message: "distributed_execution_advisory_domain" });
      expect(String(failure)).not.toContain(selectedAppUrl);
      expect(String(failure)).not.toContain(selectedOperatorUrl);
    }, 60_000);

    it("uses exact migration hashes so a missing row fails and a repaired out-of-order serial ID succeeds", async () => {
      guard();
      const [removed] = await admin!.unsafe<Array<{ hash: string; created_at: string | number | null }>>(
        `DELETE FROM drizzle.__drizzle_migrations
         WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations)
         RETURNING hash, created_at`,
      );
      expect(removed?.hash).toMatch(/^[0-9a-f]{64}$/);
      if (!removed) return;
      try {
        let failure: unknown;
        try {
          const unexpected = await openFinalStartup(finalStartupInput({
            appDatabaseUrl: appUrl,
            operatorDatabaseUrl: operatorUrl,
          }));
          await unexpected?.close();
        } catch (error) {
          failure = error;
        }
        expect(failure).toMatchObject({ message: "distributed_execution_migration_identity" });
      } finally {
        await admin!.unsafe(
          "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
          [removed.hash, removed.created_at],
        );
      }

      const repaired = await openFinalStartup(finalStartupInput({
        appDatabaseUrl: appUrl,
        operatorDatabaseUrl: operatorUrl,
      }));
      expect(repaired).not.toBeNull();
      await repaired?.close();
    }, 60_000);

    it.each([
      ["an extra unmapped hash", async () => "e".repeat(64)],
      ["a duplicate hash", async () => {
        const [row] = await admin!<{ hash: string }[]>`
          SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 1`;
        return row!.hash;
      }],
      ["an unreadable hash", async () => "not-a-sha256"],
    ] as const)("fails migration identity for %s", async (_caseName, buildHash) => {
      guard();
      const hash = await buildHash();
      const [inserted] = await admin!.unsafe<Array<{ id: number }>>(
        "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2) RETURNING id",
        [hash, Date.now()],
      );
      try {
        let accepted: Awaited<ReturnType<typeof openDistributedExecutionDatabases>> = null;
        let failure: unknown;
        try {
          accepted = await openFinalStartup(finalStartupInput({
            appDatabaseUrl: appUrl,
            operatorDatabaseUrl: operatorUrl,
          }));
        } catch (error) {
          failure = error;
        } finally {
          await accepted?.close().catch(() => {});
        }
        expect(failure).toMatchObject({ message: "distributed_execution_migration_identity" });
      } finally {
        await admin!.unsafe("DELETE FROM drizzle.__drizzle_migrations WHERE id = $1", [inserted!.id]);
      }
    }, 60_000);

    it("fails the exact RLS certificate when FORCE is disabled even though effective DML is unchanged", async () => {
      guard();
      await admin!.unsafe(`ALTER TABLE worker_lease_rejections NO FORCE ROW LEVEL SECURITY`);
      try {
        let failure: unknown;
        try {
          const unexpected = await openFinalStartup(finalStartupInput({
            appDatabaseUrl: appUrl,
            operatorDatabaseUrl: operatorUrl,
          }));
          await unexpected?.close();
        } catch (error) { failure = error; }
        expect(failure).toMatchObject({ message: "distributed_execution_app_authority" });
      } finally {
        await admin!.unsafe(`ALTER TABLE worker_lease_rejections FORCE ROW LEVEL SECURITY`);
      }
    }, 60_000);

    it("fails the exact RLS certificate when RLS itself is disabled", async () => {
      guard();
      await admin!.unsafe(`ALTER TABLE worker_lease_rejections DISABLE ROW LEVEL SECURITY`);
      try {
        expect(await captureFinalStartupFailure()).toMatchObject({
          message: "distributed_execution_app_authority",
        });
      } finally {
        await admin!.unsafe(`ALTER TABLE worker_lease_rejections ENABLE ROW LEVEL SECURITY`);
      }
    }, 60_000);

    it.each([
      ["removed", null],
      ["renamed", LEASE_REJECTION_POLICY_SQL.replaceAll(
        "worker_lease_rejections_tenant_isolation",
        "job003_renamed_policy",
      )],
      ["restrictive", LEASE_REJECTION_POLICY_SQL.replace("AS PERMISSIVE", "AS RESTRICTIVE")],
      ["SELECT-only command", `CREATE POLICY worker_lease_rejections_tenant_isolation
        ON worker_lease_rejections AS PERMISSIVE FOR SELECT TO aoa_app
        USING (organization_id = current_setting('aoa.organization_id', true)::uuid)`],
      ["PUBLIC role", LEASE_REJECTION_POLICY_SQL.replace("TO aoa_app", "TO PUBLIC")],
      ["false qual", LEASE_REJECTION_POLICY_SQL.replace(
        "USING (organization_id = current_setting('aoa.organization_id', true)::uuid)",
        "USING (false)",
      )],
      ["false check", LEASE_REJECTION_POLICY_SQL.replace(
        "WITH CHECK (organization_id = current_setting('aoa.organization_id', true)::uuid)",
        "WITH CHECK (false)",
      )],
    ] as const)("fails the exact policy certificate when its row is %s", async (_mutation, replacementSql) => {
      guard();
      await admin!.unsafe(`DROP POLICY worker_lease_rejections_tenant_isolation
        ON worker_lease_rejections`);
      if (replacementSql) await admin!.unsafe(replacementSql);
      try {
        expect(await captureFinalStartupFailure()).toMatchObject({
          message: "distributed_execution_app_authority",
        });
      } finally {
        await admin!.unsafe(`DROP POLICY IF EXISTS job003_renamed_policy
          ON worker_lease_rejections`);
        await restoreLeaseRejectionPolicy();
      }
    }, 60_000);

    it("fails the exact policy certificate on a harmless-looking 23rd permissive row", async () => {
      guard();
      await admin!.unsafe(`CREATE POLICY job003_extra_policy ON worker_lease_rejections
        AS PERMISSIVE FOR SELECT TO aoa_app USING (false)`);
      try {
        let failure: unknown;
        try {
          const unexpected = await openFinalStartup(finalStartupInput({
            appDatabaseUrl: appUrl,
            operatorDatabaseUrl: operatorUrl,
          }));
          await unexpected?.close();
        } catch (error) { failure = error; }
        expect(failure).toMatchObject({ message: "distributed_execution_app_authority" });
      } finally {
        await admin!.unsafe(`DROP POLICY IF EXISTS job003_extra_policy ON worker_lease_rejections`);
      }
    }, 60_000);

    it("fails exact attacl tuples when an expected column gains a grant option", async () => {
      guard();
      await admin!.unsafe(`GRANT SELECT (id) ON execution_targets TO aoa_app WITH GRANT OPTION`);
      try {
        let failure: unknown;
        try {
          const unexpected = await openFinalStartup(finalStartupInput({
            appDatabaseUrl: appUrl,
            operatorDatabaseUrl: operatorUrl,
          }));
          await unexpected?.close();
        } catch (error) { failure = error; }
        expect(failure).toMatchObject({ message: "distributed_execution_app_authority" });
      } finally {
        await admin!.unsafe(`REVOKE GRANT OPTION FOR SELECT (id) ON execution_targets FROM aoa_app`);
      }
    }, 60_000);

    it.each([
      [
        "a relation grant option",
        "GRANT SELECT ON job_outbox TO aoa_app WITH GRANT OPTION",
        "REVOKE GRANT OPTION FOR SELECT ON job_outbox FROM aoa_app",
      ],
      [
        "an unlisted-column grant option",
        "GRANT SELECT (label) ON workers TO aoa_app WITH GRANT OPTION",
        "REVOKE GRANT OPTION FOR SELECT (label) ON workers FROM aoa_app",
      ],
      [
        "a PUBLIC relation ACL",
        "GRANT SELECT ON worker_lease_rejections TO PUBLIC",
        "REVOKE SELECT ON worker_lease_rejections FROM PUBLIC",
      ],
    ] as const)("fails exact ACL tuples for %s", async (_mutation, installSql, restoreSql) => {
      guard();
      await admin!.unsafe(installSql);
      try {
        expect(await captureFinalStartupFailure()).toMatchObject({
          message: "distributed_execution_app_authority",
        });
      } finally {
        await admin!.unsafe(restoreSql);
      }
    }, 60_000);

    it.each([
      ["aoa_app", "distributed_execution_app_authority"],
      ["aoa_operator", "distributed_execution_operator_authority"],
    ] as const)("keeps %s outside the drizzle migration schema", async (role, errorCode) => {
      guard();
      await admin!.unsafe(`GRANT USAGE ON SCHEMA drizzle TO ${role}`);
      await admin!.unsafe(`GRANT SELECT ON drizzle.__drizzle_migrations TO ${role}`);
      try {
        expect(await captureFinalStartupFailure()).toMatchObject({
          message: errorCode,
        });
      } finally {
        await admin!.unsafe(`REVOKE ALL ON drizzle.__drizzle_migrations FROM ${role}`);
        await admin!.unsafe(`REVOKE USAGE ON SCHEMA drizzle FROM ${role}`);
      }
    }, 60_000);

    it("loads none of the flag-on job-control graph while disabled", async () => {
      guard();
      const flagOff = await observeServer({
        databaseUrl: legacyOwnerUrl,
        distributedEnabled: false,
        sentinelMode: "deny",
      });
      expect(flagOff.exited, flagOff.output).toBe(false);
      for (const moduleName of [
        "worker-control", "job-leasing", "job-control-metrics", "job-ready-scheduler", "job-outbox-worker",
      ]) {
        expect(flagOff.output).not.toContain(`JOB_CONTROL_MODULE_LOAD:${moduleName}`);
      }
    }, 60_000);

    it("proves the module-load sentinel reaches every guarded module while enabled", async () => {
      guard();
      const flagOn = await observeServer({
        databaseUrl: adminUrl,
        distributedEnabled: true,
        appDatabaseUrl: appUrl,
        operatorDatabaseUrl: operatorUrl,
        sentinelMode: "record",
      });
      expect(flagOn.exited, flagOn.output).toBe(false);
      for (const moduleName of [
        "worker-control", "job-leasing", "job-control-metrics", "job-ready-scheduler", "job-outbox-worker",
      ]) {
        expect(flagOn.output).toContain(`JOB_CONTROL_MODULE_LOAD:${moduleName}`);
      }
    }, 60_000);
  },
);
