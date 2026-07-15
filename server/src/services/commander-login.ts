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

export interface ChallengeStore {
  insert(row: ChallengeRow): Promise<ChallengeRow>;
  /** The single pending challenge for a (provider, authHome), across ALL companies. */
  findPending(provider: CommanderLoginProvider, authHome: string): Promise<ChallengeRow | null>;
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
  getStatus(id: string): Promise<{ status: ChallengeStatus; loginUrl: string | null } | null>;
  cancel(id: string): Promise<void>;
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

    // Single-flight per (provider, authHome). A pending challenge owned by
    // ANOTHER company blocks (409). For the SAME company, a re-attempt must not
    // spawn a second child — two `codex login` children fight over the local
    // callback port (:1455) and a stale PKCE URL then silently fails. So we
    // cancel the prior child (free the port) and start ONE clean login.
    const existing = await deps.store.findPending(args.provider, authHome);
    if (existing) {
      if (existing.companyId !== args.companyId) {
        throw new LoginChallengeConflictError(
          `another company is already signing in with ${args.provider} at ${authHome}`,
        );
      }
      if (existing.pid != null) deps.terminate(existing.pid, existing.pgid);
      await deps.store.remove(existing.id);
    }

    const id = deps.newId();
    const run = deps.runLogin(args.provider, { runId: id, env });

    await deps.store.insert({
      id,
      companyId: args.companyId,
      provider: args.provider,
      authHome,
      loginUrl: null,
      pid: run.handle.pid,
      pgid: run.handle.pgid,
      status: "pending",
      startedByUserId: args.startedByUserId,
      startedAt: now(),
    });

    let loginUrl: string;
    try {
      loginUrl = await run.urlPromise;
    } catch (err) {
      // Never leave a dangling `pending` row — it would falsely hold the lock.
      await deps.store.update(id, { status: "failed" });
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
    id: string,
  ): Promise<{ status: ChallengeStatus; loginUrl: string | null } | null> {
    const row = await deps.store.get(id);
    return row ? { status: row.status, loginUrl: row.loginUrl } : null;
  }

  async function cancel(id: string): Promise<void> {
    const row = await deps.store.get(id);
    if (!row) return;
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
