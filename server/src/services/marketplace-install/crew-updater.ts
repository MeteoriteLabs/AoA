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
import { protectedAgentRole } from "../protected-agents.js";
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
  /**
   * D22 gate input. `false` = provably untouched → replaceable. `true` = edited.
   * `null`/absent = unknown → treated as edited. See `agents.instructionsCustomized`.
   */
  instructionsCustomized: boolean | null;
}

/**
 * Thrown when the agent's instruction bundle is (or may be) founder-edited, so
 * a full replacement would destroy work. The caller falls back to notify.
 *
 * Mirrors `SkillCustomizedError` deliberately — the two are the same product
 * rule applied to the two customizable artifact kinds.
 */
export class AgentInstructionsCustomizedError extends Error {
  constructor(
    readonly agentId: string,
    readonly state: boolean | null | undefined,
  ) {
    super(
      `Agent ${agentId} instruction bundle is ${state === true ? "customized" : "of unknown provenance"}; ` +
        "skipping full-replacement update",
    );
    this.name = "AgentInstructionsCustomizedError";
  }
}

/**
 * Is this row safe to full-replace? Only a hard `false` qualifies.
 *
 * Fails closed on `null`/`undefined`: a row whose customization state was never
 * recorded is exactly the row whose edits we cannot see.
 */
function isReplaceable(state: boolean | null | undefined): boolean {
  return state === false;
}

/**
 * Apply a full-replacement update to a single crew agent.
 *
 * ── D22: instruction files are FOUNDER CONFIG, not app code ─────────────────
 *
 * This module previously asserted the opposite, verbatim:
 *
 * > "DESIGN DECISION: instruction files are app code, not user config.
 * >  replaceExisting: true → ALL files replaced (no preservation of edits)."
 *
 * That is **reversed** (Decision #114 / D22). Agent instruction bundles are
 * founder-editable through a first-class editor (`routes/agents.ts`
 * `/agents/:id/instructions-bundle*`), which is the whole reason that editor
 * exists — so treating what it writes as disposable app code made every catalog
 * bump a silent, unrecoverable data loss. Edits are now tracked exactly like
 * skill edits (`company_skills.customized`): a customized agent routes to
 * NOTIFY, never to replace.
 *
 * What is still fully replaced, for a row that is provably untouched:
 * instructions, `skillKeys`, `runtimeConfig.aoa.toolAllowlist`,
 * `templateVersion`, and triggers (DELETE + re-INSERT).
 *
 * Deliberately does NOT touch `name`, `role`, `title`, `icon`, `capabilities`,
 * `permissions`, `metadata` or `adapterType` — those are the founder's, not the
 * catalog's.
 *
 * **D23 exception:** for a protected AoA agent the trigger replacement is
 * skipped entirely (see the guard at the DELETE below). That carve-out is
 * unchanged by D22 and composes with it: D22 decides *whether* this function
 * runs at all, D23 narrows *what* it writes once it does.
 *
 * ── Ordering is load-bearing ────────────────────────────────────────────────
 *
 * The D22 gate runs FIRST, before any fetch and before
 * `materializeManagedBundle(..., { replaceExisting: true })` — whose first act
 * is `fs.rm(rootPath, { recursive: true, force: true })` on the directory
 * holding the founder's edits (`agent-instructions.ts`), outside any
 * transaction. A gate placed inside the transaction would throw *after* the
 * files were already gone, which is no gate at all.
 *
 * ⚠️ **Residual race, stated honestly.** The gate reads a snapshot taken by the
 * caller. A founder edit that commits between that read and the `fs.rm` is
 * still lost on disk. The transactional `instructions_customized = false`
 * predicate below closes the *database* half — the row is never stamped as
 * updated in that case, so the founder still sees a pending update — but it
 * cannot un-delete files. Closing the disk half needs the edit routes and this
 * path to share a lock; not done, and not claimed.
 *
 * ⚠️ **The write is still not atomic with the filesystem.** If the transaction
 * fails after a successful materialize, the row keeps its old `templateVersion`
 * while the bundle on disk already holds new catalog content. That is now a
 * catalog-vs-catalog inconsistency rather than destroyed founder work, and the
 * next pass converges it.
 *
 * Do NOT call this from a path that has not consulted `agentUpdatePolicy`.
 * (T2.3b's crew repair deliberately does not: it adopts the row POINTER and
 * leaves content to this policy-respecting path. See `services/crew-repair.ts`.
 * Its adopted rows carry `instructionsCustomized = null`, so they route to
 * notify here — correct, because repair genuinely cannot know whether the
 * legacy bundle it adopted was edited.)
 *
 * @throws {AgentInstructionsCustomizedError} when the bundle is, or may be,
 * founder-edited. Callers must catch and fall back to notify.
 */
export async function applyCrewAgentUpdate(opts: {
  db: Db;
  agentRow: CrewAgentRow;
  catalogItem: CatalogItem;
  instructionsService: AgentInstructionsServiceLike;
}): Promise<void> {
  const { db, agentRow, catalogItem, instructionsService } = opts;

  // D22 GATE — before the fetch, and above all before the fs.rm.
  if (!isReplaceable(agentRow.instructionsCustomized)) {
    throw new AgentInstructionsCustomizedError(agentRow.id, agentRow.instructionsCustomized);
  }

  // D23: is this row a protected AoA agent? `catalogItem.id` is the origin the
  // row is being updated against, which is the strongest identity signal
  // available here — `CrewAgentRow` does not carry `templateOrigin`, and a row
  // only reaches this function because `checkCrewUpdates` matched it to this
  // item. The name is checked too (`protectedAgentRole` falls through to it),
  // so a mis-pointed row is still recognised.
  const protectedRole = protectedAgentRole({ name: agentRow.name, templateOrigin: catalogItem.id });

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
    // D22 optimistic lock. `instructions_customized = false` in the WHERE means
    // a founder edit that committed since the gate above wins: RETURNING comes
    // back empty and we throw instead of stamping the row as updated. NULL rows
    // never satisfy `= false`, so an unknown-provenance row is excluded here too
    // (defence in depth behind the gate).
    //
    // `instructionsCustomized: false` is re-asserted in the SET so the column
    // stays a statement about the CURRENT bundle: after this commit the bundle
    // on disk is catalog content again. It is what makes the flag meaningful for
    // T2.7's merge path, which will set it back to `true`.
    const updatedRows = await tx
      .update(agents)
      .set({
        skillKeys: template.skillKeys,
        runtimeConfig: updatedRc,
        templateVersion: catalogItem.version,
        instructionsCustomized: false,
        ...(materialized ? { adapterConfig: materialized.adapterConfig } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(agents.id, agentRow.id), eq(agents.instructionsCustomized, false)))
      .returning({ id: agents.id });

    if (updatedRows.length === 0) {
      // Either a concurrent founder edit flipped the flag, or the row vanished.
      // Both must abort the transaction: triggers and the pending-update row
      // below must not be written against an agent we did not actually update.
      throw new AgentInstructionsCustomizedError(agentRow.id, true);
    }

    // Replace triggers: delete existing, re-insert from catalog.
    // `enabled` is taken from the catalog (T2.3d) — an update must not silently
    // re-enable a trigger the catalog disabled.
    //
    // D23: SKIPPED ENTIRELY for a protected AoA agent. A protected agent's
    // triggers are AoA-owned, not catalog-owned, and the wipe is unrecoverable:
    // `sweep-steward.ts` selects on kind='sweep' + enabled=true, and
    // `seedCrewAgent` only seeds triggers for a NEWLY INSERTED row — so a
    // catalog template that omits the sweep trigger would silently stop Steward
    // forever, which is verbatim the harm the protected set exists to prevent.
    // The cost is that a catalog-ADDED trigger never reaches these two roles;
    // that is the right trade for two agents, and install (`agent-create.ts`)
    // still honours the template's triggers on first install.
    if (protectedRole) {
      logger.info(
        { agentId: agentRow.id, role: protectedRole.slug, catalogItemId: catalogItem.id },
        "marketplace: preserving protected AoA agent's triggers through a catalog update",
      );
    } else {
      await tx.delete(aoaAgentTriggers).where(eq(aoaAgentTriggers.agentId, agentRow.id));
      for (const trigger of template.triggers ?? []) {
        await tx.insert(aoaAgentTriggers).values({
          companyId: agentRow.companyId,
          agentId: agentRow.id,
          kind: trigger.kind,
          enabled: trigger.enabled,
          config: trigger.config,
        });
      }
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
 *
 * - auto policy + within window + **provably untouched instructions** → apply
 *   immediately (silent, no notification).
 * - notify policy, outside window, or **customized/unknown instructions** →
 *   record pending_update + updateAvailable notification.
 *
 * D22: the customization test is deliberately routed through the SAME notify
 * machinery as the policy test rather than a parallel path, so a customized
 * agent produces the ordinary founder-visible pending-update row that T2.7's
 * diff/merge will act on.
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
      instructionsCustomized: agents.instructionsCustomized,
    })
    .from(agents)
    .where(and(eq(agents.companyId, companyId), eq(agents.kind, "aoa")));

  for (const agent of crewAgents) {
    if (!agent.templateOrigin || agent.templateOrigin.endsWith("@legacy")) continue;
    if (!agent.templateVersion) continue;

    const catalogItem = catalogById.get(agent.templateOrigin);
    if (!catalogItem) continue;
    if (catalogItem.version === agent.templateVersion) continue;

    // D22: a customized (or unknown-provenance) bundle is never auto-replaced,
    // whatever the policy says. `agentUpdatePolicy: "auto"` is consent to take
    // catalog content over CATALOG content — not consent to discard the
    // founder's own edits, which they would have no way to recover.
    const autoApply =
      settings.agentUpdatePolicy === "auto" &&
      isWithinUpdateWindow(settings.updateWindow) &&
      isReplaceable(agent.instructionsCustomized);

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
    } else if (
      settings.agentUpdatePolicy === "auto" &&
      !isReplaceable(agent.instructionsCustomized)
    ) {
      logger.info(
        {
          agentId: agent.id,
          catalogItemId: catalogItem.id,
          instructionsCustomized: agent.instructionsCustomized,
        },
        "marketplace: crew agent instructions are customized (or of unknown provenance) — " +
          "routing the update to notify instead of full replacement (D22)",
      );
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
