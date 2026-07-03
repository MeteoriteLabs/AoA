import type { ViewerTabBase } from "../../lib/viewer-tabs";

export type HubTabKind =
  | "home"
  | "browser"
  | "approval"
  | "join_request"
  | "thread"
  | "runtime_decision"
  | "task"
  | "task_output"
  | "agent"
  | "run"
  | "artifact"
  | "memory"
  | "budget"
  | "suggestion"
  | "marketplace_op"
  | "reminder"
  | "routine"
  | "notification";

export interface HubApprovalPayload {
  approvalId: string;
}

export interface HubJoinRequestPayload {
  joinRequestId: string;
}

export interface HubThreadPayload {
  discussionId: string;
  entryId?: string;
}

export interface HubRuntimeDecisionPayload {
  hubItemId: string;
}

export interface HubTaskPayload {
  issueId: string;
}

export interface HubAgentPayload {
  agentId: string;
}

export interface HubRunPayload {
  runId: string;
  agentId: string;
}

export interface HubBudgetPayload {
  scope: "company";
}

export interface HubSuggestionPayload {
  suggestionId: string;
}

export interface HubMarketplaceOpPayload {
  sourceId: string;
}

export interface HubReminderPayload {
  reminderId: string;
}

export interface HubBrowserPayload {
  url: string;
}

export interface HubNotificationPayload {
  hubItemId: string;
}

export type HubTabPayload =
  | HubApprovalPayload
  | HubJoinRequestPayload
  | HubThreadPayload
  | HubRuntimeDecisionPayload
  | HubTaskPayload
  | HubAgentPayload
  | HubRunPayload
  | HubBudgetPayload
  | HubSuggestionPayload
  | HubMarketplaceOpPayload
  | HubReminderPayload
  | HubBrowserPayload
  | HubNotificationPayload;

export interface HubTab extends ViewerTabBase {
  kind: HubTabKind;
  title: string;
  payload?: HubTabPayload;
}

const TRAILING_URL_PUNCTUATION = /[.,!?;:)\]}]+$/;

export const HOME_TAB: HubTab = {
  key: "home",
  kind: "home",
  title: "Home",
  closeable: false,
};

export function approvalTab(approvalId: string, title?: string): HubTab {
  return {
    key: `approval:${approvalId}`,
    kind: "approval",
    title: title || "Approval",
    closeable: true,
    payload: { approvalId } satisfies HubApprovalPayload,
  };
}

export function joinRequestTab(joinRequestId: string, title?: string): HubTab {
  return {
    key: `join_request:${joinRequestId}`,
    kind: "join_request",
    title: title || "Join request",
    closeable: true,
    payload: { joinRequestId } satisfies HubJoinRequestPayload,
  };
}

export function threadTab(discussionId: string, title?: string, entryId?: string): HubTab {
  return {
    key: `thread:${discussionId}`,
    kind: "thread",
    title: title || "Discussion",
    closeable: true,
    payload: { discussionId, entryId } satisfies HubThreadPayload,
  };
}

export function runtimeDecisionTab(hubItemId: string, title?: string): HubTab {
  return {
    key: `runtime_decision:${hubItemId}`,
    kind: "runtime_decision",
    title: title || "Runtime decision",
    closeable: true,
    payload: { hubItemId } satisfies HubRuntimeDecisionPayload,
  };
}

export function taskTab(issueId: string, title?: string): HubTab {
  return {
    key: `task:${issueId}`,
    kind: "task",
    title: title || "Task",
    closeable: true,
    payload: { issueId } satisfies HubTaskPayload,
  };
}

export function agentTab(agentId: string, title?: string): HubTab {
  return {
    key: `agent:${agentId}`,
    kind: "agent",
    title: title || "Agent",
    closeable: true,
    payload: { agentId } satisfies HubAgentPayload,
  };
}

export function runTab(runId: string, agentId: string, title?: string): HubTab {
  return {
    key: `run:${runId}`,
    kind: "run",
    title: title || "Run",
    closeable: true,
    payload: { runId, agentId } satisfies HubRunPayload,
  };
}

export function budgetTab(title?: string): HubTab {
  return {
    key: "budget:company",
    kind: "budget",
    title: title || "Budget",
    closeable: true,
    payload: { scope: "company" } satisfies HubBudgetPayload,
  };
}

export function suggestionTab(suggestionId: string, title?: string): HubTab {
  return {
    key: `suggestion:${suggestionId}`,
    kind: "suggestion",
    title: title || "Suggestion",
    closeable: true,
    payload: { suggestionId } satisfies HubSuggestionPayload,
  };
}

export function marketplaceOpTab(sourceId: string, title?: string): HubTab {
  return {
    key: `marketplace_op:${sourceId}`,
    kind: "marketplace_op",
    title: title || "Marketplace",
    closeable: true,
    payload: { sourceId } satisfies HubMarketplaceOpPayload,
  };
}

export function reminderTab(reminderId: string, title?: string): HubTab {
  return {
    key: `reminder:${reminderId}`,
    kind: "reminder",
    title: title || "Reminder",
    closeable: true,
    payload: { reminderId } satisfies HubReminderPayload,
  };
}

export function browserTab(url: string, title?: string): HubTab {
  const normalizedUrl = normalizeUrl(url);
  return {
    key: `browser:${normalizedUrl}`,
    kind: "browser",
    title: title || browserLabel(normalizedUrl),
    closeable: true,
    payload: { url: normalizedUrl } satisfies HubBrowserPayload,
  };
}

/** Generic fallback tab for hub items without a dedicated viewer. */
export function notificationTab(hubItemId: string, title?: string): HubTab {
  return {
    key: `notification:${hubItemId}`,
    kind: "notification",
    title: title || "Notification",
    closeable: true,
    payload: { hubItemId } satisfies HubNotificationPayload,
  };
}

function normalizeUrl(url: string): string {
  const trimmed = url.replace(TRAILING_URL_PUNCTUATION, "");
  try {
    return new URL(trimmed).toString();
  } catch {
    return trimmed.trim();
  }
}

function browserLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || "Browser";
  } catch {
    return "Browser";
  }
}
