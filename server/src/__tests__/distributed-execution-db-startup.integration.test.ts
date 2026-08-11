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
  sentinelMode?: "deny" | "record" | "identity";
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
  "idle-timeout" | "forced-end" | "shared-budget";

type StartupDeadlineReceipt = {
  readonly invocationId: number;
  readonly signal: AbortSignal;
  readonly at: number;
};

type StartupInvocationReceipt = {
  readonly id: number;
  readonly startedAt: number;
  readonly advisoryKeys: bigint[];
  readonly controllers: AbortController[];
  controllerCreatedAt: number | null;
  deadlineReceipt: StartupDeadlineReceipt | null;
  returnedAt: number | null;
};

type StartupTransactionReceipt = {
  readonly invocationId: number;
  readonly role: "owner" | "aoa_app" | "aoa_operator";
  phase: AdvisoryPhase | null;
  readonly startedAt: number;
  settledAt: number | null;
  outcome: "pending" | "fulfilled" | "rejected";
};

async function createAdvisoryStartupHarness(inject?: StartupFailureInjection) {
  const dialect = new PgDialect();
  const token = `job003_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const state = {
    phases: [] as AdvisoryPhase[],
    factoryOptions: [] as Array<{ role: "aoa_app" | "aoa_operator"; options: unknown }>,
    slotIds: { aoa_app: new Set<number>(), aoa_operator: new Set<number>() },
    closes: [] as Array<{ role: "aoa_app" | "aoa_operator"; input: unknown }>,
    closeSettled: [] as Array<{ role: "aoa_app" | "aoa_operator"; at: number }>,
    logs: [] as unknown[][],
    positiveWaiters: new Map<"aoa_app" | "aoa_operator", () => void>(),
    positiveBarrierReached: false,
    injectionTriggered: false,
    clients: [] as Sql[],
    ownerClient: null as Sql | null,
    blocker: null as Sql | null,
    backendPids: {
      owner: new Set<number>(), aoa_app: new Set<number>(), aoa_operator: new Set<number>(),
    },
    advisoryKeyBindings: [] as bigint[],
    abortControllers: [] as AbortController[],
    abortCalls: 0,
    abortAt: null as number | null,
    openInvocations: [] as StartupInvocationReceipt[],
    activeInvocation: null as StartupInvocationReceipt | null,
    transactionReceipts: [] as StartupTransactionReceipt[],
    budgetWindows: [] as Array<{
      invocationId: number;
      phase: AdvisoryPhase;
      role: "owner" | "aoa_app" | "aoa_operator";
      signal: AbortSignal | null;
      startedAt: number;
      settledAt: number | null;
      abortReceipt: StartupDeadlineReceipt | null;
      cancelledDuringWork: boolean;
    }>,
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
  const consumeBudget = async (
    phase: "owner-exclusive" | "app-negative" | "operator-negative" |
      "app-positive" | "operator-positive",
  ) => {
    const invocation = state.activeInvocation;
    if (!invocation) throw new Error("shared-budget phase ran outside an open invocation");
    const role = phase === "owner-exclusive"
      ? "owner"
      : phase.startsWith("app-") ? "aoa_app" : "aoa_operator";
    const signal = invocation.controllers.at(-1)?.signal ?? null;
    const window = {
      invocationId: invocation.id,
      phase,
      role,
      signal,
      startedAt: performance.now(),
      settledAt: null as number | null,
      abortReceipt: null as StartupDeadlineReceipt | null,
      cancelledDuringWork: false,
    };
    state.budgetWindows.push(window);
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 3_000);
        if (!signal) return;
        const onAbort = () => {
          window.abortReceipt = invocation.deadlineReceipt;
          if (window.settledAt === null) {
            window.cancelledDuringWork = true;
            clearTimeout(timer);
            reject(Object.assign(new Error("shared startup budget cancelled phase work"), {
              code: "INJECT_SHARED_BUDGET_CANCEL",
            }));
          }
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      });
    } finally {
      window.settledAt = performance.now();
    }
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

  const instrumentDb = <T extends object>(
    db: T,
    role: "owner" | "aoa_app" | "aoa_operator",
    transactionReceipt?: StartupTransactionReceipt,
  ): T => {
    const cache = new Map<PropertyKey, unknown>();
    return new Proxy(db, {
      get(target, property, receiver) {
        if (cache.has(property)) return cache.get(property);
        if (property === "execute") {
          const execute = async (statement: unknown) => {
            let queryText = "";
            let queryParams: unknown[] = [];
            try {
              const compiled = dialect.sqlToQuery(statement as never);
              queryText = compiled.sql.toLowerCase();
              queryParams = compiled.params;
            } catch { /* non-SQL */ }
            const ownerLock = role === "owner" && /pg_advisory_xact_lock\s*\(/u.test(queryText) &&
              !queryText.includes("shared");
            if (ownerLock) {
              const key = queryParams.find((value): value is bigint => typeof value === "bigint");
              if (key !== undefined) {
                state.advisoryKeyBindings.push(key);
                state.activeInvocation?.advisoryKeys.push(key);
              }
              if (transactionReceipt) transactionReceipt.phase = "owner-exclusive";
              state.phases.push("owner-exclusive");
              if (inject === "shared-budget") await consumeBudget("owner-exclusive");
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
            if (inject === "shared-budget" && role !== "owner" &&
              /pg_try_advisory_xact_lock_shared/u.test(queryText)) {
              const rolePrefix = role === "aoa_app" ? "app" : "operator";
              const negativePhase = `${rolePrefix}-negative` as AdvisoryPhase;
              const phase = state.budgetWindows.some((window) =>
                window.invocationId === state.activeInvocation?.id && window.phase === negativePhase)
                ? `${rolePrefix}-positive` as AdvisoryPhase
                : negativePhase;
              if (transactionReceipt) transactionReceipt.phase = phase;
              await consumeBudget(phase);
            }
            const result = await (target as T & { execute(s: unknown): Promise<unknown> }).execute(statement);
            if (/pg_backend_pid\s*\(/u.test(queryText)) {
              for (const row of rows(result)) {
                const pid = Object.values((row ?? {}) as Record<string, unknown>)
                  .find((value): value is number => Number.isSafeInteger(value));
                if (pid !== undefined) state.backendPids[role].add(pid);
              }
            }
            if (role !== "owner" && /pg_try_advisory_xact_lock_shared/u.test(queryText)) {
              const success = firstBoolean(result);
              const phase = `${role === "aoa_app" ? "app" : "operator"}-${success ? "positive" : "negative"}` as AdvisoryPhase;
              if (transactionReceipt) transactionReceipt.phase = phase;
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
          const transaction = async (callback: (tx: T) => unknown, ...args: unknown[]) => {
            const receipt: StartupTransactionReceipt = {
              invocationId: state.activeInvocation?.id ?? -1,
              role,
              phase: null,
              startedAt: performance.now(),
              settledAt: null,
              outcome: "pending",
            };
            state.transactionReceipts.push(receipt);
            try {
              const value = await (target as T & {
                transaction(cb: (tx: T) => unknown, ...rest: unknown[]): Promise<unknown>;
              }).transaction((tx) => callback(instrumentDb(tx, role, receipt)), ...args);
              receipt.outcome = "fulfilled";
              return value;
            } catch (error) {
              receipt.outcome = "rejected";
              throw error;
            } finally {
              receipt.settledAt = performance.now();
            }
          };
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
        state.closeSettled.push({ role, at: performance.now() });
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
    open: (async (input: Parameters<typeof openFinalStartup>[0]) => {
      if (state.activeInvocation) throw new Error("advisory startup harness does not allow overlapping opens");
      const invocation: StartupInvocationReceipt = {
        id: state.openInvocations.length + 1,
        startedAt: performance.now(),
        advisoryKeys: [],
        controllers: [],
        controllerCreatedAt: null,
        deadlineReceipt: null,
        returnedAt: null,
      };
      state.openInvocations.push(invocation);
      state.activeInvocation = invocation;
      const NativeAbortController = globalThis.AbortController;
      class ObservedAbortController extends NativeAbortController {
        constructor() {
          super();
          invocation.controllerCreatedAt ??= performance.now();
          invocation.controllers.push(this);
          state.abortControllers.push(this);
        }
        override abort(reason?: unknown) {
          state.abortCalls += 1;
          if (!this.signal.aborted) {
            const at = performance.now();
            const receipt: StartupDeadlineReceipt = {
              invocationId: invocation.id,
              signal: this.signal,
              at,
            };
            invocation.deadlineReceipt ??= receipt;
            state.abortAt ??= at;
          }
          super.abort(reason);
        }
      }
      globalThis.AbortController = ObservedAbortController;
      try {
        return await (isolated.openDistributedExecutionDatabases as unknown as typeof openFinalStartup)(input);
      } finally {
        invocation.returnedAt = performance.now();
        state.activeInvocation = null;
        globalThis.AbortController = NativeAbortController;
      }
    }) as typeof openFinalStartup,
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

async function observeAdvisoryStartupSettlement(token: string) {
  const [receipt] = await admin!.unsafe<Array<{
    participant_pids: number;
    owner_pids: number;
    owner_in_transaction: number;
    advisory_locks: number;
  }>>(`
    SELECT
      count(DISTINCT activity.pid) FILTER (
        WHERE activity.application_name IN ($1, $2)
      )::int AS participant_pids,
      count(DISTINCT activity.pid) FILTER (
        WHERE activity.application_name = $3
      )::int AS owner_pids,
      count(DISTINCT activity.pid) FILTER (
        WHERE activity.application_name = $3
          AND (activity.state <> 'idle' OR activity.xact_start IS NOT NULL)
      )::int AS owner_in_transaction,
      count(DISTINCT advisory.pid)::int AS advisory_locks
    FROM pg_stat_activity activity
    LEFT JOIN pg_locks advisory
      ON advisory.pid = activity.pid AND advisory.locktype = 'advisory'
    WHERE activity.application_name IN ($1, $2, $3)
  `, [`${token}_app`, `${token}_operator`, `${token}_owner`]);
  return receipt!;
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
      let settlement: Awaited<ReturnType<typeof observeAdvisoryStartupSettlement>> | undefined;
      try {
        accepted = await harness.open(harness.input);
      } catch (error) {
        failure = error;
      } finally {
        await accepted?.close().catch(() => {});
        settlement = await observeAdvisoryStartupSettlement(harness.token);
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
      expect(harness.state.abortControllers).toHaveLength(1);
      expect(harness.state.abortCalls).toBe(0);
      expect(harness.state.slotIds.aoa_app.size).toBe(4);
      expect(harness.state.slotIds.aoa_operator.size).toBe(4);
      expect(harness.state.closes).toEqual([
        { role: "aoa_operator", input: { timeoutSeconds: 5 } },
        { role: "aoa_app", input: { timeoutSeconds: 5 } },
      ]);
      expect(harness.state.closeSettled.map(({ role }) => role).sort())
        .toEqual(["aoa_app", "aoa_operator"]);
      expect(settlement).toEqual({
        participant_pids: 0,
        owner_pids: 1,
        owner_in_transaction: 0,
        advisory_locks: 0,
      });
    }, 60_000);

    it("creates a fresh key, controller, and exact deadline for two calls through one isolated module", async () => {
      guard();
      const harness = await createAdvisoryStartupHarness("shared-budget");
      const failures: unknown[] = [];
      const settlements: Awaited<ReturnType<typeof observeAdvisoryStartupSettlement>>[] = [];
      try {
        // One harness owns one isolated import. Recreating it here would conceal module-scoped
        // key/controller/deadline reuse, which is the production mutation this test catches.
        for (let run = 0; run < 2; run += 1) {
        let accepted: Awaited<ReturnType<typeof openDistributedExecutionDatabases>> = null;
        try {
          accepted = await harness.open(harness.input);
          failures.push(undefined);
        } catch (error) {
          failures.push(error);
        } finally {
          await accepted?.close().catch(() => {});
          settlements.push(await observeAdvisoryStartupSettlement(harness.token));
        }
        }
      } finally {
        await harness.cleanup();
      }

      expect.soft(failures).toHaveLength(2);
      for (const failure of failures) {
        expect.soft(failure).toMatchObject({ message: "distributed_execution_timeout" });
      }
      expect.soft(harness.state.openInvocations).toHaveLength(2);
      expect.soft(harness.state.abortCalls).toBe(2);
      const keys = harness.state.openInvocations.flatMap((receipt) => receipt.advisoryKeys);
      expect.soft(keys).toHaveLength(2);
      for (const key of keys) {
        expect.soft(key).toBeGreaterThanOrEqual(-(2n ** 63n));
        expect.soft(key).toBeLessThan(2n ** 63n);
      }
      if (keys.length === 2) expect.soft(keys[0]).not.toBe(keys[1]);

      const controllers = harness.state.openInvocations.flatMap((receipt) => receipt.controllers);
      expect.soft(controllers).toHaveLength(2);
      if (controllers.length === 2) expect.soft(controllers[0]).not.toBe(controllers[1]);
      const deadlines = harness.state.openInvocations.flatMap((receipt) =>
        receipt.deadlineReceipt ? [receipt.deadlineReceipt] : [],
      );
      expect.soft(deadlines).toHaveLength(2);
      if (deadlines.length === 2) {
        expect.soft(deadlines[0]).not.toBe(deadlines[1]);
        expect.soft(deadlines[0]!.signal).not.toBe(deadlines[1]!.signal);
        expect.soft(deadlines[0]!.at).toBeLessThan(deadlines[1]!.at);
      }
      for (const receipt of harness.state.openInvocations) {
        expect.soft(receipt.controllers).toHaveLength(1);
        expect.soft(receipt.deadlineReceipt?.signal).toBe(receipt.controllers[0]?.signal);
        if (receipt.controllerCreatedAt !== null && receipt.deadlineReceipt && receipt.returnedAt !== null) {
          const budgetElapsed = receipt.deadlineReceipt.at - receipt.controllerCreatedAt;
          expect.soft(budgetElapsed).toBeGreaterThanOrEqual(4_500);
          expect.soft(budgetElapsed).toBeLessThan(6_500);
          expect.soft(receipt.returnedAt - receipt.controllerCreatedAt).toBeLessThan(7_500);
        }
      }
      expect.soft(settlements).toEqual([
        { participant_pids: 0, owner_pids: 1, owner_in_transaction: 0, advisory_locks: 0 },
        { participant_pids: 0, owner_pids: 1, owner_in_transaction: 0, advisory_locks: 0 },
      ]);
    }, 120_000);

    it("spends one monotonic deadline across sequential owner and concurrent app/operator phases", async () => {
      // Mutation caught: resetting a five-second timeout per participant lets two individually
      // sub-limit delays consume more than the one allowed startup budget and return a pool.
      guard();
      const harness = await createAdvisoryStartupHarness("shared-budget");
      let accepted: Awaited<ReturnType<typeof openDistributedExecutionDatabases>> = null;
      let failure: unknown;
      let settlement: Awaited<ReturnType<typeof observeAdvisoryStartupSettlement>> | undefined;
      try {
        accepted = await harness.open(harness.input);
      } catch (error) {
        failure = error;
      } finally {
        await accepted?.close().catch(() => {});
        settlement = await observeAdvisoryStartupSettlement(harness.token);
        await harness.cleanup();
      }

      expect(accepted === null, "shared budget expiry must not return either pool").toBe(true);
      expect(failure).toMatchObject({ message: "distributed_execution_timeout" });
      expect(harness.state.abortControllers).toHaveLength(1);
      expect(harness.state.abortCalls).toBe(1);
      const [invocation] = harness.state.openInvocations;
      expect.soft(harness.state.openInvocations).toHaveLength(1);
      const windows = harness.state.budgetWindows.filter((window) =>
        window.invocationId === invocation?.id,
      );
      expect.soft(windows.map((window) => window.phase).sort()).toEqual([
        "app-negative", "operator-negative", "owner-exclusive",
      ]);
      expect.soft(windows.some((window) => window.phase.endsWith("positive"))).toBe(false);
      expect.soft(harness.state.phases.some((phase) => phase.endsWith("positive"))).toBe(false);
      const owner = windows.find((window) => window.phase === "owner-exclusive");
      const app = windows.find((window) => window.phase === "app-negative");
      const operator = windows.find((window) => window.phase === "operator-negative");
      const deadline = invocation?.deadlineReceipt ?? null;
      expect.soft(owner?.cancelledDuringWork).toBe(false);
      expect.soft(app?.cancelledDuringWork).toBe(true);
      expect.soft(operator?.cancelledDuringWork).toBe(true);
      for (const window of windows) {
        expect.soft(window.signal).toBe(invocation?.controllers[0]?.signal);
        expect.soft(window.abortReceipt).toBe(deadline);
        expect.soft(typeof window.settledAt).toBe("number");
        if (window.settledAt !== null && invocation?.returnedAt !== null) {
          expect.soft(window.settledAt).toBeLessThanOrEqual(invocation?.returnedAt ?? -1);
        }
      }
      if (owner?.settledAt !== null && owner && app && operator && deadline &&
        app.settledAt !== null && operator.settledAt !== null &&
        invocation?.controllerCreatedAt !== null && invocation?.returnedAt !== null) {
        const ownerElapsed = owner.settledAt - owner.startedAt;
        expect.soft(ownerElapsed).toBeGreaterThanOrEqual(2_750);
        expect.soft(ownerElapsed).toBeLessThan(4_250);
        expect.soft(app.startedAt).toBeGreaterThanOrEqual(owner.settledAt);
        expect.soft(operator.startedAt).toBeGreaterThanOrEqual(owner.settledAt);
        expect.soft(deadline.at).toBeGreaterThanOrEqual(Math.max(app.startedAt, operator.startedAt));
        expect.soft(deadline.at).toBeGreaterThanOrEqual(invocation.controllerCreatedAt + 4_500);
        expect.soft(deadline.at).toBeLessThan(invocation.controllerCreatedAt + 6_500);
        expect.soft(app.settledAt).toBeGreaterThanOrEqual(deadline.at);
        expect.soft(operator.settledAt).toBeGreaterThanOrEqual(deadline.at);
        expect.soft(app.settledAt - app.startedAt).toBeGreaterThanOrEqual(1_250);
        expect.soft(app.settledAt - app.startedAt).toBeLessThan(2_750);
        expect.soft(operator.settledAt - operator.startedAt).toBeGreaterThanOrEqual(1_250);
        expect.soft(operator.settledAt - operator.startedAt).toBeLessThan(2_750);
        expect.soft(invocation.returnedAt - invocation.controllerCreatedAt).toBeLessThan(7_500);
      }
      const phaseTransactions = harness.state.transactionReceipts.filter((receipt) =>
        receipt.invocationId === invocation?.id && receipt.phase !== null,
      );
      for (const phase of ["owner-exclusive", "app-negative", "operator-negative"] as const) {
        const transaction = phaseTransactions.find((receipt) => receipt.phase === phase);
        expect.soft(transaction?.outcome, phase).toBe("rejected");
        expect.soft(typeof transaction?.settledAt, phase).toBe("number");
        if (transaction?.settledAt !== null && invocation?.returnedAt !== null) {
          expect.soft(transaction.settledAt, phase).toBeLessThanOrEqual(invocation?.returnedAt ?? -1);
        }
      }
      expect(settlement).toEqual({
        participant_pids: 0,
        owner_pids: 1,
        owner_in_transaction: 0,
        advisory_locks: 0,
      });
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
        let returnedAt = Number.POSITIVE_INFINITY;
        let settlement: Awaited<ReturnType<typeof observeAdvisoryStartupSettlement>> | undefined;
        try {
          accepted = await harness.open(harness.input);
        } catch (error) {
          failure = error;
          returnedAt = performance.now();
        } finally {
          await accepted?.close().catch(() => {});
          settlement = await observeAdvisoryStartupSettlement(harness.token);
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
        expect(harness.state.closeSettled.map(({ role }) => role).sort(), injection)
          .toEqual(["aoa_app", "aoa_operator"]);
        expect(harness.state.closeSettled.every(({ at }) => at <= returnedAt), injection).toBe(true);
        expect(harness.state.abortControllers, injection).toHaveLength(1);
        expect(harness.state.abortCalls, injection).toBe(1);
        expect(settlement, injection).toEqual({
          participant_pids: 0,
          owner_pids: 1,
          owner_in_transaction: 0,
          advisory_locks: 0,
        });
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

    it("threads the identical metrics instance through the real flag-on startup and app composition", async () => {
      guard();
      const flagOn = await observeServer({
        databaseUrl: adminUrl,
        distributedEnabled: true,
        appDatabaseUrl: appUrl,
        operatorDatabaseUrl: operatorUrl,
        sentinelMode: "identity",
      });
      expect(flagOn.exited, flagOn.output).toBe(false);
      expect(flagOn.output).toContain("JOB_CONTROL_METRICS_IDENTITY:metrics");
      for (const consumer of ["job-ready-scheduler", "job-outbox-worker", "worker-control", "job-leasing"]) {
        expect(flagOn.output, consumer).toContain(`JOB_CONTROL_METRICS_IDENTITY:${consumer}:same`);
        expect(flagOn.output, consumer).not.toContain(`JOB_CONTROL_METRICS_IDENTITY:${consumer}:different`);
      }
    }, 60_000);
  },
);
