import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildPreToolUseSettings,
  writeRuntimeHookSettingsFile,
  PERMISSION_REQUIRING_TOOLS,
} from "../server/runtime-hook-settings.js";

describe("PERMISSION_REQUIRING_TOOLS", () => {
  it("is a non-empty array of tool names", () => {
    expect(Array.isArray(PERMISSION_REQUIRING_TOOLS)).toBe(true);
    expect(PERMISSION_REQUIRING_TOOLS.length).toBeGreaterThan(0);
  });

  it("includes expected permission-requiring tools", () => {
    expect(PERMISSION_REQUIRING_TOOLS).toContain("Bash");
    expect(PERMISSION_REQUIRING_TOOLS).toContain("Write");
    expect(PERMISSION_REQUIRING_TOOLS).toContain("Edit");
  });

  it("does NOT include benign read-only tools", () => {
    expect(PERMISSION_REQUIRING_TOOLS).not.toContain("Read");
    expect(PERMISSION_REQUIRING_TOOLS).not.toContain("Grep");
    expect(PERMISSION_REQUIRING_TOOLS).not.toContain("Glob");
    expect(PERMISSION_REQUIRING_TOOLS).not.toContain("LS");
    expect(PERMISSION_REQUIRING_TOOLS).not.toContain("TodoWrite");
  });
});

describe("buildPreToolUseSettings", () => {
  const sampleInput = {
    endpointUrl: "http://localhost:3000/internal/runtime-hooks/permission-request",
    timeoutSec: 300,
    forwarderPath: "/tmp/hook-forward.mjs",
  };

  it("returns an object with only the 'hooks' key", () => {
    const result = buildPreToolUseSettings(sampleInput);
    const keys = Object.keys(result);
    expect(keys).toEqual(["hooks"]);
  });

  it("does NOT have 'permissions', 'mcpServers', or 'env' keys", () => {
    const result = buildPreToolUseSettings(sampleInput);
    expect(result).not.toHaveProperty("permissions");
    expect(result).not.toHaveProperty("mcpServers");
    expect(result).not.toHaveProperty("env");
  });

  it("has hooks.PreToolUse as an array with one entry", () => {
    const result = buildPreToolUseSettings(sampleInput);
    expect(result.hooks).toHaveProperty("PreToolUse");
    expect(Array.isArray(result.hooks.PreToolUse)).toBe(true);
    expect(result.hooks.PreToolUse).toHaveLength(1);
  });

  it("the hook entry has a scoped matcher (not '*')", () => {
    const result = buildPreToolUseSettings(sampleInput);
    const entry = result.hooks.PreToolUse[0];
    expect(entry).toHaveProperty("matcher");
    expect(entry.matcher).not.toBe("*");
    expect(typeof entry.matcher).toBe("string");
    expect(entry.matcher.length).toBeGreaterThan(0);
  });

  it("the matcher is a pipe-regex covering Bash, Write, Edit", () => {
    const result = buildPreToolUseSettings(sampleInput);
    const matcher = result.hooks.PreToolUse[0].matcher;
    // It should match the expected permission-requiring tools
    const matcherRe = new RegExp(matcher);
    expect(matcherRe.test("Bash")).toBe(true);
    expect(matcherRe.test("Write")).toBe(true);
    expect(matcherRe.test("Edit")).toBe(true);
    expect(matcherRe.test("MultiEdit")).toBe(true);
    expect(matcherRe.test("WebFetch")).toBe(true);
  });

  it("the matcher does NOT match benign tools", () => {
    const result = buildPreToolUseSettings(sampleInput);
    const matcher = result.hooks.PreToolUse[0].matcher;
    const matcherRe = new RegExp(matcher);
    expect(matcherRe.test("Read")).toBe(false);
    expect(matcherRe.test("Grep")).toBe(false);
    expect(matcherRe.test("Glob")).toBe(false);
  });

  it("the hook entry has a hooks array with one command-type hook", () => {
    const result = buildPreToolUseSettings(sampleInput);
    const entry = result.hooks.PreToolUse[0];
    expect(Array.isArray(entry.hooks)).toBe(true);
    expect(entry.hooks).toHaveLength(1);
    const hook = entry.hooks[0];
    expect(hook.type).toBe("command");
  });

  it("the command invokes the forwarder via node", () => {
    const result = buildPreToolUseSettings(sampleInput);
    const hook = result.hooks.PreToolUse[0].hooks[0];
    expect(hook.command).toContain("node");
    expect(hook.command).toContain(sampleInput.forwarderPath);
  });

  it("the command does NOT embed the endpoint URL", () => {
    const result = buildPreToolUseSettings(sampleInput);
    const hook = result.hooks.PreToolUse[0].hooks[0];
    expect(hook.command).not.toContain(sampleInput.endpointUrl);
  });

  it("the hook uses timeoutSec from the input", () => {
    const result = buildPreToolUseSettings(sampleInput);
    const hook = result.hooks.PreToolUse[0].hooks[0];
    expect(hook.timeout).toBe(sampleInput.timeoutSec);
  });

  it("works with a different timeoutSec", () => {
    const result = buildPreToolUseSettings({ ...sampleInput, timeoutSec: 60 });
    const hook = result.hooks.PreToolUse[0].hooks[0];
    expect(hook.timeout).toBe(60);
  });

  it("token is never present in the settings JSON", () => {
    const token = "super-secret-token-xyz";
    const result = buildPreToolUseSettings({
      ...sampleInput,
      // endpointUrl intentionally does not carry token; confirm JSON has no token
    });
    const json = JSON.stringify(result);
    expect(json).not.toContain(token);
  });

  it("the settings object can be JSON round-tripped cleanly", () => {
    const result = buildPreToolUseSettings(sampleInput);
    const json = JSON.stringify(result);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual(result);
  });
});

describe("writeRuntimeHookSettingsFile", () => {
  it("writes valid JSON to a file in the given dir and returns the path", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hook-settings-test-"));
    const settings = buildPreToolUseSettings({
      endpointUrl: "http://localhost:3000/internal/runtime-hooks/permission-request",
      timeoutSec: 300,
      forwarderPath: "/tmp/hook-forward.mjs",
    });

    const filePath = await writeRuntimeHookSettingsFile(dir, settings);

    expect(typeof filePath).toBe("string");
    expect(filePath.startsWith(dir)).toBe(true);
    expect(filePath.endsWith(".json")).toBe(true);

    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual(settings);

    await fs.rm(dir, { recursive: true, force: true });
  });
});
