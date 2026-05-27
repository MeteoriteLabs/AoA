import { z } from "zod";
import {
  DISCUSSION_STATUSES,
  DISCUSSION_SCOPE_TYPES,
  DISCUSSION_ENTRY_INPUT_TYPES,
  EXTRACTION_ITEM_TYPES,
  MEMORY_ITEM_LAYERS,
  BRIEF_DEDUP_ACTIONS,
} from "../constants.js";

export const createDiscussionEntrySchema = z.object({
  inputType: z.enum(DISCUSSION_ENTRY_INPUT_TYPES),
  rawContent: z.string().min(1),
  title: z.string().optional().nullable(),
  departmentId: z.string().uuid().optional().nullable(),
  projectId: z.string().uuid().optional().nullable(),
  goalId: z.string().uuid().optional().nullable(),
  sourceInfo: z.record(z.unknown()).optional().nullable(),
  parentEntryId: z.string().uuid().optional().nullable(),
  authorAgentId: z.string().uuid().optional().nullable(),
});

export type CreateDiscussionEntry = z.infer<typeof createDiscussionEntrySchema>;

export const createDiscussionSchema = z.object({
  title: z.string().optional().nullable(),
  scopeType: z.enum(DISCUSSION_SCOPE_TYPES).optional().nullable(),
  scopeId: z.string().uuid().optional().nullable(),
  tags: z.array(z.string()).optional(),
  entry: createDiscussionEntrySchema.optional(),
});

export type CreateDiscussion = z.infer<typeof createDiscussionSchema>;

export const updateDiscussionSchema = z.object({
  title: z.string().optional().nullable(),
  status: z.enum(DISCUSSION_STATUSES).optional(),
  tags: z.array(z.string()).optional(),
  autonomyLevel: z.number().int().min(0).max(3).nullable().optional(),
});

export type UpdateDiscussion = z.infer<typeof updateDiscussionSchema>;

export const approveItemsSchema = z.object({
  items: z.array(
    z.object({
      itemId: z.string().uuid(),
      action: z.enum(["approved", "rejected", "edited"] as const),
      edits: z
        .object({
          title: z.string().min(1).optional(),
          description: z.string().optional().nullable(),
          type: z.enum(EXTRACTION_ITEM_TYPES).optional(),
          priority: z.string().optional().nullable(),
          assigneeId: z.string().uuid().optional().nullable(),
          departmentId: z.string().uuid().optional().nullable(),
          projectId: z.string().uuid().optional().nullable(),
          goalId: z.string().uuid().optional().nullable(),
          layer: z.enum(MEMORY_ITEM_LAYERS).optional().nullable(),
          dedupAction: z.enum(BRIEF_DEDUP_ACTIONS).optional().nullable(),
          selectedMemoryId: z.string().uuid().optional().nullable(),
          mergedContent: z.string().optional().nullable(),
        })
        .optional(),
    }),
  ),
  dependencies: z
    .array(
      z
        .object({
          dependentItemId: z.string().uuid(),
          dependencyItemId: z.string().uuid(),
        })
        .refine((d) => d.dependentItemId !== d.dependencyItemId, {
          message: "A task cannot depend on itself",
        }),
    )
    .optional(),
});

export type ApproveItems = z.infer<typeof approveItemsSchema>;

export const createAnnotationSchema = z.object({
  content: z.string().min(1),
  anchorStart: z.number().int().nonnegative().optional().nullable(),
  anchorEnd: z.number().int().nonnegative().optional().nullable(),
});

export type CreateAnnotation = z.infer<typeof createAnnotationSchema>;
