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
// DE-27 — the shared worker-admission denial recorder. This module already imports the
// logger and loads only under AOA_DISTRIBUTED_EXECUTION_ENABLED (see the header), so a
// static import here pulls nothing new into the flag-off graph.
import { recordWorkerAdmissionDenial } from "./worker-admission-denial-audit.js";

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
  /**
   * Admit one poll for the organization; fail-closed on any shared-store error.
   * `workerId` is the refused actor recorded on an over_cap denial (DE-27) — the
   * HMAC-verified `VerifiedWorkerOperation.workerId`, so the durable row names the
   * specific refused worker and not the tenant org.
   */
  admit(organizationId: string, workerId: string): Promise<WorkerAdmissionRateDecision>;
}

export function createWorkerAdmissionRateLimiter(opts: {
  appDb: Db;
  config?: WorkerPollRateLimitConfig;
  now?: () => Date;
}): WorkerAdmissionRateLimiter {
  const config = opts.config ?? resolveWorkerPollRateLimitConfig();
  return {
    async admit(organizationId: string, workerId: string): Promise<WorkerAdmissionRateDecision> {
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
        // DE-27 (audit clause, cross-replica-admission conjunct). The tenant transaction
        // that incremented the SHARED counter has already COMMITTED and returned `count`
        // above, so `opts.appDb` is a pool-level handle and nothing is about to roll back:
        // the refusal is recorded DIRECTLY here, awaited before the deny is returned, so
        // the refusal and its record are atomic from the caller's view. Never throws —
        // `recordWorkerAdmissionDenial` swallows and logs a failed insert, so a broken
        // recorder cannot convert a throttle into a 500.
        //
        // ★ WRITE-AMPLIFICATION BOUND — ONE ROW PER (org, window). `incrementAdmissionWindow`
        // upserts `requestCount + 1` on EVERY poll, so `count` keeps climbing while a
        // misbehaving worker ignores the 429 and polls in a loop. Writing a row on every
        // over-cap poll would make this control — the one meant to CHECK such a worker — an
        // unbounded per-window persistent-storage amplification lever. So the row is written
        // ONLY on the poll that FIRST crosses the cap this window (`count === config.max + 1`);
        // the atomic RETURNING gives exactly one caller that count, so exactly one durable,
        // attributed refusal row is written per (org, window). Later over-cap polls still
        // increment the shared counter and still DENY — only the audit write is suppressed.
        // `details.count` is the count AT CROSSING (config.max + 1), the forensic event: this
        // org was throttled, this worker crossed it, at this count. (The capacity path stays
        // per-refusal by design — a capacity refusal is one discrete, heavy submission tx, not
        // a cheap poll loop — see `worker-admission-denial-audit.ts`.)
        if (count === config.max + 1) {
          await recordWorkerAdmissionDenial(opts.appDb, {
            reason: "over_cap",
            companyId: null,
            organizationId,
            // WHO — the specific refused worker (`auth.workerId`), not the tenant org.
            actorId: workerId,
            entityType: "worker_poll_admission",
            entityId: organizationId,
            control: "server/src/services/worker-admission-rate-limit.ts:admit",
            details: {
              count,
              limit: config.max,
              windowStartMs: windowStart.getTime(),
              // The refused actor is a worker machine identity; name its kind so the
              // WHO is legible beyond the bare id.
              principalKind: "worker",
            },
          });
        }
        return { allowed: false, reason: "over_cap", count, limit: config.max };
      }
      return { allowed: true, count, limit: config.max };
    },
  };
}
