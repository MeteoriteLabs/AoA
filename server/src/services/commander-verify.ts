import type { Db } from "@armyofagents/db";
import { internalAgentConfig } from "@armyofagents/db";
import { eq } from "drizzle-orm";
import type { AdapterEnvironmentTestResult } from "@armyofagents/shared";

export type CommanderVerifyOutcome = "verified" | "needs_auth" | "not_installed" | "failed";

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
