import { z } from "zod";
import { AGENT_COMPLETION_POLICIES, COMPANY_STATUSES } from "../constants.js";
import {
  CommanderAdapterConfigSchema,
  CrewAdapterConfigSchema,
} from "../api/threads-contract.js";

export const createCompanySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  budgetMonthlyCents: z.number().int().nonnegative().optional().default(0),
  rootFolder: z.string().min(1).optional().nullable(),
  // Phase 1 Phase E batch 2 (T20): OnboardingWizard now collects Commander +
  // Crew adapter picks at company-create time. Both are optional — when
  // omitted, the companies row keeps its `{}` default and downstream code
  // (resolveCrewAdapterForCompany) falls back to internal_agent_config.
  commanderAdapterConfig: CommanderAdapterConfigSchema.optional(),
  crewAdapterConfig: CrewAdapterConfigSchema.optional(),
});

export type CreateCompany = z.infer<typeof createCompanySchema>;

export const updateCompanySchema = createCompanySchema
  .partial()
  .extend({
    status: z.enum(COMPANY_STATUSES).optional(),
    spentMonthlyCents: z.number().int().nonnegative().optional(),
    requireBoardApprovalForNewAgents: z.boolean().optional(),
    brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
    logoAssetId: z.string().uuid().nullable().optional(),
    vision: z.string().nullable().optional(),
    mission: z.string().nullable().optional(),
    values: z.string().nullable().optional(),
    mcpEnabled: z.boolean().optional(),
    agentCompletionPolicyDefault: z.enum(AGENT_COMPLETION_POLICIES).optional(),
    agentCompletionReviewGuardrail: z.boolean().optional(),
  });

export type UpdateCompany = z.infer<typeof updateCompanySchema>;
