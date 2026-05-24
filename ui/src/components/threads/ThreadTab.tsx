/**
 * ThreadTab — renders the thread entries timeline.
 * Reuses EntryRow for individual entries.
 * Used inside ThreadDetail's center panel (Thread tab).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { discussionsApi, type DiscussionEntry } from "../../api/discussions";
import { useToast } from "../../context/ToastContext";
import { EntryRow } from "./EntryRow";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

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

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["threads", companyId, threadId] });
  };

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

  // ── Empty state ──
  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-sm text-muted-foreground">
          No posts yet — start the discussion.
        </p>
      </div>
    );
  }

  // Group entries by parentEntryId to support 2-level nesting
  const topLevelEntries = entries.filter((e) => !(e as { parentEntryId?: string }).parentEntryId);
  const repliesByParent = entries.reduce(
    (acc, e) => {
      const parentId = (e as { parentEntryId?: string }).parentEntryId;
      if (!parentId) return acc;
      if (!acc[parentId]) acc[parentId] = [];
      acc[parentId].push(e);
      return acc;
    },
    {} as Record<string, DiscussionEntry[]>,
  );

  return (
    <div className="space-y-1.5" data-testid="thread-tab-entries">
      {topLevelEntries.map((entry) => (
        <div key={entry.id}>
          <EntryRow
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
          {/* Nested replies (max 2-deep) */}
          {(repliesByParent[entry.id] ?? []).map((reply) => (
            <EntryRow
              key={reply.id}
              entry={reply}
              onReprocess={() => reprocessMutation.mutate(reply.id)}
              onAddAnnotation={(content, start, end) =>
                addAnnotationMutation.mutate({
                  entryId: reply.id,
                  data: { content, anchorStart: start, anchorEnd: end },
                })
              }
              isReprocessing={
                reprocessMutation.isPending && reprocessMutation.variables === reply.id
              }
              indentLevel={1}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
