import { describe, it, expect } from "vitest";
import { isAoaItem, isAoaPackage, isAoaOwner, AOA_OWNERS } from "../marketplace-constants";
import type { MarketplaceCatalogItem, MarketplacePackage } from "@armyofagents/shared";

const item = (url: string, provider?: { id?: string; name?: string }) =>
  ({ source: { url }, provider }) as unknown as MarketplaceCatalogItem;
const pkg = (id: string, provider?: { id?: string }) =>
  ({ id, provider }) as unknown as MarketplacePackage;

describe("AoA predicates", () => {
  it("isAoaItem matches AoA github owners (case-insensitive)", () => {
    expect(isAoaItem(item("https://github.com/aoa-curated/x"))).toBe(true);
    expect(isAoaItem(item("https://github.com/MeteoriteLabs/x"))).toBe(true);
    expect(isAoaItem(item("https://github.com/ArmyOfAgents/x"))).toBe(true);
  });
  it("isAoaItem rejects third-party + non-github hosts", () => {
    expect(isAoaItem(item("https://github.com/garrytan/x"))).toBe(false);
    expect(isAoaItem(item("https://notgithub.com/aoa-curated/x"))).toBe(false);
  });
  it("isAoaItem matches by provider.id (not by display name)", () => {
    expect(isAoaItem(item("https://skills.sh/x", { id: "aoa-curated" }))).toBe(true);
    expect(isAoaItem(item("https://skills.sh/x", { name: "Army of Agents" }))).toBe(false);
  });
  it("isAoaPackage matches owner/repo id + provider.id", () => {
    expect(isAoaPackage(pkg("aoa-curated/crew"))).toBe(true);
    expect(isAoaPackage(pkg("garrytan/gstack"))).toBe(false);
    expect(isAoaPackage(pkg("x", { id: "armyofagents" }))).toBe(true);
  });
  it("isAoaOwner is case-insensitive and null-safe", () => {
    expect(isAoaOwner("MeteoriteLabs")).toBe(true);
    expect(isAoaOwner(null)).toBe(false);
    expect(isAoaOwner(undefined)).toBe(false);
    expect(isAoaOwner("garrytan")).toBe(false);
  });
  it("AOA_OWNERS entries are lowercase", () => {
    for (const o of AOA_OWNERS) expect(o).toBe(o.toLowerCase());
  });
});
