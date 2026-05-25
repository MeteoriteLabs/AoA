/**
 * ThreadTab — renders the thread entries timeline.
 * Reuses EntryRow for individual entries.
 * Includes a composer at the bottom for creating new entries.
 * Used inside ThreadDetail's center panel (Thread tab).
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { discussionsApi, type DiscussionEntry } from "../../api/discussions";
import { useToast } from "../../context/ToastContext";
import { useLiveUpdates } from "../../context/LiveUpdatesProvider";
import { EntryRow } from "./EntryRow";
import { Button } from "@/components/ui/button";
import { RefreshCw, SendHorizonal } from "lucide-react";

/* ════════════════════════════════════════════════════════════════════════
   ThreadTab
   ════════════════════════════════════════════════════════════════════════ */

export interface ThreadTabProps {
  threadId: string;
  companyId: string;
  entries: DiscussionEntry[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

export function ThreadTab({
  threadId,
  companyId,
  entries,
  isLoading,
  isError,
  onRetry,
}: ThreadTabProps) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const { connectionState } = useLiveUpdates();
  const isOffline = connectionState === "offline";
  const [composerText, setComposerText] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (entries.length === 0 && !isLoading) {
      composerRef.current?.focus();
    }
  }, [entries.length, isLoading]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["threads", companyId, threadId] });
  };

  const addEntryMutation = useMutation({
    mutationFn: (content: string) =>
      discussionsApi.addEntry(companyId, threadId, { rawContent: content, inputType: "write" }),
    onSuccess: () => {
      invalidate();
      setComposerText("");
      pushToast({ title: "Entry added", tone: "success" });
    },
    onError: () => {
      pushToast({ title: "Failed to add entry", tone: "warn" });
    },
  });

  function submitText() {
    const text = composerText.trim();
    if (!text || addEntryMutation.isPending) return;
    // Plan 7 (D2): don't fail silently on send while offline — warn instead.
    if (isOffline) {
      pushToast({ title: "You're offline — message not sent", tone: "warn" });
      return;
    }
    addEntryMutation.mutate(text);
  }

  function handleComposerSubmit(e: React.FormEvent) {
    e.preventDefault();
    submitText();
  }

  const reprocessMutation = useMutation({
    mutationFn: (entryId: string) =>
      discussionsApi.reprocessEntry(companyId, threadId, entryId),
    onSuccess: () => {
      invalidate();
      pushToast({ title: "Reprocessing entry...", tone: "success" });
    },
    onError: () => {
      pushToast({ title: "Failed to reprocess entry", tone: "warn" });
    },
  });

  const addAnnotationMutation = useMutation({
    mutationFn: ({
      entryId,
      data,
    }: {
      entryId: string;
      data: { content: string; anchorStart: number | null; anchorEnd: number | null };
    }) => discussionsApi.addAnnotation(companyId, threadId, entryId, data),
    onSuccess: () => {
      invalidate();
      pushToast({ title: "Annotation added", tone: "success" });
    },
    onError: () => {
      pushToast({ title: "Failed to add annotation", tone: "warn" });
    },
  });

  // ── Loading skeleton ──
  if (isLoading) {
    return (
      <div
        className="space-y-3 py-4"
        data-testid="thread-tab-skeleton"
        aria-label="Loading thread posts..."
      >
        <div className="h-10 rounded-lg bg-muted animate-pulse" />
        <div className="h-10 rounded-lg bg-muted animate-pulse" />
        <div className="h-10 rounded-lg bg-muted animate-pulse" />
      </div>
    );
  }

  // ── Error state ──
  if (isError) {
    return (
      <div
        className="flex flex-col items-center gap-3 py-8"
        data-testid="thread-tab-error"
      >
        <p className="text-sm text-muted-foreground">Couldn&apos;t load posts.</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="h-4 w-4 mr-1.5" />
          Retry
        </Button>
      </div>
    );
  }

  // Composer node — always rendered at the bottom (empty-state or entries)
  const composer = (
    <form
      onSubmit={handleComposerSubmit}
      className="flex flex-col gap-2 pt-3 border-t border-border mt-4"
      data-testid="thread-composer"
    >
      <textarea
        ref={composerRef}
        value={composerText}
        onChange={(e) => setComposerText(e.target.value)}
        placeholder="Write a message..."
        rows={3}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
        onKeyDown={(e) => {
          // Ctrl+Enter / Cmd+Enter submits
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            submitText();
          }
        }}
        disabled={addEntryMutation.isPending || isOffline}
        aria-label="Write a message"
        data-testid="thread-composer-textarea"
      />
      <div className="flex items-center justify-between gap-2">
        {isOffline ? (
          <span
            className="text-[11px] text-muted-foreground"
            data-testid="thread-composer-offline-hint"
          >
            You&apos;re offline — messages can&apos;t be sent right now.
          </span>
        ) : (
          <span />
        )}
        <Button
          type="submit"
          size="sm"
          disabled={!composerText.trim() || addEntryMutation.isPending || isOffline}
          data-testid="thread-composer-submit"
        >
          <SendHorizonal className="h-4 w-4 mr-1.5" />
          Submit
        </Button>
      </div>
    </form>
  );

  // ── Empty state ──
  if (entries.length === 0) {
    return (
      <div className="flex flex-col">
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-sm text-muted-foreground">
            No posts yet — start the discussion.
          </p>
        </div>
        {composer}
      </div>
    );
  }

  // TODO: re-enable nesting when parentEntryId is added to DiscussionEntry
  // (parentEntryId does not exist on the type; the cast was dead code — all entries are top-level)

  return (
    <div className="flex flex-col">
      <div className="space-y-1.5" data-testid="thread-tab-entries">
        {entries.map((entry) => (
          <EntryRow
            key={entry.id}
            entry={entry}
            onReprocess={() => reprocessMutation.mutate(entry.id)}
            onAddAnnotation={(content, start, end) =>
              addAnnotationMutation.mutate({
                entryId: entry.id,
                data: { content, anchorStart: start, anchorEnd: end },
              })
            }
            isReprocessing={
              reprocessMutation.isPending && reprocessMutation.variables === entry.id
            }
            indentLevel={0}
          />
        ))}
      </div>
      {composer}
    </div>
  );
}
