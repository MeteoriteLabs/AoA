/**
 * A9.2 — Real-DB end-to-end proof of the AoA backend (Plan A): company
 * create eagerly seeds the Commander Team (Decision #100), and a pending
 * discussion entry is durably picked up by the AoA dispatcher, atomically
 * claimed, and attributed to the kind='aoa' "Discussion Extraction" agent.
 *
 * Boots embedded-postgres, applies all migrations, then:
 *   1. seeds a company via companyService.create → createCompanyWithUniquePrefix
 *      (which runs ensureInternalAgentConfig + ensureCommanderAgent +
 *      ensureExtractionAgent — A9.1 wiring),
 *   2. inserts a discussion + a discussion_entry with extractionStatus='pending',
 *   3. runs runAoaDispatch(db, { limiterMax: 2, staleMs: 600000 }),
 *   4. asserts the durable-outbox contract held.
 *
 * Deterministic-without-CLI note: ensureExtractionAgent seeds the extraction
 * agent with adapterType='process' and NO adapterConfig.command. In
 * runAoaAgent the run row + the M2/#99 atomic claim happen BEFORE
 * adapter.execute; the process adapter then throws "Process adapter missing
 * command" (process/execute.ts:16), which runAoaAgent catches (never
 * rethrows — its hard isolation boundary) and marks the run 'failed'. So the
 * two assertions below (run row exists with agentId + triggerType='sub_agent';
 * entry atomically claimed off 'pending') hold deterministically with NO
 * external CLI. The cost_events row (costCents=0) is emitted only on the
 * success path — costService.createEvent runs AFTER adapter.execute returns
 * and BEFORE the catch — so it does NOT fire on the no-command process throw
 * path; that assertion is documented (not faked) at the bottom and is
 * exercisable on Linux CI only by giving the seeded agent a trivially-
 * succeeding command (Plan D §17 covers real extracted content via
 * claude_local — explicitly out of scope here).
 *
 * Skipped on Windows (embedded-postgres / migration-chain issue — Issue #114);
 * Linux CI is the authoritative gate for this test.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { applyPendingMigrations, createDb, type Db } from "@armyofagents/db";
import { companyService } from "../services/companies.js";
import { runAoaDispatch } from "../services/internal-agent/aoa-agents/dispatcher.js";

type EmbeddedPostgresInstance = {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
};
type EmbeddedPostgresCtor = new (opts: {
  databaseDir: string; user: string; password: string; port: number; persistent: boolean;
}) => EmbeddedPostgresInstance;

let pg: EmbeddedPostgresInstance | null = null;
let dataDir = "";
let db: Db;
let setupError: unknown = null;

function firstId(result: unknown): string {
  if (Array.isArray(result)) return (result[0] as any)?.id;
  return (result as any).rows?.[0]?.id;
}

const PORT = 58000 + Math.floor(Math.random() * 1000);

beforeAll(async () => {
  try {
    dataDir = await mkdtemp(join(tmpdir(), "aoa-backend-integ-test-"));
    const { default: EmbeddedPostgres } = (await import("embedded-postgres")) as {
      default: EmbeddedPostgresCtor;
    };
    pg = new EmbeddedPostgres({
      databaseDir: join(dataDir, "db"),
      user: "test",
      password: "test",
      port: PORT,
      persistent: false,
    });
    await pg.initialise();
    await pg.start();
    const connectionString = `postgres://test:test@localhost:${PORT}/postgres`;
    await applyPendingMigrations(connectionString);
    db = createDb(connectionString);
  } catch (err) {
    setupError = err;
    // eslint-disable-next-line no-console
    console.error("[aoa-backend-integration] embedded-postgres setup failed:", err);
  }
}, 180_000);

afterAll(async () => {
  try { if (pg) await pg.stop(); } catch { /* ignore */ }
  try { if (dataDir) await rm(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
}, 60_000);

describe.skipIf(process.platform === "win32")(
  "AoA backend — real DB: company create seeds Commander Team; pending entry dispatched + claimed",
  () => {
    let companyId: string;
    let entryId: string;

    // Phase 1 (Task C1): the autonomous Scribe outbox drain is OFF by default
    // in production. This integration test pins the legacy autonomous-drain
    // mechanism end-to-end (a pending discussion entry → atomically claimed
    // by the kind='aoa' Discussion Extraction agent), so it explicitly opts
    // INTO the drain via env flag while the test runs.
    const ORIGINAL_DRAIN_FLAG = process.env.AOA_SCRIBE_AUTONOMOUS_DRAIN_ENABLED;
    beforeEach(() => {
      process.env.AOA_SCRIBE_AUTONOMOUS_DRAIN_ENABLED = "true";
    });
    afterEach(() => {
      if (ORIGINAL_DRAIN_FLAG === undefined) {
        delete process.env.AOA_SCRIBE_AUTONOMOUS_DRAIN_ENABLED;
      } else {
        process.env.AOA_SCRIBE_AUTONOMOUS_DRAIN_ENABLED = ORIGINAL_DRAIN_FLAG;
      }
    });

    it("setup: company create eagerly seeds the Commander Team (Decision #100)", async () => {
      if (setupError) {
        throw new Error(
          `embedded-postgres setup failed; cannot run integration test: ${String(setupError)}`,
        );
      }
      const company = await companyService(db).create({ name: "AoA Backend Co" } as any);
      companyId = company.id;
      expect(companyId).toBeTruthy();

      // (1) default internal_agent_config row exists (ensureInternalAgentConfig)
      const cfg = await db.execute<{ agent_id: string | null }>(sql`
        SELECT agent_id FROM internal_agent_config WHERE company_id = ${companyId}
      `);
      const cfgRow = Array.isArray(cfg) ? cfg[0] : (cfg as any).rows?.[0];
      expect(cfgRow).toBeTruthy();

      // (2) Commander kind='aoa' agent exists AND is linked into the config
      const commander = await db.execute<{ id: string }>(sql`
        SELECT id FROM agents
        WHERE company_id = ${companyId} AND kind = 'aoa' AND name = 'Commander'
      `);
      const commanderId = firstId(commander);
      expect(commanderId).toBeTruthy();
      expect(cfgRow.agent_id).toBe(commanderId); // ensureCommanderAgent linked it

      // (3) Discussion Extraction kind='aoa' agent + an ENABLED outbox trigger
      const extraction = await db.execute<{ id: string }>(sql`
        SELECT id FROM agents
        WHERE company_id = ${companyId} AND kind = 'aoa' AND name = 'Discussion Extraction'
      `);
      const extractionId = firstId(extraction);
      expect(extractionId).toBeTruthy();
      const trig = await db.execute<{ enabled: boolean; agent_id: string }>(sql`
        SELECT enabled, agent_id FROM aoa_agent_triggers
        WHERE company_id = ${companyId} AND kind = 'outbox'
      `);
      const trigRow = Array.isArray(trig) ? trig[0] : (trig as any).rows?.[0];
      expect(trigRow).toBeTruthy();
      expect(trigRow.enabled).toBe(true);
      expect(trigRow.agent_id).toBe(extractionId);
    });

    it("dispatch: a pending discussion entry is atomically claimed + attributed to the kind='aoa' extraction agent", async () => {
      if (setupError) throw new Error(String(setupError));

      const discussionId = firstId(await db.execute<{ id: string }>(sql`
        INSERT INTO discussions (id, company_id, status, created_by)
        VALUES (gen_random_uuid(), ${companyId}, 'active', 'integration-test')
        RETURNING id
      `));
      expect(discussionId).toBeTruthy();

      entryId = firstId(await db.execute<{ id: string }>(sql`
        INSERT INTO discussion_entries
          (id, discussion_id, input_type, raw_content, extraction_status, created_by)
        VALUES
          (gen_random_uuid(), ${discussionId}, 'paste',
           'We decided to ship the dashboard. Krishna to draft the spec.',
           'pending', 'integration-test')
        RETURNING id
      `));
      expect(entryId).toBeTruthy();

      // The durable-outbox dispatcher: gate passes (eager outbox trigger from
      // setup), the extraction agent is resolved, runAoaAgent inserts the run
      // + atomically claims the entry, then the no-command process adapter
      // throws and the run is marked failed (never rethrown).
      await runAoaDispatch(db, { limiterMax: 2, staleMs: 600_000 });

      // Assertion 1 — an internal_agent_runs row attributed to the kind='aoa'
      // "Discussion Extraction" agent, triggerType='sub_agent'.
      const extractionId = firstId(await db.execute<{ id: string }>(sql`
        SELECT id FROM agents
        WHERE company_id = ${companyId} AND kind = 'aoa' AND name = 'Discussion Extraction'
      `));
      const runs = await db.execute<{ agent_id: string; trigger_type: string }>(sql`
        SELECT agent_id, trigger_type FROM internal_agent_runs
        WHERE company_id = ${companyId} AND agent_id = ${extractionId}
      `);
      const runRow = Array.isArray(runs) ? runs[0] : (runs as any).rows?.[0];
      expect(runRow).toBeTruthy();
      expect(runRow.agent_id).toBe(extractionId);
      expect(runRow.trigger_type).toBe("sub_agent");

      // Assertion 2 — the entry was atomically claimed off 'pending' (the M2
      // /#99 claim flipped pending→processing before adapter.execute threw).
      const entry = await db.execute<{ extraction_status: string }>(sql`
        SELECT extraction_status FROM discussion_entries WHERE id = ${entryId}
      `);
      const entryRow = Array.isArray(entry) ? entry[0] : (entry as any).rows?.[0];
      expect(entryRow).toBeTruthy();
      expect(entryRow.extraction_status).not.toBe("pending");

      // Assertion 3 (documented — NOT asserted here; honest Linux-CI note):
      // A cost_events row for the extraction agent with cost_cents=0 is
      // emitted by runAoaAgent ONLY on the success path
      // (costService.createEvent runs AFTER adapter.execute returns and
      // BEFORE the catch). The seeded extraction agent has adapterType=
      // 'process' and NO adapterConfig.command, so adapter.execute throws
      // "Process adapter missing command" and the cost event is never
      // reached — the run is marked 'failed' instead. To exercise this
      // assertion on Linux CI, give the seeded agent a trivially-succeeding
      // command (e.g. UPDATE its adapter_config to {"command":"true"}) before
      // dispatch, then assert:
      //
      //   const cost = await db.execute(sql`
      //     SELECT cost_cents FROM cost_events
      //     WHERE company_id = ${companyId} AND agent_id = ${extractionId}`);
      //   expect(firstRow(cost)?.cost_cents).toBe(0);
      //
      // Faking this row (or asserting it on the throw path) would be a false
      // green, so it is intentionally left as documentation. Real extracted
      // *content* via claude_local is Plan D §17 — explicitly out of scope.
    });
  },
);
