// server/src/services/internal-agent/aoa-agents/sweep-inbox.ts
//
// Task 1.4 (Inbound Dirty-Data Routing) — inbox routing backstop sweep.
//
// PRIMARY driver: fire-and-forget in inbox-producer.ts (after a fresh insert).
//
// This sweep is the SAFETY NET: it catches thread_inbox_items rows whose
// fire-and-forget async route never ran (process restart, crash before claim,
// transient network blip). It selects all items with routingStatus='pending_route'
// and calls routeInboxItem for each.
//
// Idempotency: routeInboxItem self-guards (Codex #9) — it no-ops if the item
// is no longer pending_route, so concurrent calls from the async trigger and
// the sweep cannot double-route.
//
// Statuses NOT swept:
//   - 'routing'   — currently in flight (claimed by an async trigger)
//   - 'routed'    — already successfully processed
//   - 'escalated' — handed to Navigator; Navigator owns it now
//   - 'failed'    — action step failed; separate retry concern, not re-swept here
//
// Interval: registered in server/src/index.ts at INBOX_SWEEP_INTERVAL_MS
// (2 minutes — mirrors the controller backstop sweep cadence).

import { eq } from "drizzle-orm";
import { threadInboxItems } from "@armyofagents/db";
import type { Db } from "@armyofagents/db";
import { routeInboxItem } from "../../inbox-router.js";
import { logger } from "../../../middleware/logger.js";

const log = logger.child({ svc: "sweep-inbox" });

export interface RunInboxSweepResult {
  /** Number of pending_route items processed (attempted, whether success or error). */
  swept: number;
}

/**
 * Drain all `thread_inbox_items` rows with `routingStatus='pending_route'`.
 *
 * For each item, calls `routeInboxItem(db, { inboxItemId })`. routeInboxItem
 * self-resolves an embedder (resolveDefaultEmbedder inside inbox-router.ts) so
 * the sweep needs no ctx. Per-item errors are caught and logged — the sweep
 * never throws.
 *
 * Returns `{ swept: N }` where N is the count of items iterated (including
 * those that errored; the lifecycle column guards re-routing of truly completed
 * items at the routeInboxItem layer).
 */
export async function runInboxSweep(db: Db): Promise<RunInboxSweepResult> {
  const pending = await db
    .select({ id: threadInboxItems.id })
    .from(threadInboxItems)
    .where(eq(threadInboxItems.routingStatus, "pending_route"));

  if (pending.length === 0) {
    return { swept: 0 };
  }

  log.debug({ count: pending.length }, "inbox sweep: draining pending_route items");

  let swept = 0;
  for (const row of pending) {
    try {
      await routeInboxItem(db, { inboxItemId: row.id });
    } catch (err) {
      log.warn({ err, inboxItemId: row.id }, "inbox sweep: routeInboxItem failed — continuing");
    }
    swept++;
  }

  log.debug({ swept }, "inbox sweep: done");
  return { swept };
}
