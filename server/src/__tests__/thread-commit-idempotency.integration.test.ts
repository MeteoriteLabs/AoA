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
import { threadAgentActionService } from "../services/thread-agent-actions.js";
import { isUniqueViolation } from "../services/db-errors.js";
import {
  buildAdvancePhaseIdempotencyKey,
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
let setupError: unknown = null;
let companyId = "";
let threadId = "";

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
    const connectionString = `postgres://test:test@localhost:${PORT}/postgres`;
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
});
