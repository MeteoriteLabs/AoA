import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "../../context/CompanyContext";
import { commanderConversationsApi, type ConversationRow } from "../../api/internal-agent";
import { Plus, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { cn } from "../../lib/utils";
import { SessionRow } from "./SessionRow";

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

  const { data } = useQuery({
    queryKey: ["commander-conversations", selectedCompanyId],
    queryFn: () => commanderConversationsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const archiveMutation = useMutation({
    mutationFn: (convId: string) =>
      commanderConversationsApi.archive(selectedCompanyId!, convId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["commander-conversations"] }),
  });

  const conversations = data?.conversations ?? [];
  const filtered = useMemo(
    () => filterConversationsByTitle(conversations, searchQuery),
    [conversations, searchQuery],
  );
  const groups = useMemo(() => groupByDate(filtered), [filtered]);

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
    return (
      <div className="flex flex-col items-center w-9 shrink-0 border-r border-border bg-secondary-sidebar">
        <button
          onClick={() => setCollapsed(false)}
          className="mt-3 p-1 rounded hover:bg-black/10 transition-colors"
          title="Expand sessions"
        >
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>
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
                onArchive={() => archiveMutation.mutate(conv.id)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

