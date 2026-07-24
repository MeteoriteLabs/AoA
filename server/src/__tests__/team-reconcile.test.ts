import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../services/marketplace-install/fetch-resource.js", () => ({
  fetchCatalogResource: vi.fn(),
}));
vi.mock("../services/marketplace-install/agent-runtime.js", () => ({
  parseMarketplaceAgentTemplate: vi.fn().mockReturnValue({ parsed: true }),
  normalizeMarketplaceAgentTemplate: vi.fn().mockReturnValue({ normalized: true, kind: "aoa", triggers: [] }),
}));
vi.mock("../services/marketplace-install/agent-create.js", () => ({
  createMarketplaceAgent: vi.fn(),
}));
vi.mock("../services/marketplace-install/conflict-resolver.js", () => ({
  resolveAgentNameConflict: vi.fn().mockImplementation(async ({ desiredName }: { desiredName: string }) => desiredName),
}));
vi.mock("@armyofagents/db", () => {
  const tableProxy = new Proxy({}, { get: () => Symbol("col") });
  return { teams: tableProxy, teamMembers: tableProxy, agents: tableProxy };
});
vi.mock("drizzle-orm", () => ({
  eq: () => Symbol("op:eq"),
  and: () => Symbol("op:and"),
}));
vi.mock("../middleware/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { reconcileTeamMembers } from "../services/marketplace-install/team-reconcile.js";
import { fetchCatalogResource } from "../services/marketplace-install/fetch-resource.js";
import { createMarketplaceAgent } from "../services/marketplace-install/agent-create.js";

const TEAM_CATALOG_ITEM = {
  id: "aoa-curated/standard-crew/team",
  type: "team" as const,
  name: "Standard Crew",
  version: "0.2.0",
  description: "test",
  source: { adapter: "aoa-curated", url: "https://example.com", locator: "team", commitSha: "abc" },
  resourceUrl: "https://example.com/team.json",
  trust: { tier: "verified" as const, source: "aoa-curated" },
  status: "active" as const,
  addedAt: "2026-01-01T00:00:00Z",
  category: "crew",
  tags: [],
  requires: [],
};

const LIBRARIAN_CATALOG_ITEM = {
  ...TEAM_CATALOG_ITEM,
  id: "aoa-curated/standard-crew/librarian",
  type: "agent" as const,
  name: "Librarian",
};

function makeDb(opts: {
  teamRows: Array<{ id: string; templateOrigin: string | null }>;
  existingMemberOrigins: string[];
  insertSpy?: ReturnType<typeof vi.fn>;
}) {
  const insertSpy = opts.insertSpy ?? vi.fn().mockResolvedValue(undefined);
  let selectCall = 0;
  const db = {
    select: vi.fn().mockImplementation(() => {
      selectCall += 1;
      // First select() per team = teams query; second = existing members query.
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(
            selectCall % 2 === 1
              ? opts.teamRows
              : opts.existingMemberOrigins.map((templateOrigin) => ({ templateOrigin })),
          ),
          innerJoin: vi.fn().mockReturnThis(),
        }),
      };
    }),
    insert: vi.fn().mockReturnValue({ values: insertSpy }),
  };
  return { db, insertSpy };
}

describe("reconcileTeamMembers (WS6)", () => {
  beforeEach(() => {
    vi.mocked(fetchCatalogResource).mockReset();
    vi.mocked(createMarketplaceAgent).mockReset();
  });

  it("installs a roster member missing from an already-installed team", async () => {
    vi.mocked(fetchCatalogResource).mockImplementation(async (item: any) => {
      if (item.type === "team") {
        return JSON.stringify({
          slug: "standard-crew",
          agents: [
            { templateOrigin: "aoa-curated/standard-crew/adjutant", name: "Adjutant" },
            { templateOrigin: "aoa-curated/standard-crew/librarian", name: "Librarian" },
          ],
        });
      }
      return JSON.stringify({ id: item.id, name: item.name });
    });
    vi.mocked(createMarketplaceAgent).mockResolvedValue({ agentId: "agent-librarian-1" });

    const { db, insertSpy } = makeDb({
      teamRows: [{ id: "team-1", templateOrigin: TEAM_CATALOG_ITEM.id }],
      // Adjutant already installed; Librarian is not.
      existingMemberOrigins: ["aoa-curated/standard-crew/adjutant"],
    });

    const result = await reconcileTeamMembers({
      db: db as any,
      companyId: "co-1",
      catalogItems: [TEAM_CATALOG_ITEM, LIBRARIAN_CATALOG_ITEM],
      instructionsService: { materializeManagedBundle: vi.fn() } as any,
    });

    expect(createMarketplaceAgent).toHaveBeenCalledTimes(1);
    expect(createMarketplaceAgent).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "co-1", desiredName: "Librarian" }),
    );
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: "team-1", agentId: "agent-librarian-1", role: "member" }),
    );
    expect(result).toEqual({ teamsReconciled: 1, membersAdded: 1 });
  });

  it("no-ops when the installed team's roster already matches the catalog", async () => {
    vi.mocked(fetchCatalogResource).mockResolvedValue(
      JSON.stringify({
        slug: "standard-crew",
        agents: [{ templateOrigin: "aoa-curated/standard-crew/librarian", name: "Librarian" }],
      }),
    );

    const { db } = makeDb({
      teamRows: [{ id: "team-1", templateOrigin: TEAM_CATALOG_ITEM.id }],
      existingMemberOrigins: ["aoa-curated/standard-crew/librarian"],
    });

    const result = await reconcileTeamMembers({
      db: db as any,
      companyId: "co-1",
      catalogItems: [TEAM_CATALOG_ITEM, LIBRARIAN_CATALOG_ITEM],
      instructionsService: { materializeManagedBundle: vi.fn() } as any,
    });

    expect(createMarketplaceAgent).not.toHaveBeenCalled();
    expect(result).toEqual({ teamsReconciled: 0, membersAdded: 0 });
  });

  it("skips teams with no templateOrigin (not catalog-installed)", async () => {
    const { db } = makeDb({
      teamRows: [{ id: "team-1", templateOrigin: null }],
      existingMemberOrigins: [],
    });

    const result = await reconcileTeamMembers({
      db: db as any,
      companyId: "co-1",
      catalogItems: [TEAM_CATALOG_ITEM, LIBRARIAN_CATALOG_ITEM],
      instructionsService: { materializeManagedBundle: vi.fn() } as any,
    });

    expect(fetchCatalogResource).not.toHaveBeenCalled();
    expect(result).toEqual({ teamsReconciled: 0, membersAdded: 0 });
  });

  it("one missing member's install failure does not block a different missing member", async () => {
    vi.mocked(fetchCatalogResource).mockImplementation(async (item: any) => {
      if (item.type === "team") {
        return JSON.stringify({
          slug: "standard-crew",
          agents: [
            { templateOrigin: "aoa-curated/standard-crew/librarian", name: "Librarian" },
            { templateOrigin: "aoa-curated/standard-crew/chronicler", name: "Chronicler" },
          ],
        });
      }
      return JSON.stringify({ id: item.id, name: item.name });
    });
    vi.mocked(createMarketplaceAgent)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ agentId: "agent-chronicler-1" });

    const { db, insertSpy } = makeDb({
      teamRows: [{ id: "team-1", templateOrigin: TEAM_CATALOG_ITEM.id }],
      existingMemberOrigins: [],
    });

    const result = await reconcileTeamMembers({
      db: db as any,
      companyId: "co-1",
      catalogItems: [
        TEAM_CATALOG_ITEM,
        LIBRARIAN_CATALOG_ITEM,
        { ...LIBRARIAN_CATALOG_ITEM, id: "aoa-curated/standard-crew/chronicler", name: "Chronicler" },
      ],
      instructionsService: { materializeManagedBundle: vi.fn() } as any,
    });

    expect(createMarketplaceAgent).toHaveBeenCalledTimes(2);
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ teamsReconciled: 1, membersAdded: 1 });
  });
});
