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
const DRIVER_CAUSE_SENTINEL = "JOB003_DRIVER_CAUSE_SENTINEL_7F4C";
const SQL_SENTINEL = "JOB003_SQL_SENTINEL_91DA";
const STARTUP_ERROR_CODES = new Set([
  "distributed_execution_configuration",
  "distributed_execution_migration_identity",
  "distributed_execution_app_authority",
  "distributed_execution_operator_authority",
  "distributed_execution_advisory_domain",
  "distributed_execution_timeout",
  "distributed_execution_close",
]);
const STARTUP_LOG_PHASES = new Set([
  "configuration",
  "migration-identity",
  "app-authority",
  "operator-authority",
  "owner-exclusive",
  "negative-peers",
  "positive-peers",
]);

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

function withApplicationName(url: string, applicationName: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}application_name=${encodeURIComponent(applicationName)}`;
}

function expectCaseInsensitiveRedaction(surface: string, forbidden: readonly string[]): void {
  const normalized = surface.toLowerCase();
  for (const value of forbidden) {
    expect(normalized, `disclosed forbidden value ${value}`).not.toContain(value.toLowerCase());
  }
}

function assertClosedStartupLogs(logs: readonly unknown[][]): void {
  expect(logs.length, "startup failure must emit one closed structured diagnostic").toBeGreaterThan(0);
  for (const args of logs) {
    expect(args).toHaveLength(2);
    expect(args[1]).toBe("distributed execution startup rejected");
    expect(args[0]).not.toBeNull();
    expect(typeof args[0]).toBe("object");
    const fields = args[0] as Record<string, unknown>;
    expect(Object.keys(fields).sort()).toEqual(["code", "phase"]);
    expect(STARTUP_ERROR_CODES.has(String(fields.code))).toBe(true);
    expect(STARTUP_LOG_PHASES.has(String(fields.phase))).toBe(true);
  }
}

type RequiredMigrationIdentity = { orderedHashes: readonly string[]; ledgerSha256: string };

function checkedInMigrationIdentity(): RequiredMigrationIdentity {
  const journal = JSON.parse(readFileSync(
    new URL("../../../packages/db/src/migrations/meta/_journal.json", import.meta.url),
    "utf8",
  )) as { entries?: Array<{ idx?: number; tag?: string }> };
  const orderedHashes = (journal.entries ?? []).map((entry) => createHash("sha256").update(readFileSync(
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
    await admin.unsafe(`CREATE DATABASE startup_other`);
    otherAdminUrl = adminUrl.replace(/\/postgres$/, "/startup_other");
    await applyPendingMigrations(otherAdminUrl);
    otherAppUrl = otherAdminUrl.replace("test:test", `aoa_app:${APP_PASSWORD}`);
    otherOperatorUrl = otherAdminUrl.replace("test:test", `aoa_operator:${OPERATOR_PASSWORD}`);
    await admin.unsafe(`CREATE DATABASE startup_legacy_owner`);
    const legacyAdminUrl = adminUrl.replace(/\/postgres$/, "/startup_legacy_owner");
    await applyPendingMigrations(legacyAdminUrl);
    const legacySetup = postgres(legacyAdminUrl, { max: 1 });
    try {
      await legacySetup.unsafe(
        `GRANT USAGE ON SCHEMA public, drizzle TO "aoa_legacy_table_owner"`,
      );
      await legacySetup.unsafe(
        `GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "aoa_legacy_table_owner"`,
      );
      await legacySetup.unsafe(
        `GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO "aoa_legacy_table_owner"`,
      );
      await legacySetup.unsafe(
        `GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO "aoa_legacy_table_owner"`,
      );
      await legacySetup.unsafe(`ALTER TABLE execution_targets OWNER TO "aoa_legacy_table_owner"`);
    } finally {
      await legacySetup.end();
    }
    legacyOwnerUrl = legacyAdminUrl.replace(
      "test:test",
      `aoa_legacy_table_owner:${LEGACY_OWNER_PASSWORD}`,
    );
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
  expectedCode?: "distributed_execution_app_authority" | "distributed_execution_operator_authority";
}): Promise<{ exited: boolean; code: number | null; output: string }> {
  return observeServer({
    databaseUrl: adminUrl,
    distributedEnabled: true,
    appDatabaseUrl: input.appDatabaseUrl,
    operatorDatabaseUrl: input.operatorDatabaseUrl,
    expectedFailureCode: input.expectedCode,
    forbiddenFailureValues: [
      DRIVER_CAUSE_SENTINEL,
      SQL_SENTINEL,
      ...checkedInMigrationIdentity().orderedHashes,
      adminUrl,
      input.appDatabaseUrl,
      input.operatorDatabaseUrl,
      APP_PASSWORD,
      OPERATOR_PASSWORD,
      "wrong-password",
      "test:test",
      "postgres://",
      "aoa_app",
      "aoa_operator",
    ],
  });
}

async function observeServer(input: {
  databaseUrl: string;
  distributedEnabled: boolean;
  appDatabaseUrl?: string;
  operatorDatabaseUrl?: string;
  expectedFailureCode?: string;
  forbiddenFailureValues?: readonly string[];
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
  if (input.expectedFailureCode) {
    expect(output).toContain(input.expectedFailureCode);
    expectCaseInsensitiveRedaction(output, input.forbiddenFailureValues ?? []);
  }
  return { exited: true, code: outcome.code, output };
}

type AdvisoryPhase =
  | "owner-exclusive"
  | "app-negative"
  | "operator-negative"
  | "app-positive"
  | "operator-positive";

const ADVISORY_PHASES: readonly AdvisoryPhase[] = [
  "owner-exclusive",
  "app-negative",
  "operator-negative",
  "app-positive",
  "operator-positive",
];

type AdvisoryPendingInjection = `${AdvisoryPhase}-pending`;

type StartupFailureInjection = AdvisoryPhase | AdvisoryPendingInjection |
  "statement-timeout" | "lock-timeout" |
  "idle-timeout" | "forced-end" | "shared-budget" | "shared-budget-pending" |
  "migration-pending" | "app-authority-pending" | "operator-authority-pending" |
  "cleanup-pending" | "cleanup-failure-pending" | "redaction-sentinel";

type StartupPhase =
  | "migration-identity"
  | "app-authority"
  | "operator-authority"
  | AdvisoryPhase;

type PendingQueryPhase = StartupPhase
  | "cleanup";

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
  phase: PendingQueryPhase | null;
  readonly startedAt: number;
  settledAt: number | null;
  outcome: "pending" | "fulfilled" | "rejected";
};

async function createAdvisoryStartupHarness(inject?: StartupFailureInjection) {
  const dialect = new PgDialect();
  const pendingAdvisoryPhase = ADVISORY_PHASES.find((phase) => inject === `${phase}-pending`) ?? null;
  const token = `job003_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const state = {
    phases: [] as AdvisoryPhase[],
    factoryOptions: [] as Array<{ role: "aoa_app" | "aoa_operator"; options: unknown }>,
    slotIds: { aoa_app: new Set<number>(), aoa_operator: new Set<number>() },
    closes: [] as Array<{ role: "aoa_app" | "aoa_operator"; input: unknown }>,
    closeAttempts: [] as Array<{ role: "aoa_app" | "aoa_operator"; at: number }>,
    closeSettled: [] as Array<{ role: "aoa_app" | "aoa_operator"; at: number }>,
    logs: [] as unknown[][],
    positiveWaiters: new Map<"aoa_app" | "aoa_operator", Array<() => void>>(),
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
    observerAliasControls: [] as AbortController[],
    observerAliasControlObserved: null as boolean | null,
    openInvocations: [] as StartupInvocationReceipt[],
    activeInvocation: null as StartupInvocationReceipt | null,
    transactionReceipts: [] as StartupTransactionReceipt[],
    sharedProbeOrdinals: new Map<string, number>(),
    budgetWindows: [] as Array<{
      invocationId: number;
      phase: AdvisoryPhase;
      role: "owner" | "aoa_app" | "aoa_operator";
      signal: AbortSignal | null;
      startedAt: number;
      settledAt: number | null;
      abortReceipt: StartupDeadlineReceipt | null;
      cancelledDuringWork: boolean;
      abortObservedWhilePending: boolean;
      releasedAt: number | null;
    }>,
    pendingBudgetWork: [] as Array<{
      invocationId: number;
      phase: AdvisoryPhase;
      release: () => void;
      drained: Promise<void>;
      releasedAt: number | null;
      drainedAt: number | null;
    }>,
    pendingQueryTimeouts: [] as Array<{
      invocationId: number;
      phase: AdvisoryPhase;
      effectiveStatementTimeout: string;
    }>,
    pendingQueries: [] as Array<{
      invocationId: number;
      phase: PendingQueryPhase;
      role: "owner" | "aoa_app" | "aoa_operator";
      backendPid: number | null;
      effectiveStatementTimeout: string | null;
      signal: AbortSignal | null;
      abortObservedAt: number | null;
      startedAt: number;
      sleepIssuedAt: number | null;
      settledAt: number | null;
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
      abortObservedWhilePending: false,
      releasedAt: null as number | null,
    };
    state.budgetWindows.push(window);
    if (inject === "shared-budget-pending" && phase !== "owner-exclusive") {
      let releaseGate!: () => void;
      const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
      const pending = {
        invocationId: invocation.id,
        phase,
        release: () => {
          if (pending.releasedAt !== null) return;
          pending.releasedAt = performance.now();
          window.releasedAt = pending.releasedAt;
          releaseGate();
        },
        drained: Promise.resolve(),
        releasedAt: null as number | null,
        drainedAt: null as number | null,
      };
      pending.drained = gate.then(() => { pending.drainedAt = performance.now(); });
      state.pendingBudgetWork.push(pending);
      const onAbort = () => {
        window.abortReceipt = invocation.deadlineReceipt;
        window.abortObservedWhilePending = pending.releasedAt === null;
      };
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
      return window;
    }
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 3_000);
        if (!signal) return;
        const onAbort = () => {
          window.abortReceipt = invocation.deadlineReceipt;
          window.abortObservedWhilePending = window.settledAt === null;
          if (window.settledAt === null) {
            window.cancelledDuringWork = true;
            if (inject === "shared-budget") {
              clearTimeout(timer);
              reject(Object.assign(new Error("shared startup budget cancelled phase work"), {
                code: "INJECT_SHARED_BUDGET_CANCEL",
              }));
            }
          }
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      });
    } finally {
      window.settledAt = performance.now();
    }
    return window;
  };
  const waitForPositivePeer = async (role: "aoa_app" | "aoa_operator") => {
    const peer = role === "aoa_app" ? "aoa_operator" : "aoa_app";
    const peerWaiters = state.positiveWaiters.get(peer);
    const existing = peerWaiters?.shift();
    if (existing) {
      state.positiveBarrierReached = true;
      if (peerWaiters?.length === 0) state.positiveWaiters.delete(peer);
      existing();
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const waiters = state.positiveWaiters.get(role) ?? [];
      let timer: ReturnType<typeof setTimeout> | undefined;
      const wrapped = () => {
        if (timer !== undefined) clearTimeout(timer);
        resolve();
      };
      waiters.push(wrapped);
      state.positiveWaiters.set(role, waiters);
      if (pendingAdvisoryPhase !== null) return;
      timer = setTimeout(() => {
        const remaining = state.positiveWaiters.get(role)?.filter((waiter) => waiter !== wrapped) ?? [];
        if (remaining.length === 0) state.positiveWaiters.delete(role);
        else state.positiveWaiters.set(role, remaining);
        reject(new Error(`positive advisory barrier stranded for ${role}`));
      }, 2_000);
    });
  };

  const createPendingReceipt = (
    role: "owner" | "aoa_app" | "aoa_operator",
    phase: PendingQueryPhase,
  ) => {
    const receipt = {
      invocationId: state.activeInvocation?.id ?? state.openInvocations.at(-1)?.id ?? -1,
      phase,
      role,
      backendPid: null as number | null,
      effectiveStatementTimeout: null as string | null,
      signal: state.activeInvocation?.controllers.at(-1)?.signal ?? null,
      abortObservedAt: null as number | null,
      startedAt: performance.now(),
      sleepIssuedAt: null as number | null,
      settledAt: null as number | null,
    };
    state.pendingQueries.push(receipt);
    const observeAbort = () => { receipt.abortObservedAt ??= performance.now(); };
    if (receipt.signal?.aborted) observeAbort();
    else receipt.signal?.addEventListener("abort", observeAbort, { once: true });
    return receipt;
  };

  const recordTransaction = async <T>(
    role: "owner" | "aoa_app" | "aoa_operator",
    phase: PendingQueryPhase | null,
    work: (receipt: StartupTransactionReceipt) => Promise<T>,
  ): Promise<T> => {
    const receipt: StartupTransactionReceipt = {
      invocationId: state.activeInvocation?.id ?? -1,
      role,
      phase,
      startedAt: performance.now(),
      settledAt: null,
      outcome: "pending",
    };
    state.transactionReceipts.push(receipt);
    try {
      const value = await work(receipt);
      receipt.outcome = "fulfilled";
      return value;
    } catch (error) {
      receipt.outcome = "rejected";
      throw error;
    } finally {
      receipt.settledAt = performance.now();
    }
  };

  const runPendingQuery = async <T extends object>(
    target: T,
    role: "owner" | "aoa_app" | "aoa_operator",
    phase: PendingQueryPhase,
    statement: unknown,
    transactionReceipt: StartupTransactionReceipt | undefined,
  ): Promise<unknown> => {
    const receipt = createPendingReceipt(role, phase);
    const run = async (transaction: T & { execute(s: unknown): Promise<unknown> }) => {
      const timeoutResult = await transaction.execute(sql`
        SELECT current_setting('statement_timeout') AS statement_timeout`);
      receipt.effectiveStatementTimeout = rows(timeoutResult)
        .flatMap((row) => Object.values((row ?? {}) as Record<string, unknown>))
        .find((value): value is string => typeof value === "string") ?? null;
      const pidResult = await transaction.execute(sql`SELECT pg_backend_pid() AS pid`);
      receipt.backendPid = rows(pidResult)
        .flatMap((row) => Object.values((row ?? {}) as Record<string, unknown>))
        .find((value): value is number => Number.isSafeInteger(value)) ?? null;
      try {
        receipt.sleepIssuedAt = performance.now();
        await transaction.execute(sql`SELECT pg_sleep(60)`);
        return await transaction.execute(statement);
      } finally {
        receipt.settledAt = performance.now();
      }
    };
    if (transactionReceipt) {
      transactionReceipt.phase = phase;
      return run(target as T & { execute(s: unknown): Promise<unknown> });
    }
    return recordTransaction(role, phase, async () =>
      (target as T & {
        transaction(callback: (transaction: T & { execute(s: unknown): Promise<unknown> }) => Promise<unknown>): Promise<unknown>;
      }).transaction(run));
  };

  const runPendingRawOwnerQuery = (client: Sql) => {
    const receipt = createPendingReceipt("owner", "cleanup");
    let cancelRequested = false;
    let sleeping: { cancel(): void } | null = null;
    const operation = recordTransaction("owner", "cleanup", async () =>
      client.begin(async (transaction) => {
        const [observation] = await transaction<{
          statement_timeout: string;
          pid: number;
        }[]>`SELECT
          current_setting('statement_timeout') AS statement_timeout,
          pg_backend_pid() AS pid`;
        receipt.effectiveStatementTimeout = observation?.statement_timeout ?? null;
        receipt.backendPid = observation?.pid ?? null;
        const pending = transaction`SELECT pg_sleep(60)`;
        sleeping = pending;
        if (cancelRequested) pending.cancel();
        await pending;
        return [];
      })).finally(() => {
      receipt.settledAt = performance.now();
    });
    return Object.assign(operation, {
      cancel() {
        cancelRequested = true;
        sleeping?.cancel();
      },
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
        if (property === "$client" && role === "owner") {
          const client = Reflect.get(target, property, receiver) as Sql;
          const instrumentedClient = new Proxy(client, {
            get(clientTarget, clientProperty, clientReceiver) {
              if (clientProperty === "unsafe") {
                return (query: string, ...args: unknown[]) => {
                  if ((inject === "cleanup-pending" || inject === "cleanup-failure-pending") &&
                    query.toLowerCase().includes("participant_pids_gone")) {
                    return runPendingRawOwnerQuery(clientTarget as Sql);
                  }
                  const unsafe = (clientTarget as Sql).unsafe as unknown as
                    (...rawArgs: unknown[]) => unknown;
                  return unsafe(query, ...args);
                };
              }
              return Reflect.get(clientTarget, clientProperty, clientReceiver);
            },
          });
          cache.set(property, instrumentedClient);
          return instrumentedClient;
        }
        if (property === "execute") {
          const execute = async (statement: unknown) => {
            let queryText = "";
            let queryParams: unknown[] = [];
            try {
              const compiled = dialect.sqlToQuery(statement as never);
              queryText = compiled.sql.toLowerCase();
              queryParams = compiled.params;
            } catch { /* non-SQL */ }
            if (inject === "redaction-sentinel" && role === "aoa_app" &&
              queryText.includes("session_role_name")) {
              state.injectionTriggered = true;
              const driverCause = Object.assign(new Error(DRIVER_CAUSE_SENTINEL), {
                code: "JOB003_DRIVER_SENTINEL",
                query: SQL_SENTINEL,
                detail: `${DRIVER_CAUSE_SENTINEL}:${SQL_SENTINEL}`,
              });
              throw Object.assign(new Error(DRIVER_CAUSE_SENTINEL), {
                code: "JOB003_DRIVER_SENTINEL",
                query: SQL_SENTINEL,
                cause: driverCause,
              });
            }
            const pendingPhase: PendingQueryPhase | null =
              inject === "migration-pending" && role === "owner" &&
                queryText.includes("__drizzle_migrations")
                ? "migration-identity"
                : inject === "app-authority-pending" && role === "aoa_app" &&
                    queryText.includes("session_role_name")
                  ? "app-authority"
                  : inject === "operator-authority-pending" && role === "aoa_operator" &&
                      queryText.includes("session_role_name")
                    ? "operator-authority"
                    : (inject === "cleanup-pending" || inject === "cleanup-failure-pending") &&
                        role === "owner" && queryText.includes("participant_pids_gone")
                      ? "cleanup"
                      : null;
            if (pendingPhase) {
              return runPendingQuery(target, role, pendingPhase, statement, transactionReceipt);
            }
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
              if (pendingAdvisoryPhase === "owner-exclusive") {
                if (!transactionReceipt) {
                  throw new Error("pending owner advisory query must run inside its startup transaction");
                }
                state.injectionTriggered = true;
                await (target as T & { execute(s: unknown): Promise<unknown> })
                  .execute(sql`SET LOCAL statement_timeout = 0`);
                return runPendingQuery(
                  target,
                  role,
                  "owner-exclusive",
                  statement,
                  transactionReceipt,
                );
              }
              if (inject === "shared-budget" || inject === "shared-budget-pending") {
                await consumeBudget("owner-exclusive");
              }
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
            if (pendingAdvisoryPhase !== null && role !== "owner" &&
              /pg_try_advisory_xact_lock_shared/u.test(queryText)) {
              const rolePrefix = role === "aoa_app" ? "app" : "operator";
              const ordinalKey = `${state.activeInvocation?.id ?? -1}:${role}`;
              const ordinal = state.sharedProbeOrdinals.get(ordinalKey) ?? 0;
              state.sharedProbeOrdinals.set(ordinalKey, ordinal + 1);
              const phase = `${rolePrefix}-${ordinal < 4 ? "negative" : "positive"}` as AdvisoryPhase;
              if (phase === pendingAdvisoryPhase && !state.injectionTriggered) {
                if (!transactionReceipt) {
                  throw new Error("pending peer advisory query must run inside its startup transaction");
                }
                transactionReceipt.phase = phase;
                state.phases.push(phase);
                state.injectionTriggered = true;
                await (target as T & { execute(s: unknown): Promise<unknown> })
                  .execute(sql`SET LOCAL statement_timeout = 0`);
                return runPendingQuery(target, role, phase, statement, transactionReceipt);
              }
            }
            if ((inject === "shared-budget" || inject === "shared-budget-pending") && role !== "owner" &&
              /pg_try_advisory_xact_lock_shared/u.test(queryText)) {
              const rolePrefix = role === "aoa_app" ? "app" : "operator";
              const negativePhase = `${rolePrefix}-negative` as AdvisoryPhase;
              const phase = state.budgetWindows.some((window) =>
                window.invocationId === state.activeInvocation?.id && window.phase === negativePhase)
                ? `${rolePrefix}-positive` as AdvisoryPhase
                : negativePhase;
              if (transactionReceipt) transactionReceipt.phase = phase;
              const budgetWindow = await consumeBudget(phase);
              if (inject === "shared-budget-pending") {
                if (!transactionReceipt) {
                  throw new Error("pending shared-budget query must run inside its startup transaction");
                }
                try {
                  await (target as T & { execute(s: unknown): Promise<unknown> })
                    .execute(sql`SET LOCAL statement_timeout = 0`);
                  const timeoutResult = await (target as T & { execute(s: unknown): Promise<unknown> })
                    .execute(sql`SELECT current_setting('statement_timeout') AS statement_timeout`);
                  const effectiveStatementTimeout = rows(timeoutResult)
                    .flatMap((row) => Object.values((row ?? {}) as Record<string, unknown>))
                    .find((value): value is string => typeof value === "string");
                  if (effectiveStatementTimeout === undefined) {
                    throw new Error("pending shared-budget query could not observe transaction-local timeout");
                  }
                  state.pendingQueryTimeouts.push({
                    invocationId: state.activeInvocation?.id ?? -1,
                    phase,
                    effectiveStatementTimeout,
                  });
                  return await (target as T & { execute(s: unknown): Promise<unknown> })
                    .execute(sql`SELECT pg_sleep(60)`);
                } finally {
                  budgetWindow.settledAt = performance.now();
                }
              }
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
              if (inject === phase || (inject === "forced-end" && phase === "operator-positive") ||
                (inject === "cleanup-failure-pending" && phase === "operator-positive")) {
                state.injectionTriggered = true;
                throw Object.assign(new Error(`${inject} injected`), { code: `INJECT_${inject}` });
              }
              const hasProductionOwnedPositiveCancellation =
                pendingAdvisoryPhase === "app-positive" ||
                pendingAdvisoryPhase === "operator-positive";
              if (success && !hasProductionOwnedPositiveCancellation) {
                await waitForPositivePeer(role);
              }
            }
            return result;
          };
          cache.set(property, execute);
          return execute;
        }
        if (property === "transaction") {
          const transaction = async (callback: (tx: T) => unknown, ...args: unknown[]) => {
            return recordTransaction(role, null, async (receipt) =>
              (target as T & {
                transaction(cb: (tx: T) => unknown, ...rest: unknown[]): Promise<unknown>;
              }).transaction((tx) => callback(instrumentDb(tx, role, receipt)), ...args));
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
        statement_timeout: inject?.endsWith("-pending") ? 0 : 5_000,
        lock_timeout: 750,
        idle_in_transaction_session_timeout: 5_000,
      },
      debug(connectionId) { state.slotIds[role].add(connectionId); },
    });
    state.clients.push(client);
    const db = instrumentDb(drizzlePg(client, { schema: dbSchema }) as unknown as Db, role);
    return {
      db,
      async close(input: { timeoutSeconds: number }) {
        state.closes.push({ role, input });
        state.closeAttempts.push({ role, at: performance.now() });
        const seconds = Number(input.timeoutSeconds);
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

  // Install one observer before the isolated import so a production module-scope constructor
  // alias captures the observer too. The WeakMap preserves the owning open after activeInvocation
  // is cleared, while inactive control constructions cannot pollute per-open controller counts.
  const NativeAbortController = globalThis.AbortController;
  const controllerOwners = new WeakMap<AbortController, StartupInvocationReceipt>();
  class ObservedAbortController extends NativeAbortController {
    constructor() {
      super();
      const invocation = state.activeInvocation;
      if (!invocation) return;
      controllerOwners.set(this, invocation);
      invocation.controllerCreatedAt ??= performance.now();
      invocation.controllers.push(this);
      state.abortControllers.push(this);
    }

    override abort(reason?: unknown) {
      const invocation = controllerOwners.get(this);
      if (invocation) {
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
      }
      super.abort(reason);
    }
  }
  globalThis.AbortController = ObservedAbortController;
  const CapturedBeforeIsolatedImportAbortController = globalThis.AbortController;
  const restoreObservedAbortController = () => {
    if (globalThis.AbortController === ObservedAbortController) {
      globalThis.AbortController = NativeAbortController;
    }
  };
  const restoreHarnessGlobals = () => {
    restoreObservedAbortController();
    vi.doUnmock("@armyofagents/db");
    vi.doUnmock("../middleware/logger.js");
    vi.resetModules();
  };

  let isolated: typeof import("../db/distributed-execution-databases.js");
  try {
    isolated = await import("../db/distributed-execution-databases.js");
    restoreObservedAbortController();
    const aliasControl = new CapturedBeforeIsolatedImportAbortController();
    state.observerAliasControls.push(aliasControl);
    state.observerAliasControlObserved = aliasControl instanceof ObservedAbortController;
    aliasControl.abort();
  } catch (error) {
    restoreHarnessGlobals();
    throw error;
  }

  let instrumentedOwnerDb: Db;
  try {
    state.ownerClient = postgres(ownerNamedUrl, {
      max: 4,
      connection: {
        client_encoding: "UTF8",
        statement_timeout: inject?.endsWith("-pending") ? 0 : 5_000,
        lock_timeout: 750,
        idle_in_transaction_session_timeout: 5_000,
      },
    });
    instrumentedOwnerDb = instrumentDb(
      drizzlePg(state.ownerClient, { schema: dbSchema }) as unknown as Db,
      "owner",
    );
    if (inject === "lock-timeout") {
      state.blocker = postgres(namedUrl(adminUrl, "blocker"), { max: 1 });
      await state.blocker`SELECT pg_advisory_lock(903003)`;
    }
  } catch (error) {
    await state.blocker?.end({ timeout: 1 }).catch(() => {});
    await state.ownerClient?.end({ timeout: 1 }).catch(() => {});
    restoreHarnessGlobals();
    throw error;
  }

  const cleanup = async () => {
    try {
      for (const pending of state.pendingBudgetWork) pending.release();
      await Promise.allSettled(state.pendingBudgetWork.map((pending) => pending.drained));
      for (const waiters of state.positiveWaiters.values()) {
        for (const resolve of waiters) resolve();
      }
      state.positiveWaiters.clear();
      if (state.blocker) {
        await state.blocker`SELECT pg_advisory_unlock(903003)`.catch(() => {});
        await state.blocker.end({ timeout: 1 }).catch(() => {});
      }
      await state.ownerClient?.end({ timeout: 1 }).catch(() => {});
      for (const client of state.clients) await client.end({ timeout: 1 }).catch(() => {});
    } finally {
      restoreHarnessGlobals();
    }
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
      const previousAbortController = globalThis.AbortController;
      globalThis.AbortController = ObservedAbortController;
      try {
        return await (isolated.openDistributedExecutionDatabases as unknown as typeof openFinalStartup)(input);
      } finally {
        invocation.returnedAt = performance.now();
        state.activeInvocation = null;
        if (globalThis.AbortController === ObservedAbortController) {
          globalThis.AbortController = previousAbortController;
        }
      }
    }) as typeof openFinalStartup,
    input: {
      enabled: true,
      ownerDb: instrumentedOwnerDb,
      requiredMigrationIdentity: checkedInMigrationIdentity(),
      appDatabaseUrl: appNamedUrl,
      operatorDatabaseUrl: operatorNamedUrl,
    },
    releasePendingBudgetWork(invocationId?: number) {
      const at = performance.now();
      for (const pending of state.pendingBudgetWork) {
        if (invocationId === undefined || pending.invocationId === invocationId) pending.release();
      }
      return at;
    },
    async waitForPendingBudgetWork(invocationId?: number) {
      await Promise.all(state.pendingBudgetWork
        .filter((pending) => invocationId === undefined || pending.invocationId === invocationId)
        .map((pending) => pending.drained));
    },
    async waitForActivePendingQuery(phase: PendingQueryPhase, timeoutMs = 3_500) {
      const deadline = performance.now() + timeoutMs;
      do {
        const receipt = state.pendingQueries.find((candidate) =>
          candidate.phase === phase && candidate.backendPid !== null);
        if (receipt?.backendPid !== null && receipt?.backendPid !== undefined) {
          const [activity] = await admin!.unsafe<Array<{ active: boolean }>>(`
            SELECT EXISTS (
              SELECT 1
              FROM pg_stat_activity
              WHERE pid = $1
                AND datname = current_database()
                AND state = 'active'
                AND query ILIKE '%pg_sleep%'
            ) AS active
          `, [receipt.backendPid]);
          if (activity?.active) return receipt;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      } while (performance.now() < deadline);
      throw new Error(`pending ${phase} query did not reach its exact active backend`);
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

async function withOuterWatchdog<T>(promise: Promise<T>, timeoutMs = 12_000): Promise<
  | { kind: "fulfilled"; value: T }
  | { kind: "rejected"; error: unknown }
  | { kind: "watchdog" }
> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observed = promise.then(
    (value) => ({ kind: "fulfilled" as const, value }),
    (error: unknown) => ({ kind: "rejected" as const, error }),
  );
  const watchdog = new Promise<{ kind: "watchdog" }>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "watchdog" }), timeoutMs);
  });
  try {
    return await Promise.race([observed, watchdog]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function waitForReceiptSettlement(
  receipts: readonly { settledAt: number | null }[],
  deadlineAt: number,
): Promise<
  | { kind: "settled"; observedAt: number }
  | { kind: "watchdog"; observedAt: number; unsettled: number }
> {
  while (performance.now() < deadlineAt) {
    if (receipts.every((receipt) => receipt.settledAt !== null)) {
      return { kind: "settled", observedAt: performance.now() };
    }
    await new Promise((resolve) => setTimeout(
      resolve,
      Math.max(0, Math.min(10, deadlineAt - performance.now())),
    ));
  }
  if (receipts.every((receipt) => receipt.settledAt !== null)) {
    return { kind: "settled", observedAt: performance.now() };
  }
  return {
    kind: "watchdog",
    observedAt: performance.now(),
    unsettled: receipts.filter((receipt) => receipt.settledAt === null).length,
  };
}

function statementTimeoutMs(value: string | null): number | null {
  if (value === null) return null;
  if (value === "0") return 0;
  const match = /^(\d+(?:\.\d+)?)(ms|s|min)$/u.exec(value);
  if (!match) return null;
  const amount = Number(match[1]);
  return match[2] === "ms" ? amount : match[2] === "s" ? amount * 1_000 : amount * 60_000;
}

const EARLY_ABORT_SETTLEMENT_WATCHDOG_MS = 2_000;
const EARLY_ABORT_PUBLIC_WATCHDOG_MS = 12_000;

describe.skipIf(process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1")(
  "distributed-execution non-owner startup gate",
  () => {
    it("observes a constructor alias captured before isolated import without polluting opens", async () => {
      guard();
      const harness = await createAdvisoryStartupHarness();
      try {
        const observerControls = harness.state.observerAliasControls;
        expect(observerControls).toHaveLength(1);
        expect(harness.state.observerAliasControlObserved).toBe(true);
        expect(observerControls[0]?.signal.aborted).toBe(true);
        expect(harness.state.openInvocations).toEqual([]);
        expect(harness.state.abortControllers).toEqual([]);
        expect(harness.state.abortCalls).toBe(0);
        expect(harness.state.abortAt).toBeNull();
      } finally {
        await harness.cleanup();
      }
    }, 20_000);

    it("keeps the prompt cancellation receipt bound independent from public teardown", async () => {
      guard();
      const pendingQuery = { settledAt: null as number | null };
      const pendingTransaction = { settledAt: null as number | null };
      let releasePublic!: () => void;
      const publicOperation = new Promise<string>((resolve) => { releasePublic = () => resolve("closed"); });
      setTimeout(() => {
        const settledAt = performance.now();
        pendingQuery.settledAt = settledAt;
        pendingTransaction.settledAt = settledAt;
      }, 0);

      const prompt = await waitForReceiptSettlement(
        [pendingQuery, pendingTransaction],
        performance.now() + 100,
      );
      expect(prompt).toMatchObject({ kind: "settled", observedAt: expect.any(Number) });
      expect(await withOuterWatchdog(publicOperation, 25)).toEqual({ kind: "watchdog" });

      releasePublic();
      expect(await withOuterWatchdog(publicOperation, 250)).toEqual({
        kind: "fulfilled",
        value: "closed",
      });
    }, 5_000);

    it("keeps the real flag-off server usable with a non-superuser execution_targets owner", async () => {
      guard();
      const result = await observeServer({
        databaseUrl: legacyOwnerUrl,
        distributedEnabled: false,
      });
      expect(result.exited, result.output).toBe(false);

      const legacyOwner = postgres(legacyOwnerUrl, { max: 1 });
      try {
        const [identity] = await legacyOwner<{
          current_user: string;
          rolsuper: boolean;
          owns_execution_targets: boolean;
        }[]>`
          SELECT current_user,
            (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS rolsuper,
            pg_get_userbyid(relation.relowner) = current_user AS owns_execution_targets
          FROM pg_class relation
          JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname = 'public' AND relation.relname = 'execution_targets'
        `;
        expect(identity).toEqual({
          current_user: "aoa_legacy_table_owner",
          rolsuper: false,
          owns_execution_targets: true,
        });
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
        appDatabaseUrl: withApplicationName(
          appUrl.replace(APP_PASSWORD, DRIVER_CAUSE_SENTINEL),
          SQL_SENTINEL,
        ),
        operatorDatabaseUrl: operatorUrl,
        expectedCode: "distributed_execution_app_authority",
      });
      expect(result.exited).toBe(true);
      expect(result.code).not.toBe(0);
    }, 60_000);

    it("fails closed before serving when the aoa_operator connection cannot open", async () => {
      guard();
      const result = await observeStartup({
        appDatabaseUrl: appUrl,
        operatorDatabaseUrl: withApplicationName(
          operatorUrl.replace(OPERATOR_PASSWORD, DRIVER_CAUSE_SENTINEL),
          SQL_SENTINEL,
        ),
        expectedCode: "distributed_execution_operator_authority",
      });
      expect(result.exited).toBe(true);
      expect(result.code).not.toBe(0);
    }, 60_000);

    it("drops driver causes and SQL payloads from the direct error and closed structured log", async () => {
      guard();
      const harness = await createAdvisoryStartupHarness("redaction-sentinel");
      const operation = harness.open(harness.input);
      try {
        const outcome = await withOuterWatchdog(operation, 5_000);
        expect.soft(outcome).toMatchObject({
          kind: "rejected",
          error: {
            name: "DistributedExecutionStartupError",
            message: "distributed_execution_app_authority",
          },
        });
        expect(harness.state.injectionTriggered).toBe(true);
        const failure = outcome.kind === "rejected" ? outcome.error : undefined;
        expect(failure).toBeInstanceOf(Error);
        expect(Object.getOwnPropertyNames(failure).sort()).toEqual(["message", "name", "stack"]);
        expect(Object.prototype.hasOwnProperty.call(failure, "cause")).toBe(false);
        const ownSurface = Object.fromEntries(Object.getOwnPropertyNames(failure).map((key) => [
          key,
          String((failure as Record<string, unknown>)[key]),
        ]));
        const directSurface = [
          String(failure),
          String((failure as { cause?: unknown } | undefined)?.cause),
          JSON.stringify(failure),
          JSON.stringify(ownSurface),
        ].join("\n");
        assertClosedStartupLogs(harness.state.logs);
        const forbidden = [
          DRIVER_CAUSE_SENTINEL,
          SQL_SENTINEL,
          "JOB003_DRIVER_SENTINEL",
          harness.appNamedUrl,
          harness.operatorNamedUrl,
          adminUrl,
          "aoa_app",
          "aoa_operator",
          "test:test",
          "postgres://",
          ...checkedInMigrationIdentity().orderedHashes,
          ...harness.state.advisoryKeyBindings.map(String),
        ];
        expectCaseInsensitiveRedaction(directSurface, forbidden);
        expectCaseInsensitiveRedaction(JSON.stringify(harness.state.logs), forbidden);
        const expectedRoles = ["aoa_app"];
        expect(harness.state.factoryOptions.map(({ role }) => role)).toEqual(expectedRoles);
        expect(harness.state.closes.map(({ role }) => role)).toEqual(expectedRoles);
        expect(harness.state.closes.map(({ input }) => input)).toEqual([{ timeoutSeconds: 5 }]);
        expect(harness.state.closeSettled.map(({ role }) => role)).toEqual(expectedRoles);
        const returnedAt = harness.state.openInvocations[0]?.returnedAt;
        expect(typeof returnedAt).toBe("number");
        expect(harness.state.closeSettled[0]!.at).toBeLessThanOrEqual(returnedAt ?? -1);
      } finally {
        await harness.cleanup();
        await withOuterWatchdog(operation.then(() => undefined, () => undefined), 5_000);
      }
    }, 20_000);

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
        expectedCode: expectedRole === "aoa_app"
          ? "distributed_execution_app_authority"
          : "distributed_execution_operator_authority",
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
        const expectedCode = expectedRole === "aoa_app"
          ? "distributed_execution_app_authority"
          : "distributed_execution_operator_authority";
        expect(failure).toMatchObject({
          name: "DistributedExecutionStartupError",
          message: expectedCode,
        });
        const serialized = [
          String(failure),
          JSON.stringify(failure),
          String((failure as { cause?: unknown } | undefined)?.cause),
          JSON.stringify(Object.fromEntries(Object.getOwnPropertyNames(failure).map((key) => [
            key,
            String((failure as Record<string, unknown>)[key]),
          ]))),
        ].join("\n");
        expect(Object.prototype.hasOwnProperty.call(failure, "cause")).toBe(false);
        expectCaseInsensitiveRedaction(serialized, [
          DRIVER_CAUSE_SENTINEL,
          SQL_SENTINEL,
          ...checkedInMigrationIdentity().orderedHashes,
          maskedOwnerUrl,
          appUrl,
          operatorUrl,
          adminUrl,
          APP_PASSWORD,
          OPERATOR_PASSWORD,
          "test:test",
          "postgres://",
          "aoa_app",
          "aoa_operator",
        ]);
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
          expectedCode: expectedRole === "aoa_app"
            ? "distributed_execution_app_authority"
            : "distributed_execution_operator_authority",
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
          expectedCode: "distributed_execution_operator_authority",
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
          expectedCode: "distributed_execution_app_authority",
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
          expectedCode: "distributed_execution_operator_authority",
        });
        expect(result.exited).toBe(true);
        expect(result.code).not.toBe(0);
      } finally {
        await admin!.unsafe(`REVOKE SELECT ON company_secrets FROM aoa_operator`).catch(() => {});
      }
    }, 60_000);

    it.each([
      ["aoa_app", "distributed_execution_app_authority", "app"],
      ["aoa_operator", "distributed_execution_operator_authority", "operator"],
    ] as const)("rejects PostgreSQL 18 MAINTAIN on an ephemeral non-manifest table for %s", async (
      role,
      errorCode,
      suffix,
    ) => {
      // Mutation caught: omitting MAINTAIN from the whole-catalog effective-privilege scan
      // accepts authority that is absent from every checked-in serving manifest.
      guard();
      const relation = `job003_maintain_${suffix}_${process.pid}`;
      const [before] = await admin!<{ relation: string | null }[]>`
        SELECT to_regclass(${`public.${relation}`})::text AS relation`;
      expect(before?.relation).toBeNull();
      let created = false;
      let failure: unknown;
      try {
        await admin!.unsafe(`CREATE TABLE "${relation}" (id integer)`);
        created = true;
        await admin!.unsafe(`GRANT MAINTAIN ON TABLE "${relation}" TO "${role}"`);
        const [granted] = await admin!<{ maintain: boolean }[]>`
          SELECT has_table_privilege(${role}, ${`public.${relation}`}, 'MAINTAIN') AS maintain`;
        expect(granted?.maintain).toBe(true);
        failure = await captureFinalStartupFailure();
      } finally {
        if (created) {
          try {
            await admin!.unsafe(`REVOKE MAINTAIN ON TABLE "${relation}" FROM "${role}"`);
          } finally {
            await admin!.unsafe(`DROP TABLE "${relation}"`);
          }
        }
      }
      const [after] = await admin!<{ relation: string | null }[]>`
        SELECT to_regclass(${`public.${relation}`})::text AS relation`;
      expect(after?.relation).toBeNull();
      expect(failure).toMatchObject({ message: errorCode });
    }, 60_000);

    it("rejects an exact-named operator role that owns an application object", async () => {
      guard();
      await admin!.unsafe(`CREATE TABLE startup_owned_drift_probe (id integer)`);
      await admin!.unsafe(`ALTER TABLE startup_owned_drift_probe OWNER TO aoa_operator`);
      try {
        const result = await observeStartup({
          appDatabaseUrl: appUrl,
          operatorDatabaseUrl: operatorUrl,
          expectedCode: "distributed_execution_operator_authority",
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
          expectedCode: "distributed_execution_operator_authority",
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
      // The negative phase gates only observe abort; they cannot reject/resolve until this test
      // releases them after the public open call has settled, so a cosmetic production listener
      // cannot borrow fixture-owned cancellation to pass.
      guard();
      const harness = await createAdvisoryStartupHarness("shared-budget-pending");
      let accepted: Awaited<ReturnType<typeof openDistributedExecutionDatabases>> = null;
      type OpenOutcome =
        | { readonly kind: "fulfilled"; readonly value: Awaited<ReturnType<typeof openDistributedExecutionDatabases>> }
        | { readonly kind: "rejected"; readonly error: unknown };
      const openSettlement = harness.open(harness.input).then<OpenOutcome>(
        (value) => ({ kind: "fulfilled", value }),
        (error: unknown) => ({ kind: "rejected", error }),
      );
      let initialOutcome: OpenOutcome | { readonly kind: "watchdog" } | undefined;
      let finalOutcome: OpenOutcome | undefined;
      let watchdogHandle: ReturnType<typeof setTimeout> | undefined;
      let drainWatchdogHandle: ReturnType<typeof setTimeout> | undefined;
      let releaseAt: number | null = null;
      let productionReturnedAtBeforeRelease: number | null = null;
      let fixtureWorkDrainedAt: number | null = null;
      let closeSettledBeforeRelease: typeof harness.state.closeSettled = [];
      let settlement: Awaited<ReturnType<typeof observeAdvisoryStartupSettlement>> | undefined;
      try {
        initialOutcome = await Promise.race([
          openSettlement,
          new Promise<{ readonly kind: "watchdog" }>((resolve) => {
            watchdogHandle = setTimeout(() => resolve({ kind: "watchdog" }), 15_000);
          }),
        ]);
        if (initialOutcome.kind !== "watchdog") finalOutcome = initialOutcome;
      } finally {
        if (watchdogHandle) clearTimeout(watchdogHandle);
        const invocationId = harness.state.openInvocations[0]?.id;
        closeSettledBeforeRelease = [...harness.state.closeSettled];
        productionReturnedAtBeforeRelease = harness.state.openInvocations[0]?.returnedAt ?? null;
        releaseAt = harness.releasePendingBudgetWork(invocationId);
        await harness.waitForPendingBudgetWork(invocationId);
        fixtureWorkDrainedAt = performance.now();
        if (!finalOutcome) {
          const drainedOutcome = await Promise.race([
            openSettlement,
            new Promise<{ readonly kind: "drain-watchdog" }>((resolve) => {
              drainWatchdogHandle = setTimeout(() => resolve({ kind: "drain-watchdog" }), 10_000);
            }),
          ]);
          if (drainedOutcome.kind !== "drain-watchdog") finalOutcome = drainedOutcome;
        }
        if (drainWatchdogHandle) clearTimeout(drainWatchdogHandle);
        accepted = finalOutcome?.kind === "fulfilled" ? finalOutcome.value : null;
        await accepted?.close().catch(() => {});
        const drainDeadline = performance.now() + 5_000;
        while (performance.now() < drainDeadline) {
          const pendingTransactions = harness.state.transactionReceipts.some((receipt) =>
            receipt.invocationId === invocationId && receipt.phase !== null && receipt.settledAt === null,
          );
          if (!pendingTransactions) break;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        const observationDeadline = performance.now() + 5_000;
        do {
          settlement = await observeAdvisoryStartupSettlement(harness.token);
          if (settlement.participant_pids === 0 && settlement.owner_in_transaction === 0 &&
            settlement.advisory_locks === 0) break;
          await new Promise((resolve) => setTimeout(resolve, 25));
        } while (performance.now() < observationDeadline);
        await harness.cleanup();
      }

      expect(accepted === null, "shared budget expiry must not return either pool").toBe(true);
      expect(initialOutcome?.kind, "public open must settle before the external watchdog").toBe("rejected");
      expect(finalOutcome).toMatchObject({
        kind: "rejected",
        error: { message: "distributed_execution_timeout" },
      });
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
      expect.soft(app?.cancelledDuringWork).toBe(false);
      expect.soft(operator?.cancelledDuringWork).toBe(false);
      expect.soft(app?.abortObservedWhilePending).toBe(true);
      expect.soft(operator?.abortObservedWhilePending).toBe(true);
      for (const window of windows) {
        expect.soft(window.signal).toBe(invocation?.controllers[0]?.signal);
        expect.soft(window.abortReceipt).toBe(deadline);
        expect.soft(typeof window.settledAt).toBe("number");
      }
      expect.soft(closeSettledBeforeRelease.map(({ role }) => role).sort()).toEqual([
        "aoa_app", "aoa_operator",
      ]);
      expect.soft(harness.state.pendingBudgetWork.map(({ phase }) => phase).sort()).toEqual([
        "app-negative", "operator-negative",
      ]);
      expect.soft(harness.state.pendingQueryTimeouts
        .map(({ phase, effectiveStatementTimeout }) => ({ phase, effectiveStatementTimeout }))
        .sort((left, right) => left.phase.localeCompare(right.phase))).toEqual([
        { phase: "app-negative", effectiveStatementTimeout: "0" },
        { phase: "operator-negative", effectiveStatementTimeout: "0" },
      ]);
      expect.soft(harness.state.pendingQueryTimeouts.every(({ invocationId }) =>
        invocationId === invocation?.id)).toBe(true);
      expect.soft(typeof productionReturnedAtBeforeRelease).toBe("number");
      expect.soft(productionReturnedAtBeforeRelease).toBe(invocation?.returnedAt ?? null);
      expect.soft(typeof releaseAt).toBe("number");
      expect.soft(typeof fixtureWorkDrainedAt).toBe("number");
      if (releaseAt !== null && fixtureWorkDrainedAt !== null && invocation?.returnedAt !== null) {
        expect.soft(invocation.returnedAt).toBeLessThan(releaseAt);
        expect.soft(fixtureWorkDrainedAt).toBeGreaterThanOrEqual(releaseAt);
        for (const pending of harness.state.pendingBudgetWork) {
          expect.soft(pending.releasedAt).toBeGreaterThanOrEqual(releaseAt);
          expect.soft(pending.drainedAt).toBeGreaterThanOrEqual(releaseAt);
        }
        for (const peer of [app, operator]) {
          expect.soft(peer?.releasedAt).toBeGreaterThanOrEqual(releaseAt);
          expect.soft(peer?.settledAt).toBeLessThanOrEqual(invocation.returnedAt);
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
        expect.soft(invocation.returnedAt - invocation.controllerCreatedAt).toBeLessThan(15_000);
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

    it.each([
      ["migration-pending", "migration-identity", "owner", []],
      ["app-authority-pending", "app-authority", "aoa_app", ["aoa_app"]],
      ["operator-authority-pending", "operator-authority", "aoa_operator", ["aoa_app", "aoa_operator"]],
    ] as const)("causally bounds and settles a statement-timeout-free %s query", async (
      injection,
      phase,
      role,
      expectedAllocatedRoles,
    ) => {
      // Mutation caught: limiting only the advisory handshake lets a pre-handshake owner or
      // authority query exceed the one immutable startup deadline. The real query ignores abort
      // and has no statement timeout; production must cancel and await it before returning.
      guard();
      const harness = await createAdvisoryStartupHarness(injection);
      const operation = harness.open(harness.input);
      try {
        const outcome = await withOuterWatchdog(operation);
        const [invocation] = harness.state.openInvocations;
        const returnedAt = invocation?.returnedAt;
        const settlement = await observeAdvisoryStartupSettlement(harness.token);

        expect.soft(outcome.kind, "public startup must settle before the outer watchdog").toBe("rejected");
        expect.soft(outcome).toMatchObject({
          kind: "rejected",
          error: {
            name: "DistributedExecutionStartupError",
            message: "distributed_execution_timeout",
          },
        });
        expect.soft(typeof returnedAt).toBe("number");
        const publicReturnedAt = returnedAt ?? -1;
        const receipts = harness.state.pendingQueries.filter((receipt) => receipt.phase === phase);
        expect.soft(receipts).toHaveLength(1);
        expect.soft(receipts[0]).toMatchObject({
          phase,
          role,
          effectiveStatementTimeout: expect.any(String),
          backendPid: expect.any(Number),
          settledAt: expect.any(Number),
        });
        const effectiveTimeoutMs = statementTimeoutMs(receipts[0]?.effectiveStatementTimeout ?? null);
        expect.soft(effectiveTimeoutMs).not.toBeNull();
        expect.soft(effectiveTimeoutMs ?? Number.NEGATIVE_INFINITY).toBeGreaterThanOrEqual(0);
        expect.soft(effectiveTimeoutMs ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(5_000);
        expect.soft(receipts[0]?.settledAt ?? Number.POSITIVE_INFINITY)
          .toBeLessThanOrEqual(publicReturnedAt);
        expect.soft(receipts[0]?.signal).toBe(invocation?.controllers[0]?.signal);
        expect.soft(receipts[0]?.signal?.aborted).toBe(true);
        expect.soft(receipts[0]?.abortObservedAt ?? Number.NEGATIVE_INFINITY).toBeGreaterThanOrEqual(
          (invocation?.controllerCreatedAt ?? Number.POSITIVE_INFINITY) + 4_500,
        );
        expect.soft(receipts[0]?.abortObservedAt ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
          (invocation?.controllerCreatedAt ?? Number.NEGATIVE_INFINITY) + 6_500,
        );
        expect.soft(receipts[0]?.abortObservedAt ?? Number.POSITIVE_INFINITY)
          .toBeLessThanOrEqual(publicReturnedAt);

        const targetTransactions = harness.state.transactionReceipts.filter((receipt) =>
          receipt.invocationId === invocation?.id && receipt.phase === phase);
        expect.soft(targetTransactions).toHaveLength(1);
        expect.soft(targetTransactions[0]).toMatchObject({
          role,
          phase,
          outcome: "rejected",
          settledAt: expect.any(Number),
        });
        expect.soft(targetTransactions[0]?.settledAt ?? Number.POSITIVE_INFINITY)
          .toBeLessThanOrEqual(publicReturnedAt);

        const expectedRoles = [...expectedAllocatedRoles].sort();
        expect.soft(harness.state.factoryOptions.map(({ role: allocatedRole }) => allocatedRole).sort())
          .toEqual(expectedRoles);
        expect.soft(harness.state.closes.map(({ role: closedRole }) => closedRole).sort())
          .toEqual(expectedRoles);
        expect.soft(harness.state.closes.map(({ input }) => input))
          .toEqual(expectedRoles.map(() => ({ timeoutSeconds: 5 })));
        expect.soft(harness.state.closeSettled.map(({ role: closedRole }) => closedRole).sort())
          .toEqual(expectedRoles);
        for (const close of harness.state.closeSettled) {
          expect.soft(close.at).toBeLessThanOrEqual(publicReturnedAt);
        }
        expect.soft(settlement).toEqual({
          participant_pids: 0,
          owner_pids: 1,
          owner_in_transaction: 0,
          advisory_locks: 0,
        });
        assertClosedStartupLogs(harness.state.logs);
        expectCaseInsensitiveRedaction(JSON.stringify(harness.state.logs), [
          harness.appNamedUrl,
          harness.operatorNamedUrl,
          adminUrl,
          "aoa_app",
          "aoa_operator",
          "pg_sleep",
          "test:test",
          "postgres://",
          DRIVER_CAUSE_SENTINEL,
          SQL_SENTINEL,
          ...checkedInMigrationIdentity().orderedHashes,
          ...harness.state.advisoryKeyBindings.map(String),
        ]);
      } finally {
        await harness.cleanup();
        const operationDrained = (await withOuterWatchdog(
          operation.then(() => true, () => true),
          5_000,
        )).kind === "fulfilled";
        expect(operationDrained).toBe(true);
      }
    }, 30_000);

    it.each([
      ["migration-pending", "migration-identity", "owner", []],
      ["app-authority-pending", "app-authority", "aoa_app", ["aoa_app"]],
      ["operator-authority-pending", "operator-authority", "aoa_operator", ["aoa_app", "aoa_operator"]],
      ["owner-exclusive-pending", "owner-exclusive", "owner", ["aoa_app", "aoa_operator"]],
      ["app-negative-pending", "app-negative", "aoa_app", ["aoa_app", "aoa_operator"]],
      ["operator-negative-pending", "operator-negative", "aoa_operator", ["aoa_app", "aoa_operator"]],
      ["app-positive-pending", "app-positive", "aoa_app", ["aoa_app", "aoa_operator"]],
      ["operator-positive-pending", "operator-positive", "aoa_operator", ["aoa_app", "aoa_operator"]],
    ] as const)("promptly settles %s after the exact startup controller is externally aborted", async (
      injection,
      phase,
      role,
      expectedAllocatedRoles,
    ) => {
      // Fail-first control: receipt observation never cancels or releases the sleep. Only production
      // may turn this exact shared-controller abort into query, transaction, close, and public settle.
      guard();
      const harness = await createAdvisoryStartupHarness(injection);
      const operation = harness.open(harness.input);
      void operation.catch(() => {});
      try {
        const pending = await harness.waitForActivePendingQuery(phase, 3_000);
        const [invocation] = harness.state.openInvocations;
        const matchingPendingQueries = harness.state.pendingQueries.filter((receipt) =>
          receipt.invocationId === invocation?.id && receipt.phase === phase,
        );
        expect(matchingPendingQueries).toHaveLength(1);
        expect(matchingPendingQueries[0]).toBe(pending);
        expect(invocation?.controllers).toHaveLength(1);
        const controller = invocation!.controllers[0]!;
        expect(harness.state.abortControllers).toEqual([controller]);
        expect(pending.signal).toBe(controller.signal);
        expect(controller.signal.aborted).toBe(false);
        expect(invocation?.deadlineReceipt).toBeNull();
        expect(invocation?.returnedAt).toBeNull();
        expect(pending).toMatchObject({
          phase,
          role,
          backendPid: expect.any(Number),
          effectiveStatementTimeout: expect.any(String),
          sleepIssuedAt: expect.any(Number),
          abortObservedAt: null,
          settledAt: null,
        });
        const targetTransactions = harness.state.transactionReceipts.filter((receipt) =>
          receipt.invocationId === invocation?.id && receipt.phase === phase);
        expect(targetTransactions).toHaveLength(1);
        expect(targetTransactions[0]).toMatchObject({
          role,
          phase,
          outcome: "pending",
          settledAt: null,
        });
        expect(harness.state.closeAttempts).toEqual([]);
        expect(harness.state.closeSettled).toEqual([]);

        const effectiveTimeoutMs = statementTimeoutMs(pending.effectiveStatementTimeout);
        expect(effectiveTimeoutMs).not.toBeNull();
        const transactionsPendingAtAbort = harness.state.transactionReceipts.filter((receipt) =>
          receipt.invocationId === invocation?.id &&
          receipt.outcome === "pending" && receipt.settledAt === null,
        );
        expect(transactionsPendingAtAbort.length).toBeGreaterThan(0);
        expect(transactionsPendingAtAbort).toContain(targetTransactions[0]);
        const externallyAbortedAt = performance.now();
        expect(externallyAbortedAt - (invocation?.controllerCreatedAt ?? Number.NEGATIVE_INFINITY))
          .toBeLessThan(3_500);
        controller.abort();
        const exactAbortAt = invocation?.deadlineReceipt?.at;
        expect(typeof exactAbortAt).toBe("number");
        expect(pending.sleepIssuedAt ?? Number.POSITIVE_INFINITY)
          .toBeLessThanOrEqual(exactAbortAt ?? Number.NEGATIVE_INFINITY);
        const timeoutRemainingAtAbort = effectiveTimeoutMs === 0
          ? 0
          : (effectiveTimeoutMs ?? Number.NEGATIVE_INFINITY) -
            ((exactAbortAt ?? Number.POSITIVE_INFINITY) -
              (pending.sleepIssuedAt ?? Number.NEGATIVE_INFINITY));
        expect(
          timeoutRemainingAtAbort === 0 ||
          timeoutRemainingAtAbort > EARLY_ABORT_SETTLEMENT_WATCHDOG_MS,
          `SQL timeout remaining at abort (${timeoutRemainingAtAbort}ms) must not settle the short watchdog lane`,
        ).toBe(true);

        const promptSettlementDeadline = (exactAbortAt ?? Number.NEGATIVE_INFINITY) +
          EARLY_ABORT_SETTLEMENT_WATCHDOG_MS;
        const promptSettlement = await waitForReceiptSettlement(
          [pending, ...transactionsPendingAtAbort],
          promptSettlementDeadline,
        );
        expect.soft(promptSettlement).toMatchObject({
          kind: "settled",
          observedAt: expect.any(Number),
        });
        expect.soft(pending.settledAt ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
          promptSettlementDeadline,
        );
        for (const transaction of transactionsPendingAtAbort) {
          expect.soft(transaction.settledAt ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
            promptSettlementDeadline,
          );
        }
        expect.soft(pending.abortObservedAt ?? Number.NEGATIVE_INFINITY)
          .toBeGreaterThanOrEqual(exactAbortAt ?? Number.POSITIVE_INFINITY);
        expect.soft(pending.settledAt ?? Number.NEGATIVE_INFINITY)
          .toBeGreaterThanOrEqual(pending.abortObservedAt ?? Number.POSITIVE_INFINITY);
        expect.soft(targetTransactions[0]).toMatchObject({
          role,
          phase,
          outcome: "rejected",
          settledAt: expect.any(Number),
        });
        for (const transaction of transactionsPendingAtAbort) {
          expect.soft(transaction.outcome, `${transaction.role}:${transaction.phase}`).not.toBe("pending");
          expect.soft(transaction.settledAt ?? Number.NEGATIVE_INFINITY)
            .toBeGreaterThanOrEqual(pending.abortObservedAt ?? Number.POSITIVE_INFINITY);
        }

        const publicWatchdogRemaining = Math.max(
          1,
          EARLY_ABORT_PUBLIC_WATCHDOG_MS -
            (performance.now() - (exactAbortAt ?? Number.NEGATIVE_INFINITY)),
        );
        const outcome = await withOuterWatchdog(operation, publicWatchdogRemaining);
        const publicReturnedAt = invocation?.returnedAt;
        const settlement = await observeAdvisoryStartupSettlement(harness.token);
        expect.soft(outcome).toMatchObject({
          kind: "rejected",
          error: {
            name: "DistributedExecutionStartupError",
            message: "distributed_execution_timeout",
          },
        });
        expect.soft(typeof publicReturnedAt).toBe("number");
        expect.soft(publicReturnedAt ?? Number.NEGATIVE_INFINITY)
          .toBeGreaterThanOrEqual(externallyAbortedAt);
        expect.soft(publicReturnedAt ?? Number.NEGATIVE_INFINITY)
          .toBeGreaterThanOrEqual(exactAbortAt ?? Number.POSITIVE_INFINITY);
        expect.soft((publicReturnedAt ?? Number.POSITIVE_INFINITY) - externallyAbortedAt)
          .toBeLessThan(EARLY_ABORT_PUBLIC_WATCHDOG_MS);
        expect.soft(harness.state.abortCalls).toBe(1);
        expect.soft(harness.state.abortAt ?? Number.NEGATIVE_INFINITY)
          .toBeGreaterThanOrEqual(externallyAbortedAt);
        expect.soft(invocation?.deadlineReceipt).toMatchObject({
          invocationId: invocation?.id,
          signal: controller.signal,
          at: expect.any(Number),
        });
        expect.soft(invocation?.deadlineReceipt?.at ?? Number.NEGATIVE_INFINITY)
          .toBeGreaterThanOrEqual(externallyAbortedAt);
        expect.soft(pending).toMatchObject({
          phase,
          role,
          backendPid: expect.any(Number),
          effectiveStatementTimeout: expect.any(String),
          abortObservedAt: expect.any(Number),
          settledAt: expect.any(Number),
        });
        expect.soft(pending.abortObservedAt ?? Number.NEGATIVE_INFINITY)
          .toBeGreaterThanOrEqual(externallyAbortedAt);
        expect.soft(pending.abortObservedAt ?? Number.NEGATIVE_INFINITY)
          .toBeGreaterThanOrEqual(invocation?.deadlineReceipt?.at ?? Number.POSITIVE_INFINITY);
        expect.soft(pending.abortObservedAt ?? Number.POSITIVE_INFINITY)
          .toBeLessThanOrEqual(publicReturnedAt ?? -1);
        expect.soft(pending.settledAt ?? Number.NEGATIVE_INFINITY)
          .toBeGreaterThanOrEqual(pending.abortObservedAt ?? Number.POSITIVE_INFINITY);
        expect.soft(pending.settledAt ?? Number.POSITIVE_INFINITY)
          .toBeLessThanOrEqual(publicReturnedAt ?? -1);

        expect.soft(targetTransactions[0]).toMatchObject({
          role,
          phase,
          outcome: "rejected",
          settledAt: expect.any(Number),
        });
        expect.soft(targetTransactions[0]?.settledAt ?? Number.NEGATIVE_INFINITY)
          .toBeGreaterThanOrEqual(pending.abortObservedAt ?? Number.POSITIVE_INFINITY);
        expect.soft(targetTransactions[0]?.settledAt ?? Number.POSITIVE_INFINITY)
          .toBeLessThanOrEqual(publicReturnedAt ?? -1);
        for (const transaction of transactionsPendingAtAbort) {
          expect.soft(transaction.outcome, `${transaction.role}:${transaction.phase}`).not.toBe("pending");
          expect.soft(transaction.settledAt ?? Number.NEGATIVE_INFINITY)
            .toBeGreaterThanOrEqual(pending.abortObservedAt ?? Number.POSITIVE_INFINITY);
          expect.soft(transaction.settledAt ?? Number.POSITIVE_INFINITY)
            .toBeLessThanOrEqual(publicReturnedAt ?? -1);
        }

        const expectedRoles = [...expectedAllocatedRoles].sort();
        expect.soft(harness.state.factoryOptions.map(({ role: allocatedRole }) => allocatedRole).sort())
          .toEqual(expectedRoles);
        expect.soft(harness.state.closes.map(({ role: closedRole }) => closedRole).sort())
          .toEqual(expectedRoles);
        expect.soft(harness.state.closes.map(({ input }) => input))
          .toEqual(expectedRoles.map(() => ({ timeoutSeconds: 5 })));
        expect.soft(harness.state.closeAttempts.map(({ role: closedRole }) => closedRole).sort())
          .toEqual(expectedRoles);
        expect.soft(harness.state.closeSettled.map(({ role: closedRole }) => closedRole).sort())
          .toEqual(expectedRoles);
        for (const attempt of harness.state.closeAttempts) {
          expect.soft(attempt.at).toBeGreaterThanOrEqual(pending.abortObservedAt ?? Number.POSITIVE_INFINITY);
          expect.soft(attempt.at).toBeLessThanOrEqual(publicReturnedAt ?? -1);
          const settled = harness.state.closeSettled.find(({ role: settledRole }) =>
            settledRole === attempt.role);
          expect.soft(settled?.at ?? Number.NEGATIVE_INFINITY).toBeGreaterThanOrEqual(attempt.at);
          expect.soft(settled?.at ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(publicReturnedAt ?? -1);
        }
        expect.soft(settlement).toEqual({
          participant_pids: 0,
          owner_pids: 1,
          owner_in_transaction: 0,
          advisory_locks: 0,
        });
        assertClosedStartupLogs(harness.state.logs);
        expectCaseInsensitiveRedaction(JSON.stringify(harness.state.logs), [
          harness.appNamedUrl,
          harness.operatorNamedUrl,
          adminUrl,
          "aoa_app",
          "aoa_operator",
          "pg_sleep",
          "test:test",
          "postgres://",
          DRIVER_CAUSE_SENTINEL,
          SQL_SENTINEL,
          ...checkedInMigrationIdentity().orderedHashes,
          ...harness.state.advisoryKeyBindings.map(String),
        ]);
      } finally {
        // Cleanup is deliberately after every production-settlement assertion. It is only the
        // finite RED-lane escape hatch and cannot make the query or public operation look settled.
        await harness.cleanup();
        const drained = await withOuterWatchdog(
          operation.then(() => true, () => true),
          5_000,
        );
        expect(drained).toMatchObject({ kind: "fulfilled", value: true });
      }
    }, 30_000);

    it("bounds and awaits a pending owner cleanup query on normal returned close", async () => {
      guard();
      const harness = await createAdvisoryStartupHarness("cleanup-pending");
      const accepted = await harness.open(harness.input);
      expect(accepted).not.toBeNull();
      const closeOperation = accepted!.close();
      try {
        const outcome = await withOuterWatchdog(closeOperation);
        const returnedAt = outcome.kind === "watchdog" ? null : performance.now();
        const settlement = await observeAdvisoryStartupSettlement(harness.token);
        expect.soft(outcome).toMatchObject({
          kind: "rejected",
          error: {
            name: "DistributedExecutionStartupError",
            message: "distributed_execution_close",
          },
        });
        expect.soft(typeof returnedAt).toBe("number");
        const publicReturnedAt = returnedAt ?? -1;
        expect.soft(harness.state.pendingQueries).toHaveLength(1);
        expect.soft(harness.state.pendingQueries[0]).toMatchObject({
          phase: "cleanup",
          role: "owner",
          effectiveStatementTimeout: expect.any(String),
          backendPid: expect.any(Number),
          settledAt: expect.any(Number),
        });
        const cleanupElapsedMs = publicReturnedAt - (harness.state.pendingQueries[0]?.startedAt ?? 0);
        expect.soft(cleanupElapsedMs).toBeGreaterThanOrEqual(4_500);
        expect.soft(cleanupElapsedMs).toBeLessThan(6_500);
        const effectiveTimeoutMs = statementTimeoutMs(
          harness.state.pendingQueries[0]?.effectiveStatementTimeout ?? null,
        );
        expect.soft(effectiveTimeoutMs).not.toBeNull();
        expect.soft(effectiveTimeoutMs ?? Number.NEGATIVE_INFINITY).toBeGreaterThanOrEqual(0);
        expect.soft(effectiveTimeoutMs ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(5_000);
        expect.soft(harness.state.pendingQueries[0]?.settledAt ?? Number.POSITIVE_INFINITY)
          .toBeLessThanOrEqual(publicReturnedAt);
        const cleanupTransactions = harness.state.transactionReceipts.filter((receipt) =>
          receipt.phase === "cleanup");
        expect.soft(cleanupTransactions).toHaveLength(1);
        expect.soft(cleanupTransactions[0]).toMatchObject({
          role: "owner",
          phase: "cleanup",
          outcome: "rejected",
          settledAt: expect.any(Number),
        });
        expect.soft(cleanupTransactions[0]?.settledAt ?? Number.POSITIVE_INFINITY)
          .toBeLessThanOrEqual(publicReturnedAt);
        const expectedRoles = ["aoa_app", "aoa_operator"];
        expect.soft(harness.state.closes.map(({ role }) => role).sort()).toEqual(expectedRoles);
        expect.soft(harness.state.closes.map(({ input }) => input))
          .toEqual(expectedRoles.map(() => ({ timeoutSeconds: 5 })));
        expect.soft(harness.state.closeSettled.map(({ role }) => role).sort()).toEqual(expectedRoles);
        for (const close of harness.state.closeSettled) {
          expect.soft(close.at).toBeLessThanOrEqual(publicReturnedAt);
        }
        expect.soft(settlement).toEqual({
          participant_pids: 0,
          owner_pids: 1,
          owner_in_transaction: 0,
          advisory_locks: 0,
        });
        expect.soft(harness.state.logs).toEqual([]);
      } finally {
        await harness.cleanup();
        const operationDrained = (await withOuterWatchdog(
          closeOperation.then(() => true, () => true),
          5_000,
        )).kind === "fulfilled";
        expect(operationDrained).toBe(true);
      }
    }, 30_000);

    it("bounds and awaits a pending owner cleanup query after startup failure", async () => {
      guard();
      const harness = await createAdvisoryStartupHarness("cleanup-failure-pending");
      const operation = harness.open(harness.input);
      try {
        const outcome = await withOuterWatchdog(operation, 18_000);
        const [invocation] = harness.state.openInvocations;
        const returnedAt = invocation?.returnedAt;
        const settlement = await observeAdvisoryStartupSettlement(harness.token);
        expect.soft(outcome).toMatchObject({
          kind: "rejected",
          error: {
            name: "DistributedExecutionStartupError",
            message: "distributed_execution_close",
          },
        });
        expect.soft(typeof returnedAt).toBe("number");
        const publicReturnedAt = returnedAt ?? -1;
        expect.soft(harness.state.injectionTriggered).toBe(true);
        expect.soft(harness.state.pendingQueries).toHaveLength(1);
        expect.soft(harness.state.pendingQueries[0]).toMatchObject({
          phase: "cleanup",
          role: "owner",
          effectiveStatementTimeout: expect.any(String),
          backendPid: expect.any(Number),
          settledAt: expect.any(Number),
        });
        const cleanupElapsedMs = publicReturnedAt - (harness.state.pendingQueries[0]?.startedAt ?? 0);
        expect.soft(cleanupElapsedMs).toBeGreaterThanOrEqual(4_500);
        expect.soft(cleanupElapsedMs).toBeLessThan(6_500);
        const effectiveTimeoutMs = statementTimeoutMs(
          harness.state.pendingQueries[0]?.effectiveStatementTimeout ?? null,
        );
        expect.soft(effectiveTimeoutMs).not.toBeNull();
        expect.soft(effectiveTimeoutMs ?? Number.NEGATIVE_INFINITY).toBeGreaterThanOrEqual(0);
        expect.soft(effectiveTimeoutMs ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(5_000);
        expect.soft(harness.state.pendingQueries[0]?.settledAt ?? Number.POSITIVE_INFINITY)
          .toBeLessThanOrEqual(publicReturnedAt);
        const cleanupTransactions = harness.state.transactionReceipts.filter((receipt) =>
          receipt.invocationId === invocation?.id && receipt.phase === "cleanup");
        expect.soft(cleanupTransactions).toHaveLength(1);
        expect.soft(cleanupTransactions[0]).toMatchObject({
          role: "owner",
          phase: "cleanup",
          outcome: "rejected",
          settledAt: expect.any(Number),
        });
        expect.soft(cleanupTransactions[0]?.settledAt ?? Number.POSITIVE_INFINITY)
          .toBeLessThanOrEqual(publicReturnedAt);
        const expectedRoles = ["aoa_app", "aoa_operator"];
        expect.soft(harness.state.closes.map(({ role }) => role).sort()).toEqual(expectedRoles);
        expect.soft(harness.state.closes.map(({ input }) => input))
          .toEqual(expectedRoles.map(() => ({ timeoutSeconds: 5 })));
        expect.soft(harness.state.closeSettled.map(({ role }) => role).sort()).toEqual(expectedRoles);
        for (const close of harness.state.closeSettled) {
          expect.soft(close.at).toBeLessThanOrEqual(publicReturnedAt);
        }
        expect.soft(settlement).toEqual({
          participant_pids: 0,
          owner_pids: 1,
          owner_in_transaction: 0,
          advisory_locks: 0,
        });
        assertClosedStartupLogs(harness.state.logs);
        expectCaseInsensitiveRedaction(JSON.stringify(harness.state.logs), [
          harness.appNamedUrl,
          harness.operatorNamedUrl,
          adminUrl,
          "aoa_app",
          "aoa_operator",
          "pg_sleep",
          "test:test",
          "postgres://",
          DRIVER_CAUSE_SENTINEL,
          SQL_SENTINEL,
          ...checkedInMigrationIdentity().orderedHashes,
          ...harness.state.advisoryKeyBindings.map(String),
        ]);
      } finally {
        await harness.cleanup();
        const operationDrained = (await withOuterWatchdog(
          operation.then(() => true, () => true),
          5_000,
        )).kind === "fulfilled";
        expect(operationDrained).toBe(true);
      }
    }, 30_000);

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
        expect(failure, injection).toMatchObject({
          name: "DistributedExecutionStartupError",
          message: expect.stringMatching(/^distributed_execution_/u),
        });
        expect(STARTUP_ERROR_CODES.has(String((failure as { message?: unknown }).message)), injection)
          .toBe(true);
        expect(Object.prototype.hasOwnProperty.call(failure, "cause"), injection).toBe(false);
        expect(harness.state.closes.map((entry) => entry.role).sort(), injection)
          .toEqual(["aoa_app", "aoa_operator"]);
        expect(harness.state.closes.map(({ input }) => input), injection)
          .toEqual([{ timeoutSeconds: 5 }, { timeoutSeconds: 5 }]);
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
        assertClosedStartupLogs(harness.state.logs);
        const serializedLogs = JSON.stringify(harness.state.logs);
        expectCaseInsensitiveRedaction(serializedLogs, [
          harness.appNamedUrl, harness.operatorNamedUrl, adminUrl, "aoa_app", "aoa_operator",
          "postgres://", "test:test", "pg_advisory", "903003",
          "startup-app-password", "startup-operator-password",
          DRIVER_CAUSE_SENTINEL, SQL_SENTINEL,
          ...checkedInMigrationIdentity().orderedHashes,
          ...harness.state.advisoryKeyBindings.map(String),
        ]);
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
        "REVOKE SELECT (label) ON workers FROM aoa_app",
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
