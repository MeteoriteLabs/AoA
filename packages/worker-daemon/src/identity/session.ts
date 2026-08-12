/**
 * Short-lived session lifecycle (WRK-002).
 *
 * Sessions are ~15-minute, opaque `aoa-worker-session` tokens. The worker keeps
 * one current session. There is NO sustained/sliding renewal: per E4-D11 the
 * as-built JOB-002 enroll route gates EVERY enroll (including a replay) on the
 * enrollment CODE ROUTE TTL (`CODE_TTL_MS = 10 min`, shorter than the 15-min
 * session and never extended), and poll/ack never re-issue the session. So the
 * only thing the replay path can do is RECOVER a session whose enroll response
 * was lost, and only WHILE the code route is still live (≤10 min from issuance).
 * Sustained renewal past the code-route window is out of scope (escalated as
 * E4-F007) — a worker whose session lapses must be RE-ENROLLED with a fresh code.
 *
 * `SessionStore` therefore owns:
 *
 *   - `recover()` — a lost-response idempotent replay: re-enroll with the SAME
 *     code + retained idempotency key + unchanged semantic digest + a FRESH
 *     device proof; the server replays the stored identity and mints a new
 *     session with no double-consume. `forceRefresh` is the shared primitive.
 *   - rotation detection — a replay whose generation differs from the current
 *     one is a ROTATION (the device key/generation changed), recorded so the
 *     caller can rebuild downstream state;
 *   - terminal-401 handling — the enroll route COLLAPSES a revoked/replaced
 *     generation AND an expired code route into HTTP 401 `unauthorized` (E4-D11).
 *     Any such stop-and-backoff failure STOPS the store: the current session is
 *     dropped, every further call fails closed (so the worker never keeps using
 *     — or hammering the control plane with — a dead identity), and it surfaces
 *     a `reenrollment_required` signal (a warn log + the
 *     `session_reenrollment_required_total` metric) so an operator issues a fresh
 *     enrollment code. It does NOT spin retrying.
 */

import { EnrollmentError, type WorkerSession } from "../enrollment/enroll.js";
import type { Logger } from "../logging/logger.js";
import type { Metrics } from "../metrics/metrics.js";

/** Metric emitted once when the store goes terminal and re-enrollment is due. */
export const REENROLLMENT_REQUIRED_METRIC = "session_reenrollment_required_total";

/** Thrown once the store has stopped (revoked/replaced identity, or a code route
 * that expired before the session could be recovered — all 401 on the enroll
 * route per E4-D11). */
export class SessionStoppedError extends Error {
  constructor(message = "session store stopped: re-enrollment required (identity revoked/replaced or code route expired)") {
    super(message);
    this.name = "SessionStoppedError";
  }
}

export interface SessionStoreDeps {
  readonly now: () => number;
  /** Replay the enroll (lost-response recovery); returns the freshly-issued
   * session. Succeeds only while the code route is live; a lapsed code route
   * surfaces as a stop-and-backoff `unauthorized` (E4-D11). */
  readonly renew: () => Promise<WorkerSession>;
  /** Optional metrics sink; the terminal-401 `reenrollment_required` counter is
   * emitted here (best-effort). */
  readonly metrics?: Metrics;
  /** Optional structured logger; the terminal-401 warn line is emitted here
   * (best-effort). */
  readonly logger?: Logger;
}

export class SessionStore {
  readonly #deps: SessionStoreDeps;
  #current: WorkerSession | null;
  #stopped = false;
  #lastRotated = false;

  constructor(deps: SessionStoreDeps, initial: WorkerSession | null = null) {
    this.#deps = deps;
    this.#current = initial;
  }

  current(): WorkerSession | null {
    return this.#current;
  }

  isStopped(): boolean {
    return this.#stopped;
  }

  /** Whether the most recent successful recovery changed the device generation. */
  lastRefreshRotated(): boolean {
    return this.#lastRotated;
  }

  set(session: WorkerSession): void {
    this.#current = session;
  }

  isExpired(): boolean {
    return this.#current === null || this.#deps.now() >= this.#current.expiresAtMs;
  }

  /**
   * Return the current session, recovering ONLY if it is absent or already
   * expired. This is NOT a near-expiry renewal scheduler (E4-D11: there is no
   * sustained renewal) — a live session is returned unchanged, and an
   * absent/expired one triggers a lost-response recovery replay whose success
   * depends on the code route still being live.
   */
  async ensureFresh(): Promise<WorkerSession> {
    if (this.#stopped) throw new SessionStoppedError();
    if (this.#current !== null && this.#deps.now() < this.#current.expiresAtMs) return this.#current;
    return this.forceRefresh();
  }

  /**
   * Lost-response recovery: replay the enroll to recover a session after a
   * dropped enroll response, while the code route is still live. Terminal on a
   * stop-and-backoff 401 (see `forceRefresh`).
   */
  recover(): Promise<WorkerSession> {
    return this.forceRefresh();
  }

  /**
   * Force a replay now (the shared recovery primitive). On a stop-and-backoff
   * enrollment error (a revoked/replaced generation OR an expired code route —
   * both 401 on the enroll route per E4-D11) the store STOPS: the current
   * session is dropped, the `reenrollment_required` signal is emitted once, and
   * every further call fails closed. It never retries a dead identity.
   */
  async forceRefresh(): Promise<WorkerSession> {
    if (this.#stopped) throw new SessionStoppedError();
    const prev = this.#current;
    try {
      const next = await this.#deps.renew();
      this.#lastRotated = prev !== null && next.deviceGeneration !== prev.deviceGeneration;
      this.#current = next;
      return next;
    } catch (err) {
      if (err instanceof EnrollmentError && err.stopAndBackoff) {
        this.#stopped = true;
        this.#current = null;
        this.#signalReenrollmentRequired(prev);
      }
      throw err;
    }
  }

  /** Emit the terminal-401 `reenrollment_required` signal exactly once (the stop
   * guard in `forceRefresh` ensures this runs only on the transition). */
  #signalReenrollmentRequired(prev: WorkerSession | null): void {
    // `reason` is a bounded low-cardinality token: on the enroll/renew path a
    // revoked/replaced generation and an expired code route both collapse to 401
    // `unauthorized` (E4-D11), so the observable cause is a single enroll-path
    // 401. Never a tenant identifier.
    this.#deps.metrics?.inc(REENROLLMENT_REQUIRED_METRIC, { reason: "enroll_unauthorized" });
    this.#deps.logger?.warn(
      { targetId: prev?.targetId ?? null, reason: "enroll_unauthorized" },
      "worker session terminal: operator re-enrollment required (fresh enrollment code needed)",
    );
  }
}
