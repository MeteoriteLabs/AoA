import {
  Archive,
  CheckCircle2,
  Clock3,
  ExternalLink,
  EyeOff,
  PanelRightClose,
  RotateCcw,
  UserCheck,
  UserX,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { RuntimeDecisionDetail } from "@armyofagents/shared";
import { agentRuntimeDecisionsApi } from "@/api/agent-runtime-decisions";
import { Link } from "@/lib/router";
import type { HubAuditRow, HubItemListRow } from "@/api/hub-items";
import { Button } from "@/components/ui/button";
import { queryKeys } from "@/lib/queryKeys";
import { HUB_REGISTRY } from "./hubRegistry";

interface HubViewerProps {
  item: HubItemListRow | null;
  onClose?: () => void;
  onMarkUnread?: (itemId: string) => void;
  onDismiss?: (itemId: string) => void;
  onSnooze?: (itemId: string) => void;
  onLifecycleAction?: (
    item: HubItemListRow,
    action: "resolve" | "archive" | "claim" | "release",
  ) => void;
  undoAction?: { label: string; onUndo: () => void } | null;
  auditRows?: HubAuditRow[];
  auditLoading?: boolean;
}

export function HubViewer({
  item,
  onClose,
  onMarkUnread,
  onDismiss,
  onSnooze,
  onLifecycleAction,
  undoAction,
  auditRows = [],
  auditLoading = false,
}: HubViewerProps) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    if (item) headingRef.current?.focus();
  }, [item?.id]);

  if (!item) {
    return (
      <aside
        aria-label="Hub viewer"
        className="hidden h-full w-[360px] shrink-0 items-center justify-center border-l border-border bg-bg p-6 text-center text-sm text-muted-foreground lg:flex"
      >
        Select an item to review details.
      </aside>
    );
  }

  const entry = HUB_REGISTRY[item.semanticType];
  const Icon = entry.icon;
  const fullLink = entry.fullLink(item);
  const whyReasons = [
    item.curationReason,
    item.curationPriorityReason,
  ].filter((reason): reason is string => Boolean(reason));
  const isRuntimeDecision = item.semanticType === "agent_runtime_decision";
  const showLifecycleActions = !isRuntimeDecision;

  return (
    <aside
      aria-label="Hub viewer"
      className="flex min-h-[320px] w-full shrink-0 flex-col border-t border-border bg-bg lg:h-full lg:w-[360px] lg:border-l lg:border-t-0"
    >
      <div className="flex h-12 items-center justify-between border-b border-border px-4">
        <div role="tablist" aria-label="Hub item viewer" className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            role="tab"
            aria-selected="true"
            className="inline-flex min-w-0 items-center gap-2 border-b-2 border-brand px-1 py-3 text-sm font-medium"
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{entry.label}</span>
          </button>
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label="Close viewer" onClick={onClose}>
          <PanelRightClose className="size-4" aria-hidden="true" />
        </Button>
      </div>
      {undoAction ? (
        <div className="flex h-11 items-center justify-between border-b border-border bg-card px-4 text-xs">
          <span className="truncate text-muted-foreground">{undoAction.label}</span>
          <Button type="button" variant="ghost" size="sm" onClick={undoAction.onUndo}>
            <RotateCcw className="size-4" aria-hidden="true" />
            Undo {undoAction.label}
          </Button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="text-xs uppercase text-muted-foreground">{entry.viewerKind}</div>
        <h2 ref={headingRef} tabIndex={-1} className="mt-2 text-lg font-semibold leading-snug">
          {item.title}
        </h2>
        {item.summary ? (
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.summary}</p>
        ) : null}
        {isRuntimeDecision ? (
          <RuntimeDecisionPanel item={item} />
        ) : null}
        {whyReasons.length > 0 ? (
          <section aria-label="Why you are seeing this" className="mt-5 border-t border-border pt-4">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">
              Why you are seeing this
            </h3>
            <ul className="mt-2 space-y-1.5 text-sm leading-6 text-muted-foreground">
              {whyReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </section>
        ) : null}
        <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Priority</dt>
            <dd className="mt-1 font-medium">{item.priority}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Status</dt>
            <dd className="mt-1 font-medium">{item.status}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Source</dt>
            <dd className="mt-1 truncate font-medium">{item.sourceType ?? "Hub"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Version</dt>
            <dd className="mt-1 font-medium">{item.version}</dd>
          </div>
        </dl>
        {item.status === "resolved" || item.status === "archived" ? (
          <section aria-label="Audit timeline" className="mt-6 border-t border-border pt-4">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">Audit</h3>
            {auditLoading ? (
              <p className="mt-3 text-sm text-muted-foreground">Loading audit...</p>
            ) : auditRows.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No audit events.</p>
            ) : (
              <ol className="mt-3 space-y-3">
                {auditRows.map((row) => (
                  <li key={row.id} className="border-l border-border pl-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium capitalize text-text">{row.action}</span>
                      <time className="shrink-0 text-xs text-muted-foreground">
                        {formatAuditTime(row.createdAt)}
                      </time>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {row.actorId}
                      {row.authorityBasis ? ` - ${row.authorityBasis}` : null}
                    </div>
                    {row.reason ? (
                      <div className="mt-1 text-xs text-muted-foreground">{row.reason}</div>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </section>
        ) : null}
      </div>
      <div className="space-y-3 border-t border-border p-4">
        <div className="grid grid-cols-2 gap-2">
          {item.readAt ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onMarkUnread?.(item.id)}
            >
              <EyeOff className="size-4" aria-hidden="true" />
              Mark unread
            </Button>
          ) : null}
          <Button type="button" variant="secondary" size="sm" onClick={() => onDismiss?.(item.id)}>
            <EyeOff className="size-4" aria-hidden="true" />
            Dismiss
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => onSnooze?.(item.id)}>
            <Clock3 className="size-4" aria-hidden="true" />
            Snooze
          </Button>
          {showLifecycleActions ? (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => onLifecycleAction?.(item, "resolve")}
              >
                <CheckCircle2 className="size-4" aria-hidden="true" />
                Resolve
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => onLifecycleAction?.(item, "archive")}
              >
                <Archive className="size-4" aria-hidden="true" />
                Archive
              </Button>
            </>
          ) : null}
          {showLifecycleActions && item.ownerPool === "board" && !item.claimedByUserId ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onLifecycleAction?.(item, "claim")}
            >
              <UserCheck className="size-4" aria-hidden="true" />
              Claim
            </Button>
          ) : null}
          {showLifecycleActions && item.claimedByUserId ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onLifecycleAction?.(item, "release")}
            >
              <UserX className="size-4" aria-hidden="true" />
              Release
            </Button>
          ) : null}
        </div>
        {fullLink ? (
          <Button asChild variant="secondary" className="w-full">
            <Link to={fullLink}>
              <ExternalLink className="size-4" aria-hidden="true" />
              Open full
            </Link>
          </Button>
        ) : (
          <Button type="button" variant="secondary" className="w-full" disabled>
            Open full
          </Button>
        )}
      </div>
    </aside>
  );
}

function RuntimeDecisionPanel({ item }: { item: HubItemListRow }) {
  const queryClient = useQueryClient();
  const [answerText, setAnswerText] = useState("");
  const decisionId = item.sourceId;
  const detailQuery = useQuery({
    queryKey: decisionId
      ? queryKeys.agentRuntimeDecisions.detail(item.companyId, decisionId)
      : ["agent-runtime-decisions", item.companyId, "missing"],
    queryFn: () => agentRuntimeDecisionsApi.detail(item.companyId, decisionId!),
    enabled: Boolean(decisionId),
  });
  const detail = detailQuery.data;
  const answerMutation = useMutation({
    mutationFn: (payload: Parameters<typeof agentRuntimeDecisionsApi.answer>[2]) =>
      agentRuntimeDecisionsApi.answer(item.companyId, decisionId!, payload),
    onSuccess: async () => {
      await Promise.all([
        decisionId
          ? queryClient.invalidateQueries({
              queryKey: queryKeys.agentRuntimeDecisions.detail(item.companyId, decisionId),
            })
          : Promise.resolve(),
        queryClient.invalidateQueries({ queryKey: ["hub-items", item.companyId] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.hubItems.counts(item.companyId) }),
      ]);
    },
  });

  if (!decisionId) {
    return (
      <section className="mt-5 border-t border-border pt-4 text-sm text-muted-foreground">
        Runtime decision source is unavailable.
      </section>
    );
  }
  if (detailQuery.isLoading) {
    return <section className="mt-5 border-t border-border pt-4 text-sm text-muted-foreground">Loading decision...</section>;
  }
  if (detailQuery.isError || !detail) {
    return <section className="mt-5 border-t border-border pt-4 text-sm text-muted-foreground">Decision details unavailable.</section>;
  }

  const disabled =
    answerMutation.isPending ||
    (detail.status !== "created" && detail.status !== "shown" && detail.status !== "relay_failed");
  const submitPermission = (decision: "allow_once" | "allow_always" | "deny") => {
    answerMutation.mutate({
      kind: "permission",
      decision,
      expectedSourceRevision: detail.sourceRevision,
      nonce: detail.nonce,
    });
  };
  const submitQuestion = () => {
    if (!answerText.trim()) return;
    answerMutation.mutate({
      kind: "work_question",
      answer: { text: answerText.trim() },
      expectedSourceRevision: detail.sourceRevision,
      nonce: detail.nonce,
    });
  };

  return (
    <section className="mt-5 border-t border-border pt-4" aria-label="Runtime decision">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">
          {detail.kind === "permission" ? "Permission" : "Question"}
        </h3>
        <span className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">
          {runtimeDecisionStatusLabel(detail.status)}
        </span>
      </div>
      {detail.promptText ? (
        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-text">{detail.promptText}</p>
      ) : null}
      <RuntimeDecisionFacts detail={detail} />
      {detail.kind === "permission" ? (
        <div className="mt-4 grid gap-2">
          <Button type="button" size="sm" disabled={disabled} onClick={() => submitPermission("allow_once")}>
            Allow once
          </Button>
          <Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={() => submitPermission("allow_always")}>
            Allow always
          </Button>
          <Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={() => submitPermission("deny")}>
            Deny
          </Button>
        </div>
      ) : (
        <div className="mt-4 grid gap-2">
          <textarea
            aria-label="Work question answer"
            value={answerText}
            disabled={disabled}
            onChange={(event) => setAnswerText(event.target.value)}
            className="min-h-24 resize-y rounded border border-border bg-bg p-2 text-sm"
          />
          <Button type="button" size="sm" disabled={disabled || !answerText.trim()} onClick={submitQuestion}>
            Send answer
          </Button>
        </div>
      )}
      {answerMutation.isError ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          Failed to answer decision.
        </p>
      ) : null}
    </section>
  );
}

function RuntimeDecisionFacts({ detail }: { detail: RuntimeDecisionDetail }) {
  const rows = [
    ["Tool", detail.toolName],
    ["Command", detail.command],
    ["Path", detail.path],
    ["Network", detail.networkTarget],
    ["Risk", detail.riskClass],
  ].filter((row): row is [string, string] => Boolean(row[1]));
  if (rows.length === 0) return null;
  return (
    <dl className="mt-4 grid gap-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="grid gap-1">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="break-words font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function runtimeDecisionStatusLabel(status: string) {
  return status.replace(/_/g, " ");
}

function formatAuditTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
