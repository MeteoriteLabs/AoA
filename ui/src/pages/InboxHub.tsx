import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  HubAutopilotActionRow,
  HubAutopilotActionsResponse,
  HubAutopilotPolicy,
  HubItemStatus,
  HubLane,
  HubPreferences,
  NotificationPreferences,
  UpdateHubAutopilotPolicyInput,
  UpdateNotificationPreferencesInput,
  UpdateHubPreferencesInput,
} from "@armyofagents/shared";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "@armyofagents/shared";
import { hubItemsApi, type HubItemListRow, type HubListResponse } from "@/api/hub-items";
import { HubShell } from "@/components/hub/HubShell";
import { hubTabForItem } from "@/components/hub/hubRegistry";
import { browserTab } from "@/components/hub/hubViewerModel";
import { useHubTabs } from "@/components/hub/useHubTabs";
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
const DEFAULT_AUTOPILOT_POLICY: HubAutopilotPolicy = {
  mode: "off",
  handledToday: 0,
  lastHandledAt: null,
  rules: [],
  updatedAt: null,
};
const DEFAULT_AUTOPILOT_ACTIONS: HubAutopilotActionsResponse = { items: [] };

/** Bound for the opened-item preview cache (deliberate, like useHubTabs' 12-tab cap). */
export const OPENED_ITEM_CACHE_MAX = 24;

/**
 * The ONLY insert path for the opened-item cache — used by BOTH writers (the
 * deep-link hydration effect and handleOpenItem) so the cache stays bounded to
 * the most recent {@link OPENED_ITEM_CACHE_MAX} rows. Recency = insertion
 * order (string keys preserve it; hub item ids are uuids, never integer-like).
 * Re-inserting the exact cached reference is a no-op (React bails out, so
 * repeated row clicks don't churn state); a changed row for a cached id
 * refreshes both its data and its recency.
 */
export function insertOpenedItem(
  cache: Record<string, HubItemListRow>,
  item: HubItemListRow,
): Record<string, HubItemListRow> {
  if (cache[item.id] === item) return cache;
  const entries = Object.entries(cache).filter(([id]) => id !== item.id);
  entries.push([item.id, item]);
  return Object.fromEntries(
    entries.slice(Math.max(0, entries.length - OPENED_ITEM_CACHE_MAX)),
  );
}

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
  // Tabbed right-panel viewer (Home + entity + browser tabs), persisted per company.
  const { tabs, activeKey, openTab, closeTab, activateTab } = useHubTabs(
    selectedCompanyId ?? undefined,
  );
  // Rows opened as tabs are cached here so runtime_decision / notification bodies
  // (which resolve their hub item by id) keep working after a lane switch, and so
  // deep-linked items from another lane / resolved history can resolve at all.
  // Bounded: every write goes through insertOpenedItem (most recent 24 rows).
  const [openedItemCache, setOpenedItemCache] = useState<Record<string, HubItemListRow>>({});
  // Per-itemId guard (not a boolean): a later deep-link to a DIFFERENT item in
  // the same SPA session must hydrate too; the same item stays fire-once.
  const deepLinkHandledRef = useRef<string | null>(null);
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

  const autopilotPolicyQuery = useQuery({
    queryKey: selectedCompanyId
      ? queryKeys.hubItems.autopilotPolicy(selectedCompanyId)
      : ["hub-items", "autopilot-policy", "none"],
    queryFn: () => hubItemsApi.autopilotPolicy.get(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const autopilotActionsQuery = useQuery({
    queryKey: selectedCompanyId
      ? queryKeys.hubItems.autopilotActions(selectedCompanyId)
      : ["hub-items", "autopilot-actions", "none"],
    queryFn: () => hubItemsApi.autopilotActions.list(selectedCompanyId!),
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

  const updateAutopilotPolicy = useMutation({
    mutationFn: (patch: UpdateHubAutopilotPolicyInput) =>
      hubItemsApi.autopilotPolicy.update(selectedCompanyId!, patch),
    onSuccess: (updated) => {
      if (!selectedCompanyId) return;
      queryClient.setQueryData(
        queryKeys.hubItems.autopilotPolicy(selectedCompanyId),
        updated,
      );
    },
    onSettled: async () => {
      if (!selectedCompanyId) return;
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.hubItems.autopilotPolicy(selectedCompanyId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.hubItems.autopilotActions(selectedCompanyId),
        }),
        queryClient.invalidateQueries({ queryKey: ["hub-items", selectedCompanyId] }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.hubItems.counts(selectedCompanyId),
        }),
      ]);
    },
  });

  const resetAutopilotPolicy = useMutation({
    mutationFn: () => hubItemsApi.autopilotPolicy.reset(selectedCompanyId!),
    onSuccess: (updated) => {
      if (!selectedCompanyId) return;
      queryClient.setQueryData(
        queryKeys.hubItems.autopilotPolicy(selectedCompanyId),
        updated,
      );
    },
    onSettled: async () => {
      if (!selectedCompanyId) return;
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.hubItems.autopilotPolicy(selectedCompanyId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.hubItems.autopilotActions(selectedCompanyId),
        }),
        queryClient.invalidateQueries({ queryKey: ["hub-items", selectedCompanyId] }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.hubItems.counts(selectedCompanyId),
        }),
      ]);
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
            limit: 50,
          }
        : undefined,
    [activeLane, debouncedSearchText, historyStatus, preferences.groupMode],
  );

  // Reset the bulk selection on any list-scope change. Page accumulation resets
  // for free: the query key includes lane/search/status, so useInfiniteQuery
  // starts a fresh page-1 fetch whenever the scope changes.
  useEffect(() => {
    setSelectedBulkIds(new Set());
  }, [activeLane, debouncedSearchText, historyStatus]);

  // Pages accumulate in the react-query cache (no useState mirror). v5's default
  // structuralSharing keeps item references stable across an unchanged refetch,
  // so the list doesn't re-render on every hub mutation (the flicker fix).
  const listQuery = useInfiniteQuery({
    queryKey:
      selectedCompanyId && listOptions
        ? queryKeys.hubItems.list(selectedCompanyId, listOptions)
        : ["hub-items", selectedCompanyId ?? "none", "home"],
    queryFn: ({ pageParam }) =>
      hubItemsApi.list(selectedCompanyId!, {
        ...listOptions!,
        cursor: pageParam ?? undefined,
      }),
    enabled: !!selectedCompanyId && !!listOptions,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const markRead = useMutation({
    mutationFn: (itemId: string) => hubItemsApi.markRead(selectedCompanyId!, itemId),
    onMutate: (itemId) => {
      if (!selectedCompanyId) return;
      const readAt = new Date().toISOString();
      // Broad prefix matcher: this hits the list, counts, audit, preferences and
      // autopilot caches. Branch order matters — the infinite-query list cache is
      // `{ pages: HubListResponse[], pageParams }`, so match `"pages" in old` FIRST
      // (before the `.items`/array branches) and leave every other shape as `old`.
      queryClient.setQueriesData<unknown>(
        { queryKey: ["hub-items", selectedCompanyId] },
        (old: unknown) => {
          if (
            old &&
            typeof old === "object" &&
            "pages" in old &&
            Array.isArray((old as { pages: HubListResponse[] }).pages)
          ) {
            const paged = old as { pages: HubListResponse[]; pageParams: unknown[] };
            return {
              ...paged,
              pages: paged.pages.map((page) => ({
                ...page,
                items: page.items.map((item) =>
                  item.id === itemId ? { ...item, readAt } : item,
                ),
              })),
            };
          }
          if (Array.isArray(old)) {
            return old.map((item) =>
              (item as HubItemListRow).id === itemId
                ? { ...(item as HubItemListRow), readAt }
                : item,
            );
          }
          if (old && typeof old === "object" && Array.isArray((old as HubListResponse).items)) {
            const resp = old as HubListResponse;
            return {
              ...resp,
              items: resp.items.map((item) =>
                item.id === itemId ? { ...item, readAt } : item,
              ),
            };
          }
          return old;
        },
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

  const items = useMemo(
    () => (activeLane ? (listQuery.data?.pages.flatMap((page) => page.items) ?? []) : []),
    [activeLane, listQuery.data],
  );
  // `selectedItemId` gates the center-list highlight, so it stays validated
  // against the loaded lane. `selectedItem` (the Home preview) additionally
  // falls back to the opened-item cache so a deep-linked / cross-lane item still
  // previews. `:itemId` remains a HUB-ITEM id — never an entity id.
  const selectedItemId =
    params.itemId && items.some((item) => item.id === params.itemId)
      ? params.itemId
      : null;
  const selectedItem =
    (params.itemId
      ? items.find((item) => item.id === params.itemId) ?? openedItemCache[params.itemId]
      : undefined) ?? null;

  // Deep link (`/inbox/:lane/:itemId`) selects the item into the Home reading
  // pane. Single-click / deep-link PREVIEW (no auto-tab); dedicated tabs open on
  // "Open full" / in-viewer links / the + browser button. If the item isn't in
  // the loaded lane (hidden / resolved / other lane), hydrate it once so the
  // reading pane can still preview it.
  useEffect(() => {
    const itemId = params.itemId;
    if (!itemId || !selectedCompanyId) return;
    if (deepLinkHandledRef.current === itemId) return;
    const listItem = items.find((item) => item.id === itemId);
    if (listItem || openedItemCache[itemId]) {
      // Cache the list-found row BEFORE marking handled: a later list refetch
      // that drops the item must not leave this deep-link unhydratable forever
      // (guard says handled + cache empty = no preview and no re-fetch).
      if (listItem) {
        setOpenedItemCache((cache) => insertOpenedItem(cache, listItem));
      }
      deepLinkHandledRef.current = itemId;
      return;
    }
    deepLinkHandledRef.current = itemId;
    let cancelled = false;
    hubItemsApi
      .getOne(selectedCompanyId, itemId)
      .then((item) => {
        if (!cancelled) setOpenedItemCache((cache) => insertOpenedItem(cache, item));
      })
      .catch(() => {
        // Stale / hidden deep link — leave the reading pane empty.
      });
    return () => {
      cancelled = true;
    };
  }, [params.itemId, selectedCompanyId, items, openedItemCache]);

  const resolveHubItem = useCallback(
    (id: string): HubItemListRow | undefined =>
      items.find((item) => item.id === id) ?? openedItemCache[id],
    [items, openedItemCache],
  );
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

  // "Open full" (from the Home reading pane) + linked-entity hand-offs: open the
  // item's entity as a dedicated tab (and keep it selected). Cache the row so its
  // tab body can resolve it by id even after a later lane switch.
  const handleOpenItem = (item: HubItemListRow) => {
    setOpenedItemCache((cache) => insertOpenedItem(cache, item));
    handleSelectItem(item.id);
    openTab(hubTabForItem(item));
  };

  const handleAddBrowserTab = () => {
    openTab(browserTab("about:blank", "Browser"));
  };

  const handleLoadMore = () => {
    if (listQuery.hasNextPage && !listQuery.isFetchingNextPage) {
      void listQuery.fetchNextPage();
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

  const handleUndoAutopilotAction = (action: HubAutopilotActionRow) => {
    if (!selectedCompanyId || !action.hubItemId || action.itemVersion == null) return;
    hubMutations.undo.mutate(
      {
        itemId: action.hubItemId,
        payload: {
          auditId: action.auditId,
          expectedVersion: action.itemVersion,
        },
      },
      {
        onSettled: async () => {
          await queryClient.invalidateQueries({
            queryKey: queryKeys.hubItems.autopilotActions(selectedCompanyId),
          });
        },
      },
    );
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
      selectedItem={selectedItem}
      companyId={selectedCompanyId ?? undefined}
      tabs={tabs}
      activeTabKey={activeKey}
      onOpenTab={openTab}
      onOpenItem={handleOpenItem}
      onCloseTab={closeTab}
      onActivateTab={activateTab}
      onAddBrowserTab={handleAddBrowserTab}
      resolveHubItem={resolveHubItem}
      historyStatus={historyStatus}
      auditRows={auditQuery.data ?? []}
      auditLoading={auditQuery.isLoading}
      selectedBulkIds={selectedBulkIds}
      bulkMessage={bulkMessage}
      searchText={searchText}
      hasMore={listQuery.hasNextPage}
      isLoadingMore={listQuery.isFetchingNextPage}
      preferences={preferences}
      notificationPreferences={notificationPreferences}
      notificationPreferencesPending={
        updateNotificationPreferences.isPending ||
        resetNotificationPreferences.isPending ||
        ackNotificationDigest.isPending
      }
      digestItems={notificationDigestQuery.data?.items ?? []}
      autopilotPolicy={autopilotPolicyQuery.data ?? DEFAULT_AUTOPILOT_POLICY}
      autopilotActions={autopilotActionsQuery.data ?? DEFAULT_AUTOPILOT_ACTIONS}
      autopilotPending={
        updateAutopilotPolicy.isPending || resetAutopilotPolicy.isPending
      }
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
      onUpdateAutopilotPolicy={(patch) => {
        updateAutopilotPolicy.mutate(patch);
      }}
      onResetAutopilotPolicy={() => {
        resetAutopilotPolicy.mutate();
      }}
      onUndoAutopilotAction={handleUndoAutopilotAction}
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
