import { z } from "zod";
import { USER_ROLES } from "../constants.js";
import type { HumanSocialLinkType } from "../types/team.js";

export const HUMAN_SOCIAL_LINK_TYPES = [
  "linkedin",
  "github",
  "x",
  "instagram",
  "facebook",
  "substack",
  "website",
  "portfolio",
  "youtube",
  "medium",
  "other",
] as const satisfies readonly HumanSocialLinkType[];

const trimmedNullableString = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .nullable()
    .optional();

const socialLinkLabelSchema = z
  .string()
  .trim()
  .max(80)
  .nullable()
  .optional()
  .transform((value) => (value && value.length > 0 ? value : null));

const humanSocialLinkSchema = z
  .object({
    type: z.enum(HUMAN_SOCIAL_LINK_TYPES),
    label: socialLinkLabelSchema,
    url: z.string().trim().url().max(2048),
  })
  .strict();

export const updateCompanyUserProfileSchema = z
  .object({
    displayName: trimmedNullableString(120),
    title: trimmedNullableString(160),
    bio: trimmedNullableString(2000),
    location: trimmedNullableString(120),
    timezone: trimmedNullableString(80),
    socialLinks: z.array(humanSocialLinkSchema).max(20).optional(),
    avatarAssetId: z.string().uuid().nullable().optional(),
  })
  .strict();

export type UpdateCompanyUserProfile = z.infer<typeof updateCompanyUserProfileSchema>;

export const updateTeamMemberRoleSchema = z.object({
  role: z.enum(USER_ROLES),
  projectId: z.string().uuid().nullable().optional(),
  parentType: z.enum(["user"]).nullable().optional(),
  parentId: z.string().nullable().optional(),
});

export type UpdateTeamMemberRole = z.infer<typeof updateTeamMemberRoleSchema>;

export const addMemberSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(320),
  role: z.enum(USER_ROLES),
  projectId: z.string().uuid().nullable().optional(),
  parentType: z.enum(["user"]).nullable().optional(),
  parentId: z.string().nullable().optional(),
});

export type AddMember = z.infer<typeof addMemberSchema>;

export const transferAdminSchema = z.object({
  toUserId: z.string().min(1),
  confirmation: z.literal("TRANSFER"),
});

export type TransferAdmin = z.infer<typeof transferAdminSchema>;

export const reassignAndRemoveSchema = z.object({
  humanReassignments: z.array(z.object({
    userId: z.string(),
    newParentId: z.string().nullable(),
  })),
  agentReassignments: z.array(z.object({
    agentId: z.string(),
    newParentId: z.string(),
    newParentType: z.literal("user"),
  })),
});

export type ReassignAndRemove = z.infer<typeof reassignAndRemoveSchema>;
