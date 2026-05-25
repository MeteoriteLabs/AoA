import { and, eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { agents, aoaAgentTriggers } from "@armyofagents/db";
import { seedRoleInstructionBundle } from "./seed-commander-bundle.js";
import { agentInstructionsService } from "../../agent-instructions.js";

/**
 * Plan 3 Task 1 — Adjutant role seed + ROLE_MIN_AUTONOMY.
 * The Adjutant checks if a thread is ready to advance to the next phase,
 * and either advances it (autonomy ≥ 2) or nudges the owner (autonomy < 2).
 * Active at all autonomy levels (L0+); advance_phase self-gates at L2 inside the tool.
 *
 * Triggered via periodic "sweep" dispatch.
 */

const ROLE_INSTRUCTION: string =
  "You are the Adjutant — the quiet shepherd of thread health. You run periodically " +
  "via a sweep trigger, not on every message. Your job: check if a thread is ready " +
  "to advance to the next phase, and either advance it (autonomy ≥ 2) or nudge the " +
  "owner (autonomy < 2). Never dominate the conversation. Observe, assess, act once, " +
  "and be silent. Tools: query_threads to find the thread, query_extracted_items to " +
  "check completeness, advance_phase to advance (only at L2), notify_owner to nudge.";

const ADJUTANT_TOOL_ALLOWLIST: string[] = [
  "query_threads",
  "query_extracted_items",
  "advance_phase",
  "notify_owner",
  "post_entry",
];

const ADJUTANT_NAME = "Adjutant";

async function ensureAdjutantRole(db: Db, companyId: string): Promise<string> {
  // Atomic insert with ON CONFLICT DO NOTHING (agents_aoa_name_per_company_idx).
  const [inserted] = await db
    .insert(agents)
    .values({
      companyId,
      name: ADJUTANT_NAME,
      kind: "aoa",
      role: "general",
      status: "idle",
      adapterType: "process",
      runtimeConfig: {
        aoa: { role: "member", instruction: ROLE_INSTRUCTION, toolAllowlist: ADJUTANT_TOOL_ALLOWLIST },
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

    // Seed the trigger for this role (sweep-based periodic dispatch).
    await db.insert(aoaAgentTriggers).values({
      companyId,
      agentId,
      kind: "sweep",
      enabled: true,
      config: { role: "adjutant" },
    });
  } else {
    // Conflict: another concurrent caller inserted first. Fetch the winner.
    const [existing] = await db
      .select({ id: agents.id, runtimeConfig: agents.runtimeConfig })
      .from(agents)
      .where(
        and(
          eq(agents.companyId, companyId),
          eq(agents.kind, "aoa"),
          eq(agents.name, ADJUTANT_NAME),
        ),
      )
      .limit(1);
    if (!existing) {
      throw new Error(
        `Adjutant role for company ${companyId} disappeared after conflict`,
      );
    }
    agentId = existing.id;
    existingRc = existing.runtimeConfig;
  }

  // D2 idempotent backfill: merge toolAllowlist into existing row's runtimeConfig
  // so pre-D2 rows aren't stranded by default-deny.
  if (!inserted) {
    const rc = existingRc ?? {};
    const aoaCfg = (rc.aoa as Record<string, unknown>) ?? {};
    if (!Array.isArray(aoaCfg.toolAllowlist)) {
      const updatedRc = {
        ...rc,
        aoa: { ...aoaCfg, toolAllowlist: ADJUTANT_TOOL_ALLOWLIST },
      };
      await db.update(agents)
        .set({ runtimeConfig: updatedRc, updatedAt: new Date() })
        .where(eq(agents.id, agentId));
    }
  }

  // P1.6: seed the role's editable instruction bundle (idempotent; never clobbers
  // founder edits). Non-fatal: seeding failure must not block role provisioning.
  try {
    const row = await db
      .select({ id: agents.id, companyId: agents.companyId, name: agents.name, adapterConfig: agents.adapterConfig })
      .from(agents)
      .where(eq(agents.id, agentId))
      .then((r: { id: string; companyId: string; name: string; adapterConfig: Record<string, unknown> | null }[]) => r[0]);
    if (row) {
      const nextAdapterConfig = await seedRoleInstructionBundle({
        role: "adjutant",
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
 * Idempotently seed the Adjutant role for a company.
 * Call this from the company bootstrap path alongside ensureCommanderAgent,
 * ensureExtractionAgent, and ensureCommandStaff.
 */
export async function ensureAdjutant(db: Db, companyId: string): Promise<void> {
  await ensureAdjutantRole(db, companyId);
}
