import { z } from "zod";
import { USER_ROLES } from "../constants.js";

export const updateTeamMemberRoleSchema = z.object({
  role: z.enum(USER_ROLES),
  projectId: z.string().uuid().nullable().optional(),
});

export type UpdateTeamMemberRole = z.infer<typeof updateTeamMemberRoleSchema>;
