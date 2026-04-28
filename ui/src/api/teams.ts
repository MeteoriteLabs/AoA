import { api } from "./client";
import type {
  CreateTeamInput,
  UpdateTeamInput,
  AddTeamMemberInput,
  TeamRole,
} from "@armyofagents/shared";

export interface Team {
  id: string;
  companyId: string;
  parentProjectId: string;
  name: string;
  slug: string;
  description: string | null;
  manifest: Record<string, unknown>;
  status: "active" | "archived";
  templateOrigin: string | null;
  templateVersion: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TeamMember {
  id: string;
  teamId: string;
  agentId: string;
  role: TeamRole;
  createdAt: string;
}

export interface TeamCoordination {
  id: string;
  teamId: string;
  name: string;
  markdown: string;
  status: "draft" | "published" | "archived";
}

export const teamsApi = {
  list: (companyId: string, projectId?: string) =>
    api.get<{ items: Team[] }>(
      `/companies/${companyId}/teams${projectId ? `?projectId=${projectId}` : ""}`,
    ),

  get: (teamId: string) => api.get<Team>(`/teams/${teamId}`),

  create: (companyId: string, input: CreateTeamInput) =>
    api.post<Team>(`/companies/${companyId}/teams`, input),

  update: (teamId: string, patch: UpdateTeamInput) =>
    api.patch<Team>(`/teams/${teamId}`, patch),

  archive: (teamId: string) => api.delete<void>(`/teams/${teamId}`),

  listMembers: (teamId: string) =>
    api.get<{ items: TeamMember[] }>(`/teams/${teamId}/members`),

  addMember: (teamId: string, input: AddTeamMemberInput) =>
    api.post<TeamMember>(`/teams/${teamId}/members`, input),

  removeMember: (teamId: string, agentId: string) =>
    api.delete<void>(`/teams/${teamId}/members/${agentId}`),

  updateMemberRole: (teamId: string, agentId: string, role: TeamRole) =>
    api.patch<TeamMember>(`/teams/${teamId}/members/${agentId}`, { role }),

  getCoordination: (teamId: string) =>
    api.get<TeamCoordination | null>(`/teams/${teamId}/coordination`),

  upsertCoordination: (teamId: string, name: string, markdown: string, description?: string) =>
    api.put<TeamCoordination>(`/teams/${teamId}/coordination`, { name, markdown, description }),
};
