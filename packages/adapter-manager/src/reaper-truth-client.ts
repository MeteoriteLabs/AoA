// packages/adapter-manager/src/reaper-truth-client.ts
//
// DEP-011 reaper Slice B (B2) — the adapter-manager's FIRST outbound client: the REAL
// liveness oracle the reaper (Slice A) trusts to reclaim. The AM holds the E2B key + the
// fleet `list` but has NO `DATABASE_URL`; the control-plane (CP) has the DB but not the
// key. So B is a READ-ONLY PULL: this client asks the CP "which of these leases are
// terminal/superseded?" over control-net and maps the answer to per-sandbox verdicts.
//
// ★ THE SAFETY SPINE — POSITIVE-CONFIRMED-DEATH, STRUCTURAL (B2C-F2). This client's
// `"orphan"` verdict authorizes a reclaim of a LIVE tenant sandbox, so the mapping starts
// EVERY sandbox at `"unknown"` and promotes to `"live"` ONLY on exact `=== "live"` and to
// `"orphan"` ONLY on exact `=== "terminal"`/`=== "superseded"`. Any other string (an
// unrecognized 5th enum, wrong-case, protocol drift), a missing key, a non-2xx body, a
// throw, or a timeout → stays `"unknown"`. There is NO negative default like
// `v === "live" ? … : "orphan"` (that would map any out-of-contract value to a fleet-wide
// mass-kill).
//
// ★ THE CLIENT NEVER REJECTS (B2C-F1). Every failure path RESOLVES to a Map (all-`unknown`
// for the affected batch) — a throwing `resolveTruth` would crash the reaper loop (C).
//
// ★ Boundary-clean: GLOBAL `fetch` + `AbortSignal` (no `require(`, no new dependency — the
// AM manifest stays `[provider-wire, sandbox-e2b-provider, worker-daemon]`). The concrete
// `E2b…Provider` is never named here. Precedent: `NetworkedProviderDriver`'s global-fetch
// client (`@armyofagents/provider-wire` driver).

import type { ResourceSummary } from "@armyofagents/worker-daemon";
import type { ReaperVerdict, ResolveTruth } from "./reconcile-reaper.js";

/** The CP-service base URL env, read in the bin via `env[CONST]` (Guards-F3 — never a
 * `process.env.AOA_…` literal). The client appends the known lease-truth path. */
export const CONTROL_PLANE_URL_ENV = "AOA_ADAPTER_MANAGER_CONTROL_PLANE_URL";

/** The B1 endpoint path the client POSTs to (co-located with the client, which owns the
 * CP contract; the env carries only the service base). */
export const LEASE_TRUTH_PATH = "/api/adapter-manager-control/lease-truth";

/** Bounded fetch deadline (B2C-F3): D ≪ the sweep cadence (default < 60s), so a hung CP
 * aborts → `"unknown"` and cannot pile up overlapping sweeps (with C's self-reschedule). */
export const DEFAULT_TRUTH_FETCH_TIMEOUT_MS = 5_000;

/** The frozen response body from B1: `{ verdicts: { <leaseId>: "terminal"|"live"|"superseded"|"absent" } }`. */
interface LeaseTruthResponseBody {
  readonly verdicts?: unknown;
}

/**
 * Map ONE control-plane verdict string to the reaper's port verdict. Positive-confirmed-
 * death: promote ONLY on an EXACT recognized string; everything else (absent, unrecognized,
 * missing, non-string) is `"unknown"` (fail-closed to skip).
 */
export function mapControlPlaneVerdict(cpVerdict: unknown): ReaperVerdict {
  if (cpVerdict === "live") return "live";
  if (cpVerdict === "terminal" || cpVerdict === "superseded") return "orphan";
  return "unknown";
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path}`;
}

/**
 * POST one per-org batch and return the CP's `verdicts` object, or `null` on ANY failure
 * (non-2xx, non-JSON, wrong shape, timeout, throw). Never rejects.
 */
async function fetchOrgVerdicts(
  endpoint: string,
  organizationId: string,
  leaseIds: readonly string[],
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orgs: [{ organizationId, leases: leaseIds.map((leaseId) => ({ leaseId })) }],
      }),
      // Bounded: a hung CP aborts to `null` → every sandbox in this org stays "unknown".
      signal: AbortSignal.timeout(timeoutMs),
    });
    // ★ res.ok FIRST — global fetch does NOT throw on non-2xx, so a naive `res.json()` on a
    // 500 body would read error fields as truth (B2C-F2).
    if (!res.ok) return null;
    const body = (await res.json()) as LeaseTruthResponseBody;
    // Shape-guard: `verdicts` must be a plain object (not null, not an array).
    if (!body || typeof body !== "object") return null;
    const verdicts = body.verdicts;
    if (!verdicts || typeof verdicts !== "object" || Array.isArray(verdicts)) return null;
    return verdicts as Record<string, unknown>;
  } catch {
    // Timeout (AbortError), network error, or malformed JSON → the whole batch is unknown.
    return null;
  }
}

/**
 * Build the real `ResolveTruth` the reaper injects (Slice A's seam). `baseUrl` is the CP
 * service base (the bin reads it from `env[CONTROL_PLANE_URL_ENV]`); `fetchImpl` defaults
 * to the global `fetch` and is injectable so tests spy the hop.
 */
export function makeControlPlaneResolveTruth(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = DEFAULT_TRUTH_FETCH_TIMEOUT_MS,
): ResolveTruth {
  const endpoint = joinUrl(baseUrl, LEASE_TRUTH_PATH);
  return async (summaries: readonly ResourceSummary[]) => {
    // Start EVERY sandbox at "unknown" — the positive-confirmed-death floor. A summary
    // whose org batch fails, or whose leaseId the CP omits, is NEVER promoted off it.
    const result = new Map<string, ReaperVerdict>();
    for (const s of summaries) result.set(s.sandboxId, "unknown");
    if (summaries.length === 0) return result;

    // Group by organizationId — one bounded POST per org (per-org failure isolation: a
    // stalled org → only its sandboxes stay unknown, others still classify).
    const byOrg = new Map<string, ResourceSummary[]>();
    for (const s of summaries) {
      const org = s.resourceLabels.organizationId;
      let group = byOrg.get(org);
      if (!group) {
        group = [];
        byOrg.set(org, group);
      }
      group.push(s);
    }

    for (const [organizationId, group] of byOrg) {
      const leaseIds = [...new Set(group.map((s) => s.resourceLabels.leaseId))];
      const verdicts = await fetchOrgVerdicts(endpoint, organizationId, leaseIds, fetchImpl, timeoutMs);
      // ★ KEY BY ITERATING THE CLIENT'S OWN SUMMARIES (B2C-F7), never the CP's verdicts.
      // Two sandboxes sharing a leaseId (a retried create) then BOTH get that lease's
      // verdict — fail-safe (leases.id is a globally-unique UUID). `verdicts?.[leaseId]`
      // is `undefined` on a failed batch or an omitted key → mapped to "unknown".
      for (const s of group) {
        result.set(s.sandboxId, mapControlPlaneVerdict(verdicts?.[s.resourceLabels.leaseId]));
      }
    }
    return result;
  };
}
