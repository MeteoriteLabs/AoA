import type {
  UniverseDraft,
  UniverseDraftDestination,
  UniverseDraftPatch,
} from "@armyofagents/shared";
import { api } from "./client";

function base(
  companyId: string,
  conversationId: string,
  destination: UniverseDraftDestination,
) {
  return `/companies/${companyId}/universe/conversations/${conversationId}/drafts/${
    destination.kind
  }/${encodeURIComponent(destination.id)}`;
}

export const universeDraftApi = {
  get: (
    companyId: string,
    conversationId: string,
    destination: UniverseDraftDestination,
  ) => api.get<UniverseDraft>(base(companyId, conversationId, destination)),
  save: (
    companyId: string,
    conversationId: string,
    destination: UniverseDraftDestination,
    patch: UniverseDraftPatch,
  ) =>
    api.patch<UniverseDraft>(base(companyId, conversationId, destination), patch),
};
