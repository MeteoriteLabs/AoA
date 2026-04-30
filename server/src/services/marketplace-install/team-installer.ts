import { eq, and } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { teams, teamMembers, agents, companySkills, projects } from "@armyofagents/db";
import type { CascadeStepResult } from "@armyofagents/db";
import type { CatalogItem, MarketplaceCatalogFile } from "@armyofagents/shared";
import { fetchCatalogResource } from "./fetch-resource.js";
import type { AgentTemplateBody } from "./types.js";
import { resolveAgentNameConflict, resolveTeamSlugConflict } from "./conflict-resolver.js";

export interface InstallTeamOpts {
  catalogItem: CatalogItem;            // type='team'
  catalog: MarketplaceCatalogFile;     // for resolving requires
  companyId: string;
  targetDepartmentId: string;          // required for team installs (M2.D8)
  db: Db;
  installPlugin: PluginInstallerFn;    // injected to break circular dep
}

export type PluginInstallerFn = (opts: {
  catalogItem: CatalogItem;
  companyId: string;
  db: Db;
}) => Promise<{ pluginId: string; alreadyInstalled: boolean }>;

export interface InstallTeamResult {
  teamId: string;
  cascadeResults: CascadeStepResult[];
}

interface TeamTemplateBody {
  slug: string;
  description?: string;
  manifest?: Record<string, unknown>;
  agents: Array<{ templateOrigin: string; name: string; overrides?: Record<string, unknown> }>;
}

/**
 * Install a team catalog item via Saga pattern (3 phases).
 *
 * **Phase 1 — Pre-flight (no writes):**
 *   - Validate target department exists and belongs to company
 *   - Validate all required catalog items resolve in the catalog
 *   - Fetch + parse team.json + each required agent.json + skill content
 *
 * **Phase 2 — Plugin preconditions (writes, idempotent):**
 *   - For each required plugin, call installPlugin (no-op if already installed)
 *   - Plugins are NEVER auto-uninstalled if subsequent phases fail (M2.D7)
 *
 * **Phase 3 — Atomic team body (single Postgres txn):**
 *   - Insert each required skill row
 *   - Insert each agent row (one per agent in team.json)
 *   - Insert team row + team_members links (first agent = lead)
 *   - All-or-nothing — txn rollback on any error
 *
 * Marketplace skills/agents use sourceType="catalog" (existing in CompanySkillSourceType)
 * and trustLevel="markdown_only" (existing in CompanySkillTrustLevel). Catalog tier
 * goes in metadata.catalogTrustTier.
 *
 * @throws Error from any phase. Plugins from phase 2 remain on phase 3 failure.
 */
export async function installTeam(opts: InstallTeamOpts): Promise<InstallTeamResult> {
  const { catalogItem, catalog, companyId, targetDepartmentId, db, installPlugin } = opts;

  if (catalogItem.type !== "team") {
    throw new Error(`installTeam called with non-team item: ${catalogItem.id}`);
  }

  const cascadeResults: CascadeStepResult[] = [];
  const itemsById = new Map(catalog.items.map((i) => [i.id, i]));
  const installedAt = new Date().toISOString();

  // ====== Phase 1: Pre-flight ======
  const phase1Start = Date.now();

  // 1a: Target department exists?
  const dept = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, targetDepartmentId), eq(projects.companyId, companyId)))
    .limit(1);
  if (dept.length === 0 || dept[0].type !== "department") {
    throw new Error(`Target department not found: ${targetDepartmentId}`);
  }

  // 1b: Resolve requires
  const requires = catalogItem.requires ?? [];
  for (const req of requires) {
    if (!itemsById.has(req.id)) {
      throw new Error(`Required catalog item not found: ${req.id}`);
    }
  }

  // 1c: Fetch team.json
  const teamBody = JSON.parse(await fetchCatalogResource(catalogItem, "team template")) as TeamTemplateBody;

  // 1d: Pre-fetch all agent.json bodies (fail fast)
  const requiredAgentItems = requires
    .filter((r) => r.type === "agent")
    .map((r) => itemsById.get(r.id)!)
    .filter(Boolean);
  const agentBodies = new Map<string, AgentTemplateBody>();
  for (const a of requiredAgentItems) {
    const text = await fetchCatalogResource(a, "agent template");
    agentBodies.set(a.id, JSON.parse(text) as AgentTemplateBody);
  }

  // 1e: Pre-fetch skill content (uses inline if available, else helper)
  const requiredSkillItems = requires
    .filter((r) => r.type === "skill")
    .map((r) => itemsById.get(r.id)!)
    .filter(Boolean);
  const skillContents = new Map<string, string>();
  for (const s of requiredSkillItems) {
    skillContents.set(s.id, s.content?.inline ?? await fetchCatalogResource(s, "skill content"));
  }

  cascadeResults.push({
    step: "preflight",
    itemId: catalogItem.id,
    status: "success",
    durationMs: Date.now() - phase1Start,
  });

  // ====== Phase 2: Plugin preconditions ======
  const requiredPluginItems = requires
    .filter((r) => r.type === "plugin")
    .map((r) => itemsById.get(r.id)!)
    .filter(Boolean);

  for (const p of requiredPluginItems) {
    const phase2Start = Date.now();
    try {
      const result = await installPlugin({ catalogItem: p, companyId, db });
      cascadeResults.push({
        step: "plugin-precondition",
        itemId: p.id,
        status: "success",
        resultEntityId: result.pluginId,
        durationMs: Date.now() - phase2Start,
      });
    } catch (err) {
      cascadeResults.push({
        step: "plugin-precondition",
        itemId: p.id,
        status: "failure",
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - phase2Start,
      });
      throw err;
    }
  }

  // ====== Phase 3: Atomic team body (single Postgres txn) ======
  const phase3Start = Date.now();
  const teamRow = await db.transaction(async (tx) => {
    // Insert skills (M.2.C corrected fields: sourceType="catalog", trustLevel="markdown_only")
    for (const skillItem of requiredSkillItems) {
      const slug = skillItem.id.split("/").pop() ?? skillItem.id;
      const inserted = await tx
        .insert(companySkills)
        .values({
          companyId,
          key: skillItem.id,
          slug,
          name: skillItem.name,
          description: skillItem.description,
          markdown: skillContents.get(skillItem.id)!,
          sourceType: "catalog",
          sourceLocator: skillItem.id,
          sourceRef: skillItem.version,
          trustLevel: "markdown_only",
          compatibility: "compatible",
          fileInventory: [],
          metadata: {
            catalogCategory: skillItem.category,
            catalogTags: skillItem.tags,
            catalogTrustTier: skillItem.trust.tier,
            installedAt,
          },
        })
        .returning();
      cascadeResults.push({
        step: "skill-install",
        itemId: skillItem.id,
        status: "success",
        resultEntityId: inserted[0].id,
        durationMs: 0,
      });
    }

    // Insert agents (one per entry in team.json's agents array)
    const agentInsertResults: Array<{ id: string; templateOrigin: string }> = [];
    for (const teamAgent of teamBody.agents) {
      const template = agentBodies.get(teamAgent.templateOrigin);
      if (!template) {
        throw new Error(`team.json references unknown agent template: ${teamAgent.templateOrigin}`);
      }
      const agentItem = itemsById.get(teamAgent.templateOrigin);
      if (!agentItem) {
        throw new Error(`team.json references catalog agent not in catalog: ${teamAgent.templateOrigin}`);
      }
      const resolvedAgentName = await resolveAgentNameConflict({
        db: tx as unknown as Db,
        companyId,
        desiredName: teamAgent.name,
      });
      const inserted = await tx
        .insert(agents)
        .values({
          companyId,
          name: resolvedAgentName,
          role: template.role ?? "general",
          title: template.title,
          icon: template.icon,
          status: "idle",
          capabilities: template.capabilities,
          adapterType: template.adapterType ?? "process",
          adapterConfig: template.adapterConfig ?? {},
          runtimeConfig: template.runtimeConfig ?? {},
          permissions: template.permissions ?? {},
          budgetMonthlyCents: template.budgetMonthlyCents ?? 0,
          skillKeys: template.skillKeys ?? [],
          templateOrigin: teamAgent.templateOrigin,
          templateVersion: agentItem.version,
          metadata: {
            catalogCategory: agentItem.category,
            catalogTags: agentItem.tags,
            catalogTrustTier: agentItem.trust.tier,
            installedAt,
          },
        })
        .returning();
      agentInsertResults.push({ id: inserted[0].id, templateOrigin: teamAgent.templateOrigin });
      cascadeResults.push({
        step: "agent-install",
        itemId: teamAgent.templateOrigin,
        status: "success",
        resultEntityId: inserted[0].id,
        durationMs: 0,
      });
    }

    // Insert team row
    const resolvedSlug = await resolveTeamSlugConflict({
      db: tx as unknown as Db,
      companyId,
      desiredSlug: teamBody.slug,
    });
    const teamInserted = await tx
      .insert(teams)
      .values({
        companyId,
        parentProjectId: targetDepartmentId,
        name: catalogItem.name,
        slug: resolvedSlug,
        description: teamBody.description ?? catalogItem.description,
        manifest: teamBody.manifest ?? {},
        templateOrigin: catalogItem.id,
        templateVersion: catalogItem.version,
      })
      .returning();

    // Link agents to team via team_members. First inserted agent is "lead",
    // remainder are "member". Satisfies team_members_one_lead_uq partial unique.
    for (let idx = 0; idx < agentInsertResults.length; idx++) {
      await tx
        .insert(teamMembers)
        .values({
          teamId: teamInserted[0].id,
          agentId: agentInsertResults[idx].id,
          role: idx === 0 ? "lead" : "member",
        });
    }

    cascadeResults.push({
      step: "team-body-txn",
      itemId: catalogItem.id,
      status: "success",
      resultEntityId: teamInserted[0].id,
      durationMs: Date.now() - phase3Start,
    });

    return teamInserted[0];
  });

  return { teamId: teamRow.id, cascadeResults };
}
