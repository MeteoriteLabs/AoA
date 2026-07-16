import { spawnSync } from "node:child_process";

/**
 * Cross-platform terminate-by-PID primitive (Plan 3 / §6.2 Task 4, Codex P1 #9).
 *
 * The heartbeat reaper only marks DB rows failed; it cannot kill a *detached*
 * login child that survived a hard restart (its in-memory TrackedChildHandle —
 * and thus `terminate()` — is gone). So the login lifecycle persists pid/pgid
 * and, on `cancel`/`reapOrphans`, kills by PID here:
 *
 *  - POSIX: the login child is spawned `detached` (own process group, pgid===pid),
 *    so `process.kill(-pgid, "SIGKILL")` reaps the whole group (CLI + any helper
 *    it forked). Falls back to the bare pid when pgid is unknown.
 *  - Windows: `taskkill /PID <pid> /T /F` kills the tree forcefully.
 *
 * Never throws — a dead process (ESRCH) is the success case for a reaper.
 * The `platform`/`kill`/`runTaskkill` seams exist so the branch selection is
 * unit-testable without spawning anything.
 */
export interface TerminateByPidDeps {
  platform?: NodeJS.Platform;
  kill?: (pidOrGroup: number, signal: NodeJS.Signals | number) => void;
  runTaskkill?: (command: string, args: string[]) => void;
}

export function terminateByPid(pid: number, pgid: number | null, deps: TerminateByPidDeps = {}): void {
  if (!Number.isFinite(pid) || pid <= 0) return;
  const platform = deps.platform ?? process.platform;

  if (platform === "win32") {
    const runTaskkill = deps.runTaskkill ?? ((command, args) => void spawnSync(command, args));
    try {
      runTaskkill("taskkill", ["/PID", String(pid), "/T", "/F"]);
    } catch {
      // Process already gone / taskkill unavailable — reaper best-effort.
    }
    return;
  }

  const kill = deps.kill ?? ((target, signal) => process.kill(target, signal));
  const target = pgid != null && Number.isFinite(pgid) && pgid > 0 ? -pgid : pid;
  try {
    kill(target, "SIGKILL");
  } catch {
    // ESRCH (already dead) or EPERM — nothing to reap.
  }
}
