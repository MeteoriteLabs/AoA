import { api } from "./client";

export interface FsBrowseEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isGitRepo: boolean;
}

export interface FsBrowseResult {
  currentPath: string;
  parentPath: string | null;
  homePath: string;
  platform: string;
  entries: FsBrowseEntry[];
}

export interface FsDrive {
  name: string;
  path: string;
}

export interface FsDrivesResult {
  drives: FsDrive[];
  platform: string;
}

export const filesystemApi = {
  browse: async (
    dirPath?: string,
    opts?: { gitAware?: boolean; includeFiles?: boolean; extensions?: string[] },
  ): Promise<FsBrowseResult> => {
    const params = new URLSearchParams();
    if (dirPath) params.set("path", dirPath);
    if (opts?.gitAware) params.set("gitAware", "true");
    if (opts?.includeFiles) params.set("includeFiles", "true");
    if (opts?.extensions?.length) params.set("extensions", opts.extensions.join(","));
    const qs = params.toString();
    return api.get(`/filesystem/browse${qs ? `?${qs}` : ""}`);
  },

  mkdir: async (dirPath: string): Promise<{ created: boolean; path: string }> => {
    return api.post("/filesystem/mkdir", { path: dirPath });
  },

  home: async (): Promise<{ homePath: string; platform: string }> => {
    return api.get("/filesystem/home");
  },

  drives: async (): Promise<FsDrivesResult> => {
    return api.get("/filesystem/drives");
  },
};
