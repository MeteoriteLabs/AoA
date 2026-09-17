import type {
  LayoutAck,
  LayoutPatch,
  UniverseLayoutDocument,
} from "@armyofagents/shared";
import { api } from "./client";

export interface UniverseLayoutResponse {
  schemaVersion: number;
  revision: number;
  document: UniverseLayoutDocument;
}

function base(companyId: string, conversationId: string) {
  return `/companies/${companyId}/universe/conversations/${conversationId}/layout`;
}

export const universeLayoutApi = {
  get: (companyId: string, conversationId: string) =>
    api.get<UniverseLayoutResponse>(base(companyId, conversationId)),
  apply: (companyId: string, conversationId: string, patch: LayoutPatch) =>
    api.patch<LayoutAck>(base(companyId, conversationId), patch),
  receipt: (companyId: string, conversationId: string, operationId: string) =>
    api.get<LayoutAck>(
      `${base(companyId, conversationId)}/operations/${operationId}`,
    ),
};
