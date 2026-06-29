import type { HubAuditRow, HubItemListRow } from "@/api/hub-items";
import type { HubItemStatus, HubLane } from "@armyofagents/shared";
import { Button } from "@/components/ui/button";
import { HubHome } from "./HubHome";
import { HubList } from "./HubList";
import { HubRail, type HubRailLane } from "./HubRail";
import { HubViewer } from "./HubViewer";

interface HubShellProps {
  activeLane: HubRailLane;
  items: HubItemListRow[];
  counts: { open: number; unread: number };
  isLoading: boolean;
  error: unknown;
  selectedItemId: string | null;
  historyStatus: Extract<HubItemStatus, "open" | "resolved" | "archived">;
  auditRows: HubAuditRow[];
  auditLoading: boolean;
  selectedBulkIds: Set<string>;
  bulkMessage: string | null;
  onLaneChange: (lane: HubRailLane) => void;
  onHistoryStatusChange: (status: Extract<HubItemStatus, "open" | "resolved" | "archived">) => void;
  onSelectItem: (itemId: string | null) => void;
  onMarkRead: (itemId: string) => void;
  onToggleBulkItem: (itemId: string) => void;
  onBulkAction: (action: "archive" | "dismiss" | "snooze") => void;
  onMarkUnread: (itemId: string) => void;
  onDismiss: (itemId: string) => void;
  onSnooze: (itemId: string) => void;
  onLifecycleAction: (item: HubItemListRow, action: "resolve" | "archive" | "claim" | "release") => void;
  undoAction: { label: string; onUndo: () => void } | null;
}

export function HubShell({
  activeLane,
  items,
  counts,
  isLoading,
  error,
  selectedItemId,
  historyStatus,
  auditRows,
  auditLoading,
  selectedBulkIds,
  bulkMessage,
  onLaneChange,
  onHistoryStatusChange,
  onSelectItem,
  onMarkRead,
  onToggleBulkItem,
  onBulkAction,
  onMarkUnread,
  onDismiss,
  onSnooze,
  onLifecycleAction,
  undoAction,
}: HubShellProps) {
  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;
  const showHome = activeLane === null;
  const selectedCount = selectedBulkIds.size;

  return (
    <div className="flex h-[calc(100vh-96px)] min-h-[520px] overflow-hidden border-y border-border bg-bg text-text">
      <HubRail activeLane={activeLane} counts={counts} onLaneChange={onLaneChange} />
      <main className="flex min-w-0 flex-1">
        <section className="flex min-w-[320px] max-w-[480px] flex-[0_0_38%] flex-col border-r border-border">
          <div className="flex h-12 items-center justify-between gap-3 border-b border-border px-4">
            <h1 className="truncate text-sm font-semibold">
              {showHome ? "Hub Home" : laneTitle(activeLane)}
            </h1>
            {!showHome ? (
              <div className="flex shrink-0 gap-1">
                {(["open", "resolved", "archived"] as const).map((status) => (
                  <Button
                    key={status}
                    type="button"
                    variant={historyStatus === status ? "secondary" : "ghost"}
                    size="sm"
                    aria-pressed={historyStatus === status}
                    onClick={() => onHistoryStatusChange(status)}
                  >
                    {statusLabel(status)}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
          {!showHome && selectedCount > 0 ? (
            <div className="flex h-11 items-center justify-between gap-3 border-b border-border bg-card px-4 text-xs">
              <span className="text-muted-foreground">{selectedCount} selected</span>
              <div className="flex gap-1">
                <Button type="button" variant="secondary" size="sm" onClick={() => onBulkAction("archive")}>
                  Archive selected
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => onBulkAction("dismiss")}>
                  Dismiss selected
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => onBulkAction("snooze")}>
                  Snooze selected
                </Button>
              </div>
            </div>
          ) : null}
          {!showHome && undoAction ? (
            <div className="flex h-11 items-center justify-between gap-3 border-b border-border bg-card px-4 text-xs">
              <span className="truncate text-muted-foreground">{undoAction.label}</span>
              <Button type="button" variant="ghost" size="sm" onClick={undoAction.onUndo}>
                Undo {undoAction.label}
              </Button>
            </div>
          ) : null}
          {!showHome && bulkMessage ? (
            <div role="status" className="border-b border-border bg-card px-4 py-2 text-xs text-muted-foreground">
              {bulkMessage}
            </div>
          ) : null}
          {showHome ? (
            <HubHome
              counts={counts}
              items={items}
              onLaneChange={(lane: HubLane) => onLaneChange(lane)}
            />
          ) : (
            <HubList
              items={items}
              isLoading={isLoading}
              error={error}
              selectedItemId={selectedItemId}
              selectedBulkIds={selectedBulkIds}
              onSelectItem={onSelectItem}
              onMarkRead={onMarkRead}
              onToggleBulkItem={onToggleBulkItem}
            />
          )}
        </section>
        <HubViewer
          item={selectedItem}
          undoAction={null}
          onClose={() => onSelectItem(null)}
          onMarkUnread={onMarkUnread}
          onDismiss={onDismiss}
          onSnooze={onSnooze}
          onLifecycleAction={onLifecycleAction}
          auditRows={auditRows}
          auditLoading={auditLoading}
        />
      </main>
    </div>
  );
}

function statusLabel(status: Extract<HubItemStatus, "open" | "resolved" | "archived">) {
  if (status === "resolved") return "Resolved";
  if (status === "archived") return "Archived";
  return "Open";
}

function laneTitle(lane: HubLane | null) {
  if (lane === "waiting_on_you") return "Waiting on you";
  if (lane === "notifications") return "Notifications";
  if (lane === "suggestions") return "Suggestions";
  return "Home";
}
