import { describe, expect, it, vi } from "vitest";
import { runAdjutantSweep } from "../services/internal-agent/aoa-agents/sweep-adjutant.js";
import { triggerMatchesEvent } from "../services/internal-agent/aoa-agents/triggers.js";

describe("P3.3: sweep trigger + adjutant periodic driver", () => {
  describe("triggerMatchesEvent", () => {
    it("matches 'sweep' trigger on sweep.tick event", () => {
      expect(triggerMatchesEvent({ kind: "sweep" }, { type: "sweep.tick" })).toBe(true);
    });

    it("does not match 'sweep' trigger on other events", () => {
      expect(triggerMatchesEvent({ kind: "sweep" }, { type: "thread.phase.changed" })).toBe(false);
      expect(triggerMatchesEvent({ kind: "sweep" }, { type: "thread.mention", targetType: "agent" })).toBe(false);
      expect(triggerMatchesEvent({ kind: "sweep" }, { type: "routine.tick" })).toBe(false);
    });

    it("does not match non-sweep triggers on sweep.tick", () => {
      expect(triggerMatchesEvent({ kind: "mention" }, { type: "sweep.tick" })).toBe(false);
      expect(triggerMatchesEvent({ kind: "phase-advance" }, { type: "sweep.tick" })).toBe(false);
      expect(triggerMatchesEvent({ kind: "routine" }, { type: "sweep.tick" })).toBe(false);
    });
  });

  describe("runAdjutantSweep", () => {
    function makeDb(options: {
      sweepTriggers: any[];
      activeThreads?: any[];
      insertResult?: any[];
      recentWakeups?: any[]; // QA-BUG-011: rows returned by the dedup-window lookup
    }) {
      const valuesMock = vi.fn().mockResolvedValue(options.insertResult ?? [{ id: "w-1" }]);
      const recentRows = options.recentWakeups ?? [];

      // QA-BUG-011: the dedup query chains `.where(...).limit(1)`. activeThreads
      // / trigger queries just await `.where(...)`. We return a thenable from
      // .where() that resolves to the appropriate row set AND exposes `.limit`
      // so the dedup call still resolves. Sequence: 1st where = triggers;
      // subsequent where calls alternate between activeThreads (when awaited
      // directly) and dedup (when `.limit` is chained). To differentiate we
      // track call counts and let the consumer pick the right shape via the
      // chain it picks: awaited-directly → activeThreads, `.limit()` chained
      // → dedup. Both shapes can come from the same thenable because the
      // caller picks exactly one continuation.
      let triggerQueryDone = false;
      let threadQueryToggle = true; // alternates: threads, dedup, threads, dedup, ...
      const whereMock = vi.fn().mockImplementation(() => {
        if (!triggerQueryDone) {
          triggerQueryDone = true;
          return Promise.resolve(options.sweepTriggers);
        }
        // After the trigger query, subsequent where calls are either
        // activeThreads (awaited) or dedup (.limit chained). We return a
        // thenable that resolves to activeThreads, AND attach .limit that
        // resolves to recentWakeups — the consumer picks one.
        const isThread = threadQueryToggle;
        threadQueryToggle = !threadQueryToggle;
        const target = isThread ? (options.activeThreads ?? []) : recentRows;
        const t = Promise.resolve(target);
        // .limit always resolves to recentRows (the dedup result shape)
        return Object.assign(t, {
          limit: vi.fn().mockResolvedValue(recentRows),
        });
      });

      return {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({ where: whereMock }),
            where: whereMock,
          }),
        }),
        insert: vi.fn().mockReturnValue({ values: valuesMock }),
        _valuesMock: valuesMock,
        _whereMock: whereMock,
      };
    }

    it("inserts one wakeup per active thread for sweep trigger", async () => {
      const db = makeDb({
        sweepTriggers: [
          { agentId: "adj-1", companyId: "co-1" },
        ],
        activeThreads: [
          { id: "t-1" },
          { id: "t-2" },
        ],
      });

      await runAdjutantSweep(db as any);

      // Should have called insert twice (once per thread)
      expect(db._valuesMock).toHaveBeenCalledTimes(2);

      const calls = db._valuesMock.mock.calls;
      // First call for thread t-1
      expect(calls[0][0].payload).toEqual({ threadId: "t-1", role: "adjutant" });
      expect(calls[0][0].source).toBe("sweep.adjutant");
      expect(calls[0][0].reason).toBe("adjutant_sweep");

      // Second call for thread t-2
      expect(calls[1][0].payload).toEqual({ threadId: "t-2", role: "adjutant" });
      expect(calls[1][0].source).toBe("sweep.adjutant");
      expect(calls[1][0].reason).toBe("adjutant_sweep");
    });

    it("returns early when no sweep triggers exist", async () => {
      const db = makeDb({
        sweepTriggers: [],
      });

      await runAdjutantSweep(db as any);

      // Should not have called where (only tried the first query for triggers)
      // In this case, select from triggers should return empty array immediately
      expect(db._valuesMock).not.toHaveBeenCalled();
    });

    it("skips insert when no active threads for a company", async () => {
      const db = makeDb({
        sweepTriggers: [
          { agentId: "adj-1", companyId: "co-1" },
        ],
        activeThreads: [],
      });

      await runAdjutantSweep(db as any);

      // Should not have called insert when there are no active threads
      expect(db._valuesMock).not.toHaveBeenCalled();
    });

    it("QA-BUG-011: skips re-queueing when a recent wakeup exists for the same (agent, thread)", async () => {
      // recentWakeups returns a non-empty row → dedup hit → insert MUST be skipped
      const db = makeDb({
        sweepTriggers: [
          { agentId: "adj-1", companyId: "co-1" },
        ],
        activeThreads: [{ id: "t-1" }],
        recentWakeups: [{ id: "previous-wakeup-id" }],
      });

      await runAdjutantSweep(db as any);

      // No insert because the dedup window matched a previous wakeup
      expect(db._valuesMock).not.toHaveBeenCalled();
    });

    it("processes multiple triggers independently", async () => {
      const db = makeDb({
        sweepTriggers: [
          { agentId: "adj-1", companyId: "co-1" },
          { agentId: "adj-2", companyId: "co-2" },
        ],
        activeThreads: [{ id: "t-1" }],
      });

      await runAdjutantSweep(db as any);

      // Should insert twice (once per trigger × one thread per trigger)
      expect(db._valuesMock).toHaveBeenCalledTimes(2);

      const calls = db._valuesMock.mock.calls;
      expect(calls[0][0].agentId).toBe("adj-1");
      expect(calls[0][0].companyId).toBe("co-1");
      expect(calls[1][0].agentId).toBe("adj-2");
      expect(calls[1][0].companyId).toBe("co-2");
    });
  });
});
