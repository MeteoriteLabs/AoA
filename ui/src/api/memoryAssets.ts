import { api } from "./client";
import type {
  MemoryAssetRecord,
  MemoryAssetUpdateInput,
} from "@armyofagents/shared";

export const memoryAssetsApi = {
  list: async (
    companyId: string,
    params?: {
      departmentId?: string;
      folderPath?: string;
      mimeType?: string;
    },
  ): Promise<MemoryAssetRecord[]> => {
    const search = new URLSearchParams();
    if (params?.departmentId) search.set("departmentId", params.departmentId);
    if (params?.folderPath) search.set("folderPath", params.folderPath);
    if (params?.mimeType) search.set("mimeType", params.mimeType);
    const qs = search.toString() ? `?${search.toString()}` : "";
    return api.get(`/companies/${companyId}/memory/assets${qs}`);
  },

  get: async (companyId: string, id: string): Promise<MemoryAssetRecord> => {
    return api.get(`/companies/${companyId}/memory/assets/${id}`);
  },

  /** Returns the URL the browser can hit directly to stream content. */
  contentUrl: (companyId: string, id: string): string => {
    return `/api/companies/${companyId}/memory/assets/${id}/content`;
  },

  update: async (
    companyId: string,
    id: string,
    patch: MemoryAssetUpdateInput,
  ): Promise<MemoryAssetRecord> => {
    return api.patch(`/companies/${companyId}/memory/assets/${id}`, patch);
  },

  remove: async (companyId: string, id: string): Promise<void> => {
    return api.delete(`/companies/${companyId}/memory/assets/${id}`);
  },
};
