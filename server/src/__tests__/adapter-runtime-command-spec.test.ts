import { describe, expect, it } from "vitest";
import { findServerAdapter } from "../adapters/registry.js";

describe("adapter runtime command specs", () => {
  it.each([
    ["claude_local", "claude", "@anthropic-ai/claude-code"],
    ["codex_local", "codex", "@openai/codex"],
    ["gemini_local", "gemini", "@google/gemini-cli"],
    ["opencode_local", "opencode", "opencode-ai"],
  ])("%s default command includes npm install guidance", (type, command, packageName) => {
    const spec = findServerAdapter(type)?.getRuntimeCommandSpec?.({});

    expect(spec).toEqual({
      command,
      detectCommand: `command -v ${command}`,
      installCommand: `npm install -g ${packageName}`,
    });
  });

  it.each([
    ["claude_local", "my-claude"],
    ["codex_local", "my-codex"],
    ["gemini_local", "my-gemini"],
    ["opencode_local", "my-opencode"],
  ])("%s custom command does not include install guidance", (type, command) => {
    const spec = findServerAdapter(type)?.getRuntimeCommandSpec?.({ command });

    expect(spec).toEqual({
      command,
      detectCommand: `command -v ${command}`,
      installCommand: null,
    });
  });

  it.each([
    ["cursor", "agent"],
    ["openclaw", "openclaw"],
  ])("%s is command-only without install guidance", (type, command) => {
    const spec = findServerAdapter(type)?.getRuntimeCommandSpec?.({});
    const customSpec = findServerAdapter(type)?.getRuntimeCommandSpec?.({ command: `custom-${command}` });

    expect(spec).toEqual({
      command,
      detectCommand: `command -v ${command}`,
      installCommand: null,
    });
    expect(customSpec).toEqual({
      command: `custom-${command}`,
      detectCommand: `command -v custom-${command}`,
      installCommand: null,
    });
  });
});
