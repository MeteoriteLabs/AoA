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
  delivered: [] as string[],
  statementTimeouts: [] as number[],
  beforeTenant: null as null | ((organizationId: string) => Promise<void>),
  afterClaim: null as null | (() => Promise<void>),
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
            const rows = runtimeHarness.claims.get(organizationId) ?? [];
            await runtimeHarness.afterClaim?.();
            return rows;
          },
          deliverReadyOutbox: async (input: { ids: string[] }) => {
            runtimeHarness.delivered.push(...input.ids);
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

describe("JOB-003 flag-on job-control runtime", () => {
  beforeEach(() => {
    runtimeHarness.visited.length = 0;
    runtimeHarness.claimInputs.length = 0;
    runtimeHarness.claims.clear();
    runtimeHarness.delivered.length = 0;
    runtimeHarness.statementTimeouts.length = 0;
    runtimeHarness.beforeTenant = null;
    runtimeHarness.afterClaim = null;
    runtimeHarness.activeTenants = 0;
    runtimeHarness.maxActiveTenants = 0;
  });

  it("bounds aggregate and target-cardinality hints and expires stale target churn deterministically", () => {
    let nowMs = 0;
    const scheduler = (createJobReadyScheduler as unknown as (input: {
      maxOrganizationShards: number;
      maxHintsPerShard: number;
      maxHintsPerOrganization: number;
      maxTargetsPerOrganization: number;
      maxHintsGlobal: number;
      hintTtlMs: number;
      now: () => number;
    }) => ReturnType<typeof createJobReadyScheduler>)({
      maxOrganizationShards: 1,
      maxHintsPerShard: 2,
      maxHintsPerOrganization: 8,
      maxTargetsPerOrganization: 8,
      maxHintsGlobal: 8,
      hintTtlMs: 1_000,
      now: () => nowMs,
    });
    const org = organizationId(1);
    let accepted = 0;
    for (let index = 0; index < 1_000; index += 1) {
      if (scheduler.hint({
        organizationId: org,
        targetId: `c3100000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
        attemptId: `attempt-${index}`,
      })) accepted += 1;
    }

    const boundedSize = scheduler.size() as unknown as {
      organizations: number;
      targets: number;
      hints: number;
    };
    expect.soft(accepted).toBe(8);
    expect.soft(boundedSize).toEqual({ organizations: 1, targets: 8, hints: 8 });
    expect.soft(scheduler.hint({
      organizationId: org,
      targetId: "c3100000-0000-4000-8000-000000000000",
      attemptId: "attempt-0",
    })).toBe(true);
    expect.soft(scheduler.size()).toEqual({ organizations: 1, targets: 8, hints: 8 });

    // Offline, revoked, and churned targets are not authority and may never pin
    // memory forever. Once their deterministic TTL elapses, a new target can
    // enter without losing correctness because PostgreSQL pull remains truth.
    nowMs = 1_001;
    const replacement = {
      organizationId: org,
      targetId: "c3100000-0000-4000-8000-999999999999",
      attemptId: "replacement-attempt",
    };
    expect.soft(scheduler.hint(replacement)).toBe(true);
    expect.soft(scheduler.take(org, "c3100000-0000-4000-8000-000000000000")).toEqual([]);
    expect.soft(scheduler.take(org, replacement.targetId)).toEqual([replacement.attemptId]);

    let globalNowMs = 0;
    const global = (createJobReadyScheduler as unknown as (input: {
      maxOrganizationShards: number;
      maxHintsPerShard: number;
      maxHintsPerOrganization: number;
      maxTargetsPerOrganization: number;
      maxHintsGlobal: number;
      hintTtlMs: number;
      now: () => number;
    }) => ReturnType<typeof createJobReadyScheduler>)({
      maxOrganizationShards: 4,
      maxHintsPerShard: 2,
      maxHintsPerOrganization: 4,
      maxTargetsPerOrganization: 4,
      maxHintsGlobal: 6,
      hintTtlMs: 1_000,
      now: () => globalNowMs,
    });
    let globalAccepted = 0;
    for (const organization of [organizationId(1), organizationId(2)]) {
      for (let index = 0; index < 4; index += 1) {
        if (global.hint({
          organizationId: organization,
          targetId: `c3200000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
          attemptId: `${organization}-global-${index}`,
        })) globalAccepted += 1;
      }
    }
    expect.soft(globalAccepted).toBe(6);
    expect.soft(global.size()).toEqual({ organizations: 2, targets: 6, hints: 6 });
    globalNowMs += 1_001;
    expect.soft(global.hint({
      organizationId: organizationId(2),
      targetId: "c3200000-0000-4000-8000-999999999999",
      attemptId: "global-after-ttl",
    })).toBe(true);

    const fifo = createJobReadyScheduler({ maxHintsPerShard: 3 });
    for (const attemptId of ["fifo-1", "fifo-2", "fifo-3"]) {
      expect(fifo.hint({ organizationId: org, targetId: replacement.targetId, attemptId })).toBe(true);
    }
    expect(fifo.take(org, replacement.targetId, 2)).toEqual(["fifo-1", "fifo-2"]);
  });

  it("visits admitted Organizations in stable lexical windows and reaches the tail beyond 32", async () => {
    const admitted = Array.from({ length: 35 }, (_, index) => organizationId(index + 1)).reverse();
    const scheduler = createJobReadyScheduler();
    const worker = createJobOutboxWorker({
      appDb: {} as never,
      scheduler,
      listAdmittedOrganizationIds: async () => admitted,
      maxOrganizationShards: 32,
    });

    await worker.tick();
    await worker.tick();

    expect(runtimeHarness.visited.slice(0, 32)).toEqual([...admitted].sort().slice(0, 32));
    expect(new Set(runtimeHarness.visited)).toEqual(new Set(admitted));
    expect(runtimeHarness.visited.slice(32)).toEqual([...admitted].sort().slice(32));
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

  it("pages admitted Organizations in bounded keyset reads and enforces a real tick budget", async () => {
    const activeMapped = Array.from({ length: 40 }, (_, index) => organizationId(index + 1));
    const queryInputs: Array<{ after: string | null; limit: number } | undefined> = [];
    let monotonicMs = 0;
    runtimeHarness.afterClaim = async () => {
      monotonicMs += 400;
    };
    const listPage = async (input?: { after: string | null; limit: number }) => {
      queryInputs.push(input);
      const start = input?.after
        ? Math.max(0, activeMapped.findIndex((id) => id > input.after!))
        : 0;
      return activeMapped.slice(start, start + (input?.limit ?? activeMapped.length));
    };
    const worker = (createJobOutboxWorker as unknown as (input: {
      appDb: never;
      scheduler: ReturnType<typeof createJobReadyScheduler>;
      listAdmittedOrganizationIds: typeof listPage;
      maxOrganizationShards: number;
      tickBudgetMs: number;
      monotonicNow: () => number;
    }) => ReturnType<typeof createJobOutboxWorker>)({
      appDb: {} as never,
      scheduler: createJobReadyScheduler(),
      listAdmittedOrganizationIds: listPage,
      maxOrganizationShards: 32,
      tickBudgetMs: 750,
      monotonicNow: () => monotonicMs,
    });

    await worker.tick();
    expect.soft(runtimeHarness.visited).toEqual(activeMapped.slice(0, 2));
    expect.soft(queryInputs.length).toBeLessThanOrEqual(2);
    expect.soft(queryInputs.every((entry) => entry !== undefined && entry.limit <= 32)).toBe(true);
    expect.soft(runtimeHarness.statementTimeouts).toEqual([750, 350]);

    await worker.tick();
    expect.soft(runtimeHarness.visited.slice(2)).toEqual(activeMapped.slice(2, 4));
    expect.soft(queryInputs.length).toBeLessThanOrEqual(4);
    for (let tick = 2; tick < 20; tick += 1) await worker.tick();
    expect.soft(new Set(runtimeHarness.visited)).toEqual(new Set(activeMapped));
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

  it("replays a rejected publication and keeps hints isolated to one logical Organization", async () => {
    const orgA = organizationId(1);
    const orgB = organizationId(2);
    const targetA = "c3100000-0000-4000-8000-000000000001";
    runtimeHarness.claims.set(orgA, [{
      id: "ready-a",
      organizationId: orgA,
      targetId: targetA,
      attemptId: "attempt-a",
    }]);
    const scheduler = createJobReadyScheduler();
    let reject = true;
    const worker = createJobOutboxWorker({
      appDb: {} as never,
      scheduler,
      listAdmittedOrganizationIds: async () => [orgA, orgB],
      publishHint: async (hint) => {
        if (reject) throw new Error("publish rejected");
        scheduler.hint(hint);
      },
    });

    await expect(worker.tick()).rejects.toThrow("publish rejected");
    reject = false;
    await expect(worker.tick()).resolves.toMatchObject({ delivered: 1 });
    const exactScheduler = scheduler as unknown as {
      take(organizationId: string, targetId: string): string[];
    };
    expect(exactScheduler.take(orgB, targetA)).toEqual([]);
    expect(exactScheduler.take(orgA, targetA)).toEqual(["attempt-a"]);
    expect(runtimeHarness.delivered).toEqual(["ready-a"]);
  });

  it("keeps hints target-scoped and leaves a full scheduler publication retryable", async () => {
    const orgA = organizationId(1);
    const orgB = organizationId(2);
    const targetA = "c3100000-0000-4000-8000-000000000001";
    const targetB = "c3100000-0000-4000-8000-000000000002";
    const scheduler = createJobReadyScheduler({ maxOrganizationShards: 1 });
    const exactScheduler = scheduler as unknown as {
      hint(hint: { organizationId: string; targetId: string; attemptId: string }): boolean;
      take(organizationId: string, targetId: string): string[];
    };
    expect(exactScheduler.hint({ organizationId: orgB, targetId: targetB, attemptId: "attempt-b" })).toBe(true);
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
    expect(exactScheduler.take(orgB, targetB)).toEqual(["attempt-b"]);
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
