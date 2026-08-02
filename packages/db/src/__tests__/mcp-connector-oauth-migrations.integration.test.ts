import { afterAll, beforeAll, describe, expect, it } from "vitest";
import EmbeddedPostgres from "embedded-postgres";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import postgres, { type Sql } from "postgres";

const suite = process.platform === "win32" ? describe.skip : describe;
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

function splitMigration(sql: string): string[] {
  return sql.split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean);
}

async function allocatePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("No test port available"));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function runStatements(sql: Sql, statements: string[]): Promise<void> {
  for (const statement of statements) await sql.unsafe(statement);
}

suite("MCP OAuth migration replay", () => {
  let pg: EmbeddedPostgres;
  let sql: Sql;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "aoa-oauth-migrations-"));
    const port = await allocatePort();
    pg = new EmbeddedPostgres({ databaseDir: join(dataDir, "db"), port, password: "postgres" });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase("aoa_oauth_migrations");
    sql = postgres(`postgresql://postgres:postgres@127.0.0.1:${port}/aoa_oauth_migrations`);
    await sql.unsafe('CREATE TABLE "companies" ("id" uuid PRIMARY KEY)');
    await sql.unsafe('CREATE TABLE "company_mcp_connectors" ("id" uuid PRIMARY KEY, "company_id" uuid NOT NULL)');
    await sql.unsafe('CREATE TABLE "company_secrets" ("id" uuid PRIMARY KEY)');
  }, 180_000);

  afterAll(async () => {
    await sql?.end().catch(() => {});
    await pg?.stop().catch(() => {});
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  }, 30_000);

  it("0188 recovers when its table and first FK already exist, then replays", async () => {
    const statements = splitMigration(await readFile(join(migrationsDir, "0188_narrow_blonde_phantom.sql"), "utf8"));
    await runStatements(sql, statements.slice(0, 2));
    await runStatements(sql, statements);
    await runStatements(sql, statements);
    const constraints = await sql<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'mcp_connector_oauth_flows'::regclass AND contype = 'f'
      ORDER BY conname
    `;
    expect(constraints.map((row) => row.conname)).toEqual([
      "mcp_connector_oauth_flows_company_id_companies_id_fk",
      "mcp_connector_oauth_flows_connector_id_company_mcp_connectors_id_fk",
    ]);
  });

  it("the generated migration recovers from partial state and replays", async () => {
    const statements = splitMigration(await readFile(join(migrationsDir, "0189_clammy_micromacro.sql"), "utf8"));
    await runStatements(sql, statements.slice(0, 2));
    await runStatements(sql, statements);
    await runStatements(sql, statements);
    const columns = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'company_mcp_connectors'
        AND column_name IN ('catalog_entry_id', 'oauth_policy_version')
      ORDER BY column_name
    `;
    expect(columns.map((row) => row.column_name)).toEqual(["catalog_entry_id", "oauth_policy_version"]);
    const indexes = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE indexname IN (
        'company_mcp_connectors_company_catalog_entry_uq',
        'mcp_connector_oauth_flows_status_expires_idx'
      ) ORDER BY indexname
    `;
    expect(indexes).toHaveLength(2);
  });

  it("the cleanup index migration replays safely", async () => {
    const statements = splitMigration(await readFile(join(migrationsDir, "0190_volatile_reaper.sql"), "utf8"));
    await runStatements(sql, statements);
    await runStatements(sql, statements);
    const indexes = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE indexname = 'mcp_connector_oauth_flows_status_updated_idx'
    `;
    expect(indexes).toHaveLength(1);
  });
});
