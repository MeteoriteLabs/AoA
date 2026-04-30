import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@armyofagents/db", () => {
  const tableProxy = new Proxy({}, { get: () => Symbol("col") });
  return { companySkills: tableProxy };
});
vi.mock("drizzle-orm", () => ({
  eq: () => Symbol("op:eq"),
  and: () => Symbol("op:and"),
}));

import { installSkill } from "../services/marketplace-install/skill-installer.js";
import type { CatalogItem } from "@armyofagents/shared";

const SKILL_INLINE: CatalogItem = {
  id: "skill:aoa-curated/code-review",
  type: "skill",
  name: "Code Review Skill",
  description: "Review code for issues",
  version: "1.0.0",
  source: { adapter: "aoa-curated", url: "https://...", locator: "content/skills/code-review", commitSha: "abc123" },
  resourceUrl: "https://raw.githubusercontent.com/.../abc123/content/skills/code-review/SKILL.md",
  content: { inline: "# Code Review\n\nAlways check for memory leaks." },
  trust: { tier: "verified", source: "aoa-curated" },
  status: "active",
  addedAt: "2026-04-30T00:00:00Z",
  category: "engineering",
  tags: [],
};

const SKILL_FETCH: CatalogItem = {
  ...SKILL_INLINE,
  id: "skill:aoa-curated/web-search",
  name: "Web Search",
  content: undefined,  // forces HTTP fetch
  resourceUrl: "https://raw.githubusercontent.com/.../abc123/content/skills/web-search/SKILL.md",
};

describe("installSkill", () => {
  let insertedRow: any = null;
  const mockDb = {
    insert: () => ({
      values: (row: any) => {
        insertedRow = row;
        return {
          returning: () => Promise.resolve([{ ...row, id: "skill-uuid-1" }]),
        };
      },
    }),
  };

  beforeEach(() => { insertedRow = null; });

  it("uses inline content when present (no HTTP fetch)", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;

    const result = await installSkill({
      catalogItem: SKILL_INLINE,
      companyId: "c1",
      db: mockDb as any,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(insertedRow.markdown).toBe("# Code Review\n\nAlways check for memory leaks.");
    expect(insertedRow.sourceType).toBe("marketplace");
    expect(insertedRow.sourceLocator).toBe("skill:aoa-curated/code-review");
    expect(insertedRow.sourceRef).toBe("1.0.0");
    expect(result.skillId).toBe("skill-uuid-1");
  });

  it("fetches from resourceUrl when inline content absent", async () => {
    const markdownBody = "# Web Search\n\nFetched from CDN.";
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => markdownBody,
    }));
    global.fetch = fetchMock as any;

    const result = await installSkill({
      catalogItem: SKILL_FETCH,
      companyId: "c1",
      db: mockDb as any,
    });

    expect(fetchMock).toHaveBeenCalledWith(SKILL_FETCH.resourceUrl, expect.any(Object));
    expect(insertedRow.markdown).toBe(markdownBody);
    expect(result.skillId).toBe("skill-uuid-1");
  });

  it("throws if HTTP fetch returns non-ok", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404 }));
    global.fetch = fetchMock as any;

    await expect(
      installSkill({ catalogItem: SKILL_FETCH, companyId: "c1", db: mockDb as any }),
    ).rejects.toThrow(/HTTP 404/);
  });

  it("throws if catalog item has neither inline content nor resourceUrl", async () => {
    const broken: CatalogItem = { ...SKILL_INLINE, content: undefined, resourceUrl: undefined };
    await expect(
      installSkill({ catalogItem: broken, companyId: "c1", db: mockDb as any }),
    ).rejects.toThrow(/no content source/i);
  });
});
