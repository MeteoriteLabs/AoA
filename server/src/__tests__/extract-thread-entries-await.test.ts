// W2 Task 3 — extractThreadEntriesAwait: awaited, targeted extraction helper.
//
// Proves the NEW method on extractionService(db):
//   (a) rows the eligibility SELECT returns are ALL attempted, in order (the
//       real SQL WHERE — status pending/skipped/failed, inputType !==
//       'scope_proposal', zero existing extracted items — is covered by the
//       W2 integration test; a mocked db cannot prove SQL semantics).
//   (b) skipped/failed rows are flipped to 'pending' (extractionRunId cleared)
//       BEFORE their extractOne call; already-'pending' rows get NO flip.
//   (c) serial: extractOne is awaited one-at-a-time, call order == row order.
//   (d) best-effort: one entry rejecting does not stop the rest; the method
//       resolves with counts and never rejects.
//   (e) cap: eligible > MAX_EXTRACT_ENTRIES_PER_SCOPE → only the cap count is
//       attempted, truncated: true.
//   (f) deadline (eng-review D2): injectable clock past EXTRACT_SCOPE_DEADLINE_MS
//       after the first entry → attempted=1, deadlineHit: true.
//   (g) selection failure → resolves with zeros (the method NEVER throws).
//   (h) round-4 P1: the accepted/completed scope-version bound query runs first
//       (the SQL gte(seq, minSeq) itself is integration-covered).
//
// Mock style mirrors crew-dispatch-approval.test.ts: makeTableProxy +
// drizzleOperatorStubs for the schema/operator ESM cycle, a hand-rolled db
// whose select() resolves the eligible rows and whose update(discussion_entries)
// is observable (captured .set() payloads + an ordered event log).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeTableProxy, drizzleOperatorStubs } from "./helpers/drizzle-mock.js";

vi.mock("@armyofagents/db", () => ({
  debriefs: makeTableProxy("debriefs"),
  briefs: makeTableProxy("briefs"),
  briefItems: makeTableProxy("brief_items"),
  projects: makeTableProxy("projects"),
  discussions: makeTableProxy("discussions"),
  discussionEntries: makeTableProxy("discussion_entries"),
  discussionExtractedItems: makeTableProxy("discussion_extracted_items"),
  internalAgentConfig: makeTableProxy("internal_agent_config"),
  threadScopeVersions: makeTableProxy("thread_scope_versions"),
}));
vi.mock("drizzle-orm", () => drizzleOperatorStubs());

vi.mock("../middleware/logger.js", () => ({
  logger: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    warn: vi.fn(),
  },
}));
vi.mock("../services/live-events.js", () => ({
  publishLiveEvent: vi.fn(),
}));
vi.mock("../services/extraction-engine.js", () => ({
  resolveExtractionEngine: vi.fn(async () => "cli"),
  resolveCompanyCliTool: vi.fn(async () => "claude_cli"),
}));
vi.mock("../services/extraction-cli.js", () => {
  class FakeCliExtractionError extends Error {
    readonly kind: string;
    constructor(message: string, kind: string) {
      super(message);
      this.name = "CliExtractionError";
      this.kind = kind;
    }
  }
  return {
    extractViaCli: vi.fn(async () => []),
    CliExtractionError: FakeCliExtractionError,
  };
});
vi.mock("../services/hub-source-producers.js", () => ({
  buildDiscussionPendingHubEmit: vi.fn(),
  emitHubItem: vi.fn(),
}));

import {
  extractionService,
  MAX_EXTRACT_ENTRIES_PER_SCOPE,
  EXTRACT_SCOPE_DEADLINE_MS,
} from "../services/extraction.js";

const COMPANY = "company-1";
const THREAD = "thread-1";

type EntryRow = { id: string; seq: number; extractionStatus: string };

/**
 * Build a mock db for an extractThreadEntriesAwait run.
 *
 * select() resolves `rows` (the eligibility query result — the method issues
 * exactly one SELECT). update(discussion_entries).set(...).where(...) resolves
 * and records: the .set() payload in `updateSets` and a "flip" marker in the
 * shared ordered `events` log (the extractOne test double pushes
 * "extract:<id>" into the same log, so flip-before-extract is assertable).
 */
function makeDb(
  rows: EntryRow[],
  opts: { selectRejects?: boolean; versionRows?: Array<{ sourceEndSeq: number }> } = {},
) {
  const events: string[] = [];
  const updateSets: Array<Record<string, unknown>> = [];

  // The method issues TWO selects, in order: [0] the accepted/completed
  // scope-version bound (round-4 P1 — start after the last scoped seq),
  // [1] the entry eligibility query.
  const selectQueue: unknown[][] = [opts.versionRows ?? [], rows];
  let selectIdx = 0;
  let selectCalls = 0;

  const db = {
    select: () => {
      selectCalls += 1;
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.leftJoin = () => chain;
      chain.where = () => chain;
      chain.orderBy = () => chain;
      chain.limit = () => chain;
      chain.then = (
        resolve: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown,
      ) =>
        (opts.selectRejects
          ? Promise.reject(new Error("select boom"))
          : Promise.resolve(selectQueue[selectIdx++] ?? [])
        ).then(resolve, reject);
      return chain;
    },
    get __selectCalls() {
      return selectCalls;
    },
    update: (table: { _?: { name?: string } }) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          if (table?._?.name === "discussion_entries") {
            updateSets.push(values);
            events.push("flip");
          }
          return Promise.resolve([]);
        },
      }),
    }),
  } as any;

  return { db, events, updateSets };
}

/** extractOne test double that logs "extract:<id>" into the shared event log. */
function makeExtractOne(events: string[]) {
  return vi.fn(async (_companyId: string, entryId: string) => {
    events.push(`extract:${entryId}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("extractionService.extractThreadEntriesAwait", () => {
  it("(a) attempts every row the eligibility select returns, in order", async () => {
    const rows: EntryRow[] = [
      { id: "e1", seq: 1, extractionStatus: "pending" },
      { id: "e2", seq: 2, extractionStatus: "pending" },
      { id: "e3", seq: 3, extractionStatus: "pending" },
    ];
    const { db, events } = makeDb(rows);
    const extractOne = makeExtractOne(events);

    const result = await extractionService(db).extractThreadEntriesAwait(
      COMPANY,
      THREAD,
      { extractOne },
    );

    expect(result).toEqual({ attempted: 3, failed: 0, truncated: false, deadlineHit: false, lastAttemptedSeq: 3 });
    expect(extractOne).toHaveBeenCalledTimes(3);
    expect(extractOne.mock.calls).toEqual([
      [COMPANY, "e1"],
      [COMPANY, "e2"],
      [COMPANY, "e3"],
    ]);
  });

  it("(b) flips skipped/failed rows to pending (runId cleared) BEFORE extractOne; pending rows get no flip", async () => {
    const rows: EntryRow[] = [
      { id: "e1", seq: 1, extractionStatus: "pending" },
      { id: "e2", seq: 2, extractionStatus: "skipped" },
      { id: "e3", seq: 3, extractionStatus: "failed" },
    ];
    const { db, events, updateSets } = makeDb(rows);
    const extractOne = makeExtractOne(events);

    const result = await extractionService(db).extractThreadEntriesAwait(
      COMPANY,
      THREAD,
      { extractOne },
    );

    expect(result).toEqual({ attempted: 3, failed: 0, truncated: false, deadlineHit: false, lastAttemptedSeq: 3 });
    // Exactly two flips (e2 + e3) — the already-pending e1 gets none.
    expect(updateSets).toEqual([
      { extractionStatus: "pending", extractionRunId: null },
      { extractionStatus: "pending", extractionRunId: null },
    ]);
    // Ordering: e1 needs no flip; each non-pending row is flipped before its
    // extraction call (extractFromDiscussionEntry only claims 'pending' rows).
    expect(events).toEqual([
      "extract:e1",
      "flip",
      "extract:e2",
      "flip",
      "extract:e3",
    ]);
  });

  it("(c) serial: extractOne is awaited one at a time, in row order", async () => {
    const rows: EntryRow[] = [
      { id: "e1", seq: 1, extractionStatus: "pending" },
      { id: "e2", seq: 2, extractionStatus: "pending" },
      { id: "e3", seq: 3, extractionStatus: "pending" },
    ];
    const { db } = makeDb(rows);

    let active = 0;
    let maxActive = 0;
    const order: string[] = [];
    const extractOne = vi.fn(async (_companyId: string, entryId: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      // Yield twice so a would-be-concurrent second call could interleave.
      await new Promise((resolve) => setTimeout(resolve, 2));
      order.push(entryId);
      active -= 1;
    });

    const result = await extractionService(db).extractThreadEntriesAwait(
      COMPANY,
      THREAD,
      { extractOne },
    );

    expect(result.attempted).toBe(3);
    expect(maxActive).toBe(1); // never two CLIs in flight
    expect(order).toEqual(["e1", "e2", "e3"]);
  });

  it("(d) best-effort: one entry rejecting does not stop the rest; the method never rejects", async () => {
    const rows: EntryRow[] = [
      { id: "e1", seq: 1, extractionStatus: "pending" },
      { id: "e2", seq: 2, extractionStatus: "pending" },
      { id: "e3", seq: 3, extractionStatus: "pending" },
    ];
    const { db, events } = makeDb(rows);
    const inner = makeExtractOne(events);
    const extractOne = vi.fn(async (companyId: string, entryId: string) => {
      if (entryId === "e2") throw new Error("CLI exploded");
      return inner(companyId, entryId);
    });

    const result = await extractionService(db).extractThreadEntriesAwait(
      COMPANY,
      THREAD,
      { extractOne },
    );

    // e2 was attempted (counter increments before the call) AND counted failed.
    expect(result).toEqual({ attempted: 3, failed: 1, truncated: false, deadlineHit: false, lastAttemptedSeq: 3 });
    expect(extractOne).toHaveBeenCalledTimes(3);
    expect(events).toEqual(["extract:e1", "extract:e3"]);
  });

  it("(e) cap: eligible > MAX_EXTRACT_ENTRIES_PER_SCOPE → only the cap attempted, truncated: true", async () => {
    const rows: EntryRow[] = Array.from(
      { length: MAX_EXTRACT_ENTRIES_PER_SCOPE + 1 },
      (_v, i) => ({ id: `e${i + 1}`, seq: i + 1, extractionStatus: "pending" }),
    );
    const { db, events } = makeDb(rows);
    const extractOne = makeExtractOne(events);

    const result = await extractionService(db).extractThreadEntriesAwait(
      COMPANY,
      THREAD,
      { extractOne },
    );

    expect(result).toEqual({
      attempted: MAX_EXTRACT_ENTRIES_PER_SCOPE,
      failed: 0,
      truncated: true,
      deadlineHit: false,
      // Codex #270 P1: the capped pass reports the highest seq it processed so the
      // draft's sourceEndSeq is capped there and the tail stays in the NEXT range.
      lastAttemptedSeq: MAX_EXTRACT_ENTRIES_PER_SCOPE,
    });
    expect(extractOne).toHaveBeenCalledTimes(MAX_EXTRACT_ENTRIES_PER_SCOPE);
    // The row past the cap is never touched.
    expect(events).not.toContain(`extract:e${MAX_EXTRACT_ENTRIES_PER_SCOPE + 1}`);
  });

  it("(f) deadline (eng-review D2): clock past EXTRACT_SCOPE_DEADLINE_MS after entry 1 → stop, deadlineHit: true", async () => {
    const rows: EntryRow[] = [
      { id: "e1", seq: 1, extractionStatus: "pending" },
      { id: "e2", seq: 2, extractionStatus: "pending" },
      { id: "e3", seq: 3, extractionStatus: "pending" },
    ];
    const { db, events } = makeDb(rows);
    const extractOne = makeExtractOne(events);

    // Scripted clock: startedAt=0; every subsequent read is past the deadline.
    // The FIRST entry still runs (the deadline is only checked once attempted > 0 —
    // the invariant "deadlineHit => lastAttemptedSeq != null" that sourceEndSeq
    // capping relies on), then the pre-entry-2 check trips.
    const now = vi
      .fn<() => number>()
      .mockReturnValueOnce(0)
      .mockReturnValue(EXTRACT_SCOPE_DEADLINE_MS + 1);

    const result = await extractionService(db).extractThreadEntriesAwait(
      COMPANY,
      THREAD,
      { extractOne, now },
    );

    expect(result).toEqual({ attempted: 1, failed: 0, truncated: false, deadlineHit: true, lastAttemptedSeq: 1 });
    expect(extractOne).toHaveBeenCalledTimes(1);
    expect(extractOne).toHaveBeenCalledWith(COMPANY, "e1");
    expect(events).toEqual(["extract:e1"]);
  });

  it("(g) selection failure → resolves with zeros; the method never throws", async () => {
    const { db, events } = makeDb([], { selectRejects: true });
    const extractOne = makeExtractOne(events);

    const result = await extractionService(db).extractThreadEntriesAwait(
      COMPANY,
      THREAD,
      { extractOne },
    );

    expect(result).toEqual({ attempted: 0, failed: 0, truncated: false, deadlineHit: false, lastAttemptedSeq: null });
    expect(extractOne).not.toHaveBeenCalled();
  });

  it("(h) Codex #270 round-4 P1: the scope-version bound query runs BEFORE the entry query and does not disturb processing", async () => {
    // With a mocked db the SQL lower bound itself is integration-covered (Case 4);
    // this pins the two-query shape: [0] accepted/completed scope bound,
    // [1] entries — and that an existing accepted version doesn't break the flow.
    const rows: EntryRow[] = [
      { id: "e4", seq: 4, extractionStatus: "pending" },
      { id: "e5", seq: 5, extractionStatus: "skipped" },
    ];
    const { db, events, updateSets } = makeDb(rows, { versionRows: [{ sourceEndSeq: 3 }] });
    const extractOne = makeExtractOne(events);

    const result = await extractionService(db).extractThreadEntriesAwait(
      COMPANY,
      THREAD,
      { extractOne },
    );

    expect(db.__selectCalls).toBe(2);
    expect(result).toEqual({ attempted: 2, failed: 0, truncated: false, deadlineHit: false, lastAttemptedSeq: 5 });
    expect(updateSets).toHaveLength(1); // only the skipped e5 flips
    expect(events).toEqual(["extract:e4", "flip", "extract:e5"]);
  });
});
