// server/src/__tests__/codex-model.test.ts
import { describe, it, expect } from "vitest";
import {
  resolveCodexChatModel,
  isCodexCompatibleModel,
  DEFAULT_CODEX_CHAT_MODEL,
  COMMANDER_CODEX_REASONING_EFFORT,
} from "../services/internal-agent/codex-model.js";

describe("isCodexCompatibleModel", () => {
  it("accepts ChatGPT-account openai chat families", () => {
    expect(isCodexCompatibleModel("gpt-5.5")).toBe(true);
    expect(isCodexCompatibleModel("gpt-4.1")).toBe(true);
    expect(isCodexCompatibleModel("gpt-4o")).toBe(true);
    expect(isCodexCompatibleModel("o3-mini")).toBe(true);
    expect(isCodexCompatibleModel("o1")).toBe(true);
    expect(isCodexCompatibleModel("chatgpt-4o")).toBe(true);
    expect(isCodexCompatibleModel("  gpt-5.5  ")).toBe(true); // trims
  });
  it("rejects the known-bad GPT-Codex variants (ChatGPT-account 400s) — REVIEW FIX C1/C2", () => {
    // The exact model that 400s on a ChatGPT account; it passed a naive /^gpt-/.
    expect(isCodexCompatibleModel("gpt-5.3-codex")).toBe(false);
    expect(isCodexCompatibleModel("gpt-5-codex")).toBe(false);
    expect(isCodexCompatibleModel("o1-codex")).toBe(false);
    expect(isCodexCompatibleModel("codex-mini")).toBe(false);
  });
  it("rejects non-openai families + empty", () => {
    expect(isCodexCompatibleModel("claude-sonnet-4-6")).toBe(false);
    expect(isCodexCompatibleModel("gemini-2.0")).toBe(false);
    expect(isCodexCompatibleModel("opus")).toBe(false);
    expect(isCodexCompatibleModel("")).toBe(false);
    expect(isCodexCompatibleModel(null)).toBe(false);
    expect(isCodexCompatibleModel(undefined)).toBe(false);
  });
  it("rejects shell-unsafe strings (spawn uses shell:true on Windows) — REVIEW FIX C10/S5", () => {
    expect(isCodexCompatibleModel("gpt-5.5; rm -rf /")).toBe(false);
    expect(isCodexCompatibleModel("gpt-5.5 && calc")).toBe(false);
    expect(isCodexCompatibleModel("gpt-5.5\nmalicious")).toBe(false);
    expect(isCodexCompatibleModel("gpt-5.5`whoami`")).toBe(false);
  });
});

describe("resolveCodexChatModel", () => {
  it("uses config.model when codex-compatible", () => {
    expect(resolveCodexChatModel("gpt-4.1", "gpt-5.5")).toBe("gpt-4.1");
    expect(resolveCodexChatModel("  o3-mini ", "gpt-5.5")).toBe("o3-mini");
  });
  it("falls back to the shared model when config.model is a claude default", () => {
    expect(resolveCodexChatModel("claude-sonnet-4-6", "gpt-5.5")).toBe("gpt-5.5");
  });
  it("VALIDATES the shared model too (not trusted as-is) — REVIEW FIX C1", () => {
    // shared ~/.codex could hold a claude alias or a GPT-Codex model → must not pass it through
    expect(resolveCodexChatModel(null, "claude-3-opus")).toBe(DEFAULT_CODEX_CHAT_MODEL);
    expect(resolveCodexChatModel(null, "gpt-5.3-codex")).toBe(DEFAULT_CODEX_CHAT_MODEL);
    expect(resolveCodexChatModel(null, "gpt-5.5")).toBe("gpt-5.5"); // valid shared still honored
  });
  it("falls back to the safe default when nothing usable is available", () => {
    expect(resolveCodexChatModel(null, null)).toBe(DEFAULT_CODEX_CHAT_MODEL);
    expect(resolveCodexChatModel("claude-sonnet-4-6", "  ")).toBe(DEFAULT_CODEX_CHAT_MODEL);
  });
  it("exposes the proven defaults", () => {
    expect(DEFAULT_CODEX_CHAT_MODEL).toBe("gpt-5.5");
    expect(COMMANDER_CODEX_REASONING_EFFORT).toBe("high");
  });
});
