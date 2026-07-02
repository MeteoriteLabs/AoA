/**
 * W1a integration: controller scope draft → apply → assigned crew task.
 *
 * Real-Postgres proof that the full Path-B chain assigns crew agents:
 *   1. Seed a company + crew Engineer agent + a discussion thread.
 *   2. Insert a 'ready' create_scope_draft action with
 *      payload.proposedTasks:[{title:"Build token endpoint",assigneeRole:"engineer"}].
 *   3. commitThreadAgentActions → produces a draft scope version whose task_proposal
 *      item carries payload.assigneeAgentId === engineer.id.
 *   4. acceptDraft + applyAcceptedDraft → the created issues row has
 *      assigneeAgentId === engineer.id and originKind === 'crew_thread'.
 *
 * Skipped on Windows (embedded-postgres / migration-chain issue — Issue #114);
 * Linux CI is the authoritative gate. Modeled on thread-commit-idempotency.integration.test.ts.
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
  threadAgentActionService,
} from "../services/thread-agent-actions.js";
import {
  captureFreshnessSnapshot,
  type ThreadFreshnessSnapshot,
} from "../services/thread-agent-action-freshness.js";
import { threadScopeVersionService } from "../services/thread-scope-versions.js";

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
let agentId = ""; // crew Engineer (kind='aoa')

const PORT = 59100 + Math.floor(Math.random() * 500);

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  return ((result as { rows?: Array<Record<string, unknown>> }).rows ?? []) as Array<
    Record<string, unknown>
  >;
}

beforeAll(async () => {
  try {
    dataDir = await mkdtemp(join(tmpdir(), "aoa-w1a-crew-integ-"));
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

    // Seed a company (also creates Commander config etc.).
    const company = await companyService(db).create({ name: "W1a Crew Assignment Co" } as never);
    companyId = company.id;

    // Seed a discussion thread (the thread the action will belong to).
    // Needs at least one entry so createDraftFromThread has something to compile.
    const [thread] = rowsOf(
      await db.execute(sql`
        INSERT INTO discussions (id, company_id, status, created_by, entry_seq)
        VALUES (gen_random_uuid(), ${companyId}, 'active', 'integration-test', 1)
        RETURNING id
      `),
    );
    threadId = String(thread.id);

    // Seed a discussion entry so the compiler has at least one source row.
    await db.execute(sql`
      INSERT INTO discussion_entries (id, discussion_id, input_type, raw_content, created_by, seq)
      VALUES (gen_random_uuid(), ${threadId}, 'write', 'let us scope the auth work', 'human-user', 1)
    `);

    // Seed the crew Engineer agent (kind='aoa', name='Engineer').
    // resolveRoleToAgentId looks for: companyId match, kind='aoa', name='Engineer', status != 'terminated'.
    const [eng] = rowsOf(
      await db.execute(sql`
        INSERT INTO agents (id, company_id, name, kind, status)
        VALUES (gen_random_uuid(), ${companyId}, 'Engineer', 'aoa', 'idle')
        RETURNING id
      `),
    );
    agentId = String(eng.id);
  } catch (err) {
    setupError = err;
    // eslint-disable-next-line no-console
    console.error("[w1a-crew-assignment] embedded-postgres setup failed:", err);
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

describe.skipIf(process.platform === "win32")("W1a integration: controller scope draft → apply → assigned crew task", () => {
  async function captureSnapshot(tid: string): Promise<ThreadFreshnessSnapshot> {
    return captureFreshnessSnapshot(db as never, tid);
  }

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

  it("creates a scope draft whose task_proposal carries assigneeAgentId, then applying it creates an assigned issue", async () => {
    if (setupError) throw new Error(String(setupError));

    const svc = threadAgentActionService(db);
    const scopeSvc = threadScopeVersionService(db);

    // Capture a real freshness snapshot so the commit path's freshness re-check passes.
    const snap = await captureSnapshot(threadId);
    const runId = await seedRun();
    const actionId = randomUUID();

    // Seed a 'ready' create_scope_draft action with proposedTasks carrying assigneeRole='engineer'.
    // The commit handler will resolve 'engineer' → Engineer agent id via resolveRoleToAgentId,
    // then forward proposedTasks into createDraftFromThread → compileThreadScopeDraft.
    await db.execute(sql`
      INSERT INTO thread_agent_actions
        (id, company_id, thread_id, run_id, agent_id, action_type, status, payload, idempotency_key, freshness)
      VALUES
        (${actionId}, ${companyId}, ${threadId}, ${runId}, ${agentId}, 'create_scope_draft', 'ready',
         ${JSON.stringify({
           summary: "Auth service scope",
           proposedTasks: [{ title: "Build token endpoint", assigneeRole: "engineer" }],
         })}::jsonb,
         ${`k:w1a:${actionId}`},
         ${JSON.stringify(snap)}::jsonb)
    `);

    // ── Step 1: commit the action ─────────────────────────────────────────────
    const commitResult = await svc.commitThreadAgentActions({
      companyId,
      threadId,
      runId,
    });
    expect(commitResult.committed).toBe(1);
    expect(commitResult.failed).toBe(0);
    expect(commitResult.suppressed).toBe(0);

    // The action row should now be committed.
    const [actionRow] = rowsOf(
      await db.execute(sql`
        SELECT status, committed_scope_version_id FROM thread_agent_actions WHERE id = ${actionId}
      `),
    );
    expect(String(actionRow.status)).toBe("committed");
    expect(actionRow.committed_scope_version_id).toBeTruthy();

    const scopeVersionId = String(actionRow.committed_scope_version_id);

    // ── Step 2: assert the scope version's task_proposal item carries assigneeAgentId ─
    const detail = await scopeSvc.getVersion(companyId, threadId, scopeVersionId);
    expect(detail).not.toBeNull();
    const taskItem = detail!.items.find((i: { kind: string }) => i.kind === "task_proposal");
    expect(taskItem).toBeDefined();
    expect(taskItem!.title).toBe("Build token endpoint");
    const taskPayload = taskItem!.payload as { assigneeAgentId?: string | null };
    expect(taskPayload.assigneeAgentId).toBe(agentId);

    // ── Step 3: accept the draft (select the task item) ───────────────────────
    const acceptResult = await scopeSvc.acceptDraft(
      companyId,
      threadId,
      scopeVersionId,
      { itemIds: [taskItem!.id] },
      { userId: "founder-user", isHuman: true },
    );
    expect(acceptResult.ok).toBe(true);

    // ── Step 4: apply the accepted draft → creates a real issues row ──────────
    const applyResult = await scopeSvc.applyAcceptedDraft(
      companyId,
      threadId,
      scopeVersionId,
      { userId: "founder-user", isHuman: true },
    );
    expect(applyResult.ok).toBe(true);
    expect((applyResult as any).createdTasks).toHaveLength(1);

    const createdTask = (applyResult as any).createdTasks[0];
    expect(createdTask.assigneeAgentId).toBe(agentId);

    // Read the actual issues row from the DB to confirm both fields.
    const [issueRow] = rowsOf(
      await db.execute(sql`
        SELECT assignee_agent_id, origin_kind FROM issues WHERE id = ${createdTask.id}
      `),
    );
    expect(String(issueRow.assignee_agent_id)).toBe(agentId);
    expect(String(issueRow.origin_kind)).toBe("crew_thread");
  });
});
