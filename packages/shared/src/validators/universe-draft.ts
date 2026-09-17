import { z } from "zod";

/** Destination kinds a Universe draft can target. The submission itself is owned
 * by the destination's canonical service (Commander/task/etc.); this only scopes
 * where the draft text lives. */
export const UNIVERSE_DRAFT_DESTINATION_KINDS = [
  "commander",
  "task",
  "question",
  "runtime_decision",
  "approval",
] as const;
export type UniverseDraftDestinationKind =
  (typeof UNIVERSE_DRAFT_DESTINATION_KINDS)[number];

export const UNIVERSE_DRAFT_SCHEMA_VERSION = 1;
/** Conservative bounds honouring the Commander composer limit; a destination's
 * own validator may be stricter, never broader. */
export const UNIVERSE_DRAFT_MAX_TEXT = 10_000;
export const UNIVERSE_DRAFT_MAX_ATTACHMENTS = 5;

export const draftDestinationSchema = z
  .object({
    kind: z.enum(UNIVERSE_DRAFT_DESTINATION_KINDS),
    id: z.string().min(1).max(256),
  })
  .strict();
export type UniverseDraftDestination = z.infer<typeof draftDestinationSchema>;

/** A draft write: the revision the client expects plus the new text + validated
 * attachment asset IDs. No client userId/company/conversation is accepted here. */
export const draftPatchSchema = z
  .object({
    schemaVersion: z.literal(UNIVERSE_DRAFT_SCHEMA_VERSION),
    expectedRevision: z.number().int().gte(0),
    text: z.string().max(UNIVERSE_DRAFT_MAX_TEXT),
    attachmentAssetIds: z
      .array(z.string().min(1).max(256))
      .max(UNIVERSE_DRAFT_MAX_ATTACHMENTS),
  })
  .strict();
export type UniverseDraftPatch = z.infer<typeof draftPatchSchema>;

export interface UniverseDraft {
  revision: number;
  text: string;
  attachmentAssetIds: string[];
}
