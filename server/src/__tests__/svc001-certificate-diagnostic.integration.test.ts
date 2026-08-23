// TEMPORARY DIAGNOSTIC - SVC-001.
//
// `verify` fails deterministically on CI in distributed-execution-db-startup with 32
// failures, every one tracing to the app-authority startup phase - which WRAPS and
// DISCARDS the underlying assertion (deliberately: a sibling test pins that startup
// errors carry no payload-bearing diagnostics, so attaching a `cause` is not an option).
//
// Every one of these comparisons is clean on a Windows embedded-postgres, so the
// difference is environmental and only Linux CI can show it. This file replicates the
// exact certificate queries AS aoa_app and asserts the diffs are empty, so the CI log
// names the drift instead of swallowing it. DELETE once the cause is known.

import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { setupJobControlFixture, type JobControlFixture } from "./helpers/job-control-fixture.js";
import { appTablePrivileges } from "../db/distributed-execution-databases.js";
import { RELATION_ACL_MANIFEST, RLS_RELATIONS, FORCE_RLS_RELATIONS, POLICY_COUNTS } from "../db/job-control-legacy-grants.js";

describe.skipIf(process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1")("SVC-001 TEMPORARY certificate diagnostic", () => {
  it("prints every app-authority certificate diff (TEMPORARY - delete once verify is diagnosed)", async () => {
    let f: JobControlFixture | null = null;
    try {
      f = await setupJobControlFixture("svc-probe3");
      const db = f.app.db;
      const expected = appTablePrivileges();
      const rows = (await db.execute(sql`
        SELECT namespace.nspname AS schema_name, relation.relname AS table_name,
          has_table_privilege(current_user, relation.oid, 'SELECT') AS s,
          has_table_privilege(current_user, relation.oid, 'INSERT') AS i,
          has_table_privilege(current_user, relation.oid, 'UPDATE') AS u,
          has_table_privilege(current_user, relation.oid, 'DELETE') AS d
        FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname <> 'information_schema' AND namespace.nspname NOT LIKE 'pg\_%'
          AND relation.relkind IN ('r','p','v','m','f')`)) as unknown as Record<string, unknown>[];
      const mismatches: string[] = [];
      for (const r of rows) {
        const exp = new Set((r.schema_name === "public" ? expected[r.table_name as string] ?? [] : []) as string[]);
        const act: Record<string, boolean> = { SELECT: !!r.s, INSERT: !!r.i, UPDATE: !!r.u, DELETE: !!r.d };
        for (const op of ["SELECT","INSERT","UPDATE","DELETE"]) {
          if (act[op] !== exp.has(op)) mismatches.push(`${r.schema_name}.${r.table_name} ${op} actual=${act[op]} expected=${exp.has(op)}`);
        }
      }
      console.error("TABLE_PRIV_MISMATCHES:", JSON.stringify(mismatches.slice(0, 25)));

      const rls = (await db.execute(sql`
        SELECT relation.relname AS relation, relation.relforcerowsecurity AS force
        FROM pg_class relation JOIN pg_namespace ns ON ns.oid = relation.relnamespace
        WHERE ns.nspname='public' AND relation.relrowsecurity ORDER BY relation.relname`)) as unknown as Record<string, unknown>[];
      const actualRls = rls.map((r) => r.relation as string).sort();
      const expRls = [...RLS_RELATIONS].sort();
      console.error("RLS_ONLY_IN_DB:", JSON.stringify(actualRls.filter((x) => !expRls.includes(x))));
      console.error("RLS_ONLY_IN_MANIFEST:", JSON.stringify(expRls.filter((x) => !actualRls.includes(x))));
      const actualForce = rls.filter((r) => r.force).map((r) => r.relation as string).sort();
      const expForce = [...FORCE_RLS_RELATIONS].sort();
      console.error("FORCE_DIFF:", JSON.stringify({ onlyDb: actualForce.filter((x)=>!expForce.includes(x)), onlyManifest: expForce.filter((x)=>!actualForce.includes(x)) }));

      const pol = (await db.execute(sql`
        SELECT relation.relname AS relation, count(*)::int AS n
        FROM pg_policy policy JOIN pg_class relation ON relation.oid = policy.polrelid
        JOIN pg_namespace ns ON ns.oid = relation.relnamespace
        WHERE ns.nspname='public' GROUP BY relation.relname`)) as unknown as Record<string, unknown>[];
      const actualCounts = Object.fromEntries(pol.map((r) => [r.relation as string, Number(r.n)]));
      const countDiff = Object.entries(POLICY_COUNTS as Record<string, number>)
        .filter(([k, v]) => (actualCounts[k] ?? 0) !== v)
        .map(([k, v]) => `${k}: manifest=${v} db=${actualCounts[k] ?? 0}`);
      console.error("POLICY_COUNT_DIFF:", JSON.stringify(countDiff));
      console.error("ACL_MANIFEST_HAS_SG:", JSON.stringify(RELATION_ACL_MANIFEST["service_generations"] ?? null));
      // Deliberately assert emptiness so a diff is IMPOSSIBLE to miss in the CI log.
      expect({ mismatches, countDiff }).toEqual({ mismatches: [], countDiff: [] });
    } finally { try { await f?.teardown(); } catch { /* ignore */ } }
  }, 240_000);
});
