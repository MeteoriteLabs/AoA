import type { CockpitPinnedEntityType } from "@armyofagents/shared";
import { api } from "./client";

export const pinsApi = {
  pin: (companyId: string, entityType: CockpitPinnedEntityType, entityId: string) =>
    api.post<void>(`/companies/${companyId}/pins`, { entityType, entityId }),

  unpin: (companyId: string, entityType: CockpitPinnedEntityType, entityId: string) =>
    api.delete<void>(`/companies/${companyId}/pins/${entityType}/${entityId}`),
};
