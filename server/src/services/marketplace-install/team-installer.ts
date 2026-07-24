import { eq, and } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { teams, teamMembers, companySkills, projects } from "@armyofagents/db";
import type { CascadeStepResult } from "@armyofagents/db";
import type { CatalogItem, MarketplaceCatalogFile } from "@armyofagents/shared";
import { fetchCatalogResource } from "./fetch-resource.js";
import type { NormalizedMarketplaceAgentTemplate } from "./types.js";
import { parseMarketplaceAgentTemplate, normalizeMarketplaceAgentTemplate } from "./agent-runtime.js";
import { createMarketplaceAgent } from "./agent-create.js";
import { resolveAgentNameConflict, resolveTeamSlugConflict } from "./conflict-resolver.js";

export interface InstallTeamOpts {
  catalogItem: CatalogItem;            // type='team'
  catalog: MarketplaceCatalogFile;     // for resolving requires
  companyId: string;
  /**
   * Department to parent the team under. `null`/absent = a company-wide team
   * (D21) — used by the internal crew bootstrap, which runs before any
   * department exists. The public install route still requires one for
   * founder-initiated team installs (marketplace-installs.ts).
   */
  targetDepartmentId?: string | null;
  db: Db;
  installPlugin: PluginInstallerFn;    // injected to break circular dep
  /**
   * Caller deadline for the whole install. Every resource fetch is chained to
   * it, and it is re-checked before each phase, so an install cannot outrun the
   * caller's budget. Absent = unbounded (the existing 202-accepted route path).
   */
  signal?: AbortSignal;
  /**
   * How many resource fetches to run at once during pre-flight. Defaults to 1
   * (sequential — the historical behaviour) so the public install route is
   * unchanged; the company-create bootstrap opts up, because it is the caller
   * that pays the latency synchronously.
   */
  fetchConcurrency?: number;
}

/**
 * Run `worker` over `items` with at most `limit` in flight. Rejects with the
 * first error (remaining in-flight requests are left to settle and ignored;
 * the caller's abort signal is what actually stops them).
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const width = Math.max(1, Math.min(limit, items.length));
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function run(): Promise<void> {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: width }, run));
  return results;
}

function assertNotAborted(signal: AbortSignal | undefined, phase: string): void {
  if (signal?.aborted) {
    throw new Error(`Team install exceeded its deadline before ${phase}`);
  }
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
 *   - Validate target department exists and belongs to company (skipped when
 *     no department is supplied — that installs a company-wide team, D21)
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
  const { catalogItem, catalog, companyId, targetDepartmentId, db, installPlugin, signal } = opts;
  const fetchConcurrency = opts.fetchConcurrency ?? 1;

  if (catalogItem.type !== "team") {
    throw new Error(`installTeam called with non-team item: ${catalogItem.id}`);
  }

  const cascadeResults: CascadeStepResult[] = [];
  const itemsById = new Map(catalog.items.map((i) => [i.id, i]));
  const installedAt = new Date().toISOString();

  // ====== Phase 1: Pre-flight ======
  const phase1Start = Date.now();

  // 1a: Target department exists? Skipped entirely for a company-wide install
  // (D21) — there is nothing to validate. When an id IS supplied it is still
  // fully validated (exists + belongs to this company + is a department); a
  // bad id is an error, never a silent fallback to company-wide.
  const parentProjectId = targetDepartmentId ?? null;
  if (parentProjectId !== null) {
    const dept = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, parentProjectId), eq(projects.companyId, companyId)))
      .limit(1);
    if (dept.length === 0 || dept[0].type !== "department") {
      throw new Error(`Target department not found: ${parentProjectId}`);
    }
  }

  // 1b: Resolve requires
  const requires = catalogItem.requires ?? [];
  for (const req of requires) {
    if (!itemsById.has(req.id)) {
      throw new Error(`Required catalog item not found: ${req.id}`);
    }
  }

  // 1c: Fetch team.json
  assertNotAborted(signal, "the team template fetch");
  const teamBody = JSON.parse(
    await fetchCatalogResource(catalogItem, "team template", signal),
  ) as TeamTemplateBody;

  // 1d: Pre-fetch + normalize all agent.json bodies (fail fast).
  // Uses parseMarketplaceAgentTemplate + normalizeMarketplaceAgentTemplate so
  // both legacy and agent.v1 formats are handled uniformly and createMarketplaceAgent
  // in Phase 3 receives fully-normalized templates instead of raw JSON.
  const requiredAgentItems = requires
    .filter((r) => r.type === "agent")
    .map((r) => itemsById.get(r.id)!)
    .filter(Boolean);
  const normalizedAgentTemplates = new Map<string, NormalizedMarketplaceAgentTemplate>();
  assertNotAborted(signal, "the agent template fetches");
  const normalizedPairs = await mapWithConcurrency(requiredAgentItems, fetchConcurrency, async (a) => {
    const text = await fetchCatalogResource(a, "agent template", signal);
    const parsed = parseMarketplaceAgentTemplate(text, a);
    // availableAdapterTypes=[] — team-installer has no adapter registry context;
    // the check is skipped when the list is empty (see normalizeMarketplaceAgentTemplate).
    const normalized = normalizeMarketplaceAgentTemplate({
      parsed,
      catalogItem: a,
      availableAdapterTypes: [],
    });
    return [a.id, normalized] as const;
  });
  for (const [id, normalized] of normalizedPairs) {
    normalizedAgentTemplates.set(id, normalized);
  }

  // 1e: Pre-fetch skill content (uses inline if available, else helper)
  const requiredSkillItems = requires
    .filter((r) => r.type === "skill")
    .map((r) => itemsById.get(r.id)!)
    .filter(Boolean);
  const skillContents = new Map<string, string>();
  assertNotAborted(signal, "the skill content fetches");
  const skillPairs = await mapWithConcurrency(requiredSkillItems, fetchConcurrency, async (item) => {
    const content = item.content?.inline ?? await fetchCatalogResource(item, "skill content", signal);
    return [item.id, content] as const;
  });
  for (const [id, content] of skillPairs) {
    skillContents.set(id, content);
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
  // Last deadline check. Past this point the work is local DB writes inside one
  // transaction — fast, and aborting midway would only mean a rollback, so the
  // check belongs here rather than inside.
  assertNotAborted(signal, "the team-body transaction");
  const phase3Start = Date.now();
  const teamRow = await db.transaction(async (tx) => {
    // Insert skills — idempotent: skip if the skill is already installed
    for (const skillItem of requiredSkillItems) {
      const slug = skillItem.id.split("/").pop() ?? skillItem.id;
      const insertedRows = await tx
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
        .onConflictDoNothing()
        .returning({ id: companySkills.id });

      if (insertedRows.length === 0) {
        // Skill already installed — look up its id for the cascade record.
        // If the row disappeared between the INSERT conflict and this SELECT (concurrent DELETE),
        // throw so the transaction rolls back rather than recording a misleading skipped entry.
        const [existing] = await tx
          .select({ id: companySkills.id })
          .from(companySkills)
          .where(and(eq(companySkills.companyId, companyId), eq(companySkills.key, skillItem.id)))
          .limit(1);
        if (!existing) {
          throw new Error(`Skill conflict detected but row not found: ${skillItem.id}`);
        }
        cascadeResults.push({
          step: "skill-install",
          itemId: skillItem.id,
          status: "skipped",
          resultEntityId: existing.id,
          durationMs: 0,
        });
      } else {
        cascadeResults.push({
          step: "skill-install",
          itemId: skillItem.id,
          status: "success",
          resultEntityId: insertedRows[0].id,
          durationMs: 0,
        });
      }
    }

    // Insert agents (one per entry in team.json's agents array).
    // Routes through createMarketplaceAgent so kind, triggers, templateOrigin,
    // and templateVersion are set via the canonical install path.
    // Passing tx (cast to Db) creates a Drizzle savepoint inside the outer txn.
    const agentInsertResults: Array<{ id: string; templateOrigin: string }> = [];
    for (const teamAgent of teamBody.agents) {
      const normalized = normalizedAgentTemplates.get(teamAgent.templateOrigin);
      if (!normalized) {
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
      // No instructionsService passed: team-installer does not materialize
      // instruction bundles during install (they are materialized on first
      // agent run via the adapter's lazy-load path, or via a follow-up update).
      const { agentId } = await createMarketplaceAgent({
        catalogItem: agentItem,
        companyId,
        db: tx as unknown as Db,
        desiredName: resolvedAgentName,
        template: normalized,
      });
      agentInsertResults.push({ id: agentId, templateOrigin: teamAgent.templateOrigin });
      cascadeResults.push({
        step: "agent-install",
        itemId: teamAgent.templateOrigin,
        status: "success",
        resultEntityId: agentId,
        durationMs: 0,
      });
    }

    // A team row with no agents is not a crew — and it is a permanent trap.
    // `TeamTemplateBody` is an unchecked JSON.parse cast, so a published
    // team.json shipping `"agents": []` (or the field renamed and defaulted)
    // would commit the `teams` row with zero members, return success, and make
    // `crewTeamIsInstalled` true forever: no crew agents, legacy seeders
    // permanently suppressed, repair permanently short-circuited.
    //
    // `undefined` is already safe (the for…of above throws and rolls back);
    // `[]` is the hole. This is a CROSS-REPO trigger — the catalog lives in
    // MeteoriteLabs/aoa-marketplace — so it must fail closed here.
    if (agentInsertResults.length === 0) {
      throw new Error(
        `team.json for ${catalogItem.id} declared no agents — refusing to install an empty team`,
      );
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
        parentProjectId,
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
