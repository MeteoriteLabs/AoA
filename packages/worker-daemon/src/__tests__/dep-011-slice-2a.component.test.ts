// -----------------------------------------------------------------------------
// DEP-011 Slice 2a — the per-run networked provider factory + capability threading
// + the credential crossing (worker side). Ships INERT.
//
// PART A drives a REAL `composeDispatchRuntime` (poll → ack → supervise) with
// `makeRunProvider = ({capability}) => new NetworkedProviderDriver(...)` pointed at
// an IN-PROCESS GATED `createProviderServer({ provider: E2bSandboxProvider(mock),
// controlPlanePublicKey })`. The capability is minted IN THIS `.test.ts` (a TEST
// keypair; `signOwnedLabelsCapability` — the fake control-plane is boundary-scanned
// and cannot import the mint, so it echoes the OPAQUE cap the test seeds). This is
// the whole crossing: the redeemed model key rides `create`'s `env` and the cap
// `sig` rides the create over the wire; the value + sig must NEVER reach the drained
// event stream or the worker logs.
//
// PART B drives `createSupervisor` DIRECTLY with `makeRunProvider` + a hand-fed
// handoff + an injected clock, to exercise the honest-cleanup timing (§2a.5) and the
// null-object late-binding (§2a.3) deterministically: fail-fast construction, the
// zero-capability fail-closed, a cancel delivered MID-REDEMPTION, an expired-cap
// teardown recording a DISTINCT `orphaned` (never `success`/`failed`, converge never
// called), and a genuinely-gone sandbox → `success` (not a false orphan).
//
// E2bSandboxProvider is named ONLY in this `.test.ts` (excluded from
// `check-gate-clause-wiring` → E7-1 stays at 4) and imported via SUBPATHS so the
// real-transport / `e2b` SDK stay out of the module closure.
// -----------------------------------------------------------------------------

import { generateKeyPairSync } from "node:crypto";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { signOwnedLabelsCapability } from "@armyofagents/provider-capability";
import { NetworkedProviderDriver } from "@armyofagents/provider-wire";
import type { OwnedLabelsCapability } from "@armyofagents/provider-wire";
import { E2bSandboxProvider } from "@armyofagents/sandbox-e2b-provider/e2b-provider.js";
import { MockE2bTransport } from "@armyofagents/sandbox-e2b-provider/mock-transport.js";
import { createProviderServer } from "@armyofagents/adapter-manager";

import { composeDispatchRuntime, type DispatchRuntime } from "../lifecycle/dispatch-runtime.js";
import { createSupervisor } from "../supervisor/supervisor.js";
import { SandboxNotFoundError, type SandboxProvider } from "../supervisor/provider.js";
import { NoopProviderReachedError } from "../supervisor/noop-provider.js";
import { createMetrics } from "../metrics/metrics.js";
import { SessionStore } from "../identity/session.js";
import type { Logger } from "../logging/logger.js";
import type { OwnedLabelsCapabilityLike } from "../lease/owned-labels-capability.js";
import { createFakeSandboxProvider } from "./support/fake-provider.js";
import { startFakeControlPlane, type FakeControlPlane } from "./support/fake-control-plane.js";
import {
  compatibleOffer,
  enrollFixtureWorker,
  enrollmentCodeConfig,
  fixtureProbes,
  makeSelfModel,
  POLL_FIXTURE_IDS,
} from "./support/poll-fixtures.js";
import { collectingSink, handoffLabels, makeHandoff, SUPERVISOR_IDENTITY } from "./support/supervisor-fixtures.js";

const ENV_METADATA_KEY = "__aoa_env"; // METADATA_KEYS.env (not exported; white-box pin)
const REDEEMED_VALUE = "sk-ant-fixture-dep011-2a-000";

const SECRET_HANDLE = {
  handleId: POLL_FIXTURE_IDS.secretHandle,
  materialization: { kind: "env", target: "ANTHROPIC_API_KEY" },
  usePolicy: "sandbox_local_only",
} as const;

/** The exact labels `labelsFor(handoff)` produces for the fixture offer — the cap's `ownedLabels`
 * must equal this or the create-gate rejects EVERY networked create. */
const RUN_LABELS = handoffLabels();

function spyLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const rec = (...args: unknown[]): void => {
    lines.push(JSON.stringify(args));
  };
  const logger = {
    info: (...a: unknown[]) => rec("info", ...a),
    warn: (...a: unknown[]) => rec("warn", ...a),
    error: (...a: unknown[]) => rec("error", ...a),
    flush: async () => {},
  } as unknown as Logger;
  return { logger, lines };
}

async function settle(predicate: () => boolean, timeoutMs = 6000): Promise<boolean> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return true;
}

// =============================================================================
// PART A — the real gated wire: composeDispatchRuntime → NetworkedProviderDriver
//          → gated createProviderServer(E2bSandboxProvider(mock)).
// =============================================================================

/** A mock transport that RECORDS the env metadata each `create` receives (the crossing landed at
 * the provider) and counts terminations — a faithful "provider.peek". */
class CapturingMockTransport extends MockE2bTransport {
  readonly createdEnvs: Record<string, string>[] = [];
  readonly createdIds: string[] = [];
  destroyCount = 0;
  override async create(req: Parameters<MockE2bTransport["create"]>[0]): ReturnType<MockE2bTransport["create"]> {
    const result = await super.create(req);
    this.createdIds.push(result.sandboxId);
    try {
      this.createdEnvs.push(JSON.parse(req.metadata[ENV_METADATA_KEY] ?? "{}") as Record<string, string>);
    } catch {
      this.createdEnvs.push({});
    }
    return result;
  }
  override async terminate(sandboxId: string): Promise<void> {
    await super.terminate(sandboxId);
    this.destroyCount += 1;
  }
}

describe("DEP-011 Slice 2a · PART A — the credential crossing over the REAL gated wire", () => {
  let fake: FakeControlPlane;
  let workDir: string;
  let runtime: DispatchRuntime | null;
  let amServer: ReturnType<typeof createProviderServer>;
  let transport: CapturingMockTransport;
  const CODE = "dep011-2a-code";

  beforeEach(async () => {
    fake = await startFakeControlPlane({ enrollments: [enrollmentCodeConfig(CODE)] });
    workDir = mkdtempSync(join(tmpdir(), "dep011-2a-"));
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
    await new Promise<void>((resolve) => amServer.close(() => resolve()));
    await fake.close();
    rmSync(workDir, { recursive: true, force: true });
  });

  function liveOffer(overrides: Record<string, unknown> = {}) {
    const now = Date.now();
    return compatibleOffer({
      ackDeadline: new Date(now + 5 * 60_000).toISOString(),
      expiresAt: new Date(now + 10 * 60_000).toISOString(),
      ...overrides,
    });
  }

  function credentialOffer() {
    const offer = liveOffer();
    (offer.job as Record<string, unknown>).secretHandles = [SECRET_HANDLE];
    return offer;
  }

  /** Start the GATED adapter-manager over a capturing E2B mock; return the loopback base url. */
  async function startGatedAm(publicKey: import("node:crypto").KeyObject): Promise<string> {
    transport = new CapturingMockTransport();
    amServer = createProviderServer({ provider: new E2bSandboxProvider({ transport }), controlPlanePublicKey: publicKey });
    await new Promise<void>((resolve) => amServer.listen(0, "127.0.0.1", resolve));
    const addr = amServer.address() as AddressInfo;
    return `http://127.0.0.1:${addr.port}`;
  }

  async function composeNetworked(
    offer: Record<string, unknown>,
    amBaseUrl: string,
    logger: Logger,
    capturingFetch?: typeof fetch,
  ): Promise<{ runtime: DispatchRuntime; factoryCalls: () => number }> {
    const { session, key, client } = await enrollFixtureWorker(fake, CODE);
    const self = await makeSelfModel();
    const store = new SessionStore(
      {
        now: () => Date.now(),
        renew: async () => {
          throw new Error("unexpected renew");
        },
        bootstrap: async () => {
          throw new Error("unexpected bootstrap");
        },
      },
      session,
    );
    fake.enqueuePoll({ kind: "offer", offer });
    let factoryCalls = 0;
    const rt = await composeDispatchRuntime({
      makeRunProvider: ({ capability }) => {
        factoryCalls += 1;
        return new NetworkedProviderDriver({
          baseUrl: amBaseUrl,
          fetch: capturingFetch,
          capability: capability as unknown as OwnedLabelsCapability,
        });
      },
      self,
      key,
      store,
      client,
      eventOutboxPath: join(workDir, "outbox.db"),
      concurrency: { batch: 1, browser: 0, service: 0 },
      backoff: { baseMs: 1, maxMs: 5, jitter: 0 } as never,
      workDir,
      probes: fixtureProbes(),
      logger,
    });
    return { runtime: rt, factoryCalls: () => factoryCalls };
  }

  it("★ (a)/(b)/(c) — a minted cap VERIFIES at the gate, the model key CROSSES into the sandbox env, and the value + sig NEVER leak to events or logs", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const cap = signOwnedLabelsCapability(
      { v: 1, audience: "adapter-manager", ownedLabels: RUN_LABELS, expiresAt: Date.now() + 3_600_000 },
      privateKey,
    );
    fake.seedSecretResolution(SECRET_HANDLE.handleId, {
      envTarget: "ANTHROPIC_API_KEY",
      value: REDEEMED_VALUE,
      ownedLabelsCapability: cap,
    });
    const amBaseUrl = await startGatedAm(publicKey);

    const requestBodies: string[] = [];
    const capturingFetch: typeof fetch = async (input, init) => {
      if (typeof init?.body === "string") requestBodies.push(init.body);
      return fetch(input, init);
    };
    const { logger, lines } = spyLogger();
    const composed = await composeNetworked(credentialOffer(), amBaseUrl, logger, capturingFetch);
    runtime = composed.runtime;
    runtime.start();

    // (a) the whole lifecycle ran through the GATED wire: create + the happy destroy both
    // passed the gate (a rejected cap would refuse create → no sandbox, no destroy).
    const ok = await settle(() => transport.destroyCount >= 1 && transport.createdIds.length === 1);
    expect(ok, "networked create+destroy completed through the gate").toBe(true);

    // (b) the redeemed model key CROSSED into the provider's create env (provider-side peek).
    expect(transport.createdEnvs[0]?.ANTHROPIC_API_KEY).toBe(REDEEMED_VALUE);

    // The crossing is REAL: the value + the cap sig are present in the create REQUEST body (correct).
    const createReq = requestBodies.find((b) => b.includes("/")); // any op body
    expect(requestBodies.some((b) => b.includes(REDEEMED_VALUE)), "value present in a create REQUEST").toBe(true);
    expect(requestBodies.some((b) => b.includes(cap.sig)), "cap sig present in a create REQUEST").toBe(true);
    void createReq;

    // (c) #104 containment — the value + sig NEVER reach the drained event stream OR the worker logs.
    await runtime.eventOutbox.flush();
    await settle(() => fake.eventBodies().length >= 2, 3000);
    const bodies = JSON.stringify(fake.eventBodies());
    // positive control: the bodies DO carry real emitted content (the created sandboxId).
    expect(bodies.includes(transport.createdIds[0]!), "positive control: real event content present").toBe(true);
    expect(bodies.includes(REDEEMED_VALUE), "redeemed value absent from events").toBe(false);
    expect(bodies.includes(cap.sig), "cap sig absent from events").toBe(false);
    // logs: a positive control (the run leaseId is logged) + the value/sig absent.
    const logs = lines.join("\n");
    expect(logs.includes(POLL_FIXTURE_IDS.lease), "positive control: real log content present").toBe(true);
    expect(logs.includes(REDEEMED_VALUE), "redeemed value absent from logs").toBe(false);
    expect(logs.includes(cap.sig), "cap sig absent from logs").toBe(false);
  });

  it("★ (d) FAIL-CLOSED — a DENIED redemption yields NO capability ⇒ NO driver is built ⇒ NO create crosses the wire", async () => {
    const { publicKey } = generateKeyPairSync("ed25519");
    // No seeded resolution ⇒ the fake denies the handle ⇒ synthesise throws ⇒ fail closed BEFORE the
    // networked rebuild, so makeRunProvider is NEVER called and no sandbox is ever created.
    const amBaseUrl = await startGatedAm(publicKey);
    const createRequests: string[] = [];
    const capturingFetch: typeof fetch = async (input, init) => {
      if (typeof input === "string" && input.includes("/op/create")) createRequests.push(String(init?.body ?? ""));
      return fetch(input, init);
    };
    const { logger } = spyLogger();
    const composed = await composeNetworked(credentialOffer(), amBaseUrl, logger, capturingFetch);
    runtime = composed.runtime;
    runtime.start();

    await settle(() => fake.ackCountFor(POLL_FIXTURE_IDS.lease) === 1 && fake.resolveCountFor(SECRET_HANDLE.handleId) >= 1);
    // Give the (failing) supervise a moment to settle.
    await settle(() => transport.createdIds.length > 0, 400);
    expect(transport.createdIds.length, "no sandbox created on a denied redemption").toBe(0);
    expect(createRequests.length, "no create request crossed the wire").toBe(0);
    expect(composed.factoryCalls(), "the per-run driver factory was never invoked (no cap)").toBe(0);
  });
});

// =============================================================================
// PART B — the supervisor's null-object late-binding + honest-cleanup timing,
//          driven directly for determinism (injected clock, deferred redemption).
// =============================================================================

/** A cap-like object (Part B's fake provider is un-gated, so no real signature is needed). */
function capLike(expiresAt: number): OwnedLabelsCapabilityLike {
  return { v: 1, audience: "adapter-manager", ownedLabels: RUN_LABELS, expiresAt, sig: "test-sig" };
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("DEP-011 Slice 2a · PART B — fail-fast, null-object late-binding, honest cleanup", () => {
  it("FAIL-FAST — both provider AND makeRunProvider set ⇒ throws at construction", () => {
    expect(() =>
      createSupervisor({
        provider: createFakeSandboxProvider({}),
        makeRunProvider: () => createFakeSandboxProvider({}),
        identity: SUPERVISOR_IDENTITY,
        eventSink: collectingSink(),
        redactionCanaries: [],
        materializeRunSecrets: async () => ({ env: {}, canaries: [] }),
      }),
    ).toThrow(/mutually exclusive/);
  });

  it("FAIL-FAST — makeRunProvider WITHOUT materializeRunSecrets ⇒ throws (the rebuild would never run)", () => {
    expect(() =>
      createSupervisor({
        makeRunProvider: () => createFakeSandboxProvider({}),
        identity: SUPERVISOR_IDENTITY,
        eventSink: collectingSink(),
        redactionCanaries: [],
      }),
    ).toThrow(/requires materializeRunSecrets/);
  });

  it("the per-run driver is built AFTER redemption: create/execute/destroy hit the makeRunProvider provider", async () => {
    const provider = createFakeSandboxProvider({});
    let factoryCalls = 0;
    const sink = collectingSink();
    const supervisor = createSupervisor({
      makeRunProvider: () => {
        factoryCalls += 1;
        return provider;
      },
      identity: SUPERVISOR_IDENTITY,
      eventSink: sink,
      redactionCanaries: [],
      now: () => 1000,
      materializeRunSecrets: async () => ({ env: { ANTHROPIC_API_KEY: REDEEMED_VALUE }, canaries: [REDEEMED_VALUE], capability: capLike(9_999_999) }),
    });
    await supervisor.accept(makeHandoff());
    expect(factoryCalls).toBe(1);
    const ops = provider.calls().filter((c) => !c.replayed).map((c) => c.op);
    expect(ops).toEqual(["create", "execute", "destroy"]);
    expect(supervisor.activeRunCount()).toBe(0);
  });

  it("ZERO-CAPABILITY fail-closed — redemption succeeds but yields NO cap ⇒ no driver, no create, a diagnosable terminal", async () => {
    let factoryCalls = 0;
    const sink = collectingSink();
    const supervisor = createSupervisor({
      makeRunProvider: () => {
        factoryCalls += 1;
        return createFakeSandboxProvider({});
      },
      identity: SUPERVISOR_IDENTITY,
      eventSink: sink,
      redactionCanaries: [],
      now: () => 1000,
      materializeRunSecrets: async () => ({ env: {}, canaries: [] }), // NO capability
    });
    await supervisor.accept(makeHandoff());
    expect(factoryCalls, "no driver built with capability:undefined").toBe(0);
    expect(supervisor.activeRunCount(), "no run leaked").toBe(0);
    const terminal = sink.events.find((e) => e.eventType === "terminal");
    expect(terminal?.payload).toMatchObject({ status: "failed", errorCode: "no_run_capability" });
  });

  it("(e) a cancel delivered MID-REDEMPTION does not throw or strand — the null-object authorities absorb it (no TypeError)", async () => {
    const provider = createFakeSandboxProvider({});
    const mat = deferred();
    const { logger, lines } = spyLogger();
    const supervisor = createSupervisor({
      makeRunProvider: () => provider,
      identity: SUPERVISOR_IDENTITY,
      eventSink: collectingSink(),
      redactionCanaries: [],
      now: () => 1000,
      logger,
      materializeRunSecrets: async () => {
        await mat.promise;
        return { env: {}, canaries: [], capability: capLike(9_999_999) };
      },
    });
    const handoff = makeHandoff();
    const running = supervisor.accept(handoff);
    // The run is registered and BLOCKED at redemption (null-object authorities in place).
    await settle(() => supervisor.activeRunCount() === 1, 1000);
    // Deliver the cancel DURING the redemption window — reaches escalateCleanup with NO try/catch.
    await supervisor.cancel(handoff.leaseId, "cancel_mid_redemption");
    mat.resolve();
    await expect(running).resolves.toBeUndefined();
    expect(supervisor.activeRunCount(), "run cleaned up, no map leak").toBe(0);
    // The null-object never let an EFFECTFUL op through, and nothing NPE'd.
    const logs = lines.join("\n");
    expect(logs).not.toContain("TypeError");
    expect(logs).not.toContain(NoopProviderReachedError.name);
  });

  it("(f) an EXPIRED cap at teardown records a DISTINCT `orphaned` outcome — never `success`/`failed`, converge NEVER called", async () => {
    let clock = 1000;
    const gate = deferred();
    const provider = createFakeSandboxProvider({ executeGate: gate.promise });
    const metrics = createMetrics();
    const sink = collectingSink();
    const supervisor = createSupervisor({
      makeRunProvider: () => provider,
      identity: SUPERVISOR_IDENTITY,
      eventSink: sink,
      redactionCanaries: [],
      metrics,
      now: () => clock,
      // cap valid at create (clock 1000 < 5000), expires before the run ends.
      materializeRunSecrets: async () => ({ env: {}, canaries: [], capability: capLike(5000) }),
    });
    const running = supervisor.accept(makeHandoff());
    // Hold at execute (create already succeeded), then advance the clock PAST the cap expiry.
    await settle(() => provider.callCount("execute") >= 1, 1000);
    clock = 6000;
    gate.resolve();
    await running;

    const prom = metrics.renderPrometheus();
    // The run terminal is still `succeeded` (frozen — the orphan is a cleanup outcome, not a terminal).
    const terminal = sink.events.find((e) => e.eventType === "terminal");
    expect(terminal?.payload).toMatchObject({ status: "succeeded" });
    // A DISTINCT `orphaned` cleanup outcome, present and NOT masked as success/failed.
    expect(prom).toContain('cleanup_outcome{outcome="orphaned"} 1');
    expect(prom).not.toContain('cleanup_outcome{outcome="success"}');
    expect(prom).not.toContain('cleanup_outcome{outcome="failed"}');
    // converge was NEVER called — NO teardown op reached the provider.
    expect(provider.callCount("destroy")).toBe(0);
    expect(provider.callCount("cancel")).toBe(0);
    expect(provider.callCount("kill")).toBe(0);
  });

  it("(f2) escalateCleanup with an EXPIRED cap orphans CLOCK-FIRST — never the gate-masking converge", async () => {
    let clock = 1000;
    const gate = deferred();
    const provider = createFakeSandboxProvider({ executeGate: gate.promise });
    const metrics = createMetrics();
    const supervisor = createSupervisor({
      makeRunProvider: () => provider,
      identity: SUPERVISOR_IDENTITY,
      eventSink: collectingSink(),
      redactionCanaries: [],
      metrics,
      now: () => clock,
      materializeRunSecrets: async () => ({ env: {}, canaries: [], capability: capLike(5000) }),
    });
    const handoff = makeHandoff();
    const running = supervisor.accept(handoff);
    await settle(() => provider.callCount("execute") >= 1, 1000);
    clock = 6000; // the lease-clamped cap is now expired
    // A cancel routes teardown through escalateCleanup → the HONEST networked convergence.
    await supervisor.cancel(handoff.leaseId, "cancel_expired");
    gate.resolve();
    await running;

    const prom = metrics.renderPrometheus();
    expect(prom).toContain('cleanup_outcome{outcome="orphaned"} 1');
    expect(prom).not.toContain('cleanup_outcome{outcome="success"}');
    // CLOCK-FIRST: NO gate-masking teardown op reached the provider (the standard converge would
    // have cancelled/destroyed the fake and reported a FALSE success).
    expect(provider.callCount("destroy")).toBe(0);
    expect(provider.callCount("cancel")).toBe(0);
  });

  it("(g) a genuinely-gone sandbox (cap STILL valid on re-read) → `success`, NOT a false orphan", async () => {
    const clock = 1000;
    const gate = deferred();
    // create/execute succeed; the sandbox is GONE at teardown (inspect → SandboxNotFoundError →
    // #requireOwned maps to the uniform RNA). The cap stays valid, so RNA means GONE → success.
    const base = createFakeSandboxProvider({ executeGate: gate.promise });
    const goneProvider: SandboxProvider = {
      ...base,
      inspect: async () => {
        throw new SandboxNotFoundError();
      },
    };
    const metrics = createMetrics();
    const supervisor = createSupervisor({
      makeRunProvider: () => goneProvider,
      identity: SUPERVISOR_IDENTITY,
      eventSink: collectingSink(),
      redactionCanaries: [],
      metrics,
      now: () => clock,
      materializeRunSecrets: async () => ({ env: {}, canaries: [], capability: capLike(9_999_999) }),
    });
    const handoff = makeHandoff();
    const running = supervisor.accept(handoff);
    await settle(() => base.callCount("execute") >= 1, 1000);
    // Cancel while held at execute ⇒ escalateCleanup ⇒ convergeNetworked over the GONE sandbox.
    await supervisor.cancel(handoff.leaseId, "cancel_gone");
    gate.resolve();
    await running;

    const prom = metrics.renderPrometheus();
    // A valid cap + RNA = genuinely gone = success, never a false orphan.
    expect(prom).toContain('cleanup_outcome{outcome="success"} 1');
    expect(prom).not.toContain('cleanup_outcome{outcome="orphaned"}');
  });
});
