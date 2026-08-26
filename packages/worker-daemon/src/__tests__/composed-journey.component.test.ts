// -----------------------------------------------------------------------------
// CLI-006 / D2 — Sprint 5 Step 1: the COMPOSED dispatch runtime drives ONE lease
// through to a supervised run.
//
// This is the join no prior test made: `composeDispatchRuntime` with its REAL
// factories (poll loop + renewal driver + supervisor + durable outbox drain), a
// per-op FAKE provider, and a real `client`/`session`/`key`/`self` from a real
// enrollment against the protocol-faithful control-plane double. One offer is
// enqueued; the composed loop polls it, self-checks it, ACKs it over the real
// lease-ack POST, hands off to the supervisor, which runs create → execute
// (inside the sandbox) → destroy, and the durable outbox drain uploads the
// terminal event.
//
//   - `poll-offer-ack.component.test.ts` proved the poll/ACK half (real client,
//     no supervisor).
//   - `supervisor-happy.component.test.ts` proved the supervise half (real
//     supervisor, hand-fed handoff).
//   This test JOINS them through `createPollLoop`/`createSupervisor` — the
//   evidence `E4-1-leases-through-protocol` / `E4-2-supervises-sandboxes` name.
//
// No real E2B, no key, no spend. Real E2B is E7-1 (the operator dispatch).
// -----------------------------------------------------------------------------

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { composeDispatchRuntime, type DispatchRuntime } from "../lifecycle/dispatch-runtime.js";
import { SessionStore } from "../identity/session.js";
import { createFakeSandboxProvider, type FakeSandboxProvider } from "./support/fake-provider.js";
import { startFakeControlPlane, type FakeControlPlane } from "./support/fake-control-plane.js";
import {
  compatibleOffer,
  enrollFixtureWorker,
  enrollmentCodeConfig,
  fixtureProbes,
  makeSelfModel,
  POLL_FIXTURE_IDS,
} from "./support/poll-fixtures.js";

const CODE = "composed-journey-code";

/** The fake provider derives the sandbox id from the offer's job/attempt/lease labels. */
const SANDBOX_ID = `fake-sbx-${POLL_FIXTURE_IDS.job}-1-${POLL_FIXTURE_IDS.lease}`;

let fake: FakeControlPlane;
let workDir: string;
let runtime: DispatchRuntime | null;

beforeEach(async () => {
  fake = await startFakeControlPlane({ enrollments: [enrollmentCodeConfig(CODE)] });
  workDir = mkdtempSync(join(tmpdir(), "composed-journey-"));
  runtime = null;
});

afterEach(async () => {
  if (runtime) {
    runtime.leasing.stopLeasing();
    await runtime.leasing.drain().catch(() => {});
    runtime.renewal.stop();
    runtime.eventOutbox.stopDrain();
    await runtime.eventOutbox.flush().catch(() => {});
    runtime.eventOutbox.closeStore();
  }
  await fake.close();
  rmSync(workDir, { recursive: true, force: true });
});

async function waitFor(predicate: () => boolean, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("timeout waiting for the composed run to complete");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** A live-window offer (the fixture's ackDeadline/expiresAt are historical). */
function liveOffer(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return compatibleOffer({
    ackDeadline: new Date(now + 5 * 60_000).toISOString(),
    expiresAt: new Date(now + 10 * 60_000).toISOString(),
    ...overrides,
  });
}

async function composeWith(offer: Record<string, unknown>, provider: FakeSandboxProvider): Promise<DispatchRuntime> {
  const { session, key, client } = await enrollFixtureWorker(fake, CODE);
  const self = await makeSelfModel();
  const store = new SessionStore(
    {
      now: () => Date.now(),
      renew: async () => {
        throw new Error("unexpected renew: the enrolled session should outlive this test");
      },
      bootstrap: async () => {
        throw new Error("unexpected bootstrap: the store is seeded with a live session");
      },
    },
    session,
  );
  fake.enqueuePoll({ kind: "offer", offer });
  const rt = await composeDispatchRuntime({
    provider,
    self,
    key,
    store,
    client,
    eventOutboxPath: join(workDir, "outbox.db"),
    concurrency: { batch: 1, browser: 0, service: 0 },
    backoff: { baseMs: 1, maxMs: 5, jitter: 0 } as never,
    workDir,
    probes: fixtureProbes(),
  });
  return rt;
}

describe("composed-journey.component — createPollLoop + createSupervisor take ONE lease and run it", () => {
  it("★ E4-1/E4-2 — the composed loop LEASES (real ACK) then SUPERVISES create→execute→destroy", async () => {
    const provider = createFakeSandboxProvider({});
    runtime = await composeWith(liveOffer(), provider);
    runtime.start();

    await waitFor(() => fake.ackCountFor(POLL_FIXTURE_IDS.lease) === 1 && provider.callCount("destroy") === 1);

    // E4-1: the composed loop took a real lease through the protocol (one ACK, for the offered lease).
    expect(fake.ackCountFor(POLL_FIXTURE_IDS.lease)).toBe(1);
    expect(fake.acks()[0]).toMatchObject({ leaseId: POLL_FIXTURE_IDS.lease, workerId: POLL_FIXTURE_IDS.worker });

    // E4-2: a real ACK reached the supervisor, which ran the sandbox lifecycle.
    const ops = provider.calls().filter((c) => !c.replayed).map((c) => c.op);
    expect(ops).toEqual(["create", "execute", "destroy"]);

    // The tenant command ran INSIDE the sandbox (the offer's workload), never spawned in-process.
    expect(provider.executionsOf(SANDBOX_ID)).toEqual([
      { command: "codex", args: ["exec", "--json"], insideSandbox: true },
    ]);
    expect(provider.peek(SANDBOX_ID)?.state).toBe("destroyed");
  });

  it("★ stream — the supervisor's terminal event is drained to the control plane, digest-valid", async () => {
    const provider = createFakeSandboxProvider({});
    runtime = await composeWith(liveOffer(), provider);
    runtime.start();

    await waitFor(() => fake.ackCountFor(POLL_FIXTURE_IDS.lease) === 1 && provider.callCount("destroy") === 1);
    // Force the durable outbox to upload before asserting (the drain is otherwise timer-paced).
    await runtime.eventOutbox.flush();

    await waitFor(() => fake.eventUploads().some((u) => u.count >= 2), 4000);
    const uploaded = fake.eventUploads();
    // attempt_started + terminal were uploaded (the fake plane independently recomputes each digest,
    // so a re-stamp bug would 400 here rather than pass).
    const total = uploaded.reduce((sum, u) => sum + u.count, 0);
    expect(total).toBeGreaterThanOrEqual(2);
  });
});
