import { describe, expect, it, vi } from "vitest";
import { makeTableProxy, drizzleOperatorStubs } from "./helpers/drizzle-mock.js";
vi.mock("@armyofagents/db", async () => ({ executionTargets: makeTableProxy("execution_targets") }));
vi.mock("drizzle-orm", () => drizzleOperatorStubs());
import { registerWorkerHeartbeat } from "../services/execution-targets.js";

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
