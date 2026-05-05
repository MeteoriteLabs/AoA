import type { GlobalSearchResponse } from "@armyofagents/shared";
import { api } from "./client";

export const searchApi = {
  global: (
    companyId: string,
    query: string,
    opts?: {
      includeArchived?: boolean;
      limitPerType?: number;
    },
  ) => {
    const params = new URLSearchParams({ q: query });
    if (opts?.includeArchived) params.set("includeArchived", "true");
    if (opts?.limitPerType) params.set("limitPerType", String(opts.limitPerType));
    return api.get<GlobalSearchResponse>(`/companies/${companyId}/search?${params.toString()}`);
  },
};
