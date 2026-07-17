import { describe, it, expect, vi } from "vitest";
import {
  createCommanderLoginService,
  type ChallengeStore,
  type ChallengeRow,
} from "../services/commander-login.js";
import { terminateByPidIfMatches } from "../utils/terminate-process.js";

/**
 * In-memory ChallengeStore for lifecycle tests. `claim` is synchronous
 * in-process, so it is atomic by nature — it implements the same
 * find→decide→remove→insert contract the drizzle store runs under a
 * transaction + advisory lock.
 */
function memStore(): ChallengeStore & { rows: Map<string, ChallengeRow> } {
  const rows = new Map<string, ChallengeRow>();
  return {
    rows,
    async claim({ provider, authHome, row, onExisting }) {
      const existing =
        [...rows.values()].find(
          (r) => r.provider === provider && r.authHome === authHome && r.status === "pending",
        ) ?? null;
      if (existing) {
        onExisting({ ...existing }); // throws → abort, nothing inserted
        rows.delete(existing.id);
      }
      rows.set(row.id, { ...row });
      return { ...row };
    },
    async get(id) {
      const r = rows.get(id);
      return r ? { ...r } : null;
    },
    async update(id, patch) {
      const r = rows.get(id);
      if (r) rows.set(id, { ...r, ...patch });
    },
    async remove(id) {
      rows.delete(id);
    },
    async listActive() {
      return [...rows.values()].filter((r) => r.status === "pending").map((r) => ({ ...r }));
    },
  };
}

/** A controllable fake login run. */
function fakeRun(pid = 111, pgid = 111) {
  let resolveUrl!: (u: string) => void;
  let rejectUrl!: (e: Error) => void;
  let resolveExit!: (code: number | null) => void;
  let rejectExit!: (e: Error) => void;
  const urlPromise = new Promise<string>((res, rej) => {
    resolveUrl = res;
    rejectUrl = rej;
  });
  const exitPromise = new Promise<number | null>((res, rej) => {
    resolveExit = res;
    rejectExit = rej;
  });
  const handle = { child: {} as never, pid, pgid, startedAt: new Date(0), terminate: vi.fn() };
  return {
    run: { handle, urlPromise, exitPromise, authHome: "/home/.codex" },
    resolveUrl,
    rejectUrl,
    resolveExit,
    rejectExit,
    handle,
  };
}

function makeService(overrides: Partial<Parameters<typeof createCommanderLoginService>[0]> = {}) {
  const store = memStore();
  const terminate = vi.fn();
  let seq = 0;
  const svc = createCommanderLoginService({
    store,
    resolveAuthHome: () => "/home/.codex",
    runLogin: () => fakeRun().run,
    credentialPresent: async () => true,
    terminate,
    newId: () => `ch-${++seq}`,
    env: () => ({}) as never,
    ...overrides,
  });
  return { svc, store, terminate };
}

describe("commander-login service (Plan 3 T4)", () => {
  it("(a) startChallenge inserts a durable pending row with pid/pgid + loginUrl", async () => {
    const f = fakeRun(222, 222);
    const { svc, store } = makeService({ runLogin: () => f.run });
    const startP = svc.startChallenge({ companyId: "c1", provider: "openai", startedByUserId: "u1" });
    f.resolveUrl("https://chatgpt.com/device?code=Z9");
    const { challengeId, loginUrl } = await startP;
    expect(loginUrl).toBe("https://chatgpt.com/device?code=Z9");
    const row = store.rows.get(challengeId)!;
    expect(row).toMatchObject({
      companyId: "c1",
      provider: "openai",
      authHome: "/home/.codex",
      pid: 222,
      pgid: 222,
      status: "pending",
      loginUrl: "https://chatgpt.com/device?code=Z9",
    });
  });

  it("(a') the pending row is durable BEFORE the child spawns (claim → spawn → pid update)", async () => {
    // Codex P1 #3 — check-then-act (findPending → spawn → insert) let two
    // overlapping starts both spawn. The claim must commit the row first,
    // then spawn, then backfill pid/pgid.
    const order: string[] = [];
    const store = memStore();
    const baseClaim = store.claim.bind(store);
    store.claim = async (args) => {
      order.push("claim");
      return baseClaim(args);
    };
    const baseUpdate = store.update.bind(store);
    store.update = async (id, patch) => {
      order.push(`update:${Object.keys(patch).sort().join(",")}`);
      return baseUpdate(id, patch);
    };
    const f = fakeRun(888, 888);
    const svc = createCommanderLoginService({
      store,
      resolveAuthHome: () => "/home/.codex",
      runLogin: () => {
        order.push("spawn");
        return f.run;
      },
      credentialPresent: async () => true,
      terminate: vi.fn(),
      newId: () => "ch-1",
      env: () => ({}) as never,
    });
    const startP = svc.startChallenge({ companyId: "c1", provider: "openai", startedByUserId: "u1" });
    f.resolveUrl("https://chatgpt.com/device?code=A");
    await startP;
    expect(order.slice(0, 3)).toEqual(["claim", "spawn", "update:pgid,pid"]);
    // At claim time the row had no pid yet; the post-spawn update backfilled it.
    expect(store.rows.get("ch-1")).toMatchObject({ pid: 888, pgid: 888 });
  });

  it("(a'') spawn failure marks the already-durable row failed and rethrows", async () => {
    const store = memStore();
    const svc = createCommanderLoginService({
      store,
      resolveAuthHome: () => "/home/.codex",
      runLogin: () => {
        throw new Error("spawn-fail");
      },
      credentialPresent: async () => true,
      terminate: vi.fn(),
      newId: () => "ch-1",
      env: () => ({}) as never,
    });
    await expect(
      svc.startChallenge({ companyId: "c1", provider: "openai", startedByUserId: "u1" }),
    ).rejects.toThrow(/spawn-fail/);
    const rows = [...store.rows.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("failed"); // no dangling pending row holding the slot
  });

  it("(b) rejects a second start for a DIFFERENT company sharing (provider, authHome)", async () => {
    const f1 = fakeRun();
    const { svc } = makeService({ runLogin: () => f1.run });
    const p1 = svc.startChallenge({ companyId: "c1", provider: "openai", startedByUserId: "u1" });
    f1.resolveUrl("https://chatgpt.com/device?code=A");
    await p1;
    await expect(
      svc.startChallenge({ companyId: "c2", provider: "openai", startedByUserId: "u2" }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("(b') same company re-start cancels the stale child (frees :1455) and starts fresh", async () => {
    const f1 = fakeRun(555, 555);
    const f2 = fakeRun(666, 666);
    let call = 0;
    const store = memStore();
    const terminate = vi.fn();
    let seq = 0;
    const svc = createCommanderLoginService({
      store,
      resolveAuthHome: () => "/home/.codex",
      runLogin: () => (call++ === 0 ? f1.run : f2.run),
      credentialPresent: async () => true,
      terminate,
      newId: () => `ch-${++seq}`,
      env: () => ({}) as never,
    });
    const p1 = svc.startChallenge({ companyId: "c1", provider: "openai", startedByUserId: "u1" });
    f1.resolveUrl("https://chatgpt.com/device?code=A");
    const first = await p1;

    // Capture the first (soon-to-be-existing) row's startedAt — the takeover now
    // forwards it as the identity `expected` so a reused pid would be skipped.
    const firstRow = store.rows.get(first.challengeId)!;

    const p2 = svc.startChallenge({ companyId: "c1", provider: "openai", startedByUserId: "u1" });
    f2.resolveUrl("https://chatgpt.com/device?code=B");
    const second = await p2;

    // The stale child was killed THROUGH the identity-verified path (3rd arg),
    // exactly like the reaper — not the old unconditional 2-arg kill.
    expect(terminate).toHaveBeenCalledWith(555, 555, { startedAt: firstRow.startedAt });
    expect(second.challengeId).not.toBe(first.challengeId); // a fresh challenge
    expect(second.loginUrl).toBe("https://chatgpt.com/device?code=B");
    // Only the new row survives — no orphaned pending row holding the lock.
    expect([...store.rows.values()].filter((r) => r.status === "pending")).toHaveLength(1);
  });

  it("(b'') cross-company start is 409 and does NOT kill the other company's child", async () => {
    const f1 = fakeRun(777, 777);
    const { svc, terminate, store } = makeService({ runLogin: () => f1.run });
    const p1 = svc.startChallenge({ companyId: "c1", provider: "openai", startedByUserId: "u1" });
    f1.resolveUrl("https://chatgpt.com/device?code=A");
    await p1;
    await expect(
      svc.startChallenge({ companyId: "c2", provider: "openai", startedByUserId: "u2" }),
    ).rejects.toMatchObject({ status: 409 });
    expect(terminate).not.toHaveBeenCalled();
    // The conflicting claim aborted — c1's pending row is untouched, no c2 row.
    const pending = [...store.rows.values()].filter((r) => r.status === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.companyId).toBe("c1");
  });

  // ── Single-flight TAKEOVER identity check (Codex P1 round-6 follow-on) ──
  // The takeover kill in `onExisting` now routes through the SAME start-time
  // identity check the reaper uses. Rationale: the boot reaper (`reapOrphans`)
  // is fired UN-awaited at startup (index.ts), so a same-(provider,authHome)
  // start served early in boot can take over a DURABLE row persisted by a PRIOR
  // process whose pid was since reused — an unconditional kill there would hit an
  // arbitrary victim (the exact harm the reaper fix avoids). These wire
  // `terminate` to the real `terminateByPidIfMatches` with injected start-time +
  // kill seams (no real processes).
  function takeoverWiredService(opts: {
    queryStartTime: (pid: number) => Date | null;
    kill: (target: number, signal: NodeJS.Signals | number) => void;
  }) {
    const store = memStore();
    const fresh = fakeRun(9999, 9999); // the NEW child the takeover spawns
    const svc = createCommanderLoginService({
      store,
      resolveAuthHome: () => "/home/.codex",
      runLogin: () => fresh.run,
      credentialPresent: async () => true,
      terminate: (pid, pgid, expected) => {
        // The takeover always passes `expected` (like the reaper); only `cancel`
        // omits it, and these tests never cancel.
        if (expected) {
          terminateByPidIfMatches(pid, pgid, expected, {
            platform: "linux",
            kill: opts.kill,
            queryStartTime: opts.queryStartTime,
          });
        }
      },
      newId: () => "ch-fresh",
      env: () => ({}) as never,
    });
    return { svc, store, fresh };
  }

  function seedDurableRow(store: ReturnType<typeof memStore>, startedAt: Date, pid = 4242) {
    store.rows.set("durable", {
      id: "durable",
      companyId: "c1",
      provider: "openai",
      authHome: "/home/.codex",
      loginUrl: null,
      pid,
      pgid: pid,
      status: "pending",
      startedByUserId: "u1",
      startedAt,
    });
  }

  it("(b3) takeover of a DURABLE row whose pid was REUSED does NOT kill, but still reclaims the slot", async () => {
    const startedAt = new Date("2026-07-17T10:00:00.000Z");
    const kill = vi.fn();
    const { svc, store, fresh } = takeoverWiredService({
      // Same pid, but it now maps to a process started 60s later → reused after a
      // crash + restart. The un-awaited boot reap means the takeover path can hit
      // this exact case, so it must skip the kill just like the reaper does.
      queryStartTime: () => new Date(startedAt.getTime() + 60_000),
      kill,
    });
    seedDurableRow(store, startedAt);
    const startP = svc.startChallenge({ companyId: "c1", provider: "openai", startedByUserId: "u1" });
    fresh.resolveUrl("https://chatgpt.com/device?code=NEW");
    await startP;
    expect(kill).not.toHaveBeenCalled(); // reused pid spared on the takeover path too
    // The slot is still taken over regardless of the skipped kill: the durable
    // row is removed and replaced by the fresh challenge.
    expect(store.rows.has("durable")).toBe(false);
    const pending = [...store.rows.values()].filter((r) => r.status === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.id).toBe("ch-fresh");
  });

  it("(b4) takeover of a GENUINE child (start time within tolerance) STILL kills — legitimate same-company takeover frees :1455", async () => {
    const startedAt = new Date("2026-07-17T10:00:00.000Z");
    const kill = vi.fn();
    const { svc, store, fresh } = takeoverWiredService({
      // The existing child's pid maps to a process started just after the recorded
      // startedAt (within tolerance) → genuinely ours (this-session child or a
      // real orphan) → kill it so the codex :1455 callback port is freed.
      queryStartTime: () => new Date(startedAt.getTime() + 200),
      kill,
    });
    seedDurableRow(store, startedAt); // pid 4242, pgid 4242
    const startP = svc.startChallenge({ companyId: "c1", provider: "openai", startedByUserId: "u1" });
    fresh.resolveUrl("https://chatgpt.com/device?code=NEW");
    await startP;
    expect(kill).toHaveBeenCalledWith(-4242, "SIGKILL"); // group kill → :1455 freed
    expect(store.rows.has("durable")).toBe(false); // slot reclaimed by the fresh login
  });

  it("(c) getStatus → completed on exit code 0 with the credential file present", async () => {
    const f = fakeRun();
    const { svc } = makeService({ runLogin: () => f.run, credentialPresent: async () => true });
    const startP = svc.startChallenge({ companyId: "c1", provider: "openai", startedByUserId: "u1" });
    f.resolveUrl("https://chatgpt.com/device?code=A");
    const { challengeId, completion } = await startP;
    f.resolveExit(0);
    await completion;
    expect((await svc.getStatus("c1", challengeId))?.status).toBe("completed");
  });

  it("(c') getStatus → failed on exit code 0 but no credential file", async () => {
    const f = fakeRun();
    const { svc } = makeService({ runLogin: () => f.run, credentialPresent: async () => false });
    const startP = svc.startChallenge({ companyId: "c1", provider: "openai", startedByUserId: "u1" });
    f.resolveUrl("https://chatgpt.com/device?code=A");
    const { challengeId, completion } = await startP;
    f.resolveExit(0);
    await completion;
    expect((await svc.getStatus("c1", challengeId))?.status).toBe("failed");
  });

  it("(c'') startChallenge rejects + marks failed + TERMINATES the child when the URL never appears", async () => {
    const f = fakeRun(999, 999);
    const { svc, store } = makeService({ runLogin: () => f.run });
    const startP = svc.startChallenge({ companyId: "c1", provider: "openai", startedByUserId: "u1" });
    f.rejectUrl(new Error("no-url"));
    await expect(startP).rejects.toThrow(/no-url/);
    // the pending row was finalized failed (not left dangling pending → no false lock)
    const rows = [...store.rows.values()];
    expect(rows.every((r) => r.status !== "pending")).toBe(true);
    expect(rows.some((r) => r.status === "failed")).toBe(true);
    // Codex P1 #2 — the child survives URL-discovery failure (holding the
    // credential home + codex :1455 port) unless we kill it here: the boot
    // reaper only sweeps `pending` rows, and this row is now `failed`.
    expect(f.handle.terminate).toHaveBeenCalledTimes(1);
  });

  it("(c''') URL discovery timeout finalizes as `timeout` (UI treats it like failed) + terminates", async () => {
    const f = fakeRun();
    const { svc, store } = makeService({ runLogin: () => f.run });
    const startP = svc.startChallenge({ companyId: "c1", provider: "openai", startedByUserId: "u1" });
    f.rejectUrl(new Error("login-url-timeout")); // streaming-login's documented discovery-window rejection
    await expect(startP).rejects.toThrow(/login-url-timeout/);
    const rows = [...store.rows.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("timeout");
    expect(f.handle.terminate).toHaveBeenCalledTimes(1);
  });

  it("(c'''') a rejecting exitPromise after URL failure is swallowed (no unhandled rejection)", async () => {
    const f = fakeRun();
    let exitHandled = false;
    const originalCatch = f.run.exitPromise.catch.bind(f.run.exitPromise);
    (f.run.exitPromise as { catch: unknown }).catch = (fn: (e: unknown) => unknown) => {
      exitHandled = true;
      return originalCatch(fn);
    };
    const { svc } = makeService({ runLogin: () => f.run });
    const startP = svc.startChallenge({ companyId: "c1", provider: "openai", startedByUserId: "u1" });
    f.rejectUrl(new Error("no-url"));
    await expect(startP).rejects.toThrow(/no-url/);
    expect(exitHandled).toBe(true); // service attached a no-op catch before throwing
    f.rejectExit(new Error("exit-after-kill"));
    await new Promise((r) => setImmediate(r)); // flush — would surface as unhandledRejection otherwise
  });

  it("(d) cancel → terminateByPid + record removed", async () => {
    const f = fakeRun(333, 333);
    const { svc, store, terminate } = makeService({ runLogin: () => f.run });
    const startP = svc.startChallenge({ companyId: "c1", provider: "openai", startedByUserId: "u1" });
    f.resolveUrl("https://chatgpt.com/device?code=A");
    const { challengeId } = await startP;
    await svc.cancel("c1", challengeId);
    expect(terminate).toHaveBeenCalledWith(333, 333);
    expect(store.rows.has(challengeId)).toBe(false);
  });

  it("(d') CROSS-TENANT cancel is a silent no-op — child NOT terminated, row kept (Codex P1 #1)", async () => {
    const f = fakeRun(333, 333);
    const { svc, store, terminate } = makeService({ runLogin: () => f.run });
    const startP = svc.startChallenge({ companyId: "c1", provider: "openai", startedByUserId: "u1" });
    f.resolveUrl("https://chatgpt.com/device?code=A");
    const { challengeId } = await startP;
    // Founder of company c2 guesses/leaks c1's challenge id.
    await expect(svc.cancel("c2", challengeId)).resolves.toBeUndefined();
    expect(terminate).not.toHaveBeenCalled();
    expect(store.rows.get(challengeId)?.status).toBe("pending"); // login still running
  });

  it("(d'') CROSS-TENANT getStatus is NOT FOUND — never leaks status or the OAuth loginUrl (Codex P1 #1)", async () => {
    const f = fakeRun();
    const { svc } = makeService({ runLogin: () => f.run });
    const startP = svc.startChallenge({ companyId: "c1", provider: "openai", startedByUserId: "u1" });
    f.resolveUrl("https://chatgpt.com/device?code=SECRET");
    const { challengeId } = await startP;
    expect(await svc.getStatus("c2", challengeId)).toBeNull(); // indistinguishable from absent
    expect((await svc.getStatus("c1", challengeId))?.loginUrl).toBe(
      "https://chatgpt.com/device?code=SECRET",
    );
  });

  it("(e) reapOrphans terminates each persisted pending child WITH its recorded identity and clears the rows", async () => {
    const f = fakeRun(444, 444);
    const { svc, store, terminate } = makeService({ runLogin: () => f.run });
    const startP = svc.startChallenge({ companyId: "c1", provider: "openai", startedByUserId: "u1" });
    f.resolveUrl("https://chatgpt.com/device?code=A");
    await startP;
    // Capture the durable row's startedAt before the reaper removes it — the
    // reaper must forward it so the terminate impl can reject a reused pid.
    const pendingRow = [...store.rows.values()].find((r) => r.status === "pending")!;
    await svc.reapOrphans();
    // Codex P1 round 6: the risky boot path forwards { startedAt } (unlike live
    // cancel, which passes only pid/pgid).
    expect(terminate).toHaveBeenCalledWith(444, 444, { startedAt: pendingRow.startedAt });
    expect([...store.rows.values()].filter((r) => r.status === "pending")).toHaveLength(0);
  });

  // End-to-end reaper behavior wired to the REAL identity-verifying terminate,
  // with an injected start-time query + kill seam (no real processes). Proves the
  // PID-reuse guard end to end: decision (kill vs skip) AND row removal.
  function reaperWiredService(opts: {
    queryStartTime: (pid: number) => Date | null;
    kill: (target: number, signal: NodeJS.Signals | number) => void;
  }) {
    const store = memStore();
    const svc = createCommanderLoginService({
      store,
      resolveAuthHome: () => "/home/.codex",
      runLogin: () => fakeRun().run,
      credentialPresent: async () => true,
      terminate: (pid, pgid, expected) => {
        // Live cancel (no `expected`) would kill directly; the reaper always
        // passes `expected`, so this test only exercises the verified path.
        if (expected) {
          terminateByPidIfMatches(pid, pgid, expected, {
            platform: "linux",
            kill: opts.kill,
            queryStartTime: opts.queryStartTime,
          });
        }
      },
      newId: () => "ch-x",
      env: () => ({}) as never,
    });
    return { svc, store };
  }

  function seedPendingRow(store: ReturnType<typeof memStore>, startedAt: Date) {
    store.rows.set("orphan", {
      id: "orphan",
      companyId: "c1",
      provider: "openai",
      authHome: "/home/.codex",
      loginUrl: null,
      pid: 4242,
      pgid: 4242,
      status: "pending",
      startedByUserId: "u1",
      startedAt,
    });
  }

  it("(e2) reaper does NOT kill a REUSED pid (queried start time is later than startedAt) but still removes the row", async () => {
    const startedAt = new Date("2026-07-17T10:00:00.000Z");
    const kill = vi.fn();
    const { svc, store } = reaperWiredService({
      // The pid now maps to a process that started 60s later → reused after a
      // crash + restart. Killing it would hit an unrelated victim.
      queryStartTime: () => new Date(startedAt.getTime() + 60_000),
      kill,
    });
    seedPendingRow(store, startedAt);
    await svc.reapOrphans();
    expect(kill).not.toHaveBeenCalled(); // the exact harm avoided
    expect(store.rows.has("orphan")).toBe(false); // slot still released
  });

  it("(e3) reaper KILLS the genuine orphan (queried start time matches startedAt) and removes the row", async () => {
    const startedAt = new Date("2026-07-17T10:00:00.000Z");
    const kill = vi.fn();
    const { svc, store } = reaperWiredService({
      queryStartTime: () => new Date(startedAt.getTime() + 200), // our child, spawned just after
      kill,
    });
    seedPendingRow(store, startedAt);
    await svc.reapOrphans();
    expect(kill).toHaveBeenCalledWith(-4242, "SIGKILL"); // group kill of the real orphan
    expect(store.rows.has("orphan")).toBe(false);
  });

  it("(e4) reaper does NOT kill when identity is unestablished (query returns null) but still removes the row", async () => {
    const startedAt = new Date("2026-07-17T10:00:00.000Z");
    const kill = vi.fn();
    const { svc, store } = reaperWiredService({
      queryStartTime: () => null, // process gone / access denied / unparseable
      kill,
    });
    seedPendingRow(store, startedAt);
    await svc.reapOrphans();
    expect(kill).not.toHaveBeenCalled(); // conservative: never kill an unverifiable pid
    expect(store.rows.has("orphan")).toBe(false);
  });

  it("(f) pid-backfill rejection TERMINATES the surviving child, marks the row failed, and rethrows (Codex P1 follow-on)", async () => {
    // The atomic claim inserts a durable pending row with pid: null, then the
    // child spawns, then the pid/pgid backfill runs. If that backfill rejects
    // (transient DB disconnect) the child is ALREADY alive — holding the shared
    // credential home + codex :1455 callback port — but the row stays `pending`
    // with pid: null, which the boot reaper can't kill BY pid. So the service
    // must terminate the child here-and-now.
    const f = fakeRun(1234, 1234);
    const store = memStore();
    const baseUpdate = store.update.bind(store);
    store.update = async (id, patch) => {
      if ("pid" in patch) throw new Error("db-disconnect");
      return baseUpdate(id, patch);
    };
    let exitHandled = false;
    const originalCatch = f.run.exitPromise.catch.bind(f.run.exitPromise);
    (f.run.exitPromise as { catch: unknown }).catch = (fn: (e: unknown) => unknown) => {
      exitHandled = true;
      return originalCatch(fn);
    };
    const svc = createCommanderLoginService({
      store,
      resolveAuthHome: () => "/home/.codex",
      runLogin: () => f.run,
      credentialPresent: async () => true,
      terminate: vi.fn(),
      newId: () => "ch-1",
      env: () => ({}) as never,
    });
    await expect(
      svc.startChallenge({ companyId: "c1", provider: "openai", startedByUserId: "u1" }),
    ).rejects.toThrow(/db-disconnect/); // the ORIGINAL backfill error propagates
    expect(f.handle.terminate).toHaveBeenCalledTimes(1); // child killed → :1455 freed
    // The row is finalized `failed` — the single-flight slot is released, not
    // left dangling as a null-pid `pending` row that nothing can clear or kill.
    const rows = [...store.rows.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("failed");
    expect(exitHandled).toBe(true); // exitPromise neutralized before throwing
    f.rejectExit(new Error("exit-after-kill"));
    await new Promise((r) => setImmediate(r)); // would surface as unhandledRejection otherwise
  });

  it("(f') pid-backfill rejection still terminates the child even when the failed-status write ALSO rejects", async () => {
    // Worst case: the DB is fully unreachable, so both the pid backfill AND the
    // compensating `failed` status write reject. Cleanup is best-effort — the
    // terminate (the load-bearing bit that frees the port) must still fire, and
    // the ORIGINAL error must propagate (the status-write rejection is swallowed).
    const f = fakeRun(1234, 1234);
    const store = memStore();
    const baseUpdate = store.update.bind(store);
    store.update = async (id, patch) => {
      if ("pid" in patch) throw new Error("backfill-failed");
      if (patch.status === "failed") throw new Error("status-write-failed");
      return baseUpdate(id, patch);
    };
    const svc = createCommanderLoginService({
      store,
      resolveAuthHome: () => "/home/.codex",
      runLogin: () => f.run,
      credentialPresent: async () => true,
      terminate: vi.fn(),
      newId: () => "ch-1",
      env: () => ({}) as never,
    });
    await expect(
      svc.startChallenge({ companyId: "c1", provider: "openai", startedByUserId: "u1" }),
    ).rejects.toThrow(/backfill-failed/); // original error, NOT the swallowed status-write one
    expect(f.handle.terminate).toHaveBeenCalledTimes(1); // best-effort cleanup still killed the child
  });

  it("(g) reapOrphans REMOVES a null-pid pending row (releases the lock) without trying to terminate", async () => {
    // A crash in the pre-backfill window (or a backfill-failure whose status
    // write also failed) leaves a durable `pending` row with pid: null. The
    // reaper can't kill a process it can't identify, but it MUST still clear the
    // row to free the single-flight slot (otherwise every future login 409s).
    const store = memStore();
    const terminate = vi.fn();
    const svc = createCommanderLoginService({
      store,
      resolveAuthHome: () => "/home/.codex",
      runLogin: () => fakeRun().run,
      credentialPresent: async () => true,
      terminate,
      newId: () => "ch-x",
      env: () => ({}) as never,
    });
    store.rows.set("orphan", {
      id: "orphan",
      companyId: "c1",
      provider: "openai",
      authHome: "/home/.codex",
      loginUrl: null,
      pid: null,
      pgid: null,
      status: "pending",
      startedByUserId: "u1",
      startedAt: new Date(0),
    });
    await svc.reapOrphans();
    expect(terminate).not.toHaveBeenCalled(); // nothing to kill — pid is null
    expect(store.rows.has("orphan")).toBe(false); // but the slot is released
  });

  it("(g') reapOrphans handles a MIXED batch: terminates the pid row, skip-terminates but still removes the null-pid row", async () => {
    const store = memStore();
    const terminate = vi.fn();
    const svc = createCommanderLoginService({
      store,
      resolveAuthHome: () => "/home/.codex",
      runLogin: () => fakeRun().run,
      credentialPresent: async () => true,
      terminate,
      newId: () => "ch-x",
      env: () => ({}) as never,
    });
    store.rows.set("with-pid", {
      id: "with-pid",
      companyId: "c1",
      provider: "openai",
      authHome: "/home/.codex",
      loginUrl: null,
      pid: 4321,
      pgid: 4321,
      status: "pending",
      startedByUserId: "u1",
      startedAt: new Date(0),
    });
    store.rows.set("null-pid", {
      id: "null-pid",
      companyId: "c2",
      provider: "anthropic",
      authHome: "/home/.claude",
      loginUrl: null,
      pid: null,
      pgid: null,
      status: "pending",
      startedByUserId: "u2",
      startedAt: new Date(0),
    });
    await svc.reapOrphans();
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(terminate).toHaveBeenCalledWith(4321, 4321, { startedAt: new Date(0) });
    expect([...store.rows.values()].filter((r) => r.status === "pending")).toHaveLength(0);
  });
});
