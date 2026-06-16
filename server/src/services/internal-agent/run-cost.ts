import { computeCostCents } from "./cost-model.js";

/**
 * Cost for a finished Commander run, in cents.
 * Prefer the adapter-reported cost (already real cents). Subscription CLI
 * reports 0 — fall back to a token × list-price ESTIMATE. Never a real bill.
 */
export function resolveRunCostCents(input: {
  reportedCostCents: number;
  provider: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
}): number {
  if (input.reportedCostCents > 0) return input.reportedCostCents;
  return computeCostCents(
    input.provider ?? "anthropic",
    input.model ?? "claude-sonnet-4-6",
    input.inputTokens,
    input.outputTokens,
  );
}

/**
 * REVIEW FIX (Lens C): the estimate's rate model must reflect the ACTIVE CLI
 * tool, not internal_agent_config.model (a dormant legacy API-mode column that
 * defaults to claude-sonnet-4-6 regardless of the CLI in use — so a codex run
 * would otherwise be priced at Claude rates). For claude_cli we honour an
 * explicitly-configured model; otherwise we use a representative model per tool.
 * It is a labelled estimate, not a bill.
 */
export function rateModelForCliTool(
  cliTool: string | null,
  configModel: string | null,
): { provider: string; model: string } {
  switch (cliTool) {
    case "codex":
      return { provider: "openai", model: "gpt-4.1" };
    case "claude_cli":
    default:
      return { provider: "anthropic", model: configModel ?? "claude-sonnet-4-6" };
  }
}
