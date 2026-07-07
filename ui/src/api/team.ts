import type {
  AddMember,
  CompanyUserProfile,
  MemberDependencies,
  TeamMemberSummary,
  TeamSummary,
  TransferAdmin,
  ReassignAndRemove,
  UpdateTeamMemberRole,
  UpdateCompanyUserProfile,
} from "@armyofagents/shared";
import { api } from "./client";

export const teamApi = {
  get: (companyId: string) => api.get<TeamSummary>(`/companies/${companyId}/team`),
  updateRole: (companyId: string, userId: string, input: UpdateTeamMemberRole) =>
    api.patch<{ role: string | null; projectId: string | null; parentType: string | null; parentId: string | null }>(
      `/companies/${companyId}/team/users/${userId}/role`,
      input,
    ),
  updateProfile: (companyId: string, userId: string, input: UpdateCompanyUserProfile) =>
    api.patch<{ profile: CompanyUserProfile }>(`/companies/${companyId}/team/users/${userId}/profile`, input),
  removeMember: (companyId: string, userId: string) =>
    api.delete<{ ok: true }>(`/companies/${companyId}/team/users/${userId}`),
  addMember: (companyId: string, input: AddMember) =>
    api.post<{ userId: string }>(`/companies/${companyId}/team/members`, input),
  getMember: (companyId: string, userId: string) =>
    api.get<{ member: TeamMemberSummary; dependencies: MemberDependencies }>(
      `/companies/${companyId}/team/users/${userId}`,
    ),
  getDependencies: (companyId: string, userId: string) =>
    api.get<MemberDependencies>(`/companies/${companyId}/team/users/${userId}/dependencies`),
  transferAdmin: (companyId: string, input: TransferAdmin) =>
    api.post<{ ok: true }>(`/companies/${companyId}/team/transfer-admin`, input),
  reassignAndRemove: (companyId: string, userId: string, input: ReassignAndRemove) =>
    api.post<{ ok: true }>(`/companies/${companyId}/team/users/${userId}/reassign-and-remove`, input),
  revokeInvite: (companyId: string, inviteId: string) =>
    api.patch<{ ok: true }>(`/companies/${companyId}/invites/${inviteId}/revoke`, {}),
  resendInvite: (companyId: string, inviteId: string) =>
    api.post<{ inviteId: string; token: string }>(`/companies/${companyId}/invites/${inviteId}/resend`, {}),
};
