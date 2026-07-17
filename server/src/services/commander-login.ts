/**
 * Interactive CLI-login lifecycle (Plan 3 / §6.2 Task 4).
 *
 * Orchestrates a `claude login` / `codex login` device flow started from
 * onboarding: spawn (via the provider streaming runner), surface the
 * verification URL, persist a DURABLE record (so a detached child can be reaped
 * after a hard restart), and finalize status from the child's exit + the
 * provider's credential-file evidence.
 *
 * Storage is behind {@link ChallengeStore} so the lifecycle is unit-testable
 * with an in-memory store; the route wires a Drizzle-backed impl.
 */

export type CommanderLoginProvider = "anthropic" | "openai";
export type ChallengeStatus = "pending" | "completed" | "failed" | "timeout";

export interface ChallengeRow {
  id: string;
  companyId: string;
  provider: CommanderLoginProvider;
  authHome: string;
  loginUrl: string | null;
  pid: number | null;
  pgid: number | null;
  status: ChallengeStatus;
  startedByUserId: string | null;
  startedAt: Date;
}

export interface ChallengeClaimArgs {
  provider: CommanderLoginProvider;
  authHome: string;
  /** The new pending row to insert (pid/pgid/loginUrl null until the child spawns). */
  row: ChallengeRow;
  /**
   * Called with the existing pending row for (provider, authHome) — across ALL
   * companies — if one exists, INSIDE the store's mutual-exclusion boundary.
   * Throw to abort the claim (nothing changes); return to take over (the
   * existing row is removed before `row` is inserted). Conflict/takeover
   * SEMANTICS stay in the service; the store only guarantees atomicity.
   */
  onExisting: (existing: ChallengeRow) => void;
}

export interface ChallengeStore {
  /**
   * Atomically claim the (provider, authHome) single-flight slot:
   * find the pending row → consult `onExisting` → remove it on takeover →
   * insert `row`. Implementations MUST make the whole sequence mutually
   * exclusive across concurrent claims — the `(provider, auth_home, status)`
   * index is NON-unique, so a plain find-then-insert lets two overlapping
   * starts both pass (Codex P1). The drizzle impl uses a transaction +
   * `pg_advisory_xact_lock`; an in-memory store is atomic by being synchronous.
   */
  claim(args: ChallengeClaimArgs): Promise<ChallengeRow>;
  get(id: string): Promise<ChallengeRow | null>;
  update(id: string, patch: Partial<ChallengeRow>): Promise<void>;
  remove(id: string): Promise<void>;
  /** All rows still `pending` (orphans after a restart). */
  listActive(): Promise<ChallengeRow[]>;
}

/** The subset of a streaming login run the lifecycle consumes. */
export interface LoginRunLike {
  handle: { pid: number | null; pgid: number | null; terminate: () => void };
  urlPromise: Promise<string>;
  exitPromise: Promise<number | null>;
  authHome: string;
}

export interface CommanderLoginServiceDeps {
  store: ChallengeStore;
  resolveAuthHome: (provider: CommanderLoginProvider, env: NodeJS.ProcessEnv) => string;
  runLogin: (
    provider: CommanderLoginProvider,
    args: { runId: string; env: NodeJS.ProcessEnv },
  ) => LoginRunLike;
  /** Provider-specific completion evidence (codex auth.json / claude credential file). */
  credentialPresent: (provider: CommanderLoginProvider, authHome: string) => Promise<boolean>;
  /**
   * Kill a login child by its PERSISTED pid/pgid. `expected.startedAt` is
   * REQUIRED — every caller of this seam kills a pid that came from a DB row,
   * which after a crash + restart may have been REUSED by an unrelated process,
   * so the impl MUST verify the target's OS start time against `startedAt` before
   * signalling (a reused pid is spared). All three persisted-pid paths route
   * through here identity-verified:
   *   - `reapOrphans` (BOOT, killing DURABLE rows from a PRIOR process),
   *   - the single-flight takeover in `startChallenge`'s `onExisting` (the
   *     existing row may be a DURABLE prior-process row — the boot reap runs
   *     un-awaited, so a takeover can beat it),
   *   - `cancel` (the UI fires cancel-on-unmount with a challengeId the BROWSER
   *     retains across a server restart / after the CLI already exited, so the
   *     row's pid may likewise be reused — Codex round-7 P1).
   * The ONLY kills that stay UNCONDITIONAL are those using a LIVE in-memory child
   * handle from the current process (`run.handle.terminate()`), which is not
   * PID-reuse-prone and never routes through this seam (Codex P1, round 6 →
   * round 7).
   */
  terminate: (pid: number, pgid: number | null, expected: { startedAt: Date }) => void;
  /**
   * Schedule the post-URL completion deadline (Codex round-7 P2) and return a
   * canceller invoked when the child finalizes FIRST. Injected so tests drive the
   * deadline deterministically without real timers or a leaked open handle; the
   * default (see `defaultDeadlineTimer`) uses an UNREF'd `setTimeout` so a pending
   * deadline never keeps the process (or a test runner) alive.
   */
  setDeadlineTimer?: (fn: () => void, ms: number) => () => void;
  newId: () => string;
  env: () => NodeJS.ProcessEnv;
  now?: () => Date;
}

export class LoginChallengeConflictError extends Error {
  status = 409;
  constructor(message: string) {
    super(message);
    this.name = "LoginChallengeConflictError";
  }
}

export interface StartChallengeResult {
  challengeId: string;
  loginUrl: string;
  /** Resolves once the login has finalized (completed/failed). Route can ignore it; tests await it. */
  completion: Promise<void>;
}

export interface CommanderLoginService {
  startChallenge(args: {
    companyId: string;
    provider: CommanderLoginProvider;
    startedByUserId: string | null;
  }): Promise<StartChallengeResult>;
  /** Company-scoped: a challenge owned by another company is reported absent. */
  getStatus(
    companyId: string,
    id: string,
  ): Promise<{ status: ChallengeStatus; loginUrl: string | null } | null>;
  /** Company-scoped: a cross-tenant cancel is a silent no-op (as if absent). */
  cancel(companyId: string, id: string): Promise<void>;
  reapOrphans(): Promise<void>;
}

/**
 * How long the lifecycle waits, AFTER the verification URL is surfaced, for the
 * login child to finalize before it is force-terminated and the row is marked
 * `timeout` (Codex round-7 P2). Chosen a few minutes: long enough for a real
 * device-code flow (open browser → sign in → possibly 2FA) to complete without
 * being cut off, short enough to reliably free the codex :1455 callback port and
 * the global (provider, authHome) single-flight slot when a child hangs without
 * ever exiting. If the CLI honors the device-code's own expiry it exits on its
 * own (→ completed/failed) well before this backstop; the deadline only fires
 * when the child neither exits nor is cancelled within the window.
 */
export const LOGIN_COMPLETION_DEADLINE_MS = 5 * 60_000;

/**
 * Default completion-deadline timer: an UNREF'd `setTimeout` so a pending login
 * deadline never keeps the process (or a test runner) alive, plus a canceller
 * that clears it. Overridable via `deps.setDeadlineTimer` for deterministic tests.
 */
function defaultDeadlineTimer(fn: () => void, ms: number): () => void {
  const handle = setTimeout(fn, ms);
  (handle as { unref?: () => void }).unref?.();
  return () => clearTimeout(handle);
}

export function createCommanderLoginService(deps: CommanderLoginServiceDeps): CommanderLoginService {
  const now = deps.now ?? (() => new Date());
  const setDeadlineTimer = deps.setDeadlineTimer ?? defaultDeadlineTimer;

  async function startChallenge(args: {
    companyId: string;
    provider: CommanderLoginProvider;
    startedByUserId: string | null;
  }): Promise<StartChallengeResult> {
    const env = deps.env();
    const authHome = deps.resolveAuthHome(args.provider, env);
    const id = deps.newId();

    // Single-flight per (provider, authHome), decided ATOMICALLY inside the
    // store's claim (transaction + advisory lock in the drizzle impl) — a
    // check-then-act find→spawn→insert let two overlapping starts both spawn
    // children that fight over the credential home + codex callback port
    // (:1455). A pending challenge owned by ANOTHER company blocks (409). For
    // the SAME company, a re-attempt must not leave a second child alive, so
    // we cancel the prior child (free the port) and start ONE clean login.
    // The row is durable BEFORE the child spawns; pid/pgid are backfilled.
    await deps.store.claim({
      provider: args.provider,
      authHome,
      row: {
        id,
        companyId: args.companyId,
        provider: args.provider,
        authHome,
        loginUrl: null,
        pid: null,
        pgid: null,
        status: "pending",
        startedByUserId: args.startedByUserId,
        startedAt: now(),
      },
      onExisting: (existing) => {
        if (existing.companyId !== args.companyId) {
          throw new LoginChallengeConflictError(
            `another company is already signing in with ${args.provider} at ${authHome}`,
          );
        }
        // Identity-verified takeover kill (Codex P1, round 6 follow-on). The
        // single-flight slot is reclaimed whether or not the kill fires (the row
        // is removed/replaced by the store either way), but the `existing` row
        // may be DURABLE — persisted by a PRIOR process whose pid has since been
        // reused, because the boot reaper (`reapOrphans`) is fired UN-awaited at
        // startup (index.ts) and a same-(provider,authHome) start served early
        // in boot can hit this callback before that reap clears the stale row.
        // So route through the SAME `expected.startedAt` identity check the
        // reaper uses — a reused pid is skipped, a genuine this-session child
        // (start time ≤ startedAt + tolerance) is still killed so the codex
        // :1455 callback port is freed for the fresh login.
        if (existing.pid != null)
          deps.terminate(existing.pid, existing.pgid, { startedAt: existing.startedAt });
      },
    });

    let run: LoginRunLike;
    try {
      run = deps.runLogin(args.provider, { runId: id, env });
    } catch (err) {
      // Spawn failed — release the slot (never leave a dangling `pending` row).
      await deps.store.update(id, { status: "failed" }).catch(() => {});
      throw err;
    }
    try {
      await deps.store.update(id, { pid: run.handle.pid, pgid: run.handle.pgid });
    } catch (err) {
      // The pid/pgid backfill rejected AFTER the child spawned (transient DB
      // disconnect). The child SURVIVES — holding the shared credential home
      // and, for codex, the :1455 callback port — but the row is still `pending`
      // with pid: null. The boot reaper terminates BY pid, so it can't kill this
      // process; a same-company retry's `onExisting` also guards on pid != null,
      // so it would leave this child alive and spawn a SECOND one; a different
      // company retry gets a permanent 409. Terminate the child NOW, best-effort
      // — this frees the port even if the compensating status write also fails,
      // which is the load-bearing part.
      try {
        run.handle.terminate();
      } catch {
        /* best-effort */
      }
      // We throw before wiring the exit finalizer below — keep a rejecting
      // exitPromise from becoming an unhandled rejection.
      run.exitPromise.catch(() => {});
      // Best-effort mark failed so the single-flight slot isn't falsely held; if
      // this write also rejects we've already freed the port above. Rethrow the
      // ORIGINAL error (not any cleanup error).
      await deps.store.update(id, { status: "failed" }).catch(() => {});
      throw err;
    }

    let loginUrl: string;
    try {
      loginUrl = await run.urlPromise;
    } catch (err) {
      // The child SURVIVES URL-discovery failure (it keeps holding the shared
      // credential home and, for codex, the :1455 callback port) and the boot
      // reaper only sweeps `pending` rows — kill it now, best-effort.
      try {
        run.handle.terminate();
      } catch {
        /* best-effort */
      }
      // We throw before wiring the exit finalizer below — keep a rejecting
      // exitPromise from becoming an unhandled rejection.
      run.exitPromise.catch(() => {});
      // `login-url-timeout` is the runner's documented discovery-window
      // rejection (adapter-utils streaming-login). The UI treats failed and
      // timeout identically (VerifyStep), so `timeout` is contract-safe AND
      // more honest for that case; everything else stays `failed`.
      // Never leave a dangling `pending` row — it would falsely hold the lock.
      const status: ChallengeStatus =
        err instanceof Error && err.message === "login-url-timeout" ? "timeout" : "failed";
      await deps.store.update(id, { status });
      throw err;
    }
    await deps.store.update(id, { loginUrl });

    // Finalize asynchronously from the child's exit + credential evidence, BUT
    // bound the wait with a completion deadline (Codex round-7 P2). After the URL
    // is surfaced the child normally finalizes from its own exit (exit 0 +
    // credential → completed; else failed). If the user never completes the
    // browser flow — or closes the tab before the fire-and-forget cancel reaches
    // the server — the CLI can wait INDEFINITELY: the exit never fires, the
    // URL-discovery timer is already cleared, and the row would sit `pending`
    // forever while the child keeps the codex :1455 callback port and the global
    // (provider, authHome) slot → every OTHER company 409s until a restart. So
    // race the exit against a server-side deadline and, on elapse, kill the LIVE
    // child (this process's own handle → an unconditional terminate is correct
    // here; it is NOT a persisted, possibly-reused pid) and finalize `timeout`.
    const completion = (async () => {
      let settled = false;
      let cancelDeadline: (() => void) | null = null;

      // First-wins finalizer: the child's exit and the deadline can land ~together
      // (exit resolving as the timer fires). Only the FIRST outcome finalizes — we
      // never overwrite a completed/failed with `timeout` (or vice-versa) — and we
      // always clear the pending deadline timer so no timer/open-handle leaks past
      // completion.
      const finalize = async (status: ChallengeStatus): Promise<void> => {
        if (settled) return;
        settled = true;
        cancelDeadline?.();
        cancelDeadline = null;
        await deps.store.update(id, { status });
      };

      const deadlineHit = new Promise<"deadline">((resolve) => {
        cancelDeadline = setDeadlineTimer(() => resolve("deadline"), LOGIN_COMPLETION_DEADLINE_MS);
      });
      // A rejection handler is attached here, so the raw `exitPromise` never
      // becomes an unhandled rejection even when the deadline wins the race and we
      // stop awaiting the exit.
      const exited = run.exitPromise.then(
        (code) => ({ kind: "exit" as const, code }),
        () => ({ kind: "exit-error" as const }),
      );

      const outcome = await Promise.race([exited, deadlineHit]);
      if (outcome === "deadline") {
        try {
          run.handle.terminate();
        } catch {
          /* best-effort — the row is finalized regardless */
        }
        await finalize("timeout");
        return;
      }
      if (outcome.kind === "exit-error") {
        await finalize("failed");
        return;
      }
      const ok = outcome.code === 0 && (await deps.credentialPresent(args.provider, authHome));
      await finalize(ok ? "completed" : "failed");
    })().catch(() => {
      // Completion is fire-and-forget from the route's perspective; store writes
      // are best-effort, so a failed finalize must never surface as an unhandled
      // rejection.
    });

    return { challengeId: id, loginUrl, completion };
  }

  async function getStatus(
    companyId: string,
    id: string,
  ): Promise<{ status: ChallengeStatus; loginUrl: string | null } | null> {
    const row = await deps.store.get(id);
    // Company-scoped (Codex P1): a row owned by another company is reported
    // NOT FOUND — never leak existence (or the OAuth loginUrl) across tenants.
    if (!row || row.companyId !== companyId) return null;
    return { status: row.status, loginUrl: row.loginUrl };
  }

  async function cancel(companyId: string, id: string): Promise<void> {
    const row = await deps.store.get(id);
    // Cross-tenant cancel is a silent no-op — as if absent (no distinct error
    // that would leak existence), and NEVER terminate another company's child.
    if (!row || row.companyId !== companyId) return;
    // Identity-verified cancel (Codex round-7 P1). The UI fires cancel-on-unmount
    // (VerifyStep) with a challengeId the BROWSER retains across a server restart /
    // after the CLI already exited, so this row's persisted pid can belong to an
    // UNRELATED, reused-pid process by now. Two guards, mirroring reapOrphans /
    // onExisting so NO persisted-pid kill anywhere stays unconditional:
    //   (a) only a still-`pending` row's child is ours to signal — a terminal
    //       (completed/failed/timeout) row's pid is no longer ours; never kill it.
    //   (b) even a pending row routes through the SAME start-time identity check —
    //       a genuine same-session live child (start ≤ startedAt + tolerance) is
    //       still killed (no regression to legitimate live cancel), a reused pid is
    //       spared.
    // Release the slot (remove the row) regardless of whether the kill fired.
    if (row.status === "pending" && row.pid != null)
      deps.terminate(row.pid, row.pgid, { startedAt: row.startedAt });
    await deps.store.remove(id);
  }

  async function reapOrphans(): Promise<void> {
    const rows = await deps.store.listActive();
    for (const row of rows) {
      // Identity-verified terminate (Codex P1, round 6): these rows were persisted
      // by a PRIOR process, so the pid may have been reused after a crash + restart.
      // Passing `startedAt` makes the terminate impl kill ONLY when the target's OS
      // start time matches — a reused pid is left untouched. The row is removed
      // either way (releases the single-flight slot), exactly as before.
      if (row.pid != null) deps.terminate(row.pid, row.pgid, { startedAt: row.startedAt });
      await deps.store.remove(row.id);
    }
  }

  return { startChallenge, getStatus, cancel, reapOrphans };
}
