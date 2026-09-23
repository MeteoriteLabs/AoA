/**
 * WRK-007 Slice 0 — the fake control-plane per-`leaseId` authority table (D6).
 *
 * Today the fake's renew directives are a GLOBAL FIFO: they cannot model "lease L
 * renewed / lease M target_revoked" under concurrent probing, because a directive
 * is bound to arrival ORDER, not to a lease. WRK-007 infers per-lease authority by
 * probing `lease_renew`, so the harness MUST answer per-lease. Slice 0 adds a keyed
 * `leaseId → {live, …}` table consumed by `handleRenew`, with the global FIFO kept
 * as a fallback for un-seeded leases.
 *
 * Fail-first: seed lease L live + lease M dead(target_revoked), probe BOTH (in
 * either order) and assert each gets ITS OWN verdict — impossible with a global
 * FIFO (the first probe would consume whichever directive was enqueued first).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { renewLeaseOnce } from "../lease/lease-renewal.js";
import { createStartupReconciler } from "../supervisor/startup-reconcile.js";

import type { FakeControlPlane } from "./support/fake-control-plane.js";
import { enrollFixtureWorker } from "./support/poll-fixtures.js";
import {
  FakeScheduler,
  RENEWAL_CODE,
  RENEWAL_IDENTITY,
  makeRenewalHandoff,
  startRenewalPlane,
} from "./support/renewal-fixtures.js";

const LEASE_L = "00000000-0000-4000-8000-0000000000c1";
const LEASE_M = "00000000-0000-4000-8000-0000000000c2";

let scheduler: FakeScheduler;
let fake: FakeControlPlane;

beforeEach(async () => {
  scheduler = new FakeScheduler();
  fake = await startRenewalPlane(scheduler);
});
afterEach(async () => {
  await fake.close();
});

describe("startup-lease-authority — the fake answers lease_renew PER LEASE, not by FIFO order", () => {
  it("seeds L live + M dead; probing both yields each lease's own verdict regardless of probe order", async () => {
    const { session, key, client } = await enrollFixtureWorker(fake, RENEWAL_CODE);

    fake.seedLeaseAuthority(LEASE_L, { live: true });
    fake.seedLeaseAuthority(LEASE_M, { live: false, deadReason: "target_revoked" });

    const offerL = makeRenewalHandoff({ leaseId: LEASE_L }).offer;
    const offerM = makeRenewalHandoff({ leaseId: LEASE_M }).offer;

    // Probe M FIRST, then L — the opposite of the seed order — to prove the verdict
    // is keyed by lease, not consumed off a FIFO in enqueue order.
    const mAttempt = await renewLeaseOnce({
      client,
      session,
      offer: offerM,
      key,
      idempotencyKey: "00000000-0000-4000-8000-0000000000d1",
      now: () => scheduler.now(),
    });
    const lAttempt = await renewLeaseOnce({
      client,
      session,
      offer: offerL,
      key,
      idempotencyKey: "00000000-0000-4000-8000-0000000000d2",
      now: () => scheduler.now(),
    });

    // Lease M is dead (target_revoked); lease L is live (renewed).
    expect(mAttempt.kind).toBe("terminal");
    if (mAttempt.kind === "terminal") expect(mAttempt.reason).toBe("target_revoked");
    expect(lAttempt.kind).toBe("renewed");

    // The plane recorded the renew for L (a live extension) but not for M.
    expect(fake.renewCountFor(LEASE_L)).toBe(1);
    expect(fake.renewCountFor(LEASE_M)).toBe(0);
  });

  it("a dead lease with the default reason rejects with stale_fence (200 rejected)", async () => {
    const { session, key, client } = await enrollFixtureWorker(fake, RENEWAL_CODE);
    fake.seedLeaseAuthority(LEASE_M, { live: false });
    const offerM = makeRenewalHandoff({ leaseId: LEASE_M }).offer;
    const attempt = await renewLeaseOnce({
      client,
      session,
      offer: offerM,
      key,
      idempotencyKey: "00000000-0000-4000-8000-0000000000d3",
      now: () => scheduler.now(),
    });
    // classifyRenewResponse folds a 200 rejected{stale_fence} into a protocol/malformed loss.
    expect(attempt.kind).toBe("rejected");
  });

  it("an un-seeded lease still falls back to the global FIFO directive", async () => {
    const { session, key, client } = await enrollFixtureWorker(fake, RENEWAL_CODE);
    // No seedLeaseAuthority for LEASE_L — enqueue a FIFO rejected directive instead.
    fake.enqueueRenew({ kind: "rejected", reason: "stale_fence" });
    const offerL = makeRenewalHandoff({ leaseId: LEASE_L }).offer;
    const attempt = await renewLeaseOnce({
      client,
      session,
      offer: offerL,
      key,
      idempotencyKey: "00000000-0000-4000-8000-0000000000d4",
      now: () => scheduler.now(),
    });
    expect(attempt.kind).toBe("rejected");
  });
});

// -----------------------------------------------------------------------------
// WRK-013 / founder ruling F5 — a live lease found at restart is FENCED.
//
// The frozen protocol has no lease-state query, so authority is inferred by ONE renew (the
// probe). F5 makes that renewal the LAST: the reconciler names every live candidate `fenced`,
// never renews it again, and never hands it to a renewal loop — the control plane's reaper ends
// the attempt. The result carries the fenced set so the composition can log and prune by lease.
// -----------------------------------------------------------------------------

describe("startup-lease-authority — F5: a live candidate is fenced after exactly one probe renewal", () => {
  it("probes each candidate ONCE and reports live leases as FENCED, dead ones as not fenced", async () => {
    const { session, key, client } = await enrollFixtureWorker(fake, RENEWAL_CODE);
    fake.seedLeaseAuthority(LEASE_L, { live: true });
    fake.seedLeaseAuthority(LEASE_M, { live: false, deadReason: "target_revoked" });

    const result = await createStartupReconciler({
      client,
      session: { get: async () => session, recover: async () => session },
      key,
      identity: RENEWAL_IDENTITY,
      leaseCandidates: [makeRenewalHandoff({ leaseId: LEASE_L }).offer, makeRenewalHandoff({ leaseId: LEASE_M }).offer],
      now: () => scheduler.now(),
    }).run();

    expect(result.fencedLeaseIds).toEqual([LEASE_L]);
    expect(result.leaseProbes.get(LEASE_M)?.state).toBe("dead");
    // Exactly one renew REQUEST per candidate — the probe — and nothing after it.
    expect(fake.renewRequests().map((r) => r.leaseId).sort()).toEqual([LEASE_L, LEASE_M].sort());
  });

  it("a duplicated candidate is probed once (one renew per lease, never two)", async () => {
    const { session, key, client } = await enrollFixtureWorker(fake, RENEWAL_CODE);
    fake.seedLeaseAuthority(LEASE_L, { live: true });
    const offer = makeRenewalHandoff({ leaseId: LEASE_L }).offer;
    const result = await createStartupReconciler({
      client,
      session: { get: async () => session, recover: async () => session },
      key,
      identity: RENEWAL_IDENTITY,
      leaseCandidates: [offer, offer],
      now: () => scheduler.now(),
    }).run();
    expect(result.fencedLeaseIds).toEqual([LEASE_L]);
    expect(fake.renewRequests().filter((r) => r.leaseId === LEASE_L)).toHaveLength(1);
  });
});
