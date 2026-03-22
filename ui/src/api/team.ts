import type { TeamSummary, UpdateTeamMemberRole } from "@paperclipai/shared";
import { api } from "./client";

export const teamApi = {
  get: (companyId: string) => api.get<TeamSummary>(`/companies/${companyId}/team`),
  updateRole: (companyId: string, userId: string, input: UpdateTeamMemberRole) =>
    api.patch<{ role: string | null; projectId: string | null }>(
      `/companies/${companyId}/team/users/${userId}/role`,
      input,
    ),
  removeMember: (companyId: string, userId: string) =>
    api.delete<{ ok: boolean }>(`/companies/${companyId}/team/users/${userId}`),
};
