import { describe, expect, it, vi } from "vitest";
import type { Environment, EnvironmentLease } from "@armyofagents/shared";
import {
  buildEnvironmentLeaseContext,
  environmentRuntimeService,
} from "../services/environment-runtime.js";

const COMPANY = "00000000-0000-0000-0000-000000000001";

function makeEnvironment(overrides: Partial<Environment> = {}): Environment {
  return {
    id: "00000000-0000-0000-0000-000000000010",
    companyId: COMPANY,
    name: "Local",
    description: null,
    driver: "local",
    status: "active",
    config: {},
    metadata: null,
    envVars: {},
    connectionTarget: null,
    target: null,
    createdAt: new Date("2026-01-01T00:00:00Z").toISOString(),
    updatedAt: new Date("2026-01-01T00:00:00Z").toISOString(),
    ...overrides,
  };
}

function makeLease(overrides: Partial<EnvironmentLease> = {}): EnvironmentLease {
  return {
    id: "00000000-0000-0000-0000-000000000020",
    companyId: COMPANY,
    environmentId: "00000000-0000-0000-0000-000000000010",
    executionWorkspaceId: null,
    issueId: null,
    heartbeatRunId: "00000000-0000-0000-0000-000000000030",
    status: "active",
    leasePolicy: "ephemeral",
    provider: "local",
    providerLeaseId: null,
    acquiredAt: new Date("2026-01-01T00:00:00Z").toISOString(),
    lastUsedAt: new Date("2026-01-01T00:00:00Z").toISOString(),
    expiresAt: null,
    releasedAt: null,
    failureReason: null,
    cleanupStatus: null,
    metadata: { driver: "local" },
    createdAt: new Date("2026-01-01T00:00:00Z").toISOString(),
    updatedAt: new Date("2026-01-01T00:00:00Z").toISOString(),
    ...overrides,
  };
}

describe("buildEnvironmentLeaseContext", () => {
  it("captures execution workspace id and mode for lease metadata", () => {
    expect(buildEnvironmentLeaseContext({
      persistedExecutionWorkspace: {
        id: "workspace-1",
        mode: "per_task",
      },
    })).toEqual({
      executionWorkspaceId: "workspace-1",
      executionWorkspaceMode: "per_task",
    });
  });
});

describe("environmentRuntimeService", () => {
  it("acquires local run leases through the environment service", async () => {
    const lease = makeLease({ executionWorkspaceId: "workspace-1", issueId: "issue-1" });
    const acquireLease = vi.fn(async () => lease);
    const runtime = environmentRuntimeService({} as never, {
      environments: {
        acquireLease,
        releaseLease: vi.fn(),
        releaseLeasesForRun: vi.fn(),
      },
    });

    const result = await runtime.acquireRunLease({
      companyId: COMPANY,
      environment: makeEnvironment(),
      issueId: "issue-1",
      heartbeatRunId: "00000000-0000-0000-0000-000000000030",
      persistedExecutionWorkspace: { id: "workspace-1", mode: "per_task" },
    });

    expect(result).toEqual({
      environment: makeEnvironment(),
      lease,
      leaseContext: {
        executionWorkspaceId: "workspace-1",
        executionWorkspaceMode: "per_task",
      },
    });
    expect(acquireLease).toHaveBeenCalledWith({
      companyId: COMPANY,
      environmentId: "00000000-0000-0000-0000-000000000010",
      executionWorkspaceId: "workspace-1",
      issueId: "issue-1",
      heartbeatRunId: "00000000-0000-0000-0000-000000000030",
      leasePolicy: "ephemeral",
      provider: "local",
      metadata: {
        driver: "local",
        executionWorkspaceMode: "per_task",
      },
    });
  });

  it("releases leases through the owning driver", async () => {
    const lease = makeLease();
    const released = makeLease({ status: "released" });
    const releaseLease = vi.fn(async () => released);
    const runtime = environmentRuntimeService({} as never, {
      environments: {
        acquireLease: vi.fn(),
        releaseLease,
        releaseLeasesForRun: vi.fn(),
      },
    });

    const result = await runtime.releaseRunLease({
      environment: makeEnvironment(),
      lease,
      status: "released",
    });

    expect(result).toEqual(released);
    expect(releaseLease).toHaveBeenCalledWith(lease.id, "released");
  });

  it("acquires Docker sandbox leases with sandbox-docker provider metadata", async () => {
    const lease = makeLease({
      provider: "sandbox-docker",
      metadata: {
        driver: "sandbox",
        executionWorkspaceMode: "per_task",
        provider: "sandbox-docker",
        image: "node:22-bookworm",
      },
    });
    const acquireLease = vi.fn(async () => lease);
    const runtime = environmentRuntimeService({} as never, {
      environments: {
        acquireLease,
        releaseLease: vi.fn(),
        releaseLeasesForRun: vi.fn(),
      },
    });

    const result = await runtime.acquireRunLease({
      companyId: COMPANY,
      environment: makeEnvironment({
        driver: "sandbox",
        config: { provider: "sandbox-docker", image: "node:22-bookworm" },
      }),
      issueId: "issue-1",
      heartbeatRunId: "00000000-0000-0000-0000-000000000030",
      persistedExecutionWorkspace: { id: "workspace-1", mode: "per_task" },
    });

    expect(result.lease).toEqual(lease);
    expect(acquireLease).toHaveBeenCalledWith({
      companyId: COMPANY,
      environmentId: "00000000-0000-0000-0000-000000000010",
      executionWorkspaceId: "workspace-1",
      issueId: "issue-1",
      heartbeatRunId: "00000000-0000-0000-0000-000000000030",
      leasePolicy: "ephemeral",
      provider: "sandbox-docker",
      metadata: {
        driver: "sandbox",
        executionWorkspaceMode: "per_task",
        provider: "sandbox-docker",
        image: "node:22-bookworm",
      },
    });
  });

  it("acquires fake provider sandbox leases through provider runtime", async () => {
    const lease = makeLease({
      provider: "fake",
      providerLeaseId: "fake-sandbox-env-1-run-1",
      metadata: {
        driver: "sandbox",
        executionWorkspaceMode: null,
        provider: "fake",
        providerMetadata: {
          provider: "fake",
          remoteCwd: "/workspace/fake",
          shellCommand: "bash",
          timeoutMs: 30000,
          workspaceMode: null,
        },
      },
    });
    const acquireLease = vi.fn(async () => lease);
    const runtime = environmentRuntimeService({} as never, {
      environments: {
        acquireLease,
        releaseLease: vi.fn(),
        releaseLeasesForRun: vi.fn(),
      },
    });

    const result = await runtime.acquireRunLease({
      companyId: COMPANY,
      environment: makeEnvironment({
        driver: "sandbox",
        config: {
          provider: "fake",
          remoteCwd: "/workspace/fake",
          shellCommand: "bash",
          timeoutMs: 30000,
        },
      }),
      issueId: null,
      heartbeatRunId: "run-1",
      persistedExecutionWorkspace: null,
    });

    expect(result.lease).toEqual(lease);
    expect(acquireLease).toHaveBeenCalledWith(expect.objectContaining({
      provider: "fake",
      providerLeaseId: expect.stringMatching(/^fake-sandbox-/),
      metadata: expect.objectContaining({
        driver: "sandbox",
        provider: "fake",
        providerMetadata: expect.objectContaining({
          remoteCwd: "/workspace/fake",
          shellCommand: "bash",
          timeoutMs: 30000,
        }),
      }),
    }));
  });

  it("resolves E2B provider keys before acquiring provider leases", async () => {
    const acquireLease = vi.fn(async () => makeLease({
      provider: "e2b",
      providerLeaseId: "e2b-lease-1",
      metadata: {
        driver: "sandbox",
        provider: "e2b",
        providerMetadata: {
          provider: "e2b",
          remoteCwd: "/workspace",
        },
      },
    }));
    const providerAcquireLease = vi.fn(async () => ({
      providerLeaseId: "e2b-lease-1",
      metadata: {
        provider: "e2b",
        remoteCwd: "/workspace",
        resolvedApiKey: "must-not-persist",
      },
    }));
    const runtimeProviderKeys = {
      resolveCredential: vi.fn(async () => "sk-e2b"),
    };
    const runtime = environmentRuntimeService({} as never, {
      environments: {
        acquireLease,
        releaseLease: vi.fn(),
        releaseLeasesForRun: vi.fn(),
      },
      sandboxProviders: [{
        provider: "e2b",
        acquireLease: providerAcquireLease,
        releaseLease: vi.fn(),
        execute: vi.fn(),
      }],
      runtimeProviderKeys: runtimeProviderKeys as never,
    } as never);

    await runtime.acquireRunLease({
      companyId: COMPANY,
      environment: makeEnvironment({
        driver: "sandbox",
        config: { provider: "e2b", credentialRef: "default", template: "base" },
      }),
      issueId: "issue-1",
      heartbeatRunId: "run-1",
      persistedExecutionWorkspace: null,
    });

    expect(runtimeProviderKeys.resolveCredential).toHaveBeenCalledWith(
      COMPANY,
      "e2b",
      expect.objectContaining({ credentialRef: "default" }),
      expect.objectContaining({
        consumerType: "system",
        consumerId: "runtime-provider-key:e2b",
        actorType: "system",
        configPath: "runtimeProviderKeys.e2b.default",
        issueId: "issue-1",
        heartbeatRunId: "run-1",
      }),
    );
    expect(providerAcquireLease).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({ resolvedApiKey: "sk-e2b" }),
    }));
    expect(acquireLease).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.not.objectContaining({ resolvedApiKey: expect.any(String) }),
    }));
    expect(JSON.stringify(acquireLease.mock.calls[0]?.[0]?.metadata)).not.toContain("sk-e2b");
  });

  it("releases all active run leases through their owning provider drivers", async () => {
    const providerRelease = vi.fn(async () => ({ cleanupStatus: "success" as const }));
    const releaseLease = vi.fn(async () => makeLease({
      provider: "e2b",
      providerLeaseId: "e2b-lease-1",
      status: "released",
      cleanupStatus: "success",
    }));
    const runtimeProviderKeys = {
      resolveCredential: vi.fn(async () => "sk-e2b"),
    };
    const environment = makeEnvironment({
      driver: "sandbox",
      config: { provider: "e2b", credentialRef: "default", template: "base" },
    });
    const lease = makeLease({
      provider: "e2b",
      providerLeaseId: "e2b-lease-1",
      metadata: {
        providerMetadata: {
          remoteCwd: "/workspace",
        },
      },
    });
    const runtime = environmentRuntimeService({} as never, {
      environments: {
        get: vi.fn(async () => environment),
        listActiveLeasesForRun: vi.fn(async () => [lease]),
        acquireLease: vi.fn(),
        releaseLease,
        releaseLeasesForRun: vi.fn(),
      },
      sandboxProviders: [{
        provider: "e2b",
        acquireLease: vi.fn(),
        releaseLease: providerRelease,
        execute: vi.fn(),
      }],
      runtimeProviderKeys: runtimeProviderKeys as never,
    } as never);

    const released = await runtime.releaseRunLeases("run-1");

    expect(providerRelease).toHaveBeenCalledWith(expect.objectContaining({
      providerLeaseId: "e2b-lease-1",
      config: expect.objectContaining({ resolvedApiKey: "sk-e2b" }),
    }));
    expect(releaseLease).toHaveBeenCalledWith(lease.id, "released", {
      cleanupStatus: "success",
    });
    expect(released).toHaveLength(1);
    expect(released[0]?.status).toBe("released");
  });

  it("cleans up provider leases when DB lease persistence fails after provider acquire", async () => {
    const providerAcquireLease = vi.fn(async () => ({
      providerLeaseId: "e2b-lease-orphan-risk",
      metadata: {
        provider: "e2b",
        remoteCwd: "/workspace",
      },
    }));
    const providerRelease = vi.fn(async () => ({ cleanupStatus: "success" as const }));
    const runtime = environmentRuntimeService({} as never, {
      environments: {
        acquireLease: vi.fn(async () => {
          throw new Error("db insert failed");
        }),
        releaseLease: vi.fn(),
        releaseLeasesForRun: vi.fn(),
      },
      sandboxProviders: [{
        provider: "e2b",
        acquireLease: providerAcquireLease,
        releaseLease: providerRelease,
        execute: vi.fn(),
      }],
      runtimeProviderKeys: {
        resolveCredential: vi.fn(async () => "sk-e2b"),
      } as never,
    } as never);

    await expect(runtime.acquireRunLease({
      companyId: COMPANY,
      environment: makeEnvironment({
        driver: "sandbox",
        config: { provider: "e2b", credentialRef: "default", template: "base" },
      }),
      issueId: "issue-1",
      heartbeatRunId: "run-1",
      persistedExecutionWorkspace: null,
    })).rejects.toThrow("db insert failed");

    expect(providerAcquireLease).toHaveBeenCalled();
    expect(providerRelease).toHaveBeenCalledWith(expect.objectContaining({
      providerLeaseId: "e2b-lease-orphan-risk",
      config: expect.objectContaining({ resolvedApiKey: "sk-e2b" }),
    }));
  });

  it("resolves E2B provider keys before execute and release", async () => {
    const providerExecute = vi.fn(async () => ({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: "ok",
      stderr: "",
    }));
    const providerRelease = vi.fn(async () => ({ cleanupStatus: "success" as const }));
    const releaseLease = vi.fn(async () => makeLease({ status: "released" }));
    const runtimeProviderKeys = {
      resolveCredential: vi.fn(async () => "sk-e2b"),
    };
    const runtime = environmentRuntimeService({} as never, {
      environments: {
        acquireLease: vi.fn(),
        releaseLease,
        releaseLeasesForRun: vi.fn(),
      },
      sandboxProviders: [{
        provider: "e2b",
        acquireLease: vi.fn(),
        releaseLease: providerRelease,
        execute: providerExecute,
      }],
      runtimeProviderKeys: runtimeProviderKeys as never,
    } as never);
    const environment = makeEnvironment({
      driver: "sandbox",
      config: { provider: "e2b", credentialRef: "default", template: "base" },
    });
    const lease = makeLease({
      provider: "e2b",
      providerLeaseId: "e2b-lease-1",
      issueId: "issue-1",
      heartbeatRunId: "run-1",
      metadata: {
        providerMetadata: {
          remoteCwd: "/workspace",
        },
      },
    });

    await runtime.executeRunLeaseCommand({
      lease,
      environment,
      command: "codex",
      args: ["--json"],
      cwd: "/workspace",
      env: {},
      stdin: null,
      timeoutSec: 30,
    });
    await runtime.releaseRunLease({ environment, lease, status: "released" });

    expect(providerExecute).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({ resolvedApiKey: "sk-e2b" }),
    }));
    expect(providerRelease).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({ resolvedApiKey: "sk-e2b" }),
    }));
  });

  it("executes commands through fake provider sandbox leases", async () => {
    const runtime = environmentRuntimeService({} as never, {
      environments: {
        acquireLease: vi.fn(),
        releaseLease: vi.fn(),
        releaseLeasesForRun: vi.fn(),
      },
    });

    const result = await runtime.executeRunLeaseCommand({
      lease: makeLease({
        provider: "fake",
        providerLeaseId: "fake-lease-1",
        metadata: {
          providerMetadata: {
            remoteCwd: "/workspace/fake",
          },
        },
      }),
      environment: makeEnvironment({ driver: "sandbox", config: { provider: "fake" } }),
      command: "codex",
      args: ["--json"],
      cwd: "/workspace/fake",
      env: { A: "1" },
      stdin: "prompt",
      timeoutSec: 30,
    });

    expect(result).toMatchObject({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: "fake: codex --json",
      stderr: "",
    });
  });

  it("rejects unknown sandbox providers until provider runtime exists", async () => {
    const runtime = environmentRuntimeService({} as never, {
      environments: {
        acquireLease: vi.fn(),
        releaseLease: vi.fn(),
        releaseLeasesForRun: vi.fn(),
      },
    });

    await expect(runtime.acquireRunLease({
      companyId: COMPANY,
      environment: makeEnvironment({
        driver: "sandbox",
        config: { provider: "daytona", image: "node:22-bookworm" },
      }),
      issueId: null,
      heartbeatRunId: "00000000-0000-0000-0000-000000000030",
      persistedExecutionWorkspace: null,
    })).rejects.toThrow('Unsupported sandbox provider "daytona"');
  });

  it("fails fast for non-local non-sandbox drivers until their runtime drivers are implemented", async () => {
    const runtime = environmentRuntimeService({} as never, {
      environments: {
        acquireLease: vi.fn(),
        releaseLease: vi.fn(),
        releaseLeasesForRun: vi.fn(),
      },
    });

    await expect(runtime.acquireRunLease({
      companyId: COMPANY,
      environment: makeEnvironment({ driver: "ssh" }),
      issueId: null,
      heartbeatRunId: "00000000-0000-0000-0000-000000000030",
      persistedExecutionWorkspace: null,
    })).rejects.toThrow(/unsupported environment driver/i);
  });
});
