import { describe, expect, it, vi } from "vitest";

// Slice 1 / Task 1.10: contract tests for the new teamsRoutes(db) factory.
//
// IMPORTANT naming note: there is a pre-existing `teamRoutes` (singular)
// export at `server/src/routes/team.ts` for the user/board permissions
// domain. The new departmental-teams routes use the plural name
// `teamsRoutes` to disambiguate. Same disambiguation applies to the
// validation schemas (`addTeamsMemberSchema`, `updateTeamsMemberRoleSchema`).
//
// Dynamic import is used to traverse a heavy module graph that occasionally
// exceeds the default 5000ms test timeout under parallel-suite load.
vi.setConfig({ testTimeout: 15000 });

describe("teamsRoutes — conformance + contract", () => {
  it("exports a factory function (not a top-level Router)", async () => {
    const mod = await import("../routes/teams.js");
    expect(typeof mod.teamsRoutes).toBe("function");
    expect(mod.teamsRoutes.length).toBe(1); // accepts (db) param
  });

  it("returns an Express Router when called with db", async () => {
    const { teamsRoutes } = await import("../routes/teams.js");
    const fakeDb = {} as unknown as never;
    const router = teamsRoutes(fakeDb);
    expect(router).toBeDefined();
    expect(typeof router).toBe("function"); // Express Routers are functions
    expect((router as unknown as { stack: unknown[] }).stack).toBeInstanceOf(Array);
  });
});
