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
]);

/**
 * A bounded low-cardinality enum token: lowercase, starts with a letter, at most
 * 40 chars of [a-z0-9_]. Rejects UUIDs (hyphens/mixed case), long free-form
 * strings, and most identifiers — the first line of defence until each key gets
 * a closed value allow-list.
 */
const LABEL_VALUE_TOKEN = /^[a-z][a-z0-9_]{0,39}$/;

export interface Metrics {
  /** Liveness gauge exposed as `worker_up`. */
  setWorkerUp(up: boolean): void;
  /** Increment a bounded counter; unknown label keys throw. */
  inc(name: string, labels?: Readonly<Record<string, string>>, by?: number): void;
  /** Render the current counters as Prometheus text exposition. */
  renderPrometheus(): string;
}

/** A metric-line label key that fails validation is rejected, never logged. */
function assertBoundedLabels(labels: Readonly<Record<string, string>>): void {
  for (const [key, value] of Object.entries(labels)) {
    if (!ALLOWED_LABEL_KEYS.has(key)) {
      throw new Error(
        `metric label key ${JSON.stringify(key)} is not in the bounded allow-list ` +
          `(${[...ALLOWED_LABEL_KEYS].join(", ")})`,
      );
    }
    if (typeof value !== "string" || !LABEL_VALUE_TOKEN.test(value)) {
      // Never echo the offending value — it may be the very identity we reject.
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

  return {
    setWorkerUp(up: boolean): void {
      workerUp = up ? 1 : 0;
    },
    inc(name: string, labels: Readonly<Record<string, string>> = {}, by = 1): void {
      assertBoundedLabels(labels);
      const key = seriesKey(name, labels);
      counters.set(key, (counters.get(key) ?? 0) + by);
    },
    renderPrometheus(): string {
      const lines: string[] = [];
      lines.push("# HELP worker_up 1 when the worker process is live.");
      lines.push("# TYPE worker_up gauge");
      lines.push(`worker_up ${workerUp}`);
      for (const [key, value] of [...counters.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        lines.push(`${key} ${value}`);
      }
      return `${lines.join("\n")}\n`;
    },
  };
}
