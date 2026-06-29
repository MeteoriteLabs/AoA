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
  claimedByUserId: string | null;
  claimedAt: string | null;
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
  includeSnoozed?: boolean;
  limit?: number;
}

export interface HubCounts {
  open: number;
  unread: number;
}

export type HubPersonalState =
  | { kind: "read" }
  | { kind: "unread" }
  | { kind: "snooze"; until: string }
  | { kind: "unsnooze" }
  | { kind: "dismiss" }
  | { kind: "undismiss" };

export interface HubItemUserState {
  id: string;
  companyId: string;
  hubItemId: string;
  principalType: "user";
  principalId: string;
  readAt: string | null;
  snoozedUntil: string | null;
  dismissedAt: string | null;
  updatedAt: string;
}

export interface HubLifecycleActionPayload {
  action: "resolve" | "archive" | "claim" | "release";
  expectedVersion: number;
  idempotencyKey?: string;
  reason?: string;
}

export interface HubLifecycleActionResult {
  item: HubItemListRow;
  auditId: string;
  undoDeadline: string | null;
}

export interface HubUndoPayload {
  auditId: string;
  expectedVersion: number;
}

export interface HubUndoResult {
  item: HubItemListRow;
  auditId: string;
}

export type HubBulkActionItem =
  | ({
      id: string;
      action: "resolve" | "archive" | "claim" | "release";
      expectedVersion: number;
    } & Pick<HubLifecycleActionPayload, "idempotencyKey" | "reason">)
  | {
      id: string;
      action: "dismiss";
      idempotencyKey?: string;
      reason?: string;
    }
  | {
      id: string;
      action: "snooze";
      until: string;
      idempotencyKey?: string;
      reason?: string;
    };

export interface HubBulkActionPayload {
  bulkId?: string;
  items: HubBulkActionItem[];
}

export interface HubBulkActionResult {
  bulkId: string;
  summary: { succeeded: number; failed: number; skipped: number };
  results: Array<{
    id: string;
    status: "success" | "failed" | "skipped";
    item?: HubItemListRow;
    state?: HubItemUserState;
    auditId?: string;
    undoDeadline?: string | null;
    error?: { status: number; message: string; code?: string };
  }>;
}

export interface HubAuditRow {
  id: string;
  companyId: string;
  hubItemId: string | null;
  actorType: string;
  actorId: string;
  action: string;
  authorityBasis: string | null;
  reason: string | null;
  undoDeadline: string | null;
  createdAt: string;
}

function listQuery(opts: HubListOptions = {}) {
  const params = new URLSearchParams();
  if (opts.lane) params.set("lane", opts.lane);
  if (opts.status) params.set("status", opts.status);
  if (opts.includeDismissed) params.set("includeDismissed", "true");
  if (opts.includeSnoozed) params.set("includeSnoozed", "true");
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
  markUnread: (companyId: string, itemId: string) =>
    api.patch(`/companies/${companyId}/hub-items/${itemId}/state`, {
      kind: "unread",
    }),
  snooze: (companyId: string, itemId: string, until: string) =>
    api.patch(`/companies/${companyId}/hub-items/${itemId}/state`, {
      kind: "snooze",
      until,
    }),
  unsnooze: (companyId: string, itemId: string) =>
    api.patch(`/companies/${companyId}/hub-items/${itemId}/state`, {
      kind: "unsnooze",
    }),
  dismiss: (companyId: string, itemId: string) =>
    api.patch(`/companies/${companyId}/hub-items/${itemId}/state`, {
      kind: "dismiss",
    }),
  undismiss: (companyId: string, itemId: string) =>
    api.patch(`/companies/${companyId}/hub-items/${itemId}/state`, {
      kind: "undismiss",
    }),
  act: (companyId: string, itemId: string, payload: HubLifecycleActionPayload) =>
    api.post<HubLifecycleActionResult>(
      `/companies/${companyId}/hub-items/${itemId}/action`,
      payload,
    ),
  undo: (companyId: string, itemId: string, payload: HubUndoPayload) =>
    api.post<HubUndoResult>(
      `/companies/${companyId}/hub-items/${itemId}/undo`,
      payload,
    ),
  bulkAction: (companyId: string, payload: HubBulkActionPayload) =>
    api.post<HubBulkActionResult>(
      `/companies/${companyId}/hub-items/bulk-action`,
      payload,
    ),
  audit: (companyId: string, itemId: string) =>
    api.get<HubAuditRow[]>(`/companies/${companyId}/hub-items/${itemId}/audit`),
};
