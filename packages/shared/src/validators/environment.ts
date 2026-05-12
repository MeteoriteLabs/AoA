import { z } from "zod";

export const createEnvironmentSchema = z.object({
  name: z.string().min(1).max(100),
  envVars: z.record(z.unknown()).optional().default({}),
  connectionTarget: z.record(z.unknown()).optional().nullable(),
});

export const updateEnvironmentSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  envVars: z.record(z.unknown()).optional(),
  connectionTarget: z.record(z.unknown()).optional().nullable(),
});

export type CreateEnvironmentInput = z.infer<typeof createEnvironmentSchema>;
export type UpdateEnvironmentInput = z.infer<typeof updateEnvironmentSchema>;
