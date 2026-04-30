import type { Db } from "@armyofagents/db";
import { agents } from "@armyofagents/db";
import type { CatalogItem } from "@armyofagents/shared";
import { fetchCatalogResource } from "./fetch-resource.js";
import type { AgentTemplateBody } from "./types.js";

export interface InstallAgentOpts {
  catalogItem: CatalogItem;
  companyId: string;
  db: Db;
  desiredName: string;     // post-conflict-resolution name (caller handles auto-suffix)
}

export interface InstallAgentResult {
  agentId: string;
}

/**
 * Install an agent catalog item into a company's agents table.
 *
 * Fetches the agent.json from resourceUrl (commit-pinned), parses it,
 * and writes a new agents row with templateOrigin = catalogItemId,
 * templateVersion = catalog version.
 *
 * **Hire-approval gate:** This installer creates the agent in `status: "idle"`
 * (immediately active), bypassing the standard `requireBoardApprovalForNewAgents`
 * flow used by POST /agents. This is intentional for V1 marketplace installs:
 * the user explicitly clicked Install (which itself requires board auth), so
 * the install action serves as the approval. Cascading team installs follow
 * the same convention. If this becomes a concern, the orchestrator can be
 * enhanced to honor the gate per-company in V1.x.
 *
 * The `db` argument may be a transaction handle. The function performs a
 * single insert and is safe to call inside a parent transaction.
 *
 * Required skills (catalogItem.requires of type 'skill') are NOT installed
 * here — the orchestrator/team-installer is responsible for skill cascade.
 *
 * @throws Error if resourceUrl missing, fetch fails, or body is invalid JSON.
 */
export async function installAgent(opts: InstallAgentOpts): Promise<InstallAgentResult> {
  const { catalogItem, companyId, db, desiredName } = opts;

  if (catalogItem.type !== "agent") {
    throw new Error(`installAgent called with non-agent item: ${catalogItem.id}`);
  }

  const bodyText = await fetchCatalogResource(catalogItem, "agent template");
  let template: AgentTemplateBody;
  try {
    template = JSON.parse(bodyText) as AgentTemplateBody;
  } catch (err) {
    throw new Error(`Failed to parse agent template JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  const inserted = await db
    .insert(agents)
    .values({
      companyId,
      name: desiredName,
      role: template.role ?? "general",
      title: template.title,
      icon: template.icon,
      status: "idle",
      capabilities: template.capabilities,  // schema column is nullable; undefined → null
      adapterType: template.adapterType ?? "process",
      adapterConfig: template.adapterConfig ?? {},
      runtimeConfig: template.runtimeConfig ?? {},
      permissions: template.permissions ?? {},
      budgetMonthlyCents: template.budgetMonthlyCents ?? 0,
      skillKeys: template.skillKeys ?? [],
      templateOrigin: catalogItem.id,
      templateVersion: catalogItem.version,
      metadata: {
        catalogCategory: catalogItem.category,
        catalogTags: catalogItem.tags,
        catalogTrustTier: catalogItem.trust.tier,
        installedAt: new Date().toISOString(),
      },
    })
    .returning();

  return { agentId: inserted[0].id };
}
