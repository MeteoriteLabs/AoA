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
import { useEffect, useRef } from "react";
import { Link } from "@/lib/router";
import type { HubAuditRow, HubItemListRow } from "@/api/hub-items";
import { HUB_SOURCE_MIRRORED_TYPES } from "@armyofagents/shared";
import { Button } from "@/components/ui/button";
import { HUB_REGISTRY } from "./hubRegistry";
import { RuntimeDecisionPanel } from "./RuntimeDecisionPanel";

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
  /**
   * When provided, the "Open full" affordance calls this instead of navigating
   * to a route. The tabbed hub uses it to open the item's entity as a sibling
   * tab (HubHomeTab). When absent, "Open full" falls back to the route `<Link>`.
   */
  onOpenFull?: (item: HubItemListRow) => void;
  /**
   * `"aside"` (default): the legacy fixed-width right rail (`lg:w-[360px]`,
   * `border-l`), used standalone. `"tab"`: fills its container (`h-full w-full`,
   * no fixed width / border) so it can host the Home tab inside the tabbed viewer.
   */
  variant?: "aside" | "tab";
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
  onOpenFull,
  variant = "aside",
  undoAction,
  auditRows = [],
  auditLoading = false,
}: HubViewerProps) {
  const isTab = variant === "tab";
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    if (item) headingRef.current?.focus();
  }, [item?.id]);

  if (!item) {
    return (
      <aside
        aria-label="Hub viewer"
        className={
          isTab
            ? "flex h-full w-full flex-col items-center justify-center bg-bg p-6 text-center text-sm text-muted-foreground"
            : "hidden h-full w-[360px] shrink-0 items-center justify-center border-l border-border bg-bg p-6 text-center text-sm text-muted-foreground lg:flex"
        }
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
  // Mirror model (R3 + H1): resolve/archive on a source-backed decision item is
  // server-rejected while the source is still pending — the item mirrors a live
  // decision and leaves the lane only when the source is decided. Hide those two
  // affordances for OPEN mirrored types (approval_request / join_request /
  // agent_runtime_decision) so users are steered to the embedded approve/reject
  // or decision panel; personal Dismiss/Snooze stay available (per-user hiding).
  // Runtime decisions additionally have no generic Claim/Release surface.
  const isMirrored = (HUB_SOURCE_MIRRORED_TYPES as readonly string[]).includes(item.semanticType);
  const showResolveArchive = !(isRuntimeDecision || (isMirrored && item.status === "open"));
  const showClaimRelease = !isRuntimeDecision;

  return (
    <aside
      aria-label="Hub viewer"
      className={
        isTab
          ? "flex h-full min-h-0 w-full flex-col bg-bg"
          : "flex min-h-[320px] w-full shrink-0 flex-col border-t border-border bg-bg lg:h-full lg:w-[360px] lg:border-l lg:border-t-0"
      }
    >
      {/* 42px header — matches the rail header and the viewer tab strip. */}
      <div className="flex h-[42px] shrink-0 items-center justify-between border-b border-border px-4">
        <div role="tablist" aria-label="Hub item viewer" className="flex h-full min-w-0 items-center gap-2">
          <button
            type="button"
            role="tab"
            aria-selected="true"
            className="inline-flex h-full min-w-0 items-center gap-2 border-b-2 border-brand px-1 text-sm font-medium"
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
          {showResolveArchive ? (
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
          {showClaimRelease && item.ownerPool === "board" && !item.claimedByUserId ? (
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
          {showClaimRelease && item.claimedByUserId ? (
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
        {onOpenFull ? (
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={() => onOpenFull(item)}
          >
            <ExternalLink className="size-4" aria-hidden="true" />
            Open full
          </Button>
        ) : fullLink ? (
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

function formatAuditTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
