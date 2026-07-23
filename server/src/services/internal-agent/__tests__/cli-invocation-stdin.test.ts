/**
 * cli-invocation-stdin.test.ts (W1 / Task 3)
 *
 * Unit tests for the now-exported resolveCliInvocation, proving the Windows
 * prompt-delivery fix: claude's user prompt is delivered over STDIN (raw,
 * unescaped) and is NOT an argv positional.
 *
 * Root cause (see docs/aoa/plans/keyless-cli-spike-findings.md): on Windows the
 * prompt passed as an argv positional through shell:true/cmd.exe is silently
 * dropped — claude runs but answers something unrelated (the empty/garbage
 * Commander turn). stdin delivery returns the correct answer.
 *
 * Both claude branches are covered:
 *   - systemSplit path  (systemContext + rawContent assembled by agent-loop)
 *   - plain path        (no systemSplit — rawContent threaded as the prompt)
 *
 * fs/promises.writeFile is stubbed so the helper never touches disk.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// resolveCliInvocation writes the {mcpServers:{aoa}} JSON (+ the sysprompt txt
// on the systemSplit path) via fs/promises.writeFile — stub it.
vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {}),
  unlink: vi.fn(async () => {}),
}));

const BASE_PARAMS = {
  companyId: "comp1",
  userId: "user1",
  userRole: "founder",
  enabledCapabilities: [] as string[],
  bridgeEntrypoint: "/app/dist/mcp-bridge.js",
  actorType: "commander",
  contextScope: null,
};

describe("resolveCliInvocation — claude stdin prompt delivery (W1 fix)", () => {
  let resolveCliInvocation: typeof import("../cli-mode.js").resolveCliInvocation;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import("../cli-mode.js");
    resolveCliInvocation = mod.resolveCliInvocation;
  });

  it("plain path: args carry NO user content; stdinPrompt is the raw prompt", async () => {
    const rawPrompt = 'hello "world" 100% & ^caret';
    // safeContent would be the win32-escaped form on Windows; pass a distinct
    // escaped string to prove stdinPrompt uses the RAW prompt, not safeContent.
    const safeContent = `"${rawPrompt.replace(/"/g, '""')}"`;

    const invocation = await resolveCliInvocation(
      "claude_cli",
      BASE_PARAMS as any,
      safeContent,
      undefined, // resumeCodexSessionId
      undefined, // systemSplitArgs (plain path)
      true,      // vendorCliBypassEnabled
      undefined, // codexModel
      rawPrompt, // rawContent threaded by the caller
    );

    expect(invocation).not.toBeNull();
    expect(invocation!.binary).toBe("claude");

    // The argv must NOT contain the user content in any escaped form.
    expect(invocation!.args.join("|")).not.toContain("hello");
    expect(invocation!.args).not.toContain(safeContent);
    expect(invocation!.args).not.toContain(rawPrompt);

    // argv stops at the print-mode flags (no trailing positional).
    expect(invocation!.args[invocation!.args.length - 1]).toBe("--verbose");

    // stdinPrompt is the RAW, unescaped prompt — never the cmd-escaped form.
    expect(invocation!.stdinPrompt).toBe(rawPrompt);
    expect(invocation!.stdinPrompt).not.toBe(safeContent);
  });

  it("systemSplit path: args carry NO user content; stdinPrompt is the raw rawContent; --system-prompt-file present", async () => {
    const rawContent = "do the thing with 100% effort";
    const systemSplitArgs = {
      rawSystemContext: "## System\nYou are Commander.\nMulti-line context.",
      rawContent,
    };

    const invocation = await resolveCliInvocation(
      "claude_cli",
      BASE_PARAMS as any,
      "ignored-safeContent",
      undefined,        // resumeCodexSessionId
      systemSplitArgs,  // systemSplit path
      true,             // vendorCliBypassEnabled
      undefined,        // codexModel
      "ignored-rawContent-param", // plain-path rawContent must NOT be used here
    );

    expect(invocation).not.toBeNull();
    expect(invocation!.binary).toBe("claude");

    // --system-prompt-file is present (Windows-safe multi-line system context).
    expect(invocation!.args).toContain("--system-prompt-file");

    // The argv must NOT contain the user content.
    expect(invocation!.args.join("|")).not.toContain("do the thing");
    expect(invocation!.args).not.toContain(rawContent);
    // argv ends at the flags — no trailing content positional.
    expect(invocation!.args[invocation!.args.length - 1]).toBe("--verbose");

    // stdinPrompt is the systemSplit rawContent (NOT the plain-path param).
    expect(invocation!.stdinPrompt).toBe(rawContent);
    expect(invocation!.stdinPrompt).not.toBe("ignored-rawContent-param");
  });

  it("plain path: when rawContent is absent, stdinPrompt falls back to safeContent", async () => {
    const safeContent = "fallback-prompt";
    const invocation = await resolveCliInvocation(
      "claude_cli",
      BASE_PARAMS as any,
      safeContent,
      undefined,
      undefined,
      true,
      undefined,
      undefined, // rawContent NOT threaded
    );
    expect(invocation!.stdinPrompt).toBe(safeContent);
  });

  // D2 (strict MCP isolation): whenever the Commander argv passes --mcp-config
  // it MUST also pass --strict-mcp-config, immediately after the config path.
  // Without it the claude CLI additionally loads the host machine's
  // ~/.claude.json and project .mcp.json (and claude.ai connectors).
  it("plain path: argv pairs --mcp-config with --strict-mcp-config (D2)", async () => {
    const invocation = await resolveCliInvocation(
      "claude_cli",
      BASE_PARAMS as any,
      "safe",
      undefined,
      undefined, // plain path
      true,
      undefined,
      "raw-prompt",
    );
    expect(invocation!.args).toContain("--mcp-config");
    expect(invocation!.args).toContain("--strict-mcp-config");
    // strict flag sits immediately after the config path element.
    const cfgIdx = invocation!.args.indexOf("--mcp-config");
    expect(invocation!.args[cfgIdx + 2]).toBe("--strict-mcp-config");
  });

  it("systemSplit path: argv pairs --mcp-config with --strict-mcp-config (D2)", async () => {
    const invocation = await resolveCliInvocation(
      "claude_cli",
      BASE_PARAMS as any,
      "ignored-safeContent",
      undefined,
      { rawSystemContext: "## System\nYou are Commander.", rawContent: "do it" },
      true,
      undefined,
      undefined,
    );
    expect(invocation!.args).toContain("--mcp-config");
    expect(invocation!.args).toContain("--strict-mcp-config");
    const cfgIdx = invocation!.args.indexOf("--mcp-config");
    expect(invocation!.args[cfgIdx + 2]).toBe("--strict-mcp-config");
  });

  it("vendorCliBypassEnabled=false drops --dangerously-skip-permissions but still uses stdin", async () => {
    const invocation = await resolveCliInvocation(
      "claude_cli",
      BASE_PARAMS as any,
      "safe",
      undefined,
      undefined,
      false, // bypass disabled
      undefined,
      "raw-prompt",
    );
    expect(invocation!.args).not.toContain("--dangerously-skip-permissions");
    expect(invocation!.stdinPrompt).toBe("raw-prompt");
  });
});
