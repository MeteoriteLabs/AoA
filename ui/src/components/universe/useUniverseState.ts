import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  UNIVERSE_LAYOUT_SCHEMA_VERSION,
  type LayoutOp,
  type LayoutPatch,
} from "@armyofagents/shared";
import { ApiError } from "../../api/client";
import {
  universeLayoutApi,
  type UniverseLayoutResponse,
} from "../../api/universe-layout";
import { queryKeys } from "../../lib/queryKeys";

export type UniverseSaveStatus =
  | "idle"
  | "saving"
  | "saved"
  | "offline"
  | "conflict";

function newOperationId(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  return (
    c?.randomUUID?.() ??
    `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}

/**
 * E1.2/2 client layer for revisioned Universe layout persistence. Retains the
 * server-acknowledged snapshot (via React Query) separately from a pending
 * operation buffer. `queueOps` debounces transient geometry; `flush` sends the
 * final gesture immediately. Save status reflects the server acknowledgement, not
 * a local animation. On a 409 the acknowledged snapshot is re-fetched (the caller
 * re-applies from that fresh base); a network failure keeps the pending ops for a
 * retry. Property-level rebase of same-property conflicts, receipt-first lost-ack
 * recovery, and the two-tab E2E are deferred refinements — their acceptance
 * (universe-persistence.spec.ts) is gated on the Universe page/route (E1.0/E2.4).
 */
export function useUniverseState(
  companyId: string | null | undefined,
  conversationId: string | null | undefined,
  options?: { debounceMs?: number },
) {
  const qc = useQueryClient();
  const enabled = !!companyId && !!conversationId;
  const key = queryKeys.universeLayout(companyId ?? "", conversationId ?? "");
  const debounceMs = options?.debounceMs ?? 250;

  const query = useQuery({
    queryKey: key,
    queryFn: () => universeLayoutApi.get(companyId as string, conversationId as string),
    enabled,
  });

  const [status, setStatus] = useState<UniverseSaveStatus>("idle");
  const pending = useRef<LayoutOp[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const ops = pending.current;
    if (!enabled || ops.length === 0) return undefined;
    pending.current = [];
    const snapshot = qc.getQueryData<UniverseLayoutResponse>(key);
    const patch: LayoutPatch = {
      schemaVersion: UNIVERSE_LAYOUT_SCHEMA_VERSION,
      operationId: newOperationId(),
      expectedRevision: snapshot?.revision ?? 0,
      operations: ops,
    };
    setStatus("saving");
    try {
      const ack = await universeLayoutApi.apply(
        companyId as string,
        conversationId as string,
        patch,
      );
      await qc.invalidateQueries({ queryKey: key });
      setStatus("saved");
      return ack;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Server wins: re-hydrate the acknowledged base. (Property-level rebase
        // of same-property edits is a later refinement.)
        await qc.invalidateQueries({ queryKey: key });
        setStatus("conflict");
      } else {
        // Network/offline: preserve the ops ahead of anything newly queued.
        pending.current = [...ops, ...pending.current];
        setStatus("offline");
      }
      throw err;
    }
  }, [companyId, conversationId, enabled, key, qc]);

  const queueOps = useCallback(
    (ops: LayoutOp[], flushNow = false) => {
      if (ops.length) pending.current = [...pending.current, ...ops];
      if (flushNow) return flush();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void flush();
      }, debounceMs);
      return undefined;
    },
    [flush, debounceMs],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return {
    document: query.data?.document,
    revision: query.data?.revision ?? 0,
    schemaVersion: query.data?.schemaVersion ?? UNIVERSE_LAYOUT_SCHEMA_VERSION,
    isLoading: query.isLoading,
    isError: query.isError,
    status,
    queueOps,
    flush,
    refetch: query.refetch,
  };
}
