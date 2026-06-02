import { describe, expect, it, vi } from "vitest";
import type { Environment, EnvironmentLease } from "@armyofagents/shared";
import {
  EnvironmentRunError,
  environmentRunOrchestrator,
} from "../services/environment-run-orchestrator.js";

const COMPANY = "00000000-0000-0000-0000-000000000001";
const ENVIRONMENT_ID = "00000000-0000-0000-0000-000000000010";
const RUN_ID = "00000000-0000-0000-0000-000000000030";

function makeEnvironment(overrides: Partial<Environment> = {}): Environment {
  return {
    id: ENVIRONMENT_ID,
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
    environmentId: ENVIRONMENT_ID,
    executionWorkspaceId: null,
    issueId: null,
    heartbeatRunId: RUN_ID,
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

describe("environmentRunOrchestrator", () => {
  it("resolves an active environment and acquires a lease for a run", async () => {
    const environment = makeEnvironment();
    const lease = makeLease();
    const runtime = {
      acquireRunLease: vi.fn(async () => ({
        environment,
        lease,
        leaseContext: {
          executionWorkspaceId: "workspace-1",
          executionWorkspaceMode: "per_task",
        },
      })),
    };
    const orchestrator = environmentRunOrchestrator({} as never, {
      environments: { get: vi.fn(async () => environment) },
      environmentRuntime: runtime,
    });

    const result = await orchestrator.acquireForRun({
      companyId: COMPANY,
      environmentId: ENVIRONMENT_ID,
      adapterType: "codex_local",
      issueId: "issue-1",
      heartbeatRunId: RUN_ID,
      persistedExecutionWorkspace: { id: "workspace-1", mode: "per_task" },
    });

    expect(result.environment).toBe(environment);
    expect(result.lease).toBe(lease);
    expect(result.leaseContext.executionWorkspaceId).toBe("workspace-1");
    expect(result.configPatch).toEqual({ executionTarget: { type: "local" } });
    expect(runtime.acquireRunLease).toHaveBeenCalledWith({
      companyId: COMPANY,
      environment,
      issueId: "issue-1",
      heartbeatRunId: RUN_ID,
      persistedExecutionWorkspace: { id: "workspace-1", mode: "per_task" },
    });
  });

  it("returns a sandbox-docker config patch when the environment has an AoA target", async () => {
    const environment = makeEnvironment({
      target: { type: "sandbox-docker", image: "node:22-bookworm" },
    });
    const lease = makeLease();
    const orchestrator = environmentRunOrchestrator({} as never, {
      environments: { get: vi.fn(async () => environment) },
      environmentRuntime: {
        acquireRunLease: vi.fn(async () => ({
          environment,
          lease,
          leaseContext: {
            executionWorkspaceId: null,
            executionWorkspaceMode: null,
          },
        })),
      },
    });

    const result = await orchestrator.acquireForRun({
      companyId: COMPANY,
      environmentId: ENVIRONMENT_ID,
      adapterType: "codex_local",
      issueId: null,
      heartbeatRunId: RUN_ID,
      persistedExecutionWorkspace: null,
    });

    expect(result.configPatch).toEqual({
      executionTarget: {
        type: "sandbox-docker",
        image: "node:22-bookworm",
        workdir: "/workspace",
        shell: "sh",
        network: "bridge",
        remove: true,
        env: {},
        installCommand: null,
      },
    });
  });

  it("returns provider-backed sandbox execution targets that call the runtime provider", async () => {
    const environment = makeEnvironment({
      driver: "sandbox",
      config: { provider: "fake" },
    });
    const lease = makeLease({
      provider: "fake",
      providerLeaseId: "fake-lease-1",
      metadata: {
        providerMetadata: {
          remoteCwd: "/workspace/fake",
          shellCommand: "bash",
        },
      },
    });
    const runtime = {
      acquireRunLease: vi.fn(async () => ({
        environment,
        lease,
        leaseContext: {
          executionWorkspaceId: null,
          executionWorkspaceMode: null,
        },
      })),
      executeRunLeaseCommand: vi.fn(async () => ({
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: "ok",
        stderr: "",
      })),
    };
    const orchestrator = environmentRunOrchestrator({} as never, {
      environments: { get: vi.fn(async () => environment) },
      environmentRuntime: runtime,
    });

    const result = await orchestrator.acquireForRun({
      companyId: COMPANY,
      environmentId: ENVIRONMENT_ID,
      adapterType: "codex_local",
      issueId: null,
      heartbeatRunId: RUN_ID,
      persistedExecutionWorkspace: null,
    });

    expect(result.configPatch.executionTarget).toMatchObject({
      type: "provider-sandbox",
      provider: "fake",
      providerLeaseId: "fake-lease-1",
      remoteCwd: "/workspace/fake",
      shell: "bash",
    });
    const target = result.configPatch.executionTarget;
    if (!target || target.type !== "provider-sandbox") throw new Error("Expected provider target");
    await expect(target.runner.execute({
      runId: RUN_ID,
      provider: "fake",
      providerLeaseId: "fake-lease-1",
      command: "codex",
      args: ["--json"],
      cwd: "/workspace/fake",
      env: { A: "1" },
      timeoutSec: 30,
      graceSec: 2,
      onLog: vi.fn(),
    })).resolves.toEqual({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: "ok",
      stderr: "",
    });
    expect(runtime.executeRunLeaseCommand).toHaveBeenCalledWith({
      environment,
      lease,
      command: "codex",
      args: ["--json"],
      cwd: "/workspace/fake",
      env: { A: "1" },
      stdin: undefined,
      timeoutSec: 30,
    });
  });

  it("rejects missing environments with a typed error", async () => {
    const orchestrator = environmentRunOrchestrator({} as never, {
      environments: { get: vi.fn(async () => null) },
      environmentRuntime: { acquireRunLease: vi.fn() },
    });

    await expect(orchestrator.acquireForRun({
      companyId: COMPANY,
      environmentId: "missing",
      adapterType: "codex_local",
      issueId: null,
      heartbeatRunId: RUN_ID,
      persistedExecutionWorkspace: null,
    })).rejects.toMatchObject({
      name: "EnvironmentRunError",
      code: "environment_not_found",
    });
  });

  it("rejects archived environments before acquiring a lease", async () => {
    const runtime = { acquireRunLease: vi.fn() };
    const orchestrator = environmentRunOrchestrator({} as never, {
      environments: { get: vi.fn(async () => makeEnvironment({ status: "archived" })) },
      environmentRuntime: runtime,
    });

    await expect(orchestrator.acquireForRun({
      companyId: COMPANY,
      environmentId: ENVIRONMENT_ID,
      adapterType: "codex_local",
      issueId: null,
      heartbeatRunId: RUN_ID,
      persistedExecutionWorkspace: null,
    })).rejects.toBeInstanceOf(EnvironmentRunError);
    expect(runtime.acquireRunLease).not.toHaveBeenCalled();
  });
});
