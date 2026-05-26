import { and, eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { agents, aoaAgentTriggers } from "@armyofagents/db";
import { seedRoleInstructionBundle } from "./seed-commander-bundle.js";
import { agentInstructionsService } from "../../agent-instructions.js";
import {
  resolveCrewAdapterForCompany,
  needsAdapterBackfill,
  mergeAdapterConfig,
} from "./resolve-crew-adapter.js";

/**
 * Plan 4 — Maker role seed (8th crew agent per design § 3).
 * The Maker generates artifacts on demand (mocks, drafts, research summaries)
 * when invited via @Maker mention or routed via a scope item with kind=artifact
 * and assigneeAgentId set to the Maker.
 *
 * Active at L1+ for mention-driven runs. Phase-advance routing requires L2
 * (same as Router/Planner/Dispatcher), enforced by the autonomy gate.
 *
 * Triggered via:
 *   - mention   (entry contains @Maker — wakeup written by processMentions)
 *   - phase-advance (thread phase changed to scope/assign — wakeup written by advancePhase)
 */

const ROLE_INSTRUCTION: string =
  "You are the Maker — you make things (mocks, drafts, prototypes, research " +
  "summaries) directly in a thread on demand. You only speak when invited via " +
  "@Maker mention or via a scope item assigned to you. You attach every make as " +
  "a create_artifact version (immutable; new version, never modify in place) " +
  "and post one short reply pointing to it. Tools: read_file for source context, " +
  "search_discussions + query_extracted_items to ground in prior decisions, " +
  "create_artifact to produce the deliverable, post_entry to announce it. Do " +
  "not create tasks, advance phases, or write memory.";

const MAKER_TOOL_ALLOWLIST: string[] = [
  "read_file",
  "search_discussions",
  "query_extracted_items",
  "create_artifact",
  "post_entry",
];

const MAKER_NAME = "Maker";

async function ensureMakerRole(db: Db, companyId: string): Promise<string> {
  // Resolve the right CLI adapter for this company's configured provider
  // (P1-B fix — see ensure-adjutant.ts for context).
  const crewAdapter = await resolveCrewAdapterForCompany(db, companyId);

  // Atomic insert with ON CONFLICT DO NOTHING (agents_aoa_name_per_company_idx).
  const [inserted] = await db
    .insert(agents)
    .values({
      companyId,
      name: MAKER_NAME,
      kind: "aoa",
      role: "general",
      status: "idle",
      adapterType: crewAdapter.adapterType,
      adapterConfig: crewAdapter.adapterConfig,
      runtimeConfig: {
        aoa: { role: "member", instruction: ROLE_INSTRUCTION, toolAllowlist: MAKER_TOOL_ALLOWLIST },
        heartbeat: { enabled: false, intervalSec: 0 },
      },
    })
    .onConflictDoNothing()
    .returning({ id: agents.id, runtimeConfig: agents.runtimeConfig });

  let agentId: string;
  let existingRc: Record<string, unknown> | undefined;

  if (inserted) {
    agentId = inserted.id;
    existingRc = inserted.runtimeConfig;

    // Seed both triggers for this role: mention (any author) + phase-advance.
    await db.insert(aoaAgentTriggers).values([
      {
        companyId,
        agentId,
        kind: "mention",
        enabled: true,
        config: { role: "maker" },
      },
      {
        companyId,
        agentId,
        kind: "phase-advance",
        enabled: true,
        config: { role: "maker" },
      },
    ]);
  } else {
    // Conflict: another concurrent caller inserted first. Fetch the winner.
    const [existing] = await db
      .select({ id: agents.id, runtimeConfig: agents.runtimeConfig })
      .from(agents)
      .where(
        and(
          eq(agents.companyId, companyId),
          eq(agents.kind, "aoa"),
          eq(agents.name, MAKER_NAME),
        ),
      )
      .limit(1);
    if (!existing) {
      throw new Error(
        `Maker role for company ${companyId} disappeared after conflict`,
      );
    }
    agentId = existing.id;
    existingRc = existing.runtimeConfig;
  }

  // D2 idempotent backfill: merge toolAllowlist into existing row's runtimeConfig.
  // P1-B backfill: upgrade adapter_type='process' (no command) rows to the
  // resolved CLI adapter (Maker is new so this only fires after a previous
  // version of ensure-maker.ts seeded it with the broken adapter).
  if (!inserted) {
    const rc = existingRc ?? {};
    const aoaCfg = (rc.aoa as Record<string, unknown>) ?? {};
    const updates: Record<string, unknown> = {};

    if (!Array.isArray(aoaCfg.toolAllowlist)) {
      updates.runtimeConfig = {
        ...rc,
        aoa: { ...aoaCfg, toolAllowlist: MAKER_TOOL_ALLOWLIST },
      };
    }

    const [current] = await db
      .select({ adapterType: agents.adapterType, adapterConfig: agents.adapterConfig })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    if (current && needsAdapterBackfill(current.adapterType, current.adapterConfig as Record<string, unknown> | null)) {
      updates.adapterType = crewAdapter.adapterType;
      updates.adapterConfig = mergeAdapterConfig(current.adapterConfig as Record<string, unknown> | null, crewAdapter.adapterConfig);
    }

    if (Object.keys(updates).length > 0) {
      await db.update(agents)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(agents.id, agentId));
    }
  }

  // Seed the role's editable instruction bundle (idempotent; never clobbers
  // founder edits). Non-fatal: seeding failure must not block role provisioning.
  try {
    const row = await db
      .select({ id: agents.id, companyId: agents.companyId, name: agents.name, adapterConfig: agents.adapterConfig })
      .from(agents)
      .where(eq(agents.id, agentId))
      .then((r: { id: string; companyId: string; name: string; adapterConfig: Record<string, unknown> | null }[]) => r[0]);
    if (row) {
      const nextAdapterConfig = await seedRoleInstructionBundle({
        role: "maker",
        agent: { id: row.id, companyId: row.companyId, name: row.name, adapterConfig: row.adapterConfig },
        service: agentInstructionsService(),
      });
      await db.update(agents).set({ adapterConfig: nextAdapterConfig, updatedAt: new Date() }).where(eq(agents.id, agentId));
    }
  } catch {
    /* non-fatal — runner falls back to the instruction string */
  }

  return agentId;
}

/**
 * Idempotently seed the Maker role for a company.
 * Call this from the company bootstrap path alongside ensureCommanderAgent,
 * ensureExtractionAgent, ensureCommandStaff, and ensureAdjutant.
 */
export async function ensureMaker(db: Db, companyId: string): Promise<void> {
  await ensureMakerRole(db, companyId);
}
