// MIG-009 — the flag-disable drain, proven at embedded Postgres (Linux CI is the formal
// authority, SKIPPED locally on Windows unless AOA_RUN_WIN_INTEGRATION=1).
//
// Two things this ticket fixes, proven against real SQL / a real bridge:
//   * Step 4 — the missing `listActiveAttempts` store returns exactly the non-terminal
//     attempts for an org, deduped by job, shaped {organizationId, companyId, jobId}.
//   * Step 5 — grain + SQL end-to-end: with the REAL per-Company budget-cost bridge
//     `assertRollbackSafe`, a pending authoritative-cost receipt on ANY Company under the
//     org (including a SIBLING of an attempt's own Company) skips the WHOLE org and
//     cancels nothing; clearing the receipt lets the SAME org drain its non-terminal
//     attempts (the positive control that reddens the M-grain revert — an org-keyed gate
//     throws at Company->Org resolution against the real bridge, so the clean org would
//     stop draining); a terminal-only org drains zero and reports a clean sweep, not an error.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  setupJobControlFixture,
  COMPANY,
  ORG,
  type JobControlFixture,
} from "./helpers/job-control-fixture.js";
import { createDistributedExecutionDrainStore } from "../services/job-distributed-drain-store.js";
import { createDistributedExecutionDrain } from "../services/job-distributed-drain.js";
import { jobBudgetCostBridge } from "../services/job-budget-cost-bridge.js";
import {
  deriveDrainCommandId,
  OPERATOR_DRAIN_REASON,
  runDrainDistributedExecutionCli,
  type DrainTriggerDeps,
} from "../services/distributed-execution-drain-trigger.js";
import { composeDistributedExecutionDrainTriggerDeps } from "../services/distributed-execution-drain-trigger-store.js";

const ENABLED_ENV = { AOA_DISTRIBUTED_EXECUTION_ENABLED: "true" } as const;
// A SECOND Company under the same Organization — the whole point of the per-Company grain.
const COMPANY_B = "a6000000-0000-4000-8000-0000000000b2";
// MIG-009 (M1a, ruling F10): a SECOND Organization with its own Company, so the operator
// trigger is proven to cancel each tenant's attempts under that tenant's own binding.
const ORG_2 = "a6000000-0000-4000-8000-0000000002a1";
const COMPANY_2 = "a6000000-0000-4000-8000-0000000002c1";

let fixture: JobControlFixture | null = null;
let setupError: unknown = null;

function guard(): void {
  if (setupError) throw new Error(`fixture setup failed: ${String(setupError)}`);
  if (!fixture) throw new Error("fixture not initialised");
}

/** Seed a minimal job + one attempt (all-NULL placement satisfies placement_atomic) with
 * the given attempt status, under (ORG, company). Returns the ids. */
async function seedAttempt(
  company: string,
  status: string,
  attemptNumber = 1,
  jobId: string = randomUUID(),
  organizationId: string = ORG,
): Promise<{ jobId: string; attemptId: string }> {
  const attemptId = randomUUID();
  await fixture!.admin`INSERT INTO jobs (id, organization_id, company_id)
    VALUES (${jobId}, ${organizationId}, ${company})
    ON CONFLICT (id) DO NOTHING`;
  await fixture!.admin`INSERT INTO job_attempts
      (id, organization_id, company_id, job_id, attempt_number, status)
    VALUES (${attemptId}, ${organizationId}, ${company}, ${jobId}, ${attemptNumber}, ${status})`;
  return { jobId, attemptId };
}

/** Seed a PENDING authoritative-cost receipt bound to a real seeded attempt of `company`. */
async function seedPendingReceipt(company: string, seeded: { jobId: string; attemptId: string }): Promise<void> {
  await fixture!.admin`INSERT INTO job_projection_receipts
      (organization_id, company_id, projection_kind, source_identity, source_digest,
       job_id, attempt_id, source_fence, status, target_aggregate_id)
    VALUES (${ORG}, ${company}, 'authoritative_cost', ${randomUUID()}, ${"a".repeat(64)},
      ${seeded.jobId}, ${seeded.attemptId}, 'fence', 'pending', ${seeded.jobId})`;
}

function makeDrain(requestCancellation: ReturnType<typeof vi.fn>) {
  const store = createDistributedExecutionDrainStore(fixture!.app.db, fixture!.operator.db);
  const bridge = jobBudgetCostBridge(fixture!.app.db, { env: ENABLED_ENV });
  return createDistributedExecutionDrain({
    listAdmittedOrganizationIds: async ({ afterOrganizationId }) =>
      afterOrganizationId === null ? [ORG] : [],
    listOrganizationCompanyIds: (organizationId) => store.listOrganizationCompanyIds(organizationId),
    listActiveAttempts: (organizationId) => store.listActiveAttempts(organizationId),
    requestCancellation,
    // THE REAL per-Company bridge gate.
    assertRollbackSafe: (companyId) => bridge.assertRollbackSafe(companyId),
  });
}

beforeAll(async () => {
  try {
    fixture = await setupJobControlFixture("mig009-drain");
    // A sibling Company under the same Organization.
    await fixture.admin`INSERT INTO companies (id, organization_id, name, issue_prefix)
      VALUES (${COMPANY_B}, ${ORG}, 'MIG-009 sibling', 'M9B')`;
    await fixture.admin`INSERT INTO organizations (id, name, slug)
      VALUES (${ORG_2}, 'MIG-009 second tenant', 'mig-009-second-tenant')`;
    await fixture.admin`INSERT INTO companies (id, organization_id, name, issue_prefix)
      VALUES (${COMPANY_2}, ${ORG_2}, 'MIG-009 second tenant co', 'M92')`;
  } catch (error) {
    setupError = error;
  }
}, 180_000);

afterAll(async () => {
  await fixture?.teardown().catch(() => {});
}, 60_000);

beforeEach(async () => {
  if (!fixture) return;
  await fixture.resetRuntimeRows();
  await fixture.admin`DELETE FROM activity_log WHERE action = 'job.drain.requested'`;
});

describe.skipIf(process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1")(
  "MIG-009 distributed-execution drain (embedded PG)",
  () => {
    it("[Step 4] listActiveAttempts returns exactly the non-terminal attempts, deduped by job, {org,company,job}", async () => {
      guard();
      const store = createDistributedExecutionDrainStore(fixture!.app.db, fixture!.operator.db);

      const co1NonTerminal = await seedAttempt(COMPANY, "running");
      await seedAttempt(COMPANY, "succeeded"); // terminal → excluded
      const coBNonTerminal = await seedAttempt(COMPANY_B, "leased");
      await seedAttempt(COMPANY_B, "cancelled"); // terminal → excluded
      // A job with TWO simultaneously non-terminal attempts → deduped to ONE row.
      const dupJob = await seedAttempt(COMPANY, "running", 1);
      await seedAttempt(COMPANY, "pending", 2, dupJob.jobId);

      const rows = await store.listActiveAttempts(ORG);

      // Exactly three distinct jobs; the terminal attempts are excluded; the dup job once.
      expect(rows).toHaveLength(3);
      const jobIds = new Set(rows.map((r) => r.jobId));
      expect(jobIds).toEqual(new Set([co1NonTerminal.jobId, coBNonTerminal.jobId, dupJob.jobId]));
      for (const row of rows) {
        expect(row.organizationId).toBe(ORG);
        expect([COMPANY, COMPANY_B]).toContain(row.companyId);
        expect(typeof row.jobId).toBe("string");
      }
    });

    it("[Step 4] returns an empty list for an org whose attempts are ALL terminal", async () => {
      guard();
      const store = createDistributedExecutionDrainStore(fixture!.app.db, fixture!.operator.db);
      await seedAttempt(COMPANY, "succeeded");
      await seedAttempt(COMPANY_B, "expired");
      expect(await store.listActiveAttempts(ORG)).toEqual([]);
    });

    it("[Step 5 / E1] a pending receipt on a SIBLING Company skips the WHOLE org — cancels nothing", async () => {
      guard();
      // Non-terminal attempts in BOTH companies.
      await seedAttempt(COMPANY, "running");
      const siblingAttempt = await seedAttempt(COMPANY_B, "leased");
      // The pending authoritative-cost receipt is on the SIBLING Company only.
      await seedPendingReceipt(COMPANY_B, siblingAttempt);

      const requestCancellation = vi.fn(async () => ({ status: "queued" as const, command: null }));
      const result = await makeDrain(requestCancellation).drainAll();

      // The real per-Company bridge threw for COMPANY_B → whole org skipped, nothing cancelled.
      expect(requestCancellation).not.toHaveBeenCalled();
      expect(result.cancelled).toBe(0);
      expect(result.skippedOrganizations).toEqual([ORG]);
      expect(result.perOrganization).toContainEqual({
        organizationId: ORG,
        skipped: true,
        reason: "rollback_pending",
        cancelled: 0,
      });
    });

    it("[Step 5 / positive control] with NO pending receipt the SAME org drains its non-terminal attempts", async () => {
      guard();
      // Two non-terminal attempts across both Companies, NO pending receipt anywhere.
      await seedAttempt(COMPANY, "running");
      await seedAttempt(COMPANY_B, "leased");

      const requestCancellation = vi.fn(async () => ({ status: "queued" as const, command: null }));
      const result = await makeDrain(requestCancellation).drainAll();

      // The clean org drains BOTH attempts. (M-grain — reverting to a single per-org
      // assertRollbackSafe(organizationId) — reddens HERE: against the real bridge an org
      // id resolves no Company->Org edge and throws, so this clean org would cancel 0.)
      expect(requestCancellation).toHaveBeenCalledTimes(2);
      expect(result.cancelled).toBe(2);
      expect(result.skippedOrganizations).toEqual([]);
    });

    it("[Step 5] a terminal-only org drains zero and reports a clean sweep (not an error, not skipped)", async () => {
      guard();
      await seedAttempt(COMPANY, "succeeded");
      await seedAttempt(COMPANY_B, "cancelled");

      const requestCancellation = vi.fn(async () => ({ status: "queued" as const, command: null }));
      const result = await makeDrain(requestCancellation).drainAll();

      expect(requestCancellation).not.toHaveBeenCalled();
      expect(result.cancelled).toBe(0);
      expect(result.skippedOrganizations).toEqual([]);
      expect(result.perOrganization).toContainEqual({
        organizationId: ORG,
        skipped: false,
        cancelled: 0,
      });
    });
  },
);

// ── MIG-009 (M1a): the OPERATOR TRIGGER's composition root, over the REAL store, the REAL
// budget-cost bridge, the REAL `requestCancellation` and the REAL activity_log. This drives
// `composeDistributedExecutionDrainTriggerDeps` + `runDrainDistributedExecutionCli` — exactly what
// `pnpm drain:distributed-execution` runs — not a hand-built dep bag.

async function runTrigger(wrap?: (deps: DrainTriggerDeps) => DrainTriggerDeps) {
  const out: string[] = [];
  const err: string[] = [];
  const composed = composeDistributedExecutionDrainTriggerDeps({
    appDb: fixture!.app.db,
    operatorDb: fixture!.operator.db,
    env: ENABLED_ENV,
  });
  const code = await runDrainDistributedExecutionCli({
    argv: ["node", "drain-distributed-execution", "--operator", "mig009-rehearsal"],
    distributedExecutionEnabled: true,
    openPools: async () => ({ close: async () => {} }),
    composeDeps: () => (wrap ? wrap(composed) : composed),
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
  const summaryLine = out.find((line) => line.includes('"summary"'));
  if (!summaryLine) throw new Error(`no summary line (exit ${code}):\n${[...out, ...err].join("\n")}`);
  const summary = JSON.parse(summaryLine).summary as {
    cancelled: number;
    skippedOrganizations: string[];
    failedCancellations: Array<{ organizationId: string; jobId: string }>;
  };
  return { code, out, err, summary };
}

async function attemptStatus(attemptId: string): Promise<string> {
  const [row] = await fixture!.admin`SELECT status FROM job_attempts WHERE id = ${attemptId}`;
  return row!.status as string;
}

async function drainAuditRows() {
  return fixture!.admin`SELECT company_id, actor_type, actor_id, entity_id, details
    FROM activity_log WHERE action = 'job.drain.requested' ORDER BY created_at, id`;
}

describe.skipIf(process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1")(
  "MIG-009 (M1a) operator drain trigger — composition root (embedded PG)",
  () => {
    it("[trigger] a sibling-Company pending receipt skips the WHOLE org: exit 1, nothing cancelled, nothing audited", async () => {
      guard();
      const own = await seedAttempt(COMPANY, "running");
      const sibling = await seedAttempt(COMPANY_B, "leased");
      await seedPendingReceipt(COMPANY_B, sibling);

      const { code, summary } = await runTrigger();

      expect(code).toBe(1);
      expect(summary.skippedOrganizations).toContain(ORG);
      expect(await attemptStatus(own.attemptId)).toBe("running");
      expect(await attemptStatus(sibling.attemptId)).toBe("leased");
      expect(await drainAuditRows()).toHaveLength(0);
    });

    it("[trigger / positive control] clearing the receipt lets the SAME org drain, each cancel with its actor-attributed audit row", async () => {
      guard();
      const own = await seedAttempt(COMPANY, "running");
      const sibling = await seedAttempt(COMPANY_B, "leased");

      const { code, summary } = await runTrigger();

      expect(code).toBe(0);
      expect(summary.skippedOrganizations).toEqual([]);
      expect(summary.cancelled).toBe(2);
      // Unleased attempts are finalized directly by requestCancellation.
      expect(await attemptStatus(own.attemptId)).toBe("cancelled");
      expect(await attemptStatus(sibling.attemptId)).toBe("cancelled");
      const rows = await drainAuditRows();
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.actor_type).toBe("system");
        expect(row.actor_id).toBe("operator-cli:mig009-rehearsal");
        expect((row.details as { reason: string }).reason).toBe(OPERATOR_DRAIN_REASON);
        expect((row.details as { outcome: string }).outcome).toBe("cancelled");
      }
      expect(new Set(rows.map((row) => row.entity_id))).toEqual(new Set([own.jobId, sibling.jobId]));
      expect(new Set(rows.map((row) => row.company_id))).toEqual(new Set([COMPANY, COMPANY_B]));
    });

    it("[trigger] a terminal-only fleet drains zero as a clean sweep (exit 0, no audit rows)", async () => {
      guard();
      await seedAttempt(COMPANY, "succeeded");
      await seedAttempt(COMPANY_B, "cancelled");
      await seedAttempt(COMPANY_2, "expired", 1, randomUUID(), ORG_2);

      const { code, summary } = await runTrigger();

      expect(code).toBe(0);
      expect(summary.cancelled).toBe(0);
      expect(summary.skippedOrganizations).toEqual([]);
      expect(await drainAuditRows()).toHaveLength(0);
    });

    it("[trigger / silent-cancel (ii)] a LEASED attempt is left cancel_requested and the clean run still exits 0; a re-run queues no second command", async () => {
      guard();
      const { seeded } = await fixture!.activateLease(91);

      const first = await runTrigger();
      expect(first.code).toBe(0);
      expect(first.summary.cancelled).toBe(1);
      // Cancellation is a REQUEST: the attempt is still non-terminal when the sweep returns.
      expect(await attemptStatus(seeded.attemptId)).toBe("cancel_requested");
      const commands = await fixture!.admin`SELECT command_id FROM job_control_commands
        WHERE job_id = ${seeded.jobId} AND command_kind = 'cancel'`;
      expect(commands.map((row) => row.command_id)).toEqual([deriveDrainCommandId(seeded.jobId)]);

      const second = await runTrigger();
      expect(second.code).toBe(0);
      const after = await fixture!.admin`SELECT count(*)::int AS n FROM job_control_commands
        WHERE job_id = ${seeded.jobId} AND command_kind = 'cancel'`;
      expect(after[0]!.n).toBe(1);
      const rows = await drainAuditRows();
      expect(rows.map((row) => (row.details as { outcome: string }).outcome)).toEqual(["queued", "already_requested"]);
      expect(rows[0]!.details).toMatchObject({ commandId: deriveDrainCommandId(seeded.jobId) });
    });

    it("[trigger / multi-tenant] two Organizations each drain under their OWN tenant binding; one org's failure is reported for that org only", async () => {
      guard();
      const org1 = await seedAttempt(COMPANY, "running");
      const org2 = await seedAttempt(COMPANY_2, "running", 1, randomUUID(), ORG_2);

      // Same-tenant positive control: both tenants drain, each audit row carries its own Company.
      const clean = await runTrigger();
      expect(clean.code).toBe(0);
      expect(await attemptStatus(org1.attemptId)).toBe("cancelled");
      expect(await attemptStatus(org2.attemptId)).toBe("cancelled");
      const rows = await drainAuditRows();
      expect(rows.map((row) => [row.entity_id, row.company_id]).sort()).toEqual(
        [[org1.jobId, COMPANY], [org2.jobId, COMPANY_2]].sort(),
      );

      // ORG_2's tenant transaction fails; ORG's still commits, and only ORG_2 is reported.
      await fixture!.resetRuntimeRows();
      await fixture!.admin`DELETE FROM activity_log WHERE action = 'job.drain.requested'`;
      const again1 = await seedAttempt(COMPANY, "running");
      const again2 = await seedAttempt(COMPANY_2, "running", 1, randomUUID(), ORG_2);
      const failing = await runTrigger((deps) => ({
        ...deps,
        withTenant: (organizationId, work) =>
          organizationId === ORG_2
            ? Promise.reject(Object.assign(new Error("tenant transaction failed"), { code: "40001" }))
            : deps.withTenant(organizationId, work),
      }));
      expect(failing.code).toBe(1);
      expect(failing.summary.skippedOrganizations).toEqual([]);
      expect(failing.summary.failedCancellations.map((f) => [f.organizationId, f.jobId])).toEqual([
        [ORG_2, again2.jobId],
      ]);
      expect(await attemptStatus(again1.attemptId)).toBe("cancelled");
      expect(await attemptStatus(again2.attemptId)).toBe("running");
    });

    it("[trigger / atomicity] an audit insert that fails rolls the REAL cancel back in the same tenant transaction (exit 1)", async () => {
      guard();
      const seeded = await seedAttempt(COMPANY, "running");

      const { code, summary } = await runTrigger((deps) => ({
        ...deps,
        withTenant: (organizationId, work) =>
          deps.withTenant(organizationId, (scope) =>
            work({
              ...scope,
              recordDrainAudit: async () => {
                throw new Error("audit insert failed");
              },
            })),
      }));

      expect(code).toBe(1);
      expect(summary.failedCancellations.map((f) => f.jobId)).toEqual([seeded.jobId]);
      // requestCancellation ran and UPDATEd the attempt inside the transaction — and was rolled
      // back with the failed audit write. Never a cancelled attempt with no record of who did it.
      expect(await attemptStatus(seeded.attemptId)).toBe("running");
      const [job] = await fixture!.admin`SELECT status FROM jobs WHERE id = ${seeded.jobId}`;
      expect(job!.status).not.toBe("cancelled");
      expect(await drainAuditRows()).toHaveLength(0);
    });
  },
);
