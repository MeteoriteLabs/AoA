/**
 * #197 / #198 — Real-DB proof of the action-commit idempotency substrate.
 *
 * Boots embedded-postgres, applies all migrations (incl. 0145 + 0146), then
 * verifies what the sequence-mock suites structurally cannot:
 *   1. the three partial unique indexes actually build in Postgres;
 *   2. the discussion_entries partial unique index ENFORCES a duplicate
 *      source_action_id — AND the real postgres-js error matches
 *      `isUniqueViolation(err, "..._source_action_uq")` (the exact C1 failure
 *      mode: postgres-js puts the index name on `cause.constraint_name`, not
 *      `constraint`). NULL source_action_id is exempt (partial predicate).
 *   3. the artifacts partial unique index enforces + matches the helper.
 *   4. proposeThreadAction dedups a re-proposed run-independent key cross-run
 *      via onConflictDoNothing against the real (companyId, idempotencyKey)
 *      unique index, returning the same row (same action.id).
 *   5. (#198) the thread_scope_items partial unique index ENFORCES a duplicate
 *      source_action_id (the add_scope_item commit guarantee) + NULL exemption.
 *   6. (#198) a key-only action type (advance_phase) dedups end-to-end at the
 *      (companyId, idempotencyKey) unique index — the cross-run guarantee for
 *      the types with no source_action_id side-effect.
 *
 * Skipped on Windows (embedded-postgres / migration-chain issue — Issue #114);
 * Linux CI is the authoritative gate. Modeled on aoa-backend.integration.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  applyPendingMigrations,
  createDb,
  threadScopeItems,
  type Db,
} from "@armyofagents/db";
import { companyService } from "../services/companies.js";
import { discussionService } from "../services/discussions.js";
import { artifactService } from "../services/artifacts.js";
import {
  threadAgentActionService,
  reapStaleThreadAgentActions,
} from "../services/thread-agent-actions.js";
import {
  captureFreshnessSnapshot,
  type ThreadFreshnessSnapshot,
} from "../services/thread-agent-action-freshness.js";
import { isUniqueViolation } from "../services/db-errors.js";
import {
  buildAdvancePhaseIdempotencyKey,
  buildConveneWakeupDedupKey,
  buildPostReplyIdempotencyKey,
} from "../services/internal-agent/tools/thread-action-keys.js";

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
}) => EmbeddedPostgresInstance;

let pg: EmbeddedPostgresInstance | null = null;
let dataDir = "";
let db: Db;
// Module-scoped so the two-connection concurrency proof (Test 9) can spin up a
// SECOND independent postgres pool against the SAME embedded-postgres instance via
// createDb(connectionString). createDb() opens a fresh postgres() pool per call, so
// this yields genuine cross-connection contention (not two handles sharing a socket).
let connectionString = "";
let setupError: unknown = null;
let companyId = "";
let threadId = "";
// A real agent row — the post_reply commit handler blocks on a null agentId and
// discussion_entries.author_agent_id is an FK, so the cross-run e2e needs one.
let agentId = "";

const PORT = 59000 + Math.floor(Math.random() * 1000);

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  return ((result as { rows?: Array<Record<string, unknown>> }).rows ?? []) as Array<
    Record<string, unknown>
  >;
}

beforeAll(async () => {
  try {
    dataDir = await mkdtemp(join(tmpdir(), "aoa-thread-idem-integ-"));
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
    connectionString = `postgres://test:test@localhost:${PORT}/postgres`;
    await applyPendingMigrations(connectionString);
    db = createDb(connectionString);

    // Seed a company (eager Commander/config) + a thread.
    const company = await companyService(db).create({ name: "Idempotency Co" } as never);
    companyId = company.id;
    const [thread] = rowsOf(
      await db.execute(sql`
        INSERT INTO discussions (id, company_id, status, created_by)
        VALUES (gen_random_uuid(), ${companyId}, 'active', 'integration-test')
        RETURNING id
      `),
    );
    threadId = String(thread.id);

    // Seed an agent for the post_reply commit path (author_agent_id FK + the
    // handler's non-null agentId guard). Only company_id + name are NOT NULL.
    const [agent] = rowsOf(
      await db.execute(sql`
        INSERT INTO agents (id, company_id, name)
        VALUES (gen_random_uuid(), ${companyId}, 'Cross-Run Agent')
        RETURNING id
      `),
    );
    agentId = String(agent.id);
  } catch (err) {
    setupError = err;
    // eslint-disable-next-line no-console
    console.error("[thread-commit-idempotency] embedded-postgres setup failed:", err);
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

describe.skipIf(process.platform === "win32")("thread-commit idempotency (real DB)", () => {
  // ── Harness helpers (PR-B) ─────────────────────────────────────────────────
  // thread_agent_actions.run_id is an FK to internal_agent_runs, so the cross-run
  // e2e needs real run rows. internal_agent_runs requires company_id (FK) +
  // trigger_type + trigger_source (both NOT NULL, no default); status defaults to
  // 'running' and id/created_at are auto-filled.
  async function seedRun(): Promise<string> {
    const [run] = rowsOf(
      await db.execute(sql`
        INSERT INTO internal_agent_runs (id, company_id, trigger_type, trigger_source)
        VALUES (gen_random_uuid(), ${companyId}, 'event', 'integration-test')
        RETURNING id
      `),
    );
    return String(run.id);
  }

  // Capture a REAL freshness snapshot via the production primitive so seeded
  // action rows carry a snapshot the commit path's compareFreshnessSnapshot
  // recognizes as fresh (matching the live thread state). A hand-rolled `{}`
  // would be detected as `snapshot_unavailable` and the action suppressed.
  async function captureSnapshot(tid: string): Promise<ThreadFreshnessSnapshot> {
    return captureFreshnessSnapshot(db as never, tid);
  }

  it("builds the three partial unique indexes", async () => {
    if (setupError) throw new Error(String(setupError));
    const names = new Set(
      rowsOf(
        await db.execute(sql`
          SELECT indexname FROM pg_indexes
          WHERE indexname IN (
            'discussion_entries_source_action_uq',
            'artifacts_source_action_uq',
            'thread_scope_items_source_action_uq'
          )
        `),
      ).map((r) => String(r.indexname)),
    );
    expect(names.has("discussion_entries_source_action_uq")).toBe(true);
    expect(names.has("artifacts_source_action_uq")).toBe(true);
    expect(names.has("thread_scope_items_source_action_uq")).toBe(true);
  });

  it("enforces discussion_entries source_action_id; the real driver error matches isUniqueViolation; NULLs exempt", async () => {
    if (setupError) throw new Error(String(setupError));
    const actionId = randomUUID();
    const svc = discussionService(db);

    // First write succeeds.
    await svc.addEntry(
      companyId,
      threadId,
      { inputType: "write", rawContent: "first", sourceActionId: actionId },
      "integration-test",
    );

    // Second write with the SAME source_action_id is rejected by the partial index.
    let caught: unknown;
    try {
      await svc.addEntry(
        companyId,
        threadId,
        { inputType: "write", rawContent: "dup", sourceActionId: actionId },
        "integration-test",
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    // The C1 proof: the REAL postgres-js error (cause.constraint_name) matches.
    expect(isUniqueViolation(caught, "discussion_entries_source_action_uq")).toBe(true);

    // Two NULL-source_action_id entries both succeed (partial predicate exempts them).
    await svc.addEntry(companyId, threadId, { inputType: "write", rawContent: "n1" }, "integration-test");
    await svc.addEntry(companyId, threadId, { inputType: "write", rawContent: "n2" }, "integration-test");
  });

  it("enforces artifacts source_action_id; the real driver error matches isUniqueViolation", async () => {
    if (setupError) throw new Error(String(setupError));
    const actionId = randomUUID();
    const svc = artifactService(db);

    await svc.create(companyId, "integration-test", {
      title: "Spec",
      type: "document",
      source: "agent",
      content: "# Plan",
      sourceActionId: actionId,
    });

    let caught: unknown;
    try {
      await svc.create(companyId, "integration-test", {
        title: "Spec (dup)",
        type: "document",
        source: "agent",
        content: "# Plan",
        sourceActionId: actionId,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(isUniqueViolation(caught, "artifacts_source_action_uq")).toBe(true);
  });

  it("enforces thread_scope_items source_action_id; the real driver error matches isUniqueViolation; NULLs exempt", async () => {
    if (setupError) throw new Error(String(setupError));

    // The partial unique index lives on (company_id, source_action_id); the scope
    // item only needs a valid scope_version_id FK to satisfy NOT NULL. Seed one
    // scope version directly (non-'draft' status so it never collides with the
    // thread_scope_versions_one_draft_uq partial index that the add_scope_item
    // commit path relies on). The scope_version_id supplies the FK target; the
    // index under test is wholly independent of which version the item belongs to.
    const [scopeVersion] = rowsOf(
      await db.execute(sql`
        INSERT INTO thread_scope_versions
          (id, company_id, thread_id, version_number, status,
           source_start_seq, source_end_seq, summary, created_by)
        VALUES
          (gen_random_uuid(), ${companyId}, ${threadId}, 1, 'accepted',
           0, 0, 'idempotency probe version', 'integration-test')
        RETURNING id
      `),
    );
    const scopeVersionId = String(scopeVersion.id);
    const actionId = randomUUID();

    // First gated scope item succeeds.
    await db.insert(threadScopeItems).values({
      companyId,
      scopeVersionId,
      kind: "decision",
      status: "draft",
      title: "x",
      sourceActionId: actionId,
    });

    // Second with the SAME (company_id, source_action_id) is rejected by the
    // partial index — and the REAL postgres-js error matches the helper.
    let caught: unknown;
    try {
      await db.insert(threadScopeItems).values({
        companyId,
        scopeVersionId,
        kind: "decision",
        status: "draft",
        title: "x (dup)",
        sourceActionId: actionId,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(isUniqueViolation(caught, "thread_scope_items_source_action_uq")).toBe(true);

    // Two NULL-source_action_id items both succeed (partial predicate exempts them).
    await db.insert(threadScopeItems).values({
      companyId,
      scopeVersionId,
      kind: "decision",
      status: "draft",
      title: "n1",
      sourceActionId: null,
    });
    await db.insert(threadScopeItems).values({
      companyId,
      scopeVersionId,
      kind: "decision",
      status: "draft",
      title: "n2",
      sourceActionId: null,
    });
  });

  it("dedups a re-proposed post_reply stable key cross-run (one action row)", async () => {
    if (setupError) throw new Error(String(setupError));
    const svc = threadAgentActionService(db);
    const key = buildPostReplyIdempotencyKey({
      threadId,
      agentId: null,
      parentEntryId: null,
      content: "Status: green.",
      turnAnchor: "1",
    });
    // Dedup is on (companyId, idempotencyKey), independent of runId. Pass runId=null
    // (run_id is a nullable FK to internal_agent_runs) so the test doesn't need a
    // seeded run row — the point is that the SAME stable key dedups across proposes.
    const a = (await svc.proposeThreadAction({
      companyId,
      threadId,
      runId: null,
      agentId: null,
      actionType: "post_reply",
      payload: { rawContent: "Status: green." },
      idempotencyKey: key,
    })) as { id: string };
    // A re-propose of the identical reply → same stable key → the real unique index
    // rejects the insert (onConflictDoNothing) → the existing row is returned, NOT a
    // new one.
    const b = (await svc.proposeThreadAction({
      companyId,
      threadId,
      runId: null,
      agentId: null,
      actionType: "post_reply",
      payload: { rawContent: "Status: green." },
      idempotencyKey: key,
    })) as { id: string };

    expect(b.id).toBe(a.id);
    const count = rowsOf(
      await db.execute(sql`
        SELECT count(*)::int AS n FROM thread_agent_actions
        WHERE company_id = ${companyId} AND idempotency_key = ${key}
      `),
    );
    expect(Number(count[0].n)).toBe(1);
  });

  it("dedups a re-proposed key-only action (advance_phase) cross-run (one action row)", async () => {
    if (setupError) throw new Error(String(setupError));
    // The three key-only action types (advance_phase / convene_agent /
    // create_scope_draft) have NO source_action_id side-effect index — their
    // sole cross-run idempotency guarantee is the proposeThreadAction
    // onConflictDoNothing against (company_id, idempotency_key). By contrast
    // add_scope_item DOES carry a side-effect index (thread_scope_items_source_action_uq,
    // exercised by the thread_scope_items case above), as do post_reply and
    // create_artifact_candidate. post_reply (case 4 above) is a stable-key type
    // that ALSO carries a side-effect index; this case proves the same dedup
    // holds for a key-only type whose only protection is the action-row index.
    const svc = threadAgentActionService(db);
    const key = buildAdvancePhaseIdempotencyKey({
      threadId,
      agentId: null,
      toPhase: "scope",
      turnAnchor: "1",
    });
    const a = (await svc.proposeThreadAction({
      companyId,
      threadId,
      runId: null,
      agentId: null,
      actionType: "advance_phase",
      payload: { toPhase: "scope" },
      idempotencyKey: key,
    })) as { id: string };
    // Re-propose the identical transition from a different (null) run → same
    // stable key → onConflictDoNothing suppresses the insert and the canonical
    // row is re-selected and returned.
    const b = (await svc.proposeThreadAction({
      companyId,
      threadId,
      runId: null,
      agentId: null,
      actionType: "advance_phase",
      payload: { toPhase: "scope" },
      idempotencyKey: key,
    })) as { id: string };

    expect(b.id).toBe(a.id);
    const count = rowsOf(
      await db.execute(sql`
        SELECT count(*)::int AS n FROM thread_agent_actions
        WHERE company_id = ${companyId} AND idempotency_key = ${key}
      `),
    );
    expect(Number(count[0].n)).toBe(1);
  });

  it("thread-scoped commit drains a prior run's proposed row (cross-run)", async () => {
    if (setupError) throw new Error(String(setupError));
    // A proposed post_reply belongs to runA. The commit is invoked under runB —
    // a DIFFERENT run. Pre-PR-B the SELECT filtered `eq(runId, input.runId)`, so
    // runB would never see runA's row and `committed` would be 0. Thread-scoped
    // selection drains it: any run flushes the thread's pending actions.
    const runA = await seedRun();
    const snap = await captureSnapshot(threadId);
    const actionId = randomUUID();
    // Seed the proposed row directly. agent_id is the real seeded agent (the
    // handler blocks null agentId; author_agent_id is an FK). The freshness column
    // carries the real snapshot so the per-action freshness re-check passes.
    await db.execute(sql`
      INSERT INTO thread_agent_actions
        (id, company_id, thread_id, run_id, agent_id, action_type, status, payload, idempotency_key, freshness)
      VALUES
        (${actionId}, ${companyId}, ${threadId}, ${runA}, ${agentId}, 'post_reply', 'proposed',
         ${JSON.stringify({ rawContent: "cross-run reply" })}::jsonb, ${`k:${actionId}`},
         ${JSON.stringify(snap)}::jsonb)
    `);

    const runB = await seedRun();
    const res = await threadAgentActionService(db).commitThreadAgentActions({
      companyId,
      threadId,
      runId: runB,
    });
    expect(res.committed).toBe(1);

    // Exactly one discussion_entries row was produced for this action (the
    // source_action_id is stamped by the post_reply commit handler).
    const n = rowsOf(
      await db.execute(sql`
        SELECT count(*)::int AS n FROM discussion_entries WHERE source_action_id = ${actionId}
      `),
    );
    expect(Number(n[0].n)).toBe(1);

    // The action row itself is now committed and stamped with the entry it created.
    const committedRow = rowsOf(
      await db.execute(sql`
        SELECT status, committed_entry_id FROM thread_agent_actions WHERE id = ${actionId}
      `),
    );
    expect(String(committedRow[0].status)).toBe("committed");
    expect(committedRow[0].committed_entry_id).toBeTruthy();
  });

  // ── PR-B real-DB proofs (#198) ─────────────────────────────────────────────

  // Test 6 — crash-recovery convergence (THE most important).
  //
  // Reconstruct the exact torn-write a crash leaves behind: a `post_reply` action
  // stranded in `committing` PAST the reaper TTL, with its side-effect entry
  // (the discussion_entries row stamped with source_action_id) ALREADY landed
  // pre-crash. The reaper flips the stranded row committing→failed (+attempt), then
  // a fresh commit re-selects it, re-attempts the entry write, hits the partial
  // unique index (discussion_entries_source_action_uq), and converges via the
  // inner unique-violation branch — re-selecting the existing entry and stamping
  // the action `committed` WITHOUT producing a duplicate. This is the property the
  // whole #197/#198 substrate exists to guarantee: a side effect that landed once
  // can never land twice, even across a crash + reaper + re-commit.
  it("converges a crash-stranded committing row: reaper→failed, re-commit dedups via unique index (no duplicate, ends committed)", async () => {
    if (setupError) throw new Error(String(setupError));
    const svc = threadAgentActionService(db);
    const snap = await captureSnapshot(threadId);
    const actionId = randomUUID();

    // The pre-crash side effect: a discussion_entries row already stamped with
    // this action's id (input_type='agent' + the real seeded agent, matching what
    // the post_reply commit handler writes). discussion_id + source_action_id are
    // what the handler's convergence re-select keys on.
    await db.execute(sql`
      INSERT INTO discussion_entries
        (id, discussion_id, input_type, raw_content, author_agent_id, source_action_id, created_by)
      VALUES
        (gen_random_uuid(), ${threadId}, 'agent', 'pre-crash reply', ${agentId}, ${actionId}, ${`agent:${agentId}`})
    `);

    // The torn action: stuck in 'committing', last touched 20 minutes ago (well
    // past STALE_COMMITTING_TTL_MS = 10m). Carries the real freshness snapshot and
    // a valid post_reply payload so the post-reap re-commit reaches the entry write.
    const runA = await seedRun();
    await db.execute(sql`
      INSERT INTO thread_agent_actions
        (id, company_id, thread_id, run_id, agent_id, action_type, status, payload, idempotency_key, freshness, updated_at)
      VALUES
        (${actionId}, ${companyId}, ${threadId}, ${runA}, ${agentId}, 'post_reply', 'committing',
         ${JSON.stringify({ rawContent: "pre-crash reply" })}::jsonb, ${`k:${actionId}`},
         ${JSON.stringify(snap)}::jsonb, now() - interval '20 minutes')
    `);

    // Reaper flips the stranded committing row → failed (+ bumps attempt_count to 1).
    const reap = await reapStaleThreadAgentActions(db, { now: new Date() });
    expect(reap.reaped).toBeGreaterThanOrEqual(1);

    const afterReap = rowsOf(
      await db.execute(sql`
        SELECT status, attempt_count FROM thread_agent_actions WHERE id = ${actionId}
      `),
    );
    expect(String(afterReap[0].status)).toBe("failed");
    expect(Number(afterReap[0].attempt_count)).toBe(1);

    // Re-commit under a DIFFERENT run. The failed row (attempt 1 < max 3) is
    // re-selected, claimed (fence on attempt_count=1), and the entry re-write hits
    // the unique index → convergence branch.
    const runB = await seedRun();
    const res = await svc.commitThreadAgentActions({ companyId, threadId, runId: runB });
    expect(res.committed).toBe(1);
    expect(res.failed).toBe(0);

    // No duplicate: exactly ONE discussion_entries row carries this source_action_id.
    const entryCount = rowsOf(
      await db.execute(sql`
        SELECT count(*)::int AS n FROM discussion_entries WHERE source_action_id = ${actionId}
      `),
    );
    expect(Number(entryCount[0].n)).toBe(1);

    // The action converged to committed and is stamped with the PRE-EXISTING entry
    // (not stuck/looping in failed/committing).
    const finalRow = rowsOf(
      await db.execute(sql`
        SELECT status, committed_entry_id FROM thread_agent_actions WHERE id = ${actionId}
      `),
    );
    expect(String(finalRow[0].status)).toBe("committed");
    expect(finalRow[0].committed_entry_id).toBeTruthy();
  });

  // Test 7 — poison-row attempt cap (no livelock).
  //
  // A permanently-failing action must NOT be retried forever. We seed a post_reply
  // whose payload.parentEntryId points at a non-existent entry: discussionService
  // .addEntry validates the parent belongs to the thread and throws badRequest. That
  // throw is NOT a unique violation, so the inner catch re-throws → the outer commit
  // catch sets status='failed' + bumps attempt_count (the genuine failed-retry loop,
  // not a terminal blocked_policy first-try). Driven maxAttempts+1 times, the failing
  // row climbs to attempt_count >= max_attempts and the commit SELECT
  // (status='failed' AND attempt_count < max_attempts) stops re-selecting it — while
  // a sibling always-succeeding post_reply on the SAME thread commits normally. This
  // proves the poison pill self-limits without starving healthy work.
  it("caps a permanently-failing action at max_attempts and stops re-selecting it (no livelock); a healthy sibling still commits", async () => {
    if (setupError) throw new Error(String(setupError));
    const svc = threadAgentActionService(db);

    // The healthy action: a valid post_reply that commits on the first tick.
    const goodSnap = await captureSnapshot(threadId);
    const goodId = randomUUID();
    await db.execute(sql`
      INSERT INTO thread_agent_actions
        (id, company_id, thread_id, run_id, agent_id, action_type, status, payload, idempotency_key, freshness)
      VALUES
        (${goodId}, ${companyId}, ${threadId}, NULL, ${agentId}, 'post_reply', 'proposed',
         ${JSON.stringify({ rawContent: "healthy reply" })}::jsonb, ${`k:good:${goodId}`},
         ${JSON.stringify(goodSnap)}::jsonb)
    `);

    // The poison action: a post_reply pointing at a bogus parentEntryId. addEntry
    // throws badRequest("parentEntryId must reference an entry in the same
    // discussion") on EVERY attempt → the commit catch marks it failed + bumps.
    const poisonSnap = await captureSnapshot(threadId);
    const poisonId = randomUUID();
    const bogusParent = randomUUID();
    await db.execute(sql`
      INSERT INTO thread_agent_actions
        (id, company_id, thread_id, run_id, agent_id, action_type, status, payload, idempotency_key, freshness)
      VALUES
        (${poisonId}, ${companyId}, ${threadId}, NULL, ${agentId}, 'post_reply', 'proposed',
         ${JSON.stringify({ rawContent: "poison reply", parentEntryId: bogusParent })}::jsonb,
         ${`k:poison:${poisonId}`}, ${JSON.stringify(poisonSnap)}::jsonb)
    `);

    // Drive commit maxAttempts+1 (=4) times. Each tick the poison row is re-picked
    // while attempt_count < max_attempts (3), fails, and bumps; once it reaches 3 it
    // is no longer re-selected.
    for (let i = 0; i < 4; i++) {
      await svc.commitThreadAgentActions({ companyId, threadId, runId: await seedRun() });
    }

    // Poison row: failed and at/over the cap.
    const poisonRow = rowsOf(
      await db.execute(sql`
        SELECT status, attempt_count, max_attempts FROM thread_agent_actions WHERE id = ${poisonId}
      `),
    );
    expect(String(poisonRow[0].status)).toBe("failed");
    expect(Number(poisonRow[0].attempt_count)).toBeGreaterThanOrEqual(
      Number(poisonRow[0].max_attempts),
    );

    // Direct proof it is NOT in the commit's selected set anymore: the SELECT
    // predicate is (status='proposed') OR (status='failed' AND attempt_count <
    // max_attempts). The poison row matches neither.
    const selectable = rowsOf(
      await db.execute(sql`
        SELECT count(*)::int AS n FROM thread_agent_actions
        WHERE id = ${poisonId}
          AND (status = 'proposed'
               OR (status = 'failed' AND attempt_count < max_attempts))
      `),
    );
    expect(Number(selectable[0].n)).toBe(0);

    // The healthy sibling committed (proving the poison row never starved it).
    const goodRow = rowsOf(
      await db.execute(sql`
        SELECT status, committed_entry_id FROM thread_agent_actions WHERE id = ${goodId}
      `),
    );
    expect(String(goodRow[0].status)).toBe("committed");
    expect(goodRow[0].committed_entry_id).toBeTruthy();
  });

  // Test 8 — snapshot_unavailable suppresses for EVERY action type.
  //
  // The per-action freshness re-check runs FIRST in the commit loop — before the
  // claim CAS and before any per-type payload validation. An empty freshness ('{}')
  // is detected by isSnapshotUnavailable (it carries neither the always-present
  // string threadId nor numeric entrySeq) → compareFreshnessSnapshot returns
  // { fresh:false, reason:"snapshot_unavailable" } → the action is marked
  // suppressed_stale and counted in result.suppressed, REGARDLESS of action type or
  // payload validity. This is what prevents a dropped run/turn from replaying an old
  // empty-snapshot row out of turn. We seed one proposed row of each of the six
  // types (minimal valid payloads, but they're never reached) and assert all six
  // suppress and none commit.
  it("suppresses an empty-snapshot row (snapshot_unavailable) for all six action types; none commit", async () => {
    if (setupError) throw new Error(String(setupError));
    const svc = threadAgentActionService(db);

    // One isolated thread so this test's six rows are the only pending actions the
    // thread-scoped commit drains (no interference from rows left by other tests).
    const [t8] = rowsOf(
      await db.execute(sql`
        INSERT INTO discussions (id, company_id, status, created_by)
        VALUES (gen_random_uuid(), ${companyId}, 'active', 'integration-test')
        RETURNING id
      `),
    );
    const t8Id = String(t8.id);

    // Minimal valid payload per type (read off each handler's required keys). These
    // are intentionally well-formed so a FAILURE here can only come from the
    // snapshot gate, not a payload-validation block — but the freshness gate fires
    // before any of them is inspected.
    const seeds: Array<{ type: string; payload: Record<string, unknown> }> = [
      { type: "post_reply", payload: { rawContent: "x" } },
      { type: "advance_phase", payload: { toPhase: "scope", effectiveAutonomy: 2 } },
      { type: "convene_agent", payload: { targetAgentId: agentId } },
      { type: "add_scope_item", payload: { kind: "decision", title: "x" } },
      { type: "create_artifact_candidate", payload: { title: "x" } },
      { type: "create_scope_draft", payload: { summary: "x" } },
    ];

    for (const seed of seeds) {
      const id = randomUUID();
      // freshness = '{}'::jsonb → snapshot_unavailable.
      await db.execute(sql`
        INSERT INTO thread_agent_actions
          (id, company_id, thread_id, run_id, agent_id, action_type, status, payload, idempotency_key, freshness)
        VALUES
          (${id}, ${companyId}, ${t8Id}, NULL, ${agentId}, ${seed.type}, 'proposed',
           ${JSON.stringify(seed.payload)}::jsonb, ${`k:t8:${seed.type}:${id}`}, '{}'::jsonb)
      `);
    }

    const res = await svc.commitThreadAgentActions({ companyId, threadId: t8Id, runId: await seedRun() });
    expect(res.committed).toBe(0);
    expect(res.suppressed).toBe(6);

    // Zero rows on this thread reached 'committed'; all six are suppressed_stale.
    const committedCount = rowsOf(
      await db.execute(sql`
        SELECT count(*)::int AS n FROM thread_agent_actions
        WHERE thread_id = ${t8Id} AND status = 'committed'
      `),
    );
    expect(Number(committedCount[0].n)).toBe(0);

    const suppressedCount = rowsOf(
      await db.execute(sql`
        SELECT count(*)::int AS n FROM thread_agent_actions
        WHERE thread_id = ${t8Id} AND status = 'suppressed_stale'
      `),
    );
    expect(Number(suppressedCount[0].n)).toBe(6);
  });

  // Test 9 — two-connection concurrency (won/lost split).
  //
  // Two independent postgres connections (db / db2, each its own pool against the
  // same embedded-postgres DB) race to commit the SAME proposed post_reply. The
  // fenced CAS claim (claimActionForCommit: UPDATE … WHERE status IN
  // ('proposed','failed') AND attempt_count = observed) lets exactly ONE committer
  // win the row; the loser's UPDATE touches 0 rows and it skips the action. Plus the
  // discussion_entries_source_action_uq partial index is the side-effect backstop.
  // Timing-independent assertions: exactly one discussion_entries row for the action,
  // and committed counts sum to exactly 1 across the two results.
  it("two real connections racing the same proposed action: exactly one wins the fenced claim, one entry total", async () => {
    if (setupError) throw new Error(String(setupError));

    // A genuine SECOND pool against the same DB. createDb() opens a fresh
    // postgres() connection per call → real cross-connection contention.
    const db2 = createDb(connectionString) as Db;

    const snap = await captureSnapshot(threadId);
    const actionId = randomUUID();
    await db.execute(sql`
      INSERT INTO thread_agent_actions
        (id, company_id, thread_id, run_id, agent_id, action_type, status, payload, idempotency_key, freshness)
      VALUES
        (${actionId}, ${companyId}, ${threadId}, NULL, ${agentId}, 'post_reply', 'proposed',
         ${JSON.stringify({ rawContent: "raced reply" })}::jsonb, ${`k:race:${actionId}`},
         ${JSON.stringify(snap)}::jsonb)
    `);

    const svc1 = threadAgentActionService(db);
    const svc2 = threadAgentActionService(db2);
    const runA = await seedRun();
    const runB = await seedRun();

    const [r1, r2] = await Promise.all([
      svc1.commitThreadAgentActions({ companyId, threadId, runId: runA }),
      svc2.commitThreadAgentActions({ companyId, threadId, runId: runB }),
    ]);

    // Exactly one committer claimed + committed the row.
    expect(r1.committed + r2.committed).toBe(1);

    // Exactly one discussion_entries row was produced (the unique-index + fenced-CAS
    // backstop held under genuine two-connection contention).
    const entryCount = rowsOf(
      await db.execute(sql`
        SELECT count(*)::int AS n FROM discussion_entries WHERE source_action_id = ${actionId}
      `),
    );
    expect(Number(entryCount[0].n)).toBe(1);

    // The action row converged to committed exactly once.
    const finalRow = rowsOf(
      await db.execute(sql`
        SELECT status, committed_entry_id FROM thread_agent_actions WHERE id = ${actionId}
      `),
    );
    expect(String(finalRow[0].status)).toBe("committed");
    expect(finalRow[0].committed_entry_id).toBeTruthy();
  });

  // Test 10 — convene wakeup dedup discriminated by stable sourceActionId (PR-B2 / #202 P2).
  //
  // Two genuinely-DISTINCT convene_agent actions to the SAME target on the SAME thread
  // (distinct action ids, distinct payloads) must BOTH enqueue a queued
  // agent_wakeup_requests row — the old `${target}:${thread}:queued` key collapsed them
  // to one (the swallowed-second-dispatch bug). Because the new dedupKey is discriminated
  // by the committing action.id, their dedupKeys differ → the partial unique index
  // (agent_wakeup_requests_dedup_key_queued_uq) lets both insert. Then a re-commit of the
  // SAME action id (idempotent re-run) collapses to one: the still-queued row blocks the
  // duplicate via onConflictDoNothing. The seeded target reuses the integration agent (a
  // valid in-company targetAgentId — the handler blocks targets outside the company).
  it("two distinct convene_agent actions both enqueue a queued wakeup (discriminated dedupKey); a same-action re-commit collapses to one", async () => {
    if (setupError) throw new Error(String(setupError));

    // Isolated thread so this test's wakeup rows + actions are the only pending work
    // the thread-scoped commit drains (no interference from other tests' rows).
    const [t10] = rowsOf(
      await db.execute(sql`
        INSERT INTO discussions (id, company_id, status, created_by)
        VALUES (gen_random_uuid(), ${companyId}, 'active', 'integration-test')
        RETURNING id
      `),
    );
    const t10Id = String(t10.id);

    const svc = threadAgentActionService(db);
    const snap = await captureSnapshot(t10Id);
    const runA = await seedRun();
    const actionId1 = randomUUID();
    const actionId2 = randomUUID();

    // Two distinct proposed convene_agent actions: same target (the seeded agent), same
    // thread, DISTINCT ids + DISTINCT payloads (different reason/context). Real freshness
    // snapshot so the per-action freshness re-check passes (an empty snapshot would
    // suppress them as snapshot_unavailable). agent_id is the seeded agent (the handler
    // does not gate convene on a null agentId, but seeding a real one matches the harness).
    await db.execute(sql`
      INSERT INTO thread_agent_actions
        (id, company_id, thread_id, run_id, agent_id, action_type, status, payload, idempotency_key, freshness)
      VALUES
        (${actionId1}, ${companyId}, ${t10Id}, ${runA}, ${agentId}, 'convene_agent', 'proposed',
         ${JSON.stringify({ targetAgentId: agentId, reason: "review pass", context: { hop: 1 } })}::jsonb,
         ${`k:convene:${actionId1}`}, ${JSON.stringify(snap)}::jsonb)
    `);
    await db.execute(sql`
      INSERT INTO thread_agent_actions
        (id, company_id, thread_id, run_id, agent_id, action_type, status, payload, idempotency_key, freshness)
      VALUES
        (${actionId2}, ${companyId}, ${t10Id}, ${runA}, ${agentId}, 'convene_agent', 'proposed',
         ${JSON.stringify({ targetAgentId: agentId, reason: "second pass", context: { hop: 2 } })}::jsonb,
         ${`k:convene:${actionId2}`}, ${JSON.stringify(snap)}::jsonb)
    `);

    const res = await svc.commitThreadAgentActions({ companyId, threadId: t10Id, runId: await seedRun() });
    expect(res.committed).toBe(2);

    // BOTH distinct actions enqueued a queued wakeup for the target — the discriminated
    // dedupKey (keyed on the stable sourceActionId) kept them apart.
    const queuedCount = rowsOf(
      await db.execute(sql`
        SELECT count(*)::int AS n FROM agent_wakeup_requests
        WHERE company_id = ${companyId}
          AND agent_id = ${agentId}
          AND status = 'queued'
          AND source = 'agent.dispatch'
          AND dedup_key LIKE ${`${agentId}:${t10Id}:%:queued`}
      `),
    );
    expect(Number(queuedCount[0].n)).toBe(2);

    // SAME-action collapse: a second wakeup carrying the SAME committing action id (a
    // claim race / idempotent re-fire of actionId1) must NOT double-enqueue. Recompute
    // actionId1's exact dedupKey and attempt the duplicate insert through the same path
    // the handler uses (bare onConflictDoNothing). The still-queued first row blocks it
    // via the partial unique index → no row returned, queued count unchanged at 2.
    const dupKey = buildConveneWakeupDedupKey({
      targetAgentId: agentId,
      threadId: t10Id,
      sourceActionId: actionId1,
    });
    const dupInsert = rowsOf(
      await db.execute(sql`
        INSERT INTO agent_wakeup_requests (id, company_id, agent_id, source, reason, status, dedup_key)
        VALUES (gen_random_uuid(), ${companyId}, ${agentId}, 'agent.dispatch', 'review pass', 'queued', ${dupKey})
        ON CONFLICT DO NOTHING
        RETURNING id
      `),
    );
    expect(dupInsert.length).toBe(0); // collapsed — the queued row blocked the duplicate.

    const queuedCountAfter = rowsOf(
      await db.execute(sql`
        SELECT count(*)::int AS n FROM agent_wakeup_requests
        WHERE company_id = ${companyId}
          AND agent_id = ${agentId}
          AND status = 'queued'
          AND source = 'agent.dispatch'
          AND dedup_key LIKE ${`${agentId}:${t10Id}:%:queued`}
      `),
    );
    expect(Number(queuedCountAfter[0].n)).toBe(2); // still 2 — same-action re-fire collapsed.
  });
});
