import { z } from "zod";
import { BRIEF_STATUSES, BRIEF_ITEM_TYPES, BRIEF_ITEM_STATUSES } from "../constants.js";

export const updateBriefSchema = z.object({
  status: z.enum(BRIEF_STATUSES).optional(),
  departmentId: z.string().uuid().optional().nullable(),
  projectId: z.string().uuid().optional().nullable(),
  reviewedBy: z.string().optional().nullable(),
});

export type UpdateBrief = z.infer<typeof updateBriefSchema>;

export const createBriefItemSchema = z.object({
  type: z.enum(BRIEF_ITEM_TYPES),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  suggestedAssigneeId: z.string().uuid().optional().nullable(),
  suggestedPriority: z.string().optional().nullable(),
  suggestedDepartmentId: z.string().uuid().optional().nullable(),
  suggestedProjectId: z.string().uuid().optional().nullable(),
});

export type CreateBriefItem = z.infer<typeof createBriefItemSchema>;

export const updateBriefItemSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  suggestedAssigneeId: z.string().uuid().optional().nullable(),
  suggestedPriority: z.string().optional().nullable(),
  suggestedDepartmentId: z.string().uuid().optional().nullable(),
  suggestedProjectId: z.string().uuid().optional().nullable(),
  status: z.enum(BRIEF_ITEM_STATUSES).optional(),
  resultTaskId: z.string().uuid().optional().nullable(),
  resultMemoryId: z.string().uuid().optional().nullable(),
});

export type UpdateBriefItem = z.infer<typeof updateBriefItemSchema>;
