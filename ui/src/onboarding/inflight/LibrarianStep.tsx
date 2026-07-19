import { useEffect, useRef, useState } from "react";
import type { MemoryItem } from "@armyofagents/shared";
import { projectsApi } from "../../api/projects";
import { braindumpApi, type BraindumpCapture } from "../../api/braindump";
import { memoryApi } from "../../api/memory";
import { Button } from "@/components/ui/button";
import { AgentCharacter, Reveal } from "../motion";
import { GradientText, StepCard, StepHeading, StepShell } from "../steps/shared";

/** Interval (ms) between capture-status poll ticks while the Librarian is
 *  organizing. Matches the cadence of VerifyStep's login poll. */
const POLL_INTERVAL_MS = 3000;

function isTerminal(status: BraindumpCapture["status"]): boolean {
  return status === "proposed" || status === "failed";
}

export type LibrarianStepProps = {
  companyId: string;
  onDone: () => void;
};

/**
 * WS6 — the In-flight "Librarian" surface. Standalone, like `BraindumpStep`
 * (which precedes it) — domain-only, no `advanceOnboarding` call; WS9
 * sequences Braindump -> Librarian onto Home.
 *
 * Polls every department's braindump captures (the synchronous dispatch in
 * `POST /braindumps` usually already lands "proposed"/"failed" by the time
 * this mounts, but a still-"pending"/"running" row — e.g. a retry racing a
 * page load — keeps the AgentCharacter in `thinking` until every capture
 * reaches a terminal status). Once terminal, flips to `done` and lists the
 * proposed `domain` memory items for inline approval via the REAL founder
 * approval route (`memoryApi.approve` -> `POST .../memory/:id/approve`) —
 * never a bespoke write. A `failed` capture shows its `failureReason` with a
 * Retry action (`braindumpApi.retry`). Continue always fires `onDone` — this
 * step never blocks the founder from moving on, even mid-organizing.
 */
export function LibrarianStep({ companyId, onDone }: LibrarianStepProps) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [organizing, setOrganizing] = useState(true);
  const [captures, setCaptures] = useState<BraindumpCapture[]>([]);
  const [pendingItems, setPendingItems] = useState<MemoryItem[]>([]);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const departmentIdsRef = useRef<string[]>([]);

  function clearPoll() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearPoll();
    };
  }, []);

  async function fetchCaptures(deptIds: string[]): Promise<BraindumpCapture[]> {
    const lists = await Promise.all(deptIds.map((id) => braindumpApi.listByDepartment(companyId, id)));
    return lists.flat();
  }

  async function fetchPendingItems() {
    try {
      const res = await memoryApi.list(companyId, { status: "pending", layer: "domain" });
      if (mountedRef.current) setPendingItems(res.items);
    } catch {
      // Best-effort — the approve list just stays empty/stale; Continue still works.
    }
  }

  async function pollTick() {
    const deptIds = departmentIdsRef.current;
    if (deptIds.length === 0) return;
    try {
      const next = await fetchCaptures(deptIds);
      if (!mountedRef.current) return;
      setCaptures(next);
      if (next.every((c) => isTerminal(c.status))) {
        clearPoll();
        setOrganizing(false);
        await fetchPendingItems();
      }
    } catch {
      // transient — keep polling
    }
  }

  function startPolling() {
    clearPoll();
    pollRef.current = setInterval(() => void pollTick(), POLL_INTERVAL_MS);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const projects = await projectsApi.list(companyId);
        const deptIds = projects.filter((p) => p.type === "department").map((p) => p.id);
        if (cancelled) return;
        departmentIdsRef.current = deptIds;

        if (deptIds.length === 0) {
          setOrganizing(false);
          await fetchPendingItems();
          return;
        }

        const initial = await fetchCaptures(deptIds);
        if (cancelled) return;
        setCaptures(initial);

        const inFlight = initial.some((c) => !isTerminal(c.status));
        if (!inFlight) {
          setOrganizing(false);
          await fetchPendingItems();
        } else {
          setOrganizing(true);
          startPolling();
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Couldn't load your braindumps.");
          setOrganizing(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per companyId; poll lifecycle is self-managed via refs.
  }, [companyId]);

  async function approve(id: string) {
    setApprovingId(id);
    try {
      await memoryApi.approve(companyId, id);
      if (mountedRef.current) setPendingItems((prev) => prev.filter((i) => i.id !== id));
    } catch {
      // leave the item in the list — the founder can retry the click.
    } finally {
      if (mountedRef.current) setApprovingId(null);
    }
  }

  async function retry(captureId: string) {
    setRetryingId(captureId);
    try {
      const updated = await braindumpApi.retry(companyId, captureId);
      if (!mountedRef.current) return;
      setCaptures((prev) => prev.map((c) => (c.id === captureId ? updated : c)));
      if (!isTerminal(updated.status)) {
        setOrganizing(true);
        startPolling();
      } else {
        await fetchPendingItems();
      }
    } catch {
      // leave the failed state as-is; Retry stays clickable.
    } finally {
      if (mountedRef.current) setRetryingId(null);
    }
  }

  const failedCaptures = captures.filter((c) => c.status === "failed");

  return (
    <StepShell className="max-w-lg">
      <Reveal>
        <StepHeading
          title={
            organizing ? (
              <>
                Organizing your <GradientText>knowledge</GradientText>…
              </>
            ) : (
              <>
                Your domain <GradientText>memory</GradientText> is ready
              </>
            )
          }
          subtitle={
            organizing
              ? "The Librarian is reading through what you shared and proposing memory items."
              : "Review what the Librarian found — approve what looks right."
          }
        />
      </Reveal>

      <Reveal delay={0.09}>
        <div className="flex flex-col items-center gap-3">
          <AgentCharacter state={organizing ? "thinking" : "done"} />
        </div>
      </Reveal>

      {loadError && <p className="text-center text-xs text-destructive">{loadError}</p>}

      {failedCaptures.length > 0 && (
        <div className="flex flex-col gap-2">
          {failedCaptures.map((c) => (
            <Reveal key={c.id} delay={0.14}>
              <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3">
                <p className="text-xs text-destructive">
                  {c.failureReason ?? "This braindump couldn't be organized."}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={retryingId === c.id}
                  onClick={() => void retry(c.id)}
                >
                  {retryingId === c.id ? "Retrying…" : "Retry"}
                </Button>
              </div>
            </Reveal>
          ))}
        </div>
      )}

      {!organizing && !loading && (
        <div className="flex flex-col gap-2">
          {pendingItems.length === 0 && (
            <p className="text-center text-xs text-dim">No proposed memory items yet.</p>
          )}
          {pendingItems.map((item, i) => (
            <Reveal key={item.id} delay={0.09 + i * 0.06}>
              <StepCard>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text">{item.title}</p>
                    <p className="mt-1 text-xs text-dim">{item.content}</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="shrink-0"
                    disabled={approvingId === item.id}
                    onClick={() => void approve(item.id)}
                  >
                    {approvingId === item.id ? "Approving…" : "Approve"}
                  </Button>
                </div>
              </StepCard>
            </Reveal>
          ))}
        </div>
      )}

      <Reveal delay={0.36}>
        <Button className="w-full" onClick={onDone}>
          Continue
        </Button>
      </Reveal>
    </StepShell>
  );
}
