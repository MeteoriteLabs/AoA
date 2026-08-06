import { describe, it, expect, vi } from "vitest";
import { acquireExecutionContext } from "../services/acquire-execution-context.js";
import { EnvironmentRunError } from "../services/environment-run-orchestrator.js";

describe("acquireExecutionContext", () => {
  it("passes environmentId ?? null STRAIGHT into acquireForRun and returns {sandbox, lease}", async () => {
    const acquireForRun = vi.fn().mockResolvedValue({
      lease: { id: "lease-1", provider: "e2b", providerLeaseId: "e2b-1", metadata: {} }, // S6: EnvironmentLease shape
      environment: { id: "env-plat", companyId: "c1", driver: "sandbox" }, // S5: real shape
      adapterType: "claude_local",
      configPatch: { executionTarget: { type: "provider-sandbox", provider: "e2b", providerLeaseId: "lease-1", remoteCwd: "/workspace", runner: { execute: () => {} } } },
    });
    const orchestrator = { acquireForRun, resolveEnvironment: vi.fn() };
    const result = await acquireExecutionContext(
      { orchestrator } as any,
      {
        runIdentity: { companyId: "c1", agentId: "a1", runId: "r1", adapterType: "claude_local" },
        functionType: null,          // Commander → ephemeral
        warmPreference: "auto",
        worktree: null,
        environmentId: null,          // nothing pinned → null flows through; orchestrator (U1) resolves platform default
      },
    );
    // S1: the helper does NOT resolve a default id — null is what acquireForRun receives.
    expect(acquireForRun).toHaveBeenCalledWith(expect.objectContaining({ companyId: "c1", environmentId: null }));
    expect(result.sandbox?.configPatch).toBeTruthy();
    expect(result.sandbox?.environment.driver).toBe("sandbox"); // S5
    expect(result.lease).toEqual(expect.objectContaining({ id: "lease-1", provider: "e2b" }));
    // Warm is deferred (U7): a null functionType must resolve ephemeral, never warm.
    expect(result.warmResolved).toBe(false);
  });

  it("threads a pinned environmentId through unchanged (heartbeat path)", async () => {
    const acquireForRun = vi.fn().mockResolvedValue({
      lease: { id: "lease-2", provider: "e2b", providerLeaseId: "e2b-2", metadata: {} },
      environment: { id: "env-pin", companyId: "c1", driver: "sandbox" },
      adapterType: "claude_local",
      configPatch: {},
    });
    const orchestrator = { acquireForRun, resolveEnvironment: vi.fn() };
    await acquireExecutionContext(
      { orchestrator } as any,
      { runIdentity: { companyId: "c1", agentId: "a1", runId: "r1", adapterType: "claude_local" }, functionType: "software_development", warmPreference: "auto", worktree: null, environmentId: "env-pin" },
    );
    expect(acquireForRun).toHaveBeenCalledWith(expect.objectContaining({ environmentId: "env-pin" }));
  });

  it("returns {sandbox:null} when the orchestrator resolves no environment (desktop/local_trusted → environment_not_found)", async () => {
    // S1: on desktop, resolvePlatformDefaultEnvironment returns null and resolveEnvironment
    // throws environment_not_found (as today). That throw is the local-execution signal.
    const acquireForRun = vi.fn().mockRejectedValue(new EnvironmentRunError("environment_not_found", "No environment selected."));
    const orchestrator = { acquireForRun, resolveEnvironment: vi.fn() };
    const result = await acquireExecutionContext(
      { orchestrator } as any,
      { runIdentity: { companyId: "c1", agentId: null, runId: "r1", adapterType: "claude_local" }, functionType: null, warmPreference: "auto", worktree: null, environmentId: null },
    );
    expect(result.sandbox).toBeNull();
    expect(result.lease).toBeNull();
  });

  it("RE-THROWS a non-'not_found' environment error (a cloud misconfig must fail loud, never silently fall to local)", async () => {
    const acquireForRun = vi.fn().mockRejectedValue(new EnvironmentRunError("environment_inactive", "inactive"));
    const orchestrator = { acquireForRun, resolveEnvironment: vi.fn() };
    await expect(
      acquireExecutionContext({ orchestrator } as any, {
        runIdentity: { companyId: "c1", agentId: null, runId: "r1", adapterType: "claude_local" }, functionType: null, warmPreference: "auto", worktree: null, environmentId: null,
      }),
    ).rejects.toThrow(/inactive/);
  });
});
