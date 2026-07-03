import { Menu, Settings, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { useBreakpoint } from "@/lib/useBreakpoint";
import type { HubAuditRow, HubItemListRow } from "@/api/hub-items";
import type {
  HubAutopilotAction,
  HubAutopilotActionRow,
  HubAutopilotMode,
  HubAutopilotPolicy,
  HubDensity,
  HubGroupMode,
  HubItemStatus,
  HubLane,
  HubPreferences,
  NotificationPreferences,
  NotificationPreference,
  UpdateHubPreferencesInput,
  UpdateHubAutopilotPolicyInput,
  UpdateNotificationPreferencesInput,
} from "@armyofagents/shared";
import { DEFAULT_NOTIFICATION_PREFERENCES, isFounderGatedAutopilotType } from "@armyofagents/shared";
import { Button } from "@/components/ui/button";
import { HubHome } from "./HubHome";
import { HubHomeTab } from "./HubHomeTab";
import { HubList } from "./HubList";
import { HubRail, type HubRailLane } from "./HubRail";
import { HubTabBody } from "./HubTabBody";
import { HubTabStrip } from "./HubTabStrip";
import { HOME_TAB, type HubTab } from "./hubViewerModel";

const EMPTY_BULK_IDS = new Set<string>();
const noop = () => {};
/** Persisted icon-only state for the hub lane rail (Discussions-rail pattern). */
const RAIL_COLLAPSED_KEY = "aoa:hub:rail-collapsed";
const DEFAULT_PREFERENCES: HubPreferences = {
  defaultLanding: "home",
  visibleLanes: ["waiting_on_you", "notifications", "suggestions"],
  groupMode: "auto",
  density: "comfortable",
  showAutopilotEntry: true,
  updatedAt: null,
};
const DEFAULT_AUTOPILOT_POLICY: HubAutopilotPolicy = {
  mode: "off",
  handledToday: 0,
  lastHandledAt: null,
  rules: [],
  updatedAt: null,
};
const EMPTY_AUTOPILOT_ACTIONS: { items: HubAutopilotActionRow[] } = { items: [] };

interface HubShellProps {
  activeLane: HubRailLane;
  items: HubItemListRow[];
  counts: { open: number; unread: number };
  isLoading: boolean;
  error: unknown;
  selectedItemId: string | null;
  /** The selected hub item resolved by the parent (loaded list OR deep-link
   *  hydration), used as the Home tab's reading-pane preview. */
  selectedItem: HubItemListRow | null;
  /** Concrete company id for the embedded viewers hosted in tabs (D2-review
   *  seam: an embedded ThreadDetail with an undefined companyId would hang). */
  companyId: string | undefined;
  /** Open hub tabs (Home first, non-closeable) + the active tab key. */
  tabs: HubTab[];
  activeTabKey: string | null;
  /** Open a prebuilt tab (linked-entity hand-offs from inside a hosted viewer). */
  onOpenTab: (tab: HubTab) => void;
  /** Row-click "open": select the item + open its entity as a tab. */
  onOpenItem: (item: HubItemListRow) => void;
  onCloseTab: (key: string) => void;
  onActivateTab: (key: string) => void;
  onAddBrowserTab: () => void;
  /** Resolve a hub item id → full row for the runtime_decision tab body. */
  resolveHubItem: (hubItemId: string) => HubItemListRow | undefined;
  historyStatus: Extract<HubItemStatus, "open" | "resolved" | "archived">;
  auditRows: HubAuditRow[];
  auditLoading: boolean;
  selectedBulkIds: Set<string>;
  bulkMessage: string | null;
  searchText?: string;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  preferences?: HubPreferences;
  notificationPreferences?: NotificationPreferences;
  notificationPreferencesPending?: boolean;
  digestItems?: HubItemListRow[];
  autopilotPolicy?: HubAutopilotPolicy;
  autopilotActions?: { items: HubAutopilotActionRow[] };
  autopilotPending?: boolean;
  onLaneChange: (lane: HubRailLane) => void;
  onSearchTextChange?: (value: string) => void;
  onLoadMore?: () => void;
  onPreferencesChange?: (patch: UpdateHubPreferencesInput) => void;
  onUpdateNotificationPreferences?: (patch: UpdateNotificationPreferencesInput) => void;
  onResetNotificationPreferences?: () => void;
  onAckDigest?: () => void;
  onUpdateAutopilotPolicy?: (patch: UpdateHubAutopilotPolicyInput) => void;
  onResetAutopilotPolicy?: () => void;
  onUndoAutopilotAction?: (action: HubAutopilotActionRow) => void;
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
  selectedItem,
  companyId,
  tabs,
  activeTabKey,
  onOpenTab,
  onOpenItem,
  onCloseTab,
  onActivateTab,
  onAddBrowserTab,
  resolveHubItem,
  historyStatus = "open",
  auditRows = [],
  auditLoading = false,
  selectedBulkIds = EMPTY_BULK_IDS,
  bulkMessage = null,
  searchText = "",
  hasMore = false,
  isLoadingMore = false,
  preferences = DEFAULT_PREFERENCES,
  notificationPreferences = DEFAULT_NOTIFICATION_PREFERENCES,
  notificationPreferencesPending = false,
  digestItems = [],
  autopilotPolicy = DEFAULT_AUTOPILOT_POLICY,
  autopilotActions = EMPTY_AUTOPILOT_ACTIONS,
  autopilotPending = false,
  onLaneChange,
  onSearchTextChange = noop,
  onLoadMore = noop,
  onPreferencesChange = noop,
  onUpdateNotificationPreferences = noop,
  onResetNotificationPreferences = noop,
  onAckDigest = noop,
  onUpdateAutopilotPolicy = noop,
  onResetAutopilotPolicy = noop,
  onUndoAutopilotAction = noop,
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
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(() => {
    try {
      return localStorage.getItem(RAIL_COLLAPSED_KEY) === "true";
    } catch {
      return false;
    }
  });
  const toggleRailCollapsed = () => {
    setRailCollapsed((value) => {
      const next = !value;
      try {
        localStorage.setItem(RAIL_COLLAPSED_KEY, String(next));
      } catch {
        // Persistence is best-effort.
      }
      return next;
    });
  };
  // Gate the resizable Group on the SAME 1024px boundary the rest of this
  // component uses via `lg:` (HubRail `hidden lg:block`, rail dialog `lg:hidden`).
  // `isMobile` is <640px only, which would mount the horizontal split in the
  // 640-1023px tablet band while the inline rail is still hidden.
  const { isDesktopUp } = useBreakpoint();
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "aoa:hub:panel-sizes",
    storage: localStorage,
    panelIds: ["hub-list", "hub-viewer"],
  });
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const keyboardSelectedItemId = useRef<string | null>(selectedItemId);
  const showHome = activeLane === null;
  const selectedCount = selectedBulkIds.size;

  useEffect(() => {
    keyboardSelectedItemId.current = selectedItemId;
  }, [selectedItemId]);

  useEffect(() => {
    keyboardSelectedItemId.current = null;
  }, [activeLane, historyStatus]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;

      if (event.key === "/" && !showHome) {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (event.key === "Escape") {
        if (mobileRailOpen) {
          setMobileRailOpen(false);
          return;
        }
        if (selectedItemId) {
          focusHubRow(selectedItemId);
          onSelectItem(null);
        }
        return;
      }

      if ((event.key === "j" || event.key === "k") && activeLane && items.length > 0) {
        event.preventDefault();
        const visibleRowIds = getVisibleHubRowIds();
        const navigationItems =
          visibleRowIds.length > 0
            ? visibleRowIds
                .map((id) => items.find((item) => item.id === id))
                .filter((item): item is HubItemListRow => Boolean(item))
            : items;
        const currentId = keyboardSelectedItemId.current ?? selectedItemId;
        const currentIndex = currentId
          ? navigationItems.findIndex((item) => item.id === currentId)
          : -1;
        const nextIndex =
          event.key === "j"
            ? Math.min(currentIndex + 1, navigationItems.length - 1)
            : Math.max(currentIndex - 1, 0);
        const nextItem = navigationItems[nextIndex] ?? navigationItems[0];
        keyboardSelectedItemId.current = nextItem.id;
        onSelectItem(nextItem.id);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeLane, items, mobileRailOpen, onSelectItem, selectedItemId, showHome]);

  const handleViewerClose = () => {
    if (selectedItemId) focusHubRow(selectedItemId);
    onSelectItem(null);
  };

  const handleLaneChange = (lane: HubRailLane) => {
    setMobileRailOpen(false);
    onLaneChange(lane);
  };

  const updateNotificationRule = (
    semanticType: NotificationPreferences["rules"][number]["semanticType"],
    patch: Partial<Pick<NotificationPreferences["rules"][number], "deliveryMode" | "toastEnabled">>,
  ) => {
    onUpdateNotificationPreferences({
      rules: notificationPreferences.rules.map((rule) =>
        rule.semanticType === semanticType ? { ...rule, ...patch } : rule,
      ),
    });
  };

  const updateQuietHours = (patch: Partial<NotificationPreferences["quietHours"]>) => {
    onUpdateNotificationPreferences({
      quietHours: { ...notificationPreferences.quietHours, ...patch },
    });
  };

  const updateDigest = (patch: Partial<NotificationPreferences["digest"]>) => {
    onUpdateNotificationPreferences({
      digest: { ...notificationPreferences.digest, ...patch },
    });
  };

  const updateAutopilotRule = (
    semanticType: HubAutopilotPolicy["rules"][number]["semanticType"],
    patch: Partial<
      Pick<HubAutopilotPolicy["rules"][number], "enabled" | "action" | "minTrustScore">
    >,
  ) => {
    onUpdateAutopilotPolicy({
      rules: autopilotPolicy.rules.map((rule) =>
        rule.semanticType === semanticType ? { ...rule, ...patch } : rule,
      ),
    });
  };

  const listSection = (
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* 42px header — matches the rail header and the viewer tab strip. */}
          <div className="flex h-[42px] shrink-0 items-center justify-between gap-3 border-b border-border px-4">
            <div className="flex min-w-0 items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Open hub lanes"
                onClick={() => setMobileRailOpen(true)}
                className="lg:hidden"
              >
                <Menu className="size-4" aria-hidden="true" />
              </Button>
              <h1 className="truncate text-sm font-semibold">
                {showHome ? "Hub Home" : laneTitle(activeLane)}
              </h1>
            </div>
            <div className="flex shrink-0 gap-1">
              {!showHome
                ? (["open", "resolved", "archived"] as const).map((status) => (
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
                ))
                : null}
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
          </div>
          {settingsOpen ? (
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
              <div className="grid gap-3 border-t border-border pt-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold">Autopilot</h2>
                  {autopilotPending ? (
                    <span className="text-[11px] text-muted-foreground">Saving</span>
                  ) : null}
                </div>
                <label className="grid gap-1">
                  <span className="text-muted-foreground">Mode</span>
                  <select
                    aria-label="Autopilot mode"
                    value={autopilotPolicy.mode}
                    disabled={autopilotPending}
                    onChange={(event) =>
                      onUpdateAutopilotPolicy({
                        mode: event.target.value as HubAutopilotMode,
                      })
                    }
                    className="h-8 rounded border border-border bg-bg px-2"
                  >
                    <option value="off">Off</option>
                    <option value="assist">Assist</option>
                    <option value="drive">Drive</option>
                  </select>
                </label>
                <div className="grid gap-2">
                  {autopilotPolicy.rules.map((rule) => {
                    const label = semanticTypeLabel(rule.semanticType);
                    const founderGated = isFounderGatedAutopilotType(rule.semanticType);
                    return (
                      <div key={rule.semanticType} className="grid gap-2 border-t border-border pt-2 first:border-t-0 first:pt-0">
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-medium">{label}</div>
                          {founderGated ? (
                            <span className="text-[11px] uppercase text-muted-foreground">
                              Founder-gated
                            </span>
                          ) : null}
                        </div>
                        {founderGated ? (
                          <div className="text-muted-foreground">
                            Escalation only.
                          </div>
                        ) : (
                          <div className="grid gap-2 sm:grid-cols-3">
                            <label className="flex items-center gap-2 self-end">
                              <input
                                type="checkbox"
                                aria-label={`${label} autopilot enabled`}
                                checked={rule.enabled}
                                disabled={autopilotPending}
                                onChange={(event) =>
                                  updateAutopilotRule(rule.semanticType, {
                                    enabled: event.target.checked,
                                  })
                                }
                              />
                              <span>Enabled</span>
                            </label>
                            <label className="grid gap-1">
                              <span className="text-muted-foreground">Action</span>
                              <select
                                aria-label={`${label} autopilot action`}
                                value={rule.action}
                                disabled={autopilotPending}
                                onChange={(event) =>
                                  updateAutopilotRule(rule.semanticType, {
                                    action: event.target.value as HubAutopilotAction,
                                  })
                                }
                                className="h-8 rounded border border-border bg-bg px-2"
                              >
                                <option value="none">None</option>
                                <option value="resolve">Resolve</option>
                                <option value="archive">Archive</option>
                              </select>
                            </label>
                            <label className="grid gap-1">
                              <span className="text-muted-foreground">Min trust</span>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                aria-label={`${label} min trust`}
                                value={rule.minTrustScore}
                                disabled={autopilotPending}
                                onChange={(event) =>
                                  updateAutopilotRule(rule.semanticType, {
                                    minTrustScore: Number(event.target.value),
                                  })
                                }
                                className="h-8 rounded border border-border bg-bg px-2"
                              />
                            </label>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="justify-start"
                  disabled={autopilotPending}
                  onClick={onResetAutopilotPolicy}
                >
                  Reset Autopilot
                </Button>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="justify-start"
                aria-expanded={notificationPanelOpen}
                onClick={() => setNotificationPanelOpen((open) => !open)}
              >
                Notification preferences
              </Button>
              {notificationPanelOpen ? (
                <div className="grid gap-3 rounded border border-border bg-bg p-3">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-sm font-semibold">Notification preferences</h2>
                    {notificationPreferencesPending ? (
                      <span className="text-[11px] text-muted-foreground">Saving</span>
                    ) : null}
                  </div>
                  <div className="grid gap-2">
                    {notificationPreferences.rules.map((rule) => {
                      const label = semanticTypeLabel(rule.semanticType);
                      return (
                        <div key={rule.semanticType} className="grid gap-2 border-t border-border pt-2 first:border-t-0 first:pt-0">
                          <div className="font-medium">{label}</div>
                          <div className="grid gap-2 sm:grid-cols-2">
                            <label className="grid gap-1">
                              <span className="text-muted-foreground">Delivery</span>
                              <select
                                aria-label={`${label} delivery`}
                                value={rule.deliveryMode}
                                disabled={notificationPreferencesPending}
                                onChange={(event) =>
                                  updateNotificationRule(rule.semanticType, {
                                    deliveryMode: event.target.value as NotificationPreference,
                                  })
                                }
                                className="h-8 rounded border border-border bg-bg px-2"
                              >
                                <option value="realtime">Realtime</option>
                                <option value="digest">Digest</option>
                                <option value="silent">Silent</option>
                              </select>
                            </label>
                            <label className="flex items-center gap-2 self-end">
                              <input
                                type="checkbox"
                                aria-label={`${label} toast`}
                                checked={rule.toastEnabled}
                                disabled={notificationPreferencesPending || rule.deliveryMode !== "realtime"}
                                onChange={(event) =>
                                  updateNotificationRule(rule.semanticType, {
                                    toastEnabled: event.target.checked,
                                  })
                                }
                              />
                              <span>Toast</span>
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="grid gap-2 border-t border-border pt-3">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        aria-label="Quiet hours"
                        checked={notificationPreferences.quietHours.enabled}
                        disabled={notificationPreferencesPending}
                        onChange={(event) => updateQuietHours({ enabled: event.target.checked })}
                      />
                      <span>Quiet hours</span>
                    </label>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <label className="grid gap-1">
                        <span className="text-muted-foreground">Start</span>
                        <input
                          aria-label="Quiet hours start"
                          value={notificationPreferences.quietHours.start}
                          disabled={notificationPreferencesPending}
                          onChange={(event) => updateQuietHours({ start: event.target.value })}
                          className="h-8 rounded border border-border bg-bg px-2"
                        />
                      </label>
                      <label className="grid gap-1">
                        <span className="text-muted-foreground">End</span>
                        <input
                          aria-label="Quiet hours end"
                          value={notificationPreferences.quietHours.end}
                          disabled={notificationPreferencesPending}
                          onChange={(event) => updateQuietHours({ end: event.target.value })}
                          className="h-8 rounded border border-border bg-bg px-2"
                        />
                      </label>
                      <label className="grid gap-1">
                        <span className="text-muted-foreground">Timezone</span>
                        <input
                          aria-label="Quiet hours timezone"
                          value={notificationPreferences.quietHours.timezone}
                          disabled={notificationPreferencesPending}
                          onChange={(event) => updateQuietHours({ timezone: event.target.value })}
                          className="h-8 rounded border border-border bg-bg px-2"
                        />
                      </label>
                    </div>
                  </div>
                  <div className="grid gap-2 border-t border-border pt-3">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        aria-label="Digest enabled"
                        checked={notificationPreferences.digest.enabled}
                        disabled={notificationPreferencesPending}
                        onChange={(event) => updateDigest({ enabled: event.target.checked })}
                      />
                      <span>Digest enabled</span>
                    </label>
                    <div className="grid gap-1">
                      <div className="text-muted-foreground">Pending digest</div>
                      {digestItems.length > 0 ? (
                        <ul className="grid gap-1">
                          {digestItems.slice(0, 5).map((item) => (
                            <li key={item.id} className="truncate rounded border border-border px-2 py-1">
                              {item.title}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="text-muted-foreground">No pending digest items</div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={notificationPreferencesPending || digestItems.length === 0}
                        onClick={onAckDigest}
                      >
                        Acknowledge digest
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={notificationPreferencesPending}
                        onClick={onResetNotificationPreferences}
                      >
                        Reset notification preferences
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          {!showHome ? (
            <div className="border-b border-border px-4 py-2">
              <input
                type="search"
                aria-label="Search hub"
                ref={searchInputRef}
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
              autopilotPolicy={autopilotPolicy}
              autopilotActions={autopilotActions.items}
              onLaneChange={(lane: HubLane) => onLaneChange(lane)}
              onUndoAutopilotAction={onUndoAutopilotAction}
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
  );

  const activeTab = tabs.find((tab) => tab.key === activeTabKey) ?? tabs[0] ?? HOME_TAB;
  const viewer = (
        <div
          className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg"
          data-testid="hub-tabbed-viewer"
        >
          <HubTabStrip
            tabs={tabs}
            activeKey={activeTabKey}
            onActivate={onActivateTab}
            onClose={onCloseTab}
            onAddBrowser={onAddBrowserTab}
          />
          <div className="min-h-0 min-w-0 flex-1">
            <HubTabBody
              tab={activeTab}
              companyId={companyId}
              onOpenTab={onOpenTab}
              resolveHubItem={resolveHubItem}
              homeContent={
                <HubHomeTab
                  selectedItem={selectedItem}
                  auditRows={auditRows}
                  auditLoading={auditLoading}
                  onOpenFull={onOpenItem}
                  onClose={handleViewerClose}
                  onMarkUnread={onMarkUnread}
                  onDismiss={onDismiss}
                  onSnooze={onSnooze}
                  onLifecycleAction={onLifecycleAction}
                />
              }
            />
          </div>
        </div>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-muted/30 text-text lg:flex-row lg:gap-2 lg:p-2">
      <div className="hidden lg:block">
        <HubRail
          activeLane={activeLane}
          counts={counts}
          visibleLanes={preferences.visibleLanes}
          onLaneChange={handleLaneChange}
          collapsed={railCollapsed}
          onToggleCollapsed={toggleRailCollapsed}
        />
      </div>
      {mobileRailOpen ? (
        <div
          role="dialog"
          aria-label="Hub lanes"
          className="border-b border-border bg-bg lg:hidden"
        >
          <div className="flex h-11 items-center justify-between border-b border-border px-3">
            <span className="text-sm font-semibold">Hub lanes</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Close hub lanes"
              onClick={() => setMobileRailOpen(false)}
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
          <HubRail
            activeLane={activeLane}
            counts={counts}
            visibleLanes={preferences.visibleLanes}
            onLaneChange={handleLaneChange}
          />
        </div>
      ) : null}
      {!isDesktopUp ? (
        <main className="flex min-w-0 flex-1 flex-col">
          {listSection}
          {viewer}
        </main>
      ) : (
        <Group
          orientation="horizontal"
          className="flex min-w-0 flex-1"
          defaultLayout={defaultLayout}
          onLayoutChanged={onLayoutChanged}
          data-testid="hub-panel-group"
        >
          <Panel
            id="hub-list"
            defaultSize="38%"
            minSize="24%"
            className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm"
            data-testid="hub-list-panel"
          >
            {listSection}
          </Panel>
          {/* Transparent resize gutter — the tray shows through, so the list and
              viewer read as separate floating islands (Discussions pattern). */}
          <Separator
            className="w-2 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-border/70"
            data-testid="hub-panel-separator"
          />
          <Panel
            id="hub-viewer"
            minSize="30%"
            className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm"
            data-testid="hub-viewer-panel"
          >
            {viewer}
          </Panel>
        </Group>
      )}
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

function semanticTypeLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tagName = target.tagName.toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select") return true;
  const role = target.getAttribute("role");
  return role === "textbox" || role === "combobox";
}

function focusHubRow(itemId: string) {
  const row = Array.from(document.querySelectorAll<HTMLElement>("[data-hub-row-id]")).find(
    (element) => element.getAttribute("data-hub-row-id") === itemId,
  );
  row?.focus();
}

function getVisibleHubRowIds() {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-hub-row-id]"))
    .filter((element) => element.offsetParent !== null)
    .map((element) => element.getAttribute("data-hub-row-id"))
    .filter((id): id is string => Boolean(id));
}
