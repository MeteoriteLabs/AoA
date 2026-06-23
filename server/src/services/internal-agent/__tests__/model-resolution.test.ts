import { describe, it, expect } from "vitest";
import { resolveModel, ShellUnsafeModelError } from "../model-resolution.js";

const chatgpt = { authMode: "chatgpt" as const, defaultModelResolved: "gpt-5.5" };

describe("resolveModel", () => {
  it("THROWS on a shell-unsafe model regardless of tier", () => {
    expect(() => resolveModel("codex_local", "gpt-5 & calc.exe", chatgpt)).toThrow(ShellUnsafeModelError);
  });
  it("corrects an API-key-only codex model on chatgpt to the safe default", () => {
    const r = resolveModel("codex_local", "gpt-5.3-codex", chatgpt);
    expect(r.model).toBe("gpt-5.5");
    expect(r.note).toMatch(/not supported.*ChatGPT/i);
  });
  it("passes a compatible codex model through unchanged", () => {
    expect(resolveModel("codex_local", "gpt-5.5", chatgpt).model).toBe("gpt-5.5");
  });
  it("empty model on codex resolves to the validated default", () => {
    expect(resolveModel("codex_local", "", chatgpt).model).toBe("gpt-5.5");
  });
  it("claude passes a claude model through; gemini 'auto' is allowed (omit)", () => {
    expect(resolveModel("claude_local", "claude-sonnet-4-5-20250929", { authMode: "subscription", defaultModelResolved: null }).model)
      .toBe("claude-sonnet-4-5-20250929");
    expect(resolveModel("gemini_local", "auto", { authMode: "unknown", defaultModelResolved: null }).omitModelFlag).toBe(true);
  });
});
