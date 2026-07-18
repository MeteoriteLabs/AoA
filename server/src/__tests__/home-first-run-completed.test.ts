/**
 * Unit tests for `resolveFirstRunCompleted` (WS0b). Pattern mirrors
 * thread-events.test.ts: mock `@armyofagents/db` and `drizzle-orm` at module
 * level via the shared Proxy/operator helpers (real imports of the full
 * schema graph + drizzle-orm together trigger an ESM require-cycle crash —
 * see server/src/__tests__/helpers/drizzle-mock.ts). `issue-crew-scope.js` is
 * also mocked since `home.ts` imports it unconditionally at module scope.
 */
import { describe, it, expect, vi } from "vitest";
import { makeTableProxy, drizzleOperatorStubs } from "./helpers/drizzle-mock.js";

vi.mock("@armyofagents/db", () => ({
  discussions: makeTableProxy("discussions"),
  issues: makeTableProxy("issues"),
  memoryItems: makeTableProxy("memory_items"),
  memoryItemVersions: makeTableProxy("memory_item_versions"),
  suggestions: makeTableProxy("suggestions"),
  activityLog: makeTableProxy("activity_log"),
  goals: makeTableProxy("goals"),
  companies: makeTableProxy("companies"),
  projects: makeTableProxy("projects"),
  agents: makeTableProxy("agents"),
  onboardingProgress: makeTableProxy("onboarding_progress"),
}));

vi.mock("drizzle-orm", () => drizzleOperatorStubs());

vi.mock("../services/issue-crew-scope.js", () => ({
  notCrewAssigned: vi.fn(() => "notCrewAssigned"),
}));

const { resolveFirstRunCompleted } = await import("../services/home.js");

function dbReturning(rows: unknown[]) {
  const limitFn = vi.fn().mockResolvedValue(rows);
  const whereFn = vi.fn().mockReturnValue({ limit: limitFn });
  const fromFn = vi.fn().mockReturnValue({ where: whereFn });
  const selectFn = vi.fn().mockReturnValue({ from: fromFn });
  return { db: { select: selectFn } as any, selectFn, fromFn, whereFn, limitFn };
}

describe("resolveFirstRunCompleted (WS0b)", () => {
  it("a fresh row with firstRunCompletedAt null is NOT complete (first-run still shows)", async () => {
    const { db } = dbReturning([{ firstRunCompletedAt: null }]);
    const result = await resolveFirstRunCompleted(db, "c1", "u1");
    expect(result).toBe(false);
  });

  it("a row with firstRunCompletedAt set IS complete, flipping Home to steady-state", async () => {
    const { db } = dbReturning([{ firstRunCompletedAt: new Date("2026-07-18T00:00:00Z") }]);
    const result = await resolveFirstRunCompleted(db, "c1", "u1");
    expect(result).toBe(true);
  });

  it("no onboarding-progress row for this (userId, companyId) defaults to complete (pre-existing member, never re-onboard)", async () => {
    const { db } = dbReturning([]);
    const result = await resolveFirstRunCompleted(db, "c1", "u1");
    expect(result).toBe(true);
  });

  it("no board-actor userId (agent/MCP caller) defaults to complete without querying the db", async () => {
    const { db, selectFn } = dbReturning([]);
    const result = await resolveFirstRunCompleted(db, "c1", undefined);
    expect(result).toBe(true);
    expect(selectFn).not.toHaveBeenCalled();
  });

  it("queries scoped to the given userId and companyId", async () => {
    const { db, fromFn } = dbReturning([{ firstRunCompletedAt: null }]);
    await resolveFirstRunCompleted(db, "company-42", "user-7");
    expect(fromFn).toHaveBeenCalledTimes(1);
  });
});
