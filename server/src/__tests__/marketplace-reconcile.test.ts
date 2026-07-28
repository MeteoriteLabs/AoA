import { describe, expect, it, vi } from "vitest";
import {
  digestMarketplaceCatalog,
  runMarketplaceCrewMaintenance,
  runMarketplaceReconciliation,
  writeMarketplaceReconciliationAudit,
} from "../services/marketplace-reconcile.js";
import { MARKETPLACE_SETTINGS_DEFAULTS } from "@armyofagents/shared";
import { withMarketplaceUpdateLock } from "../services/marketplace-update-coordinator.js";

const CATALOG = {
  schemaVersion: "1.0.0",
  generatedAt: "2026-07-28T00:00:00.000Z",
  itemCount: 0,
  items: [],
};

const EMPTY_REPAIR = {
  catalogReady: true,
  inspected: 0,
  repaired: 0,
  skippedFailClosed: 0,
  skippedCooldown: 0,
  skippedOverBudget: 0,
  failed: 0,
};

const EMPTY_STEWARD = {
  disabled: false,
  catalogReady: true,
  inspected: 0,
  adopted: 0,
  skippedOverBudget: 0,
  failed: 0,
};

const ADMIN_ACTOR = {
  actorType: "user" as const,
  actorId: "admin-1",
};

const EMPTY_UPDATE_CHECK = {
  companiesExamined: 1,
  failures: [],
};

describe("marketplace reconciliation", () => {
  it("isolates a company failure and continues the remaining companies", async () => {
    const checkCrewUpdates = vi.fn(
      async ({ companyId }: { companyId: string }) => {
        if (companyId === "company-a") throw new Error("update failed");
      }
    );
    const runCrewRepair = vi.fn(async (opts) => {
      opts.onFailure?.({
        companyId: "company-a",
        error: new Error("repair failed"),
      });
      return { ...EMPTY_REPAIR, failed: 1 };
    });
    const runLegacyStewardReconcile = vi.fn(async () => EMPTY_STEWARD);
    const reconcileTeamMembers = vi.fn(
      async ({ companyId }: { companyId: string }) =>
        companyId === "company-b"
          ? { teamsReconciled: 1, membersAdded: 2 }
          : { teamsReconciled: 0, membersAdded: 0 }
    );

    const result = await runMarketplaceCrewMaintenance({
      db: {} as any,
      catalogItems: [],
      mode: "manual",
      instructionsService: {} as any,
      deps: {
        listCompanyIds: async () => ["company-b", "company-a"],
        loadSettings: async () => MARKETPLACE_SETTINGS_DEFAULTS,
        runCrewRepair,
        runLegacyStewardReconcile,
        checkCrewUpdates: checkCrewUpdates as any,
        reconcileTeamMembers: reconcileTeamMembers as any,
      },
    });

    expect(result.companiesExamined).toBe(2);
    expect(checkCrewUpdates).toHaveBeenCalledTimes(2);
    expect(reconcileTeamMembers).toHaveBeenCalledTimes(2);
    expect(runCrewRepair).toHaveBeenCalledWith(
      expect.objectContaining({
        companyIds: ["company-a", "company-b"],
        maxPerPass: 2,
        force: true,
      })
    );
    expect(runLegacyStewardReconcile).toHaveBeenCalledWith(
      expect.objectContaining({
        companyIds: ["company-a", "company-b"],
        maxPerPass: 2,
      })
    );
    expect(result.teamReconcile).toEqual({
      teamsReconciled: 1,
      membersAdded: 2,
    });
    expect(result.failures).toEqual([
      {
        companyId: "company-a",
        stage: "crew_repair",
        message: "repair failed",
      },
      {
        companyId: "company-a",
        stage: "crew_update",
        message: "update failed",
      },
    ]);
  });

  it("reports a swallowed crew-update persistence error as a company failure", async () => {
    const persistenceError = new Error("pending update insert failed");
    const result = await runMarketplaceCrewMaintenance({
      db: {} as any,
      catalogItems: [],
      mode: "manual",
      instructionsService: {} as any,
      deps: {
        listCompanyIds: async () => ["company-a"],
        loadSettings: async () => MARKETPLACE_SETTINGS_DEFAULTS,
        runCrewRepair: vi.fn(async () => EMPTY_REPAIR),
        runLegacyStewardReconcile: vi.fn(async () => EMPTY_STEWARD),
        checkCrewUpdates: vi.fn(async (opts) => {
          opts.onFailure?.({
            companyId: "company-a",
            agentId: "agent-a",
            catalogItemId: "agent:aoa-curated/example",
            stage: "pending_update",
            error: persistenceError,
          });
        }),
        reconcileTeamMembers: vi.fn(async () => ({
          teamsReconciled: 0,
          membersAdded: 0,
        })),
      },
    });

    expect(result.crewUpdates).toEqual({ succeeded: 0, failed: 1 });
    expect(result.failures).toEqual([
      {
        companyId: "company-a",
        stage: "crew_update",
        message: "pending update insert failed",
      },
    ]);
  });

  it("collapses repeated team failures by company and stage", async () => {
    const result = await runMarketplaceCrewMaintenance({
      db: {} as any,
      catalogItems: [],
      instructionsService: {} as any,
      deps: {
        listCompanyIds: async () => ["company-a"],
        loadSettings: async () => MARKETPLACE_SETTINGS_DEFAULTS,
        runCrewRepair: vi.fn(async () => EMPTY_REPAIR),
        runLegacyStewardReconcile: vi.fn(async () => EMPTY_STEWARD),
        checkCrewUpdates: vi.fn(),
        reconcileTeamMembers: vi.fn(async (opts) => {
          opts.onFailure?.({
            companyId: "company-a",
            teamId: "team-a",
            stage: "member_install",
            error: new Error("first member failed"),
          });
          opts.onFailure?.({
            companyId: "company-a",
            teamId: "team-a",
            stage: "member_install",
            error: new Error("second member failed"),
          });
          return { teamsReconciled: 0, membersAdded: 0 };
        }),
      },
    });

    expect(result.failures).toEqual([
      {
        companyId: "company-a",
        stage: "team_reconcile",
        message: "first member failed",
        occurrences: 2,
      },
    ]);
  });

  it("returns a stable catalog identity and a successful replay result", async () => {
    const status = {
      lastSyncedAt: "2026-07-28T00:00:01.000Z",
      lastSyncStatus: "success" as const,
      lastSyncError: null,
      source: "cdn" as const,
      schemaVersion: "1.0.0",
      itemCount: 0,
    };
    const catalogService = {
      refresh: vi.fn().mockResolvedValue({
        catalog: CATALOG,
        status,
        outcome: "cdn_success" as const,
        error: null,
      }),
    };
    const maintenance = vi.fn().mockResolvedValue({
      companiesExamined: 1,
      crewRepair: EMPTY_REPAIR,
      legacySteward: EMPTY_STEWARD,
      crewUpdates: { succeeded: 1, failed: 0 },
      teamReconcile: { teamsReconciled: 0, membersAdded: 0 },
      failures: [],
    });
    const audit = vi.fn().mockResolvedValue(undefined);
    const listCompanyIds = vi.fn().mockResolvedValue(["company-1"]);
    const updateCheck = vi.fn().mockResolvedValue(EMPTY_UPDATE_CHECK);

    const first = await runMarketplaceReconciliation({
      db: {} as any,
      catalogService,
      actor: ADMIN_ACTOR,
      operationId: "operation-1",
      maintenance,
      listCompanyIds,
      audit,
      updateCheck,
    });
    const replay = await runMarketplaceReconciliation({
      db: {} as any,
      catalogService,
      actor: ADMIN_ACTOR,
      operationId: "operation-2",
      maintenance,
      listCompanyIds,
      audit,
      updateCheck,
    });

    expect(first.status).toBe("success");
    expect(replay.status).toBe("success");
    expect(replay.catalog).toEqual(first.catalog);
    expect(replay.repairs).toEqual({
      crewCompaniesRepaired: 0,
      legacyStewardsAdopted: 0,
      teamsReconciled: 0,
      teamMembersAdded: 0,
    });
    expect(replay.crewRepair.repaired).toBe(0);
    expect(catalogService.refresh).toHaveBeenCalledTimes(2);
    expect(updateCheck).toHaveBeenCalledTimes(2);
    expect(updateCheck).toHaveBeenNthCalledWith(
      1,
      {},
      CATALOG.items,
      { companyIds: ["company-1"] },
    );
    expect(maintenance).toHaveBeenCalledWith(
      expect.objectContaining({ companyIds: ["company-1"], mode: "manual" }),
    );
    expect(audit).toHaveBeenCalledTimes(4);
    expect(audit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        phase: "started",
        operationId: "operation-1",
        actor: ADMIN_ACTOR,
        companyIds: ["company-1"],
      }),
    );
    expect(audit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        phase: "completed",
        operationId: "operation-1",
        actor: ADMIN_ACTOR,
        result: expect.objectContaining({ status: "success" }),
      }),
    );
  });

  it("persists one actor-attributed start audit per target company", async () => {
    const returning = vi
      .fn()
      .mockResolvedValue([{ id: "audit-1" }, { id: "audit-2" }]);
    const values = vi.fn().mockReturnValue({ returning });
    const db = {
      insert: vi.fn().mockReturnValue({ values }),
    };

    await writeMarketplaceReconciliationAudit({
      db: db as any,
      phase: "started",
      operationId: "operation-audit",
      actor: ADMIN_ACTOR,
      companyIds: ["company-a", "company-b"],
      catalog: {
        generatedAt: CATALOG.generatedAt,
        canonicalDigestSha256: "a".repeat(64),
        schemaVersion: CATALOG.schemaVersion,
        itemCount: 0,
        source: "cdn",
      },
    });

    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({
        companyId: "company-a",
        actorType: "user",
        actorId: "admin-1",
        action: "marketplace.reconciliation_started",
        entityType: "marketplace_reconciliation",
        entityId: "operation-audit",
      }),
      expect.objectContaining({
        companyId: "company-b",
        actorType: "user",
        actorId: "admin-1",
        action: "marketplace.reconciliation_started",
        entityId: "operation-audit",
      }),
    ]);
  });

  it("does not run maintenance when the required catalog refresh fails", async () => {
    const maintenance = vi.fn();
    const catalogStatus = {
      lastSyncedAt: "2026-07-28T00:00:01.000Z",
      lastSyncStatus: "failure" as const,
      lastSyncError: "cdn unavailable",
      source: "cdn" as const,
      schemaVersion: "1.0.0",
      itemCount: 0,
    };

    await expect(
      runMarketplaceReconciliation({
        db: {} as any,
        actor: ADMIN_ACTOR,
        catalogService: {
          refresh: vi
            .fn()
            .mockResolvedValue({
              catalog: null,
              status: catalogStatus,
              outcome: "failure",
              error: "cdn unavailable",
            }),
        },
        operationId: "operation-catalog-failure",
        maintenance,
      })
    ).rejects.toMatchObject({
      operationId: "operation-catalog-failure",
      catalogStatus,
    });
    expect(maintenance).not.toHaveBeenCalled();
  });

  it("fails before fleet mutation when the actor audit cannot be persisted", async () => {
    const maintenance = vi.fn();
    const updateCheck = vi.fn();

    await expect(
      runMarketplaceReconciliation({
        db: {} as any,
        actor: ADMIN_ACTOR,
        operationId: "operation-audit-failure",
        catalogService: {
          refresh: vi.fn().mockResolvedValue({
            catalog: CATALOG,
            status: {
              lastSyncedAt: "2026-07-28T00:00:01.000Z",
              lastSyncStatus: "success",
              lastSyncError: null,
              source: "cdn",
              schemaVersion: "1.0.0",
              itemCount: 0,
            },
            outcome: "cdn_success",
            error: null,
          }),
        },
        maintenance,
        listCompanyIds: async () => ["company-1"],
        audit: vi.fn().mockRejectedValue(new Error("audit insert failed")),
        updateCheck,
      }),
    ).rejects.toMatchObject({
      operationId: "operation-audit-failure",
    });
    expect(updateCheck).not.toHaveBeenCalled();
    expect(maintenance).not.toHaveBeenCalled();
  });

  it("runs catalog update mutations only after the start audit succeeds", async () => {
    const order: string[] = [];
    const maintenanceResult = {
      companiesExamined: 1,
      crewRepair: EMPTY_REPAIR,
      legacySteward: EMPTY_STEWARD,
      crewUpdates: { succeeded: 1, failed: 0 },
      teamReconcile: { teamsReconciled: 0, membersAdded: 0 },
      failures: [],
    };

    await runMarketplaceReconciliation({
      db: {} as any,
      actor: ADMIN_ACTOR,
      operationId: "operation-order",
      catalogService: {
        refresh: vi.fn(async () => {
          order.push("refresh");
          return {
            catalog: CATALOG,
            status: {
              lastSyncedAt: "2026-07-28T00:00:01.000Z",
              lastSyncStatus: "success" as const,
              lastSyncError: null,
              source: "cdn" as const,
              schemaVersion: "1.0.0",
              itemCount: 0,
            },
            outcome: "cdn_success" as const,
            error: null,
          };
        }),
      },
      listCompanyIds: vi.fn(async () => {
        order.push("targets");
        return ["company-1"];
      }),
      audit: vi.fn(async ({ phase }) => {
        order.push(`audit:${phase}`);
      }),
      updateCheck: vi.fn(async () => {
        order.push("update-check");
        return EMPTY_UPDATE_CHECK;
      }),
      maintenance: vi.fn(async () => {
        order.push("maintenance");
        return maintenanceResult;
      }),
    });

    expect(order).toEqual([
      "refresh",
      "targets",
      "audit:started",
      "update-check",
      "maintenance",
      "audit:completed",
    ]);
  });

  it("holds a concurrent background update behind the audited operation", async () => {
    const order: string[] = [];
    let resolveRefresh!: (value: {
      catalog: typeof CATALOG;
      status: {
        lastSyncedAt: string;
        lastSyncStatus: "success";
        lastSyncError: null;
        source: "cdn";
        schemaVersion: string;
        itemCount: number;
      };
      outcome: "cdn_success";
      error: null;
    }) => void;
    let markRefreshStarted!: () => void;
    const refreshStarted = new Promise<void>((resolve) => {
      markRefreshStarted = resolve;
    });
    const refreshResult = new Promise<Parameters<typeof resolveRefresh>[0]>(
      (resolve) => {
        resolveRefresh = resolve;
      },
    );
    const maintenanceResult = {
      companiesExamined: 1,
      crewRepair: EMPTY_REPAIR,
      legacySteward: EMPTY_STEWARD,
      crewUpdates: { succeeded: 1, failed: 0 },
      teamReconcile: { teamsReconciled: 0, membersAdded: 0 },
      failures: [],
    };

    const reconciliation = runMarketplaceReconciliation({
      db: {} as any,
      actor: ADMIN_ACTOR,
      operationId: "operation-serialized",
      catalogService: {
        refresh: vi.fn(async () => {
          order.push("refresh");
          markRefreshStarted();
          return refreshResult;
        }),
      },
      listCompanyIds: vi.fn(async () => {
        order.push("targets");
        return ["company-1"];
      }),
      audit: vi.fn(async ({ phase }) => {
        order.push(`audit:${phase}`);
      }),
      updateCheck: vi.fn(async () => {
        order.push("admin-update");
        return EMPTY_UPDATE_CHECK;
      }),
      maintenance: vi.fn(async () => {
        order.push("maintenance");
        return maintenanceResult;
      }),
    });
    await refreshStarted;

    const backgroundUpdate = withMarketplaceUpdateLock(async () => {
      order.push("background-update");
    });
    await Promise.resolve();
    expect(order).toEqual(["refresh"]);

    resolveRefresh({
      catalog: CATALOG,
      status: {
        lastSyncedAt: "2026-07-28T00:00:01.000Z",
        lastSyncStatus: "success",
        lastSyncError: null,
        source: "cdn",
        schemaVersion: "1.0.0",
        itemCount: 0,
      },
      outcome: "cdn_success",
      error: null,
    });
    await reconciliation;
    await backgroundUpdate;

    expect(order).toEqual([
      "refresh",
      "targets",
      "audit:started",
      "admin-update",
      "maintenance",
      "audit:completed",
      "background-update",
    ]);
  });

  it("does not reconcile from a bundled fallback after a failed CDN refresh", async () => {
    const maintenance = vi.fn();
    const catalogStatus = {
      lastSyncedAt: "2026-07-28T00:00:01.000Z",
      lastSyncStatus: "success" as const,
      lastSyncError: null,
      source: "bundled" as const,
      schemaVersion: "1.0.0",
      itemCount: 0,
    };

    await expect(
      runMarketplaceReconciliation({
        db: {} as any,
        actor: ADMIN_ACTOR,
        catalogService: {
          refresh: vi.fn().mockResolvedValue({
            catalog: CATALOG,
            status: catalogStatus,
            outcome: "fallback_success",
            error: "network down",
          }),
        },
        operationId: "operation-bundled-fallback",
        maintenance,
      }),
    ).rejects.toMatchObject({
      operationId: "operation-bundled-fallback",
      catalogStatus,
      catalogOutcome: "fallback_success",
      catalogError: "network down",
    });
    expect(maintenance).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "uncaptured repair failures",
      crewRepair: { ...EMPTY_REPAIR, failed: 1 },
      legacySteward: EMPTY_STEWARD,
      crewUpdates: { succeeded: 1, failed: 0 },
      failures: [],
    },
    {
      name: "uncaptured Steward failures",
      crewRepair: EMPTY_REPAIR,
      legacySteward: { ...EMPTY_STEWARD, failed: 1 },
      crewUpdates: { succeeded: 1, failed: 0 },
      failures: [],
    },
    {
      name: "crew update failures",
      crewRepair: EMPTY_REPAIR,
      legacySteward: EMPTY_STEWARD,
      crewUpdates: { succeeded: 0, failed: 1 },
      failures: [],
    },
    {
      name: "cooldown skips",
      crewRepair: { ...EMPTY_REPAIR, skippedCooldown: 1 },
      legacySteward: EMPTY_STEWARD,
      crewUpdates: { succeeded: 1, failed: 0 },
      failures: [],
    },
    {
      name: "missing crew catalog prerequisite",
      crewRepair: { ...EMPTY_REPAIR, catalogReady: false },
      legacySteward: EMPTY_STEWARD,
      crewUpdates: { succeeded: 1, failed: 0 },
      failures: [],
    },
    {
      name: "disabled Steward reconciliation",
      crewRepair: EMPTY_REPAIR,
      legacySteward: { ...EMPTY_STEWARD, disabled: true },
      crewUpdates: { succeeded: 1, failed: 0 },
      failures: [],
    },
    {
      name: "missing Steward catalog prerequisite",
      crewRepair: EMPTY_REPAIR,
      legacySteward: { ...EMPTY_STEWARD, catalogReady: false },
      crewUpdates: { succeeded: 1, failed: 0 },
      failures: [],
    },
  ])("reports partial status for $name", async (maintenanceResult) => {
    const result = await runMarketplaceReconciliation({
      db: {} as any,
      actor: ADMIN_ACTOR,
      catalogService: {
        refresh: vi.fn().mockResolvedValue({
          catalog: CATALOG,
          status: {
            lastSyncedAt: "2026-07-28T00:00:01.000Z",
            lastSyncStatus: "success",
            lastSyncError: null,
            source: "cdn",
            schemaVersion: "1.0.0",
            itemCount: 0,
          },
          outcome: "cdn_success",
          error: null,
        }),
      },
      maintenance: vi.fn().mockResolvedValue({
        companiesExamined: 1,
        teamReconcile: { teamsReconciled: 0, membersAdded: 0 },
        ...maintenanceResult,
      }),
      listCompanyIds: async () => ["company-1"],
      audit: vi.fn(),
      updateCheck: vi.fn().mockResolvedValue(EMPTY_UPDATE_CHECK),
    });

    expect(result.status).toBe("partial");
  });

  it("reports marketplace update-check failures as a partial audited result", async () => {
    const audit = vi.fn();
    const maintenance = vi.fn().mockResolvedValue({
      companiesExamined: 1,
      crewRepair: EMPTY_REPAIR,
      legacySteward: EMPTY_STEWARD,
      crewUpdates: { succeeded: 1, failed: 0 },
      teamReconcile: { teamsReconciled: 0, membersAdded: 0 },
      failures: [],
    });

    const result = await runMarketplaceReconciliation({
      db: {} as any,
      actor: ADMIN_ACTOR,
      operationId: "operation-update-failure",
      catalogService: {
        refresh: vi.fn().mockResolvedValue({
          catalog: CATALOG,
          status: {
            lastSyncedAt: "2026-07-28T00:00:01.000Z",
            lastSyncStatus: "success",
            lastSyncError: null,
            source: "cdn",
            schemaVersion: "1.0.0",
            itemCount: 0,
          },
          outcome: "cdn_success",
          error: null,
        }),
      },
      listCompanyIds: async () => ["company-1"],
      audit,
      updateCheck: vi.fn().mockResolvedValue({
        companiesExamined: 1,
        failures: [
          {
            companyId: "company-1",
            itemType: "skill",
            catalogItemId: "skill:aoa-curated/code-review",
            message: "notification unavailable",
          },
        ],
      }),
      maintenance,
    });

    expect(result.status).toBe("partial");
    expect(result.failures).toEqual([
      {
        companyId: "company-1",
        stage: "marketplace_update",
        message:
          "skill skill:aoa-curated/code-review: notification unavailable",
      },
    ]);
    expect(audit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        phase: "completed",
        result: expect.objectContaining({
          status: "partial",
          failures: result.failures,
        }),
      }),
    );
  });

  it("serializes scheduled and manual passes in the same process", async () => {
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const secondListCompanies = vi.fn(async () => []);
    const baseDeps = {
      loadSettings: async () => MARKETPLACE_SETTINGS_DEFAULTS,
      runCrewRepair: vi.fn(async () => EMPTY_REPAIR),
      runLegacyStewardReconcile: vi.fn(async () => EMPTY_STEWARD),
      reconcileTeamMembers: vi.fn(async () => ({
        teamsReconciled: 0,
        membersAdded: 0,
      })),
    };

    const first = runMarketplaceCrewMaintenance({
      db: {} as any,
      catalogItems: [],
      instructionsService: {} as any,
      deps: {
        ...baseDeps,
        listCompanyIds: async () => ["company-a"],
        checkCrewUpdates: vi.fn(async () => {
          markFirstStarted();
          await firstBlocked;
        }),
      },
    });
    await firstStarted;

    const second = runMarketplaceCrewMaintenance({
      db: {} as any,
      catalogItems: [],
      mode: "manual",
      instructionsService: {} as any,
      deps: {
        ...baseDeps,
        listCompanyIds: secondListCompanies,
        checkCrewUpdates: vi.fn(),
      },
    });
    await Promise.resolve();
    expect(secondListCompanies).not.toHaveBeenCalled();

    releaseFirst();
    await Promise.all([first, second]);
    expect(secondListCompanies).toHaveBeenCalledTimes(1);
  });

  it("acquires the maintenance lock before the admin start audit", async () => {
    const order: string[] = [];
    let releaseScheduled!: () => void;
    const scheduledBlocked = new Promise<void>((resolve) => {
      releaseScheduled = resolve;
    });
    let markScheduledStarted!: () => void;
    const scheduledStarted = new Promise<void>((resolve) => {
      markScheduledStarted = resolve;
    });
    const maintenanceResult = {
      companiesExamined: 1,
      crewRepair: EMPTY_REPAIR,
      legacySteward: EMPTY_STEWARD,
      crewUpdates: { succeeded: 1, failed: 0 },
      teamReconcile: { teamsReconciled: 0, membersAdded: 0 },
      failures: [],
    };

    const scheduled = runMarketplaceCrewMaintenance({
      db: {} as any,
      catalogItems: [],
      instructionsService: {} as any,
      deps: {
        listCompanyIds: async () => ["company-a"],
        loadSettings: async () => MARKETPLACE_SETTINGS_DEFAULTS,
        runCrewRepair: vi.fn(async () => EMPTY_REPAIR),
        runLegacyStewardReconcile: vi.fn(async () => EMPTY_STEWARD),
        checkCrewUpdates: vi.fn(async () => {
          order.push("scheduled:start");
          markScheduledStarted();
          await scheduledBlocked;
          order.push("scheduled:end");
        }),
        reconcileTeamMembers: vi.fn(async () => ({
          teamsReconciled: 0,
          membersAdded: 0,
        })),
      },
    });
    await scheduledStarted;

    const audit = vi.fn(async ({ phase }) => {
      order.push(`audit:${phase}`);
    });
    const reconciliation = runMarketplaceReconciliation({
      db: {} as any,
      actor: ADMIN_ACTOR,
      operationId: "operation-maintenance-boundary",
      catalogService: {
        refresh: vi.fn(async () => {
          order.push("refresh");
          return {
            catalog: CATALOG,
            status: {
              lastSyncedAt: "2026-07-28T00:00:01.000Z",
              lastSyncStatus: "success" as const,
              lastSyncError: null,
              source: "cdn" as const,
              schemaVersion: "1.0.0",
              itemCount: 0,
            },
            outcome: "cdn_success" as const,
            error: null,
          };
        }),
      },
      listCompanyIds: async () => ["company-a"],
      audit,
      updateCheck: vi.fn(async () => EMPTY_UPDATE_CHECK),
      maintenance: vi.fn(async () => {
        order.push("admin:maintenance");
        return maintenanceResult;
      }),
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(audit).not.toHaveBeenCalled();
    expect(order).toEqual(["scheduled:start"]);

    releaseScheduled();
    await Promise.all([scheduled, reconciliation]);
    expect(order).toEqual([
      "scheduled:start",
      "scheduled:end",
      "refresh",
      "audit:started",
      "admin:maintenance",
      "audit:completed",
    ]);
  });

  it("canonicalizes object keys before hashing", () => {
    const reordered = {
      items: [],
      itemCount: 0,
      generatedAt: CATALOG.generatedAt,
      schemaVersion: CATALOG.schemaVersion,
    };
    expect(digestMarketplaceCatalog(reordered)).toBe(
      digestMarketplaceCatalog(CATALOG)
    );
  });
});
