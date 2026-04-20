import type {
  CurrentUserProfile,
  UpdateCurrentUserProfile,
} from "@paperclipai/shared";
import { api } from "./client";

export const profileApi = {
  get: () => api.get<CurrentUserProfile>("/auth/profile"),
  update: (patch: UpdateCurrentUserProfile) =>
    api.patch<CurrentUserProfile>("/auth/profile", patch),
};
