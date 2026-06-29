import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { HubItemStatus, HubLane } from "@armyofagents/shared";
import { hubItemsApi, type HubItemListRow } from "@/api/hub-items";
import { HubShell } from "@/components/hub/HubShell";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useCompany } from "@/context/CompanyContext";
import { useHubItemMutations } from "@/hooks/useHubItemMutations";
import { queryKeys } from "@/lib/queryKeys";
import { Navigate, useNavigate, useParams } from "@/lib/router";

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

export function InboxHub() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const navigate = useNavigate();
  const params = useParams<{
    companyPrefix?: string;
    lane?: string;
    itemId?: string;
  }>();
  const queryClient = useQueryClient();
  const markingReadItemIds = useRef(new Set<string>());
  const hubMutations = useHubItemMutations(selectedCompanyId);
  const [undoAction, setUndoAction] = useState<{
    label: string;
    itemId: string;
    auditId?: string;
    expectedVersion?: number;
    restore?: { kind: "unsnooze" | "undismiss" };
  } | null>(null);
  const [historyStatus, setHistoryStatus] = useState<
    Extract<HubItemStatus, "open" | "resolved" | "archived">
  >("open");
  const [selectedBulkIds, setSelectedBulkIds] = useState<Set<string>>(() => new Set());

  const laneSlug = params.lane ?? null;
  const activeLane = laneSlug ? SLUG_TO_LANE[laneSlug] ?? null : null;
  const unknownLane = laneSlug != null && activeLane == null;

  useEffect(() => {
    setBreadcrumbs([{ label: "Inbox Hub" }]);
  }, [setBreadcrumbs]);

  const countsQuery = useQuery({
    queryKey: selectedCompanyId
      ? queryKeys.hubItems.counts(selectedCompanyId)
      : ["hub-items", "counts", "none"],
    queryFn: () => hubItemsApi.counts(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const listOptions = useMemo(
    () =>
      activeLane
        ? {
            lane: activeLane,
            status: historyStatus,
            limit: 50,
          }
        : undefined,
    [activeLane, historyStatus],
  );

  const listQuery = useQuery({
    queryKey:
      selectedCompanyId && listOptions
        ? queryKeys.hubItems.list(selectedCompanyId, listOptions)
        : ["hub-items", selectedCompanyId ?? "none", "home"],
    queryFn: () => hubItemsApi.list(selectedCompanyId!, listOptions),
    enabled: !!selectedCompanyId && !!listOptions,
  });

  const markRead = useMutation({
    mutationFn: (itemId: string) => hubItemsApi.markRead(selectedCompanyId!, itemId),
    onMutate: (itemId) => {
      if (!selectedCompanyId) return;
      const readAt = new Date().toISOString();
      queryClient.setQueriesData<HubItemListRow[]>(
        { queryKey: ["hub-items", selectedCompanyId] },
        (old) =>
          Array.isArray(old)
            ? old.map((item) => (item.id === itemId ? { ...item, readAt } : item))
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

  const items = listQuery.data ?? [];
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
      navigate("/inbox-hub");
      return;
    }
    navigate(`/inbox-hub/${LANE_TO_SLUG[lane]}`);
  };

  const handleHistoryStatusChange = (
    status: Extract<HubItemStatus, "open" | "resolved" | "archived">,
  ) => {
    setHistoryStatus(status);
    setSelectedBulkIds(new Set());
  };

  const handleToggleBulkItem = (itemId: string) => {
    setSelectedBulkIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const handleBulkAction = (action: "archive" | "dismiss" | "snooze") => {
    const selectedItems = items.filter((item) => selectedBulkIds.has(item.id));
    if (selectedItems.length === 0) return;
    const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    hubMutations.bulkAction.mutate({
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
    setSelectedBulkIds(new Set());
  };

  const handleSelectItem = (itemId: string | null) => {
    if (!activeLane) return;
    const lanePath = `/inbox-hub/${LANE_TO_SLUG[activeLane]}`;
    if (!itemId) {
      navigate(lanePath);
      return;
    }
    navigate(`${lanePath}/${itemId}`);
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

  if (unknownLane) {
    return <Navigate to="/inbox-hub" replace />;
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
      onLaneChange={handleLaneChange}
      onHistoryStatusChange={handleHistoryStatusChange}
      onSelectItem={handleSelectItem}
      onMarkRead={handleMarkRead}
      onToggleBulkItem={handleToggleBulkItem}
      onBulkAction={handleBulkAction}
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
