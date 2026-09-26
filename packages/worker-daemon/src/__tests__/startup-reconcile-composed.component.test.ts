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
//   9  (Codex review, PR #553) the candidate is written BEFORE the ACK: a crash after the server
//      recorded the ACK but before the worker read the response still leaves it; an ACK the
//      server refused withdraws it                         — "★ 9"
//  10  (Codex review, PR #553) a candidate write that FAILS is never followed by an ACK — "★ 10"
//  11  (Codex review, PR #553) a boot that dies between claiming and pruning loses nothing: the
//      next boot names the lease and prunes it, WITHOUT a second probe (F5)  — "★ 11"
//  12  (Codex review, PR #553) a configured store that cannot be opened refuses every ACK — "★ 12"
//  13  (Codex review, PR #553) the claim is per-lease, taken immediately before THAT lease's
//      probe: a crash while probing the first candidate leaves the rest probeable — "★ 13"
//  14  a candidate whose CLAIM fails is neither probed nor pruned: the next boot still has it — "★ 14"
//  15  (Codex review, PR #553) on the desktop path a FENCED lease's sandbox is torn down, not
//      left running to the provider's TTL                                              — "★ 15"
//  16  (Codex review, PR #553) a boot that cannot get a SESSION probes nothing and KEEPS every
//      candidate: a transient failure never discards the state WRK-013 exists to keep — "★ 16"
// -----------------------------------------------------------------------------

import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { composeDispatchRuntime, type DispatchRuntime } from "../lifecycle/dispatch-runtime.js";
import { SessionStore } from "../identity/session.js";
import type { LeaseRenewalDriver } from "../lease/lease-renewal.js";
import { LEASE_CANDIDATE_REASONS, openLeaseCandidateStore } from "../lease/lease-candidate-store.js";
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
  /** Wrap the shared client (models a lost ACK response). */
  readonly clientWrap?: (base: ControlPlaneClient) => ControlPlaneClient;
  /** Replace the store opener (models a store whose writes fail). */
  readonly openLeaseCandidates?: Parameters<typeof composeDispatchRuntime>[0]["openLeaseCandidates"];
  readonly makeStartupReconciler?: Parameters<typeof composeDispatchRuntime>[0]["makeStartupReconciler"];
  /** Compose with a session store that cannot produce a session (a TRANSIENT failure, not terminal). */
  readonly sessionBroken?: boolean;
  readonly provider?: SandboxProvider;
  readonly makeRunProvider?: () => SandboxProvider;
  readonly withStore?: boolean;
  readonly logger?: Logger;
  readonly self?: WorkerSelfModel;
  readonly batch?: number;
}

async function lifetime(opts: LifetimeOptions = {}): Promise<DispatchRuntime> {
  const self = opts.self ?? (await makeSelfModel());
  const store = opts.sessionBroken
    ? new SessionStore(
        {
          now: () => Date.now(),
          renew: async () => {
            throw new Error("control plane unreachable");
          },
          bootstrap: async () => {
            throw new Error("control plane unreachable");
          },
        },
        null, // no seeded session: ensureFresh fails TRANSIENTLY (the store never goes stopped)
      )
    : new SessionStore(
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
    client: opts.clientWrap ? opts.clientWrap(worker.client) : opts.callLog ? recordingClient(opts.callLog) : worker.client,
    eventOutboxPath: outboxPath(),
    leaseCandidatePath: opts.withStore === false ? undefined : candidatePath(),
    concurrency: { batch: opts.batch ?? 1, browser: 0, service: 0 },
    backoff: { baseMs: 1, maxMs: 5, jitter: 0 } as never,
    workDir,
    probes: fixtureProbes(),
    logger: opts.logger,
    openLeaseCandidates: opts.openLeaseCandidates,
    makeStartupReconciler: opts.makeStartupReconciler,
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
  // Crash only once every run has reached `create`, so each run is mid-flight (not merely ACKed)
  // when the process dies. The write itself precedes the ACK (★ 9 proves that window).
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

  it("★ 9 — the candidate is written BEFORE the ACK: a crash after the server recorded the ACK, before the worker read it, is still probed", async () => {
    fake.enqueuePoll({ kind: "offer", offer: offerFor(ORG_X, LEASE_X, JOB_X, FENCE_X) });
    // The ACK reaches the control plane and is recorded there; the worker never sees the response.
    const lostResponse = (base: ControlPlaneClient): ControlPlaneClient => ({
      ...base,
      leaseAck: async (...args: Parameters<ControlPlaneClient["leaseAck"]>) => {
        await base.leaseAck(...args);
        return new Promise<never>(() => {});
      },
    });
    const a = await lifetime({ clientWrap: lostResponse });
    await a.start();
    expect(await settle(() => fake.ackCountFor(LEASE_X) === 1)).toBe(true);
    crash(a);
    await quiesce();
    fake.seedLeaseAuthority(LEASE_X, { live: true });

    const lines: LogLine[] = [];
    const b = await lifetime({ logger: recordingLogger(lines) });
    await b.start();
    expect(renewRequestsFor(LEASE_X)).toHaveLength(1);
    expect(lines.some((l) => l.bindings.reason === LEASE_CANDIDATE_REASONS.fenced && l.bindings.leaseId === LEASE_X)).toBe(true);
  });

  it("★ 9 — an ACK the control plane REFUSED withdraws the candidate: the restart probes nothing", async () => {
    fake.enqueueAck({ kind: "rejected", reason: "stale_fence" });
    fake.enqueuePoll({ kind: "offer", offer: offerFor(ORG_X, LEASE_X, JOB_X, FENCE_X) });
    const a = await lifetime({});
    await a.start();
    // A poll AFTER the refused ACK means handleOffer returned, so the withdrawal has run.
    const polledAfterAck = () => {
      const i = fake.requests.findIndex((r) => r.url.endsWith(`/leases/${LEASE_X}/ack`));
      return i >= 0 && fake.requests.slice(i + 1).some((r) => r.url.endsWith("/api/worker-control/poll"));
    };
    expect(await settle(polledAfterAck)).toBe(true);
    crash(a);
    await quiesce();
    fake.seedLeaseAuthority(LEASE_X, { live: true });

    const lines: LogLine[] = [];
    const b = await lifetime({ logger: recordingLogger(lines) });
    await b.start();
    expect(renewRequestsFor(LEASE_X)).toHaveLength(0);
    expect(reasonsIn(lines)).toContain(LEASE_CANDIDATE_REASONS.empty);
  });

  it("★ 10 — a candidate write that FAILS is never followed by an ACK (the offer is dropped, polling continues)", async () => {
    fake.enqueuePoll({ kind: "offer", offer: offerFor(ORG_X, LEASE_X, JOB_X, FENCE_X) });
    const lines: LogLine[] = [];
    const failingPuts = async (o: { path: string }) => {
      const real = await openLeaseCandidateStore(o);
      return Object.assign(real, {
        put: () => {
          throw new Error("disk full");
        },
      });
    };
    const a = await lifetime({ logger: recordingLogger(lines), openLeaseCandidates: failingPuts as never });
    const pollsBefore = fake.pollCount();
    await a.start();
    // The loop keeps polling after the refused write (it backs off, it does not stop) ...
    expect(await settle(() => fake.pollCount() >= pollsBefore + 3)).toBe(true);
    // ... and the lease was NEVER acknowledged to the control plane.
    expect(fake.requests.some((r) => r.url.endsWith(`/leases/${LEASE_X}/ack`))).toBe(false);
    expect(lines.some((l) => l.bindings.reason === LEASE_CANDIDATE_REASONS.writeFailed && l.bindings.op === "put")).toBe(true);
  });

  it("★ 11 — a boot that dies between CLAIMING and PRUNING loses nothing, and the next boot never probes it again (F5)", async () => {
    await ackThenCrash([offerFor(ORG_X, LEASE_X, JOB_X, FENCE_X)]);
    fake.seedLeaseAuthority(LEASE_X, { live: true });

    // Lifetime B claims the candidate for its probe (`beforeProbe`), then dies mid-reconcile.
    const b = await lifetime({
      makeStartupReconciler: (d) => ({
        run: async () => {
          d.beforeProbe?.(d.leaseCandidates[0]!);
          throw new Error("process died mid-reconcile");
        },
      }),
    });
    await b.start();
    crash(b);
    expect(renewRequestsFor(LEASE_X)).toHaveLength(0);

    // Lifetime C: the claimed row is still there — accounted for BY NAME, never probed, then pruned.
    const lines: LogLine[] = [];
    const c = await lifetime({ logger: recordingLogger(lines) });
    await c.start();
    const carried = lines.find((l) => l.bindings.reason === LEASE_CANDIDATE_REASONS.claimedUnprobed);
    expect(carried?.bindings).toMatchObject({ leaseId: LEASE_X, jobId: JOB_X, attempt: 1, organizationId: ORG_X });
    expect(renewRequestsFor(LEASE_X)).toHaveLength(0);
    crash(c);

    // Lifetime D: nothing left.
    const dLines: LogLine[] = [];
    const d = await lifetime({ logger: recordingLogger(dLines) });
    await d.start();
    expect(reasonsIn(dLines)).toContain(LEASE_CANDIDATE_REASONS.empty);
  });

  it("★ 12 — a CONFIGURED store that cannot be opened refuses every ACK (never silently records nothing)", async () => {
    fake.enqueuePoll({ kind: "offer", offer: offerFor(ORG_X, LEASE_X, JOB_X, FENCE_X) });
    const lines: LogLine[] = [];
    const neverOpens = async () => {
      throw new Error("volume is read-only");
    };
    const a = await lifetime({ logger: recordingLogger(lines), openLeaseCandidates: neverOpens as never });
    const pollsBefore = fake.pollCount();
    await a.start();
    expect(await settle(() => fake.pollCount() >= pollsBefore + 3)).toBe(true);
    expect(fake.requests.some((r) => r.url.endsWith(`/leases/${LEASE_X}/ack`))).toBe(false);
    const reasons = reasonsIn(lines);
    expect(reasons).toContain(LEASE_CANDIDATE_REASONS.unavailable);
    expect(reasons).toContain(LEASE_CANDIDATE_REASONS.writeFailed);
  });

  it("★ 13 — the claim is PER LEASE: a crash while probing the first candidate leaves the second probeable", async () => {
    await ackThenCrash([offerFor(ORG_X, LEASE_X, JOB_X, FENCE_X), offerFor(ORG_Y, LEASE_Y, JOB_Y, FENCE_Y)]);
    fake.seedLeaseAuthority(LEASE_X, { live: true });
    fake.seedLeaseAuthority(LEASE_Y, { live: true });

    // Lifetime B claims ONLY the candidate it is about to probe, then dies. The other is untouched.
    const b = await lifetime({
      makeStartupReconciler: (d) => ({
        run: async () => {
          const first = d.leaseCandidates.find((o) => String(o.leaseId) === LEASE_X)!;
          d.beforeProbe?.(first);
          throw new Error("died while probing the first candidate");
        },
      }),
    });
    await b.start();
    crash(b);

    const lines: LogLine[] = [];
    const c = await lifetime({ logger: recordingLogger(lines) });
    await c.start();

    // X was claimed by the dead boot: named, never re-probed (F5). Y was never claimed, so it is
    // PROBED normally — the whole point of claiming one lease at a time.
    expect(lines.filter((l) => l.bindings.reason === LEASE_CANDIDATE_REASONS.claimedUnprobed).map((l) => l.bindings.leaseId)).toEqual([LEASE_X]);
    expect(renewRequestsFor(LEASE_X)).toHaveLength(0);
    expect(renewRequestsFor(LEASE_Y)).toEqual([
      { leaseId: LEASE_Y, workerId: POLL_FIXTURE_IDS.worker, jobId: JOB_Y, attempt: 1, fenceToken: FENCE_Y },
    ]);
    expect(lines.some((l) => l.bindings.reason === LEASE_CANDIDATE_REASONS.fenced && l.bindings.leaseId === LEASE_Y)).toBe(true);
  });

  it("★ 14 — a candidate whose CLAIM fails is NOT probed and NOT pruned; the next boot still probes it", async () => {
    await ackThenCrash([offerFor(ORG_X, LEASE_X, JOB_X, FENCE_X)]);
    fake.seedLeaseAuthority(LEASE_X, { live: true });

    // Lifetime B's store cannot mark the claim durable, so the lease cannot be accounted for.
    const claimFails = async (o: { path: string }) => {
      const real = await openLeaseCandidateStore(o);
      return Object.assign(real, {
        claim: () => {
          throw new Error("disk full");
        },
      });
    };
    const lines: LogLine[] = [];
    const b = await lifetime({ logger: recordingLogger(lines), openLeaseCandidates: claimFails as never });
    await b.start();
    // Nothing was renewed: a lease the daemon cannot account for is never probed.
    expect(renewRequestsFor(LEASE_X)).toHaveLength(0);
    expect(lines.some((l) => l.bindings.reason === LEASE_CANDIDATE_REASONS.writeFailed && l.bindings.leaseId === LEASE_X)).toBe(true);
    crash(b);

    // And it was NOT pruned: a normal lifetime still finds it, and probes it once.
    const cLines: LogLine[] = [];
    const c = await lifetime({ logger: recordingLogger(cLines) });
    await c.start();
    expect(renewRequestsFor(LEASE_X)).toHaveLength(1);
    expect(reasonsIn(cLines)).not.toContain(LEASE_CANDIDATE_REASONS.empty);
    expect(cLines.some((l) => l.bindings.reason === LEASE_CANDIDATE_REASONS.fenced && l.bindings.leaseId === LEASE_X)).toBe(true);
  });

  it("★ 15 — desktop path: a FENCED lease's sandbox is TORN DOWN, not left to the provider TTL", async () => {
    await ackThenCrash([offerFor(ORG_X, LEASE_X, JOB_X, FENCE_X)]);
    fake.seedLeaseAuthority(LEASE_X, { live: true });

    // The crashed run's sandbox is still there, under this worker's own labels and generation.
    const provider = createFakeSandboxProvider({
      ignoreCancel: true, // a bare cancel is ignored, so the cleanup authority must escalate
      seededResources: [
        {
          sandboxId: "sbx-fenced",
          labels: {
            organizationId: ORG_X,
            targetId: POLL_FIXTURE_IDS.target,
            workerId: POLL_FIXTURE_IDS.worker,
            jobId: JOB_X,
            attempt: 1,
            leaseId: LEASE_X,
            deviceGeneration: 1,
          },
          hasLiveLease: true,
          state: "running",
        },
      ],
    });
    const base = await makeSelfModel();
    const self: WorkerSelfModel = {
      ...base,
      registeredTargetProfile: { ...base.registeredTargetProfile, scope: "organization", organizationId: ORG_X },
    };

    const lines: LogLine[] = [];
    const b = await lifetime({ provider, self, logger: recordingLogger(lines) });
    await b.start();

    // The lease was probed once and fenced ...
    expect(renewRequestsFor(LEASE_X)).toHaveLength(1);
    expect(lines.some((l) => l.bindings.reason === LEASE_CANDIDATE_REASONS.fenced && l.bindings.leaseId === LEASE_X)).toBe(true);
    // ... and its supervisor-less sandbox was destroyed, its process tree provably gone.
    expect(provider.peek("sbx-fenced")?.state).toBe("destroyed");
    expect(provider.processTreeAlive("sbx-fenced")).toBe(false);
  });

  it("★ 16 — a boot that cannot obtain a SESSION probes nothing and KEEPS its candidates for the next boot", async () => {
    await ackThenCrash([offerFor(ORG_X, LEASE_X, JOB_X, FENCE_X)]);
    fake.seedLeaseAuthority(LEASE_X, { live: true });

    // Lifetime B cannot acquire a session. probeLeaseAuthority marks every candidate `unprobed`
    // WITHOUT calling beforeProbe and without sending a request.
    const b = await lifetime({ sessionBroken: true });
    await b.start();
    expect(renewRequestsFor(LEASE_X)).toHaveLength(0); // nothing was probed, so nothing was renewed
    crash(b);

    // The candidate SURVIVED that boot: a later lifetime with a working session probes and fences it.
    const lines: LogLine[] = [];
    const c = await lifetime({ logger: recordingLogger(lines) });
    await c.start();
    expect(renewRequestsFor(LEASE_X)).toEqual([
      { leaseId: LEASE_X, workerId: POLL_FIXTURE_IDS.worker, jobId: JOB_X, attempt: 1, fenceToken: FENCE_X },
    ]);
    expect(reasonsIn(lines)).not.toContain(LEASE_CANDIDATE_REASONS.empty);
    expect(lines.some((l) => l.bindings.reason === LEASE_CANDIDATE_REASONS.fenced && l.bindings.leaseId === LEASE_X)).toBe(true);
  });
});
