import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import postgres, { type Sql } from "postgres";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { applyPendingMigrations, type Db } from "@armyofagents/db";
import * as dbSchema from "@armyofagents/db";
import { allocateEmbeddedPgPort } from "./helpers/embedded-pg-port.js";
import {
  provisionTenantAppRoleLoginSql,
  TENANT_APP_ROLE,
} from "../db/rls-tenant.js";
import { openDistributedExecutionDatabases } from "../db/distributed-execution-databases.js";
import * as legacyGrants from "../db/job-control-legacy-grants.js";

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

type AdvisoryPhase =
  | "owner-exclusive"
  | "app-negative"
  | "operator-negative"
  | "app-positive"
  | "operator-positive";

type StartupFailureInjection = AdvisoryPhase | "statement-timeout" | "lock-timeout" |
  "idle-timeout" | "forced-end";

async function createAdvisoryStartupHarness(inject?: StartupFailureInjection) {
  const dialect = new PgDialect();
  const token = `job003_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const state = {
    phases: [] as AdvisoryPhase[],
    factoryOptions: [] as Array<{ role: "aoa_app" | "aoa_operator"; options: unknown }>,
    slotIds: { aoa_app: new Set<number>(), aoa_operator: new Set<number>() },
    closes: [] as Array<{ role: "aoa_app" | "aoa_operator"; input: unknown }>,
    logs: [] as unknown[][],
    positiveWaiters: new Map<"aoa_app" | "aoa_operator", () => void>(),
    positiveBarrierReached: false,
    injectionTriggered: false,
    clients: [] as Sql[],
    ownerClient: null as Sql | null,
    blocker: null as Sql | null,
  };
  const namedUrl = (url: string, suffix: string) => {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}application_name=${token}_${suffix}`;
  };
  const appNamedUrl = namedUrl(appUrl, "app");
  const operatorNamedUrl = namedUrl(operatorUrl, "operator");
  const ownerNamedUrl = namedUrl(adminUrl, "owner");

  const rows = (result: unknown): unknown[] => Array.isArray(result)
    ? result
    : ((result as { rows?: unknown[] })?.rows ?? []);
  const firstBoolean = (result: unknown): boolean | undefined => {
    for (const row of rows(result)) {
      for (const value of Object.values((row ?? {}) as Record<string, unknown>)) {
        if (typeof value === "boolean") return value;
      }
    }
    return undefined;
  };
  const waitForPositivePeer = async (role: "aoa_app" | "aoa_operator") => {
    const peer = role === "aoa_app" ? "aoa_operator" : "aoa_app";
    const existing = state.positiveWaiters.get(peer);
    if (existing) {
      state.positiveBarrierReached = true;
      state.positiveWaiters.delete(peer);
      existing();
      return;
    }
    await new Promise<void>((resolve, reject) => {
      state.positiveWaiters.set(role, resolve);
      const timer = setTimeout(() => {
        state.positiveWaiters.delete(role);
        reject(new Error(`positive advisory barrier stranded for ${role}`));
      }, 2_000);
      const wrapped = () => {
        clearTimeout(timer);
        resolve();
      };
      state.positiveWaiters.set(role, wrapped);
    });
  };

  const instrumentDb = <T extends object>(db: T, role: "owner" | "aoa_app" | "aoa_operator"): T => {
    const cache = new Map<PropertyKey, unknown>();
    return new Proxy(db, {
      get(target, property, receiver) {
        if (cache.has(property)) return cache.get(property);
        if (property === "execute") {
          const execute = async (statement: unknown) => {
            let queryText = "";
            try { queryText = dialect.sqlToQuery(statement as never).sql.toLowerCase(); } catch { /* non-SQL */ }
            const ownerLock = role === "owner" && /pg_advisory_xact_lock\s*\(/u.test(queryText) &&
              !queryText.includes("shared");
            if (ownerLock) {
              state.phases.push("owner-exclusive");
              if (inject === "owner-exclusive") {
                state.injectionTriggered = true;
                throw Object.assign(new Error("owner phase injected"), { code: "INJECT_OWNER" });
              }
              if (inject === "statement-timeout") {
                state.injectionTriggered = true;
                return (target as T & { execute(s: unknown): Promise<unknown> }).execute(sql`SELECT pg_sleep(6)`);
              }
              if (inject === "lock-timeout") {
                state.injectionTriggered = true;
                return (target as T & { execute(s: unknown): Promise<unknown> }).execute(sql`SELECT pg_advisory_xact_lock(903003)`);
              }
              if (inject === "idle-timeout") {
                state.injectionTriggered = true;
                await (target as T & { execute(s: unknown): Promise<unknown> }).execute(sql`SELECT 1`);
                await new Promise((resolve) => setTimeout(resolve, 5_500));
                return (target as T & { execute(s: unknown): Promise<unknown> }).execute(sql`SELECT 1`);
              }
            }
            const result = await (target as T & { execute(s: unknown): Promise<unknown> }).execute(statement);
            if (role !== "owner" && /pg_try_advisory_xact_lock_shared/u.test(queryText)) {
              const success = firstBoolean(result);
              const phase = `${role === "aoa_app" ? "app" : "operator"}-${success ? "positive" : "negative"}` as AdvisoryPhase;
              state.phases.push(phase);
              if (inject === phase || (inject === "forced-end" && phase === "operator-positive")) {
                state.injectionTriggered = true;
                throw Object.assign(new Error(`${inject} injected`), { code: `INJECT_${inject}` });
              }
              if (success) await waitForPositivePeer(role);
            }
            return result;
          };
          cache.set(property, execute);
          return execute;
        }
        if (property === "transaction") {
          const transaction = async (callback: (tx: T) => unknown, ...args: unknown[]) =>
            (target as T & { transaction(cb: (tx: T) => unknown, ...rest: unknown[]): Promise<unknown> })
              .transaction((tx) => callback(instrumentDb(tx, role)), ...args);
          cache.set(property, transaction);
          return transaction;
        }
        return Reflect.get(target, property, receiver);
      },
    });
  };

  const createServingConnection = (
    url: string,
    role: "aoa_app" | "aoa_operator",
    options: Record<string, unknown> | undefined,
  ) => {
    state.factoryOptions.push({ role, options });
    const client = postgres(url, {
      max: Number(options?.max ?? 4),
      connect_timeout: 5,
      idle_timeout: 30,
      connection: {
        client_encoding: "UTF8",
        statement_timeout: 5_000,
        lock_timeout: 750,
        idle_in_transaction_session_timeout: 5_000,
      },
      debug(connectionId) { state.slotIds[role].add(connectionId); },
    });
    state.clients.push(client);
    const db = instrumentDb(drizzlePg(client, { schema: dbSchema }) as unknown as Db, role);
    return {
      db,
      async close(input?: unknown) {
        state.closes.push({ role, input });
        const seconds = Number((input as { timeoutSeconds?: number } | undefined)?.timeoutSeconds ?? 5);
        const sleeping = inject === "forced-end" && state.injectionTriggered
          ? client`SELECT pg_sleep(60)`.catch(() => {})
          : Promise.resolve();
        if (inject === "forced-end" && state.injectionTriggered) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        await client.end({ timeout: seconds });
        await sleeping;
      },
    };
  };

  vi.resetModules();
  vi.doMock("@armyofagents/db", async () => {
    const actual = await vi.importActual<typeof import("@armyofagents/db")>("@armyofagents/db");
    return {
      ...actual,
      createTenantAppDbConnection: (url: string, options?: Record<string, unknown>) =>
        createServingConnection(url, "aoa_app", options),
      createOperatorDbConnection: (url: string, options?: Record<string, unknown>) =>
        createServingConnection(url, "aoa_operator", options),
    };
  });
  vi.doMock("../middleware/logger.js", async () => {
    const actual = await vi.importActual<typeof import("../middleware/logger.js")>("../middleware/logger.js");
    const record = (...args: unknown[]) => { state.logs.push(args); };
    return { ...actual, logger: { trace: record, debug: record, info: record, warn: record, error: record } };
  });
  const isolated = await import("../db/distributed-execution-databases.js");

  state.ownerClient = postgres(ownerNamedUrl, {
    max: 4,
    connection: {
      client_encoding: "UTF8",
      statement_timeout: 5_000,
      lock_timeout: 750,
      idle_in_transaction_session_timeout: 5_000,
    },
  });
  const instrumentedOwnerDb = instrumentDb(
    drizzlePg(state.ownerClient, { schema: dbSchema }) as unknown as Db,
    "owner",
  );
  if (inject === "lock-timeout") {
    state.blocker = postgres(namedUrl(adminUrl, "blocker"), { max: 1 });
    await state.blocker`SELECT pg_advisory_lock(903003)`;
  }

  const cleanup = async () => {
    for (const resolve of state.positiveWaiters.values()) resolve();
    state.positiveWaiters.clear();
    if (state.blocker) {
      await state.blocker`SELECT pg_advisory_unlock(903003)`.catch(() => {});
      await state.blocker.end({ timeout: 1 }).catch(() => {});
    }
    await state.ownerClient?.end({ timeout: 1 }).catch(() => {});
    for (const client of state.clients) await client.end({ timeout: 1 }).catch(() => {});
    vi.doUnmock("@armyofagents/db");
    vi.doUnmock("../middleware/logger.js");
    vi.resetModules();
  };
  return {
    state,
    appNamedUrl,
    operatorNamedUrl,
    open: isolated.openDistributedExecutionDatabases as unknown as typeof openFinalStartup,
    input: {
      enabled: true,
      ownerDb: instrumentedOwnerDb,
      requiredMigrationIdentity: checkedInMigrationIdentity(),
      appDatabaseUrl: appNamedUrl,
      operatorDatabaseUrl: operatorNamedUrl,
    },
    cleanup,
    token,
  };
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

    it("proves the public startup API exhausts both max-four pools through the real transaction-advisory barrier and leaves no peer", async () => {
      // Mutations caught: comparing URL/database strings, probing one lazy connection, or
      // running the positive peers sequentially cannot produce this real-PG phase receipt.
      guard();
      const harness = await createAdvisoryStartupHarness();
      let accepted: Awaited<ReturnType<typeof openDistributedExecutionDatabases>> = null;
      let failure: unknown;
      try {
        accepted = await harness.open(harness.input);
      } catch (error) {
        failure = error;
      } finally {
        await accepted?.close().catch(() => {});
        await harness.cleanup();
      }

      expect(failure).toBeUndefined();
      expect(harness.state.factoryOptions).toEqual([
        {
          role: "aoa_app",
          options: {
            max: 4,
            connectTimeoutMs: 5_000,
            statementTimeoutMs: 5_000,
            lockTimeoutMs: 750,
            idleInTransactionSessionTimeoutMs: 5_000,
            idleTimeoutMs: 30_000,
          },
        },
        {
          role: "aoa_operator",
          options: {
            max: 4,
            connectTimeoutMs: 5_000,
            statementTimeoutMs: 5_000,
            lockTimeoutMs: 750,
            idleInTransactionSessionTimeoutMs: 5_000,
            idleTimeoutMs: 30_000,
          },
        },
      ]);
      expect(harness.state.phases[0]).toBe("owner-exclusive");
      expect(harness.state.phases.filter((phase) => phase === "app-negative")).toHaveLength(4);
      expect(harness.state.phases.filter((phase) => phase === "operator-negative")).toHaveLength(4);
      expect(harness.state.phases.filter((phase) => phase === "app-positive")).toHaveLength(4);
      expect(harness.state.phases.filter((phase) => phase === "operator-positive")).toHaveLength(4);
      expect(harness.state.positiveBarrierReached).toBe(true);
      expect(harness.state.slotIds.aoa_app.size).toBe(4);
      expect(harness.state.slotIds.aoa_operator.size).toBe(4);
      expect(harness.state.closes).toEqual([
        { role: "aoa_operator", input: { timeoutSeconds: 5 } },
        { role: "aoa_app", input: { timeoutSeconds: 5 } },
      ]);

      const [leaks] = await admin!<{ active_pids: number; advisory_locks: number }[]>`
        SELECT
          count(DISTINCT activity.pid)::int AS active_pids,
          count(DISTINCT advisory.pid)::int AS advisory_locks
        FROM pg_stat_activity activity
        LEFT JOIN pg_locks advisory
          ON advisory.pid = activity.pid AND advisory.locktype = 'advisory'
        WHERE activity.application_name LIKE ${`${harness.token}%`}
      `;
      expect(leaks).toEqual({ active_pids: 0, advisory_locks: 0 });
    }, 60_000);

    it("settles and tears down every advisory participant for each failure/timeout/forced-end phase without payload-bearing diagnostics", async () => {
      // Mutations caught: per-peer aborts, naked Promise.race closes, or logging URLs/keys can
      // strand a backend or disclose the random advisory domain after an injected phase fault.
      guard();
      const injections: StartupFailureInjection[] = [
        "owner-exclusive", "app-negative", "operator-negative", "app-positive", "operator-positive",
        "statement-timeout", "lock-timeout", "idle-timeout", "forced-end",
      ];
      const receipts: Array<{ injection: StartupFailureInjection; errorCode: string; closed: string[] }> = [];
      for (const injection of injections) {
        const harness = await createAdvisoryStartupHarness(injection);
        let accepted: Awaited<ReturnType<typeof openDistributedExecutionDatabases>> = null;
        let failure: unknown;
        try {
          accepted = await harness.open(harness.input);
        } catch (error) {
          failure = error;
        } finally {
          await accepted?.close().catch(() => {});
          await harness.cleanup();
        }
        const errorCode = (failure as { message?: string } | undefined)?.message ?? "startup_returned_pool";
        receipts.push({
          injection,
          errorCode,
          closed: harness.state.closes.map((entry) => entry.role),
        });
        expect(accepted === null, `${injection}: startup must not return either pool`).toBe(true);
        expect(failure, injection).toMatchObject({ message: expect.stringMatching(/^distributed_execution_/u) });
        expect(harness.state.closes.map((entry) => entry.role).sort(), injection)
          .toEqual(["aoa_app", "aoa_operator"]);
        const serializedLogs = JSON.stringify(harness.state.logs);
        for (const forbidden of [
          harness.appNamedUrl, harness.operatorNamedUrl, "aoa_app", "aoa_operator", "postgres",
          "pg_advisory", "903003", "startup-app-password", "startup-operator-password",
          ...checkedInMigrationIdentity().orderedHashes,
        ]) {
          expect(serializedLogs, `${injection}:${forbidden}`).not.toContain(forbidden);
        }
      }
      expect(receipts.map((receipt) => receipt.injection)).toEqual(injections);
      expect(receipts.every((receipt) => receipt.errorCode !== "startup_returned_pool")).toBe(true);
    }, 120_000);

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

    it("rejects every real catalog relkind substitution, including a column-only serving relation", async () => {
      // mcp_api_keys is intentionally derived only from APP_MCP_API_KEY_COLUMN_GRANTS. A
      // hand-maintained table-grant list or broad effective-privilege scan misses every case
      // below once the original relation's column ACL is removed.
      guard();
      const relation = "mcp_api_keys";
      const backup = `job003_mcp_api_keys_backup_${process.pid}`;
      const columns = "id, company_id, user_id, revoked_at";
      const expectRelationFailure = async (shape: string) => {
        expect.soft(await captureFinalStartupFailure(), shape).toMatchObject({
          message: "distributed_execution_app_authority",
        });
      };
      const replace = async (
        shape: string,
        createSql: string,
        dropSql: string,
        grantColumns = true,
      ) => {
        await admin!.unsafe(`ALTER TABLE ${relation} RENAME TO ${backup}`);
        await admin!.unsafe(`REVOKE SELECT (${columns}) ON ${backup} FROM aoa_app`);
        try {
          if (createSql) await admin!.unsafe(createSql);
          if (grantColumns) {
            await admin!.unsafe(`GRANT SELECT (${columns}) ON ${relation} TO aoa_app`);
          }
          await expectRelationFailure(shape);
        } finally {
          if (dropSql) await admin!.unsafe(dropSql).catch(() => {});
          await admin!.unsafe(`GRANT SELECT (${columns}) ON ${backup} TO aoa_app`);
          await admin!.unsafe(`ALTER TABLE ${backup} RENAME TO ${relation}`);
        }
      };

      await replace("missing", "", "", false);
      await replace(
        "view",
        `CREATE VIEW ${relation} AS TABLE ${backup}`,
        `DROP VIEW IF EXISTS ${relation}`,
      );
      await replace(
        "materialized-view",
        `CREATE MATERIALIZED VIEW ${relation} AS TABLE ${backup} WITH NO DATA`,
        `DROP MATERIALIZED VIEW IF EXISTS ${relation}`,
      );
      await replace(
        "partitioned-table",
        `CREATE TABLE ${relation} (LIKE ${backup} INCLUDING DEFAULTS) PARTITION BY HASH (id)`,
        `DROP TABLE IF EXISTS ${relation}`,
      );
      await replace(
        "sequence",
        `CREATE SEQUENCE ${relation}`,
        `DROP SEQUENCE IF EXISTS ${relation}`,
        false,
      );

      const serverName = `job003_relation_shape_${process.pid}`;
      await admin!.unsafe("CREATE EXTENSION IF NOT EXISTS postgres_fdw");
      await admin!.unsafe(`CREATE SERVER ${serverName} FOREIGN DATA WRAPPER postgres_fdw
        OPTIONS (host '127.0.0.1', dbname 'postgres')`);
      try {
        await replace(
          "foreign-table",
          `CREATE FOREIGN TABLE ${relation} (
            id uuid, company_id uuid, user_id text, name text, key_hash text,
            last_used_at timestamptz, revoked_at timestamptz, created_at timestamptz
          ) SERVER ${serverName} OPTIONS (table_name '${backup}')`,
          `DROP FOREIGN TABLE IF EXISTS ${relation}`,
        );
      } finally {
        await admin!.unsafe(`DROP SERVER IF EXISTS ${serverName} CASCADE`).catch(() => {});
      }

      const shadow = `job003_relation_shadow_${process.pid}`;
      await admin!.unsafe(`CREATE SCHEMA ${shadow}`);
      await admin!.unsafe(`CREATE VIEW ${shadow}.${relation} AS TABLE public.${relation}`);
      try {
        await expectRelationFailure("duplicate-name outside the expected public identity");
      } finally {
        await admin!.unsafe(`DROP SCHEMA IF EXISTS ${shadow} CASCADE`);
      }
    }, 120_000);

    it("checks grant-option ACL tuples independently on every derived relation and non-dropped user column", async () => {
      // The mutations preserve effective SELECT wherever it already exists. Only inspection of
      // relacl/attacl nullness and aclexplode(...).is_grantable can reject those cases.
      guard();
      const appTables = {
        ...legacyGrants.JOB_CONTROL_LEGACY_GRANTS,
        ...legacyGrants.JOB_CONTROL_NEW_PATH_GRANTS,
        ...legacyGrants.JOB_SUBMISSION_LEGACY_GRANTS,
        ...legacyGrants.JOB_SUBMISSION_NEW_PATH_GRANTS,
        ...legacyGrants.WORKER_ENROLLMENT_APP_GRANTS,
        ...legacyGrants.JOB_LEASING_NEW_PATH_GRANTS,
      } as Readonly<Record<string, readonly string[]>>;
      const operatorTables = legacyGrants.WORKER_ENROLLMENT_OPERATOR_GRANTS as
        Readonly<Record<string, readonly string[]>>;
      const relations = [...new Set([
        ...Object.keys(appTables),
        ...Object.keys(operatorTables),
        ...Object.keys(legacyGrants.OPERATOR_METADATA_COLUMN_GRANTS),
        "mcp_api_keys",
        "execution_targets",
      ])].sort();
      const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
      const acceptedMutations: string[] = [];

      for (const relation of relations) {
        const [access] = await admin!<{ app: boolean; operator: boolean }[]>`
          SELECT
            has_table_privilege('aoa_app', ${`public.${relation}`}, 'SELECT') AS app,
            has_table_privilege('aoa_operator', ${`public.${relation}`}, 'SELECT') AS operator`;
        const role = access?.app ? "aoa_app" : access?.operator ? "aoa_operator" : null;
        if (role) {
          await admin!.unsafe(`GRANT SELECT ON TABLE ${quote(relation)} TO ${role} WITH GRANT OPTION`);
          try {
            if (await captureFinalStartupFailure() === undefined) acceptedMutations.push(`${relation}:relacl`);
          } finally {
            await admin!.unsafe(
              `REVOKE GRANT OPTION FOR SELECT ON TABLE ${quote(relation)} FROM ${role}`,
            );
          }
        }

        const columns = await admin!<{ column_name: string; app: boolean; operator: boolean }[]>`
          SELECT attribute.attname AS column_name,
            has_column_privilege('aoa_app', relation.oid, attribute.attnum, 'SELECT') AS app,
            has_column_privilege('aoa_operator', relation.oid, attribute.attnum, 'SELECT') AS operator
          FROM pg_class relation
          JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
          JOIN pg_attribute attribute ON attribute.attrelid = relation.oid
          WHERE namespace.nspname = 'public' AND relation.relname = ${relation}
            AND relation.relkind = 'r' AND attribute.attnum > 0 AND NOT attribute.attisdropped
          ORDER BY attribute.attnum`;
        for (const column of columns) {
          const role = column.app ? "aoa_app" : column.operator ? "aoa_operator" : "aoa_app";
          const [prior] = await admin!<{ explicit_select: boolean }[]>`
            SELECT EXISTS (
              SELECT 1 FROM pg_class relation
              JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
              JOIN pg_attribute attribute ON attribute.attrelid = relation.oid
              CROSS JOIN LATERAL aclexplode(attribute.attacl) acl
              LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
              WHERE namespace.nspname = 'public' AND relation.relname = ${relation}
                AND attribute.attname = ${column.column_name}
                AND grantee.rolname = ${role} AND acl.privilege_type = 'SELECT'
            ) AS explicit_select`;
          await admin!.unsafe(
            `GRANT SELECT (${quote(column.column_name)}) ON ${quote(relation)} TO ${role} WITH GRANT OPTION`,
          );
          try {
            if (await captureFinalStartupFailure() === undefined) {
              acceptedMutations.push(`${relation}.${column.column_name}:attacl`);
            }
          } finally {
            await admin!.unsafe(
              `REVOKE SELECT (${quote(column.column_name)}) ON ${quote(relation)} FROM ${role}`,
            );
            if (prior?.explicit_select) {
              await admin!.unsafe(
                `GRANT SELECT (${quote(column.column_name)}) ON ${quote(relation)} TO ${role}`,
              );
            }
          }
        }
      }
      expect(acceptedMutations).toEqual([]);
    }, 180_000);

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
