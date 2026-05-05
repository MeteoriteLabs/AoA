import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: any[]) => args),
  eq: vi.fn((a: any, b: any) => ({ eq: [a, b] })),
  desc: vi.fn((col: any) => ({ desc: col })),
  inArray: vi.fn((col: any, vals: any) => ({ inArray: [col, vals] })),
}));

vi.mock("@armyofagents/db", () => ({
  executionWorkspaces: {
    id: "ew_id",
    companyId: "ew_company_id",
    projectId: "ew_project_id",
    projectWorkspaceId: "ew_project_workspace_id",
    sourceIssueId: "ew_source_issue_id",
    mode: "ew_mode",
    strategyType: "ew_strategy_type",
    name: "ew_name",
    status: "ew_status",
    cwd: "ew_cwd",
    repoUrl: "ew_repo_url",
    baseRef: "ew_base_ref",
    branchName: "ew_branch_name",
    providerType: "ew_provider_type",
    providerRef: "ew_provider_ref",
    derivedFromExecutionWorkspaceId: "ew_derived_from",
    lastUsedAt: "ew_last_used_at",
    openedAt: "ew_opened_at",
    closedAt: "ew_closed_at",
    cleanupEligibleAt: "ew_cleanup_eligible_at",
    cleanupReason: "ew_cleanup_reason",
    metadata: "ew_metadata",
    createdAt: "ew_created_at",
    updatedAt: "ew_updated_at",
  },
  projectWorkspaces: {
    id: "pw_id",
    companyId: "pw_company_id",
    projectId: "pw_project_id",
    cwd: "pw_cwd",
    repoUrl: "pw_repo_url",
    repoRef: "pw_repo_ref",
    defaultRef: "pw_default_ref",
    metadata: "pw_metadata",
  },
  workspaceRuntimeServices: {
    id: "wrs_id",
    companyId: "wrs_company_id",
    projectId: "wrs_project_id",
    projectWorkspaceId: "wrs_project_workspace_id",
    executionWorkspaceId: "wrs_execution_workspace_id",
    scopeType: "wrs_scope_type",
    scopeId: "wrs_scope_id",
    serviceName: "wrs_service_name",
    status: "wrs_status",
    lifecycle: "wrs_lifecycle",
    reuseKey: "wrs_reuse_key",
    command: "wrs_command",
    cwd: "wrs_cwd",
    port: "wrs_port",
    url: "wrs_url",
    provider: "wrs_provider",
    providerRef: "wrs_provider_ref",
    lastUsedAt: "wrs_last_used_at",
    startedAt: "wrs_started_at",
    stoppedAt: "wrs_stopped_at",
    stopPolicy: "wrs_stop_policy",
    healthStatus: "wrs_health_status",
    createdAt: "wrs_created_at",
    updatedAt: "wrs_updated_at",
  },
}));

vi.mock("../adapters/utils.js", () => ({
  asNumber: (value: unknown, fallback: number) => (typeof value === "number" ? value : fallback),
  asString: (value: unknown, fallback: string) => (typeof value === "string" ? value : fallback),
  parseObject: (value: unknown) => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}),
  renderTemplate: (template: string) => template,
}));

vi.mock("../home-paths.js", () => ({
  resolveHomeAwarePath: (p: string) => p,
}));

// `../middleware/logger.js` (used by workspace-runtime.ts after the C1 audit
// log) eagerly resolves AoA's config + log directory at import time, which in
// turn drags in `../home-paths.js` exports beyond `resolveHomeAwarePath`.
// Stub the logger here so the mock above remains a minimal partial.
vi.mock("../middleware/logger.js", () => ({
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    trace: () => {},
    fatal: () => {},
  },
}));

// ── Imports under test ────────────────────────────────────────────────────────

import {
  buildWorkspaceRuntimeDesiredStatePatch,
  listConfiguredRuntimeServiceEntries,
  resetRuntimeServicesForTests,
  resolveShell,
  resolveWorkspaceRuntimeReadinessTimeoutSec,
  restartDesiredRuntimeServicesOnStartup,
  stopRuntimeServicesForProjectWorkspace,
} from "../services/workspace-runtime.js";
import {
  mergeProjectWorkspaceRuntimeConfig,
  readProjectWorkspaceRuntimeConfig,
} from "../services/project-workspace-runtime-config.js";
import {
  selectCurrentRuntimeServiceRows,
} from "../services/workspace-runtime-read-model.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRuntimeRow(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: "svc-1",
    companyId: "company-1",
    projectId: "project-1",
    projectWorkspaceId: null,
    executionWorkspaceId: null,
    issueId: null,
    scopeType: "execution_workspace",
    scopeId: "ws-1",
    serviceName: "web",
    status: "running",
    lifecycle: "shared",
    reuseKey: "reuse-1",
    command: "pnpm dev",
    cwd: "/tmp/ws",
    port: 3000,
    url: "http://localhost:3000",
    provider: "local_process",
    providerRef: null,
    ownerAgentId: null,
    startedByRunId: null,
    lastUsedAt: now,
    startedAt: now,
    stoppedAt: null,
    stopPolicy: null,
    healthStatus: "healthy",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

beforeEach(async () => {
  await resetRuntimeServicesForTests();
});

// ── Pure function tests ───────────────────────────────────────────────────────

describe("resolveShell", () => {
  it("returns a non-empty string", () => {
    const shell = resolveShell();
    expect(typeof shell).toBe("string");
    expect(shell.length).toBeGreaterThan(0);
  });

  it("falls back to platform default when SHELL is empty", () => {
    const originalShell = process.env.SHELL;
    delete process.env.SHELL;
    try {
      const shell = resolveShell();
      if (process.platform === "win32") {
        expect(shell).toBe("cmd.exe");
      } else {
        expect(shell).toBe("/bin/sh");
      }
    } finally {
      if (originalShell !== undefined) process.env.SHELL = originalShell;
    }
  });
});

describe("resolveWorkspaceRuntimeReadinessTimeoutSec", () => {
  it("returns explicit readiness.timeoutSec when provided", () => {
    const timeout = resolveWorkspaceRuntimeReadinessTimeoutSec({
      readiness: { timeoutSec: 120 },
    });
    expect(timeout).toBe(120);
  });

  it("returns 90 for dev server commands when no explicit timeout", () => {
    expect(resolveWorkspaceRuntimeReadinessTimeoutSec({ command: "pnpm dev" })).toBe(90);
    expect(resolveWorkspaceRuntimeReadinessTimeoutSec({ command: "npm run dev" })).toBe(90);
    expect(resolveWorkspaceRuntimeReadinessTimeoutSec({ command: "yarn dev" })).toBe(90);
  });

  it("returns 30 for non-dev commands", () => {
    expect(resolveWorkspaceRuntimeReadinessTimeoutSec({ command: "pnpm test" })).toBe(30);
    expect(resolveWorkspaceRuntimeReadinessTimeoutSec({})).toBe(30);
  });

  it("floors to 1 when explicit timeout is 0 but command is not a dev server", () => {
    expect(resolveWorkspaceRuntimeReadinessTimeoutSec({ readiness: { timeoutSec: 0 } })).toBe(30);
  });
});

describe("listConfiguredRuntimeServiceEntries", () => {
  it("returns services array from workspaceRuntime", () => {
    const entries = listConfiguredRuntimeServiceEntries({
      workspaceRuntime: {
        services: [
          { name: "web", command: "pnpm dev" },
          { name: "api", command: "pnpm dev:api" },
        ],
      },
    });
    expect(entries).toHaveLength(2);
    expect(entries[0]?.name).toBe("web");
  });

  it("returns empty array when no services configured", () => {
    expect(listConfiguredRuntimeServiceEntries({})).toEqual([]);
    expect(listConfiguredRuntimeServiceEntries({ workspaceRuntime: {} })).toEqual([]);
    expect(listConfiguredRuntimeServiceEntries({ workspaceRuntime: { services: null } })).toEqual([]);
  });

  it("filters out non-object entries", () => {
    const entries = listConfiguredRuntimeServiceEntries({
      workspaceRuntime: {
        services: [{ name: "web" }, "invalid", null, { name: "api" }],
      },
    });
    expect(entries).toHaveLength(2);
  });
});

describe("buildWorkspaceRuntimeDesiredStatePatch", () => {
  const config = {
    workspaceRuntime: {
      services: [
        { name: "web", command: "pnpm dev" },
        { name: "api", command: "pnpm dev:api" },
      ],
    },
  };

  it("sets all services to running when action=start and no serviceIndex", () => {
    const patch = buildWorkspaceRuntimeDesiredStatePatch({
      config,
      currentDesiredState: "stopped",
      currentServiceStates: null,
      action: "start",
    });
    expect(patch.desiredState).toBe("running");
    expect(patch.serviceStates).toEqual({ "0": "running", "1": "running" });
  });

  it("sets all services to stopped when action=stop and no serviceIndex", () => {
    const patch = buildWorkspaceRuntimeDesiredStatePatch({
      config,
      currentDesiredState: "running",
      currentServiceStates: { "0": "running", "1": "running" },
      action: "stop",
    });
    expect(patch.desiredState).toBe("stopped");
    expect(patch.serviceStates).toEqual({ "0": "stopped", "1": "stopped" });
  });

  it("restart is equivalent to start for desiredState", () => {
    const patch = buildWorkspaceRuntimeDesiredStatePatch({
      config,
      currentDesiredState: "running",
      currentServiceStates: { "0": "running", "1": "running" },
      action: "restart",
    });
    expect(patch.desiredState).toBe("running");
    expect(patch.serviceStates).toEqual({ "0": "running", "1": "running" });
  });

  it("only affects the targeted service when serviceIndex is set", () => {
    const patch = buildWorkspaceRuntimeDesiredStatePatch({
      config,
      currentDesiredState: "running",
      currentServiceStates: { "0": "running", "1": "running" },
      action: "stop",
      serviceIndex: 1,
    });
    expect(patch.serviceStates).toEqual({ "0": "running", "1": "stopped" });
    expect(patch.desiredState).toBe("running");
  });

  it("computes desiredState=stopped when all service states are stopped", () => {
    const patch = buildWorkspaceRuntimeDesiredStatePatch({
      config,
      currentDesiredState: "running",
      currentServiceStates: { "0": "running", "1": "stopped" },
      action: "stop",
      serviceIndex: 0,
    });
    expect(patch.serviceStates).toEqual({ "0": "stopped", "1": "stopped" });
    expect(patch.desiredState).toBe("stopped");
  });

  it("returns null serviceStates when no configured services", () => {
    const patch = buildWorkspaceRuntimeDesiredStatePatch({
      config: {},
      currentDesiredState: null,
      currentServiceStates: null,
      action: "start",
    });
    expect(patch.serviceStates).toBeNull();
    expect(patch.desiredState).toBe("stopped");
  });

  it("ignores out-of-range serviceIndex without crashing", () => {
    const patch = buildWorkspaceRuntimeDesiredStatePatch({
      config,
      currentDesiredState: "stopped",
      currentServiceStates: null,
      action: "start",
      serviceIndex: 99,
    });
    expect(patch.serviceStates).toEqual({ "0": "stopped", "1": "stopped" });
    expect(patch.desiredState).toBe("stopped");
  });
});

// ── project-workspace-runtime-config tests ────────────────────────────────────

describe("readProjectWorkspaceRuntimeConfig", () => {
  it("returns null for missing runtimeConfig", () => {
    expect(readProjectWorkspaceRuntimeConfig(null)).toBeNull();
    expect(readProjectWorkspaceRuntimeConfig({})).toBeNull();
    expect(readProjectWorkspaceRuntimeConfig({ other: "value" })).toBeNull();
  });

  it("reads desiredState + workspaceRuntime + serviceStates", () => {
    const config = readProjectWorkspaceRuntimeConfig({
      runtimeConfig: {
        workspaceRuntime: { services: [{ name: "web" }] },
        desiredState: "running",
        serviceStates: { "0": "running" },
      },
    });
    expect(config).toEqual({
      workspaceRuntime: { services: [{ name: "web" }] },
      desiredState: "running",
      serviceStates: { "0": "running" },
    });
  });

  it("rejects invalid desiredState values", () => {
    const config = readProjectWorkspaceRuntimeConfig({
      runtimeConfig: { desiredState: "bogus" },
    });
    expect(config).toBeNull();
  });

  it("filters invalid service state values", () => {
    const config = readProjectWorkspaceRuntimeConfig({
      runtimeConfig: {
        workspaceRuntime: { services: [] },
        serviceStates: { "0": "running", "1": "bogus" },
      },
    });
    expect(config?.serviceStates).toEqual({ "0": "running" });
  });
});

describe("mergeProjectWorkspaceRuntimeConfig", () => {
  it("merges patch onto existing config", () => {
    const merged = mergeProjectWorkspaceRuntimeConfig(
      { runtimeConfig: { desiredState: "stopped" } },
      { desiredState: "running" },
    );
    expect((merged as any)?.runtimeConfig?.desiredState).toBe("running");
  });

  it("removes runtimeConfig when patch is null", () => {
    const merged = mergeProjectWorkspaceRuntimeConfig(
      { runtimeConfig: { desiredState: "running" }, other: "value" },
      null,
    );
    expect(merged).toEqual({ other: "value" });
  });
});

// ── workspace-runtime-read-model tests ────────────────────────────────────────

describe("selectCurrentRuntimeServiceRows", () => {
  it("deduplicates by reuseKey, keeping first", () => {
    const now = new Date();
    const rows = [
      makeRuntimeRow({ id: "a", reuseKey: "key-1", updatedAt: new Date(now.getTime() + 1000) }),
      makeRuntimeRow({ id: "b", reuseKey: "key-1", updatedAt: now }),
    ];
    const result = selectCurrentRuntimeServiceRows(rows);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("a");
  });

  it("deduplicates by identity tuple when reuseKey is null", () => {
    const rows = [
      makeRuntimeRow({ id: "a", reuseKey: null, scopeType: "execution_workspace", scopeId: "ws-1", serviceName: "web", command: "pnpm dev", cwd: "/tmp" }),
      makeRuntimeRow({ id: "b", reuseKey: null, scopeType: "execution_workspace", scopeId: "ws-1", serviceName: "web", command: "pnpm dev", cwd: "/tmp" }),
    ];
    const result = selectCurrentRuntimeServiceRows(rows);
    expect(result).toHaveLength(1);
  });

  it("keeps rows with distinct identities", () => {
    const rows = [
      makeRuntimeRow({ id: "a", reuseKey: "k1" }),
      makeRuntimeRow({ id: "b", reuseKey: "k2" }),
    ];
    expect(selectCurrentRuntimeServiceRows(rows)).toHaveLength(2);
  });
});

// ── stopRuntimeServicesForProjectWorkspace — DB-persisted path ────────────────

describe("stopRuntimeServicesForProjectWorkspace", () => {
  it("updates persisted rows to stopped for a project workspace", async () => {
    const updates: unknown[] = [];
    const setCalls: unknown[] = [];
    const db: any = {
      update: vi.fn(() => ({
        set: vi.fn((values: unknown) => {
          setCalls.push(values);
          return {
            where: vi.fn((conditions: unknown) => {
              updates.push(conditions);
              return Promise.resolve();
            }),
          };
        }),
      })),
    };

    await stopRuntimeServicesForProjectWorkspace({
      db,
      projectWorkspaceId: "pw-1",
    });

    expect(db.update).toHaveBeenCalledTimes(1);
    expect(setCalls).toHaveLength(1);
    const setCall = setCalls[0] as Record<string, unknown>;
    expect(setCall.status).toBe("stopped");
    expect(setCall.healthStatus).toBe("unknown");
  });

  it("targets a specific runtimeServiceId when provided", async () => {
    const db: any = {
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve()),
        })),
      })),
    };

    await stopRuntimeServicesForProjectWorkspace({
      db,
      projectWorkspaceId: "pw-1",
      runtimeServiceId: "svc-123",
    });

    expect(db.update).toHaveBeenCalled();
  });

  it("is a no-op without db when no matching in-memory records", async () => {
    await expect(
      stopRuntimeServicesForProjectWorkspace({ projectWorkspaceId: "pw-999" }),
    ).resolves.toBeUndefined();
  });
});

// ── restartDesiredRuntimeServicesOnStartup ────────────────────────────────────

describe("restartDesiredRuntimeServicesOnStartup", () => {
  it("returns restarted=0 when no rows have desiredState=running", async () => {
    const db: any = {
      select: vi.fn(() => ({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        then: vi.fn((fn: (rows: any[]) => any) => Promise.resolve(fn([]))),
      })),
    };

    const result = await restartDesiredRuntimeServicesOnStartup(db);
    expect(result).toEqual({ restarted: 0, failed: 0 });
  });

  it("skips rows without runtime config or cwd", async () => {
    const projectWorkspaceRows = [
      { id: "pw-1", companyId: "c", projectId: "p", cwd: null, repoUrl: null, repoRef: null, defaultRef: null, metadata: null },
      { id: "pw-2", companyId: "c", projectId: "p", cwd: "/tmp", repoUrl: null, repoRef: null, defaultRef: null, metadata: {} },
    ];
    let callIdx = 0;
    const responses = [projectWorkspaceRows, []];
    const db: any = {
      select: vi.fn(() => ({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        then: vi.fn((fn: (rows: any[]) => any) => Promise.resolve(fn(responses[callIdx++] ?? []))),
      })),
    };

    const result = await restartDesiredRuntimeServicesOnStartup(db);
    expect(result.restarted).toBe(0);
  });
});

// ── resetRuntimeServicesForTests ──────────────────────────────────────────────

describe("resetRuntimeServicesForTests", () => {
  it("is a safe no-op when nothing is registered", async () => {
    await expect(resetRuntimeServicesForTests()).resolves.toBeUndefined();
  });
});
