import { z } from "zod";
import { HUB_LANES, HUB_ITEM_STATUSES } from "../hub.js";

// ── List query (GET /companies/:companyId/hub-items) ──────────────────────────
// Query-string params arrive as strings; coerce `includeDismissed` to a boolean
// and constrain `lane`/`status` to the shared enums.
export const listHubItemsQuery = z
  .object({
    lane: z.enum(HUB_LANES).optional(),
    status: z.enum(HUB_ITEM_STATUSES).optional(),
    // Accept "true"/"false"/"1"/"0" from the query string.
    includeDismissed: z
      .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
      .optional()
      .transform((v) => v === true || v === "true" || v === "1"),
  })
  .strict();

export type ListHubItemsQuery = z.infer<typeof listHubItemsQuery>;

// ── Action (POST /companies/:companyId/hub-items/:id/action) ──────────────────
// Optimistic-concurrency action envelope. `expectedVersion` is the version the
// client last saw → a mismatch yields 409. `nextStatus` is the target lifecycle
// state (W1a covers single-item resolve/archive/snooze).
export const hubActionSchema = z
  .object({
    action: z.string().trim().min(1),
    expectedVersion: z.number().int().min(0),
    nextStatus: z.enum(["resolved", "archived", "snoozed"]),
    idempotencyKey: z.string().trim().min(1).optional(),
    reason: z.string().trim().min(1).optional(),
  })
  .strict();

export type HubActionInput = z.infer<typeof hubActionSchema>;

// ── Per-user state (PATCH /companies/:companyId/hub-items/:id/state) ───────────
// A discriminated union over the three divergence kinds a principal can record:
// read, snooze (until a datetime), or dismiss. Each writes the matching column
// on the sparse `hub_item_user_state` row.
export const hubUserStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("read") }).strict(),
  z.object({ kind: z.literal("snooze"), until: z.string().datetime() }).strict(),
  z.object({ kind: z.literal("dismiss") }).strict(),
]);

export type HubUserStateInput = z.infer<typeof hubUserStateSchema>;
