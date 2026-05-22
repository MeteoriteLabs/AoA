import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("cli-mode spawn shape invariant", () => {
  it("cli-mode.ts still sends params.content verbatim and is not modified by this feature", () => {
    // Use __dirname so this works whether vitest CWD is server/ or monorepo root.
    const src = readFileSync(resolve(__dirname, "../services/internal-agent/cli-mode.ts"), "utf8");
    // claude argv still uses safeContent / safeRawContent; codex still prompt: params.content
    // C-systemsplit (corrected): --system-prompt-file is used instead of inline --system-prompt
    // to avoid Windows cmd.exe newline-truncation. --dangerously-skip-permissions bypasses
    // the MCP tool permission prompts that block tools in non-interactive (-p) mode.
    expect(src).toContain("--system-prompt-file");
    expect(src).toContain("--dangerously-skip-permissions");
    expect(src).toContain("systemSplitArgs.safeRawContent");
    expect(src).toContain("prompt: params.content");
    // no skillsDir / assembledPrompt plumbing leaked into cli-mode
    expect(src).not.toContain("skillsDir");
    expect(src).not.toContain("assembledPrompt");
  });
});
