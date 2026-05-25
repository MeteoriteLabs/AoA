/**
 * EntryRow — shared between DiscussionDetail and ThreadTab.
 * Renders a single discussion entry in a compact collapsible style.
 * Extracted from DiscussionDetail.tsx's ThreadEntryRow.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronRight,
  ClipboardPen,
  Loader2,
  MessageCirclePlus,
  MessageSquare,
  Mic,
  PenLine,
  Plug,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/utils";
import type { DiscussionEntry, Annotation } from "../../api/discussions";
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
  onAddAnnotation?: (
    content: string,
    anchorStart: number | null,
    anchorEnd: number | null,
  ) => void;
  isReprocessing?: boolean;
  /** Indent level for nested replies (0 = top-level, 1 = reply) */
  indentLevel?: number;
  /** Reply to this entry — opens the composer targeting this entry as parent. */
  onReply?: (entryId: string) => void;
}

export function EntryRow({
  entry,
  onReprocess,
  onAddAnnotation,
  isReprocessing = false,
  indentLevel = 0,
  onReply,
}: EntryRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [showAnnotationInput, setShowAnnotationInput] = useState(false);
  const [annotationText, setAnnotationText] = useState("");
  const [selectedRange, setSelectedRange] = useState<{ start: number; end: number } | null>(null);
  const contentRef = useRef<HTMLParagraphElement>(null);

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

  const handleTextSelect = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !contentRef.current) return;
    if (!contentRef.current.contains(selection.anchorNode)) return;
    const range = selection.getRangeAt(0);
    const preRange = document.createRange();
    preRange.setStart(contentRef.current, 0);
    preRange.setEnd(range.startContainer, range.startOffset);
    const start = preRange.toString().length;
    const end = start + range.toString().length;
    if (end > start) {
      setSelectedRange({ start, end });
      setShowAnnotationInput(true);
    }
  }, []);

  function submitAnnotation() {
    if (!annotationText.trim()) return;
    onAddAnnotation?.(
      annotationText.trim(),
      selectedRange?.start ?? null,
      selectedRange?.end ?? null,
    );
    setAnnotationText("");
    setShowAnnotationInput(false);
    setSelectedRange(null);
  }

  // Rendered content with annotation highlights
  const renderedContent = useMemo(() => {
    if (!entry.annotations || entry.annotations.length === 0) return null;
    const anchored = entry.annotations.filter(
      (a) => a.anchorStart != null && a.anchorEnd != null,
    );
    if (anchored.length === 0) return null;

    const text = entry.rawContent;
    const charMap: Annotation[][] = new Array(text.length);
    for (let i = 0; i < text.length; i++) charMap[i] = [];
    for (const ann of anchored) {
      const start = Math.max(0, ann.anchorStart!);
      const end = Math.min(text.length, ann.anchorEnd!);
      for (let i = start; i < end; i++) charMap[i].push(ann);
    }

    const segments: { text: string; annotations: Annotation[] }[] = [];
    let segStart = 0;
    for (let i = 1; i <= text.length; i++) {
      const prevAnns = charMap[i - 1];
      const currAnns = i < text.length ? charMap[i] : [];
      const same =
        prevAnns.length === currAnns.length &&
        prevAnns.every((a, idx) => a.id === currAnns[idx]?.id);
      if (!same || i === text.length) {
        segments.push({ text: text.slice(segStart, i), annotations: prevAnns });
        segStart = i;
      }
    }
    return segments;
  }, [entry.rawContent, entry.annotations]);

  const generalAnnotations = useMemo(
    () => (entry.annotations ?? []).filter((a) => a.anchorStart == null),
    [entry.annotations],
  );

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
            <p
              ref={contentRef}
              onMouseUp={handleTextSelect}
              className="text-sm whitespace-pre-wrap text-muted-foreground leading-relaxed select-text cursor-text"
            >
              {renderedContent
                ? renderedContent.map((seg, i) =>
                    seg.annotations.length > 0 ? (
                      <span
                        key={i}
                        className="bg-yellow-200/60 dark:bg-yellow-800/40 border-b border-yellow-400 dark:border-yellow-600 cursor-help"
                        title={seg.annotations.map((a) => a.content).join("\n---\n")}
                      >
                        {seg.text}
                      </span>
                    ) : (
                      <span key={i}>{seg.text}</span>
                    ),
                  )
                : entry.rawContent}
            </p>
          </div>

          {/* General annotations */}
          {generalAnnotations.length > 0 && (
            <div className="space-y-1">
              {generalAnnotations.map((ann) => (
                <div
                  key={ann.id}
                  className="flex items-start gap-2 rounded-md bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 p-2"
                >
                  <MessageCirclePlus className="h-3.5 w-3.5 text-yellow-600 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-xs text-yellow-800 dark:text-yellow-300">{ann.content}</p>
                    <span className="text-[10px] text-yellow-600/80">
                      {new Date(ann.createdAt).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Annotation input */}
          {showAnnotationInput && (
            <div className="flex items-start gap-2 rounded-md border border-yellow-300 dark:border-yellow-700 bg-yellow-50/50 dark:bg-yellow-950/20 p-3">
              <MessageCirclePlus className="h-4 w-4 text-yellow-600 shrink-0 mt-1" />
              <div className="flex-1 space-y-2">
                {selectedRange && (
                  <p className="text-[10px] text-yellow-700 dark:text-yellow-400">
                    Annotating: &ldquo;
                    {entry.rawContent.slice(
                      selectedRange.start,
                      Math.min(selectedRange.end, selectedRange.start + 80),
                    )}
                    {selectedRange.end - selectedRange.start > 80 ? "..." : ""}
                    &rdquo;
                  </p>
                )}
                <Textarea
                  value={annotationText}
                  onChange={(e) => setAnnotationText(e.target.value)}
                  placeholder={
                    selectedRange
                      ? "Add a note about this selection..."
                      : "Add a general note to this entry..."
                  }
                  className="min-h-[60px] text-sm resize-y bg-white dark:bg-background"
                  autoFocus
                />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowAnnotationInput(false);
                      setAnnotationText("");
                      setSelectedRange(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={submitAnnotation}
                    disabled={!annotationText.trim()}
                  >
                    Add Note
                  </Button>
                </div>
              </div>
            </div>
          )}

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
              onClick={() => {
                setSelectedRange(null);
                setShowAnnotationInput((p) => !p);
              }}
              className={cn("text-xs", showAnnotationInput && "bg-accent")}
            >
              <MessageCirclePlus className="h-3.5 w-3.5 mr-1" />
              Annotate
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
