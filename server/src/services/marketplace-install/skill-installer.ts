import type { Db } from "@armyofagents/db";
import { companySkills } from "@armyofagents/db";
import type { CatalogItem } from "@armyofagents/shared";

const FETCH_TIMEOUT_MS = 30_000;

export interface InstallSkillOpts {
  catalogItem: CatalogItem;
  companyId: string;
  db: Db;
}

export interface InstallSkillResult {
  skillId: string;
  alreadyExisted: false;
}

/**
 * Install a skill catalog item into a company's company_skills table.
 *
 * - Uses inline content if present (faster, no network).
 * - Falls back to HTTP GET on resourceUrl (commit-pinned by aggregator).
 * - Stores sourceType=marketplace, sourceLocator=catalogItemId, sourceRef=version
 *   so future updates and idempotency checks can find the row.
 *
 * Idempotency check (whether a skill is already installed) belongs in the
 * orchestrator, not here. This function blindly inserts; caller must
 * check first.
 *
 * @throws Error if neither inline content nor resourceUrl is present, or HTTP fetch fails.
 */
export async function installSkill(opts: InstallSkillOpts): Promise<InstallSkillResult> {
  const { catalogItem, companyId, db } = opts;

  if (catalogItem.type !== "skill") {
    throw new Error(`installSkill called with non-skill item: ${catalogItem.id} (type=${catalogItem.type})`);
  }

  const markdown = await loadSkillContent(catalogItem);

  const slug = catalogItem.id.split("/").pop() ?? catalogItem.id;
  const key = catalogItem.id;  // catalog ID doubles as the unique skill key

  const inserted = await db
    .insert(companySkills)
    .values({
      companyId,
      key,
      slug,
      name: catalogItem.name,
      description: catalogItem.description,
      markdown,
      sourceType: "marketplace",
      sourceLocator: catalogItem.id,
      sourceRef: catalogItem.version,
      trustLevel: catalogItem.trust.tier === "verified" ? "verified" : "markdown_only",
      compatibility: "compatible",
      fileInventory: [],
      metadata: {
        catalogCategory: catalogItem.category,
        catalogTags: catalogItem.tags,
        installedAt: new Date().toISOString(),
      },
    })
    .returning();

  return { skillId: inserted[0].id, alreadyExisted: false };
}

async function loadSkillContent(item: CatalogItem): Promise<string> {
  if (item.content?.inline) {
    return item.content.inline;
  }
  if (!item.resourceUrl) {
    throw new Error(`Skill ${item.id} has no content source (neither inline nor resourceUrl)`);
  }
  const res = await fetch(item.resourceUrl, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch skill content: HTTP ${res.status} from ${item.resourceUrl}`);
  }
  return await res.text();
}
