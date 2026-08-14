import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LeaseOfferV1, LeaseRenewOperationRequestV1 } from "@armyofagents/worker-protocol";
import { createJobReconciliationService } from "../services/job-reconciliation.js";
import { createJobLeaseRenewalService } from "../services/job-fencing.js";
import { runInTenant } from "../db/tenant-context.js";
import {
  auth,
  COMPANY,
  ORG,
  setupJobControlFixture,
  type JobControlFixture,
} from "./helpers/job-control-fixture.js";

const integration = describe.skipIf(
  process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1",
);

function renewRequest(offer: LeaseOfferV1): LeaseRenewOperationRequestV1 {
  return {
    protocolVersion: 1,
    correlationId: crypto.randomUUID(),
    issuedAt: new Date().toISOString(),
    nonce: `renew-${crypto.randomUUID()}`,
    audience: "worker_run",
    idempotencyKey: crypto.randomUUID(),
    body: {
      protocolVersion: 1,
      workerId: offer.workerId,
      jobId: offer.job.jobId,
      attempt: offer.job.attempt,
      leaseId: offer.leaseId,
      fenceToken: offer.fenceToken,
      observedAt: new Date().toISOString(),
      extensions: [],
    },
  };
}

integration("JOB-006 durable control commands + ACK", () => {
  let fx: JobControlFixture | null = null;
  let setupError: unknown = null;

  function ctx(): JobControlFixture {
    if (setupError) throw new Error(`embedded-postgres setup failed: ${String(setupError)}`);
    if (!fx) throw new Error("fixture not initialized");
    return fx;
  }

  async function commandRows(leaseId: string) {
    const { admin } = ctx();
    return admin<{ commandId: string; commandSeq: number; commandKind: string; ackStatus: string | null }[]>`
      SELECT command_id AS "commandId", command_seq AS "commandSeq", command_kind AS "commandKind",
        ack_status AS "ackStatus"
      FROM job_control_commands WHERE lease_id = ${leaseId} ORDER BY command_seq`;
  }

  async function jobAttemptStatus(jobId: string, attemptId: string) {
    const { admin } = ctx();
    const [row] = await admin<{ jobStatus: string; attemptStatus: string }[]>`SELECT
      (SELECT status FROM jobs WHERE id = ${jobId}) AS "jobStatus",
      (SELECT status FROM job_attempts WHERE id = ${attemptId}) AS "attemptStatus"`;
    return row!;
  }

  beforeAll(async () => {
    try {
      fx = await setupJobControlFixture("job-control-commands");
    } catch (error) {
      setupError = error;
    }
  }, 180_000);

  afterAll(async () => {
    await fx?.teardown();
  }, 60_000);

  it("queues ONE monotonically-sequenced cancel command bound to the active fence and marks the requested state", async () => {
    const f = ctx();
    const reconciliation = createJobReconciliationService({ appDb: f.app.db });
    const { seeded, offer } = await f.activateLease(6_001);

    const outcome = await reconciliation.requestCancellation({
      organizationId: ORG,
      companyId: COMPANY,
      jobId: seeded.jobId,
      reason: "operator stopped it",
      graceful: true,
    });
    expect(outcome.status).toBe("queued");
    expect(outcome.command?.commandKind).toBe("cancel");
    expect(outcome.command?.commandSeq).toBe(1);
    expect(outcome.command?.fenceToken).toBe(offer.fenceToken);
    expect(outcome.command?.ackStatus).toBeNull();

    // The requested state is marked; exactly one durable command row exists.
    expect(await jobAttemptStatus(seeded.jobId, seeded.attemptId)).toEqual({
      jobStatus: "cancel_requested", attemptStatus: "cancel_requested",
    });
    const rows = await commandRows(offer.leaseId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ commandSeq: 1, commandKind: "cancel", ackStatus: null });
  }, 60_000);

  it("finalizes cancellation to terminal 'cancelled' when the job has NO active lease (no cancel_requested hang)", async () => {
    const f = ctx();
    const reconciliation = createJobReconciliationService({ appDb: f.app.db });
    // A placed-but-unleased attempt: queued job, attempt 'pending', NO lease. The reaper's
    // expired-lease scan never reaches it and claimReadyOutbox won't dispatch a
    // cancel_requested job, so cancellation MUST finalize inline (else it hangs forever).
    const seeded = await f.seedPlacedJob(6_050);
    const outcome = await reconciliation.requestCancellation({
      organizationId: ORG,
      companyId: COMPANY,
      jobId: seeded.jobId,
      reason: "operator stopped an unleased job",
      graceful: true,
    });
    expect(outcome.status).toBe("cancelled");
    expect(outcome.command).toBeNull();
    // Converged to TERMINAL cancelled — not left in cancel_requested.
    expect(await jobAttemptStatus(seeded.jobId, seeded.attemptId)).toEqual({
      jobStatus: "cancelled", attemptStatus: "cancelled",
    });
  }, 60_000);

  it("replays the SAME cancel command idempotently (no second row) on a re-request", async () => {
    const f = ctx();
    const reconciliation = createJobReconciliationService({ appDb: f.app.db });
    const { seeded, offer } = await f.activateLease(6_002);

    const first = await reconciliation.requestCancellation({
      organizationId: ORG, companyId: COMPANY, jobId: seeded.jobId, reason: "stop", graceful: true,
    });
    const second = await reconciliation.requestCancellation({
      organizationId: ORG, companyId: COMPANY, jobId: seeded.jobId, reason: "stop again", graceful: false,
    });
    expect(first.status).toBe("queued");
    expect(second.status).toBe("already_requested");
    expect(second.command?.commandId).toBe(first.command?.commandId);
    expect(await commandRows(offer.leaseId)).toHaveLength(1);
  }, 60_000);

  it("surfaces the pending cancel on renew (cancelRequested=true) UNTIL the worker ACKs it", async () => {
    const f = ctx();
    const reconciliation = createJobReconciliationService({ appDb: f.app.db });
    const renewal = createJobLeaseRenewalService({ appDb: f.app.db });
    const { seeded, offer, identity } = await f.activateLease(6_003);

    const outcome = await reconciliation.requestCancellation({
      organizationId: ORG, companyId: COMPANY, jobId: seeded.jobId, reason: "please stop", graceful: true,
    });
    expect(outcome.status).toBe("queued");

    // Renew (active fence: attempt is cancel_requested, NOT terminal) → cancelRequested surfaces.
    const renewed = await renewal.renew({ auth: auth("renew-cancel-1"), request: renewRequest(offer) });
    expect(renewed.outcome).toBe("renewed");
    if (renewed.outcome === "renewed") {
      expect(renewed.body.cancelRequested).toBe(true);
      expect(renewed.body.cancelReason).toBe("please stop");
    }

    // Worker ACKs the command → the durable ack_status is recorded.
    const commandId = outcome.command!.commandId;
    const ack = await runInTenant(f.app.db, ORG, async (repos) => repos.jobControl.ackControlCommand({
      ...identity,
      ack: { commandId, status: "completed", observedAt: new Date(), detail: null },
    }));
    expect(ack.guarded).toBe(true);
    expect(ack.ackOutcome?.applied).toBe(true);

    // A later renew no longer surfaces the (now ACKed) control.
    const afterAck = await renewal.renew({ auth: auth("renew-cancel-2"), request: renewRequest(offer) });
    expect(afterAck.outcome).toBe("renewed");
    if (afterAck.outcome === "renewed") expect(afterAck.body.cancelRequested).toBe(false);
    const [row] = await commandRows(offer.leaseId);
    expect(row?.ackStatus).toBe("completed");
  }, 60_000);

  it("records the worker ACK idempotently: first terminal ACK wins, replay is a no-op", async () => {
    const f = ctx();
    const reconciliation = createJobReconciliationService({ appDb: f.app.db });
    const { seeded, offer, identity } = await f.activateLease(6_004);
    const outcome = await reconciliation.requestCancellation({
      organizationId: ORG, companyId: COMPANY, jobId: seeded.jobId, reason: "stop", graceful: true,
    });
    const commandId = outcome.command!.commandId;
    const ackWith = (status: "accepted" | "completed" | "rejected") =>
      runInTenant(f.app.db, ORG, async (repos) => repos.jobControl.ackControlCommand({
        ...identity,
        ack: { commandId, status, observedAt: new Date(), detail: null },
      }));

    // accepted → completed is allowed; a later different status cannot overwrite a terminal ACK.
    expect((await ackWith("accepted")).ackOutcome).toEqual({ applied: true, status: "accepted" });
    expect((await ackWith("completed")).ackOutcome).toEqual({ applied: true, status: "completed" });
    expect((await ackWith("rejected")).ackOutcome).toEqual({ applied: false, status: "rejected" });
    // A replay of the winning terminal status is idempotent (still applies the same value).
    expect((await ackWith("completed")).ackOutcome).toEqual({ applied: true, status: "completed" });

    const [row] = await commandRows(offer.leaseId);
    expect(row?.ackStatus).toBe("completed");
  }, 60_000);

  it("enforces the monotonic per-lease sequence uniqueness (no two commands share a sequence)", async () => {
    const f = ctx();
    const { admin } = f;
    const { seeded, offer } = await f.activateLease(6_005);
    await createJobReconciliationService({ appDb: f.app.db }).requestCancellation({
      organizationId: ORG, companyId: COMPANY, jobId: seeded.jobId, reason: "stop", graceful: true,
    });
    // A second command re-using command_seq = 1 on the same lease violates the unique index.
    await expect(admin`INSERT INTO job_control_commands
      (organization_id, company_id, job_id, attempt_id, attempt_number, lease_id, command_id,
       command_seq, command_kind, fence_token, command)
      VALUES (${ORG}, ${COMPANY}, ${seeded.jobId}, ${seeded.attemptId}, 1, ${offer.leaseId},
        ${crypto.randomUUID()}, 1, 'drain', ${offer.fenceToken}, ${{ commandKind: "drain" }})`)
      .rejects.toMatchObject({ constraint_name: "job_control_commands_org_lease_seq_uq" });
  }, 60_000);
});
