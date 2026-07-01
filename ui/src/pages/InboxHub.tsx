import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  HubItemStatus,
  HubLane,
  HubPreferences,
  NotificationPreferences,
  UpdateNotificationPreferencesInput,
  UpdateHubPreferencesInput,
} from "@armyofagents/shared";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "@armyofagents/shared";
import { hubItemsApi, type HubItemListRow, type HubListResponse } from "@/api/hub-items";
import { HubShell } from "@/components/hub/HubShell";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useCompany } from "@/context/CompanyContext";
import { useLiveUpdates } from "@/context/LiveUpdatesProvider";
import { useToast } from "@/context/ToastContext";
import { useHubItemMutations } from "@/hooks/useHubItemMutations";
import { buildHubToastInput, shouldToastHubItem } from "@/lib/hub-toast-bridge";
import { queryKeys } from "@/lib/queryKeys";
import { Navigate, useLocation, useNavigate, useParams } from "@/lib/router";

export const LANE_TO_SLUG: Record<HubLane, string> = {
  waiting_on_you: "waiting",
  notifications: "notifications",
  suggestions: "suggestions",
};

export const SLUG_TO_LANE: Record<string, HubLane> = {
  waiting: "waiting_on_you",
  notifications: "notifications",
  suggestions: "suggestions",
};

type RouteHistoryStatus = Extract<HubItemStatus, "open" | "resolved" | "archived">;

function getRouteHistoryStatus(search: string): RouteHistoryStatus {
  const status = new URLSearchParams(search).get("status");
  return status === "resolved" || status === "archived" ? status : "open";
}

function appendStatus(search: string, status: RouteHistoryStatus) {
  const params = new URLSearchParams(search);
  params.set("status", status);
  const nextSearch = params.toString();
  return nextSearch ? `?${nextSearch}` : "";
}

const DEFAULT_HUB_PREFERENCES: HubPreferences = {
  defaultLanding: "home",
  visibleLanes: ["waiting_on_you", "notifications", "suggestions"],
  groupMode: "auto",
  density: "comfortable",
  showAutopilotEntry: true,
  updatedAt: null,
};

export function InboxHub() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams<{
    companyPrefix?: string;
    lane?: string;
    itemId?: string;
  }>();
  const queryClient = useQueryClient();
  const { onHubItemChanged } = useLiveUpdates();
  const { pushToast } = useToast();
  const markingReadItemIds = useRef(new Set<string>());
  const notificationPreferencesRef = useRef<NotificationPreferences | null>(null);
  const hubMutations = useHubItemMutations(selectedCompanyId);
  const [undoAction, setUndoAction] = useState<{
    label: string;
    itemId: string;
    auditId?: string;
    expectedVersion?: number;
    restore?: { kind: "unsnooze" | "undismiss" };
  } | null>(null);
  const routeHistoryStatus = getRouteHistoryStatus(location.search);
  const [historyStatus, setHistoryStatus] =
    useState<RouteHistoryStatus>(routeHistoryStatus);
  const [selectedBulkIds, setSelectedBulkIds] = useState<Set<string>>(() => new Set());
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [debouncedSearchText, setDebouncedSearchText] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [accumulatedItems, setAccumulatedItems] = useState<HubItemListRow[]>([]);
  const [optimisticPreferences, setOptimisticPreferences] = useState<HubPreferences | null>(null);

  const laneSlug = params.lane ?? null;
  const activeLane = laneSlug ? SLUG_TO_LANE[laneSlug] ?? null : null;
  const unknownLane = laneSlug != null && activeLane == null;
  const inboxHubIndex = location.pathname.indexOf("/inbox-hub");
  const legacyInboxHubTarget =
    inboxHubIndex >= 0
      ? `/inbox${location.pathname.slice(inboxHubIndex + "/inbox-hub".length)}${location.search}`
      : null;
  const isLegacyInboxNew = /\/inbox\/new$/.test(location.pathname);
  const isLegacyInboxAll = /\/inbox\/all$/.test(location.pathname);

  useEffect(() => {
    setBreadcrumbs([{ label: "Inbox Hub" }]);
  }, [setBreadcrumbs]);

  useEffect(() => {
    setHistoryStatus(routeHistoryStatus);
  }, [routeHistoryStatus]);

  const countsQuery = useQuery({
    queryKey: selectedCompanyId
      ? queryKeys.hubItems.counts(selectedCompanyId)
      : ["hub-items", "counts", "none"],
    queryFn: () => hubItemsApi.counts(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const preferencesQuery = useQuery({
    queryKey: selectedCompanyId
      ? queryKeys.hubItems.preferences(selectedCompanyId)
      : ["hub-items", "preferences", "none"],
    queryFn: () => hubItemsApi.getPreferences(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const serverPreferences = preferencesQuery.data ?? DEFAULT_HUB_PREFERENCES;
  const preferences = optimisticPreferences ?? serverPreferences;

  const notificationPreferencesQuery = useQuery({
    queryKey: selectedCompanyId
      ? queryKeys.notifications.preferences(selectedCompanyId)
      : ["notifications", "preferences", "none"],
    queryFn: () => hubItemsApi.notificationPreferences.get(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const notificationPreferences =
    notificationPreferencesQuery.data ?? DEFAULT_NOTIFICATION_PREFERENCES;

  const notificationDigestQuery = useQuery({
    queryKey: selectedCompanyId
      ? queryKeys.notifications.digest(selectedCompanyId)
      : ["notifications", "digest", "none"],
    queryFn: () => hubItemsApi.notificationDigest.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  useEffect(() => {
    notificationPreferencesRef.current = notificationPreferencesQuery.data ?? null;
  }, [notificationPreferencesQuery.data, selectedCompanyId]);

  useEffect(() => {
    if (!selectedCompanyId) return;
    return onHubItemChanged(async (itemId) => {
      const loadedNotificationPreferences = notificationPreferencesRef.current;
      if (!loadedNotificationPreferences) return;

      try {
        const item = await hubItemsApi.getOne(selectedCompanyId, itemId);
        const decision = shouldToastHubItem({
          item,
          preferences: loadedNotificationPreferences,
          now: new Date(),
        });
        if (decision.show) {
          pushToast(buildHubToastInput(selectedCompanyId, item));
        }
      } catch {
        // The RBAC hydration route may 404 for stale/hidden items; ignore the poke.
      }
    });
  }, [onHubItemChanged, pushToast, selectedCompanyId]);

  const updatePreferences = useMutation({
    mutationFn: (patch: UpdateHubPreferencesInput) =>
      hubItemsApi.updatePreferences(selectedCompanyId!, patch),
    onMutate: async (patch) => {
      if (!selectedCompanyId) return { previous: undefined };
      const queryKey = queryKeys.hubItems.preferences(selectedCompanyId);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<HubPreferences>(queryKey);
      queryClient.setQueryData<HubPreferences>(queryKey, {
        ...(previous ?? DEFAULT_HUB_PREFERENCES),
        ...patch,
      });
      return { previous };
    },
    onError: (_error, _patch, context) => {
      setOptimisticPreferences(null);
      if (!selectedCompanyId || !context?.previous) return;
      queryClient.setQueryData(
        queryKeys.hubItems.preferences(selectedCompanyId),
        context.previous,
      );
    },
    onSuccess: (updated) => {
      setOptimisticPreferences(updated);
      if (!selectedCompanyId) return;
      queryClient.setQueryData(queryKeys.hubItems.preferences(selectedCompanyId), updated);
    },
    onSettled: async () => {
      if (!selectedCompanyId) return;
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.hubItems.preferences(selectedCompanyId),
        }),
        queryClient.invalidateQueries({ queryKey: ["hub-items", selectedCompanyId] }),
      ]);
      setOptimisticPreferences(null);
    },
  });

  const updateNotificationPreferences = useMutation({
    mutationFn: (patch: UpdateNotificationPreferencesInput) =>
      hubItemsApi.notificationPreferences.update(selectedCompanyId!, patch),
    onMutate: async (patch) => {
      if (!selectedCompanyId) return { previous: undefined };
      const queryKey = queryKeys.notifications.preferences(selectedCompanyId);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<NotificationPreferences>(queryKey);
      queryClient.setQueryData<NotificationPreferences>(queryKey, {
        ...(previous ?? DEFAULT_NOTIFICATION_PREFERENCES),
        ...patch,
      });
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (!selectedCompanyId || !context?.previous) return;
      queryClient.setQueryData(
        queryKeys.notifications.preferences(selectedCompanyId),
        context.previous,
      );
    },
    onSuccess: (updated) => {
      if (!selectedCompanyId) return;
      queryClient.setQueryData(
        queryKeys.notifications.preferences(selectedCompanyId),
        updated,
      );
    },
    onSettled: async () => {
      if (!selectedCompanyId) return;
      await queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.preferences(selectedCompanyId),
      });
    },
  });

  const resetNotificationPreferences = useMutation({
    mutationFn: () => hubItemsApi.notificationPreferences.reset(selectedCompanyId!),
    onSuccess: (updated) => {
      if (!selectedCompanyId) return;
      queryClient.setQueryData(
        queryKeys.notifications.preferences(selectedCompanyId),
        updated,
      );
    },
    onSettled: async () => {
      if (!selectedCompanyId) return;
      await queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.preferences(selectedCompanyId),
      });
    },
  });

  const ackNotificationDigest = useMutation({
    mutationFn: () => hubItemsApi.notificationDigest.ack(selectedCompanyId!),
    onSettled: async () => {
      if (!selectedCompanyId) return;
      await queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.digest(selectedCompanyId),
      });
    },
  });

  useEffect(() => {
    if (!activeLane) {
      if (preferences.defaultLanding !== "home") {
        navigate(`/inbox/${LANE_TO_SLUG[preferences.defaultLanding]}`);
      }
      return;
    }
    if (!preferences.visibleLanes.includes(activeLane)) {
      navigate("/inbox");
    }
  }, [activeLane, navigate, preferences.defaultLanding, preferences.visibleLanes]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchText(searchText.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  const listOptions = useMemo(
    () =>
      activeLane
        ? {
            lane: activeLane,
            status: historyStatus,
            q: debouncedSearchText || undefined,
            groupMode: preferences.groupMode,
            cursor: cursor ?? undefined,
            limit: 50,
          }
        : undefined,
    [activeLane, cursor, debouncedSearchText, historyStatus, preferences.groupMode],
  );

  useEffect(() => {
    setCursor(null);
    setAccumulatedItems([]);
    setSelectedBulkIds(new Set());
  }, [activeLane, debouncedSearchText, historyStatus]);

  const listQuery = useQuery({
    queryKey:
      selectedCompanyId && listOptions
        ? queryKeys.hubItems.list(selectedCompanyId, listOptions)
        : ["hub-items", selectedCompanyId ?? "none", "home"],
    queryFn: () => hubItemsApi.list(selectedCompanyId!, listOptions),
    enabled: !!selectedCompanyId && !!listOptions,
  });

  useEffect(() => {
    if (!activeLane || !listQuery.data) return;
    const nextItems = listQuery.data.items;
    setAccumulatedItems((current) => {
      if (!cursor) return nextItems;
      const seen = new Set(current.map((item) => item.id));
      return [...current, ...nextItems.filter((item) => !seen.has(item.id))];
    });
  }, [activeLane, cursor, listQuery.data]);

  const markRead = useMutation({
    mutationFn: (itemId: string) => hubItemsApi.markRead(selectedCompanyId!, itemId),
    onMutate: (itemId) => {
      if (!selectedCompanyId) return;
      const readAt = new Date().toISOString();
      queryClient.setQueriesData<HubListResponse | HubItemListRow[]>(
        { queryKey: ["hub-items", selectedCompanyId] },
        (old) =>
          Array.isArray(old)
            ? old.map((item) => (item.id === itemId ? { ...item, readAt } : item))
            : old && Array.isArray(old.items)
              ? {
                  ...old,
                  items: old.items.map((item) =>
                    item.id === itemId ? { ...item, readAt } : item,
                  ),
                }
            : old,
      );
    },
    onError: (_error, itemId) => {
      markingReadItemIds.current.delete(itemId);
    },
    onSettled: async () => {
      if (!selectedCompanyId) return;
      await queryClient.invalidateQueries({
        queryKey: queryKeys.hubItems.counts(selectedCompanyId),
      });
    },
  });

  const items = activeLane ? accumulatedItems : [];
  const selectedItemId =
    params.itemId && items.some((item) => item.id === params.itemId)
      ? params.itemId
      : null;
  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;
  const auditQuery = useQuery({
    queryKey:
      selectedCompanyId && selectedItem
        ? queryKeys.hubItems.audit(selectedCompanyId, selectedItem.id)
        : ["hub-items", selectedCompanyId ?? "none", "audit", "none"],
    queryFn: () => hubItemsApi.audit(selectedCompanyId!, selectedItem!.id),
    enabled:
      !!selectedCompanyId &&
      !!selectedItem &&
      (selectedItem.status === "resolved" || selectedItem.status === "archived"),
  });

  const handleLaneChange = (lane: HubLane | null) => {
    setHistoryStatus("open");
    setSelectedBulkIds(new Set());
    if (!lane) {
      navigate("/inbox");
      return;
    }
    navigate(`/inbox/${LANE_TO_SLUG[lane]}`);
  };

  const handleHistoryStatusChange = (
    status: RouteHistoryStatus,
  ) => {
    setHistoryStatus(status);
    setBulkMessage(null);
    if (activeLane) {
      const itemPath = params.itemId ? `/${params.itemId}` : "";
      navigate(
        `/inbox/${LANE_TO_SLUG[activeLane]}${itemPath}${appendStatus(
          location.search,
          status,
        )}`,
      );
    }
  };

  const handleToggleBulkItem = (itemId: string) => {
    setSelectedBulkIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const handleBulkAction = async (action: "archive" | "dismiss" | "snooze") => {
    const selectedItems = items.filter((item) => selectedBulkIds.has(item.id));
    if (selectedItems.length === 0) return;
    const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const result = await hubMutations.bulkAction.mutateAsync({
      items: selectedItems.map((item) => {
        if (action === "archive") {
          return { id: item.id, action, expectedVersion: item.version };
        }
        if (action === "snooze") {
          return { id: item.id, action, until };
        }
        return { id: item.id, action };
      }),
    });
    setBulkMessage(
      `${result.summary.succeeded} succeeded, ${result.summary.failed} failed`,
    );
    setSelectedBulkIds(new Set());
  };

  const handleSelectItem = (itemId: string | null) => {
    if (!activeLane) return;
    const lanePath = `/inbox/${LANE_TO_SLUG[activeLane]}`;
    if (!itemId) {
      navigate(`${lanePath}${location.search}`);
      return;
    }
    navigate(`${lanePath}/${itemId}${location.search}`);
  };

  const handleLoadMore = () => {
    if (listQuery.data?.nextCursor) {
      setCursor(listQuery.data.nextCursor);
    }
  };

  const handlePreferencesChange = (patch: UpdateHubPreferencesInput) => {
    setOptimisticPreferences({ ...preferences, ...patch });
    updatePreferences.mutate(patch);
    if (patch.visibleLanes && activeLane && !patch.visibleLanes.includes(activeLane)) {
      navigate("/inbox");
    }
  };

  const handleMarkRead = (itemId: string) => {
    if (markingReadItemIds.current.has(itemId)) return;
    markingReadItemIds.current.add(itemId);
    markRead.mutate(itemId);
  };

  const handleMarkUnread = (itemId: string) => {
    hubMutations.markUnread.mutate(itemId);
  };

  const handleDismiss = (itemId: string) => {
    hubMutations.dismiss.mutate(itemId);
    setUndoAction({ label: "dismiss", itemId, restore: { kind: "undismiss" } });
  };

  const handleSnooze = (itemId: string) => {
    const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    hubMutations.snooze.mutate({ itemId, until });
    setUndoAction({ label: "snooze", itemId, restore: { kind: "unsnooze" } });
  };

  const handleLifecycleAction = async (
    item: HubItemListRow,
    action: "resolve" | "archive" | "claim" | "release",
  ) => {
    const result = await hubMutations.act.mutateAsync({
      itemId: item.id,
      payload: { action, expectedVersion: item.version },
    });
    if (result.auditId) {
      setUndoAction({
        label: action,
        itemId: item.id,
        auditId: result.auditId,
        expectedVersion: result.item.version,
      });
    }
  };

  const undoServerAction = () => {
    if (!undoAction) return;
    if (undoAction.restore) {
      void hubMutations.undoPersonalState({
        itemId: undoAction.itemId,
        restore: undoAction.restore,
      });
    } else if (undoAction.auditId != null && undoAction.expectedVersion != null) {
      hubMutations.undo.mutate({
        itemId: undoAction.itemId,
        payload: {
          auditId: undoAction.auditId,
          expectedVersion: undoAction.expectedVersion,
        },
      });
    }
    setUndoAction(null);
  };

  if (legacyInboxHubTarget) {
    return <Navigate to={legacyInboxHubTarget} replace />;
  }

  if (isLegacyInboxNew) {
    return (
      <Navigate
        to={`/inbox/${LANE_TO_SLUG.waiting_on_you}${location.search}`}
        replace
      />
    );
  }

  if (isLegacyInboxAll) {
    return (
      <Navigate
        to={`/inbox/${LANE_TO_SLUG.waiting_on_you}${appendStatus(
          location.search,
          "resolved",
        )}`}
        replace
      />
    );
  }

  if (unknownLane) {
    return <Navigate to="/inbox" replace />;
  }

  return (
    <HubShell
      activeLane={activeLane}
      items={items}
      counts={countsQuery.data ?? { open: 0, unread: 0 }}
      isLoading={activeLane ? listQuery.isLoading : countsQuery.isLoading}
      error={listQuery.error ?? countsQuery.error}
      selectedItemId={selectedItemId}
      historyStatus={historyStatus}
      auditRows={auditQuery.data ?? []}
      auditLoading={auditQuery.isLoading}
      selectedBulkIds={selectedBulkIds}
      bulkMessage={bulkMessage}
      searchText={searchText}
      hasMore={!!listQuery.data?.nextCursor}
      isLoadingMore={listQuery.isFetching && !!cursor}
      preferences={preferences}
      notificationPreferences={notificationPreferences}
      notificationPreferencesPending={
        updateNotificationPreferences.isPending ||
        resetNotificationPreferences.isPending ||
        ackNotificationDigest.isPending
      }
      digestItems={notificationDigestQuery.data?.items ?? []}
      onLaneChange={handleLaneChange}
      onSearchTextChange={setSearchText}
      onLoadMore={handleLoadMore}
      onPreferencesChange={handlePreferencesChange}
      onUpdateNotificationPreferences={(patch) => {
        updateNotificationPreferences.mutate(patch);
      }}
      onResetNotificationPreferences={() => {
        resetNotificationPreferences.mutate();
      }}
      onAckDigest={() => {
        ackNotificationDigest.mutate();
      }}
      onHistoryStatusChange={handleHistoryStatusChange}
      onSelectItem={handleSelectItem}
      onMarkRead={handleMarkRead}
      onToggleBulkItem={handleToggleBulkItem}
      onBulkAction={(action) => {
        void handleBulkAction(action);
      }}
      onMarkUnread={handleMarkUnread}
      onDismiss={handleDismiss}
      onSnooze={handleSnooze}
      onLifecycleAction={(item, action) => {
        void handleLifecycleAction(item, action);
      }}
      undoAction={
        undoAction
          ? {
              label: undoAction.label,
              onUndo: undoServerAction,
            }
          : null
      }
    />
  );
}
