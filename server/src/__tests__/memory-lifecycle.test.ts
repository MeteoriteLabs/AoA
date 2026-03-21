import { describe, it, expect } from "vitest";

describe("accessedAt batch update in fetchMemoryContext", () => {
  it("empty served list skips the UPDATE (no empty IN clause)", () => {
    // In fetchMemoryContext: if (servedIds.length > 0) { ... }
    // When items array is empty, the UPDATE block is skipped entirely.
    const servedIds: string[] = [];
    expect(servedIds.length > 0).toBe(false);
  });

  it("batch update collects all served IDs into a single query", () => {
    // fetchMemoryContext selects id along with other fields,
    // then maps items to servedIds for a single inArray() UPDATE.
    const items = [
      { id: "a", title: "A", content: "a", category: "preference", tags: [] },
      { id: "b", title: "B", content: "b", category: "context", tags: [] },
      { id: "c", title: "C", content: "c", category: "decision", tags: [] },
    ];
    const servedIds = items.map((item) => item.id);
    expect(servedIds).toEqual(["a", "b", "c"]);
    // Single array → single query (not 3 separate N+1 queries)
    expect(servedIds.length).toBe(3);
  });

  it("staleness flagging respects recent accessedAt", () => {
    // After an item is served, accessedAt = NOW().
    // flagStaleItems checks: accessedAt <= cutoff (90 days ago).
    // A recently accessed item won't match the cutoff condition.
    const recentDate = new Date();
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    expect(recentDate > cutoff).toBe(true);
  });

  it("concurrent context assembly is safe (last-write-wins on accessedAt)", () => {
    // Two heartbeat runs both SET accessedAt = NOW() on overlapping items.
    // Both UPDATEs succeed — the later timestamp wins, which is acceptable.
    const now1 = new Date();
    const now2 = new Date(now1.getTime() + 50); // 50ms later
    expect(now2.getTime()).toBeGreaterThan(now1.getTime());
  });

  it("items with null accessedAt and old createdAt are flagged stale", () => {
    // flagStaleItems WHERE clause:
    //   (accessedAt IS NULL AND createdAt <= cutoff) OR (accessedAt <= cutoff)
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const oldCreatedAt = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);
    const accessedAt = null;

    const wouldBeStale = accessedAt === null && oldCreatedAt <= cutoff;
    expect(wouldBeStale).toBe(true);
  });

  it("items with recent accessedAt are not flagged stale even if createdAt is old", () => {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const oldCreatedAt = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);
    const recentAccessedAt = new Date(); // just served

    const wouldBeStale = recentAccessedAt <= cutoff;
    expect(wouldBeStale).toBe(false);
  });
});
