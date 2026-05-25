/**
 * EntryRow — shared between DiscussionDetail and ThreadTab.
 * Renders a single discussion entry in a compact collapsible style.
 * Extracted from DiscussionDetail.tsx's ThreadEntryRow.
 */
import { useState } from "react";
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronRight,
  ClipboardPen,
  Loader2,
  MessageSquare,
  Mic,
  PenLine,
  Plug,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/utils";
import type { DiscussionEntry } from "../../api/discussions";
import { Link } from "@/lib/router";

/* ─── Constants ─── */

const SOURCE_ICONS: Record<string, typeof ClipboardPen> = {
  paste: ClipboardPen,
  write: PenLine,
  voice: Mic,
  mcp: Plug,
  agent: Bot,
};

const SOURCE_LABELS: Record<string, string> = {
  paste: "Paste",
  write: "Write",
  voice: "Voice",
  mcp: "MCP",
  agent: "Agent",
};

function ExtractionStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-muted text-muted-foreground",
    processing: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    skipped: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium capitalize",
        styles[status] ?? styles.pending,
      )}
    >
      {status === "processing" && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
      {status}
    </span>
  );
}

function getExtractionError(sourceInfo: Record<string, unknown> | null): string | null {
  if (!sourceInfo || typeof sourceInfo.extractionError !== "string") return null;
  return sourceInfo.extractionError;
}

/** Friendly author name + initials from a raw createdBy id / slug.
   No display-name source exists on the entry, so derive a readable label. */
function friendlyAuthor(id: string | null | undefined): { name: string; initials: string } {
  if (!id) return { name: "Unknown", initials: "?" };
  if (id === "local-board") return { name: "Local Board", initials: "LB" };
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id)) return { name: "Member", initials: "M" };
  const name = id
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return { name: name || id, initials: initials || "?" };
}

/* ════════════════════════════════════════════════════════════════════════
   EntryRow
   ════════════════════════════════════════════════════════════════════════ */

export interface EntryRowProps {
  entry: DiscussionEntry;
  onReprocess: () => void;
  isReprocessing?: boolean;
  /** Indent level for nested replies (0 = top-level, 1 = reply) */
  indentLevel?: number;
  /** Reply to this entry — opens the composer targeting this entry as parent. */
  onReply?: (entryId: string) => void;
}

export function EntryRow({
  entry,
  onReprocess,
  isReprocessing = false,
  indentLevel = 0,
  onReply,
}: EntryRowProps) {
  const [expanded, setExpanded] = useState(false);

  const SourceIcon = SOURCE_ICONS[entry.inputType] ?? MessageSquare;
  const sourceLabel = SOURCE_LABELS[entry.inputType] ?? entry.inputType;
  const itemCount = entry.extractedItems.length;
  const pendingCount = entry.extractedItems.filter((i) => i.status === "pending").length;
  const author = friendlyAuthor(entry.createdBy);

  const isAgent = !!entry.authorAgentId;
  const agentInitials =
    (entry.authorAgentName ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "AG";
  const displayName = isAgent ? (entry.authorAgentName ?? "Agent") : author.name;
  const displayInitials = isAgent ? agentInitials : author.initials;

  const extractionError = getExtractionError(entry.sourceInfo);
  const errorMentionsProvider = extractionError
    ? extractionError.toLowerCase().includes("api key") ||
      extractionError.toLowerCase().includes("provider")
    : false;

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card",
        indentLevel > 0 && "ml-6 border-l-2 border-l-muted-foreground/20 rounded-l-none",
      )}
      data-testid={`entry-row-${entry.id}`}
    >
      {/* Compact header row */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className="flex items-center gap-2 w-full px-3 py-2.5 text-left hover:bg-muted/30 transition-colors rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
        {/* Author identity (avatar + name) */}
        {isAgent && entry.authorAgentAvatar ? (
          <img
            src={entry.authorAgentAvatar}
            alt=""
            className="h-5 w-5 rounded-full object-cover shrink-0"
            aria-hidden
          />
        ) : (
          <span
            className={cn(
              "inline-flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold shrink-0",
              isAgent
                ? "bg-primary/15 text-primary"
                : "bg-muted text-muted-foreground",
            )}
            title={isAgent ? (entry.authorAgentName ?? "Agent") : entry.createdBy}
            aria-hidden
          >
            {displayInitials}
          </span>
        )}
        <span className="text-xs font-medium text-foreground shrink-0">{displayName}</span>
        {isAgent && (
          <span
            data-testid="entry-author-badge-agent"
            className="inline-flex items-center rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary shrink-0"
          >
            Agent
          </span>
        )}
        <SourceIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">{sourceLabel}</span>
        <span className="text-xs text-muted-foreground">{relativeTime(entry.createdAt)}</span>
        <ExtractionStatusBadge status={entry.extractionStatus} />
        {itemCount > 0 && (
          <span className="text-[10px] text-muted-foreground ml-auto">
            {pendingCount > 0 ? `${pendingCount} pending / ` : ""}
            {itemCount} items
          </span>
        )}
        {/* Entry content preview (collapsed) */}
        {!expanded && (
          <span className="text-xs text-muted-foreground truncate max-w-[200px] ml-1">
            {entry.rawContent.slice(0, 60)}
            {entry.rawContent.length > 60 ? "..." : ""}
          </span>
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-border pt-3">
          {/* Raw content */}
          <div className="rounded-md bg-muted/30 p-3">
            <p className="text-sm whitespace-pre-wrap text-muted-foreground leading-relaxed">
              {entry.rawContent}
            </p>
          </div>

          {/* Processing / failed / skipped status messages */}
          {entry.extractionStatus === "processing" && (
            <div className="flex items-center gap-2 rounded-md bg-muted/50 p-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Extracting items...</span>
            </div>
          )}

          {entry.extractionStatus === "failed" && (
            <div className="flex flex-col gap-1 rounded-md bg-red-50 dark:bg-red-950/30 p-3">
              <div className="flex items-center gap-2">
                <XCircle className="h-4 w-4 text-red-600 shrink-0" />
                <span className="text-sm text-red-700 dark:text-red-400">Extraction failed</span>
              </div>
              {extractionError && (
                <p className="text-xs text-red-600/80 dark:text-red-400/80 ml-6">
                  {extractionError}
                  {errorMentionsProvider && (
                    <Link to="/settings?tab=llm" className="ml-1 underline hover:no-underline">
                      Go to Settings
                    </Link>
                  )}
                </p>
              )}
            </div>
          )}

          {entry.extractionStatus === "skipped" && (
            <div className="flex flex-col gap-1 rounded-md bg-amber-50 dark:bg-amber-950/30 p-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                <span className="text-sm text-amber-700 dark:text-amber-400">
                  Extraction skipped
                </span>
              </div>
              {extractionError && (
                <p className="text-xs text-amber-600/80 dark:text-amber-400/80 ml-6">
                  {extractionError}
                  {errorMentionsProvider && (
                    <Link to="/settings?tab=llm" className="ml-1 underline hover:no-underline">
                      Go to Settings
                    </Link>
                  )}
                </p>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onReply?.(entry.id)}
              className="text-xs"
            >
              <MessageSquare className="h-3.5 w-3.5 mr-1" />
              Reply
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onReprocess}
              disabled={isReprocessing || entry.extractionStatus === "processing"}
              className="text-xs"
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5 mr-1", isReprocessing && "animate-spin")}
              />
              Reprocess
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
