import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@armyofagents/db", () => {
  const tableProxy = new Proxy({}, { get: () => Symbol("col") });
  return {
    agents: tableProxy, teams: tableProxy, teamMembers: tableProxy,
    companySkills: tableProxy, projects: tableProxy, plugins: tableProxy,
  };
});
vi.mock("drizzle-orm", () => ({
  eq: () => Symbol("op:eq"),
  and: () => Symbol("op:and"),
  like: () => Symbol("op:like"),
}));

import { installTeam } from "../services/marketplace-install/team-installer.js";
import type { CatalogItem, MarketplaceCatalogFile } from "@armyofagents/shared";

const PLUGIN: CatalogItem = {
  id: "plugin:aoa-curated/aoa-plugin-github-issues",
  type: "plugin", name: "GitHub Issues", description: "...", version: "1.0.0",
  source: { adapter: "aoa-curated", url: "...", locator: "...", commitSha: "abc" },
  npm: { packageName: "aoa-plugin-github-issues", version: "1.0.0" },
  trust: { tier: "verified", source: "aoa-curated" }, status: "active",
  addedAt: "2026-04-30T00:00:00Z", capabilities: [], category: "integrations", tags: [],
};
const SKILL: CatalogItem = {
  id: "skill:aoa-curated/code-review", type: "skill", name: "Code Review", description: "...", version: "1.0.0",
  source: { adapter: "aoa-curated", url: "...", locator: "...", commitSha: "abc" },
  resourceUrl: "https://.../SKILL.md",
  content: { inline: "# Code Review" },
  trust: { tier: "verified", source: "aoa-curated" }, status: "active",
  addedAt: "2026-04-30T00:00:00Z", category: "engineering", tags: [],
};
const AGENT: CatalogItem = {
  id: "agent:aoa-curated/engineer", type: "agent", name: "Engineer", description: "...", version: "1.0.0",
  source: { adapter: "aoa-curated", url: "...", locator: "...", commitSha: "abc" },
  resourceUrl: "https://.../agent.json",
  trust: { tier: "verified", source: "aoa-curated" }, status: "active",
  addedAt: "2026-04-30T00:00:00Z", category: "engineering", tags: [],
  requires: [{ type: "skill", id: "skill:aoa-curated/code-review" }],
};
const TEAM: CatalogItem = {
  id: "team:aoa-curated/engineering", type: "team", name: "Engineering Team", description: "...", version: "1.0.0",
  source: { adapter: "aoa-curated", url: "...", locator: "...", commitSha: "abc" },
  resourceUrl: "https://.../team.json",
  trust: { tier: "verified", source: "aoa-curated" }, status: "active",
  addedAt: "2026-04-30T00:00:00Z", category: "engineering", tags: [],
  requires: [
    { type: "plugin", id: PLUGIN.id },
    { type: "skill", id: SKILL.id },
    { type: "agent", id: AGENT.id },
  ],
};

const CATALOG: MarketplaceCatalogFile = {
  schemaVersion: "1.0.0", generatedAt: "2026-04-30T00:00:00Z", itemCount: 4, items: [PLUGIN, SKILL, AGENT, TEAM],
};

const TEAM_JSON_BODY = JSON.stringify({
  slug: "engineering",
  description: "Engineering team",
  manifest: { defaultProjectFunctionType: "software_development" },
  agents: [
    { templateOrigin: AGENT.id, name: "Engineer-1" },
    { templateOrigin: AGENT.id, name: "Engineer-2" },
  ],
});

describe("installTeam — Saga cascade", () => {
  let pluginInstalls: any[] = [];
  let skillInserts: any[] = [];
  let agentInserts: any[] = [];
  let teamInserts: any[] = [];
  let teamMemberInserts: any[] = [];

  const mockPluginInstaller = vi.fn(async (opts: any) => {
    pluginInstalls.push(opts);
    return { pluginId: `plug-${pluginInstalls.length}`, alreadyInstalled: false };
  });

  const mockDb = {
    transaction: async (cb: (tx: any) => Promise<any>) => {
      const tx = {
        insert: (_table: any) => ({
          values: (row: any) => {
            if (row.markdown !== undefined) {
              skillInserts.push(row);
            } else if (row.adapterType !== undefined || row.skillKeys !== undefined) {
              agentInserts.push(row);
            } else if (row.parentProjectId !== undefined || row.manifest !== undefined) {
              teamInserts.push(row);
            } else if (row.teamId !== undefined && row.agentId !== undefined && row.role !== undefined) {
              teamMemberInserts.push(row);
            }
            const insertId = `${skillInserts.length + agentInserts.length + teamInserts.length + teamMemberInserts.length}-uuid`;
            return {
              // Skills go through .onConflictDoNothing().returning()
              onConflictDoNothing: () => ({
                returning: (_cols?: any) => Promise.resolve([{ id: insertId }]),
              }),
              // Other inserts (agents, teams, team_members) use .returning() directly
              returning: () => Promise.resolve([{ ...row, id: insertId }]),
            };
          },
        }),
        // tx.select() used by conflict-resolver (returns [] = no conflict) AND
        // by the new skill-exists fallback lookup (needs .limit())
        select: () => ({
          from: () => ({
            where: () => {
              const rows: any[] = [];
              // Thenable for conflict-resolver (awaits .where() directly)
              // AND has .limit() for the skill lookup
              return Object.assign(Promise.resolve(rows), {
                limit: (_n: number) => Promise.resolve(rows),
              });
            },
          }),
        }),
        // T3.0.5: createMarketplaceAgent calls db.transaction() from inside the outer
        // transaction. Pass the same tx so the inner savepoint path stays in scope and
        // agent inserts still flow through the same insert tracker above.
        transaction: async (cb: (innerTx: any) => Promise<any>) => cb(tx),
      };
      return cb(tx);
    },
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{ id: "dept-uuid-1", type: "department", companyId: "c1" }]),
        }),
      }),
    }),
  };

  beforeEach(() => {
    pluginInstalls = []; skillInserts = []; agentInserts = []; teamInserts = []; teamMemberInserts = [];
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes("team.json")) {
        return { ok: true, status: 200, text: async () => TEAM_JSON_BODY };
      }
      if (String(url).includes("agent.json")) {
        // T3.0.5: team-installer now routes through normalizeMarketplaceAgentTemplate,
        // which requires valid agent.v1 JSON (legacy format requires promptTemplate).
        return {
          ok: true, status: 200,
          text: async () => JSON.stringify({
            schemaVersion: "agent.v1",
            id: "aoa-curated/engineer",
            name: "Engineer",
            description: "Senior software engineer",
            instructions: { type: "inline", content: "Build carefully." },
            aoa: {
              adapterType: "claude_local",
              install: { defaultRole: "engineer" },
              skillKeys: [SKILL.id],
            },
          }),
        };
      }
      return { ok: false, status: 404 };
    }) as any;
  });

  it("phase 1: pre-flight validates department exists", async () => {
    const dbNoDept = {
      ...mockDb,
      select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
    };

    await expect(
      installTeam({
        catalogItem: TEAM, catalog: CATALOG, companyId: "c1",
        targetDepartmentId: "missing-dept", db: dbNoDept as any, installPlugin: mockPluginInstaller,
      }),
    ).rejects.toThrow(/department.*not found/i);
  });

  // ── D21: company-wide teams (no parent department) ────────────────────────
  //
  // AoA crew are company-wide singletons — Adjutant serves every department —
  // and nothing creates a department at company-create time, so the crew must
  // be installable before any department exists. `targetDepartmentId: null`
  // means "company-wide": the department pre-flight is skipped entirely and
  // `teams.parent_project_id` is written NULL.

  // Rejects every read so the assertion is "pre-flight never ran", not merely
  // "a lookup happened to succeed". The happy-path mockDb returns a department
  // row for ANY select, so reusing it would let this test pass while the
  // precondition still fired against a null id.
  const dbNoSelectAllowed = {
    ...mockDb,
    select: () => {
      throw new Error("department pre-flight must not run for a company-wide install");
    },
  };

  it("D21: installs a company-wide team when targetDepartmentId is null", async () => {
    const result = await installTeam({
      catalogItem: TEAM, catalog: CATALOG, companyId: "c1",
      targetDepartmentId: null, db: dbNoSelectAllowed as any, installPlugin: mockPluginInstaller,
    });

    expect(teamInserts).toHaveLength(1);
    expect(teamInserts[0].parentProjectId).toBeNull();
    expect(result.teamId).toBeDefined();
  });

  it("D21: installs a company-wide team when targetDepartmentId is omitted", async () => {
    const result = await installTeam({
      catalogItem: TEAM, catalog: CATALOG, companyId: "c1",
      db: dbNoSelectAllowed as any, installPlugin: mockPluginInstaller,
    });

    expect(teamInserts).toHaveLength(1);
    expect(teamInserts[0].parentProjectId).toBeNull();
    expect(result.teamId).toBeDefined();
  });

  it("D21: a supplied-but-wrong-type project is still rejected (never silently nulled)", async () => {
    // A `type: "project"` row is not a department. Relaxing the precondition
    // for null must not degrade validation of a supplied id into a fallback.
    const dbProjectNotDept = {
      ...mockDb,
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([{ id: "proj-uuid-1", type: "project", companyId: "c1" }]),
          }),
        }),
      }),
    };

    await expect(
      installTeam({
        catalogItem: TEAM, catalog: CATALOG, companyId: "c1",
        targetDepartmentId: "proj-uuid-1", db: dbProjectNotDept as any, installPlugin: mockPluginInstaller,
      }),
    ).rejects.toThrow(/department.*not found/i);
    expect(teamInserts).toHaveLength(0);
  });

  it("phase 2: installs all required plugins (idempotent preconditions)", async () => {
    await installTeam({
      catalogItem: TEAM, catalog: CATALOG, companyId: "c1",
      targetDepartmentId: "dept-uuid-1", db: mockDb as any, installPlugin: mockPluginInstaller,
    });

    expect(pluginInstalls).toHaveLength(1);
    expect(pluginInstalls[0].catalogItem.id).toBe(PLUGIN.id);
  });

  it("phase 3: atomic txn inserts team + skills + agents + team_members", async () => {
    const result = await installTeam({
      catalogItem: TEAM, catalog: CATALOG, companyId: "c1",
      targetDepartmentId: "dept-uuid-1", db: mockDb as any, installPlugin: mockPluginInstaller,
    });

    expect(skillInserts.length).toBeGreaterThanOrEqual(1);
    // Skills use sourceType="catalog" + trustLevel="markdown_only" (M.2.C corrections)
    expect(skillInserts[0].sourceType).toBe("catalog");
    expect(skillInserts[0].trustLevel).toBe("markdown_only");
    expect(skillInserts[0].metadata.catalogTrustTier).toBe("verified");

    expect(agentInserts.length).toBe(2);
    expect(teamInserts).toHaveLength(1);
    expect(teamInserts[0].templateOrigin).toBe(TEAM.id);
    expect(teamInserts[0].templateVersion).toBe("1.0.0");
    expect(teamInserts[0].parentProjectId).toBe("dept-uuid-1");
    expect(result.teamId).toBeDefined();
    expect(result.cascadeResults.length).toBeGreaterThanOrEqual(4);

    // team_members link rows: one per agent, first is lead
    expect(teamMemberInserts).toHaveLength(2);
    expect(teamMemberInserts[0].role).toBe("lead");
    expect(teamMemberInserts[1].role).toBe("member");
    for (const tm of teamMemberInserts) {
      expect(tm.teamId).toBeDefined();
      expect(tm.agentId).toBeDefined();
    }
  });

  it("if phase 3 fails, plugin from phase 2 remains (Saga semantics)", async () => {
    const dbThatFailsTxn = {
      ...mockDb,
      transaction: async (_cb: any) => { throw new Error("DB error during team insert"); },
    };

    await expect(
      installTeam({
        catalogItem: TEAM, catalog: CATALOG, companyId: "c1",
        targetDepartmentId: "dept-uuid-1", db: dbThatFailsTxn as any, installPlugin: mockPluginInstaller,
      }),
    ).rejects.toThrow(/DB error/);

    // Plugin install was called BEFORE the txn failed — it stays
    expect(pluginInstalls).toHaveLength(1);
  });

  it("phase 3: skips skill install if skill already exists, completes rest of install", async () => {
    let skillOnConflictCalled = false;

    // mockDbSkillExists has its own local insert-tracking arrays (localAgentInserts etc.)
    // that intentionally shadow the outer beforeEach arrays. This keeps the happy-path
    // arrays clean. Assertions in this test use result.cascadeResults directly, not the
    // outer arrays, to avoid confusion.
    const mockDbSkillExists = {
      ...mockDb,
      transaction: async (cb: (tx: any) => Promise<any>) => {
        const localAgentInserts: any[] = [];
        const localTeamInserts: any[] = [];
        const localTeamMemberInserts: any[] = [];

        const tx = {
          insert: (_table: any) => ({
            values: (row: any) => {
              const isSkill = row.markdown !== undefined;
              if (!isSkill) {
                if (row.adapterType !== undefined || row.skillKeys !== undefined) localAgentInserts.push(row);
                else if (row.parentProjectId !== undefined || row.manifest !== undefined) localTeamInserts.push(row);
                else if (row.teamId !== undefined && row.agentId !== undefined) localTeamMemberInserts.push(row);
                const id = `${localAgentInserts.length + localTeamInserts.length + localTeamMemberInserts.length}-uuid`;
                return {
                  onConflictDoNothing: () => ({ returning: (_cols?: any) => Promise.resolve([{ id }]) }),
                  returning: () => Promise.resolve([{ ...row, id }]),
                };
              }
              // Skill — simulate unique conflict (already installed)
              skillOnConflictCalled = true;
              return {
                onConflictDoNothing: () => ({
                  returning: (_cols?: any) => Promise.resolve([]), // empty = conflict
                }),
              };
            },
          }),
          select: () => ({
            from: () => ({
              where: () =>
                Object.assign(Promise.resolve([]), {
                  limit: (_n: number) => Promise.resolve([{ id: "existing-skill-uuid" }]),
                }),
            }),
          }),
          // T3.0.5: createMarketplaceAgent calls db.transaction() inside the outer txn
          transaction: async (cb2: (innerTx: any) => Promise<any>) => cb2(tx),
        };
        return cb(tx);
      },
    };

    const result = await installTeam({
      catalogItem: TEAM,
      catalog: CATALOG,
      companyId: "c1",
      targetDepartmentId: "dept-uuid-1",
      db: mockDbSkillExists as any,
      installPlugin: mockPluginInstaller,
    });

    // onConflictDoNothing was invoked for the skill insert
    expect(skillOnConflictCalled).toBe(true);

    // Cascade result for the skill must be "skipped" with the existing skill's id
    const skillResult = result.cascadeResults.find((r) => r.step === "skill-install");
    expect(skillResult).toBeDefined();
    expect(skillResult?.status).toBe("skipped");
    expect(skillResult?.resultEntityId).toBe("existing-skill-uuid");

    // Team was still created despite the skipped skill
    expect(result.teamId).toBeDefined();
  });
});
