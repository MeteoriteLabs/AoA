/**
 * E0-F013 Decision 2, acceptance condition (c) — the unscoped-reader disclosure
 * path, closed and PROVOKED.
 *
 * ★ WHAT THE PAPER FOUND. `DECISION-REQUEST-unattributable-denial-sink.md` §2
 * measured that `activityService.forIssue` filters on `entityType = 'issue'` +
 * `entityId` and NOTHING ELSE — no company predicate — while the route that
 * serves it, `GET /issues/:id/activity`, gates on the ISSUE's company
 * (`assertCompanyAccess(db, req, issue.companyId)`), never on the ROW's. On the
 * denial recorder `entityType`/`entityId` are caller-supplied free text
 * (`security-denial-audit.ts`), so a denial row recorded in tenant B and typed
 * `issue` against tenant A's issue id is returned to a tenant-A reader. The
 * ruling makes `company_id` NULLABLE, so this stops being an oddity and becomes
 * the door the decision exists to shut: it hands Decision 3's disclosure
 * question straight back.
 *
 * ★ BLAST RADIUS, MEASURED BEFORE CHOOSING (the answer is LATENT, not LIVE).
 * All three production callers of `recordSecurityDenial` HARD-CODE their
 * `entityType`: `memory_item` (`mcp/tools/read-tools.ts`) and `job_artifact`
 * (`services/artifact-commit.ts`, `services/artifact-transfer-grant.ts`). None
 * types `issue`, so no denial row reachable through `forIssue` exists today, and
 * `company_id` is still NOT NULL so no tenantless row exists either. The
 * exposure is therefore LATENT — one future writer, or one caller-chosen
 * `entityType`, away. It is fixed now because the ruling removes the second of
 * those two protections in the same wave.
 *
 * ★ THE FIX CHOSEN, AND WHY THIS ONE. The paper offered two: scope `forIssue` by
 * company, or bar the denial namespace from entity types an unscoped reader keys
 * on. This file proves the FIRST. Barring entity types would have to be enforced
 * inside `security-denial-audit.ts` — Unit A's file this wave — and it protects
 * only the rows it knows about, leaving `forIssue` cross-tenant for every other
 * writer. Scoping the reader fixes the reader, which is where the defect is, and
 * it is defensive against the ruling by construction: a NULL `company_id` never
 * satisfies `company_id = $1`, so a tenantless denial row is invisible here the
 * moment Unit A lands.
 *
 * ★ WHY THIS IS A PROVOCATION AND NOT A READ-BACK. Nothing here asserts what the
 * predicate says. The row is planted through the REAL `recordSecurityDenial`
 * (which is exactly what proves `entityType`/`entityId` are unconstrained), and
 * the assertion is made against the REAL route + REAL service over real
 * Postgres. A read-back verifies what was DECLARED; this asserts what is
 * ENFORCED.
 *
 * ★ NAMED POSITIVE CONTROLS, because "return nothing" must fail this file:
 *   1. SAME-TENANT ROW STILL RETURNED — a legitimate tenant-A `issue` activity
 *      row on the same issue comes back. Scope the reader to nothing and this
 *      goes red.
 *   2. THE PLANTED ROW EXISTS — asserted by raw SQL. Its absence from the
 *      response is the predicate, not a failed insert.
 *   3. THE ROUTE STILL WORKS AT ALL — 200, not 403/404.
 *
 * Real Postgres (embedded-postgres + the committed migration chain), the real
 * `activityRoutes(db)` router, the real `activityService`, the real
 * `assertCompanyAccess`. No stubs on the reader and none on the writer.
 *
 * Skipped on Windows CI by default (the `runneradmin` account cannot start
 * embedded-postgres — Issue #114); Linux CI is the authoritative gate. On a
 * Windows dev box set `AOA_RUN_WIN_INTEGRATION=1` to run it for real.
 */
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { applyPendingMigrations, createDb, type Db } from "@armyofagents/db";
import { activityRoutes } from "../routes/activity.js";
import { errorHandler } from "../middleware/index.js";
import { recordSecurityDenial } from "../services/security-denial-audit.js";
import { allocateEmbeddedPgPort } from "./helpers/embedded-pg-port.js";

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
let setupFailed = false;

function assertSetupOk(): void {
  const dbReady = (db as Db | undefined) !== undefined;
  if (!setupFailed && dbReady) return;
  throw new Error(
    `embedded-postgres setup failed (see the console.error above): ${
      setupError instanceof Error ? setupError.message : String(setupError)
    }`,
  );
}

function firstId(result: unknown): string {
  if (Array.isArray(result)) return (result[0] as { id: string })?.id;
  return (result as { rows?: { id: string }[] }).rows?.[0]?.id;
}

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

/** Tenant A — owns the issue, and is the tenant the reader is authorized for. */
let coA = "";
/** Tenant B — the tenant the planted denial row is attributed to. */
let coB = "";
/** An issue owned by tenant A. Its id is the `entityId` the probe reuses. */
let issueA = "";

/**
 * A board session scoped to ONE company, the shape `assertCompanyAccess` reads
 * in static (non-cloud) mode. Deliberately NOT an instance admin: that branch
 * short-circuits the company check and would make the test vacuous.
 */
function appAsMemberOf(companyId: string) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { actor: unknown }).actor = {
      type: "board",
      userId: "user-a",
      source: "session",
      isInstanceAdmin: false,
      companyIds: [companyId],
    };
    next();
  });
  app.use("/api", activityRoutes(db));
  app.use(errorHandler);
  return app;
}

/**
 * An OPERATOR-plane board session: `operator: true`, and a member of NO company.
 * `canManageInstanceSettings` reads `req.actor.operator` deliberately rather than
 * `isInstanceAdmin` (which cloud_auth clamps to false), so this is the shape a
 * real cloud operator presents. Membership of zero companies is the point: it
 * proves the denial reader is not smuggling company scope in through the actor.
 */
function appAsOperator() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { actor: unknown }).actor = {
      type: "board",
      userId: "operator-1",
      source: "session",
      operator: true,
      isInstanceAdmin: false,
      companyIds: [],
    };
    next();
  });
  app.use("/api", activityRoutes(db));
  app.use(errorHandler);
  return app;
}

interface ActivityRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  companyId: string | null;
}

beforeAll(async () => {
  try {
    dataDir = await mkdtemp(join(tmpdir(), "aoa-e0f013-disclosure-"));
    const port = await allocateEmbeddedPgPort();
    const { default: EmbeddedPostgres } = (await import("embedded-postgres")) as {
      default: EmbeddedPostgresCtor;
    };
    pg = new EmbeddedPostgres({
      databaseDir: join(dataDir, "db"),
      user: "test",
      password: "test",
      port,
      persistent: false,
      initdbFlags: ["--encoding=UTF8", "--locale=C"],
    });
    await pg.initialise();
    await pg.start();
    const connectionString = `postgres://test:test@localhost:${port}/postgres`;
    await applyPendingMigrations(connectionString);
    db = createDb(connectionString);
  } catch (err) {
    setupError = err;
    setupFailed = true;
    // eslint-disable-next-line no-console
    console.error("[e0f013-disclosure] embedded-postgres setup failed:", err);
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

describe.skipIf(process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1")(
  "E0-F013 (c) — a denial row typed `issue` in another tenant does not come back from GET /issues/:id/activity",
  () => {
    it("setup: two companies, one issue in company A, one legitimate same-tenant activity row on it", async () => {
      assertSetupOk();

      coA = firstId(
        await db.execute<{ id: string }>(sql`
          INSERT INTO companies (organization_id, id, name, issue_prefix)
          VALUES ('00000000-0000-0000-0000-000000000001', gen_random_uuid(), 'Disclosure Co A', 'DCA')
          RETURNING id`),
      );
      coB = firstId(
        await db.execute<{ id: string }>(sql`
          INSERT INTO companies (organization_id, id, name, issue_prefix)
          VALUES ('00000000-0000-0000-0000-000000000001', gen_random_uuid(), 'Disclosure Co B', 'DCB')
          RETURNING id`),
      );
      expect(coA).toBeTruthy();
      expect(coB).toBeTruthy();
      expect(coA).not.toBe(coB);

      issueA = firstId(
        await db.execute<{ id: string }>(sql`
          INSERT INTO issues (id, company_id, title, status)
          VALUES (gen_random_uuid(), ${coA}, 'Tenant A task', 'todo')
          RETURNING id`),
      );
      expect(issueA).toBeTruthy();

      // POSITIVE CONTROL #1's fixture: an ordinary, correctly-attributed
      // tenant-A activity row on the same issue.
      await db.execute(sql`
        INSERT INTO activity_log (id, company_id, actor_type, actor_id, action, entity_type, entity_id)
        VALUES (gen_random_uuid(), ${coA}, 'user', 'user-a', 'issue.created', 'issue', ${issueA})`);
    });

    it("plants the probe through the REAL recorder: a tenant-B denial typed `issue` against tenant A's issue id", async () => {
      assertSetupOk();

      // This call is itself the evidence for the paper's claim that
      // `entityType`/`entityId` are caller-supplied free text on the recorder:
      // nothing here is rejected, coerced, or namespaced.
      const id = await recordSecurityDenial(db, {
        companyId: coB,
        crossing: "E0-F013",
        surface: "disclosure_path_probe",
        reason: "cross_tenant_probe",
        actorType: "system",
        actorId: "prober",
        entityType: "issue",
        entityId: issueA,
        control: "server/src/__tests__/e0-f013-denial-disclosure-path.integration.test.ts",
        details: { note: "planted by the acceptance-condition-(c) provocation" },
      });

      // POSITIVE CONTROL #2 — the row really is in the table. Without this, an
      // empty response below would be indistinguishable from a failed insert,
      // and the test would pass while proving nothing.
      expect(id, "recordSecurityDenial returned null — the probe was never planted").toBeTruthy();
      const planted = rowsOf<{ n: string }>(
        await db.execute(sql`
          SELECT count(*)::text AS n FROM activity_log
          WHERE action = 'security.denied.disclosure_path_probe'
            AND entity_type = 'issue' AND entity_id = ${issueA} AND company_id = ${coB}`),
      );
      expect(planted[0]?.n).toBe("1");
    });

    it("★ THE PROVOCATION: tenant A's issue activity feed does not disclose the tenant-B denial row", async () => {
      assertSetupOk();

      const res = await request(appAsMemberOf(coA)).get(`/api/issues/${issueA}/activity`);

      // POSITIVE CONTROL #3 — the route is reachable and authorized. A 403/404
      // would produce an empty body for the wrong reason.
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const rows = res.body as ActivityRow[];
      expect(Array.isArray(rows)).toBe(true);

      expect(
        rows.map((r) => r.action),
        "GET /issues/:id/activity returned a `security.denied.*` row attributed to ANOTHER company — the unscoped-reader disclosure path is open",
      ).not.toContain("security.denied.disclosure_path_probe");
      expect(
        rows.filter((r) => r.companyId !== null && r.companyId !== coA),
        "GET /issues/:id/activity returned a row belonging to another company",
      ).toEqual([]);

      // POSITIVE CONTROL #1 — the legitimate same-tenant row is still returned.
      // A reader that returns nothing also passes the two assertions above.
      expect(
        rows.map((r) => r.action),
        "the same-tenant activity row vanished too — the reader was scoped to nothing, not to the company",
      ).toContain("issue.created");
    });

    it("a tenant-B member is still refused the route outright (the company gate itself is intact)", async () => {
      assertSetupOk();
      const res = await request(appAsMemberOf(coB)).get(`/api/issues/${issueA}/activity`);
      expect(res.status).toBe(403);
    });

    /**
     * ★ ACCEPTANCE CONDITION (a) — the reader, proved on the SAME rows the
     * condition-(c) arms above just proved are undisclosed to tenants.
     *
     * The two halves of the ruling are one property, not two: the denial row
     * must be UNREACHABLE from every company surface and REACHABLE from exactly
     * one operator surface. Asserting them against the same planted row is what
     * makes "we hid it" distinguishable from "we lost it".
     */
    it("★ (a) THE READER: the operator plane can see the same denial row that no tenant surface disclosed", async () => {
      assertSetupOk();

      const res = await request(appAsOperator()).get("/api/instance/security-denials");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const rows = res.body as (ActivityRow & { details: Record<string, unknown> | null })[];

      const probe = rows.find((r) => r.action === "security.denied.disclosure_path_probe");
      expect(
        probe,
        "the operator reader did not return the planted denial row — the evidence is written and still unreachable, which is the failure acceptance condition (a) exists to prevent",
      ).toBeTruthy();

      // ATTRIBUTION is the point of the namespace, so the reader must carry it
      // through rather than returning a bare count. All four questions:
      expect(probe?.companyId, "WHICH TENANT").toBe(coB);
      expect(probe?.entityType, "WHICH RESOURCE (kind)").toBe("issue");
      expect(probe?.entityId, "WHICH RESOURCE (id)").toBe(issueA);
      expect(probe?.details?.crossing, "WHICH CROSSING").toBe("E0-F013");
      expect(probe?.details?.reason, "WHY").toBe("cross_tenant_probe");
    });

    it("(a) the reader is closed to a company member — including one who is a member of the denial's own tenant", async () => {
      assertSetupOk();
      const res = await request(appAsMemberOf(coB)).get("/api/instance/security-denials");
      expect(res.status, JSON.stringify(res.body)).toBe(403);
    });

    /**
     * POSITIVE CONTROL for the namespace predicate itself. Four green arms above
     * are also what a reader that returns EVERY activity row would produce, so
     * prove it excludes non-denial rows — the tenant-A `issue.created` row that
     * condition (c)'s positive control depends on must NOT appear here.
     */
    it("(a) the reader returns only the reserved namespace, not the whole audit log", async () => {
      assertSetupOk();
      const res = await request(appAsOperator()).get("/api/instance/security-denials");
      expect(res.status).toBe(200);
      const rows = res.body as ActivityRow[];
      expect(rows.length).toBeGreaterThan(0);
      expect(
        rows.map((r) => r.action),
        "the operator reader returned an ordinary product activity row — it is a whole-audit-log reader wearing a denial-reader name",
      ).not.toContain("issue.created");
      expect(rows.every((r) => r.action.startsWith("security.denied."))).toBe(true);
    });

    it("(a) filters narrow rather than widen: an unmatched crossing returns nothing", async () => {
      assertSetupOk();
      const miss = await request(appAsOperator())
        .get("/api/instance/security-denials")
        .query({ crossing: "DE-NOT-A-CROSSING" });
      expect(miss.status).toBe(200);
      expect(miss.body).toEqual([]);

      // POSITIVE CONTROL — the same filter with the real value still matches, so
      // the empty result above is the predicate and not a broken filter path.
      const hit = await request(appAsOperator())
        .get("/api/instance/security-denials")
        .query({ crossing: "E0-F013" });
      expect(hit.status).toBe(200);
      expect((hit.body as ActivityRow[]).length).toBeGreaterThan(0);
    });
  },
);
