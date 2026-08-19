// CLI-006 (Task 4) — cancel routing for distributed-owned runs (R3).
//
// Today cancel is a lie for these runs. Every writer's only stop mechanism is
// `runningProcesses.get(run.id)`, which a distributed attempt never populates,
// and `grep requestCancellation server/src/services/heartbeat.ts` returns zero
// hits. Worse, the writer latches the run `cancelled`, so the projector's later
// terminal is discarded and the distributed evidence is lost.
//
// This file covers the two pieces that must exist BEFORE any writer is touched:
// the routing decision, and the port that carries the fence-revoking call.
//
// The port is module-level, not constructor-injected, and that is load-bearing.
// `cancelRun`'s three non-test callers all hold a bare `heartbeatService(db)`
// (agents.ts:198, issues.ts:99, index.ts:1828); only the scheduler instance
// receives options. A port on the constructor would be `undefined` at every real
// cancel — wired-looking, typechecking, and never firing. That is the Task 2a
// defect shape, and instance-independence is the property that fixes it.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveCancelRoute,
  setDistributedCancellationPort,
  getDistributedCancellationPort,
  type DistributedCancellationPort,
} from "../services/distributed-cancellation-port.js";

const JOB = "10b10b10-10b1-4b10-8b10-10b10b10b10b";

const distributedRun = {
  executionOwner: "distributed" as string | null,
  distributedJobId: JOB as string | null,
};

const port: DistributedCancellationPort = {
  requestCancellation: async () => {},
};

beforeEach(() => {
  setDistributedCancellationPort(undefined);
});

describe("CLI-006/Task 4 — resolveCancelRoute", () => {
  it("routes a distributed-owned run to the fence-revoking cancel", () => {
    expect(resolveCancelRoute(distributedRun, port)).toEqual({
      route: "distributed",
      jobId: JOB,
    });
  });

  it("routes a legacy run to the legacy writer — the common case", () => {
    expect(
      resolveCancelRoute({ executionOwner: null, distributedJobId: null }, port),
    ).toEqual({ route: "legacy" });
  });

  it("falls through to LEGACY when no port is registered, and says why", () => {
    // A control-plane restart with the distributed flag off leaves marked runs
    // behind and no port. Refusing to terminalize would strand them forever;
    // with the subsystem disabled no worker will ever terminalize that attempt,
    // so the legacy write is the only convergent outcome. Deliberately the
    // OPPOSITE direction from the seam's fail-safe: suppression must never
    // strand a run, cancel must never leave one unkillable.
    expect(resolveCancelRoute(distributedRun, undefined)).toEqual({
      route: "legacy",
      degraded: "no_distributed_cancellation_port",
    });
  });

  it("falls through to LEGACY when the marker is present but the job id is not", () => {
    // Nothing to revoke a fence against. A half-written marker must not make a
    // run unkillable.
    expect(
      resolveCancelRoute({ executionOwner: "distributed", distributedJobId: null }, port),
    ).toEqual({ route: "legacy", degraded: "missing_distributed_job_id" });
  });

  it("does NOT route on an unrecognised owner value", () => {
    // Forward-compat: a future owner kind this build does not understand must
    // read as legacy, not as distributed.
    expect(
      resolveCancelRoute({ executionOwner: "owner_desktop", distributedJobId: JOB }, port),
    ).toEqual({ route: "legacy" });
  });
});

describe("CLI-006/Task 4 — the module-level port", () => {
  it("is absent until registered", () => {
    expect(getDistributedCancellationPort()).toBeUndefined();
  });

  it("is readable from a caller holding no service instance at all", () => {
    // The whole point: every real cancelRun caller builds heartbeatService(db)
    // with no options, so the port must not travel through an instance.
    setDistributedCancellationPort(port);
    expect(getDistributedCancellationPort()).toBe(port);
  });

  it("can be cleared, so a test or a reload cannot leak one deployment's port", () => {
    setDistributedCancellationPort(port);
    setDistributedCancellationPort(undefined);
    expect(getDistributedCancellationPort()).toBeUndefined();
  });

  it("carries the graceful flag and the reason through to the fence revoke", async () => {
    const requestCancellation = vi.fn(async () => {});
    setDistributedCancellationPort({ requestCancellation });
    await getDistributedCancellationPort()!.requestCancellation({
      jobId: JOB,
      companyId: "c",
      organizationId: "o",
      reason: "Cancelled by control plane",
      graceful: true,
    });
    expect(requestCancellation).toHaveBeenCalledWith({
      jobId: JOB,
      companyId: "c",
      organizationId: "o",
      reason: "Cancelled by control plane",
      graceful: true,
    });
  });
});
