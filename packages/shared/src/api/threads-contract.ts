import { z } from "zod";

// ---- Discussion entry attachments (new field on DiscussionEntry) ----
export const DiscussionEntryAttachmentSchema = z.object({
  id: z.string().uuid(),
  artifactId: z.string().uuid().nullable(),
  assetId: z.string().uuid().nullable(),
  artifactType: z.string().nullable(),
  artifactTitle: z.string().nullable(),
});
export type DiscussionEntryAttachment = z.infer<typeof DiscussionEntryAttachmentSchema>;

// ---- Phase 1 extended DiscussionEntry (adds attachments to existing shape) ----
export const DISCUSSION_ENTRY_INPUT_TYPES_V2 = [
  "paste", "write", "voice", "mcp", "transcript", "document", "routine", "webhook", "integration", "agent",
  // Phase 1 additions:
  "scope_proposal", "system",
] as const;

export const DiscussionEntryV2Schema = z.object({
  id: z.string().uuid(),
  discussionId: z.string().uuid(),
  inputType: z.enum(DISCUSSION_ENTRY_INPUT_TYPES_V2),
  rawContent: z.string(),
  title: z.string().nullable().optional(),
  parentEntryId: z.string().uuid().nullable(),
  authorAgentId: z.string().uuid().nullable(),
  authorAgentName: z.string().nullable(),
  authorAgentAvatar: z.string().nullable(),
  attachments: z.array(DiscussionEntryAttachmentSchema).default([]),
  createdAt: z.string(), // ISO string
  createdBy: z.string(),
});
export type DiscussionEntryV2 = z.infer<typeof DiscussionEntryV2Schema>;

// ---- Scope proposal payload (the JSON body of a scope_proposal entry) ----
export const ProposedTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable(),
  suggestedAssigneeAgentId: z.string().uuid().nullable(),
  suggestedDepartmentId: z.string().uuid().nullable(),
});
export type ProposedTask = z.infer<typeof ProposedTaskSchema>;

export const ScopeProposalPayloadSchema = z.object({
  summary: z.string().min(1),
  proposedTasks: z.array(ProposedTaskSchema).min(1),
  autoAdvanceAt: z.string().nullable(), // ISO string or null
});
export type ScopeProposalPayload = z.infer<typeof ScopeProposalPayloadSchema>;

// ---- Thread visibility (expanded from open|private to private|department|company) ----
export const THREAD_VISIBILITIES_V2 = ["private", "department", "company"] as const;
export const ThreadVisibilitySchema = z.enum(THREAD_VISIBILITIES_V2);
export type ThreadVisibilityV2 = z.infer<typeof ThreadVisibilitySchema>;

// ---- Adapter configuration ----
export const AdapterConfigEntrySchema = z.object({
  adapter: z.string().min(1), // e.g. "claude_local", "codex_local", "gemini_local"
  model: z.string().min(1), // e.g. "claude-sonnet-4-6", "gpt-5.3-codex"
});
export type AdapterConfigEntry = z.infer<typeof AdapterConfigEntrySchema>;

export const CommanderAdapterConfigSchema = AdapterConfigEntrySchema;
export type CommanderAdapterConfig = z.infer<typeof CommanderAdapterConfigSchema>;

export const CrewAdapterConfigSchema = z.object({
  default: AdapterConfigEntrySchema.optional(),
  perAgent: z.record(z.string(), AdapterConfigEntrySchema).optional(),
});
export type CrewAdapterConfig = z.infer<typeof CrewAdapterConfigSchema>;

// ---- Notification types (new Phase 1 types extending existing constants) ----
export const NEW_NOTIFICATION_TYPES = [
  "thread.scope_proposal_posted",
  "thread.artifact_needs_review",
  "thread.crew_failed",
  "thread.spinoff_suggested",
  "thread.human_input_needed",
] as const;
export const NewNotificationTypeSchema = z.enum(NEW_NOTIFICATION_TYPES);
export type NewNotificationType = z.infer<typeof NewNotificationTypeSchema>;
