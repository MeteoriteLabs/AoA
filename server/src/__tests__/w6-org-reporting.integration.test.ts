/**
 * W6 org-reporting — real-DB integration harness (Task 0).
 *
 * Shared embedded-postgres harness that every later W6 task appends `it(...)`
 * blocks to. W6 makes the org-agent reports-to tree always top out at a real
 * human (human-at-top invariant): first-agent → founder, real-human operator
 * incl. local_trusted, owner = first-human-ancestor.
 *
 * Boots embedded-postgres, applies all migrations, and exposes
 * `seedCompanyWithFounder()` for the per-test fixtures.
 *
 * Skipped on Windows (embedded-postgres / migration-chain — Issue #114); Linux
 * CI is the authoritative gate. Mirrors crew-org-scope.integration.test.ts.
 *
 * NOTE on schema column names (verified against packages/db/src/schema/*):
 *   - The auth-users table is named "user" (Drizzle table name), NOT auth_users.
 *     `id` is text (no default) → generated via gen_random_uuid()::text.
 *     `name` is NOT NULL no-default; `created_at`/`updated_at` are NOT NULL
 *     no-default → supplied explicitly with now().
 *   - company_memberships: principal_type / principal_id (text) / membership_role
 *     / status — all confirmed.
 *   - user_roles: user_id (text) / role — confirmed.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { applyPendingMigrations, createDb, type Db } from "@armyofagents/db";
import { orgHierarchyService } from "../services/org-hierarchy.js";
import { agentService } from "../services/agents.js";

type Pg = { initialise(): Promise<void>; start(): Promise<void>; stop(): Promise<void> };
let pg: Pg | null = null; let dataDir = ""; let db: Db; let setupError: unknown = null;
const PORT = 58200 + Math.floor(Math.random() * 1000);
function firstId(r: unknown): string {
  const id = Array.isArray(r) ? (r[0] as { id: string } | undefined)?.id : (r as { rows?: { id: string }[] }).rows?.[0]?.id;
  if (!id) throw new Error("firstId: no id returned from INSERT ... RETURNING id");
  return id;
}

beforeAll(async () => {
  try {
    dataDir = await mkdtemp(join(tmpdir(), "aoa-w6-test-"));
    const { default: EmbeddedPostgres } = (await import("embedded-postgres")) as { default: new (o: object) => Pg };
    pg = new EmbeddedPostgres({ databaseDir: join(dataDir, "db"), user: "test", password: "test", port: PORT, persistent: false });
    await pg.initialise(); await pg.start();
    const cs = `postgres://test:test@localhost:${PORT}/postgres`;
    await applyPendingMigrations(cs); db = createDb(cs);
  } catch (err) { setupError = err; console.error("[w6-integration] setup failed:", err); }
}, 180_000);

afterAll(async () => {
  try { if (pg) await pg.stop(); } catch { /* ignore */ }
  try { if (dataDir) await rm(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
}, 60_000);

async function seedCompanyWithFounder(): Promise<{ companyId: string; founderId: string }> {
  const companyId = firstId(await db.execute(sql`INSERT INTO companies (id, name) VALUES (gen_random_uuid(), 'W6 Co') RETURNING id`));
  const founderId = firstId(await db.execute(sql`INSERT INTO "user" (id, email, name, email_verified, created_at, updated_at) VALUES (gen_random_uuid()::text, 'f@w6.test', 'Founder', false, now(), now()) RETURNING id`));
  await db.execute(sql`INSERT INTO company_memberships (id, company_id, principal_type, principal_id, membership_role, status, created_at, updated_at) VALUES (gen_random_uuid(), ${companyId}, 'user', ${founderId}, 'owner', 'active', now(), now())`);
  await db.execute(sql`INSERT INTO user_roles (id, company_id, user_id, role) VALUES (gen_random_uuid(), ${companyId}, ${founderId}, 'founder')`);
  return { companyId, founderId };
}

describe.skipIf(process.platform === "win32")("W6 org reporting — real DB", () => {
  it("setup harness boots", () => { if (setupError) throw new Error(String(setupError)); expect(db).toBeTruthy(); });

  it("getFounderUserId returns the founder, else the owner-membership principal", async () => {
    if (setupError) throw new Error(String(setupError));
    const { companyId, founderId } = await seedCompanyWithFounder();
    const svc = orgHierarchyService(db);
    expect(await svc.getFounderUserId(companyId)).toBe(founderId);
    await db.execute(sql`DELETE FROM user_roles WHERE company_id = ${companyId} AND role = 'founder'`);
    expect(await svc.getFounderUserId(companyId)).toBe(founderId);
  });

  it("getFirstHumanAncestor walks agent -> agent -> human", async () => {
    if (setupError) throw new Error(String(setupError));
    const { companyId, founderId } = await seedCompanyWithFounder();
    const leadId = firstId(await db.execute(sql`INSERT INTO agents (id, company_id, name, kind, status, parent_type, parent_id) VALUES (gen_random_uuid(), ${companyId}, 'Lead', 'org', 'idle', 'user', ${founderId}) RETURNING id`));
    const workerId = firstId(await db.execute(sql`INSERT INTO agents (id, company_id, name, kind, status, parent_type, parent_id) VALUES (gen_random_uuid(), ${companyId}, 'Worker', 'org', 'idle', 'agent', ${leadId}) RETURNING id`));
    expect(await orgHierarchyService(db).getFirstHumanAncestor(companyId, "agent", workerId)).toBe(founderId);
  });
});
