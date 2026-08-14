// server/src/__tests__/worker-revocation.integration.test.ts
//
// JOB-007 — worker/target revocation via generation cutoff. Proves, against real
// embedded Postgres:
//   * revocation bumps the target's device_generation, disables it, and writes ONE
//     durable operator record;
//   * the committed cutoff DENIES every governed guard on the old fence IMMEDIATELY
//     (before any fanout) — renew/events/secrets/complete/projection/health/control-ACK
//     all refuse `target_revoked` through the locked current-generation recheck;
//   * the fanout marks matching old-generation leases `revoked`, releases their
//     capacity slot, and requests attempt cancellation — idempotently;
//   * a crash after the cutoff but before the fanout still denies old-generation
//     effects; a restart resumes the durable idempotent scan to convergence;
//   * a capacity slot is released exactly once (no double-release across fanout re-runs).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createExecutionTargetRevocationFanout } from "../services/execution-target-revocation-fanout.js";
import { revokeExecutionTarget } from "../services/execution-targets.js";
import { createJobReconciliationService } from "../services/job-reconciliation.js";
import { admitAttemptCapacity } from "../services/org-concurrency.js";
import { runInTenant } from "../db/tenant-context.js";
import {
  COMPANY,
  ORG,
  TARGET,
  setupJobControlFixture,
  type JobControlFixture,
} from "./helpers/job-control-fixture.js";
import type { ActiveFenceRequest } from "@armyofagents/db";

const integration = describe.skipIf(
  process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1",
);

integration("JOB-007 worker/target revocation via generation cutoff", () => {
  let fx: JobControlFixture | null = null;
  let setupError: unknown = null;

  function ctx(): JobControlFixture {
    if (setupError) throw new Error(`embedded-postgres setup failed: ${String(setupError)}`);
    if (!fx) throw new Error("fixture not initialized");
    return fx;
  }

  async function clearRevocations(): Promise<void> {
    await ctx().admin`DELETE FROM execution_target_revocations`;
  }

  function fanout() {
    const f = ctx();
    const reconciliation = createJobReconciliationService({ appDb: f.app.db });
    return createExecutionTargetRevocationFanout({
      appDb: f.app.db,
      operatorDb: f.operator.db,
      reconciliation,
      listAdmittedOrganizationIds: async () => [ORG],
    });
  }

  /** Run one governed mutator on the (now-stale) fence and return its refusal code. */
  async function guardCode(
    label: string,
    call: (identity: ActiveFenceRequest, repos: import("@armyofagents/db").TenantRepositories) => Promise<unknown>,
    identity: ActiveFenceRequest,
  ): Promise<string> {
    const f = ctx();
    try {
      await runInTenant(f.app.db, ORG, async (repos) => call(identity, repos));
      return `${label}:NO_ERROR`;
    } catch (error) {
      return (error as { code?: string }).code ?? `${label}:${String(error)}`;
    }
  }

  async function targetGeneration(): Promise<number> {
    const [row] = await ctx().admin<{ g: number }[]>`
      SELECT device_generation AS g FROM execution_targets WHERE id = ${TARGET}`;
    return Number(row!.g);
  }

  async function leaseStatus(leaseId: string): Promise<string | null> {
    const [row] = await ctx().admin<{ status: string }[]>`SELECT status FROM leases WHERE id = ${leaseId}`;
    return row?.status ?? null;
  }

  beforeAll(async () => {
    try {
      fx = await setupJobControlFixture("worker-revocation");
    } catch (error) {
      setupError = error;
    }
  }, 180_000);

  afterAll(async () => {
    await fx?.teardown();
  }, 60_000);

  it("revocation bumps the target generation, disables it, and writes ONE durable record", async () => {
    const f = ctx();
    await clearRevocations();
    await f.activateLease(7_201);
    expect(await targetGeneration()).toBe(1);

    const result = await revokeExecutionTarget({
      appDb: f.app.db,
      operatorDb: f.operator.db,
      targetId: TARGET,
      organizationId: ORG,
      reason: "device_compromised",
    });
    expect(result).toMatchObject({ revoked: true, revokedGeneration: 1, targetScope: "organization" });
    expect(await targetGeneration()).toBe(2);

    const [target] = await f.admin<{ status: string }[]>`SELECT status FROM execution_targets WHERE id = ${TARGET}`;
    expect(target?.status).toBe("disabled");

    const records = await f.admin<{ target_id: string; revoked_generation: number; status: string }[]>`
      SELECT target_id, revoked_generation, status FROM execution_target_revocations WHERE target_id = ${TARGET}`;
    expect(records).toEqual([{ target_id: TARGET, revoked_generation: 1, status: "pending" }]);

    // Re-invoking is a no-op (already disabled) — no second record, no further bump.
    const again = await revokeExecutionTarget({
      appDb: f.app.db, operatorDb: f.operator.db, targetId: TARGET, organizationId: ORG,
    });
    expect(again).toMatchObject({ revoked: false, reason: "already_disabled" });
    expect(await targetGeneration()).toBe(2);
  }, 60_000);

  it("the committed cutoff DENIES every governed guard on the old fence IMMEDIATELY (before fanout)", async () => {
    const f = ctx();
    await clearRevocations();
    const { identity } = await f.activateLease(7_202);

    // Cutoff commits; NO fanout runs yet (simulating a crash after cutoff, before fanout).
    await revokeExecutionTarget({
      appDb: f.app.db, operatorDb: f.operator.db, targetId: TARGET, organizationId: ORG,
    });

    // Every governed mutator gates on the fence guard, whose locked current-generation
    // recheck now refuses the old fence `target_revoked` — the instant the cutoff commits.
    const codes = await Promise.all([
      guardCode("renew", (id, repos) => repos.jobControl.renewLease({
        ...id, leaseDurationMs: 300_000, idempotencyKey: randomUUID(), semanticDigest: "d".repeat(64),
      }), identity),
      guardCode("events", (id, repos) => repos.jobControl.acceptEvent({ ...id }), identity),
      guardCode("secrets", (id, repos) => repos.jobControl.readSecretHandle({ ...id, handle: "h" }), identity),
      guardCode("complete", (id, repos) => repos.jobControl.completeAttempt({ ...id, terminalStatus: "succeeded" }), identity),
      guardCode("projection", (id, repos) => repos.jobControl.applyProjectionReceipt({ ...id }), identity),
      guardCode("health", (id, repos) => repos.jobControl.recordServiceHealth({
        ...id, serviceInstanceId: randomUUID(), healthStatus: "healthy",
      }), identity),
      guardCode("control_ack", (id, repos) => repos.jobControl.ackControlCommand({ ...id }), identity),
    ]);
    expect(codes).toEqual([
      "target_revoked", "target_revoked", "target_revoked", "target_revoked",
      "target_revoked", "target_revoked", "target_revoked",
    ]);

    // The lease is still 'active' in the row (fanout has not run) — denial came purely
    // from the generation recheck, proving the cutoff is the gate and fanout is convergence.
    const [lease] = await f.admin<{ status: string }[]>`
      SELECT status FROM leases WHERE target_id = ${TARGET} ORDER BY created_at DESC LIMIT 1`;
    expect(lease?.status).toBe("active");
  }, 60_000);

  it("the fanout marks old-generation leases revoked, releases capacity, and cancels — idempotently", async () => {
    const f = ctx();
    await clearRevocations();
    const { seeded, offer } = await f.activateLease(7_203);
    // Claim the attempt's capacity so the fanout has a slot to release exactly once.
    await runInTenant(f.app.db, ORG, async (_repos, tx) => admitAttemptCapacity(tx, {
      organizationId: ORG, companyId: COMPANY, workloadType: "batch", attemptId: seeded.attemptId,
    }));
    const [held] = await f.admin<{ state: string }[]>`
      SELECT capacity_claim_state AS state FROM job_attempts WHERE id = ${seeded.attemptId}`;
    expect(held?.state).toBe("held");

    await revokeExecutionTarget({
      appDb: f.app.db, operatorDb: f.operator.db, targetId: TARGET, organizationId: ORG,
    });

    const first = await fanout().tick();
    expect(first).toMatchObject({ records: 1, leasesRevoked: 1, cancellations: 1, completed: 1 });
    expect(await leaseStatus(offer.leaseId)).toBe("revoked");

    // The job converged to cancelled and the capacity slot was released.
    const [job] = await f.admin<{ status: string }[]>`SELECT status FROM jobs WHERE id = ${seeded.jobId}`;
    expect(job?.status).toBe("cancelled");
    const [attempt] = await f.admin<{ state: string }[]>`
      SELECT capacity_claim_state AS state FROM job_attempts WHERE id = ${seeded.attemptId}`;
    expect(attempt?.state).toBe("released");

    // The durable record is completed; a re-tick is an idempotent no-op (no re-processing,
    // no double-release, no second cancellation).
    const second = await fanout().tick();
    expect(second).toMatchObject({ records: 0, leasesRevoked: 0, cancellations: 0, completed: 0 });
    expect(await leaseStatus(offer.leaseId)).toBe("revoked");
    const [recovered] = await f.admin<{ status: string }[]>`
      SELECT status FROM execution_target_revocations WHERE target_id = ${TARGET}`;
    expect(recovered?.status).toBe("completed");
  }, 60_000);

  it("crash after cutoff / before fanout: restart resumes the durable scan to convergence", async () => {
    const f = ctx();
    await clearRevocations();
    const { seeded, offer, identity } = await f.activateLease(7_204);

    // Cutoff commits. Then a "crash": no fanout runs. The durable record is 'pending'.
    await revokeExecutionTarget({
      appDb: f.app.db, operatorDb: f.operator.db, targetId: TARGET, organizationId: ORG,
    });
    const [pending] = await f.admin<{ status: string }[]>`
      SELECT status FROM execution_target_revocations WHERE target_id = ${TARGET}`;
    expect(pending?.status).toBe("pending");

    // Even with no fanout, the old fence cannot complete (generation recheck is the gate).
    expect(await guardCode("complete", (id, repos) =>
      repos.jobControl.completeAttempt({ ...id, terminalStatus: "succeeded" }), identity)).toBe("target_revoked");

    // Restart: the fanout resumes the durable idempotent scan and converges the tenant.
    const resumed = await fanout().tick();
    expect(resumed).toMatchObject({ records: 1, leasesRevoked: 1, completed: 1 });
    expect(await leaseStatus(offer.leaseId)).toBe("revoked");
    const [job] = await f.admin<{ status: string }[]>`SELECT status FROM jobs WHERE id = ${seeded.jobId}`;
    expect(job?.status).toBe("cancelled");
  }, 60_000);
});
