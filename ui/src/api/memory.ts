import type { MemoryItem, MemoryItemVersion } from "@paperclipai/shared";
import { api } from "./client";

export type SimilarMemoryItem = MemoryItem & {
  similarity?: number | null;
};

export const memoryApi = {
  list: (
    companyId: string,
    filters?: {
      category?: string;
      status?: string;
      source?: string;
      departmentId?: string;
      projectId?: string;
      layer?: string;
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
    if (filters?.layer) params.set("layer", filters.layer);
    if (filters?.tags && filters.tags.length > 0) params.set("tags", filters.tags.join(","));
    if (filters?.search) params.set("search", filters.search);
    const qs = params.toString();
    return api.get<MemoryItem[]>(`/companies/${companyId}/memory${qs ? `?${qs}` : ""}`);
  },
  get: (companyId: string, id: string) =>
    api.get<MemoryItem>(`/companies/${companyId}/memory/${id}`),
  findSimilarItems: (
    companyId: string,
    content: string,
    filters?: { departmentId?: string; layer?: string },
  ) => {
    const params = new URLSearchParams({ content });
    if (filters?.departmentId) params.set("departmentId", filters.departmentId);
    if (filters?.layer) params.set("layer", filters.layer);
    return api.get<SimilarMemoryItem[]>(
      `/companies/${companyId}/memory/find-similar?${params.toString()}`,
    );
  },
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

  // Version management
  getVersions: (companyId: string, id: string) =>
    api.get<MemoryItemVersion[]>(`/companies/${companyId}/memory/${id}/versions`),
  saveDraft: (companyId: string, id: string, content: string) =>
    api.post<MemoryItemVersion>(`/companies/${companyId}/memory/${id}/draft`, { content }),
  publishDraft: (companyId: string, id: string) =>
    api.post<MemoryItemVersion>(`/companies/${companyId}/memory/${id}/publish`, {}),
  restore: (companyId: string, id: string) =>
    api.post<MemoryItem>(`/companies/${companyId}/memory/${id}/restore`, {}),
  touchAccessedAt: (companyId: string, id: string) =>
    api.post<MemoryItem>(`/companies/${companyId}/memory/${id}/touch`, {}),
  searchSemantic: (
    companyId: string,
    q: string,
    filters?: {
      layer?: string;
      departmentId?: string;
      limit?: number;
    },
  ) => {
    const params = new URLSearchParams();
    params.set("q", q);
    if (filters?.layer) params.set("layer", filters.layer);
    if (filters?.departmentId) params.set("departmentId", filters.departmentId);
    if (filters?.limit !== undefined) params.set("limit", String(filters.limit));
    return api.get<Array<MemoryItem & { similarity: number | null }>>(
      `/companies/${companyId}/memory/search?${params.toString()}`,
    );
  },
};
