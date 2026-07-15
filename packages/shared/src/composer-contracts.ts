import { z } from "zod";

export const COMPOSER_SURFACES = ["commander", "discussion", "task"] as const;
export type ComposerSurface = (typeof COMPOSER_SURFACES)[number];

export const COMPOSER_ACTIONS = [
  "send",
  "comment",
  "wake",
  "interrupt-and-send",
  "reopen-and-send",
] as const;
export type ComposerAction = (typeof COMPOSER_ACTIONS)[number];

export const composerMentionSchema = z.object({
  id: z.string().trim().min(1).max(200),
  kind: z.enum(["agent", "human", "project"]),
  label: z.string().trim().min(1).max(200),
  companyId: z.string().trim().min(1).max(200),
});
export type ComposerMention = z.infer<typeof composerMentionSchema>;

export const composerCommandTokenSchema = z.object({
  key: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(200),
});
export type ComposerCommandToken = z.infer<typeof composerCommandTokenSchema>;

export const composerAttachmentRefSchema = z.object({
  id: z.string().trim().min(1).max(200),
  filename: z.string().trim().min(1).max(512),
  contentType: z.string().trim().min(1).max(200),
  byteSize: z.number().int().nonnegative(),
  capability: z.enum(["text-readable", "vision-readable", "stored-only"]),
});
export type ComposerAttachmentRef = z.infer<typeof composerAttachmentRefSchema>;

export const composerSubmissionSchema = z.object({
  clientSubmissionId: z.string().trim().min(1).max(200),
  text: z.string().max(100_000),
  mentions: z.array(composerMentionSchema).max(50),
  commands: z.array(composerCommandTokenSchema).max(20),
  attachments: z.array(composerAttachmentRefSchema).max(5),
  replyTargetId: z.string().trim().min(1).max(200).optional(),
  action: z.enum(COMPOSER_ACTIONS),
});
export type ComposerSubmission = z.infer<typeof composerSubmissionSchema>;

export const composerDraftSchema = z.object({
  version: z.literal(1),
  savedAt: z.number().int().nonnegative(),
  text: z.string().max(100_000),
  mentions: z.array(composerMentionSchema).max(50),
  commands: z.array(composerCommandTokenSchema).max(20),
  attachments: z.array(composerAttachmentRefSchema).max(5),
});
export type ComposerDraft = z.infer<typeof composerDraftSchema>;

export function buildComposerDraftKey(input: {
  companyId: string;
  userId: string;
  surface: ComposerSurface;
  entityId: string;
  replyTargetId?: string | null;
}): string {
  const reply = input.replyTargetId?.trim() || "root";
  return ["aoa", "composer-draft", input.companyId, input.userId, input.surface, input.entityId, reply]
    .map((part) => encodeURIComponent(part))
    .join(":");
}

export function buildComposerIdempotencyKey(input: {
  companyId: string;
  userId: string;
  surface: ComposerSurface;
  entityId: string;
  clientSubmissionId: string;
}): string {
  return ["composer", input.companyId, input.userId, input.surface, input.entityId, input.clientSubmissionId]
    .map((part) => encodeURIComponent(part.trim()))
    .join(":");
}

export function createComposerSubmissionId(randomUuid: () => string = () => crypto.randomUUID()): string {
  return randomUuid();
}
