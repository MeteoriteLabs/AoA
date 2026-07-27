import { runStreamingLogin, type StreamingLoginResult } from "@armyofagents/adapter-utils/streaming-login";
import type { SpawnTrackedChildOptions, TrackedChildHandle } from "@armyofagents/adapter-utils/server-utils";
import fs from "node:fs";
import { resolveSharedCodexHomeDir } from "./codex-home.js";

const DEVICE_CODE_RE = /\b[A-Z0-9]{4,8}-[A-Z0-9]{4,8}\b/i;

export function extractCodexDeviceCode(text: string): string | null {
  return DEVICE_CODE_RE.exec(text)?.[0]?.toUpperCase() ?? null;
}

/**
 * Start an interactive `codex login` (Plan 3 / §6.2 Task 3), streaming the
 * device-verification URL out as soon as the CLI prints it. Runs against the
 * SHARED codex home (`resolveSharedCodexHomeDir`) so a successful login lands
 * `auth.json` where the Commander codex spawn already reads it — that file's
 * presence is codex's completion evidence for the login lifecycle (Task 4).
 *
 * The real device flow is dogfood-verified; CI covers URL parsing + the
 * `{handle, urlPromise, exitPromise}` wiring via the injected spawn seam.
 */
export function runCodexLogin(args: {
  runId: string;
  env?: NodeJS.ProcessEnv;
  discoveryTimeoutMs?: number;
  spawn?: (
    runId: string,
    command: string,
    argv: string[],
    opts: SpawnTrackedChildOptions,
  ) => TrackedChildHandle;
}): StreamingLoginResult & { authHome: string; userCodePromise: Promise<string> } {
  const env = args.env ?? process.env;
  const authHome = resolveSharedCodexHomeDir(env);
  fs.mkdirSync(authHome, { recursive: true, mode: 0o700 });
  fs.chmodSync(authHome, 0o700);
  const result = runStreamingLogin({
    runId: args.runId,
    command: "codex",
    args: ["login", "--device-auth"],
    cwd: authHome,
    // Preserve the caller's scoped HOME as well as CODEX_HOME. Passing only
    // CODEX_HOME makes spawnTrackedChild merge the server's shared HOME back in.
    env: { ...env, CODEX_HOME: authHome },
    discoveryTimeoutMs: args.discoveryTimeoutMs,
    spawn: args.spawn,
  });

  let buffer = "";
  let settled = false;
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: Error) => void;
  const userCodePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  const codeTimer = setTimeout(() => {
    if (!settled) {
      settled = true;
      rejectCode(new Error("device-code-timeout"));
    }
  }, args.discoveryTimeoutMs ?? 60_000);
  codeTimer.unref?.();
  const settleCode = (code: string) => {
    if (settled) return;
    settled = true;
    clearTimeout(codeTimer);
    resolveCode(code);
  };
  const failCode = (message: string) => {
    if (settled) return;
    settled = true;
    clearTimeout(codeTimer);
    rejectCode(new Error(message));
  };
  const onData = (chunk: Buffer | string) => {
    if (settled) return;
    buffer = `${buffer}${typeof chunk === "string" ? chunk : chunk.toString("utf8")}`.slice(-8192);
    const code = extractCodexDeviceCode(buffer);
    if (code) settleCode(code);
  };
  result.handle.child.stdout?.on("data", onData);
  result.handle.child.stderr?.on("data", onData);
  result.handle.child.once("close", () => {
    failCode("no-device-code");
  });
  result.handle.child.once("error", () => {
    failCode("device-code-process-error");
  });

  return { ...result, authHome, userCodePromise };
}
