import { gt } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { discussions, internalAgentConfig } from "@armyofagents/db";

/**
 * One-time startup reconciliation: clamp any stored autonomy_level > 2 → 2.
 *
 * Background: the UI autonomy scale was remapped from old 1/2/3
 * (Manual/Semi/Auto) to canonical 0/1/2 (Manual/Assist/Drive). Rows written
 * before the migration may hold autonomy_level = 3 (old "Auto"). The new max
 * is 2 (Drive). Clamp them so the runtime never sees an out-of-range value.
 *
 * Tables updated:
 *   - discussions.autonomy_level  (per-thread override)
 *   - internal_agent_config.autonomy_level  (company-level default)
 *
 * Safe to call on every startup — only touches rows where autonomy_level > 2.
 * Idempotent: a second run matches 0 rows and returns { discussionsUpdated: 0,
 * configUpdated: 0 }.
 */
export async function reconcileAutonomyScale(
  db: Db,
): Promise<{ discussionsUpdated: number; configUpdated: number }> {
  const discussionsResult = await db
    .update(discussions)
    .set({
      autonomyLevel: 2,
      updatedAt: new Date(),
    })
    .where(gt(discussions.autonomyLevel, 2));

  const configResult = await db
    .update(internalAgentConfig)
    .set({
      autonomyLevel: 2,
      updatedAt: new Date(),
    })
    .where(gt(internalAgentConfig.autonomyLevel, 2));

  const discussionsUpdated =
    (discussionsResult as unknown as { rowCount?: number | null }).rowCount ?? 0;
  const configUpdated =
    (configResult as unknown as { rowCount?: number | null }).rowCount ?? 0;

  return { discussionsUpdated, configUpdated };
}
