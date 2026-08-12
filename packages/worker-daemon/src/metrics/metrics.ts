/**
 * Bounded-label metrics surface (WRK-001).
 *
 * Stable metrics use bounded labels ONLY (`operation`, `outcome`/`reason`,
 * `workload`, `provider`, `escalation_stage`) — never `organizationId`,
 * `companyId`, `jobId`, event content, secret, key, or session bytes. The
 * counter map is validated against a closed label-KEY allow-list AND a bounded
 * label-VALUE token, so a caller cannot widen cardinality or smuggle tenant
 * identity (an id/UUID/free-form string) into `/metrics` as a label value.
 * WRK-003/004 that add poll/lease/cleanup counters must register the closed
 * value set for each key here; the token bound below is the interim floor.
 */

export const ALLOWED_LABEL_KEYS = new Set([
  "operation",
  "outcome",
  "reason",
  "workload",
  "provider",
  "escalation_stage",
  // WRK-003: backoff-sleep histogram bucket (a CLOSED token set, below).
  "bucket",
]);

/**
 * A bounded low-cardinality enum token: lowercase, starts with a letter, at most
 * 40 chars of [a-z0-9_]. Rejects UUIDs (hyphens/mixed case), long free-form
 * strings, and most identifiers — the floor for keys that do NOT yet have a
 * closed value allow-list.
 */
const LABEL_VALUE_TOKEN = /^[a-z][a-z0-9_]{0,39}$/;

/**
 * CLOSED per-key value allow-lists (E4 metrics contract: "WRK-003/004 that add
 * poll/lease/cleanup counters must register the closed value set for each key").
 * A key WITH a closed set admits ONLY those values; a key WITHOUT one still falls
 * back to the `LABEL_VALUE_TOKEN` floor. This makes the poll/lease/backoff label
 * cardinality provably finite — a caller cannot smuggle an identifier or widen
 * the series space through `outcome`/`workload`/`bucket`.
 */
export const CLOSED_LABEL_VALUES: Readonly<Record<string, ReadonlySet<string>>> = {
  outcome: new Set([
    // poll outcomes
    "offer",
    "no_work",
    "drain",
    "incompatible",
    "backpressure",
    "recovered",
    // an offer that arrived after lease-stop began (drain-before-lease-stop) →
    // dropped un-ACKed rather than abandoned in flight at exit.
    "offer_dropped",
    // shared error/terminal outcomes
    "malformed",
    "unauthorized",
    "reenrollment_required",
    "target_revoked",
    "throttled",
    "internal_unavailable",
    "timeout",
    "socket_error",
    // lease_ack outcomes
    "acknowledged",
    "rejected",
    "handed_off",
  ]),
  workload: new Set(["batch", "browser_session", "service"]),
  bucket: new Set(["lt_1s", "lt_5s", "lt_30s", "gte_30s"]),
};

export interface Metrics {
  /** Liveness gauge exposed as `worker_up`. */
  setWorkerUp(up: boolean): void;
  /** Increment a bounded counter; unknown label keys / values throw. */
  inc(name: string, labels?: Readonly<Record<string, string>>, by?: number): void;
  /** Set a bounded labeled gauge (last-write-wins) — e.g. `active_leases`,
   * `capacity_free_slots{workload}`. */
  setGauge(name: string, value: number, labels?: Readonly<Record<string, string>>): void;
  /** Render the current gauges + counters as Prometheus text exposition. */
  renderPrometheus(): string;
}

/** A metric-line label key/value that fails validation is rejected, never logged. */
function assertBoundedLabels(labels: Readonly<Record<string, string>>): void {
  for (const [key, value] of Object.entries(labels)) {
    if (!ALLOWED_LABEL_KEYS.has(key)) {
      throw new Error(
        `metric label key ${JSON.stringify(key)} is not in the bounded allow-list ` +
          `(${[...ALLOWED_LABEL_KEYS].join(", ")})`,
      );
    }
    if (typeof value !== "string") {
      throw new Error(`metric label ${JSON.stringify(key)} value must be a string`);
    }
    const closed = CLOSED_LABEL_VALUES[key];
    if (closed !== undefined) {
      if (!closed.has(value)) {
        // Never echo the offending value — it may be the very identity we reject.
        throw new Error(
          `metric label ${JSON.stringify(key)} has an unregistered value; ` +
            "labels carry values from the closed per-key allow-list only",
        );
      }
    } else if (!LABEL_VALUE_TOKEN.test(value)) {
      throw new Error(
        `metric label ${JSON.stringify(key)} has an unbounded/non-token value; ` +
          "labels carry low-cardinality enum tokens only, never identifiers",
      );
    }
  }
}

/** Render a stable, order-independent key for a metric + its labels. */
function seriesKey(name: string, labels: Readonly<Record<string, string>>): string {
  const parts = Object.keys(labels)
    .sort()
    .map((k) => `${k}="${labels[k]}"`);
  return parts.length > 0 ? `${name}{${parts.join(",")}}` : name;
}

export function createMetrics(): Metrics {
  let workerUp = 0;
  const counters = new Map<string, number>();
  const gauges = new Map<string, number>();

  return {
    setWorkerUp(up: boolean): void {
      workerUp = up ? 1 : 0;
    },
    inc(name: string, labels: Readonly<Record<string, string>> = {}, by = 1): void {
      assertBoundedLabels(labels);
      const key = seriesKey(name, labels);
      counters.set(key, (counters.get(key) ?? 0) + by);
    },
    setGauge(name: string, value: number, labels: Readonly<Record<string, string>> = {}): void {
      assertBoundedLabels(labels);
      gauges.set(seriesKey(name, labels), value);
    },
    renderPrometheus(): string {
      const lines: string[] = [];
      lines.push("# HELP worker_up 1 when the worker process is live.");
      lines.push("# TYPE worker_up gauge");
      lines.push(`worker_up ${workerUp}`);
      for (const [key, value] of [...gauges.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        lines.push(`${key} ${value}`);
      }
      for (const [key, value] of [...counters.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        lines.push(`${key} ${value}`);
      }
      return `${lines.join("\n")}\n`;
    },
  };
}
