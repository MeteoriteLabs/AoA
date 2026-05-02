import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@armyofagents/db", () => {
  const tableProxy = new Proxy({}, { get: () => Symbol("col") });
  return {
    marketplacePendingUpdates: tableProxy,
    companies: tableProxy,
    companySkills: tableProxy,
  };
});
vi.mock("drizzle-orm", () => ({
  eq: () => Symbol("eq"),
  and: () => Symbol("and"),
}));
vi.mock("../services/marketplace-notifications.js", () => ({
  marketplaceNotifications: {
    updateAvailable: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../services/marketplace-settings.js", () => ({
  marketplaceSettingsService: vi.fn(() => ({
    get: vi.fn().mockResolvedValue({
      skillUpdatePolicy: "notify",
      updateWindow: "anytime",
    }),
  })),
}));
vi.mock("../services/marketplace-install/skill-auto-updater.js", () => ({
  applySkillUpdate: vi.fn().mockResolvedValue(undefined),
  isWithinUpdateWindow: vi.fn().mockReturnValue(true),
  SkillCustomizedError: class SkillCustomizedError extends Error {
    constructor(id: string) { super(id); this.name = "SkillCustomizedError"; }
  },
  SkillDeletedError: class SkillDeletedError extends Error {
    constructor(id: string) { super(id); this.name = "SkillDeletedError"; }
  },
}));
vi.mock("../middleware/logger.js", () => ({
  logger: { error: vi.fn() },
}));

import { runUpdateCheck, upsertPendingUpdate, compareVersions } from "../services/marketplace-update-checker.js";
import { marketplaceNotifications } from "../services/marketplace-notifications.js";
import { marketplaceSettingsService } from "../services/marketplace-settings.js";
import { applySkillUpdate, isWithinUpdateWindow, SkillCustomizedError, SkillDeletedError } from "../services/marketplace-install/skill-auto-updater.js";
import type { CatalogItem } from "@armyofagents/shared";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SKILL_CATALOG_ITEM: CatalogItem = {
  id: "skill:aoa-curated/code-review",
  type: "skill",
  name: "Code Review",
  description: "...",
  version: "1.1.0",
  source: { adapter: "aoa-curated", url: "...", locator: "...", commitSha: "abc" },
  resourceUrl: "https://example.com/SKILL.md",
  content: { inline: "# Code Review v1.1.0" },
  trust: { tier: "verified", source: "aoa-curated" },
  status: "active",
  addedAt: "2026-04-30T00:00:00Z",
  category: "engineering",
  tags: [],
};

function buildMockDb({
  skillRows = [{ sourceLocator: SKILL_CATALOG_ITEM.id, sourceRef: "1.0.0" }],
  insertReturning = [{ id: "upd-1" }],
}: {
  skillRows?: Array<{ sourceLocator: string; sourceRef: string }>;
  insertReturning?: Array<{ id: string }>;
} = {}) {
  let selectCall = 0;
  return {
    select: () => {
      selectCall++;
      const n = selectCall;
      return {
        from: () => {
          if (n === 1) return Promise.resolve([{ id: "c1" }]); // companies
          return { where: () => Promise.resolve(skillRows) };   // companySkills
        },
      };
    },
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: () => Promise.resolve(insertReturning),
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  };
}

// ─── compareVersions ──────────────────────────────────────────────────────────

describe("compareVersions", () => {
  it("returns positive when latest > current", () => {
    expect(compareVersions("1.1.0", "1.0.0")).toBeGreaterThan(0);
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
  });
  it("returns 0 when versions are equal", () => {
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });
  it("returns negative when latest < current", () => {
    expect(compareVersions("0.9.0", "1.0.0")).toBeLessThan(0);
  });
});

// ─── upsertPendingUpdate ──────────────────────────────────────────────────────

describe("upsertPendingUpdate", () => {
  it("returns { inserted: false } when latest version is not newer than current", async () => {
    const db = buildMockDb();
    const result = await upsertPendingUpdate(db as any, "c1", {
      catalogItemId: "skill:x",
      catalogItemName: "X",
      itemType: "skill",
      currentVersion: "1.0.0",
      latestVersion: "1.0.0", // same version
    });
    expect(result).toEqual({ inserted: false });
  });

  it("returns { inserted: true } when a new row is inserted", async () => {
    const db = buildMockDb({ insertReturning: [{ id: "upd-1" }] });
    const result = await upsertPendingUpdate(db as any, "c1", {
      catalogItemId: "skill:x",
      catalogItemName: "X",
      itemType: "skill",
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
    });
    expect(result).toEqual({ inserted: true });
  });

  it("returns { inserted: false } on conflict (row already exists)", async () => {
    const db = buildMockDb({ insertReturning: [] }); // empty = conflict
    const result = await upsertPendingUpdate(db as any, "c1", {
      catalogItemId: "skill:x",
      catalogItemName: "X",
      itemType: "skill",
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
    });
    expect(result).toEqual({ inserted: false });
  });
});

// ─── runUpdateCheck auto-apply logic ─────────────────────────────────────────

describe("runUpdateCheck — notify policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(marketplaceSettingsService).mockReturnValue({
      get: vi.fn().mockResolvedValue({ skillUpdatePolicy: "notify", updateWindow: "anytime" }),
    } as any);
    vi.mocked(isWithinUpdateWindow).mockReturnValue(true);
  });

  it("fires updateAvailable and does NOT call applySkillUpdate when policy is notify", async () => {
    const db = buildMockDb();
    await runUpdateCheck(db as any, [SKILL_CATALOG_ITEM]);

    expect(marketplaceNotifications.updateAvailable).toHaveBeenCalledOnce();
    expect(applySkillUpdate).not.toHaveBeenCalled();
  });
});

describe("runUpdateCheck — auto policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(marketplaceSettingsService).mockReturnValue({
      get: vi.fn().mockResolvedValue({ skillUpdatePolicy: "auto", updateWindow: "anytime" }),
    } as any);
    vi.mocked(isWithinUpdateWindow).mockReturnValue(true);
    vi.mocked(applySkillUpdate).mockResolvedValue(undefined);
  });

  it("calls applySkillUpdate (not updateAvailable) when policy=auto and in window", async () => {
    const db = buildMockDb();
    await runUpdateCheck(db as any, [SKILL_CATALOG_ITEM]);

    expect(applySkillUpdate).toHaveBeenCalledOnce();
    expect(marketplaceNotifications.updateAvailable).not.toHaveBeenCalled();
  });

  it("fires updateAvailable as fallback when outside update window", async () => {
    vi.mocked(isWithinUpdateWindow).mockReturnValue(false);
    const db = buildMockDb();
    await runUpdateCheck(db as any, [SKILL_CATALOG_ITEM]);

    expect(applySkillUpdate).not.toHaveBeenCalled();
    expect(marketplaceNotifications.updateAvailable).toHaveBeenCalledOnce();
  });

  it("fires updateAvailable as fallback when applySkillUpdate throws SkillCustomizedError", async () => {
    vi.mocked(applySkillUpdate).mockRejectedValue(new SkillCustomizedError("skill:x"));
    const db = buildMockDb();
    await runUpdateCheck(db as any, [SKILL_CATALOG_ITEM]);

    expect(marketplaceNotifications.updateAvailable).toHaveBeenCalledOnce();
  });

  it("fires updateAvailable as fallback when applySkillUpdate throws a fetch error", async () => {
    vi.mocked(applySkillUpdate).mockRejectedValue(new Error("HTTP 503"));
    const db = buildMockDb();
    await runUpdateCheck(db as any, [SKILL_CATALOG_ITEM]);

    expect(marketplaceNotifications.updateAvailable).toHaveBeenCalledOnce();
  });

  it("skips notification (but continues) when SkillDeletedError is thrown", async () => {
    vi.mocked(applySkillUpdate).mockRejectedValue(new SkillDeletedError("skill:x"));
    const db = buildMockDb();
    await runUpdateCheck(db as any, [SKILL_CATALOG_ITEM]);

    expect(marketplaceNotifications.updateAvailable).not.toHaveBeenCalled();
  });

  it("processes remaining skills even when one skill throws", async () => {
    const SKILL_2: CatalogItem = { ...SKILL_CATALOG_ITEM, id: "skill:aoa-curated/web-search", name: "Web Search" };
    vi.mocked(applySkillUpdate)
      .mockRejectedValueOnce(new Error("Unexpected error for skill 1"))
      .mockResolvedValueOnce(undefined);

    const db = {
      ...buildMockDb({
        skillRows: [
          { sourceLocator: SKILL_CATALOG_ITEM.id, sourceRef: "1.0.0" },
          { sourceLocator: SKILL_2.id, sourceRef: "1.0.0" },
        ],
      }),
    };

    await runUpdateCheck(db as any, [SKILL_CATALOG_ITEM, SKILL_2]);

    // Both skills attempted; second succeeds
    expect(applySkillUpdate).toHaveBeenCalledTimes(2);
  });
});
