import { and, eq, or, isNull, lte } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { memoryItems } from "@paperclipai/db";

const STALE_DAYS = 90;

export function memoryLifecycleService(db: Db) {
  return {
    /**
     * Flag approved memory items as stale when their accessedAt (or createdAt
     * if never accessed) is older than 90 days.  Items already flagged or in
     * non-approved status are skipped.
     *
     * Returns the list of flagged item IDs.
     */
    flagStaleItems: async (companyId: string) => {
      const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);

      const flagged = await db
        .update(memoryItems)
        .set({ status: "stale", updatedAt: new Date() })
        .where(
          and(
            eq(memoryItems.companyId, companyId),
            eq(memoryItems.status, "approved"),
            or(
              // Never accessed and created before cutoff
              and(isNull(memoryItems.accessedAt), lte(memoryItems.createdAt, cutoff)),
              // Accessed but last access before cutoff
              lte(memoryItems.accessedAt, cutoff),
            ),
          ),
        )
        .returning({ id: memoryItems.id });

      return flagged.map((r) => r.id);
    },
  };
}
