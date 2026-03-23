import { api } from "./client";

export interface Debrief {
  id: string;
  companyId: string;
  title: string | null;
  inputType: string;
  rawContent: string;
  artifactUrl: string | null;
  departmentId: string | null;
  projectId: string | null;
  goalId: string | null;
  sourceInfo: Record<string, unknown> | null;
  status: string;
  createdBy: string;
  createdAt: string;
}

export const debriefsApi = {
  list: (
    companyId: string,
    filters?: {
      status?: string;
      departmentId?: string;
      inputType?: string;
    },
  ) => {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    if (filters?.departmentId) params.set("departmentId", filters.departmentId);
    if (filters?.inputType) params.set("inputType", filters.inputType);
    const qs = params.toString();
    return api.get<Debrief[]>(`/companies/${companyId}/debriefs${qs ? `?${qs}` : ""}`);
  },
  get: (companyId: string, id: string) =>
    api.get<Debrief>(`/companies/${companyId}/debriefs/${id}`),
  create: (companyId: string, data: Record<string, unknown>) =>
    api.post<Debrief>(`/companies/${companyId}/debriefs`, data),
  update: (companyId: string, id: string, data: Record<string, unknown>) =>
    api.patch<Debrief>(`/companies/${companyId}/debriefs/${id}`, data),
};
