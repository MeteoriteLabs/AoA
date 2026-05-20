import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { commanderConversationsApi, type ConversationRow } from "../api/internal-agent";
import { Plus, Archive, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../lib/utils";

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  const diffWk = Math.floor(diffDay / 7);
  if (diffWk < 5) return `${diffWk}w ago`;
  const diffMo = Math.floor(diffDay / 30);
  if (diffMo < 12) return `${diffMo}mo ago`;
  return `${Math.floor(diffMo / 12)}y ago`;
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

export function CommanderSessionsSidebar({
  activeConversationId,
  onSelect,
  onNewConversation,
}: Props) {
  const { selectedCompanyId } = useCompany();
  const qc = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);

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
  const groups = groupByDate(conversations);

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
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border-soft">
        <span className="text-[10px] font-semibold text-very-dim uppercase tracking-widest">
          Sessions
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={onNewConversation}
            className="w-6 h-6 inline-flex items-center justify-center rounded text-dim hover:bg-hd hover:text-text transition-colors"
            title="New conversation"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setCollapsed(true)}
            className="w-6 h-6 inline-flex items-center justify-center rounded text-dim hover:bg-hd hover:text-text transition-colors"
            title="Collapse sidebar"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto py-1">
        {conversations.length === 0 && (
          <p className="text-xs text-muted-foreground px-3 py-4 text-center">
            No sessions yet
          </p>
        )}
        {groups.map((group) => (
          <div key={group.label}>
            <div className="px-3 py-1.5 text-[9px] font-semibold text-muted-foreground uppercase tracking-widest">
              {group.label}
            </div>
            {group.items.map((conv) => (
              <SessionItem
                key={conv.id}
                conv={conv}
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

function SessionItem({
  conv,
  isActive,
  onSelect,
  onArchive,
}: {
  conv: ConversationRow;
  isActive: boolean;
  onSelect: () => void;
  onArchive: () => void;
}) {
  const title = conv.title ?? `Chat ${formatRelativeTime(conv.createdAt)}`;

  return (
    <div
      className={cn(
        "group relative flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-hd transition-colors",
        isActive && "bg-[color:color-mix(in_srgb,var(--brand)_6%,transparent)] border-l-2 border-l-brand pl-[10px]",
      )}
      onClick={onSelect}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{title}</p>
        <p className="font-mono text-[10px] text-very-dim truncate">
          {formatRelativeTime(conv.updatedAt)} ·{" "}
          {conv.messageCount} msg{conv.messageCount !== 1 ? "s" : ""}
        </p>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onArchive();
        }}
        className="hidden group-hover:flex items-center p-0.5 rounded hover:bg-black/10 transition-colors"
        title="Archive"
      >
        <Archive className="h-3 w-3 text-muted-foreground" />
      </button>
    </div>
  );
}
