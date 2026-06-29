/**
 * W1a Task 7 — `hubItems.recordAndAct` optimistic-concurrency + audit-before-
 * side-effect real-DB integration. Embedded-postgres (mirrors w6). Skipped on
 * Windows (Issue #114); Linux CI is the authoritative gate.
 *
 * Asserts: stale expectedVersion → 409 (no transition); an Owner lacking founder
 * authority acting on an approval_request → 403; a fresh version transitions
 * open→resolved, bumps version, writes exactly one audit row with
 * priorState.status='open'; the audit row is written BEFORE the side-effect
 * (call order); idempotency replay = no second audit row, no second side-effect.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { applyPendingMigrations, createDb, type Db } from "@armyofagents/db";
import { hubItemsService } from "../services/hub-items.js";
import { HttpError } from "../errors.js";

type Pg = { initialise(): Promise<void>; start(): Promise<void>; stop(): Promise<void> };
let pg: Pg | null = null;
let dataDir = "";
let db: Db;
let setupError: unknown = null;
const PORT = 58500 + Math.floor(Math.random() * 1000);

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
    dataDir = await mkdtemp(join(tmpdir(), "aoa-hub-action-test-"));
    const { default: EmbeddedPostgres } = (await import("embedded-postgres")) as { default: new (o: object) => Pg };
    pg = new EmbeddedPostgres({ databaseDir: join(dataDir, "db"), user: "test", password: "test", port: PORT, persistent: false });
    await pg.initialise();
    await pg.start();
    const cs = `postgres://test:test@localhost:${PORT}/postgres`;
    await applyPendingMigrations(cs);
    db = createDb(cs);
  } catch (err) {
    setupError = err;
    console.error("[hub-action-integration] setup failed:", err);
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

async function auditCount(companyId: string, hubItemId: string): Promise<number> {
  const res = await db.execute(
    sql`SELECT count(*)::int AS n FROM hub_audit WHERE company_id = ${companyId} AND hub_item_id = ${hubItemId}`,
  );
  return firstRow<{ n: number }>(res).n;
}

describe.skipIf(process.platform === "win32")("hubItems.recordAndAct — real DB", () => {
  it("setup harness boots", () => {
    if (setupError) throw new Error(String(setupError));
    expect(db).toBeTruthy();
  });

  it("a stale expectedVersion → 409 and does NOT transition", async () => {
    if (setupError) throw new Error(String(setupError));
    const { companyId, founderId } = await seedCompanyWithFounder();
    const svc = hubItemsService(db);
    const item = await svc.emit({ companyId, semanticType: "run_failed", sourceType: "heartbeat_run", sourceId: "stale-1", title: "x", ownerUserId: founderId });
    let caught: unknown;
    try {
      await svc.recordAndAct({
        companyId,
        hubItemId: item.id,
        action: "dismiss",
        expectedVersion: item.version + 5, // stale
        actorType: "user",
        actorId: founderId,
        actorIsFounder: true,
        nextStatus: "archived",
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(HttpError);
    expect((caught as HttpError).status).toBe(409);
    const after = await db.execute(sql`SELECT status, version FROM notifications WHERE id = ${item.id}`);
    const row = firstRow<{ status: string; version: number }>(after);
    expect(row.status).toBe("open"); // untouched
    expect(row.version).toBe(item.version);
    expect(await auditCount(companyId, item.id)).toBe(0);
  });

  it("an Owner without founder authority acting on an approval_request → 403", async () => {
    if (setupError) throw new Error(String(setupError));
    const { companyId, founderId } = await seedCompanyWithFounder();
    const svc = hubItemsService(db);
    // approval_request → authority = founder.
    const item = await svc.emit({ companyId, semanticType: "approval_request", sourceType: "approval", sourceId: "appr-403", title: "Approve", ownerUserId: founderId });
    let caught: unknown;
    try {
      await svc.recordAndAct({
        companyId,
        hubItemId: item.id,
        action: "approve",
        expectedVersion: item.version,
        actorType: "user",
        actorId: founderId,
        actorIsFounder: false, // owner but NOT founder authority
        nextStatus: "resolved",
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(HttpError);
    expect((caught as HttpError).status).toBe(403);
    expect(await auditCount(companyId, item.id)).toBe(0); // no transition, no audit
  });

  it("a fresh version transitions open→resolved, bumps version, writes one audit (priorState.status='open') BEFORE the side-effect", async () => {
    if (setupError) throw new Error(String(setupError));
    const { companyId, founderId } = await seedCompanyWithFounder();
    const svc = hubItemsService(db);
    const item = await svc.emit({ companyId, semanticType: "run_failed", sourceType: "heartbeat_run", sourceId: "ok-1", title: "x", ownerUserId: founderId });

    const order: string[] = [];
    const result = await svc.recordAndAct({
      companyId,
      hubItemId: item.id,
      action: "resolve",
      expectedVersion: item.version,
      actorType: "user",
      actorId: founderId,
      actorIsFounder: true,
      nextStatus: "resolved",
      sideEffect: async () => {
        // At side-effect time the audit row must already be committed.
        order.push(`audit=${await auditCount(companyId, item.id)}`);
        order.push("side-effect");
        return {};
      },
    });

    expect(result.status).toBe("resolved");
    expect(result.version).toBe(item.version + 1);
    // Side-effect saw exactly one durable audit row already present.
    expect(order).toEqual(["audit=1", "side-effect"]);

    const audit = await db.execute(
      sql`SELECT prior_state, action, actor_type FROM hub_audit WHERE company_id = ${companyId} AND hub_item_id = ${item.id}`,
    );
    const arow = firstRow<{ prior_state: { status: string; version: number }; action: string; actor_type: string }>(audit);
    expect(arow.prior_state.status).toBe("open");
    expect(arow.prior_state.version).toBe(item.version);
    expect(arow.action).toBe("resolve");
    expect(arow.actor_type).toBe("user");
    expect(await auditCount(companyId, item.id)).toBe(1);
  });

  it("idempotency replay = no second audit row, no second side-effect", async () => {
    if (setupError) throw new Error(String(setupError));
    const { companyId, founderId } = await seedCompanyWithFounder();
    const svc = hubItemsService(db);
    const item = await svc.emit({ companyId, semanticType: "run_failed", sourceType: "heartbeat_run", sourceId: "idem-1", title: "x", ownerUserId: founderId });
    const key = `idem-key-${Math.random()}`;
    let sideEffects = 0;
    const doAct = (expectedVersion: number) =>
      svc.recordAndAct({
        companyId,
        hubItemId: item.id,
        action: "resolve",
        expectedVersion,
        actorType: "user",
        actorId: founderId,
        actorIsFounder: true,
        idempotencyKey: key,
        nextStatus: "resolved",
        sideEffect: async () => {
          sideEffects += 1;
          return {};
        },
      });

    await doAct(item.version);
    // Replay with the SAME idempotency key (and the now-stale original version):
    // the idempotency short-circuit must fire BEFORE the version guard.
    await doAct(item.version);

    expect(sideEffects).toBe(1); // side-effect ran exactly once
    expect(await auditCount(companyId, item.id)).toBe(1); // one audit row only
  });
});
