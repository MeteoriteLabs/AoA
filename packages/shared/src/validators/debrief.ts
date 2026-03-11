import { z } from "zod";
import { DEBRIEF_INPUT_TYPES, DEBRIEF_STATUSES } from "../constants.js";

export const createDebriefSchema = z.object({
  title: z.string().optional().nullable(),
  inputType: z.enum(DEBRIEF_INPUT_TYPES),
  rawContent: z.string().min(1),
  artifactUrl: z.string().optional().nullable(),
  departmentId: z.string().uuid().optional().nullable(),
  projectId: z.string().uuid().optional().nullable(),
  sourceInfo: z.record(z.unknown()).optional().nullable(),
});

export type CreateDebrief = z.infer<typeof createDebriefSchema>;

export const updateDebriefSchema = z.object({
  title: z.string().optional().nullable(),
  status: z.enum(DEBRIEF_STATUSES).optional(),
  departmentId: z.string().uuid().optional().nullable(),
  projectId: z.string().uuid().optional().nullable(),
});

export type UpdateDebrief = z.infer<typeof updateDebriefSchema>;
