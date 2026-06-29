/**
 * W1a Task 5 — `hubItems.emit` real-DB integration.
 *
 * Embedded-postgres harness (mirrors w6-org-reporting.integration.test.ts).
 * Skipped on Windows (embedded-postgres / migration-chain — Issue #114); Linux
 * CI is the authoritative gate.
 *
 * Asserts: idempotent upsert on source_unique_key (same source → one open row),
 * redact-before-persist of the denormalized summary, and agent-sourced emit
 * resolving the owner to the first human ancestor (W6).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { applyPendingMigrations, createDb, type Db } from "@armyofagents/db";
import { hubItemsService } from "../services/hub-items.js";

type Pg = { initialise(): Promise<void>; start(): Promise<void>; stop(): Promise<void> };
let pg: Pg | null = null;
let dataDir = "";
let db: Db;
let setupError: unknown = null;
const PORT = 58300 + Math.floor(Math.random() * 1000);

function firstId(r: unknown): string {
  const id = Array.isArray(r) ? (r[0] as { id: string } | undefined)?.id : (r as { rows?: { id: string }[] }).rows?.[0]?.id;
  if (!id) throw new Error("firstId: no id returned from INSERT ... RETURNING id");
  return id;
}
function firstRow<T = Record<string, unknown>>(res: unknown): T {
  const rows = Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows ?? [];
  return rows[0] as T;
}

beforeAll(async () => {
  try {
    dataDir = await mkdtemp(join(tmpdir(), "aoa-hub-emit-test-"));
    const { default: EmbeddedPostgres } = (await import("embedded-postgres")) as { default: new (o: object) => Pg };
    pg = new EmbeddedPostgres({ databaseDir: join(dataDir, "db"), user: "test", password: "test", port: PORT, persistent: false });
    await pg.initialise();
    await pg.start();
    const cs = `postgres://test:test@localhost:${PORT}/postgres`;
    await applyPendingMigrations(cs);
    db = createDb(cs);
  } catch (err) {
    setupError = err;
    console.error("[hub-emit-integration] setup failed:", err);
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

async function seedCompanyWithFounder(): Promise<{ companyId: string; founderId: string }> {
  const companyId = firstId(await db.execute(sql`INSERT INTO companies (id, name, issue_prefix) VALUES (gen_random_uuid(), 'Hub Co', upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))) RETURNING id`));
  const founderId = firstId(await db.execute(sql`INSERT INTO "user" (id, email, name, email_verified, created_at, updated_at) VALUES (gen_random_uuid()::text, ${`f-${PORT}-${Math.random()}@hub.test`}, 'Founder', false, now(), now()) RETURNING id`));
  await db.execute(sql`INSERT INTO company_memberships (id, company_id, principal_type, principal_id, membership_role, status, created_at, updated_at) VALUES (gen_random_uuid(), ${companyId}, 'user', ${founderId}, 'owner', 'active', now(), now())`);
  await db.execute(sql`INSERT INTO user_roles (id, company_id, user_id, role) VALUES (gen_random_uuid(), ${companyId}, ${founderId}, 'founder')`);
  return { companyId, founderId };
}

describe.skipIf(process.platform === "win32")("hubItems.emit — real DB", () => {
  it("setup harness boots", () => {
    if (setupError) throw new Error(String(setupError));
    expect(db).toBeTruthy();
  });

  it("emit upserts on source_unique_key (idempotent), redacts the summary, keeps one open row", async () => {
    if (setupError) throw new Error(String(setupError));
    const { companyId, founderId } = await seedCompanyWithFounder();
    const svc = hubItemsService(db);
    const args = {
      companyId,
      semanticType: "approval_request" as const,
      sourceType: "approval",
      sourceId: "appr-1",
      title: "Approve hire",
      summary: "token sk-ABC123SECRETVALUEXYZ in the payload",
      ownerUserId: founderId,
    };
    const a = await svc.emit(args);
    const b = await svc.emit(args); // same source → same row, not a duplicate
    expect(b.id).toBe(a.id);
    expect(a.summary).not.toContain("sk-ABC123SECRETVALUEXYZ"); // redact-before-persist
    expect(a.lane).toBe("waiting_on_you");
    const open = await db.execute(
      sql`SELECT count(*)::int AS n FROM notifications WHERE company_id = ${companyId} AND status = 'open'`,
    );
    expect(firstRow<{ n: number }>(open).n).toBe(1);
  });

  it("an agent-sourced emit resolves the owner to the first human ancestor (W6)", async () => {
    if (setupError) throw new Error(String(setupError));
    const { companyId, founderId } = await seedCompanyWithFounder();
    // founder ← lead (agent) ← worker (agent): worker's first human ancestor = founder.
    const leadId = firstId(await db.execute(sql`INSERT INTO agents (id, company_id, name, kind, status, parent_type, parent_id) VALUES (gen_random_uuid(), ${companyId}, 'Lead', 'org', 'idle', 'user', ${founderId}) RETURNING id`));
    const workerId = firstId(await db.execute(sql`INSERT INTO agents (id, company_id, name, kind, status, parent_type, parent_id) VALUES (gen_random_uuid(), ${companyId}, 'Worker', 'org', 'idle', 'agent', ${leadId}) RETURNING id`));
    const svc = hubItemsService(db);
    const item = await svc.emit({
      companyId,
      semanticType: "run_failed",
      sourceType: "heartbeat_run",
      sourceId: "hbr-agent-1",
      title: "Run failed",
      summary: "the worker crashed",
      sourceActorType: "agent",
      sourceActorId: workerId,
    });
    expect(item.ownerUserId).toBe(founderId);
    expect(item.userId).toBe(founderId); // legacy NOT NULL column carries the resolved human
    expect(item.lane).toBe("notifications");
  });
});
