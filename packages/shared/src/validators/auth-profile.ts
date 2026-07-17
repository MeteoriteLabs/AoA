import { z } from "zod";

export const currentUserProfileSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  /**
   * Whether the acting user can manage instance settings. Computed server-side
   * from the same source of truth as assertCanManageInstanceSettings
   * (instance_user_roles via the auth middleware; always true for the
   * local_trusted synthetic board user). Additive — used by the UI to hide
   * instance-admin-only chrome (e.g. the Lobby "Settings" row).
   */
  isInstanceAdmin: z.boolean(),
});

export type CurrentUserProfile = z.infer<typeof currentUserProfileSchema>;

export const updateCurrentUserProfileSchema = z
  .object({
    displayName: z.string().min(1).max(200).optional(),
    avatarUrl: z.string().url().max(2048).nullable().optional(),
  })
  .strict();

export type UpdateCurrentUserProfile = z.infer<typeof updateCurrentUserProfileSchema>;
