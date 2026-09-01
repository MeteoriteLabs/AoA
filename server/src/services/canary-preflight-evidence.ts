// server/src/services/canary-preflight-evidence.ts
//
// BLOCKER E (E-1). These reads cross a privilege boundary: the non-owner `aoa_app` pool
// holds ZERO privileges on `environment_leases`, `environments`, `runtime_provider_keys`
// and `company_secret_versions`. They are served by an owner-owned SECURITY DEFINER
// function (migration 0266_canary_preflight_evidence_fn.sql) which narrows both the
// projection and the predicate — the return type structurally cannot carry
// `company_secret_versions.material` or `environment_leases.metadata`.
//
// NO ATOMICITY IS CLAIMED. The store calls this once per member, so a `check()` makes
// three round trips, exactly as the code it replaces did (three separate drizzle queries).
// If a future change needs a consistent snapshot across the three scalars, memoize per
// `check()` — do not assert a consistency this code does not provide.

import { sql } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { derivePlatformDefaultEnvironmentId } from "./platform-default-environment.js";

type EvidenceRow = {
  lease_id: string | null;
  platform_default_environment_id: string | null;
  key_generation: string | null;
};

export type CanaryPreflightEvidence = {
  readonly leaseIds: readonly string[];
  readonly platformDefaultEnvironmentId: string | null;
  readonly keyGeneration: string | null;
};

export async function readCanaryPreflightEvidence(
  db: Db,
  companyId: string,
): Promise<CanaryPreflightEvidence> {
  // The default-env id is derived HERE and passed IN: it is a TypeScript uuidv5
  // (platform-default-environment.ts:109-111) with no SQL equivalent, and a second
  // derivation in PL/pgSQL would drift SILENTLY — a mismatched id reads as "no default
  // env" rather than raising.
  const defaultEnvId = derivePlatformDefaultEnvironmentId(companyId);
  const result = await db.execute(
    sql`SELECT lease_id, platform_default_environment_id, key_generation
        FROM public.canary_preflight_evidence(${companyId}::uuid, ${defaultEnvId}::uuid)`,
  );
  // `db.execute` returns an array (postgres-js) or `{ rows }` (node-postgres) depending on
  // the driver. Both shapes are handled deliberately; do not "simplify" this without
  // checking which driver the app pool uses.
  const rows = (Array.isArray(result)
    ? result
    : ((result as { rows?: unknown[] }).rows ?? [])) as EvidenceRow[];
  return {
    leaseIds: rows.map((row) => row.lease_id).filter((id): id is string => id !== null),
    platformDefaultEnvironmentId: rows[0]?.platform_default_environment_id ?? null,
    keyGeneration: rows[0]?.key_generation ?? null,
  };
}
