import { randomUUID } from "node:crypto";
import path from "node:path";

export interface SandboxProviderAcquireInput {
  companyId: string;
  environmentId: string;
  issueId: string | null;
  heartbeatRunId: string | null;
  config: Record<string, unknown>;
  workspaceMode: string | null;
}

export interface SandboxProviderLease {
  providerLeaseId: string;
  expiresAt?: Date | string | null;
  metadata: Record<string, unknown>;
}

export interface SandboxProviderReleaseInput {
  providerLeaseId: string | null;
  leaseMetadata: Record<string, unknown> | null;
  config?: Record<string, unknown> | null;
}

export interface SandboxProviderReleaseResult {
  cleanupStatus: "success" | "failed";
  metadata?: Record<string, unknown>;
}

export interface SandboxProviderExecuteInput {
  providerLeaseId: string;
  leaseMetadata: Record<string, unknown> | null;
  config?: Record<string, unknown> | null;
  command: string;
  args?: string[];
  cwd?: string | null;
  env?: Record<string, string>;
  stdin?: string | null;
  timeoutMs?: number | null;
}

export interface SandboxProviderExecuteResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  metadata?: Record<string, unknown>;
}

export interface SandboxProviderConfigValidationResult {
  ok: boolean;
  provider: string;
  errors?: string[];
  sanitizedConfig?: Record<string, unknown>;
}

export interface SandboxProviderProbeInput {
  companyId: string;
  environmentId: string;
  config: Record<string, unknown>;
}

export interface SandboxProviderProbeResult {
  ok: boolean;
  provider: string;
  summary: string;
  metadata?: Record<string, unknown>;
  errors?: string[];
}

export interface SandboxRuntimeProvider {
  readonly provider: string;
  validateConfig?(config: Record<string, unknown>): Promise<SandboxProviderConfigValidationResult>;
  probe?(input: SandboxProviderProbeInput): Promise<SandboxProviderProbeResult>;
  acquireLease(input: SandboxProviderAcquireInput): Promise<SandboxProviderLease>;
  releaseLease(input: SandboxProviderReleaseInput): Promise<SandboxProviderReleaseResult>;
  execute(input: SandboxProviderExecuteInput): Promise<SandboxProviderExecuteResult>;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readPositiveInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

function sanitizeProviderLeasePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "lease";
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function isValidShellEnvKey(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

export function createFakeSandboxRuntimeProvider(): SandboxRuntimeProvider {
  return {
    provider: "fake",

    async acquireLease(input) {
      const remoteCwd = readString(input.config.remoteCwd) ?? "/workspace";
      const shellCommand = readString(input.config.shellCommand) === "bash" ? "bash" : "sh";
      const timeoutMs = readPositiveInteger(input.config.timeoutMs);
      return {
        providerLeaseId: `fake-sandbox-${sanitizeProviderLeasePart(input.environmentId)}-${sanitizeProviderLeasePart(input.heartbeatRunId ?? "test")}`,
        metadata: {
          provider: "fake",
          remoteCwd,
          shellCommand,
          timeoutMs,
          workspaceMode: input.workspaceMode,
        },
      };
    },

    async releaseLease(input) {
      return {
        cleanupStatus: "success",
        metadata: {
          releasedProviderLeaseId: input.providerLeaseId,
        },
      };
    },

    async execute(input) {
      const args = input.args ?? [];
      return {
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: `fake: ${[input.command, ...args].join(" ")}`.trim(),
        stderr: "",
        metadata: {
          cwd: input.cwd ?? readString(input.leaseMetadata?.remoteCwd) ?? null,
          envKeys: Object.keys(input.env ?? {}).sort(),
          providerLeaseId: input.providerLeaseId,
        },
      };
    },
  };
}

type E2bCommandResult = {
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
};

type E2bSandbox = {
  sandboxId?: string;
  sandboxDomain?: string;
  commands: {
    run(command: string, options?: Record<string, unknown>): Promise<E2bCommandResult>;
  };
  files?: {
    write(path: string, content: string): Promise<void>;
    remove(path: string): Promise<void>;
  };
  setTimeout?(timeoutMs: number): Promise<void>;
  kill?(): Promise<void>;
  pause?(): Promise<void>;
};

type E2bModule = {
  Sandbox: {
    create(template: string, options: Record<string, unknown>): Promise<E2bSandbox>;
    connect(providerLeaseId: string, options: Record<string, unknown>): Promise<E2bSandbox>;
  };
  CommandExitError?: new (...args: unknown[]) => Error;
  TimeoutError?: new (...args: unknown[]) => Error;
  SandboxNotFoundError?: new (...args: unknown[]) => Error;
};

interface E2bDriverConfig {
  template: string;
  apiKey: string | null;
  timeoutMs: number;
  reuseLease: boolean;
}

export interface E2bSandboxRuntimeProviderOptions {
  importE2b?: () => Promise<E2bModule>;
  env?: Record<string, string | undefined>;
  randomId?: () => string;
}

function parseE2bDriverConfig(raw: Record<string, unknown>): E2bDriverConfig {
  const timeoutMs = readPositiveInteger(raw.timeoutMs) ?? 3_600_000;
  return {
    template: readString(raw.template) ?? "base",
    apiKey: readString(raw.resolvedApiKey) ?? readString(raw.apiKey),
    timeoutMs,
    reuseLease: raw.reuseLease === true,
  };
}

function sanitizedE2bConfig(config: E2bDriverConfig, env: Record<string, string | undefined>) {
  return {
    provider: "e2b",
    template: config.template,
    timeoutMs: config.timeoutMs,
    reuseLease: config.reuseLease,
    hasApiKey: Boolean(config.apiKey ?? readString(env.E2B_API_KEY)),
  };
}

function validateE2bDriverConfig(
  raw: Record<string, unknown>,
  env: Record<string, string | undefined>,
): SandboxProviderConfigValidationResult {
  const config = parseE2bDriverConfig(raw);
  const errors: string[] = [];
  if (config.timeoutMs < 1_000 || config.timeoutMs > 86_400_000) {
    errors.push("E2B timeoutMs must be between 1000 and 86400000.");
  }
  if (!config.apiKey && !readString(env.E2B_API_KEY)) {
    errors.push("E2B sandbox environments require an API key in config or E2B_API_KEY.");
  }
  return {
    ok: errors.length === 0,
    provider: "e2b",
    ...(errors.length > 0 ? { errors } : {}),
    sanitizedConfig: sanitizedE2bConfig(config, env),
  };
}

function resolveE2bApiKey(config: E2bDriverConfig, env: Record<string, string | undefined>): string {
  const apiKey = config.apiKey ?? readString(env.E2B_API_KEY);
  if (!apiKey) {
    throw new Error("E2B sandbox environments require an API key in config or E2B_API_KEY.");
  }
  return apiKey;
}

function defaultImportE2b(): Promise<E2bModule> {
  return import("e2b") as Promise<E2bModule>;
}

async function resolveE2bWorkingDirectory(sandbox: E2bSandbox): Promise<string> {
  const result = await sandbox.commands.run("pwd");
  const cwd = typeof result.stdout === "string" && result.stdout.trim().length > 0
    ? result.stdout.trim()
    : "/";
  const remoteCwd = path.posix.join(cwd, "aoa-workspace");
  await sandbox.commands.run(`mkdir -p ${shellQuote(remoteCwd)}`);
  return remoteCwd;
}

function buildE2bLeaseMetadata(input: {
  config: E2bDriverConfig;
  sandbox: E2bSandbox;
  remoteCwd: string;
  workspaceMode: string | null;
}) {
  return {
    provider: "e2b",
    template: input.config.template,
    timeoutMs: input.config.timeoutMs,
    reuseLease: input.config.reuseLease,
    sandboxId: input.sandbox.sandboxId ?? null,
    sandboxDomain: input.sandbox.sandboxDomain ?? null,
    remoteCwd: input.remoteCwd,
    shellCommand: "bash",
    workspaceMode: input.workspaceMode,
  };
}

function buildE2bLoginShellScript(input: {
  command: string;
  args: string[];
  env?: Record<string, string>;
}): string {
  const env = input.env ?? {};
  for (const key of Object.keys(env)) {
    if (!isValidShellEnvKey(key)) {
      throw new Error(`Invalid sandbox environment variable key: ${key}`);
    }
  }

  const envArgs = Object.entries(env).map(([key, value]) => `${key}=${shellQuote(value)}`);
  const commandParts = [shellQuote(input.command), ...input.args.map(shellQuote)].join(" ");
  const preExecCommands: string[] = [];
  const codexHome = readString(env.CODEX_HOME);
  if (codexHome) {
    preExecCommands.push(`mkdir -p ${shellQuote(codexHome)}`);
  }
  const execLine = envArgs.length > 0
    ? `exec env ${envArgs.join(" ")} ${commandParts}`
    : `exec ${commandParts}`;
  return [
    'if [ -f /etc/profile ]; then . /etc/profile >/dev/null 2>&1 || true; fi',
    'if [ -f "$HOME/.profile" ]; then . "$HOME/.profile" >/dev/null 2>&1 || true; fi',
    'if [ -f "$HOME/.bash_profile" ]; then . "$HOME/.bash_profile" >/dev/null 2>&1 || true; elif [ -f "$HOME/.bashrc" ]; then . "$HOME/.bashrc" >/dev/null 2>&1 || true; fi',
    'export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"',
    '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true',
    ...preExecCommands,
    execLine,
  ].join(" && ");
}

function configFromE2bLease(input: {
  leaseMetadata: Record<string, unknown> | null;
  config?: Record<string, unknown> | null;
  env: Record<string, string | undefined>;
}): E2bDriverConfig {
  const metadata = input.leaseMetadata ?? {};
  const config = input.config ?? {};
  return parseE2bDriverConfig({
    provider: "e2b",
    template: config.template ?? metadata.template,
    timeoutMs: config.timeoutMs ?? metadata.timeoutMs,
    reuseLease: config.reuseLease ?? metadata.reuseLease,
    resolvedApiKey: config.resolvedApiKey,
    apiKey: config.apiKey,
  });
}

function isInstanceOf(error: unknown, ctor: unknown): boolean {
  return typeof ctor === "function" && error instanceof ctor;
}

function readErrorStream(error: unknown, key: "stdout" | "stderr"): string {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const direct = record[key];
  if (typeof direct === "string") return direct;
  const nested = record.result && typeof record.result === "object"
    ? (record.result as Record<string, unknown>)[key]
    : null;
  return typeof nested === "string" ? nested : "";
}

export function createE2bSandboxRuntimeProvider(
  options: E2bSandboxRuntimeProviderOptions = {},
): SandboxRuntimeProvider {
  const importE2b = options.importE2b ?? defaultImportE2b;
  const env = options.env ?? process.env;
  const randomId = options.randomId ?? randomUUID;

  async function connect(config: E2bDriverConfig, providerLeaseId: string): Promise<E2bSandbox> {
    const e2b = await importE2b();
    return await e2b.Sandbox.connect(providerLeaseId, {
      apiKey: resolveE2bApiKey(config, env),
      timeoutMs: config.timeoutMs,
    });
  }

  return {
    provider: "e2b",

    async validateConfig(config) {
      return validateE2bDriverConfig(config, env);
    },

    async probe(input) {
      const validation = validateE2bDriverConfig(input.config, env);
      if (!validation.ok) {
        return {
          ok: false,
          provider: "e2b",
          summary: "E2B sandbox configuration is invalid.",
          errors: validation.errors,
          metadata: validation.sanitizedConfig,
        };
      }

      const config = parseE2bDriverConfig(input.config);
      const e2b = await importE2b();
      const sandbox = await e2b.Sandbox.create(config.template, {
        apiKey: resolveE2bApiKey(config, env),
        timeoutMs: config.timeoutMs,
        metadata: {
          aoaProvider: "e2b",
          companyId: input.companyId,
          environmentId: input.environmentId,
        },
      });

      try {
        await sandbox.setTimeout?.(config.timeoutMs);
        const remoteCwd = await resolveE2bWorkingDirectory(sandbox);
        return {
          ok: true,
          provider: "e2b",
          summary: "E2B sandbox created and workspace directory prepared.",
          metadata: {
            template: config.template,
            timeoutMs: config.timeoutMs,
            sandboxId: sandbox.sandboxId ?? null,
            sandboxDomain: sandbox.sandboxDomain ?? null,
            remoteCwd,
          },
        };
      } finally {
        await sandbox.kill?.().catch(() => undefined);
      }
    },

    async acquireLease(input) {
      const config = parseE2bDriverConfig(input.config);
      const e2b = await importE2b();
      const sandbox = await e2b.Sandbox.create(config.template, {
        apiKey: resolveE2bApiKey(config, env),
        timeoutMs: config.timeoutMs,
        metadata: {
          aoaProvider: "e2b",
          companyId: input.companyId,
          environmentId: input.environmentId,
        },
      });

      try {
        await sandbox.setTimeout?.(config.timeoutMs);
        const remoteCwd = await resolveE2bWorkingDirectory(sandbox);
        return {
          providerLeaseId: sandbox.sandboxId ?? "",
          metadata: buildE2bLeaseMetadata({
            config,
            sandbox,
            remoteCwd,
            workspaceMode: input.workspaceMode,
          }),
        };
      } catch (error) {
        await sandbox.kill?.().catch(() => undefined);
        throw error;
      }
    },

    async releaseLease(input) {
      if (!input.providerLeaseId) {
        return { cleanupStatus: "success", metadata: { skipped: "missing_provider_lease_id" } };
      }
      const config = configFromE2bLease({
        leaseMetadata: input.leaseMetadata,
        config: input.config,
        env,
      });
      try {
        const sandbox = await connect(config, input.providerLeaseId);
        if (config.reuseLease) {
          await sandbox.pause?.();
        } else {
          await sandbox.kill?.();
        }
        return { cleanupStatus: "success" };
      } catch (error) {
        const e2b = await importE2b();
        if (isInstanceOf(error, e2b.SandboxNotFoundError)) {
          return { cleanupStatus: "success", metadata: { alreadyGone: true } };
        }
        return {
          cleanupStatus: "failed",
          metadata: { error: error instanceof Error ? error.message : String(error) },
        };
      }
    },

    async execute(input) {
      const config = configFromE2bLease({
        leaseMetadata: input.leaseMetadata,
        config: input.config,
        env,
      });
      const e2b = await importE2b();
      const sandbox = await connect(config, input.providerLeaseId);
      await sandbox.setTimeout?.(config.timeoutMs).catch(() => undefined);

      let stagedStdinPath: string | null = null;
      const baseCommand = buildE2bLoginShellScript({
        command: input.command,
        args: input.args ?? [],
        env: input.env,
      });
      let command = baseCommand;
      if (input.stdin != null) {
        if (!sandbox.files) throw new Error("E2B sandbox file API is required to pass stdin.");
        stagedStdinPath = `/tmp/aoa-stdin-${sanitizeProviderLeasePart(randomId())}`;
        await sandbox.files.write(stagedStdinPath, input.stdin);
        command = `${baseCommand} < ${shellQuote(stagedStdinPath)}`;
      }

      try {
        const result = await sandbox.commands.run(command, {
          cwd: input.cwd ?? readString(input.leaseMetadata?.remoteCwd) ?? undefined,
          timeoutMs: input.timeoutMs ?? config.timeoutMs,
        });
        return {
          exitCode: typeof result.exitCode === "number" ? result.exitCode : 0,
          signal: null,
          timedOut: false,
          stdout: typeof result.stdout === "string" ? result.stdout : "",
          stderr: typeof result.stderr === "string" ? result.stderr : "",
        };
      } catch (error) {
        if (isInstanceOf(error, e2b.CommandExitError)) {
          const record = error as unknown as Record<string, unknown>;
          return {
            exitCode: typeof record.exitCode === "number" ? record.exitCode : 1,
            signal: null,
            timedOut: false,
            stdout: readErrorStream(error, "stdout"),
            stderr: readErrorStream(error, "stderr"),
          };
        }
        if (isInstanceOf(error, e2b.TimeoutError)) {
          return {
            exitCode: null,
            signal: null,
            timedOut: true,
            stdout: readErrorStream(error, "stdout"),
            stderr: readErrorStream(error, "stderr") || (error instanceof Error ? error.message : String(error)),
          };
        }
        throw error;
      } finally {
        if (stagedStdinPath && sandbox.files) {
          await sandbox.files.remove(stagedStdinPath).catch(() => undefined);
        }
      }
    },
  };
}

export function sandboxProviderRuntime(
  options: {
    providers?: SandboxRuntimeProvider[];
  } = {},
) {
  const providers = new Map<string, SandboxRuntimeProvider>();
  for (const provider of options.providers ?? [
    createFakeSandboxRuntimeProvider(),
    createE2bSandboxRuntimeProvider(),
  ]) {
    providers.set(provider.provider, provider);
  }

  function getProvider(providerKey: string): SandboxRuntimeProvider | null {
    return providers.get(providerKey) ?? null;
  }

  function requireProvider(providerKey: string): SandboxRuntimeProvider {
    const provider = getProvider(providerKey);
    if (!provider) {
      throw new Error(`Unsupported sandbox provider "${providerKey}"`);
    }
    return provider;
  }

  return {
    getProvider,

    acquireLease(providerKey: string, input: SandboxProviderAcquireInput) {
      return requireProvider(providerKey).acquireLease(input);
    },

    releaseLease(providerKey: string, input: SandboxProviderReleaseInput) {
      return requireProvider(providerKey).releaseLease(input);
    },

    execute(providerKey: string, input: SandboxProviderExecuteInput) {
      return requireProvider(providerKey).execute(input);
    },

    validateConfig(providerKey: string, config: Record<string, unknown>): Promise<SandboxProviderConfigValidationResult> {
      const provider = requireProvider(providerKey);
      return provider.validateConfig?.(config) ?? Promise.resolve({
        ok: true,
        provider: providerKey,
        sanitizedConfig: { provider: providerKey },
      });
    },

    probe(providerKey: string, input: SandboxProviderProbeInput): Promise<SandboxProviderProbeResult> {
      const provider = requireProvider(providerKey);
      return provider.probe?.(input) ?? Promise.resolve({
        ok: true,
        provider: providerKey,
        summary: `${providerKey} sandbox provider is registered.`,
      });
    },
  };
}

export type SandboxProviderRuntime = ReturnType<typeof sandboxProviderRuntime>;
