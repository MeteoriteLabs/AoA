import type { HubItemListRow } from "@/api/hub-items";
import type { HubLane } from "@armyofagents/shared";
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
  onLaneChange: (lane: HubRailLane) => void;
  onSelectItem: (itemId: string | null) => void;
  onMarkRead: (itemId: string) => void;
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
  onLaneChange,
  onSelectItem,
  onMarkRead,
  onMarkUnread,
  onDismiss,
  onSnooze,
  onLifecycleAction,
  undoAction,
}: HubShellProps) {
  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;
  const showHome = activeLane === null;

  return (
    <div className="flex h-[calc(100vh-96px)] min-h-[520px] overflow-hidden border-y border-border bg-bg text-text">
      <HubRail activeLane={activeLane} counts={counts} onLaneChange={onLaneChange} />
      <main className="flex min-w-0 flex-1">
        <section className="flex min-w-[320px] max-w-[480px] flex-[0_0_38%] flex-col border-r border-border">
          <div className="flex h-12 items-center border-b border-border px-4">
            <h1 className="truncate text-sm font-semibold">
              {showHome ? "Hub Home" : laneTitle(activeLane)}
            </h1>
          </div>
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
              onSelectItem={onSelectItem}
              onMarkRead={onMarkRead}
            />
          )}
        </section>
        <HubViewer
          item={selectedItem}
          undoAction={undoAction}
          onClose={() => onSelectItem(null)}
          onMarkUnread={onMarkUnread}
          onDismiss={onDismiss}
          onSnooze={onSnooze}
          onLifecycleAction={onLifecycleAction}
        />
      </main>
    </div>
  );
}

function laneTitle(lane: HubLane | null) {
  if (lane === "waiting_on_you") return "Waiting on you";
  if (lane === "notifications") return "Notifications";
  if (lane === "suggestions") return "Suggestions";
  return "Home";
}
