import { useState } from "react";
import { useCompany } from "../../context/CompanyContext";
import { api } from "../../api/client";
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
