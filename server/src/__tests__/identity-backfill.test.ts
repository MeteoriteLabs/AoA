import { describe, expect, it, vi } from "vitest";
import { makeTableProxy, drizzleOperatorStubs } from "./helpers/drizzle-mock.js";

vi.mock("@armyofagents/db", () => ({
  companies: makeTableProxy("companies"),
  memoryItems: makeTableProxy("memory_items"),
}));
vi.mock("drizzle-orm", () => drizzleOperatorStubs());

// enqueueMemoryEmbedding is a best-effort side effect (Decision #104). Stub the
// whole memory-write module so the backfill's insert path is exercised without
// dragging in the embedding-queue table. vi.hoisted keeps the spy accessible to
// the hoisted vi.mock factory.
const { enqueueMemoryEmbedding } = vi.hoisted(() => ({
  enqueueMemoryEmbedding: vi.fn(async () => {}),
}));
vi.mock("../services/memory-write.js", () => ({ enqueueMemoryEmbedding }));

vi.mock("../middleware/logger.js", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import {
  planIdentityBackfill,
  backfillIdentityMemory,
  backfillAllCompaniesIdentityMemory,
  IDENTITY_BACKFILL_MARK,
} from "../services/identity-backfill.js";

const MARK = IDENTITY_BACKFILL_MARK;

// ── Pure planner (field → item mapping + idempotency) ──────────────────────

describe("planIdentityBackfill", () => {
  it("plans one identity item per non-empty company field", () => {
    const plan = planIdentityBackfill(
      { vision: "Be the best", mission: "Ship value", values: "Trust" },
      [],
    );
    expect(plan.map((p) => p.title).sort()).toEqual([
      "Company Mission",
      "Company Values",
      "Company Vision",
    ]);
    expect(plan.every((p) => p.layer === "identity" && p.sourceContext === MARK)).toBe(true);
    // content is the trimmed field value.
    expect(plan.find((p) => p.title === "Company Vision")?.content).toBe("Be the best");
  });

  it("skips empty/whitespace fields", () => {
    const plan = planIdentityBackfill({ vision: "V", mission: "  ", values: null }, []);
    expect(plan).toHaveLength(1);
    expect(plan[0].title).toBe("Company Vision");
  });

  it("is idempotent — skips fields already backfilled (marker + title)", () => {
    const plan = planIdentityBackfill(
      { vision: "V", mission: "M", values: null },
      [{ title: "Company Vision", sourceContext: MARK }],
    );
    expect(plan.map((p) => p.title)).toEqual(["Company Mission"]);
  });

  it("ignores identity items lacking the backfill marker (treats them as unrelated)", () => {
    const plan = planIdentityBackfill(
      { vision: "V", mission: null, values: null },
      [{ title: "Company Vision", sourceContext: null }],
    );
    // A hand-authored 'Company Vision' without the marker does not block the backfill.
    expect(plan.map((p) => p.title)).toEqual(["Company Vision"]);
  });
});

// ── DB-backed backfill (first run inserts, second run inserts nothing) ──────

type Row = Record<string, unknown>;

/**
 * Sequence-mock db: select #0 → company fields, select #1 → existing identity
 * items. insert().values().returning() captures the inserted rows and echoes
 * them back with synthetic ids.
 */
function makeMockDb(opts: { company: Row | null; existing?: Row[] }) {
  const inserts: Row[][] = [];
  let selectCall = 0;
  const thenable = (rows: () => Row[]) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "orderBy", "limit"]) {
      (c as Record<string, () => unknown>)[m] = () => c;
    }
    (c as { then: (r: (rows: Row[]) => unknown) => Promise<unknown> }).then = (resolve) =>
      Promise.resolve(resolve(rows()));
    return c;
  };
  const db = {
    select: () => {
      const idx = selectCall++;
      return thenable(() =>
        idx === 0 ? (opts.company ? [opts.company] : []) : (opts.existing ?? []),
      );
    },
    insert: () => ({
      values: (vals: Row[]) => {
        inserts.push(vals);
        return {
          returning: () =>
            Promise.resolve(
              vals.map((v, i) => ({ id: `mem-${i}`, title: v.title, content: v.content })),
            ),
        };
      },
    }),
  };
  return { db: db as unknown as Parameters<typeof backfillIdentityMemory>[0], inserts };
}

describe("backfillIdentityMemory", () => {
  it("first run inserts one identity item per non-empty field and enqueues embeddings", async () => {
    enqueueMemoryEmbedding.mockClear();
    const { db, inserts } = makeMockDb({
      company: { vision: "V", mission: "M", values: "Val" },
      existing: [],
    });
    const n = await backfillIdentityMemory(db, "co-1");
    expect(n).toBe(3);
    expect(inserts).toHaveLength(1);
    const rows = inserts[0];
    expect(rows.map((r) => r.title).sort()).toEqual([
      "Company Mission",
      "Company Values",
      "Company Vision",
    ]);
    // Every inserted row is an approved, company-scoped identity item with the marker.
    expect(
      rows.every(
        (r) =>
          r.layer === "identity" &&
          r.status === "approved" &&
          r.visibility === "company" &&
          r.companyId === "co-1" &&
          r.sourceContext === MARK,
      ),
    ).toBe(true);
    expect(enqueueMemoryEmbedding).toHaveBeenCalledTimes(3);
  });

  it("second run inserts nothing (all fields already backfilled)", async () => {
    const { db, inserts } = makeMockDb({
      company: { vision: "V", mission: "M", values: "Val" },
      existing: [
        { title: "Company Vision", sourceContext: MARK },
        { title: "Company Mission", sourceContext: MARK },
        { title: "Company Values", sourceContext: MARK },
      ],
    });
    const n = await backfillIdentityMemory(db, "co-1");
    expect(n).toBe(0);
    expect(inserts).toHaveLength(0);
  });

  it("inserts only the missing field on a partial re-run", async () => {
    const { db, inserts } = makeMockDb({
      company: { vision: "V", mission: "M", values: null },
      existing: [{ title: "Company Vision", sourceContext: MARK }],
    });
    const n = await backfillIdentityMemory(db, "co-1");
    expect(n).toBe(1);
    expect(inserts[0].map((r) => r.title)).toEqual(["Company Mission"]);
  });

  it("empty fields insert nothing (never touches memory_items)", async () => {
    const { db, inserts } = makeMockDb({
      company: { vision: null, mission: "   ", values: "" },
    });
    const n = await backfillIdentityMemory(db, "co-1");
    expect(n).toBe(0);
    expect(inserts).toHaveLength(0);
  });

  it("returns 0 for a missing company", async () => {
    const { db, inserts } = makeMockDb({ company: null });
    const n = await backfillIdentityMemory(db, "nope");
    expect(n).toBe(0);
    expect(inserts).toHaveLength(0);
  });
});

// ── All-companies startup loop ─────────────────────────────────────────────

describe("backfillAllCompaniesIdentityMemory", () => {
  it("aggregates inserts across companies and skips empty ones", async () => {
    enqueueMemoryEmbedding.mockClear();
    // select #0 = all companies; then per company with content: select existing, insert.
    const companyRows: Row[] = [
      { id: "co-1", vision: "V1", mission: null, values: null },
      { id: "co-2", vision: null, mission: null, values: null }, // no content → skipped
    ];
    let selectCall = 0;
    const inserts: Row[][] = [];
    const thenable = (rows: () => Row[]) => {
      const c: Record<string, unknown> = {};
      for (const m of ["from", "where", "orderBy", "limit"]) {
        (c as Record<string, () => unknown>)[m] = () => c;
      }
      (c as { then: (r: (rows: Row[]) => unknown) => Promise<unknown> }).then = (resolve) =>
        Promise.resolve(resolve(rows()));
      return c;
    };
    const db = {
      select: () => {
        const idx = selectCall++;
        // idx 0 = companies list; idx 1 = existing identity items for co-1 (only company with content).
        return thenable(() => (idx === 0 ? companyRows : []));
      },
      insert: () => ({
        values: (vals: Row[]) => {
          inserts.push(vals);
          return {
            returning: () =>
              Promise.resolve(vals.map((v, i) => ({ id: `m-${i}`, title: v.title, content: v.content }))),
          };
        },
      }),
    } as unknown as Parameters<typeof backfillAllCompaniesIdentityMemory>[0];

    const res = await backfillAllCompaniesIdentityMemory(db);
    expect(res).toEqual({ companies: 1, items: 1 });
    expect(inserts).toHaveLength(1);
    expect(inserts[0].map((r) => r.title)).toEqual(["Company Vision"]);
  });
});
