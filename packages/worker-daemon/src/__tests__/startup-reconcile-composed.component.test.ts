// -----------------------------------------------------------------------------
// WRK-013 — the startup reconciler, COMPOSED, over a durable lease-candidate store.
//
// Every case runs the REAL composition (`composeDispatchRuntime` with its real poll loop,
// renewal driver, supervisor and durable outbox) against the protocol-faithful in-process
// control-plane double. A "restart" is two lifetimes of the same enrolled device over the
// SAME local files:
//
//   lifetime A — composes, polls, ACKs an offer over the real lease-ack POST, and hands it to
//                a supervisor whose `create` never returns (the run is mid-flight), then
//                CRASHES: its stores are closed with no drain and no settle, so nothing prunes.
//   lifetime B — composes over the same files and `start()`s.
//
// The candidate B probes therefore comes from A's WRITE-ON-ACK, never from a test `put()` —
// which is what makes the positive control (removing the write reds case 1) meaningful.
//
// Acceptance (E4 implementation plan §4c, WRK-013):
//   1  a stored candidate is probed (not `[]`)            — "★ 1"
//   2  a live candidate is FENCED (F5)                    — "★ 2"
//   3  an attempt that ended before the crash is pruned   — "★ 3"
//   4  an empty store / a platform-scoped target: a NAMED reason, never silent — "★ 4"
//   5  the reconcile completes BEFORE the first poll      — "★ 5" (request order, not a sleep)
//   6  a corrupt store: no renewal for any lease it would have named, a named reason, and polling
//      still starts (S0-8 amendment 5)                   — "★ 6"
//   7  positive control: no write-on-ACK ⇒ case 1's probe never happens — "★ 7"
//   8  two Organizations' leases on one daemon are stored, probed and fenced independently,
//      each probe carrying ITS OWN lease identity (F10)  — "★ 8"
// -----------------------------------------------------------------------------

import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { composeDispatchRuntime, type DispatchRuntime } from "../lifecycle/dispatch-runtime.js";
import { SessionStore } from "../identity/session.js";
import type { LeaseRenewalDriver } from "../lease/lease-renewal.js";
import { LEASE_CANDIDATE_REASONS } from "../lease/lease-candidate-store.js";
import { SANDBOX_PASS_SKIP_REASONS } from "../supervisor/startup-reconcile.js";
import type { OwnershipSelector, SandboxProvider } from "../supervisor/provider.js";
import type { Logger } from "../logging/logger.js";
import type { WorkerSelfModel } from "../poll/capacity.js";
import type { ControlPlaneClient } from "../transport/client.js";
import { createFakeSandboxProvider } from "./support/fake-provider.js";
import { startFakeControlPlane, type FakeControlPlane } from "./support/fake-control-plane.js";
import {
  compatibleOffer,
  enrollFixtureWorker,
  enrollmentCodeConfig,
  fixtureProbes,
  makeSelfModel,
  POLL_FIXTURE_IDS,
  type EnrolledFixtureWorker,
} from "./support/poll-fixtures.js";

const CODE = "wrk-013-restart-code";

// Two Organizations on ONE (platform-scoped) daemon — F10.
const ORG_X = "00000000-0000-4000-8000-0000000013a1";
const ORG_Y = "00000000-0000-4000-8000-0000000013b1";
const LEASE_X = "00000000-0000-4000-8000-0000000013a2";
const LEASE_Y = "00000000-0000-4000-8000-0000000013b2";
const JOB_X = "00000000-0000-4000-8000-0000000013a3";
const JOB_Y = "00000000-0000-4000-8000-0000000013b3";
const FENCE_X = "x".repeat(43);
const FENCE_Y = "y".repeat(43);

interface LogLine {
  readonly level: "info" | "warn" | "error";
  readonly bindings: Record<string, unknown>;
  readonly message: string;
}

function recordingLogger(lines: LogLine[]): Logger {
  const push = (level: LogLine["level"]) => (bindings: unknown, message?: unknown) =>
    lines.push({ level, bindings: (bindings ?? {}) as Record<string, unknown>, message: String(message ?? "") });
  return { info: push("info"), warn: push("warn"), error: push("error"), flush: async () => {} } as unknown as Logger;
}

const reasonsIn = (lines: readonly LogLine[]): string[] =>
  lines.map((l) => l.bindings.reason).filter((r): r is string => typeof r === "string");

let fake: FakeControlPlane;
let workDir: string;
let worker: EnrolledFixtureWorker;
const live: DispatchRuntime[] = [];

beforeEach(async () => {
  fake = await startFakeControlPlane({ enrollments: [enrollmentCodeConfig(CODE)] });
  workDir = mkdtempSync(join(tmpdir(), "wrk013-"));
  worker = await enrollFixtureWorker(fake, CODE);
});

afterEach(async () => {
  for (const rt of live.splice(0)) crash(rt);
  await fake.close();
  rmSync(workDir, { recursive: true, force: true });
});

async function settle(predicate: () => boolean, timeoutMs = 6000): Promise<boolean> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return true;
}

const outboxPath = (): string => join(workDir, "outbox.db");
const candidatePath = (): string => join(workDir, "lease-candidates.db");

/** A live-window offer for (org, lease, job, fence). `expiresMs` is short on purpose: if anything
 * re-attached the lease to the renewal driver, its renewal would fire inside the test window. */
function offerFor(org: string, lease: string, job: string, fence: string, expiresMs = 60_000): Record<string, unknown> {
  const now = Date.now();
  const offer = compatibleOffer({
    leaseId: lease,
    fenceToken: fence,
    ackDeadline: new Date(now + Math.min(Math.floor(expiresMs / 2), 30_000)).toISOString(),
    expiresAt: new Date(now + expiresMs).toISOString(),
  }) as { job: Record<string, unknown> };
  offer.job.organizationId = org;
  offer.job.jobId = job;
  return offer as Record<string, unknown>;
}

interface LifetimeOptions {
  /** Records THIS lifetime's own control-plane calls, in call order (lifetime A's lingering
   * requests can never interleave into it — the ordering proof for ★ 5). */
  readonly callLog?: string[];
  readonly provider?: SandboxProvider;
  readonly makeRunProvider?: () => SandboxProvider;
  readonly withStore?: boolean;
  readonly logger?: Logger;
  readonly self?: WorkerSelfModel;
  readonly batch?: number;
}

async function lifetime(opts: LifetimeOptions = {}): Promise<DispatchRuntime> {
  const self = opts.self ?? (await makeSelfModel());
  const store = new SessionStore(
    {
      now: () => Date.now(),
      renew: async () => {
        throw new Error("unexpected session renew");
      },
      bootstrap: async () => {
        throw new Error("unexpected session bootstrap");
      },
    },
    worker.session,
  );
  const rt = await composeDispatchRuntime({
    provider: opts.makeRunProvider ? undefined : (opts.provider ?? createFakeSandboxProvider({})),
    makeRunProvider: opts.makeRunProvider ? (() => opts.makeRunProvider!()) : undefined,
    self,
    key: worker.key,
    store,
    client: opts.callLog ? recordingClient(opts.callLog) : worker.client,
    eventOutboxPath: outboxPath(),
    leaseCandidatePath: opts.withStore === false ? undefined : candidatePath(),
    concurrency: { batch: opts.batch ?? 1, browser: 0, service: 0 },
    backoff: { baseMs: 1, maxMs: 5, jitter: 0 } as never,
    workDir,
    probes: fixtureProbes(),
    logger: opts.logger,
  });
  live.push(rt);
  return rt;
}

/** The shared enrolled client, with poll + lease_renew calls recorded as they START and END. */
function recordingClient(log: string[]): ControlPlaneClient {
  const base = worker.client;
  return {
    ...base,
    poll: async (...args: Parameters<ControlPlaneClient["poll"]>) => {
      log.push("poll:start");
      return base.poll(...args);
    },
    leaseRenew: async (...args: Parameters<ControlPlaneClient["leaseRenew"]>) => {
      log.push(`renew:start:${args[0]}`);
      try {
        return await base.leaseRenew(...args);
      } finally {
        log.push(`renew:end:${args[0]}`);
      }
    },
  };
}

/** A CRASH, not a shutdown: stop timers and close the local stores with NO drain, NO flush and
 * NO settle of the in-flight run — exactly what a killed process leaves on disk. */
function crash(rt: DispatchRuntime): void {
  const i = live.indexOf(rt);
  if (i >= 0) live.splice(i, 1);
  rt.leasing.stopLeasing();
  rt.renewal.stop();
  rt.eventOutbox.stopDrain();
  try {
    rt.eventOutbox.closeStore();
  } catch {
    // already closed
  }
}

/** Lifetime A: ACK every enqueued offer with a run that never finishes, then crash. */
async function ackThenCrash(offers: readonly Record<string, unknown>[], opts: LifetimeOptions = {}): Promise<void> {
  for (const offer of offers) fake.enqueuePoll({ kind: "offer", offer });
  const provider = createFakeSandboxProvider({ hangCreate: true });
  const a = await lifetime({ provider, batch: offers.length, ...opts });
  await a.start();
  const acked = await settle(() => offers.every((o) => fake.ackCountFor(String(o.leaseId)) === 1));
  expect(acked).toBe(true);
  // The plane records the ACK BEFORE the worker reads the response; the write-on-ACK happens after.
  // Crash only once every run has reached `create` (downstream of the write), or the test would
  // model a crash BETWEEN the ACK and the write — a real window, but not the case under test.
  expect(await settle(() => provider.callCount("create") === offers.length)).toBe(true);
  crash(a);
  await quiesce();
}

/** Wait until the plane has seen no new request for a while: lifetime A's last in-flight poll has
 * landed, so every request after a later mark belongs to lifetime B. */
async function quiesce(): Promise<void> {
  let seen = fake.requests.length;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 60));
    if (fake.requests.length === seen) return;
    seen = fake.requests.length;
  }
}

function renewRequestsFor(leaseId: string) {
  return fake.renewRequests().filter((r) => r.leaseId === leaseId);
}


describe("WRK-013 — a restart reconciles the leases it held (composed, in-process control plane)", () => {
  it("★ 1 + ★ 5 — a candidate stored on ACK is PROBED at restart, and the probe completes BEFORE the first poll", async () => {
    await ackThenCrash([offerFor(ORG_X, LEASE_X, JOB_X, FENCE_X)]);
    fake.seedLeaseAuthority(LEASE_X, { live: true });
    expect(renewRequestsFor(LEASE_X)).toHaveLength(0); // A never renewed it (window far off)

    const lines: LogLine[] = [];
    const calls: string[] = [];
    const b = await lifetime({ logger: recordingLogger(lines), callLog: calls });
    await b.start();

    // (1) The probe ran over A's candidate — exactly one renew, carrying A's lease identity.
    expect(renewRequestsFor(LEASE_X)).toEqual([
      { leaseId: LEASE_X, workerId: POLL_FIXTURE_IDS.worker, jobId: JOB_X, attempt: 1, fenceToken: FENCE_X },
    ]);
    expect(reasonsIn(lines)).not.toContain(LEASE_CANDIDATE_REASONS.empty);

    // (5) ORDER, not timing: B's probe renew has COMPLETED before B starts its first poll.
    expect(await settle(() => calls.includes("poll:start"))).toBe(true);
    const renewEnd = calls.indexOf(`renew:end:${LEASE_X}`);
    expect(renewEnd).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf(`renew:start:${LEASE_X}`)).toBe(0); // nothing precedes the probe
    expect(renewEnd).toBeLessThan(calls.indexOf("poll:start"));
  });

  it("★ 2 — F5: a candidate the probe finds LIVE is FENCED — the probe's renewal is its last, and nothing re-attaches it", async () => {
    // A 3 s window: had the lease been handed back to the renewal driver, its renewal (at half the
    // window) would land inside the wait below.
    await ackThenCrash([offerFor(ORG_X, LEASE_X, JOB_X, FENCE_X, 3_000)]);
    fake.seedLeaseAuthority(LEASE_X, { live: true });

    const lines: LogLine[] = [];
    const b = await lifetime({ logger: recordingLogger(lines) });
    await b.start();
    expect(renewRequestsFor(LEASE_X)).toHaveLength(1); // the probe

    // Structural: the renewal driver holds NO lease — the fenced lease was never re-registered.
    expect((b.loopSupervisorSeam as LeaseRenewalDriver).activeRenewalCount()).toBe(0);
    // Behavioural: the control-plane double sees no further lease_renew for it.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(renewRequestsFor(LEASE_X)).toHaveLength(1);
    // Named and attributable: the fence is logged with the lease and attempt ids.
    const fenced = lines.find((l) => l.bindings.reason === LEASE_CANDIDATE_REASONS.fenced);
    expect(fenced?.bindings).toMatchObject({ leaseId: LEASE_X, jobId: JOB_X, attempt: 1, organizationId: ORG_X });

    // A CRASH LOOP cannot keep it alive: the candidate was claimed before its probe, so a third
    // lifetime over the same files probes (and renews) nothing.
    crash(b);
    const cLines: LogLine[] = [];
    const c = await lifetime({ logger: recordingLogger(cLines) });
    await c.start();
    expect(renewRequestsFor(LEASE_X)).toHaveLength(1);
    expect(reasonsIn(cLines)).toContain(LEASE_CANDIDATE_REASONS.empty);
  }, 15_000);

  it("★ 3 — an attempt that ENDED before the crash was pruned, and is never probed", async () => {
    // A run that completes (create → execute → destroy): the handoff settles and the prune runs.
    fake.enqueuePoll({ kind: "offer", offer: offerFor(ORG_X, LEASE_X, JOB_X, FENCE_X) });
    const provider = createFakeSandboxProvider({});
    const a = await lifetime({ provider });
    await a.start();
    expect(await settle(() => provider.callCount("destroy") === 1)).toBe(true);
    // The prune rides the SETTLE, which follows destroy by a tick.
    expect(await settle(() => a.pollLoop.activeLeaseCount() === 0)).toBe(true);
    crash(a);
    await quiesce();
    fake.seedLeaseAuthority(LEASE_X, { live: true });

    const lines: LogLine[] = [];
    const b = await lifetime({ logger: recordingLogger(lines) });
    await b.start();
    expect(renewRequestsFor(LEASE_X)).toHaveLength(0);
    expect(reasonsIn(lines)).toContain(LEASE_CANDIDATE_REASONS.empty);
  });

  it("★ 4 — an EMPTY store boots with a NAMED reason (never a silent [])", async () => {
    const lines: LogLine[] = [];
    const b = await lifetime({ logger: recordingLogger(lines) });
    await b.start();
    expect(reasonsIn(lines)).toContain(LEASE_CANDIDATE_REASONS.empty);
    expect(fake.renewRequests()).toHaveLength(0);
    expect(await settle(() => fake.pollCount() >= 1)).toBe(true);
  });

  it("★ 4 — a PLATFORM-scoped target skips the sandbox pass with a NAMED reason (no ownership selector exists)", async () => {
    const provider = createFakeSandboxProvider({});
    const lines: LogLine[] = [];
    const b = await lifetime({ provider, logger: recordingLogger(lines) }); // the fixture target is platform-scoped
    await b.start();
    expect(reasonsIn(lines)).toContain(SANDBOX_PASS_SKIP_REASONS.platformScopedTarget);
    expect(provider.callCount("list")).toBe(0);
  });

  it("★ 4 (positive control) — an ORGANIZATION-scoped target DOES run the sandbox pass, under its own Organization", async () => {
    const base = await makeSelfModel();
    const self: WorkerSelfModel = {
      ...base,
      registeredTargetProfile: { ...base.registeredTargetProfile, scope: "organization", organizationId: ORG_X },
    };
    const provider = createFakeSandboxProvider({});
    const selectors: OwnershipSelector[] = [];
    const list = provider.list.bind(provider);
    provider.list = async (input, ctx) => {
      selectors.push(input.ownershipSelector);
      return list(input, ctx);
    };
    const lines: LogLine[] = [];
    const b = await lifetime({ provider, self, logger: recordingLogger(lines) });
    await b.start();
    expect(reasonsIn(lines)).not.toContain(SANDBOX_PASS_SKIP_REASONS.platformScopedTarget);
    expect(selectors).toEqual([
      { organizationId: ORG_X, targetId: POLL_FIXTURE_IDS.target, workerId: POLL_FIXTURE_IDS.worker },
    ]);
  });

  it("★ F4 — the CONTAINER path (a per-run provider only) skips the sandbox pass with the named F4 narrowing", async () => {
    const lines: LogLine[] = [];
    let perRunBuilt = 0;
    const b = await lifetime({
      makeRunProvider: () => {
        perRunBuilt += 1;
        return createFakeSandboxProvider({});
      },
      logger: recordingLogger(lines),
    });
    await b.start();
    expect(reasonsIn(lines)).toContain(SANDBOX_PASS_SKIP_REASONS.containerPathNoEnumeration);
    expect(perRunBuilt).toBe(0); // no provider was conjured to enumerate with
  });

  it("★ 6 — a CORRUPT store: ZERO lease_renew for the pre-crash lease, a named (distinct) reason, and polling still starts", async () => {
    await ackThenCrash([offerFor(ORG_X, LEASE_X, JOB_X, FENCE_X)]);
    fake.seedLeaseAuthority(LEASE_X, { live: true });
    // The store A wrote on ACK is now unreadable.
    writeFileSync(candidatePath(), Buffer.from("torn write — not a database ".repeat(64)));

    const lines: LogLine[] = [];
    const b = await lifetime({ logger: recordingLogger(lines) });
    const pollsBefore = fake.pollCount();
    await b.start();

    expect(renewRequestsFor(LEASE_X)).toHaveLength(0); // renewal is what is closed
    const reasons = reasonsIn(lines);
    expect(reasons).toContain(LEASE_CANDIDATE_REASONS.unreadable);
    expect(reasons).not.toContain(LEASE_CANDIDATE_REASONS.empty); // distinct from case 4
    expect(await settle(() => fake.pollCount() > pollsBefore)).toBe(true); // boot was not blocked
    // The unreadable file was set aside (never silently overwritten) and a fresh store opened.
    expect(readdirSync(workDir).some((f) => f.startsWith("lease-candidates.db.corrupt-"))).toBe(true);
    expect(existsSync(candidatePath())).toBe(true);
  });

  it("★ 6 — an undecodable ROW: no renewal for any stored lease, the named reason, polling starts", async () => {
    await ackThenCrash([offerFor(ORG_X, LEASE_X, JOB_X, FENCE_X)]);
    fake.seedLeaseAuthority(LEASE_X, { live: true });
    const { loadDatabaseSync } = await import("../events/event-outbox-store.js");
    const Database = await loadDatabaseSync();
    const db = new Database(candidatePath());
    db.prepare("UPDATE lease_candidate SET offer_json = ? WHERE lease_id = ?").run("{torn", LEASE_X);
    db.close();

    const lines: LogLine[] = [];
    const b = await lifetime({ logger: recordingLogger(lines) });
    const pollsBefore = fake.pollCount();
    await b.start();
    expect(renewRequestsFor(LEASE_X)).toHaveLength(0);
    expect(reasonsIn(lines)).toContain(LEASE_CANDIDATE_REASONS.unreadable);
    expect(await settle(() => fake.pollCount() > pollsBefore)).toBe(true);
  });

  it("★ 7 — POSITIVE CONTROL: with no store to write on ACK, the restart probes nothing (case 1's probe is absent)", async () => {
    // Lifetime A runs WITHOUT the store: the ACK happens, the write-on-ACK has nowhere to go.
    await ackThenCrash([offerFor(ORG_X, LEASE_X, JOB_X, FENCE_X)], { withStore: false });
    fake.seedLeaseAuthority(LEASE_X, { live: true });
    const lines: LogLine[] = [];
    const b = await lifetime({ logger: recordingLogger(lines) });
    await b.start();
    expect(renewRequestsFor(LEASE_X)).toHaveLength(0);
    expect(reasonsIn(lines)).toContain(LEASE_CANDIDATE_REASONS.empty);
  });

  it("★ 7 — a daemon composed with NO store path says so by name (never a silent skip)", async () => {
    const lines: LogLine[] = [];
    const b = await lifetime({ withStore: false, logger: recordingLogger(lines) });
    await b.start();
    expect(reasonsIn(lines)).toContain(LEASE_CANDIDATE_REASONS.notConfigured);
  });

  it("★ 8 — F10: two Organizations' leases on ONE daemon are stored, probed and fenced INDEPENDENTLY, each under its own identity", async () => {
    await ackThenCrash([offerFor(ORG_X, LEASE_X, JOB_X, FENCE_X), offerFor(ORG_Y, LEASE_Y, JOB_Y, FENCE_Y)]);
    // Organization X's attempt is still live; Organization Y's already ended at the control plane.
    fake.seedLeaseAuthority(LEASE_X, { live: true });
    fake.seedLeaseAuthority(LEASE_Y, { live: false, deadReason: "stale_fence" });

    const lines: LogLine[] = [];
    const b = await lifetime({ logger: recordingLogger(lines) });
    await b.start();

    // Each lease probed exactly once, and each probe carried ONLY its own lease's identity.
    expect(renewRequestsFor(LEASE_X)).toEqual([
      { leaseId: LEASE_X, workerId: POLL_FIXTURE_IDS.worker, jobId: JOB_X, attempt: 1, fenceToken: FENCE_X },
    ]);
    expect(renewRequestsFor(LEASE_Y)).toEqual([
      { leaseId: LEASE_Y, workerId: POLL_FIXTURE_IDS.worker, jobId: JOB_Y, attempt: 1, fenceToken: FENCE_Y },
    ]);
    // Cross-tenant: no probe ever pairs one Organization's lease with the other's job or fence.
    for (const r of fake.renewRequests()) {
      if (r.leaseId === LEASE_X) expect([r.jobId, r.fenceToken]).toEqual([JOB_X, FENCE_X]);
      if (r.leaseId === LEASE_Y) expect([r.jobId, r.fenceToken]).toEqual([JOB_Y, FENCE_Y]);
    }
    // Independent verdicts: X fenced (live), Y ended (dead) — neither leaks into the other.
    const byReason = (reason: string) =>
      lines.filter((l) => l.bindings.reason === reason).map((l) => [l.bindings.leaseId, l.bindings.organizationId]);
    expect(byReason(LEASE_CANDIDATE_REASONS.fenced)).toEqual([[LEASE_X, ORG_X]]);
    expect(byReason(LEASE_CANDIDATE_REASONS.ended)).toEqual([[LEASE_Y, ORG_Y]]);
    expect((b.loopSupervisorSeam as LeaseRenewalDriver).activeRenewalCount()).toBe(0);
  });
});
