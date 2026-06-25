import { describe, it, expect } from "vitest";
import { createAgentSchema, createAgentHireSchema, updateAgentSchema } from "./agent.js";

describe("agent schema adapter↔model cross-family + shell-safety", () => {
  it("rejects claude_local + a gpt model (cross-family)", () => {
    expect(
      createAgentSchema.safeParse({
        name: "x",
        adapterType: "claude_local",
        adapterConfig: { model: "gpt-5.5" },
      }).success,
    ).toBe(false);
  });

  it("rejects codex_local + a claude model", () => {
    expect(
      updateAgentSchema.safeParse({
        adapterType: "codex_local",
        adapterConfig: { model: "claude-sonnet-4-5-20250929" },
      }).success,
    ).toBe(false);
  });

  it("rejects a shell-unsafe model", () => {
    expect(
      updateAgentSchema.safeParse({
        adapterType: "codex_local",
        adapterConfig: { model: "gpt-5 && rm" },
      }).success,
    ).toBe(false);
  });

  it("allows opencode_local + openai/<model> slash format", () => {
    expect(
      updateAgentSchema.safeParse({
        adapterType: "opencode_local",
        adapterConfig: { model: "openai/gpt-5.2-codex" },
      }).success,
    ).toBe(true);
  });

  it("allows gemini_local + 'auto' and an unknown-but-safe model", () => {
    expect(
      updateAgentSchema.safeParse({
        adapterType: "gemini_local",
        adapterConfig: { model: "auto" },
      }).success,
    ).toBe(true);
    expect(
      updateAgentSchema.safeParse({
        adapterType: "codex_local",
        adapterConfig: { model: "gpt-5.6" },
      }).success,
    ).toBe(true);
  });

  it("rejects claude_local + a gpt model via createAgentHireSchema (hire path)", () => {
    expect(createAgentHireSchema.safeParse({ name: "x", adapterType: "claude_local", adapterConfig: { model: "gpt-5.5" } }).success).toBe(false);
  });
  it("allows a partial update with a model but no adapterType (early return — pure validator can't see persisted adapterType)", () => {
    expect(updateAgentSchema.safeParse({ adapterConfig: { model: "gpt-5.5" } }).success).toBe(true);
  });
  it("allows an o-series model on codex_local (openai family)", () => {
    expect(updateAgentSchema.safeParse({ adapterType: "codex_local", adapterConfig: { model: "o3" } }).success).toBe(true);
  });
  it("rejects an opencode slash model with a shell-unsafe first segment", () => {
    expect(updateAgentSchema.safeParse({ adapterType: "opencode_local", adapterConfig: { model: "ev&il/gpt-5.5" } }).success).toBe(false);
  });
  it("allows opencode_local + anthropic/claude model (multi-provider, the ① fix)", () => {
    expect(updateAgentSchema.safeParse({ adapterType: "opencode_local", adapterConfig: { model: "anthropic/claude-sonnet-4-5" } }).success).toBe(true);
  });
  it("allows opencode_local + google/gemini model (multi-provider)", () => {
    expect(updateAgentSchema.safeParse({ adapterType: "opencode_local", adapterConfig: { model: "google/gemini-2.0-flash" } }).success).toBe(true);
  });
});
