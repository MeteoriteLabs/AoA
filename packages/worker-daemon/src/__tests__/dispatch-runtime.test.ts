import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";
import {
  leaseOfferV1Schema,
  registeredTargetProfileV1Schema,
  verifyAndBrandProviderConstraintProfileV1,
  type WorkerCapacity,
} from "@armyofagents/worker-protocol";

import { composeDispatchRuntime, type ComposeDispatchRuntimeDeps } from "../lifecycle/dispatch-runtime.js";
import { buildDesktopHello } from "../enrollment/desktop-hello.js";
import { deriveHelloProvisioning } from "../enrollment/hello-provisioning.js";
import { offerSatisfiesWorker, type CapacityProbes, type WorkerSelfModel } from "../poll/capacity.js";
import { createFakeSandboxProvider } from "./support/fake-provider.js";
import { generateDeviceKey } from "../identity/device-key.js";

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../../tests/fixtures/worker-provisioned-target.json", import.meta.url)),
    "utf8",
  ),
) as { registeredProfile: Record<string, unknown>; providerConstraintProfile: Record<string, unknown>; leaseOffer: unknown };

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const NAMEPLATE: WorkerCapacity = {
  batchSlots: 1, browserSessionSlots: 0, serviceSlots: 0,
  freeCpuMillis: 2000, freeMemoryMiB: 4096, freeDiskMiB: 8192,
};
// Probes reporting far ABOVE the fixture ceiling (cpu 2000 / mem 4096 / disk 8192), so the
// clamp is observable regardless of the test host's real resources.
const HUGE_PROBES: CapacityProbes = {
  freeCpuMillis: () => 999_999,
  freeMemoryMiB: () => 999_999,
  freeDiskMiB: () => 999_999,
};

async function provisionedSelf(): Promise<WorkerSelfModel> {
  const provisioning = deriveHelloProvisioning({
    selfModelResponse: { registeredProfile: fixture.registeredProfile, providerConstraintProfile: fixture.providerConstraintProfile },
    isolation: "none",
    capacity: NAMEPLATE,
  });
  const report = buildDesktopHello({
    workerId: "00000000-0000-4000-8000-000000000001",
    targetId: fixture.registeredProfile.targetId as string,
    deviceGeneration: 1,
    platform: "linux",
    arch: "x64",
    provisioning: provisioning!,
  });
  const verified = await verifyAndBrandProviderConstraintProfileV1(fixture.providerConstraintProfile, sha256);
  return {
    registeredTargetProfile: registeredTargetProfileV1Schema.parse(fixture.registeredProfile),
    verifiedProviderConstraints: verified!,
    report,
  };
}

/** Fake factories that capture the deps composeDispatchRuntime passes, and record the order. */
function harness() {
  const order: string[] = [];
  const captured: Record<string, unknown> = {};
  const sinkSentinel = { emit: () => {}, __sink: true } as never;
  const supSentinel = { accept: () => {}, cancel: () => {}, onLeaseLost: () => {}, shutdown: () => {}, activeRunCount: () => 0, __sup: true } as never;
  const driverSentinel = { accept: () => {}, stop: () => {}, activeRenewalCount: () => 0, proxyFor: () => undefined, __driver: true } as never;
  const pollSentinel = { run: async () => ({ kind: "stopped" }), stopLeasing: () => {}, drain: async () => {}, activeLeaseCount: () => 0 } as never;

  const seams: Partial<ComposeDispatchRuntimeDeps> = {
    probes: HUGE_PROBES,
    openStore: (async (o: unknown) => { order.push("openStore"); captured.storeOpts = o; return { close: () => {}, __store: true } as never; }) as never,
    makeSink: ((d: { store: unknown; kek: unknown }) => { order.push("makeSink"); captured.sinkStore = d.store; captured.sinkKek = d.kek; return sinkSentinel; }) as never,
    makeDrain: ((d: { kek: unknown }) => { order.push("makeDrain"); captured.drainKek = d.kek; return { recover: () => { order.push("recover"); return 0; }, start: () => { order.push("drainStart"); }, stop: () => {}, drainOnce: async () => ({}), flush: async () => {} } as never; }) as never,
    makeSupervisor: ((d: { eventSink: unknown; redactionCanaries: unknown; observeRun?: unknown }) => { order.push("makeSupervisor"); captured.supEventSink = d.eventSink; captured.redactionCanaries = d.redactionCanaries; captured.observeRun = d.observeRun; return supSentinel; }) as never,
    makeDriver: ((d: { eventSink: unknown; supervisor: unknown; schedule: unknown }) => { order.push("makeDriver"); captured.driverEventSink = d.eventSink; captured.driverSupervisor = d.supervisor; captured.driverSchedule = d.schedule; return driverSentinel; }) as never,
    makePollLoop: ((d: { supervisor: unknown; self: unknown; measure: unknown }) => { order.push("makePollLoop"); captured.pollSupervisor = d.supervisor; captured.pollSelf = d.self; captured.pollMeasure = d.measure; captured.pollRun = () => { order.push("pollRun"); }; return { ...pollSentinel, run: async () => { order.push("pollRun"); return { kind: "stopped" }; } } as never; }) as never,
    makeSchedule: (() => ({ __schedule: true }) as never) as never,
  };
  return { order, captured, seams, sinkSentinel, driverSentinel };
}

async function compose(extra?: Partial<ComposeDispatchRuntimeDeps>) {
  const self = await provisionedSelf();
  const h = harness();
  const runtime = await composeDispatchRuntime({
    provider: createFakeSandboxProvider({}),
    self,
    key: generateDeviceKey(),
    store: {} as never,
    client: {} as never,
    eventOutboxPath: "/tmp/outbox.db",
    concurrency: { batch: 3, browser: 2, service: 1 },
    backoff: { baseMs: 1, maxMs: 2, jitter: 0 } as never,
    workDir: "/tmp",
    ...h.seams,
    ...extra,
  });
  return { runtime, ...h, self };
}

describe("composeDispatchRuntime — the composition wiring", () => {
  it("★ the poll loop leases through the RENEWAL DRIVER, not the raw supervisor", async () => {
    const { captured, driverSentinel, runtime } = await compose();
    expect(captured.pollSupervisor).toBe(driverSentinel);
    expect(runtime.loopSupervisorSeam).toBe(driverSentinel);
    expect(captured.pollSupervisor).not.toBe(captured.driverSupervisor); // the driver DECORATES the supervisor
  });

  it("★ recovery happens BEFORE the supervisor can emit (recover precedes makeSupervisor)", async () => {
    const { order } = await compose();
    expect(order.indexOf("recover")).toBeLessThan(order.indexOf("makeSupervisor"));
    expect(order.indexOf("recover")).toBeGreaterThan(-1);
  });

  it("★ the SAME event sink goes to BOTH the supervisor and the driver", async () => {
    const { captured, sinkSentinel } = await compose();
    expect(captured.supEventSink).toBe(sinkSentinel);
    expect(captured.driverEventSink).toBe(sinkSentinel);
    expect(captured.driverEventSink).toBe(captured.supEventSink);
  });

  it("★ the KEK reaches the sink (not only the drain)", async () => {
    const { captured } = await compose();
    expect(captured.sinkKek).toBeInstanceOf(Buffer);
    expect(captured.drainKek).toBeInstanceOf(Buffer);
    expect(captured.sinkKek).toEqual(captured.drainKek);
  });

  it("★ redactionCanaries is [] and observeRun is undefined (nothing to redact)", async () => {
    const { captured } = await compose();
    expect(captured.redactionCanaries).toEqual([]);
    expect(captured.observeRun).toBeUndefined();
  });

  it("★ capacity is CLAMPED to the server-owned provider ceiling", async () => {
    const { runtime } = await compose();
    const cap = runtime.measure();
    // Fixture ceiling: cpu 2000, mem 4096, disk 8192 — the huge probes are clamped down to it.
    expect(cap.freeCpuMillis).toBe(2000);
    expect(cap.freeMemoryMiB).toBe(4096);
    expect(cap.freeDiskMiB).toBe(8192);
  });

  it("★ measure() reads the limiter LIVE (not a constant snapshot)", async () => {
    const { runtime } = await compose();
    expect(runtime.measure().batchSlots).toBe(3);
    runtime.limiter.tryAcquire("batch");
    expect(runtime.measure().batchSlots).toBe(2);
  });

  it("the composed self-model is MATCHABLE — offerSatisfiesWorker ADMITS a valid offer, REFUSES an unprovisioned one", async () => {
    const { self } = await compose();
    const offer = leaseOfferV1Schema.parse(fixture.leaseOffer);
    expect(offerSatisfiesWorker(self, NAMEPLATE, offer)).toBe(true);
    const bareReport = buildDesktopHello({
      workerId: "00000000-0000-4000-8000-000000000001",
      targetId: fixture.registeredProfile.targetId as string,
      deviceGeneration: 1, platform: "linux", arch: "x64",
    });
    expect(offerSatisfiesWorker({ ...self, report: bareReport }, NAMEPLATE, offer)).toBe(false);
  });

  it("start() starts the drain then the poll loop (fire-and-forget)", async () => {
    const { runtime, order } = await compose();
    runtime.start();
    expect(order).toContain("drainStart");
    expect(order.indexOf("drainStart")).toBeLessThan(order.indexOf("pollRun"));
  });
});
