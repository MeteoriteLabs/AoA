import { describe, it, expect } from "vitest";
import { applyModelResolutionToConfig } from "../runner-model-resolution.js";

const status = { authMode: "chatgpt" as const, defaultModelResolved: "gpt-5.5" };
describe("applyModelResolutionToConfig", () => {
  it("rewrites an incompatible codex model to the safe default", () => {
    const cfg = applyModelResolutionToConfig("codex_local", { model: "gpt-5.3-codex", env: {} }, status);
    expect(cfg.model).toBe("gpt-5.5");
  });
  it("strips a stray (company) OPENAI_API_KEY when the agent did NOT set one", () => {
    const cfg = applyModelResolutionToConfig("codex_local", { model: "gpt-5.5", env: {} }, status,
      { inheritedEnvOpenAiKey: "sk-company" });
    expect((cfg.env as Record<string, unknown>).OPENAI_API_KEY).toBeUndefined();
  });
  it("KEEPS a per-agent OPENAI_API_KEY the agent set itself", () => {
    const cfg = applyModelResolutionToConfig("codex_local", { model: "gpt-5.5", env: { OPENAI_API_KEY: "sk-agent" } }, status,
      { inheritedEnvOpenAiKey: "sk-company" });
    expect((cfg.env as Record<string, unknown>).OPENAI_API_KEY).toBe("sk-agent");
  });
});
