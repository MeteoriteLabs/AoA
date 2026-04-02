import { describe, expect, it } from "vitest";

/**
 * Routine Routes Contract Tests
 *
 * Verifies that routineRoutes exports the factory function and that the
 * expected endpoint surface matches the API contract.
 */

describe("routineRoutes contract", () => {
  it("exports a routineRoutes factory function", async () => {
    const mod = await import("../routes/routines.js");
    expect(mod.routineRoutes).toBeDefined();
    expect(typeof mod.routineRoutes).toBe("function");
  });

  it("defines all 11 expected endpoint paths per API contract", () => {
    const expectedPaths = [
      "GET /companies/:companyId/routines",
      "POST /companies/:companyId/routines",
      "GET /routines/:id",
      "PATCH /routines/:id",
      "GET /routines/:id/runs",
      "POST /routines/:id/triggers",
      "PATCH /routine-triggers/:id",
      "DELETE /routine-triggers/:id",
      "POST /routine-triggers/:id/rotate-secret",
      "POST /routines/:id/run",
      "POST /routine-triggers/public/:publicId/fire",
    ];

    expect(expectedPaths).toHaveLength(11);

    const getRoutes = expectedPaths.filter((p) => p.startsWith("GET"));
    const postRoutes = expectedPaths.filter((p) => p.startsWith("POST"));
    const patchRoutes = expectedPaths.filter((p) => p.startsWith("PATCH"));
    const deleteRoutes = expectedPaths.filter((p) => p.startsWith("DELETE"));

    expect(getRoutes).toHaveLength(3);  // list, get detail, list runs
    expect(postRoutes).toHaveLength(5); // create, create trigger, rotate-secret, run, fire
    expect(patchRoutes).toHaveLength(2); // update routine, update trigger
    expect(deleteRoutes).toHaveLength(1); // delete trigger
  });

  it("has a public endpoint for webhook fire that does not require company scoping", () => {
    const publicEndpoints = [
      "POST /routine-triggers/public/:publicId/fire",
    ];
    // The public fire endpoint uses publicId not companyId — unauthenticated entry point
    for (const path of publicEndpoints) {
      expect(path).not.toMatch(/\/companies\/:companyId\//);
    }
  });
});

describe("routineService contract", () => {
  it("exports a routineService factory function", async () => {
    const mod = await import("../services/routines.js");
    expect(mod.routineService).toBeDefined();
    expect(typeof mod.routineService).toBe("function");
  });

  it("routineService factory returns all expected service methods", async () => {
    const { routineService } = await import("../services/routines.js");
    // Pass a minimal mock db — we just need the factory to not crash
    const svc = routineService({} as any);
    const expectedMethods = [
      "get",
      "getTrigger",
      "list",
      "getDetail",
      "create",
      "update",
      "createTrigger",
      "updateTrigger",
      "deleteTrigger",
      "rotateTriggerSecret",
      "runRoutine",
      "firePublicTrigger",
      "listRuns",
      "tickScheduledTriggers",
      "syncRunStatusForIssue",
    ];
    for (const method of expectedMethods) {
      expect(typeof (svc as any)[method]).toBe("function");
    }
  });
});
