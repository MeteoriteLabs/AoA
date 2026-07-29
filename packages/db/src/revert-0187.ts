// REVERSIBILITY ESCAPE HATCH — manual, single-org only. NOT a journaled
// migration (would auto-apply and undo Phase 1). Run: tsx src/revert-0187.ts
// Refuses unless exactly ONE Organization exists.
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required for revert-0187");

const sql = postgres(url, { max: 1 });
try {
  const [{ count }] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM organizations`;
  if (count !== 1) {
    throw new Error(
      `revert-0187 refused: expected exactly 1 organization, found ${count}. ` +
        `Once a second tenant exists this is a one-way door — restore the pre-0187 snapshot instead.`,
    );
  }
  await sql.begin(async (tx) => {
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
    await tx.unsafe(`DROP TABLE IF EXISTS "organization_invitations"`);
    await tx.unsafe(`DROP TABLE IF EXISTS "organization_memberships"`);
    await tx.unsafe(`DROP TABLE IF EXISTS "organizations"`);
    // 4. Manually strip the 0187 journal row from __drizzle_migrations so the
    //    migrator does not think it is still applied. (Operator must also delete
    //    the 0187 files + journal entry from source before re-generating.)
    await tx.unsafe(`DELETE FROM "drizzle"."__drizzle_migrations" WHERE name = '0187_organizations.sql' OR name = '0187_organizations'`);
  });
  // eslint-disable-next-line no-console
  console.log("revert-0187 complete: Phase 1 tenant schema removed (single-org state restored).");
} finally {
  await sql.end();
}
