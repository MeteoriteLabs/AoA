import { sanitizeRemoteExecutionEnv } from "./remote-execution-env.js";
import { preferredShellForSandbox } from "./sandbox-shell.js";
import {
  asBoolean,
  asString,
  parseObject,
  runChildProcess,
  shapeAoaWorkspaceEnvForExecution,
  type RunProcessResult,
} from "./server-utils.js";
import {
  startSandboxCallbackBridgeServer,
  type SandboxCallbackBridgeServer,
} from "./sandbox-callback-bridge.js";
import type {
  AdapterDockerExecutionTarget,
  AdapterExecutionTarget,
  AdapterRuntimeCommandSpec,
} from "./types.js";

export function resolveAdapterExecutionTarget(raw: unknown): AdapterExecutionTarget {
  const config = parseObject(raw);
  const type = asString(config.type, "local");
  if (type === "local") return { type: "local" };
  if (type !== "sandbox-docker") {
    throw new Error(`Unsupported execution target "${type}"`);
  }

  const image = asString(config.image, "").trim();
  if (!image) throw new Error('executionTarget.image is required for target "sandbox-docker"');

  const envRaw = parseObject(config.env);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(envRaw)) {
    if (typeof value === "string") env[key] = value;
  }

  const shell = asString(config.shell, "sh");
  const network = asString(config.network, "bridge");
  return {
    type: "sandbox-docker",
    image,
    workdir: asString(config.workdir, "/workspace"),
    shell: shell === "bash" ? "bash" : "sh",
    network: network === "host" || network === "none" ? network : "bridge",
    remove: asBoolean(config.remove, true),
    env,
    installCommand: asString(config.installCommand, "") || null,
  };
}

export interface AdapterTargetProcessOptions {
  runId: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  stdin?: string;
  authToken?: string | null;
  apiBaseUrl?: string | null;
  runtimeCommandSpec?: AdapterRuntimeCommandSpec | null;
  timeoutSec: number;
  graceSec: number;
  onLog: (stream: "stdout" | "stderr", chunk: string) => Promise<void>;
  onSpawn?: (pid: number | null, pgid: number | null, startedAt: Date) => void;
}

type ChildProcessRunner = typeof runChildProcess;
type SandboxCallbackBridgeStarter = typeof startSandboxCallbackBridgeServer;

interface AdapterExecutionTargetProcessDeps {
  run?: ChildProcessRunner;
  startBridge?: SandboxCallbackBridgeStarter;
}

export async function runLocalTargetProcess(
  opts: AdapterTargetProcessOptions,
  run: ChildProcessRunner = runChildProcess,
): Promise<RunProcessResult> {
  return run(opts.runId, opts.command, opts.args, {
    cwd: opts.cwd,
    env: opts.env,
    stdin: opts.stdin,
    timeoutSec: opts.timeoutSec,
    graceSec: opts.graceSec,
    onLog: opts.onLog,
    onSpawn: opts.onSpawn,
  });
}

export function formatDockerBindSource(localCwd: string): string {
  return localCwd.replaceAll("\\", "/");
}

export function buildDockerRunArgs(input: {
  target: AdapterDockerExecutionTarget;
  localCwd: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  stdin?: string;
}): string[] {
  const workdir = input.target.workdir ?? "/workspace";
  const dockerArgs = ["run"];
  if (input.target.remove !== false) dockerArgs.push("--rm");
  if (input.stdin != null) dockerArgs.push("--interactive");
  dockerArgs.push(
    "--workdir",
    workdir,
    "--mount",
    `type=bind,source=${formatDockerBindSource(input.localCwd)},target=${workdir}`,
    "--network",
    input.target.network ?? "bridge",
    "--add-host",
    "host.docker.internal:host-gateway",
  );

  for (const [key, value] of Object.entries(input.env)) {
    dockerArgs.push("--env", `${key}=${value}`);
  }

  dockerArgs.push(input.target.image, input.command, ...input.args);
  return dockerArgs;
}

export function prepareWorkspaceForExecutionTarget(
  target: AdapterExecutionTarget,
  cwd: string,
): { localCwd: string; executionCwd: string; restore: null } {
  if (target.type === "sandbox-docker") {
    return {
      localCwd: cwd,
      executionCwd: target.workdir ?? "/workspace",
      restore: null,
    };
  }
  return {
    localCwd: cwd,
    executionCwd: cwd,
    restore: null,
  };
}

function buildDockerCommandWithInstall(input: {
  target: AdapterDockerExecutionTarget;
  command: string;
  args: string[];
  runtimeCommandSpec?: AdapterRuntimeCommandSpec | null;
}): { command: string; args: string[] } {
  const installCommands = [
    input.target.installCommand,
    input.runtimeCommandSpec?.installCommand,
  ]
    .map((command) => command?.trim() ?? "")
    .filter(Boolean);

  if (installCommands.length === 0) {
    return { command: input.command, args: input.args };
  }

  const shell = preferredShellForSandbox(input.target.shell);
  const shellFlag = shell === "bash" ? "-lc" : "-c";
  const script = ["set -e", ...installCommands, 'exec "$@"'].join("\n");
  return {
    command: shell,
    args: [shellFlag, script, shell, input.command, ...input.args],
  };
}

export async function runAdapterExecutionTargetProcess(
  target: AdapterExecutionTarget,
  opts: AdapterTargetProcessOptions,
  deps: AdapterExecutionTargetProcessDeps = {},
): Promise<RunProcessResult> {
  const run = deps.run ?? runChildProcess;
  if (target.type === "local") {
    return runLocalTargetProcess(opts, run);
  }

  const workspace = prepareWorkspaceForExecutionTarget(target, opts.cwd);
  const commandSpec = buildDockerCommandWithInstall({
    target,
    command: opts.command,
    args: opts.args,
    runtimeCommandSpec: opts.runtimeCommandSpec,
  });
  let bridge: SandboxCallbackBridgeServer | null = null;

  try {
    let env = sanitizeRemoteExecutionEnv(
      shapeAoaWorkspaceEnvForExecution({
        env: { ...(target.env ?? {}), ...opts.env },
        targetType: "sandbox-docker",
        localCwd: workspace.localCwd,
        executionCwd: workspace.executionCwd,
      }),
    );

    if (opts.authToken && opts.apiBaseUrl) {
      const startBridge = deps.startBridge ?? startSandboxCallbackBridgeServer;
      bridge = await startBridge({
        apiBaseUrl: opts.apiBaseUrl,
        authToken: opts.authToken,
        runId: opts.runId,
        exposeToDocker: true,
      });
      env = {
        ...env,
        AOA_CALLBACK_BRIDGE_URL: bridge.containerUrl,
        AOA_API_URL: bridge.containerUrl,
        AOA_ORIGIN_API_URL: opts.apiBaseUrl,
      };
    }

    return await run(
      opts.runId,
      "docker",
      buildDockerRunArgs({
        target,
        localCwd: workspace.localCwd,
        command: commandSpec.command,
        args: commandSpec.args,
        env,
        stdin: opts.stdin,
      }),
      {
        cwd: workspace.localCwd,
        env: {},
        stdin: opts.stdin,
        timeoutSec: opts.timeoutSec,
        graceSec: opts.graceSec,
        onLog: opts.onLog,
        onSpawn: opts.onSpawn,
      },
    );
  } finally {
    if (bridge) await bridge.close();
  }
}

export async function isDockerAvailable(
  run: ChildProcessRunner = runChildProcess,
): Promise<boolean> {
  try {
    const result = await run("docker-availability-probe", "docker", ["info"], {
      cwd: process.cwd(),
      env: {},
      timeoutSec: 10,
      graceSec: 1,
      onLog: async () => {},
    });
    return !result.timedOut && result.exitCode === 0;
  } catch {
    return false;
  }
}

export async function ensureAdapterExecutionTargetRuntimeCommandInstalled(input: {
  target: AdapterExecutionTarget;
  runtimeCommandSpec: AdapterRuntimeCommandSpec | null | undefined;
  runShellCommand: (command: string) => Promise<RunProcessResult>;
}): Promise<void> {
  if (input.target.type !== "sandbox-docker") return;
  const installCommands = [
    input.target.installCommand,
    input.runtimeCommandSpec?.installCommand,
  ]
    .map((command) => command?.trim() ?? "")
    .filter(Boolean);

  for (const installCommand of installCommands) {
    const result = await input.runShellCommand(installCommand);
    if (result.timedOut || (result.exitCode ?? 0) !== 0) {
      throw new Error(
        `Failed to install runtime command: ${result.stderr || result.stdout || "unknown error"}`,
      );
    }
  }
}
