import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  UNIVERSE_DRAFT_SCHEMA_VERSION,
  type UniverseDraft,
  type UniverseDraftDestination,
} from "@armyofagents/shared";
import { ApiError } from "../../api/client";
import { universeDraftApi } from "../../api/universe-draft";
import { queryKeys } from "../../lib/queryKeys";
import { afterAcknowledgement, type SentSnapshot } from "./draft-state";

export type DraftSaveStatus =
  | "idle"
  | "saving"
  | "saved"
  | "offline"
  | "conflict";

const EMPTY: UniverseDraft = { revision: 0, text: "", attachmentAssetIds: [] };

/**
 * E1.3 client layer for a single destination-scoped draft. Keeps the
 * server-acknowledged draft (React Query) and debounces edits; save status
 * reflects the server, a 409 re-hydrates (the client keeps its local edit — both
 * versions retained), a network failure keeps the edit for retry. `submitSnapshot`
 * freezes the draft for Send and `acknowledge` clears exactly the sent snapshot
 * after a durable ack (keeping anything typed since). The actual send calls the
 * destination's own client (Commander/task) — wired by E1.5/E2.4, not here.
 */
export function useUniverseDraft(
  companyId: string | null | undefined,
  conversationId: string | null | undefined,
  destination: UniverseDraftDestination,
  options?: { debounceMs?: number },
) {
  const qc = useQueryClient();
  const enabled = !!companyId && !!conversationId;
  const key = queryKeys.universeDraft(
    companyId ?? "",
    conversationId ?? "",
    destination.kind,
    destination.id,
  );
  const debounceMs = options?.debounceMs ?? 400;

  const query = useQuery({
    queryKey: key,
    queryFn: () =>
      universeDraftApi.get(companyId as string, conversationId as string, destination),
    enabled,
  });

  const [status, setStatus] = useState<DraftSaveStatus>("idle");
  const pending = useRef<{ text: string; attachmentAssetIds: string[] } | null>(
    null,
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const next = pending.current;
    if (!enabled || !next) return undefined;
    pending.current = null;
    const current = qc.getQueryData<UniverseDraft>(key);
    setStatus("saving");
    try {
      const saved = await universeDraftApi.save(
        companyId as string,
        conversationId as string,
        destination,
        {
          schemaVersion: UNIVERSE_DRAFT_SCHEMA_VERSION,
          expectedRevision: current?.revision ?? 0,
          text: next.text,
          attachmentAssetIds: next.attachmentAssetIds,
        },
      );
      qc.setQueryData(key, saved);
      setStatus("saved");
      return saved;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        await qc.invalidateQueries({ queryKey: key });
        setStatus("conflict");
      } else {
        pending.current = next;
        setStatus("offline");
      }
      throw err;
    }
  }, [companyId, conversationId, destination, enabled, key, qc]);

  const save = useCallback(
    (text: string, attachmentAssetIds: string[], flushNow = false) => {
      pending.current = { text, attachmentAssetIds };
      if (flushNow) return flush();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void flush();
      }, debounceMs);
      return undefined;
    },
    [flush, debounceMs],
  );

  const submitSnapshot = useCallback(
    (clientSubmissionId: string): SentSnapshot | null => {
      const current = qc.getQueryData<UniverseDraft>(key) ?? EMPTY;
      return {
        revision: current.revision,
        text: current.text,
        attachmentAssetIds: current.attachmentAssetIds,
        clientSubmissionId,
      };
    },
    [qc, key],
  );

  const acknowledge = useCallback(
    (sent: SentSnapshot) => {
      const current = qc.getQueryData<UniverseDraft>(key) ?? EMPTY;
      const next = afterAcknowledgement(
        {
          revision: current.revision,
          text: current.text,
          attachmentAssetIds: current.attachmentAssetIds,
        },
        sent,
      );
      // Only persist when the acknowledged snapshot was cleared; if the user kept
      // typing, the newer draft is left untouched.
      if (next.text === current.text) return undefined;
      return save(next.text, next.attachmentAssetIds, true);
    },
    [qc, key, save],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return {
    draft: query.data ?? EMPTY,
    revision: query.data?.revision ?? 0,
    isLoading: query.isLoading,
    status,
    save,
    flush,
    submitSnapshot,
    acknowledge,
    refetch: query.refetch,
  };
}
