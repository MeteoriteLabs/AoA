// REVERSIBILITY ESCAPE HATCH — manual, single-org only. NOT a journaled
// migration (would auto-apply and undo Phase 1). Run: tsx src/revert-0188.ts
// Refuses unless exactly ONE Organization exists.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve as resolvePath } from "node:path";
import postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

// Read the 0188 migration file EXACTLY the way the migrator does
// (client.ts readMigrationFileContent — no line-ending normalization) so the
// sha256 matches the journal row the migrator inserted. The
// drizzle.__drizzle_migrations table is keyed by `hash`, NOT `name` (it has no
// `name` column — see client.ts), so this is how we locate the 0188 row.
async function compute0188JournalHash(): Promise<string> {
  const content = await readFile(
    new URL("./migrations/0188_organizations.sql", import.meta.url),
    "utf8",
  );
  return createHash("sha256").update(content).digest("hex");
}

// Same refusal used by BOTH the cheap pre-check and the authoritative
// in-transaction recheck, so callers (and the guard test) see one stable
// message regardless of which gate fires.
function singleOrgRefusal(count: number): Error {
  return new Error(
    `revert-0188 refused: expected exactly 1 organization, found ${count}. ` +
      `Once a second tenant exists this is a one-way door — restore the pre-0188 snapshot instead.`,
  );
}

export async function revert0188(sql: Sql): Promise<void> {
  // Cheap fast-fail (no lock): give a friendly early error when a second tenant
  // already exists, without paying for a table lock. This is NOT the real gate —
  // it is racy on its own (a concurrent org could commit between here and the
  // drops below). The authoritative gate is the post-lock recheck inside the
  // transaction.
  const [{ count }] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM organizations`;
  if (count !== 1) throw singleOrgRefusal(count);
  const journalHash = await compute0188JournalHash();
  await sql.begin(async (tx) => {
    // 0. Close the TOCTOU window on the destructive single-org rollback. Take an
    //    ACCESS EXCLUSIVE lock on organizations as the FIRST statement in the
    //    transaction, THEN re-run the single-org count check. ACCESS EXCLUSIVE
    //    conflicts with the RowExclusive lock a concurrent INSERT holds, so no
    //    org can be created between this recheck and the drops below — a second
    //    tenant committing after the pre-check above can no longer sneak in and
    //    have BOTH tenants' data dropped. This recheck (not the pre-check) is the
    //    authoritative one-way-door guard.
    await tx.unsafe(`LOCK TABLE "organizations" IN ACCESS EXCLUSIVE MODE`);
    const lockedRows = (await tx.unsafe(
      `SELECT count(*)::int AS count FROM organizations`,
    )) as unknown as { count: number }[];
    const lockedCount = lockedRows[0]!.count;
    if (lockedCount !== 1) throw singleOrgRefusal(lockedCount);
    // 1. Drop the tenant FK on companies.
    await tx.unsafe(`ALTER TABLE "companies" DROP CONSTRAINT IF EXISTS "companies_organization_id_organizations_id_fk"`);
    await tx.unsafe(`ALTER TABLE "companies" ALTER COLUMN "organization_id" DROP DEFAULT`);
    // 2. Restore global uniqueness (safe: single org => prefixes/identifiers are already globally unique).
    await tx.unsafe(`DROP INDEX IF EXISTS "companies_org_issue_prefix_idx"`);
    await tx.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "companies_issue_prefix_idx" ON "companies" USING btree ("issue_prefix")`);
    await tx.unsafe(`DROP INDEX IF EXISTS "issues_identifier_idx"`);
    await tx.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "issues_identifier_idx" ON "issues" USING btree ("identifier")`);
    // 3. Drop the org column + tenant tables.
    await tx.unsafe(`ALTER TABLE "companies" DROP COLUMN IF EXISTS "organization_id"`);
    // Later phases add org FKs from OTHER tables (provider_connections in 0190,
    // execution_targets in 0191, and any future org-referencing table). DROP
    // TABLE below has no CASCADE, so those inbound FKs would abort the whole
    // (transactional) revert with a dependent-object error. Dynamically drop
    // EVERY foreign key that references organizations first — robust and
    // future-proof, no hardcoded table list. (organizations still exists here;
    // the single-org guard above guarantees the ::regclass cast resolves.)
    await tx.unsafe(`
      DO $$
      DECLARE
        r record;
      BEGIN
        FOR r IN
          SELECT conrelid::regclass AS tbl, conname
          FROM pg_constraint
          WHERE contype = 'f'
            AND confrelid = 'organizations'::regclass
            AND conrelid <> 'organizations'::regclass
        LOOP
          EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.tbl, r.conname);
        END LOOP;
      END $$;
    `);
    await tx.unsafe(`DROP TABLE IF EXISTS "organization_invitations"`);
    await tx.unsafe(`DROP TABLE IF EXISTS "organization_memberships"`);
    await tx.unsafe(`DROP TABLE IF EXISTS "organizations"`);
    // 4. Manually strip the 0188 journal row from __drizzle_migrations so the
    //    migrator does not think it is still applied. The table has no `name`
    //    column — rows are keyed by the sha256 of the migration file content
    //    (see client.ts), so delete by hash. (Operator must also delete the
    //    0188 files + journal entry from source before re-generating.)
    await tx.unsafe(`DELETE FROM "drizzle"."__drizzle_migrations" WHERE hash = $1`, [journalHash]);
  });
  // eslint-disable-next-line no-console
  console.log("revert-0188 complete: Phase 1 tenant schema removed (single-org state restored).");
}

// Only run the destructive script when executed directly (tsx src/revert-0188.ts),
// never when imported (e.g. by the integration test).
function invokedAsScript(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const here = fileURLToPath(import.meta.url);
  try {
    return realpathSync(entry) === realpathSync(here);
  } catch {
    return resolvePath(entry) === resolvePath(here);
  }
}

if (invokedAsScript()) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for revert-0188");
  const sql = postgres(url, { max: 1 });
  try {
    await revert0188(sql);
  } finally {
    await sql.end();
  }
}
