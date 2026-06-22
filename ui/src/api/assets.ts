import type { AssetImage } from "@armyofagents/shared";
import { api } from "./client";

export interface AssetFileResponse {
  assetId: string;
  companyId: string;
  provider: string;
  objectKey: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  originalFilename: string | null;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  contentPath: string;
}

export const assetsApi = {
  uploadImage: async (companyId: string, file: File, namespace?: string) => {
    // Read file data into memory eagerly so the fetch body is self-contained.
    // Clipboard-paste File objects reference transient data that the browser may
    // discard after the paste-event handler returns, causing ERR_ACCESS_DENIED
    // when fetch() later tries to stream the FormData body.
    const buffer = await file.arrayBuffer();
    const safeFile = new File([buffer], file.name, { type: file.type });

    const form = new FormData();
    form.append("file", safeFile);
    if (namespace && namespace.trim().length > 0) {
      form.append("namespace", namespace.trim());
    }
    return api.postForm<AssetImage>(`/companies/${companyId}/assets/images`, form);
  },

  /**
   * Phase E1: upload any file (up to AOA_FILE_MAX_BYTES, default 50 MB) for
   * attachment to a discussion entry. Used by the thread composer's paperclip
   * button. Returns the new asset record.
   */
  uploadFile: async (companyId: string, file: File, namespace?: string) => {
    const buffer = await file.arrayBuffer();
    const safeFile = new File([buffer], file.name, { type: file.type });
    const form = new FormData();
    form.append("file", safeFile);
    if (namespace && namespace.trim().length > 0) {
      form.append("namespace", namespace.trim());
    }
    return api.postForm<AssetFileResponse>(
      `/companies/${companyId}/assets/files`,
      form,
    );
  },
};

