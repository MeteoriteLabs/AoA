/**
 * DE-27, audit clause (cross-replica-admission conjunct) — a refused worker admission
 * leaves an attributable durable record, for BOTH of the two admission deny sites.
 *
 * ★ WHAT THIS TEST IS FOR. `docs/architecture/distributed-execution-threat-controls.json`
 * DE-27's `audit` clause was AMENDED by E0-F013 Decision 1.2(c): "cross-replica
 * admission events are audited" is read WEAKLY — each admission REFUSAL is durably
 * recorded — and the "partition" conjunct is dropped as vacuous (no detector exists).
 * Admission is already DB-serialized across replicas (a shared advisory lock over the
 * organization for capacity; one shared counter row for the poll limiter), so the
 * clause does NOT require a record naming WHICH replica decided, and the system has no
 * replica identity to name. So the whole remaining deliverable is: durably record the
 * two admission refusals —
 *   over_cap  — `worker-admission-rate-limit.ts admit()` (`:138-140`), the shared
 *               per-organization worker-poll rate limit; and
 *   capacity  — `org-concurrency.ts admitAttemptCapacity()` (`:247-249`), the shared
 *               per-organization concurrency cap, reached at submit time.
 * Before this unit both deny paths returned/threw before anything durable was written,
 * so a throttled poll and a capacity-refused submit were indistinguishable from traffic
 * that never happened.
 *
 * ★ WHY THIS IS NOT A READ-BACK. It never constructs a denial row. It PROVOKES the real
 * refusals through the real code — the real `createWorkerAdmissionRateLimiter().admit`
 * over a real shared counter, and the real `jobSubmissionService.submit` over a real
 * organization cap of 1 — and then asserts the durable rows the refusals themselves
 * leave behind, against real embedded PostgreSQL under the real `aoa_app` non-owner role.
 *
 * ★ ATTRIBUTION IS THE ASSERTION. Each of WHO / TENANT / RESOURCE / WHY is asserted
 * separately rather than asserting that a row merely exists:
 *   WHO      -> actor_type/actor_id is the organization whose admission was refused
 *               (admission is org-scoped; no finer principal exists at the control point)
 *   TENANT   -> organization_id (and, for capacity, company_id) is the refusing tenant
 *   RESOURCE -> over_cap names the org's worker-poll admission; capacity names the attempt
 *   WHY      -> details.reason is a stable branch code, told APART (over_cap vs capacity),
 *               plus details.crossing = "DE-27"
 *
 * ★ POSITIVE CONTROLS, so "always write an admission-denial row" fails this file:
 *   1. The two ADMITTED polls (count 1, 2) below the cap write NO row.
 *   2. The ADMITTED submit (under the cap of 1) writes NO row.
 *   3. The two refusals carry DIFFERENT reason codes — a constant reason would fail the
 *      anti-vacuity arm.
 *   4. ATTRIBUTION IS NOT A CONSTANT: a refusal for a SECOND organization lands under
 *      that organization, not the first.
 *
 * Real Postgres (embedded-postgres + the committed migration chain), the real limiter,
 * the real submit path (which threads the capacity-denial sink and drains it on the pool
 * handle after the rolled-back tenant transaction closes). No stubs on the deny path and
 * none on the writer.
 *
 * Skipped on Windows CI by default (the `runneradmin` account cannot start
 * embedded-postgres — Issue #114); Linux CI `push` is the authoritative gate. On a
 * Windows dev box set `AOA_RUN_WIN_INTEGRATION=1` to run it for real. Harness modeled on
 * `worker-admission-rate-limit.integration.test.ts`, `job-submit-capacity-admission.integration.test.ts`
 * and `de-19-memory-denial-audit.integration.test.ts`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { HttpError } from "../errors.js";
import { createWorkerAdmissionRateLimiter } from "../services/worker-admission-rate-limit.js";
import { jobSubmissionService } from "../services/job-submission.js";
import { ORG, COMPANY, setupJobControlFixture, type JobControlFixture } from "./helpers/job-control-fixture.js";

const integration = describe.skipIf(
  process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1",
);

/** A SECOND organization, for the attribution control. Its own `organizations` row so a
 * refusal for it is FK-valid and attributable to it and not to `ORG`. */
const ORG2 = "a6000000-0000-4000-8000-0000000000f2";

interface DenialRow {
  company_id: string | null;
  organization_id: string | null;
  actor_type: string;
  actor_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: Record<string, unknown> | null;
}

integration("DE-27 audit clause — the two worker-admission refusals leave attributable durable records", () => {
  let fx: JobControlFixture | null = null;
  let setupError: unknown = null;
  let priorFlag: string | undefined;

  function ctx(): JobControlFixture {
    if (setupError) throw new Error(`embedded-postgres setup failed: ${String(setupError)}`);
    if (!fx) throw new Error("fixture not initialized");
    return fx;
  }

  /** Every `security.denied.worker_admission` row, newest last. */
  async function admissionDenialRows(): Promise<DenialRow[]> {
    return ctx().admin<DenialRow[]>`
      SELECT company_id, organization_id, actor_type, actor_id, action, entity_type, entity_id, details
      FROM activity_log
      WHERE action = 'security.denied.worker_admission'
      ORDER BY created_at ASC`;
  }

  async function rowsWithReason(reason: string): Promise<DenialRow[]> {
    return (await admissionDenialRows()).filter((r) => r.details?.reason === reason);
  }

  async function clearAll(): Promise<void> {
    const { admin } = ctx();
    await admin`DELETE FROM activity_log WHERE action = 'security.denied.worker_admission'`;
    await admin`DELETE FROM worker_admission_rate_limits`;
    await admin`DELETE FROM job_outbox`;
    await admin`DELETE FROM job_attempts`;
    await admin`DELETE FROM jobs`;
    await admin`UPDATE organizations SET concurrency_cap = NULL WHERE id IN (${ORG}, ${ORG2})`;
  }

  const WINDOW_MS = 60_000;
  const clockAt = (ms: number) => () => new Date(ms);

  function submission(idempotencyKey: string) {
    return {
      organizationId: ORG,
      companyId: COMPANY,
      principal: { kind: "system" as const, id: "de27-submit-test" },
      command: {
        idempotencyKey,
        source: { kind: "one_shot" as const, operationId: randomUUID(), operationKind: "readiness_probe" as const },
        input: { value: "de27" },
      },
    };
  }

  beforeAll(async () => {
    // The submit-time capacity admission is dormant behind the deployment flag; turn it on.
    priorFlag = process.env.AOA_DISTRIBUTED_EXECUTION_ENABLED;
    process.env.AOA_DISTRIBUTED_EXECUTION_ENABLED = "true";
    try {
      fx = await setupJobControlFixture("de27-admission-audit");
      // The second organization for the attribution control (no company needed — the
      // over_cap refusal is org-scoped and records companyId=null).
      await fx.admin`INSERT INTO organizations (id, name, slug) VALUES (${ORG2}, 'DE-27 org B', 'de27-org-b')`;
    } catch (error) {
      setupError = error;
    }
  }, 180_000);

  afterEach(async () => {
    if (fx && !setupError) await clearAll();
  });

  afterAll(async () => {
    if (priorFlag === undefined) delete process.env.AOA_DISTRIBUTED_EXECUTION_ENABLED;
    else process.env.AOA_DISTRIBUTED_EXECUTION_ENABLED = priorFlag;
    await fx?.teardown();
  }, 60_000);

  it("setup: nothing has been refused yet, so no admission-denial row exists", async () => {
    await clearAll();
    expect(await admissionDenialRows()).toHaveLength(0);
  });

  // ── over_cap ────────────────────────────────────────────────────────────────────────

  it("PROVOKE over_cap — the third poll over a cap of 2 is refused", async () => {
    await clearAll();
    const limiter = createWorkerAdmissionRateLimiter({
      appDb: ctx().app.db,
      config: { windowMs: WINDOW_MS, max: 2 },
      now: clockAt(120_000),
    });
    expect((await limiter.admit(ORG)).allowed).toBe(true); // count 1
    expect((await limiter.admit(ORG)).allowed).toBe(true); // count 2
    const third = await limiter.admit(ORG);
    expect(third).toEqual({ allowed: false, reason: "over_cap", count: 3, limit: 2 });
  }, 60_000);

  it("★ THE CLAUSE (over_cap) — that refusal wrote ONE durable row attributing WHO / TENANT / RESOURCE / WHY", async () => {
    await clearAll();
    const limiter = createWorkerAdmissionRateLimiter({
      appDb: ctx().app.db,
      config: { windowMs: WINDOW_MS, max: 2 },
      now: clockAt(120_000),
    });
    await limiter.admit(ORG);
    await limiter.admit(ORG);
    await limiter.admit(ORG); // over_cap

    const rows = await admissionDenialRows();
    // POSITIVE CONTROL — the two ADMITTED polls wrote NO row. Without this, "write an
    // admission-denial row unconditionally" would pass every over_cap assertion below.
    expect(rows).toHaveLength(1);
    const row = rows[0]!;

    // WHO — admission is org-scoped, so the organization is the refused actor, not a user/agent.
    expect(row.actor_type).toBe("system");
    expect(row.actor_id).toBe(ORG);
    // TENANT — org-scoped limiter: the organization axis is set, the company axis is null.
    expect(row.organization_id).toBe(ORG);
    expect(row.company_id).toBeNull();
    // RESOURCE — the org's worker-poll admission bucket.
    expect(row.entity_type).toBe("worker_poll_admission");
    expect(row.entity_id).toBe(ORG);
    // WHY — a stable branch code, the crossing, and the control that refused.
    expect(row.action).toBe("security.denied.worker_admission");
    expect(row.details?.reason).toBe("over_cap");
    expect(row.details?.crossing).toBe("DE-27");
    expect(String(row.details?.control)).toContain("worker-admission-rate-limit.ts");
    // The window count and limit ride details, so an operator can see how far over the org went.
    expect(Number(row.details?.count)).toBe(3);
    expect(Number(row.details?.limit)).toBe(2);
  }, 60_000);

  it("★ ATTRIBUTION IS NOT A CONSTANT — a refusal for a SECOND organization lands under THAT organization", async () => {
    await clearAll();
    const limiterB = createWorkerAdmissionRateLimiter({
      appDb: ctx().app.db,
      config: { windowMs: WINDOW_MS, max: 1 },
      now: clockAt(120_000),
    });
    expect((await limiterB.admit(ORG2)).allowed).toBe(true); // count 1
    const over = await limiterB.admit(ORG2);
    expect(over).toMatchObject({ allowed: false, reason: "over_cap" });

    const rows = await admissionDenialRows();
    expect(rows).toHaveLength(1);
    // The row is attributed to ORG2 — the refusing organization — not to ORG. A writer that
    // stamped a constant tenant would fail here.
    expect(rows[0]!.organization_id).toBe(ORG2);
    expect(rows[0]!.actor_id).toBe(ORG2);
    expect(rows[0]!.organization_id).not.toBe(ORG);
  }, 60_000);

  // ── capacity ────────────────────────────────────────────────────────────────────────

  it("PROVOKE capacity — a submit over an organization cap of 1 is refused (429), and the ADMITTED submit before it wrote NO row", async () => {
    await clearAll();
    await ctx().admin`UPDATE organizations SET concurrency_cap = 1 WHERE id = ${ORG}`;
    const svc = jobSubmissionService(ctx().app.db);

    const first = await svc.submit(submission(randomUUID()));
    expect(first.replayed).toBe(false);
    // POSITIVE CONTROL — the admitted submit wrote no capacity denial row.
    expect(await rowsWithReason("capacity")).toHaveLength(0);

    await expect(svc.submit(submission(randomUUID()))).rejects.toMatchObject({ status: 429 });
  }, 60_000);

  it("★ THE CLAUSE (capacity) — the capacity refusal wrote ONE durable row attributing WHO / TENANT / RESOURCE / WHY", async () => {
    await clearAll();
    await ctx().admin`UPDATE organizations SET concurrency_cap = 1 WHERE id = ${ORG}`;
    const svc = jobSubmissionService(ctx().app.db);

    await svc.submit(submission(randomUUID())); // admitted, holds the one slot
    await expect(svc.submit(submission(randomUUID()))).rejects.toMatchObject({ status: 429 });

    const rows = await rowsWithReason("capacity");
    // Exactly one — the admitted submit wrote nothing, the refused submit wrote one.
    expect(rows).toHaveLength(1);
    const row = rows[0]!;

    // WHO — the organization whose capacity was exhausted.
    expect(row.actor_type).toBe("system");
    expect(row.actor_id).toBe(ORG);
    // TENANT — both axes: capacity holds an FK-valid company (the just-inserted attempt).
    expect(row.organization_id).toBe(ORG);
    expect(row.company_id).toBe(COMPANY);
    // RESOURCE — the attempt that could not claim a slot (a real uuid; the attempt row
    // itself rolled back with the refused submission, but entity_id carries no FK).
    expect(row.entity_type).toBe("job_attempt");
    expect(row.entity_id).toMatch(/^[0-9a-f-]{36}$/i);
    // WHY.
    expect(row.action).toBe("security.denied.worker_admission");
    expect(row.details?.reason).toBe("capacity");
    expect(row.details?.crossing).toBe("DE-27");
    expect(String(row.details?.control)).toContain("org-concurrency.ts");
    expect(Number(row.details?.cap)).toBe(1);
  }, 60_000);

  // ── anti-vacuity ──────────────────────────────────────────────────────────────────

  it("★ THE REASON IS READ FROM THE BRANCH, NOT STAMPED — the two refusals carry DIFFERENT reason codes under the SAME action", async () => {
    await clearAll();
    // one over_cap
    const limiter = createWorkerAdmissionRateLimiter({
      appDb: ctx().app.db,
      config: { windowMs: WINDOW_MS, max: 1 },
      now: clockAt(120_000),
    });
    await limiter.admit(ORG);
    await limiter.admit(ORG); // over_cap
    // one capacity
    await ctx().admin`UPDATE organizations SET concurrency_cap = 1 WHERE id = ${ORG}`;
    const svc = jobSubmissionService(ctx().app.db);
    await svc.submit(submission(randomUUID()));
    await expect(svc.submit(submission(randomUUID()))).rejects.toMatchObject({ status: 429 });

    const rows = await admissionDenialRows();
    const reasons = rows.map((r) => r.details?.reason);
    // Both refusals filed under the ONE admission action, distinguished only by reason —
    // a constant reason (the mutation) would collapse this set to size 1.
    expect(new Set(rows.map((r) => r.action))).toEqual(new Set(["security.denied.worker_admission"]));
    expect(new Set(reasons)).toEqual(new Set(["over_cap", "capacity"]));
  }, 60_000);
});
