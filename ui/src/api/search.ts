import type {
  SearchEntityType,
  SearchResultsGrouped,
} from "@paperclipai/shared";
import { api } from "./client";

export const searchApi = {
  search: (
    companyId: string,
    q: string,
    types?: SearchEntityType[],
  ) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (types && types.length > 0) params.set("types", types.join(","));
    const qs = params.toString();
    return api.get<SearchResultsGrouped>(`/companies/${companyId}/search${qs ? `?${qs}` : ""}`);
  },
};
