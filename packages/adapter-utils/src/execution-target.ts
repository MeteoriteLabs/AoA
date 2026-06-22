import fs from "node:fs";
import path from "node:path";
import { sanitizeRemoteExecutionEnv } from "./remote-execution-env.js";
import { preferredShellForSandbox } from "./sandbox-shell.js";
import {
  asBoolean,
  asString,
  ensureAbsoluteDirectory,
  ensureCommandResolvable,
  parseObject,
  runChildProcess,
  shapeAoaWorkspaceEnvForExecution,
  type RunProcessResult,
} from "./server-utils.js";
import {
  startSandboxCallbackBridgeServer,
  type SandboxCallbackBridgeServer,
} from "./sandbox-callback-bridge.js";
import { shellQuote } from "./sandbox-install.js";
import type {
  AdapterEnvironmentCheck,
  AdapterDockerExecutionTarget,
  AdapterExecutionTarget,
  AdapterProviderSandboxExecutionTarget,
  AdapterRuntimeCommandSpec,
} from "./types.js";

export function resolveAdapterExecutionTarget(raw: unknown): AdapterExecutionTarget {
  const config = parseObject(raw);
  const type = asString(config.type, "local");
  if (type === "local") return { type: "local" };
  if (type === "provider-sandbox") {
    const provider = asString(config.provider, "").trim();
    if (!provider) throw new Error('executionTarget.provider is required for target "provider-sandbox"');
    const providerLeaseId = asString(config.providerLeaseId, "").trim();
    if (!providerLeaseId) throw new Error('executionTarget.providerLeaseId is required for target "provider-sandbox"');
    const remoteCwd = asString(config.remoteCwd, "").trim();
    if (!remoteCwd) throw new Error('executionTarget.remoteCwd is required for target "provider-sandbox"');
    const runner = parseObject(config.runner);
    if (typeof runner.execute !== "function") {
      throw new Error('executionTarget.runner is required for target "provider-sandbox"');
    }
    const envRaw = parseObject(config.env);
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(envRaw)) {
      if (typeof value === "string") env[key] = value;
    }
    const shell = asString(config.shell, "sh");
    return {
      type: "provider-sandbox",
      provider,
      providerLeaseId,
      remoteCwd,
      shell: shell === "bash" ? "bash" : "sh",
      env,
      runner: runner as unknown as AdapterProviderSandboxExecutionTarget["runner"],
    };
  }
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

interface AdapterExecutionTargetShellDeps {
  run?: ChildProcessRunner;
  startBridge?: SandboxCallbackBridgeStarter;
}

export interface AdapterExecutionTargetShellOptions {
  cwd: string;
  env: Record<string, string>;
  timeoutSec?: number | null;
  graceSec?: number | null;
  onLog?: (stream: "stdout" | "stderr", chunk: string) => Promise<void>;
  onSpawn?: (pid: number | null, pgid: number | null, startedAt: Date) => void;
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
  if (target.type === "provider-sandbox") {
    return {
      localCwd: cwd,
      executionCwd: target.remoteCwd,
      restore: null,
    };
  }
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

export function describeAdapterExecutionTarget(target: AdapterExecutionTarget | null | undefined): string {
  if (!target || target.type === "local") return "local";
  if (target.type === "provider-sandbox") return `provider-sandbox ${target.provider} at ${target.remoteCwd}`;
  return `sandbox-docker ${target.image} at ${target.workdir ?? "/workspace"}`;
}

export function resolveAdapterExecutionTargetCwd(
  target: AdapterExecutionTarget | null | undefined,
  configuredCwd: string,
  fallbackCwd: string,
): string {
  if (target?.type === "provider-sandbox") return configuredCwd.trim() || target.remoteCwd;
  return configuredCwd.trim() || fallbackCwd;
}

export function resolveAdapterExecutionTargetTimeoutSec(
  _target: AdapterExecutionTarget | null | undefined,
  timeoutSec: number,
): number {
  return timeoutSec;
}

export function readAdapterExecutionTarget(input: {
  executionTarget?: AdapterExecutionTarget | null;
  legacyRemoteExecution?: unknown;
}): AdapterExecutionTarget {
  if (input.executionTarget) return input.executionTarget;
  return resolveAdapterExecutionTarget(input.legacyRemoteExecution);
}

export function adapterExecutionTargetIsRemote(
  target: AdapterExecutionTarget | null | undefined,
): boolean {
  return target?.type === "sandbox-docker" || target?.type === "provider-sandbox";
}

export function adapterExecutionTargetRemoteCwd(
  target: AdapterExecutionTarget | null | undefined,
  cwd: string,
): string {
  if (target?.type === "provider-sandbox") return target.remoteCwd;
  return target?.type === "sandbox-docker" ? target.workdir ?? "/workspace" : cwd;
}

export function overrideAdapterExecutionTargetRemoteCwd(
  target: AdapterExecutionTarget | null | undefined,
  cwd: string,
): AdapterExecutionTarget {
  if (!target || target.type === "local") return { type: "local" };
  if (target.type === "provider-sandbox") return { ...target, remoteCwd: cwd };
  return { ...target, workdir: cwd };
}

export function adapterExecutionTargetSessionIdentity(
  target: AdapterExecutionTarget | null | undefined,
): Record<string, unknown> | null {
  if (!target || target.type === "local") return null;
  if (target.type === "provider-sandbox") {
    return {
      type: "provider-sandbox",
      provider: target.provider,
      providerLeaseId: target.providerLeaseId,
      remoteCwd: target.remoteCwd,
    };
  }
  return {
    type: "sandbox-docker",
    image: target.image,
    workdir: target.workdir ?? "/workspace",
  };
}

export function adapterExecutionTargetSessionMatches(
  raw: unknown,
  target: AdapterExecutionTarget | null | undefined,
): boolean {
  const expected = adapterExecutionTargetSessionIdentity(target);
  if (!expected) return true;
  const actual = parseObject(raw);
  return JSON.stringify(actual) === JSON.stringify(expected);
}

export async function prepareAdapterExecutionTargetRuntime(input: {
  target: AdapterExecutionTarget | null | undefined;
  workspaceLocalDir: string;
  adapterKey: string;
  runId?: string;
  timeoutSec?: number;
  installCommand?: string | null;
  detectCommand?: string | null;
}): Promise<{
  workspaceRemoteDir: string | null;
  runtimeRootDir: string | null;
  restoreWorkspace: () => Promise<void>;
}> {
  if (!input.target || input.target.type === "local") {
    return {
      workspaceRemoteDir: input.workspaceLocalDir,
      runtimeRootDir: null,
      restoreWorkspace: async () => {},
    };
  }
  const workspaceRemoteDir = input.target.type === "provider-sandbox"
    ? input.target.remoteCwd
    : input.target.workdir ?? "/workspace";
  return {
    workspaceRemoteDir,
    runtimeRootDir: `${workspaceRemoteDir}/.aoa-runtime/${input.adapterKey}`,
    restoreWorkspace: async () => {},
  };
}

async function walkDirectoryForSync(input: {
  root: string;
  relativeDir?: string;
  followSymlinks?: boolean;
}): Promise<Array<{ localPath: string; relativePath: string }>> {
  const relativeDir = input.relativeDir ?? "";
  const absoluteDir = path.join(input.root, relativeDir);
  const entries = await fs.promises.readdir(absoluteDir, { withFileTypes: true });
  const files: Array<{ localPath: string; relativePath: string }> = [];

  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    const localPath = path.join(input.root, relativePath);
    if (entry.isSymbolicLink() && input.followSymlinks) {
      const stat = await fs.promises.stat(localPath);
      if (stat.isDirectory()) {
        files.push(...await walkDirectoryForSync({
          root: input.root,
          relativeDir: relativePath,
          followSymlinks: input.followSymlinks,
        }));
        continue;
      }
      if (stat.isFile()) {
        files.push({ localPath, relativePath });
      }
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...await walkDirectoryForSync({
        root: input.root,
        relativeDir: relativePath,
        followSymlinks: input.followSymlinks,
      }));
      continue;
    }
    if (entry.isFile()) {
      files.push({ localPath, relativePath });
    }
  }

  return files;
}

export async function syncAdapterExecutionTargetDirectory(input: {
  runId: string;
  target: AdapterExecutionTarget | null | undefined;
  localDir: string;
  remoteDir: string;
  cwd: string;
  env?: Record<string, string>;
  timeoutSec?: number | null;
  graceSec?: number | null;
  followSymlinks?: boolean;
  onLog?: (stream: "stdout" | "stderr", chunk: string) => Promise<void>;
}): Promise<void> {
  if (!input.target || input.target.type === "local") {
    if (path.resolve(input.localDir) === path.resolve(input.remoteDir)) return;
    await fs.promises.cp(input.localDir, input.remoteDir, {
      recursive: true,
      force: true,
      dereference: input.followSymlinks ?? false,
    });
    return;
  }

  if (!input.remoteDir.startsWith("/")) {
    throw new Error(`Remote directory must be an absolute POSIX path on ${describeAdapterExecutionTarget(input.target)}: "${input.remoteDir}"`);
  }

  await ensureAdapterExecutionTargetDirectory(
    `${input.runId}-sync-root`,
    input.target,
    input.remoteDir,
    {
      cwd: input.cwd,
      env: input.env ?? {},
      createIfMissing: true,
      timeoutSec: input.timeoutSec ?? 30,
      graceSec: input.graceSec ?? 5,
      onLog: input.onLog,
    },
  );

  const files = await walkDirectoryForSync({
    root: input.localDir,
    followSymlinks: input.followSymlinks ?? false,
  });

  for (const [index, file] of files.entries()) {
    const remotePath = path.posix.join(
      input.remoteDir,
      ...file.relativePath.split(path.sep).filter(Boolean),
    );
    await syncAdapterExecutionTargetFile({
      runId: `${input.runId}-sync-file-${index}`,
      target: input.target,
      localPath: file.localPath,
      remotePath,
      cwd: input.cwd,
      env: input.env,
      timeoutSec: input.timeoutSec,
      graceSec: input.graceSec,
      onLog: input.onLog,
    });
  }
}

export async function syncAdapterExecutionTargetFile(input: {
  runId: string;
  target: AdapterExecutionTarget | null | undefined;
  localPath: string;
  remotePath: string;
  cwd: string;
  env?: Record<string, string>;
  timeoutSec?: number | null;
  graceSec?: number | null;
  onLog?: (stream: "stdout" | "stderr", chunk: string) => Promise<void>;
}): Promise<void> {
  if (!input.target || input.target.type === "local") {
    if (path.resolve(input.localPath) === path.resolve(input.remotePath)) return;
    await fs.promises.mkdir(path.dirname(input.remotePath), { recursive: true });
    await fs.promises.copyFile(input.localPath, input.remotePath);
    return;
  }

  if (!input.remotePath.startsWith("/")) {
    throw new Error(`Remote file must be an absolute POSIX path on ${describeAdapterExecutionTarget(input.target)}: "${input.remotePath}"`);
  }

  const content = await fs.promises.readFile(input.localPath);
  const shell = preferredShellForSandbox(input.target.shell);
  const result = await runAdapterExecutionTargetProcess(input.target, {
    runId: input.runId,
    command: shell,
    args: [
      shell === "bash" ? "-lc" : "-c",
      `mkdir -p "$(dirname ${shellQuote(input.remotePath)})" && base64 -d > ${shellQuote(input.remotePath)}`,
    ],
    cwd: input.cwd,
    env: input.env ?? {},
    stdin: content.toString("base64"),
    timeoutSec: input.timeoutSec ?? 30,
    graceSec: input.graceSec ?? 5,
    onLog: input.onLog ?? (async () => {}),
  });
  if (result.timedOut || (result.exitCode ?? 1) !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(
      `Failed to sync ${input.localPath} to ${describeAdapterExecutionTarget(input.target)}${detail ? `: ${detail}` : ""}`,
    );
  }
}

export async function resolveAdapterExecutionTargetCommandForLogs(
  command: string,
  target: AdapterExecutionTarget | null | undefined,
  _cwd: string,
  _env: NodeJS.ProcessEnv,
): Promise<string> {
  if (!target || target.type === "local") return command;
  if (target.type === "provider-sandbox") {
    return `provider-sandbox://${target.provider}${target.remoteCwd} :: ${command}`;
  }
  return `sandbox-docker://${target.image}${target.workdir ?? "/workspace"} :: ${command}`;
}

function buildSandboxCommandWithInstall(input: {
  shell?: "sh" | "bash" | null;
  targetInstallCommand?: string | null;
  command: string;
  args: string[];
  runtimeCommandSpec?: AdapterRuntimeCommandSpec | null;
}): { command: string; args: string[] } {
  const installCommands = [
    input.targetInstallCommand,
    input.runtimeCommandSpec?.installCommand,
  ]
    .map((command) => command?.trim() ?? "")
    .filter(Boolean);

  if (installCommands.length === 0) {
    return { command: input.command, args: input.args };
  }

  const shell = preferredShellForSandbox(input.shell);
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

  if (target.type === "provider-sandbox") {
    const workspace = prepareWorkspaceForExecutionTarget(target, opts.cwd);
    const commandSpec = buildSandboxCommandWithInstall({
      shell: target.shell,
      command: opts.command,
      args: opts.args,
      runtimeCommandSpec: opts.runtimeCommandSpec,
    });
    const env = sanitizeRemoteExecutionEnv(
      shapeAoaWorkspaceEnvForExecution({
        env: { ...(target.env ?? {}), ...opts.env },
        targetType: "sandbox-docker",
        localCwd: workspace.localCwd,
        executionCwd: workspace.executionCwd,
      }),
    );
    return target.runner.execute({
      runId: opts.runId,
      provider: target.provider,
      providerLeaseId: target.providerLeaseId,
      command: commandSpec.command,
      args: commandSpec.args,
      cwd: workspace.executionCwd,
      env,
      stdin: opts.stdin,
      timeoutSec: opts.timeoutSec,
      graceSec: opts.graceSec,
      onLog: opts.onLog,
      onSpawn: opts.onSpawn,
    });
  }

  const workspace = prepareWorkspaceForExecutionTarget(target, opts.cwd);
  const commandSpec = buildSandboxCommandWithInstall({
    shell: target.shell,
    targetInstallCommand: target.installCommand,
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
        shell: false,
      },
    );
  } finally {
    if (bridge) await bridge.close();
  }
}

export async function runAdapterExecutionTargetShellCommand(
  runId: string,
  target: AdapterExecutionTarget | null | undefined,
  command: string,
  options: AdapterExecutionTargetShellOptions,
  deps: AdapterExecutionTargetShellDeps = {},
): Promise<RunProcessResult> {
  const shell = target?.type === "sandbox-docker" || target?.type === "provider-sandbox"
    ? preferredShellForSandbox(target.shell)
    : "sh";
  const shellFlag = shell === "bash" ? "-lc" : "-c";
  return runAdapterExecutionTargetProcess(
    target ?? { type: "local" },
    {
      runId,
      command: shell,
      args: [shellFlag, command],
      cwd: options.cwd,
      env: options.env,
      timeoutSec: options.timeoutSec ?? 15,
      graceSec: options.graceSec ?? 5,
      onLog: options.onLog ?? (async () => {}),
      onSpawn: options.onSpawn,
    },
    deps,
  );
}

export async function ensureAdapterExecutionTargetCommandResolvable(
  command: string,
  target: AdapterExecutionTarget | null | undefined,
  cwd: string,
  env: NodeJS.ProcessEnv,
  options: {
    installCommand?: string | null;
    timeoutSec?: number | null;
    graceSec?: number | null;
    run?: ChildProcessRunner;
    startBridge?: SandboxCallbackBridgeStarter;
  } = {},
): Promise<void> {
  if (!target || target.type === "local") {
    await ensureCommandResolvable(command, cwd, env);
    return;
  }

  const runProbe = () =>
    runAdapterExecutionTargetShellCommand(
      `command-probe-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      target,
      `command -v ${shellQuote(command)}`,
      {
        cwd,
        env: Object.fromEntries(
          Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
        ),
        timeoutSec: options.timeoutSec ?? 15,
        graceSec: options.graceSec ?? 5,
      },
      { run: options.run, startBridge: options.startBridge },
    );

  let probe = await runProbe();
  if (!probe.timedOut && probe.exitCode === 0) return;

  const installCommand = options.installCommand?.trim();
  if (installCommand) {
    const install = await runAdapterExecutionTargetShellCommand(
      `command-install-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      target,
      installCommand,
      {
        cwd,
        env: Object.fromEntries(
          Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
        ),
        timeoutSec: options.timeoutSec ?? 240,
        graceSec: options.graceSec ?? 10,
      },
      { run: options.run, startBridge: options.startBridge },
    );
    if (install.timedOut) {
      throw new Error(`Timed out installing command "${command}" on ${describeAdapterExecutionTarget(target)}.`);
    }
    probe = await runProbe();
    if (!probe.timedOut && probe.exitCode === 0) return;
  }

  if (probe.timedOut) {
    throw new Error(`Timed out checking command "${command}" on ${describeAdapterExecutionTarget(target)}.`);
  }
  const detail = (probe.stderr || probe.stdout || "").trim();
  throw new Error(
    `Command "${command}" is not installed or not on PATH on ${describeAdapterExecutionTarget(target)}${detail ? `: ${detail}` : "."}`,
  );
}

export async function ensureAdapterExecutionTargetDirectory(
  runId: string,
  target: AdapterExecutionTarget | null | undefined,
  cwd: string,
  options: AdapterExecutionTargetShellOptions & {
    createIfMissing?: boolean;
    run?: ChildProcessRunner;
    startBridge?: SandboxCallbackBridgeStarter;
  },
): Promise<void> {
  const createIfMissing = options.createIfMissing ?? false;
  if (!target || target.type === "local") {
    await ensureAbsoluteDirectory(cwd, { createIfMissing });
    return;
  }

  if (!cwd.startsWith("/")) {
    throw new Error(`Working directory must be an absolute POSIX path on ${describeAdapterExecutionTarget(target)}: "${cwd}"`);
  }

  const quoted = shellQuote(cwd);
  const script = createIfMissing
    ? `mkdir -p ${quoted} && [ -d ${quoted} ]`
    : `[ -d ${quoted} ]`;
  const result = await runAdapterExecutionTargetShellCommand(
    runId,
    target,
    script,
    options,
    { run: options.run, startBridge: options.startBridge },
  );

  if (result.timedOut) {
    throw new Error(`Timed out checking working directory on ${describeAdapterExecutionTarget(target)}: "${cwd}"`);
  }
  if ((result.exitCode ?? 1) !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(
      `Working directory is not available on ${describeAdapterExecutionTarget(target)}: "${cwd}"${detail ? `: ${detail}` : ""}`,
    );
  }
}

export async function ensureAdapterExecutionTargetFile(
  runId: string,
  target: AdapterExecutionTarget | null | undefined,
  filePath: string,
  options: AdapterExecutionTargetShellOptions,
): Promise<void> {
  if (!target || target.type === "local") {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, "", { flag: "a" });
    return;
  }

  const quoted = shellQuote(filePath);
  const result = await runAdapterExecutionTargetShellCommand(
    runId,
    target,
    `mkdir -p "$(dirname ${quoted})" && touch ${quoted}`,
    options,
  );
  if (result.timedOut || (result.exitCode ?? 1) !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(`Failed to create file on ${describeAdapterExecutionTarget(target)}: ${filePath}${detail ? `: ${detail}` : ""}`);
  }
}

export async function maybeRunSandboxInstallCommand(input: {
  runId: string;
  target: AdapterExecutionTarget | null | undefined;
  adapterKey: string;
  installCommand?: string | null;
  detectCommand?: string | null;
  cwd?: string;
  env?: Record<string, string>;
}): Promise<AdapterEnvironmentCheck | null> {
  if (!input.target || input.target.type !== "sandbox-docker") return null;
  const installCommand = input.installCommand?.trim();
  if (!installCommand) return null;
  const result = await runAdapterExecutionTargetShellCommand(
    input.runId,
    input.target,
    installCommand,
    {
      cwd: input.cwd ?? input.target.workdir ?? "/workspace",
      env: input.env ?? {},
      timeoutSec: 240,
      graceSec: 10,
    },
  );
  if (result.timedOut || (result.exitCode ?? 0) !== 0) {
    return {
      code: `${input.adapterKey}_sandbox_install_failed`,
      level: "warn",
      message: `Sandbox install command failed for ${input.adapterKey}.`,
      detail: result.stderr || result.stdout || null,
    };
  }
  return {
    code: `${input.adapterKey}_sandbox_install_completed`,
    level: "info",
    message: `Sandbox install command completed for ${input.adapterKey}.`,
  };
}

export function adapterExecutionTargetUsesManagedHome(
  target: AdapterExecutionTarget | null | undefined,
): boolean {
  return target?.type === "sandbox-docker" || target?.type === "provider-sandbox";
}

export function adapterExecutionTargetUsesPaperclipBridge(
  _target: AdapterExecutionTarget | null | undefined,
): boolean {
  return false;
}

export async function startAdapterExecutionTargetPaperclipBridge(): Promise<null> {
  return null;
}

export async function isDockerAvailable(
  run: ChildProcessRunner = runChildProcess,
): Promise<boolean> {
  try {
    const result = await run(
      "docker-probe",
      "docker",
      ["version", "--format", "{{.Server.Version}}"],
      {
        cwd: process.cwd(),
        env: {},
        timeoutSec: 10,
        graceSec: 2,
        onLog: async () => {},
      },
    );
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
