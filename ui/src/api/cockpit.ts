import type { CockpitData } from "@armyofagents/shared";
import { api } from "./client";

export const cockpitApi = {
  get: (companyId: string) => api.get<CockpitData>(`/companies/${companyId}/cockpit`),
};
