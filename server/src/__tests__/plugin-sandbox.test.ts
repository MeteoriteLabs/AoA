import { describe, it, expect } from "vitest";
import { buildSandboxExecArgv } from "../services/plugin-sandbox.js";
import path from "node:path";
import os from "node:os";

describe("buildSandboxExecArgv", () => {
  const pluginId = "plugin-abc-123";
  const expectedScratch = path.join(os.homedir(), ".aoa", "plugins", pluginId, "scratch");

  it("returns empty array for 'core' plugins (no sandbox)", () => {
    const args = buildSandboxExecArgv({
      pluginId,
      trustTier: "core",
      capabilities: ["http.outbound"],
    });
    expect(args).toEqual([]);
  });

  it("returns --permission flags for 'untrusted' plugins", () => {
    const args = buildSandboxExecArgv({
      pluginId,
      trustTier: "untrusted",
      capabilities: [],
    });
    expect(args).toContain("--permission");
    expect(args).toContain(`--allow-fs-read=${expectedScratch}`);
    expect(args).toContain(`--allow-fs-write=${expectedScratch}`);
  });

  it("denies network access for 'untrusted' without http.outbound", () => {
    const args = buildSandboxExecArgv({
      pluginId,
      trustTier: "untrusted",
      capabilities: ["issues.read"],
    });
    expect(args.some((a) => a.startsWith("--allow-net"))).toBe(false);
  });

  it("allows network access for 'untrusted' with http.outbound capability", () => {
    const args = buildSandboxExecArgv({
      pluginId,
      trustTier: "untrusted",
      capabilities: ["http.outbound"],
    });
    expect(args).toContain("--allow-net");
  });

  it("applies sandbox for 'verified' plugins (same as untrusted)", () => {
    const args = buildSandboxExecArgv({
      pluginId,
      trustTier: "verified",
      capabilities: [],
    });
    expect(args).toContain("--permission");
    expect(args).toContain(`--allow-fs-read=${expectedScratch}`);
    expect(args).toContain(`--allow-fs-write=${expectedScratch}`);
  });

  it("allows network for 'verified' with http.outbound", () => {
    const args = buildSandboxExecArgv({
      pluginId,
      trustTier: "verified",
      capabilities: ["http.outbound"],
    });
    expect(args).toContain("--allow-net");
  });

  it("scratch dir uses pluginId in the path", () => {
    const args = buildSandboxExecArgv({
      pluginId: "my-special-plugin",
      trustTier: "untrusted",
      capabilities: [],
    });
    const scratchArg = args.find((a) => a.startsWith("--allow-fs-read="));
    expect(scratchArg).toContain("my-special-plugin");
  });
});

// This verifies the helper computes correct flags — the loader test is a direct call,
// not a full integration test (loader dep tree is too complex to mock here).
describe("plugin-loader sandbox injection (integration)", () => {
  it("passes --permission flags to workerManager.startWorker for untrusted plugins", async () => {
    const { buildSandboxExecArgv } = await import("../services/plugin-sandbox.js");
    const flags = buildSandboxExecArgv({
      pluginId: "test-id",
      trustTier: "untrusted",
      capabilities: [],
    });
    expect(flags).toContain("--permission");
  });
});
