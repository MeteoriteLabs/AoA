import { runStreamingLogin, type StreamingLoginResult } from "@armyofagents/adapter-utils/streaming-login";
import type { SpawnTrackedChildOptions, TrackedChildHandle } from "@armyofagents/adapter-utils/server-utils";
import { resolveSharedCodexHomeDir } from "./codex-home.js";

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
}): StreamingLoginResult & { authHome: string } {
  const env = args.env ?? process.env;
  const authHome = resolveSharedCodexHomeDir(env);
  const result = runStreamingLogin({
    runId: args.runId,
    command: "codex",
    args: ["login"],
    cwd: authHome,
    env: { CODEX_HOME: authHome },
    discoveryTimeoutMs: args.discoveryTimeoutMs,
    spawn: args.spawn,
  });
  return { ...result, authHome };
}
