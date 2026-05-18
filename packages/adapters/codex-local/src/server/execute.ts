import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  runAdapterExecutionTargetProcess,
  type AdapterExecutionContext,
  type AdapterExecutionResult,
} from "@armyofagents/adapter-utils";
import {
  asString,
  asNumber,
  asBoolean,
  asStringArray,
  parseObject,
  buildAoaEnv,
  redactEnvForLogs,
  ensureAbsoluteDirectory,
  ensureCommandResolvable,
  ensurePathInEnv,
  renderTemplate,
  applyAoaWorkspaceEnv,
} from "@armyofagents/adapter-utils/server-utils";
import { parseCodexJsonl, isCodexUnknownSessionError } from "./parse.js";
import { isCodexLocalFastModeSupported, CODEX_LOCAL_FAST_MODE_SUPPORTED_MODELS } from "../index.js";
import { prepareManagedCodexHome } from "./codex-home.js";
import { writeCodexMcpConfigToml } from "./codex-config-toml.js";

const __moduleDir = path.dirname(fileURLToPath(import.meta.url));
const AOA_SKILLS_CANDIDATES = [
  path.resolve(__moduleDir, "../../skills"),         // published: <pkg>/dist/server/ -> <pkg>/skills/
  path.resolve(__moduleDir, "../../../../../skills"), // dev: src/server/ -> repo root/skills/
];
const CODEX_ROLLOUT_NOISE_RE =
  /^\d{4}-\d{2}-\d{2}T[^\s]+\s+ERROR\s+codex_core::rollout::list:\s+state db missing rollout path for thread\s+[a-z0-9-]+$/i;

function stripCodexRolloutNoise(text: string): string {
  const parts = text.split(/\r?\n/);
  const kept: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) {
      kept.push(part);
      continue;
    }
    if (CODEX_ROLLOUT_NOISE_RE.test(trimmed)) continue;
    kept.push(part);
  }
  return kept.join("\n");
}

function firstNonEmptyLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function hasNonEmptyEnvValue(env: Record<string, string>, key: string): boolean {
  const raw = env[key];
  return typeof raw === "string" && raw.trim().length > 0;
}

function resolveCodexBillingType(env: Record<string, string>): "api" | "subscription" {
  // Codex uses API-key auth when OPENAI_API_KEY is present; otherwise rely on local login/session auth.
  return hasNonEmptyEnvValue(env, "OPENAI_API_KEY") ? "api" : "subscription";
}

function codexHomeDir(): string {
  const fromEnv = process.env.CODEX_HOME;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) return fromEnv.trim();
  return path.join(os.homedir(), ".codex");
}

function isAlreadyExistsError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = "code" in err ? String((err as NodeJS.ErrnoException).code) : "";
  return code === "EEXIST" || code === "ERR_FS_CP_EEXIST" || /\bEEXIST\b|already exists/i.test(err.message);
}

export async function linkOrCopyCodexSkill({
  source,
  target,
  entryName,
  skillsHome,
  onLog,
  linkSkill = (linkSource, linkTarget, type) => fs.symlink(linkSource, linkTarget, type),
  copySkill = (copySource, copyTarget, options) => fs.cp(copySource, copyTarget, options),
}: {
  source: string;
  target: string;
  entryName: string;
  skillsHome: string;
  onLog: AdapterExecutionContext["onLog"];
  linkSkill?: (
    source: string,
    target: string,
    type?: "dir" | "file" | "junction",
  ) => Promise<void>;
  copySkill?: (
    source: string,
    target: string,
    options: { recursive: true },
  ) => Promise<void>;
}) {
  try {
    await linkSkill(source, target, process.platform === "win32" ? "junction" : undefined);
    await onLog(
      "stderr",
      `[aoa] Injected Codex skill "${entryName}" into ${skillsHome}\n`,
    );
  } catch (err) {
    if (isAlreadyExistsError(err)) {
      await onLog(
        "stderr",
        `[aoa] Codex skill "${entryName}" already exists in ${skillsHome}; skipping injection\n`,
      );
      return;
    }
    try {
      await copySkill(source, target, { recursive: true });
      await onLog(
        "stderr",
        `[aoa] Copied Codex skill "${entryName}" into ${skillsHome} after link failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    } catch (copyErr) {
      if (isAlreadyExistsError(copyErr)) {
        await onLog(
          "stderr",
          `[aoa] Codex skill "${entryName}" already exists in ${skillsHome}; skipping injection\n`,
        );
        return;
      }
      throw copyErr;
    }
  }
}

async function resolvePaperclipSkillsDir(): Promise<string | null> {
  for (const candidate of AOA_SKILLS_CANDIDATES) {
    const isDir = await fs.stat(candidate).then((s) => s.isDirectory()).catch(() => false);
    if (isDir) return candidate;
  }
  return null;
}

async function ensureCodexSkillsInjected(onLog: AdapterExecutionContext["onLog"]) {
  const skillsDir = await resolvePaperclipSkillsDir();
  if (!skillsDir) return;

  const skillsHome = path.join(codexHomeDir(), "skills");
  await fs.mkdir(skillsHome, { recursive: true });
  const entries = await fs.readdir(skillsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const source = path.join(skillsDir, entry.name);
    const target = path.join(skillsHome, entry.name);
    const existing = await fs.lstat(target).catch(() => null);
    if (existing) continue;

    await linkOrCopyCodexSkill({ source, target, entryName: entry.name, skillsHome, onLog });
  }
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, runtime, config, context, onLog, onMeta, authToken, onSpawn } = ctx;
  const executionTarget = ctx.executionTarget ?? { type: "local" as const };

  const promptTemplate = asString(
    config.promptTemplate,
    [
      "You are agent {{agent.id}} ({{agent.name}}). Continue your AoA work.",
      "{{context.currentTaskMarkdown}}",
    ].join("\n\n"),
  );
  const command = asString(config.command, "codex");
  const model = asString(config.model, "");
  const modelReasoningEffort = asString(
    config.modelReasoningEffort,
    asString(config.reasoningEffort, ""),
  );
  const search = asBoolean(config.search, false);
  const bypass = asBoolean(
    config.dangerouslyBypassApprovalsAndSandbox,
    asBoolean(config.dangerouslyBypassSandbox, false),
  );
  const fastModeRequested = asBoolean(config.fastMode, false);
  const fastModeApplied = fastModeRequested && isCodexLocalFastModeSupported(model);

  const workspaceContext = parseObject(context.paperclipWorkspace);
  const workspaceCwd = asString(workspaceContext.cwd, "");
  const workspaceSource = asString(workspaceContext.source, "");
  const workspaceId = asString(workspaceContext.workspaceId, "");
  const workspaceRepoUrl = asString(workspaceContext.repoUrl, "");
  const workspaceRepoRef = asString(workspaceContext.repoRef, "");
  const workspaceHints = Array.isArray(context.paperclipWorkspaces)
    ? context.paperclipWorkspaces.filter(
        (value): value is Record<string, unknown> => typeof value === "object" && value !== null,
      )
    : [];
  const configuredCwd = asString(config.cwd, "");
  const useConfiguredInsteadOfAgentHome = workspaceSource === "agent_home" && configuredCwd.length > 0;
  const effectiveWorkspaceCwd = useConfiguredInsteadOfAgentHome ? "" : workspaceCwd;
  const cwd = effectiveWorkspaceCwd || configuredCwd || process.cwd();
  await ensureAbsoluteDirectory(cwd, { createIfMissing: true });
  await ensureCodexSkillsInjected(onLog);
  const envConfig = parseObject(config.env);
  const hasExplicitApiKey =
    typeof envConfig.AOA_API_KEY === "string" && envConfig.AOA_API_KEY.trim().length > 0;
  const env: Record<string, string> = { ...buildAoaEnv(agent) };
  env.AOA_RUN_ID = runId;
  const wakeTaskId =
    (typeof context.taskId === "string" && context.taskId.trim().length > 0 && context.taskId.trim()) ||
    (typeof context.issueId === "string" && context.issueId.trim().length > 0 && context.issueId.trim()) ||
    null;
  const wakeReason =
    typeof context.wakeReason === "string" && context.wakeReason.trim().length > 0
      ? context.wakeReason.trim()
      : null;
  const wakeCommentId =
    (typeof context.wakeCommentId === "string" && context.wakeCommentId.trim().length > 0 && context.wakeCommentId.trim()) ||
    (typeof context.commentId === "string" && context.commentId.trim().length > 0 && context.commentId.trim()) ||
    null;
  const approvalId =
    typeof context.approvalId === "string" && context.approvalId.trim().length > 0
      ? context.approvalId.trim()
      : null;
  const approvalStatus =
    typeof context.approvalStatus === "string" && context.approvalStatus.trim().length > 0
      ? context.approvalStatus.trim()
      : null;
  const linkedIssueIds = Array.isArray(context.issueIds)
    ? context.issueIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  if (wakeTaskId) {
    env.AOA_TASK_ID = wakeTaskId;
  }
  if (wakeReason) {
    env.AOA_WAKE_REASON = wakeReason;
  }
  if (wakeCommentId) {
    env.AOA_WAKE_COMMENT_ID = wakeCommentId;
  }
  if (approvalId) {
    env.AOA_APPROVAL_ID = approvalId;
  }
  if (approvalStatus) {
    env.AOA_APPROVAL_STATUS = approvalStatus;
  }
  if (linkedIssueIds.length > 0) {
    env.AOA_LINKED_ISSUE_IDS = linkedIssueIds.join(",");
  }
  applyAoaWorkspaceEnv(env, {
    workspaceCwd: effectiveWorkspaceCwd || null,
    workspaceSource: workspaceSource || null,
    workspaceStrategy: asString(workspaceContext.strategy, "") || null,
    workspaceId: workspaceId || null,
    workspaceRepoUrl: workspaceRepoUrl || null,
    workspaceRepoRef: workspaceRepoRef || null,
    workspaceBranch: asString(workspaceContext.branchName, "") || null,
    workspaceWorktreePath: asString(workspaceContext.worktreePath, "") || null,
    agentHome: asString(workspaceContext.agentHome, "") || null,
  });
  if (workspaceHints.length > 0) {
    env.AOA_WORKSPACES_JSON = JSON.stringify(workspaceHints);
  }
  for (const [k, v] of Object.entries(envConfig)) {
    if (typeof v === "string") env[k] = v;
  }
  if (!hasExplicitApiKey && authToken) {
    env.AOA_API_KEY = authToken;
  }

  const configuredOpenAiApiKey =
    typeof env.OPENAI_API_KEY === "string" && env.OPENAI_API_KEY.trim().length > 0
      ? env.OPENAI_API_KEY.trim()
      : null;

  const managedCodexHome = await prepareManagedCodexHome(
    process.env,
    (msg) => onLog("stderr", `${msg}\n`),
    agent.companyId,
    { apiKey: configuredOpenAiApiKey },
  );
  env.CODEX_HOME = executionTarget.type === "sandbox-docker"
    ? "/tmp/aoa-codex-home"
    : managedCodexHome;

  // MX3: deliver the internal-agent MCP bridge to codex via its native
  // discovery mechanism — a [mcp_servers.aoa] (+ .env) table in the
  // adapter-managed CODEX_HOME/config.toml that `codex exec` already runs
  // against. codex does NOT accept a --mcp-config flag, so this is the only
  // path. The managed home is adapter-owned (only holds auth.json + this
  // file); writeCodexMcpConfigToml preserves any unrelated content and is
  // idempotent. auth.json is untouched; CODEX_HOME's value is unchanged.
  if (ctx.mcpBridge) {
    if (executionTarget.type === "sandbox-docker") {
      // MX3: sandbox-docker codex MCP wiring is a follow-up — CODEX_HOME there
      // is the container path "/tmp/aoa-codex-home" which is not writable from
      // the host at this point. The §17 acceptance path is type:"local".
      await onLog(
        "stderr",
        `[aoa] codex MCP bridge config.toml is not yet wired for sandbox-docker execution targets; skipping (MX3 follow-up).\n`,
      );
    } else {
      await writeCodexMcpConfigToml(managedCodexHome, ctx.mcpBridge);
      await onLog(
        "stderr",
        `[aoa] Wrote managed Codex config.toml [mcp_servers.aoa] for company ${agent.companyId}\n`,
      );
    }
  }

  const billingType = resolveCodexBillingType(env);
  const runtimeEnv = ensurePathInEnv({ ...process.env, ...env });
  if (executionTarget.type === "local") {
    await ensureCommandResolvable(command, cwd, runtimeEnv);
  }

  const timeoutSec = asNumber(config.timeoutSec, 0);
  const graceSec = asNumber(config.graceSec, 20);
  const extraArgs = (() => {
    const fromExtraArgs = asStringArray(config.extraArgs);
    if (fromExtraArgs.length > 0) return fromExtraArgs;
    return asStringArray(config.args);
  })();

  const runtimeSessionParams = parseObject(runtime.sessionParams);
  const runtimeSessionId = asString(runtimeSessionParams.sessionId, runtime.sessionId ?? "");
  const runtimeSessionCwd = asString(runtimeSessionParams.cwd, "");
  const canResumeSession =
    runtimeSessionId.length > 0 &&
    (runtimeSessionCwd.length === 0 || path.resolve(runtimeSessionCwd) === path.resolve(cwd));
  const sessionId = canResumeSession ? runtimeSessionId : null;
  if (runtimeSessionId && !canResumeSession) {
    await onLog(
      "stderr",
      `[aoa] Codex session "${runtimeSessionId}" was saved for cwd "${runtimeSessionCwd}" and will not be resumed in "${cwd}".\n`,
    );
  }
  const instructionsFilePath = asString(config.instructionsFilePath, "").trim();
  const instructionsDir = instructionsFilePath ? `${path.dirname(instructionsFilePath)}/` : "";
  let instructionsPrefix = "";
  if (instructionsFilePath) {
    try {
      const instructionsContents = await fs.readFile(instructionsFilePath, "utf8");
      instructionsPrefix =
        `${instructionsContents}\n\n` +
        `The above agent instructions were loaded from ${instructionsFilePath}. ` +
        `Resolve any relative file references from ${instructionsDir}.\n\n`;
      await onLog(
        "stderr",
        `[aoa] Loaded agent instructions file: ${instructionsFilePath}\n`,
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await onLog(
        "stderr",
        `[aoa] Warning: could not read agent instructions file "${instructionsFilePath}": ${reason}\n`,
      );
    }
  }
  const commandNotes = (() => {
    const notes = [`Execution target: ${executionTarget.type}`];
    if (!instructionsFilePath) return notes;
    if (instructionsPrefix.length > 0) {
      return [
        ...notes,
        `Loaded agent instructions from ${instructionsFilePath}`,
        `Prepended instructions + path directive to stdin prompt (relative references from ${instructionsDir}).`,
      ];
    }
    return [
      ...notes,
      `Configured instructionsFilePath ${instructionsFilePath}, but file could not be read; continuing without injected instructions.`,
    ];
  })();
  const renderedPrompt = renderTemplate(promptTemplate, {
    agentId: agent.id,
    companyId: agent.companyId,
    runId,
    company: { id: agent.companyId },
    agent,
    run: { id: runId, source: "on_demand" },
    context,
  });
  const prompt = `${instructionsPrefix}${renderedPrompt}`;

  const buildArgs = (resumeSessionId: string | null) => {
    const args = ["exec", "--json"];
    if (search) args.unshift("--search");
    if (bypass) args.push("--dangerously-bypass-approvals-and-sandbox");
    if (model) args.push("--model", model);
    if (modelReasoningEffort) args.push("-c", `model_reasoning_effort=${JSON.stringify(modelReasoningEffort)}`);
    if (fastModeApplied) {
      // service_tier expects a quoted string ("fast"); features.fast_mode expects an
      // unquoted boolean (true). JSON.stringify happens to produce both correctly.
      args.push("-c", `service_tier=${JSON.stringify("fast")}`);
      args.push("-c", `features.fast_mode=${JSON.stringify(true)}`);
    }
    if (extraArgs.length > 0) args.push(...extraArgs);
    if (resumeSessionId) args.push("resume", resumeSessionId, "-");
    else args.push("-");
    return args;
  };

  if (fastModeRequested && !fastModeApplied) {
    await onLog(
      "stderr",
      `[aoa] fastMode requested but model "${model || "(none)"}" does not support it (supported: ${CODEX_LOCAL_FAST_MODE_SUPPORTED_MODELS.join(", ")}); ignoring.\n`,
    );
  }

  const runAttempt = async (resumeSessionId: string | null) => {
    const args = buildArgs(resumeSessionId);
    if (onMeta) {
      await onMeta({
        adapterType: "codex_local",
        command,
        cwd,
        commandNotes,
        commandArgs: args.map((value, idx) => {
          if (idx === args.length - 1 && value !== "-") return `<prompt ${prompt.length} chars>`;
          return value;
        }),
        env: redactEnvForLogs(env),
        prompt,
        context,
      });
    }

    const proc = await runAdapterExecutionTargetProcess(executionTarget, {
      runId,
      command,
      args,
      cwd,
      env,
      stdin: prompt,
      authToken: env.AOA_API_KEY ?? authToken ?? null,
      apiBaseUrl: env.AOA_API_URL ?? null,
      runtimeCommandSpec: ctx.runtimeCommandSpec ?? null,
      timeoutSec,
      graceSec,
      onLog: async (stream, chunk) => {
        if (stream !== "stderr") {
          await onLog(stream, chunk);
          return;
        }
        const cleaned = stripCodexRolloutNoise(chunk);
        if (!cleaned.trim()) return;
        await onLog(stream, cleaned);
      },
      onSpawn,
    });
    const cleanedStderr = stripCodexRolloutNoise(proc.stderr);
    return {
      proc: {
        ...proc,
        stderr: cleanedStderr,
      },
      rawStderr: proc.stderr,
      parsed: parseCodexJsonl(proc.stdout),
    };
  };

  const toResult = (
    attempt: { proc: { exitCode: number | null; signal: string | null; timedOut: boolean; stdout: string; stderr: string }; rawStderr: string; parsed: ReturnType<typeof parseCodexJsonl> },
    clearSessionOnMissingSession = false,
  ): AdapterExecutionResult => {
    if (attempt.proc.timedOut) {
      return {
        exitCode: attempt.proc.exitCode,
        signal: attempt.proc.signal,
        timedOut: true,
        errorMessage: `Timed out after ${timeoutSec}s`,
        clearSession: clearSessionOnMissingSession,
      };
    }

    const resolvedSessionId = attempt.parsed.sessionId ?? runtimeSessionId ?? runtime.sessionId ?? null;
    const resolvedSessionParams = resolvedSessionId
      ? ({
        sessionId: resolvedSessionId,
        cwd,
        ...(workspaceId ? { workspaceId } : {}),
        ...(workspaceRepoUrl ? { repoUrl: workspaceRepoUrl } : {}),
        ...(workspaceRepoRef ? { repoRef: workspaceRepoRef } : {}),
      } as Record<string, unknown>)
      : null;
    const parsedError = typeof attempt.parsed.errorMessage === "string" ? attempt.parsed.errorMessage.trim() : "";
    const stderrLine = firstNonEmptyLine(attempt.proc.stderr);
    const fallbackErrorMessage =
      parsedError ||
      stderrLine ||
      `Codex exited with code ${attempt.proc.exitCode ?? -1}`;

    return {
      exitCode: attempt.proc.exitCode,
      signal: attempt.proc.signal,
      timedOut: false,
      errorMessage:
        (attempt.proc.exitCode ?? 0) === 0
          ? null
          : fallbackErrorMessage,
      usage: attempt.parsed.usage,
      sessionId: resolvedSessionId,
      sessionParams: resolvedSessionParams,
      sessionDisplayId: resolvedSessionId,
      provider: "openai",
      model,
      billingType,
      costUsd: null,
      resultJson: {
        stdout: attempt.proc.stdout,
        stderr: attempt.proc.stderr,
      },
      summary: attempt.parsed.summary,
      clearSession: Boolean(clearSessionOnMissingSession && !resolvedSessionId),
    };
  };

  const initial = await runAttempt(sessionId);
  if (
    sessionId &&
    !initial.proc.timedOut &&
    (initial.proc.exitCode ?? 0) !== 0 &&
    isCodexUnknownSessionError(initial.proc.stdout, initial.rawStderr)
  ) {
    await onLog(
      "stderr",
      `[aoa] Codex resume session "${sessionId}" is unavailable; retrying with a fresh session.\n`,
    );
    const retry = await runAttempt(null);
    return toResult(retry, true);
  }

  return toResult(initial);
}
