import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("cli-mode spawn shape invariant", () => {
  it("cli-mode.ts still sends params.content verbatim and is not modified by this feature", () => {
    // Use __dirname so this works whether vitest CWD is server/ or monorepo root.
    const src = readFileSync(resolve(__dirname, "../services/internal-agent/cli-mode.ts"), "utf8");
    // claude argv still uses safeContent (= params.content); codex still prompt:params.content
    expect(src).toContain('"-p", safeContent, "--output-format", "text"');
    expect(src).toContain("prompt: params.content");
    // no skillsDir / assembledPrompt plumbing leaked into cli-mode
    expect(src).not.toContain("skillsDir");
    expect(src).not.toContain("assembledPrompt");
  });
});
