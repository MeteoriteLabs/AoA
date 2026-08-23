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
import {
  RELATION_ACL_MANIFEST,
  COLUMN_ACL_MANIFEST,
  RLS_RELATIONS,
  FORCE_RLS_RELATIONS,
  POLICY_COUNTS,
  RLS_POLICY_MANIFEST,
} from "../db/job-control-legacy-grants.js";

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
      // ---- the checks the first diagnostic did NOT cover -------------------------
      const schemaRows = (await db.execute(sql`
        SELECT ns.nspname AS schema_name,
          has_schema_privilege(current_user, ns.oid, 'USAGE') AS usage,
          has_schema_privilege(current_user, ns.oid, 'CREATE') AS create_priv
        FROM pg_namespace ns
        WHERE ns.nspname <> 'information_schema' AND ns.nspname NOT LIKE 'pg\_%'`)) as unknown as Record<string, unknown>[];
      const schemaBad = schemaRows
        .filter((r) => !!r.usage !== (r.schema_name === "public") || !!r.create_priv)
        .map((r) => `${r.schema_name} usage=${r.usage} create=${r.create_priv}`);
      console.error("SCHEMA_PRIV_BAD:", JSON.stringify(schemaBad));

      const aclRows = (await db.execute(sql`
        SELECT relation.relname AS relation, relation.relacl IS NULL AS acl_is_null,
          CASE WHEN acl.grantor = relation.relowner THEN 'RELATION_OWNER'
               ELSE COALESCE(grantor.rolname, acl.grantor::text) END AS grantor,
          CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
               WHEN acl.grantee = relation.relowner THEN 'RELATION_OWNER'
               ELSE COALESCE(grantee.rolname, acl.grantee::text) END AS grantee,
          acl.privilege_type, acl.is_grantable
        FROM pg_class relation
        JOIN pg_namespace ns ON ns.oid = relation.relnamespace
        LEFT JOIN LATERAL aclexplode(relation.relacl) acl ON TRUE
        LEFT JOIN pg_roles grantor ON grantor.oid = acl.grantor
        LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
        WHERE ns.nspname = 'public'`)) as unknown as Record<string, unknown>[];
      const key = (t: Record<string, unknown>) => `${t.grantor}:${t.grantee}:${t.privilegeType}:${t.isGrantable}`;
      const actualAcl: Record<string, { aclIsNull: boolean; tuples: Record<string, unknown>[] }> = {};
      for (const r of aclRows) {
        const e = (actualAcl[r.relation as string] ??= { aclIsNull: !!r.acl_is_null, tuples: [] });
        if (r.grantor !== null && r.grantee !== null && r.privilege_type !== null && r.is_grantable !== null) {
          e.tuples.push({ grantor: r.grantor, grantee: r.grantee, privilegeType: r.privilege_type, isGrantable: r.is_grantable });
        }
      }
      const aclDiff: string[] = [];
      for (const [rel, exp] of Object.entries(RELATION_ACL_MANIFEST as Record<string, { aclIsNull: boolean; tuples: Record<string, unknown>[] }>)) {
        const act = actualAcl[rel];
        if (!act) { aclDiff.push(`${rel}: MISSING FROM DATABASE`); continue; }
        if (act.aclIsNull !== exp.aclIsNull) aclDiff.push(`${rel}: aclIsNull db=${act.aclIsNull} manifest=${exp.aclIsNull}`);
        const a = act.tuples.map(key).sort().join("|");
        const b = exp.tuples.map(key).sort().join("|");
        if (a !== b) aclDiff.push(`${rel}: tuples db=[${a}] manifest=[${b}]`);
      }
      console.error("RELATION_ACL_DIFF:", JSON.stringify(aclDiff.slice(0, 10)));

      const colRows = (await db.execute(sql`
        SELECT relation.relname AS relation, attribute.attname AS column_name,
          attribute.attacl IS NULL AS acl_is_null
        FROM pg_class relation
        JOIN pg_namespace ns ON ns.oid = relation.relnamespace
        JOIN pg_attribute attribute ON attribute.attrelid = relation.oid AND attribute.attnum > 0 AND NOT attribute.attisdropped
        WHERE ns.nspname = 'public'`)) as unknown as Record<string, unknown>[];
      const colDiff: string[] = [];
      for (const [rel, cols] of Object.entries(COLUMN_ACL_MANIFEST as Record<string, Record<string, { aclIsNull: boolean }>>)) {
        for (const [col, exp] of Object.entries(cols)) {
          const act = colRows.find((r) => r.relation === rel && r.column_name === col);
          if (!act) { colDiff.push(`${rel}.${col}: MISSING FROM DATABASE`); continue; }
          if (!!act.acl_is_null !== exp.aclIsNull) colDiff.push(`${rel}.${col}: aclIsNull db=${act.acl_is_null} manifest=${exp.aclIsNull}`);
        }
      }
      console.error("COLUMN_ACL_DIFF:", JSON.stringify(colDiff.slice(0, 10)));

      const polRows = (await db.execute(sql`
        SELECT relation.relname AS relation, policy.polname AS name,
          CASE policy.polcmd WHEN '*' THEN 'ALL' WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
               WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' END AS command,
          CASE WHEN policy_role.role_oid = 0 THEN 'PUBLIC' ELSE role.rolname END AS role,
          policy.polpermissive AS permissive,
          pg_get_expr(policy.polqual, policy.polrelid) AS qual,
          pg_get_expr(policy.polwithcheck, policy.polrelid) AS check
        FROM pg_policy policy
        JOIN pg_class relation ON relation.oid = policy.polrelid
        JOIN pg_namespace ns ON ns.oid = relation.relnamespace
        CROSS JOIN LATERAL unnest(policy.polroles) AS policy_role(role_oid)
        LEFT JOIN pg_roles role ON role.oid = policy_role.role_oid
        WHERE ns.nspname = 'public'`)) as unknown as Record<string, unknown>[];
      const pkey = (r: Record<string, unknown>) => `${r.relation}|${r.name}|${r.command}|${r.role}|${r.permissive}|${r.qual}|${r.check}`;
      const actualPol = new Set(polRows.map(pkey));
      const expectedPol = new Set((RLS_POLICY_MANIFEST as Record<string, unknown>[]).map(pkey));
      const polDiff = {
        onlyDb: [...actualPol].filter((x) => !expectedPol.has(x)).slice(0, 6),
        onlyManifest: [...expectedPol].filter((x) => !actualPol.has(x)).slice(0, 6),
      };
      console.error("POLICY_ROW_DIFF:", JSON.stringify(polDiff));

      // Deliberately assert emptiness so a diff is IMPOSSIBLE to miss in the CI log.
      expect({ mismatches, countDiff, schemaBad, aclDiff, colDiff, polDiff }).toEqual({
        mismatches: [], countDiff: [], schemaBad: [], aclDiff: [], colDiff: [],
        polDiff: { onlyDb: [], onlyManifest: [] },
      });
    } finally { try { await f?.teardown(); } catch { /* ignore */ } }
  }, 240_000);
});
