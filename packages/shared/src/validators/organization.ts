import { z } from "zod";
import { ORGANIZATION_ROLES } from "../constants.js";

export const createOrganizationSchema = z.object({
  name: z.string().min(1),
  // Slug is optional at create — the service slugifies the name and de-dupes.
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "slug must be lowercase kebab-case")
    .optional(),
  plan: z.string().optional(),
});
export type CreateOrganization = z.infer<typeof createOrganizationSchema>;

export const inviteToOrganizationSchema = z.object({
  email: z.string().email(),
  role: z.enum(ORGANIZATION_ROLES).default("member"),
});
export type InviteToOrganization = z.infer<typeof inviteToOrganizationSchema>;
