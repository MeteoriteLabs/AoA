import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

type CertificateScanMetrics = Readonly<{
  hitsObserved: number;
  hitsSaturated: boolean;
  missesObserved: number;
  missesSaturated: boolean;
  scanExhausted: boolean;
  cardinalityObserved: number;
  cardinalitySaturated: boolean;
}>;
type CertificateUpsertMetrics = Readonly<{ count: number }>;
type CertificateCleanupMetrics = Readonly<{
  count: number;
  cardinalityObserved: number;
  cardinalitySaturated: boolean;
}>;
type SchedulerCapacityRejectMetrics = Readonly<{ scope: "organization" | "target" | "global" }>;
type SchedulerExpiryMetrics = Readonly<{ count: number }>;
type SchedulerCardinalityMetrics = Readonly<{ organizations: number; targets: number; signals: number }>;
type OutboxTickMetrics = Readonly<{
  budgetMs: number;
  elapsedMs: number;
  overshootMs: number;
  organizations: number;
  claimed: number;
  delivered: number;
  cleaned: number;
}>;

type JobControlMetrics = {
  certificateScan(value: CertificateScanMetrics): void;
  certificateUpsert(value: CertificateUpsertMetrics): void;
  certificateCleanup(value: CertificateCleanupMetrics): void;
  headRestart(): void;
  schedulerCapacityReject(value: SchedulerCapacityRejectMetrics): void;
  schedulerExpiry(value: SchedulerExpiryMetrics): void;
  schedulerCardinality(value: SchedulerCardinalityMetrics): void;
  outboxTick(value: OutboxTickMetrics): void;
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
    } as CertificateScanMetrics);
    metrics.certificateUpsert({ count: 11, input: forbidden } as CertificateUpsertMetrics);
    metrics.certificateCleanup({
      count: 13,
      cardinalityObserved: 17,
      cardinalitySaturated: true,
      reason: forbidden,
    } as CertificateCleanupMetrics);
    metrics.headRestart();
    metrics.schedulerCapacityReject({ scope: "target", targetId: forbidden } as SchedulerCapacityRejectMetrics);
    metrics.schedulerExpiry({ count: 19, error: forbidden } as SchedulerExpiryMetrics);
    metrics.schedulerCardinality({ organizations: 2, targets: 23, signals: 29, sql: forbidden } as SchedulerCardinalityMetrics);
    metrics.outboxTick({
      budgetMs: 600,
      elapsedMs: 650,
      overshootMs: 50,
      organizations: 3,
      claimed: 31,
      delivered: 37,
      cleaned: 41,
      credential: forbidden,
    } as OutboxTickMetrics);

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
    const everyMethod: Array<() => void> = [
      () => metrics.certificateScan({ hitsObserved: 1, hitsSaturated: false,
        missesObserved: 2, missesSaturated: false, scanExhausted: false,
        cardinalityObserved: 3, cardinalitySaturated: false }),
      () => metrics.certificateUpsert({ count: 1 }),
      () => metrics.certificateCleanup({ count: 1, cardinalityObserved: 2, cardinalitySaturated: false }),
      () => metrics.headRestart(),
      () => metrics.schedulerCapacityReject({ scope: "global" }),
      () => metrics.schedulerExpiry({ count: 1 }),
      () => metrics.schedulerCardinality({ organizations: 1, targets: 2, signals: 3 }),
      () => metrics.outboxTick({ budgetMs: 1, elapsedMs: 1, overshootMs: 0,
        organizations: 0, claimed: 0, delivered: 0, cleaned: 0 }),
    ];
    for (const call of everyMethod) expect(call).not.toThrow();
  });

  it("clamps invalid numeric values and rejects the open scheduler scope", async () => {
    const loaded = await loadMetricsModule();
    expect(loaded).not.toBeNull();
    if (!loaded) return;
    const records: unknown[][] = [];
    const metrics = loaded.createPinoJobControlMetrics({ info: (...args) => { records.push(args); } });
    metrics.schedulerCapacityReject({ scope: "tenant" } as unknown as SchedulerCapacityRejectMetrics);
    metrics.schedulerExpiry({ count: -1 });
    metrics.schedulerCardinality({ organizations: Number.NaN, targets: 1.5, signals: Number.POSITIVE_INFINITY });
    metrics.outboxTick({ budgetMs: -1, elapsedMs: Number.MAX_SAFE_INTEGER + 1,
      overshootMs: Number.NaN, organizations: -2, claimed: 1.5,
      delivered: Number.NEGATIVE_INFINITY, cleaned: 3 });

    expect(records).toEqual([
      [{ event: "job_control.scheduler_capacity_reject", scope: "global" }],
      [{ event: "job_control.scheduler_expiry", count: 0 }],
      [{ event: "job_control.scheduler_cardinality", organizations: 0, targets: 1, signals: 0 }],
      [{ event: "job_control.outbox_tick", budgetMs: 0, elapsedMs: Number.MAX_SAFE_INTEGER,
        overshootMs: 0, organizations: 0, claimed: 1, delivered: 0, cleaned: 3 }],
    ]);
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
