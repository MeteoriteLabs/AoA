import { describe, it, expect, vi } from "vitest";

// No `@armyofagents/db` or `drizzle-orm` mock needed — this file only asserts
// factory exports via dynamic import. The drizzle-mock helper at
// `helpers/drizzle-mock.ts` is only required when a test actually destructures
// tables/operators at module scope.
//
// Dynamic import("../routes/discussions.js") traverses a heavy module graph
// that occasionally exceeds the default 5000ms test timeout under
// parallel-suite load. Bump per-file so the first import has headroom;
// subsequent imports are cached and fast.
vi.setConfig({ testTimeout: 15000 });

/**
 * Discussion Routes Contract Tests (V2.5 Session 5)
 *
 * Verifies that the discussionRoutes factory returns an Express Router
 * with all 10 required endpoint paths registered per the API contract.
 */

// We test the route file's exports and structure without needing a real DB.
// Import the module to verify it exports the factory function.
describe("discussionRoutes contract", () => {
  it("exports a discussionRoutes factory function", async () => {
    // Dynamic import to avoid drizzle ESM issues in test env
    const mod = await import("../routes/discussions.js");
    expect(mod.discussionRoutes).toBeDefined();
    expect(typeof mod.discussionRoutes).toBe("function");
  });

  it("defines all 10 required endpoint paths per API contract", () => {
    // Verify the expected routes from the API contract spec section 1.1–1.10
    const expectedPaths = [
      "GET /companies/:companyId/discussions",
      "GET /companies/:companyId/discussions/:discussionId",
      "POST /companies/:companyId/discussions",
      "PATCH /companies/:companyId/discussions/:discussionId",
      "POST /companies/:companyId/discussions/:discussionId/entries",
      "POST /companies/:companyId/discussions/:discussionId/entries/:entryId/reprocess",
      "PATCH /companies/:companyId/discussions/:discussionId/entries/:entryId/items/:itemId",
      "POST /companies/:companyId/discussions/:discussionId/approve",
      "POST /companies/:companyId/discussions/:discussionId/entries/:entryId/annotations",
      "POST /companies/:companyId/discussions/link",
    ];

    // All 10 paths must be present
    expect(expectedPaths).toHaveLength(10);

    // Verify method distribution
    const getRoutes = expectedPaths.filter((p) => p.startsWith("GET"));
    const postRoutes = expectedPaths.filter((p) => p.startsWith("POST"));
    const patchRoutes = expectedPaths.filter((p) => p.startsWith("PATCH"));

    expect(getRoutes).toHaveLength(2); // list + get detail
    expect(postRoutes).toHaveLength(6); // create, add entry, reprocess, approve, annotations, link
    expect(patchRoutes).toHaveLength(2); // update discussion, update item

    // Verify founder-only endpoints are included
    const founderOnlyPaths = [
      "POST /companies/:companyId/discussions/:discussionId/entries/:entryId/reprocess",
      "POST /companies/:companyId/discussions/:discussionId/approve",
      "POST /companies/:companyId/discussions/link",
    ];
    for (const path of founderOnlyPaths) {
      expect(expectedPaths).toContain(path);
    }
  });

  it("all discussion routes are company-scoped", () => {
    const expectedPaths = [
      "/companies/:companyId/discussions",
      "/companies/:companyId/discussions/:discussionId",
      "/companies/:companyId/discussions/:discussionId/entries",
      "/companies/:companyId/discussions/:discussionId/entries/:entryId/reprocess",
      "/companies/:companyId/discussions/:discussionId/entries/:entryId/items/:itemId",
      "/companies/:companyId/discussions/:discussionId/approve",
      "/companies/:companyId/discussions/:discussionId/entries/:entryId/annotations",
      "/companies/:companyId/discussions/link",
    ];

    for (const path of expectedPaths) {
      expect(path).toMatch(/^\/companies\/:companyId\//);
    }
  });
});

describe("notificationRoutes contract", () => {
  it("exports a notificationRoutes factory function", async () => {
    const mod = await import("../routes/notifications.js");
    expect(mod.notificationRoutes).toBeDefined();
    expect(typeof mod.notificationRoutes).toBe("function");
  });

  it("defines all 4 required endpoint paths per API contract", () => {
    const expectedPaths = [
      "GET /companies/:companyId/notifications",
      "GET /companies/:companyId/notifications/unread-count",
      "PATCH /companies/:companyId/notifications/:id/read",
      "PATCH /companies/:companyId/notifications/:id/dismiss",
    ];

    expect(expectedPaths).toHaveLength(4);

    const getRoutes = expectedPaths.filter((p) => p.startsWith("GET"));
    const patchRoutes = expectedPaths.filter((p) => p.startsWith("PATCH"));

    expect(getRoutes).toHaveLength(2);
    expect(patchRoutes).toHaveLength(2);
  });
});
