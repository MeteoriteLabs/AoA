import type { MemoryItem } from "@paperclipai/shared";
import { api } from "./client";

export const memoryApi = {
  list: (
    companyId: string,
    filters?: {
      category?: string;
      status?: string;
      source?: string;
      departmentId?: string;
      projectId?: string;
      tags?: string[];
      search?: string;
    },
  ) => {
    const params = new URLSearchParams();
    if (filters?.category) params.set("category", filters.category);
    if (filters?.status) params.set("status", filters.status);
    if (filters?.source) params.set("source", filters.source);
    if (filters?.departmentId) params.set("departmentId", filters.departmentId);
    if (filters?.projectId) params.set("projectId", filters.projectId);
    if (filters?.tags && filters.tags.length > 0) params.set("tags", filters.tags.join(","));
    if (filters?.search) params.set("search", filters.search);
    const qs = params.toString();
    return api.get<MemoryItem[]>(`/companies/${companyId}/memory${qs ? `?${qs}` : ""}`);
  },
  get: (companyId: string, id: string) =>
    api.get<MemoryItem>(`/companies/${companyId}/memory/${id}`),
  create: (companyId: string, data: Record<string, unknown>) =>
    api.post<MemoryItem>(`/companies/${companyId}/memory`, data),
  update: (companyId: string, id: string, data: Record<string, unknown>) =>
    api.patch<MemoryItem>(`/companies/${companyId}/memory/${id}`, data),
  remove: (companyId: string, id: string) =>
    api.delete<MemoryItem>(`/companies/${companyId}/memory/${id}`),
  approve: (companyId: string, id: string) =>
    api.post<MemoryItem>(`/companies/${companyId}/memory/${id}/approve`, {}),
  reject: (companyId: string, id: string) =>
    api.post<MemoryItem>(`/companies/${companyId}/memory/${id}/reject`, {}),
};
