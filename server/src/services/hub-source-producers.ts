import type { Db } from "@armyofagents/db";
import { hubItemsService, type EmitArgs } from "./hub-items.js";

type ApprovalLike = {
  id: string;
  companyId: string;
  type: string;
  requestedByAgentId: string | null;
  requestedByUserId: string | null;
  payload: Record<string, unknown>;
  updatedAt: SourceUpdatedAt;
};

type SourceUpdatedAt = Date | string;

type JoinRequestLike = {
  id: string;
  companyId: string;
  requestType: string;
  agentName: string | null;
  requestEmailSnapshot: string | null;
  adapterType: string | null;
  updatedAt: SourceUpdatedAt;
};

type DiscussionLike = {
  id: string;
  companyId: string;
  title: string | null;
  ownerUserId: string | null;
  scopeType: string | null;
  scopeId: string | null;
  lastPendingActorType?: "user" | "agent" | null;
  lastPendingActorId?: string | null;
  pendingItemCount: number;
  updatedAt: SourceUpdatedAt;
};

type SuggestionLike = {
  id: string;
  companyId: string;
  title: string;
  evidence: string | null;
  updatedAt: SourceUpdatedAt;
};

type IssueLike = {
  id: string;
  companyId: string;
  title: string;
  assigneeUserId: string | null;
  assigneeAgentId: string | null;
  updatedAt: SourceUpdatedAt;
};

function spaced(value: string) {
  return value.replace(/_/g, " ");
}

function scopeKeyFor(source: { scopeType: string | null; scopeId: string | null }) {
  return source.scopeType && source.scopeId ? source.scopeId : null;
}

function sourceRevision(value: SourceUpdatedAt) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function approvalSummary(approval: ApprovalLike) {
  const agentName =
    typeof approval.payload.name === "string"
      ? approval.payload.name
      : typeof approval.payload.agentName === "string"
        ? approval.payload.agentName
        : null;
  return agentName ? `Agent: ${agentName}` : `Approval type: ${spaced(approval.type)}`;
}

export function buildApprovalHubEmit(approval: ApprovalLike): EmitArgs {
  const actor =
    approval.requestedByAgentId != null
      ? ({ sourceActorType: "agent", sourceActorId: approval.requestedByAgentId } as const)
      : approval.requestedByUserId != null
        ? ({ sourceActorType: "user", sourceActorId: approval.requestedByUserId } as const)
        : {};

  return {
    companyId: approval.companyId,
    semanticType: "approval_request",
    sourceType: "approval",
    sourceId: approval.id,
    title: `Review ${spaced(approval.type)} approval`,
    summary: approvalSummary(approval),
    ownerPool: "board",
    ...actor,
    sourcePermissionRevision: sourceRevision(approval.updatedAt),
  };
}

export function buildJoinRequestHubEmit(request: JoinRequestLike): EmitArgs {
  const subject =
    request.requestType === "agent"
      ? request.agentName ?? `${request.adapterType ?? "Agent"} request`
      : request.requestEmailSnapshot ?? "Human join request";

  return {
    companyId: request.companyId,
    semanticType: "join_request",
    sourceType: "join_request",
    sourceId: request.id,
    title: `Review ${subject}`,
    summary: `${spaced(request.requestType)} join request`,
    ownerPool: "board",
    sourcePermissionRevision: sourceRevision(request.updatedAt),
  };
}

export function buildDiscussionPendingHubEmit(discussion: DiscussionLike): EmitArgs {
  const count = discussion.pendingItemCount;
  const title = discussion.title?.trim() || "Discussion";
  const actor =
    discussion.lastPendingActorType && discussion.lastPendingActorId
      ? {
          sourceActorType: discussion.lastPendingActorType,
          sourceActorId: discussion.lastPendingActorId,
        }
      : {};

  return {
    companyId: discussion.companyId,
    semanticType: "discussion_pending",
    sourceType: "discussion",
    sourceId: discussion.id,
    title: `Review ${count} pending ${count === 1 ? "item" : "items"} in ${title}`,
    summary: `${count} extracted ${count === 1 ? "item needs" : "items need"} review.`,
    ownerUserId: discussion.ownerUserId,
    scopeKey: scopeKeyFor(discussion),
    ...actor,
    sourcePermissionRevision: sourceRevision(discussion.updatedAt),
  };
}

export function buildSuggestionHubEmit(suggestion: SuggestionLike): EmitArgs {
  return {
    companyId: suggestion.companyId,
    semanticType: "suggestion",
    sourceType: "suggestion",
    sourceId: suggestion.id,
    title: suggestion.title,
    summary: suggestion.evidence,
    sourcePermissionRevision: sourceRevision(suggestion.updatedAt),
  };
}

export function buildStaleIssueHubEmit(issue: IssueLike): EmitArgs {
  return {
    companyId: issue.companyId,
    semanticType: "stale_work",
    sourceType: "issue",
    sourceId: issue.id,
    title: `Stale task: ${issue.title}`,
    summary: "No recent human or crew progress.",
    ownerUserId: issue.assigneeUserId,
    ownerPool: issue.assigneeUserId ? undefined : "board",
    sourceActorType: issue.assigneeAgentId ? "agent" : undefined,
    sourceActorId: issue.assigneeAgentId ?? undefined,
    sourcePermissionRevision: sourceRevision(issue.updatedAt),
  };
}

export async function emitHubItem(db: Db, args: EmitArgs) {
  return hubItemsService(db).emit(args);
}
