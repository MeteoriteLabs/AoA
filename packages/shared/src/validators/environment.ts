import { z } from "zod";

export const environmentTargetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("local") }),
  z.object({
    type: z.literal("sandbox-docker"),
    image: z.string().min(1),
    workdir: z.string().min(1).optional().nullable(),
    shell: z.enum(["sh", "bash"]).optional().nullable(),
    network: z.enum(["bridge", "host", "none"]).optional().nullable(),
    remove: z.boolean().optional(),
    env: z.record(z.string()).optional(),
    installCommand: z.string().optional().nullable(),
  }),
]);

export const createEnvironmentSchema = z.object({
  name: z.string().min(1).max(100),
  envVars: z.record(z.unknown()).optional().default({}),
  connectionTarget: z.record(z.unknown()).optional().nullable(),
  target: environmentTargetSchema.optional().nullable(),
});

export const updateEnvironmentSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  envVars: z.record(z.unknown()).optional(),
  connectionTarget: z.record(z.unknown()).optional().nullable(),
  target: environmentTargetSchema.optional().nullable(),
});

export type CreateEnvironmentInput = z.infer<typeof createEnvironmentSchema>;
export type UpdateEnvironmentInput = z.infer<typeof updateEnvironmentSchema>;
