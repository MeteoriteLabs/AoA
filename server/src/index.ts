/// <reference path="./types/express.d.ts" />
import "./env-compat.js"; // side-effect: mirror PAPERCLIP_* env to AOA_* for migration
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { Request as ExpressRequest, RequestHandler } from "express";
import { and, eq, sql } from "drizzle-orm";
import {
  createDb,
  ensurePostgresDatabase,
  inspectMigrations,
  applyPendingMigrations,
  reconcilePendingMigrationHistory,
  formatDatabaseBackupResult,
  runDatabaseBackup,
  authUsers,
  companies,
  companyMemberships,
  instanceUserRoles,
  agents,
  marketplaceCatalogCache,
  marketplaceCompanySettings,
} from "@armyofagents/db";
import detectPort from "detect-port";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { logger } from "./middleware/logger.js";
import { setupLiveEventsWebSocketServer } from "./realtime/live-events-ws.js";
import {
  heartbeatService,
  issueMonitorSchedulerService,
  productivityReviewService,
  routineService,
  processFileImportQueue,
  resetStuckJobs,
  WORKER_INTERVAL_MS,
} from "./services/index.js";
import { getDbCapabilities, probeDbCapabilities } from "./services/db-capabilities.js";
import { runExtractionSweep } from "./services/internal-agent/subagents/extraction-sweeper.js";
import { runAdjutantSweep } from "./services/internal-agent/aoa-agents/sweep-adjutant.js";
import { runMemoryKeeperSweep, MK_SWEEP_DEBOUNCE_MS } from "./services/internal-agent/aoa-agents/sweep-memory-keeper.js";
import {
  reconcilePersistedRuntimeServicesOnStartup,
  restartDesiredRuntimeServicesOnStartup,
} from "./services/workspace-runtime.js";
import { handlePreviewProxyUpgrade } from "./services/preview-proxy.js";
import { scheduleTtlSweeper } from "./services/workspace-ttl-sweeper.js";
import { scheduleCleanupRetrySweeper } from "./services/workspace-cleanup-retry-sweeper.js";
import { registerHeartbeatWatchdogSweeper } from "./services/heartbeat-watchdog.js";
import { startEmbeddingWorker } from "./services/embeddings-worker.js";
import { onBudgetExhausted } from "./services/budget-hooks.js";
import { createStorageServiceFromConfig } from "./storage/index.js";
import { printStartupBanner } from "./startup-banner.js";
import { getBoardClaimWarningUrl, initializeBoardClaimChallenge } from "./board-claim.js";
import { tryRecoverOrphanPostgres } from "./postgres/embedded-orphan-recovery.js";
import { DEFAULT_BACKUP_RETENTION, MARKETPLACE_SETTINGS_DEFAULTS } from "@armyofagents/shared";
import { ensureCommandStaff } from "./services/internal-agent/aoa-agents/ensure-command-staff.js";
import { ensureAdjutant } from "./services/internal-agent/aoa-agents/ensure-adjutant.js";
import { ensureMaker } from "./services/internal-agent/aoa-agents/ensure-maker.js";
import { ensureCommanderAgent } from "./services/internal-agent/aoa-agents/ensure-commander.js";
import { ensureExtractionAgent } from "./services/internal-agent/aoa-agents/ensure-extraction-agent.js";
import { backfillGoalParents } from "./migrations/backfill-goal-parents.js";
import { backfillCrewTemplateOrigin } from "./services/internal-agent/aoa-agents/backfill-template-origin.js";
import { checkCrewUpdates } from "./services/marketplace-install/crew-updater.js";
import { agentInstructionsService } from "./services/agent-instructions.js";

type BetterAuthSessionUser = {
  id: string;
  email?: string | null;
  name?: string | null;
};

type BetterAuthSessionResult = {
  session: { id: string; userId: string } | null;
  user: BetterAuthSessionUser | null;
};

type EmbeddedPostgresInstance = {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
};

type EmbeddedPostgresCtor = new (opts: {
  databaseDir: string;
  user: string;
  password: string;
  port: number;
  persistent: boolean;
  /**
   * Flags forwarded to `initdb` when the cluster is first created. Used to
   * force UTF-8 encoding so non-Latin-1 characters (right-arrow `→`, em-dashes,
   * emoji, CJK) can be stored. On Windows, the default initdb takes the OS
   * locale (WIN1252), and INSERTs of UTF-8-only chars then fail with
   * `character with byte sequence … has no equivalent in encoding "WIN1252"`.
   */
  initdbFlags?: string[];
  onLog?: (message: unknown) => void;
  onError?: (message: unknown) => void;
}) => EmbeddedPostgresInstance;

const config = loadConfig();
if (process.env.AOA_SECRETS_PROVIDER === undefined) {
  process.env.AOA_SECRETS_PROVIDER = config.secretsProvider;
}
if (process.env.AOA_SECRETS_STRICT_MODE === undefined) {
  process.env.AOA_SECRETS_STRICT_MODE = config.secretsStrictMode ? "true" : "false";
}
if (process.env.AOA_SECRETS_MASTER_KEY_FILE === undefined) {
  process.env.AOA_SECRETS_MASTER_KEY_FILE = config.secretsMasterKeyFilePath;
}

type MigrationSummary =
  | "skipped"
  | "already applied"
  | "applied (empty database)"
  | "applied (pending migrations)"
  | "pending migrations skipped";

function formatPendingMigrationSummary(migrations: string[]): string {
  if (migrations.length === 0) return "none";
  return migrations.length > 3
    ? `${migrations.slice(0, 3).join(", ")} (+${migrations.length - 3} more)`
    : migrations.join(", ");
}

async function promptApplyMigrations(migrations: string[]): Promise<boolean> {
  if (process.env.AOA_MIGRATION_PROMPT === "never") return false;
  if (process.env.AOA_MIGRATION_AUTO_APPLY === "true") return true;
  if (!stdin.isTTY || !stdout.isTTY) return true;

  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await prompt.question(
      `Apply pending migrations (${formatPendingMigrationSummary(migrations)}) now? (y/N): `,
    )).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    prompt.close();
  }
}

type EnsureMigrationsOptions = {
  autoApply?: boolean;
};

async function ensureMigrations(
  connectionString: string,
  label: string,
  opts?: EnsureMigrationsOptions,
): Promise<MigrationSummary> {
  const autoApply = opts?.autoApply === true;
  let state = await inspectMigrations(connectionString);
  if (state.status === "needsMigrations" && state.reason === "pending-migrations") {
    const repair = await reconcilePendingMigrationHistory(connectionString);
    if (repair.repairedMigrations.length > 0) {
      logger.warn(
        { repairedMigrations: repair.repairedMigrations },
        `${label} had drifted migration history; repaired migration journal entries from existing schema state.`,
      );
      state = await inspectMigrations(connectionString);
      if (state.status === "upToDate") return "already applied";
    }
  }
  if (state.status === "upToDate") return "already applied";
  if (state.status === "needsMigrations" && state.reason === "no-migration-journal-non-empty-db") {
    logger.warn(
      { tableCount: state.tableCount },
      `${label} has existing tables but no migration journal. Run migrations manually to sync schema.`,
    );
    const apply = autoApply ? true : await promptApplyMigrations(state.pendingMigrations);
    if (!apply) {
      logger.warn(
        { pendingMigrations: state.pendingMigrations },
        `${label} has pending migrations; continuing without applying. Run pnpm db:migrate to apply before startup.`,
      );
      return "pending migrations skipped";
    }

    logger.info({ pendingMigrations: state.pendingMigrations }, `Applying ${state.pendingMigrations.length} pending migrations for ${label}`);
    await applyPendingMigrations(connectionString);
    return "applied (pending migrations)";
  }

  const apply = autoApply ? true : await promptApplyMigrations(state.pendingMigrations);
  if (!apply) {
    logger.warn(
      { pendingMigrations: state.pendingMigrations },
      `${label} has pending migrations; continuing without applying. Run pnpm db:migrate to apply before startup.`,
    );
    return "pending migrations skipped";
  }

  logger.info({ pendingMigrations: state.pendingMigrations }, `Applying ${state.pendingMigrations.length} pending migrations for ${label}`);
  await applyPendingMigrations(connectionString);
  return "applied (pending migrations)";
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
}

const LOCAL_BOARD_USER_ID = "local-board";
const LOCAL_BOARD_USER_EMAIL = "local@aoa.local";
const LOCAL_BOARD_USER_NAME = "Board";

async function ensureLocalTrustedBoardPrincipal(db: any): Promise<void> {
  const now = new Date();
  const existingUser = await db
    .select({ id: authUsers.id })
    .from(authUsers)
    .where(eq(authUsers.id, LOCAL_BOARD_USER_ID))
    .then((rows: Array<{ id: string }>) => rows[0] ?? null);

  if (!existingUser) {
    await db.insert(authUsers).values({
      id: LOCAL_BOARD_USER_ID,
      name: LOCAL_BOARD_USER_NAME,
      email: LOCAL_BOARD_USER_EMAIL,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  const role = await db
    .select({ id: instanceUserRoles.id })
    .from(instanceUserRoles)
    .where(and(eq(instanceUserRoles.userId, LOCAL_BOARD_USER_ID), eq(instanceUserRoles.role, "instance_admin")))
    .then((rows: Array<{ id: string }>) => rows[0] ?? null);
  if (!role) {
    await db.insert(instanceUserRoles).values({
      userId: LOCAL_BOARD_USER_ID,
      role: "instance_admin",
    });
  }

  const companyRows = await db.select({ id: companies.id }).from(companies);
  for (const company of companyRows) {
    const membership = await db
      .select({ id: companyMemberships.id })
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.companyId, company.id),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, LOCAL_BOARD_USER_ID),
        ),
      )
      .then((rows: Array<{ id: string }>) => rows[0] ?? null);
    if (membership) continue;
    await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "user",
      principalId: LOCAL_BOARD_USER_ID,
      status: "active",
      membershipRole: "owner",
    });
  }
}

let db: ReturnType<typeof import("@armyofagents/db").createDb> | undefined;
let embeddedPostgres: EmbeddedPostgresInstance | null = null;
let embeddedPostgresStartedByThisProcess = false;
let migrationSummary: MigrationSummary = "skipped";
let activeDatabaseConnectionString: string;
let startupDbInfo:
  | { mode: "external-postgres"; connectionString: string }
  | { mode: "embedded-postgres"; dataDir: string; port: number };
if (config.databaseUrl) {
  migrationSummary = await ensureMigrations(config.databaseUrl, "PostgreSQL");

  db = createDb(config.databaseUrl);
  logger.info("Using external PostgreSQL via DATABASE_URL/config");
  activeDatabaseConnectionString = config.databaseUrl;
  startupDbInfo = { mode: "external-postgres", connectionString: config.databaseUrl };
} else {
  const moduleName = "embedded-postgres";
  let EmbeddedPostgres: EmbeddedPostgresCtor;
  try {
    const mod = await import(moduleName);
    EmbeddedPostgres = mod.default as EmbeddedPostgresCtor;
  } catch {
    throw new Error(
      "Embedded PostgreSQL mode requires dependency `embedded-postgres`. Reinstall dependencies (without omitting required packages), or set DATABASE_URL for external Postgres.",
    );
  }

  const dataDir = resolve(config.embeddedPostgresDataDir);
  const configuredPort = config.embeddedPostgresPort;
  let port = configuredPort;
  const embeddedPostgresLogBuffer: string[] = [];
  const EMBEDDED_POSTGRES_LOG_BUFFER_LIMIT = 120;
  const verboseEmbeddedPostgresLogs = process.env.AOA_EMBEDDED_POSTGRES_VERBOSE === "true";
  const appendEmbeddedPostgresLog = (message: unknown) => {
    const text = typeof message === "string" ? message : message instanceof Error ? message.message : String(message ?? "");
    for (const lineRaw of text.split(/\r?\n/)) {
      const line = lineRaw.trim();
      if (!line) continue;
      embeddedPostgresLogBuffer.push(line);
      if (embeddedPostgresLogBuffer.length > EMBEDDED_POSTGRES_LOG_BUFFER_LIMIT) {
        embeddedPostgresLogBuffer.splice(0, embeddedPostgresLogBuffer.length - EMBEDDED_POSTGRES_LOG_BUFFER_LIMIT);
      }
      if (verboseEmbeddedPostgresLogs) {
        logger.info({ embeddedPostgresLog: line }, "embedded-postgres");
      }
    }
  };
  const logEmbeddedPostgresFailure = (phase: "initialise" | "start", err: unknown) => {
    if (embeddedPostgresLogBuffer.length > 0) {
      logger.error(
        {
          phase,
          recentLogs: embeddedPostgresLogBuffer,
          err,
        },
        "Embedded PostgreSQL failed; showing buffered startup logs",
      );
    }
  };

  if (config.databaseMode === "postgres") {
    logger.warn("Database mode is postgres but no connection string was set; falling back to embedded PostgreSQL");
  }

  const clusterVersionFile = resolve(dataDir, "PG_VERSION");
  const clusterAlreadyInitialized = existsSync(clusterVersionFile);
  const postmasterPidFile = resolve(dataDir, "postmaster.pid");
  const isPidRunning = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  const getRunningPid = (): number | null => {
    if (!existsSync(postmasterPidFile)) return null;
    try {
      const pidLine = readFileSync(postmasterPidFile, "utf8").split("\n")[0]?.trim();
      const pid = Number(pidLine);
      if (!Number.isInteger(pid) || pid <= 0) return null;
      if (!isPidRunning(pid)) return null;
      return pid;
    } catch {
      return null;
    }
  };

  const runningPid = getRunningPid();
  if (runningPid) {
    logger.warn(`Embedded PostgreSQL already running; reusing existing process (pid=${runningPid}, port=${port})`);
  } else {
    const detectedPort = await detectPort(configuredPort);
    if (detectedPort !== configuredPort) {
      logger.warn(`Embedded PostgreSQL port is in use; using next free port (requestedPort=${configuredPort}, selectedPort=${detectedPort})`);
    }
    port = detectedPort;
    logger.info(`Using embedded PostgreSQL because no DATABASE_URL set (dataDir=${dataDir}, port=${port})`);
    embeddedPostgres = new EmbeddedPostgres({
      databaseDir: dataDir,
      user: "paperclip",
      password: "paperclip",
      port,
      persistent: true,
      // Force UTF-8 encoding + locale=C at cluster creation. Without this,
      // initdb takes the OS locale (WIN1252 on Windows) and the cluster
      // physically rejects UTF-8-only characters in INSERTs/UPDATEs. Locale=C
      // gives byte-sort ORDER BY semantics; that's the safest default for an
      // application-layer database where collation rarely matters.
      // Only applied on first cluster creation; existing clusters keep their
      // initial encoding (an existing WIN1252 cluster needs to be re-init'd
      // or pg_dump/restore'd to switch to UTF-8).
      initdbFlags: ["--encoding=UTF8", "--locale=C"],
      onLog: appendEmbeddedPostgresLog,
      onError: appendEmbeddedPostgresLog,
    });

    if (!clusterAlreadyInitialized) {
      try {
        await embeddedPostgres.initialise();
      } catch (err) {
        logEmbeddedPostgresFailure("initialise", err);
        throw err;
      }
    } else {
      logger.info(`Embedded PostgreSQL cluster already exists (${clusterVersionFile}); skipping init`);
    }

    if (existsSync(postmasterPidFile)) {
      logger.warn("Removing stale embedded PostgreSQL lock file");
      // On Windows, also kill any orphan postgres.exe still holding the
      // shared-memory block — otherwise embeddedPostgres.start() below will
      // fail with "pre-existing shared memory block is still in use".
      // No-op on non-Windows.
      await tryRecoverOrphanPostgres({ dataDir });
      rmSync(postmasterPidFile, { force: true });
    }
    try {
      await embeddedPostgres.start();
    } catch (err) {
      logEmbeddedPostgresFailure("start", err);
      throw err;
    }
    embeddedPostgresStartedByThisProcess = true;
  }

  const embeddedAdminConnectionString = `postgres://paperclip:paperclip@127.0.0.1:${port}/postgres`;
  const dbStatus = await ensurePostgresDatabase(embeddedAdminConnectionString, "paperclip");
  if (dbStatus === "created") {
    logger.info("Created embedded PostgreSQL database: paperclip");
  }

  const embeddedConnectionString = `postgres://paperclip:paperclip@127.0.0.1:${port}/paperclip`;
  const shouldAutoApplyFirstRunMigrations = !clusterAlreadyInitialized || dbStatus === "created";
  if (shouldAutoApplyFirstRunMigrations) {
    logger.info("Detected first-run embedded PostgreSQL setup; applying pending migrations automatically");
  }
  migrationSummary = await ensureMigrations(embeddedConnectionString, "Embedded PostgreSQL", {
    autoApply: shouldAutoApplyFirstRunMigrations,
  });

  db = createDb(embeddedConnectionString);
  logger.info("Embedded PostgreSQL ready");
  activeDatabaseConnectionString = embeddedConnectionString;
  startupDbInfo = { mode: "embedded-postgres", dataDir, port };
}

// Expose the active DB URL in process.env so MCP bridge child processes
// (Commander bridge spawned by claude/codex CLI) can inherit it.
// External-postgres sets process.env.DATABASE_URL before this point (it is
// read by loadConfig via process.env.DATABASE_URL), so the set here is a
// no-op for that path. Embedded-postgres builds the URL dynamically — this
// is the only place it reaches process.env, ensuring the bridge gets it.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = activeDatabaseConnectionString;
}

// Probe optional database capabilities (pgvector). Services read the result
// via getDbCapabilities() to gate semantic-search paths and embedding columns.
await probeDbCapabilities(db as any);

if (config.deploymentMode === "local_trusted" && !isLoopbackHost(config.host)) {
  throw new Error(
    `local_trusted mode requires loopback host binding (received: ${config.host}). ` +
      "Use authenticated mode for non-loopback deployments.",
  );
}

if (config.deploymentMode === "local_trusted" && config.deploymentExposure !== "private") {
  throw new Error("local_trusted mode only supports private exposure");
}

if (config.deploymentMode === "authenticated") {
  if (config.authBaseUrlMode === "explicit" && !config.authPublicBaseUrl) {
    throw new Error("auth.baseUrlMode=explicit requires auth.publicBaseUrl");
  }
  if (config.deploymentExposure === "public") {
    if (config.authBaseUrlMode !== "explicit") {
      throw new Error("authenticated public exposure requires auth.baseUrlMode=explicit");
    }
    if (!config.authPublicBaseUrl) {
      throw new Error("authenticated public exposure requires auth.publicBaseUrl");
    }
  }
}

const requestedListenPort = config.port;
const listenPort = await detectPort(requestedListenPort);
if (listenPort !== requestedListenPort) {
  logger.warn(`Requested port is busy; using next free port (requestedPort=${requestedListenPort}, selectedPort=${listenPort})`);
}

let authReady = config.deploymentMode === "local_trusted";
let betterAuthHandler: RequestHandler | undefined;
let resolveSession:
  | ((req: ExpressRequest) => Promise<BetterAuthSessionResult | null>)
  | undefined;
let resolveSessionFromHeaders:
  | ((headers: Headers) => Promise<BetterAuthSessionResult | null>)
  | undefined;
if (config.deploymentMode === "local_trusted") {
  await ensureLocalTrustedBoardPrincipal(db as any);
}
if (config.deploymentMode === "authenticated") {
  const {
    createBetterAuthHandler,
    createBetterAuthInstance,
    deriveAuthTrustedOrigins,
    resolveBetterAuthSession,
    resolveBetterAuthSessionFromHeaders,
  } = await import("./auth/better-auth.js");
  const betterAuthSecret =
    process.env.BETTER_AUTH_SECRET?.trim() ?? process.env.AOA_AGENT_JWT_SECRET?.trim();
  if (!betterAuthSecret) {
    throw new Error(
      "authenticated mode requires BETTER_AUTH_SECRET (or AOA_AGENT_JWT_SECRET) to be set",
    );
  }
  const derivedTrustedOrigins = deriveAuthTrustedOrigins(config, { listenPort });
  const envTrustedOrigins = (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const effectiveTrustedOrigins = Array.from(new Set([...derivedTrustedOrigins, ...envTrustedOrigins]));
  logger.info(
    {
      authBaseUrlMode: config.authBaseUrlMode,
      authPublicBaseUrl: config.authPublicBaseUrl ?? null,
      trustedOrigins: effectiveTrustedOrigins,
      trustedOriginsSource: {
        derived: derivedTrustedOrigins.length,
        env: envTrustedOrigins.length,
      },
    },
    "Authenticated mode auth origin configuration",
  );
  const auth = createBetterAuthInstance(db as any, config, effectiveTrustedOrigins);
  betterAuthHandler = createBetterAuthHandler(auth);
  resolveSession = (req) => resolveBetterAuthSession(auth, req);
  resolveSessionFromHeaders = (headers) => resolveBetterAuthSessionFromHeaders(auth, headers);
  await initializeBoardClaimChallenge(db as any, { deploymentMode: config.deploymentMode });
  authReady = true;
}

const uiMode = config.uiDevMiddleware ? "vite-dev" : config.serveUi ? "static" : "none";
const storageService = createStorageServiceFromConfig(config);
const app = await createApp(db as any, {
  uiMode,
  storageService,
  deploymentMode: config.deploymentMode,
  deploymentExposure: config.deploymentExposure,
  allowedHostnames: config.allowedHostnames,
  bindHost: config.host,
  authReady,
  companyDeletionEnabled: config.companyDeletionEnabled,
  trustProxy: config.trustProxy,
  betterAuthHandler,
  resolveSession,
});
const server = createServer(app as unknown as Parameters<typeof createServer>[0]);

const runtimeListenHost = config.host;
const runtimeApiHost =
  runtimeListenHost === "0.0.0.0" || runtimeListenHost === "::"
    ? "localhost"
    : runtimeListenHost;
process.env.AOA_LISTEN_HOST = runtimeListenHost;
process.env.AOA_LISTEN_PORT = String(listenPort);
process.env.AOA_API_URL = `http://${runtimeApiHost}:${listenPort}`;

server.on("upgrade", (req, socket, head) => {
  void handlePreviewProxyUpgrade(db as any, req, socket, head, {
    deploymentMode: config.deploymentMode,
    resolveSessionFromHeaders,
  }).catch((err) => {
    logger.warn({ err, path: req.url }, "preview websocket upgrade failed");
    socket.destroy();
  });
});

setupLiveEventsWebSocketServer(server, db as any, {
  deploymentMode: config.deploymentMode,
  resolveSessionFromHeaders,
});

if (config.heartbeatSchedulerEnabled) {
  const heartbeat = heartbeatService(db as any);
  const productivityReviews = productivityReviewService(db as any);
  const monitorScheduler = issueMonitorSchedulerService(db as any);
  const PRODUCTIVITY_REVIEW_RECONCILIATION_INTERVAL_MS = 60 * 60 * 1000;
  let monitorTickInFlight = false;
  let productivityReviewTickInFlight = false;

  const runProductivityReviewReconciliation = (now = new Date()) => {
    if (productivityReviewTickInFlight) return;
    productivityReviewTickInFlight = true;
    void db
      .select({ id: companies.id })
      .from(companies)
      .then((rows) => Promise.all(rows.map((row) => productivityReviews.reconcileCompany(row.id, { now }))))
      .catch((err) => {
        logger.error({ err }, "productivity review reconciliation tick failed");
      })
      .finally(() => {
        productivityReviewTickInFlight = false;
      });
  };

  // Subscribe heartbeat's scope-cancellation to budget-exhausted signals so
  // hard-stop breaches interrupt in-flight work, not just preflight-block.
  onBudgetExhausted(async (scope) => {
    const cancelled = await heartbeat.cancelBudgetScopeWork(scope);
    if (cancelled > 0) {
      logger.warn(
        { scope, cancelled },
        "cancelled in-flight runs due to budget hard-stop",
      );
    }
  });

  // Reap orphaned runs at startup (no threshold -- runningProcesses is empty)
  void heartbeat.reapOrphanedRuns().catch((err) => {
    logger.error({ err }, "startup reap of orphaned heartbeat runs failed");
  });

  // Reconcile stale runtime service states after server restart
  void reconcilePersistedRuntimeServicesOnStartup(db as any).catch((err) => {
    logger.error({ err }, "reconcilePersistedRuntimeServicesOnStartup failed");
  });

  // Auto-resume runtime services that were desiredState:running when server stopped
  void restartDesiredRuntimeServicesOnStartup(db as any).catch((err) => {
    logger.error({ err }, "restartDesiredRuntimeServicesOnStartup failed");
  });

  // Periodic sweep: mark stale workspaces as cleanup-eligible based on project TTL.
  // Sweeper no-ops when the instance-level experimental flag is off.
  scheduleTtlSweeper(db as any);

  // Retry filesystem cleanup for workspaces stuck in `cleanup_failed` (Windows
  // file-handle races). Runs every 60s; promotes to `archived` once rm succeeds.
  scheduleCleanupRetrySweeper(db as any);

  // Detect heartbeat runs that are still marked `running` but have produced no
  // output for >30 min. Records a watchdog decision and snoozes re-evaluation
  // for 1 hr to avoid duplicate decisions. Observe-only — no recovery actions.
  registerHeartbeatWatchdogSweeper(db as any);

  setInterval(() => {
    const now = new Date();

    void heartbeat
      .tickTimers(now)
      .then((result) => {
        if (result.enqueued > 0) {
          logger.info({ ...result }, "heartbeat timer tick enqueued runs");
        }
      })
      .catch((err) => {
        logger.error({ err }, "heartbeat timer tick failed");
      });

    // Periodically reap orphaned runs (5-min staleness threshold)
    void heartbeat
      .reapOrphanedRuns({ staleThresholdMs: 5 * 60 * 1000 })
      .catch((err) => {
        logger.error({ err }, "periodic reap of orphaned heartbeat runs failed");
      });

    // Promote max-turn continuations once their bounded retry delay has elapsed.
    void heartbeat
      .promoteDueScheduledRetries(now)
      .catch((err) => {
        logger.error({ err }, "heartbeat scheduled retry promotion failed");
      });

    // Tick scheduled routine triggers
    void routineService(db as any)
      .tickScheduledTriggers(now)
      .catch((err) => {
        logger.error({ err }, "routine scheduled trigger tick failed");
      });

    if (!monitorTickInFlight) {
      monitorTickInFlight = true;
      void db
        .select({ id: companies.id })
        .from(companies)
        .then((rows) => Promise.all(rows.map((row) => monitorScheduler.triggerDueMonitors(row.id, { now }))))
        .catch((err) => {
          logger.error({ err }, "issue monitor scheduler tick failed");
        })
        .finally(() => {
          monitorTickInFlight = false;
        });
    }
  }, config.heartbeatSchedulerIntervalMs);

  runProductivityReviewReconciliation();
  setInterval(runProductivityReviewReconciliation, PRODUCTIVITY_REVIEW_RECONCILIATION_INTERVAL_MS);
}

// Idempotent backfill: ensure Command Staff (Router/Planner/Dispatcher/Memory Keeper)
// and Adjutant exist for all companies. Safe to run on every startup — uses
// ON CONFLICT DO NOTHING. Pre-existing companies miss this because the seeders
// only run on company creation.
// T3.5: skip ensure-*.ts if marketplace already governs this company's crew.
void db
  .select({ id: companies.id })
  .from(companies)
  .then(async (rows) => {
    for (const row of rows) {
      // Wrap each company independently: a failure for one company must never
      // abort the backfill for the remaining companies.
      try {
        // T3.5: skip ensure-*.ts if marketplace already governs this company's crew.
        // Wrapped so a transient DB error defaults to running the ensures (safe:
        // ensures are idempotent and non-fatal on legacy companies).
        let marketplaceInstalled: { id: string } | undefined;
        try {
          [marketplaceInstalled] = await db
            .select({ id: agents.id })
            .from(agents)
            .where(
              and(
                eq(agents.companyId, row.id),
                eq(agents.kind, "aoa"),
                sql`${agents.templateOrigin} IS NOT NULL AND ${agents.templateOrigin} NOT LIKE '%@legacy'`,
              ),
            )
            .limit(1);
        } catch (err: unknown) {
          logger.warn({ err, companyId: row.id }, "marketplace gate check failed — defaulting to legacy crew ensures");
        }

        if (marketplaceInstalled) {
          logger.debug({ companyId: row.id }, "crew startup backfill: skipping — marketplace governs");
          continue;
        }

        await Promise.all([
          ensureCommandStaff(db as any, row.id).catch((err: unknown) =>
            logger.warn({ err, companyId: row.id }, "command staff backfill failed"),
          ),
          ensureAdjutant(db as any, row.id).catch((err: unknown) =>
            logger.warn({ err, companyId: row.id }, "adjutant backfill failed"),
          ),
          ensureMaker(db as any, row.id).catch((err: unknown) =>
            logger.warn({ err, companyId: row.id }, "maker backfill failed"),
          ),
          ensureCommanderAgent(db as any, row.id).catch((err: unknown) =>
            logger.warn({ err, companyId: row.id }, "commander backfill failed"),
          ),
          ensureExtractionAgent(db as any, row.id).catch((err: unknown) =>
            logger.warn({ err, companyId: row.id }, "extraction agent backfill failed"),
          ),
        ]);
      } catch (err: unknown) {
        logger.warn({ err, companyId: row.id }, "crew startup backfill failed for company");
      }
    }
  })
  .catch((err) => logger.warn({ err }, "crew startup backfill failed"));

// Idempotent backfill: migrate the vestigial goals.parentId column into the
// goal_parents join table (multi-parent DAG; Decision #20 superseded 2026-05-25).
// Safe on every startup — ON CONFLICT DO NOTHING on the composite PK.
void backfillGoalParents(db as any)
  .then((res) => {
    if (res.inserted > 0) {
      logger.info({ inserted: res.inserted }, "goal_parents backfill complete");
    }
  })
  .catch((err) => logger.warn({ err }, "goal_parents startup backfill failed"));

// Idempotent backfill: stamp @legacy templateOrigin onto pre-marketplace crew
// agents (kind='aoa', templateOrigin IS NULL). Runs once per deploy; second run
// updates 0 rows. Required so boot-time ensure guards can skip companies already
// on marketplace (T3.5) and the crew-updater can exclude legacy rows (T3.4).
void backfillCrewTemplateOrigin(db as any).catch((err: unknown) =>
  logger.warn({ err }, "crew templateOrigin backfill failed"),
);

// T3.5 / T3.x: Check all marketplace-installed crew agents for catalog updates.
// auto policy + within window → apply immediately (silent).
// notify policy → record pending_update + send updateAvailable notification.
const CREW_UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function runCrewUpdateCheck(): Promise<void> {
  try {
    const catalogRows = await (db as any)
      .select()
      .from(marketplaceCatalogCache)
      .where(eq(marketplaceCatalogCache.id, 1))
      .limit(1);
    if (catalogRows.length === 0) return;
    const catalogData = (catalogRows[0].catalogJson as { items?: unknown }).items;
    if (!Array.isArray(catalogData)) return;

    const allCompanies = await (db as any).select({ id: companies.id }).from(companies);
    for (const company of allCompanies) {
      // Per-company isolation: a failure for one company must not abort the
      // update check for the remaining companies.
      try {
        const settingsRow = await (db as any)
          .select({ settings: marketplaceCompanySettings.settings })
          .from(marketplaceCompanySettings)
          .where(eq(marketplaceCompanySettings.companyId, company.id))
          .limit(1);
        const settings = {
          ...MARKETPLACE_SETTINGS_DEFAULTS,
          ...((settingsRow[0]?.settings as object) ?? {}),
        };
        await checkCrewUpdates({
          db: db as any,
          companyId: company.id,
          catalogItems: catalogData as any,
          settings,
          instructionsService: agentInstructionsService(),
        });
      } catch (err) {
        logger.warn({ err, companyId: company.id }, "crew update check failed for company");
      }
    }
  } catch (err) {
    logger.warn({ err }, "crew update check failed");
  }
}

void runCrewUpdateCheck();
setInterval(
  () => void runCrewUpdateCheck().catch((err) => logger.warn({ err }, "crew update check interval failed")),
  CREW_UPDATE_CHECK_INTERVAL_MS,
);

// File import queue worker
void resetStuckJobs(db as any).catch((err) =>
  logger.warn({ err }, "resetStuckJobs on startup failed"),
);
let fileImportTickInFlight = false;
setInterval(() => {
  if (fileImportTickInFlight) return;
  fileImportTickInFlight = true;
  void processFileImportQueue(db as any, storageService)
    .catch((err) => logger.warn({ err }, "processFileImportQueue tick failed"))
    .finally(() => { fileImportTickInFlight = false; });
}, WORKER_INTERVAL_MS);
// No immediate first tick — the first interval fires at T+15s, which is acceptable
// since resetStuckJobs already ran synchronously above

// Write-behind embedding queue worker (Task B1, Decision D2).
// Drains rows from `embedding_queue` and UPDATEs the target row's vector
// column. The worker tolerates a missing OPENAI_API_KEY (warns but stays
// registered so any queued rows surface as auth errors via the normal
// retry path). 2-second tick is fast enough to keep find-similar staleness
// to a few seconds for typical traffic.
const embeddingWorker = startEmbeddingWorker(db as any, { intervalMs: 2000 });
// Best-effort stop on SIGTERM/SIGINT — the shared shutdown handlers below
// already exit the process, but this lets the in-flight tick log cleanly.
process.once("SIGTERM", () => embeddingWorker.stop());
process.once("SIGINT", () => embeddingWorker.stop());

// Sub-agent #1: durable discussion-extraction sweeper (primary trigger).
// Polls discussion_entries.extractionStatus='pending' (+ reclaims orphaned
// 'processing') and runs extraction via the consumer under a bounded limiter.
// Idempotency-safe alongside the reprocess path via the M2 atomic claim.
const EXTRACTION_SWEEP_INTERVAL_MS = 45_000;
let extractionSweepInFlight = false;
setInterval(() => {
  if (extractionSweepInFlight) return;
  extractionSweepInFlight = true;
  void runExtractionSweep(db as any, { limiterMax: 4, staleMs: 10 * 60 * 1000 })
    .catch((err) => logger.warn({ err }, "extraction sweep tick failed"))
    .finally(() => { extractionSweepInFlight = false; });
}, EXTRACTION_SWEEP_INTERVAL_MS);

// Sub-agent #2: periodic adjutant sweep — checks thread health, advances phases or nudges.
const ADJUTANT_SWEEP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
let adjutantSweepInFlight = false;
setInterval(() => {
  if (adjutantSweepInFlight) return;
  adjutantSweepInFlight = true;
  void runAdjutantSweep(db as any)
    .catch((err) => logger.warn({ err }, "adjutant sweep tick failed"))
    .finally(() => { adjutantSweepInFlight = false; });
}, ADJUTANT_SWEEP_INTERVAL_MS);

// Sub-agent #3: periodic Memory Keeper sweep (T1.4 part 1).
// 4hr cadence — eng-review D10's cost analysis showed naive 30-min sweeping
// scales to ~$240/day for a company with 50 active threads. 4hr is the cost-
// vs-freshness sweet spot for memory pattern detection: founders edit memory
// items once a week on average; missing a pattern by ≤4hr is fine. Event-
// driven entry.added wakeups (T1.4 part 2) will layer on top for faster
// reaction; this sweep is the safety floor that catches aging patterns on
// quiet threads. MK_SWEEP_DEBOUNCE_MS matches this cadence (4hr) so each
// active thread gets exactly one MK wakeup per cycle.
const MEMORY_KEEPER_SWEEP_INTERVAL_MS = MK_SWEEP_DEBOUNCE_MS; // 4 hours
let memoryKeeperSweepInFlight = false;
setInterval(() => {
  if (memoryKeeperSweepInFlight) return;
  memoryKeeperSweepInFlight = true;
  void runMemoryKeeperSweep(db as any)
    .catch((err) => logger.warn({ err }, "memory keeper sweep tick failed"))
    .finally(() => { memoryKeeperSweepInFlight = false; });
}, MEMORY_KEEPER_SWEEP_INTERVAL_MS);

if (config.databaseBackupEnabled) {
  const backupIntervalMs = config.databaseBackupIntervalMinutes * 60 * 1000;
  let backupInFlight = false;

  const runScheduledBackup = async () => {
    if (backupInFlight) {
      logger.warn("Skipping scheduled database backup because a previous backup is still running");
      return;
    }

    backupInFlight = true;
    try {
      const result = await runDatabaseBackup({
        connectionString: activeDatabaseConnectionString,
        backupDir: config.databaseBackupDir,
        retention: DEFAULT_BACKUP_RETENTION,
        filenamePrefix: "aoa",
      });
      logger.info(
        {
          backupFile: result.backupFile,
          sizeBytes: result.sizeBytes,
          prunedCount: result.prunedCount,
          backupDir: config.databaseBackupDir,
        },
        `Automatic database backup complete: ${formatDatabaseBackupResult(result)}`,
      );
    } catch (err) {
      logger.error({ err, backupDir: config.databaseBackupDir }, "Automatic database backup failed");
    } finally {
      backupInFlight = false;
    }
  };

  logger.info(
    {
      intervalMinutes: config.databaseBackupIntervalMinutes,
      retention: DEFAULT_BACKUP_RETENTION,
      backupDir: config.databaseBackupDir,
    },
    "Automatic database backups enabled",
  );
  setInterval(() => {
    void runScheduledBackup();
  }, backupIntervalMs);
}

server.listen(listenPort, config.host, () => {
  logger.info(`Server listening on ${config.host}:${listenPort}`);
  if (process.env.AOA_OPEN_ON_LISTEN === "true") {
    const openHost = config.host === "0.0.0.0" || config.host === "::" ? "127.0.0.1" : config.host;
    const url = `http://${openHost}:${listenPort}`;
    void import("open")
      .then((mod) => mod.default(url))
      .then(() => {
        logger.info(`Opened browser at ${url}`);
      })
      .catch((err) => {
        logger.warn({ err, url }, "Failed to open browser on startup");
      });
  }
  printStartupBanner({
    host: config.host,
    deploymentMode: config.deploymentMode,
    deploymentExposure: config.deploymentExposure,
    authReady,
    requestedPort: config.port,
    listenPort,
    uiMode,
    db: startupDbInfo,
    migrationSummary,
    hasVectorSupport: getDbCapabilities().hasVectorSupport,
    heartbeatSchedulerEnabled: config.heartbeatSchedulerEnabled,
    heartbeatSchedulerIntervalMs: config.heartbeatSchedulerIntervalMs,
    databaseBackupEnabled: config.databaseBackupEnabled,
    databaseBackupIntervalMinutes: config.databaseBackupIntervalMinutes,
    databaseBackupDir: config.databaseBackupDir,
  });

  // Bootstrap plugin subsystem after server is listening
  const pluginSys = (app as any).__pluginSubsystem;
  if (pluginSys) {
    pluginSys.jobScheduler.start();
    pluginSys.jobCoordinator.start();
    pluginSys.loader.loadAll().catch((err: unknown) => {
      logger.error({ err }, "Plugin loadAll failed at startup");
    });
    logger.info("Plugin subsystem initialized");
  }

  const boardClaimUrl = getBoardClaimWarningUrl(config.host, listenPort);
  if (boardClaimUrl) {
    const red = "\x1b[41m\x1b[30m";
    const yellow = "\x1b[33m";
    const reset = "\x1b[0m";
    console.log(
      [
        `${red}  BOARD CLAIM REQUIRED  ${reset}`,
        `${yellow}This instance was previously local_trusted and still has local-board as the only admin.${reset}`,
        `${yellow}Sign in with a real user and open this one-time URL to claim ownership:${reset}`,
        `${yellow}${boardClaimUrl}${reset}`,
        `${yellow}If you are connecting over Tailscale, replace the host in this URL with your Tailscale IP/MagicDNS name.${reset}`,
      ].join("\n"),
    );
  }
});

if (embeddedPostgres && embeddedPostgresStartedByThisProcess) {
  const shutdown = async (signal: "SIGINT" | "SIGTERM") => {
    // Shutdown plugin subsystem first
    const pluginSys = (app as any).__pluginSubsystem;
    if (pluginSys) {
      logger.info("Stopping plugin subsystem");
      pluginSys.jobScheduler.stop();
      await pluginSys.workerManager.stopAll().catch((err: unknown) => {
        logger.error({ err }, "Plugin worker shutdown failed");
      });
    }

    logger.info({ signal }, "Stopping embedded PostgreSQL");
    try {
      await embeddedPostgres?.stop();
    } catch (err) {
      logger.error({ err }, "Failed to stop embedded PostgreSQL cleanly");
    } finally {
      process.exit(0);
    }
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}
