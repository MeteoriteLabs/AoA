// UNIT D measurement harness for DE-01's READ half (E0-F010 / E0-F013).
//
// THE STANDING CLAIM UNDER TEST: "detecting an RLS-filtered read needs a BYPASSRLS
// comparator, i.e. exactly the privilege packages/db/src/client.ts:325 throws at boot
// to forbid", therefore that boot guard must be amended.
//
// This suite measures the claim against real embedded PostgreSQL rather than reasoning
// about it. It writes NO production code and asserts NO new production behaviour; every
// DDL statement below is created inside the test database and dies with it.
//
// Gate: the E2-D05 env hatch, identical to tenant-rls-enforcement.integration.test.ts —
// runs unconditionally on Linux, and on Windows only under AOA_RUN_WIN_INTEGRATION=1.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { assertNonOwnerConnection, createDb, type Db } from "@armyofagents/db";
import { withTenantTx } from "../db/with-tenant-tx.js";
import { startMigratedDatabase, type MigratedDatabase } from "./helpers/migrated-database.js";

const ORG_A = "00000000-0000-0000-0000-0000000ad001";
const ORG_B = "00000000-0000-0000-0000-0000000bd001";
const CO_A = "00000000-0000-0000-0000-0000000ac001";
const CO_B = "00000000-0000-0000-0000-0000000bc001";

const DEFOWNER_PW = "de01_defowner_pw";
const BYPASS_PW = "de01_bypass_pw";

let harness: MigratedDatabase | null = null;
let setupError: unknown = null;
let jobA = "";
let jobB = "";
let bypassDb: Db | null = null;

function rowsOf<T>(res: unknown): T[] {
  return (Array.isArray(res) ? res : (res as { rows: T[] }).rows) as T[];
}
function errCode(error: unknown): string | undefined {
  let e: unknown = error;
  for (let i = 0; i < 6 && e && typeof e === "object"; i += 1) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}
async function captureError(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (e) {
    return e;
  }
  throw new Error("expected the statement to be rejected, but it succeeded");
}

const skip = process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1";

describe.skipIf(skip)("DE-01 read half — is BYPASSRLS actually required?", () => {
  beforeAll(async () => {
    try {
      harness = await startMigratedDatabase({ label: "aoa-de01-alts-" });
      const admin = harness.admin;
      await admin`INSERT INTO organizations (id, name, slug) VALUES (${ORG_A}, 'Org A', 'de01-org-a'), (${ORG_B}, 'Org B', 'de01-org-b')`;
      await admin`INSERT INTO companies (id, name, issue_prefix, organization_id) VALUES (${CO_A}, 'Co A', 'DAA', ${ORG_A}), (${CO_B}, 'Co B', 'DBB', ${ORG_B})`;
      const a =
        await admin`INSERT INTO jobs (organization_id, company_id) VALUES (${ORG_A}, ${CO_A}) RETURNING id`;
      const b =
        await admin`INSERT INTO jobs (organization_id, company_id) VALUES (${ORG_B}, ${CO_B}) RETURNING id`;
      jobA = (a[0] as { id: string }).id;
      jobB = (b[0] as { id: string }).id;
    } catch (error) {
      setupError = error;
    }
  }, 180_000);

  afterAll(async () => {
    await bypassDb?.$client?.end?.().catch(() => {});
    await harness?.teardown();
  });

  it("P1 PREMISE — a cross-tenant read is silently filtered: zero rows, no error", async () => {
    if (setupError) throw setupError;
    const h = harness!;
    const seen = await withTenantTx(h.appDb, ORG_A, async (tx) =>
      rowsOf<{ id: string }>(await tx.execute(sql`SELECT id FROM jobs WHERE id = ${jobB}`)),
    );
    expect(seen).toEqual([]);
    const own = await withTenantTx(h.appDb, ORG_A, async (tx) =>
      rowsOf<{ id: string }>(await tx.execute(sql`SELECT id FROM jobs WHERE id = ${jobA}`)),
    );
    expect(own.map((r) => r.id)).toEqual([jobA]);
  });

  it("P2 — aoa_operator has no GRANT on jobs: the refusal is 42501, not a filter", async () => {
    if (setupError) throw setupError;
    const error = await captureError(() => harness!.operatorDb.execute(sql`SELECT id FROM jobs`));
    expect(errCode(error)).toBe("42501");
  });

  it("P3 — GRANT alone is NOT enough: under FORCE RLS a granted role with no matching policy sees zero rows", async () => {
    if (setupError) throw setupError;
    const h = harness!;
    await h.admin`GRANT SELECT ON jobs TO "aoa_operator"`;
    const seen = rowsOf<{ id: string }>(await h.operatorDb.execute(sql`SELECT id FROM jobs`));
    expect(seen).toEqual([]);
  });

  it("ALT-A(i) — SECURITY DEFINER owned by a NON-superuser role matched by no policy returns zero rows", async () => {
    if (setupError) throw setupError;
    const h = harness!;
    await h.admin.unsafe(
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'de01_defowner') THEN ` +
        `CREATE ROLE "de01_defowner" LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE ` +
        `PASSWORD '${DEFOWNER_PW}'; END IF; END $$;`,
    );
    await h.admin`GRANT SELECT ON jobs TO "de01_defowner"`;
    await h.admin.unsafe(
      `CREATE OR REPLACE FUNCTION public.de01_probe_weak() RETURNS TABLE (id uuid, organization_id uuid) ` +
        `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ ` +
        `SELECT j.id, j.organization_id FROM public.jobs j $$;`,
    );
    await h.admin`ALTER FUNCTION public.de01_probe_weak() OWNER TO "de01_defowner"`;
    await h.admin`REVOKE ALL ON FUNCTION public.de01_probe_weak() FROM PUBLIC`;
    await h.admin`GRANT EXECUTE ON FUNCTION public.de01_probe_weak() TO "aoa_operator"`;
    const seen = rowsOf<{ id: string }>(
      await h.operatorDb.execute(sql`SELECT id, organization_id FROM public.de01_probe_weak()`),
    );
    expect(seen).toEqual([]);
  });

  it("ALT-A(ii) — SECURITY DEFINER owned by the MIGRATION OWNER reads across tenants; the CALLER holds no BYPASSRLS", async () => {
    if (setupError) throw setupError;
    const h = harness!;
    await h.admin.unsafe(
      `CREATE OR REPLACE FUNCTION public.de01_probe_owner() RETURNS TABLE (id uuid, organization_id uuid) ` +
        `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ ` +
        `SELECT j.id, j.organization_id FROM public.jobs j $$;`,
    );
    await h.admin`REVOKE ALL ON FUNCTION public.de01_probe_owner() FROM PUBLIC`;
    await h.admin`REVOKE ALL ON FUNCTION public.de01_probe_owner() FROM "aoa_app"`;
    await h.admin`GRANT EXECUTE ON FUNCTION public.de01_probe_owner() TO "aoa_operator"`;
    const seen = rowsOf<{ id: string }>(
      await h.operatorDb.execute(sql`SELECT id, organization_id FROM public.de01_probe_owner()`),
    );
    expect(seen.map((r) => r.id).sort()).toEqual([jobA, jobB].sort());
    const attrs = rowsOf<{ rolbypassrls: boolean; rolsuper: boolean }>(
      await h.operatorDb.execute(
        sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
      ),
    );
    expect(attrs[0]).toMatchObject({ rolsuper: false, rolbypassrls: false });
    const denied = await captureError(() => h.appDb.execute(sql`SELECT * FROM public.de01_probe_owner()`));
    expect(errCode(denied)).toBe("42501");
  });

  it("ALT-B — a role-targeted policy admits aoa_operator across tenants with NO BYPASSRLS", async () => {
    if (setupError) throw setupError;
    const h = harness!;
    await h.admin.unsafe(
      `CREATE POLICY "de01_jobs_comparator" ON "jobs" FOR SELECT TO "aoa_operator" USING (true);`,
    );
    const seen = rowsOf<{ id: string }>(
      await h.operatorDb.execute(sql`SELECT id FROM jobs ORDER BY id`),
    );
    expect(seen.map((r) => r.id).sort()).toEqual([jobA, jobB].sort());
    const stillFiltered = await withTenantTx(h.appDb, ORG_A, async (tx) =>
      rowsOf<{ id: string }>(await tx.execute(sql`SELECT id FROM jobs`)),
    );
    expect(stillFiltered.map((r) => r.id)).toEqual([jobA]);
  });

  it("GUARD — client.ts:325 still passes for aoa_operator after ALT-A and ALT-B; the guard is untouched", async () => {
    if (setupError) throw setupError;
    await expect(assertNonOwnerConnection(harness!.operatorDb, "aoa_operator")).resolves.toBeUndefined();
  });

  it("POSITIVE CONTROL — the guard DOES bite: a BYPASSRLS role is refused with the :325 message", async () => {
    if (setupError) throw setupError;
    const h = harness!;
    await h.admin.unsafe(
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'de01_bypass') THEN ` +
        `CREATE ROLE "de01_bypass" LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT ` +
        `NOREPLICATION PASSWORD '${BYPASS_PW}'; END IF; END $$;`,
    );
    bypassDb = createDb(h.adminUrl.replace("test:test", `de01_bypass:${BYPASS_PW}`));
    const error = await captureError(() => assertNonOwnerConnection(bypassDb!));
    expect(String((error as Error).message)).toContain(
      "Refusing to serve tenant queries as a privileged role",
    );
    expect(String((error as Error).message)).toContain("rolbypassrls=true");
  });
});
