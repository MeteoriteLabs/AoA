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

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dispatchCancel,
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
      reason: "Cancelled by control plane",
      graceful: true,
    });
    expect(requestCancellation).toHaveBeenCalledWith({
      jobId: JOB,
      companyId: "c",
      reason: "Cancelled by control plane",
      graceful: true,
    });
  });
});

// -- 4-D1: a THROWING port is not the same failure as a MISSING one -----------
//
// A missing port falls through to the legacy write, because with the subsystem
// disabled no worker will ever terminalize that attempt. That reasoning does NOT
// transfer to a port that throws: there the subsystem is ENABLED and the worker
// is LIVE, so writing `cancelled` locally would claim a stop that did not happen,
// latch the run, and make the projector discard the attempt's real terminal. The
// run would read cancelled in the UI while the sandbox kept burning budget.

const RUN_CTX = { companyId: "c", reason: "stop", graceful: true };

describe("CLI-006/4-D1 — dispatchCancel", () => {
  it("tells a legacy run's caller to write the terminal itself", async () => {
    await expect(
      dispatchCancel({
        run: { executionOwner: null, distributedJobId: null },
        ...RUN_CTX,
        port,
        onError: "propagate",
      }),
    ).resolves.toEqual({ writeLegacyTerminal: true });
  });

  it("revokes the fence and tells the caller NOT to write a terminal", async () => {
    const requestCancellation = vi.fn(async () => {});
    await expect(
      dispatchCancel({ run: distributedRun, ...RUN_CTX, port: { requestCancellation }, onError: "propagate" }),
    ).resolves.toEqual({ writeLegacyTerminal: false });
    expect(requestCancellation).toHaveBeenCalledWith({
      jobId: JOB,
      companyId: "c",
      reason: "stop",
      graceful: true,
    });
  });

  it("falls through to the legacy write when no port is registered", async () => {
    await expect(
      dispatchCancel({ run: distributedRun, ...RUN_CTX, port: undefined, onError: "propagate" }),
    ).resolves.toEqual({ writeLegacyTerminal: true, degraded: "no_distributed_cancellation_port" });
  });

  it("PROPAGATES a port throw for cancelRun — an operator must not see a false success", async () => {
    const boom = { requestCancellation: async () => { throw new Error("unreachable"); } };
    await expect(
      dispatchCancel({ run: distributedRun, ...RUN_CTX, port: boom, onError: "propagate" }),
    ).rejects.toThrow(/unreachable/);
  });

  it("SKIPS a port throw for a batch, and still writes NO terminal", async () => {
    // One unreachable attempt must not abort a company-wide budget hard-stop for
    // every other run. But the skipped run must stay `running`, not be latched
    // cancelled — the worker is still live.
    const boom = { requestCancellation: async () => { throw new Error("unreachable"); } };
    await expect(
      dispatchCancel({ run: distributedRun, ...RUN_CTX, port: boom, onError: "skip" }),
    ).resolves.toEqual({ writeLegacyTerminal: false, degraded: "cancellation_request_failed" });
  });

  it("never writes a terminal on a throw, under EITHER error mode", async () => {
    // The single property that matters most in this file: a live worker plus a
    // locally-latched `cancelled` is the one outcome that silently lies.
    const boom = { requestCancellation: async () => { throw new Error("unreachable"); } };
    const skipped = await dispatchCancel({ run: distributedRun, ...RUN_CTX, port: boom, onError: "skip" });
    expect(skipped.writeLegacyTerminal).toBe(false);
    await expect(
      dispatchCancel({ run: distributedRun, ...RUN_CTX, port: boom, onError: "propagate" }),
    ).rejects.toThrow();
  });
});

// -- the wiring, asserted structurally -------------------------------------------
//
// The five writers live inside a service closure and inside a database
// transaction, so neither is reachable from an in-process unit test. What CAN be
// proven — and mutation-proven — is that each writer actually consults the
// routing, and that the bulk SQL carries its exclusion predicate. Per the CLI-002
// lesson: a mocked DB never executes a WHERE, so assert the predicate's presence
// rather than pretending to exercise it.

const src = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("CLI-006/Task 4 — every heartbeat cancel writer consults the routing", () => {
  const heartbeat = src("../services/heartbeat.ts");

  it("routes all FOUR writers", () => {
    // cancelRun, cancelActiveForAgent, and both cancelBudgetScopeWork scopes.
    const calls = heartbeat.match(/routeRunCancellation\(run,/g) ?? [];
    expect(calls).toHaveLength(4);
  });

  it("propagates for cancelRun and skips for the three batch writers", () => {
    expect(heartbeat).toContain('onError: "propagate"');
    expect((heartbeat.match(/onError: "skip"/g) ?? []).length).toBe(3);
  });

  it("reads the port from module scope, never from a service option", () => {
    // A constructor option would be undefined at every real cancel — the three
    // callers all hold a bare heartbeatService(db).
    expect(heartbeat).toContain("port: getDistributedCancellationPort()");
    expect(heartbeat).not.toMatch(/distributedCancellation\??\.\s*requestCancellation/);
  });
});

describe("CLI-006/4-D2 — the bulk writer excludes distributed runs in SQL", () => {
  const issues = src("../services/issues.ts");

  it("carries the exclusion predicate on the bulk terminal update", () => {
    // This update bypasses setRunStatus entirely, so the CLI-006 terminal latch
    // does not protect it. Without this predicate a distributed-owned run is
    // latched `cancelled` and the projector discards the attempt's real terminal.
    expect(issues).toContain(
      'or(isNull(heartbeatRuns.executionOwner), ne(heartbeatRuns.executionOwner, "distributed"))',
    );
  });

  it("routes the distributed subset after the transaction, at BOTH call sites", () => {
    const calls = issues.match(/routeDistributedCancelsForRuns\(db, runsToTerminate/g) ?? [];
    expect(calls).toHaveLength(2);
  });

  it("routes AFTER terminateTrackedRuns, not inside the transaction", () => {
    // requestCancellation goes through runInTenant on a different pool and must
    // not be entangled with this transaction's lifetime.
    const lines = issues.split(/\r?\n/);
    const terminate = lines.findIndex((l) => l.includes("terminateTrackedRuns(runsToTerminate);"));
    const route = lines.findIndex((l) => l.includes("routeDistributedCancelsForRuns(db, runsToTerminate"));
    expect(terminate).toBeGreaterThan(-1);
    expect(route).toBeGreaterThan(terminate);
  });
});
