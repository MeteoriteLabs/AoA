// JOB-003 payload-free job-control telemetry (E3-F032).
//
// A closed, bounded metrics surface for the leasing certificate, scheduler capacity/expiry, and
// outbox launch window. Every event carries only hand-derived numeric counts, saturation flags,
// and the closed scheduler scope union — never tenant payload, identity, or free-form fields.
// The adapter constructs each emitted object explicitly, so an extra caller field can never reach
// the log. Counts are clamped to a non-negative safe integer; the scope is clamped to the union.

export type SchedulerCapacityScope = "organization" | "target" | "global";

export interface JobControlMetrics {
  certificateScan(value: {
    readonly hitsObserved: number;
    readonly hitsSaturated: boolean;
    readonly missesObserved: number;
    readonly missesSaturated: boolean;
    readonly scanExhausted: boolean;
    readonly cardinalityObserved: number;
    readonly cardinalitySaturated: boolean;
  }): void;
  certificateUpsert(value: { readonly count: number }): void;
  certificateCleanup(value: {
    readonly count: number;
    readonly cardinalityObserved: number;
    readonly cardinalitySaturated: boolean;
  }): void;
  headRestart(): void;
  schedulerCapacityReject(value: { readonly scope: SchedulerCapacityScope }): void;
  schedulerExpiry(value: { readonly count: number }): void;
  schedulerCardinality(value: {
    readonly organizations: number;
    readonly targets: number;
    readonly signals: number;
  }): void;
  outboxTick(value: {
    readonly budgetMs: number;
    readonly elapsedMs: number;
    readonly overshootMs: number;
    readonly organizations: number;
    readonly claimed: number;
    readonly delivered: number;
    readonly cleaned: number;
  }): void;
}

/** Clamp any observed count to a non-negative floored safe integer; non-finite becomes zero. */
function clampCount(value: number): number {
  return Number.isFinite(value)
    ? Math.min(Math.max(0, Math.floor(value)), Number.MAX_SAFE_INTEGER)
    : 0;
}

/** Clamp an out-of-union scope down to the safe default so telemetry never widens the contract. */
function clampScope(value: SchedulerCapacityScope): SchedulerCapacityScope {
  return value === "organization" || value === "target" || value === "global" ? value : "global";
}

/**
 * Frozen no-op metrics: services default to this when telemetry is not composed. Each method
 * allocates nothing and emits nothing.
 */
export const NOOP_JOB_CONTROL_METRICS: JobControlMetrics = Object.freeze({
  certificateScan: () => {},
  certificateUpsert: () => {},
  certificateCleanup: () => {},
  headRestart: () => {},
  schedulerCapacityReject: () => {},
  schedulerExpiry: () => {},
  schedulerCardinality: () => {},
  outboxTick: () => {},
});

/**
 * Adapter that logs each closed event as one structured record. Telemetry is best-effort: a
 * failing logger is swallowed and never changes control flow.
 */
export function createPinoJobControlMetrics(
  log: { info: (...args: unknown[]) => void },
): JobControlMetrics {
  const emit = (record: Readonly<Record<string, unknown>>): void => {
    try {
      log.info(record);
    } catch {
      // Best-effort telemetry: a failing logger never changes control flow.
    }
  };
  return {
    certificateScan: (value) => emit({
      event: "job_control.certificate_scan",
      hitsObserved: clampCount(value.hitsObserved),
      hitsSaturated: value.hitsSaturated === true,
      missesObserved: clampCount(value.missesObserved),
      missesSaturated: value.missesSaturated === true,
      scanExhausted: value.scanExhausted === true,
      cardinalityObserved: clampCount(value.cardinalityObserved),
      cardinalitySaturated: value.cardinalitySaturated === true,
    }),
    certificateUpsert: (value) => emit({
      event: "job_control.certificate_upsert",
      count: clampCount(value.count),
    }),
    certificateCleanup: (value) => emit({
      event: "job_control.certificate_cleanup",
      count: clampCount(value.count),
      cardinalityObserved: clampCount(value.cardinalityObserved),
      cardinalitySaturated: value.cardinalitySaturated === true,
    }),
    headRestart: () => emit({ event: "job_control.head_restart" }),
    schedulerCapacityReject: (value) => emit({
      event: "job_control.scheduler_capacity_reject",
      scope: clampScope(value.scope),
    }),
    schedulerExpiry: (value) => emit({
      event: "job_control.scheduler_expiry",
      count: clampCount(value.count),
    }),
    schedulerCardinality: (value) => emit({
      event: "job_control.scheduler_cardinality",
      organizations: clampCount(value.organizations),
      targets: clampCount(value.targets),
      signals: clampCount(value.signals),
    }),
    outboxTick: (value) => emit({
      event: "job_control.outbox_tick",
      budgetMs: clampCount(value.budgetMs),
      elapsedMs: clampCount(value.elapsedMs),
      overshootMs: clampCount(value.overshootMs),
      organizations: clampCount(value.organizations),
      claimed: clampCount(value.claimed),
      delivered: clampCount(value.delivered),
      cleaned: clampCount(value.cleaned),
    }),
  };
}
