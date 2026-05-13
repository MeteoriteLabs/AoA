import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunProcessResult } from "@armyofagents/adapter-utils/server-utils";

const mocks = vi.hoisted(() => ({
  runAdapterExecutionTargetProcess: vi.fn(),
}));

vi.mock("@armyofagents/adapter-utils", async (importActual) => {
  const actual = await importActual<typeof import("@armyofagents/adapter-utils")>();
  return {
    ...actual,
    runAdapterExecutionTargetProcess: mocks.runAdapterExecutionTargetProcess,
  };
});

const okResult: RunProcessResult = {
  exitCode: 0,
  signal: null,
  timedOut: false,
  stdout: "ok\n",
  stderr: "",
};

describe("process adapter execution target bridge context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AOA_API_URL;
    mocks.runAdapterExecutionTargetProcess.mockResolvedValue(okResult);
  });

  it("passes computed AOA_API_URL when process env does not define one", async () => {
    const { execute } = await import("../adapters/process/execute.js");

    await execute({
      runId: "run-process-bridge",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Process Runner",
        adapterType: "process",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {
        command: "node",
        cwd: process.cwd(),
        env: {},
      },
      context: {},
      executionTarget: { type: "sandbox-docker", image: "node:22-bookworm" },
      runtimeCommandSpec: null,
      authToken: "ctx-token",
      onLog: async () => {},
    });

    expect(mocks.runAdapterExecutionTargetProcess).toHaveBeenCalledWith(
      expect.objectContaining({ type: "sandbox-docker" }),
      expect.objectContaining({
        apiBaseUrl: "http://localhost:3100",
        authToken: "ctx-token",
      }),
    );
  });

  it("passes explicit AOA_API_KEY as bridge auth token", async () => {
    const { execute } = await import("../adapters/process/execute.js");

    await execute({
      runId: "run-process-explicit-key",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Process Runner",
        adapterType: "process",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {
        command: "node",
        cwd: process.cwd(),
        env: { AOA_API_KEY: "configured-token" },
      },
      context: {},
      executionTarget: { type: "sandbox-docker", image: "node:22-bookworm" },
      runtimeCommandSpec: null,
      authToken: "ctx-token",
      onLog: async () => {},
    });

    expect(mocks.runAdapterExecutionTargetProcess).toHaveBeenCalledWith(
      expect.objectContaining({ type: "sandbox-docker" }),
      expect.objectContaining({
        authToken: "configured-token",
      }),
    );
  });
});
