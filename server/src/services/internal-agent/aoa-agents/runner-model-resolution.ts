import { readEnvBindingValue } from "@armyofagents/shared";
import { resolveModel, type ResolveModelStatus } from "../model-resolution.js";

/**
 * Apply model resolution + company OPENAI_API_KEY strip to an adapter config
 * before the crew runner spawns the CLI.
 *
 * Two concerns, both pure and testable:
 *  1. Model: delegates to resolveModel (shell-safe gate + adapter-specific logic).
 *     resolveModel throws ShellUnsafeModelError on unsafe input — callers must sit
 *     inside a try/catch that records a failed run (the runner's top-level catch).
 *  2. Env-strip hardening: the company-level OPENAI_API_KEY (inherited from
 *     process.env) must NEVER reach the codex CLI. Only a key the AGENT itself
 *     set in its own adapterConfig.env survives.
 *
 * `opts.agentOwnEnv` disambiguates the agent's own key from inherited env in the
 * ORG/heartbeat path, where baseConfig.env is the project→environment→agent
 * MERGE (a project/environment OPENAI_API_KEY there is meant for the app being
 * built, not for codex auth). When provided, the agent-set-key decision reads it
 * instead of the merged env, and any non-agent OPENAI_API_KEY in the merged env
 * is stripped from the spawn. The crew path omits it — baseConfig.env there IS
 * the agent's own env — so behavior is unchanged.
 */
export function applyModelResolutionToConfig(
  adapterType: string,
  baseConfig: Record<string, unknown>,
  status: ResolveModelStatus,
  opts: { inheritedEnvOpenAiKey?: string | null; agentOwnEnv?: Record<string, unknown> | null } = {},
): Record<string, unknown> {
  const next = { ...baseConfig };
  const resolved = resolveModel(adapterType, next.model as string | undefined, status);
  if (resolved.omitModelFlag) delete next.model; else next.model = resolved.model;

  if (adapterType === "codex_local") {
    const env = { ...((next.env as Record<string, unknown>) ?? {}) };
    // Whether the AGENT ITSELF set OPENAI_API_KEY. In the org/heartbeat path the
    // merged env carries project/environment keys that must NOT count as the
    // agent opting into codex api-key auth — read the pre-merge agentOwnEnv when
    // the caller supplies it. Binding-aware: saved env entries are normalized to
    // binding objects, so a string-only check would miss the agent's own key
    // (Codex P2). readEnvBindingValue handles string / plain / secret_ref.
    const ownEnv = opts.agentOwnEnv !== undefined ? (opts.agentOwnEnv ?? {}) : env;
    const agentSetKey = readEnvBindingValue(ownEnv.OPENAI_API_KEY) != null;
    // Env-strip hardening: any OPENAI_API_KEY the agent did not set itself — the
    // ambient company key OR an inherited project/environment key in the merged
    // env — must never reach the codex CLI.
    if (!agentSetKey && (opts.inheritedEnvOpenAiKey || readEnvBindingValue(env.OPENAI_API_KEY) != null)) {
      delete env.OPENAI_API_KEY;
    }
    next.env = env;
  }
  return next;
}
