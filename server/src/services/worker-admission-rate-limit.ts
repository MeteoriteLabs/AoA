// server/src/services/worker-admission-rate-limit.ts
//
// DEP-009 — the PostgreSQL-backed SHARED admission rate limiter for the distributed
// worker-control path (the worker poll — the highest-frequency admission request).
//
// The express-rate-limit limiters in `middleware/rate-limit.ts` are per-PROCESS in-memory
// buckets and are not applied to worker-control at all, so two control-plane replicas would
// each keep their own counter — process-local admission state, which the two-replica
// acceptance explicitly forbids. This limiter is the shared authority: a per-`(organizationId,
// window_start)` fixed-window counter row in `worker_admission_rate_limits` that BOTH replicas
// increment, so a burst split across replica A + replica B observes ONE limit.
//
// The counter is advanced with an ATOMIC single statement — INSERT ... ON CONFLICT
// (organization_id, window_start) DO UPDATE SET request_count = request_count + 1
// RETURNING request_count — inside the request's tenant transaction (`runInTenant`, role
// aoa_app under FORCE RLS). There is NO read-then-write race: two concurrent callers each
// get a distinct returned count from the one row.
//
// FAIL-CLOSED: a shared-store error (or any thrown dependency) DENIES the request; there is
// NO per-process/in-memory fallback (DEP-006 line 729: no in-memory fast-path even on a
// transient shared-store failure). The scheduler poll-backoff hint is untouched.
//
// DORMANCY: this module is imported ONLY by `worker-control.ts`, which is mounted ONLY when
// AOA_DISTRIBUTED_EXECUTION_ENABLED is on (app.ts). It therefore never loads in the flag-off
// graph. Value imports here are safe: `runInTenant` (tenant-context) and the db barrel are
// already always-loaded; nothing new is pulled into the dormant graph.

import type { Db } from "@armyofagents/db";
import { workerAdmissionRateLimits } from "@armyofagents/db";
import { sql } from "drizzle-orm";
import { runInTenant } from "../db/tenant-context.js";
// Always-loaded infrastructure logger (used app-wide); importing it here pulls nothing
// new into the flag-off graph, so the DEP-007 dormancy invariant holds.
import { logger } from "../middleware/logger.js";

export const WORKER_POLL_RATE_LIMIT_WINDOW_MS_ENV = "AOA_WORKER_POLL_RATE_LIMIT_WINDOW_MS";
export const WORKER_POLL_RATE_LIMIT_MAX_ENV = "AOA_WORKER_POLL_RATE_LIMIT_MAX";

// Generous defaults: a per-org safety valve, NOT a tight throttle. The D1 live campaign
// (e6f-01's ~100-poll lease race, e6f-03/05 smoke) shares one org per scenario and must not
// be throttled by the limiter, so the default cap is far above any legitimate burst; a real
// deployment tunes both via the env vars above. A fixed 60s window keeps the counter bounded.
export const DEFAULT_WORKER_POLL_RATE_LIMIT_WINDOW_MS = 60_000;
export const DEFAULT_WORKER_POLL_RATE_LIMIT_MAX = 100_000;

export interface WorkerPollRateLimitConfig {
  /** Fixed-window length in milliseconds. */
  windowMs: number;
  /** Maximum admitted requests per organization per window. */
  max: number;
}

type Env = Record<string, string | undefined>;

function parsePositiveIntEnv(env: Env, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name}=${JSON.stringify(env[name])} must be a positive integer`);
  }
  return parsed;
}

export function resolveWorkerPollRateLimitConfig(env: Env = process.env): WorkerPollRateLimitConfig {
  return {
    windowMs: parsePositiveIntEnv(env, WORKER_POLL_RATE_LIMIT_WINDOW_MS_ENV, DEFAULT_WORKER_POLL_RATE_LIMIT_WINDOW_MS),
    max: parsePositiveIntEnv(env, WORKER_POLL_RATE_LIMIT_MAX_ENV, DEFAULT_WORKER_POLL_RATE_LIMIT_MAX),
  };
}

/** The fixed-window bucket boundary for `now`: floor(now / windowMs) * windowMs. */
export function windowStartFor(now: Date, windowMs: number): Date {
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

export type WorkerAdmissionRateDecision =
  | { allowed: true; count: number; limit: number }
  | { allowed: false; reason: "over_cap"; count: number; limit: number }
  | { allowed: false; reason: "unavailable"; limit: number };

/**
 * The ATOMIC upsert-increment, INSIDE an already-open tenant transaction (a `Db` handle
 * carrying the aoa.organization_id GUC). One statement — INSERT ... ON CONFLICT DO UPDATE
 * ... RETURNING — so there is no read-then-write race. Returns the NEW post-increment count.
 * The organization_id equals the tenant GUC, so the RLS WITH CHECK passes on both the INSERT
 * and the conflict UPDATE.
 */
export async function incrementAdmissionWindow(
  tx: Db,
  input: { organizationId: string; windowStart: Date },
): Promise<number> {
  const [row] = await tx
    .insert(workerAdmissionRateLimits)
    .values({
      organizationId: input.organizationId,
      windowStart: input.windowStart,
      requestCount: 1,
    })
    .onConflictDoUpdate({
      target: [workerAdmissionRateLimits.organizationId, workerAdmissionRateLimits.windowStart],
      set: {
        requestCount: sql`${workerAdmissionRateLimits.requestCount} + 1`,
        updatedAt: sql`clock_timestamp()`,
      },
    })
    .returning({ count: workerAdmissionRateLimits.requestCount });
  if (!row) throw new Error("worker admission rate-limit upsert returned no row");
  return row.count;
}

export interface WorkerAdmissionRateLimiter {
  /** Admit one poll for the organization; fail-closed on any shared-store error. */
  admit(organizationId: string): Promise<WorkerAdmissionRateDecision>;
}

export function createWorkerAdmissionRateLimiter(opts: {
  appDb: Db;
  config?: WorkerPollRateLimitConfig;
  now?: () => Date;
}): WorkerAdmissionRateLimiter {
  const config = opts.config ?? resolveWorkerPollRateLimitConfig();
  return {
    async admit(organizationId: string): Promise<WorkerAdmissionRateDecision> {
      const windowStart = windowStartFor(opts.now?.() ?? new Date(), config.windowMs);
      let count: number;
      try {
        count = await runInTenant(opts.appDb, organizationId, (_repos, tx) =>
          incrementAdmissionWindow(tx, { organizationId, windowStart }),
        );
      } catch (err) {
        // FAIL-CLOSED: a shared-store error denies. NEVER a per-process fallback. Log the
        // cause (operator-only sink) so a persistent unavailable deny is diagnosable instead
        // of a silent 429 — the deny itself is unchanged.
        logger.error({ err, organizationId }, "worker_admission_internal_unavailable");
        return { allowed: false, reason: "unavailable", limit: config.max };
      }
      if (count > config.max) {
        return { allowed: false, reason: "over_cap", count, limit: config.max };
      }
      return { allowed: true, count, limit: config.max };
    },
  };
}
