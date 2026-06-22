import { describe, expect, it, vi } from "vitest";
import {
  createE2bSandboxRuntimeProvider,
  createFakeSandboxRuntimeProvider,
  sandboxProviderRuntime,
} from "../services/sandbox-provider-runtime.js";

describe("sandboxProviderRuntime", () => {
  it("registers and resolves sandbox providers by key", () => {
    const provider = createFakeSandboxRuntimeProvider();
    const runtime = sandboxProviderRuntime({ providers: [provider] });

    expect(runtime.getProvider("fake")).toBe(provider);
    expect(runtime.getProvider("missing")).toBeNull();
  });

  it("acquires fake provider leases with remote execution metadata", async () => {
    const runtime = sandboxProviderRuntime({
      providers: [createFakeSandboxRuntimeProvider()],
    });

    const lease = await runtime.acquireLease("fake", {
      companyId: "company-1",
      environmentId: "env-1",
      issueId: "issue-1",
      heartbeatRunId: "run-1",
      config: {
        remoteCwd: "/workspace/run-1",
        shellCommand: "bash",
        timeoutMs: 60_000,
      },
      workspaceMode: "per_task",
    });

    expect(lease.providerLeaseId).toMatch(/^fake-sandbox-/);
    expect(lease.metadata).toEqual({
      provider: "fake",
      remoteCwd: "/workspace/run-1",
      shellCommand: "bash",
      timeoutMs: 60_000,
      workspaceMode: "per_task",
    });
  });

  it("executes commands through the fake provider contract", async () => {
    const provider = createFakeSandboxRuntimeProvider();
    const result = await provider.execute({
      providerLeaseId: "fake-sandbox-1",
      leaseMetadata: { remoteCwd: "/workspace/run-1" },
      command: "printf",
      args: ["hello"],
      cwd: "/workspace/run-1",
      env: { AOA: "1" },
      stdin: null,
      timeoutMs: 5_000,
    });

    expect(result).toEqual({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: "fake: printf hello",
      stderr: "",
      metadata: {
        cwd: "/workspace/run-1",
        envKeys: ["AOA"],
        providerLeaseId: "fake-sandbox-1",
      },
    });
  });

  it("releases fake provider leases idempotently", async () => {
    const provider = createFakeSandboxRuntimeProvider();

    await expect(provider.releaseLease({
      providerLeaseId: "fake-sandbox-1",
      leaseMetadata: { remoteCwd: "/workspace/run-1" },
    })).resolves.toEqual({
      cleanupStatus: "success",
      metadata: {
        releasedProviderLeaseId: "fake-sandbox-1",
      },
    });
  });

  it("acquires E2B leases through an injected E2B SDK importer", async () => {
    const commandsRun = vi.fn(async (command: string) => ({
      exitCode: 0,
      stdout: command === "pwd" ? "/home/user\n" : "",
      stderr: "",
    }));
    const setTimeout = vi.fn(async () => undefined);
    const sandbox = {
      sandboxId: "e2b-sandbox-1",
      sandboxDomain: "sandbox.example",
      commands: { run: commandsRun },
      setTimeout,
      kill: vi.fn(async () => undefined),
    };
    const create = vi.fn(async () => sandbox);
    const provider = createE2bSandboxRuntimeProvider({
      importE2b: async () => ({ Sandbox: { create, connect: vi.fn() } }),
      env: { E2B_API_KEY: "key-from-env" },
    });

    const lease = await provider.acquireLease({
      companyId: "company-1",
      environmentId: "env-1",
      issueId: "issue-1",
      heartbeatRunId: "run-1",
      config: { provider: "e2b", template: "base", timeoutMs: 60_000, reuseLease: true },
      workspaceMode: "per_task",
    });

    expect(create).toHaveBeenCalledWith("base", {
      apiKey: "key-from-env",
      timeoutMs: 60_000,
      metadata: { aoaProvider: "e2b", companyId: "company-1", environmentId: "env-1" },
    });
    expect(setTimeout).toHaveBeenCalledWith(60_000);
    expect(commandsRun).toHaveBeenCalledWith("pwd");
    expect(commandsRun).toHaveBeenCalledWith("mkdir -p '/home/user/aoa-workspace'");
    expect(lease).toEqual({
      providerLeaseId: "e2b-sandbox-1",
      metadata: {
        provider: "e2b",
        template: "base",
        timeoutMs: 60_000,
        reuseLease: true,
        sandboxId: "e2b-sandbox-1",
        sandboxDomain: "sandbox.example",
        remoteCwd: "/home/user/aoa-workspace",
        shellCommand: "bash",
        workspaceMode: "per_task",
      },
    });
  });

  it("validates E2B config without exposing API keys", async () => {
    const provider = createE2bSandboxRuntimeProvider({
      importE2b: async () => ({ Sandbox: { create: vi.fn(), connect: vi.fn() } }),
      env: {},
    });

    await expect(provider.validateConfig?.({
      provider: "e2b",
      template: "base",
      apiKey: "secret-key",
      timeoutMs: 60_000,
    })).resolves.toEqual({
      ok: true,
      provider: "e2b",
      sanitizedConfig: {
        provider: "e2b",
        template: "base",
        timeoutMs: 60_000,
        reuseLease: false,
        hasApiKey: true,
      },
    });
  });

  it("accepts internally resolved E2B API keys without exposing them", async () => {
    const provider = createE2bSandboxRuntimeProvider({
      importE2b: async () => ({ Sandbox: { create: vi.fn(), connect: vi.fn() } }),
      env: {},
    });

    await expect(provider.validateConfig?.({
      provider: "e2b",
      template: "base",
      resolvedApiKey: "resolved-secret-key",
      timeoutMs: 60_000,
    })).resolves.toEqual({
      ok: true,
      provider: "e2b",
      sanitizedConfig: {
        provider: "e2b",
        template: "base",
        timeoutMs: 60_000,
        reuseLease: false,
        hasApiKey: true,
      },
    });
  });

  it("rejects E2B config that has no API key source", async () => {
    const provider = createE2bSandboxRuntimeProvider({
      importE2b: async () => ({ Sandbox: { create: vi.fn(), connect: vi.fn() } }),
      env: {},
    });

    await expect(provider.validateConfig?.({
      provider: "e2b",
      template: "base",
    })).resolves.toEqual({
      ok: false,
      provider: "e2b",
      errors: ["E2B sandbox environments require an API key in config or E2B_API_KEY."],
      sanitizedConfig: {
        provider: "e2b",
        template: "base",
        timeoutMs: 3_600_000,
        reuseLease: false,
        hasApiKey: false,
      },
    });
  });

  it("probes E2B by creating and cleaning up a sandbox", async () => {
    const commandsRun = vi.fn(async (command: string) => ({
      exitCode: 0,
      stdout: command === "pwd" ? "/home/user\n" : "",
      stderr: "",
    }));
    const sandbox = {
      sandboxId: "e2b-probe-1",
      sandboxDomain: "probe.example",
      commands: { run: commandsRun },
      setTimeout: vi.fn(async () => undefined),
      kill: vi.fn(async () => undefined),
    };
    const create = vi.fn(async () => sandbox);
    const provider = createE2bSandboxRuntimeProvider({
      importE2b: async () => ({ Sandbox: { create, connect: vi.fn() } }),
      env: {},
    });

    const result = await provider.probe?.({
      companyId: "company-1",
      environmentId: "probe",
      config: { provider: "e2b", template: "base", apiKey: "secret-key", timeoutMs: 60_000 },
    });

    expect(create).toHaveBeenCalledWith("base", {
      apiKey: "secret-key",
      timeoutMs: 60_000,
      metadata: { aoaProvider: "e2b", companyId: "company-1", environmentId: "probe" },
    });
    expect(sandbox.kill).toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      provider: "e2b",
      summary: "E2B sandbox created and workspace directory prepared.",
      metadata: {
        template: "base",
        timeoutMs: 60_000,
        sandboxId: "e2b-probe-1",
        sandboxDomain: "probe.example",
        remoteCwd: "/home/user/aoa-workspace",
      },
    });
    expect(JSON.stringify(result)).not.toContain("secret-key");
  });

  it("executes E2B commands through a login shell with staged stdin", async () => {
    const commandsRun = vi.fn(async (command: string, options?: Record<string, unknown>) => ({
      exitCode: 0,
      stdout: `ran:${command}`,
      stderr: JSON.stringify(options ?? {}),
    }));
    const sandbox = {
      commands: { run: commandsRun },
      files: {
        write: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined),
      },
      setTimeout: vi.fn(async () => undefined),
    };
    const connect = vi.fn(async () => sandbox);
    const provider = createE2bSandboxRuntimeProvider({
      importE2b: async () => ({ Sandbox: { create: vi.fn(), connect } }),
      env: { E2B_API_KEY: "key-from-env" },
      randomId: () => "stdin-1",
    });

    const result = await provider.execute({
      providerLeaseId: "e2b-sandbox-1",
      leaseMetadata: { template: "base", timeoutMs: 30_000, remoteCwd: "/workspace" },
      config: { template: "base", apiKey: "key-from-config", timeoutMs: 30_000 },
      command: "codex",
      args: ["--json"],
      cwd: "/workspace",
      env: { AOA: "1" },
      stdin: "hello",
      timeoutMs: 5_000,
    });

    expect(connect).toHaveBeenCalledWith("e2b-sandbox-1", {
      apiKey: "key-from-config",
      timeoutMs: 30_000,
    });
    expect(sandbox.files.write).toHaveBeenCalledWith("/tmp/aoa-stdin-stdin-1", "hello");
    expect(commandsRun).toHaveBeenCalledWith(
      expect.stringContaining("exec env AOA='1' 'codex' '--json' < '/tmp/aoa-stdin-stdin-1'"),
      { cwd: "/workspace", timeoutMs: 5_000 },
    );
    expect(sandbox.files.remove).toHaveBeenCalledWith("/tmp/aoa-stdin-stdin-1");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stdout).toContain("codex");
  });

  it("creates CODEX_HOME before executing E2B commands that need it", async () => {
    const commandsRun = vi.fn(async (command: string, options?: Record<string, unknown>) => ({
      exitCode: 0,
      stdout: `ran:${command}`,
      stderr: JSON.stringify(options ?? {}),
    }));
    const sandbox = {
      commands: { run: commandsRun },
      setTimeout: vi.fn(async () => undefined),
    };
    const connect = vi.fn(async () => sandbox);
    const provider = createE2bSandboxRuntimeProvider({
      importE2b: async () => ({ Sandbox: { create: vi.fn(), connect } }),
      env: { E2B_API_KEY: "key-from-env" },
    });

    await provider.execute({
      providerLeaseId: "e2b-sandbox-1",
      leaseMetadata: { template: "base", timeoutMs: 30_000, remoteCwd: "/workspace" },
      config: { template: "base", apiKey: "key-from-config", timeoutMs: 30_000 },
      command: "codex",
      args: ["exec", "-"],
      cwd: "/workspace",
      env: { CODEX_HOME: "/tmp/aoa-codex-home", OPENAI_API_KEY: "redacted" },
      stdin: null,
      timeoutMs: 5_000,
    });

    expect(commandsRun).toHaveBeenCalledWith(
      expect.stringContaining("mkdir -p '/tmp/aoa-codex-home' && exec env"),
      { cwd: "/workspace", timeoutMs: 5_000 },
    );
  });

  it("connects to E2B using internally resolved credentials", async () => {
    const commandsRun = vi.fn(async (command: string, options?: Record<string, unknown>) => ({
      exitCode: 0,
      stdout: `ran:${command}`,
      stderr: JSON.stringify(options ?? {}),
    }));
    const sandbox = {
      commands: { run: commandsRun },
      setTimeout: vi.fn(async () => undefined),
    };
    const connect = vi.fn(async () => sandbox);
    const provider = createE2bSandboxRuntimeProvider({
      importE2b: async () => ({ Sandbox: { create: vi.fn(), connect } }),
      env: {},
    });

    await provider.execute({
      providerLeaseId: "e2b-sandbox-1",
      leaseMetadata: { template: "base", timeoutMs: 30_000, remoteCwd: "/workspace" },
      config: { template: "base", resolvedApiKey: "resolved-secret-key", timeoutMs: 30_000 },
      command: "pwd",
      args: [],
      cwd: "/workspace",
      env: {},
      stdin: null,
      timeoutMs: 5_000,
    });

    expect(connect).toHaveBeenCalledWith("e2b-sandbox-1", {
      apiKey: "resolved-secret-key",
      timeoutMs: 30_000,
    });
  });

  it("registers fake and E2B providers by default", () => {
    const runtime = sandboxProviderRuntime();
    expect(runtime.getProvider("fake")).not.toBeNull();
    expect(runtime.getProvider("e2b")).not.toBeNull();
  });
});
