import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  adapterExecutionTargetIsRemote,
  adapterExecutionTargetRemoteCwd,
  adapterExecutionTargetSessionIdentity,
  adapterExecutionTargetSessionMatches,
  adapterExecutionTargetUsesManagedHome,
  prepareAdapterExecutionTargetRuntime,
  runAdapterExecutionTargetProcess,
  syncAdapterExecutionTargetDirectory,
  syncAdapterExecutionTargetFile,
  type AdapterBillingType,
  type AdapterExecutionContext,
  type AdapterExecutionResult,
} from "@armyofagents/adapter-utils";
import type { RunProcessResult } from "@armyofagents/adapter-utils/server-utils";
import {
  asString,
  asNumber,
  asBoolean,
  asStringArray,
  parseObject,
  parseJson,
  buildAoaEnv,
  redactEnvForLogs,
  ensureAbsoluteDirectory,
  ensureCommandResolvable,
  ensurePathInEnv,
  renderTemplate,
  runChildProcess,
  applyAoaWorkspaceEnv,
} from "@armyofagents/adapter-utils/server-utils";
import {
  parseClaudeStreamJson,
  describeClaudeFailure,
  detectClaudeLoginRequired,
  isClaudeMaxTurnsResult,
  isClaudeUnknownSessionError,
} from "./parse.js";
import {
  buildPreToolUseSettings,
  writeRuntimeHookSettingsFile,
} from "./runtime-hook-settings.js";

const __moduleDir = path.dirname(fileURLToPath(import.meta.url));
const AOA_SKILLS_CANDIDATES = [
  path.resolve(__moduleDir, "../../skills"),         // published: <pkg>/dist/server/ -> <pkg>/skills/
  path.resolve(__moduleDir, "../../../../../skills"), // dev: src/server/ -> repo root/skills/
];

async function resolvePaperclipSkillsDir(): Promise<string | null> {
  for (const candidate of AOA_SKILLS_CANDIDATES) {
    const isDir = await fs.stat(candidate).then((s) => s.isDirectory()).catch(() => false);
    if (isDir) return candidate;
  }
  return null;
}

/**
 * Create a tmpdir with `.claude/skills/` containing symlinks to skills from
 * the repo's `skills/` directory, so `--add-dir` makes Claude Code discover
 * them as proper registered skills.
 */
async function buildSkillsDir(
  dbSkills?: Array<{ key: string; name: string; markdown: string; files?: Array<{ path: string; content: string }> }>,
): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-skills-"));
  const target = path.join(tmp, ".claude", "skills");
  await fs.mkdir(target, { recursive: true });
  const skillsDir = await resolvePaperclipSkillsDir();
  if (skillsDir) {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const src = path.join(skillsDir, entry.name);
        const dest = path.join(target, entry.name);
        try {
          await fs.symlink(src, dest, process.platform === "win32" ? "junction" : undefined);
        } catch {
          // Fallback to copy if symlink/junction fails (Windows without admin)
          await fs.cp(src, dest, { recursive: true });
        }
      }
    }
  }
  // Write DB-backed company skills
  if (dbSkills) {
    for (const skill of dbSkills) {
      const skillFolderName = skill.key.replace(/\//g, "--");
      const skillDir = path.join(target, skillFolderName);
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(path.join(skillDir, "SKILL.md"), skill.markdown, "utf-8");
      for (const file of skill.files ?? []) {
        const fullPath = path.join(skillDir, file.path);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, file.content, "utf-8");
      }
    }
  }
  return tmp;
}

interface ClaudeExecutionInput {
  runId: string;
  agent: AdapterExecutionContext["agent"];
  config: Record<string, unknown>;
  context: Record<string, unknown>;
  authToken?: string;
  executionTarget?: AdapterExecutionContext["executionTarget"];
}

interface ClaudeRuntimeConfig {
  command: string;
  cwd: string;
  workspaceId: string | null;
  workspaceRepoUrl: string | null;
  workspaceRepoRef: string | null;
  env: Record<string, string>;
  timeoutSec: number;
  graceSec: number;
  extraArgs: string[];
}

function buildLoginResult(input: {
  proc: RunProcessResult;
  loginUrl: string | null;
}) {
  return {
    exitCode: input.proc.exitCode,
    signal: input.proc.signal,
    timedOut: input.proc.timedOut,
    stdout: input.proc.stdout,
    stderr: input.proc.stderr,
    loginUrl: input.loginUrl,
  };
}

function hasNonEmptyEnvValue(env: Record<string, string>, key: string): boolean {
  const raw = env[key];
  return typeof raw === "string" && raw.trim().length > 0;
}

export function isBedrockAuth(env: Record<string, string>): boolean {
  if (env.CLAUDE_CODE_USE_BEDROCK === "1" || env.CLAUDE_CODE_USE_BEDROCK === "true") return true;
  if (hasNonEmptyEnvValue(env, "ANTHROPIC_BEDROCK_BASE_URL")) return true;
  return false;
}

export function resolveClaudeBillingType(env: Record<string, string>): AdapterBillingType {
  if (isBedrockAuth(env)) return "metered_api";
  // Claude uses API-key auth when ANTHROPIC_API_KEY is present; otherwise rely on local login/session auth.
  return hasNonEmptyEnvValue(env, "ANTHROPIC_API_KEY") ? "api" : "subscription";
}

async function buildClaudeRuntimeConfig(input: ClaudeExecutionInput): Promise<ClaudeRuntimeConfig> {
  const { runId, agent, config, context, authToken } = input;
  const executionTarget = input.executionTarget ?? { type: "local" as const };

  const command = asString(config.command, "claude");
  const workspaceContext = parseObject(context.paperclipWorkspace);
  const workspaceCwd = asString(workspaceContext.cwd, "");
  const workspaceSource = asString(workspaceContext.source, "");
  const workspaceId = asString(workspaceContext.workspaceId, "") || null;
  const workspaceRepoUrl = asString(workspaceContext.repoUrl, "") || null;
  const workspaceRepoRef = asString(workspaceContext.repoRef, "") || null;
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

  for (const [key, value] of Object.entries(envConfig)) {
    if (typeof value === "string") env[key] = value;
  }

  if (!hasExplicitApiKey && authToken) {
    env.AOA_API_KEY = authToken;
  }

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

  return {
    command,
    cwd,
    workspaceId,
    workspaceRepoUrl,
    workspaceRepoRef,
    env,
    timeoutSec,
    graceSec,
    extraArgs,
  };
}

export async function runClaudeLogin(input: {
  runId: string;
  agent: AdapterExecutionContext["agent"];
  config: Record<string, unknown>;
  context?: Record<string, unknown>;
  authToken?: string;
  onLog?: (stream: "stdout" | "stderr", chunk: string) => Promise<void>;
}) {
  const onLog = input.onLog ?? (async () => {});
  const runtime = await buildClaudeRuntimeConfig({
    runId: input.runId,
    agent: input.agent,
    config: input.config,
    context: input.context ?? {},
    authToken: input.authToken,
  });

  const proc = await runChildProcess(input.runId, runtime.command, ["login"], {
    cwd: runtime.cwd,
    env: runtime.env,
    timeoutSec: runtime.timeoutSec,
    graceSec: runtime.graceSec,
    onLog,
  });

  const loginMeta = detectClaudeLoginRequired({
    parsed: null,
    stdout: proc.stdout,
    stderr: proc.stderr,
    exitCode: proc.exitCode,
  });

  return buildLoginResult({
    proc,
    loginUrl: loginMeta.loginUrl,
  });
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, runtime, config, context, onLog, onMeta, authToken, onSpawn, runtimeHookBridge, runtimeHookToken } = ctx;
  const executionTarget = ctx.executionTarget ?? { type: "local" as const };
  const isRemoteExecutionTarget = adapterExecutionTargetIsRemote(executionTarget);

  const promptTemplate = asString(
    config.promptTemplate,
    [
      "You are agent {{agent.id}} ({{agent.name}}). Continue your AoA work.",
      "{{context.currentTaskMarkdown}}",
    ].join("\n\n"),
  );
  const model = asString(config.model, "");
  const effort = asString(config.effort, "");
  const chrome = asBoolean(config.chrome, false);
  const maxTurns = asNumber(config.maxTurnsPerRun, 0);
  const dangerouslySkipPermissions = asBoolean(config.dangerouslySkipPermissions, false);
  const instructionsFilePath = asString(config.instructionsFilePath, "").trim();
  const instructionsFileDir = instructionsFilePath ? `${path.dirname(instructionsFilePath)}/` : "";
  const commandNotes = [
    ...(instructionsFilePath
      ? [
          `Configured agent instructions via --append-system-prompt-file ${instructionsFilePath} (with path directive appended for local target)`,
        ]
      : []),
    `Execution target: ${executionTarget.type}`,
  ];

  const runtimeConfig = await buildClaudeRuntimeConfig({
    runId,
    agent,
    config,
    context,
    authToken,
    executionTarget,
  });
  const {
    command,
    cwd,
    workspaceId,
    workspaceRepoUrl,
    workspaceRepoRef,
    env,
    timeoutSec,
    graceSec,
    extraArgs,
  } = runtimeConfig;
  const billingType = resolveClaudeBillingType(env);
  const dbSkills = (context.skills as Array<{ key: string; name: string; markdown: string; files?: Array<{ path: string; content: string }> }> | undefined) ?? [];
  const skillsDir = await buildSkillsDir(dbSkills.length > 0 ? dbSkills : undefined);

  // --- Runtime hook bridge (Task 6) ---
  // bridged = true when caller explicitly sets runtimeHookBridge.enabled
  const bridged = runtimeHookBridge?.enabled === true;
  // forwarderPath: hook-forward.mjs lives alongside execute.ts/execute.js in src/server or dist/server
  const forwarderPath = path.resolve(__moduleDir, "hook-forward.mjs");
  let hookSettingsTmpDir: string | null = null;
  let hookSettingsFilePath: string | null = null;
  if (bridged) {
    const endpointUrl = runtimeHookBridge!.selfBaseUrl + runtimeHookBridge!.path;
    const hookSettings = buildPreToolUseSettings({
      endpointUrl,
      timeoutSec: runtimeHookBridge!.timeoutSec,
      forwarderPath,
    });
    hookSettingsTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aoa-runtime-hooks-"));
    hookSettingsFilePath = await writeRuntimeHookSettingsFile(hookSettingsTmpDir, hookSettings);
    // Inject hook env vars into the child process env.
    // AOA_RUNTIME_HOOK_TOKEN is redacted in onMeta by its key name ("TOKEN" matches SENSITIVE_ENV_KEY).
    // AOA_RUNTIME_HOOK_URL is a plain non-secret URL; redacted by value if it looks like a secret (it doesn't).
    env.AOA_RUNTIME_HOOK_URL = endpointUrl;
    if (runtimeHookToken) {
      env.AOA_RUNTIME_HOOK_TOKEN = runtimeHookToken;
    }
  }
  // ------------------------------------

  const executionCwd = adapterExecutionTargetRemoteCwd(executionTarget, cwd);
  const preparedRuntime = await prepareAdapterExecutionTargetRuntime({
    target: executionTarget,
    workspaceLocalDir: cwd,
    adapterKey: "claude",
    runId,
    timeoutSec,
    installCommand: ctx.runtimeCommandSpec?.installCommand ?? null,
    detectCommand: ctx.runtimeCommandSpec?.detectCommand ?? command,
  });
  const runtimeRootDir = preparedRuntime.runtimeRootDir;
  if (runtimeRootDir && adapterExecutionTargetUsesManagedHome(executionTarget)) {
    env.HOME = runtimeRootDir;
  }

  // When instructionsFilePath is configured, create a combined temp file that
  // includes both the file content and the path directive, so we only need
  // --append-system-prompt-file (Claude CLI forbids using both flags together).
  let effectiveInstructionsFilePath = instructionsFilePath;
  if (instructionsFilePath) {
    const instructionsContent = await fs.readFile(instructionsFilePath, "utf-8");
    const pathDirective = `\nThe above agent instructions were loaded from ${instructionsFilePath}. Resolve any relative file references from ${instructionsFileDir}.`;
    const combinedPath = path.join(skillsDir, "agent-instructions.md");
    await fs.writeFile(combinedPath, instructionsContent + pathDirective, "utf-8");
    effectiveInstructionsFilePath = combinedPath;
  }
  let effectiveRemoteInstructionsFilePath: string | null = null;
  let effectiveRemoteSkillsDir: string | null = null;
  if (isRemoteExecutionTarget && runtimeRootDir) {
    effectiveRemoteSkillsDir = `${runtimeRootDir}/.claude/skills`;
    await syncAdapterExecutionTargetDirectory({
      runId: `${runId}-claude-skills`,
      target: executionTarget,
      localDir: path.join(skillsDir, ".claude", "skills"),
      remoteDir: effectiveRemoteSkillsDir,
      cwd: executionCwd,
      env,
      timeoutSec,
      graceSec,
      followSymlinks: true,
      onLog,
    });
    if (effectiveInstructionsFilePath) {
      effectiveRemoteInstructionsFilePath = `${runtimeRootDir}/agent-instructions.md`;
      await syncAdapterExecutionTargetFile({
        runId: `${runId}-claude-instructions`,
        target: executionTarget,
        localPath: effectiveInstructionsFilePath,
        remotePath: effectiveRemoteInstructionsFilePath,
        cwd: executionCwd,
        env,
        timeoutSec,
        graceSec,
        onLog,
      });
    }
  }

  const runtimeSessionParams = parseObject(runtime.sessionParams);
  const runtimeSessionId = asString(runtimeSessionParams.sessionId, runtime.sessionId ?? "");
  const runtimeSessionCwd = asString(runtimeSessionParams.cwd, "");
  const runtimeRemoteExecution = parseObject(runtimeSessionParams.remoteExecution);
  const sessionCwdMatches = runtimeSessionCwd.length === 0 || (
    isRemoteExecutionTarget
      ? runtimeSessionCwd === executionCwd
      : path.resolve(runtimeSessionCwd) === path.resolve(executionCwd)
  );
  const canResumeSession =
    runtimeSessionId.length > 0 &&
    sessionCwdMatches &&
    adapterExecutionTargetSessionMatches(runtimeRemoteExecution, executionTarget);
  const sessionId = canResumeSession ? runtimeSessionId : null;
  if (runtimeSessionId && !canResumeSession) {
    await onLog(
      "stderr",
      `[aoa] Claude session "${runtimeSessionId}" was saved for cwd "${runtimeSessionCwd}" and will not be resumed in "${executionCwd}".\n`,
    );
  }
  const renderedPrompt = renderTemplate(promptTemplate, {
    agentId: agent.id,
    companyId: agent.companyId,
    runId,
    company: { id: agent.companyId },
    agent,
    run: { id: runId, source: "on_demand" },
    context,
  });
  const currentTaskMarkdown = typeof context.currentTaskMarkdown === "string"
    ? context.currentTaskMarkdown.trim()
    : "";
  const prompt = currentTaskMarkdown && !/{{\s*context\.currentTaskMarkdown\s*}}/.test(promptTemplate)
    ? `${renderedPrompt.trimEnd()}\n\n${currentTaskMarkdown}`
    : renderedPrompt;

  const buildClaudeArgs = async (resumeSessionId: string | null) => {
    const args = ["--print", "-", "--output-format", "stream-json", "--verbose"];
    if (resumeSessionId) args.push("--resume", resumeSessionId);
    if (hookSettingsFilePath) {
      // Bridged mode: wire the PreToolUse hook via --settings.
      // --dangerously-skip-permissions and --settings must never coexist: skip-permissions bypasses
      // all tool approval, defeating the permission bridge entirely.
      args.push("--settings", hookSettingsFilePath);
    } else if (dangerouslySkipPermissions) {
      // Unbridged: honor config.dangerouslySkipPermissions as before.
      args.push("--dangerously-skip-permissions");
    }
    if (chrome) args.push("--chrome");
    if (model && !isBedrockAuth(env)) args.push("--model", model);
    if (effort) args.push("--effort", effort);
    if (maxTurns > 0) args.push("--max-turns", String(maxTurns));
    const instructionsArg = isRemoteExecutionTarget
      ? effectiveRemoteInstructionsFilePath
      : effectiveInstructionsFilePath;
    const skillsArg = isRemoteExecutionTarget ? effectiveRemoteSkillsDir : skillsDir;
    if (instructionsArg) {
      args.push("--append-system-prompt-file", instructionsArg);
    }
    if (skillsArg) {
      args.push("--add-dir", skillsArg);
    }
    if (extraArgs.length > 0) {
      if (hookSettingsFilePath) {
        // Bridged mode: strip bypass flags that defeat the PreToolUse hook.
        // These flags would re-enable Claude's permission bypass, making the
        // hook's deny decisions ineffective.
        const BYPASS_FLAGS = new Set([
          "--dangerously-skip-permissions",
          "--allow-dangerously-skip-permissions",
        ]);
        const BYPASS_PERMISSION_MODE_VALUES = new Set(["bypassPermissions", "dontAsk"]);
        const stripped: string[] = [];
        const filteredArgs: string[] = [];
        let i = 0;
        while (i < extraArgs.length) {
          const arg = extraArgs[i];
          if (BYPASS_FLAGS.has(arg)) {
            stripped.push(arg);
            i++;
          } else if (arg === "--permission-mode" && i + 1 < extraArgs.length) {
            const value = extraArgs[i + 1];
            if (BYPASS_PERMISSION_MODE_VALUES.has(value)) {
              stripped.push(`${arg} ${value}`);
              i += 2;
            } else {
              filteredArgs.push(arg, value);
              i += 2;
            }
          } else if (arg.startsWith("--permission-mode=")) {
            const value = arg.slice("--permission-mode=".length);
            if (BYPASS_PERMISSION_MODE_VALUES.has(value)) {
              stripped.push(arg);
              i++;
            } else {
              filteredArgs.push(arg);
              i++;
            }
          } else {
            filteredArgs.push(arg);
            i++;
          }
        }
        if (stripped.length > 0) {
          await onLog(
            "stderr",
            `[aoa] WARNING: bridged mode — stripped bypass flag(s) from extraArgs that would defeat the PreToolUse permission hook: ${stripped.join(", ")}\n`,
          );
        }
        if (filteredArgs.length > 0) args.push(...filteredArgs);
      } else {
        args.push(...extraArgs);
      }
    }
    return args;
  };

  const parseFallbackErrorMessage = (proc: RunProcessResult) => {
    const stderrLine =
      proc.stderr
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean) ?? "";

    if ((proc.exitCode ?? 0) === 0) {
      return "Failed to parse claude JSON output";
    }

    return stderrLine
      ? `Claude exited with code ${proc.exitCode ?? -1}: ${stderrLine}`
      : `Claude exited with code ${proc.exitCode ?? -1}`;
  };

  const runAttempt = async (resumeSessionId: string | null) => {
    const args = await buildClaudeArgs(resumeSessionId);
    if (onMeta) {
      await onMeta({
        adapterType: "claude_local",
        command,
        cwd: executionCwd,
        commandArgs: args,
        commandNotes,
        env: redactEnvForLogs(env),
        prompt,
        context,
      });
    }

    const proc = await runAdapterExecutionTargetProcess(executionTarget, {
      runId,
      command,
      args,
      cwd: executionCwd,
      env,
      stdin: prompt,
      authToken: env.AOA_API_KEY ?? authToken ?? null,
      apiBaseUrl: env.AOA_API_URL ?? null,
      runtimeCommandSpec: ctx.runtimeCommandSpec ?? null,
      timeoutSec,
      graceSec,
      onLog,
      onSpawn,
    });

    const parsedStream = parseClaudeStreamJson(proc.stdout);
    const parsed = parsedStream.resultJson ?? parseJson(proc.stdout);
    return { proc, parsedStream, parsed };
  };

  const toAdapterResult = (
    attempt: {
      proc: RunProcessResult;
      parsedStream: ReturnType<typeof parseClaudeStreamJson>;
      parsed: Record<string, unknown> | null;
    },
    opts: { fallbackSessionId: string | null; clearSessionOnMissingSession?: boolean },
  ): AdapterExecutionResult => {
    const { proc, parsedStream, parsed } = attempt;
    const loginMeta = detectClaudeLoginRequired({
      parsed,
      stdout: proc.stdout,
      stderr: proc.stderr,
      exitCode: proc.exitCode,
    });
    const errorMeta =
      loginMeta.loginUrl != null
        ? {
            loginUrl: loginMeta.loginUrl,
          }
        : undefined;

    if (proc.timedOut) {
      return {
        exitCode: proc.exitCode,
        signal: proc.signal,
        timedOut: true,
        errorMessage: `Timed out after ${timeoutSec}s`,
        errorCode: "timeout",
        errorMeta,
        clearSession: Boolean(opts.clearSessionOnMissingSession),
        executionCwd,
      };
    }

    if (!parsed) {
      return {
        exitCode: proc.exitCode,
        signal: proc.signal,
        timedOut: false,
        errorMessage: parseFallbackErrorMessage(proc),
        errorCode: loginMeta.requiresLogin ? "claude_auth_required" : null,
        errorMeta,
        resultJson: {
          stdout: proc.stdout,
          stderr: proc.stderr,
        },
        clearSession: Boolean(opts.clearSessionOnMissingSession),
        executionCwd,
      };
    }

    const usage =
      parsedStream.usage ??
      (() => {
        const usageObj = parseObject(parsed.usage);
        return {
          inputTokens: asNumber(usageObj.input_tokens, 0),
          cachedInputTokens: asNumber(usageObj.cache_read_input_tokens, 0),
          outputTokens: asNumber(usageObj.output_tokens, 0),
        };
      })();

    const resolvedSessionId =
      parsedStream.sessionId ??
      (asString(parsed.session_id, opts.fallbackSessionId ?? "") || opts.fallbackSessionId);
    const resolvedSessionParams = resolvedSessionId
      ? ({
        sessionId: resolvedSessionId,
        cwd: executionCwd,
        ...(workspaceId ? { workspaceId } : {}),
        ...(workspaceRepoUrl ? { repoUrl: workspaceRepoUrl } : {}),
        ...(workspaceRepoRef ? { repoRef: workspaceRepoRef } : {}),
        ...(isRemoteExecutionTarget
          ? { remoteExecution: adapterExecutionTargetSessionIdentity(executionTarget) }
          : {}),
      } as Record<string, unknown>)
      : null;
    const clearSessionForMaxTurns = isClaudeMaxTurnsResult(parsed);

    return {
      exitCode: proc.exitCode,
      signal: proc.signal,
      timedOut: false,
      errorMessage:
        (proc.exitCode ?? 0) === 0
          ? null
          : describeClaudeFailure(parsed) ?? `Claude exited with code ${proc.exitCode ?? -1}`,
      errorCode: clearSessionForMaxTurns
        ? "max_turns_exhausted"
        : loginMeta.requiresLogin
          ? "claude_auth_required"
          : null,
      errorMeta,
      usage,
      sessionId: resolvedSessionId,
      sessionParams: resolvedSessionParams,
      sessionDisplayId: resolvedSessionId,
      provider: isBedrockAuth(env) ? "aws_bedrock" : "anthropic",
      model: parsedStream.model || asString(parsed.model, model),
      billingType,
      costUsd: parsedStream.costUsd ?? asNumber(parsed.total_cost_usd, 0),
      executionCwd,
      resultJson: parsed,
      summary: parsedStream.summary || asString(parsed.result, ""),
      clearSession: clearSessionForMaxTurns || Boolean(opts.clearSessionOnMissingSession && !resolvedSessionId),
    };
  };

  try {
    const initial = await runAttempt(sessionId ?? null);
    if (
      sessionId &&
      !initial.proc.timedOut &&
      (initial.proc.exitCode ?? 0) !== 0 &&
      initial.parsed &&
      isClaudeUnknownSessionError(initial.parsed)
    ) {
      await onLog(
        "stderr",
        `[aoa] Claude resume session "${sessionId}" is unavailable; retrying with a fresh session.\n`,
      );
      const retry = await runAttempt(null);
      return toAdapterResult(retry, { fallbackSessionId: null, clearSessionOnMissingSession: true });
    }

    return toAdapterResult(initial, { fallbackSessionId: runtimeSessionId || runtime.sessionId });
  } finally {
    fs.rm(skillsDir, { recursive: true, force: true }).catch(() => {});
    if (hookSettingsTmpDir) {
      fs.rm(hookSettingsTmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
