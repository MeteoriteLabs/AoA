import { and, eq, isNull, inArray, sql } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { agents } from "@armyofagents/db";

/**
 * One-time startup backfill: stamp a synthetic `@legacy` templateOrigin onto
 * every kind='aoa' crew agent that was seeded before the marketplace installer
 * began setting this field (Phase 3 / v1.1).
 *
 * The `@legacy` suffix distinguishes hard-coded ensures (pre-marketplace) from
 * catalog-installed agents so that:
 *   1. The boot-time `ensureX` guards can skip companies already on marketplace.
 *   2. The crew-updater can exclude legacy rows from update eligibility.
 *
 * Safe to call on every startup — it only touches rows where templateOrigin IS NULL.
 * Idempotent: second run updates 0 rows.
 *
 * Phase D batch 2 (D6 + D7): canonical Phase-1 roster only. Removed:
 *   - Scribe — autonomous Scribe is gated off (Task C1); extraction now runs
 *     as tool calls from Memory Keeper + Adjutant. Pre-existing Scribe rows
 *     in legacy DBs are left as-is (founder can terminate manually if desired).
 *   - Router — superseded by Navigator (rename happens inside
 *     ensure-command-staff.ts). Pre-existing Router rows are renamed to
 *     Navigator before seedCrewAgent runs, so by the time this backfill stamps
 *     templateOrigin the row is already named Navigator.
 *   - Maker — superseded by Engineer (rename happens inside ensure-engineer.ts,
 *     same mechanism as Router/Navigator).
 */
const CREW_NAMES = [
  "Commander",
  "Adjutant",
  "Scout",
  "Engineer",
  "Navigator",
  "Planner",
  "Dispatcher",
  "Memory Keeper",
] as const;

export async function backfillCrewTemplateOrigin(db: Db): Promise<void> {
  await db
    .update(agents)
    .set({
      templateOrigin: sql`'aoa-curated/standard-crew/' || lower(replace(${agents.name}, ' ', '-')) || '@legacy'`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(agents.kind, "aoa"),
        isNull(agents.templateOrigin),
        inArray(agents.name, [...CREW_NAMES]),
      ),
    );
}
