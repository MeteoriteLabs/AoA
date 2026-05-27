import { and, eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { agents, aoaAgentTriggers, marketplacePendingUpdates } from "@armyofagents/db";
import type { CatalogItem, MarketplaceSettings } from "@armyofagents/shared";
import { fetchCatalogResource } from "./fetch-resource.js";
import { parseMarketplaceAgentTemplate, normalizeMarketplaceAgentTemplate } from "./agent-runtime.js";
import { loadMarketplaceInstructionFiles } from "./agent-create.js";
import type { AgentInstructionsServiceLike } from "./agent-create.js";
import { marketplaceNotifications } from "../marketplace-notifications.js";
import { isWithinUpdateWindow } from "./skill-auto-updater.js";
import { logger } from "../../middleware/logger.js";

export interface CrewAgentRow {
  id: string;
  companyId: string;
  name: string;
  adapterType: string;
  adapterConfig: Record<string, unknown> | null;
  runtimeConfig: Record<string, unknown> | null;
  skillKeys: string[];
  templateVersion: string | null;
}

/**
 * Apply a full-replacement update to a single crew agent.
 *
 * DESIGN DECISION: instruction files are app code, not user config.
 * replaceExisting: true → ALL files replaced (no preservation of edits).
 * Also replaces: skillKeys, runtimeConfig.aoa.toolAllowlist, templateVersion.
 * Triggers are replaced (DELETE + re-INSERT) from catalog definition.
 */
export async function applyCrewAgentUpdate(opts: {
  db: Db;
  agentRow: CrewAgentRow;
  catalogItem: CatalogItem;
  instructionsService: AgentInstructionsServiceLike;
}): Promise<void> {
  const { db, agentRow, catalogItem, instructionsService } = opts;

  const bodyText = await fetchCatalogResource(catalogItem, "agent template for update");
  const parsed = parseMarketplaceAgentTemplate(bodyText, catalogItem);
  const template = normalizeMarketplaceAgentTemplate({ parsed, catalogItem, availableAdapterTypes: [] });
  const instructionFiles = await loadMarketplaceInstructionFiles(catalogItem, template);

  const agentForMaterialize = {
    id: agentRow.id,
    companyId: agentRow.companyId,
    name: agentRow.name,
    role: "general",
    adapterType: agentRow.adapterType,
    adapterConfig: agentRow.adapterConfig,
  };

  const materialized = instructionFiles
    ? await instructionsService.materializeManagedBundle(
        agentForMaterialize,
        instructionFiles.files,
        {
          entryFile: instructionFiles.entryFile,
          replaceExisting: true,
          clearLegacyPromptTemplate: true,
        },
      )
    : null;

  // Merge new toolAllowlist into runtimeConfig.aoa (replace, not merge)
  const existingRc = agentRow.runtimeConfig ?? {};
  const existingAoa = (existingRc.aoa as Record<string, unknown>) ?? {};
  const newAoa = (template.runtimeConfig?.aoa as Record<string, unknown>) ?? {};
  const updatedRc = {
    ...existingRc,
    aoa: {
      ...existingAoa,
      ...(newAoa.toolAllowlist !== undefined ? { toolAllowlist: newAoa.toolAllowlist } : {}),
    },
  };

  await db.transaction(async (tx) => {
    await tx
      .update(agents)
      .set({
        skillKeys: template.skillKeys,
        runtimeConfig: updatedRc,
        templateVersion: catalogItem.version,
        ...(materialized ? { adapterConfig: materialized.adapterConfig } : {}),
        updatedAt: new Date(),
      })
      .where(eq(agents.id, agentRow.id));

    // Replace triggers: delete existing, re-insert from catalog
    await tx.delete(aoaAgentTriggers).where(eq(aoaAgentTriggers.agentId, agentRow.id));
    for (const trigger of template.triggers ?? []) {
      await tx.insert(aoaAgentTriggers).values({
        companyId: agentRow.companyId,
        agentId: agentRow.id,
        kind: trigger.kind,
        enabled: true,
        config: trigger.config,
      });
    }

    // Mark pending update as applied
    await tx
      .update(marketplacePendingUpdates)
      .set({ status: "applied", updatedAt: new Date() })
      .where(
        and(
          eq(marketplacePendingUpdates.companyId, agentRow.companyId),
          eq(marketplacePendingUpdates.catalogItemId, catalogItem.id),
          eq(marketplacePendingUpdates.status, "pending"),
        ),
      );
  });

  logger.info(
    { agentId: agentRow.id, catalogItemId: catalogItem.id, version: catalogItem.version },
    "marketplace: crew agent update applied",
  );
}

/**
 * Check all installed crew agents against the catalog for new versions.
 * auto policy + within window → apply immediately (silent, no notification).
 * notify policy or outside window → record pending_update + updateAvailable notification.
 */
export async function checkCrewUpdates(opts: {
  db: Db;
  companyId: string;
  catalogItems: CatalogItem[];
  settings: MarketplaceSettings;
  instructionsService: AgentInstructionsServiceLike;
}): Promise<void> {
  const { db, companyId, catalogItems, settings, instructionsService } = opts;
  const catalogById = new Map(catalogItems.map((item) => [item.id, item]));

  const crewAgents = await db
    .select({
      id: agents.id,
      name: agents.name,
      adapterType: agents.adapterType,
      adapterConfig: agents.adapterConfig,
      runtimeConfig: agents.runtimeConfig,
      skillKeys: agents.skillKeys,
      templateOrigin: agents.templateOrigin,
      templateVersion: agents.templateVersion,
    })
    .from(agents)
    .where(and(eq(agents.companyId, companyId), eq(agents.kind, "aoa")));

  for (const agent of crewAgents) {
    if (!agent.templateOrigin || agent.templateOrigin.endsWith("@legacy")) continue;
    if (!agent.templateVersion) continue;

    const catalogItem = catalogById.get(agent.templateOrigin);
    if (!catalogItem) continue;
    if (catalogItem.version === agent.templateVersion) continue;

    const autoApply =
      settings.agentUpdatePolicy === "auto" && isWithinUpdateWindow(settings.updateWindow);

    if (autoApply) {
      try {
        await applyCrewAgentUpdate({
          db,
          agentRow: { ...agent, companyId },
          catalogItem,
          instructionsService,
        });
        continue;
      } catch (err) {
        logger.error(
          { err, agentId: agent.id },
          "marketplace: crew auto-update failed — notifying",
        );
      }
    }

    // Notify path: record pending update + fire notification only on first detection.
    // onConflictDoNothing().returning() returns the newly-inserted row when the
    // (companyId, catalogItemId) pair is new, and returns [] when the row already
    // exists.  Gating the notification on a non-empty return prevents the same
    // founder from receiving duplicate "update available" notifications every time
    // checkCrewUpdates runs (every boot + every catalog sync cycle).
    let pendingInserted = false;
    try {
      const inserted = await db
        .insert(marketplacePendingUpdates)
        .values({
          companyId,
          catalogItemId: catalogItem.id,
          catalogItemName: catalogItem.name,
          itemType: "agent",
          currentVersion: agent.templateVersion ?? "0.0.0",
          latestVersion: catalogItem.version,
          status: "pending",
        })
        .onConflictDoNothing()
        .returning({ id: marketplacePendingUpdates.id });
      pendingInserted = inserted.length > 0;
    } catch (err) {
      logger.error({ err }, "marketplace: failed to record pending update");
    }
    if (pendingInserted) {
      try {
        await marketplaceNotifications.updateAvailable(
          db,
          companyId,
          catalogItem.name,
          agent.templateVersion ?? "0.0.0",
          catalogItem.version,
        );
      } catch (err) {
        logger.error({ err }, "marketplace: updateAvailable notification failed");
      }
    }
  }
}
