/**
 * @fileoverview Idempotent default skill seeder for Commander agents.
 *
 * Reads the catalog skill IDs from onboarding-assets/commander/default-skills.json
 * and installs each one into the company's company_skills table if not already
 * present. Safe to call multiple times — skips skills that are already installed
 * at any version. Failures are non-fatal: a missing catalog or unavailable
 * network must not block Commander provisioning.
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { eq, and } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { companySkills, marketplaceCatalogCache } from "@armyofagents/db";
import {
  MarketplaceCatalogFileSchema,
  isSchemaVersionSupported,
  type CatalogItem,
} from "@armyofagents/shared";
import { installSkill } from "./skill-installer.js";
import { logger } from "../../middleware/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface DefaultSkillsConfig {
  _comment?: string;
  skills: string[]; // catalog item IDs
}

/**
 * Read the default-skills.json config. Returns null if missing or malformed.
 */
function readDefaultSkillsConfig(): DefaultSkillsConfig | null {
  const configPath = join(
    __dirname,
    "../../onboarding-assets/commander/default-skills.json",
  );
  try {
    return JSON.parse(readFileSync(configPath, "utf-8")) as DefaultSkillsConfig;
  } catch {
    return null;
  }
}

/**
 * Read the cached marketplace catalog from the DB.
 * Returns null if no catalog has been cached yet or if validation fails.
 */
async function readCachedCatalog(db: Db): Promise<CatalogItem[] | null> {
  try {
    const rows = await db
      .select()
      .from(marketplaceCatalogCache)
      .where(eq(marketplaceCatalogCache.id, 1))
      .limit(1);

    if (rows.length === 0) return null;
    const row = rows[0];

    const candidate = {
      schemaVersion: row.schemaVersion,
      generatedAt: row.generatedAt.toISOString(),
      itemCount: row.itemCount,
      items: (row.catalogJson as { items?: unknown }).items ?? [],
    };

    const parsed = MarketplaceCatalogFileSchema.safeParse(candidate);
    if (!parsed.success) return null;
    if (!isSchemaVersionSupported(parsed.data.schemaVersion)) return null;

    return parsed.data.items;
  } catch {
    return null;
  }
}

/**
 * Idempotently seed default Commander skills for a company.
 *
 * - Reads skill IDs from default-skills.json.
 * - Looks each up in the cached catalog.
 * - Installs if not already present in company_skills (keyed by catalogItem.id).
 * - Skips gracefully if: config missing, catalog not cached, skill not in catalog,
 *   or network fetch fails. Never throws — failures are logged only.
 */
export async function seedDefaultCommanderSkills(params: {
  db: Db;
  companyId: string;
}): Promise<void> {
  const { db, companyId } = params;

  const config = readDefaultSkillsConfig();
  if (!config || !Array.isArray(config.skills) || config.skills.length === 0) {
    return;
  }

  const catalogItems = await readCachedCatalog(db);
  if (!catalogItems) {
    logger.warn(
      { companyId },
      "default-skill-seeder: catalog not cached — skipping default skill seeding",
    );
    return;
  }

  const catalogById = new Map<string, CatalogItem>(
    catalogItems.map((item) => [item.id, item]),
  );

  for (const catalogItemId of config.skills) {
    try {
      // Idempotency check: is any version of this skill already installed?
      // The key in company_skills equals the catalogItem.id (see skill-installer.ts).
      const existing = await db
        .select({ id: companySkills.id })
        .from(companySkills)
        .where(
          and(
            eq(companySkills.companyId, companyId),
            eq(companySkills.key, catalogItemId),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        // Already installed at some version — skip (idempotent).
        continue;
      }

      const catalogItem = catalogById.get(catalogItemId);
      if (!catalogItem) {
        logger.warn(
          { companyId, catalogItemId },
          "default-skill-seeder: catalog item not found — skipping",
        );
        continue;
      }

      if (catalogItem.type !== "skill") {
        logger.warn(
          { companyId, catalogItemId, type: catalogItem.type },
          "default-skill-seeder: item is not a skill — skipping",
        );
        continue;
      }

      await installSkill({ catalogItem, companyId, db });

      logger.info(
        { companyId, catalogItemId },
        "default-skill-seeder: installed default skill",
      );
    } catch (err) {
      // Non-fatal: log and continue to the next skill.
      logger.error(
        { companyId, catalogItemId, err },
        "default-skill-seeder: failed to install default skill — skipping",
      );
    }
  }
}
