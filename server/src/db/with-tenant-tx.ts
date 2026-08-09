import { sql } from "drizzle-orm";
import type { Db } from "@armyofagents/db";

/**
 * Runs `fn` inside a transaction with the tenant GUC set TRANSACTION-LOCAL
 * (`set_config(..., is_local => true)`) so the value never leaks across pooled
 * postgres-js connections once the transaction commits/rolls back.
 *
 * The RLS canary policy on `company_secrets` reads
 * `current_setting('aoa.organization_id', true)` — this helper is the sole,
 * injection-safe writer of that GUC (the organizationId is bound as a query
 * parameter, never string-interpolated).
 *
 * NOTE (TEN-002): for the NEW-PATH distributed-execution tables this GUC is now the
 * LIVE isolation filter, not merely defense-in-depth. Those 8 tables are served by
 * the non-owner `aoa_app` role (NOSUPERUSER/NOBYPASSRLS) under FORCE ROW LEVEL
 * SECURITY with per-table policies that read `current_setting('aoa.organization_id',
 * true)::uuid`, so a query without this GUC set sees zero rows (TEN-002; proved in
 * `tenant-rls-enforcement.integration.test.ts`). TEN-003's `runInTenant`
 * (`tenant-context.ts`) is the mandatory wrapper that writes it for new-path
 * repositories over that non-owner pool.
 *
 * The legacy `company_secrets` RLS canary, by contrast, remains owner-exempt / inert
 * (its policy is un-FORCE'd and the serving pool still connects as the cluster
 * owner for legacy tables), so on that table this GUC has no filtering effect and
 * `assertCompanyAccess` stays the live legacy boundary (CAV-005 — no legacy RLS
 * retrofit).
 */
export async function withTenantTx<T>(
  db: Db,
  organizationId: string,
  fn: (tx: Db) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // is_local = true => the setting is scoped to THIS transaction only.
    await tx.execute(sql`select set_config('aoa.organization_id', ${organizationId}, true)`);
    return fn(tx as unknown as Db);
  });
}
