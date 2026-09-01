// server/src/services/canary-preflight-evidence.ts
//
// BLOCKER E. These reads cross a privilege boundary: `aoa_app` holds ZERO privileges on
// environment_leases / environments / runtime_provider_keys / company_secret_versions. They
// are served by owner-owned SECURITY DEFINER functions (migration
// 0266_canary_preflight_evidence_fn.sql) which narrow both the projection and the predicate --
// the return types structurally cannot carry secret material.
//
// ★ TWO FUNCTIONS, AND NO SHARED STATE. There was one function returning a row per lease plus
// two scalars, which forced a choice between two defects: either the two scalar-only store
// members each hydrated the whole lease inventory to read one scalar, or a single-flight
// coalesced them. The single-flight was store-global and keyed only by company, so two
// OVERLAPPING `check()` calls shared one snapshot and a lease committed between them was
// invisible to the second -- the exact fail-open `canary-preflight.ts:30-33` refuses to cache
// in order to prevent. Splitting dissolves the choice rather than scoping it: each caller reads
// only what it needs, every read is independent, and there is no shared mutable state left to
// get wrong.
//
// So: three store members, three independent reads per `check()`, and ONLY `listLeases` touches
// `environment_leases` -- which is what the pre-BLOCKER-E code did. An earlier comment here
// claimed that parity while three reads were scanning leases; it was wrong, and this is the
// shape that actually has it.

import { sql } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { derivePlatformDefaultEnvironmentId } from "./platform-default-environment.js";

type LeaseRow = { lease_id: string | null };
type ScalarRow = {
  platform_default_environment_id: string | null;
  key_generation: string | null;
};

export type CanaryPreflightScalars = {
  readonly platformDefaultEnvironmentId: string | null;
  readonly keyGeneration: string | null;
};

function rowsOf<T>(result: unknown): T[] {
  // `db.execute` returns an array on some drivers and `{rows}` on others. Both shapes are
  // handled deliberately; do not "simplify" without checking which driver `appDb` uses.
  return (Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])) as T[];
}

/** Lease ids for one Company. The only evidence read that touches `environment_leases`. */
export async function readCanaryPreflightLeaseIds(
  db: Db,
  companyId: string,
): Promise<readonly string[]> {
  const result = await db.execute(
    sql`SELECT lease_id FROM public.canary_preflight_evidence_leases(${companyId}::uuid)`,
  );
  return rowsOf<LeaseRow>(result)
    .map((row) => row.lease_id)
    .filter((id): id is string => id !== null);
}

/**
 * The platform-default environment id and the current provider-control key generation.
 * Always exactly one row, so "no leases" can never be confused with "no key generation".
 */
export async function readCanaryPreflightScalars(
  db: Db,
  companyId: string,
): Promise<CanaryPreflightScalars> {
  // The default-env id is derived HERE and passed in: it is a TypeScript uuidv5
  // (platform-default-environment.ts) with no SQL equivalent, and a second derivation would
  // drift SILENTLY -- a mismatched id reads as "no default env" rather than raising.
  const defaultEnvId = derivePlatformDefaultEnvironmentId(companyId);
  const result = await db.execute(
    sql`SELECT platform_default_environment_id, key_generation
        FROM public.canary_preflight_evidence_scalars(${companyId}::uuid, ${defaultEnvId}::uuid)`,
  );
  const row = rowsOf<ScalarRow>(result)[0];
  return {
    platformDefaultEnvironmentId: row?.platform_default_environment_id ?? null,
    keyGeneration: row?.key_generation ?? null,
  };
}
