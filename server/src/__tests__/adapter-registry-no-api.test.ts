import { describe, it, expect } from "vitest";
import { AGENT_ADAPTER_TYPES } from "@armyofagents/shared";
import { BUILTIN_ADAPTER_TYPES } from "../adapters/builtin-adapter-types.js";

// Regression guard for Sprint 2A: ensures the three API adapters stay removed.
// See docs/superpowers/specs/2026-04-24-sprint-2a-drop-api-adapters-design.md
describe("adapter registry after Sprint 2A", () => {
  it("AGENT_ADAPTER_TYPES does not include claude_api / openai_api / gemini_api", () => {
    expect(AGENT_ADAPTER_TYPES).not.toContain("claude_api");
    expect(AGENT_ADAPTER_TYPES).not.toContain("openai_api");
    expect(AGENT_ADAPTER_TYPES).not.toContain("gemini_api");
  });

  it("BUILTIN_ADAPTER_TYPES set does not include API adapters", () => {
    expect(BUILTIN_ADAPTER_TYPES.has("claude_api")).toBe(false);
    expect(BUILTIN_ADAPTER_TYPES.has("openai_api")).toBe(false);
    expect(BUILTIN_ADAPTER_TYPES.has("gemini_api")).toBe(false);
  });

  it("still includes expected CLI adapters (regression guard)", () => {
    expect(AGENT_ADAPTER_TYPES).toContain("claude_local");
    expect(AGENT_ADAPTER_TYPES).toContain("codex_local");
    expect(AGENT_ADAPTER_TYPES).toContain("opencode_local");
    expect(AGENT_ADAPTER_TYPES).toContain("openclaw");
    expect(AGENT_ADAPTER_TYPES).toContain("cursor");
    expect(AGENT_ADAPTER_TYPES).toContain("hermes_local");
    expect(AGENT_ADAPTER_TYPES).toContain("gemini_local");
    expect(BUILTIN_ADAPTER_TYPES.has("claude_local")).toBe(true);
    expect(BUILTIN_ADAPTER_TYPES.has("codex_local")).toBe(true);
    expect(BUILTIN_ADAPTER_TYPES.has("openclaw")).toBe(true);
  });
});
