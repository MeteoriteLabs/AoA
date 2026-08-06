/**
 * U2b integration — `resolveBrokerToolContext` (server/src/mcp/broker-tool-context.ts)
 * against a real Postgres. Proves the resolver builds the internal-agent
 * `ToolContext` for a sandboxed (E2B) agent run purely from the run-JWT
 * identity (agentId/companyId/runId) + the control-plane `db`, and that a
 * companyId that does not match the agent's real tenant is refused.
 *
 * Modeled on d18-autonomy-dial-split.integration.test.ts's embedded-postgres
 * harness. Skipped on Windows by default (CI's `runneradmin` account can't
 * start embedded-postgres — Issue #114); Linux CI is the authoritative gate.
 * On a Windows dev box set `AOA_RUN_WIN_INTEGRATION=1` to run it for real.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { applyPendingMigrations, createDb, type Db } from "@armyofagents/db";
import { companyService } from "../services/companies.js";
import { resolveBrokerToolContext } from "../mcp/broker-tool-context.js";

type EmbeddedPostgresInstance = {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
};
type EmbeddedPostgresCtor = new (opts: {
  databaseDir: string;
  user: string;
  password: string;
  port: number;
  persistent: boolean;
  initdbFlags?: string[];
}) => EmbeddedPostgresInstance;

let pg: EmbeddedPostgresInstance | null = null;
let dataDir = "";
let db: Db;
let setupError: unknown = null;
let setupFailed = false;

/** Fail LOUDLY and ONCE when embedded-postgres never came up (see D18 integration test). */
function assertSetupOk(): void {
  const dbReady = (db as Db | undefined) !== undefined;
  if (!setupFailed && dbReady) return;
  throw new Error(
    `embedded-postgres setup failed (see the console.error above): ${
      setupError instanceof Error ? setupError.message : String(setupError)
    }`,
  );
}

// Distinct from the other integration suites' ranges (see grep of `const PORT =`
// across server/src/__tests__) to keep collision odds low.
const PORT = 62700 + Math.floor(Math.random() * 300);

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  return ((result as { rows?: Array<Record<string, unknown>> }).rows ?? []) as Array<
    Record<string, unknown>
  >;
}

/**
 * Seed a company (auto-seeds internal_agent_config + the AoA crew via
 * companyService.create — see D18 integration test) plus ONE extra crew
 * agent we fully control: kind='aoa', runtimeConfig.aoa.toolAllowlist
 * carrying `query_memory` (the per-role allowlist contract `ensure-*` crew
 * seed files set up in production; here seeded directly for test control).
 */
async function seedCompanyWithBrokerAgent(
  label: string,
): Promise<{ companyId: string; agentId: string }> {
  const company = await companyService(db).create({ name: `U2b ${label} Co` } as never);
  const companyId = company.id;

  const [agentRow] = rowsOf(
    await db.execute(sql`
      INSERT INTO agents (id, company_id, name, kind, status, runtime_config)
      VALUES (
        gen_random_uuid(), ${companyId}, ${`Broker Agent ${label}`}, 'aoa', 'idle',
        ${JSON.stringify({ aoa: { toolAllowlist: ["query_memory", "query_tasks"] } })}::jsonb
      )
      RETURNING id
    `),
  );
  const agentId = String(agentRow.id);

  // D18 split: set the two dials to DIFFERENT values so a resolver reading
  // the wrong column (autonomyLevel instead of crewAutonomyLevel) fails loudly
  // rather than accidentally matching.
  await db.execute(sql`
    UPDATE internal_agent_config
    SET autonomy_level = 2, crew_autonomy_level = 1
    WHERE company_id = ${companyId}
  `);

  return { companyId, agentId };
}

beforeAll(async () => {
  try {
    dataDir = await mkdtemp(join(tmpdir(), "aoa-broker-tool-context-integ-"));
    const { default: EmbeddedPostgres } = (await import("embedded-postgres")) as {
      default: EmbeddedPostgresCtor;
    };
    pg = new EmbeddedPostgres({
      databaseDir: join(dataDir, "db"),
      user: "test",
      password: "test",
      port: PORT,
      persistent: false,
      // Force UTF-8 so migration SQL containing non-Latin1 chars applies on a
      // Windows dev box (initdb would otherwise inherit WIN1252).
      initdbFlags: ["--encoding=UTF8", "--locale=C"],
    });
    await pg.initialise();
    await pg.start();
    const connectionString = `postgres://test:test@localhost:${PORT}/postgres`;
    await applyPendingMigrations(connectionString);
    db = createDb(connectionString);
  } catch (err) {
    setupError = err;
    setupFailed = true;
    // eslint-disable-next-line no-console
    console.error("[broker-tool-context] embedded-postgres setup failed:", err);
  }
}, 180_000);

afterAll(async () => {
  try {
    if (pg) await pg.stop();
  } catch {
    /* ignore */
  }
  try {
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}, 60_000);

describe.skipIf(
  process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1",
)("resolveBrokerToolContext — integration", () => {
  it("resolves an agent ToolContext from run-JWT identity (agentId/companyId/runId) + db", async () => {
    assertSetupOk();

    const { companyId, agentId } = await seedCompanyWithBrokerAgent("Happy");
    const runId = "run-happy-1";

    const ctx = await resolveBrokerToolContext({ db, companyId, agentId, runId });

    expect(ctx.actorType).toBe("agent");
    expect(ctx.agentKind).toBe("aoa");
    expect(ctx.agentId).toBe(agentId);
    expect(ctx.runId).toBe(runId);
    expect(ctx.companyId).toBe(companyId);
    expect(ctx.toolAllowlist).toContain("query_memory");
    // D18: the resolver must read crew_autonomy_level (1), never autonomy_level (2).
    expect(ctx.effectiveAutonomy).toBe(1);
    // Commander-only fields must never be set for an agent actor.
    expect(ctx.commanderToolPermissions).toBeUndefined();
    expect(ctx.runtimeApprovalsEnabled).toBeUndefined();
    expect(ctx.db).toBe(db);
    expect(ctx.services).toBeDefined();
  });

  it("throws when the caller-supplied companyId does not match the agent's real tenant", async () => {
    assertSetupOk();

    const { agentId } = await seedCompanyWithBrokerAgent("Victim");
    const { companyId: otherCompanyId } = await seedCompanyWithBrokerAgent("Attacker");

    await expect(
      resolveBrokerToolContext({
        db,
        companyId: otherCompanyId,
        agentId,
        runId: "run-cross-tenant",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
