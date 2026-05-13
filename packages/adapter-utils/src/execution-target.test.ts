import { describe, expect, it, vi } from "vitest";
import {
  ensureAdapterExecutionTargetRuntimeCommandInstalled,
  resolveAdapterExecutionTarget,
  runLocalTargetProcess,
} from "./execution-target.js";
import type { RunProcessResult } from "./server-utils.js";

const okResult: RunProcessResult = {
  exitCode: 0,
  signal: null,
  timedOut: false,
  stdout: "",
  stderr: "",
};

describe("resolveAdapterExecutionTarget", () => {
  it("defaults missing config to local", () => {
    expect(resolveAdapterExecutionTarget(undefined)).toEqual({ type: "local" });
  });

  it("resolves explicit local config", () => {
    expect(resolveAdapterExecutionTarget({ type: "local", image: "ignored" })).toEqual({
      type: "local",
    });
  });

  it("requires a Docker image", () => {
    expect(() => resolveAdapterExecutionTarget({ type: "sandbox-docker" })).toThrow(
      'executionTarget.image is required for target "sandbox-docker"',
    );
  });

  it("keeps only string-valued Docker env entries", () => {
    expect(
      resolveAdapterExecutionTarget({
        type: "sandbox-docker",
        image: "node:22",
        env: { CI: "1", COUNT: 2, EMPTY: "", ENABLED: true },
      }),
    ).toMatchObject({
      type: "sandbox-docker",
      image: "node:22",
      env: { CI: "1", EMPTY: "" },
    });
  });

  it("throws for an unknown target type", () => {
    expect(() => resolveAdapterExecutionTarget({ type: "remote-ssh" })).toThrow(
      'Unsupported execution target "remote-ssh"',
    );
  });
});

describe("runLocalTargetProcess", () => {
  it("forwards child process options without target-only fields", async () => {
    const onLog = vi.fn();
    const onSpawn = vi.fn();
    const run = vi.fn().mockResolvedValue(okResult);

    await runLocalTargetProcess(
      {
        runId: "run_1",
        command: "node",
        args: ["script.js"],
        cwd: "/repo",
        env: { A: "1" },
        stdin: "prompt",
        authToken: "secret",
        apiBaseUrl: "http://localhost:3100",
        runtimeCommandSpec: { command: "node" },
        timeoutSec: 30,
        graceSec: 2,
        onLog,
        onSpawn,
      },
      run,
    );

    expect(run).toHaveBeenCalledWith("run_1", "node", ["script.js"], {
      cwd: "/repo",
      env: { A: "1" },
      stdin: "prompt",
      timeoutSec: 30,
      graceSec: 2,
      onLog,
      onSpawn,
    });
  });
});

describe("ensureAdapterExecutionTargetRuntimeCommandInstalled", () => {
  it("does nothing for local targets", async () => {
    const runShellCommand = vi.fn();
    await ensureAdapterExecutionTargetRuntimeCommandInstalled({
      target: { type: "local" },
      runtimeCommandSpec: { command: "node", installCommand: "npm install -g node" },
      runShellCommand,
    });
    expect(runShellCommand).not.toHaveBeenCalled();
  });

  it("runs Docker install commands", async () => {
    const runShellCommand = vi.fn().mockResolvedValue(okResult);
    await ensureAdapterExecutionTargetRuntimeCommandInstalled({
      target: { type: "sandbox-docker", image: "node:22" },
      runtimeCommandSpec: { command: "codex", installCommand: "npm install -g @openai/codex" },
      runShellCommand,
    });
    expect(runShellCommand).toHaveBeenCalledWith("npm install -g @openai/codex");
  });

  it("throws when Docker install fails", async () => {
    await expect(
      ensureAdapterExecutionTargetRuntimeCommandInstalled({
        target: { type: "sandbox-docker", image: "node:22" },
        runtimeCommandSpec: { command: "codex", installCommand: "npm install -g @openai/codex" },
        runShellCommand: async () => ({
          exitCode: 1,
          signal: null,
          timedOut: false,
          stdout: "",
          stderr: "nope",
        }),
      }),
    ).rejects.toThrow("Failed to install runtime command: nope");
  });
});
