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
import { accessService } from "../services/access.js";
import { companyPortabilityService } from "../services/company-portability.js";
import type { CompanyPortabilityManifest } from "@armyofagents/shared";

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

  it("a rootless org agent (no kind field) auto-parents to the founder", async () => {
    if (setupError) throw new Error(String(setupError));
    const { companyId, founderId } = await seedCompanyWithFounder();
    const agent = await agentService(db).create(companyId, { name: "Atlas", role: "cxo" });
    expect(agent.parentType).toBe("user");
    expect(agent.parentId).toBe(founderId);
  });

  it("an aoa crew agent is NOT force-parented", async () => {
    if (setupError) throw new Error(String(setupError));
    const { companyId } = await seedCompanyWithFounder();
    const crew = await agentService(db).create(companyId, { name: "X", kind: "aoa", role: "general" });
    expect(crew.parentId).toBeNull();
  });

  it("removing an agent re-parents its reports to the removed agent's parent", async () => {
    if (setupError) throw new Error(String(setupError));
    const { companyId, founderId } = await seedCompanyWithFounder();
    const leadId = firstId(await db.execute(sql`INSERT INTO agents (id, company_id, name, kind, status, parent_type, parent_id) VALUES (gen_random_uuid(), ${companyId}, 'Lead', 'org', 'idle', 'user', ${founderId}) RETURNING id`));
    const workerId = firstId(await db.execute(sql`INSERT INTO agents (id, company_id, name, kind, status, parent_type, parent_id) VALUES (gen_random_uuid(), ${companyId}, 'Worker', 'org', 'idle', 'agent', ${leadId}) RETURNING id`));
    await orgHierarchyService(db).reparentChildren(companyId, leadId, "agent");
    const res = await db.execute(sql`SELECT parent_type, parent_id FROM agents WHERE id = ${workerId}`);
    const w = (Array.isArray(res) ? res[0] : (res as { rows: { parent_type: string; parent_id: string }[] }).rows[0]);
    expect(w.parent_type).toBe("user");
    expect(w.parent_id).toBe(founderId);
  });

  it("ensureRealOperator seeds a real human operator when none exists (local_trusted path)", async () => {
    if (setupError) throw new Error(String(setupError));
    // Seed ONLY a company — no founder user, membership, or role.
    const companyId = firstId(
      await db.execute(sql`INSERT INTO companies (id, name) VALUES (gen_random_uuid(), 'W6 Operator Co') RETURNING id`),
    );

    const operatorId = await accessService(db).ensureRealOperator(companyId, null);
    expect(operatorId).toBeTruthy();

    // A real auth-user row exists for the returned id.
    const userRows = await db.execute(sql`SELECT id FROM "user" WHERE id = ${operatorId}`);
    expect(firstId(userRows)).toBe(operatorId);

    // A user_roles founder row exists for the operator.
    const roleRes = await db.execute(
      sql`SELECT id FROM user_roles WHERE company_id = ${companyId} AND user_id = ${operatorId} AND role = 'founder'`,
    );
    const roleRows = (Array.isArray(roleRes) ? roleRes : (roleRes as { rows: unknown[] }).rows);
    expect(roleRows.length).toBe(1);

    // An owner company_memberships row exists for the operator.
    const memRes = await db.execute(
      sql`SELECT id FROM company_memberships WHERE company_id = ${companyId} AND principal_type = 'user' AND principal_id = ${operatorId} AND membership_role = 'owner' AND status = 'active'`,
    );
    const memRows = (Array.isArray(memRes) ? memRes : (memRes as { rows: unknown[] }).rows);
    expect(memRows.length).toBe(1);

    // The org hierarchy now tops out at the seeded operator.
    expect(await orgHierarchyService(db).getFounderUserId(companyId)).toBe(operatorId);
  });

  it("backfillHumanAtTop re-parents existing rootless org agents to the founder", async () => {
    if (setupError) throw new Error(String(setupError));
    const { companyId, founderId } = await seedCompanyWithFounder();
    const orphanId = firstId(await db.execute(sql`INSERT INTO agents (id, company_id, name, kind, status) VALUES (gen_random_uuid(), ${companyId}, 'Orphan', 'org', 'idle') RETURNING id`));
    const count = await agentService(db).backfillHumanAtTop(companyId);
    expect(count).toBeGreaterThanOrEqual(1);
    const res = await db.execute(sql`SELECT parent_type, parent_id FROM agents WHERE id = ${orphanId}`);
    const a = (Array.isArray(res) ? res[0] : (res as { rows: { parent_type: string; parent_id: string }[] }).rows[0]);
    expect(a.parent_type).toBe("user");
    expect(a.parent_id).toBe(founderId);
  });

  it("importBundle into a NEW company seeds a real operator + roots a rootless org agent at the founder", async () => {
    if (setupError) throw new Error(String(setupError));

    // Minimal valid bundle: one company + one rootless org agent (reportsToSlug
    // null, no parentType/parentIdRef). Mirrors the inline-source shape used by
    // company-portability-env-inputs.test.ts so the manifest schema validates.
    const manifest: CompanyPortabilityManifest = {
      schemaVersion: 2,
      generatedAt: "2026-06-28T00:00:00.000Z",
      source: null,
      includes: { company: true, agents: true, projects: false, issues: false, skills: false, routines: false, envInputs: false },
      company: {
        path: "COMPANY.md",
        name: "Imported W6 Co",
        description: null,
        brandColor: null,
        requireBoardApprovalForNewAgents: true,
      },
      agents: [
        {
          slug: "atlas",
          name: "Atlas",
          path: "agents/atlas/AGENTS.md",
          role: "Engineer",
          title: null,
          icon: null,
          capabilities: null,
          reportsToSlug: null,
          adapterType: "claude_local",
          adapterConfig: {},
          runtimeConfig: {},
          permissions: {},
          budgetMonthlyCents: 0,
          metadata: null,
        },
      ],
      requiredSecrets: [],
    };

    // actorUserId = null exercises the genuine bug: company-create route operator
    // seeding is bypassed, so without the fix the company would have no real human
    // founder and the restored org agent would top out at a non-user principal.
    const result = await companyPortabilityService(db).importBundle(
      {
        source: { type: "inline", manifest, files: {
          "COMPANY.md": "---\nkind: company\nname: Imported W6 Co\n---\n",
          "agents/atlas/AGENTS.md": "---\nname: Atlas\nslug: atlas\n---\nDo the thing.\n",
        } },
        target: { mode: "new_company", newCompanyName: "Imported W6 Co" },
        include: { company: true, agents: true },
      },
      null,
    );

    const companyId = result.company.id;
    expect(result.company.action).toBe("created");

    // (a) A real human founder now exists for the imported company.
    const founderId = await orgHierarchyService(db).getFounderUserId(companyId);
    expect(founderId).toBeTruthy();
    // The founder is backed by a real auth-user row (not the synthetic "board" actor).
    const founderUserRows = await db.execute(sql`SELECT id FROM "user" WHERE id = ${founderId}`);
    const founderUser = (Array.isArray(founderUserRows) ? founderUserRows : (founderUserRows as { rows: unknown[] }).rows);
    expect(founderUser.length).toBe(1);

    // (b) The imported (rootless) org agent now reports to that founder.
    const createdAgent = result.agents.find((a) => a.slug === "atlas");
    expect(createdAgent?.id).toBeTruthy();
    const res = await db.execute(sql`SELECT parent_type, parent_id FROM agents WHERE id = ${createdAgent!.id}`);
    const a = (Array.isArray(res) ? res[0] : (res as { rows: { parent_type: string; parent_id: string }[] }).rows[0]);
    expect(a.parent_type).toBe("user");
    expect(a.parent_id).toBe(founderId);
  });
});
