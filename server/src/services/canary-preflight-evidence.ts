// server/src/services/canary-preflight-evidence.ts
//
// BLOCKER E (E-1). These reads cross a privilege boundary: the non-owner `aoa_app` pool
// holds ZERO privileges on `environment_leases`, `environments`, `runtime_provider_keys`
// and `company_secret_versions`. They are served by an owner-owned SECURITY DEFINER
// function (migration 0266_canary_preflight_evidence_fn.sql) which narrows both the
// projection and the predicate — the return type structurally cannot carry
// `company_secret_versions.material` or `environment_leases.metadata`.
//
// NO ATOMICITY IS CLAIMED ACROSS `check()` CALLS. Two separate `check()` calls read
// independently, and must — `canary-preflight.ts:30-33` refuses to cache this gate.
//
// Within one `check()` the store single-flights this call, so the three members share one
// read (`canary-preflight-store.ts`). An earlier version of this comment said three
// independent calls were "exactly as the code it replaces did"; that was WRONG and is
// corrected here rather than deleted. The replaced code issued four queries but scanned
// `environment_leases` ONCE — only `listLeases` touched it, while the other two were
// indexed lookups on `environments` / `runtime_provider_keys`. This function returns one row
// per lease, so calling it per member scanned and hydrated the whole lease inventory THREE
// times to read two scalars, and terminal leases are retained, so that grew with history.

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
