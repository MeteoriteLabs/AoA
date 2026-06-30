import { Settings } from "lucide-react";
import { useState } from "react";
import type { HubAuditRow, HubItemListRow } from "@/api/hub-items";
import type {
  HubDensity,
  HubGroupMode,
  HubItemStatus,
  HubLane,
  HubPreferences,
  UpdateHubPreferencesInput,
} from "@armyofagents/shared";
import { Button } from "@/components/ui/button";
import { HubHome } from "./HubHome";
import { HubList } from "./HubList";
import { HubRail, type HubRailLane } from "./HubRail";
import { HubViewer } from "./HubViewer";

const EMPTY_BULK_IDS = new Set<string>();
const noop = () => {};
const DEFAULT_PREFERENCES: HubPreferences = {
  defaultLanding: "home",
  visibleLanes: ["waiting_on_you", "notifications", "suggestions"],
  groupMode: "auto",
  density: "comfortable",
  showAutopilotEntry: true,
  updatedAt: null,
};

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
  searchText?: string;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  preferences?: HubPreferences;
  onLaneChange: (lane: HubRailLane) => void;
  onSearchTextChange?: (value: string) => void;
  onLoadMore?: () => void;
  onPreferencesChange?: (patch: UpdateHubPreferencesInput) => void;
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
  historyStatus = "open",
  auditRows = [],
  auditLoading = false,
  selectedBulkIds = EMPTY_BULK_IDS,
  bulkMessage = null,
  searchText = "",
  hasMore = false,
  isLoadingMore = false,
  preferences = DEFAULT_PREFERENCES,
  onLaneChange,
  onSearchTextChange = noop,
  onLoadMore = noop,
  onPreferencesChange = noop,
  onHistoryStatusChange = noop,
  onSelectItem,
  onMarkRead,
  onToggleBulkItem = noop,
  onBulkAction = noop,
  onMarkUnread = noop,
  onDismiss = noop,
  onSnooze = noop,
  onLifecycleAction = noop,
  undoAction = null,
}: HubShellProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;
  const showHome = activeLane === null;
  const selectedCount = selectedBulkIds.size;

  return (
    <div className="flex h-[calc(100vh-96px)] min-h-[520px] overflow-hidden border-y border-border bg-bg text-text">
      <HubRail
        activeLane={activeLane}
        counts={counts}
        visibleLanes={preferences.visibleLanes}
        onLaneChange={onLaneChange}
      />
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
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Hub settings"
                  aria-expanded={settingsOpen}
                  onClick={() => setSettingsOpen((open) => !open)}
                >
                  <Settings className="size-4" aria-hidden="true" />
                </Button>
              </div>
            ) : null}
          </div>
          {!showHome && settingsOpen ? (
            <div className="grid gap-3 border-b border-border bg-card px-4 py-3 text-xs">
              <label className="grid gap-1">
                <span className="text-muted-foreground">Default landing</span>
                <select
                  aria-label="Default landing"
                  value={preferences.defaultLanding}
                  onChange={(event) =>
                    onPreferencesChange({ defaultLanding: event.target.value as "home" | HubLane })
                  }
                  className="h-8 rounded border border-border bg-bg px-2"
                >
                  <option value="home">Home</option>
                  <option value="waiting_on_you">Waiting on you</option>
                  <option value="notifications">Notifications</option>
                  <option value="suggestions">Suggestions</option>
                </select>
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(["waiting_on_you", "notifications", "suggestions"] as const).map((lane) => (
                  <label key={lane} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={preferences.visibleLanes.includes(lane)}
                      onChange={(event) => {
                        const next = event.target.checked
                          ? [...preferences.visibleLanes, lane]
                          : preferences.visibleLanes.filter((value) => value !== lane);
                        if (next.length > 0) onPreferencesChange({ visibleLanes: next });
                      }}
                    />
                    <span>{laneTitle(lane)}</span>
                  </label>
                ))}
              </div>
              <label className="grid gap-1">
                <span className="text-muted-foreground">Grouping</span>
                <select
                  aria-label="Grouping"
                  value={preferences.groupMode}
                  onChange={(event) =>
                    onPreferencesChange({ groupMode: event.target.value as HubGroupMode })
                  }
                  className="h-8 rounded border border-border bg-bg px-2"
                >
                  <option value="auto">Auto</option>
                  <option value="source">Source</option>
                  <option value="scope">Scope</option>
                  <option value="type">Type</option>
                  <option value="none">None</option>
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-muted-foreground">Density</span>
                <select
                  aria-label="Density"
                  value={preferences.density}
                  onChange={(event) =>
                    onPreferencesChange({ density: event.target.value as HubDensity })
                  }
                  className="h-8 rounded border border-border bg-bg px-2"
                >
                  <option value="comfortable">Comfortable</option>
                  <option value="compact">Compact</option>
                </select>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  aria-label="Autopilot entry"
                  checked={preferences.showAutopilotEntry}
                  onChange={(event) =>
                    onPreferencesChange({ showAutopilotEntry: event.target.checked })
                  }
                />
                <span>Autopilot entry</span>
              </label>
              <Button type="button" variant="ghost" size="sm" disabled className="justify-start">
                Notification preferences
              </Button>
            </div>
          ) : null}
          {!showHome ? (
            <div className="border-b border-border px-4 py-2">
              <input
                type="search"
                aria-label="Search hub"
                value={searchText}
                onChange={(event) => onSearchTextChange(event.target.value)}
                placeholder="Search"
                className="h-9 w-full rounded-md border border-border bg-bg px-3 text-sm outline-none focus:border-brand"
              />
            </div>
          ) : null}
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
              visibleLanes={preferences.visibleLanes}
              showAutopilotEntry={preferences.showAutopilotEntry}
              onLaneChange={(lane: HubLane) => onLaneChange(lane)}
            />
          ) : (
            <HubList
              items={items}
              isLoading={isLoading}
              error={error}
              selectedItemId={selectedItemId}
              selectedBulkIds={selectedBulkIds}
              hasMore={hasMore}
              isLoadingMore={isLoadingMore}
              groupMode={preferences.groupMode}
              density={preferences.density}
              onSelectItem={onSelectItem}
              onMarkRead={onMarkRead}
              onToggleBulkItem={onToggleBulkItem}
              onLoadMore={onLoadMore}
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
