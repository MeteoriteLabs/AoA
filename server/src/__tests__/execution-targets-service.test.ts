import { describe, expect, it, vi } from "vitest";
import { makeTableProxy, drizzleOperatorStubs } from "./helpers/drizzle-mock.js";
vi.mock("@armyofagents/db", async () => ({ executionTargets: makeTableProxy("execution_targets") }));
vi.mock("drizzle-orm", () => drizzleOperatorStubs());
import { registerWorkerHeartbeat, listExecutionTargets } from "../services/execution-targets.js";

describe("listExecutionTargets (P5 review finding #1 — no system-row leak to tenants)", () => {
  const rows = [
    { id: "sys-cp", organizationId: null, slug: "control-plane", kind: "local_host" },
    { id: "sys-pool", organizationId: null, slug: "pool-1", kind: "pooled_gvisor" },
    { id: "a-ded", organizationId: "org-A", slug: "a-box", kind: "dedicated_worker" },
    { id: "b-ded", organizationId: "org-B", slug: "b-box", kind: "dedicated_worker" },
  ];
  function dbWith(r: unknown[]) {
    return { select: vi.fn().mockReturnValue({ from: vi.fn().mockResolvedValue(r) }) } as unknown as Parameters<
      typeof listExecutionTargets
    >[0];
  }
  it("returns ONLY the org's own targets — never organizationId=null system rows (whose id is the worker token)", async () => {
    const out = (await listExecutionTargets(dbWith(rows), "org-A")) as Array<{ id: string; organizationId: string | null }>;
    expect(out.map((t) => t.id)).toEqual(["a-ded"]);
    expect(out.some((t) => t.organizationId == null)).toBe(false); // no system-row disclosure
    expect(out.some((t) => t.organizationId === "org-B")).toBe(false); // no cross-org disclosure
  });
  it("returns nothing for a null org (no ambient system-row disclosure)", async () => {
    expect(await listExecutionTargets(dbWith(rows), null)).toEqual([]);
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
    // "eq" is the stubbed operator return; proves .where was given the id predicate.
    expect(where).toHaveBeenCalledWith("eq");
    expect(res.updated).toBe(1);
  });
  it("reports zero updated when the target id is gone (fail-closed 404 at the route)", async () => {
    const where = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) });
    const set = vi.fn().mockReturnValue({ where });
    const db = { update: vi.fn().mockReturnValue({ set }) } as unknown as Parameters<typeof registerWorkerHeartbeat>[0];
    expect((await registerWorkerHeartbeat(db, { targetId: "missing" })).updated).toBe(0);
  });
});
