import { describe, it, expect, vi } from "vitest";

vi.mock("../services/marketplace-install/fetch-resource.js", () => ({
  fetchCatalogResource: vi.fn().mockResolvedValue(JSON.stringify({
    schemaVersion: "agent.v1", id: "aoa-curated/standard-crew/maker", name: "Maker",
    description: "test", instructions: { type: "inline", content: "new instructions" },
    aoa: {
      runtimeConfig: { aoa: { toolAllowlist: ["new_tool"] } },
      skillKeys: ["new-skill"],
      triggers: [{ kind: "mention", config: { role: "maker" } }],
    },
  })),
}));
vi.mock("../services/marketplace-install/agent-create.js", () => ({
  loadMarketplaceInstructionFiles: vi.fn().mockResolvedValue({
    files: { "INSTRUCTIONS.md": "new content" }, entryFile: "INSTRUCTIONS.md",
  }),
}));
vi.mock("@armyofagents/db", () => {
  const tableProxy = new Proxy({}, { get: () => Symbol("col") });
  return {
    agents: tableProxy,
    aoaAgentTriggers: tableProxy,
    marketplacePendingUpdates: tableProxy,
  };
});
vi.mock("drizzle-orm", () => ({
  eq: () => Symbol("op:eq"),
  and: () => Symbol("op:and"),
}));
vi.mock("../middleware/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../services/marketplace-notifications.js", () => ({
  marketplaceNotifications: {
    updateAvailable: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../services/marketplace-install/skill-auto-updater.js", () => ({
  isWithinUpdateWindow: vi.fn().mockReturnValue(true),
}));

import {
  AgentInstructionsCustomizedError,
  applyCrewAgentUpdate,
  checkCrewUpdates,
} from "../services/marketplace-install/crew-updater.js";

// ── helpers ────────────────────────────────────────────────────────────────

const CATALOG_ITEM = {
  id: "aoa-curated/standard-crew/maker",
  type: "agent" as const,
  name: "Maker",
  version: "0.1.0",
  description: "test",
  source: { adapter: "aoa-curated", url: "https://example.com", locator: "maker", commitSha: "abc" },
  resourceUrl: "https://example.com/agent.json",
  trust: { tier: "verified" as const, source: "aoa-curated" },
  status: "active" as const,
  addedAt: "2026-01-01T00:00:00Z",
  category: "crew",
  tags: [],
  requires: [],
};

const AGENT_ROW = {
  id: "agent-1",
  companyId: "co-1",
  name: "Maker",
  adapterType: "claude_local",
  adapterConfig: {},
  runtimeConfig: { aoa: { toolAllowlist: ["old_tool"] } },
  skillKeys: ["old-skill"],
  templateVersion: "0.0.1",
  // D22: `false` = AoA materialized this bundle and nothing has edited it since.
  instructionsCustomized: false as boolean | null,
};

/**
 * Drizzle's builders are thenable AND chainable. `update().set().where()` is
 * awaited directly in some places and `.returning()`-ed in others, so the mock
 * has to be both.
 */
function whereResult(returningRows: unknown[]) {
  return {
    returning: vi.fn().mockResolvedValue(returningRows),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(undefined).then(resolve, reject),
  };
}

function makeTxMock(
  updatedFields: Record<string, unknown>,
  opts?: { agentUpdateReturning?: unknown[] },
) {
  const agentUpdateReturning = opts?.agentUpdateReturning ?? [{ id: "agent-1" }];
  return {
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockImplementation((v: Record<string, unknown>) => {
        Object.assign(updatedFields, v);
        return { where: vi.fn().mockReturnValue(whereResult(agentUpdateReturning)) };
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
  };
}

/** Top-level db mock for the notify path (pending-update insert). */
function makeNotifyDb(rows: unknown[]) {
  const insertedValues: Record<string, unknown>[] = [];
  const db = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(rows) }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockImplementation((v: Record<string, unknown>) => {
        insertedValues.push(v);
        return {
          onConflictDoNothing: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: "pending-1" }]),
          }),
        };
      }),
    }),
    transaction: vi.fn(),
  };
  return { db, insertedValues };
}

const AUTO_SETTINGS = {
  agentUpdatePolicy: "auto" as const,
  updateWindow: "anytime" as const,
  allowTeamLeadPlugins: false,
  teamMemberCanRequestInstall: false,
  requireFounderApproval: false,
  updateCheckHours: 24 as const,
};

// ── tests: applyCrewAgentUpdate ────────────────────────────────────────────

describe("applyCrewAgentUpdate", () => {
  it("calls materializeManagedBundle with replaceExisting:true and bumps templateVersion", async () => {
    const mockMaterialize = vi.fn().mockResolvedValue({ adapterConfig: { updated: true } });
    const updatedFields: Record<string, unknown> = {};
    const txMock = makeTxMock(updatedFields);
    const db = {
      transaction: vi.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txMock)),
    };

    await applyCrewAgentUpdate({
      db: db as any,
      agentRow: AGENT_ROW,
      catalogItem: CATALOG_ITEM,
      instructionsService: { materializeManagedBundle: mockMaterialize } as any,
    });

    // Must call with replaceExisting: true
    expect(mockMaterialize).toHaveBeenCalledWith(
      expect.objectContaining({ id: "agent-1" }),
      expect.any(Object),
      expect.objectContaining({ replaceExisting: true }),
    );
    // Must bump templateVersion
    expect(updatedFields.templateVersion).toBe("0.1.0");
  });

  it("replaces triggers: deletes old, inserts new from template", async () => {
    const mockMaterialize = vi.fn().mockResolvedValue({ adapterConfig: {} });
    const updatedFields: Record<string, unknown> = {};
    const txMock = makeTxMock(updatedFields);
    const db = {
      transaction: vi.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txMock)),
    };

    await applyCrewAgentUpdate({
      db: db as any,
      agentRow: AGENT_ROW,
      catalogItem: CATALOG_ITEM,
      instructionsService: { materializeManagedBundle: mockMaterialize } as any,
    });

    // delete aoaAgentTriggers called once
    expect(txMock.delete).toHaveBeenCalled();
    // insert called for new trigger + pending update mark
    expect(txMock.insert).toHaveBeenCalled();
  });

  it("updates skillKeys from the new catalog template", async () => {
    const mockMaterialize = vi.fn().mockResolvedValue({ adapterConfig: {} });
    const updatedFields: Record<string, unknown> = {};
    const txMock = makeTxMock(updatedFields);
    const db = {
      transaction: vi.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txMock)),
    };

    await applyCrewAgentUpdate({
      db: db as any,
      agentRow: AGENT_ROW,
      catalogItem: CATALOG_ITEM,
      instructionsService: { materializeManagedBundle: mockMaterialize } as any,
    });

    // skillKeys should be replaced with template value (["new-skill"] from mocked fetch)
    expect(updatedFields.skillKeys).toBeDefined();
  });
});

// ── tests: D22 instruction-customization guard ─────────────────────────────

describe("applyCrewAgentUpdate — D22 customization guard", () => {
  it("refuses a customized agent BEFORE materializeManagedBundle can delete the edits", async () => {
    const mockMaterialize = vi.fn().mockResolvedValue({ adapterConfig: {} });
    const updatedFields: Record<string, unknown> = {};
    const txMock = makeTxMock(updatedFields);
    const db = {
      transaction: vi.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txMock)),
    };

    await expect(
      applyCrewAgentUpdate({
        db: db as any,
        agentRow: { ...AGENT_ROW, instructionsCustomized: true },
        catalogItem: CATALOG_ITEM,
        instructionsService: { materializeManagedBundle: mockMaterialize } as any,
      }),
    ).rejects.toBeInstanceOf(AgentInstructionsCustomizedError);

    // The destructive half (fs.rm on the founder's instructions root) must never run.
    expect(mockMaterialize).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("refuses a row whose customization state is unknown (pre-D22 row)", async () => {
    const mockMaterialize = vi.fn().mockResolvedValue({ adapterConfig: {} });
    const db = { transaction: vi.fn() };

    await expect(
      applyCrewAgentUpdate({
        db: db as any,
        agentRow: { ...AGENT_ROW, instructionsCustomized: null },
        catalogItem: CATALOG_ITEM,
        instructionsService: { materializeManagedBundle: mockMaterialize } as any,
      }),
    ).rejects.toBeInstanceOf(AgentInstructionsCustomizedError);
    expect(mockMaterialize).not.toHaveBeenCalled();
  });

  it("throws rather than reporting success when a concurrent edit wins the optimistic lock", async () => {
    const mockMaterialize = vi.fn().mockResolvedValue({ adapterConfig: {} });
    const updatedFields: Record<string, unknown> = {};
    // Empty RETURNING = the `instructions_customized = false` predicate no longer matched.
    const txMock = makeTxMock(updatedFields, { agentUpdateReturning: [] });
    const db = {
      transaction: vi.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txMock)),
    };

    await expect(
      applyCrewAgentUpdate({
        db: db as any,
        agentRow: AGENT_ROW,
        catalogItem: CATALOG_ITEM,
        instructionsService: { materializeManagedBundle: mockMaterialize } as any,
      }),
    ).rejects.toBeInstanceOf(AgentInstructionsCustomizedError);
  });

  it("re-asserts instructionsCustomized=false on a successful apply", async () => {
    const mockMaterialize = vi.fn().mockResolvedValue({ adapterConfig: {} });
    const updatedFields: Record<string, unknown> = {};
    const txMock = makeTxMock(updatedFields);
    const db = {
      transaction: vi.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txMock)),
    };

    await applyCrewAgentUpdate({
      db: db as any,
      agentRow: AGENT_ROW,
      catalogItem: CATALOG_ITEM,
      instructionsService: { materializeManagedBundle: mockMaterialize } as any,
    });

    expect(updatedFields.instructionsCustomized).toBe(false);
  });
});

describe("checkCrewUpdates — D22 routing", () => {
  it("does NOT auto-apply a customized agent, even on policy=auto inside the window", async () => {
    const { db, insertedValues } = makeNotifyDb([
      {
        ...AGENT_ROW,
        companyId: "co-1",
        templateOrigin: CATALOG_ITEM.id,
        kind: "aoa",
        instructionsCustomized: true,
      },
    ]);
    const mockMaterialize = vi.fn().mockResolvedValue({ adapterConfig: {} });

    await checkCrewUpdates({
      db: db as any,
      companyId: "co-1",
      catalogItems: [CATALOG_ITEM],
      settings: AUTO_SETTINGS,
      instructionsService: { materializeManagedBundle: mockMaterialize } as any,
    });

    expect(db.transaction).not.toHaveBeenCalled();
    expect(mockMaterialize).not.toHaveBeenCalled();
    // Routed to the EXISTING notify machinery — pending row + updateAvailable.
    expect(insertedValues).toHaveLength(1);
    expect(insertedValues[0]).toMatchObject({ catalogItemId: CATALOG_ITEM.id, itemType: "agent" });
    const { marketplaceNotifications } = await import("../services/marketplace-notifications.js");
    expect(marketplaceNotifications.updateAvailable).toHaveBeenCalled();
  });

  it("does NOT auto-apply a row with unknown customization state (pre-D22 row)", async () => {
    const { db, insertedValues } = makeNotifyDb([
      {
        ...AGENT_ROW,
        companyId: "co-1",
        templateOrigin: CATALOG_ITEM.id,
        kind: "aoa",
        instructionsCustomized: null,
      },
    ]);
    const mockMaterialize = vi.fn().mockResolvedValue({ adapterConfig: {} });

    await checkCrewUpdates({
      db: db as any,
      companyId: "co-1",
      catalogItems: [CATALOG_ITEM],
      settings: AUTO_SETTINGS,
      instructionsService: { materializeManagedBundle: mockMaterialize } as any,
    });

    expect(db.transaction).not.toHaveBeenCalled();
    expect(mockMaterialize).not.toHaveBeenCalled();
    expect(insertedValues).toHaveLength(1);
  });

  // THE DISCRIMINATOR. Without this, an implementation that simply disabled
  // instruction updates for every agent would pass every test above.
  it("still auto-applies an UNTOUCHED agent (instructionsCustomized=false)", async () => {
    const mockMaterialize = vi.fn().mockResolvedValue({ adapterConfig: {} });
    const updatedFields: Record<string, unknown> = {};
    const txMock = makeTxMock(updatedFields);
    const { db, insertedValues } = makeNotifyDb([
      {
        ...AGENT_ROW,
        companyId: "co-1",
        templateOrigin: CATALOG_ITEM.id,
        kind: "aoa",
        instructionsCustomized: false,
      },
    ]);
    db.transaction = vi
      .fn()
      .mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txMock));

    await checkCrewUpdates({
      db: db as any,
      companyId: "co-1",
      catalogItems: [CATALOG_ITEM],
      settings: AUTO_SETTINGS,
      instructionsService: { materializeManagedBundle: mockMaterialize } as any,
    });

    expect(db.transaction).toHaveBeenCalled();
    expect(mockMaterialize).toHaveBeenCalledWith(
      expect.objectContaining({ id: "agent-1" }),
      expect.any(Object),
      expect.objectContaining({ replaceExisting: true }),
    );
    expect(updatedFields.templateVersion).toBe("0.1.0");
    // Auto-apply is silent: no pending row, no "update available" notification.
    expect(insertedValues).toHaveLength(0);
  });
});

// ── tests: checkCrewUpdates ────────────────────────────────────────────────

describe("checkCrewUpdates", () => {
  it("auto-applies when policy=auto and within update window", async () => {
    const { isWithinUpdateWindow } = await import("../services/marketplace-install/skill-auto-updater.js");
    vi.mocked(isWithinUpdateWindow).mockReturnValue(true);

    const mockMaterialize = vi.fn().mockResolvedValue({ adapterConfig: {} });
    const updatedFields: Record<string, unknown> = {};
    const txMock = makeTxMock(updatedFields);

    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { ...AGENT_ROW, companyId: "co-1", templateOrigin: CATALOG_ITEM.id, kind: "aoa" },
          ]),
        }),
      }),
      transaction: vi.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txMock)),
    };

    const settings = {
      agentUpdatePolicy: "auto" as const,
      updateWindow: "anytime" as const,
      allowTeamLeadPlugins: false,
      teamMemberCanRequestInstall: false,
      requireFounderApproval: false,
      updateCheckHours: 24 as const,
    };

    await checkCrewUpdates({
      db: db as any,
      companyId: "co-1",
      catalogItems: [CATALOG_ITEM],
      settings,
      instructionsService: { materializeManagedBundle: mockMaterialize } as any,
    });

    // transaction should have been called (auto-apply ran)
    expect(db.transaction).toHaveBeenCalled();
  });

  it("skips agents with @legacy templateOrigin", async () => {
    const mockMaterialize = vi.fn().mockResolvedValue({ adapterConfig: {} });

    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            {
              ...AGENT_ROW, companyId: "co-1",
              templateOrigin: "aoa-curated/standard-crew/maker@legacy",
              kind: "aoa",
            },
          ]),
        }),
      }),
      transaction: vi.fn(),
    };

    const settings = {
      agentUpdatePolicy: "auto" as const,
      updateWindow: "anytime" as const,
      allowTeamLeadPlugins: false,
      teamMemberCanRequestInstall: false,
      requireFounderApproval: false,
      updateCheckHours: 24 as const,
    };

    await checkCrewUpdates({
      db: db as any,
      companyId: "co-1",
      catalogItems: [CATALOG_ITEM],
      settings,
      instructionsService: { materializeManagedBundle: mockMaterialize } as any,
    });

    // @legacy agents are skipped — no transaction
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("skips agents where catalog version matches templateVersion", async () => {
    const mockMaterialize = vi.fn().mockResolvedValue({ adapterConfig: {} });

    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            {
              ...AGENT_ROW,
              companyId: "co-1",
              templateOrigin: CATALOG_ITEM.id,
              templateVersion: CATALOG_ITEM.version, // same version = no update needed
              kind: "aoa",
            },
          ]),
        }),
      }),
      transaction: vi.fn(),
    };

    const settings = {
      agentUpdatePolicy: "auto" as const,
      updateWindow: "anytime" as const,
      allowTeamLeadPlugins: false,
      teamMemberCanRequestInstall: false,
      requireFounderApproval: false,
      updateCheckHours: 24 as const,
    };

    await checkCrewUpdates({
      db: db as any,
      companyId: "co-1",
      catalogItems: [CATALOG_ITEM],
      settings,
      instructionsService: { materializeManagedBundle: mockMaterialize } as any,
    });

    expect(db.transaction).not.toHaveBeenCalled();
  });
});
