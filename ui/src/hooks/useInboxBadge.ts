import { useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { inboxDismissalsApi, type InboxDismissal } from "@/api/inbox-dismissals";
import { queryKeys } from "@/lib/queryKeys";

export const DISMISSED_LOCAL_STORAGE_KEY = "aoa:inbox:dismissed";
const MIGRATION_FLAG_KEY = "aoa:inbox:dismissed:migrated";

function readLegacyDismissed(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(DISMISSED_LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((k): k is string => typeof k === "string" && k.length > 0);
  } catch {
    return [];
  }
}

function clearLegacyDismissed() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DISMISSED_LOCAL_STORAGE_KEY);
    window.localStorage.setItem(MIGRATION_FLAG_KEY, "1");
  } catch {
    // ignore storage quota errors
  }
}

function hasMigrated(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(MIGRATION_FLAG_KEY) === "1";
  } catch {
    return true;
  }
}

export interface UseInboxBadgeResult {
  dismissals: InboxDismissal[];
  dismissedSet: Set<string>;
  isDismissed: (itemKey: string) => boolean;
  dismiss: (itemKey: string) => void;
  undismiss: (itemKey: string) => void;
  isLoading: boolean;
}

export function useInboxBadge(
  companyId: string | null | undefined,
): UseInboxBadgeResult {
  const queryClient = useQueryClient();
  const enabled = !!companyId;
  const queryKey = companyId
    ? queryKeys.inboxDismissals(companyId)
    : (["inbox-dismissals", "__disabled__"] as const);

  const { data: dismissals = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => inboxDismissalsApi.list(companyId!),
    enabled,
  });

  const dismissMutation = useMutation({
    mutationFn: (itemKey: string) => inboxDismissalsApi.dismiss(companyId!, itemKey),
    onMutate: async (itemKey) => {
      if (!companyId) return { previous: [] as InboxDismissal[] };
      await queryClient.cancelQueries({ queryKey });
      const previous =
        queryClient.getQueryData<InboxDismissal[]>(queryKey) ?? [];
      const now = new Date().toISOString();
      queryClient.setQueryData<InboxDismissal[]>(queryKey, [
        {
          id: `optimistic:${itemKey}`,
          companyId,
          userId: "me",
          itemKey,
          dismissedAt: now,
          createdAt: now,
          updatedAt: now,
        },
        ...previous.filter((d) => d.itemKey !== itemKey),
      ]);
      return { previous };
    },
    onError: (_err, _key, ctx) => {
      if (!ctx) return;
      queryClient.setQueryData(queryKey, ctx.previous);
    },
    onSettled: () => {
      if (!companyId) return;
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const undismissMutation = useMutation({
    mutationFn: (itemKey: string) =>
      inboxDismissalsApi.undismiss(companyId!, itemKey),
    onMutate: async (itemKey) => {
      if (!companyId) return { previous: [] as InboxDismissal[] };
      await queryClient.cancelQueries({ queryKey });
      const previous =
        queryClient.getQueryData<InboxDismissal[]>(queryKey) ?? [];
      queryClient.setQueryData<InboxDismissal[]>(
        queryKey,
        previous.filter((d) => d.itemKey !== itemKey),
      );
      return { previous };
    },
    onError: (_err, _key, ctx) => {
      if (!ctx) return;
      queryClient.setQueryData(queryKey, ctx.previous);
    },
    onSettled: () => {
      if (!companyId) return;
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const migrationRanRef = useRef(false);
  useEffect(() => {
    if (!companyId || migrationRanRef.current) return;
    if (hasMigrated()) return;
    migrationRanRef.current = true;
    const legacy = readLegacyDismissed();
    if (legacy.length === 0) {
      clearLegacyDismissed();
      return;
    }
    // Best-effort: push each dismissal to the server, then clear the key.
    // Failures are logged and do not block the user.
    void Promise.allSettled(
      legacy.map((itemKey) => inboxDismissalsApi.dismiss(companyId, itemKey)),
    ).then((results) => {
      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length > 0) {
        console.warn(
          `[inbox] migrated ${legacy.length - failed.length}/${legacy.length} legacy dismissals to server`,
          failed,
        );
      }
      clearLegacyDismissed();
      queryClient.invalidateQueries({ queryKey });
    });
  }, [companyId, queryClient, queryKey]);

  const dismissedSet = useMemo(
    () => new Set(dismissals.map((d) => d.itemKey)),
    [dismissals],
  );

  return {
    dismissals,
    dismissedSet,
    isDismissed: (itemKey: string) => dismissedSet.has(itemKey),
    dismiss: (itemKey: string) => dismissMutation.mutate(itemKey),
    undismiss: (itemKey: string) => undismissMutation.mutate(itemKey),
    isLoading,
  };
}
