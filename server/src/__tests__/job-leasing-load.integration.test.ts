import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { runInTenant } from "../db/tenant-context.js";

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
  "hot_worker_fully_certified_then_head_saturated",
  "ten_thousand_workers_by_one_hundred",
  "ninety_percent_stale_version_or_context",
  "cleanup_sparse_then_tail",
] as const);

export const E3_PERF_01_CLAIM_SCENARIOS = Object.freeze([
  "hot_worker_fully_certified_no_work",
  "hot_worker_head_saturated_999744_prefix",
  "ten_thousand_workers_by_one_hundred",
  "ninety_percent_stale_version_or_context",
] as const);

const E3_PERF_01_ORGANIZATION_ID = "e3000000-0000-4000-8000-000000000001";
const E3_PERF_01_COMPANY_ID = "e3010000-0000-4000-8000-000000000001";
const E3_PERF_01_HOT_TARGET_ID = "e3020000-0000-4000-8000-000000000000";
const E3_PERF_01_HOT_WORKER_ID = "e3030000-0000-4000-8000-000000000000";
const E3_PERF_01_TARGET_AUTHORITY_KEY = `organization:${E3_PERF_01_ORGANIZATION_ID}`;
const E3_PERF_01_PROFILE_HASH = "2".repeat(64);
const E3_PERF_01_PROVIDER_HASH = "3".repeat(64);
const E3_PERF_01_INPUT_DIGEST = "4".repeat(64);
const E3_PERF_01_POLICY_DIGEST = "5".repeat(64);
const E3_PERF_01_STATIC_CONTEXT_HASH = "6".repeat(64);
const E3_PERF_01_SEED_NAMESPACE = `e3-perf-01-${E3_PERF_01_DATASET.seed}`;
const E3_PERF_01_EXPECTED_CLAIM_ROWS = Object.freeze({
  hot_worker_fully_certified_no_work: 0,
  hot_worker_head_saturated_999744_prefix: 256,
  ten_thousand_workers_by_one_hundred: 0,
  ninety_percent_stale_version_or_context: 256,
} satisfies Record<(typeof E3_PERF_01_CLAIM_SCENARIOS)[number], number>);

const enabled = process.env.AOA_RUN_E3_PERF_01 === "1";
let db: Sql | null = null;
let seedSql: Sql | null = null;
let tenantSql: Sql | null = null;
let tenantDb: ReturnType<typeof drizzle> | null = null;
const capturedQueries: Array<{ sql: string; parameters: unknown[] }> = [];

type ClaimContext = {
  organizationId: string;
  workerId: string;
  targetId: string;
  targetAuthorityKey: string;
  targetOwner: string;
  targetClass: string;
  targetScope: string;
  targetGeneration: number;
  targetProfileHash: string;
  targetProviderConstraintHash: string;
  admissibleWorkloadTypes: string[];
  eligibilityVersion: number;
  staticContextHash: string;
  limit: 256;
};

function database(): Sql {
  if (!db) throw new Error("E3-PERF-01 database was not initialized");
  return db;
}

function seedDatabase(): Sql {
  if (!seedSql) throw new Error("E3-PERF-01 seed database was not initialized");
  return seedSql;
}

function tenantDatabase(): ReturnType<typeof drizzle> {
  if (!tenantDb) throw new Error("E3-PERF-01 tenant database was not initialized");
  return tenantDb;
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

function normalizedQuerySha256(statement: string): string {
  return createHash("sha256")
    .update(statement.replace(/\s+/g, " ").trim())
    .digest("hex");
}

function latestProductionClaimQuery(): { sql: string; parameters: unknown[] } | null {
  return [...capturedQueries].reverse().find((query) =>
    /worker_lease_rejections/i.test(query.sql) && /FOR\s+UPDATE/i.test(query.sql)) ?? null;
}

async function callProductionClaim(input: ClaimContext): Promise<{
  rows: Array<{ job: { id: string }; attempt: { id: string } }>;
  query: { sql: string; parameters: unknown[] };
  querySha256: string;
}> {
  capturedQueries.length = 0;
  const rows = await runInTenant(tenantDatabase() as never, input.organizationId, async (repos) => {
    const operation = repos.jobControl.lockEligibleLeaseCandidates as unknown as (
      context: Omit<ClaimContext, "organizationId">,
    ) => Promise<Array<{ job: { id: string }; attempt: { id: string } }>>;
    return operation({
      workerId: input.workerId,
      targetId: input.targetId,
      targetAuthorityKey: input.targetAuthorityKey,
      targetOwner: input.targetOwner,
      targetClass: input.targetClass,
      targetScope: input.targetScope,
      targetGeneration: input.targetGeneration,
      targetProfileHash: input.targetProfileHash,
      targetProviderConstraintHash: input.targetProviderConstraintHash,
      admissibleWorkloadTypes: input.admissibleWorkloadTypes,
      eligibilityVersion: input.eligibilityVersion,
      staticContextHash: input.staticContextHash,
      limit: 256,
    });
  });
  const query = latestProductionClaimQuery();
  expect.soft(query, "real tenant repository claim query must include the certificate anti-join").not.toBeNull();
  if (!query) throw new Error("production claim query was not captured");
  return { rows, query, querySha256: normalizedQuerySha256(query.sql) };
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

const REQUIRED_PLAN_INDEXES = [
  "jobs_claim_idx",
  "job_attempts_lease_candidate_idx",
  "worker_lease_rejections_pkey",
] as const;

function assertHotPlan(plan: Record<string, unknown>, shape: string): {
  indexes: string[];
  actualRows: number;
  rowsRemoved: number;
  heapFetches: number;
  sharedBlocks: number;
  localBlocks: number;
  tempBlocks: number;
} {
  const violations: string[] = [];
  const indexes = new Set<string>();
  const summary = { actualRows: 0, rowsRemoved: 0, heapFetches: 0, sharedBlocks: 0, localBlocks: 0, tempBlocks: 0 };
  const numeric = (node: Record<string, unknown>, key: string): number => {
    const value = Number(node[key] ?? 0);
    if (!Number.isFinite(value) || value < 0) violations.push(`invalid_plan_fact:${key}`);
    return value;
  };
  walkPlan(plan, (node) => {
    const nodeType = String(node["Node Type"] ?? "");
    const relation = String(node["Relation Name"] ?? "");
    const index = String(node["Index Name"] ?? "");
    if (index) indexes.add(index);
    const actualRows = numeric(node, "Actual Rows");
    summary.actualRows += actualRows;
    summary.rowsRemoved += numeric(node, "Rows Removed by Filter") + numeric(node, "Rows Removed by Index Recheck");
    summary.heapFetches += numeric(node, "Heap Fetches");
    summary.sharedBlocks += numeric(node, "Shared Hit Blocks") + numeric(node, "Shared Read Blocks") +
      numeric(node, "Shared Dirtied Blocks") + numeric(node, "Shared Written Blocks");
    summary.localBlocks += numeric(node, "Local Hit Blocks") + numeric(node, "Local Read Blocks") +
      numeric(node, "Local Dirtied Blocks") + numeric(node, "Local Written Blocks");
    summary.tempBlocks += numeric(node, "Temp Read Blocks") + numeric(node, "Temp Written Blocks");
    if (nodeType === "Sort" && (
      node["Sort Method"] !== "top-N heapsort" || actualRows > 256 ||
      numeric(node, "Temp Read Blocks") !== 0 || numeric(node, "Temp Written Blocks") !== 0
    )) violations.push("unbounded_or_spilled_sort");
    if ((nodeType === "Seq Scan" || nodeType === "Parallel Seq Scan") &&
        ["jobs", "job_attempts", "worker_lease_rejections"].includes(relation)) {
      violations.push(`hot_sequential_scan:${relation}`);
    }
  });
  for (const required of REQUIRED_PLAN_INDEXES) {
    if (!indexes.has(required)) violations.push(`missing_required_index:${required}`);
  }
  expect(violations, shape).toEqual([]);
  return { indexes: [...indexes].sort(), ...summary };
}

function assertCleanupPlan(plan: Record<string, unknown>, layout: string, affectedRows = 256): {
  indexes: string[];
  actualRows: number;
  rowsRemoved: number;
  tempBlocks: number;
  rootActualRows: number;
  candidateRows: number;
  affectedRows: number;
} {
  const violations: string[] = [];
  const indexes = new Set<string>();
  const summary = { actualRows: 0, rowsRemoved: 0, tempBlocks: 0 };
  let candidateRows = 0;
  const numeric = (node: Record<string, unknown>, key: string): number => {
    const value = Number(node[key] ?? 0);
    if (!Number.isFinite(value) || value < 0) violations.push(`invalid_plan_fact:${key}`);
    return value;
  };
  walkPlan(plan, (node) => {
    const nodeType = String(node["Node Type"] ?? "");
    const relation = String(node["Relation Name"] ?? "");
    const index = String(node["Index Name"] ?? "");
    if (index) indexes.add(index);
    const actualRows = numeric(node, "Actual Rows");
    if (relation === "worker_lease_rejections" || nodeType === "Limit") {
      candidateRows = Math.max(candidateRows, actualRows);
    }
    const tempBlocks = numeric(node, "Temp Read Blocks") + numeric(node, "Temp Written Blocks");
    summary.actualRows += actualRows;
    summary.rowsRemoved += numeric(node, "Rows Removed by Filter") + numeric(node, "Rows Removed by Index Recheck");
    summary.tempBlocks += tempBlocks;
    if (nodeType === "Sort" && (
      node["Sort Method"] !== "top-N heapsort" || actualRows > 256 || tempBlocks !== 0
    )) violations.push("unbounded_or_spilled_sort");
    if ((nodeType === "Seq Scan" || nodeType === "Parallel Seq Scan") &&
        relation === "worker_lease_rejections") {
      violations.push("hot_sequential_scan:worker_lease_rejections");
    }
  });
  if (!indexes.has("worker_lease_rejections_cleanup_idx")) {
    violations.push("missing_required_index:worker_lease_rejections_cleanup_idx");
  }
  const root = plan.Plan && typeof plan.Plan === "object" && !Array.isArray(plan.Plan)
    ? plan.Plan as Record<string, unknown>
    : plan;
  if (!Object.hasOwn(root, "Actual Rows")) violations.push("missing_root_actual_rows");
  const rootActualRows = numeric(root, "Actual Rows");
  if (affectedRows !== 256) violations.push(`wrong_affected_rows:${affectedRows}`);
  if (rootActualRows !== 256) violations.push(`wrong_root_actual_rows:${rootActualRows}`);
  if (candidateRows !== 256) violations.push(`wrong_candidate_rows:${candidateRows}`);
  expect(violations, `cleanup:${layout}`).toEqual([]);
  return { indexes: [...indexes].sort(), ...summary, rootActualRows, candidateRows, affectedRows };
}

function deterministicUuidSql(namespace: string, ordinalSql: string): string {
  return `md5('${namespace}:' || (${ordinalSql})::text)::uuid`;
}

async function seedE3Perf01Corpus(client: Sql): Promise<void> {
  const jobIdSql = deterministicUuidSql(`${E3_PERF_01_SEED_NAMESPACE}-job`, "ordinal");
  const attemptIdSql = deterministicUuidSql(`${E3_PERF_01_SEED_NAMESPACE}-attempt`, "ordinal");
  const targetIdSql = deterministicUuidSql(`${E3_PERF_01_SEED_NAMESPACE}-target`, "ordinal");
  const workerIdSql = deterministicUuidSql(`${E3_PERF_01_SEED_NAMESPACE}-worker`, "ordinal");
  await client.begin(async (tx) => {
    const query = tx as unknown as Sql;
    await query`SELECT set_config('aoa.organization_id', ${E3_PERF_01_ORGANIZATION_ID}, true)`;
    await query`DELETE FROM jobs WHERE source_kind = 'e3_perf_01'`;
    await query`DELETE FROM workers WHERE label LIKE 'E3-PERF-01 worker %'`;
    await query`DELETE FROM execution_targets WHERE slug LIKE 'e3-perf-01-target-%'`;
    await query`INSERT INTO organizations (id, name, slug, status)
      VALUES (${E3_PERF_01_ORGANIZATION_ID}, 'E3-PERF-01 Organization', 'e3-perf-01', 'active')
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`;
    await query`INSERT INTO companies (id, organization_id, name, issue_prefix, status)
      VALUES (${E3_PERF_01_COMPANY_ID}, ${E3_PERF_01_ORGANIZATION_ID}, 'E3-PERF-01 Company', 'E3P', 'active')
      ON CONFLICT (id) DO UPDATE SET organization_id = EXCLUDED.organization_id, status = EXCLUDED.status`;
    await query`INSERT INTO execution_targets
      (id, organization_id, slug, kind, trust_class, status, scope, target_authority_key,
       device_generation, last_seen_at)
      VALUES (${E3_PERF_01_HOT_TARGET_ID}, ${E3_PERF_01_ORGANIZATION_ID},
        'e3-perf-01-target-0', 'dedicated_worker', 'dedicated_tenant', 'active', 'organization',
        ${E3_PERF_01_TARGET_AUTHORITY_KEY}, 1, clock_timestamp())`;
    await query.unsafe(`INSERT INTO execution_targets
      (id, organization_id, slug, kind, trust_class, status, scope, target_authority_key,
       device_generation, last_seen_at)
      SELECT ${targetIdSql}, '${E3_PERF_01_ORGANIZATION_ID}'::uuid,
        'e3-perf-01-target-' || ordinal, 'dedicated_worker', 'dedicated_tenant', 'active',
        'organization', '${E3_PERF_01_TARGET_AUTHORITY_KEY}', 1, clock_timestamp()
      FROM generate_series(1, 10000) AS seed(ordinal)`);
    await query`INSERT INTO workers
      (id, scope, organization_id, execution_target_id, target_authority_key, device_public_key,
       device_thumbprint, device_generation, profile_hash, enrolled_at, last_seen_at, label, status)
      VALUES (${E3_PERF_01_HOT_WORKER_ID}, 'organization', ${E3_PERF_01_ORGANIZATION_ID},
        ${E3_PERF_01_HOT_TARGET_ID}, ${E3_PERF_01_TARGET_AUTHORITY_KEY}, 'e3-perf-01-key-0',
        ${"7".repeat(64)}, 1, ${E3_PERF_01_PROFILE_HASH}, clock_timestamp(), clock_timestamp(),
        'E3-PERF-01 worker 0', 'active')`;
    await query.unsafe(`INSERT INTO workers
      (id, scope, organization_id, execution_target_id, target_authority_key, device_public_key,
       device_thumbprint, device_generation, profile_hash, enrolled_at, last_seen_at, label, status)
      SELECT ${workerIdSql}, 'organization', '${E3_PERF_01_ORGANIZATION_ID}'::uuid,
        ${targetIdSql}, '${E3_PERF_01_TARGET_AUTHORITY_KEY}', 'e3-perf-01-key-' || ordinal,
        md5('e3-perf-01-thumb:' || ordinal) || md5('e3-perf-01-thumb:' || ordinal || ':2'), 1,
        '${E3_PERF_01_PROFILE_HASH}', clock_timestamp(), clock_timestamp(),
        'E3-PERF-01 worker ' || ordinal, 'active'
      FROM generate_series(1, 10000) AS seed(ordinal)`);
    await query.unsafe(`INSERT INTO jobs
      (id, organization_id, company_id, workload_type, idempotency_key, command_digest,
       source_kind, source_identity, priority, available_at, status, created_at, updated_at)
      SELECT ${jobIdSql}, '${E3_PERF_01_ORGANIZATION_ID}'::uuid,
        '${E3_PERF_01_COMPANY_ID}'::uuid, 'batch', 'e3-perf-01-' || ordinal,
        md5('e3-perf-01-command:' || ordinal) || md5('e3-perf-01-command:' || ordinal || ':2'),
        'e3_perf_01', ordinal::text, 0,
        TIMESTAMPTZ '2026-08-01 00:00:00+00' + ordinal * INTERVAL '1 microsecond', 'queued',
        TIMESTAMPTZ '2026-08-01 00:00:00+00' + ordinal * INTERVAL '1 microsecond',
        TIMESTAMPTZ '2026-08-01 00:00:00+00' + ordinal * INTERVAL '1 microsecond'
      FROM generate_series(1, 1000000) AS seed(ordinal)`);
    await query.unsafe(`INSERT INTO job_attempts
      (id, organization_id, company_id, job_id, attempt_number, status,
       placement_disposition, placement_owner, placement_target_id, placement_target_class,
       placement_target_scope, placement_target_generation, placement_profile_hash,
       placement_provider_constraint_hash, placement_fallback_disposition, placement_reason_code,
       placement_mode, placement_lease_eligible, placement_input_digest, placement_policy_digest,
       placement_decided_at, created_at, updated_at)
      SELECT ${attemptIdSql}, '${E3_PERF_01_ORGANIZATION_ID}'::uuid,
        '${E3_PERF_01_COMPANY_ID}'::uuid, ${jobIdSql}, 1, 'pending', 'selected',
        'organization_dedicated', '${E3_PERF_01_HOT_TARGET_ID}'::uuid,
        'organization_dedicated', 'organization', 1, '${E3_PERF_01_PROFILE_HASH}',
        '${E3_PERF_01_PROVIDER_HASH}', 'primary', 'target_selected', 'active', true,
        '${E3_PERF_01_INPUT_DIGEST}', '${E3_PERF_01_POLICY_DIGEST}',
        TIMESTAMPTZ '2026-08-01 00:00:00+00',
        TIMESTAMPTZ '2026-08-01 00:00:00+00' + ordinal * INTERVAL '1 microsecond',
        TIMESTAMPTZ '2026-08-01 00:00:00+00' + ordinal * INTERVAL '1 microsecond'
      FROM generate_series(1, 1000000) AS seed(ordinal)`);
    await query.unsafe(`INSERT INTO worker_lease_rejections
      (organization_id, company_id, job_id, attempt_id, worker_id, target_id,
       target_authority_key, eligibility_version, static_context_hash, workload_type,
       placement_owner, placement_target_class, placement_target_scope,
       placement_target_generation, placement_profile_hash, placement_provider_constraint_hash,
       placement_input_digest, placement_policy_digest, reason_code, created_at, updated_at)
      SELECT '${E3_PERF_01_ORGANIZATION_ID}'::uuid, '${E3_PERF_01_COMPANY_ID}'::uuid,
        ${jobIdSql}, ${attemptIdSql}, '${E3_PERF_01_HOT_WORKER_ID}'::uuid,
        '${E3_PERF_01_HOT_TARGET_ID}'::uuid, '${E3_PERF_01_TARGET_AUTHORITY_KEY}', 1,
        '${E3_PERF_01_STATIC_CONTEXT_HASH}', 'batch', 'organization_dedicated',
        'organization_dedicated', 'organization', 1, '${E3_PERF_01_PROFILE_HASH}',
        '${E3_PERF_01_PROVIDER_HASH}', '${E3_PERF_01_INPUT_DIGEST}',
        '${E3_PERF_01_POLICY_DIGEST}', 'static_requirements_mismatch',
        TIMESTAMPTZ '2026-08-01 00:00:00+00' + ordinal * INTERVAL '1 microsecond',
        TIMESTAMPTZ '2026-08-01 00:00:00+00' + ordinal * INTERVAL '1 microsecond'
      FROM generate_series(1, 1000000) AS seed(ordinal)`);
    await query.unsafe("ANALYZE jobs, job_attempts, workers, execution_targets, worker_lease_rejections");
  });
}

async function prepareE3Perf01ClaimScenario(
  client: Sql,
  scenario: (typeof E3_PERF_01_CLAIM_SCENARIOS)[number],
): Promise<void> {
  const jobIdSql = deterministicUuidSql(`${E3_PERF_01_SEED_NAMESPACE}-job`, "j.source_identity::integer");
  const attemptIdSql = deterministicUuidSql(`${E3_PERF_01_SEED_NAMESPACE}-attempt`, "j.source_identity::integer");
  const targetIdSql = deterministicUuidSql(
    `${E3_PERF_01_SEED_NAMESPACE}-target`,
    "(((j.source_identity::integer - 1) / 100) + 1)",
  );
  await client.begin(async (tx) => {
    const query = tx as unknown as Sql;
    await query`SELECT set_config('aoa.organization_id', ${E3_PERF_01_ORGANIZATION_ID}, true)`;
    await query`DELETE FROM worker_lease_rejections`;
    await query`UPDATE jobs SET status = 'queued'
      WHERE source_kind = 'e3_perf_01'`;

    if (scenario === "ten_thousand_workers_by_one_hundred") {
      await query.unsafe(`UPDATE job_attempts AS ja SET
        status = 'pending', placement_target_id = ${targetIdSql}, updated_at = clock_timestamp()
        FROM jobs AS j
        WHERE j.organization_id = ja.organization_id AND j.company_id = ja.company_id
          AND j.id = ja.job_id AND j.source_kind = 'e3_perf_01'`);
      await query.unsafe(`INSERT INTO worker_lease_rejections
        (organization_id, company_id, job_id, attempt_id, worker_id, target_id,
         target_authority_key, eligibility_version, static_context_hash, workload_type,
         placement_owner, placement_target_class, placement_target_scope,
         placement_target_generation, placement_profile_hash, placement_provider_constraint_hash,
         placement_input_digest, placement_policy_digest, reason_code, created_at, updated_at)
        SELECT j.organization_id, j.company_id, ${jobIdSql}, ${attemptIdSql}, w.id,
          ${targetIdSql}, '${E3_PERF_01_TARGET_AUTHORITY_KEY}', 1,
          '${E3_PERF_01_STATIC_CONTEXT_HASH}', 'batch', 'organization_dedicated',
          'organization_dedicated', 'organization', 1, '${E3_PERF_01_PROFILE_HASH}',
          '${E3_PERF_01_PROVIDER_HASH}', '${E3_PERF_01_INPUT_DIGEST}',
          '${E3_PERF_01_POLICY_DIGEST}', 'static_requirements_mismatch',
          TIMESTAMPTZ '2026-08-01 00:00:00+00' + j.source_identity::integer * INTERVAL '1 microsecond',
          TIMESTAMPTZ '2026-08-01 00:00:00+00' + j.source_identity::integer * INTERVAL '1 microsecond'
        FROM jobs AS j
        JOIN workers AS w ON w.organization_id = j.organization_id
          AND w.execution_target_id = ${targetIdSql}
        WHERE j.source_kind = 'e3_perf_01'`);
      return;
    }

    await query`UPDATE job_attempts AS ja SET status = 'pending',
      placement_target_id = ${E3_PERF_01_HOT_TARGET_ID}, updated_at = clock_timestamp()
      FROM jobs AS j
      WHERE j.organization_id = ja.organization_id AND j.company_id = ja.company_id
        AND j.id = ja.job_id AND j.source_kind = 'e3_perf_01'`;
    await query.unsafe(`INSERT INTO worker_lease_rejections
      (organization_id, company_id, job_id, attempt_id, worker_id, target_id,
       target_authority_key, eligibility_version, static_context_hash, workload_type,
       placement_owner, placement_target_class, placement_target_scope,
       placement_target_generation, placement_profile_hash, placement_provider_constraint_hash,
       placement_input_digest, placement_policy_digest, reason_code, created_at, updated_at)
      SELECT j.organization_id, j.company_id, ${jobIdSql}, ${attemptIdSql},
        '${E3_PERF_01_HOT_WORKER_ID}'::uuid, '${E3_PERF_01_HOT_TARGET_ID}'::uuid,
        '${E3_PERF_01_TARGET_AUTHORITY_KEY}',
        CASE WHEN '${scenario}' = 'ninety_percent_stale_version_or_context'
          AND j.source_identity::integer <= 450000 THEN 0 ELSE 1 END,
        CASE WHEN '${scenario}' = 'ninety_percent_stale_version_or_context'
          AND j.source_identity::integer BETWEEN 450001 AND 900000 THEN '${"8".repeat(64)}'
          ELSE '${E3_PERF_01_STATIC_CONTEXT_HASH}' END,
        'batch', 'organization_dedicated', 'organization_dedicated', 'organization', 1,
        '${E3_PERF_01_PROFILE_HASH}', '${E3_PERF_01_PROVIDER_HASH}',
        '${E3_PERF_01_INPUT_DIGEST}', '${E3_PERF_01_POLICY_DIGEST}',
        'static_requirements_mismatch',
        TIMESTAMPTZ '2026-08-01 00:00:00+00' + j.source_identity::integer * INTERVAL '1 microsecond',
        TIMESTAMPTZ '2026-08-01 00:00:00+00' + j.source_identity::integer * INTERVAL '1 microsecond'
      FROM jobs AS j WHERE j.source_kind = 'e3_perf_01'`);
    if (scenario === "hot_worker_head_saturated_999744_prefix") {
      await query`DELETE FROM worker_lease_rejections AS rejection
        USING jobs AS j
        WHERE j.organization_id = rejection.organization_id
          AND j.company_id = rejection.company_id AND j.id = rejection.job_id
          AND j.source_kind = 'e3_perf_01' AND j.source_identity::integer > 999744`;
    }
  });
  await seedDatabase().unsafe("ANALYZE jobs, job_attempts, worker_lease_rejections");
}

async function directClaimFixture(
  client: Sql,
  scenario: (typeof E3_PERF_01_CLAIM_SCENARIOS)[number],
): Promise<ClaimContext> {
  const workerLabel = scenario === "ten_thousand_workers_by_one_hundred"
    ? "E3-PERF-01 worker 1"
    : "E3-PERF-01 worker 0";
  const [fixture] = await client<{
    worker_id: string;
    target_id: string;
    target_authority_key: string;
    target_generation: number;
  }[]>`
    SELECT w.id AS worker_id, t.id AS target_id, w.target_authority_key,
      t.device_generation AS target_generation
    FROM workers AS w
    JOIN execution_targets AS t ON t.id = w.execution_target_id
      AND t.target_authority_key = w.target_authority_key
    WHERE w.organization_id = ${E3_PERF_01_ORGANIZATION_ID} AND w.label = ${workerLabel}`;
  expect.soft(fixture, `seeded worker for ${scenario}`).toBeDefined();
  if (!fixture) throw new Error(`E3-PERF-01 fixture missing for ${scenario}`);
  return {
    organizationId: E3_PERF_01_ORGANIZATION_ID,
    workerId: fixture.worker_id,
    targetId: fixture.target_id,
    targetAuthorityKey: fixture.target_authority_key,
    targetOwner: "organization_dedicated",
    targetClass: "organization_dedicated",
    targetScope: "organization",
    targetGeneration: fixture.target_generation,
    targetProfileHash: E3_PERF_01_PROFILE_HASH,
    targetProviderConstraintHash: E3_PERF_01_PROVIDER_HASH,
    admissibleWorkloadTypes: ["batch"],
    eligibilityVersion: 1,
    staticContextHash: E3_PERF_01_STATIC_CONTEXT_HASH,
    limit: 256,
  };
}

async function assertCanonicalClaimShape(
  client: Sql,
  scenario: (typeof E3_PERF_01_CLAIM_SCENARIOS)[number],
): Promise<string[]> {
  const [counts] = await client<{
    candidates: number;
    certificates: number;
    current_certificates: number;
    stale_certificates: number;
  }[]>`
    SELECT
      count(*)::int AS candidates,
      count(rejection.attempt_id)::int AS certificates,
      count(rejection.attempt_id) FILTER (WHERE rejection.eligibility_version = 1
        AND rejection.static_context_hash = ${E3_PERF_01_STATIC_CONTEXT_HASH})::int AS current_certificates,
      count(rejection.attempt_id) FILTER (WHERE rejection.eligibility_version <> 1
        OR rejection.static_context_hash <> ${E3_PERF_01_STATIC_CONTEXT_HASH})::int AS stale_certificates
    FROM job_attempts AS attempt
    JOIN jobs AS job ON job.organization_id = attempt.organization_id
      AND job.company_id = attempt.company_id AND job.id = attempt.job_id
    LEFT JOIN worker_lease_rejections AS rejection
      ON rejection.organization_id = attempt.organization_id
      AND rejection.company_id = attempt.company_id AND rejection.job_id = attempt.job_id
      AND rejection.attempt_id = attempt.id
    WHERE job.source_kind = 'e3_perf_01'`;
  expect.soft(counts?.candidates, scenario).toBe(1_000_000);

  if (scenario === "hot_worker_fully_certified_no_work") {
    expect.soft(counts).toMatchObject({ certificates: 1_000_000, current_certificates: 1_000_000, stale_certificates: 0 });
  } else if (scenario === "hot_worker_head_saturated_999744_prefix") {
    expect.soft(counts).toMatchObject({ certificates: 999_744, current_certificates: 999_744, stale_certificates: 0 });
  } else if (scenario === "ten_thousand_workers_by_one_hundred") {
    const [distribution] = await client<{ workers: number; total_rows: number; min_rows: number; max_rows: number }[]>`
      SELECT count(*)::int AS workers, sum(rows_per_worker)::int AS total_rows,
        min(rows_per_worker)::int AS min_rows, max(rows_per_worker)::int AS max_rows
      FROM (
        SELECT worker.id, count(*)::int AS rows_per_worker
        FROM workers AS worker
        JOIN job_attempts AS attempt ON attempt.organization_id = worker.organization_id
          AND attempt.placement_target_id = worker.execution_target_id
        JOIN jobs AS job ON job.organization_id = attempt.organization_id
          AND job.company_id = attempt.company_id AND job.id = attempt.job_id
        WHERE job.source_kind = 'e3_perf_01' AND worker.label LIKE 'E3-PERF-01 worker %'
          AND worker.label <> 'E3-PERF-01 worker 0'
        GROUP BY worker.id
      ) AS worker_rows`;
    expect.soft(distribution).toEqual({ workers: 10_000, total_rows: 1_000_000, min_rows: 100, max_rows: 100 });
    expect.soft(counts).toMatchObject({ certificates: 1_000_000, current_certificates: 1_000_000, stale_certificates: 0 });
  } else {
    expect.soft(counts?.certificates).toBe(1_000_000);
    expect.soft(counts?.stale_certificates).toBeGreaterThanOrEqual(900_000);
    expect.soft(counts?.current_certificates).toBeLessThanOrEqual(100_000);
  }

  const expectedOrdinals = scenario === "hot_worker_head_saturated_999744_prefix"
    ? Array.from({ length: 256 }, (_, index) => 999_745 + index)
    : scenario === "ninety_percent_stale_version_or_context"
      ? Array.from({ length: 256 }, (_, index) => index + 1)
      : [];
  const expectedRows = expectedOrdinals.length === 0 ? [] : await client<{ ordinal: number; attempt_id: string }[]>`
    SELECT job.source_identity::int AS ordinal, attempt.id AS attempt_id
    FROM jobs AS job
    JOIN job_attempts AS attempt ON attempt.organization_id = job.organization_id
      AND attempt.company_id = job.company_id AND attempt.job_id = job.id
    WHERE job.source_kind = 'e3_perf_01'
      AND job.source_identity::int = ANY(${expectedOrdinals}::int[])
    ORDER BY job.available_at ASC, job.priority DESC, job.created_at ASC, job.id ASC`;
  expect.soft(expectedRows.map((row) => row.ordinal), `${scenario}:canonical-order`).toEqual(expectedOrdinals);
  return expectedRows.map((row) => row.attempt_id);
}

async function prepareAndAssertCleanupLayout(client: Sql, layout: "sparse" | "tail"): Promise<void> {
  await prepareE3Perf01ClaimScenario(client, "hot_worker_fully_certified_no_work");
  await client.begin(async (tx) => {
    const query = tx as unknown as Sql;
    await query`SELECT set_config('aoa.organization_id', ${E3_PERF_01_ORGANIZATION_ID}, true)`;
    await query`UPDATE jobs SET status = CASE WHEN source_identity::integer % 4 = 0
        THEN 'succeeded' ELSE 'queued' END
      WHERE source_kind = 'e3_perf_01'`;
    await query`UPDATE job_attempts AS attempt SET status = CASE WHEN job.status = 'succeeded'
        THEN 'succeeded' ELSE 'pending' END
      FROM jobs AS job
      WHERE job.organization_id = attempt.organization_id
        AND job.company_id = attempt.company_id AND job.id = attempt.job_id
        AND job.source_kind = 'e3_perf_01'`;
    await query`UPDATE worker_lease_rejections AS rejection SET
        updated_at = TIMESTAMPTZ '2026-08-01 00:00:00+00'
          + job.source_identity::integer * INTERVAL '1 microsecond'
      FROM jobs AS job
      WHERE job.organization_id = rejection.organization_id
        AND job.company_id = rejection.company_id AND job.id = rejection.job_id
        AND job.source_kind = 'e3_perf_01'`;
    if (layout === "tail") {
      await query`UPDATE worker_lease_rejections AS rejection SET
          updated_at = TIMESTAMPTZ '2026-09-01 00:00:00+00'
            + job.source_identity::integer * INTERVAL '1 microsecond'
        FROM jobs AS job
        WHERE job.organization_id = rejection.organization_id
          AND job.company_id = rejection.company_id AND job.id = rejection.job_id
          AND job.source_kind = 'e3_perf_01' AND job.status = 'succeeded'`;
    }
  });
  await seedDatabase().unsafe("ANALYZE jobs, worker_lease_rejections");

  const [attestation] = await client<{
    eligible_rows: number;
    first_eligible_position: number;
    last_eligible_position: number;
    max_eligible_gap: number | null;
  }[]>`
    WITH ordered AS (
      SELECT job.status,
        row_number() OVER (ORDER BY rejection.organization_id, rejection.updated_at,
          rejection.worker_id, rejection.attempt_id)::int AS position
      FROM worker_lease_rejections AS rejection
      JOIN jobs AS job ON job.organization_id = rejection.organization_id
        AND job.company_id = rejection.company_id AND job.id = rejection.job_id
      WHERE job.source_kind = 'e3_perf_01'
    ), eligible AS (
      SELECT position, position - lag(position) OVER (ORDER BY position) AS gap
      FROM ordered WHERE status = 'succeeded'
    )
    SELECT count(*)::int AS eligible_rows, min(position)::int AS first_eligible_position,
      max(position)::int AS last_eligible_position, max(gap)::int AS max_eligible_gap
    FROM eligible`;
  if (layout === "sparse") {
    expect.soft(attestation).toEqual({
      eligible_rows: 250_000,
      first_eligible_position: 4,
      last_eligible_position: 1_000_000,
      max_eligible_gap: 4,
    });
  } else {
    expect.soft(attestation).toEqual({
      eligible_rows: 250_000,
      first_eligible_position: 750_001,
      last_eligible_position: 1_000_000,
      max_eligible_gap: 1,
    });
  }
}

beforeAll(async () => {
  if (!enabled) return;
  const url = process.env.AOA_E3_PERF_DATABASE_URL;
  if (!url) throw new Error("AOA_E3_PERF_DATABASE_URL is required for E3-PERF-01");
  // A single setup/attestation connection keeps the tenant GUC deterministic;
  // production repository calls still use the separate runInTenant connection.
  db = postgres(url, { max: 1, prepare: false, idle_timeout: 0, max_lifetime: null });
  tenantSql = postgres(url, {
    max: 1,
    prepare: false,
    idle_timeout: 0,
    max_lifetime: null,
    debug: (_connection, statement, parameters) => {
      capturedQueries.push({ sql: statement, parameters: [...parameters] });
    },
  });
  seedSql = postgres(url, { max: 1, prepare: false, idle_timeout: 0, max_lifetime: null });
  tenantDb = drizzle(tenantSql);
  // The pinned setup credential seeds the disposable corpus, while every
  // measured/direct tenant query runs under the hardened serving role.
  await db.unsafe('SET ROLE "aoa_app"');
  await tenantSql.unsafe('SET ROLE "aoa_app"');
  const [role] = await db<{ current_user: string; superuser: boolean; bypassrls: boolean }[]>`
    SELECT current_user, rol.rolsuper AS superuser, rol.rolbypassrls AS bypassrls
    FROM pg_roles rol WHERE rol.rolname = current_user`;
  expect(role).toEqual({ current_user: "aoa_app", superuser: false, bypassrls: false });
  const [seedRole] = await seedSql<{
    current_user: string;
    organizations_insert: boolean;
    companies_insert: boolean;
    targets_insert: boolean;
  }[]>`
    SELECT current_user,
      has_table_privilege(current_user, 'organizations', 'INSERT') AS organizations_insert,
      has_table_privilege(current_user, 'companies', 'INSERT') AS companies_insert,
      has_table_privilege(current_user, 'execution_targets', 'INSERT') AS targets_insert`;
  expect(seedRole?.current_user).not.toBe("aoa_app");
  expect(seedRole).toMatchObject({
    organizations_insert: true,
    companies_insert: true,
    targets_insert: true,
  });
  await db`SELECT set_config('aoa.organization_id', ${E3_PERF_01_ORGANIZATION_ID}, false)`;
  await seedSql`SELECT set_config('aoa.organization_id', ${E3_PERF_01_ORGANIZATION_ID}, false)`;
  await seedE3Perf01Corpus(seedSql);
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
  await tenantSql?.end();
  await db?.end();
  await seedSql?.end();
}, 60_000);

describe("E3-PERF-01 immutable load contract", () => {
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
      "hot_worker_fully_certified_then_head_saturated",
      "ten_thousand_workers_by_one_hundred",
      "ninety_percent_stale_version_or_context",
      "cleanup_sparse_then_tail",
    ]);
    expect(E3_PERF_01_CLAIM_SCENARIOS).toEqual([
      "hot_worker_fully_certified_no_work",
      "hot_worker_head_saturated_999744_prefix",
      "ten_thousand_workers_by_one_hundred",
      "ninety_percent_stale_version_or_context",
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

  it("fails closed on hot sequential scans, spilled/unbounded sorts, and missing reviewed indexes", () => {
    const valid = {
      Plan: {
        "Node Type": "Limit",
        "Actual Rows": 256,
        Plans: [{
          "Node Type": "Index Scan",
          "Relation Name": "jobs",
          "Index Name": "jobs_claim_idx",
          "Actual Rows": 256,
          Plans: [{
            "Node Type": "Index Scan",
            "Relation Name": "job_attempts",
            "Index Name": "job_attempts_lease_candidate_idx",
            "Actual Rows": 256,
            Plans: [{
              "Node Type": "Index Only Scan",
              "Relation Name": "worker_lease_rejections",
              "Index Name": "worker_lease_rejections_pkey",
              "Actual Rows": 256,
              "Heap Fetches": 0,
            }],
          }],
        }],
      },
    };
    expect(() => assertHotPlan(valid, "valid")).not.toThrow();
    expect(() => assertHotPlan({ Plan: {
      "Node Type": "Seq Scan", "Relation Name": "jobs", "Actual Rows": 1,
    } }, "seq")).toThrow();
    expect(() => assertHotPlan({ Plan: {
      "Node Type": "Sort", "Sort Method": "external merge", "Actual Rows": 257,
      "Temp Read Blocks": 1, "Temp Written Blocks": 1,
    } }, "sort")).toThrow();
    expect(() => assertCleanupPlan({ Plan: {
      "Node Type": "Index Scan", "Relation Name": "worker_lease_rejections",
      "Index Name": "worker_lease_rejections_cleanup_idx", "Actual Rows": 256,
    } }, "valid")).not.toThrow();
    expect(() => assertCleanupPlan({ Plan: {
      "Node Type": "Seq Scan", "Relation Name": "worker_lease_rejections", "Actual Rows": 0,
    } }, "seq")).toThrow();
    expect(() => assertCleanupPlan({ Plan: {
      "Node Type": "Index Scan", "Relation Name": "worker_lease_rejections",
      "Index Name": "worker_lease_rejections_cleanup_idx",
    } }, "missing-cardinality")).toThrow();
  });
});

describe.skipIf(!enabled)("E3-PERF-01 production-capacity static-certificate lane", () => {
  it.each(E3_PERF_01_CLAIM_SCENARIOS)("records the real bounded claim plan and samples for %s", async (scenario) => {
    const client = database();
    await prepareE3Perf01ClaimScenario(client, scenario);
    const claimContext = await directClaimFixture(seedDatabase(), scenario);
    const expectedIds = await assertCanonicalClaimShape(client, scenario);
    expect.soft(expectedIds).toHaveLength(E3_PERF_01_EXPECTED_CLAIM_ROWS[scenario]);

    const first = await callProductionClaim(claimContext);
    expect.soft(first.rows.map((row) => row.attempt.id), scenario).toEqual(expectedIds);
    const plan = await client.begin(async (tx) => {
      const query = tx as unknown as Sql;
      await query`SELECT set_config('aoa.organization_id', ${E3_PERF_01_ORGANIZATION_ID}, true)`;
      return explainJson(query, first.query.sql, first.query.parameters);
    });
    const planSummary = assertHotPlan(plan, scenario);
    for (let index = 0; index < E3_PERF_01_DATASET.warmups; index += 1) {
      const warmup = await callProductionClaim(claimContext);
      expect.soft(warmup.querySha256).toBe(first.querySha256);
      expect.soft(warmup.rows.map((row) => row.attempt.id)).toEqual(expectedIds);
    }
    const samples: number[] = [];
    for (let index = 0; index < E3_PERF_01_DATASET.claimSamples; index += 1) {
      const start = performance.now();
      const sample = await callProductionClaim(claimContext);
      samples.push(performance.now() - start);
      expect.soft(sample.querySha256).toBe(first.querySha256);
      expect.soft(sample.rows.map((row) => row.attempt.id)).toEqual(expectedIds);
      expect(sample.rows.length).toBeLessThanOrEqual(256);
    }
    emitEvidence({
      kind: "claim_scenario",
      scenario,
      querySha256: first.querySha256,
      actualAttemptIds: expectedIds,
      samples,
      p95Ms: percentile(samples, 0.95),
      maxMs: Math.max(...samples),
      plan,
      planSummary,
    });
  }, 30 * 60_000);

  it("attests the complete current certificate tuple against the seeded candidates before the production claim", async () => {
    const client = database();
    const scenario = "hot_worker_head_saturated_999744_prefix" as const;
    await prepareE3Perf01ClaimScenario(client, scenario);
    const context = await directClaimFixture(seedDatabase(), scenario);
    const [tuple] = await client<{ exact_current_rows: number; unmatched_rows: number }[]>`
      SELECT
        count(*) FILTER (WHERE rejection.organization_id = attempt.organization_id
          AND rejection.company_id = attempt.company_id AND rejection.job_id = attempt.job_id
          AND rejection.attempt_id = attempt.id AND rejection.worker_id = ${context.workerId}
          AND rejection.target_id = attempt.placement_target_id
          AND rejection.target_authority_key = ${context.targetAuthorityKey}
          AND rejection.workload_type = job.workload_type
          AND rejection.placement_owner = attempt.placement_owner
          AND rejection.placement_target_class = attempt.placement_target_class
          AND rejection.placement_target_scope = attempt.placement_target_scope
          AND rejection.placement_target_generation = attempt.placement_target_generation
          AND rejection.placement_profile_hash = attempt.placement_profile_hash
          AND rejection.placement_provider_constraint_hash = attempt.placement_provider_constraint_hash
          AND rejection.placement_input_digest = attempt.placement_input_digest
          AND rejection.placement_policy_digest = attempt.placement_policy_digest
          AND rejection.eligibility_version = ${context.eligibilityVersion}
          AND rejection.static_context_hash = ${context.staticContextHash})::int AS exact_current_rows,
        count(*) FILTER (WHERE rejection.attempt_id IS NULL)::int AS unmatched_rows
      FROM jobs AS job
      JOIN job_attempts AS attempt ON attempt.organization_id = job.organization_id
        AND attempt.company_id = job.company_id AND attempt.job_id = job.id
      LEFT JOIN worker_lease_rejections AS rejection
        ON rejection.organization_id = attempt.organization_id
        AND rejection.company_id = attempt.company_id AND rejection.job_id = attempt.job_id
        AND rejection.attempt_id = attempt.id AND rejection.worker_id = ${context.workerId}
      WHERE job.source_kind = 'e3_perf_01'`;
    expect.soft(tuple).toEqual({ exact_current_rows: 999_744, unmatched_rows: 256 });
    const expectedIds = await assertCanonicalClaimShape(client, scenario);
    const result = await callProductionClaim(context);
    expect.soft(result.rows.map((candidate) => candidate.attempt.id)).toEqual(expectedIds);
  }, 30 * 60_000);

  it("records 20 exact 256-row bulk-certificate upserts without changing authority rows", async () => {
    const client = database();
    const authorityClient = seedDatabase();
    await prepareE3Perf01ClaimScenario(client, "hot_worker_head_saturated_999744_prefix");
    const certificates = await client<Array<Record<string, unknown>>>`
      SELECT organization_id AS "organizationId", company_id AS "companyId", job_id AS "jobId",
        attempt_id AS "attemptId", worker_id AS "workerId", target_id AS "targetId",
        target_authority_key AS "targetAuthorityKey", eligibility_version AS "eligibilityVersion",
        static_context_hash AS "staticContextHash", workload_type AS "workloadType",
        placement_owner AS "placementOwner", placement_target_class AS "placementTargetClass",
        placement_target_scope AS "placementTargetScope",
        placement_target_generation AS "placementTargetGeneration",
        placement_profile_hash AS "placementProfileHash",
        placement_provider_constraint_hash AS "placementProviderConstraintHash",
        placement_input_digest AS "placementInputDigest",
        placement_policy_digest AS "placementPolicyDigest", reason_code AS "reasonCode"
      FROM worker_lease_rejections
      ORDER BY updated_at, worker_id, attempt_id LIMIT ${E3_PERF_01_DATASET.batchSize}`;
    expect.soft(certificates).toHaveLength(E3_PERF_01_DATASET.batchSize);
    const [authorityBefore] = await authorityClient<{ digest: string }[]>`
      SELECT md5(jsonb_build_object(
        'targets', (SELECT jsonb_agg(jsonb_build_array(id, status, device_generation,
          registered_profile_hash, provider_constraint_profile) ORDER BY id) FROM execution_targets),
        'workers', (SELECT jsonb_agg(jsonb_build_array(id, status, device_generation,
          profile_hash, revoked_at) ORDER BY id) FROM workers)
      )::text) AS digest`;
    const samples: number[] = [];
    const queryFingerprints = new Set<string>();
    for (let index = 0; index < E3_PERF_01_DATASET.mutationSamples; index += 1) {
      const start = performance.now();
      capturedQueries.length = 0;
      let affected = 0;
      const rollback = new Error("E3_PERF_01_ROLLBACK_BULK_UPSERT");
      await expect(runInTenant(tenantDatabase() as never, E3_PERF_01_ORGANIZATION_ID, async (repos) => {
        const operation = (repos.jobControl as unknown as {
          upsertLeaseRejectionCertificates(input: { certificates: unknown[] }): Promise<number>;
        }).upsertLeaseRejectionCertificates;
        expect.soft(typeof operation).toBe("function");
        if (typeof operation !== "function") throw new Error("production certificate upsert is missing");
        affected = await operation({ certificates });
        throw rollback;
      })).rejects.toBe(rollback);
      samples.push(performance.now() - start);
      expect(affected).toBe(E3_PERF_01_DATASET.batchSize);
      const query = [...capturedQueries].reverse().find((entry) => /worker_lease_rejections/i.test(entry.sql));
      expect.soft(query).toBeDefined();
      if (query) queryFingerprints.add(normalizedQuerySha256(query.sql));
    }
    const [authorityAfter] = await authorityClient<{ digest: string }[]>`
      SELECT md5(jsonb_build_object(
        'targets', (SELECT jsonb_agg(jsonb_build_array(id, status, device_generation,
          registered_profile_hash, provider_constraint_profile) ORDER BY id) FROM execution_targets),
        'workers', (SELECT jsonb_agg(jsonb_build_array(id, status, device_generation,
          profile_hash, revoked_at) ORDER BY id) FROM workers)
      )::text) AS digest`;
    expect.soft(authorityAfter?.digest).toBe(authorityBefore?.digest);
    expect.soft([...queryFingerprints]).toHaveLength(1);
    emitEvidence({
      kind: "bulk_upsert",
      querySha256: [...queryFingerprints][0],
      affectedPerSample: Array(E3_PERF_01_DATASET.mutationSamples).fill(256),
      samples,
      p95Ms: percentile(samples, 0.95),
    });
  }, 10 * 60_000);

  it.each(["sparse", "tail"] as const)("records 20 bounded 256-row %s cleanup samples", async (layout) => {
    const client = database();
    await prepareAndAssertCleanupLayout(client, layout);
    const [before] = await client<{ total_rows: number; eligible_rows: number; retained_rows: number }[]>`
      SELECT count(*)::int AS total_rows,
        count(*) FILTER (WHERE job.status = 'succeeded')::int AS eligible_rows,
        count(*) FILTER (WHERE job.status <> 'succeeded')::int AS retained_rows
      FROM worker_lease_rejections AS rejection
      JOIN jobs AS job ON job.organization_id = rejection.organization_id
        AND job.company_id = rejection.company_id AND job.id = rejection.job_id
      WHERE job.source_kind = 'e3_perf_01'`;
    expect.soft(before).toEqual({ total_rows: 1_000_000, eligible_rows: 250_000, retained_rows: 750_000 });
    const samples: number[] = [];
    const queryFingerprints = new Set<string>();
    let measuredQuery: { sql: string; parameters: unknown[] } | undefined;
    for (let index = 0; index < E3_PERF_01_DATASET.mutationSamples; index += 1) {
      const start = performance.now();
      capturedQueries.length = 0;
      let affected = 0;
      const rollback = new Error(`E3_PERF_01_ROLLBACK_CLEANUP_${layout}`);
      await expect(runInTenant(tenantDatabase() as never, E3_PERF_01_ORGANIZATION_ID, async (repos) => {
        const operation = (repos.jobControl as unknown as {
          cleanupLeaseRejectionCertificates(input: { limit: number }): Promise<number>;
        }).cleanupLeaseRejectionCertificates;
        expect.soft(typeof operation).toBe("function");
        if (typeof operation !== "function") throw new Error("production certificate cleanup is missing");
        affected = await operation({ limit: E3_PERF_01_DATASET.batchSize });
        throw rollback;
      })).rejects.toBe(rollback);
      samples.push(performance.now() - start);
      expect(affected).toBe(E3_PERF_01_DATASET.batchSize);
      const query = [...capturedQueries].reverse().find((entry) =>
        /worker_lease_rejections/i.test(entry.sql) && /FOR\s+UPDATE|SKIP\s+LOCKED/i.test(entry.sql));
      expect.soft(query).toBeDefined();
      if (query) {
        measuredQuery ??= query;
        queryFingerprints.add(normalizedQuerySha256(query.sql));
      }
    }
    expect.soft([...queryFingerprints]).toHaveLength(1);
    expect.soft(measuredQuery).toBeDefined();
    let cleanupPlan: Record<string, unknown> | undefined;
    if (measuredQuery) {
      const rollback = new Error(`E3_PERF_01_ROLLBACK_CLEANUP_EXPLAIN_${layout}`);
      await expect(client.begin(async (tx) => {
        const query = tx as unknown as Sql;
        await query`SELECT set_config('aoa.organization_id', ${E3_PERF_01_ORGANIZATION_ID}, true)`;
        cleanupPlan = await explainJson(query, measuredQuery!.sql, measuredQuery!.parameters);
        throw rollback;
      })).rejects.toBe(rollback);
    }
    const planSummary = cleanupPlan ? assertCleanupPlan(cleanupPlan, layout, 256) : undefined;
    const [after] = await client<{ total_rows: number; eligible_rows: number; retained_rows: number }[]>`
      SELECT count(*)::int AS total_rows,
        count(*) FILTER (WHERE job.status = 'succeeded')::int AS eligible_rows,
        count(*) FILTER (WHERE job.status <> 'succeeded')::int AS retained_rows
      FROM worker_lease_rejections AS rejection
      JOIN jobs AS job ON job.organization_id = rejection.organization_id
        AND job.company_id = rejection.company_id AND job.id = rejection.job_id
      WHERE job.source_kind = 'e3_perf_01'`;
    expect.soft(after).toEqual(before);
    emitEvidence({
      kind: "cleanup",
      layout,
      querySha256: [...queryFingerprints][0],
      affectedPerSample: Array(E3_PERF_01_DATASET.mutationSamples).fill(256),
      samples,
      p95Ms: percentile(samples, 0.95),
      plan: cleanupPlan,
      planSummary,
    });
  }, 10 * 60_000);

  it("keeps exact corpus size and combined table plus index bytes inside the blocking bound", async () => {
    const client = database();
    await prepareE3Perf01ClaimScenario(client, "hot_worker_fully_certified_no_work");
    const [sizes] = await client<{
      candidate_rows: number;
      certificate_rows: number;
      joined_job_rows: number;
      relation_bytes: number;
      table_bytes: number;
      index_bytes: number;
      total_bytes: number;
    }[]>`
      SELECT
        (SELECT count(*)::int FROM job_attempts WHERE status = 'pending') AS candidate_rows,
        (SELECT count(*)::int FROM worker_lease_rejections) AS certificate_rows,
        (SELECT count(*)::int FROM jobs j WHERE EXISTS (
          SELECT 1 FROM job_attempts ja WHERE ja.organization_id = j.organization_id
            AND ja.company_id = j.company_id AND ja.job_id = j.id AND ja.status = 'pending')) AS joined_job_rows,
        pg_relation_size('worker_lease_rejections')::bigint::float8 AS relation_bytes,
        pg_table_size('worker_lease_rejections')::bigint::float8 AS table_bytes,
        pg_indexes_size('worker_lease_rejections')::bigint::float8 AS index_bytes,
        pg_total_relation_size('worker_lease_rejections')::bigint::float8 AS total_bytes`;
    expect(sizes?.candidate_rows).toBe(E3_PERF_01_DATASET.candidateRows);
    expect(sizes?.certificate_rows).toBe(E3_PERF_01_DATASET.certificateRows);
    expect(Number(sizes?.joined_job_rows ?? 0)).toBeGreaterThan(0);
    expect(Number(sizes?.total_bytes ?? 0)).toBe(Number(sizes?.table_bytes ?? 0) + Number(sizes?.index_bytes ?? 0));
    expect(Number(sizes?.total_bytes ?? 0))
      .toBeLessThanOrEqual(E3_PERF_01_INITIAL_THRESHOLDS.combinedTableIndexBytesMax);

    const indexes = await client<{
      index_name: string;
      valid: boolean;
      ready: boolean;
      definition: string;
      predicate: string | null;
    }[]>`
      SELECT index_rel.relname AS index_name, idx.indisvalid AS valid, idx.indisready AS ready,
        pg_get_indexdef(idx.indexrelid) AS definition,
        pg_get_expr(idx.indpred, idx.indrelid) AS predicate
      FROM pg_index idx
      JOIN pg_class index_rel ON index_rel.oid = idx.indexrelid
      WHERE index_rel.relname IN ('jobs_claim_idx', 'job_attempts_lease_candidate_idx',
        'worker_lease_rejections_pkey', 'worker_lease_rejections_cleanup_idx')
      ORDER BY index_rel.relname`;
    expect.soft(indexes.map((index) => index.index_name)).toEqual([
      "job_attempts_lease_candidate_idx", "jobs_claim_idx", "worker_lease_rejections_cleanup_idx",
      "worker_lease_rejections_pkey",
    ]);
    expect.soft(indexes.every((index) => index.valid && index.ready)).toBe(true);
    expect.soft(indexes.find((index) => index.index_name === "jobs_claim_idx")?.definition).toContain("priority DESC");
    expect.soft(indexes.find((index) => index.index_name === "job_attempts_lease_candidate_idx")?.predicate)
      .toMatch(/pending[\s\S]*selected[\s\S]*active[\s\S]*placement_lease_eligible/i);
    emitEvidence({ kind: "storage", ...sizes, indexes });
  });
});
