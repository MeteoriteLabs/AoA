import { describe, it, expect, vi } from "vitest";

// Drizzle ESM cycle workaround (per CLAUDE.md V2 Test Patterns)
vi.mock("@armyofagents/db", () => {
  const tableProxy = new Proxy({}, { get: () => Symbol("col") });
  return {
    agents: tableProxy,
    teams: tableProxy,
    companySkills: tableProxy,
    plugins: tableProxy,
    projects: tableProxy,
    marketplaceInstallOperations: tableProxy,
  };
});
vi.mock("drizzle-orm", () => ({
  eq: () => Symbol("op:eq"),
  and: () => Symbol("op:and"),
}));

import { resolveInstallPlan } from "../services/marketplace-install/resolver.js";
import type { CatalogItem } from "@armyofagents/shared";

const SLACK_PLUGIN: CatalogItem = {
  id: "plugin:aoa-curated/aoa-plugin-slack",
  type: "plugin",
  name: "Slack",
  description: "Slack integration",
  version: "1.0.0",
  source: { adapter: "aoa-curated", url: "https://...", locator: "plugins/aoa-plugin-slack", commitSha: "abc123" },
  npm: { packageName: "aoa-plugin-slack", version: "1.0.0" },
  trust: { tier: "verified", source: "aoa-curated" },
  status: "active",
  addedAt: "2026-04-30T00:00:00Z",
  capabilities: [],
  category: "integrations",
  tags: [],
};

const ENGINEER_TEAM: CatalogItem = {
  id: "team:aoa-curated/engineering",
  type: "team",
  name: "Engineering Team",
  description: "Standard engineering team template",
  version: "1.0.0",
  source: { adapter: "aoa-curated", url: "https://...", locator: "content/teams/engineering", commitSha: "abc123" },
  resourceUrl: "https://raw.githubusercontent.com/.../abc123/content/teams/engineering/team.json",
  trust: { tier: "verified", source: "aoa-curated" },
  status: "active",
  addedAt: "2026-04-30T00:00:00Z",
  category: "engineering",
  tags: [],
  requires: [
    { type: "agent", id: "agent:aoa-curated/engineer" },
    { type: "skill", id: "skill:aoa-curated/code-review" },
    { type: "plugin", id: "plugin:aoa-curated/aoa-plugin-github-issues" },
  ],
};

// Concrete fixtures for the items ENGINEER_TEAM requires. Resolver throws
// "Required catalog item not found" if these are missing.
const REQUIRED_AGENT: CatalogItem = {
  id: "agent:aoa-curated/engineer",
  type: "agent",
  name: "Engineer",
  description: "Senior engineer agent",
  version: "1.0.0",
  source: { adapter: "aoa-curated", url: "https://...", locator: "content/agents/engineer", commitSha: "abc123" },
  resourceUrl: "https://raw.githubusercontent.com/.../abc123/content/agents/engineer/agent.json",
  trust: { tier: "verified", source: "aoa-curated" },
  status: "active",
  addedAt: "2026-04-30T00:00:00Z",
  category: "engineering",
  tags: [],
};

const REQUIRED_SKILL: CatalogItem = {
  id: "skill:aoa-curated/code-review",
  type: "skill",
  name: "Code Review",
  description: "Code review skill",
  version: "1.0.0",
  source: { adapter: "aoa-curated", url: "https://...", locator: "content/skills/code-review", commitSha: "abc123" },
  resourceUrl: "https://raw.githubusercontent.com/.../abc123/content/skills/code-review/SKILL.md",
  content: { inline: "# Code Review" },
  trust: { tier: "verified", source: "aoa-curated" },
  status: "active",
  addedAt: "2026-04-30T00:00:00Z",
  category: "engineering",
  tags: [],
};

const REQUIRED_PLUGIN: CatalogItem = {
  id: "plugin:aoa-curated/aoa-plugin-github-issues",
  type: "plugin",
  name: "GitHub Issues",
  description: "GitHub issues integration",
  version: "1.0.0",
  source: { adapter: "aoa-curated", url: "https://...", locator: "plugins/aoa-plugin-github-issues", commitSha: "abc123" },
  npm: { packageName: "aoa-plugin-github-issues", version: "1.0.0" },
  trust: { tier: "verified", source: "aoa-curated" },
  status: "active",
  addedAt: "2026-04-30T00:00:00Z",
  capabilities: [],
  category: "integrations",
  tags: [],
};

const CATALOG = {
  schemaVersion: "1.0.0",
  generatedAt: "2026-04-30T00:00:00Z",
  itemCount: 5,
  items: [SLACK_PLUGIN, ENGINEER_TEAM, REQUIRED_AGENT, REQUIRED_SKILL, REQUIRED_PLUGIN],
};

describe("resolveInstallPlan", () => {
  it("returns single-step plan for a leaf item (plugin) not yet installed", async () => {
    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([]),  // no rows
          }),
        }),
      }),
    };

    const plan = await resolveInstallPlan({
      catalogItemId: SLACK_PLUGIN.id,
      catalog: CATALOG,
      db: mockDb as any,
      companyId: "c1",
    });

    expect(plan.rootItem.id).toBe(SLACK_PLUGIN.id);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].catalogItemId).toBe(SLACK_PLUGIN.id);
    expect(plan.steps[0].action).toBe("install-new");
    expect(plan.conflicts).toEqual([]);
  });

  it("expands team install into plugin + skills + agents cascade", async () => {
    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([]),
          }),
        }),
      }),
    };

    const plan = await resolveInstallPlan({
      catalogItemId: ENGINEER_TEAM.id,
      catalog: CATALOG,
      db: mockDb as any,
      companyId: "c1",
    });

    const stepIds = plan.steps.map((s) => s.catalogItemId);
    expect(stepIds).toContain(ENGINEER_TEAM.id);
    expect(stepIds).toContain("plugin:aoa-curated/aoa-plugin-github-issues");
    expect(stepIds).toContain("agent:aoa-curated/engineer");
    expect(stepIds).toContain("skill:aoa-curated/code-review");
  });

  it("marks plugin as skip-already-installed if at same version", async () => {
    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([
              { id: "plugin-row-1", packageName: "aoa-plugin-slack", version: "1.0.0", status: "ready" },
            ]),
          }),
        }),
      }),
    };

    const plan = await resolveInstallPlan({
      catalogItemId: SLACK_PLUGIN.id,
      catalog: CATALOG,
      db: mockDb as any,
      companyId: "c1",
    });

    expect(plan.steps[0].action).toBe("skip-already-installed");
  });

  it("throws on unknown catalogItemId", async () => {
    const mockDb = { select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }) };
    await expect(
      resolveInstallPlan({
        catalogItemId: "unknown:item",
        catalog: CATALOG,
        db: mockDb as any,
        companyId: "c1",
      }),
    ).rejects.toThrow(/not found/i);
  });
});
