// The SECURITY DEFINER certificate.
//
// `assertExactServingRoleAuthority` scans tables, columns and sequences. It never scanned
// functions — before migration 0266 there was not one `prosecdef` reference in this
// repository. A definer function runs with the OWNER's authority regardless of caller, so
// shipping one without a certificate would turn a documented ACL model into one with an
// undocumented hole.
//
// The shape cases below are properties of a constant and cannot fail for any reason that
// matters on their own; the integration cases exercise the REAL query against a REAL
// database, including a mutant definer function the scan must reject.
//
// Windows-skipped unless AOA_RUN_WIN_INTEGRATION=1 (Issue #114); Linux CI is the authority.

import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { SECURITY_DEFINER_FUNCTION_MANIFEST } from "../db/security-definer-manifest.js";
import { assertSecurityDefinerManifest } from "../db/distributed-execution-databases.js";
import { startMigratedDatabase } from "./helpers/migrated-database.js";

const RUN = process.platform !== "win32" || process.env.AOA_RUN_WIN_INTEGRATION === "1";

function manifestKeys(): Set<string> {
  return new Set(
    SECURITY_DEFINER_FUNCTION_MANIFEST.map(
      (fn) => `${fn.schema}.${fn.name}(${fn.identityArguments})`,
    ),
  );
}

describe("SECURITY DEFINER manifest — shape", () => {
  it("lists the canary preflight evidence function exactly once", () => {
    const hits = SECURITY_DEFINER_FUNCTION_MANIFEST.filter(
      (fn) => fn.name === "canary_preflight_evidence",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.schema).toBe("public");
    expect(hits[0]?.identityArguments).toBe("p_company_id uuid, p_default_env_id uuid");
  });

  it("requires a rationale on every entry — owner authority is never granted silently", () => {
    for (const fn of SECURITY_DEFINER_FUNCTION_MANIFEST) {
      expect(fn.rationale.length, `${fn.name} has no rationale`).toBeGreaterThan(40);
    }
  });

  it("has no duplicate identities", () => {
    expect(manifestKeys().size).toBe(SECURITY_DEFINER_FUNCTION_MANIFEST.length);
  });
});

describe.skipIf(!RUN)("SECURITY DEFINER manifest — the scan actually matches the database", () => {
  it("finds exactly the manifested set after migrations", async () => {
    const database = await startMigratedDatabase({ label: "aoa-definer-manifest-" });
    try {
      const rows = (await database.appDb.execute(sql`
        SELECT
          namespace.nspname AS schema_name,
          proc.proname AS function_name,
          pg_get_function_identity_arguments(proc.oid) AS identity_arguments
        FROM pg_proc proc
        JOIN pg_namespace namespace ON namespace.oid = proc.pronamespace
        WHERE proc.prosecdef
          AND namespace.nspname <> 'information_schema'
          AND namespace.nspname NOT LIKE 'pg_%'
      `)) as unknown as Array<{
        schema_name: string;
        function_name: string;
        identity_arguments: string;
      }>;
      const actual = new Set(
        rows.map((row) => `${row.schema_name}.${row.function_name}(${row.identity_arguments})`),
      );
      expect(actual).toEqual(manifestKeys());

      // And the production assertion itself accepts that database.
      await expect(
        assertSecurityDefinerManifest(database.appDb, "aoa_app"),
      ).resolves.toBeUndefined();
    } finally {
      await database.teardown();
    }
  }, 180_000);

  // The mutation check, AUTOMATED. A hand-run check is not a regression guard.
  it("REJECTS an unmanifested definer function", async () => {
    const database = await startMigratedDatabase({ label: "aoa-definer-mutant-" });
    try {
      await database.admin.unsafe(
        "CREATE FUNCTION public.mutant_definer() RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'",
      );
      await expect(assertSecurityDefinerManifest(database.appDb, "aoa_app")).rejects.toThrow(
        /unmanifested SECURITY DEFINER function public\.mutant_definer\(\)/,
      );
    } finally {
      await database.teardown();
    }
  }, 180_000);

  // The other direction: a manifest entry whose function is missing is drift too. Dropping
  // the real function proves the "is absent" arm can fire, which a set-difference in only
  // one direction would never show.
  it("REJECTS a manifested definer function that is absent", async () => {
    const database = await startMigratedDatabase({ label: "aoa-definer-absent-" });
    try {
      await database.admin.unsafe(
        "DROP FUNCTION public.canary_preflight_evidence(uuid, uuid)",
      );
      await expect(assertSecurityDefinerManifest(database.appDb, "aoa_app")).rejects.toThrow(
        /manifested SECURITY DEFINER function public\.canary_preflight_evidence\(p_company_id uuid, p_default_env_id uuid\) is absent/,
      );
    } finally {
      await database.teardown();
    }
  }, 180_000);
});
