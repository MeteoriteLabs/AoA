import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

type JobControlMetrics = {
  certificateScan(value: Record<string, unknown>): void;
  certificateUpsert(value: Record<string, unknown>): void;
  certificateCleanup(value: Record<string, unknown>): void;
  headRestart(): void;
  schedulerCapacityReject(value: Record<string, unknown>): void;
  schedulerExpiry(value: Record<string, unknown>): void;
  schedulerCardinality(value: Record<string, unknown>): void;
  outboxTick(value: Record<string, unknown>): void;
};

type MetricsModule = {
  NOOP_JOB_CONTROL_METRICS: JobControlMetrics;
  createPinoJobControlMetrics(log: { info(...args: unknown[]): void }): JobControlMetrics;
};

async function loadMetricsModule(): Promise<MetricsModule | null> {
  const moduleSpecifier: string = "../services/job-control-metrics.js";
  try {
    return await import(moduleSpecifier) as MetricsModule;
  } catch {
    return null;
  }
}

describe("JOB-003 closed payload-free metrics", () => {
  it("emits the eight exact event names with only their closed hand-derived fields", async () => {
    // Mutation caught: adding arbitrary labels/payloads or inferring counts in the adapter makes
    // a domain canary observable even though the service result is otherwise unchanged.
    const loaded = await loadMetricsModule();
    expect(loaded).not.toBeNull();
    if (!loaded) return;
    const records: unknown[][] = [];
    const metrics = loaded.createPinoJobControlMetrics({
      info: (...args) => { records.push(args); },
    });
    const forbidden = "JOB003_SECRET_URL_worker_attempt_hash_reason_sql";

    metrics.certificateScan({
      hitsObserved: 3,
      hitsSaturated: false,
      missesObserved: 5,
      missesSaturated: true,
      scanExhausted: true,
      cardinalityObserved: 7,
      cardinalitySaturated: false,
      organizationId: forbidden,
    });
    metrics.certificateUpsert({ count: 11, input: forbidden });
    metrics.certificateCleanup({
      count: 13,
      cardinalityObserved: 17,
      cardinalitySaturated: true,
      reason: forbidden,
    });
    metrics.headRestart();
    metrics.schedulerCapacityReject({ scope: "target", targetId: forbidden });
    metrics.schedulerExpiry({ count: 19, error: forbidden });
    metrics.schedulerCardinality({ organizations: 2, targets: 23, signals: 29, sql: forbidden });
    metrics.outboxTick({
      budgetMs: 600,
      elapsedMs: 650,
      overshootMs: 50,
      organizations: 3,
      claimed: 31,
      delivered: 37,
      cleaned: 41,
      credential: forbidden,
    });

    expect(records).toEqual([
      [{ event: "job_control.certificate_scan", hitsObserved: 3, hitsSaturated: false,
        missesObserved: 5, missesSaturated: true, scanExhausted: true,
        cardinalityObserved: 7, cardinalitySaturated: false }],
      [{ event: "job_control.certificate_upsert", count: 11 }],
      [{ event: "job_control.certificate_cleanup", count: 13,
        cardinalityObserved: 17, cardinalitySaturated: true }],
      [{ event: "job_control.head_restart" }],
      [{ event: "job_control.scheduler_capacity_reject", scope: "target" }],
      [{ event: "job_control.scheduler_expiry", count: 19 }],
      [{ event: "job_control.scheduler_cardinality", organizations: 2, targets: 23, signals: 29 }],
      [{ event: "job_control.outbox_tick", budgetMs: 600, elapsedMs: 650, overshootMs: 50,
        organizations: 3, claimed: 31, delivered: 37, cleaned: 41 }],
    ]);
    expect(JSON.stringify(records)).not.toContain(forbidden);
  });

  it("freezes the no-op singleton and isolates every logger failure from control flow", async () => {
    const loaded = await loadMetricsModule();
    expect(loaded).not.toBeNull();
    if (!loaded) return;
    expect(Object.isFrozen(loaded.NOOP_JOB_CONTROL_METRICS)).toBe(true);
    for (const method of Object.values(loaded.NOOP_JOB_CONTROL_METRICS)) {
      expect(() => (method as (value?: unknown) => void)({ count: 1 })).not.toThrow();
    }

    const metrics = loaded.createPinoJobControlMetrics({ info: vi.fn(() => {
      throw new Error("logger unavailable");
    }) });
    expect(() => metrics.certificateUpsert({ count: 1 })).not.toThrow();
    expect(() => metrics.headRestart()).not.toThrow();
    expect(() => metrics.outboxTick({ budgetMs: 1, elapsedMs: 1, overshootMs: 0,
      organizations: 0, claimed: 0, delivered: 0, cleaned: 0 })).not.toThrow();
  });

  it("keeps the metrics implementation free of open payload and identity vocabulary", async () => {
    const sourceUrl = new URL("../services/job-control-metrics.ts", import.meta.url);
    let source: string | null = null;
    try { source = readFileSync(sourceUrl, "utf8"); } catch { /* assertion below owns RED */ }
    expect(source).not.toBeNull();
    if (source === null) return;
    for (const forbidden of [
      "organizationId", "companyId", "workerId", "targetId", "jobId", "attemptId",
      "leaseId", "hash", "reason", "error", "stack", "sql", "credential", "url", "input",
    ]) {
      expect(source).not.toMatch(new RegExp(`\\b${forbidden}\\b`, "i"));
    }
  });
});
