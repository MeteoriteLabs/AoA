import { describe, it, expect, vi } from "vitest";
import type { CatalogItem } from "@armyofagents/shared";

import { loadSkillContent } from "../services/marketplace-install/fetch-resource.js";

const BASE_ITEM: CatalogItem = {
  id: "skill:aoa-curated/code-review",
  type: "skill",
  name: "Code Review",
  description: "Reviews code for issues",
  version: "1.0.0",
  source: { adapter: "aoa-curated", url: "https://example.com", locator: "content/skills/code-review", commitSha: "abc123" },
  resourceUrl: "https://raw.githubusercontent.com/example/abc123/SKILL.md",
  content: undefined,
  trust: { tier: "verified", source: "aoa-curated" },
  status: "active",
  addedAt: "2026-04-30T00:00:00Z",
  category: "engineering",
  tags: [],
};

describe("loadSkillContent", () => {
  it("returns inline content without making any HTTP request", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;

    const item = { ...BASE_ITEM, content: { inline: "# Code Review\n\nCheck for bugs." } };
    const result = await loadSkillContent(item);

    expect(result).toBe("# Code Review\n\nCheck for bugs.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches from resourceUrl when no inline content present", async () => {
    const body = "# Web Search\n\nFetched from CDN.";
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => body,
    })) as any;

    const result = await loadSkillContent(BASE_ITEM);

    expect(result).toBe(body);
    expect(global.fetch).toHaveBeenCalledWith(BASE_ITEM.resourceUrl, expect.any(Object));
  });

  it("throws an error containing 'HTTP 404' when fetch returns non-ok", async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 404 })) as any;

    await expect(loadSkillContent(BASE_ITEM)).rejects.toThrow("HTTP 404");
  });

  it("throws when item has no inline content and no resourceUrl", async () => {
    const broken = { ...BASE_ITEM, resourceUrl: undefined };

    await expect(loadSkillContent(broken)).rejects.toThrow(/no resourceUrl/i);
  });
});
