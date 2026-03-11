import { z } from "zod";
import { MEMORY_ITEM_CATEGORIES, MEMORY_ITEM_SOURCES, MEMORY_ITEM_STATUSES } from "../constants.js";

export const createMemoryItemSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  category: z.enum(MEMORY_ITEM_CATEGORIES),
  source: z.enum(MEMORY_ITEM_SOURCES),
  status: z.enum(MEMORY_ITEM_STATUSES).optional().default("pending"),
  tags: z.array(z.string()).optional().default([]),
  departmentId: z.string().uuid().optional().nullable(),
  projectId: z.string().uuid().optional().nullable(),
  createdBy: z.string().min(1),
});

export type CreateMemoryItem = z.infer<typeof createMemoryItemSchema>;

export const updateMemoryItemSchema = createMemoryItemSchema
  .omit({ createdBy: true, source: true })
  .partial();

export type UpdateMemoryItem = z.infer<typeof updateMemoryItemSchema>;
