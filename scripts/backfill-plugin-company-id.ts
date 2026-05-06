/**
 * One-time backfill: set companyId on all existing plugin rows that have NULL companyId.
 * Uses the first company in the companies table (AoA is typically single-tenant).
 *
 * Run: npx tsx scripts/backfill-plugin-company-id.ts
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { isNull } from "drizzle-orm";
import {
  plugins,
  pluginConfig,
  pluginVersionSnapshots,
  companies,
} from "../packages/db/src/schema/index.js";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function main() {
  // Get first company
  const [company] = await db.select({ id: companies.id }).from(companies).limit(1);
  if (!company) {
    console.error("No companies found — skipping backfill");
    process.exit(0);
  }
  const companyId = company.id;
  console.log(`Backfilling companyId = ${companyId}`);

  // Backfill plugins
  await db
    .update(plugins)
    .set({ companyId })
    .where(isNull(plugins.companyId));
  console.log("plugins updated");

  // Backfill plugin_config
  await db
    .update(pluginConfig)
    .set({ companyId })
    .where(isNull(pluginConfig.companyId));
  console.log("plugin_config updated");

  // Backfill plugin_version_snapshots
  await db
    .update(pluginVersionSnapshots)
    .set({ companyId })
    .where(isNull(pluginVersionSnapshots.companyId));
  console.log("plugin_version_snapshots updated");

  console.log("Backfill complete.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
