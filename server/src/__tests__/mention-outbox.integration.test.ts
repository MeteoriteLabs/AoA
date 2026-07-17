import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { applyPendingMigrations, createDb, type Db } from "@armyofagents/db";
import { drainMentionOutbox, enqueueMentionOutbox } from "../services/mention-outbox.js";
import { discussionService } from "../services/discussions.js";

// PR #291 round-6 (#3) — the transactional @mention outbox must guarantee the
// summon survives a post-commit failure and a same-key replay, and fire the
// non-idempotent processMentions EXACTLY ONCE. Needs real Postgres (FOR UPDATE
// SKIP LOCKED + real tx atomicity). Collects + skips on Windows.

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

const PORT = 60300 + Math.floor(Math.random() * 400);
const companyId = "11111111-1111-4111-8111-111111111111";
const discussionId = "22222222-2222-4222-8222-222222222222";

async function countOutbox(entryId: string, status?: string): Promise<number> {
  const rows = await db.execute(
    status
      ? sql`SELECT id FROM discussion_mention_outbox WHERE entry_id = ${entryId} AND status = ${status}`
      : sql`SELECT id FROM discussion_mention_outbox WHERE entry_id = ${entryId}`,
  );
  const arr = Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] })?.rows ?? []);
  return arr.length;
}

async function outboxStatus(entryId: string): Promise<string | null> {
  const rows = await db.execute(
    sql`SELECT status FROM discussion_mention_outbox WHERE entry_id = ${entryId}`,
  );
  const arr = Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] })?.rows ?? []);
  return (arr[0] as { status: string } | undefined)?.status ?? null;
}

beforeAll(async () => {
  if (process.platform === "win32") return;
  try {
    dataDir = await mkdtemp(join(tmpdir(), "aoa-mention-outbox-test-"));
    const { default: EmbeddedPostgres } = (await import("embedded-postgres")) as {
      default: EmbeddedPostgresCtor;
    };
    pg = new EmbeddedPostgres({
      databaseDir: join(dataDir, "db"),
      user: "test",
      password: "test",
      port: PORT,
      persistent: false,
      initdbFlags: ["--encoding=UTF8", "--locale=C"],
    });
    await pg.initialise();
    await pg.start();
    const connectionString = `postgres://test:test@localhost:${PORT}/postgres`;
    await applyPendingMigrations(connectionString);
    db = createDb(connectionString);

    await db.execute(sql`
      INSERT INTO companies (id, name, issue_prefix)
      VALUES (${companyId}, 'Outbox Co', 'OBX')
    `);
    await db.execute(sql`
      INSERT INTO discussions (id, company_id, title, status, created_by)
      VALUES (${discussionId}, ${companyId}, 'Outbox thread', 'active', 'user:1')
    `);
  } catch (err) {
    setupError = err;
  }
}, 180_000);

afterAll(async () => {
  try {
    if (pg) await pg.stop();
  } catch {
    // ignore
  }
  try {
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}, 60_000);

describe.skipIf(process.platform === "win32")("mention outbox (real DB)", () => {
  it("boots the harness", () => {
    expect(setupError).toBeNull();
  });

  it("addEntry enqueues a pending outbox row ATOMICALLY with the entry (a committed entry always has a summon)", async () => {
    const entry = await discussionService(db).addEntry(
      companyId,
      discussionId,
      { rawContent: "@Scout please look", inputType: "write" },
      "user:1",
    );
    // A committed entry carries exactly one pending summon row.
    expect(await countOutbox(entry.id, "pending")).toBe(1);
  });

  it("does NOT enqueue when the entry has no @mention", async () => {
    const entry = await discussionService(db).addEntry(
      companyId,
      discussionId,
      { rawContent: "just thinking out loud", inputType: "write" },
      "user:1",
    );
    expect(await countOutbox(entry.id)).toBe(0);
  });

  it("the worker drains a pending row EXACTLY ONCE and marks it done", async () => {
    // Clear any backlog from earlier tests so this asserts on our row alone.
    await drainMentionOutbox(db, { runMentions: async () => undefined });

    const entryId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab1";
    await enqueueMentionOutbox(db, {
      companyId,
      discussionId,
      entryId,
      mentions: [{ raw: "@Scout", name: "Scout" }],
    });
    const runMentions = vi.fn(async () => undefined);

    const first = await drainMentionOutbox(db, { runMentions });
    expect(first.processed).toBe(1);
    expect(runMentions).toHaveBeenCalledTimes(1);
    expect(runMentions).toHaveBeenCalledWith(
      db,
      companyId,
      discussionId,
      entryId,
      [{ raw: "@Scout", name: "Scout" }],
    );
    expect(await outboxStatus(entryId)).toBe("done");

    // Second drain must NOT re-run it (done → exactly-once across restarts).
    const second = await drainMentionOutbox(db, { runMentions });
    expect(second.processed).toBe(0);
    expect(runMentions).toHaveBeenCalledTimes(1);
  });

  it("a crash-orphaned 'processing' row is reclaimed on a later drain", async () => {
    const entryId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab2";
    await enqueueMentionOutbox(db, {
      companyId,
      discussionId,
      entryId,
      mentions: [{ raw: "@Nova", name: "Nova" }],
    });
    // Simulate a worker that claimed the row then crashed mid-process.
    await db.execute(sql`
      UPDATE discussion_mention_outbox
      SET status = 'processing', updated_at = now() - interval '30 minutes'
      WHERE entry_id = ${entryId}
    `);

    const runMentions = vi.fn(async () => undefined);
    const result = await drainMentionOutbox(db, { runMentions });
    expect(result.processed).toBe(1);
    expect(runMentions).toHaveBeenCalledTimes(1);
    expect(await outboxStatus(entryId)).toBe("done");
  });

  // ── Attachment provenance binding (round-6 #2 security) ──────────────────
  async function insertAsset(id: string, composerValidated: boolean): Promise<void> {
    await db.execute(sql`
      INSERT INTO assets (id, company_id, provider, object_key, content_type, byte_size, sha256, composer_validated)
      VALUES (${id}, ${companyId}, 'memory', ${"k/" + id}, 'text/plain', 10, 'sha', ${composerValidated})
    `);
  }

  it("REJECTS binding a non-composer-validated asset (namespace=files) as a discussion attachment (round-6 #2)", async () => {
    const assetId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
    await insertAsset(assetId, false); // uploaded via namespace=files → not validated
    await expect(
      discussionService(db).addEntry(
        companyId,
        discussionId,
        { rawContent: "see file", inputType: "write", attachments: [{ assetId }] },
        "user:1",
      ),
    ).rejects.toThrow(/not a validated composer upload/i);
  });

  it("ACCEPTS binding a composer-validated asset as a discussion attachment (round-6 #2)", async () => {
    const assetId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
    await insertAsset(assetId, true); // uploaded via a composer namespace → validated
    const entry = await discussionService(db).addEntry(
      companyId,
      discussionId,
      { rawContent: "see file", inputType: "write", attachments: [{ assetId }] },
      "user:1",
    );
    expect(entry.id).toBeTruthy();
  });

  it("a failing summon is retried with backoff, then terminalized as 'failed'", async () => {
    const entryId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab3";
    await enqueueMentionOutbox(db, {
      companyId,
      discussionId,
      entryId,
      mentions: [{ raw: "@Boom", name: "Boom" }],
    });
    const runMentions = vi.fn(async () => {
      throw new Error("summon failed");
    });

    const first = await drainMentionOutbox(db, { runMentions, maxAttempts: 2 });
    expect(first.failed).toBe(1);
    // Not terminal yet → back to pending with a backoff (next_retry_at set).
    expect(await outboxStatus(entryId)).toBe("pending");

    // Force the backoff to elapse, then drain again → terminal 'failed'.
    await db.execute(sql`
      UPDATE discussion_mention_outbox SET next_retry_at = now() - interval '1 minute' WHERE entry_id = ${entryId}
    `);
    const second = await drainMentionOutbox(db, { runMentions, maxAttempts: 2 });
    expect(second.failed).toBe(1);
    expect(await outboxStatus(entryId)).toBe("failed");
  });
});
