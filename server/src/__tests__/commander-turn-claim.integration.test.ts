import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { applyPendingMigrations, createDb, type Db } from "@armyofagents/db";
import { conversationService } from "../services/internal-agent/conversation.js";

// PR #291 round-6 (#1) — the durable Commander turn claim (claimTurn CAS) must
// guarantee, across processes, that exactly ONE caller runs a given turn. The
// in-process Set could not do this in a multi-worker deployment. The CAS needs
// real Postgres row-level serialization, so this runs against embedded Postgres.
// It collects + skips on Windows (embedded-postgres can't start on the CI Windows
// runner); the controller runs it on Linux.

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

const PORT = 59900 + Math.floor(Math.random() * 400);

const companyId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const conversationId = "33333333-3333-4333-8333-333333333333";

async function insertUserMessage(id: string, clientSubmissionId: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO internal_agent_messages (id, conversation_id, role, content, client_submission_id)
    VALUES (${id}, ${conversationId}, 'user', 'hi', ${clientSubmissionId})
  `);
}

async function readTurnStatus(id: string): Promise<string | null> {
  const rows = await db.execute(sql`SELECT turn_status FROM internal_agent_messages WHERE id = ${id}`);
  const arr = Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] })?.rows ?? []);
  return (arr[0] as { turn_status: string | null } | undefined)?.turn_status ?? null;
}

beforeAll(async () => {
  if (process.platform === "win32") return; // skipped suite — don't boot pg
  try {
    dataDir = await mkdtemp(join(tmpdir(), "aoa-turn-claim-test-"));
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
      VALUES (${companyId}, 'Turn Claim Co', 'TCC')
    `);
    await db.execute(sql`
      INSERT INTO internal_agent_conversations (id, company_id, user_id, status)
      VALUES (${conversationId}, ${companyId}, ${userId}, 'active')
    `);
  } catch (err) {
    setupError = err;
  }
}, 180_000);

afterAll(async () => {
  try {
    if (pg) await pg.stop();
  } catch {
    // ignore cleanup failures
  }
  try {
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
}, 60_000);

describe.skipIf(process.platform === "win32")("Commander durable turn claim (real DB)", () => {
  it("boots the harness", () => {
    expect(setupError).toBeNull();
  });

  it("exactly one of two racing claims wins; the loser must defer", async () => {
    const msgId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
    await insertUserMessage(msgId, "sub-race");
    const svc = conversationService(db);

    // Two connections race the CAS concurrently. The conditional UPDATE
    // serializes on the row, so exactly one sees a returned row.
    const [a, b] = await Promise.all([svc.claimTurn(msgId), svc.claimTurn(msgId)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await readTurnStatus(msgId)).toBe("running");
  });

  it("a fresh 'running' claim cannot be re-acquired (no double-run)", async () => {
    const msgId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
    await insertUserMessage(msgId, "sub-fresh-running");
    const svc = conversationService(db);

    expect(await svc.claimTurn(msgId)).toBe(true); // first wins
    expect(await svc.claimTurn(msgId)).toBe(false); // still running, fresh → denied
  });

  it("a STALE 'running' claim is reclaimable (owner presumed dead)", async () => {
    const msgId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
    await insertUserMessage(msgId, "sub-stale");
    const svc = conversationService(db);

    expect(await svc.claimTurn(msgId)).toBe(true);
    // Backdate the claim well past the 10-minute staleness window.
    await db.execute(
      sql`UPDATE internal_agent_messages SET turn_claimed_at = now() - interval '30 minutes' WHERE id = ${msgId}`,
    );
    expect(await svc.claimTurn(msgId)).toBe(true); // reclaimed
  });

  it("'done' is terminal (a retry replays, never re-runs); 'failed' is reclaimable", async () => {
    const msgId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
    await insertUserMessage(msgId, "sub-terminal");
    const svc = conversationService(db);

    expect(await svc.claimTurn(msgId)).toBe(true);
    await svc.finishTurn(msgId, "done");
    expect(await svc.claimTurn(msgId)).toBe(false); // done → never reclaimed

    await svc.finishTurn(msgId, "failed");
    expect(await svc.claimTurn(msgId)).toBe(true); // failed → reclaimable
  });
});
