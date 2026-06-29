import type { Db } from "@armyofagents/db";
import { hubItemsService, type EmitArgs } from "./hub-items.js";

type ApprovalLike = {
  id: string;
  companyId: string;
  type: string;
  requestedByAgentId: string | null;
  requestedByUserId: string | null;
  payload: Record<string, unknown>;
  updatedAt: Date;
};

type JoinRequestLike = {
  id: string;
  companyId: string;
  requestType: string;
  agentName: string | null;
  requestEmailSnapshot: string | null;
  adapterType: string | null;
  updatedAt: Date;
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
  updatedAt: Date;
};

type SuggestionLike = {
  id: string;
  companyId: string;
  title: string;
  evidence: string | null;
  updatedAt: Date;
};

type IssueLike = {
  id: string;
  companyId: string;
  title: string;
  assigneeUserId: string | null;
  assigneeAgentId: string | null;
  updatedAt: Date;
};

function spaced(value: string) {
  return value.replace(/_/g, " ");
}

function scopeKeyFor(source: { scopeType: string | null; scopeId: string | null }) {
  return source.scopeType && source.scopeId ? `${source.scopeType}:${source.scopeId}` : null;
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
    summary:
      typeof approval.payload.agentName === "string"
        ? `Agent: ${approval.payload.agentName}`
        : `Approval type: ${spaced(approval.type)}`,
    ownerPool: "board",
    ...actor,
    sourcePermissionRevision: approval.updatedAt.toISOString(),
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
    sourcePermissionRevision: request.updatedAt.toISOString(),
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
    sourcePermissionRevision: discussion.updatedAt.toISOString(),
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
    sourcePermissionRevision: suggestion.updatedAt.toISOString(),
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
    sourcePermissionRevision: issue.updatedAt.toISOString(),
  };
}

export async function emitHubItem(db: Db, args: EmitArgs) {
  return hubItemsService(db).emit(args);
}
