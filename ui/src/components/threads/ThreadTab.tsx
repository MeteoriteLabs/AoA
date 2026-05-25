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
  const { connectionState, sendPresence } = useLiveUpdates();
  const isOffline = connectionState === "offline";
  const isReconnecting = connectionState === "reconnecting";
  // Composer is unusable whenever the socket is gone — both fully offline and
  // mid-reconnect. Sending in either state would silently drop the message.
  const isDisconnected = isOffline || isReconnecting;
  const [composerText, setComposerText] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  // Platform-aware send-shortcut hint (Cmd on macOS, Ctrl elsewhere).
  const sendKey =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.userAgent)
      ? "⌘"
      : "Ctrl";
  // Throttle typing heartbeats so we don't poke on every keystroke.
  const lastTypingSentRef = useRef(0);

  function handleComposerChange(value: string) {
    setComposerText(value);
    const now = Date.now();
    if (value.trim() && now - lastTypingSentRef.current > 2_000) {
      lastTypingSentRef.current = now;
      sendPresence(threadId, { typing: true });
    }
  }

  useEffect(() => {
    if (entries.length === 0 && !isLoading) {
      composerRef.current?.focus();
    }
  }, [entries.length, isLoading]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["threads", companyId, threadId] });
  };

  const addEntryMutation = useMutation({
    mutationFn: ({ content, parentEntryId }: { content: string; parentEntryId: string | null }) =>
      discussionsApi.addEntry(companyId, threadId, {
        rawContent: content,
        inputType: "write",
        parentEntryId,
      }),
    onSuccess: (_, { parentEntryId }) => {
      invalidate();
      setComposerText("");
      setReplyTo(null);
      pushToast({ title: parentEntryId ? "Reply added" : "Entry added", tone: "success" });
    },
    onError: () => {
      pushToast({ title: "Failed to add entry", tone: "warn" });
    },
  });

  function submitText() {
    const text = composerText.trim();
    if (!text || addEntryMutation.isPending) return;
    // Plan 7 (D2): don't fail silently on send while disconnected — warn instead.
    if (isDisconnected) {
      pushToast({
        title: isOffline
          ? "You're offline — message not sent"
          : "Reconnecting — message not sent",
        tone: "warn",
      });
      return;
    }
    addEntryMutation.mutate({ content: text, parentEntryId: replyTo });
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
      {replyTo && (
        <div
          className="flex items-center justify-between rounded-md bg-muted/50 px-2 py-1 text-[11px] text-muted-foreground"
          data-testid="thread-composer-reply-context"
        >
          <span>Replying to a post</span>
          <button
            type="button"
            className="underline hover:no-underline"
            onClick={() => setReplyTo(null)}
          >
            Cancel
          </button>
        </div>
      )}
      <textarea
        ref={composerRef}
        value={composerText}
        onChange={(e) => handleComposerChange(e.target.value)}
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
        disabled={addEntryMutation.isPending || isDisconnected}
        aria-label="Write a message"
        data-testid="thread-composer-textarea"
      />
      <div className="flex items-center justify-between gap-2">
        {isDisconnected ? (
          <span
            className="text-[11px] text-muted-foreground"
            data-testid="thread-composer-offline-hint"
          >
            {isOffline
              ? "You're offline"
              : "Reconnecting — messages will send when connected"}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[10px] font-medium leading-none">
              {sendKey}↵
            </kbd>
            to send
          </span>
        )}
        <Button
          type="submit"
          size="sm"
          disabled={!composerText.trim() || addEntryMutation.isPending || isDisconnected}
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

  // Group one level deep: top-level entries, each followed by direct replies.
  // Replies whose parent is not a known top-level id are treated as top-level (orphan safety).
  const topLevel = entries.filter((e) => !e.parentEntryId);
  const topLevelIds = new Set(topLevel.map((e) => e.id));
  const repliesByParent = new Map<string, DiscussionEntry[]>();
  for (const e of entries) {
    if (e.parentEntryId && topLevelIds.has(e.parentEntryId)) {
      const list = repliesByParent.get(e.parentEntryId) ?? [];
      list.push(e);
      repliesByParent.set(e.parentEntryId, list);
    }
  }
  const orphans = entries.filter(
    (e) => e.parentEntryId && !topLevelIds.has(e.parentEntryId),
  );
  const roots = [...topLevel, ...orphans];

  return (
    <div className="flex flex-col">
      <div className="space-y-1.5" data-testid="thread-tab-entries">
        {roots.map((entry) => (
          <div key={entry.id} data-testid={`entry-group-${entry.id}`} className="space-y-1.5">
            <EntryRow
              entry={entry}
              onReprocess={() => reprocessMutation.mutate(entry.id)}
              onReply={(id) => {
                setReplyTo(id);
                composerRef.current?.focus();
              }}
              isReprocessing={
                reprocessMutation.isPending && reprocessMutation.variables === entry.id
              }
              indentLevel={0}
            />
            {(repliesByParent.get(entry.id) ?? []).map((reply) => (
              <EntryRow
                key={reply.id}
                entry={reply}
                onReprocess={() => reprocessMutation.mutate(reply.id)}
                onReply={() => {
                  // Replies to a reply target the top-level parent (shallow threading)
                  setReplyTo(entry.id);
                  composerRef.current?.focus();
                }}
                isReprocessing={
                  reprocessMutation.isPending && reprocessMutation.variables === reply.id
                }
                indentLevel={1}
              />
            ))}
          </div>
        ))}
      </div>
      {composer}
    </div>
  );
}
