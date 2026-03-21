import { z } from "zod";
import {
  MEMORY_ITEM_CATEGORIES,
  MEMORY_ITEM_SOURCES,
  MEMORY_ITEM_STATUSES,
  MEMORY_ITEM_LAYERS,
  MEMORY_ITEM_VISIBILITY,
} from "../constants.js";

export const createMemoryItemSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  category: z.enum(MEMORY_ITEM_CATEGORIES),
  source: z.enum(MEMORY_ITEM_SOURCES),
  status: z.enum(MEMORY_ITEM_STATUSES).optional(),
  tags: z.array(z.string()).optional().default([]),
  departmentId: z.string().uuid().optional().nullable(),
  projectId: z.string().uuid().optional().nullable(),
  createdBy: z.string().min(1).optional(),
  // V2 fields
  layer: z.enum(MEMORY_ITEM_LAYERS).optional().nullable(),
  priority: z.number().int().optional().default(0),
  visibility: z.enum(MEMORY_ITEM_VISIBILITY).optional().default("scoped"),
  expiresAt: z.string().datetime().optional().nullable(),
  goalId: z.string().uuid().optional().nullable(),
  taskId: z.string().uuid().optional().nullable(),
  sourceArtifactId: z.string().uuid().optional().nullable(),
  sourceContext: z.string().optional().nullable(),
});

export type CreateMemoryItem = z.infer<typeof createMemoryItemSchema>;

export const updateMemoryItemSchema = createMemoryItemSchema
  .omit({ createdBy: true, source: true })
  .partial();

export type UpdateMemoryItem = z.infer<typeof updateMemoryItemSchema>;

export const saveDraftSchema = z.object({
  content: z.string().min(1),
});

export type SaveDraft = z.infer<typeof saveDraftSchema>;

export const createVersionSchema = z.object({
  content: z.string().min(1),
  sourceContext: z.string().optional(),
});

export type CreateVersion = z.infer<typeof createVersionSchema>;
