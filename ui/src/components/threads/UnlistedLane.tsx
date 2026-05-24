import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "../../context/CompanyContext";
import { api } from "../../api/client";
import { threadsApi } from "../../api/threads";
import { cn } from "../../lib/utils";
import { Sparkles, ChevronDown, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { InboxCardItem } from "./ThreadBoard";

/* ════════════════════════════════════════════════════════════════════════
   UnlistedLane — amber triage queue for un-routed inbound items
   ════════════════════════════════════════════════════════════════════════ */

type TriageAction = "make_thread" | "attach" | "dismiss";

interface TriagePayload {
  action: TriageAction;
  threadId?: string;
}

interface UnlistedLaneProps {
  inboxItems: InboxCardItem[];
  /** Called after any item is triaged (dismissed, attached, or made into a thread) */
  onTriaged: (itemId: string, action: TriageAction) => void;
}

export function UnlistedLane({ inboxItems, onTriaged }: UnlistedLaneProps) {
  return (
    <div
      className="flex-none w-[220px] rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 flex flex-col"
      data-testid="unlisted-lane"
    >
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-amber-200 dark:border-amber-800">
        <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wider">
          Unlisted
        </p>
        <p className="text-[10px] text-amber-700/70 dark:text-amber-400/70 mt-0.5">
          Needs triage
        </p>
      </div>

      {/* Items */}
      <div className="flex-1 p-2 space-y-2 overflow-y-auto">
        {inboxItems.length === 0 ? (
          <p className="text-xs text-amber-700/50 dark:text-amber-400/50 text-center py-4">
            Nothing to triage
          </p>
        ) : (
          inboxItems.map((item) => (
            <InboxTriageCard
              key={item.id}
              item={item}
              onTriaged={onTriaged}
            />
          ))
        )}
      </div>
    </div>
  );
}

/* ── Triage card ─────────────────────────────────────────────────────────────── */

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface InboxTriageCardProps {
  item: InboxCardItem;
  onTriaged: (itemId: string, action: TriageAction) => void;
}

function InboxTriageCard({ item, onTriaged }: InboxTriageCardProps) {
  const { selectedCompanyId } = useCompany();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddTo, setShowAddTo] = useState(false);

  // Load existing threads for "Add to" dropdown — only when the dropdown is open
  const { data: threadsData, isFetching: isLoadingThreads } = useQuery({
    queryKey: ["threads", selectedCompanyId, "list"],
    queryFn: () => threadsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId && showAddTo,
    staleTime: 30_000,
  });

  const existingThreads = threadsData?.discussions ?? [];

  async function triage(action: TriageAction, threadId?: string) {
    if (!selectedCompanyId) return;
    setIsPending(true);
    setError(null);
    try {
      const payload: TriagePayload = { action };
      if (threadId) payload.threadId = threadId;

      await api.post(
        `/companies/${selectedCompanyId}/discussions/inbox/${item.id}/triage`,
        payload,
      );
      onTriaged(item.id, action);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Triage failed");
    } finally {
      setIsPending(false);
    }
  }

  async function handleAttach(e: React.ChangeEvent<HTMLSelectElement>) {
    const threadId = e.target.value;
    if (!threadId) return;
    setShowAddTo(false);
    await triage("attach", threadId);
  }

  return (
    <div
      className={cn(
        "rounded-md border border-amber-200 dark:border-amber-800 bg-white dark:bg-amber-950/40 p-2 space-y-2",
        isPending && "opacity-60",
      )}
      data-testid={`inbox-item-${item.id}`}
    >
      {/* Content preview */}
      <p className="text-xs line-clamp-3 text-foreground/80 leading-relaxed">
        {item.rawContent}
      </p>

      {/* Meta */}
      <div className="flex items-center justify-between">
        {item.originSource && (
          <span className="text-[10px] text-amber-700/70 dark:text-amber-400/70 capitalize">
            {item.originSource}
          </span>
        )}
        <span className="text-[10px] text-muted-foreground">
          {relativeTime(item.createdAt)}
        </span>
      </div>

      {/* Error */}
      {error && (
        <p className="text-[10px] text-destructive">{error}</p>
      )}

      {/* Add to existing thread — dropdown */}
      {showAddTo && (
        <div className="relative">
          {isLoadingThreads ? (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground py-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading…
            </div>
          ) : (
            <select
              aria-label="Select thread to attach"
              className="w-full text-[10px] rounded border border-input bg-background px-1.5 py-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              defaultValue=""
              onChange={handleAttach}
              disabled={isPending}
              data-testid="add-to-thread-select"
            >
              <option value="" disabled>
                {existingThreads.length === 0 ? "No threads available" : "Pick a thread…"}
              </option>
              {existingThreads.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Triage actions */}
      <div className="flex items-center gap-1">
        {/* Make thread */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => triage("make_thread")}
          disabled={isPending}
          className="h-6 px-2 text-[10px] flex items-center gap-1 flex-1"
          aria-label="Make thread"
        >
          {isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Sparkles className="h-3 w-3" />
          )}
          Make thread
        </Button>

        {/* Add to existing thread */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowAddTo((v) => !v)}
          disabled={isPending}
          className="h-6 px-2 text-[10px] flex items-center gap-0.5"
          aria-label="Add to existing thread"
          data-testid="add-to-thread-button"
        >
          Add to
          <ChevronDown className={cn("h-3 w-3 transition-transform", showAddTo && "rotate-180")} />
        </Button>

        {/* Dismiss */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => triage("dismiss")}
          disabled={isPending}
          className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
          aria-label="Dismiss"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

export type { InboxCardItem, TriageAction, TriagePayload };
