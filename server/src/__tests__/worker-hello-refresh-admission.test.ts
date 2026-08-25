// server/src/__tests__/worker-hello-refresh-admission.test.ts
//
// WRK-011 (Sprint 2.75) — the pure hello-refresh admission decision.
//
// ★ POSITIVE CONTROL FIRST (E1-F008 precedent). Five placement guards once passed
// their own named tests while DELETED, because every fixture refused earlier for an
// unrelated reason and each test asserted a bare `admit:false`. So this suite OPENS by
// proving the shared fixture ADMITS with `changed:true` and a SPECIFIC profileHash, and
// every refusal case below asserts its SPECIFIC reason — never a bare `admit:false`.

import { describe, expect, it } from "vitest";
import { workerHelloV1Schema, type WorkerHelloV1 } from "@armyofagents/worker-protocol";
import {
  admitHelloRefresh,
  helloRefreshRefusalWireCode,
  type HelloRefusalReason,
} from "../services/worker-hello-refresh-admission.js";

const WORKER_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";
const RATIFIED_POLICY_HASH = "a".repeat(64);
const INJECTED_DIGEST = "b".repeat(64);

/** A valid, parsed hello inside the ratified ceiling (a STRICT subset), at the
 * principal's identity and generation, echoing the ratified policy. The positive
 * control must ADMIT this before any refusal case is built on it. */
function hello(overrides: Partial<WorkerHelloV1> = {}): WorkerHelloV1 {
  return workerHelloV1Schema.parse({
    protocolVersion: 1,
    workerId: WORKER_ID,
    targetId: TARGET_ID,
    deviceGeneration: 3,
    agentVersion: "1.0.0",
    supportedProtocol: { min: 1, max: 1 },
    platform: { os: "linux", arch: "x64", runtime: "desktop" },
    reportedCapabilities: ["workload.batch"],
    capacity: {
      batchSlots: 1,
      browserSessionSlots: 0,
      serviceSlots: 0,
      freeCpuMillis: 1000,
      freeMemoryMiB: 512,
      freeDiskMiB: 1024,
    },
    policyHash: RATIFIED_POLICY_HASH,
    ...overrides,
  });
}

function input(overrides: Partial<Parameters<typeof admitHelloRefresh>[0]> = {}) {
  return {
    principal: { workerId: WORKER_ID, targetId: TARGET_ID, targetGeneration: 3 },
    hello: hello(),
    ratified: { capabilityCeiling: ["workload.batch", "workload.service"], policyHash: RATIFIED_POLICY_HASH },
    currentProfileHash: null,
    digestOf: () => INJECTED_DIGEST,
    ...overrides,
  } satisfies Parameters<typeof admitHelloRefresh>[0];
}

describe("admitHelloRefresh — positive control", () => {
  it("ADMITS a provisioned worker with changed:true and the injected digest", () => {
    const decision = admitHelloRefresh(input());
    expect(decision).toEqual({ admit: true, changed: true, profileHash: INJECTED_DIGEST });
  });

  it("ADMITS with changed:false when the computed digest equals the current hash (idempotent no-op)", () => {
    const decision = admitHelloRefresh(input({ currentProfileHash: INJECTED_DIGEST }));
    expect(decision).toEqual({ admit: true, changed: false });
  });
});
