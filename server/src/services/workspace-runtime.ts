import { execFile, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import type { AdapterRuntimeServiceReport } from "@armyofagents/adapter-utils";
import type { Db } from "@armyofagents/db";
import { executionWorkspaces, projectWorkspaces, workspaceRuntimeServices } from "@armyofagents/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import type {
  WorkspaceRuntimeDesiredState,
  WorkspaceRuntimeServiceStateMap,
} from "@armyofagents/shared";
import { asNumber, asString, parseObject, renderTemplate } from "../adapters/utils.js";
import { logger } from "../middleware/logger.js";
import { resolveHomeAwarePath } from "../home-paths.js";
import type { WorkspaceOperationRecorder } from "./workspace-operations.js";
import type { ExecutionWorkspace } from "@armyofagents/shared";
import { readExecutionWorkspaceConfig } from "./execution-workspaces.js";
import { readProjectWorkspaceRuntimeConfig } from "./project-workspace-runtime-config.js";
import { probePreviewUrl } from "./runtime-service-preview-detection.js";
import { emitRuntimeServiceTaskOutput } from "./task-output-emitters.js";

export interface ExecutionWorkspaceInput {
  baseCwd: string;
  source: "project_primary" | "task_session" | "agent_home";
  projectId: string | null;
  workspaceId: string | null;
  repoUrl: string | null;
  repoRef: string | null;
}

export interface ExecutionWorkspaceIssueRef {
  id: string;
  identifier: string | null;
  title: string | null;
}

export interface ExecutionWorkspaceAgentRef {
  id: string | null;
  name: string;
  companyId: string;
}

export interface RealizedExecutionWorkspace extends ExecutionWorkspaceInput {
  strategy: "project_primary" | "git_worktree";
  cwd: string;
  branchName: string | null;
  worktreePath: string | null;
  warnings: string[];
  created: boolean;
}

export interface RuntimeServiceRef {
  id: string;
  companyId: string;
  projectId: string | null;
  projectWorkspaceId: string | null;
  executionWorkspaceId: string | null;
  issueId: string | null;
  serviceName: string;
  status: "starting" | "running" | "stopped" | "failed";
  lifecycle: "shared" | "ephemeral";
  scopeType: "project_workspace" | "execution_workspace" | "run" | "agent";
  scopeId: string | null;
  reuseKey: string | null;
  command: string | null;
  cwd: string | null;
  port: number | null;
  url: string | null;
  provider: "local_process" | "adapter_managed";
  providerRef: string | null;
  ownerAgentId: string | null;
  startedByRunId: string | null;
  lastUsedAt: string;
  startedAt: string;
  stoppedAt: string | null;
  stopPolicy: Record<string, unknown> | null;
  healthStatus: "unknown" | "healthy" | "unhealthy";
  reused: boolean;
}

interface RuntimeServiceRecord extends RuntimeServiceRef {
  db?: Db;
  child: ChildProcess | null;
  leaseRunIds: Set<string>;
  idleTimer: ReturnType<typeof globalThis.setTimeout> | null;
  envFingerprint: string;
}

const runtimeServicesById = new Map<string, RuntimeServiceRecord>();
const runtimeServicesByReuseKey = new Map<string, string>();
const runtimeServiceLeasesByRun = new Map<string, string[]>();
const execFileAsync = promisify(execFile);

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    return `{${Object.keys(rec).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(rec[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function shellInvocation(command: string): { command: string; args: string[] } {
  const configuredShell = process.env.SHELL?.trim();
  if (process.platform === "win32") {
    const shellName = configuredShell ? path.basename(configuredShell).toLowerCase() : "";
    if (configuredShell && (shellName.includes("bash") || shellName === "sh.exe")) {
      return { command: configuredShell, args: ["-lc", command] };
    }
    return {
      command: configuredShell || "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-Command", command],
    };
  }

  return { command: configuredShell || "/bin/sh", args: ["-lc", command] };
}

export function sanitizeRuntimeServiceBaseEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  for (const key of Object.keys(env)) {
    if (key.startsWith("AOA_")) {
      delete env[key];
    }
  }
  delete env.DATABASE_URL;
  return env;
}

function stableRuntimeServiceId(input: {
  adapterType: string;
  runId: string;
  scopeType: RuntimeServiceRef["scopeType"];
  scopeId: string | null;
  serviceName: string;
  urlKey: string | null;
  reportId: string | null;
  providerRef: string | null;
  reuseKey: string | null;
}) {
  if (input.reportId) return input.reportId;
  const identity = input.urlKey
    ? {
        adapterType: input.adapterType,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        urlKey: input.urlKey,
      }
    : {
        adapterType: input.adapterType,
        runId: input.runId,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        serviceName: input.serviceName,
        providerRef: input.providerRef,
        reuseKey: input.reuseKey,
      };
  const digest = createHash("sha256")
    .update(stableStringify(identity))
    .digest("hex")
    .slice(0, 32);
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    digest.slice(12, 16),
    digest.slice(16, 20),
    digest.slice(20, 32),
  ].join("-");
}

function normalizeRuntimeServiceUrlKey(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value);
    return url.toString();
  } catch {
    return value.trim().replace(/\/+$/, "");
  }
}

function toRuntimeServiceRef(record: RuntimeServiceRecord, overrides?: Partial<RuntimeServiceRef>): RuntimeServiceRef {
  return {
    id: record.id,
    companyId: record.companyId,
    projectId: record.projectId,
    projectWorkspaceId: record.projectWorkspaceId,
    executionWorkspaceId: record.executionWorkspaceId,
    issueId: record.issueId,
    serviceName: record.serviceName,
    status: record.status,
    lifecycle: record.lifecycle,
    scopeType: record.scopeType,
    scopeId: record.scopeId,
    reuseKey: record.reuseKey,
    command: record.command,
    cwd: record.cwd,
    port: record.port,
    url: record.url,
    provider: record.provider,
    providerRef: record.providerRef,
    ownerAgentId: record.ownerAgentId,
    startedByRunId: record.startedByRunId,
    lastUsedAt: record.lastUsedAt,
    startedAt: record.startedAt,
    stoppedAt: record.stoppedAt,
    stopPolicy: record.stopPolicy,
    healthStatus: record.healthStatus,
    reused: record.reused,
    ...overrides,
  };
}

function sanitizeSlugPart(value: string | null | undefined, fallback: string): string {
  const raw = (value ?? "").trim().toLowerCase();
  const normalized = raw
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-/]+|[-/]+$/g, "");
  return normalized.length > 0 ? normalized : fallback;
}

function renderWorkspaceTemplate(template: string, input: {
  issue: ExecutionWorkspaceIssueRef | null;
  agent: ExecutionWorkspaceAgentRef;
  projectId: string | null;
  repoRef: string | null;
}) {
  const issueIdentifier = input.issue?.identifier ?? input.issue?.id ?? "issue";
  const slug = sanitizeSlugPart(input.issue?.title, sanitizeSlugPart(issueIdentifier, "issue"));
  return renderTemplate(template, {
    issue: {
      id: input.issue?.id ?? "",
      identifier: input.issue?.identifier ?? "",
      title: input.issue?.title ?? "",
    },
    agent: {
      id: input.agent.id,
      name: input.agent.name,
    },
    project: {
      id: input.projectId ?? "",
    },
    workspace: {
      repoRef: input.repoRef ?? "",
    },
    slug,
  });
}

function sanitizeBranchName(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9._/-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-/.]+|[-/.]+$/g, "")
    .slice(0, 120) || "paperclip-work";
}

function isAbsolutePath(value: string) {
  return path.isAbsolute(value) || value.startsWith("~");
}

function resolveConfiguredPath(value: string, baseDir: string): string {
  if (isAbsolutePath(value)) {
    return resolveHomeAwarePath(value);
  }
  return path.resolve(baseDir, value);
}

function formatCommandForDisplay(command: string, args: string[]) {
  return [command, ...args]
    .map((part) => (/^[A-Za-z0-9_./:-]+$/.test(part) ? part : JSON.stringify(part)))
    .join(" ");
}

async function executeProcess(input: {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const proc = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: input.env ?? process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code }));
  });
  return proc;
}

async function runGit(args: string[], cwd: string): Promise<string> {
  const proc = await executeProcess({
    command: "git",
    args,
    cwd,
  });
  if (proc.code !== 0) {
    throw new Error(proc.stderr.trim() || proc.stdout.trim() || `git ${args.join(" ")} failed`);
  }
  return proc.stdout.trim();
}

function gitErrorIncludes(error: unknown, needle: string) {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes(needle.toLowerCase());
}

async function directoryExists(value: string) {
  return fs.stat(value).then((stats) => stats.isDirectory()).catch(() => false);
}

interface GitWorktreePorcelainEntry {
  worktree: string;
  branch: string | null;
}

function parseGitWorktreeListPorcelain(raw: string): GitWorktreePorcelainEntry[] {
  const entries: GitWorktreePorcelainEntry[] = [];
  let current: Partial<GitWorktreePorcelainEntry> | null = null;
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trimEnd();
    if (line.length === 0) {
      if (current?.worktree) {
        entries.push({ worktree: current.worktree, branch: current.branch ?? null });
      }
      current = null;
      continue;
    }
    if (line.startsWith("worktree ")) {
      current = { worktree: line.slice("worktree ".length), branch: null };
    } else if (line.startsWith("branch ") && current) {
      current.branch = line.slice("branch ".length);
    }
  }
  if (current?.worktree) {
    entries.push({ worktree: current.worktree, branch: current.branch ?? null });
  }
  return entries;
}

async function findRegisteredGitWorktreeByBranch(
  repoRoot: string,
  branchName: string,
): Promise<string | null> {
  const raw = await runGit(["worktree", "list", "--porcelain"], repoRoot).catch(() => null);
  if (!raw) return null;
  const expected = `refs/heads/${branchName}`;
  for (const entry of parseGitWorktreeListPorcelain(raw)) {
    if (entry.branch === expected) return path.resolve(entry.worktree);
  }
  return null;
}

async function detectDefaultBranch(repoRoot: string): Promise<string | null> {
  try {
    const remoteHead = await runGit(
      ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
      repoRoot,
    );
    const branch = remoteHead?.startsWith("origin/") ? remoteHead.slice("origin/".length) : remoteHead;
    if (branch) return branch;
  } catch {
    // Fall through to remote-branch heuristic.
  }

  for (const candidate of ["main", "master"]) {
    try {
      await runGit(["rev-parse", "--verify", `refs/remotes/origin/${candidate}`], repoRoot);
      return candidate;
    } catch {
      // Try next candidate.
    }
  }

  for (const candidate of ["main", "master"]) {
    try {
      await runGit(["rev-parse", "--verify", `refs/heads/${candidate}`], repoRoot);
      return candidate;
    } catch {
      // Try next candidate.
    }
  }

  return null;
}

async function listLinkedGitWorktreePaths(repoRoot: string): Promise<Set<string>> {
  const raw = await runGit(["worktree", "list", "--porcelain"], repoRoot).catch(() => "");
  const paths = new Set<string>();
  for (const entry of parseGitWorktreeListPorcelain(raw)) {
    paths.add(path.resolve(entry.worktree));
  }
  return paths;
}

type ValidateLinkedGitWorktreeResult = { valid: true } | { valid: false; reason: string };

async function validateLinkedGitWorktree(input: {
  repoRoot: string;
  worktreePath: string;
  expectedBranchName: string | null;
}): Promise<ValidateLinkedGitWorktreeResult> {
  const resolvedWorktreePath = path.resolve(input.worktreePath);
  const listed = await listLinkedGitWorktreePaths(input.repoRoot);
  if (!listed.has(resolvedWorktreePath)) {
    return { valid: false, reason: "path is not registered in `git worktree list`" };
  }

  const worktreeTopLevel = await runGit(
    ["rev-parse", "--show-toplevel"],
    resolvedWorktreePath,
  ).catch(() => null);
  if (!worktreeTopLevel || path.resolve(worktreeTopLevel) !== resolvedWorktreePath) {
    return { valid: false, reason: "git resolves this path to a different repository root" };
  }

  if (input.expectedBranchName) {
    const currentBranch = await runGit(
      ["symbolic-ref", "--quiet", "--short", "HEAD"],
      resolvedWorktreePath,
    ).catch(() => null);
    if (currentBranch !== input.expectedBranchName) {
      return {
        valid: false,
        reason: `worktree HEAD is on "${currentBranch ?? "<detached>"}" instead of "${input.expectedBranchName}"`,
      };
    }
  }

  return { valid: true };
}

export function buildRuntimeServiceProcessTreeKillCommand(
  pid: number,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } | null {
  if (platform !== "win32") return null;
  return { command: "taskkill.exe", args: ["/PID", String(pid), "/T", "/F"] };
}

async function terminateChildProcess(child: ChildProcess) {
  if (!child.pid) return;
  const windowsTreeKill = buildRuntimeServiceProcessTreeKillCommand(child.pid);
  if (windowsTreeKill) {
    try {
      await execFileAsync(windowsTreeKill.command, windowsTreeKill.args, {
        timeout: 5000,
        windowsHide: true,
      });
      return;
    } catch {
      // Fall through to the direct child kill when taskkill is unavailable or
      // the wrapper process exited before we could terminate its tree.
    }
  }
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, "SIGTERM");
      return;
    } catch {
      // Fall through to the direct child kill.
    }
  }
  if (!child.killed) {
    child.kill("SIGTERM");
  }
}

function buildWorkspaceCommandEnv(input: {
  base: ExecutionWorkspaceInput;
  repoRoot: string;
  worktreePath: string;
  branchName: string;
  issue: ExecutionWorkspaceIssueRef | null;
  agent: ExecutionWorkspaceAgentRef;
  created: boolean;
}) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  env.AOA_WORKSPACE_CWD = input.worktreePath;
  env.AOA_WORKSPACE_PATH = input.worktreePath;
  env.AOA_WORKSPACE_WORKTREE_PATH = input.worktreePath;
  env.AOA_WORKSPACE_BRANCH = input.branchName;
  env.AOA_WORKSPACE_BASE_CWD = input.base.baseCwd;
  env.AOA_WORKSPACE_REPO_ROOT = input.repoRoot;
  env.AOA_WORKSPACE_SOURCE = input.base.source;
  env.AOA_WORKSPACE_REPO_REF = input.base.repoRef ?? "";
  env.AOA_WORKSPACE_REPO_URL = input.base.repoUrl ?? "";
  env.AOA_WORKSPACE_CREATED = input.created ? "true" : "false";
  env.AOA_PROJECT_ID = input.base.projectId ?? "";
  env.AOA_PROJECT_WORKSPACE_ID = input.base.workspaceId ?? "";
  env.AOA_AGENT_ID = input.agent.id ?? "";
  env.AOA_AGENT_NAME = input.agent.name;
  env.AOA_COMPANY_ID = input.agent.companyId;
  env.AOA_ISSUE_ID = input.issue?.id ?? "";
  env.AOA_ISSUE_IDENTIFIER = input.issue?.identifier ?? "";
  env.AOA_ISSUE_TITLE = input.issue?.title ?? "";
  return env;
}

async function runWorkspaceCommand(input: {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  label: string;
}) {
  // Defense-in-depth audit log for security finding C1: every shell command
  // dispatched through the workspace runtime is recorded with the host context
  // populated by `buildWorkspaceCommandEnv`. Operators can grep for this in
  // production logs to detect unexpected provision/teardown/cleanup runs.
  logger.warn(
    {
      label: input.label,
      command: input.command,
      cwd: input.cwd,
      companyId: input.env.AOA_COMPANY_ID ?? null,
      projectId: input.env.AOA_PROJECT_ID ?? null,
      projectWorkspaceId: input.env.AOA_PROJECT_WORKSPACE_ID ?? null,
      issueId: input.env.AOA_ISSUE_ID ?? null,
      agentId: input.env.AOA_AGENT_ID ?? null,
    },
    "Running workspace shell command",
  );
  const shell = process.env.SHELL?.trim() || "/bin/sh";
  const proc = await executeProcess({
    command: shell,
    args: ["-c", input.command],
    cwd: input.cwd,
    env: input.env,
  });
  if (proc.code === 0) return;

  const details = [proc.stderr.trim(), proc.stdout.trim()].filter(Boolean).join("\n");
  throw new Error(
    details.length > 0
      ? `${input.label} failed: ${details}`
      : `${input.label} failed with exit code ${proc.code ?? -1}`,
  );
}

async function recordGitOperation(
  recorder: WorkspaceOperationRecorder | null | undefined,
  input: {
    phase: "worktree_prepare" | "worktree_cleanup" | "user_git_operation";
    args: string[];
    cwd: string;
    metadata?: Record<string, unknown> | null;
    successMessage?: string | null;
    failureLabel?: string | null;
  },
): Promise<string> {
  if (!recorder) {
    return runGit(input.args, input.cwd);
  }

  let stdout = "";
  let stderr = "";
  let code: number | null = null;
  await recorder.recordOperation({
    phase: input.phase,
    command: formatCommandForDisplay("git", input.args),
    cwd: input.cwd,
    metadata: input.metadata ?? null,
    run: async () => {
      const result = await executeProcess({
        command: "git",
        args: input.args,
        cwd: input.cwd,
      });
      stdout = result.stdout;
      stderr = result.stderr;
      code = result.code;
      return {
        status: result.code === 0 ? "succeeded" : "failed",
        exitCode: result.code,
        stdout: result.stdout,
        stderr: result.stderr,
        system: result.code === 0 ? input.successMessage ?? null : null,
      };
    },
  });

  if (code !== 0) {
    const details = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
    throw new Error(
      details.length > 0
        ? `${input.failureLabel ?? `git ${input.args.join(" ")}`} failed: ${details}`
        : `${input.failureLabel ?? `git ${input.args.join(" ")}`} failed with exit code ${code ?? -1}`,
    );
  }
  return stdout.trim();
}

async function recordWorkspaceCommandOperation(
  recorder: WorkspaceOperationRecorder | null | undefined,
  input: {
    phase: "workspace_provision" | "workspace_teardown";
    command: string;
    cwd: string;
    env: NodeJS.ProcessEnv;
    label: string;
    metadata?: Record<string, unknown> | null;
    successMessage?: string | null;
  },
) {
  if (!recorder) {
    await runWorkspaceCommand(input);
    return;
  }

  let stdout = "";
  let stderr = "";
  let code: number | null = null;
  await recorder.recordOperation({
    phase: input.phase,
    command: input.command,
    cwd: input.cwd,
    metadata: input.metadata ?? null,
    run: async () => {
      const shell = shellInvocation(input.command);
      const result = await executeProcess({
        command: shell.command,
        args: shell.args,
        cwd: input.cwd,
        env: input.env,
      });
      stdout = result.stdout;
      stderr = result.stderr;
      code = result.code;
      return {
        status: result.code === 0 ? "succeeded" : "failed",
        exitCode: result.code,
        stdout: result.stdout,
        stderr: result.stderr,
        system: result.code === 0 ? input.successMessage ?? null : null,
      };
    },
  });

  if (code === 0) return;

  const details = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
  throw new Error(
    details.length > 0
      ? `${input.label} failed: ${details}`
      : `${input.label} failed with exit code ${code ?? -1}`,
  );
}

async function provisionExecutionWorktree(input: {
  strategy: Record<string, unknown>;
  base: ExecutionWorkspaceInput;
  repoRoot: string;
  worktreePath: string;
  branchName: string;
  issue: ExecutionWorkspaceIssueRef | null;
  agent: ExecutionWorkspaceAgentRef;
  created: boolean;
  recorder?: WorkspaceOperationRecorder | null;
}) {
  const provisionCommand = asString(input.strategy.provisionCommand, "").trim();
  if (!provisionCommand) return;

  await recordWorkspaceCommandOperation(input.recorder, {
    phase: "workspace_provision",
    command: provisionCommand,
    cwd: input.worktreePath,
    env: buildWorkspaceCommandEnv({
      base: input.base,
      repoRoot: input.repoRoot,
      worktreePath: input.worktreePath,
      branchName: input.branchName,
      issue: input.issue,
      agent: input.agent,
      created: input.created,
    }),
    label: `Execution workspace provision command "${provisionCommand}"`,
    metadata: {
      repoRoot: input.repoRoot,
      worktreePath: input.worktreePath,
      branchName: input.branchName,
      created: input.created,
    },
    successMessage: `Provisioned workspace at ${input.worktreePath}\n`,
  });
}

function buildExecutionWorkspaceCleanupEnv(input: {
  workspace: {
    cwd: string | null;
    providerRef: string | null;
    branchName: string | null;
    repoUrl: string | null;
    baseRef: string | null;
    projectId: string | null;
    projectWorkspaceId: string | null;
    sourceIssueId: string | null;
  };
  projectWorkspaceCwd?: string | null;
}) {
  const env: NodeJS.ProcessEnv = sanitizeRuntimeServiceBaseEnv(process.env);
  env.AOA_WORKSPACE_CWD = input.workspace.cwd ?? "";
  env.AOA_WORKSPACE_PATH = input.workspace.cwd ?? "";
  env.AOA_WORKSPACE_WORKTREE_PATH =
    input.workspace.providerRef ?? input.workspace.cwd ?? "";
  env.AOA_WORKSPACE_BRANCH = input.workspace.branchName ?? "";
  env.AOA_WORKSPACE_BASE_CWD = input.projectWorkspaceCwd ?? "";
  env.AOA_WORKSPACE_REPO_ROOT = input.projectWorkspaceCwd ?? "";
  env.AOA_WORKSPACE_REPO_URL = input.workspace.repoUrl ?? "";
  env.AOA_WORKSPACE_REPO_REF = input.workspace.baseRef ?? "";
  env.AOA_PROJECT_ID = input.workspace.projectId ?? "";
  env.AOA_PROJECT_WORKSPACE_ID = input.workspace.projectWorkspaceId ?? "";
  env.AOA_ISSUE_ID = input.workspace.sourceIssueId ?? "";
  return env;
}

async function resolveGitRepoRootForWorkspaceCleanup(
  worktreePath: string,
  projectWorkspaceCwd: string | null,
): Promise<string | null> {
  if (projectWorkspaceCwd) {
    const resolvedProjectWorkspaceCwd = path.resolve(projectWorkspaceCwd);
    const gitDir = await runGit(["rev-parse", "--git-common-dir"], resolvedProjectWorkspaceCwd)
      .catch(() => null);
    if (gitDir) {
      const resolvedGitDir = path.resolve(resolvedProjectWorkspaceCwd, gitDir);
      return path.dirname(resolvedGitDir);
    }
  }

  const gitDir = await runGit(["rev-parse", "--git-common-dir"], worktreePath).catch(() => null);
  if (!gitDir) return null;
  const resolvedGitDir = path.resolve(worktreePath, gitDir);
  return path.dirname(resolvedGitDir);
}

export async function realizeExecutionWorkspace(input: {
  base: ExecutionWorkspaceInput;
  config: Record<string, unknown>;
  issue: ExecutionWorkspaceIssueRef | null;
  agent: ExecutionWorkspaceAgentRef;
  recorder?: WorkspaceOperationRecorder | null;
}): Promise<RealizedExecutionWorkspace> {
  const rawStrategy = parseObject(input.config.workspaceStrategy);
  const strategyType = asString(rawStrategy.type, "project_primary");
  if (strategyType !== "git_worktree") {
    return {
      ...input.base,
      strategy: "project_primary",
      cwd: input.base.baseCwd,
      branchName: null,
      worktreePath: null,
      warnings: [],
      created: false,
    };
  }

  const repoRootOrNull = await runGit(["rev-parse", "--show-toplevel"], input.base.baseCwd).catch(() => null);
  if (!repoRootOrNull) {
    // baseCwd is not inside a git repository — cannot create a worktree.
    // Fall back to project_primary so the run still proceeds.
    return {
      ...input.base,
      strategy: "project_primary" as const,
      cwd: input.base.baseCwd,
      branchName: null,
      worktreePath: null,
      warnings: [
        `Workspace directory "${input.base.baseCwd}" is not a git repository. ` +
        `Cannot create an isolated worktree. Using shared workspace instead.`,
      ],
      created: false,
    };
  }
  const repoRoot: string = repoRootOrNull;
  const branchTemplate = asString(rawStrategy.branchTemplate, "{{issue.identifier}}-{{slug}}");
  const renderedBranch = renderWorkspaceTemplate(branchTemplate, {
    issue: input.issue,
    agent: input.agent,
    projectId: input.base.projectId,
    repoRef: input.base.repoRef,
  });
  const branchName = sanitizeBranchName(renderedBranch);
  const configuredParentDir = asString(rawStrategy.worktreeParentDir, "");
  const worktreeParentDir = configuredParentDir
    ? resolveConfiguredPath(configuredParentDir, repoRoot)
    : path.join(repoRoot, ".aoa", "worktrees");
  const worktreePath = path.join(worktreeParentDir, branchName);
  const configuredBaseRef = typeof rawStrategy.baseRef === "string" && rawStrategy.baseRef.length > 0
    ? rawStrategy.baseRef
    : input.base.repoRef ?? null;
  const baseRef = configuredBaseRef ?? (await detectDefaultBranch(repoRoot)) ?? "HEAD";

  await fs.mkdir(worktreeParentDir, { recursive: true });

  async function reuseExistingWorktreeAt(reusablePath: string): Promise<RealizedExecutionWorkspace> {
    if (input.recorder) {
      await input.recorder.recordOperation({
        phase: "worktree_prepare",
        cwd: repoRoot,
        metadata: {
          repoRoot,
          worktreePath: reusablePath,
          branchName,
          baseRef,
          created: false,
          reused: true,
        },
        run: async () => ({
          status: "succeeded",
          exitCode: 0,
          system: `Reused existing git worktree at ${reusablePath}\n`,
        }),
      });
    }
    await provisionExecutionWorktree({
      strategy: rawStrategy,
      base: input.base,
      repoRoot,
      worktreePath: reusablePath,
      branchName,
      issue: input.issue,
      agent: input.agent,
      created: false,
      recorder: input.recorder ?? null,
    });
    return {
      ...input.base,
      strategy: "git_worktree",
      cwd: reusablePath,
      branchName,
      worktreePath: reusablePath,
      warnings: [],
      created: false,
    };
  }

  async function reuseConcurrentWorktreeIfValid(): Promise<RealizedExecutionWorkspace | null> {
    if (await directoryExists(worktreePath)) {
      const validation = await validateLinkedGitWorktree({
        repoRoot,
        worktreePath,
        expectedBranchName: branchName,
      });
      if (validation.valid) {
        return await reuseExistingWorktreeAt(worktreePath);
      }

      const existingGitDir = await runGit(["rev-parse", "--git-dir"], worktreePath).catch(() => null);
      if (existingGitDir) {
        throw new Error(
          `Configured worktree path "${worktreePath}" is not reusable: ${validation.reason}.`,
        );
      }
    }

    const registeredBranchWorktree = await findRegisteredGitWorktreeByBranch(repoRoot, branchName);
    if (!registeredBranchWorktree) {
      return null;
    }
    const validation = await validateLinkedGitWorktree({
      repoRoot,
      worktreePath: registeredBranchWorktree,
      expectedBranchName: branchName,
    });
    if (validation.valid) {
      return await reuseExistingWorktreeAt(registeredBranchWorktree);
    }
    throw new Error(
      `Configured worktree branch "${branchName}" is registered but not reusable: ${validation.reason}.`,
    );
  }

  const existingWorktree = await directoryExists(worktreePath);
  if (existingWorktree) {
    const validation = await validateLinkedGitWorktree({
      repoRoot,
      worktreePath,
      expectedBranchName: branchName,
    });
    if (validation.valid) {
      return await reuseExistingWorktreeAt(worktreePath);
    }
    const existingGitDir = await runGit(["rev-parse", "--git-dir"], worktreePath).catch(() => null);
    if (existingGitDir) {
      // Directory is a git checkout but not registered as a worktree of repoRoot,
      // or the branch doesn't match. Surface the specific reason from validation.
      throw new Error(
        `Configured worktree path "${worktreePath}" is not reusable: ${validation.reason}.`,
      );
    }
    throw new Error(`Configured worktree path "${worktreePath}" already exists and is not a git worktree.`);
  }

  const registeredBranchWorktree = await findRegisteredGitWorktreeByBranch(repoRoot, branchName);
  if (registeredBranchWorktree) {
    const validation = await validateLinkedGitWorktree({
      repoRoot,
      worktreePath: registeredBranchWorktree,
      expectedBranchName: branchName,
    });
    if (validation.valid) {
      return await reuseExistingWorktreeAt(registeredBranchWorktree);
    }
  }

  try {
    await recordGitOperation(input.recorder, {
      phase: "worktree_prepare",
      args: ["worktree", "add", "-b", branchName, worktreePath, baseRef],
      cwd: repoRoot,
      metadata: {
        repoRoot,
        worktreePath,
        branchName,
        baseRef,
        created: true,
      },
      successMessage: `Created git worktree at ${worktreePath}\n`,
      failureLabel: `git worktree add ${worktreePath}`,
    });
  } catch (error) {
    if (!gitErrorIncludes(error, "already exists")) {
      throw error;
    }
    const concurrentlyCreated = await reuseConcurrentWorktreeIfValid();
    if (concurrentlyCreated) {
      return concurrentlyCreated;
    }
    try {
      await recordGitOperation(input.recorder, {
        phase: "worktree_prepare",
        args: ["worktree", "add", worktreePath, branchName],
        cwd: repoRoot,
        metadata: {
          repoRoot,
          worktreePath,
          branchName,
          baseRef,
          created: false,
          reusedExistingBranch: true,
        },
        successMessage: `Attached existing branch ${branchName} at ${worktreePath}\n`,
        failureLabel: `git worktree add ${worktreePath}`,
      });
    } catch (attachError) {
      if (!gitErrorIncludes(attachError, "already checked out")) {
        throw attachError;
      }
      const reusablePath = await findRegisteredGitWorktreeByBranch(repoRoot, branchName);
      if (!reusablePath) {
        throw attachError;
      }
      const validation = await validateLinkedGitWorktree({
        repoRoot,
        worktreePath: reusablePath,
        expectedBranchName: branchName,
      });
      if (!validation.valid) {
        throw attachError;
      }
      return await reuseExistingWorktreeAt(reusablePath);
    }
  }
  await provisionExecutionWorktree({
    strategy: rawStrategy,
    base: input.base,
    repoRoot,
    worktreePath,
    branchName,
    issue: input.issue,
    agent: input.agent,
    created: true,
    recorder: input.recorder ?? null,
  });

  return {
    ...input.base,
    strategy: "git_worktree",
    cwd: worktreePath,
    branchName,
    worktreePath,
    warnings: [],
    created: true,
  };
}

export function buildRealizedExecutionWorkspaceFromPersisted(
  ws: ExecutionWorkspace,
  base: ExecutionWorkspaceInput,
): RealizedExecutionWorkspace {
  const strategy = ws.strategyType === "git_worktree" ? "git_worktree" : "project_primary";
  return {
    baseCwd: base.baseCwd,
    source: base.source,
    projectId: ws.projectId ?? base.projectId,
    workspaceId: ws.projectWorkspaceId ?? base.workspaceId,
    repoUrl: ws.repoUrl ?? base.repoUrl,
    repoRef: ws.baseRef ?? base.repoRef,
    strategy,
    cwd: ws.cwd ?? base.baseCwd,
    branchName: ws.branchName,
    worktreePath: strategy === "git_worktree" ? (ws.providerRef ?? ws.cwd ?? null) : null,
    warnings: [],
    created: false,
  };
}

export async function ensurePersistedExecutionWorkspaceAvailable(
  persisted: ExecutionWorkspace,
  base: ExecutionWorkspaceInput,
  recorder?: WorkspaceOperationRecorder | null,
): Promise<RealizedExecutionWorkspace> {
  const rehydrated = buildRealizedExecutionWorkspaceFromPersisted(persisted, base);

  if (persisted.strategyType !== "git_worktree" || !persisted.cwd) {
    return rehydrated;
  }

  const cwd = persisted.cwd;
  const branchName = persisted.branchName;
  const repoRoot = await runGit(["rev-parse", "--show-toplevel"], base.baseCwd).catch(() => null);

  if (await directoryExists(cwd)) {
    if (!repoRoot || !branchName) {
      return rehydrated;
    }
    const validation = await validateLinkedGitWorktree({
      repoRoot,
      worktreePath: cwd,
      expectedBranchName: branchName,
    });
    if (validation.valid) return rehydrated;
    // Disk present but git state doesn't match — fall through to re-provision.
  }

  if (!repoRoot) {
    return rehydrated;
  }
  if (!branchName) {
    throw new Error(
      `Execution workspace "${cwd}" is missing and cannot be restored because no branch name is recorded.`,
    );
  }

  await fs.mkdir(path.dirname(cwd), { recursive: true });
  await runGit(["worktree", "prune"], repoRoot).catch(() => undefined);

  let created = false;
  try {
    await recordGitOperation(recorder, {
      phase: "worktree_prepare",
      args: ["worktree", "add", cwd, branchName],
      cwd: repoRoot,
      metadata: {
        repoRoot,
        worktreePath: cwd,
        branchName,
        baseRef: persisted.baseRef ?? base.repoRef ?? null,
        created: false,
        restored: true,
      },
      successMessage: `Reattached missing git worktree at ${cwd}\n`,
      failureLabel: `git worktree add ${cwd}`,
    });
  } catch (error) {
    if (
      !gitErrorIncludes(error, "invalid reference") &&
      !gitErrorIncludes(error, "not a commit") &&
      !gitErrorIncludes(error, "unknown revision")
    ) {
      throw error;
    }
    const baseRef = persisted.baseRef ?? (await detectDefaultBranch(repoRoot)) ?? "HEAD";
    await recordGitOperation(recorder, {
      phase: "worktree_prepare",
      args: ["worktree", "add", "-b", branchName, cwd, baseRef],
      cwd: repoRoot,
      metadata: {
        repoRoot,
        worktreePath: cwd,
        branchName,
        baseRef,
        created: true,
        restored: true,
      },
      successMessage: `Recreated missing git worktree at ${cwd}\n`,
      failureLabel: `git worktree add ${cwd}`,
    });
    created = true;
  }

  return {
    ...rehydrated,
    cwd,
    worktreePath: cwd,
    created,
  };
}

export async function cleanupExecutionWorkspaceArtifacts(input: {
  workspace: {
    id: string;
    cwd: string | null;
    providerType: string;
    providerRef: string | null;
    branchName: string | null;
    repoUrl: string | null;
    baseRef: string | null;
    projectId: string | null;
    projectWorkspaceId: string | null;
    sourceIssueId: string | null;
    metadata?: Record<string, unknown> | null;
  };
  projectWorkspace?: {
    cwd: string | null;
    cleanupCommand: string | null;
  } | null;
  cleanupCommand?: string | null;
  teardownCommand?: string | null;
  recorder?: WorkspaceOperationRecorder | null;
}) {
  const warnings: string[] = [];
  const workspacePath = input.workspace.providerRef ?? input.workspace.cwd;
  const cleanupEnv = buildExecutionWorkspaceCleanupEnv({
    workspace: input.workspace,
    projectWorkspaceCwd: input.projectWorkspace?.cwd ?? null,
  });
  const createdByRuntime = input.workspace.metadata?.createdByRuntime === true;
  const cleanupCommands = [
    input.cleanupCommand ?? null,
    input.projectWorkspace?.cleanupCommand ?? null,
    input.teardownCommand ?? null,
  ]
    .map((value) => asString(value, "").trim())
    .filter(Boolean);

  for (const command of cleanupCommands) {
    try {
      await recordWorkspaceCommandOperation(input.recorder, {
        phase: "workspace_teardown",
        command,
        cwd: workspacePath ?? input.projectWorkspace?.cwd ?? process.cwd(),
        env: cleanupEnv,
        label: `Execution workspace cleanup command "${command}"`,
        metadata: {
          workspaceId: input.workspace.id,
          workspacePath,
          branchName: input.workspace.branchName,
          providerType: input.workspace.providerType,
        },
        successMessage: `Completed cleanup command "${command}"\n`,
      });
    } catch (err) {
      warnings.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (input.workspace.providerType === "git_worktree" && workspacePath) {
    const repoRoot = await resolveGitRepoRootForWorkspaceCleanup(
      workspacePath,
      input.projectWorkspace?.cwd ?? null,
    );
    const worktreeExists = await directoryExists(workspacePath);
    if (worktreeExists) {
      if (!repoRoot) {
        warnings.push(`Could not resolve git repo root for "${workspacePath}".`);
      } else {
        try {
          await recordGitOperation(input.recorder, {
            phase: "worktree_cleanup",
            args: ["worktree", "remove", "--force", workspacePath],
            cwd: repoRoot,
            metadata: {
              workspaceId: input.workspace.id,
              workspacePath,
              branchName: input.workspace.branchName,
              cleanupAction: "worktree_remove",
            },
            successMessage: `Removed git worktree ${workspacePath}\n`,
            failureLabel: `git worktree remove ${workspacePath}`,
          });
        } catch (err) {
          warnings.push(err instanceof Error ? err.message : String(err));
        }
      }
    }
    if (createdByRuntime && input.workspace.branchName) {
      if (!repoRoot) {
        warnings.push(`Could not resolve git repo root to delete branch "${input.workspace.branchName}".`);
      } else {
        try {
          await recordGitOperation(input.recorder, {
            phase: "worktree_cleanup",
            args: ["branch", "-d", input.workspace.branchName],
            cwd: repoRoot,
            metadata: {
              workspaceId: input.workspace.id,
              workspacePath,
              branchName: input.workspace.branchName,
              cleanupAction: "branch_delete",
            },
            successMessage: `Deleted branch ${input.workspace.branchName}\n`,
            failureLabel: `git branch -d ${input.workspace.branchName}`,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          warnings.push(`Skipped deleting branch "${input.workspace.branchName}": ${message}`);
        }
      }
    }
  } else if (input.workspace.providerType === "local_fs" && createdByRuntime && workspacePath) {
    const projectWorkspaceCwd = input.projectWorkspace?.cwd ? path.resolve(input.projectWorkspace.cwd) : null;
    const resolvedWorkspacePath = path.resolve(workspacePath);
    const containsProjectWorkspace = projectWorkspaceCwd
      ? (
          resolvedWorkspacePath === projectWorkspaceCwd ||
          projectWorkspaceCwd.startsWith(`${resolvedWorkspacePath}${path.sep}`)
        )
      : false;
    if (containsProjectWorkspace) {
      warnings.push(`Refusing to remove path "${workspacePath}" because it contains the project workspace.`);
    } else {
      await fs.rm(resolvedWorkspacePath, { recursive: true, force: true });
      if (input.recorder) {
        await input.recorder.recordOperation({
          phase: "workspace_teardown",
          cwd: projectWorkspaceCwd ?? process.cwd(),
          metadata: {
            workspaceId: input.workspace.id,
            workspacePath: resolvedWorkspacePath,
            cleanupAction: "remove_local_fs",
          },
          run: async () => ({
            status: "succeeded",
            exitCode: 0,
            system: `Removed local workspace directory ${resolvedWorkspacePath}\n`,
          }),
        });
      }
    }
  }

  const cleaned =
    !workspacePath ||
    !(await directoryExists(workspacePath));

  return {
    cleanedPath: workspacePath,
    cleaned,
    warnings,
  };
}

async function allocatePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        if (!address || typeof address === "string") {
          reject(new Error("Failed to allocate port"));
          return;
        }
        resolve(address.port);
      });
    });
    server.on("error", reject);
  });
}

function buildTemplateData(input: {
  workspace: RealizedExecutionWorkspace;
  agent: ExecutionWorkspaceAgentRef;
  issue: ExecutionWorkspaceIssueRef | null;
  adapterEnv: Record<string, string>;
  port: number | null;
}) {
  return {
    workspace: {
      cwd: input.workspace.cwd,
      branchName: input.workspace.branchName ?? "",
      worktreePath: input.workspace.worktreePath ?? "",
      repoUrl: input.workspace.repoUrl ?? "",
      repoRef: input.workspace.repoRef ?? "",
      env: input.adapterEnv,
    },
    issue: {
      id: input.issue?.id ?? "",
      identifier: input.issue?.identifier ?? "",
      title: input.issue?.title ?? "",
    },
    agent: {
      id: input.agent.id,
      name: input.agent.name,
    },
    port: input.port ?? "",
  };
}

function resolveServiceScopeId(input: {
  service: Record<string, unknown>;
  workspace: RealizedExecutionWorkspace;
  executionWorkspaceId?: string | null;
  issue: ExecutionWorkspaceIssueRef | null;
  runId: string;
  agent: ExecutionWorkspaceAgentRef;
}): {
  scopeType: "project_workspace" | "execution_workspace" | "run" | "agent";
  scopeId: string | null;
} {
  const scopeTypeRaw = asString(input.service.reuseScope, input.service.lifecycle === "shared" ? "project_workspace" : "run");
  const scopeType =
    scopeTypeRaw === "project_workspace" ||
    scopeTypeRaw === "execution_workspace" ||
    scopeTypeRaw === "agent"
      ? scopeTypeRaw
      : "run";
  if (scopeType === "project_workspace") return { scopeType, scopeId: input.workspace.workspaceId ?? input.workspace.projectId };
  if (scopeType === "execution_workspace") {
    return { scopeType, scopeId: input.executionWorkspaceId ?? input.workspace.cwd };
  }
  if (scopeType === "agent") return { scopeType, scopeId: input.agent.id };
  return { scopeType: "run" as const, scopeId: input.runId };
}

async function waitForReadiness(input: {
  service: Record<string, unknown>;
  url: string | null;
}) {
  const options = resolveRuntimeServiceReadinessOptions({ service: input.service });
  if (options.type !== "http" || !input.url) return;
  const deadline = Date.now() + options.timeoutSec * 1000;
  let lastError = "service did not become ready";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(input.url);
      if (response.ok) return;
      lastError = `received HTTP ${response.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await delay(options.intervalMs);
  }
  throw new Error(`Readiness check failed for ${input.url}: ${lastError}`);
}

function toPersistedWorkspaceRuntimeService(record: RuntimeServiceRecord): typeof workspaceRuntimeServices.$inferInsert {
  return {
    id: record.id,
    companyId: record.companyId,
    projectId: record.projectId,
    projectWorkspaceId: record.projectWorkspaceId,
    executionWorkspaceId: record.executionWorkspaceId,
    issueId: record.issueId,
    scopeType: record.scopeType,
    scopeId: record.scopeId,
    serviceName: record.serviceName,
    status: record.status,
    lifecycle: record.lifecycle,
    reuseKey: record.reuseKey,
    command: record.command,
    cwd: record.cwd,
    port: record.port,
    url: record.url,
    provider: record.provider,
    providerRef: record.providerRef,
    ownerAgentId: record.ownerAgentId,
    startedByRunId: record.startedByRunId,
    lastUsedAt: new Date(record.lastUsedAt),
    startedAt: new Date(record.startedAt),
    stoppedAt: record.stoppedAt ? new Date(record.stoppedAt) : null,
    stopPolicy: record.stopPolicy,
    healthStatus: record.healthStatus,
    updatedAt: new Date(),
  };
}

async function persistRuntimeServiceRecord(db: Db | undefined, record: RuntimeServiceRecord) {
  if (!db) return;
  const values = toPersistedWorkspaceRuntimeService(record);
  await db
    .insert(workspaceRuntimeServices)
    .values(values)
    .onConflictDoUpdate({
      target: workspaceRuntimeServices.id,
      set: {
        projectId: values.projectId,
        projectWorkspaceId: values.projectWorkspaceId,
        executionWorkspaceId: values.executionWorkspaceId,
        issueId: values.issueId,
        scopeType: values.scopeType,
        scopeId: values.scopeId,
        serviceName: values.serviceName,
        status: values.status,
        lifecycle: values.lifecycle,
        reuseKey: values.reuseKey,
        command: values.command,
        cwd: values.cwd,
        port: values.port,
        url: values.url,
        provider: values.provider,
        providerRef: values.providerRef,
        ownerAgentId: values.ownerAgentId,
        startedByRunId: values.startedByRunId,
        lastUsedAt: values.lastUsedAt,
        startedAt: values.startedAt,
        stoppedAt: values.stoppedAt,
        stopPolicy: values.stopPolicy,
        healthStatus: values.healthStatus,
        updatedAt: values.updatedAt,
      },
    });
  await emitRuntimeServiceTaskOutput(db, values);
}

function clearIdleTimer(record: RuntimeServiceRecord) {
  if (!record.idleTimer) return;
  clearTimeout(record.idleTimer);
  record.idleTimer = null;
}

export function normalizeAdapterManagedRuntimeServices(input: {
  adapterType: string;
  runId: string;
  agent: ExecutionWorkspaceAgentRef;
  issue: ExecutionWorkspaceIssueRef | null;
  workspace: RealizedExecutionWorkspace;
  executionWorkspaceId?: string | null;
  reports: AdapterRuntimeServiceReport[];
  now?: Date;
}): RuntimeServiceRef[] {
  const nowIso = (input.now ?? new Date()).toISOString();
  const refs: RuntimeServiceRef[] = input.reports.map((report) => {
    const scopeType = report.scopeType ?? "run";
    const scopeId =
      report.scopeId ??
      (scopeType === "project_workspace"
        ? input.workspace.workspaceId
        : scopeType === "execution_workspace"
          ? input.executionWorkspaceId ?? input.workspace.cwd
          : scopeType === "agent"
            ? input.agent.id
            : input.runId) ??
      null;
    const serviceName = asString(report.serviceName, "").trim() || "service";
    const status = report.status ?? "running";
    const lifecycle = report.lifecycle ?? "ephemeral";
    const previewUrlKey =
      scopeType === "execution_workspace" && !report.command && !report.providerRef
        ? normalizeRuntimeServiceUrlKey(report.url ?? null)
        : null;
    const healthStatus =
      report.healthStatus ??
      (status === "running" ? "healthy" : status === "failed" ? "unhealthy" : "unknown");
    return {
      id: stableRuntimeServiceId({
        adapterType: input.adapterType,
        runId: input.runId,
        scopeType,
        scopeId,
        serviceName,
        urlKey: previewUrlKey,
        reportId: report.id ?? null,
        providerRef: report.providerRef ?? null,
        reuseKey: report.reuseKey ?? null,
      }),
      companyId: input.agent.companyId,
      projectId: report.projectId ?? input.workspace.projectId,
      projectWorkspaceId: report.projectWorkspaceId ?? input.workspace.workspaceId,
      executionWorkspaceId: input.executionWorkspaceId ?? null,
      issueId: report.issueId ?? input.issue?.id ?? null,
      serviceName,
      status,
      lifecycle,
      scopeType,
      scopeId,
      reuseKey: report.reuseKey ?? null,
      command: report.command ?? null,
      cwd: report.cwd ?? null,
      port: report.port ?? null,
      url: report.url ?? null,
      provider: "adapter_managed",
      providerRef: report.providerRef ?? null,
      ownerAgentId: report.ownerAgentId ?? input.agent.id,
      startedByRunId: input.runId,
      lastUsedAt: nowIso,
      startedAt: nowIso,
      stoppedAt: status === "running" || status === "starting" ? null : nowIso,
      stopPolicy: report.stopPolicy ?? null,
      healthStatus,
      reused: false,
    };
  });
  return Array.from(new Map(refs.map((ref) => [ref.id, ref])).values());
}

type WorkspaceRuntimeServiceRow = typeof workspaceRuntimeServices.$inferSelect;

type PreviewRuntimeServiceUpdate = {
  id: string;
  status: string;
  healthStatus: string;
  stoppedAt: Date | null;
  healthCheckedAt: Date;
  updatedAt: Date;
};

const DEFAULT_PREVIEW_HEALTH_CHECK_TTL_MS = 30_000;
const DEFAULT_PREVIEW_HEALTH_CHECK_CONCURRENCY = 5;
const previewProbeInFlight = new Map<string, Promise<boolean>>();

function isAdapterManagedPreviewRuntimeServiceRow(row: WorkspaceRuntimeServiceRow): boolean {
  return row.provider === "adapter_managed" && !row.command && !row.providerRef && Boolean(row.url);
}

function dateTime(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function isPreviewHealthCheckStale(
  row: WorkspaceRuntimeServiceRow,
  now: Date,
  ttlMs: number,
): boolean {
  const checkedAt = dateTime(row.healthCheckedAt);
  if (checkedAt === null) return true;
  return now.getTime() - checkedAt >= ttlMs;
}

function isRuntimeServiceHealthRefreshActive(row: WorkspaceRuntimeServiceRow): boolean {
  return row.status === "starting" || row.status === "running";
}

function nextRuntimeServiceHealthState(
  row: WorkspaceRuntimeServiceRow,
  reachable: boolean,
  now: Date,
): Pick<PreviewRuntimeServiceUpdate, "status" | "healthStatus" | "stoppedAt"> {
  if (reachable) {
    return {
      status: "running",
      healthStatus: "healthy",
      stoppedAt: null,
    };
  }

  if (row.healthStatus === "unhealthy") {
    return {
      status: "stopped",
      healthStatus: "unhealthy",
      stoppedAt: now,
    };
  }

  return {
    status: row.status,
    healthStatus: "unhealthy",
    stoppedAt: row.stoppedAt ?? null,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await fn(items[currentIndex]!, currentIndex);
    }
  });
  await Promise.all(workers);
  return results;
}

async function probePreviewUrlDeduped(input: {
  key: string;
  url: string;
  probeUrl: (url: string) => Promise<boolean>;
}): Promise<boolean> {
  const existing = previewProbeInFlight.get(input.key);
  if (existing) return existing;
  const promise = input.probeUrl(input.url).finally(() => {
    previewProbeInFlight.delete(input.key);
  });
  previewProbeInFlight.set(input.key, promise);
  return promise;
}

export async function refreshAdapterManagedPreviewRuntimeServiceRows(input: {
  rows: WorkspaceRuntimeServiceRow[];
  now?: Date;
  ttlMs?: number;
  maxConcurrency?: number;
  probeUrl?: (url: string) => Promise<boolean>;
}): Promise<{ rows: WorkspaceRuntimeServiceRow[]; updates: PreviewRuntimeServiceUpdate[] }> {
  const now = input.now ?? new Date();
  const ttlMs = input.ttlMs ?? DEFAULT_PREVIEW_HEALTH_CHECK_TTL_MS;
  const maxConcurrency = input.maxConcurrency ?? DEFAULT_PREVIEW_HEALTH_CHECK_CONCURRENCY;
  const probeUrl = input.probeUrl ?? ((url: string) => probePreviewUrl(url, { timeoutMs: 750 }));
  const updates: PreviewRuntimeServiceUpdate[] = [];

  const rows = await mapWithConcurrency(
    input.rows,
    maxConcurrency,
    async (row) => {
      if (!isAdapterManagedPreviewRuntimeServiceRow(row) || !row.url) return row;
      if (!isRuntimeServiceHealthRefreshActive(row)) return row;
      if (!isPreviewHealthCheckStale(row, now, ttlMs)) return row;

      const reachable = await probePreviewUrlDeduped({
        key: row.id,
        url: row.url,
        probeUrl,
      });
      const nextHealth = nextRuntimeServiceHealthState(row, reachable, now);
      const changed =
        row.status !== nextHealth.status ||
        row.healthStatus !== nextHealth.healthStatus ||
        dateTime(row.stoppedAt) !== dateTime(nextHealth.stoppedAt) ||
        dateTime(row.healthCheckedAt) !== dateTime(now);

      if (!changed) return row;

      const update = {
        id: row.id,
        status: nextHealth.status,
        healthStatus: nextHealth.healthStatus,
        stoppedAt: nextHealth.stoppedAt,
        healthCheckedAt: now,
        updatedAt: now,
      };
      updates.push(update);
      return {
        ...row,
        status: update.status,
        healthStatus: update.healthStatus,
        stoppedAt: update.stoppedAt,
        healthCheckedAt: update.healthCheckedAt,
        updatedAt: update.updatedAt,
      };
    },
  );

  return { rows, updates };
}

export async function refreshLocalProcessRuntimeServiceRows(input: {
  rows: WorkspaceRuntimeServiceRow[];
  now?: Date;
  ttlMs?: number;
  maxConcurrency?: number;
  probeUrl?: (url: string) => Promise<boolean>;
}): Promise<{ rows: WorkspaceRuntimeServiceRow[]; updates: PreviewRuntimeServiceUpdate[] }> {
  const now = input.now ?? new Date();
  const ttlMs = input.ttlMs ?? DEFAULT_PREVIEW_HEALTH_CHECK_TTL_MS;
  const maxConcurrency = input.maxConcurrency ?? DEFAULT_PREVIEW_HEALTH_CHECK_CONCURRENCY;
  const probeUrl = input.probeUrl ?? ((url: string) => probePreviewUrl(url, { timeoutMs: 750 }));
  const updates: PreviewRuntimeServiceUpdate[] = [];

  const rows = await mapWithConcurrency(
    input.rows,
    maxConcurrency,
    async (row) => {
      if (row.provider !== "local_process" || !row.url) return row;
      if (!isRuntimeServiceHealthRefreshActive(row)) return row;
      if (!isPreviewHealthCheckStale(row, now, ttlMs)) return row;

      const reachable = await probePreviewUrlDeduped({
        key: row.id,
        url: row.url,
        probeUrl,
      });
      const nextHealth = nextRuntimeServiceHealthState(row, reachable, now);
      const changed =
        row.status !== nextHealth.status ||
        row.healthStatus !== nextHealth.healthStatus ||
        dateTime(row.stoppedAt) !== dateTime(nextHealth.stoppedAt) ||
        dateTime(row.healthCheckedAt) !== dateTime(now);

      if (!changed) return row;

      const update = {
        id: row.id,
        status: nextHealth.status,
        healthStatus: nextHealth.healthStatus,
        stoppedAt: nextHealth.stoppedAt,
        healthCheckedAt: now,
        updatedAt: now,
      };
      updates.push(update);
      return {
        ...row,
        status: update.status,
        healthStatus: update.healthStatus,
        stoppedAt: update.stoppedAt,
        healthCheckedAt: update.healthCheckedAt,
        updatedAt: update.updatedAt,
      };
    },
  );

  return { rows, updates };
}

async function persistRuntimeServiceHealthUpdates(
  db: Db,
  updates: PreviewRuntimeServiceUpdate[],
) {
  for (const update of updates) {
    await db
      .update(workspaceRuntimeServices)
      .set({
        status: update.status,
        healthStatus: update.healthStatus,
        stoppedAt: update.stoppedAt,
        healthCheckedAt: update.healthCheckedAt,
        updatedAt: update.updatedAt,
      })
      .where(eq(workspaceRuntimeServices.id, update.id));
  }
}

export async function refreshPersistedRuntimeServiceRows(input: {
  db: Db;
  rows: WorkspaceRuntimeServiceRow[];
  now?: Date;
  ttlMs?: number;
  maxConcurrency?: number;
  probeUrl?: (url: string) => Promise<boolean>;
}): Promise<WorkspaceRuntimeServiceRow[]> {
  const adapterRows = await refreshAdapterManagedPreviewRuntimeServiceRows(input);
  const localRows = await refreshLocalProcessRuntimeServiceRows({
    ...input,
    rows: adapterRows.rows,
  });
  await persistRuntimeServiceHealthUpdates(input.db, [
    ...adapterRows.updates,
    ...localRows.updates,
  ]);
  const changedIds = new Set([
    ...adapterRows.updates.map((update) => update.id),
    ...localRows.updates.map((update) => update.id),
  ]);
  for (const row of localRows.rows) {
    if (changedIds.has(row.id)) {
      await emitRuntimeServiceTaskOutput(input.db, row);
    }
  }
  return localRows.rows;
}

export async function refreshPersistedAdapterManagedPreviewRuntimeServices(input: {
  db: Db;
  rows: WorkspaceRuntimeServiceRow[];
}): Promise<WorkspaceRuntimeServiceRow[]> {
  const refreshed = await refreshAdapterManagedPreviewRuntimeServiceRows({ rows: input.rows });
  await persistRuntimeServiceHealthUpdates(input.db, refreshed.updates);
  const changedIds = new Set(refreshed.updates.map((update) => update.id));
  for (const row of refreshed.rows) {
    if (changedIds.has(row.id)) {
      await emitRuntimeServiceTaskOutput(input.db, row);
    }
  }
  return refreshed.rows;
}

async function startLocalRuntimeService(input: {
  db?: Db;
  runId: string;
  startedByRunId?: string | null;
  leaseRunId?: string | null;
  agent: ExecutionWorkspaceAgentRef;
  issue: ExecutionWorkspaceIssueRef | null;
  workspace: RealizedExecutionWorkspace;
  executionWorkspaceId?: string | null;
  adapterEnv: Record<string, string>;
  service: Record<string, unknown>;
  onLog?: (stream: "stdout" | "stderr", chunk: string) => Promise<void>;
  reuseKey: string | null;
  scopeType: "project_workspace" | "execution_workspace" | "run" | "agent";
  scopeId: string | null;
}): Promise<RuntimeServiceRecord> {
  const serviceName = asString(input.service.name, "service");
  const lifecycle = asString(input.service.lifecycle, "shared") === "ephemeral" ? "ephemeral" : "shared";
  const command = asString(input.service.command, "");
  if (!command) throw new Error(`Runtime service "${serviceName}" is missing command`);
  const serviceCwdTemplate = asString(input.service.cwd, ".");
  const portConfig = parseObject(input.service.port);
  const port = asString(portConfig.type, "") === "auto" ? await allocatePort() : null;
  const envConfig = parseObject(input.service.env);
  const templateData = buildTemplateData({
    workspace: input.workspace,
    agent: input.agent,
    issue: input.issue,
    adapterEnv: input.adapterEnv,
    port,
  });
  const serviceCwd = resolveConfiguredPath(renderTemplate(serviceCwdTemplate, templateData), input.workspace.cwd);
  const env: Record<string, string> = {
    ...sanitizeRuntimeServiceBaseEnv(process.env),
    ...input.adapterEnv,
  } as Record<string, string>;
  for (const [key, value] of Object.entries(envConfig)) {
    if (typeof value === "string") {
      env[key] = renderTemplate(value, templateData);
    }
  }
  if (port) {
    const portEnvKey = asString(portConfig.envKey, "PORT");
    env[portEnvKey] = String(port);
  }
  const shell = shellInvocation(command);
  const child = spawn(shell.command, shell.args, {
    cwd: serviceCwd,
    env,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderrExcerpt = "";
  let stdoutExcerpt = "";
  child.stdout?.on("data", async (chunk) => {
    const text = String(chunk);
    stdoutExcerpt = (stdoutExcerpt + text).slice(-4096);
    if (input.onLog) await input.onLog("stdout", `[service:${serviceName}] ${text}`);
  });
  child.stderr?.on("data", async (chunk) => {
    const text = String(chunk);
    stderrExcerpt = (stderrExcerpt + text).slice(-4096);
    if (input.onLog) await input.onLog("stderr", `[service:${serviceName}] ${text}`);
  });

  const expose = parseObject(input.service.expose);
  const readiness = parseObject(input.service.readiness);
  const urlTemplate =
    asString(expose.urlTemplate, "") ||
    asString(readiness.urlTemplate, "");
  const url = urlTemplate ? renderTemplate(urlTemplate, templateData) : null;

  try {
    await waitForReadiness({ service: input.service, url });
  } catch (err) {
    await terminateChildProcess(child);
    throw new Error(
      `Failed to start runtime service "${serviceName}": ${err instanceof Error ? err.message : String(err)}${stderrExcerpt ? ` | stderr: ${stderrExcerpt.trim()}` : ""}`,
    );
  }

  const envFingerprint = createHash("sha256").update(stableStringify(envConfig)).digest("hex");
  const startedByRunId = input.startedByRunId === undefined ? input.runId : input.startedByRunId;
  const leaseRunId = input.leaseRunId === undefined ? input.runId : input.leaseRunId;
  return {
    id: randomUUID(),
    companyId: input.agent.companyId,
    projectId: input.workspace.projectId,
    projectWorkspaceId: input.workspace.workspaceId,
    executionWorkspaceId: input.executionWorkspaceId ?? null,
    issueId: input.issue?.id ?? null,
    serviceName,
    status: "running",
    lifecycle,
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    reuseKey: input.reuseKey,
    command,
    cwd: serviceCwd,
    port,
    url,
    provider: "local_process",
    providerRef: child.pid ? String(child.pid) : null,
    ownerAgentId: input.agent.id,
    startedByRunId,
    lastUsedAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    stoppedAt: null,
    stopPolicy: parseObject(input.service.stopPolicy),
    healthStatus: "healthy",
    reused: false,
    db: input.db,
    child,
    leaseRunIds: leaseRunId ? new Set([leaseRunId]) : new Set(),
    idleTimer: null,
    envFingerprint,
  };
}

function scheduleIdleStop(record: RuntimeServiceRecord) {
  clearIdleTimer(record);
  const stopType = asString(record.stopPolicy?.type, "manual");
  if (stopType !== "idle_timeout") return;
  const idleSeconds = Math.max(1, asNumber(record.stopPolicy?.idleSeconds, 1800));
  record.idleTimer = setTimeout(() => {
    stopRuntimeService(record.id).catch(() => undefined);
  }, idleSeconds * 1000);
}

async function stopRuntimeService(serviceId: string) {
  const record = runtimeServicesById.get(serviceId);
  if (!record) return;
  clearIdleTimer(record);
  record.status = "stopped";
  record.lastUsedAt = new Date().toISOString();
  record.stoppedAt = new Date().toISOString();
  if (record.child && record.child.pid) {
    await terminateChildProcess(record.child);
  }
  runtimeServicesById.delete(serviceId);
  if (record.reuseKey) {
    runtimeServicesByReuseKey.delete(record.reuseKey);
  }
  await persistRuntimeServiceRecord(record.db, record);
}

async function markPersistedRuntimeServicesStoppedForExecutionWorkspace(input: {
  db: Db;
  executionWorkspaceId: string;
}) {
  const now = new Date();
  await input.db
    .update(workspaceRuntimeServices)
    .set({
      status: "stopped",
      healthStatus: "unknown",
      stoppedAt: now,
      lastUsedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(workspaceRuntimeServices.executionWorkspaceId, input.executionWorkspaceId),
        inArray(workspaceRuntimeServices.status, ["starting", "running"]),
      ),
    );
}

function registerRuntimeService(db: Db | undefined, record: RuntimeServiceRecord) {
  record.db = db;
  runtimeServicesById.set(record.id, record);
  if (record.reuseKey) {
    runtimeServicesByReuseKey.set(record.reuseKey, record.id);
  }

  record.child?.on("exit", (code, signal) => {
    const current = runtimeServicesById.get(record.id);
    if (!current) return;
    clearIdleTimer(current);
    current.status = code === 0 || signal === "SIGTERM" ? "stopped" : "failed";
    current.healthStatus = current.status === "failed" ? "unhealthy" : "unknown";
    current.lastUsedAt = new Date().toISOString();
    current.stoppedAt = new Date().toISOString();
    runtimeServicesById.delete(current.id);
    if (current.reuseKey && runtimeServicesByReuseKey.get(current.reuseKey) === current.id) {
      runtimeServicesByReuseKey.delete(current.reuseKey);
    }
    void persistRuntimeServiceRecord(db, current);
  });
}

export async function ensureRuntimeServicesForRun(input: {
  db?: Db;
  runId: string;
  agent: ExecutionWorkspaceAgentRef;
  issue: ExecutionWorkspaceIssueRef | null;
  workspace: RealizedExecutionWorkspace;
  executionWorkspaceId?: string | null;
  config: Record<string, unknown>;
  adapterEnv: Record<string, string>;
  onLog?: (stream: "stdout" | "stderr", chunk: string) => Promise<void>;
}): Promise<RuntimeServiceRef[]> {
  const runtime = parseObject(input.config.workspaceRuntime);
  const rawServices = Array.isArray(runtime.services)
    ? runtime.services.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    : [];
  const acquiredServiceIds: string[] = [];
  const refs: RuntimeServiceRef[] = [];
  runtimeServiceLeasesByRun.set(input.runId, acquiredServiceIds);

  try {
    for (const service of rawServices) {
      const lifecycle = asString(service.lifecycle, "shared") === "ephemeral" ? "ephemeral" : "shared";
      const { scopeType, scopeId } = resolveServiceScopeId({
        service,
        workspace: input.workspace,
        executionWorkspaceId: input.executionWorkspaceId,
        issue: input.issue,
        runId: input.runId,
        agent: input.agent,
      });
      const envConfig = parseObject(service.env);
      const envFingerprint = createHash("sha256").update(stableStringify(envConfig)).digest("hex");
      const serviceName = asString(service.name, "service");
      const reuseKey =
        lifecycle === "shared"
          ? [scopeType, scopeId ?? "", serviceName, envFingerprint].join(":")
          : null;

      if (reuseKey) {
        const existingId = runtimeServicesByReuseKey.get(reuseKey);
        const existing = existingId ? runtimeServicesById.get(existingId) : null;
        if (existing && existing.status === "running") {
          existing.leaseRunIds.add(input.runId);
          existing.lastUsedAt = new Date().toISOString();
          existing.stoppedAt = null;
          clearIdleTimer(existing);
          await persistRuntimeServiceRecord(input.db, existing);
          acquiredServiceIds.push(existing.id);
          refs.push(toRuntimeServiceRef(existing, { reused: true }));
          continue;
        }
      }

      const record = await startLocalRuntimeService({
        db: input.db,
        runId: input.runId,
        startedByRunId: input.runId,
        leaseRunId: input.runId,
        agent: input.agent,
        issue: input.issue,
        workspace: input.workspace,
        executionWorkspaceId: input.executionWorkspaceId,
        adapterEnv: input.adapterEnv,
        service,
        onLog: input.onLog,
        reuseKey,
        scopeType,
        scopeId,
      });
      registerRuntimeService(input.db, record);
      await persistRuntimeServiceRecord(input.db, record);
      acquiredServiceIds.push(record.id);
      refs.push(toRuntimeServiceRef(record));
    }
  } catch (err) {
    await releaseRuntimeServicesForRun(input.runId);
    throw err;
  }

  return refs;
}

export async function releaseRuntimeServicesForRun(runId: string) {
  const acquired = runtimeServiceLeasesByRun.get(runId) ?? [];
  runtimeServiceLeasesByRun.delete(runId);
  for (const serviceId of acquired) {
    const record = runtimeServicesById.get(serviceId);
    if (!record) continue;
    record.leaseRunIds.delete(runId);
    record.lastUsedAt = new Date().toISOString();
    const stopType = asString(record.stopPolicy?.type, record.lifecycle === "ephemeral" ? "on_run_finish" : "manual");
    await persistRuntimeServiceRecord(record.db, record);
    if (record.leaseRunIds.size === 0) {
      if (record.lifecycle === "ephemeral" || stopType === "on_run_finish") {
        await stopRuntimeService(serviceId);
        continue;
      }
      scheduleIdleStop(record);
    }
  }
}

export async function stopRuntimeServicesForExecutionWorkspace(input: {
  db?: Db;
  executionWorkspaceId: string;
  workspaceCwd?: string | null;
  runtimeServiceId?: string | null;
}) {
  const normalizedWorkspaceCwd = input.workspaceCwd ? path.resolve(input.workspaceCwd) : null;
  const matchingServiceIds = Array.from(runtimeServicesById.values())
    .filter((record) => {
      if (input.runtimeServiceId) return record.id === input.runtimeServiceId;
      if (record.executionWorkspaceId === input.executionWorkspaceId) return true;
      if (!normalizedWorkspaceCwd || !record.cwd) return false;
      const resolvedCwd = path.resolve(record.cwd);
      return (
        resolvedCwd === normalizedWorkspaceCwd ||
        resolvedCwd.startsWith(`${normalizedWorkspaceCwd}${path.sep}`)
      );
    })
    .map((record) => record.id);

  for (const serviceId of matchingServiceIds) {
    await stopRuntimeService(serviceId);
  }

  if (input.db) {
    if (input.runtimeServiceId) {
      const now = new Date();
      await input.db
        .update(workspaceRuntimeServices)
        .set({
          status: "stopped",
          healthStatus: "unknown",
          stoppedAt: now,
          lastUsedAt: now,
          updatedAt: now,
        })
        .where(eq(workspaceRuntimeServices.id, input.runtimeServiceId));
    } else {
      await markPersistedRuntimeServicesStoppedForExecutionWorkspace({
        db: input.db,
        executionWorkspaceId: input.executionWorkspaceId,
      });
    }
  }
}

export async function listWorkspaceRuntimeServicesForProjectWorkspaces(
  db: Db,
  companyId: string,
  projectWorkspaceIds: string[],
) {
  if (projectWorkspaceIds.length === 0) return new Map<string, typeof workspaceRuntimeServices.$inferSelect[]>();
  const rows = await db
    .select()
    .from(workspaceRuntimeServices)
    .where(
      and(
        eq(workspaceRuntimeServices.companyId, companyId),
        inArray(workspaceRuntimeServices.projectWorkspaceId, projectWorkspaceIds),
      ),
    )
    .orderBy(desc(workspaceRuntimeServices.updatedAt), desc(workspaceRuntimeServices.createdAt));

  const grouped = new Map<string, typeof workspaceRuntimeServices.$inferSelect[]>();
  for (const row of rows) {
    if (!row.projectWorkspaceId) continue;
    const existing = grouped.get(row.projectWorkspaceId);
    if (existing) existing.push(row);
    else grouped.set(row.projectWorkspaceId, [row]);
  }
  return grouped;
}

export async function reconcilePersistedRuntimeServicesOnStartup(db: Db) {
  const staleRows = await db
    .select({ id: workspaceRuntimeServices.id })
    .from(workspaceRuntimeServices)
    .where(
      and(
        eq(workspaceRuntimeServices.provider, "local_process"),
        inArray(workspaceRuntimeServices.status, ["starting", "running"]),
      ),
    );

  if (staleRows.length === 0) return { reconciled: 0 };

  const now = new Date();
  await db
    .update(workspaceRuntimeServices)
    .set({
      status: "stopped",
      healthStatus: "unknown",
      stoppedAt: now,
      lastUsedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(workspaceRuntimeServices.provider, "local_process"),
        inArray(workspaceRuntimeServices.status, ["starting", "running"]),
      ),
    );

  return { reconciled: staleRows.length };
}

export async function persistAdapterManagedRuntimeServices(input: {
  db: Db;
  adapterType: string;
  runId: string;
  agent: ExecutionWorkspaceAgentRef;
  issue: ExecutionWorkspaceIssueRef | null;
  workspace: RealizedExecutionWorkspace;
  executionWorkspaceId?: string | null;
  reports: AdapterRuntimeServiceReport[];
}) {
  const refs = normalizeAdapterManagedRuntimeServices(input);
  if (refs.length === 0) return refs;

  const existingRows = await input.db
    .select()
    .from(workspaceRuntimeServices)
    .where(inArray(workspaceRuntimeServices.id, refs.map((ref) => ref.id)));
  const existingById = new Map(existingRows.map((row) => [row.id, row]));

  for (const ref of refs) {
    const existing = existingById.get(ref.id);
    const startedAt = existing?.startedAt ?? new Date(ref.startedAt);
    const createdAt = existing?.createdAt ?? new Date();
    await input.db
      .insert(workspaceRuntimeServices)
      .values({
        id: ref.id,
        companyId: ref.companyId,
        projectId: ref.projectId,
        projectWorkspaceId: ref.projectWorkspaceId,
        executionWorkspaceId: ref.executionWorkspaceId,
        issueId: ref.issueId,
        scopeType: ref.scopeType,
        scopeId: ref.scopeId,
        serviceName: ref.serviceName,
        status: ref.status,
        lifecycle: ref.lifecycle,
        reuseKey: ref.reuseKey,
        command: ref.command,
        cwd: ref.cwd,
        port: ref.port,
        url: ref.url,
        provider: ref.provider,
        providerRef: ref.providerRef,
        ownerAgentId: ref.ownerAgentId,
        startedByRunId: ref.startedByRunId,
        lastUsedAt: new Date(ref.lastUsedAt),
        startedAt,
        stoppedAt: ref.stoppedAt ? new Date(ref.stoppedAt) : null,
        stopPolicy: ref.stopPolicy,
        healthStatus: ref.healthStatus,
        createdAt,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: workspaceRuntimeServices.id,
        set: {
          projectId: ref.projectId,
          projectWorkspaceId: ref.projectWorkspaceId,
          executionWorkspaceId: ref.executionWorkspaceId,
          issueId: ref.issueId,
          scopeType: ref.scopeType,
          scopeId: ref.scopeId,
          serviceName: ref.serviceName,
          status: ref.status,
          lifecycle: ref.lifecycle,
          reuseKey: ref.reuseKey,
          command: ref.command,
          cwd: ref.cwd,
          port: ref.port,
          url: ref.url,
          provider: ref.provider,
          providerRef: ref.providerRef,
          ownerAgentId: ref.ownerAgentId,
          startedByRunId: ref.startedByRunId,
          lastUsedAt: new Date(ref.lastUsedAt),
          startedAt,
          stoppedAt: ref.stoppedAt ? new Date(ref.stoppedAt) : null,
          stopPolicy: ref.stopPolicy,
          healthStatus: ref.healthStatus,
          updatedAt: new Date(),
        },
      });
    await emitRuntimeServiceTaskOutput(input.db, {
      id: ref.id,
      companyId: ref.companyId,
      projectId: ref.projectId,
      issueId: ref.issueId,
      executionWorkspaceId: ref.executionWorkspaceId,
      serviceName: ref.serviceName,
      provider: ref.provider,
      status: ref.status,
      healthStatus: ref.healthStatus,
      url: ref.url,
      port: ref.port,
      lifecycle: ref.lifecycle,
      scopeType: ref.scopeType,
      providerRef: ref.providerRef,
      startedByRunId: ref.startedByRunId,
      ownerAgentId: ref.ownerAgentId,
    });
  }

  return refs;
}

// ---------------------------------------------------------------------------
// Runtime service control — primitives (Task 7 / Bundle D.1)
// ---------------------------------------------------------------------------

export function resolveShell(): string {
  const fallback = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
  const shell = process.env.SHELL?.trim();
  if (!shell) return fallback;
  if (path.isAbsolute(shell)) {
    try {
      fs.access(shell);
    } catch {
      return fallback;
    }
  }
  return shell;
}

export async function resetRuntimeServicesForTests() {
  for (const record of runtimeServicesById.values()) {
    clearIdleTimer(record);
  }
  runtimeServicesById.clear();
  runtimeServicesByReuseKey.clear();
  runtimeServiceLeasesByRun.clear();
}

function looksLikeWorkspaceDevServerCommand(command: string) {
  const normalized = command.trim().toLowerCase();
  if (!normalized) return false;
  return /(?:^|\s)(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?dev(?:\s|$)/.test(normalized);
}

export function resolveWorkspaceRuntimeReadinessTimeoutSec(service: Record<string, unknown>) {
  const readiness = parseObject(service.readiness);
  const explicitTimeoutSec = asNumber(readiness.timeoutSec, 0);
  if (explicitTimeoutSec > 0) {
    return Math.max(1, explicitTimeoutSec);
  }
  return looksLikeWorkspaceDevServerCommand(asString(service.command, "")) ? 90 : 30;
}

export function resolveRuntimeServiceReadinessOptions(input: {
  service: Record<string, unknown>;
}): { timeoutSec: number; intervalMs: number; type: string } {
  const readiness = parseObject(input.service.readiness);
  return {
    type: asString(readiness.type, ""),
    timeoutSec: resolveWorkspaceRuntimeReadinessTimeoutSec(input.service),
    intervalMs: Math.max(100, asNumber(readiness.intervalMs, 500)),
  };
}

export function resolveConfiguredRuntimeServiceIndexForRow(input: {
  services: Record<string, unknown>[];
  row: {
    serviceName: string;
    command: string | null;
    cwd: string | null;
  };
  workspaceCwd: string | null;
}): number | null {
  const normalizedRowCwd = input.row.cwd ? path.resolve(input.row.cwd) : null;
  let matchIndex: number | null = null;
  for (let index = 0; index < input.services.length; index += 1) {
    const service = input.services[index]!;
    const name = asString(service.name, "service");
    const command = asString(service.command, "");
    const serviceCwd = asString(service.cwd, ".");
    const resolvedServiceCwd = input.workspaceCwd
      ? path.resolve(input.workspaceCwd, serviceCwd)
      : null;
    if (name !== input.row.serviceName) continue;
    if (input.row.command && command && input.row.command !== command) continue;
    if (normalizedRowCwd && resolvedServiceCwd && normalizedRowCwd !== resolvedServiceCwd) continue;
    if (matchIndex !== null) return null;
    matchIndex = index;
  }
  return matchIndex;
}

function readRuntimeServiceEntries(config: Record<string, unknown>): Record<string, unknown>[] {
  const runtime = parseObject(config.workspaceRuntime);
  const services = runtime.services;
  if (!Array.isArray(services)) return [];
  return services.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null);
}

export function listConfiguredRuntimeServiceEntries(config: Record<string, unknown>) {
  return readRuntimeServiceEntries(config);
}

function readConfiguredServiceStates(config: Record<string, unknown>): WorkspaceRuntimeServiceStateMap {
  const raw = parseObject(config.serviceStates);
  const states: WorkspaceRuntimeServiceStateMap = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === "running" || value === "stopped") {
      states[key] = value;
    }
  }
  return states;
}

export function buildWorkspaceRuntimeDesiredStatePatch(input: {
  config: Record<string, unknown>;
  currentDesiredState: WorkspaceRuntimeDesiredState | null;
  currentServiceStates: WorkspaceRuntimeServiceStateMap | null | undefined;
  action: "start" | "stop" | "restart";
  serviceIndex?: number | null;
}): {
  desiredState: WorkspaceRuntimeDesiredState;
  serviceStates: WorkspaceRuntimeServiceStateMap | null;
} {
  const configuredServices = listConfiguredRuntimeServiceEntries(input.config);
  const fallbackState: WorkspaceRuntimeDesiredState = input.currentDesiredState === "running" ? "running" : "stopped";
  const nextServiceStates: WorkspaceRuntimeServiceStateMap = {};

  for (let index = 0; index < configuredServices.length; index += 1) {
    nextServiceStates[String(index)] = input.currentServiceStates?.[String(index)] ?? fallbackState;
  }

  const nextState: WorkspaceRuntimeDesiredState = input.action === "stop" ? "stopped" : "running";
  if (input.serviceIndex === undefined || input.serviceIndex === null) {
    for (let index = 0; index < configuredServices.length; index += 1) {
      nextServiceStates[String(index)] = nextState;
    }
  } else if (input.serviceIndex >= 0 && input.serviceIndex < configuredServices.length) {
    nextServiceStates[String(input.serviceIndex)] = nextState;
  }

  const desiredState = Object.values(nextServiceStates).some((state) => state === "running") ? "running" : "stopped";

  return {
    desiredState,
    serviceStates: Object.keys(nextServiceStates).length > 0 ? nextServiceStates : null,
  };
}

function selectRuntimeServiceEntries(input: {
  config: Record<string, unknown>;
  serviceIndex?: number | null;
  respectDesiredStates?: boolean;
  defaultDesiredState?: WorkspaceRuntimeDesiredState | null;
  serviceStates?: WorkspaceRuntimeServiceStateMap | null;
}) {
  const entries = listConfiguredRuntimeServiceEntries(input.config);
  const states = input.serviceStates ?? readConfiguredServiceStates(input.config);
  const fallbackState: WorkspaceRuntimeDesiredState = input.defaultDesiredState === "running" ? "running" : "stopped";

  return entries.filter((_, index) => {
    if (input.serviceIndex !== undefined && input.serviceIndex !== null) {
      return index === input.serviceIndex;
    }
    if (!input.respectDesiredStates) return true;
    return (states[String(index)] ?? fallbackState) === "running";
  });
}

// ensureServerWorkspaceLinksCurrent — AoA port stub.
// Paperclip uses this to re-link pnpm workspace packages in git-worktree checkouts.
// AoA's runtime control flow does not require this for start/stop/restart (only for
// runWorkspaceJobForControl). Ported as a no-op; full implementation deferred.
export async function ensureServerWorkspaceLinksCurrent(
  _startCwd: string,
  _opts?: {
    onLog?: (stream: "stdout" | "stderr", chunk: string) => Promise<void>;
  },
): Promise<void> {
  return;
}

// ---------------------------------------------------------------------------
// Runtime service control — control functions (Task 7 / Bundle D.1)
// ---------------------------------------------------------------------------

export async function startRuntimeServicesForWorkspaceControl(input: {
  db?: Db;
  invocationId?: string;
  actor: ExecutionWorkspaceAgentRef;
  issue: ExecutionWorkspaceIssueRef | null;
  workspace: RealizedExecutionWorkspace;
  executionWorkspaceId?: string | null;
  config: Record<string, unknown>;
  adapterEnv: Record<string, string>;
  onLog?: (stream: "stdout" | "stderr", chunk: string) => Promise<void>;
  serviceIndex?: number | null;
  respectDesiredStates?: boolean;
}): Promise<RuntimeServiceRef[]> {
  const rawServices = selectRuntimeServiceEntries({
    config: input.config,
    serviceIndex: input.serviceIndex,
    respectDesiredStates: input.respectDesiredStates,
    defaultDesiredState: input.config.desiredState === "running" ? "running" : "stopped",
    serviceStates: readConfiguredServiceStates(input.config),
  });
  const refs: RuntimeServiceRef[] = [];
  const invocationId = input.invocationId ?? randomUUID();

  for (const service of rawServices) {
    const lifecycle = asString(service.lifecycle, "shared") === "ephemeral" ? "ephemeral" : "shared";
    const { scopeType, scopeId } = resolveServiceScopeId({
      service,
      workspace: input.workspace,
      executionWorkspaceId: input.executionWorkspaceId,
      issue: input.issue,
      runId: invocationId,
      agent: input.actor,
    });
    const envConfig = parseObject(service.env);
    const envFingerprint = createHash("sha256").update(stableStringify(envConfig)).digest("hex");
    const serviceName = asString(service.name, "service");
    const reuseKey =
      lifecycle === "shared"
        ? [scopeType, scopeId ?? "", serviceName, envFingerprint].join(":")
        : null;

    if (reuseKey) {
      const existingId = runtimeServicesByReuseKey.get(reuseKey);
      const existing = existingId ? runtimeServicesById.get(existingId) : null;
      if (existing && existing.status === "running") {
        existing.lastUsedAt = new Date().toISOString();
        existing.stoppedAt = null;
        clearIdleTimer(existing);
        await persistRuntimeServiceRecord(input.db, existing);
        refs.push(toRuntimeServiceRef(existing, { reused: true }));
        continue;
      }
    }

    // Manually controlled services are not tied to a heartbeat run lifecycle, so they do not
    // retain a run lease and never persist a startedByRunId foreign key.
    const record = await startLocalRuntimeService({
      db: input.db,
      runId: invocationId,
      startedByRunId: null,
      leaseRunId: null,
      agent: input.actor,
      issue: input.issue,
      workspace: input.workspace,
      executionWorkspaceId: input.executionWorkspaceId,
      adapterEnv: input.adapterEnv,
      service,
      onLog: input.onLog,
      reuseKey,
      scopeType,
      scopeId,
    });
    registerRuntimeService(input.db, record);
    await persistRuntimeServiceRecord(input.db, record);
    refs.push(toRuntimeServiceRef(record));
  }

  return refs;
}

export async function stopRuntimeServicesForProjectWorkspace(input: {
  db?: Db;
  projectWorkspaceId: string;
  runtimeServiceId?: string | null;
}) {
  const matchingServiceIds = Array.from(runtimeServicesById.values())
    .filter((record) => {
      if (input.runtimeServiceId) return record.id === input.runtimeServiceId;
      return record.projectWorkspaceId === input.projectWorkspaceId && record.scopeType === "project_workspace";
    })
    .map((record) => record.id);

  for (const serviceId of matchingServiceIds) {
    await stopRuntimeService(serviceId);
  }

  if (input.db) {
    const now = new Date();
    await input.db
      .update(workspaceRuntimeServices)
      .set({
        status: "stopped",
        healthStatus: "unknown",
        stoppedAt: now,
        lastUsedAt: now,
        updatedAt: now,
      })
      .where(
        input.runtimeServiceId
          ? eq(workspaceRuntimeServices.id, input.runtimeServiceId)
          : and(
              eq(workspaceRuntimeServices.projectWorkspaceId, input.projectWorkspaceId),
              eq(workspaceRuntimeServices.scopeType, "project_workspace"),
              inArray(workspaceRuntimeServices.status, ["starting", "running"]),
            ),
      );
  }
}

// Simplified one-shot job runner. Spawns a command in the workspace cwd, captures output,
// and records a workspace operation via the recorder when provided. Returns a minimal
// report compatible with the route's response shape.
export async function runWorkspaceJobForControl(input: {
  actor: ExecutionWorkspaceAgentRef;
  issue: ExecutionWorkspaceIssueRef | null;
  workspace: RealizedExecutionWorkspace;
  command: Record<string, unknown>;
  adapterEnv?: Record<string, string>;
  recorder?: WorkspaceOperationRecorder | null;
  metadata?: Record<string, unknown> | null;
}): Promise<{
  id: string | null;
  name: string;
  status: "succeeded" | "failed";
  exitCode: number | null;
  stdout: string;
  stderr: string;
}> {
  const name = asString(input.command.name, "workspace-job");
  const rawCommand = asString(input.command.command, "");
  if (!rawCommand) {
    throw new Error(`Workspace job "${name}" is missing command`);
  }
  const renderContext = {
    workspace: {
      cwd: input.workspace.cwd,
      branchName: input.workspace.branchName ?? "",
      projectId: input.workspace.projectId ?? "",
      workspaceId: input.workspace.workspaceId ?? "",
    },
    issue: input.issue ?? {},
    agent: input.actor,
  };
  const command = renderTemplate(rawCommand, renderContext);
  const cwd = input.workspace.cwd;
  const baseEnv = sanitizeRuntimeServiceBaseEnv({ ...process.env });
  const env: NodeJS.ProcessEnv = { ...baseEnv, ...(input.adapterEnv ?? {}) };

  const runJob = async (): Promise<{
    status: "succeeded" | "failed";
    exitCode: number;
    stdout: string;
    stderr: string;
  }> => {
    await ensureServerWorkspaceLinksCurrent(cwd);
    return new Promise((resolve) => {
      const shell = resolveShell();
      const child = spawn(command, {
        cwd,
        env,
        shell,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
      child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
      child.on("error", (err) => {
        resolve({ status: "failed", exitCode: -1, stdout, stderr: stderr + String(err) });
      });
      child.on("close", (code) => {
        resolve({
          status: code === 0 ? "succeeded" : "failed",
          exitCode: code ?? -1,
          stdout,
          stderr,
        });
      });
    });
  };

  let operationId: string | null = null;
  let result: { status: "succeeded" | "failed"; exitCode: number; stdout: string; stderr: string };

  if (input.recorder) {
    const operation = await input.recorder.recordOperation({
      phase: "workspace_provision",
      command,
      cwd,
      metadata: {
        workspaceCommandKind: "job",
        workspaceCommandName: name,
        ...(input.metadata ?? {}),
      },
      run: async () => {
        result = await runJob();
        return {
          status: result.status,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          system: result.status === "succeeded" ? `Completed workspace job "${name}"\n` : undefined,
        };
      },
    });
    operationId = operation?.id ?? null;
  } else {
    result = await runJob();
  }

  return {
    id: operationId,
    name,
    status: result!.status,
    exitCode: result!.exitCode,
    stdout: result!.stdout,
    stderr: result!.stderr,
  };
}

// ---------------------------------------------------------------------------
// Runtime service boot restart (Task 7 / Bundle D.1 / gap #12)
// ---------------------------------------------------------------------------

export async function restartDesiredRuntimeServicesOnStartup(db: Db) {
  let restarted = 0;
  let failed = 0;

  const projectWorkspaceRows = await db.select().from(projectWorkspaces);
  const projectWorkspaceRowsById = new Map(projectWorkspaceRows.map((row) => [row.id, row] as const));

  for (const row of projectWorkspaceRows) {
    const runtimeConfig = readProjectWorkspaceRuntimeConfig((row.metadata as Record<string, unknown> | null) ?? null);
    if (runtimeConfig?.desiredState !== "running" || !runtimeConfig.workspaceRuntime || !row.cwd) continue;

    try {
      const refs = await startRuntimeServicesForWorkspaceControl({
        db,
        actor: { id: null, name: "AoA", companyId: row.companyId },
        issue: null,
        workspace: {
          baseCwd: row.cwd,
          source: "project_primary",
          projectId: row.projectId,
          workspaceId: row.id,
          repoUrl: row.repoUrl ?? null,
          repoRef: row.repoRef ?? null,
          strategy: "project_primary",
          cwd: row.cwd,
          branchName: row.defaultRef ?? row.repoRef ?? null,
          worktreePath: null,
          warnings: [],
          created: false,
        },
        config: {
          workspaceRuntime: runtimeConfig.workspaceRuntime,
          desiredState: runtimeConfig.desiredState,
          serviceStates: runtimeConfig.serviceStates ?? null,
        },
        adapterEnv: {},
        respectDesiredStates: true,
      });
      if (refs.length > 0) restarted += refs.filter((ref) => !ref.reused).length;
    } catch {
      failed += 1;
    }
  }

  const executionWorkspaceRows = await db
    .select()
    .from(executionWorkspaces)
    .where(inArray(executionWorkspaces.status, ["active", "idle", "in_review", "cleanup_failed"]));

  for (const row of executionWorkspaceRows) {
    const config = readExecutionWorkspaceConfig((row.metadata as Record<string, unknown> | null) ?? null);
    const inheritedRuntimeConfig = row.projectWorkspaceId
      ? readProjectWorkspaceRuntimeConfig(
          (projectWorkspaceRowsById.get(row.projectWorkspaceId)?.metadata as Record<string, unknown> | null) ?? null,
        )?.workspaceRuntime ?? null
      : null;
    const effectiveRuntimeConfig = config?.workspaceRuntime ?? inheritedRuntimeConfig;
    if (config?.desiredState !== "running" || !effectiveRuntimeConfig || !row.cwd) continue;

    try {
      const refs = await startRuntimeServicesForWorkspaceControl({
        db,
        actor: { id: null, name: "AoA", companyId: row.companyId },
        issue: row.sourceIssueId
          ? { id: row.sourceIssueId, identifier: null, title: row.name }
          : null,
        workspace: {
          baseCwd: row.cwd,
          source: row.mode === "shared_workspace" ? "project_primary" : "task_session",
          projectId: row.projectId,
          workspaceId: row.projectWorkspaceId ?? null,
          repoUrl: row.repoUrl ?? null,
          repoRef: row.baseRef ?? null,
          strategy: row.strategyType === "git_worktree" ? "git_worktree" : "project_primary",
          cwd: row.cwd,
          branchName: row.branchName ?? null,
          worktreePath: row.strategyType === "git_worktree" ? row.cwd : null,
          warnings: [],
          created: false,
        },
        executionWorkspaceId: row.id,
        config: {
          workspaceRuntime: effectiveRuntimeConfig,
          desiredState: config.desiredState,
          serviceStates: config.serviceStates ?? null,
        },
        adapterEnv: {},
        respectDesiredStates: true,
      });
      if (refs.length > 0) restarted += refs.filter((ref) => !ref.reused).length;
    } catch {
      failed += 1;
    }
  }

  return { restarted, failed };
}

// ---------------------------------------------------------------------------

export function buildWorkspaceReadyComment(input: {
  workspace: RealizedExecutionWorkspace;
  runtimeServices: RuntimeServiceRef[];
}) {
  const lines = ["## Workspace Ready", ""];
  lines.push(`- Strategy: \`${input.workspace.strategy}\``);
  if (input.workspace.branchName) lines.push(`- Branch: \`${input.workspace.branchName}\``);
  lines.push(`- CWD: \`${input.workspace.cwd}\``);
  if (input.workspace.worktreePath && input.workspace.worktreePath !== input.workspace.cwd) {
    lines.push(`- Worktree: \`${input.workspace.worktreePath}\``);
  }
  for (const service of input.runtimeServices) {
    const detail = service.url ? `${service.serviceName}: ${service.url}` : `${service.serviceName}: running`;
    const suffix = service.reused ? " (reused)" : "";
    lines.push(`- Service: ${detail}${suffix}`);
  }
  return lines.join("\n");
}
