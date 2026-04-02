import { z } from "zod";
import { USER_ROLES } from "../constants.js";

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
