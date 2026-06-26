import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@armyofagents/adapter-utils";
import {
  asString,
  asBoolean,
  asStringArray,
  parseObject,
  ensurePathInEnv,
} from "@armyofagents/adapter-utils/server-utils";
import {
  adapterExecutionTargetIsRemote,
  adapterExecutionTargetRemoteCwd,
  describeAdapterExecutionTarget,
  ensureAdapterExecutionTargetCommandResolvable,
  ensureAdapterExecutionTargetDirectory,
  resolveAdapterExecutionTargetCwd,
  runAdapterExecutionTargetProcess,
} from "@armyofagents/adapter-utils/execution-target";
import fs from "node:fs/promises";
import path from "node:path";
import { parseCodexJsonl } from "./parse.js";
import { prepareManagedCodexHome, resolveSharedCodexHomeDir } from "./codex-home.js";
import { SANDBOX_INSTALL_COMMAND } from "../index.js";

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function firstNonEmptyLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function commandLooksLike(command: string, expected: string): boolean {
  const base = path.basename(command).toLowerCase();
  return base === expected || base === `${expected}.cmd` || base === `${expected}.exe`;
}

function summarizeProbeDetail(stdout: string, stderr: string, parsedError: string | null): string | null {
  const raw = parsedError?.trim() || firstNonEmptyLine(stderr) || firstNonEmptyLine(stdout);
  if (!raw) return null;
  const clean = raw.replace(/\s+/g, " ").trim();
  const max = 240;
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

const CODEX_AUTH_REQUIRED_RE =
  /(?:not\s+logged\s+in|login\s+required|authentication\s+required|unauthorized|invalid(?:\s+or\s+missing)?\s+api(?:[_\s-]?key)?|openai[_\s-]?api[_\s-]?key|api[_\s-]?key.*required|please\s+run\s+`?codex\s+login`?)/i;

function shellDoubleQuote(value: string): string {
  return `"${value.replace(/["\\$`]/g, "\\$&")}"`;
}

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);
  const command = asString(config.command, "codex");
  const target = ctx.executionTarget ?? null;
  const targetIsRemote = adapterExecutionTargetIsRemote(target);
  const cwd = resolveAdapterExecutionTargetCwd(target, asString(config.cwd, ""), process.cwd());
  const targetLabel = targetIsRemote
    ? ctx.environmentName ?? describeAdapterExecutionTarget(target)
    : null;
  const runId = `codex-envtest-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  if (targetLabel) {
    checks.push({
      code: "codex_environment_target",
      level: "info",
      message: `Probing inside environment: ${targetLabel}`,
    });
  }

  try {
    await ensureAdapterExecutionTargetDirectory(runId, target, cwd, {
      cwd,
      env: {},
      createIfMissing: true,
    });
    checks.push({
      code: "codex_cwd_valid",
      level: "info",
      message: `Working directory is valid: ${cwd}`,
    });
  } catch (err) {
    checks.push({
      code: "codex_cwd_invalid",
      level: "error",
      message: err instanceof Error ? err.message : "Invalid working directory",
      detail: cwd,
    });
  }

  const envConfig = parseObject(config.env);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(envConfig)) {
    if (typeof value === "string") env[key] = value;
  }
  const runtimeEnv = ensurePathInEnv({ ...(targetIsRemote ? {} : process.env), ...env });
  try {
    await ensureAdapterExecutionTargetCommandResolvable(command, target, cwd, runtimeEnv, {
      installCommand: SANDBOX_INSTALL_COMMAND,
    });
    checks.push({
      code: "codex_command_resolvable",
      level: "info",
      message: `Command is executable: ${command}`,
    });
  } catch (err) {
    checks.push({
      code: "codex_command_unresolvable",
      level: "error",
      message: err instanceof Error ? err.message : "Command is not executable",
      detail: command,
    });
  }

  // Auth-presence assessment MUST mirror what a real run uses (Codex finding 3 /
  // env-strip): a per-agent OPENAI_API_KEY in adapter config env, else the shared
  // Codex auth.json. The ambient server process.env.OPENAI_API_KEY is STRIPPED
  // from agent runs, so it must NOT be reported as usable auth — otherwise the
  // probe passes while the saved agent immediately runs without auth.
  const configOpenAiKey = env.OPENAI_API_KEY;
  const hostOpenAiKey = targetIsRemote ? undefined : process.env.OPENAI_API_KEY;
  const sharedAuthPath = path.join(resolveSharedCodexHomeDir(process.env), "auth.json");
  const sharedAuthReady = await fs.stat(sharedAuthPath).then((stat) => stat.isFile()).catch(() => false);
  if (isNonEmpty(configOpenAiKey)) {
    checks.push({
      code: "codex_openai_api_key_present",
      level: "info",
      message: "OPENAI_API_KEY is set for Codex authentication.",
      detail: "Detected in adapter config env.",
    });
  } else if (sharedAuthReady) {
    checks.push({
      code: "codex_auth_json_present",
      level: "info",
      message: "Codex auth.json is available for local authentication.",
    });
  } else if (isNonEmpty(hostOpenAiKey)) {
    checks.push({
      code: "codex_openai_api_key_server_env_only",
      level: "warn",
      message: "OPENAI_API_KEY is set only in the server environment; agent runs do not use it.",
      hint: "Set a per-agent OPENAI_API_KEY in the adapter config, or run `codex login`, so agent runs can authenticate.",
    });
  } else {
    checks.push({
      code: "codex_openai_api_key_missing",
      level: "warn",
      message: "OPENAI_API_KEY is not set. Codex runs may fail until authentication is configured.",
      hint: "Set a per-agent OPENAI_API_KEY in the adapter config, or run `codex login`.",
    });
  }

  const canRunProbe =
    checks.every((check) => check.code !== "codex_cwd_invalid" && check.code !== "codex_command_unresolvable");
  if (canRunProbe) {
    if (!commandLooksLike(command, "codex")) {
      checks.push({
        code: "codex_hello_probe_skipped_custom_command",
        level: "info",
        message: "Skipped hello probe because command is not `codex`.",
        detail: command,
        hint: "Use the `codex` CLI command to run the automatic login and installation probe.",
      });
    } else {
      const model = asString(config.model, "").trim();
      const modelReasoningEffort = asString(
        config.modelReasoningEffort,
        asString(config.reasoningEffort, ""),
      ).trim();
      const search = asBoolean(config.search, false);
      const bypass = asBoolean(
        config.dangerouslyBypassApprovalsAndSandbox,
        asBoolean(config.dangerouslyBypassSandbox, false),
      );
      const extraArgs = (() => {
        const fromExtraArgs = asStringArray(config.extraArgs);
        if (fromExtraArgs.length > 0) return fromExtraArgs;
        return asStringArray(config.args);
      })();

      const args = ["exec", "--json"];
      if (search) args.unshift("--search");
      if (bypass) args.push("--dangerously-bypass-approvals-and-sandbox");
      if (model) args.push("--model", model);
      if (modelReasoningEffort) {
        args.push("-c", `model_reasoning_effort=${JSON.stringify(modelReasoningEffort)}`);
      }
      if (extraArgs.length > 0) args.push(...extraArgs);
      args.push("-");

      // Codex CLI 0.122+ reads auth from $CODEX_HOME/auth.json rather than env.
      // Materialize auth.json into a managed per-company home dir before the probe.
      // On Windows, the shell trap variant is not supported (Issue #114); we fall back
      // to a bare probe — API-key auth may return 401 on Codex 0.122+ in that case.
      //
      // AUTH ALIGNMENT (env-strip / Codex finding 3): use the SAME auth inputs a
      // real run uses (execute.ts) — the per-agent OPENAI_API_KEY in adapter config
      // env, else the shared Codex auth.json that prepareManagedCodexHome copies in.
      // Do NOT fall back to the ambient process.env.OPENAI_API_KEY: agent runs strip
      // that key, so materializing it here would let "Test environment" report a
      // passing connection while the saved agent immediately runs without auth.
      const configuredOpenAiApiKey =
        typeof env.OPENAI_API_KEY === "string" && env.OPENAI_API_KEY.trim().length > 0
          ? env.OPENAI_API_KEY.trim()
          : null;

      const managedCodexHome = targetIsRemote
        ? `${adapterExecutionTargetRemoteCwd(target, cwd).replace(/\/+$/, "")}/.aoa-codex-home`
        : await prepareManagedCodexHome(
            process.env,
            () => {},
            ctx.companyId,
            { apiKey: configuredOpenAiApiKey },
          );
      const probeEnv = { ...env, CODEX_HOME: managedCodexHome };
      const runtimeCommandSpec = targetIsRemote
        ? {
            command,
            installCommand: [
              `mkdir -p ${shellDoubleQuote(managedCodexHome)}`,
              SANDBOX_INSTALL_COMMAND,
              `if [ -n "$OPENAI_API_KEY" ]; then printf '%s' "$OPENAI_API_KEY" | codex login --with-api-key; fi`,
            ].join("\n"),
          }
        : null;

      const probe = await runAdapterExecutionTargetProcess(
        target ?? { type: "local" },
        {
          runId,
          command,
          args,
          cwd,
          env: probeEnv,
          // Strip the ambient server OPENAI_API_KEY from the probe child too, so
          // the diagnostic uses the SAME auth a real run does (per-agent key in
          // probeEnv survives — mergeChildEnv keeps overlay-set keys; only the
          // inherited process.env key is removed). Without this the probe could
          // authenticate with the ambient key and pass while real runs strip it
          // and fail (Codex P2). Matches execute.ts' unsetEnvKeys.
          unsetEnvKeys: ["OPENAI_API_KEY"],
          runtimeCommandSpec,
          timeoutSec: 45,
          graceSec: 5,
          stdin: "Respond with hello.",
          onLog: async () => {},
        },
      );
      const parsed = parseCodexJsonl(probe.stdout);
      const detail = summarizeProbeDetail(probe.stdout, probe.stderr, parsed.errorMessage);
      const authEvidence = `${parsed.errorMessage ?? ""}\n${probe.stdout}\n${probe.stderr}`.trim();

      if (probe.timedOut) {
        checks.push({
          code: "codex_hello_probe_timed_out",
          level: "warn",
          message: "Codex hello probe timed out.",
          hint: "Retry the probe. If this persists, verify Codex can run `Respond with hello` from this directory manually.",
        });
      } else if ((probe.exitCode ?? 1) === 0) {
        const summary = parsed.summary.trim();
        const hasHello = /\bhello\b/i.test(summary);
        checks.push({
          code: hasHello ? "codex_hello_probe_passed" : "codex_hello_probe_unexpected_output",
          level: hasHello ? "info" : "warn",
          message: hasHello
            ? "Codex hello probe succeeded."
            : "Codex probe ran but did not return `hello` as expected.",
          ...(summary ? { detail: summary.replace(/\s+/g, " ").trim().slice(0, 240) } : {}),
          ...(hasHello
            ? {}
            : {
                hint: "Try the probe manually (`codex exec --json -` then prompt: Respond with hello) to inspect full output.",
              }),
        });
      } else if (CODEX_AUTH_REQUIRED_RE.test(authEvidence)) {
        checks.push({
          code: "codex_hello_probe_auth_required",
          level: "warn",
          message: "Codex CLI is installed, but authentication is not ready.",
          ...(detail ? { detail } : {}),
          hint: "Configure OPENAI_API_KEY in adapter env/shell or run `codex login`, then retry the probe.",
        });
      } else {
        checks.push({
          code: "codex_hello_probe_failed",
          level: "error",
          message: "Codex hello probe failed.",
          ...(detail ? { detail } : {}),
          hint: "Run `codex exec --json -` manually in this working directory and prompt `Respond with hello` to debug.",
        });
      }
    }
  }

  return {
    adapterType: ctx.adapterType,
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}
