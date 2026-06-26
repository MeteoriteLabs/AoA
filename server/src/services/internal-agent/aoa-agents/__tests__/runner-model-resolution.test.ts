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
  it("KEEPS a per-agent OPENAI_API_KEY stored as a normalized plain binding (Codex P2)", () => {
    // Saved env entries are normalized to binding objects; a string-only check
    // would treat the agent's own key as absent and strip it.
    const cfg = applyModelResolutionToConfig("codex_local",
      { model: "gpt-5.5", env: { OPENAI_API_KEY: { type: "plain", value: "sk-agent" } } }, status,
      { inheritedEnvOpenAiKey: "sk-company" });
    expect((cfg.env as Record<string, unknown>).OPENAI_API_KEY).toEqual({ type: "plain", value: "sk-agent" });
  });
  it("KEEPS a per-agent OPENAI_API_KEY stored as a secret_ref binding (Codex P2)", () => {
    const cfg = applyModelResolutionToConfig("codex_local",
      { model: "gpt-5.5", env: { OPENAI_API_KEY: { type: "secret_ref", secretId: "11111111-1111-4111-8111-111111111111" } } }, status,
      { inheritedEnvOpenAiKey: "sk-company" });
    expect((cfg.env as Record<string, unknown>).OPENAI_API_KEY).toEqual({ type: "secret_ref", secretId: "11111111-1111-4111-8111-111111111111" });
  });
  it("sets env to {} (no inherited key leaks) when the codex config has no env field", () => {
    const cfg = applyModelResolutionToConfig("codex_local", { model: "gpt-5.5" }, status,
      { inheritedEnvOpenAiKey: "sk-company" });
    expect((cfg.env as Record<string, unknown>).OPENAI_API_KEY).toBeUndefined();
  });

  // Codex P2 (org/heartbeat path): baseConfig.env is the project→environment→agent
  // MERGE. A project/environment OPENAI_API_KEY (meant for the app being built)
  // must NOT count as the agent's own key, and must be stripped from the codex
  // spawn. The caller passes agentOwnEnv (the agent's pre-merge adapterConfig.env).
  it("strips a project/environment OPENAI_API_KEY from the merged env when the agent set none (agentOwnEnv)", () => {
    const cfg = applyModelResolutionToConfig("codex_local",
      { model: "gpt-5.3-codex", env: { OPENAI_API_KEY: "sk-project" } }, status,
      { agentOwnEnv: {} });
    // agent has no own key → detection-side stays non-apikey (model corrected)…
    expect(cfg.model).toBe("gpt-5.5");
    // …and the non-agent key never reaches the CLI.
    expect((cfg.env as Record<string, unknown>).OPENAI_API_KEY).toBeUndefined();
  });
  it("KEEPS the agent's OWN key even when the merged env also carries it (agentOwnEnv has the key)", () => {
    const cfg = applyModelResolutionToConfig("codex_local",
      { model: "gpt-5.5", env: { OPENAI_API_KEY: "sk-agent" } }, status,
      { agentOwnEnv: { OPENAI_API_KEY: "sk-agent" }, inheritedEnvOpenAiKey: "sk-company" });
    expect((cfg.env as Record<string, unknown>).OPENAI_API_KEY).toBe("sk-agent");
  });
  it("treats a binding-object agentOwnEnv key as agent-set (preserves the merged key)", () => {
    const cfg = applyModelResolutionToConfig("codex_local",
      { model: "gpt-5.5", env: { OPENAI_API_KEY: "sk-resolved" } }, status,
      { agentOwnEnv: { OPENAI_API_KEY: { type: "secret_ref", secretId: "11111111-1111-4111-8111-111111111111" } } });
    expect((cfg.env as Record<string, unknown>).OPENAI_API_KEY).toBe("sk-resolved");
  });
});
