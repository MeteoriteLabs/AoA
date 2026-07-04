/**
 * ask_founder dogfood — real-Postgres integration across all scenarios.
 *
 * Proves, against a REAL embedded Postgres (no mocks), that the MCP
 * `handleAskFounder` tool works end-to-end through the real
 * `agentRuntimeDecisionService` + real DB rows + real hub emission. We build a
 * REAL ToolContext (with `services.agentsSvc = agentService(db)`), seed a real
 * `heartbeat_runs` row for `runId`, and observe the concrete side-effects:
 *   - a real `agent_runtime_decisions` row (kind='work_question'),
 *   - a real `notifications` (hub) row in the `waiting_on_you` lane, and
 *   - the handler's blocked promise resolving once the founder answers/cancels.
 *
 * Scenarios:
 *   1. Round-trip, free-text, routing bypass ON (flag unset)   → answered {text}
 *   2. Round-trip, options, routing bypass ON                   → answered {value}
 *   3. Round-trip, routing ENABLED (runtimeDecisionRoutingEnabled=true)
 *        → IDENTICAL behaviour. Orthogonality proof (see comment on the case).
 *   4. Park on run-terminal: block, terminate run + cancelActiveForRun
 *        → { answered:false, status:"parked" }, decision cancelled + hub closed.
 *   5. Zombie guard: TERMINAL run → createPrompt throws conflict, no decision.
 *   6. Actor guard: non-agent actor, and agent actor with runId:null
 *        → both err(403), no decision.
 *
 * Each scenario runs in an isolated company/agent/run triple so they are fully
 * independent despite sharing one embedded-postgres instance.
 *
 * Windows-skip: CI's `runneradmin` account can't start embedded-postgres
 * (Issue #114). Linux CI runs it; to run locally on Windows set
 * AOA_RUN_WIN_INTEGRATION=1. Modeled on w1c-inbox-dispatch-approval.integration.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { applyPendingMigrations, createDb, type Db } from "@armyofagents/db";
import { companyService } from "../services/companies.js";
import { agentService } from "../services/agents.js";
import { agentRuntimeDecisionService } from "../services/agent-runtime-decisions.js";
import { handleAskFounder } from "../mcp/tools/ask-founder-tool.js";
import type { ProtocolActor, ToolContext } from "../mcp/tools/types.js";

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

// Distinct base port from w1b (59600) / w1c (59603) so all three can run together.
const PORT = 59900 + Math.floor(Math.random() * 300);

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  return ((result as { rows?: Array<Record<string, unknown>> }).rows ?? []) as Array<
    Record<string, unknown>
  >;
}

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Seed a company + founder user + founder user_roles row + reuse the auto-seeded
 * 'Engineer' AoA crew agent. The founder row is REQUIRED: emitHubItem() resolves
 * the hub-item owner via getFounderUserId() (reads user_roles role='founder') and
 * emit() THROWS ("company has no human owner") without one — the hub row would
 * then never persist and the waiting_on_you assertion would fail.
 *
 * `routingEnabled` sets the agent's runtimeConfig.runtimeDecisionRoutingEnabled
 * (Scenario 3). handleAskFounder never reads it — this proves orthogonality.
 */
async function seedCompanyAndAgent(
  label: string,
  opts: { routingEnabled?: boolean } = {},
): Promise<{ companyId: string; agentId: string }> {
  const company = await companyService(db).create({ name: `AskFounder ${label} Co` } as never);
  const companyId = company.id;

  const founderUserId = `founder-${randomUUID()}`;
  await db.execute(sql`
    INSERT INTO "user" (id, name, email, created_at, updated_at)
    VALUES (${founderUserId}, ${`Founder ${label}`}, ${`${founderUserId}@example.test`}, now(), now())
  `);
  await db.execute(sql`
    INSERT INTO user_roles (id, company_id, user_id, role)
    VALUES (gen_random_uuid(), ${companyId}, ${founderUserId}, 'founder')
  `);

  // Reuse the auto-seeded 'Engineer' crew agent (companyService.create seeds the
  // AoA crew). Set its adapterType + runtimeConfig so getById() returns the shape
  // handleAskFounder reads (agent.adapterType) and the routing flag under test.
  const engRows = rowsOf(
    await db.execute(sql`
      SELECT id FROM agents
      WHERE company_id = ${companyId} AND kind = 'aoa' AND name = 'Engineer' AND status <> 'terminated'
      LIMIT 1
    `),
  );
  let agentId: string;
  if (engRows.length > 0) {
    agentId = String(engRows[0].id);
    await db.execute(sql`
      UPDATE agents
      SET adapter_type = 'claude_local',
          runtime_config = ${JSON.stringify({ runtimeDecisionRoutingEnabled: Boolean(opts.routingEnabled) })}::jsonb
      WHERE id = ${agentId}
    `);
  } else {
    const inserted = rowsOf(
      await db.execute(sql`
        INSERT INTO agents (id, company_id, name, kind, status, adapter_type, runtime_config)
        VALUES (gen_random_uuid(), ${companyId}, 'Engineer', 'aoa', 'idle', 'claude_local',
          ${JSON.stringify({ runtimeDecisionRoutingEnabled: Boolean(opts.routingEnabled) })}::jsonb)
        RETURNING id
      `),
    );
    agentId = String(inserted[0].id);
  }
  return { companyId, agentId };
}

/**
 * Seed a heartbeat_runs row (getRunStatus reads THIS table, not internal_agent_runs).
 * `status` controls the R1 zombie guard: 'running' is live, terminal statuses
 * ('succeeded'/'failed'/'cancelled'/'timed_out') make createPrompt throw.
 */
async function seedHeartbeatRun(
  companyId: string,
  agentId: string,
  status = "running",
): Promise<string> {
  const [run] = rowsOf(
    await db.execute(sql`
      INSERT INTO heartbeat_runs (id, company_id, agent_id, status, invocation_source)
      VALUES (gen_random_uuid(), ${companyId}, ${agentId}, ${status}, 'on_demand')
      RETURNING id
    `),
  );
  return String(run.id);
}

/** Build a REAL ToolContext for an agent actor with an active run. */
function buildAgentCtx(
  companyId: string,
  agentId: string,
  runId: string | null,
): ToolContext {
  const actor: ProtocolActor = {
    userId: agentId,
    companyId,
    keyId: null,
    source: "agent",
    agentId,
    runId,
  };
  // handleAskFounder only reads ctx.actor, ctx.companyId, ctx.db, and
  // ctx.services.agentsSvc.getById — the remaining ToolContext fields are never
  // touched by this handler, so no-op stubs (typed-cast) satisfy the type.
  return {
    db,
    companyId,
    actor,
    scope: { kind: "founder", userId: agentId },
    services: { agentsSvc: agentService(db) } as unknown as ToolContext["services"],
    actorInfo: {} as ToolContext["actorInfo"],
    resolveRole: async () => "founder",
    resolveScopedAgentIds: async () => null,
  };
}

/** Poll the DB for the newest work_question decision minted for a run. */
async function waitForWorkQuestionDecision(
  companyId: string,
  runId: string,
  timeoutMs = 5_000,
): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  for (;;) {
    const rows = rowsOf(
      await db.execute(sql`
        SELECT id, kind, status, nonce, source_revision, options, answer_payload
        FROM agent_runtime_decisions
        WHERE company_id = ${companyId} AND run_id = ${runId} AND kind = 'work_question'
        ORDER BY created_at DESC
        LIMIT 1
      `),
    );
    if (rows.length > 0) return rows[0];
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`work_question decision never appeared for run ${runId}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Assert a waiting_on_you hub (notifications) row exists for a decision. */
async function findHubRowForDecision(companyId: string, decisionId: string) {
  return rowsOf(
    await db.execute(sql`
      SELECT id, semantic_type, status, source_type
      FROM notifications
      WHERE company_id = ${companyId} AND source_type = 'runtime_decision' AND source_id = ${decisionId}
    `),
  );
}

// ── embedded-postgres lifecycle ───────────────────────────────────────────────

beforeAll(async () => {
  try {
    dataDir = await mkdtemp(join(tmpdir(), "aoa-ask-founder-dogfood-integ-"));
    const { default: EmbeddedPostgres } = (await import("embedded-postgres")) as {
      default: EmbeddedPostgresCtor;
    };
    pg = new EmbeddedPostgres({
      databaseDir: join(dataDir, "db"),
      user: "test",
      password: "test",
      port: PORT,
      persistent: false,
      // Force UTF-8 so migration SQL containing non-Latin1 chars (e.g. '→' in a
      // comment) applies — initdb otherwise inherits WIN1252 on Windows and the
      // `postgres` DB rejects those bytes.
      initdbFlags: ["--encoding=UTF8", "--locale=C"],
    });
    await pg.initialise();
    await pg.start();
    const connectionString = `postgres://test:test@localhost:${PORT}/postgres`;
    await applyPendingMigrations(connectionString);
    db = createDb(connectionString);
  } catch (err) {
    setupError = err;
    // eslint-disable-next-line no-console
    console.error("[ask-founder-dogfood] embedded-postgres setup failed:", err);
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

// ── test suite ────────────────────────────────────────────────────────────────

// Linux CI runs it; Windows CI skips (embedded-pg fails on the runneradmin
// runner — Issue #114). Run locally on Windows with AOA_RUN_WIN_INTEGRATION=1.
describe.skipIf(
  process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1",
)("ask_founder dogfood (real Postgres)", () => {
  // ── Scenario 1: round-trip, free-text, routing bypass ON ──────────────────

  it("Scenario 1 — free-text round-trip (routing bypass ON): asks, founder answers, returns {text}", async () => {
    if (setupError) throw new Error(String(setupError));

    const { companyId, agentId } = await seedCompanyAndAgent("S1");
    const runId = await seedHeartbeatRun(companyId, agentId, "running");
    const ctx = buildAgentCtx(companyId, agentId, runId);
    const svc = agentRuntimeDecisionService(db);

    // Call the tool but do NOT await — it blocks in waitForAnswer.
    const p = handleAskFounder(ctx, { question: "Approach A or B?" });

    // A real work_question decision row appeared for this run.
    const decision = await waitForWorkQuestionDecision(companyId, runId);
    const decisionId = String(decision.id);
    expect(String(decision.kind)).toBe("work_question");
    expect(["created", "shown"]).toContain(String(decision.status));

    // A real hub (notifications) row surfaced it in the waiting_on_you lane.
    const hub = await findHubRowForDecision(companyId, decisionId);
    expect(hub.length).toBeGreaterThanOrEqual(1);
    expect(String(hub[0].semantic_type)).toBe("agent_runtime_decision"); // → waiting_on_you lane
    expect(String(hub[0].status)).toBe("open");

    // Founder answers via the real service (run still running so it's not stranded).
    await svc.answerPrompt({
      companyId,
      decisionId,
      actorUserId: "local-board",
      expectedSourceRevision: Number(decision.source_revision),
      nonce: String(decision.nonce),
      kind: "work_question",
      answer: { text: "A" },
    });

    const res = await p;
    expect(res).toEqual({ ok: true, data: { answered: true, answer: { text: "A" } } });

    // The decision is durably answered.
    const [after] = rowsOf(
      await db.execute(sql`SELECT status, answer_payload FROM agent_runtime_decisions WHERE id = ${decisionId}`),
    );
    expect(String(after.status)).toBe("answered");
    expect(after.answer_payload).toEqual({ text: "A" });
  });

  // ── Scenario 2: round-trip, options ───────────────────────────────────────

  it("Scenario 2 — options round-trip: persists options, founder answers {value}, returns {value}", async () => {
    if (setupError) throw new Error(String(setupError));

    const { companyId, agentId } = await seedCompanyAndAgent("S2");
    const runId = await seedHeartbeatRun(companyId, agentId, "running");
    const ctx = buildAgentCtx(companyId, agentId, runId);
    const svc = agentRuntimeDecisionService(db);

    const options = [
      { label: "Postgres", value: "pg" },
      { label: "SQLite", value: "sqlite" },
    ];
    const p = handleAskFounder(ctx, { question: "Which database?", options });

    const decision = await waitForWorkQuestionDecision(companyId, runId);
    const decisionId = String(decision.id);
    // The decision persisted the options array.
    expect(decision.options).toEqual(options);

    const hub = await findHubRowForDecision(companyId, decisionId);
    expect(hub.length).toBeGreaterThanOrEqual(1);
    expect(String(hub[0].semantic_type)).toBe("agent_runtime_decision");

    await svc.answerPrompt({
      companyId,
      decisionId,
      actorUserId: "local-board",
      expectedSourceRevision: Number(decision.source_revision),
      nonce: String(decision.nonce),
      kind: "work_question",
      answer: { value: "pg" },
    });

    const res = await p;
    expect(res).toEqual({ ok: true, data: { answered: true, answer: { value: "pg" } } });
  });

  // ── Scenario 3: routing ENABLED — IDENTICAL behaviour (orthogonality proof) ─

  it("Scenario 3 — routing ENABLED: ask_founder behaves IDENTICALLY (bypass flag gates permission, NOT work_question)", async () => {
    if (setupError) throw new Error(String(setupError));

    // Orthogonality: runtimeConfig.runtimeDecisionRoutingEnabled gates the
    // *permission* runtime-decision bridge (PreToolUse hooks in the adapter
    // runtime — packages/adapter-utils/src/types.ts:313). handleAskFounder /
    // createPrompt / the work_question path NEVER read that flag, so flipping it
    // ON must not change ask_founder at all. This case seeds routingEnabled=true
    // and asserts the SAME work_question create + answerable round-trip as S1.
    const { companyId, agentId } = await seedCompanyAndAgent("S3", { routingEnabled: true });

    // Sanity: the flag is actually persisted true on the agent under test.
    const [agentRow] = rowsOf(
      await db.execute(sql`SELECT runtime_config FROM agents WHERE id = ${agentId}`),
    );
    expect((agentRow.runtime_config as { runtimeDecisionRoutingEnabled?: boolean }).runtimeDecisionRoutingEnabled).toBe(true);

    const runId = await seedHeartbeatRun(companyId, agentId, "running");
    const ctx = buildAgentCtx(companyId, agentId, runId);
    const svc = agentRuntimeDecisionService(db);

    const p = handleAskFounder(ctx, { question: "Ship it now?" });

    const decision = await waitForWorkQuestionDecision(companyId, runId);
    const decisionId = String(decision.id);
    expect(String(decision.kind)).toBe("work_question"); // still work_question, unaffected by routing flag

    const hub = await findHubRowForDecision(companyId, decisionId);
    expect(hub.length).toBeGreaterThanOrEqual(1);
    expect(String(hub[0].semantic_type)).toBe("agent_runtime_decision");

    await svc.answerPrompt({
      companyId,
      decisionId,
      actorUserId: "local-board",
      expectedSourceRevision: Number(decision.source_revision),
      nonce: String(decision.nonce),
      kind: "work_question",
      answer: { text: "yes" },
    });

    const res = await p;
    expect(res).toEqual({ ok: true, data: { answered: true, answer: { text: "yes" } } });
  });

  // ── Scenario 4: park on run-terminal ──────────────────────────────────────

  it("Scenario 4 — parks gracefully when the run goes terminal: cancelActiveForRun cancels the decision + closes the hub item", async () => {
    if (setupError) throw new Error(String(setupError));

    const { companyId, agentId } = await seedCompanyAndAgent("S4");
    const runId = await seedHeartbeatRun(companyId, agentId, "running");
    const ctx = buildAgentCtx(companyId, agentId, runId);
    const svc = agentRuntimeDecisionService(db);

    const p = handleAskFounder(ctx, { question: "Blocked — need a decision" });

    const decision = await waitForWorkQuestionDecision(companyId, runId);
    const decisionId = String(decision.id);
    const hubBefore = await findHubRowForDecision(companyId, decisionId);
    expect(hubBefore.length).toBeGreaterThanOrEqual(1);
    expect(String(hubBefore[0].status)).toBe("open");

    // Terminate the run, then cancel its active decisions (what heartbeat's
    // teardown does). The tool's ~1s waitForAnswer poll then sees status
    // 'cancelled' → throws RuntimeDecisionCancelledError → returns "parked".
    await db.execute(sql`UPDATE heartbeat_runs SET status = 'cancelled' WHERE id = ${runId}`);
    const { cancelled } = await svc.cancelActiveForRun({
      companyId,
      runId,
      reason: "run ended",
    });
    expect(cancelled).toBe(1);

    const res = await p;
    expect(res).toEqual({
      ok: true,
      data: { answered: false, status: "parked", note: "parked for founder" },
    });

    // The decision row is cancelled and its hub item is closed (not open).
    const [after] = rowsOf(
      await db.execute(sql`SELECT status FROM agent_runtime_decisions WHERE id = ${decisionId}`),
    );
    expect(String(after.status)).toBe("cancelled");
    const hubAfter = rowsOf(
      await db.execute(sql`
        SELECT status FROM notifications
        WHERE company_id = ${companyId} AND source_type = 'runtime_decision' AND source_id = ${decisionId}
      `),
    );
    expect(hubAfter.length).toBeGreaterThanOrEqual(1);
    expect(String(hubAfter[0].status)).not.toBe("open"); // reconciled/archived on the terminal transition
  });

  // ── Scenario 5: zombie guard (terminal run) ───────────────────────────────

  it("Scenario 5 — zombie guard: a TERMINAL run rejects (createPrompt throws), no decision minted", async () => {
    if (setupError) throw new Error(String(setupError));

    const { companyId, agentId } = await seedCompanyAndAgent("S5");
    // Seed a run that is ALREADY terminal.
    const runId = await seedHeartbeatRun(companyId, agentId, "succeeded");
    const ctx = buildAgentCtx(companyId, agentId, runId);

    // createPrompt's R1 zombie guard throws conflict("run is terminal").
    await expect(handleAskFounder(ctx, { question: "Am I a zombie?" })).rejects.toThrow(
      /run is terminal/i,
    );

    // No decision row was minted for the terminal run.
    const decisions = rowsOf(
      await db.execute(sql`
        SELECT id FROM agent_runtime_decisions WHERE company_id = ${companyId} AND run_id = ${runId}
      `),
    );
    expect(decisions).toHaveLength(0);
  });

  // ── Scenario 6: actor guard ───────────────────────────────────────────────

  it("Scenario 6 — actor guard: non-agent actor AND agent-with-null-run both err(403), no decision", async () => {
    if (setupError) throw new Error(String(setupError));

    const { companyId, agentId } = await seedCompanyAndAgent("S6");
    const runId = await seedHeartbeatRun(companyId, agentId, "running");

    // (a) Non-agent actor (source "board") → 403, even with a valid run.
    const boardCtx = buildAgentCtx(companyId, agentId, runId);
    (boardCtx.actor as { source: string }).source = "board";
    const boardRes = await handleAskFounder(boardCtx, { question: "Board asking?" });
    expect(boardRes).toEqual({
      ok: false,
      status: 403,
      code: -32003,
      message: "ask_founder requires an active run",
    });

    // (b) Agent actor but runId null → 403.
    const noRunCtx = buildAgentCtx(companyId, agentId, null);
    const noRunRes = await handleAskFounder(noRunCtx, { question: "No run here" });
    expect(noRunRes).toEqual({
      ok: false,
      status: 403,
      code: -32003,
      message: "ask_founder requires an active run",
    });

    // Neither minted a decision.
    const decisions = rowsOf(
      await db.execute(sql`
        SELECT id FROM agent_runtime_decisions WHERE company_id = ${companyId} AND run_id = ${runId}
      `),
    );
    expect(decisions).toHaveLength(0);
  });
});
