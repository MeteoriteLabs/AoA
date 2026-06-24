import { describe, it, expect } from "vitest";
import { resolveRunScopedModel } from "../services/heartbeat-provider-resolution.js";

const chatgpt = { adapterType: "codex_local", installed: true, authenticated: true, authMode: "chatgpt" as const, defaultModelResolved: "gpt-5.5" };

describe("resolveRunScopedModel (heartbeat/org path)", () => {
  it("corrects an incompatible codex model on chatgpt to gpt-5.5", () => {
    const cfg = resolveRunScopedModel("codex_local", { model: "gpt-5.3-codex", env: {} }, chatgpt);
    expect(cfg.model).toBe("gpt-5.5");
  });
  it("EDGE #5: resolves the budget-SWAPPED model, not the original (operates on the passed config only)", () => {
    // The seam is config-only and pure; the ordering guarantee (resolve AFTER the
    // cheap-model swap, BEFORE resolveAdapterExecutionContext) lives in the caller
    // and is proven by the heartbeat-wiring integration test in Task 3.
    const swapped = { model: "gpt-5.3-codex", env: {} };
    const cfg = resolveRunScopedModel("codex_local", swapped, chatgpt);
    expect(cfg.model).toBe("gpt-5.5");
  });
  it("strips an inherited company OPENAI_API_KEY (codex) the agent didn't set", () => {
    const cfg = resolveRunScopedModel("codex_local", { model: "gpt-5.5", env: {} }, chatgpt, { inheritedEnvOpenAiKey: "sk-company" });
    expect((cfg.env as Record<string, unknown>).OPENAI_API_KEY).toBeUndefined();
  });
});
