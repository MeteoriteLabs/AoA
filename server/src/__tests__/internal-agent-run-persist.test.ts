import { describe, it, expect } from "vitest";
import { resolveRunCostCents, rateModelForCliTool } from "../services/internal-agent/run-cost.js";

describe("rateModelForCliTool", () => {
  it("prices claude_cli at the configured claude model (or sonnet default)", () => {
    expect(rateModelForCliTool("claude_cli", null)).toEqual({ provider: "anthropic", model: "claude-sonnet-4-6" });
    expect(rateModelForCliTool("claude_cli", "claude-opus-4-6")).toEqual({ provider: "anthropic", model: "claude-opus-4-6" });
  });
  it("prices codex at a GPT model, NOT claude rates", () => {
    expect(rateModelForCliTool("codex", "claude-sonnet-4-6")).toEqual({ provider: "openai", model: "gpt-4.1" });
  });
});

describe("resolveRunCostCents", () => {
  it("prefers the adapter-reported cost when > 0", () => {
    expect(
      resolveRunCostCents({ reportedCostCents: 7, provider: "anthropic", model: "claude-opus-4-6", inputTokens: 100, outputTokens: 100 }),
    ).toBe(7);
  });
  it("estimates from tokens when reported cost is 0 (subscription)", () => {
    // sonnet: 300 in/M, 1500 out/M; 1M in + 1M out = 300 + 1500 = 1800 cents
    expect(
      resolveRunCostCents({ reportedCostCents: 0, provider: "anthropic", model: "claude-sonnet-4-6", inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    ).toBe(1800);
  });
  it("falls back to a default model rate when model is null", () => {
    expect(
      resolveRunCostCents({ reportedCostCents: 0, provider: null, model: null, inputTokens: 1_000_000, outputTokens: 0 }),
    ).toBe(300);
  });
});
