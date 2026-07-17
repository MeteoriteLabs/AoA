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
  terminate: (pid: number, pgid: number | null) => void;
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

export function createCommanderLoginService(deps: CommanderLoginServiceDeps): CommanderLoginService {
  const now = deps.now ?? (() => new Date());

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
        if (existing.pid != null) deps.terminate(existing.pid, existing.pgid);
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

    // Finalize asynchronously from the child's exit + credential evidence.
    const completion = run.exitPromise
      .then(async (code) => {
        const ok = code === 0 && (await deps.credentialPresent(args.provider, authHome));
        await deps.store.update(id, { status: ok ? "completed" : "failed" });
      })
      .catch(async () => {
        await deps.store.update(id, { status: "failed" });
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
    if (row.pid != null) deps.terminate(row.pid, row.pgid);
    await deps.store.remove(id);
  }

  async function reapOrphans(): Promise<void> {
    const rows = await deps.store.listActive();
    for (const row of rows) {
      if (row.pid != null) deps.terminate(row.pid, row.pgid);
      await deps.store.remove(row.id);
    }
  }

  return { startChallenge, getStatus, cancel, reapOrphans };
}
