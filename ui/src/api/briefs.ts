import { api } from "./client";

export interface Brief {
  id: string;
  companyId: string;
  debriefId: string;
  status: string;
  departmentId: string | null;
  projectId: string | null;
  goalId: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  createdAt: string;
  updatedAt: string;
  sourceType: string | null;
  departmentName: string | null;
  projectName: string | null;
  itemCount: number;
}

export interface BriefItem {
  id: string;
  briefId: string;
  type: string;
  title: string;
  description: string | null;
  suggestedAssigneeId: string | null;
  suggestedPriority: string | null;
  suggestedDepartmentId: string | null;
  suggestedProjectId: string | null;
  suggestedLayer: string | null;
  layer: string | null;
  dedupAction: "update_existing" | "create_separate" | "replace" | null;
  selectedMemoryId: string | null;
  mergedContent: string | null;
  status: string;
  resultTaskId: string | null;
  resultMemoryId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BriefWithItems extends Brief {
  items: BriefItem[];
}

export interface BriefApproveResult {
  brief: Brief;
  createdTaskIds: string[];
  createdMemoryIds: string[];
  createdDependencyCount: number;
  skippedDependencyCount: number;
}

export const briefsApi = {
  list: (
    companyId: string,
    filters?: {
      status?: string;
      departmentId?: string;
    },
  ) => {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    if (filters?.departmentId) params.set("departmentId", filters.departmentId);
    const qs = params.toString();
    return api.get<Brief[]>(`/companies/${companyId}/briefs${qs ? `?${qs}` : ""}`);
  },
  get: (companyId: string, id: string) =>
    api.get<BriefWithItems>(`/companies/${companyId}/briefs/${id}`),
  update: (companyId: string, id: string, data: Record<string, unknown>) =>
    api.patch<Brief>(`/companies/${companyId}/briefs/${id}`, data),
  updateItem: (
    companyId: string,
    briefId: string,
    itemId: string,
    data: Record<string, unknown>,
  ) =>
    api.patch<BriefItem>(
      `/companies/${companyId}/briefs/${briefId}/items/${itemId}`,
      data,
    ),
  approve: (
    companyId: string,
    briefId: string,
    dependencies?: Array<{ dependentItemId: string; dependencyItemId: string }>,
  ) =>
    api.post<BriefApproveResult>(
      `/companies/${companyId}/briefs/${briefId}/approve`,
      { dependencies },
    ),
};
