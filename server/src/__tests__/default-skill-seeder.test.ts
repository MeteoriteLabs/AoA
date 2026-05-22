/**
 * Tests for seedDefaultCommanderSkills (Sprint 2).
 *
 * Covers:
 *   1. Empty skills array in config → no DB queries, returns quickly
 *   2. Skill already installed → installSkill NOT called (idempotent)
 *   3. Skill not installed → installSkill called with correct args
 *   4. installSkill throws → error swallowed (non-fatal, continues)
 *   5. Config file missing/malformed → returns gracefully without error
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks ───────────────────────────────────────────────────────────────

// We mock `fs` so we can control what readFileSync returns without touching disk.
vi.mock("fs", () => ({
  readFileSync: vi.fn(),
}));

vi.mock("@armyofagents/db", () => {
  const tableProxy = new Proxy({}, { get: () => Symbol("col") });
  return {
    companySkills: tableProxy,
    marketplaceCatalogCache: tableProxy,
  };
});

vi.mock("drizzle-orm", () => ({
  eq: () => Symbol("eq"),
  and: () => Symbol("and"),
}));

vi.mock("../services/marketplace-install/skill-installer.js", () => ({
  installSkill: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../middleware/logger.js", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// @armyofagents/shared validation — make safeParse always succeed with a passthrough
vi.mock("@armyofagents/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@armyofagents/shared")>();
  return {
    ...actual,
    MarketplaceCatalogFileSchema: {
      safeParse: (data: unknown) => ({ success: true, data }),
    },
    isSchemaVersionSupported: () => true,
  };
});

import { readFileSync } from "fs";
import { seedDefaultCommanderSkills } from "../services/marketplace-install/default-skill-seeder.js";
import { installSkill } from "../services/marketplace-install/skill-installer.js";
import { logger } from "../middleware/logger.js";

// ── helpers ────────────────────────────────────────────────────────────────────

const SKILL_ID = "skill:aoa-curated/code-review";

const CATALOG_ITEM = {
  id: SKILL_ID,
  type: "skill",
  name: "Code Review",
  description: "...",
  version: "1.1.0",
  source: { adapter: "aoa-curated", url: "...", locator: "...", commitSha: "abc" },
  resourceUrl: "https://example.com/SKILL.md",
  trust: { tier: "verified", source: "aoa-curated" },
  status: "active",
  addedAt: "2026-04-30T00:00:00Z",
  category: "engineering",
  tags: [],
};

/**
 * Build a mock DB that simulates the two-step query pattern used by the seeder:
 *   1. SELECT from marketplaceCatalogCache → catalog row
 *   2. SELECT from companySkills           → existing skill row(s)
 */
function buildMockDb({
  catalogRows = [
    {
      schemaVersion: "1.0.0",
      generatedAt: new Date("2026-04-30T00:00:00Z"),
      itemCount: 1,
      catalogJson: { items: [CATALOG_ITEM] },
    },
  ],
  skillRows = [] as any[],
}: {
  catalogRows?: any[];
  skillRows?: any[];
} = {}) {
  let selectCall = 0;

  return {
    select: (_cols?: any) => {
      selectCall++;
      const n = selectCall;
      return {
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve(n === 1 ? catalogRows : skillRows),
          }),
        }),
      };
    },
  };
}

/** Parse the default skills config from a JSON string. */
function mockConfig(skills: string[]) {
  vi.mocked(readFileSync).mockReturnValue(
    JSON.stringify({ _comment: "test", skills }) as any,
  );
}

// ── tests ──────────────────────────────────────────────────────────────────────

describe("seedDefaultCommanderSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. empty skills array in config → no DB queries, no installSkill call", async () => {
    mockConfig([]);
    const db = buildMockDb();
    const selectSpy = vi.spyOn(db, "select");

    await expect(
      seedDefaultCommanderSkills({ db: db as any, companyId: "c1" }),
    ).resolves.toBeUndefined();

    // Should return before touching the DB at all.
    expect(selectSpy).not.toHaveBeenCalled();
    expect(installSkill).not.toHaveBeenCalled();
  });

  it("2. skill already installed → installSkill NOT called (idempotent)", async () => {
    mockConfig([SKILL_ID]);
    const db = buildMockDb({
      skillRows: [{ id: "existing-row-id" }], // skill exists
    });

    await seedDefaultCommanderSkills({ db: db as any, companyId: "c1" });

    expect(installSkill).not.toHaveBeenCalled();
  });

  it("3. skill not installed → installSkill called with correct args", async () => {
    mockConfig([SKILL_ID]);
    const db = buildMockDb({
      skillRows: [], // not yet installed
    });

    await seedDefaultCommanderSkills({ db: db as any, companyId: "c1" });

    expect(installSkill).toHaveBeenCalledOnce();
    expect(installSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "c1",
        catalogItem: expect.objectContaining({ id: SKILL_ID }),
      }),
    );
  });

  it("4. installSkill throws → error is swallowed; function resolves without throwing", async () => {
    mockConfig([SKILL_ID]);
    const db = buildMockDb({ skillRows: [] });
    vi.mocked(installSkill).mockRejectedValueOnce(new Error("network error"));

    // Must not throw — non-fatal error handling
    await expect(
      seedDefaultCommanderSkills({ db: db as any, companyId: "c1" }),
    ).resolves.toBeUndefined();

    // Logger should have logged the error
    expect(logger.error).toHaveBeenCalled();
  });

  it("5. config file missing/malformed → returns gracefully without error", async () => {
    // readFileSync throws on missing file
    vi.mocked(readFileSync).mockImplementationOnce(() => {
      throw new Error("ENOENT: no such file");
    });

    const db = buildMockDb();
    const selectSpy = vi.spyOn(db, "select");

    await expect(
      seedDefaultCommanderSkills({ db: db as any, companyId: "c1" }),
    ).resolves.toBeUndefined();

    // Should return early — no DB access, no installSkill
    expect(selectSpy).not.toHaveBeenCalled();
    expect(installSkill).not.toHaveBeenCalled();
  });
});
