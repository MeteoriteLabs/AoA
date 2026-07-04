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

type FailedRunLike = {
  id: string;
  companyId: string;
  agentId: string;
  agentName?: string | null;
  status: string;
  error?: string | null;
  updatedAt: SourceUpdatedAt;
};

type BudgetAlertLike = {
  companyId: string;
  monthSpendCents: number;
  monthBudgetCents: number;
  monthUtilizationPercent: number;
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

export function buildFailedRunHubEmit(run: FailedRunLike): EmitArgs {
  const agentName = run.agentName?.trim() || "Agent";
  return {
    companyId: run.companyId,
    semanticType: "run_failed",
    sourceType: "heartbeat_run",
    sourceId: run.id,
    title: `${agentName} run ${run.status.replace(/_/g, " ")}`,
    summary: run.error ?? `Latest run status: ${run.status}`,
    sourceActorType: "agent",
    sourceActorId: run.agentId,
    // The run viewer tab is keyed on runTab(runId=sourceId, agentId). Persist the
    // owning agentId as the related entity so hubTabForItem can build that tab;
    // relatedEntity is NOT part of sourceUniqueKey, so this never re-keys the row.
    relatedEntityType: "agent",
    relatedEntityId: run.agentId,
    priority: "high",
    sourcePermissionRevision: sourceRevision(run.updatedAt),
  };
}

export function buildCompletedRunHubEmit(run: FailedRunLike): EmitArgs {
  const agentName = run.agentName?.trim() || "Agent";
  return {
    companyId: run.companyId,
    semanticType: "run_complete",
    sourceType: "heartbeat_run",
    sourceId: run.id,
    title: `${agentName} run complete`,
    summary: "Run finished successfully",
    sourceActorType: "agent",
    sourceActorId: run.agentId,
    // See buildFailedRunHubEmit: the run tab needs the agentId via relatedEntity.
    relatedEntityType: "agent",
    relatedEntityId: run.agentId,
    priority: "normal",
    sourcePermissionRevision: sourceRevision(run.updatedAt),
  };
}

const TERMINAL_FAILED_STATUSES: ReadonlySet<string> = new Set(["failed", "timed_out"]);

// Maps a terminal heartbeat run to its hub emit. Cancelled/queued/running -> null
// (cancellation is founder-initiated; no notification). MUST route failures
// through buildFailedRunHubEmit so the event emit and the legacy sidebar-badges
// scan produce byte-identical rows for the same run (change-aware emit no-ops).
export function buildTerminalRunHubEmit(run: FailedRunLike): EmitArgs | null {
  if (run.status === "succeeded") return buildCompletedRunHubEmit(run);
  if (TERMINAL_FAILED_STATUSES.has(run.status)) return buildFailedRunHubEmit(run);
  return null;
}

// Shared budget-alert summary formatter (H3). BOTH the producer above and the
// company_budget reconciler (hub-items.ts) format the summary through this ONE
// function so the change-aware upsert and the reconcile heal path produce
// byte-identical strings for the same spend/budget — that byte-identity is what
// keeps them from ping-ponging (a self-inflicted feedback storm) as each side
// re-emits. Recomputes the percentage from cents so callers never have to pass a
// pre-rounded utilization: `pct.toFixed(2)` matches the producer's historical
// `Number(((spend/budget)*100).toFixed(2)).toFixed(2)` (double-rounding a value
// already at 2dp is idempotent). Zero/negative budget → 0.00% (never divide by 0).
export function formatBudgetAlertSummary(spendCents: number, budgetCents: number): string {
  const pct = budgetCents > 0 ? (spendCents / budgetCents) * 100 : 0;
  return `${pct.toFixed(2)}% used (${spendCents}/${budgetCents} cents)`;
}

export function buildBudgetAlertHubEmit(alert: BudgetAlertLike): EmitArgs {
  return {
    companyId: alert.companyId,
    semanticType: "budget_alert",
    sourceType: "company_budget",
    sourceId: alert.companyId,
    title: "Budget approaching limit",
    summary: formatBudgetAlertSummary(alert.monthSpendCents, alert.monthBudgetCents),
    ownerPool: "board",
    priority: alert.monthUtilizationPercent >= 100 ? "urgent" : "high",
    sourcePermissionRevision: sourceRevision(alert.updatedAt),
  };
}

export async function emitHubItem(db: Db, args: EmitArgs) {
  return hubItemsService(db).emit(args);
}
