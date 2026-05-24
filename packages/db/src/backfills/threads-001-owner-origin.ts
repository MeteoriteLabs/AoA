// One-time backfill: existing discussions had no thread fields.
// Run once after applying migration 0109 (0109_cultured_devos.sql).
// Idempotent: only fills NULLs.
import { sql } from "drizzle-orm";
import type { Db } from "../client.js";

export async function backfillThreadDefaults(db: Db): Promise<void> {
  // Pre-Threads discussions were human-created -> owner = creator.
  await db.execute(sql`UPDATE discussions SET owner_user_id = created_by WHERE owner_user_id IS NULL`);
  // Set human/text origin for pre-Threads discussions.
  await db.execute(sql`UPDATE discussions SET origin_source = 'human', origin_medium = 'text' WHERE origin_source IS NULL`);
  // Heuristic: discussions with approved extracted items are already scoped.
  await db.execute(sql`
    UPDATE discussions SET phase = 'scope'
    WHERE phase = 'discuss'
      AND id IN (
        SELECT DISTINCT discussion_id FROM discussion_entries de
        JOIN discussion_extracted_items dei ON dei.discussion_entry_id = de.id
        WHERE dei.status = 'approved'
      )
  `);
}
