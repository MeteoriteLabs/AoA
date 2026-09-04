/**
 * JOB-015 slices (c)+(f) — THE ACCEPTANCE BAR, end to end through the renewal driver.
 *
 * ★★★ THE BAR IS THE CONSUMER, NOT THE PAYLOAD. "The command appears in the renew
 * response" is not delivery. These tests assert that a worker-side handler APPLIED the
 * command and that the ACK the worker uploaded is the one that suppresses redelivery.
 * A suite that only inspected the payload would pass against the exact defect JOB-015
 * was filed for.
 *
 * Every fail-closed lever has its ★ POSITIVE CONTROL here, in the same file:
 *   - a worker with NO handlers completes the renewal normally against a server that
 *     emits the extension (`critical:false` is honoured; existing deployments unaffected)
 *   - `cancel` still works through the BOOLEAN alone with the extension suppressed (D2)
 *   - an oversized LEADING command is rejected AND the command behind it is delivered
 *     on the next renewal — a test that asserted only the marker would pass against the
 *     permanently-stalling design
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLeaseRenewalDriver, type ControlCommandHandlers } from "../lease/lease-renewal.js";
import { CONTROL_EXTENSION_NAMESPACE, OVERSIZED_FOR_RENEW_CHANNEL } from "../lease/control-commands.js";
import { createMetrics } from "../metrics/metrics.js";

import type { FakeControlPlane } from "./support/fake-control-plane.js";
import { enrollFixtureWorker } from "./support/poll-fixtures.js";
import { FENCE_TOKEN, POLL_FIXTURE_IDS } from "./support/poll-fixtures.js";
import {
  FakeScheduler,
  RENEWAL_CODE,
  RENEWAL_IDENTITY,
  makeRenewalHandoff,
  recordingSupervisor,
  spyProxyFactory,
  staticSessionProvider,
  startRenewalPlane,
} from "./support/renewal-fixtures.js";

let scheduler: FakeScheduler;
let fake: FakeControlPlane;

beforeEach(async () => {
  scheduler = new FakeScheduler();
  fake = await startRenewalPlane(scheduler);
});
afterEach(async () => {
  await fake.close();
});

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function drainBody(seq: number): Record<string, unknown> {
  return {
    protocolVersion: 1,
    audience: "control_channel",
    commandId: uuid(seq),
    commandSeq: seq,
    idempotencyKey: uuid(seq),
    issuedAt: "2026-08-13T00:00:00.000Z",
    nonce: `nonce-${seq}`,
    organizationId: POLL_FIXTURE_IDS.org,
    companyId: POLL_FIXTURE_IDS.company,
    workerId: POLL_FIXTURE_IDS.worker,
    jobId: POLL_FIXTURE_IDS.job,
    attempt: 1,
    leaseId: POLL_FIXTURE_IDS.lease,
    fenceToken: FENCE_TOKEN,
    commandKind: "drain",
    reason: "fleet rollout",
  };
}

function controlExtension(value: unknown): Record<string, unknown> {
  return { namespace: CONTROL_EXTENSION_NAMESPACE, schemaVersion: 1, critical: false, value };
}

function pending(seqs: number[], extra: Record<string, unknown> = {}): Record<string, unknown>[] {
  return [
    controlExtension({
      commands: seqs.map(drainBody),
      pendingCount: seqs.length,
      truncated: false,
      ...extra,
    }),
  ];
}

async function fireNextTimer(): Promise<void> {
  const next = scheduler.setTimerLog[scheduler.setTimerLog.length - 1]!.targetMs;
  await scheduler.advanceTo(next);
}

interface DriverCase {
  readonly drains: (string | null)[];
  readonly log: string[];
  readonly metrics: ReturnType<typeof createMetrics>;
  readonly driver: ReturnType<typeof createLeaseRenewalDriver>;
}

async function makeDriverCase(options: { handlers?: boolean } = {}): Promise<DriverCase> {
  const { session, key, client } = await enrollFixtureWorker(fake, RENEWAL_CODE);
  const log: string[] = [];
  const sup = recordingSupervisor(log);
  const proxies = spyProxyFactory(log);
  const drains: (string | null)[] = [];
  const metrics = createMetrics();
  const handlers: ControlCommandHandlers = {
    drain: (reason) => {
      drains.push(reason);
    },
  };
  const driver = createLeaseRenewalDriver({
    client,
    session: staticSessionProvider(session),
    key,
    identity: RENEWAL_IDENTITY,
    supervisor: sup.supervisor,
    schedule: scheduler,
    makeFenceProxy: proxies.factory,
    metrics,
    tuning: { leadMs: 20_000 },
    ...(options.handlers === false ? {} : { controlHandlers: () => handlers }),
  });
  return { drains, log, metrics, driver };
}

describe("JOB-015 — a delivered drain is APPLIED and ACKed", () => {
  it("calls the drain handler and uploads a completed ACK carrying the echoed sequence", async () => {
    const c = await makeDriverCase();
    fake.enqueueRenew({ kind: "renewed", extensions: pending([1]) });
    void c.driver.accept(makeRenewalHandoff({ windowMs: 100_000 }));
    await fireNextTimer();

    // ★ THE BAR: a handler ran. Not "it was in the payload".
    expect(c.drains).toEqual(["fleet rollout"]);
    // ★ AND the ACK — the only thing that clears `ack_status IS NULL` server-side.
    expect(fake.controlAcks()).toEqual([
      { leaseId: POLL_FIXTURE_IDS.lease, commandId: uuid(1), commandSeq: 1, status: "completed", detail: null },
    ]);
    expect(c.metrics.renderPrometheus()).toContain('control_command{outcome="applied"} 1');
    // The lease is still healthy: a control command is not a lease loss.
    expect(c.driver.activeRenewalCount()).toBe(1);
  });

  it("★ POSITIVE CONTROL — a worker with NO handler completes the renewal normally and ACKs nothing", async () => {
    // This is what proves `critical:false` is honoured: an already-deployed worker that
    // does not understand the extension keeps running against a server that emits it.
    // It is also what proves an unapplied command is NOT consumed — no ACK, so the
    // server redelivers it instead of the queue quietly draining into nothing.
    const c = await makeDriverCase({ handlers: false });
    fake.enqueueRenew({ kind: "renewed", extensions: pending([1]) });
    void c.driver.accept(makeRenewalHandoff({ windowMs: 100_000 }));
    await fireNextTimer();

    expect(c.drains).toEqual([]);
    expect(fake.controlAcks()).toEqual([]);
    expect(c.metrics.renderPrometheus()).toContain('control_command{outcome="unhandled"} 1');
    expect(c.driver.activeRenewalCount()).toBe(1);
    expect(c.log).not.toContain(`onLeaseLost:${POLL_FIXTURE_IDS.lease}`);
  });

  it("applies a redelivered command ONCE — the ACK is what stops redelivery, the memory is the backstop", async () => {
    const c = await makeDriverCase();
    fake.enqueueRenew({ kind: "renewed", extensions: pending([1]) });
    fake.enqueueRenew({ kind: "renewed", extensions: pending([1]) });
    void c.driver.accept(makeRenewalHandoff({ windowMs: 100_000 }));
    await fireNextTimer();
    await fireNextTimer();

    expect(c.drains).toEqual(["fleet rollout"]);
    expect(fake.controlAcks()).toHaveLength(1);
    expect(c.metrics.renderPrometheus()).toContain('control_command{outcome="deferred"} 1');
  });
});

describe("JOB-015 — the oversized-leading terminal, and its positive control", () => {
  it("ACKs the oversized command rejected/oversized_for_renew_channel, then the one BEHIND it is delivered", async () => {
    const c = await makeDriverCase();
    // Renewal 1: the leading command cannot ride the channel — marker only.
    fake.enqueueRenew({
      kind: "renewed",
      extensions: [
        controlExtension({
          commands: [],
          pendingCount: 2,
          truncated: true,
          oversizedLeading: { commandId: uuid(1), commandSeq: 1 },
        }),
      ],
    });
    // Renewal 2: with seq 1 cleared by the rejected ACK, seq 2 is now the head.
    fake.enqueueRenew({ kind: "renewed", extensions: pending([2]) });

    void c.driver.accept(makeRenewalHandoff({ windowMs: 100_000 }));
    await fireNextTimer();

    expect(fake.controlAcks()).toEqual([
      {
        leaseId: POLL_FIXTURE_IDS.lease,
        commandId: uuid(1),
        commandSeq: 1,
        status: "rejected",
        detail: OVERSIZED_FOR_RENEW_CHANNEL,
      },
    ]);
    // ★ THE CONTROL THAT SEPARATES THE FIX FROM THE STALL. A test asserting only that
    // the marker was ACKed would pass against a design that returns the same marker
    // forever. The queue must MOVE.
    await fireNextTimer();
    expect(c.drains).toEqual(["fleet rollout"]);
    expect(fake.controlAcks()[1]).toEqual({
      leaseId: POLL_FIXTURE_IDS.lease,
      commandId: uuid(2),
      commandSeq: 2,
      status: "completed",
      detail: null,
    });
  });
});

describe("JOB-015 — fail-closed direction: an unreadable delivery is never 'no commands'", () => {
  it("treats a malformed control extension as a protocol refusal, not an empty queue", async () => {
    const c = await makeDriverCase();
    fake.enqueueRenew({
      kind: "renewed",
      extensions: [controlExtension({ commands: [{ not: "a command" }], pendingCount: 1, truncated: false })],
    });
    void c.driver.accept(makeRenewalHandoff({ windowMs: 100_000 }));
    await fireNextTimer();

    // A delivery fault the worker cannot read is a lease loss, which is loud. Silently
    // renewing with `control: null` would make it indistinguishable from an empty queue
    // — the precise shape of the bug this ticket closes.
    expect(c.log).toContain(`onLeaseLost:${POLL_FIXTURE_IDS.lease}`);
    expect(c.drains).toEqual([]);
    expect(fake.controlAcks()).toEqual([]);
  });

  it("★ POSITIVE CONTROL — a WELL-FORMED extension on the same path renews and applies", async () => {
    const c = await makeDriverCase();
    fake.enqueueRenew({ kind: "renewed", extensions: pending([1]) });
    void c.driver.accept(makeRenewalHandoff({ windowMs: 100_000 }));
    await fireNextTimer();
    expect(c.log).not.toContain(`onLeaseLost:${POLL_FIXTURE_IDS.lease}`);
    expect(c.drains).toEqual(["fleet rollout"]);
  });
});

describe("JOB-015 D2 — the cancel BOOLEAN floor is untouched", () => {
  it("★ cancel still works through the boolean alone with the extension SUPPRESSED", async () => {
    const c = await makeDriverCase();
    // No extension at all — exactly the pre-JOB-015 wire.
    fake.enqueueRenew({ kind: "renewed", cancelRequested: true, cancelReason: "operator_cancel" });
    void c.driver.accept(makeRenewalHandoff({ windowMs: 100_000 }));
    await fireNextTimer();

    expect(c.log).toContain(`cancel:${POLL_FIXTURE_IDS.lease}:operator_cancel`);
    expect(c.driver.activeRenewalCount()).toBe(0);
  });

  it("a cancel BOOLEAN short-circuits a co-delivered drain — the run is ending either way", async () => {
    const c = await makeDriverCase();
    fake.enqueueRenew({
      kind: "renewed",
      cancelRequested: true,
      cancelReason: "operator_cancel",
      extensions: pending([1]),
    });
    void c.driver.accept(makeRenewalHandoff({ windowMs: 100_000 }));
    await fireNextTimer();

    expect(c.log).toContain(`cancel:${POLL_FIXTURE_IDS.lease}:operator_cancel`);
    expect(c.drains).toEqual([]);
  });
});

describe("JOB-015 — a failing ACK leaves the command pending rather than killing the lease", () => {
  it("keeps renewing when the server reports the ACK matched no row", async () => {
    // `applied:false` is exactly what a mismatched echoed `commandSeq` now produces
    // server-side. The worker must not treat it as fatal: the command stays pending and
    // the next renewal redelivers it.
    const c = await makeDriverCase();
    fake.enqueueControlAckApplied(false);
    fake.enqueueRenew({ kind: "renewed", extensions: pending([1]) });
    void c.driver.accept(makeRenewalHandoff({ windowMs: 100_000 }));
    await fireNextTimer();

    expect(c.drains).toEqual(["fleet rollout"]);
    expect(c.driver.activeRenewalCount()).toBe(1);
    expect(c.log).not.toContain(`onLeaseLost:${POLL_FIXTURE_IDS.lease}`);
  });
});
