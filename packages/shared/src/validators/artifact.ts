import { z } from "zod";
import { ARTIFACT_TYPES, ARTIFACT_STATUSES, ARTIFACT_VERSION_SOURCES } from "../constants.js";

export const createArtifactSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  type: z.enum(ARTIFACT_TYPES),
  // Initial version fields (optional — artifact can be created without a version)
  source: z.enum(ARTIFACT_VERSION_SOURCES).optional(),
  sourceDetail: z.string().optional().nullable(),
  changelog: z.string().optional().nullable(),
  content: z.string().optional().nullable(),
  fileUrl: z.string().optional().nullable(),
});

export type CreateArtifact = z.infer<typeof createArtifactSchema>;

export const updateArtifactSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  type: z.enum(ARTIFACT_TYPES).optional(),
  status: z.enum(ARTIFACT_STATUSES).optional(),
});

export type UpdateArtifact = z.infer<typeof updateArtifactSchema>;

export const createArtifactVersionSchema = z.object({
  source: z.enum(ARTIFACT_VERSION_SOURCES),
  sourceDetail: z.string().optional().nullable(),
  changelog: z.string().optional().nullable(),
  parentVersionId: z.string().uuid().optional().nullable(),
  content: z.string().optional().nullable(),
  fileUrl: z.string().optional().nullable(),
});

export type CreateArtifactVersion = z.infer<typeof createArtifactVersionSchema>;

/** MCP-specific artifact version push — source is always "mcp", sourceDetail required */
export const mcpArtifactVersionSchema = z.object({
  sourceDetail: z.string().min(1, "MCP client identity is required"),
  changelog: z.string().optional().nullable(),
  parentVersionId: z.string().uuid().optional().nullable(),
  content: z.string().optional().nullable(),
  fileUrl: z.string().optional().nullable(),
});

export type McpArtifactVersion = z.infer<typeof mcpArtifactVersionSchema>;
