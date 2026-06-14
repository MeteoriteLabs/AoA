/**
 * useCockpitPin — Phase 3d.
 *
 * Returns { pin, unpin } mutation pairs. Each on success shows a toast and
 * invalidates queryKeys.cockpit so the Pinned card refreshes immediately.
 * Mirrors the approach used by useCockpitApprovalAction.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CockpitPinnedEntityType } from "@armyofagents/shared";
import { pinsApi } from "../../../api/pins";
import { queryKeys } from "../../../lib/queryKeys";
import { useToast } from "../../../context/ToastContext";

export function useCockpitPin(companyId: string) {
  const qc = useQueryClient();
  const { pushToast } = useToast();

  const pin = useMutation({
    mutationFn: ({ entityType, entityId }: { entityType: CockpitPinnedEntityType; entityId: string }) =>
      pinsApi.pin(companyId, entityType, entityId),
    onSuccess: () => {
      pushToast({ title: "Pinned", tone: "success" });
      void qc.invalidateQueries({ queryKey: queryKeys.cockpit(companyId) });
    },
    onError: (err) =>
      pushToast({
        title: err instanceof Error ? err.message : "Pin failed",
        tone: "error",
      }),
  });

  const unpin = useMutation({
    mutationFn: ({ entityType, entityId }: { entityType: CockpitPinnedEntityType; entityId: string }) =>
      pinsApi.unpin(companyId, entityType, entityId),
    onSuccess: () => {
      pushToast({ title: "Unpinned", tone: "success" });
      void qc.invalidateQueries({ queryKey: queryKeys.cockpit(companyId) });
    },
    onError: (err) =>
      pushToast({
        title: err instanceof Error ? err.message : "Unpin failed",
        tone: "error",
      }),
  });

  return { pin, unpin };
}
