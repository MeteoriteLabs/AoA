import type {
  HubItemPriority,
  HubItemStatus,
  HubLane,
  HubSemanticType,
} from "@armyofagents/shared";
import { api } from "./client";

export interface HubItemListRow {
  id: string;
  companyId: string;
  semanticType: HubSemanticType;
  lane: HubLane | null;
  status: HubItemStatus;
  priority: HubItemPriority;
  title: string;
  summary: string | null;
  sourceType: string | null;
  sourceId: string | null;
  ownerUserId: string | null;
  ownerPool: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  readAt: string | null;
  snoozedUntil: string | null;
  dismissedAt: string | null;
}

export interface HubListOptions {
  lane?: HubLane;
  status?: HubItemStatus;
  includeDismissed?: boolean;
  limit?: number;
}

export interface HubCounts {
  open: number;
  unread: number;
}

function listQuery(opts: HubListOptions = {}) {
  const params = new URLSearchParams();
  if (opts.lane) params.set("lane", opts.lane);
  if (opts.status) params.set("status", opts.status);
  if (opts.includeDismissed) params.set("includeDismissed", "true");
  const rawLimit = Number.isFinite(opts.limit) ? opts.limit! : 50;
  params.set("limit", String(Math.min(Math.max(rawLimit, 1), 50)));
  const query = params.toString();
  return query ? `?${query}` : "";
}

export const hubItemsApi = {
  list: (companyId: string, opts?: HubListOptions) =>
    api.get<HubItemListRow[]>(
      `/companies/${companyId}/hub-items${listQuery(opts)}`,
    ),
  counts: (companyId: string) =>
    api.get<HubCounts>(`/companies/${companyId}/hub-items/counts`),
  markRead: (companyId: string, itemId: string) =>
    api.patch(`/companies/${companyId}/hub-items/${itemId}/state`, {
      kind: "read",
    }),
};
