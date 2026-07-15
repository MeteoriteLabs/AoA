import path from "node:path";
import os from "node:os";
import { runStreamingLogin, type StreamingLoginResult } from "@armyofagents/adapter-utils/streaming-login";
import type { SpawnTrackedChildOptions, TrackedChildHandle } from "@armyofagents/adapter-utils/server-utils";

/**
 * The Claude Code CLI config home (Plan 3 / §6.2, Codex P1 #9). There is no
 * pre-existing repo resolver for this, so we define it here and let the login
 * lifecycle (Task 4) reuse it. `claude login` persists its credential file
 * under this dir — that file's presence is claude's completion evidence
 * (do NOT reuse codex's `auth.json`).
 */
export function resolveClaudeConfigHome(env: NodeJS.ProcessEnv): string {
  return env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
}

/**
 * Start an interactive `claude login` (Plan 3 / §6.2 Task 3), streaming the
 * verification URL out live. Streaming (not the batch `runClaudeLogin` in
 * execute.ts) because a device flow blocks until the browser round-trip, so a
 * collect-to-EOF read would never surface the URL. The real device flow is
 * dogfood-verified; CI covers URL parsing + the runner wiring via the spawn seam.
 */
export function runClaudeLoginStreaming(args: {
  runId: string;
  command?: string;
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
  const authHome = resolveClaudeConfigHome(env);
  const result = runStreamingLogin({
    runId: args.runId,
    command: args.command ?? "claude",
    args: ["login"],
    cwd: authHome,
    env: { CLAUDE_CONFIG_DIR: authHome },
    discoveryTimeoutMs: args.discoveryTimeoutMs,
    spawn: args.spawn,
  });
  return { ...result, authHome };
}
