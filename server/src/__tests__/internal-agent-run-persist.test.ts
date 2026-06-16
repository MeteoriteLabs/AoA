/**
 * T2 — Route cost/duration/provenance resolution contract tests.
 *
 * Tests the pure resolution branches that the chat SSE handler uses to
 * compute what gets persisted + sent in the `done` SSE event.
 *
 * Covers:
 *   - wall-clock durationMs fallback (finalSummary.durationMs <= 0)
 *   - estimate-vs-reported cost branch
 *   - no-tokenUsage path
 *   - F1: model/provider preference (adapter-reported over cost-label)
 *   - F2: done payload uses computed costCents, not finalSummary.costCents
 */
import { describe, it, expect } from "vitest";
import { resolveRunCostCents, rateModelForCliTool } from "../services/internal-agent/run-cost.js";

// ── Pure helpers mirroring the route's inline resolution logic ───────────────

interface FinalSummary {
  durationMs: number;
  costCents: number;
  tokenUsage?: { inputTokens: number; outputTokens: number; cachedInputTokens?: number } | null;
  model?: string | null;
  provider?: string | null;
}

function resolveDurationMs(finalSummary: FinalSummary | null, wallClockMs: number): number {
  return finalSummary && finalSummary.durationMs > 0 ? finalSummary.durationMs : wallClockMs;
}

function resolveCostCents(
  finalSummary: FinalSummary | null,
  runProvider: string,
  runModel: string,
): number {
  const tokenUsage = finalSummary?.tokenUsage ?? null;
  const reportedCostCents = finalSummary?.costCents ?? 0;
  if (tokenUsage) {
    return resolveRunCostCents({
      reportedCostCents,
      provider: runProvider,
      model: runModel,
      inputTokens: tokenUsage.inputTokens,
      outputTokens: tokenUsage.outputTokens,
    });
  }
  return reportedCostCents;
}

function resolvePersistedProvenance(
  finalSummary: FinalSummary | null,
  runModel: string,
  runProvider: string,
): { model: string; provider: string } {
  // F1: adapter-reported model/provider wins over cost-label defaults.
  return {
    model: finalSummary?.model ?? runModel,
    provider: finalSummary?.provider ?? runProvider,
  };
}

function resolveDonePayload(
  finalSummary: FinalSummary | null,
  computedCostCents: number,
): { costCents: number; tokenUsage: { inputTokens: number; outputTokens: number } } {
  // F2: done payload uses the locally-computed costCents (matches DB row)
  // and a guaranteed-non-null tokenUsage.
  return {
    costCents: computedCostCents,
    tokenUsage: finalSummary?.tokenUsage ?? { inputTokens: 0, outputTokens: 0 },
  };
}

// ── Pre-existing tests (preserved) ───────────────────────────────────────────

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

// ── T2: Route resolution branches ────────────────────────────────────────────

describe("T2 resolveDurationMs", () => {
  it("uses finalSummary.durationMs when > 0", () => {
    expect(resolveDurationMs({ durationMs: 1200, costCents: 0 }, 9999)).toBe(1200);
  });
  it("falls back to wall-clock when finalSummary.durationMs is 0", () => {
    expect(resolveDurationMs({ durationMs: 0, costCents: 0 }, 5000)).toBe(5000);
  });
  it("falls back to wall-clock when finalSummary is null", () => {
    expect(resolveDurationMs(null, 4200)).toBe(4200);
  });
  it("falls back to wall-clock when finalSummary.durationMs is negative", () => {
    expect(resolveDurationMs({ durationMs: -1, costCents: 0 }, 3300)).toBe(3300);
  });
});

describe("T2 resolveCostCents (estimate-vs-reported)", () => {
  it("returns reportedCostCents when > 0 (adapter billing path)", () => {
    const summary: FinalSummary = { durationMs: 1000, costCents: 500, tokenUsage: { inputTokens: 1000, outputTokens: 200 } };
    expect(resolveCostCents(summary, "anthropic", "claude-sonnet-4-6")).toBe(500);
  });
  it("estimates from tokens when reportedCostCents is 0 (codex subscription path)", () => {
    // Use 100k+ tokens so Math.round() doesn't collapse to 0.
    // gpt-4.1: 200 in/M + 800 out/M; 100k in + 50k out = 20 + 40 = 60 cents (before rounding).
    const summary: FinalSummary = { durationMs: 800, costCents: 0, tokenUsage: { inputTokens: 100_000, outputTokens: 50_000 } };
    expect(resolveCostCents(summary, "openai", "gpt-4.1")).toBeGreaterThan(0);
  });
  it("returns 0 when no tokenUsage and reportedCostCents is 0", () => {
    const summary: FinalSummary = { durationMs: 0, costCents: 0, tokenUsage: null };
    expect(resolveCostCents(summary, "anthropic", "claude-sonnet-4-6")).toBe(0);
  });
  it("returns 0 when finalSummary is null", () => {
    expect(resolveCostCents(null, "anthropic", "claude-sonnet-4-6")).toBe(0);
  });
});

describe("T2 resolvePersistedProvenance (F1 — adapter-reported over cost-label)", () => {
  it("uses adapter-reported model and provider when finalSummary carries them", () => {
    const summary: FinalSummary = { durationMs: 0, costCents: 0, model: "gpt-5.5", provider: "openai" };
    const result = resolvePersistedProvenance(summary, "gpt-4.1", "openai");
    expect(result).toEqual({ model: "gpt-5.5", provider: "openai" });
  });
  it("falls back to cost-label model/provider when finalSummary carries no model", () => {
    const summary: FinalSummary = { durationMs: 0, costCents: 0 };
    const result = resolvePersistedProvenance(summary, "gpt-4.1", "openai");
    expect(result).toEqual({ model: "gpt-4.1", provider: "openai" });
  });
  it("falls back to cost-label when finalSummary is null", () => {
    expect(resolvePersistedProvenance(null, "claude-sonnet-4-6", "anthropic")).toEqual({
      model: "claude-sonnet-4-6",
      provider: "anthropic",
    });
  });
  it("cost pricing still uses cost-label model even when adapter-reported model differs", () => {
    // The route uses runModel/runProvider for pricing; provenance columns use adapter-reported.
    // Use 100k+ tokens so Math.round() doesn't collapse to 0.
    const summary: FinalSummary = {
      durationMs: 0,
      costCents: 0,
      tokenUsage: { inputTokens: 100_000, outputTokens: 50_000 },
      model: "gpt-5.5",   // adapter-reported (provenance only)
      provider: "openai",
    };
    // Pricing: cost-label = gpt-4.1 (not gpt-5.5)
    const cost = resolveCostCents(summary, "openai", "gpt-4.1");
    expect(cost).toBeGreaterThan(0);
    // Provenance: adapter-reported = gpt-5.5
    const prov = resolvePersistedProvenance(summary, "gpt-4.1", "openai");
    expect(prov.model).toBe("gpt-5.5");
  });
});

describe("T2 resolveDonePayload (F2 — wire matches DB)", () => {
  it("costCents equals computed value, not finalSummary.costCents", () => {
    const summary: FinalSummary = { durationMs: 1000, costCents: 999, tokenUsage: { inputTokens: 100, outputTokens: 20 } };
    const payload = resolveDonePayload(summary, 42);
    expect(payload.costCents).toBe(42);
  });
  it("tokenUsage is non-null when finalSummary has no tokenUsage", () => {
    const summary: FinalSummary = { durationMs: 0, costCents: 0, tokenUsage: null };
    expect(resolveDonePayload(summary, 0).tokenUsage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
  it("tokenUsage is non-null when finalSummary is null", () => {
    expect(resolveDonePayload(null, 0).tokenUsage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
  it("tokenUsage passes through when present", () => {
    const summary: FinalSummary = { durationMs: 500, costCents: 0, tokenUsage: { inputTokens: 300, outputTokens: 80 } };
    expect(resolveDonePayload(summary, 5).tokenUsage).toEqual({ inputTokens: 300, outputTokens: 80 });
  });
});
