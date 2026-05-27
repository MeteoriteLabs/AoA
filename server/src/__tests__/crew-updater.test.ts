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

import { applyCrewAgentUpdate, checkCrewUpdates } from "../services/marketplace-install/crew-updater.js";

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
};

function makeTxMock(updatedFields: Record<string, unknown>) {
  return {
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockImplementation((v: Record<string, unknown>) => {
        Object.assign(updatedFields, v);
        return { where: vi.fn().mockResolvedValue(undefined) };
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
