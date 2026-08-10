import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const runtimeHarness = vi.hoisted(() => ({
  visited: [] as string[],
  claims: new Map<string, Array<{
    id: string;
    organizationId: string;
    targetId: string;
    attemptId: string;
  }>>(),
  delivered: [] as string[],
}));

vi.mock("../db/tenant-context.js", () => ({
  runInTenant: async (
    _appDb: unknown,
    organizationId: string,
    fn: (repos: unknown) => Promise<unknown>,
  ) => {
    runtimeHarness.visited.push(organizationId);
    return fn({
      jobControl: {
        currentDatabaseTime: async () => new Date("2026-08-10T12:00:00.000Z"),
        claimReadyOutbox: async () => runtimeHarness.claims.get(organizationId) ?? [],
        deliverReadyOutbox: async (input: { ids: string[] }) => {
          runtimeHarness.delivered.push(...input.ids);
          return input.ids.length;
        },
      },
    });
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
    runtimeHarness.claims.clear();
    runtimeHarness.delivered.length = 0;
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
