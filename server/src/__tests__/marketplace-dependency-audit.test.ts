import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * T2.4 Step 6 — marketplace dependency audit.
 *
 * Asserts that every marketplace AGENT's and the crew TEAM's declared `requires`
 * edges resolve to a matching-type, ACTIVE item in the published catalog. The
 * catalog is authored in two EXTERNAL repos, so an upstream rename/drop can
 * silently orphan a dependency here — which makes the crew-team install fail
 * pre-flight and degrades every new company to the non-updateable `@legacy`
 * roster (the exact state Phase 2 exists to eliminate).
 *
 * This is a plain `.test.ts` (not `*.integration.test.ts`/e2e), so it runs in the
 * required Linux `verify` gate AND on Windows — no DB, no network. It audits a
 * committed, GENERATED projection of the real published catalog index
 * (`__fixtures__/published-catalog/catalog-index.json`), refreshed via
 * `pnpm fetch-catalog:audit-fixture` whenever the catalog is bumped. Because the
 * fixture copies id/type/status/requires byte-for-byte, it cannot diverge from
 * production in the audited dimension (same discipline as the verbatim
 * `*.agent.json` fixtures).
 */

type Item = {
  id: string;
  type: string;
  status: string;
  requires?: { type: string; id: string; versionRange?: string }[];
};
type Catalog = { schemaVersion: string; generatedAt: string; items: Item[] };
type Orphan = {
  owner: string;
  requiredType: string;
  requiredId: string;
  reason: "missing" | "type-mismatch" | "not-active";
};

/**
 * Pure auditor: returns every agent/team `requires` edge that does NOT resolve
 * to a matching-type, active item in the catalog. Empty result = all edges
 * resolve. Exported so it can be reused by a live-CDN advisory script.
 */
export function auditCatalogDependencies(cat: Catalog): Orphan[] {
  const byId = new Map(cat.items.map((i) => [i.id, i]));
  const out: Orphan[] = [];
  for (const owner of cat.items) {
    if (owner.type !== "agent" && owner.type !== "team") continue;
    for (const edge of owner.requires ?? []) {
      const target = byId.get(edge.id);
      if (!target) {
        out.push({ owner: owner.id, requiredType: edge.type, requiredId: edge.id, reason: "missing" });
      } else if (target.type !== edge.type) {
        out.push({ owner: owner.id, requiredType: edge.type, requiredId: edge.id, reason: "type-mismatch" });
      } else if (target.status !== "active") {
        out.push({ owner: owner.id, requiredType: edge.type, requiredId: edge.id, reason: "not-active" });
      }
    }
  }
  return out;
}

const catalog: Catalog = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./__fixtures__/published-catalog/catalog-index.json", import.meta.url)),
    "utf8",
  ),
);

describe("marketplace catalog dependency audit", () => {
  // NON-VACUITY discriminator: an empty CDN-failure fallback or the 5-item e2e
  // stub would fail HERE and never reach the resolution assertion — so a green
  // result below can't be a "test that lies" over zero edges. Floors sit well
  // under real values (12 agents / 27 team edges / 70 total) so legitimate
  // catalog growth won't false-fail, but any degrade will.
  it("fixture is the real catalog index, not an empty/stub degrade", () => {
    const agents = catalog.items.filter((i) => i.type === "agent");
    const team = catalog.items.find((i) => i.id === "team:aoa-curated/default-crew");
    const edges = catalog.items
      .filter((i) => i.type === "agent" || i.type === "team")
      .reduce((n, i) => n + (i.requires?.length ?? 0), 0);
    expect(agents.length).toBeGreaterThanOrEqual(10);
    expect(team, "default-crew team must be present in the catalog").toBeDefined();
    expect(team?.requires?.length ?? 0).toBeGreaterThanOrEqual(25);
    expect(edges).toBeGreaterThanOrEqual(40);
  });

  it("every agent/team requires edge resolves to a matching-type active catalog item", () => {
    const orphans = auditCatalogDependencies(catalog);
    expect(
      orphans,
      `orphaned dependencies (agent/team -> unresolvable requires edge):\n${orphans
        .map((o) => `  ${o.owner} -> ${o.reason} ${o.requiredType} ${o.requiredId}`)
        .join("\n")}`,
    ).toEqual([]);
  });

  // FAIL-ABILITY discriminator: proves the auditor is not a no-op that always
  // returns []. If someone stubs auditCatalogDependencies, this fails the build.
  it("auditor flags an unresolvable edge (negative control)", () => {
    const broken: Catalog = {
      schemaVersion: "1.0.0",
      generatedAt: "test",
      items: [
        { id: "agent:test/a", type: "agent", status: "active", requires: [{ type: "skill", id: "skill:test/missing" }] },
      ],
    };
    expect(auditCatalogDependencies(broken)).toEqual([
      { owner: "agent:test/a", requiredType: "skill", requiredId: "skill:test/missing", reason: "missing" },
    ]);
  });

  it("auditor flags a type mismatch and a non-active target", () => {
    const cat: Catalog = {
      schemaVersion: "1.0.0",
      generatedAt: "test",
      items: [
        { id: "skill:x/dep", type: "skill", status: "deprecated" },
        { id: "plugin:x/p", type: "plugin", status: "active" },
        {
          id: "agent:x/a",
          type: "agent",
          status: "active",
          requires: [
            { type: "skill", id: "skill:x/dep" }, // resolves but not active
            { type: "skill", id: "plugin:x/p" }, // resolves but wrong type
          ],
        },
      ],
    };
    expect(auditCatalogDependencies(cat)).toEqual([
      { owner: "agent:x/a", requiredType: "skill", requiredId: "skill:x/dep", reason: "not-active" },
      { owner: "agent:x/a", requiredType: "skill", requiredId: "plugin:x/p", reason: "type-mismatch" },
    ]);
  });
});
