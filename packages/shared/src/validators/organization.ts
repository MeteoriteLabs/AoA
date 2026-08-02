import { z } from "zod";
import { ORGANIZATION_ROLES } from "../constants.js";

// Reject terminal controls and format characters that can reorder or hide an
// organization name. ZWNJ/ZWJ (U+200C/U+200D) remain allowed because they are
// meaningful in several writing systems; identity and authorization use IDs.
const UNSAFE_ORGANIZATION_NAME_CHARACTERS =
  /[\u0000-\u001F\u007F-\u009F\u061C\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/u;

export const createOrganizationSchema = z.object({
  name: z
    .string()
    .refine(
      (value) => !UNSAFE_ORGANIZATION_NAME_CHARACTERS.test(value),
      "name contains invalid or invisible characters",
    )
    .transform((value) => value.trim().normalize("NFC"))
    .pipe(z.string().min(1).max(100)),
}).strict();
export type CreateOrganization = z.infer<typeof createOrganizationSchema>;

export const inviteToOrganizationSchema = z.object({
  email: z.string().email(),
  role: z.enum(ORGANIZATION_ROLES).default("member"),
});
export type InviteToOrganization = z.infer<typeof inviteToOrganizationSchema>;
