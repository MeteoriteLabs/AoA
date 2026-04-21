import { z } from "zod";

export const portabilityIncludeSchema = z
  .object({
    company: z.boolean().optional(),
    agents: z.boolean().optional(),
    projects: z.boolean().optional(),
    issues: z.boolean().optional(),
  })
  .partial();

export const portabilitySecretRequirementSchema = z.object({
  key: z.string().min(1),
  description: z.string().nullable(),
  agentSlug: z.string().min(1).nullable(),
  providerHint: z.string().nullable(),
});

export const portabilityCompanyManifestEntrySchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  brandColor: z.string().nullable(),
  requireBoardApprovalForNewAgents: z.boolean(),
});

export const portabilityAgentManifestEntrySchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  role: z.string().min(1),
  title: z.string().nullable(),
  icon: z.string().nullable(),
  capabilities: z.string().nullable(),
  reportsToSlug: z.string().min(1).nullable(),
  parentType: z.string().min(1).nullable().optional(),
  parentIdRef: z.string().min(1).nullable().optional(),
  adapterType: z.string().min(1),
  adapterConfig: z.record(z.unknown()),
  runtimeConfig: z.record(z.unknown()),
  permissions: z.record(z.unknown()),
  budgetMonthlyCents: z.number().int().nonnegative(),
  metadata: z.record(z.unknown()).nullable(),
});

export const portabilityProjectManifestEntrySchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["department", "project"]),
  description: z.string().nullable().optional(),
  parentSlug: z.string().min(1).nullable().optional(),
  status: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  targetDate: z.string().nullable().optional(),
  leadAgentSlug: z.string().min(1).nullable().optional(),
  functionType: z.string().nullable().optional(),
  executionWorkspacePolicy: z.record(z.unknown()).nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
});

export const portabilityIssueManifestEntrySchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  priority: z.string().nullable().optional(),
  projectSlug: z.string().min(1).nullable().optional(),
  assigneeAgentSlug: z.string().min(1).nullable().optional(),
  assigneeUserEmail: z.string().email().nullable().optional(),
  labelNames: z.array(z.string().min(1)).optional(),
  billingCode: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  identifier: z.string().nullable().optional(),
  recurring: z.boolean().nullable().optional(),
  assigneeAdapterOverrides: z.record(z.unknown()).nullable().optional(),
  executionWorkspaceSettings: z.record(z.unknown()).nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
});

export const portabilityManifestSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    generatedAt: z.string().datetime(),
    source: z
      .object({
        companyId: z.string().uuid(),
        companyName: z.string().min(1),
      })
      .nullable(),
    includes: z
      .object({
        company: z.boolean(),
        agents: z.boolean(),
        projects: z.boolean().optional(),
        issues: z.boolean().optional(),
      })
      .passthrough(),
    company: portabilityCompanyManifestEntrySchema.nullable(),
    agents: z.array(portabilityAgentManifestEntrySchema),
    projects: z.array(portabilityProjectManifestEntrySchema).optional(),
    issues: z.array(portabilityIssueManifestEntrySchema).optional(),
    requiredSecrets: z.array(portabilitySecretRequirementSchema).default([]),
  })
  .passthrough();

export const portabilitySourceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("inline"),
    manifest: portabilityManifestSchema,
    files: z.record(z.string()),
  }),
  z.object({
    type: z.literal("url"),
    url: z.string().url(),
  }),
  z.object({
    type: z.literal("github"),
    url: z.string().url(),
  }),
]);

export const portabilityTargetSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("new_company"),
    newCompanyName: z.string().min(1).optional().nullable(),
  }),
  z.object({
    mode: z.literal("existing_company"),
    companyId: z.string().uuid(),
  }),
]);

export const portabilityAgentSelectionSchema = z.union([
  z.literal("all"),
  z.array(z.string().min(1)),
]);

export const portabilityCollisionStrategySchema = z.enum(["rename", "skip", "replace"]);

export const companyPortabilityExportSchema = z.object({
  include: portabilityIncludeSchema.optional(),
});

export type CompanyPortabilityExport = z.infer<typeof companyPortabilityExportSchema>;

export const companyPortabilityPreviewSchema = z.object({
  source: portabilitySourceSchema,
  include: portabilityIncludeSchema.optional(),
  target: portabilityTargetSchema,
  agents: portabilityAgentSelectionSchema.optional(),
  collisionStrategy: portabilityCollisionStrategySchema.optional(),
});

export type CompanyPortabilityPreview = z.infer<typeof companyPortabilityPreviewSchema>;

export const companyPortabilityImportSchema = companyPortabilityPreviewSchema;

export type CompanyPortabilityImport = z.infer<typeof companyPortabilityImportSchema>;
