/**
 * ThreadTab — group-chat message stream.
 * Uses EntryRow for each entry (bubble/card style).
 * Composer at the bottom with user avatar + input + send.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { discussionsApi, type DiscussionEntry } from "../../api/discussions";
import { authApi } from "../../api/auth";
import { useToast } from "../../context/ToastContext";
import { useLiveUpdates } from "../../context/LiveUpdatesProvider";
import { queryKeys } from "../../lib/queryKeys";
import { EntryRow } from "./EntryRow";
import { Button } from "@/components/ui/button";
import { RefreshCw, SendHorizonal, Paperclip } from "lucide-react";
import { relativeTime } from "@/lib/utils";

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
  const isDisconnected = isOffline || isReconnecting;

  // Current user identity — for right-aligning own messages
  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });
  const currentUserId =
    (session as Record<string, unknown> | undefined)?.userId as string | null ??
    (session as { user?: { id?: string } } | undefined)?.user?.id ??
    null;

  const [composerText, setComposerText] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastTypingSentRef = useRef(0);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (entries.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [entries.length]);

  // Focus composer when thread is empty
  useEffect(() => {
    if (entries.length === 0 && !isLoading) {
      composerRef.current?.focus();
    }
  }, [entries.length, isLoading]);

  function handleComposerChange(value: string) {
    setComposerText(value);
    const now = Date.now();
    if (value.trim() && now - lastTypingSentRef.current > 2_000) {
      lastTypingSentRef.current = now;
      sendPresence(threadId, { typing: true });
    }
  }

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["threads", companyId, threadId] });
  };

  const addEntryMutation = useMutation({
    mutationFn: (content: string) =>
      discussionsApi.addEntry(companyId, threadId, {
        rawContent: content,
        inputType: "write",
        parentEntryId: null,
      }),
    onSuccess: () => {
      invalidate();
      setComposerText("");
    },
    onError: () => {
      pushToast({ title: "Failed to send message", tone: "warn" });
    },
  });

  function submitText() {
    const text = composerText.trim();
    if (!text || addEntryMutation.isPending) return;
    if (isDisconnected) {
      pushToast({
        title: isOffline ? "You're offline — message not sent" : "Reconnecting — message not sent",
        tone: "warn",
      });
      return;
    }
    addEntryMutation.mutate(text);
  }

  const reprocessMutation = useMutation({
    mutationFn: (entryId: string) =>
      discussionsApi.reprocessEntry(companyId, threadId, entryId),
    onSuccess: () => {
      invalidate();
      pushToast({ title: "Reprocessing entry…", tone: "success" });
    },
    onError: () => {
      pushToast({ title: "Failed to reprocess entry", tone: "warn" });
    },
  });

  // ── Loading skeleton ──
  if (isLoading) {
    return (
      <div className="space-y-4 py-4" data-testid="thread-tab-skeleton">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-end gap-2">
            <div className="w-8 h-8 rounded-full bg-muted animate-pulse shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 rounded bg-muted animate-pulse w-24" />
              <div
                className="h-12 rounded-xl bg-muted animate-pulse"
                style={{ borderRadius: "4px 14px 14px 14px" }}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ── Error state ──
  if (isError) {
    return (
      <div className="flex flex-col items-center gap-3 py-8" data-testid="thread-tab-error">
        <p className="text-sm text-muted-foreground">Couldn&apos;t load messages.</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="h-4 w-4 mr-1.5" />
          Retry
        </Button>
      </div>
    );
  }

  // Derive user initials for composer avatar
  const myInitials = currentUserId
    ? currentUserId === "local-board"
      ? "LB"
      : currentUserId.replace(/[-_]/g, " ").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "Me"
    : "Me";

  const composer = (
    <div
      className="shrink-0 px-4 py-3 border-t border-border"
      style={{ background: "var(--card, #161a20)" }}
      data-testid="thread-composer"
    >
      {isDisconnected && (
        <div
          className="mb-2 rounded-md px-3 py-1.5 text-xs text-muted-foreground"
          style={{ background: "hsl(38 20% 10%)", border: "1px solid rgba(217,169,56,0.25)" }}
          data-testid="thread-composer-offline-hint"
        >
          {isOffline ? "You're offline — messages won't send" : "Reconnecting…"}
        </div>
      )}
      <div className="flex items-center gap-2.5">
        {/* User avatar */}
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
          style={{ background: "hsl(221 22% 34%)" }}
          aria-hidden="true"
        >
          {myInitials}
        </div>

        {/* Input area */}
        <div
          className="flex-1 flex items-center gap-1 rounded-xl border border-border/80 px-3 focus-within:border-border"
          style={{ background: "var(--field, #0e1014)" }}
        >
          <textarea
            ref={composerRef}
            value={composerText}
            onChange={(e) => handleComposerChange(e.target.value)}
            placeholder="Reply… @mention to summon crew"
            rows={1}
            className="flex-1 bg-transparent py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none resize-none min-h-[40px] max-h-[120px]"
            style={{ lineHeight: "1.4" }}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                submitText();
              }
            }}
            disabled={addEntryMutation.isPending || isDisconnected}
            aria-label="Write a message"
            data-testid="thread-composer-textarea"
          />
          {/* Attach icon (TODO: wire up) */}
          <button
            type="button"
            title="Attach file (coming soon)"
            className="shrink-0 p-1 rounded text-muted-foreground/40 hover:text-muted-foreground transition-colors"
            tabIndex={-1}
          >
            <Paperclip className="h-4 w-4" />
          </button>
        </div>

        {/* Send button */}
        <button
          type="button"
          onClick={submitText}
          disabled={!composerText.trim() || addEntryMutation.isPending || isDisconnected}
          className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-opacity disabled:opacity-40"
          style={{ background: "#b82d1c" }}
          aria-label="Send"
          data-testid="thread-composer-submit"
        >
          <SendHorizonal className="h-4 w-4 text-white" />
        </button>
      </div>
    </div>
  );

  // ── Empty state ──
  if (entries.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex flex-col items-center justify-center py-12 text-center px-6">
          <p className="text-sm text-muted-foreground mb-1">No messages yet.</p>
          <p className="text-xs text-muted-foreground/60">Start the discussion below.</p>
        </div>
        {composer}
      </div>
    );
  }

  // Group: top-level first, replies underneath; orphan replies treated as top-level
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
  const orphans = entries.filter((e) => e.parentEntryId && !topLevelIds.has(e.parentEntryId));
  const roots = [...topLevel, ...orphans];

  return (
    <div className="flex flex-col h-full">
      {/* Message list */}
      <div
        className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3"
        data-testid="thread-tab-entries"
      >
        {roots.map((entry) => (
          <div key={entry.id} data-testid={`entry-group-${entry.id}`} className="space-y-2">
            <EntryRow
              entry={entry}
              currentUserId={currentUserId}
              onReprocess={() => reprocessMutation.mutate(entry.id)}
              isReprocessing={
                reprocessMutation.isPending && reprocessMutation.variables === entry.id
              }
            />
            {(repliesByParent.get(entry.id) ?? []).map((reply) => (
              <div key={reply.id} className="pl-10">
                <EntryRow
                  entry={reply}
                  currentUserId={currentUserId}
                  onReprocess={() => reprocessMutation.mutate(reply.id)}
                  isReprocessing={
                    reprocessMutation.isPending && reprocessMutation.variables === reply.id
                  }
                />
              </div>
            ))}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {composer}
    </div>
  );
}
