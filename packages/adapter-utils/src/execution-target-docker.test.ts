import { describe, expect, it, vi } from "vitest";
import {
  buildDockerRunArgs,
  formatDockerBindSource,
  isDockerAvailable,
  runAdapterExecutionTargetProcess,
} from "./execution-target.js";
import type { RunProcessResult } from "./server-utils.js";

const okResult: RunProcessResult = {
  exitCode: 0,
  signal: null,
  timedOut: false,
  stdout: "",
  stderr: "",
};

function baseOpts(overrides: Partial<Parameters<typeof runAdapterExecutionTargetProcess>[1]> = {}) {
  return {
    runId: "run_1",
    command: "codex",
    args: ["--model", "gpt-5"],
    cwd: "C:\\repo",
    env: { AOA_RUN_ID: "run_1" },
    timeoutSec: 30,
    graceSec: 3,
    onLog: vi.fn(),
    ...overrides,
  };
}

describe("formatDockerBindSource", () => {
  it("keeps POSIX paths unchanged", () => {
    expect(formatDockerBindSource("/home/tk/repo")).toBe("/home/tk/repo");
  });

  it("normalizes Windows drive paths for Docker --mount", () => {
    expect(formatDockerBindSource("C:\\repo")).toBe("C:/repo");
  });

  it("preserves spaces while normalizing repo-shaped Windows paths", () => {
    expect(formatDockerBindSource("C:\\Users\\TK\\Claude Data\\Paperclip-AoA")).toBe(
      "C:/Users/TK/Claude Data/Paperclip-AoA",
    );
  });
});

describe("buildDockerRunArgs", () => {
  it("builds docker run args with bind mount, env, image, command, and args", () => {
    expect(
      buildDockerRunArgs({
        target: {
          type: "sandbox-docker",
          image: "node:22",
          workdir: "/work",
          network: "none",
          env: {},
        },
        localCwd: "C:\\repo",
        command: "node",
        args: ["script.js"],
        env: { A: "1", B: "two words" },
      }),
    ).toEqual([
      "run",
      "--rm",
      "--workdir",
      "/work",
      "--mount",
      "type=bind,source=C:/repo,target=/work",
      "--network",
      "none",
      "--add-host",
      "host.docker.internal:host-gateway",
      "--env",
      "A=1",
      "--env",
      "B=two words",
      "node:22",
      "node",
      "script.js",
    ]);
  });

  it("omits --rm when target.remove is false", () => {
    const args = buildDockerRunArgs({
      target: { type: "sandbox-docker", image: "node:22", remove: false },
      localCwd: "/repo",
      command: "node",
      args: [],
      env: {},
    });

    expect(args).not.toContain("--rm");
  });
});

describe("runAdapterExecutionTargetProcess sandbox-docker", () => {
  it("runs docker with target env below runtime env and Docker-shaped workspace env", async () => {
    const run = vi.fn().mockResolvedValue(okResult);
    const result = await runAdapterExecutionTargetProcess(
      {
        type: "sandbox-docker",
        image: "node:22",
        env: { SHARED: "target", TARGET_ONLY: "yes" },
      },
      baseOpts({
        cwd: "/host/repo",
        env: {
          SHARED: "runtime",
          AOA_WORKSPACE_CWD: "/host/repo",
          AOA_WORKSPACES_JSON: JSON.stringify([
            { id: "current", cwd: "/host/repo" },
            { id: "other", cwd: "/elsewhere" },
          ]),
        },
      }),
      { run },
    );

    expect(result).toBe(okResult);
    expect(run).toHaveBeenCalledWith(
      "run_1",
      "docker",
      expect.arrayContaining([
        "--env",
        "SHARED=runtime",
        "--env",
        "TARGET_ONLY=yes",
        "--env",
        "AOA_WORKSPACE_CWD=/workspace",
        "--env",
        `AOA_WORKSPACES_JSON=${JSON.stringify([{ id: "current", cwd: "/workspace" }, { id: "other" }])}`,
      ]),
      expect.objectContaining({
        cwd: "/host/repo",
        timeoutSec: 30,
        graceSec: 3,
      }),
    );
  });

  it("strips matching host identity env before Docker spawn", async () => {
    const pathValue = process.env.PATH;
    if (!pathValue) return;
    const run = vi.fn().mockResolvedValue(okResult);

    await runAdapterExecutionTargetProcess(
      { type: "sandbox-docker", image: "node:22" },
      baseOpts({ env: { PATH: pathValue, AOA_RUN_ID: "run_1" } }),
      { run },
    );

    const dockerArgs = run.mock.calls[0]![2] as string[];
    expect(dockerArgs).not.toContain(`PATH=${pathValue}`);
    expect(dockerArgs).toContain("AOA_RUN_ID=run_1");
  });

  it("injects a Docker-facing callback bridge URL and closes the bridge after spawn errors", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const run = vi.fn().mockRejectedValue(new Error("spawn failed"));

    await expect(
      runAdapterExecutionTargetProcess(
        { type: "sandbox-docker", image: "node:22" },
        baseOpts({
          authToken: "server-token",
          apiBaseUrl: "http://127.0.0.1:3100",
        }),
        {
          run,
          startBridge: vi.fn().mockResolvedValue({
            listenUrl: "http://0.0.0.0:12345",
            containerUrl: "http://host.docker.internal:12345",
            close,
          }),
        },
      ),
    ).rejects.toThrow("spawn failed");

    const dockerArgs = run.mock.calls[0]![2] as string[];
    expect(dockerArgs).toContain("AOA_CALLBACK_BRIDGE_URL=http://host.docker.internal:12345");
    expect(dockerArgs).toContain("AOA_API_URL=http://host.docker.internal:12345");
    expect(dockerArgs).toContain("AOA_ORIGIN_API_URL=http://127.0.0.1:3100");
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("isDockerAvailable", () => {
  it("returns true when docker info exits successfully", async () => {
    await expect(isDockerAvailable(vi.fn().mockResolvedValue(okResult))).resolves.toBe(true);
  });

  it("returns false when docker cannot be started", async () => {
    await expect(isDockerAvailable(vi.fn().mockRejectedValue(new Error("missing")))).resolves.toBe(
      false,
    );
  });
});
