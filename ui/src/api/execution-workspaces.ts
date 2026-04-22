import type {
  ExecutionWorkspace,
  ExecutionWorkspaceCloseReadiness,
  ExecutionWorkspaceSummary,
} from "@paperclipai/shared";
import { api } from "./client";

export interface WorkspaceRuntimeService {
  id: string;
  serviceName: string;
  status: string;
  port: number | null;
  url: string | null;
  command: string | null;
  cwd: string | null;
  provider: string;
  lifecycle: string;
  startedAt: string | null;
  stoppedAt: string | null;
}

export const executionWorkspacesApi = {
  list: (
    companyId: string,
    filters?: {
      projectId?: string;
      projectWorkspaceId?: string;
      issueId?: string;
      status?: string;
      reuseEligible?: boolean;
    },
  ) => {
    const params = new URLSearchParams();
    if (filters?.projectId) params.set("projectId", filters.projectId);
    if (filters?.projectWorkspaceId) params.set("projectWorkspaceId", filters.projectWorkspaceId);
    if (filters?.issueId) params.set("issueId", filters.issueId);
    if (filters?.status) params.set("status", filters.status);
    if (filters?.reuseEligible) params.set("reuseEligible", "true");
    const qs = params.toString();
    return api.get<ExecutionWorkspace[]>(`/companies/${companyId}/execution-workspaces${qs ? `?${qs}` : ""}`);
  },
  listSummaries: (
    companyId: string,
    filters?: {
      projectId?: string;
      projectWorkspaceId?: string;
      issueId?: string;
      status?: string;
      reuseEligible?: boolean;
    },
  ) => {
    const params = new URLSearchParams({ summary: "true" });
    if (filters?.projectId) params.set("projectId", filters.projectId);
    if (filters?.projectWorkspaceId) params.set("projectWorkspaceId", filters.projectWorkspaceId);
    if (filters?.issueId) params.set("issueId", filters.issueId);
    if (filters?.status) params.set("status", filters.status);
    if (filters?.reuseEligible) params.set("reuseEligible", "true");
    return api.get<ExecutionWorkspaceSummary[]>(
      `/companies/${companyId}/execution-workspaces?${params.toString()}`,
    );
  },
  get: (id: string) => api.get<ExecutionWorkspace>(`/execution-workspaces/${id}`),
  update: (id: string, data: Record<string, unknown>) =>
    api.patch<ExecutionWorkspace>(`/execution-workspaces/${id}`, data),
  runtimeServices: (workspaceId: string) =>
    api.get<WorkspaceRuntimeService[]>(`/execution-workspaces/${workspaceId}/runtime-services`),
  getCloseReadiness: (id: string) =>
    api.get<ExecutionWorkspaceCloseReadiness>(`/execution-workspaces/${id}/close-readiness`),
};
