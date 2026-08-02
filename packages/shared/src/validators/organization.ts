import { z } from "zod";
import { ORGANIZATION_ROLES } from "../constants.js";

export const createOrganizationSchema = z.object({
  name: z.string().min(1),
}).strict();
export type CreateOrganization = z.infer<typeof createOrganizationSchema>;

export const inviteToOrganizationSchema = z.object({
  email: z.string().email(),
  role: z.enum(ORGANIZATION_ROLES).default("member"),
});
export type InviteToOrganization = z.infer<typeof inviteToOrganizationSchema>;
