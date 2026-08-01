import { describe, expect, it, vi } from "vitest";
import { makeTableProxy, drizzleOperatorStubs } from "./helpers/drizzle-mock.js";
vi.mock("@armyofagents/db", async () => ({ executionTargets: makeTableProxy("execution_targets") }));
vi.mock("drizzle-orm", () => drizzleOperatorStubs());
import { registerWorkerHeartbeat, listExecutionTargets } from "../services/execution-targets.js";

describe("listExecutionTargets (P5 finding #1 — no system-row leak; L-c: scoped in SQL)", () => {
  // Thenable-with-.where: the OLD (`await …from()`) and NEW (`…from().where()`)
  // paths both resolve rows; the discriminator is whether `.where` ran.
  function dbWith(scopedRows: unknown[]) {
    const where = vi.fn().mockResolvedValue(scopedRows);
    const fromResult: unknown = Object.assign(Promise.resolve(scopedRows), { where });
    const from = vi.fn().mockReturnValue(fromResult);
    const select = vi.fn().mockReturnValue({ from });
    return {
      db: { select } as unknown as Parameters<typeof listExecutionTargets>[0],
      where,
      select,
    };
  }

  it("scopes to the org's own rows via a WHERE clause (eq), not a full scan + JS filter", async () => {
    const { db, where } = dbWith([
      { id: "a-ded", organizationId: "org-A", slug: "a-box", kind: "dedicated_worker" },
    ]);
    const out = (await listExecutionTargets(db, "org-A")) as Array<{
      id: string;
      organizationId: string | null;
    }>;
    expect(where).toHaveBeenCalledWith("eq"); // eq(organizationId, orgId) — SQL scope
    expect(out.map((t) => t.id)).toEqual(["a-ded"]);
  });

  it("returns nothing for a null org WITHOUT scanning the table (early-return before the query)", async () => {
    const { db, select } = dbWith([]);
    expect(await listExecutionTargets(db, null)).toEqual([]);
    expect(select).not.toHaveBeenCalled(); // no ambient system-row scan for a null org
  });
});

describe("registerWorkerHeartbeat", () => {
  it("scopes the update to the target ID (never the slug) and reports rows updated", async () => {
    const where = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: "t-1" }]) });
    const set = vi.fn().mockReturnValue({ where });
    const db = { update: vi.fn().mockReturnValue({ set }) } as unknown as Parameters<typeof registerWorkerHeartbeat>[0];
    const res = await registerWorkerHeartbeat(db, { targetId: "t-1", status: "active", capabilities: { runtimes: ["runsc"] } });
    expect(db.update).toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: "active" }));
    // "and" is the stubbed operator return; proves .where was given a COMPOSED
    // predicate — and(eq(id), ne(status, 'disabled')) — not a bare id equality.
    // The status guard keeps a disabled target from being resurrected by its
    // own heartbeat (real-DB proof in execution-targets-worker-token.integration).
    expect(where).toHaveBeenCalledWith("and");
    expect(res.updated).toBe(1);
  });
  it("reports zero updated when the target id is gone (fail-closed 404 at the route)", async () => {
    const where = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) });
    const set = vi.fn().mockReturnValue({ where });
    const db = { update: vi.fn().mockReturnValue({ set }) } as unknown as Parameters<typeof registerWorkerHeartbeat>[0];
    expect((await registerWorkerHeartbeat(db, { targetId: "missing" })).updated).toBe(0);
  });
});
