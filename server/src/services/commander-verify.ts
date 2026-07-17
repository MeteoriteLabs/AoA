import type { Db } from "@armyofagents/db";
import { internalAgentConfig, agents } from "@armyofagents/db";
import { eq } from "drizzle-orm";
import type { AdapterEnvironmentTestResult } from "@armyofagents/shared";
import { secretService } from "./secrets.js";

export type CommanderVerifyOutcome = "verified" | "needs_auth" | "not_installed" | "failed";

/**
 * Resolve the config Commander verify should probe with (Plan 3 / §6.1, Codex
 * P1 #8). Loads the Commander AGENT via internal_agent_config.agent_id (the
 * executable config lives on agents.adapterConfig, NOT internal_agent_config)
 * and resolves its env `secret_ref` bindings for runtime — so a saved API key
 * (§6.2) actually unblocks the re-probe. Falls back to `{}` (CLI defaults /
 * subscription-login path) when no Commander agent is linked.
 */
export async function resolveCommanderProbeConfig(
  db: Db,
  companyId: string,
  actorId: string | null,
): Promise<Record<string, unknown>> {
  const [cfg] = await db
    .select({ agentId: internalAgentConfig.agentId })
    .from(internalAgentConfig)
    .where(eq(internalAgentConfig.companyId, companyId))
    .limit(1);
  if (!cfg?.agentId) return {};

  const [agent] = await db
    .select({ adapterConfig: agents.adapterConfig })
    .from(agents)
    .where(eq(agents.id, cfg.agentId))
    .limit(1);
  const adapterConfig = (agent?.adapterConfig as Record<string, unknown> | null) ?? {};

  return secretService(db).resolveAdapterConfigForRuntime(companyId, adapterConfig, {
    consumerType: "agent",
    consumerId: cfg.agentId,
    actorType: "user",
    actorId: actorId ?? "board",
  });
}

/** Commander cliTool → agent adapter type (mirror UI AgentStep). */
export function cliToolToAdapterType(cliTool: string | null | undefined): string {
  switch (cliTool) {
    case "claude_cli":
      return "claude_local";
    case "codex":
      return "codex_local";
    case "opencode":
      return "opencode_local";
    default:
      return "claude_local"; // safe default; Commander defaults to claude_cli
  }
}

/**
 * Classify the shared adapter probe into a recovery outcome (revA R14). The
 * auth signal lives in check *codes*, not a structured field:
 *   *_hello_probe_passed → verified · *_auth_required / *login* → needs_auth ·
 *   *_command_unresolvable / *not_installed* / *install* → not_installed.
 * A non-error `warn` with no auth/install signal is treated as verified so the
 * founder is not hard-blocked on a cosmetic mismatch (scope §8).
 */
export function classifyCommanderProbe(result: AdapterEnvironmentTestResult): {
  outcome: CommanderVerifyOutcome;
  result: AdapterEnvironmentTestResult;
} {
  if (result.status === "pass") return { outcome: "verified", result };
  const codes = result.checks.map((c) => c.code);
  const anyCode = (needle: string) => codes.some((c) => c.includes(needle));
  if (anyCode("auth_required") || anyCode("login")) return { outcome: "needs_auth", result };
  if (anyCode("command_unresolvable") || anyCode("not_installed") || anyCode("install")) {
    return { outcome: "not_installed", result };
  }
  if (result.status === "warn") return { outcome: "verified", result };
  return { outcome: "failed", result };
}

/** Resolve the Commander's adapter type from its configured cliTool. */
export async function resolveCommanderAdapterType(db: Db, companyId: string): Promise<string> {
  const [cfg] = await db
    .select({ cliTool: internalAgentConfig.cliTool })
    .from(internalAgentConfig)
    .where(eq(internalAgentConfig.companyId, companyId))
    .limit(1);
  return cliToolToAdapterType(cfg?.cliTool ?? "claude_cli");
}
