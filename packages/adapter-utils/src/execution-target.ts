import { asBoolean, asString, parseObject, runChildProcess, type RunProcessResult } from "./server-utils.js";
import type {
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

export async function runAdapterExecutionTargetProcess(
  target: AdapterExecutionTarget,
  opts: AdapterTargetProcessOptions,
): Promise<RunProcessResult> {
  if (target.type === "local") {
    return runLocalTargetProcess(opts);
  }
  throw new Error(`Execution target "${target.type}" is not implemented in this session`);
}

export async function ensureAdapterExecutionTargetRuntimeCommandInstalled(input: {
  target: AdapterExecutionTarget;
  runtimeCommandSpec: AdapterRuntimeCommandSpec | null | undefined;
  runShellCommand: (command: string) => Promise<RunProcessResult>;
}): Promise<void> {
  if (input.target.type !== "sandbox-docker") return;
  const installCommand = input.runtimeCommandSpec?.installCommand?.trim();
  if (!installCommand) return;

  const result = await input.runShellCommand(installCommand);
  if (result.timedOut || (result.exitCode ?? 0) !== 0) {
    throw new Error(
      `Failed to install runtime command: ${result.stderr || result.stdout || "unknown error"}`,
    );
  }
}
