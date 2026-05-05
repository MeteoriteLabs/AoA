import { z } from "zod";

export const currentUserProfileSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});

export type CurrentUserProfile = z.infer<typeof currentUserProfileSchema>;

export const updateCurrentUserProfileSchema = z
  .object({
    displayName: z.string().min(1).max(200).optional(),
    avatarUrl: z.string().url().max(2048).nullable().optional(),
  })
  .strict();

export type UpdateCurrentUserProfile = z.infer<typeof updateCurrentUserProfileSchema>;
