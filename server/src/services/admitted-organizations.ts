// server/src/services/admitted-organizations.ts
//
// The ONE distributed-execution Organization enumerator, extracted VERBATIM from the composition
// root (server/src/index.ts, where it was an inline closure) by MIG-009 (M1a) so the operator
// drain trigger (`pnpm drain:distributed-execution`) REUSES it instead of re-deriving it. The
// server's outbox worker, convergence sweeper and revocation fanout keep using the same function
// through index.ts; there is still exactly one definition of "an admitted Organization".
//
// A parallel copy is how CLI-002's memory bundle once silently dropped a security predicate
// (see job-distributed-drain-store.ts); sharing the function makes that drift impossible rather
// than merely unlikely.
//
// Semantics (unchanged by the extraction): active Organizations that own at least one Company,
// excluding the sentinel default Organization, keyset-paged ascending by id. Both inputs are
// clamped to the same ceilings the drain clamps to (32 rows, 750 ms), and the statement timeout is
// transaction-local. Runs on the bounded `aoa_app` pool.

import { and, asc, eq, exists, gt, ne, sql } from "drizzle-orm";
import { companies, organizations, type Db } from "@armyofagents/db";

export interface ListAdmittedOrganizationIdsInput {
  afterOrganizationId: string | null;
  limit: number;
  statementTimeoutMs: number;
}

export type ListAdmittedOrganizationIds = (input: ListAdmittedOrganizationIdsInput) => Promise<string[]>;

export function createAdmittedOrganizationIdsLister(appDb: Db): ListAdmittedOrganizationIds {
  return async (input) => {
    const boundedLimit = Math.max(1, Math.min(32, Math.floor(input.limit)));
    const boundedTimeout = Math.max(1, Math.min(750, Math.floor(input.statementTimeoutMs)));
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('statement_timeout', ${String(boundedTimeout)}, true)`);
      const rows = await tx.select({ id: organizations.id })
        .from(organizations)
        .where(and(
          eq(organizations.status, "active"),
          ne(organizations.id, "00000000-0000-0000-0000-000000000001"),
          input.afterOrganizationId
            ? gt(organizations.id, input.afterOrganizationId)
            : undefined,
          exists(
            tx.select({ id: companies.id })
              .from(companies)
              .where(eq(companies.organizationId, organizations.id)),
          ),
        ))
        .orderBy(asc(organizations.id))
        .limit(boundedLimit);
      return rows.map((row) => row.id);
    });
  };
}
