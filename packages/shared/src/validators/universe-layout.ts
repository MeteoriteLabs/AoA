import { z } from "zod";

/** Reference kinds a Universe panel may render — matches the frame's Ref.kind.
 * `kind` is an accepted enum, never arbitrary render code. */
export const UNIVERSE_REF_KINDS = ["task", "artifact", "browser"] as const;
export type UniverseRefKind = (typeof UNIVERSE_REF_KINDS)[number];

/** Proposed transport bounds. These require host qualification and are not a
 * capacity guarantee. */
export const UNIVERSE_LAYOUT_SCHEMA_VERSION = 1;
export const UNIVERSE_LAYOUT_MAX_PANELS = 200;
export const UNIVERSE_LAYOUT_MAX_OPERATIONS = 50;
export const UNIVERSE_LAYOUT_COORD_LIMIT = 1_000_000;
export const UNIVERSE_LAYOUT_MIN_DIMENSION = 1;
export const UNIVERSE_LAYOUT_MAX_DIMENSION = 8192;
export const UNIVERSE_LAYOUT_MIN_ZOOM = 0.25;
export const UNIVERSE_LAYOUT_MAX_ZOOM = 2;

const finite = z.number().finite();
const coord = finite
  .gte(-UNIVERSE_LAYOUT_COORD_LIMIT)
  .lte(UNIVERSE_LAYOUT_COORD_LIMIT);
const dimension = finite
  .gte(UNIVERSE_LAYOUT_MIN_DIMENSION)
  .lte(UNIVERSE_LAYOUT_MAX_DIMENSION);
const zoom = finite.gte(UNIVERSE_LAYOUT_MIN_ZOOM).lte(UNIVERSE_LAYOUT_MAX_ZOOM);
const key = z.string().min(1).max(1024);

export const rectSchema = z
  .object({ x: coord, y: coord, width: dimension, height: dimension })
  .strict();
export type Rect = z.infer<typeof rectSchema>;

/** An operation's reference carries no companyId — the server derives it from the
 * authenticated scope, never from the body. */
const opRefSchema = z
  .object({
    kind: z.enum(UNIVERSE_REF_KINDS),
    id: z.string().min(1).max(256),
    version: z.string().min(1).max(256).optional(),
  })
  .strict();

const viewportSchema = z.object({ x: coord, y: coord, zoom }).strict();

/** A single layout mutation. Strict discriminated union — no content bodies,
 * credentials, raw audio, cookies or control tokens ever ride here. */
export const layoutOpSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("open"), key, ref: opRefSchema, rect: rectSchema })
    .strict(),
  z.object({ type: z.literal("geometry"), key, rect: rectSchema }).strict(),
  z.object({ type: z.literal("pin"), key, value: z.boolean() }).strict(),
  z.object({ type: z.literal("minimize"), key, value: z.boolean() }).strict(),
  z.object({ type: z.literal("close"), key }).strict(),
  z
    .object({
      type: z.literal("order"),
      keys: z.array(key).max(UNIVERSE_LAYOUT_MAX_PANELS),
    })
    .strict(),
  z
    .object({ type: z.literal("viewport"), x: coord, y: coord, zoom })
    .strict(),
]);
export type LayoutOp = z.infer<typeof layoutOpSchema>;

/** A client patch: an idempotency key, the revision it expects, and a bounded
 * batch of operations. `schemaVersion` is required and fixed at 1. */
export const layoutPatchSchema = z
  .object({
    schemaVersion: z.literal(UNIVERSE_LAYOUT_SCHEMA_VERSION),
    operationId: z.string().min(1).max(256),
    expectedRevision: z.number().int().gte(0),
    operations: z
      .array(layoutOpSchema)
      .min(1)
      .max(UNIVERSE_LAYOUT_MAX_OPERATIONS),
  })
  .strict();
export type LayoutPatch = z.infer<typeof layoutPatchSchema>;

export type LayoutAck = {
  operationId: string;
  revision: number;
  schemaVersion: typeof UNIVERSE_LAYOUT_SCHEMA_VERSION;
};

/** A stored panel inside a persisted layout document. The ref carries companyId
 * because it has already been resolved server-side against the scope. */
const documentPanelSchema = z
  .object({
    ref: z
      .object({
        companyId: z.string().min(1),
        kind: z.enum(UNIVERSE_REF_KINDS),
        id: z.string().min(1).max(256),
        version: z.string().min(1).max(256).optional(),
      })
      .strict(),
    title: z.string().max(1024),
    rect: rectSchema,
    openedOrdinal: z.number().int().gte(1),
    minimized: z.boolean(),
    pinned: z.boolean(),
    placement: z.enum(["auto", "manual"]).optional(),
  })
  .strict();

/** The persisted presentation snapshot (revision/schemaVersion live in columns). */
export const universeLayoutDocumentSchema = z
  .object({
    panels: z.array(documentPanelSchema).max(UNIVERSE_LAYOUT_MAX_PANELS),
    order: z.array(key).max(UNIVERSE_LAYOUT_MAX_PANELS),
    selected: z.string().nullable(),
    maximized: z.string().nullable(),
    viewport: viewportSchema,
    nextOpenedOrdinal: z.number().int().gte(1),
  })
  .strict();
export type UniverseLayoutDocument = z.infer<
  typeof universeLayoutDocumentSchema
>;

/** An empty starting document (revision 0, nothing open). */
export const emptyUniverseLayoutDocument = (): UniverseLayoutDocument => ({
  panels: [],
  order: [],
  selected: null,
  maximized: null,
  viewport: { x: 0, y: 0, zoom: 1 },
  nextOpenedOrdinal: 1,
});
