import { describe, expect, it } from "vitest";

// Slice 8 / Task 8.3: contract tests for the new teamImportsRoutes(db) factory.
//
// Verifies the factory shape and that BOTH routes (preview + install) are
// registered at the expected paths. Handler behaviour (parse, collision
// detection, transactional cascade) is exercised by the service tests in
// team-import-{preview,install}-*.test.ts -- this contract test is just the
// route-table check.
//
// Dynamic import for parity with `teams-routes-contract.test.ts` (heavy
// transitive module graph + Drizzle ESM cycle).
vi.setConfig({ testTimeout: 15000 });

import { vi } from "vitest";

describe("teamImportsRoutes -- conformance + contract", () => {
  it("exports a factory function (not a top-level Router)", async () => {
    const mod = await import("../routes/team-imports.js");
    expect(typeof mod.teamImportsRoutes).toBe("function");
    expect(mod.teamImportsRoutes.length).toBe(1); // accepts (db) param
  });

  it("returns an Express Router when called with db", async () => {
    const { teamImportsRoutes } = await import("../routes/team-imports.js");
    const fakeDb = {} as unknown as never;
    const router = teamImportsRoutes(fakeDb);
    expect(router).toBeDefined();
    expect(typeof router).toBe("function"); // Express Routers are functions
    expect((router as unknown as { stack: unknown[] }).stack).toBeInstanceOf(Array);
  });

  it("registers both /_imports/preview and /_imports/install POST routes", async () => {
    const { teamImportsRoutes } = await import("../routes/team-imports.js");
    const fakeDb = {} as unknown as never;
    const router = teamImportsRoutes(fakeDb);
    const stack = (router as unknown as {
      stack: Array<{ route?: { path?: string; methods?: Record<string, boolean> } }>;
    }).stack;
    const paths = stack
      .filter((layer) => layer.route)
      .map((layer) => layer.route?.path);
    expect(paths).toContain("/companies/:companyId/teams/_imports/preview");
    expect(paths).toContain("/companies/:companyId/teams/_imports/install");
    // Both are POST.
    for (const layer of stack) {
      if (!layer.route) continue;
      expect(layer.route.methods?.post).toBe(true);
    }
  });
});
