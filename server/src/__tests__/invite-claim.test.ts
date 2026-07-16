import { describe, it, expect, vi, beforeEach } from "vitest";
import { drizzleOperatorStubs, makeTableProxy } from "./helpers/drizzle-mock.js";

vi.mock("drizzle-orm", () => drizzleOperatorStubs());
vi.mock("@armyofagents/db", () => ({
  invites: makeTableProxy("invites"),
  joinRequests: makeTableProxy("join_requests"),
}));
const emitHubItem = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../services/hub-source-producers.js", () => ({
  emitHubItem,
  buildJoinRequestHubEmit: (row: unknown) => ({ row }),
}));

import { claimInviteAndFileJoinRequest } from "../services/invite-claim.js";

/**
 * Mock tx: update().set().where() resolves; insert().values(v).onConflictDoNothing().returning()
 * yields `insertResult`; select().from().where() (reselect) yields `reselectResult`.
 */
function makeDb(opts: { insertResult: unknown[]; reselectResult?: unknown[] }) {
  const inserted: unknown[] = [];
  const tx = {
    update: () => ({ set: () => ({ where: async () => {} }) }),
    insert: () => ({
      values: (v: unknown) => {
        inserted.push(v);
        return { onConflictDoNothing: () => ({ returning: async () => opts.insertResult }) };
      },
    }),
    select: () => ({ from: () => ({ where: async () => opts.reselectResult ?? [] }) }),
  };
  const db = { transaction: async (cb: (t: unknown) => Promise<unknown>) => cb(tx), _inserted: inserted } as never;
  return db;
}

const base = { inviteId: "inv1", companyId: "c2", userId: "u1", email: "u@x.com", requestIp: "127.0.0.1" };

describe("claimInviteAndFileJoinRequest (tokenless invited entry)", () => {
  beforeEach(() => emitHubItem.mockClear());

  it("files a pending_approval human join_request and emits the hub item on a fresh insert", async () => {
    const db = makeDb({ insertResult: [{ id: "jr1", status: "pending_approval", requestType: "human", requestingUserId: "u1" }] });
    const r = await claimInviteAndFileJoinRequest(db, base);
    expect(r).toEqual({ id: "jr1", status: "pending_approval" });
    expect((db as unknown as { _inserted: Record<string, unknown>[] })._inserted[0]).toMatchObject({
      inviteId: "inv1",
      companyId: "c2",
      requestType: "human",
      status: "pending_approval",
      requestingUserId: "u1",
      requestEmailSnapshot: "u@x.com",
    });
    expect(emitHubItem).toHaveBeenCalledTimes(1);
  });

  it("on a unique-conflict, re-selects the winner and does NOT double-emit", async () => {
    const db = makeDb({
      insertResult: [], // conflict
      reselectResult: [{ id: "winner", status: "pending_approval", requestType: "human", requestingUserId: "u1" }],
    });
    const r = await claimInviteAndFileJoinRequest(db, base);
    expect(r.id).toBe("winner");
    expect(emitHubItem).not.toHaveBeenCalled(); // only fresh inserts emit
  });

  it("rejects when the conflict winner is a different principal or an agent request", async () => {
    const db = makeDb({
      insertResult: [],
      reselectResult: [{ id: "other", status: "pending_approval", requestType: "agent", requestingUserId: null }],
    });
    await expect(claimInviteAndFileJoinRequest(db, base)).rejects.toThrow();
  });
});
