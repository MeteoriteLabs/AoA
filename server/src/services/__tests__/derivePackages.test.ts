import { describe, it, expect } from "vitest";
import type { MarketplaceCatalogItem } from "@armyofagents/shared";
import { derivePackages } from "../derivePackages.js";

function makeItem(overrides: Partial<MarketplaceCatalogItem> & { id: string }): MarketplaceCatalogItem {
  return {
    id: overrides.id,
    type: "skill",
    name: overrides.id,
    description: "test item",
    version: "1.0.0",
    source: {
      adapter: "github-skills",
      url: "https://github.com/example/repo",
      locator: "default",
    },
    trust: { tier: "verified", source: "x" },
    status: "active",
    addedAt: "2026-05-01T00:00:00Z",
    category: "engineering",
    tags: [],
    ...overrides,
  } as MarketplaceCatalogItem;
}

describe("derivePackages", () => {
  it("returns [] for an empty input", () => {
    expect(derivePackages([])).toEqual([]);
  });

  it("groups items by github owner/repo extracted from source.url", () => {
    const items = [
      makeItem({ id: "skill:gstack/office-hours", source: { adapter: "g", url: "https://github.com/garrytan/gstack/tree/abc/skills/office-hours", locator: "office-hours" } }),
      makeItem({ id: "skill:gstack/qa", source: { adapter: "g", url: "https://github.com/garrytan/gstack/tree/abc/skills/qa", locator: "qa" } }),
      makeItem({ id: "skill:sp/brainstorming", source: { adapter: "g", url: "https://github.com/anthropic/superpowers/tree/main/skills/brainstorming", locator: "brainstorming" } }),
      makeItem({ id: "skill:sp/code-review", source: { adapter: "g", url: "https://github.com/anthropic/superpowers/tree/main/skills/code-review", locator: "code-review" } }),
    ];
    const packages = derivePackages(items);
    expect(packages).toHaveLength(2);
    const gstack = packages.find((p) => p.id === "garrytan/gstack")!;
    const sp = packages.find((p) => p.id === "anthropic/superpowers")!;
    expect(gstack.memberItemIds.sort()).toEqual(["skill:gstack/office-hours", "skill:gstack/qa"]);
    expect(sp.memberItemIds.sort()).toEqual(["skill:sp/brainstorming", "skill:sp/code-review"]);
  });

  it("strips a trailing .git suffix from the repo name", () => {
    const items = [
      makeItem({ id: "a", source: { adapter: "g", url: "https://github.com/owner/repo.git", locator: "x" } }),
      makeItem({ id: "b", source: { adapter: "g", url: "https://github.com/owner/repo.git/tree/main/y", locator: "y" } }),
    ];
    const [pkg] = derivePackages(items);
    expect(pkg.id).toBe("owner/repo");
    expect(pkg.name).toBe("repo");
  });

  it("excludes single-item synthesized groups (threshold = 2)", () => {
    const items = [
      makeItem({ id: "loner", source: { adapter: "g", url: "https://github.com/foo/bar", locator: "z" } }),
      makeItem({ id: "p1", source: { adapter: "g", url: "https://github.com/qux/quux/tree/main/a", locator: "a" } }),
      makeItem({ id: "p2", source: { adapter: "g", url: "https://github.com/qux/quux/tree/main/b", locator: "b" } }),
    ];
    const packages = derivePackages(items);
    expect(packages).toHaveLength(1);
    expect(packages[0]!.id).toBe("qux/quux");
  });

  it("excludes items with non-github source URLs from synthesis", () => {
    const items = [
      makeItem({ id: "x1", source: { adapter: "g", url: "https://gitlab.com/foo/bar", locator: "x" } }),
      makeItem({ id: "x2", source: { adapter: "g", url: "https://gitlab.com/foo/bar", locator: "y" } }),
    ];
    expect(derivePackages(items)).toEqual([]);
  });

  it("explicit packageId overrides synthesis and accepts groups of size 1", () => {
    const items = [
      makeItem({ id: "alone", packageId: "my-curated", source: { adapter: "g", url: "https://example.com/anywhere", locator: "x" } }),
    ];
    const packages = derivePackages(items);
    expect(packages).toHaveLength(1);
    expect(packages[0]).toMatchObject({
      id: "my-curated",
      name: "my-curated",
      explicit: true,
      count: 1,
      memberItemIds: ["alone"],
    });
  });

  it("explicit packageId pulls items together even from different source URLs", () => {
    const items = [
      makeItem({ id: "a", packageId: "joint", source: { adapter: "g", url: "https://github.com/o1/r1", locator: "x" } }),
      makeItem({ id: "b", packageId: "joint", source: { adapter: "g", url: "https://github.com/o2/r2", locator: "y" } }),
    ];
    const packages = derivePackages(items);
    expect(packages).toHaveLength(1);
    expect(packages[0]!.memberItemIds.sort()).toEqual(["a", "b"]);
  });

  it("explicit packageId on one item promotes only that item; others still synthesize separately", () => {
    const items = [
      makeItem({ id: "ex", packageId: "explicit-pkg", source: { adapter: "g", url: "https://github.com/owner/repo/tree/main/a", locator: "a" } }),
      makeItem({ id: "syn1", source: { adapter: "g", url: "https://github.com/owner/repo/tree/main/b", locator: "b" } }),
      makeItem({ id: "syn2", source: { adapter: "g", url: "https://github.com/owner/repo/tree/main/c", locator: "c" } }),
    ];
    const packages = derivePackages(items);
    expect(packages).toHaveLength(2);
    const ex = packages.find((p) => p.id === "explicit-pkg")!;
    const syn = packages.find((p) => p.id === "owner/repo")!;
    expect(ex.explicit).toBe(true);
    expect(ex.memberItemIds).toEqual(["ex"]);
    expect(syn.explicit).toBe(false);
    expect(syn.memberItemIds.sort()).toEqual(["syn1", "syn2"]);
  });

  it("verified=true only when every member is verified", () => {
    const items = [
      makeItem({ id: "v1", trust: { tier: "verified", source: "x" }, source: { adapter: "g", url: "https://github.com/x/y/tree/main/a", locator: "a" } }),
      makeItem({ id: "v2", trust: { tier: "verified", source: "x" }, source: { adapter: "g", url: "https://github.com/x/y/tree/main/b", locator: "b" } }),
    ];
    expect(derivePackages(items)[0]!.verified).toBe(true);

    const mixed = [
      ...items,
      makeItem({ id: "c", trust: { tier: "community", source: "x" }, source: { adapter: "g", url: "https://github.com/x/y/tree/main/c", locator: "c" } }),
    ];
    expect(derivePackages(mixed)[0]!.verified).toBe(false);
  });

  it("returns memberItemIds sorted ascending and packages sorted by id ascending", () => {
    const items = [
      makeItem({ id: "z", source: { adapter: "g", url: "https://github.com/zz/zz/tree/main/a", locator: "a" } }),
      makeItem({ id: "a", source: { adapter: "g", url: "https://github.com/aa/aa/tree/main/a", locator: "a" } }),
      makeItem({ id: "m", source: { adapter: "g", url: "https://github.com/aa/aa/tree/main/m", locator: "m" } }),
      makeItem({ id: "b", source: { adapter: "g", url: "https://github.com/zz/zz/tree/main/b", locator: "b" } }),
    ];
    const packages = derivePackages(items);
    expect(packages.map((p) => p.id)).toEqual(["aa/aa", "zz/zz"]);
    expect(packages[0]!.memberItemIds).toEqual(["a", "m"]);
    expect(packages[1]!.memberItemIds).toEqual(["b", "z"]);
  });

  it("count always equals memberItemIds.length", () => {
    const items = [
      makeItem({ id: "a", source: { adapter: "g", url: "https://github.com/o/r/tree/main/a", locator: "a" } }),
      makeItem({ id: "b", source: { adapter: "g", url: "https://github.com/o/r/tree/main/b", locator: "b" } }),
      makeItem({ id: "c", source: { adapter: "g", url: "https://github.com/o/r/tree/main/c", locator: "c" } }),
    ];
    const [pkg] = derivePackages(items);
    expect(pkg!.count).toBe(pkg!.memberItemIds.length);
    expect(pkg!.count).toBe(3);
  });
});
