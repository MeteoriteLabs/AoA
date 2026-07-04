/**
 * W3a (Task 4) integration: the crew result loopback + run summary on real Postgres.
 *
 * The composed side-effect functions postCrewRunSuccess / postCrewRunFailure are
 * unit-tested with mocks (aoa-runner-loopback.test.ts). Only a real DB proves the
 * discussion entries + issue_comments actually LAND. This drives the composed
 * functions with their DEFAULT deps (real relayCrewResult / postCrewFailureCard /
 * postRunSummaryComment) against seeded companies/threads/issues.
 *
 * Cases:
 *   1. Success loopback + summary — a crew_thread issue → an `agent` "Completed: …"
 *      entry lands in the thread (entry_seq/entry_count bumped) AND an issue_comments
 *      run-summary row lands ({ relayed:true, summarized:true }).
 *   2. Non-discussion task — origin_kind='manual' → the loopback is a no-op (ZERO new
 *      entries) but the summary STILL posts (summary is not origin-gated)
 *      ({ relayed:false, summarized:true }).
 *   3. Failure card + failure summary — a crew_thread issue → a `system`
 *      "… could not complete …" entry lands AND a failure summary comment containing
 *      the error lands ({ carded:true, summarized:true }).
 *   4. Opt-out — runtimeConfig.autoRunSummary=false → NO issue_comments row (summary
 *      suppressed) but the loopback entry STILL posts (opt-out is summary-only, D3)
 *      ({ relayed:true, summarized:false }).
 *
 * Each case runs in an isolated company / thread / issue triple so they are fully
 * independent despite sharing one embedded-postgres instance.
 *
 * Skipped on Windows (CI's `runneradmin` account can't start embedded-postgres —
 * Issue #114); Linux CI is the authoritative gate. Modeled on
 * w2-extract-then-scope.integration.test.ts. To run locally on Windows, temporarily
 * flip `describe.skipIf(process.platform === "win32")` → `describe.skipIf(false)`,
 * run, then ALWAYS restore before commit — the UTF-8 initdbFlags make the cluster
 * locale-safe.
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
  type Db,
} from "@armyofagents/db";
import { companyService } from "../services/companies.js";
import {
  postCrewRunSuccess,
  postCrewRunFailure,
} from "../services/internal-agent/aoa-agents/crew-run-outcome.js";

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

// Offset by +12 from W2's 59609 range to avoid a port collision if both run together.
const PORT = 59621 + Math.floor(Math.random() * 370);

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  return ((result as { rows?: Array<Record<string, unknown>> }).rows ?? []) as Array<
    Record<string, unknown>
  >;
}

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Seed a company (companyService.create auto-seeds the AoA crew incl. Engineer) +
 * a founder user + user_roles row. Reuse the seeded Engineer — a second INSERT
 * would violate agents_aoa_name_per_company_idx. Mirrors the W2 test's seed.
 */
async function seedCompanyAndEngineer(label: string): Promise<{
  companyId: string;
  engineerId: string;
}> {
  const company = await companyService(db).create({ name: `W3a ${label} Co` } as never);
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

  let engRows = rowsOf(
    await db.execute(sql`
      SELECT id FROM agents
      WHERE company_id = ${companyId} AND kind = 'aoa' AND name = 'Engineer' AND status <> 'terminated'
      LIMIT 1
    `),
  );
  if (engRows.length === 0) {
    engRows = rowsOf(
      await db.execute(sql`
        INSERT INTO agents (id, company_id, name, kind, status)
        VALUES (gen_random_uuid(), ${companyId}, 'Engineer', 'aoa', 'idle')
        RETURNING id
      `),
    );
  }
  return { companyId, engineerId: String(engRows[0].id) };
}

/** Seed a thread. entry_seq/entry_count start at 0 so the loopback bump is observable. */
async function seedThread(companyId: string): Promise<string> {
  const [thread] = rowsOf(
    await db.execute(sql`
      INSERT INTO discussions (id, company_id, status, created_by, entry_seq, entry_count)
      VALUES (gen_random_uuid(), ${companyId}, 'active', 'integration-test', 0, 0)
      RETURNING id
    `),
  );
  return String(thread.id);
}

/**
 * Seed an issues row. Only company_id + title are NOT NULL (status defaults to
 * 'backlog'); origin_kind / source_discussion_id / assignee_agent_id are the W3a
 * loopback gate columns.
 */
async function seedIssue(opts: {
  companyId: string;
  title: string;
  originKind: string | null;
  sourceDiscussionId: string | null;
  assigneeAgentId: string | null;
}): Promise<string> {
  const [issue] = rowsOf(
    await db.execute(sql`
      INSERT INTO issues (id, company_id, title, status, origin_kind, source_discussion_id, assignee_agent_id)
      VALUES (
        gen_random_uuid(), ${opts.companyId}, ${opts.title}, 'in_progress',
        ${opts.originKind}, ${opts.sourceDiscussionId}, ${opts.assigneeAgentId}
      )
      RETURNING id
    `),
  );
  return String(issue.id);
}

async function threadCounts(
  threadId: string,
): Promise<{ entrySeq: number; entryCount: number }> {
  const [row] = rowsOf(
    await db.execute(sql`
      SELECT entry_seq, entry_count FROM discussions WHERE id = ${threadId}
    `),
  );
  return { entrySeq: Number(row.entry_seq), entryCount: Number(row.entry_count) };
}

async function commentsFor(issueId: string): Promise<Array<{ body: string }>> {
  return rowsOf(
    await db.execute(sql`
      SELECT body FROM issue_comments WHERE issue_id = ${issueId} ORDER BY created_at
    `),
  ).map((r) => ({ body: String(r.body) }));
}

async function entriesFor(
  threadId: string,
): Promise<Array<{ inputType: string; rawContent: string }>> {
  return rowsOf(
    await db.execute(sql`
      SELECT input_type, raw_content FROM discussion_entries
      WHERE discussion_id = ${threadId} ORDER BY seq
    `),
  ).map((r) => ({ inputType: String(r.input_type), rawContent: String(r.raw_content) }));
}

// ── embedded-postgres lifecycle ───────────────────────────────────────────────

beforeAll(async () => {
  try {
    dataDir = await mkdtemp(join(tmpdir(), "aoa-w3a-crew-loopback-integ-"));
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
      // comment) applies. Without this, initdb inherits the host locale (WIN1252 on
      // Windows) and the `postgres` DB rejects those bytes.
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
    console.error("[w3a-crew-loopback] embedded-postgres setup failed:", err);
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

// Windows-skip: CI's `runneradmin` account can't start embedded-postgres (Issue #114).
// To run locally on Windows, temporarily flip this to `describe.skipIf(false)` — the
// UTF-8 initdbFlags above make the cluster locale-safe. ALWAYS restore before commit.
describe.skipIf(process.platform === "win32")("W3a integration: crew loopback + run summary", () => {
  // ── Case 1: success loopback + summary ─────────────────────────────────────
  it("success: a crew_thread task relays a Completed entry AND writes a run-summary comment", async () => {
    if (setupError) throw new Error(String(setupError));

    const { companyId, engineerId } = await seedCompanyAndEngineer("Success");
    const threadId = await seedThread(companyId);
    const title = "Build the auth token endpoint";
    const issueId = await seedIssue({
      companyId,
      title,
      originKind: "crew_thread",
      sourceDiscussionId: threadId,
      assigneeAgentId: engineerId,
    });

    const before = await threadCounts(threadId);
    const startedAtMs = 1_000_000;

    const result = await postCrewRunSuccess(db, {
      companyId,
      issueId,
      agentName: "Engineer",
      runtimeConfig: {},
      startedAtMs,
      nowMs: startedAtMs + 135_000, // 2m 15s
      adapterUsage: { inputTokens: 100, outputTokens: 200 },
      costCents: 12,
      runId: randomUUID(),
    });

    // Composed return value.
    expect(result).toEqual({ relayed: true, summarized: true });

    // (a) A NEW agent loopback entry landed with the "Completed: …" content.
    const entries = await entriesFor(threadId);
    const agentEntries = entries.filter((e) => e.inputType === "agent");
    expect(agentEntries).toHaveLength(1);
    expect(agentEntries[0].rawContent).toContain("Completed:");
    expect(agentEntries[0].rawContent).toContain(title);

    // (b) entry_seq / entry_count bumped by exactly one.
    const after = await threadCounts(threadId);
    expect(after.entrySeq).toBe(before.entrySeq + 1);
    expect(after.entryCount).toBe(before.entryCount + 1);

    // (c) A run-summary comment landed on the task, naming the agent + Duration.
    const comments = await commentsFor(issueId);
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toContain("Engineer");
    expect(comments[0].body).toContain("Duration");
    expect(comments[0].body).toContain("2m 15s");
  }, 60_000);

  // ── Case 2: non-discussion task → loopback no-op, summary still posts ───────
  it("non-discussion: origin='manual' relay is a no-op but the summary still posts", async () => {
    if (setupError) throw new Error(String(setupError));

    const { companyId, engineerId } = await seedCompanyAndEngineer("Manual");
    // A thread exists only to prove its entry count is UNCHANGED (relay never runs).
    const threadId = await seedThread(companyId);
    const issueId = await seedIssue({
      companyId,
      title: "A manually created task",
      originKind: "manual",
      sourceDiscussionId: null,
      assigneeAgentId: engineerId,
    });

    const before = await threadCounts(threadId);
    const startedAtMs = 2_000_000;

    const result = await postCrewRunSuccess(db, {
      companyId,
      issueId,
      agentName: "Engineer",
      runtimeConfig: {},
      startedAtMs,
      nowMs: startedAtMs + 30_000,
      adapterUsage: { inputTokens: 10, outputTokens: 20 },
      costCents: 3,
      runId: randomUUID(),
    });

    // Loopback did NOT post (not a crew_thread task); summary DID.
    expect(result).toEqual({ relayed: false, summarized: true });

    // ZERO discussion entries were created anywhere for this issue.
    const after = await threadCounts(threadId);
    expect(after.entrySeq).toBe(before.entrySeq);
    expect(after.entryCount).toBe(before.entryCount);
    const entries = await entriesFor(threadId);
    expect(entries).toHaveLength(0);

    // The summary comment STILL landed (not origin-gated).
    const comments = await commentsFor(issueId);
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toContain("Engineer");
    expect(comments[0].body).toContain("Duration");
  }, 60_000);

  // ── Case 3: failure card + failure summary ─────────────────────────────────
  it("failure: a crew_thread task posts a system 'could not complete' entry AND a failure summary", async () => {
    if (setupError) throw new Error(String(setupError));

    const { companyId, engineerId } = await seedCompanyAndEngineer("Failure");
    const threadId = await seedThread(companyId);
    const title = "Wire the export pipeline";
    const issueId = await seedIssue({
      companyId,
      title,
      originKind: "crew_thread",
      sourceDiscussionId: threadId,
      assigneeAgentId: engineerId,
    });

    const before = await threadCounts(threadId);
    const startedAtMs = 3_000_000;

    const result = await postCrewRunFailure(db, {
      companyId,
      issueId,
      agentId: engineerId,
      agentName: "Engineer",
      runtimeConfig: {},
      startedAtMs,
      nowMs: startedAtMs + 5_000,
      errorMessage: "boom",
      runId: randomUUID(),
    });

    expect(result).toEqual({ carded: true, summarized: true });

    // A `system` failure card landed containing the agent + "could not complete" + title.
    const entries = await entriesFor(threadId);
    const systemEntries = entries.filter((e) => e.inputType === "system");
    expect(systemEntries).toHaveLength(1);
    expect(systemEntries[0].rawContent).toContain("could not complete");
    expect(systemEntries[0].rawContent).toContain(title);

    // entry_seq / entry_count bumped by one.
    const after = await threadCounts(threadId);
    expect(after.entrySeq).toBe(before.entrySeq + 1);
    expect(after.entryCount).toBe(before.entryCount + 1);

    // A failure run-summary comment landed carrying the error + the Failed marker.
    const comments = await commentsFor(issueId);
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toContain("boom");
    expect(comments[0].body).toContain("Failed");
    expect(comments[0].body).toContain("Engineer");
  }, 60_000);

  // ── Case 4: opt-out → no summary comment, loopback still posts ─────────────
  it("opt-out: autoRunSummary=false suppresses the summary but the loopback entry still posts", async () => {
    if (setupError) throw new Error(String(setupError));

    const { companyId, engineerId } = await seedCompanyAndEngineer("OptOut");
    const threadId = await seedThread(companyId);
    const title = "Refactor the billing retry queue";
    const issueId = await seedIssue({
      companyId,
      title,
      originKind: "crew_thread",
      sourceDiscussionId: threadId,
      assigneeAgentId: engineerId,
    });

    const before = await threadCounts(threadId);
    const startedAtMs = 4_000_000;

    const result = await postCrewRunSuccess(db, {
      companyId,
      issueId,
      agentName: "Engineer",
      runtimeConfig: { autoRunSummary: false }, // D3: opt-out is summary-only.
      startedAtMs,
      nowMs: startedAtMs + 60_000,
      adapterUsage: { inputTokens: 50, outputTokens: 75 },
      costCents: 8,
      runId: randomUUID(),
    });

    // Loopback posted; summary was suppressed.
    expect(result).toEqual({ relayed: true, summarized: false });

    // NO run-summary comment on the task.
    const comments = await commentsFor(issueId);
    expect(comments).toHaveLength(0);

    // The loopback entry STILL landed (opt-out never suppresses founder visibility).
    const entries = await entriesFor(threadId);
    const agentEntries = entries.filter((e) => e.inputType === "agent");
    expect(agentEntries).toHaveLength(1);
    expect(agentEntries[0].rawContent).toContain("Completed:");
    expect(agentEntries[0].rawContent).toContain(title);

    const after = await threadCounts(threadId);
    expect(after.entrySeq).toBe(before.entrySeq + 1);
    expect(after.entryCount).toBe(before.entryCount + 1);
  }, 60_000);
});
