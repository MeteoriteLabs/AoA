import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { applyPendingMigrations, createDb, type Db } from "@armyofagents/db";
import { issueService } from "../services/issues.js";

// PR #291 round-12 — the keyed comment+reassign PATCH must commit the issue
// reassign (svc.update) and the KEYED comment (addComment) in ONE transaction
// (#2), and its wakeup dispatch must be gated by an atomic claim so two
// concurrent recovery requests dispatch EXACTLY ONCE (#1). Both invariants need
// real Postgres (transaction atomicity + a conditional UPDATE ... RETURNING CAS).
// Collects + skips on Windows (embedded-postgres can't boot on the CI runner).

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

const PORT = 60800 + Math.floor(Math.random() * 400);
const companyId = "11111111-1111-4111-8111-111111111111";
const issueId = "22222222-2222-4222-8222-222222222222";

async function readIssueField(field: "title" | "priority"): Promise<string | null> {
  const rows = await db.execute(
    sql`SELECT ${sql.raw(field)} AS v FROM issues WHERE id = ${issueId}`,
  );
  const arr = Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] })?.rows ?? []);
  return (arr[0] as { v: string } | undefined)?.v ?? null;
}

beforeAll(async () => {
  if (process.platform === "win32") return;
  try {
    dataDir = await mkdtemp(join(tmpdir(), "aoa-comment-reassign-test-"));
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
      VALUES (${companyId}, 'Reassign Co', 'RSN')
    `);
    await db.execute(sql`
      INSERT INTO issues (id, company_id, title, status, priority, work_mode)
      VALUES (${issueId}, ${companyId}, 'original title', 'todo', 'medium', 'standard')
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

describe.skipIf(process.platform === "win32")("comment+reassign atomicity (real DB)", () => {
  it("boots the harness", () => {
    expect(setupError).toBeNull();
  });

  // ---- Round-12 #2: the reassign + keyed comment are ONE transaction ----

  it("commits the reassign AND the keyed comment together (a committed PATCH always has its keyed comment)", async () => {
    const key = "combined-key-commit";
    const persisted = await db.transaction(async (txRaw) => {
      const txSvc = issueService(txRaw as unknown as Db);
      const updatedIssue = await txSvc.update(issueId, { title: "reassigned title" }, { actorType: "board" });
      const keyedComment = await txSvc.addComment(issueId, "please take this over", {
        userId: "board-user",
        clientSubmissionId: key,
      });
      return { updatedIssue, keyedComment };
    });

    expect(persisted.updatedIssue?.title).toBe("reassigned title");
    // The PATCH landed…
    expect(await readIssueField("title")).toBe("reassigned title");
    // …and the keyed comment exists — so the early-replay check (which keys off
    // the comment) will correctly short-circuit a retry.
    const found = await issueService(db).getCommentByClientSubmissionId(companyId, issueId, key);
    expect(found?.id).toBe(persisted.keyedComment.id);
  });

  it("ROLLS BACK the reassign when the keyed comment insert never completes (no phantom PATCH)", async () => {
    const before = await readIssueField("priority");
    const key = "combined-key-rollback";

    await expect(
      db.transaction(async (txRaw) => {
        const txSvc = issueService(txRaw as unknown as Db);
        await txSvc.update(issueId, { priority: "high" }, { actorType: "board" });
        await txSvc.addComment(issueId, "body that never durably lands", {
          userId: "board-user",
          clientSubmissionId: key,
        });
        // Simulate a crash AFTER both writes but BEFORE the tx commits.
        throw new Error("simulated crash before commit");
      }),
    ).rejects.toThrow("simulated crash before commit");

    // The reassign was rolled back with the comment — you can never observe the
    // PATCH applied without its keyed comment (the exact invariant round-12 #2
    // closes: otherwise a retry re-PATCHes over a newer concurrent reassign).
    expect(await readIssueField("priority")).toBe(before);
    expect(await issueService(db).getCommentByClientSubmissionId(companyId, issueId, key)).toBeNull();
  });

  // ---- Round-12 #1: the wakeup dispatch is claimed atomically ----

  it("lets exactly ONE of two concurrent claims win (no double-wake)", async () => {
    const comment = await issueService(db).addComment(issueId, "@Beta please look", {
      userId: "board-user",
      clientSubmissionId: "claim-key-1",
    });

    const [a, b] = await Promise.all([
      issueService(db).claimCommentWakeupDispatch(comment.id),
      issueService(db).claimCommentWakeupDispatch(comment.id),
    ]);
    // Exactly one request may dispatch; the other skips.
    expect([a, b].filter(Boolean)).toHaveLength(1);

    // A third (later) claim also loses — the marker is set.
    expect(await issueService(db).claimCommentWakeupDispatch(comment.id)).toBe(false);
  });

  it("re-opens the claim after a compensating release (a failed dispatch stays retryable)", async () => {
    const comment = await issueService(db).addComment(issueId, "@Beta again", {
      userId: "board-user",
      clientSubmissionId: "claim-key-2",
    });

    // Winner claims, then its dispatch throws → it releases the claim.
    expect(await issueService(db).claimCommentWakeupDispatch(comment.id)).toBe(true);
    await issueService(db).releaseCommentWakeupDispatch(comment.id);

    // A retry re-claims and dispatches (the summon is never lost).
    expect(await issueService(db).claimCommentWakeupDispatch(comment.id)).toBe(true);
  });
});
