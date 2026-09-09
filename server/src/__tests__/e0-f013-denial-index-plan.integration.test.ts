/**
 * E0-F013 Decision 2, acceptance condition (a), SECOND HALF — the denial-prefix
 * index, proved by PLAN rather than by read-back.
 *
 * ★ WHAT WAS NOT DONE, AND IS DONE HERE. The unit that shipped
 * `GET /api/instance/security-denials` filed the missing index as NOT DONE and
 * measured why: `activity_log` carries indexes on `(company_id, created_at)`,
 * `(run_id)` and `(entity_type, entity_id)` and NOTHING on `action` or on
 * `created_at` alone, so the only production reader of the reserved
 * `security.denied.` namespace planned every page as
 * `Limit <- Sort <- Seq Scan`. Deep paging was therefore O(table) PER PAGE — the
 * cursor made the oldest evidence REACHABLE, but re-read the whole table to
 * reach it. Migration `0275` adds a partial index; this file is what makes the
 * claim that it works an observation instead of an assertion.
 *
 * ★ WHY A PLAN ASSERTION AND NOT A TIMING ONE. A wall-clock threshold on a
 * shared CI runner is a flake generator, and a fast query proves nothing about
 * the plan on a table two orders of magnitude larger. The plan is the durable
 * property: an `Index Scan` feeding a `Limit` is O(page), a `Sort` over a
 * `Seq Scan` is O(table), and the difference does not depend on the machine.
 *
 * ★ WHY IT CANNOT PASS VACUOUSLY. A plan assertion on a 10-row table is
 * meaningless — Postgres seq-scans small tables no matter what indexes exist, so
 * an arm that asserted "no Seq Scan" there would be asserting nothing. So this
 * file seeds enough rows that the choice is real, and then makes the vacuity
 * question empirical: one arm DROPS the index, re-plans the identical query on
 * the identical data, and asserts the plan DEGRADES to the documented
 * `Sort <- Seq Scan`, before restoring it from the definition Postgres itself
 * reports. That arm is the built-in positive control — if the good plan and the
 * bad plan are indistinguishable on this data, that arm fails and the file
 * refuses to certify anything.
 *
 * Real Postgres (embedded-postgres + the committed migration chain), the real
 * migration, and the two queries the reader really emits: the first page, and
 * the keyset page that the `before`/`beforeId` cursor produces.
 *
 * Skipped on Windows CI by default (the `runneradmin` account cannot start
 * embedded-postgres — Issue #114); Linux CI is the authoritative gate. On a
 * Windows dev box set `AOA_RUN_WIN_INTEGRATION=1` to run it for real.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { applyPendingMigrations, createDb, type Db } from "@armyofagents/db";
import { allocateEmbeddedPgPort } from "./helpers/embedded-pg-port.js";

type EmbeddedPostgresInstance = {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
};
type EmbeddedPostgresCtor = new (opts: {
  databaseDir: string;
  user: string;
  password: string;
  port: number;
  persistent: boolean;
  initdbFlags?: string[];
}) => EmbeddedPostgresInstance;

let pg: EmbeddedPostgresInstance | null = null;
let dataDir = "";
let db: Db;
let setupError: unknown = null;
let setupFailed = false;

function assertSetupOk(): void {
  const dbReady = (db as Db | undefined) !== undefined;
  if (!setupFailed && dbReady) return;
  throw new Error(
    `embedded-postgres setup failed (see the console.error above): ${
      setupError instanceof Error ? setupError.message : String(setupError)
    }`,
  );
}

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

const INDEX_NAME = "activity_log_denial_created_idx";

/**
 * The row count is not decoration. Below roughly this size Postgres prefers a
 * sequential scan whatever indexes exist, which would make every assertion in
 * this file vacuously true. The degradation arm proves empirically that this
 * many rows is enough on the machine actually running the suite.
 */
const PRODUCT_ROWS = 40_000;
const DENIAL_ROWS = 400;

/**
 * The reader's FIRST-PAGE query, in the shape `activityService.securityDenials`
 * emits it: the namespace predicate, the total order it pages by, the default
 * page size clamp.
 */
const FIRST_PAGE_SQL = `SELECT * FROM activity_log
  WHERE action LIKE 'security.denied.%'
  ORDER BY created_at DESC, id DESC
  LIMIT 100`;

/** Read a plan back as one string. */
async function planFor(query: string): Promise<string> {
  const res = await db.execute(sql.raw(`EXPLAIN ${query}`));
  return rowsOf<Record<string, string>>(res)
    .map((r) => r["QUERY PLAN"])
    .join("\n");
}

/**
 * The DEEP-PAGE query, built from a real boundary row near the OLDEST evidence.
 * This is the one the NOT-DONE entry was about: the keyset predicate is a
 * row-value comparison, and whether it becomes an `Index Cond` (a seek) or a
 * `Filter` (a scan) is the entire difference between O(page) and O(table).
 */
async function deepPageSql(): Promise<string> {
  const boundary = rowsOf<{ c: string; id: string }>(
    await db.execute(sql`
      SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS c, id
      FROM activity_log
      WHERE action LIKE 'security.denied.%'
      ORDER BY created_at DESC, id DESC
      OFFSET ${sql.raw(String(DENIAL_ROWS - 60))} LIMIT 1`),
  )[0];
  expect(boundary, "could not find a deep boundary row — the denial seed is wrong").toBeTruthy();
  return `SELECT * FROM activity_log
  WHERE action LIKE 'security.denied.%'
    AND (created_at, id) < ('${boundary!.c}'::timestamptz, '${boundary!.id}'::uuid)
  ORDER BY created_at DESC, id DESC
  LIMIT 100`;
}

beforeAll(async () => {
  try {
    dataDir = await mkdtemp(join(tmpdir(), "aoa-e0f013-denial-index-"));
    const port = await allocateEmbeddedPgPort();
    const { default: EmbeddedPostgres } = (await import("embedded-postgres")) as {
      default: EmbeddedPostgresCtor;
    };
    pg = new EmbeddedPostgres({
      databaseDir: join(dataDir, "db"),
      user: "test",
      password: "test",
      port,
      persistent: false,
      initdbFlags: ["--encoding=UTF8", "--locale=C"],
    });
    await pg.initialise();
    await pg.start();
    const connectionString = `postgres://test:test@localhost:${port}/postgres`;
    await applyPendingMigrations(connectionString);
    db = createDb(connectionString);
  } catch (err) {
    setupError = err;
    setupFailed = true;
    // eslint-disable-next-line no-console
    console.error("[e0f013-denial-index] embedded-postgres setup failed:", err);
  }
}, 180_000);

afterAll(async () => {
  try {
    if (pg) await pg.stop();
  } catch {
    /* ignore */
  }
  try {
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}, 60_000);

describe.skipIf(process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1")(
  "E0-F013 (a) — the denial-prefix index changes the plan of the only production denial reader",
  () => {
    it("setup: a realistic activity_log — 40,000 ordinary product rows and 400 denials", async () => {
      assertSetupOk();

      const co = rowsOf<{ id: string }>(
        await db.execute(sql`
          INSERT INTO companies (organization_id, id, name, issue_prefix)
          VALUES ('00000000-0000-0000-0000-000000000001', gen_random_uuid(), 'Plan Co', 'PLN')
          RETURNING id`),
      )[0]!.id;

      await db.execute(sql`
        INSERT INTO activity_log (company_id, actor_type, actor_id, action, entity_type, entity_id, created_at)
        SELECT ${co}, 'user', 'seed-user', 'issue.updated', 'issue', gen_random_uuid()::text,
               now() - (g || ' seconds')::interval
        FROM generate_series(1, ${sql.raw(String(PRODUCT_ROWS))}) AS g`);

      // Half the denials are TENANTLESS, because that is now a shape the table
      // really holds and a partial index must cover it too — the predicate is on
      // `action`, not on `company_id`, and this is what proves it.
      await db.execute(sql`
        INSERT INTO activity_log (company_id, actor_type, actor_id, action, entity_type, entity_id, created_at)
        SELECT CASE WHEN g % 2 = 0 THEN ${co}::uuid ELSE NULL END,
               'system', 'seed-prober', 'security.denied.plan_probe', 'memory_item', gen_random_uuid()::text,
               now() - (g || ' seconds')::interval
        FROM generate_series(1, ${sql.raw(String(DENIAL_ROWS))}) AS g`);

      // The planner chooses on statistics, so this is load bearing, not hygiene.
      await db.execute(sql`ANALYZE activity_log`);

      const counts = rowsOf<{ total: string; denials: string; tenantless: string }>(
        await db.execute(sql`
          SELECT count(*)::text AS total,
                 count(*) FILTER (WHERE action LIKE 'security.denied.%')::text AS denials,
                 count(*) FILTER (WHERE company_id IS NULL)::text AS tenantless
          FROM activity_log`),
      )[0];
      expect(counts?.total).toBe(String(PRODUCT_ROWS + DENIAL_ROWS));
      expect(counts?.denials).toBe(String(DENIAL_ROWS));
      expect(Number(counts?.tenantless)).toBeGreaterThan(0);
    }, 120_000);

    it("migration 0275 created the partial index, with the predicate and the DESC ordering it needs", async () => {
      assertSetupOk();
      const defs = rowsOf<{ indexdef: string }>(
        await db.execute(sql`SELECT indexdef FROM pg_indexes WHERE indexname = ${INDEX_NAME}`),
      );
      expect(defs.length, `${INDEX_NAME} does not exist — migration 0275 did not apply`).toBe(1);
      const def = defs[0]!.indexdef;
      // PARTIAL — it indexes denial rows only, so it costs nothing per product row.
      expect(def, "the index is not partial — it would index every product row").toContain(
        "WHERE (action ~~ 'security.denied.%'::text)",
      );
      // DESC on both keys, matching the reader's total order. Postgres prints
      // `DESC` without `NULLS FIRST` precisely because NULLS FIRST is the default
      // for DESC — which is the whole reason the schema pins `nullsFirst()`.
      expect(def).toContain("created_at DESC");
      expect(def).toContain("id DESC");
      expect(def, "the index emitted NULLS LAST, which does NOT match the reader's ORDER BY").not.toContain(
        "NULLS LAST",
      );
    });

    it("★ THE FIRST PAGE: an ordered index scan feeds the LIMIT — no Seq Scan and no Sort", async () => {
      assertSetupOk();
      const plan = await planFor(FIRST_PAGE_SQL);
      expect(plan, `plan was:\n${plan}`).toContain(`Index Scan using ${INDEX_NAME}`);
      expect(
        plan,
        `the denial reader still sequentially scans activity_log — the index is not being used:\n${plan}`,
      ).not.toContain("Seq Scan on activity_log");
      expect(
        plan,
        `the plan still sorts — the index ordering does not match the reader's ORDER BY, so the scan was narrowed but the O(n log n) was left behind:\n${plan}`,
      ).not.toContain("Sort");
    });

    it("★ THE DEEP PAGE: the keyset cursor becomes an Index Cond (a seek), not a Filter (a scan)", async () => {
      assertSetupOk();
      const plan = await planFor(await deepPageSql());
      expect(plan, `plan was:\n${plan}`).toContain(`Index Scan using ${INDEX_NAME}`);
      // The row-value comparison must be pushed INTO the index as a search
      // condition. As a `Filter` it is evaluated per row after the scan, which is
      // the O(table)-per-page behaviour the NOT-DONE entry described.
      expect(
        plan,
        `the cursor predicate was not pushed into the index — deep paging is still O(table) per page:\n${plan}`,
      ).toContain("Index Cond");
      expect(plan, `plan was:\n${plan}`).not.toContain("Seq Scan on activity_log");
      expect(plan, `plan was:\n${plan}`).not.toContain("Sort");
    });

    /**
     * ★ THE POSITIVE CONTROL, AND THE ONLY REASON THE THREE ARMS ABOVE MEAN
     * ANYTHING. They assert the ABSENCE of `Seq Scan` and `Sort`. An absence
     * assertion is worthless unless the presence is achievable on this data on
     * this machine — if Postgres would never seq-scan here anyway, those arms are
     * green for a reason that has nothing to do with the index.
     *
     * So: drop the index, re-plan the identical query on the identical rows, and
     * require the documented BAD plan to appear. Then restore the index from the
     * definition Postgres itself reports, so the file leaves the database as it
     * found it and arm order cannot matter.
     */
    it("★ POSITIVE CONTROL: without the index the same query on the same rows degrades to Sort over Seq Scan", async () => {
      assertSetupOk();

      const def = rowsOf<{ indexdef: string }>(
        await db.execute(sql`SELECT indexdef FROM pg_indexes WHERE indexname = ${INDEX_NAME}`),
      )[0]?.indexdef;
      expect(def, "the index is already missing — a later arm dropped it and did not restore it").toBeTruthy();

      try {
        await db.execute(sql.raw(`DROP INDEX ${INDEX_NAME}`));
        await db.execute(sql`ANALYZE activity_log`);

        const degraded = await planFor(FIRST_PAGE_SQL);
        expect(
          degraded,
          `dropping the index did NOT produce a sequential scan, so the "no Seq Scan" arms above are vacuous on this data — raise PRODUCT_ROWS until this fails honestly:\n${degraded}`,
        ).toContain("Seq Scan on activity_log");
        expect(
          degraded,
          `dropping the index did NOT reintroduce a Sort, so the "no Sort" arms above are vacuous:\n${degraded}`,
        ).toContain("Sort");
      } finally {
        // Restore from Postgres's own rendering of the shipped definition, not
        // from a literal retyped here — a retyped literal could silently restore
        // a DIFFERENT index and make every later arm test the wrong object.
        await db.execute(sql.raw(def!));
        await db.execute(sql`ANALYZE activity_log`);
      }

      // And the good plan is back, so the restore really restored.
      const restored = await planFor(FIRST_PAGE_SQL);
      expect(restored, `plan after restore:\n${restored}`).toContain(`Index Scan using ${INDEX_NAME}`);
    }, 60_000);

    /**
     * The index must not change WHAT the reader returns, only how it finds it.
     * A partial index whose predicate disagreed with the query's would silently
     * drop rows; asserting the row set is unchanged is cheap and catches that.
     */
    it("the index changes the plan and not the answer: the same rows, in the same order", async () => {
      assertSetupOk();
      const withIndex = rowsOf<{ id: string }>(
        await db.execute(sql`
          SELECT id FROM activity_log
          WHERE action LIKE 'security.denied.%'
          ORDER BY created_at DESC, id DESC LIMIT 100`),
      ).map((r) => r.id);
      expect(withIndex.length).toBe(100);

      await db.execute(sql`SET enable_indexscan = off`);
      await db.execute(sql`SET enable_bitmapscan = off`);
      try {
        const withoutIndex = rowsOf<{ id: string }>(
          await db.execute(sql`
            SELECT id FROM activity_log
            WHERE action LIKE 'security.denied.%'
            ORDER BY created_at DESC, id DESC LIMIT 100`),
        ).map((r) => r.id);
        expect(
          withoutIndex,
          "the indexed and unindexed plans disagree about the answer — the index predicate does not match the query's",
        ).toEqual(withIndex);
      } finally {
        await db.execute(sql`SET enable_indexscan = on`);
        await db.execute(sql`SET enable_bitmapscan = on`);
      }
    });
  },
);
