import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";

export const E3_PERF_01_DATASET = Object.freeze({
  seed: 3003,
  candidateRows: 1_000_000,
  certificateRows: 1_000_000,
  warmups: 5,
  claimSamples: 30,
  mutationSamples: 20,
  batchSize: 256,
});

export const E3_PERF_01_INITIAL_THRESHOLDS = Object.freeze({
  shapesTwoThreeP95Ms: 250,
  shapesTwoThreeMaxMs: 1_500,
  saturatedP95Ms: 2_000,
  saturatedMaxMs: 5_000,
  bulkUpsertP95Ms: 500,
  cleanupP95Ms: 750,
  combinedTableIndexBytesMax: 2 * 1024 * 1024 * 1024,
});

export const E3_PERF_01_SHAPES = Object.freeze([
  "fully_certified",
  "ten_thousand_workers_by_one_hundred",
  "ninety_percent_stale_version_or_context",
  "cleanup_sparse_then_tail",
] as const);

const enabled = process.env.AOA_RUN_E3_PERF_01 === "1";
let db: Sql | null = null;

function database(): Sql {
  if (!db) throw new Error("E3-PERF-01 database was not initialized");
  return db;
}

function percentile(samples: number[], fraction: number): number {
  const ordered = [...samples].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)] ?? Number.NaN;
}

function emitEvidence(value: Record<string, unknown>): void {
  // The dedicated runner consumes closed NDJSON. Never include connection,
  // environment, path, payload, proof, fence, or credential data here.
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function explainJson(client: Sql, statement: string, parameters: unknown[] = []): Promise<Record<string, unknown>> {
  const rows = await client.unsafe<Array<{ "QUERY PLAN": unknown }>>(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement}`,
    parameters,
  );
  const root = rows[0]?.["QUERY PLAN"];
  if (!Array.isArray(root) || typeof root[0] !== "object" || root[0] === null) {
    throw new Error("E3-PERF-01 returned malformed EXPLAIN JSON");
  }
  return root[0] as Record<string, unknown>;
}

function walkPlan(node: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (!node || typeof node !== "object" || Array.isArray(node)) return;
  const record = node as Record<string, unknown>;
  visit(record);
  const plans = record.Plans;
  if (Array.isArray(plans)) for (const child of plans) walkPlan(child, visit);
  if (record.Plan) walkPlan(record.Plan, visit);
}

function assertHotPlan(plan: Record<string, unknown>, shape: string): void {
  const violations: string[] = [];
  walkPlan(plan, (node) => {
    const nodeType = String(node["Node Type"] ?? "");
    const relation = String(node["Relation Name"] ?? "");
    if (nodeType === "Sort" && node["Sort Method"] === undefined) violations.push("unbounded_sort");
    if (nodeType === "Seq Scan" && ["jobs", "job_attempts", "worker_lease_rejections"].includes(relation)) {
      violations.push(`hot_sequential_scan:${relation}`);
    }
  });
  expect(violations, shape).toEqual([]);
}

beforeAll(async () => {
  if (!enabled) return;
  const url = process.env.AOA_E3_PERF_DATABASE_URL;
  if (!url) throw new Error("AOA_E3_PERF_DATABASE_URL is required for E3-PERF-01");
  db = postgres(url, { max: 4, prepare: false });
  const [posture] = await db<{
    candidates: number;
    certificates: number;
    certificate_table: string | null;
  }[]>`
    SELECT
      (SELECT count(*)::int FROM job_attempts WHERE status = 'pending') AS candidates,
      CASE WHEN to_regclass('public.worker_lease_rejections') IS NULL THEN 0
        ELSE (SELECT count(*)::int FROM worker_lease_rejections) END AS certificates,
      to_regclass('public.worker_lease_rejections')::text AS certificate_table
  `;
  expect(posture).toEqual({
    candidates: E3_PERF_01_DATASET.candidateRows,
    certificates: E3_PERF_01_DATASET.certificateRows,
    certificate_table: "worker_lease_rejections",
  });
}, 30 * 60_000);

afterAll(async () => {
  await db?.end();
}, 60_000);

describe.skipIf(!enabled)("E3-PERF-01 production-capacity static-certificate lane", () => {
  it("pins the immutable INITIAL corpus, samples, thresholds, and four named shapes", () => {
    expect(E3_PERF_01_DATASET).toEqual({
      seed: 3003,
      candidateRows: 1_000_000,
      certificateRows: 1_000_000,
      warmups: 5,
      claimSamples: 30,
      mutationSamples: 20,
      batchSize: 256,
    });
    expect(E3_PERF_01_SHAPES).toEqual([
      "fully_certified",
      "ten_thousand_workers_by_one_hundred",
      "ninety_percent_stale_version_or_context",
      "cleanup_sparse_then_tail",
    ]);
    expect(E3_PERF_01_INITIAL_THRESHOLDS).toEqual({
      shapesTwoThreeP95Ms: 250,
      shapesTwoThreeMaxMs: 1_500,
      saturatedP95Ms: 2_000,
      saturatedMaxMs: 5_000,
      bulkUpsertP95Ms: 500,
      cleanupP95Ms: 750,
      combinedTableIndexBytesMax: 2 * 1024 * 1024 * 1024,
    });
  });

  it.each(E3_PERF_01_SHAPES)("records correct bounded claim plans and samples for %s", async (shape) => {
    const client = database();
    const [fixture] = await client<{
      organization_id: string;
      worker_id: string;
      target_id: string;
      target_authority_key: string;
      static_context_hash: string;
    }[]>`
      SELECT organization_id, worker_id, target_id, target_authority_key, static_context_hash
      FROM e3_perf_01_shape_workers WHERE shape = ${shape} LIMIT 1`;
    expect(fixture).toBeDefined();
    if (!fixture) return;
    const claimSql = `
      SELECT ja.id
      FROM job_attempts ja
      JOIN jobs j ON j.organization_id = ja.organization_id
        AND j.company_id = ja.company_id AND j.id = ja.job_id
      WHERE ja.organization_id = $1 AND ja.status = 'pending'
        AND ja.placement_disposition = 'selected' AND ja.placement_mode = 'active'
        AND ja.placement_lease_eligible = true AND ja.placement_target_id = $2
        AND j.status = 'queued' AND j.available_at <= statement_timestamp()
        AND NOT EXISTS (
          SELECT 1 FROM worker_lease_rejections rejection
          WHERE rejection.organization_id = ja.organization_id
            AND rejection.company_id = ja.company_id
            AND rejection.job_id = ja.job_id AND rejection.attempt_id = ja.id
            AND rejection.worker_id = $3 AND rejection.target_id = $2
            AND rejection.target_authority_key = $4
            AND rejection.eligibility_version = 1
            AND rejection.static_context_hash = $5)
      ORDER BY j.available_at ASC, j.priority DESC, j.created_at ASC, j.id ASC
      LIMIT 256 FOR UPDATE OF ja SKIP LOCKED`;
    const parameters = [
      fixture.organization_id,
      fixture.target_id,
      fixture.worker_id,
      fixture.target_authority_key,
      fixture.static_context_hash,
    ];
    const plan = await client.begin((tx) => explainJson(tx as unknown as Sql, claimSql, parameters));
    assertHotPlan(plan, shape);
    for (let index = 0; index < E3_PERF_01_DATASET.warmups; index += 1) {
      await client.begin((tx) => tx.unsafe(claimSql, parameters));
    }
    const samples: number[] = [];
    for (let index = 0; index < E3_PERF_01_DATASET.claimSamples; index += 1) {
      const start = performance.now();
      const rows = await client.begin((tx) => tx.unsafe<Array<{ id: string }>>(claimSql, parameters));
      samples.push(performance.now() - start);
      expect(rows.length).toBeLessThanOrEqual(256);
    }
    emitEvidence({
      kind: "claim_shape",
      shape,
      samples,
      p95Ms: percentile(samples, 0.95),
      maxMs: Math.max(...samples),
      plan,
    });
  }, 30 * 60_000);

  it("records 20 exact 256-row bulk-certificate upserts without changing authority rows", async () => {
    const client = database();
    const samples: number[] = [];
    for (let index = 0; index < E3_PERF_01_DATASET.mutationSamples; index += 1) {
      const start = performance.now();
      const [result] = await client<{ affected: number }[]>`
        SELECT e3_perf_01_bulk_upsert(${E3_PERF_01_DATASET.batchSize})::int AS affected`;
      samples.push(performance.now() - start);
      expect(result?.affected).toBe(E3_PERF_01_DATASET.batchSize);
    }
    emitEvidence({ kind: "bulk_upsert", samples, p95Ms: percentile(samples, 0.95) });
  }, 10 * 60_000);

  it.each(["sparse", "tail"] as const)("records 20 bounded 256-row %s cleanup samples", async (layout) => {
    const client = database();
    const samples: number[] = [];
    for (let index = 0; index < E3_PERF_01_DATASET.mutationSamples; index += 1) {
      const start = performance.now();
      const [result] = await client<{ affected: number }[]>`
        SELECT e3_perf_01_cleanup(${layout}, ${E3_PERF_01_DATASET.batchSize})::int AS affected`;
      samples.push(performance.now() - start);
      expect(result?.affected).toBeLessThanOrEqual(E3_PERF_01_DATASET.batchSize);
    }
    emitEvidence({ kind: "cleanup", layout, samples, p95Ms: percentile(samples, 0.95) });
  }, 10 * 60_000);

  it("keeps exact corpus size and combined table plus index bytes inside the blocking bound", async () => {
    const client = database();
    const [sizes] = await client<{
      candidate_rows: number;
      certificate_rows: number;
      table_bytes: number;
      index_bytes: number;
    }[]>`
      SELECT
        (SELECT count(*)::int FROM job_attempts WHERE status = 'pending') AS candidate_rows,
        (SELECT count(*)::int FROM worker_lease_rejections) AS certificate_rows,
        pg_relation_size('worker_lease_rejections')::bigint::float8 AS table_bytes,
        pg_indexes_size('worker_lease_rejections')::bigint::float8 AS index_bytes`;
    expect(sizes?.candidate_rows).toBe(E3_PERF_01_DATASET.candidateRows);
    expect(sizes?.certificate_rows).toBe(E3_PERF_01_DATASET.certificateRows);
    expect(Number(sizes?.table_bytes ?? 0) + Number(sizes?.index_bytes ?? 0))
      .toBeLessThanOrEqual(E3_PERF_01_INITIAL_THRESHOLDS.combinedTableIndexBytesMax);
    emitEvidence({ kind: "storage", ...sizes });
  });
});
