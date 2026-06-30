import { z } from "zod";
import {
  HUB_DENSITIES,
  HUB_GROUP_MODES,
  HUB_ITEM_STATUSES,
  HUB_LANDING_TARGETS,
  HUB_LANES,
} from "../hub.js";

const queryBoolean = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .optional()
  .transform((v) => v === true || v === "true" || v === "1");

// ── List query (GET /companies/:companyId/hub-items) ──────────────────────────
// Query-string params arrive as strings; coerce `includeDismissed` to a boolean
// and constrain `lane`/`status` to the shared enums.
export const listHubItemsQuery = z
  .object({
    lane: z.enum(HUB_LANES).optional(),
    status: z.enum(HUB_ITEM_STATUSES).optional(),
    q: z
      .string()
      .trim()
      .max(120)
      .optional()
      .transform((value) => (value && value.length > 0 ? value : undefined)),
    cursor: z.string().trim().min(1).optional(),
    groupMode: z.enum(HUB_GROUP_MODES).optional(),
    // Accept "true"/"false"/"1"/"0" from the query string.
    includeDismissed: queryBoolean,
    includeSnoozed: queryBoolean,
    limit: z.coerce.number().int().min(1).max(50).optional().default(50),
  })
  .strict();

export type ListHubItemsQuery = z.infer<typeof listHubItemsQuery>;

const visibleLanesSchema = z
  .array(z.enum(HUB_LANES))
  .min(1)
  .refine((lanes) => new Set(lanes).size === lanes.length, {
    message: "visibleLanes must not contain duplicates",
  });

export const hubPreferencesSchema = z
  .object({
    defaultLanding: z.enum(HUB_LANDING_TARGETS),
    visibleLanes: visibleLanesSchema,
    groupMode: z.enum(HUB_GROUP_MODES),
    density: z.enum(HUB_DENSITIES),
    showAutopilotEntry: z.boolean(),
    updatedAt: z.string().datetime().nullable(),
  })
  .strict();

export type HubPreferences = z.infer<typeof hubPreferencesSchema>;

export const updateHubPreferencesSchema = z
  .object({
    defaultLanding: z.enum(HUB_LANDING_TARGETS).optional(),
    visibleLanes: visibleLanesSchema.optional(),
    groupMode: z.enum(HUB_GROUP_MODES).optional(),
    density: z.enum(HUB_DENSITIES).optional(),
    showAutopilotEntry: z.boolean().optional(),
  })
  .strict();

export type UpdateHubPreferencesInput = z.infer<typeof updateHubPreferencesSchema>;

// ── Action (POST /companies/:companyId/hub-items/:id/action) ──────────────────
// Optimistic-concurrency action envelope. `expectedVersion` is the version the
// client last saw → a mismatch yields 409. `nextStatus` is the target lifecycle
// state (W1a covers single-item resolve/archive/snooze).
export const hubActionSchema = z
  .object({
    action: z.enum(["resolve", "archive", "claim", "release"]),
    expectedVersion: z.number().int().min(0),
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
  z.object({ kind: z.literal("unread") }).strict(),
  z.object({ kind: z.literal("snooze"), until: z.string().datetime() }).strict(),
  z.object({ kind: z.literal("unsnooze") }).strict(),
  z.object({ kind: z.literal("dismiss") }).strict(),
  z.object({ kind: z.literal("undismiss") }).strict(),
]);

export type HubUserStateInput = z.infer<typeof hubUserStateSchema>;

const bulkSharedLifecycleItemSchema = z
  .object({
    id: z.string().uuid(),
    action: z.enum(["resolve", "archive", "claim", "release"]),
    expectedVersion: z.number().int().min(0),
    idempotencyKey: z.string().trim().min(1).optional(),
    reason: z.string().trim().min(1).optional(),
  })
  .strict();

const bulkDismissItemSchema = z
  .object({
    id: z.string().uuid(),
    action: z.literal("dismiss"),
    idempotencyKey: z.string().trim().min(1).optional(),
    reason: z.string().trim().min(1).optional(),
  })
  .strict();

const bulkSnoozeItemSchema = z
  .object({
    id: z.string().uuid(),
    action: z.literal("snooze"),
    until: z.string().datetime(),
    idempotencyKey: z.string().trim().min(1).optional(),
    reason: z.string().trim().min(1).optional(),
  })
  .strict();

export const hubBulkActionSchema = z
  .object({
    bulkId: z.string().trim().min(1).optional(),
    items: z
      .array(
        z.discriminatedUnion("action", [
          bulkSharedLifecycleItemSchema,
          bulkDismissItemSchema,
          bulkSnoozeItemSchema,
        ]),
      )
      .min(1)
      .max(50),
  })
  .strict();

export type HubBulkActionInput = z.infer<typeof hubBulkActionSchema>;

export const hubUndoSchema = z
  .object({
    auditId: z.string().trim().min(1),
    expectedVersion: z.number().int().min(0),
  })
  .strict();

export type HubUndoInput = z.infer<typeof hubUndoSchema>;
