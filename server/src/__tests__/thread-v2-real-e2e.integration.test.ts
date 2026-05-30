/**
 * P2-T5 — Advisory real-agent E2E lane for the thread-v2 (crew) loop.
 *
 * This test proves the orchestration controller path executes end-to-end with
 * a real claude_local adapter: a human entry on a controller-path thread
 * triggers runControllerSweep → runController → Adjutant via runAoaAgent →
 * the Adjutant posts its own entry via MCP tools (post_entry / scope_proposal).
 *
 * CRITICAL PRECONDITIONS (all must hold; test is skipped otherwise):
 *   1. Not running on Windows (embedded-postgres migration issue — Issue #114)
 *   2. THREAD_V2_E2E=1 environment variable is set
 *   3. DATABASE_URL environment variable points to a running database with
 *      migrations already applied
 *   4. The Adjutant agent in the test company is configured with
 *      adapterType='claude_local' and valid credentials. The test configures
 *      this explicitly — if the underlying adapter or CLI is absent, the
 *      runControllerSweep call will fail and the test will surface that failure.
 *
 * The describe.skipIf guard is the entire point — removing it or weakening
 * the preconditions would produce a false green. This is intentional per the
 * advisory lane contract documented in .github/workflows/thread-v2-e2e.yml.
 *
 * See docs/qa/thread-v2-release-checklist.md for the authoritative per-release
 * manual gate.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDb, type Db } from "@armyofagents/db";
import { companyService } from "../services/companies.js";
import { runControllerSweep } from "../services/internal-agent/aoa-agents/sweep-controller.js";

const isWin32 = process.platform === "win32";
const hasRealE2E = Boolean(process.env.THREAD_V2_E2E);
const hasDbUrl = Boolean(process.env.DATABASE_URL);

// ── Helpers ───────────────────────────────────────────────────────────────────

function firstRow<T>(result: unknown): T | undefined {
  if (Array.isArray(result)) return result[0] as T;
  return (result as any).rows?.[0] as T | undefined;
}

function firstId(result: unknown): string {
  return (firstRow<{ id: string }>(result) as any)?.id;
}

/** Poll until predicate returns a truthy value or the timeout elapses.
 *  Returns the last predicate result (truthy = success, undefined = timeout). */
async function pollUntil<T>(
  predicate: () => Promise<T | undefined | null>,
  timeoutMs: number,
  intervalMs = 2000,
): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return undefined;
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe.skipIf(isWin32 || !hasRealE2E || !hasDbUrl)(
  "thread v2 real-agent E2E (advisory)",
  () => {
    let db: Db;
    let companyId: string;
    let adjutantAgentId: string;
    let threadId: string;
    let setupError: unknown = null;

    beforeAll(async () => {
      try {
        const databaseUrl = process.env.DATABASE_URL;
        if (!databaseUrl) {
          throw new Error(
            "DATABASE_URL is not set. The thread-v2 real-agent E2E test requires a " +
            "running database with migrations applied. See " +
            "docs/qa/thread-v2-release-checklist.md for setup.",
          );
        }
        db = createDb(databaseUrl);

        // Seed a test company. companyService.create seeds the full crew
        // (Adjutant, Engineer, Scout, Commander, Command Staff) idempotently.
        const company = await companyService(db).create({
          name: `Thread v2 E2E Co ${Date.now()}`,
        });
        companyId = company.id;

        // Find the Adjutant agent seeded by company create. The Adjutant is
        // kind='aoa', name='Adjutant', not terminated — exactly one per company.
        const adjutantRow = await db.execute<{ id: string }>(sql`
          SELECT id
          FROM agents
          WHERE company_id = ${companyId}
            AND kind = 'aoa'
            AND name = 'Adjutant'
            AND status != 'terminated'
          LIMIT 1
        `);
        const adjutant = firstRow<{ id: string }>(adjutantRow);
        if (!adjutant) {
          throw new Error(
            "Precondition failed: no Adjutant agent found after company create. " +
            "companyService.create should seed the Adjutant via ensureAdjutant. " +
            "Check ensure-adjutant.ts and the company bootstrap path.",
          );
        }
        adjutantAgentId = adjutant.id;

        // Configure the Adjutant with claude_local so it can actually run. The
        // adapter config is read from ACCEPTANCE_ADAPTER_CONFIG if set (JSON
        // string), otherwise uses a minimal default that assumes `claude` is on
        // PATH (the same pattern as aoa-realoutput.integration.test.ts).
        const adapterConfigRaw = process.env.ACCEPTANCE_ADAPTER_CONFIG;
        const adapterConfig = adapterConfigRaw
          ? JSON.parse(adapterConfigRaw)
          : { cwd: process.cwd() };

        await db.execute(sql`
          UPDATE agents
          SET adapter_type = 'claude_local',
              adapter_config = ${JSON.stringify(adapterConfig)}::jsonb,
              updated_at = now()
          WHERE id = ${adjutantAgentId}
        `);

        // Create a controller-path thread. discussionService.create sets
        // useControllerPath=true by default for all new threads (P1-T11). We
        // use a raw insert here to avoid the side-effect chain in
        // discussionService (live events, activity log) that requires a full
        // server context. The thread needs: a discussion row + a
        // threadOrchestrationState row with pendingRun=true.
        const threadRow = await db.execute<{ id: string }>(sql`
          INSERT INTO discussions
            (id, company_id, status, use_controller_path, crew_paused,
             adjutant_enabled, phase, entry_count, entry_seq, created_by)
          VALUES
            (gen_random_uuid(), ${companyId}, 'active', true, false,
             true, 'discuss', 0, 0, 'thread-v2-e2e-test')
          RETURNING id
        `);
        threadId = firstId(threadRow);
        expect(threadId).toBeTruthy();

        // Ensure a thread orchestration state row exists. The production path
        // calls threadOrchestrationService(db).ensureController(threadId) as
        // a best-effort side effect of discussionService.create; we replicate
        // the intent here with an explicit upsert.
        await db.execute(sql`
          INSERT INTO thread_orchestration_state
            (thread_id, pending_run, hop_count, updated_at)
          VALUES
            (${threadId}, false, 0, now())
          ON CONFLICT (thread_id) DO NOTHING
        `);

        // Seed a human entry — converged-ish content that should prompt the
        // Adjutant to act (post an agent entry or scope proposal) rather than
        // exit silently. The content is deliberately concrete so the Adjutant
        // does not apply the "casual chat" heuristic that causes a silent exit.
        await db.execute(sql`
          INSERT INTO discussion_entries
            (id, discussion_id, input_type, raw_content, extraction_status,
             created_by, seq)
          VALUES (
            gen_random_uuid(),
            ${threadId},
            'write',
            'Let''s add CSV export to the budget page — filtered view, one row per cost event. Let''s build it.',
            'skipped',
            'thread-v2-e2e-test',
            1
          )
        `);

        // Bump the discussion's entry_seq + entry_count so the Adjutant sees
        // new human input (the wait-or-act heuristic checks for human entries
        // since last Adjutant action — seq 0→1 means there is new input).
        await db.execute(sql`
          UPDATE discussions
          SET entry_seq = 1, entry_count = 1, last_entry_at = now()
          WHERE id = ${threadId}
        `);

        // Mark the orchestration state as pendingRun=true so runControllerSweep
        // picks it up. In production this is set by the inline drain in
        // thread-events.ts when a human entry lands; we set it directly here
        // to drive the sweep deterministically (no debounce wait).
        await db.execute(sql`
          UPDATE thread_orchestration_state
          SET pending_run = true, updated_at = now()
          WHERE thread_id = ${threadId}
        `);
      } catch (err) {
        setupError = err;
        // eslint-disable-next-line no-console
        console.error("[thread-v2-real-e2e] setup failed:", err);
      }
    }, 60_000);

    afterAll(async () => {
      // Best-effort cleanup: cascade-delete the test company.
      if (db && companyId) {
        try {
          await db.execute(sql`DELETE FROM companies WHERE id = ${companyId}`);
        } catch {
          /* swallow — test isolation, not critical */
        }
      }
    }, 30_000);

    it(
      "Adjutant posts a real agent entry after runControllerSweep claims the pending run",
      async () => {
        if (setupError) {
          throw new Error(
            `Thread v2 real-agent E2E setup failed — cannot assert real output: ${String(setupError)}`,
          );
        }

        // Record the entry count before the sweep so the assertion can detect
        // NEW entries created by the Adjutant (not the human seed entry above).
        const beforeRows = await db.execute<{ count: string }>(sql`
          SELECT COUNT(*)::text AS count
          FROM discussion_entries
          WHERE discussion_id = ${threadId}
            AND input_type IN ('agent', 'scope_proposal')
        `);
        const countBefore = parseInt(
          firstRow<{ count: string }>(beforeRows)?.count ?? "0",
          10,
        );

        // Drive the controller deterministically: runControllerSweep claims the
        // pendingRun, calls runController, which invokes the Adjutant via
        // makeControllerAdjutantRunner → runAoaAgent (real claude_local).
        // The production adapter spawns the claude CLI subprocess synchronously
        // (runAoaAgent awaits the adapter.execute call), so by the time
        // runControllerSweep returns the agent run is complete or has failed.
        await runControllerSweep(db);

        // Poll for a NEW agent-authored discussion_entries row on the thread.
        // Timeout is 120 seconds: generous enough for a real claude_local run
        // (including model latency) but bounded so a hung subprocess doesn't
        // stall CI indefinitely.
        const agentEntry = await pollUntil<{ id: string; input_type: string }>(
          async () => {
            const result = await db.execute<{
              id: string;
              input_type: string;
            }>(sql`
              SELECT id, input_type
              FROM discussion_entries
              WHERE discussion_id = ${threadId}
                AND input_type IN ('agent', 'scope_proposal')
                AND author_agent_id = ${adjutantAgentId}
              LIMIT 1
            `);
            const row = firstRow<{ id: string; input_type: string }>(result);
            // Only return the row if it's genuinely new (author_agent_id match
            // is sufficient — the human seed entry has a different input_type
            // and no author_agent_id so it cannot match).
            return row ?? null;
          },
          120_000,
          2_000,
        );

        // Hard bar: at least one real Adjutant entry appeared.
        expect(
          agentEntry,
          "No agent-authored discussion_entries row appeared within 120 seconds for " +
          `thread ${threadId} / Adjutant ${adjutantAgentId}. ` +
          "Verify: (1) the Adjutant is configured with claude_local and valid creds; " +
          "(2) the claude CLI is on PATH; (3) runControllerSweep claimed the pending run. " +
          "See docs/qa/thread-v2-release-checklist.md § Preconditions.",
        ).toBeTruthy();

        // Weak content assertion: the entry must be one of the expected types.
        // We do NOT assert specific content — the LLM is non-deterministic.
        // The hard bar is 'a real agent entry appeared', not 'it said X'.
        expect(
          ["agent", "scope_proposal"].includes(agentEntry!.input_type),
          `Expected input_type in ('agent','scope_proposal'), got '${agentEntry!.input_type}'`,
        ).toBe(true);

        // Guard: the count of agent entries must have increased (i.e., the
        // entry was newly created by this test run, not a leftover).
        const afterRows = await db.execute<{ count: string }>(sql`
          SELECT COUNT(*)::text AS count
          FROM discussion_entries
          WHERE discussion_id = ${threadId}
            AND input_type IN ('agent', 'scope_proposal')
        `);
        const countAfter = parseInt(
          firstRow<{ count: string }>(afterRows)?.count ?? "0",
          10,
        );
        expect(
          countAfter,
          `Expected agent entry count to increase from ${countBefore}. Got ${countAfter}. ` +
          "The Adjutant may have applied the silent-exit heuristic — ensure the human seed " +
          "entry is concrete enough to trigger a response.",
        ).toBeGreaterThan(countBefore);
      },
      150_000, // 150-second test timeout (120s poll + 30s overhead)
    );
  },
);
