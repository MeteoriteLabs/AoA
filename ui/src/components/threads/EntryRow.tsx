/**
 * EntryRow — group-chat message bubbles and agent cards.
 * Current user → right-aligned bubble.
 * Other humans → left-aligned bubble.
 * Agents → left-aligned card with role-colored left border.
 * System notices → centered divider.
 */
import { CheckCircle2, Database, Loader2, XCircle } from "lucide-react";
import { relativeTime } from "@/lib/utils";
import { Link } from "@/lib/router";
import type { DiscussionEntry } from "../../api/discussions";

/* ─── Agent role → color ─── */

const ROLE_COLORS: Array<[RegExp, string]> = [
  [/scribe/i,     "#6470DC"],  // --data-indigo
  [/adjutant/i,   "#D9A938"],  // --data-amber
  [/router/i,     "#3FA8C7"],  // --data-teal
  [/planner/i,    "#5AA87E"],  // --data-emerald
  [/dispatcher/i, "#7E8AA8"],  // --data-slate
];

function agentRoleColor(name: string | null | undefined): string {
  for (const [re, c] of ROLE_COLORS) if (re.test(name ?? "")) return c;
  return "#7E8AA8";
}

/* ─── Helpers ─── */

function toInitials(id: string | null | undefined, fallback = "?"): string {
  if (!id) return fallback;
  if (id === "local-board") return "LB";
  if (/^[0-9a-f]{8}-/i.test(id)) return "M";
  return (
    id.replace(/[-_]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || fallback
  );
}

function toDisplayName(id: string | null | undefined): string {
  if (!id) return "Unknown";
  if (id === "local-board") return "Local Board";
  if (/^[0-9a-f]{8}-/i.test(id)) return "Member";
  return id.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

/* ─── Inline robot icon ─── */

function RobotIcon() {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor" aria-hidden="true">
      <rect x="3" y="9" width="14" height="9" rx="2" />
      <rect x="7" y="5.5" width="6" height="4" rx="1" />
      <line x1="10" y1="5.5" x2="10" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="2.2" r="1" />
      <circle cx="7.5" cy="13" r="1.3" />
      <circle cx="12.5" cy="13" r="1.3" />
      <rect x="8" y="16" width="4" height="1" rx="0.5" />
    </svg>
  );
}

/* ─── Chip row ─── */

function ChipRow({
  taskCount,
  memCount,
  pendingCount,
  extractionStatus,
  extractionError,
  errorMentionsProvider,
}: {
  taskCount: number;
  memCount: number;
  pendingCount: number;
  extractionStatus: string;
  extractionError: string | null;
  errorMentionsProvider: boolean;
}) {
  const hasChips =
    taskCount > 0 ||
    memCount > 0 ||
    pendingCount > 0 ||
    extractionStatus === "processing" ||
    extractionStatus === "failed";

  if (!hasChips) return null;

  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {extractionStatus === "processing" && (
        <span
          className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full text-muted-foreground"
          style={{ border: "1px solid hsl(0 0% 25%)", background: "hsl(0 0% 12%)" }}
        >
          <Loader2 className="h-2.5 w-2.5 animate-spin" />
          Extracting…
        </span>
      )}
      {extractionStatus === "failed" && (
        <span
          className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full"
          style={{
            color: "#e87070",
            border: "1px solid rgba(220,80,80,0.3)",
            background: "rgba(220,80,80,0.08)",
          }}
          title={extractionError ?? "Extraction failed"}
        >
          <XCircle className="h-2.5 w-2.5" />
          Extraction failed
          {errorMentionsProvider && (
            <Link to="/settings?tab=llm" className="underline hover:no-underline ml-1">
              Settings
            </Link>
          )}
        </span>
      )}
      {taskCount > 0 && (
        <span
          className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full"
          style={{
            color: "#4FB67E",
            border: "1px solid rgba(79,182,126,0.35)",
            background: "rgba(79,182,126,0.08)",
          }}
        >
          <CheckCircle2 className="h-2.5 w-2.5" />
          {taskCount} Task{taskCount !== 1 ? "s" : ""}
        </span>
      )}
      {memCount > 0 && (
        <span
          className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full"
          style={{
            color: "#6470DC",
            border: "1px solid rgba(100,112,220,0.35)",
            background: "rgba(100,112,220,0.08)",
          }}
        >
          <Database className="h-2.5 w-2.5" />
          {memCount} Memory
        </span>
      )}
      {pendingCount > 0 && (
        <span
          className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full"
          style={{
            color: "#D9A938",
            border: "1px solid rgba(217,169,56,0.35)",
            background: "rgba(217,169,56,0.08)",
          }}
        >
          {pendingCount} pending
        </span>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   EntryRow — public component
   ════════════════════════════════════════════════════════════════════════ */

export interface EntryRowProps {
  entry: DiscussionEntry;
  /** Viewer's own user ID — determines which side to align the bubble. */
  currentUserId?: string | null;
  onReprocess: () => void;
  isReprocessing?: boolean;
}

export function EntryRow({
  entry,
  currentUserId,
  onReprocess,
  isReprocessing = false,
}: EntryRowProps) {
  // System notice → centered divider
  if ((entry.sourceInfo as Record<string, unknown> | null)?.systemNotice === true) {
    return (
      <div
        className="flex items-center gap-3 my-2 px-1"
        data-testid="entry-system-notice"
        data-entry-id={`entry-row-${entry.id}`}
      >
        <div className="flex-1 h-px bg-border/60" />
        <span
          className="text-[11px] text-muted-foreground/70 whitespace-nowrap rounded-full px-3 py-0.5 shrink-0"
          style={{ background: "hsl(0 0% 14% / 0.6)" }}
        >
          {entry.rawContent}
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 shrink-0">
          System notice
        </span>
        <div className="flex-1 h-px bg-border/60" />
      </div>
    );
  }

  const isAgent = !!entry.authorAgentId;
  const isMe = !isAgent && !!currentUserId && entry.createdBy === currentUserId;

  const approved = entry.extractedItems.filter((i) => i.status === "approved");
  const taskCount = approved.filter((i) => i.resultTaskId).length;
  const memCount = approved.filter((i) => i.resultMemoryId).length;
  const pendingCount = entry.extractedItems.filter(
    (i) => i.status === "pending" || i.status === "edited",
  ).length;

  const extractionError =
    typeof (entry.sourceInfo as Record<string, unknown> | null)?.extractionError === "string"
      ? ((entry.sourceInfo as Record<string, unknown>).extractionError as string)
      : null;
  const errorMentionsProvider = extractionError
    ? /api key|provider/i.test(extractionError)
    : false;

  if (isAgent) {
    return (
      <AgentCard
        entry={entry}
        taskCount={taskCount}
        memCount={memCount}
        pendingCount={pendingCount}
        extractionError={extractionError}
        errorMentionsProvider={errorMentionsProvider}
      />
    );
  }

  if (isMe) {
    return (
      <MeBubble
        entry={entry}
        taskCount={taskCount}
        memCount={memCount}
        pendingCount={pendingCount}
      />
    );
  }

  return (
    <HumanBubble
      entry={entry}
      taskCount={taskCount}
      memCount={memCount}
      pendingCount={pendingCount}
      extractionError={extractionError}
      errorMentionsProvider={errorMentionsProvider}
    />
  );
}

/* ── Me bubble (right-aligned) ── */

function MeBubble({
  entry,
  taskCount,
  memCount,
  pendingCount,
}: {
  entry: DiscussionEntry;
  taskCount: number;
  memCount: number;
  pendingCount: number;
}) {
  return (
    <div
      className="flex flex-col items-end gap-1"
      data-testid={`entry-row-${entry.id}`}
      data-entry-type="me"
    >
      <div className="flex items-center gap-1.5 pr-1">
        <span className="text-[11px] font-semibold text-muted-foreground">
          {toDisplayName(entry.createdBy)}
        </span>
        <span className="text-[11px] text-muted-foreground/50">
          {relativeTime(entry.createdAt)}
        </span>
      </div>
      <div className="flex items-end gap-2">
        <div className="flex flex-col items-end gap-1.5 max-w-[78%]">
          <div
            className="px-4 py-3 text-sm leading-relaxed break-words whitespace-pre-wrap"
            style={{
              color: "#eeeeee",
              background: "hsl(221 20% 27%)",
              border: "1px solid hsl(221 18% 34%)",
              borderRadius: "16px 16px 4px 16px",
            }}
          >
            {entry.rawContent}
          </div>
          <ChipRow
            taskCount={taskCount}
            memCount={memCount}
            pendingCount={pendingCount}
            extractionStatus={entry.extractionStatus}
            extractionError={null}
            errorMentionsProvider={false}
          />
        </div>
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
          style={{ background: "hsl(221 22% 34%)" }}
          title={entry.createdBy ?? "Me"}
        >
          {toInitials(entry.createdBy, "Me")}
        </div>
      </div>
    </div>
  );
}

/* ── Human bubble (left-aligned) ── */

function HumanBubble({
  entry,
  taskCount,
  memCount,
  pendingCount,
  extractionError,
  errorMentionsProvider,
}: {
  entry: DiscussionEntry;
  taskCount: number;
  memCount: number;
  pendingCount: number;
  extractionError: string | null;
  errorMentionsProvider: boolean;
}) {
  return (
    <div
      className="flex items-end gap-2"
      data-testid={`entry-row-${entry.id}`}
      data-entry-type="human"
    >
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
        style={{ background: "hsl(220 14% 28%)" }}
        title={toDisplayName(entry.createdBy)}
      >
        {toInitials(entry.createdBy, "?")}
      </div>
      <div className="flex flex-col gap-1 flex-1 min-w-0 max-w-[80%]">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold text-muted-foreground">
            {toDisplayName(entry.createdBy)}
          </span>
          <span className="text-[11px] text-muted-foreground/50">
            {relativeTime(entry.createdAt)}
          </span>
        </div>
        <div
          className="px-4 py-3 text-sm leading-relaxed break-words whitespace-pre-wrap"
          style={{
            color: "#eeeeee",
            background: "hsl(220 12% 21%)",
            border: "1px solid hsl(220 10% 27%)",
            borderRadius: "16px 16px 16px 4px",
          }}
        >
          {entry.rawContent}
        </div>
        <ChipRow
          taskCount={taskCount}
          memCount={memCount}
          pendingCount={pendingCount}
          extractionStatus={entry.extractionStatus}
          extractionError={extractionError}
          errorMentionsProvider={errorMentionsProvider}
        />
      </div>
    </div>
  );
}

/* ── Agent card (left-aligned, role-colored left border) ── */

function AgentCard({
  entry,
  taskCount,
  memCount,
  pendingCount,
  extractionError,
  errorMentionsProvider,
}: {
  entry: DiscussionEntry;
  taskCount: number;
  memCount: number;
  pendingCount: number;
  extractionError: string | null;
  errorMentionsProvider: boolean;
}) {
  const color = agentRoleColor(entry.authorAgentName);
  const agentName = entry.authorAgentName ?? "Agent";
  const roleLabel = agentName.split(/\s+/)[0];

  return (
    <div
      className="flex items-start gap-2 max-w-[90%]"
      data-testid={`entry-row-${entry.id}`}
      data-entry-type="agent"
    >
      {/* Robot avatar */}
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-white shrink-0 mt-0.5"
        style={{ background: color }}
        title={agentName}
      >
        <RobotIcon />
      </div>

      {/* Card */}
      <div
        className="flex flex-col gap-2.5 px-3.5 py-3 flex-1 min-w-0"
        style={{
          background: "var(--card-2, #1d2128)",
          borderLeft: `3px solid ${color}`,
          borderRadius: "4px 14px 14px 14px",
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold" style={{ color: "#eeeeee" }}>
            {agentName}
          </span>
          <span
            className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide shrink-0"
            data-testid="entry-author-badge-agent"
            style={{ color, background: `${color}25` }}
          >
            {roleLabel}
          </span>
          <span className="text-[11px] text-muted-foreground/50 ml-auto">
            {relativeTime(entry.createdAt)}
          </span>
        </div>

        {/* Body */}
        <p
          className="text-sm leading-relaxed break-words whitespace-pre-wrap"
          style={{ color: "#eeeeee" }}
        >
          {entry.rawContent}
        </p>

        {/* Chips */}
        <ChipRow
          taskCount={taskCount}
          memCount={memCount}
          pendingCount={pendingCount}
          extractionStatus={entry.extractionStatus}
          extractionError={extractionError}
          errorMentionsProvider={errorMentionsProvider}
        />
      </div>
    </div>
  );
}
