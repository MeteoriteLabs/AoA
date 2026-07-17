import { spawnTrackedChild, type TrackedChildHandle, type SpawnTrackedChildOptions } from "./server-utils.js";
import { createLoginUrlDetector } from "./login-url-detector.js";

/**
 * Interactive CLI-login runner (Plan 3 / §6.2 Task 3).
 *
 * Spawns `claude login` / `codex login` through {@link spawnTrackedChild} (so
 * the child shares the one kill/registration path the heartbeat reaper knows
 * about), tees stdout+stderr through {@link createLoginUrlDetector}, and hands
 * back the full contract the login lifecycle (Task 4) needs:
 *
 *  - `handle`      — the TrackedChildHandle (pid/pgid/terminate) to persist + reap.
 *  - `urlPromise`  — resolves with the verification URL on first detection;
 *                    rejects with `no-url` if the child exits first, with the
 *                    spawn `error`, or with `login-url-timeout` after the
 *                    discovery window.
 *  - `exitPromise` — resolves with the child's exit code (null on spawn error)
 *                    so the lifecycle can mark completed/failed.
 *
 * The runner owns the child's `close`/`error` listeners and clears the
 * discovery timer as soon as the URL is found (Codex P2 #6).
 */

export interface StreamingLoginResult {
  handle: TrackedChildHandle;
  urlPromise: Promise<string>;
  exitPromise: Promise<number | null>;
}

export interface RunStreamingLoginOptions {
  runId: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  /** Reject `urlPromise` if no URL is seen within this window. Default 120s. */
  discoveryTimeoutMs?: number;
  /** Extra parent-env keys to strip (forwarded to spawnTrackedChild). */
  unsetEnvKeys?: string[];
  /** DI seam — defaults to the real spawnTrackedChild. */
  spawn?: (
    runId: string,
    command: string,
    args: string[],
    opts: SpawnTrackedChildOptions,
  ) => TrackedChildHandle;
}

const DEFAULT_DISCOVERY_TIMEOUT_MS = 120_000;

export function runStreamingLogin(opts: RunStreamingLoginOptions): StreamingLoginResult {
  const spawnFn = opts.spawn ?? spawnTrackedChild;
  const handle = spawnFn(opts.runId, opts.command, opts.args, {
    cwd: opts.cwd,
    env: opts.env,
    graceSec: 5,
    unsetEnvKeys: opts.unsetEnvKeys,
    // stdin ignored: the device flow needs no input; stdout+stderr piped for URL detection.
    stdio: ["ignore", "pipe", "pipe"],
  });

  const child = handle.child;
  const detector = createLoginUrlDetector();

  let settled = false;
  let resolveUrl!: (url: string) => void;
  let rejectUrl!: (err: Error) => void;
  const urlPromise = new Promise<string>((res, rej) => {
    resolveUrl = res;
    rejectUrl = rej;
  });

  let discoveryTimer: ReturnType<typeof setTimeout> | undefined;
  const clearDiscoveryTimer = (): void => {
    if (discoveryTimer !== undefined) {
      clearTimeout(discoveryTimer);
      discoveryTimer = undefined;
    }
  };

  const onData = (chunk: Buffer | string): void => {
    if (settled) return;
    const url = detector.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    if (url !== null) {
      settled = true;
      clearDiscoveryTimer();
      resolveUrl(url);
    }
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);

  discoveryTimer = setTimeout(() => {
    if (!settled) {
      settled = true;
      rejectUrl(new Error("login-url-timeout"));
    }
  }, opts.discoveryTimeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS);
  // Never keep the event loop alive solely for the discovery timer.
  discoveryTimer.unref?.();

  const exitPromise = new Promise<number | null>((resolve) => {
    child.on("close", (code: number | null) => {
      clearDiscoveryTimer();
      if (!settled) {
        settled = true;
        rejectUrl(new Error("no-url"));
      }
      resolve(code);
    });
    child.on("error", (err: Error) => {
      clearDiscoveryTimer();
      if (!settled) {
        settled = true;
        rejectUrl(err);
      }
      resolve(null);
    });
  });

  return { handle, urlPromise, exitPromise };
}
