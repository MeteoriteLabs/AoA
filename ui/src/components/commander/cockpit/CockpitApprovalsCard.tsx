/**
 * CockpitApprovalsCard — Phase 3c + approval-families extension.
 *
 * Compact inline approve/deny card for the unified approvals queue.
 * Mirrors the MemoryApprovalActions styling (h-7 buttons).
 *
 * Props:
 *   items       — CockpitApprovalItem[] (already founder-filtered by the server)
 *   companyId   — needed for per-source API calls and navigation
 *   onOpenFullPage — open the source full page
 *   onAsk       — ask Commander about the item
 *
 * Sources:
 *   approval         → binary (Approve / Deny)
 *   memory           → binary
 *   discussion_item  → binary
 *   join_request     → binary
 *   memory_version   → binary
 *   memory_archive   → binary
 *   runtime_tool_trust → ternary (Always / Once / Deny); no full-page link
 */

import { Check, ExternalLink, Loader2, MessageSquare, X } from "lucide-react";
import type { CockpitApprovalItem } from "@armyofagents/shared";
import { Button } from "../../ui/button";
import { useCockpitApprovalAction } from "./useCockpitApprovalAction";

// Source chip label map — must include all CockpitApprovalSource values.
const SOURCE_LABELS: Record<CockpitApprovalItem["source"], string> = {
  approval: "Approval",
  memory: "Memory",
  discussion_item: "Discussion",
  join_request: "Join request",
  memory_version: "Memory edit",
  memory_archive: "Archive",
  runtime_tool_trust: "Tool trust",
};

/**
 * Build the full-page route for a given approval item.
 * Returns empty string when no full-page route exists (runtime_tool_trust).
 */
function fullPageRoute(item: CockpitApprovalItem): string {
  if (item.source === "approval") return `/approvals/${item.id}`;
  if (item.source === "memory") return `/memory/explore`;
  if (item.source === "memory_version" || item.source === "memory_archive") return `/memory/explore`;
  if (item.source === "join_request") return `/inbox/new`;
  if (item.source === "runtime_tool_trust") return ""; // no full-page destination
  // discussion_item: navigate to the discussion thread
  return `/discussions/${item.discussionId ?? ""}`;
}

// ── Row component ─────────────────────────────────────────────────────────────

function ApprovalRow({
  item,
  companyId,
  onOpenFullPage,
  onAsk,
}: {
  item: CockpitApprovalItem;
  companyId: string;
  onOpenFullPage?: (href: string) => void;
  onAsk?: (text: string) => void;
}) {
  const { approve, deny, allowAlways } = useCockpitApprovalAction(companyId);
  // Stay disabled after success too — the row only unmounts once the cockpit refetch
  // returns, so this closes the sub-second window where a decided row is re-clickable.
  const busy =
    approve.isPending ||
    deny.isPending ||
    approve.isSuccess ||
    deny.isSuccess ||
    allowAlways.isPending ||
    allowAlways.isSuccess;

  const isTernary = item.decisionType === "ternary";
  const route = fullPageRoute(item);

  return (
    <li className="group flex flex-col gap-1 rounded px-1 py-1.5 text-xs hover:bg-muted/50">
      {/* Row header: title + source chip + ↗ (hidden when no route) */}
      <div className="flex items-center gap-1 truncate">
        <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
        <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
          {SOURCE_LABELS[item.source]}
        </span>
        {route && (
          <button
            type="button"
            aria-label={`Open ${item.title} full page`}
            title="Open full page"
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => onOpenFullPage?.(route)}
          >
            <ExternalLink className="size-3" aria-hidden />
          </button>
        )}
      </div>

      {/* Subtitle */}
      {item.subtitle && (
        <span className="px-0 text-[10px] text-muted-foreground">{item.subtitle}</span>
      )}

      {/* Action row */}
      <div className="flex items-center gap-1.5">
        {isTernary ? (
          /* 3-way: Always / Once / Deny — for runtime_tool_trust */
          <>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => allowAlways.mutate(item)}
              className="h-7 gap-1 bg-violet-600 text-xs text-white hover:bg-violet-700"
            >
              {allowAlways.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              ) : (
                <Check className="h-3 w-3" aria-hidden />
              )}
              Always
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => approve.mutate(item)}
              className="h-7 gap-1 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
            >
              {approve.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              ) : (
                <Check className="h-3 w-3" aria-hidden />
              )}
              Once
            </Button>
          </>
        ) : (
          /* 2-way: Approve / Deny — all other sources */
          <Button
            size="sm"
            disabled={busy}
            onClick={() => approve.mutate(item)}
            className="h-7 gap-1 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
          >
            {approve.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <Check className="h-3 w-3" aria-hidden />
            )}
            Approve
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => deny.mutate(item)}
          className="h-7 gap-1 text-xs"
        >
          {deny.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          ) : (
            <X className="h-3 w-3" aria-hidden />
          )}
          Deny
        </Button>
        {onAsk && (
          <button
            type="button"
            aria-label="Ask Commander about this"
            title="Ask Commander"
            className="ml-auto hidden shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground group-hover:flex"
            onClick={() =>
              onAsk(
                `About the pending "${item.title}" ${SOURCE_LABELS[item.source].toLowerCase()} — should I approve or deny it?`,
              )
            }
          >
            <MessageSquare className="size-3" aria-hidden />
          </button>
        )}
      </div>
    </li>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────

export function CockpitApprovalsCard({
  items,
  companyId,
  onOpenFullPage,
  onAsk,
}: {
  items: CockpitApprovalItem[];
  companyId: string;
  onOpenFullPage?: (href: string) => void;
  onAsk?: (text: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <section
      className="rounded-lg border border-border bg-background p-2"
      data-testid="cockpit-card-approvals"
    >
      <header className="mb-1 flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground">
        {/* ⚑ flag glyph */}
        <span aria-hidden className="text-[13px] leading-none">
          ⚑
        </span>
        Approvals
        <span className="ml-auto tabular-nums">{items.length}</span>
      </header>
      <ul className="divide-y divide-border/40">
        {items.map((item) => (
          <ApprovalRow
            key={`${item.source}:${item.id}`}
            item={item}
            companyId={companyId}
            onOpenFullPage={onOpenFullPage}
            onAsk={onAsk}
          />
        ))}
      </ul>
    </section>
  );
}
