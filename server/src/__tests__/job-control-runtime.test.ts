import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const runtimeHarness = vi.hoisted(() => ({
  visited: [] as string[],
  claimInputs: [] as Array<Record<string, unknown>>,
  claims: new Map<string, Array<{
    id: string;
    organizationId: string;
    targetId: string;
    attemptId: string;
  }>>(),
  claimErrors: new Map<string, Error & { code?: string }>(),
  delivered: [] as string[],
  statementTimeouts: [] as number[],
  beforeTenant: null as null | ((organizationId: string) => Promise<void>),
  afterClaim: null as null | (() => Promise<void>),
  afterDelivery: null as null | (() => Promise<void>),
  activeTenants: 0,
  maxActiveTenants: 0,
}));

vi.mock("../db/tenant-context.js", () => ({
  runInTenant: async (
    _appDb: unknown,
    organizationId: string,
    fn: (repos: unknown) => Promise<unknown>,
  ) => {
    runtimeHarness.visited.push(organizationId);
    runtimeHarness.activeTenants += 1;
    runtimeHarness.maxActiveTenants = Math.max(
      runtimeHarness.maxActiveTenants,
      runtimeHarness.activeTenants,
    );
    try {
      await runtimeHarness.beforeTenant?.(organizationId);
      return await fn({
        jobControl: {
          currentDatabaseTime: async () => new Date("2026-08-10T12:00:00.000Z"),
          setLocalStatementTimeout: async (milliseconds: number) => {
            runtimeHarness.statementTimeouts.push(milliseconds);
          },
          claimReadyOutbox: async (input: Record<string, unknown>) => {
            runtimeHarness.claimInputs.push(input);
            const failure = runtimeHarness.claimErrors.get(organizationId);
            if (failure) throw failure;
            const rows = runtimeHarness.claims.get(organizationId) ?? [];
            await runtimeHarness.afterClaim?.();
            return rows;
          },
          deliverReadyOutbox: async (input: { ids: string[] }) => {
            runtimeHarness.delivered.push(...input.ids);
            await runtimeHarness.afterDelivery?.();
            return input.ids.length;
          },
        },
      });
    } finally {
      runtimeHarness.activeTenants -= 1;
    }
  },
}));

import { createJobOutboxWorker } from "../services/job-outbox-worker.js";
import { createJobReadyScheduler } from "../services/job-ready-scheduler.js";

function organizationId(ordinal: number): string {
  return `c3000000-0000-4000-8000-${ordinal.toString().padStart(12, "0")}`;
}

type ReadySignalScheduler = ReturnType<typeof createJobReadyScheduler> & {
  signal?: (input: { organizationId: string; targetId: string }) => boolean;
  consume?: (organizationId: string, targetId: string) => boolean;
  size(): { organizations: number; targets: number; signals: number };
};

function readySignalScheduler(input: Record<string, unknown> = {}): ReadySignalScheduler {
  return (createJobReadyScheduler as unknown as (
    input: Record<string, unknown>,
  ) => ReadySignalScheduler)(input);
}

describe("JOB-003 flag-on job-control runtime", () => {
  beforeEach(() => {
    runtimeHarness.visited.length = 0;
    runtimeHarness.claimInputs.length = 0;
    runtimeHarness.claims.clear();
    runtimeHarness.claimErrors.clear();
    runtimeHarness.delivered.length = 0;
    runtimeHarness.statementTimeouts.length = 0;
    runtimeHarness.beforeTenant = null;
    runtimeHarness.afterClaim = null;
    runtimeHarness.afterDelivery = null;
    runtimeHarness.activeTenants = 0;
    runtimeHarness.maxActiveTenants = 0;
  });

  it("stores only one coalesced exact-target readiness bit with deterministic monotonic expiry", () => {
    let nowMs = 0;
    const scheduler = readySignalScheduler({
      maxOrganizationShards: 2,
      maxTargetsPerOrganization: 2,
      maxSignalsGlobal: 3,
      signalTtlMs: 1_000,
      monotonicNow: () => nowMs,
    });
    expect.soft(typeof scheduler.signal).toBe("function");
    expect.soft(typeof scheduler.consume).toBe("function");
    if (!scheduler.signal || !scheduler.consume) return;

    const orgA = organizationId(1);
    const orgB = organizationId(2);
    const targetA = "c3100000-0000-4000-8000-000000000001";
    const targetB = "c3100000-0000-4000-8000-000000000002";
    const targetC = "c3100000-0000-4000-8000-000000000003";
    expect.soft(scheduler.signal({ organizationId: orgA, targetId: targetA })).toBe(true);
    expect.soft(scheduler.signal({ organizationId: orgA, targetId: targetA })).toBe(true);
    expect.soft(scheduler.signal({ organizationId: orgA, targetId: targetB })).toBe(true);
    expect.soft(scheduler.signal({ organizationId: orgB, targetId: targetC })).toBe(true);
    expect.soft(scheduler.size()).toEqual({ organizations: 2, targets: 3, signals: 3 });
    expect.soft(scheduler.signal({
      organizationId: orgB,
      targetId: "c3100000-0000-4000-8000-000000000004",
    })).toBe(false);
    expect.soft(scheduler.consume(orgB, targetA)).toBe(false);
    expect.soft(scheduler.consume(orgA, targetA)).toBe(true);
    expect.soft(scheduler.consume(orgA, targetA)).toBe(false);

    // A duplicate never extends expiry.
    nowMs = 999;
    expect.soft(scheduler.signal({ organizationId: orgA, targetId: targetB })).toBe(true);
    nowMs = 1_001;
    expect.soft(scheduler.consume(orgA, targetB)).toBe(false);
    expect.soft(scheduler.signal({ organizationId: orgA, targetId: targetA })).toBe(true);
  });

  it("pins scheduler defaults/hard ceilings and rejects non-finite, non-positive, and fractional configuration", () => {
    for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      expect(() => readySignalScheduler({ maxOrganizationShards: invalid })).toThrow();
      expect(() => readySignalScheduler({ maxTargetsPerOrganization: invalid })).toThrow();
      expect(() => readySignalScheduler({ maxSignalsGlobal: invalid })).toThrow();
      expect(() => readySignalScheduler({ signalTtlMs: invalid })).toThrow();
    }

    let nowMs = 0;
    const clamped = readySignalScheduler({
      maxOrganizationShards: 10_000,
      maxTargetsPerOrganization: 10_000,
      maxSignalsGlobal: 10_000,
      signalTtlMs: 10_000_000,
      monotonicNow: () => nowMs,
    });
    expect.soft(typeof clamped.signal).toBe("function");
    expect.soft(typeof clamped.consume).toBe("function");
    if (!clamped.signal || !clamped.consume) return;
    const org = organizationId(1);
    let accepted = 0;
    for (let index = 0; index < 1_025; index += 1) {
      if (clamped.signal({
        organizationId: org,
        targetId: `c3200000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
      })) accepted += 1;
    }
    expect.soft(accepted).toBe(1_024);
    expect.soft(clamped.size()).toEqual({ organizations: 1, targets: 1_024, signals: 1_024 });
    nowMs = 300_001;
    expect.soft(clamped.consume(org, "c3200000-0000-4000-8000-000000000000")).toBe(false);

    const defaults = readySignalScheduler();
    expect.soft(typeof defaults.signal).toBe("function");
    if (!defaults.signal) return;
    let defaultAccepted = 0;
    for (let orgIndex = 0; orgIndex < 9; orgIndex += 1) {
      for (let targetIndex = 0; targetIndex < 128; targetIndex += 1) {
        if (defaults.signal({
          organizationId: organizationId(orgIndex + 1),
          targetId: `c3300000-0000-4000-${orgIndex.toString().padStart(4, "0")}-${targetIndex.toString().padStart(12, "0")}`,
        })) defaultAccepted += 1;
      }
    }
    expect.soft(defaultAccepted).toBe(1_024);

    const organizationBound = readySignalScheduler();
    expect.soft(typeof organizationBound.signal).toBe("function");
    if (!organizationBound.signal) return;
    let organizationAccepted = 0;
    for (let index = 0; index < 33; index += 1) {
      if (organizationBound.signal({
        organizationId: organizationId(index + 1),
        targetId: `c3400000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
      })) organizationAccepted += 1;
    }
    expect.soft(organizationAccepted).toBe(32);
    expect.soft(organizationBound.size()).toEqual({ organizations: 32, targets: 32, signals: 32 });
  });

  it("reads at most tail plus bounded wrap and admits at most 32 distinct Organizations per tick", async () => {
    const admitted = Array.from({ length: 35 }, (_, index) => organizationId(index + 1));
    const queryInputs: Array<{ after: string | null; limit: number }> = [];
    const listPage = async (input: { after: string | null; limit: number }) => {
      queryInputs.push(input);
      const start = input.after === null
        ? 0
        : Math.max(0, admitted.findIndex((id) => id > input.after!));
      return admitted.slice(start, start + input.limit);
    };
    const scheduler = createJobReadyScheduler();
    const worker = createJobOutboxWorker({
      appDb: {} as never,
      scheduler,
      listAdmittedOrganizationIds: listPage,
      maxOrganizationShards: 32,
    });

    await worker.tick();
    const firstTickQueries = queryInputs.splice(0);
    expect.soft(firstTickQueries).toMatchObject([{ after: null, limit: 32 }]);
    expect.soft(runtimeHarness.visited).toEqual(admitted.slice(0, 32));
    runtimeHarness.visited.length = 0;
    await worker.tick();
    expect.soft(queryInputs).toMatchObject([
      { after: admitted[31], limit: 32 },
      { after: null, limit: 29 },
    ]);
    expect.soft(queryInputs).toHaveLength(2);
    expect.soft(runtimeHarness.visited).toEqual([...admitted.slice(32), ...admitted.slice(0, 29)]);
    expect.soft(new Set(runtimeHarness.visited).size).toBe(32);
  });

  it("preserves fair progress through membership churn and a runtime restart", async () => {
    const all = Array.from({ length: 34 }, (_, index) => organizationId(index + 1));
    let admitted = all;
    const scheduler = createJobReadyScheduler();
    const first = createJobOutboxWorker({
      appDb: {} as never,
      scheduler,
      listAdmittedOrganizationIds: async () => admitted,
      maxOrganizationShards: 32,
    });
    await first.tick();
    admitted = [...all.slice(1), organizationId(99)];
    await first.tick();
    const beforeRestart = new Set(runtimeHarness.visited);
    expect(beforeRestart).toContain(all[33]);
    expect(beforeRestart).toContain(organizationId(99));

    runtimeHarness.visited.length = 0;
    const restarted = createJobOutboxWorker({
      appDb: {} as never,
      scheduler: createJobReadyScheduler(),
      listAdmittedOrganizationIds: async () => admitted,
      maxOrganizationShards: 32,
    });
    await restarted.tick();
    await restarted.tick();
    expect(new Set(runtimeHarness.visited)).toEqual(new Set(admitted));
  });

  it("does not invent cursor progress when an admitted-Organization page read fails", async () => {
    const orgA = organizationId(1);
    const orgB = organizationId(2);
    const pageInputs: Array<{ after?: string | null; limit?: number }> = [];
    let fail = true;
    const worker = createJobOutboxWorker({
      appDb: {} as never,
      scheduler: createJobReadyScheduler(),
      maxOrganizationShards: 1,
      listAdmittedOrganizationIds: async (input) => {
        pageInputs.push(input);
        if (fail) throw new Error("admitted organization page failed");
        return [orgA, orgB];
      },
    });

    await expect(worker.tick()).rejects.toThrow("admitted organization page failed");
    fail = false;
    await expect(worker.tick()).resolves.toMatchObject({ organizations: 1 });
    expect.soft(pageInputs).toHaveLength(2);
    expect.soft(pageInputs.map((input) => input.after ?? null)).toEqual([null, null]);
    expect.soft(runtimeHarness.visited).toEqual([orgA]);
  });

  it("treats 750 ms as launch admission: page completion at the deadline launches no shard", async () => {
    const org = organizationId(1);
    let monotonicMs = 0;
    const pageInputs: Array<{ statementTimeoutMs?: number }> = [];
    const worker = createJobOutboxWorker({
      appDb: {} as never,
      scheduler: createJobReadyScheduler(),
      listAdmittedOrganizationIds: async (input) => {
        pageInputs.push(input);
        monotonicMs = 750;
        return [org];
      },
      tickBudgetMs: 750,
      monotonicNow: () => monotonicMs,
    } as never);

    await expect(worker.tick()).resolves.toMatchObject({ organizations: 0, claimed: 0, delivered: 0 });
    expect.soft(pageInputs).toHaveLength(1);
    expect.soft(pageInputs[0]?.statementTimeoutMs).toBe(750);
    expect.soft(runtimeHarness.visited).toEqual([]);
  });

  it("launches no publisher or delivery after an admitted claim finishes beyond the window", async () => {
    const org = organizationId(1);
    const target = "c3100000-0000-4000-8000-000000000001";
    runtimeHarness.claims.set(org, [{ id: "late-claim", organizationId: org, targetId: target, attemptId: "attempt-a" }]);
    let monotonicMs = 0;
    runtimeHarness.afterClaim = async () => { monotonicMs = 800; };
    const publications: unknown[] = [];
    const worker = createJobOutboxWorker({
      appDb: {} as never,
      scheduler: createJobReadyScheduler(),
      listAdmittedOrganizationIds: async () => [org],
      publishHint: async (signal) => { publications.push(signal); },
      tickBudgetMs: 750,
      monotonicNow: () => monotonicMs,
    } as never);

    await worker.tick();
    expect.soft(publications).toEqual([]);
    expect.soft(runtimeHarness.delivered).toEqual([]);
    expect.soft(runtimeHarness.statementTimeouts).toEqual([750]);
  });

  it("checks launch admission before every signal publication and launches no delivery after publisher k", async () => {
    const org = organizationId(1);
    const target = "c3100000-0000-4000-8000-000000000001";
    runtimeHarness.claims.set(org, [
      { id: "publish-a", organizationId: org, targetId: target, attemptId: "attempt-a" },
      { id: "publish-b", organizationId: org, targetId: target, attemptId: "attempt-b" },
    ]);
    let monotonicMs = 0;
    const publications: unknown[] = [];
    const worker = createJobOutboxWorker({
      appDb: {} as never,
      scheduler: createJobReadyScheduler(),
      listAdmittedOrganizationIds: async () => [org],
      publishHint: async (signal) => {
        publications.push(signal);
        monotonicMs = 750;
      },
      tickBudgetMs: 750,
      monotonicNow: () => monotonicMs,
    } as never);

    await worker.tick();
    expect.soft(publications).toHaveLength(1);
    expect.soft(runtimeHarness.delivered).toEqual([]);
  });

  it("awaits an already admitted delivery even when it completes after 750 ms", async () => {
    const org = organizationId(1);
    const target = "c3100000-0000-4000-8000-000000000001";
    runtimeHarness.claims.set(org, [{ id: "deliver-a", organizationId: org, targetId: target, attemptId: "attempt-a" }]);
    let monotonicMs = 0;
    runtimeHarness.afterDelivery = async () => { monotonicMs = 1_200; };
    const worker = createJobOutboxWorker({
      appDb: {} as never,
      scheduler: createJobReadyScheduler(),
      listAdmittedOrganizationIds: async () => [org],
      publishHint: async () => { monotonicMs = 749; },
      tickBudgetMs: 750,
      monotonicNow: () => monotonicMs,
    } as never);

    await expect(worker.tick()).resolves.toMatchObject({ claimed: 1, delivered: 1 });
    expect.soft(monotonicMs).toBe(1_200);
    expect.soft(runtimeHarness.statementTimeouts).toEqual([750, 1]);
  });

  it("does not overlap a slow shard tick and resumes at the next cursor", async () => {
    const orgs = [organizationId(1), organizationId(2)];
    let enteredFirst!: () => void;
    const firstEntered = new Promise<void>((resolve) => { enteredFirst = resolve; });
    let releaseFirst!: () => void;
    const release = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let calls = 0;
    runtimeHarness.beforeTenant = async () => {
      calls += 1;
      if (calls === 1) {
        enteredFirst();
        await release;
      }
    };
    const worker = createJobOutboxWorker({
      appDb: {} as never,
      scheduler: createJobReadyScheduler(),
      listAdmittedOrganizationIds: async () => orgs,
      maxOrganizationShards: 1,
    });

    const first = worker.tick();
    await firstEntered;
    const overlapping = worker.tick();
    await Promise.resolve();
    expect.soft(runtimeHarness.maxActiveTenants).toBe(1);
    releaseFirst();
    await Promise.all([first, overlapping]);
    await worker.tick();
    expect.soft(runtimeHarness.visited).toEqual([orgs[0], orgs[1]]);
  });

  it("advances fair rotation after rejected publication while leaving the claimed row retryable", async () => {
    const orgA = organizationId(1);
    const orgB = organizationId(2);
    const targetA = "c3100000-0000-4000-8000-000000000001";
    runtimeHarness.claims.set(orgA, [{
      id: "ready-a",
      organizationId: orgA,
      targetId: targetA,
      attemptId: "attempt-a",
    }]);
    let reject = true;
    const worker = createJobOutboxWorker({
      appDb: {} as never,
      scheduler: createJobReadyScheduler(),
      listAdmittedOrganizationIds: async () => [orgA, orgB],
      maxOrganizationShards: 1,
      publishHint: async (hint) => {
        if (reject) throw new Error("publish rejected");
        expect(Object.keys(hint).sort()).toEqual(["organizationId", "targetId"]);
      },
    });

    await expect(worker.tick()).rejects.toThrow("publish rejected");
    expect.soft(runtimeHarness.delivered).toEqual([]);
    reject = false;
    runtimeHarness.visited.length = 0;
    await expect(worker.tick()).resolves.toMatchObject({ claimed: 0, delivered: 0 });
    expect.soft(runtimeHarness.visited).toEqual([orgB]);
    runtimeHarness.visited.length = 0;
    await expect(worker.tick()).resolves.toMatchObject({ delivered: 1 });
    expect.soft(runtimeHarness.visited).toEqual([orgA]);
    expect(runtimeHarness.delivered).toEqual(["ready-a"]);
  });

  it("coalesces attempt-aware outbox rows into one two-field exact-target signal", async () => {
    const orgA = organizationId(1);
    const orgB = organizationId(2);
    const targetA = "c3100000-0000-4000-8000-000000000001";
    runtimeHarness.claims.set(orgA, [
      { id: "ready-a1", organizationId: orgA, targetId: targetA, attemptId: "attempt-a1" },
      { id: "ready-a2", organizationId: orgA, targetId: targetA, attemptId: "attempt-a2" },
    ]);
    const scheduler = readySignalScheduler();
    expect.soft(typeof scheduler.signal).toBe("function");
    expect.soft(typeof scheduler.consume).toBe("function");
    if (!scheduler.signal || !scheduler.consume) return;
    const publications: unknown[] = [];
    const worker = createJobOutboxWorker({
      appDb: {} as never,
      scheduler,
      listAdmittedOrganizationIds: async () => [orgA],
      publishHint: async (signal) => {
        publications.push(signal);
        expect.soft(Object.keys(signal).sort()).toEqual(["organizationId", "targetId"]);
        expect.soft(scheduler.signal!(signal)).toBe(true);
      },
    });

    await expect(worker.tick()).resolves.toMatchObject({ claimed: 2, delivered: 2 });
    expect.soft(publications).toHaveLength(2);
    expect.soft(scheduler.size()).toEqual({ organizations: 1, targets: 1, signals: 1 });
    expect.soft(scheduler.consume(orgB, targetA)).toBe(false);
    expect.soft(scheduler.consume(orgA, targetA)).toBe(true);
    expect.soft(scheduler.consume(orgA, targetA)).toBe(false);
  });

  it("leaves a live-cap signal rejection durable and never evicts an existing target", async () => {
    const orgA = organizationId(1);
    const orgB = organizationId(2);
    const targetA = "c3100000-0000-4000-8000-000000000001";
    const targetB = "c3100000-0000-4000-8000-000000000002";
    const scheduler = readySignalScheduler({ maxOrganizationShards: 1 });
    expect.soft(typeof scheduler.signal).toBe("function");
    expect.soft(typeof scheduler.consume).toBe("function");
    if (!scheduler.signal || !scheduler.consume) return;
    expect(scheduler.signal({ organizationId: orgB, targetId: targetB })).toBe(true);
    runtimeHarness.claims.set(orgA, [{
      id: "ready-a",
      organizationId: orgA,
      targetId: targetA,
      attemptId: "attempt-a",
    }]);
    const worker = createJobOutboxWorker({
      appDb: {} as never,
      scheduler,
      listAdmittedOrganizationIds: async () => [orgA],
    });

    await expect(worker.tick()).rejects.toThrow("job_ready_scheduler_full");
    expect(runtimeHarness.delivered).not.toContain("ready-a");
    expect.soft(scheduler.consume(orgB, targetB)).toBe(true);
    expect.soft(scheduler.consume(orgA, targetA)).toBe(false);
  });

  it("advances past a statement-timeout shard and resumes without overlapping ticks", async () => {
    const orgA = organizationId(1);
    const orgB = organizationId(2);
    const timeout = Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
    runtimeHarness.claimErrors.set(orgA, timeout);
    const worker = createJobOutboxWorker({
      appDb: {} as never,
      scheduler: createJobReadyScheduler(),
      listAdmittedOrganizationIds: async () => [orgA, orgB],
      maxOrganizationShards: 1,
    });

    await expect(worker.tick()).resolves.toMatchObject({ organizations: 1, claimed: 0, delivered: 0 });
    runtimeHarness.claimErrors.delete(orgA);
    runtimeHarness.visited.length = 0;
    await worker.tick();
    expect.soft(runtimeHarness.visited).toEqual([orgB]);
  });

  it("composes and stops the runtime only inside the distributed-execution flag", () => {
    const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
    const shutdownSource = readFileSync(new URL("../services/server-shutdown.ts", import.meta.url), "utf8");
    const flagIndex = indexSource.indexOf("config.distributedExecutionEnabled");
    const schedulerIndex = indexSource.indexOf("createJobReadyScheduler");
    const outboxIndex = indexSource.indexOf("createJobOutboxWorker");

    expect(flagIndex).toBeGreaterThanOrEqual(0);
    expect(schedulerIndex).toBeGreaterThan(flagIndex);
    expect(outboxIndex).toBeGreaterThan(flagIndex);
    expect(indexSource).toContain("listAdmittedOrganizationIds");
    expect(indexSource).toMatch(/listAdmittedOrganizationIds[\s\S]*?\.limit\(/);
    expect(indexSource).toContain("eq(organizations.status, \"active\")");
    expect(indexSource).toContain("ne(organizations.id, \"00000000-0000-0000-0000-000000000001\")");
    expect(indexSource).toContain("eq(companies.organizationId, organizations.id)");
    expect(indexSource).toContain("jobReadyScheduler: scheduler");
    const appSource = readFileSync(new URL("../app.ts", import.meta.url), "utf8");
    const workerRoutesSource = readFileSync(new URL("../routes/worker-control.ts", import.meta.url), "utf8");
    expect(appSource).toContain("jobReadyScheduler?: JobReadyScheduler");
    expect(appSource).toContain("jobReadyScheduler: opts.jobReadyScheduler");
    expect(workerRoutesSource).toContain("scheduler: opts.jobReadyScheduler");
    expect(indexSource).toContain("jobControlRuntime.stop");
    expect(shutdownSource.indexOf("jobControlRuntime.stop")).toBeLessThan(
      shutdownSource.indexOf("boundedDatabases.close"),
    );
  });
});
