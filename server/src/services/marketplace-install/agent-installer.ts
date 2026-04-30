import type { Db } from "@armyofagents/db";
import { agents } from "@armyofagents/db";
import type { CatalogItem } from "@armyofagents/shared";

const FETCH_TIMEOUT_MS = 30_000;

export interface InstallAgentOpts {
  catalogItem: CatalogItem;
  companyId: string;
  db: Db;
  desiredName: string;     // post-conflict-resolution name (caller handles auto-suffix)
}

export interface InstallAgentResult {
  agentId: string;
}

interface AgentTemplateBody {
  role?: string;
  title?: string;
  icon?: string;
  adapterType?: string;
  adapterConfig?: Record<string, unknown>;
  runtimeConfig?: Record<string, unknown>;
  permissions?: Record<string, unknown>;
  skillKeys?: string[];
  capabilities?: string;
  budgetMonthlyCents?: number;
}

/**
 * Install an agent catalog item into a company's agents table.
 *
 * Fetches the agent.json from resourceUrl (commit-pinned), parses it,
 * and writes a new agents row with templateOrigin = catalogItemId,
 * templateVersion = catalog version.
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
  if (!catalogItem.resourceUrl) {
    throw new Error(`Agent ${catalogItem.id} has no resourceUrl`);
  }

  const res = await fetch(catalogItem.resourceUrl, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch agent template: HTTP ${res.status} from ${catalogItem.resourceUrl}`);
  }
  const bodyText = await res.text();
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
      capabilities: template.capabilities ?? null,
      adapterType: template.adapterType ?? "process",
      adapterConfig: template.adapterConfig ?? {},
      runtimeConfig: template.runtimeConfig ?? {},
      permissions: template.permissions ?? {},
      budgetMonthlyCents: template.budgetMonthlyCents ?? 0,
      skillKeys: template.skillKeys ?? [],
      templateOrigin: catalogItem.id,
      templateVersion: catalogItem.version,
    })
    .returning();

  return { agentId: inserted[0].id };
}
