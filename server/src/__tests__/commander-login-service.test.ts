import { describe, it, expect, vi } from "vitest";
import {
  createCommanderLoginService,
  type ChallengeStore,
  type ChallengeRow,
} from "../services/commander-login.js";

/** In-memory ChallengeStore for lifecycle tests. */
function memStore(): ChallengeStore & { rows: Map<string, ChallengeRow> } {
  const rows = new Map<string, ChallengeRow>();
  return {
    rows,
    async insert(row) {
      rows.set(row.id, { ...row });
      return { ...row };
    },
    async findPending(provider, authHome) {
      for (const r of rows.values()) {
        if (r.provider === provider && r.authHome === authHome && r.status === "pending") return { ...r };
      }
      return null;
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
  const urlPromise = new Promise<string>((res, rej) => {
    resolveUrl = res;
    rejectUrl = rej;
  });
  const exitPromise = new Promise<number | null>((res) => (resolveExit = res));
  const handle = { child: {} as never, pid, pgid, startedAt: new Date(0), terminate: vi.fn() };
  return { run: { handle, urlPromise, exitPromise, authHome: "/home/.codex" }, resolveUrl, rejectUrl, resolveExit, handle };
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

  it("(b') same company re-start is idempotent (returns the existing challenge)", async () => {
    const f1 = fakeRun();
    const { svc } = makeService({ runLogin: () => f1.run });
    const p1 = svc.startChallenge({ companyId: "c1", provider: "openai", startedByUserId: "u1" });
    f1.resolveUrl("https://chatgpt.com/device?code=A");
    const first = await p1;
    const second = await svc.startChallenge({ companyId: "c1", provider: "openai", startedByUserId: "u1" });
    expect(second.challengeId).toBe(first.challengeId);
    expect(second.loginUrl).toBe("https://chatgpt.com/device?code=A");
  });

  it("(c) getStatus → completed on exit code 0 with the credential file present", async () => {
    const f = fakeRun();
    const { svc } = makeService({ runLogin: () => f.run, credentialPresent: async () => true });
    const startP = svc.startChallenge({ companyId: "c1", provider: "openai", startedByUserId: "u1" });
    f.resolveUrl("https://chatgpt.com/device?code=A");
    const { challengeId, completion } = await startP;
    f.resolveExit(0);
    await completion;
    expect((await svc.getStatus(challengeId))?.status).toBe("completed");
  });

  it("(c') getStatus → failed on exit code 0 but no credential file", async () => {
    const f = fakeRun();
    const { svc } = makeService({ runLogin: () => f.run, credentialPresent: async () => false });
    const startP = svc.startChallenge({ companyId: "c1", provider: "openai", startedByUserId: "u1" });
    f.resolveUrl("https://chatgpt.com/device?code=A");
    const { challengeId, completion } = await startP;
    f.resolveExit(0);
    await completion;
    expect((await svc.getStatus(challengeId))?.status).toBe("failed");
  });

  it("(c'') startChallenge rejects + marks failed when the URL never appears", async () => {
    const f = fakeRun();
    const { svc, store } = makeService({ runLogin: () => f.run });
    const startP = svc.startChallenge({ companyId: "c1", provider: "openai", startedByUserId: "u1" });
    f.rejectUrl(new Error("no-url"));
    await expect(startP).rejects.toThrow(/no-url/);
    // the pending row was finalized failed (not left dangling pending → no false lock)
    const rows = [...store.rows.values()];
    expect(rows.every((r) => r.status !== "pending")).toBe(true);
  });

  it("(d) cancel → terminateByPid + record removed", async () => {
    const f = fakeRun(333, 333);
    const { svc, store, terminate } = makeService({ runLogin: () => f.run });
    const startP = svc.startChallenge({ companyId: "c1", provider: "openai", startedByUserId: "u1" });
    f.resolveUrl("https://chatgpt.com/device?code=A");
    const { challengeId } = await startP;
    await svc.cancel(challengeId);
    expect(terminate).toHaveBeenCalledWith(333, 333);
    expect(store.rows.has(challengeId)).toBe(false);
  });

  it("(e) reapOrphans kills every persisted pending child and clears the rows", async () => {
    const f = fakeRun(444, 444);
    const { svc, store, terminate } = makeService({ runLogin: () => f.run });
    const startP = svc.startChallenge({ companyId: "c1", provider: "openai", startedByUserId: "u1" });
    f.resolveUrl("https://chatgpt.com/device?code=A");
    await startP;
    await svc.reapOrphans();
    expect(terminate).toHaveBeenCalledWith(444, 444);
    expect([...store.rows.values()].filter((r) => r.status === "pending")).toHaveLength(0);
  });
});
