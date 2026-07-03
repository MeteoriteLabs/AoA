/**
 * W5c Task 7 — the BRIDGED (supervised) codex execution path.
 *
 * When runtime-decision routing is enabled for a run (per-agent opt-in, local
 * target, env kill-switch — resolved server-side and delivered on
 * `ctx.runtimeDecisionRoutingEnabled`), codex is driven via `codex app-server`
 * (a long-lived JSON-RPC child) instead of the one-shot `codex exec`. The
 * app-server exposes a blocking approval callback
 * (`item/commandExecution/requestApproval` / `item/fileChange/requestApproval`)
 * that we bridge to the human-decision broker via `handleApprovalRequest`.
 *
 * This module owns ONLY the bridged turn: spawn the client, wire the
 * forwarding-ref handlers the driver installs, drive one turn, close the client,
 * and return a NEUTRAL INTERMEDIATE. `execute.ts` assembles the final
 * `AdapterExecutionResult` from that intermediate via the SAME builder the exec
 * path uses, so the two spawn modes cannot drift on result shape.
 *
 * The exec path stays in `execute.ts`, untouched and byte-identical.
 *
 * Testability: the real dependencies (`spawnAppServerClient`,
 * `driveCodexAppServer`, `createAppServerResultAccumulator`) are injected via a
 * `deps` param defaulting to the real implementations, so the routing unit test
 * stubs them with no real codex process.
 */
import type {
  AdapterRuntimeDecisionBroker,
} from "@armyofagents/adapter-utils";
import { RUNTIME_HOOK_BLOCK_TIMEOUT_SEC } from "@armyofagents/adapter-utils";
import {
  spawnAppServerClient as realSpawnAppServerClient,
  type SpawnAppServerClientOptions,
  type SpawnedAppServerClient,
} from "./app-server/jsonrpc-client.js";
import {
  driveCodexAppServer as realDriveCodexAppServer,
  type DriveCodexAppServerInput,
  type DriverResult,
} from "./app-server/driver.js";
import { createAppServerResultAccumulator as realCreateAccumulator } from "./app-server/parse-events.js";
import { handleApprovalRequest } from "./app-server/approval-bridge.js";

/** Injectable dependency set (defaults to the real app-server implementations). */
export interface RunAppServerTurnDeps {
  spawnAppServerClient: (opts: SpawnAppServerClientOptions) => SpawnedAppServerClient;
  driveCodexAppServer: (input: DriveCodexAppServerInput) => Promise<DriverResult>;
  createAppServerResultAccumulator: () => DriveCodexAppServerInput["accumulator"];
}

export const defaultRunAppServerTurnDeps: RunAppServerTurnDeps = {
  spawnAppServerClient: realSpawnAppServerClient,
  driveCodexAppServer: realDriveCodexAppServer,
  createAppServerResultAccumulator: realCreateAccumulator,
};

export interface RunAppServerTurnInput {
  runId: string;
  command: string;
  cwd: string;
  env: Record<string, string>;
  prompt: string;
  timeoutSec: number;
  graceSec: number;
  /** Resumable stored session (cwd-guarded inside the driver). */
  session?: { sessionId: string; cwd?: string };
  /** Human-decision broker (from ctx). Absent → approvals fail closed. */
  broker?: AdapterRuntimeDecisionBroker;
  /** Forwarded to spawnTrackedChild so the controller can persist PID/PGID. */
  onSpawn?: (pid: number | null, pgid: number | null, startedAt: Date) => void;
  /** Non-fatal warning / audit sink. */
  onWarn?: (message: string) => void;
  /** Injectable deps for tests; real app-server implementations by default. */
  deps?: RunAppServerTurnDeps;
}

/**
 * Drive ONE supervised codex turn over `codex app-server` and return the
 * driver's `DriverResult` (a neutral intermediate + session lifecycle fields).
 * `execute.ts` turns this into an `AdapterExecutionResult`.
 */
export async function runAppServerTurn(
  input: RunAppServerTurnInput,
): Promise<DriverResult> {
  const {
    runId,
    command,
    cwd,
    env,
    prompt,
    timeoutSec,
    graceSec,
    session,
    broker,
    onSpawn,
    onWarn,
    deps = defaultRunAppServerTurnDeps,
  } = input;

  const accumulator = deps.createAppServerResultAccumulator();

  // ── Forwarding-ref wiring (client ↔ driver) ────────────────────────────────
  // The driver installs its handlers via `registerNotificationHandler` /
  // `registerServerRequestHandler` (called synchronously before the handshake).
  // The spawn callbacks must forward EVERY frame to whatever the driver
  // installed — but the client is spawned BEFORE the driver runs, so the spawn
  // callbacks close over mutable refs that the driver later fills.
  let notificationHandler:
    | ((method: string, params: unknown) => void)
    | null = null;
  let serverRequestHandler:
    | ((id: number | string, method: string, params: unknown) => void | Promise<void>)
    | null = null;

  const registerNotificationHandler: DriveCodexAppServerInput["registerNotificationHandler"] = (
    handler,
  ) => {
    notificationHandler = handler;
  };
  const registerServerRequestHandler: DriveCodexAppServerInput["registerServerRequestHandler"] = (
    handler,
  ) => {
    serverRequestHandler = handler;
  };

  const spawned = deps.spawnAppServerClient({
    runId,
    command,
    cwd,
    env,
    graceSec,
    // Preserve the env-strip on the bridged path too — the ambient server
    // OPENAI_API_KEY must never reach a supervised codex run and flip billing.
    // (spawnAppServerClient also defaults this; we pass it explicitly so the
    // guard survives even if that default is ever changed.)
    unsetEnvKeys: ["OPENAI_API_KEY"],
    onSpawn,
    onNotification: (method, params) => {
      notificationHandler?.(method, params);
    },
    onServerRequest: (id, method, params) => serverRequestHandler?.(id, method, params),
    onError: (err) => {
      onWarn?.(
        `[aoa] codex app-server transport error: ${err instanceof Error ? err.message : String(err)}`,
      );
    },
  });

  try {
    const result = await deps.driveCodexAppServer({
      runId,
      cwd,
      input: [{ type: "text", text: prompt }],
      // The bridge always drives codex in the fully-supervised policy so EVERY
      // command + file change surfaces a `requestApproval` we route to the human.
      approvalPolicy: "untrusted",
      timeoutSec,
      client: spawned.client,
      accumulator,
      onServerApproval: (method, params) =>
        handleApprovalRequest(method, params, {
          broker,
          bridged: true,
          timeoutMs: RUNTIME_HOOK_BLOCK_TIMEOUT_SEC * 1000,
          cwd,
          onLog: onWarn ? (msg) => onWarn(msg) : undefined,
        }),
      registerServerRequestHandler,
      registerNotificationHandler,
      terminate: spawned.terminate,
      session,
      onWarn,
    });
    return result;
  } finally {
    try {
      spawned.client.close();
    } catch {
      // close must never throw into the caller.
    }
  }
}
