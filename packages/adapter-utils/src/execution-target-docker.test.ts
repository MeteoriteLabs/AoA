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
  it("legacy profile is unchanged and OMITS --add-host when the bridge is inactive", () => {
    expect(
      buildDockerRunArgs({
        target: { type: "sandbox-docker", image: "node:22", workdir: "/work", network: "none", env: {} },
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

  it("emits --add-host ONLY when the bridge is active AND the target opts in", () => {
    const withGateway = buildDockerRunArgs(
      {
        target: { type: "sandbox-docker", image: "node:22", network: "bridge", allowHostGateway: true, env: {} },
        localCwd: "/repo",
        command: "node",
        args: [],
        env: {},
      },
      { hostGatewayActive: true },
    );
    expect(withGateway).toContain("--add-host");
    expect(withGateway).toContain("host.docker.internal:host-gateway");

    const noOptIn = buildDockerRunArgs(
      {
        target: { type: "sandbox-docker", image: "node:22", network: "bridge", allowHostGateway: false, env: {} },
        localCwd: "/repo",
        command: "node",
        args: [],
        env: {},
      },
      { hostGatewayActive: true },
    );
    expect(noOptIn).not.toContain("--add-host");
  });

  it("emits the full hardened flag set incl. --runtime=runsc when isolation is set", () => {
    const args = buildDockerRunArgs({
      target: {
        type: "sandbox-docker",
        image: "aoa/agent-base:latest",
        workdir: "/workspace",
        network: "none",
        runtime: "runsc",
        env: {},
        isolation: {
          user: "1000:1000",
          capDropAll: true,
          noNewPrivileges: true,
          seccompProfile: "/etc/aoa/seccomp.json",
          readOnlyRootfs: true,
          tmpfs: ["/tmp:rw,noexec,nosuid,size=64m", "/home/agent:rw,nosuid,size=256m"],
          memory: "2g",
          cpus: "2",
          pidsLimit: 512,
          ulimitNofile: 1024,
          ipcPrivate: true,
        },
      },
      localCwd: "/repo",
      command: "claude",
      args: ["-p", "hi"],
      env: {},
    });
    const joined = args.join(" ");
    expect(joined).toContain("--runtime runsc");
    expect(joined).toContain("--user 1000:1000");
    expect(joined).toContain("--cap-drop ALL");
    expect(joined).toContain("--security-opt no-new-privileges");
    expect(joined).toContain("--security-opt seccomp=/etc/aoa/seccomp.json");
    expect(joined).toContain("--read-only");
    expect(joined).toContain("--tmpfs /tmp:rw,noexec,nosuid,size=64m");
    expect(joined).toContain("--tmpfs /home/agent:rw,nosuid,size=256m");
    expect(joined).toContain("--memory 2g");
    expect(joined).toContain("--memory-swap 2g");
    expect(joined).toContain("--cpus 2");
    expect(joined).toContain("--pids-limit 512");
    expect(joined).toContain("--ulimit nofile=1024:1024");
    expect(joined).toContain("--ipc private");
    expect(joined).toContain("--network none");
    // image + command always last, in order (image, command, then its args)
    expect(args.slice(-4)).toEqual(["aoa/agent-base:latest", "claude", "-p", "hi"]);
    expect(args[args.length - 1]).toBe("hi");
  });
});

describe("runAdapterExecutionTargetProcess sandbox-docker", () => {
  it("runs docker with target env below runtime env and Docker-shaped workspace env", async () => {
    // U5: the merge-order + workspace-cwd-rewrite probes below use ALLOWLISTED
    // key names (AOA_EXECUTION_TARGET_ID / AOA_RUNTIME_HOOK_TOKEN /
    // AOA_WORKSPACE_CWD / AOA_WORKSPACES_JSON) — buildSandboxEnvAllowlist now
    // runs ahead of shapeAoaWorkspaceEnvForExecution in this chokepoint, so an
    // arbitrary non-allowlisted key (the old "SHARED"/"TARGET_ONLY" synthetic
    // names) would be dropped before the merge/rewrite logic under test ever
    // sees it.
    const run = vi.fn().mockResolvedValue(okResult);
    const result = await runAdapterExecutionTargetProcess(
      {
        type: "sandbox-docker",
        image: "node:22",
        env: { AOA_EXECUTION_TARGET_ID: "target", AOA_RUNTIME_HOOK_TOKEN: "yes" },
      },
      baseOpts({
        cwd: "/host/repo",
        env: {
          AOA_EXECUTION_TARGET_ID: "runtime",
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
        "AOA_EXECUTION_TARGET_ID=runtime",
        "--env",
        "AOA_RUNTIME_HOOK_TOKEN=yes",
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
    // No bridge started here → host-gateway must not be injected by default.
    expect(run.mock.calls[0]![2] as string[]).not.toContain("--add-host");
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
        { type: "sandbox-docker", image: "node:22", allowHostGateway: true },
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
