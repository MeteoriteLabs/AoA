import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "../../context/CompanyContext";
import { commanderConversationsApi, type ConversationRow } from "../../api/internal-agent";
import { Plus, ChevronLeft, Search, X, Pin } from "lucide-react";
import { SessionRow } from "./SessionRow";
import { CollapsedSessionStrip } from "./CollapsedSessionStrip";

/** Pure exported helper — used by SessionsSidebar and pinned-group filter in Task 6. */
export function filterConversationsByTitle(
  conversations: ConversationRow[],
  query: string,
): ConversationRow[] {
  const trimmed = query.trim();
  if (!trimmed) return conversations;
  const lower = trimmed.toLowerCase();
  return conversations.filter((conv) =>
    (conv.title ?? "").toLowerCase().includes(lower),
  );
}

interface Props {
  activeConversationId: string | null;
  onSelect: (conversationId: string) => void;
  onNewConversation: () => void;
}

function groupByDate(conversations: ConversationRow[]) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate() - 1);
  const weekStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate() - 7);
  const groups: { label: string; items: ConversationRow[] }[] = [
    { label: "TODAY", items: [] },
    { label: "YESTERDAY", items: [] },
    { label: "THIS WEEK", items: [] },
    { label: "OLDER", items: [] },
  ];
  for (const conv of conversations) {
    const d = new Date(conv.updatedAt);
    if (d >= todayStart) groups[0].items.push(conv);
    else if (d >= yesterdayStart) groups[1].items.push(conv);
    else if (d >= weekStart) groups[2].items.push(conv);
    else groups[3].items.push(conv);
  }
  return groups.filter((g) => g.items.length > 0);
}

/**
 * Pure cache-update helpers — exported for unit testing.
 * Each takes the current cache data shape and returns the updated shape.
 */
export function applyPinOptimistic(
  data: { conversations: ConversationRow[] } | undefined,
  convId: string,
  pinned: boolean,
): { conversations: ConversationRow[] } {
  const conversations = data?.conversations ?? [];
  return {
    conversations: conversations.map((c) =>
      c.id === convId ? { ...c, pinned } : c,
    ),
  };
}

export function applyRenameOptimistic(
  data: { conversations: ConversationRow[] } | undefined,
  convId: string,
  title: string,
): { conversations: ConversationRow[] } {
  const conversations = data?.conversations ?? [];
  return {
    conversations: conversations.map((c) =>
      c.id === convId ? { ...c, title } : c,
    ),
  };
}

export function applyDeleteOptimistic(
  data: { conversations: ConversationRow[] } | undefined,
  convId: string,
): { conversations: ConversationRow[] } {
  const conversations = data?.conversations ?? [];
  return {
    conversations: conversations.filter((c) => c.id !== convId),
  };
}

export function SessionsSidebar({
  activeConversationId,
  onSelect,
  onNewConversation,
}: Props) {
  const { selectedCompanyId } = useCompany();
  const qc = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const queryKey = ["commander-conversations", selectedCompanyId] as const;

  const { data } = useQuery({
    queryKey,
    queryFn: () => commanderConversationsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const archiveMutation = useMutation({
    mutationFn: (convId: string) =>
      commanderConversationsApi.archive(selectedCompanyId!, convId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["commander-conversations"] }),
  });

  const pinMutation = useMutation({
    mutationFn: ({ convId, pinned }: { convId: string; pinned: boolean }) =>
      commanderConversationsApi.pin(selectedCompanyId!, convId, pinned),
    onMutate: async ({ convId, pinned }) => {
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<{ conversations: ConversationRow[] }>(queryKey);
      qc.setQueryData(queryKey, applyPinOptimistic(previous, convId, pinned));
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(queryKey, ctx.previous);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["commander-conversations"] });
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ convId, title }: { convId: string; title: string }) =>
      commanderConversationsApi.rename(selectedCompanyId!, convId, title),
    onMutate: async ({ convId, title }) => {
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<{ conversations: ConversationRow[] }>(queryKey);
      qc.setQueryData(queryKey, applyRenameOptimistic(previous, convId, title));
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(queryKey, ctx.previous);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["commander-conversations"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (convId: string) =>
      commanderConversationsApi.remove(selectedCompanyId!, convId),
    onMutate: async (convId) => {
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<{ conversations: ConversationRow[] }>(queryKey);
      qc.setQueryData(queryKey, applyDeleteOptimistic(previous, convId));
      return { previous };
    },
    onError: (_err, _convId, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(queryKey, ctx.previous);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["commander-conversations"] });
    },
  });

  const conversations = data?.conversations ?? [];
  const filtered = useMemo(
    () => filterConversationsByTitle(conversations, searchQuery),
    [conversations, searchQuery],
  );

  /**
   * PINNED group: top 5 pinned conversations from the filtered list, sorted by
   * updatedAt descending.
   * pinnedAt not tracked; sort by updatedAt as proxy.
   * Cap at 5 — overflow conversations remain visible in their date groups.
   */
  const pinned = useMemo(
    () =>
      filtered
        .filter((c) => c.pinned)
        .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
        .slice(0, 5),
    [filtered],
  );

  /**
   * Exclude the displayed-pinned 5 from date groups to avoid duplication.
   * If a user has >5 pinned conversations, the overflow still appears in its
   * date group so no sessions are hidden.
   */
  const pinnedIds = useMemo(() => new Set(pinned.map((c) => c.id)), [pinned]);

  const groups = useMemo(
    () => groupByDate(filtered.filter((c) => !pinnedIds.has(c.id))),
    [filtered, pinnedIds],
  );

  // Auto-focus the input when search opens
  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus();
    }
  }, [searchOpen]);

  function handleNewChat() {
    setSearchQuery("");
    setSearchOpen(false);
    onNewConversation();
  }

  if (collapsed) {
    // Pass the full conversations list (not filtered) — collapsed view has no
    // search box, so filtering by the search query would silently hide sessions.
    return (
      <CollapsedSessionStrip
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelect={onSelect}
        onExpand={() => setCollapsed(false)}
        onNewConversation={handleNewChat}
      />
    );
  }

  return (
    <div className="flex flex-col h-full w-56 shrink-0 border-r border-border bg-secondary-sidebar">
      {/* Header */}
      <div className="px-2.5 pt-2.5 pb-0 border-b border-border-soft">
        {/* New chat button — full-width brand primary */}
        <button
          onClick={handleNewChat}
          className="w-full h-8 flex items-center justify-center gap-1.5 rounded-md bg-brand text-white text-[0.78rem] font-medium hover:bg-brand-hover transition-colors mb-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          New chat
        </button>

        {/* Search sessions — full-width ghost that morphs to input */}
        {searchOpen ? (
          <div className="w-full h-8 flex items-center gap-1.5 rounded-md border border-border px-2 mb-1.5 bg-field">
            <Search className="h-3.5 w-3.5 text-dim shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
              }}
              onBlur={() => {
                if (!searchQuery.trim()) setSearchOpen(false);
              }}
              placeholder="Search sessions…"
              className="flex-1 min-w-0 bg-transparent text-[0.78rem] text-text placeholder:text-very-dim outline-none"
            />
            {searchQuery && (
              <button
                onMouseDown={(e) => {
                  // prevent input blur before we clear
                  e.preventDefault();
                  setSearchQuery("");
                  setSearchOpen(false);
                }}
                className="shrink-0 p-0.5 rounded hover:bg-hd transition-colors"
                title="Clear search"
              >
                <X className="h-3 w-3 text-dim" />
              </button>
            )}
          </div>
        ) : (
          <button
            onClick={() => setSearchOpen(true)}
            className="w-full h-8 flex items-center justify-center gap-1.5 rounded-md border border-border text-dim text-[0.78rem] hover:bg-hd hover:text-text transition-colors mb-1.5"
          >
            <Search className="h-3.5 w-3.5" />
            Search sessions
          </button>
        )}

        {/* Status row */}
        <div className="flex items-center justify-between py-1 pb-2">
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-success shrink-0" />
            <span className="text-[0.7rem] text-very-dim">online</span>
          </div>
          <button
            data-commander-touch
            onClick={() => setCollapsed(true)}
            className="p-0.5 rounded text-dim hover:bg-hd hover:text-text transition-colors"
            title="Collapse sidebar"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto py-1">
        {filtered.length === 0 && (
          <p className="text-xs text-muted-foreground px-3 py-4 text-center">
            {searchQuery.trim() ? "No sessions match" : "No sessions yet"}
          </p>
        )}

        {/* PINNED group — rendered above date groups when any pinned sessions exist */}
        {pinned.length > 0 && (
          <div>
            <div className="px-3 py-1.5 flex items-center gap-1 text-[9px] font-semibold text-muted-foreground uppercase tracking-widest">
              <Pin className="h-2.5 w-2.5 shrink-0" />
              Pinned
            </div>
            {pinned.map((conv) => (
              <SessionRow
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeConversationId}
                onSelect={() => onSelect(conv.id)}
                onPin={(p) => pinMutation.mutate({ convId: conv.id, pinned: p })}
                onRename={(title) => renameMutation.mutate({ convId: conv.id, title })}
                onArchive={() => archiveMutation.mutate(conv.id)}
                onDelete={() => deleteMutation.mutate(conv.id)}
              />
            ))}
          </div>
        )}

        {groups.map((group) => (
          <div key={group.label}>
            <div className="px-3 py-1.5 text-[9px] font-semibold text-muted-foreground uppercase tracking-widest">
              {group.label}
            </div>
            {group.items.map((conv) => (
              <SessionRow
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeConversationId}
                onSelect={() => onSelect(conv.id)}
                onPin={(p) => pinMutation.mutate({ convId: conv.id, pinned: p })}
                onRename={(title) => renameMutation.mutate({ convId: conv.id, title })}
                onArchive={() => archiveMutation.mutate(conv.id)}
                onDelete={() => deleteMutation.mutate(conv.id)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
