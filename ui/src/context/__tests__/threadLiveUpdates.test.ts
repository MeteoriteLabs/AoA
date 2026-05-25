import { describe, it, expect } from "vitest";
import { threadEventToInvalidations } from "../LiveUpdatesProvider";

// Plan 7 Task 4: a thread.* live event maps to the React Query keys to
// invalidate (refetch-on-poke). RBAC stays in REST — invalidation just refetches.
describe("threadEventToInvalidations", () => {
  it("maps a thread event to the right query keys", () => {
    const keys = threadEventToInvalidations(
      { type: "thread.scope.changed", threadId: "t1" },
      "co1",
    );
    expect(keys).toContainEqual(["thread", "co1", "t1"]);
    expect(keys).toContainEqual(["threads", "co1"]);
    // also invalidates the concrete detail key the ThreadDetail page uses
    expect(keys).toContainEqual(["threads", "co1", "t1"]);
  });

  it("maps thread.entry.created the same way", () => {
    const keys = threadEventToInvalidations(
      { type: "thread.entry.created", threadId: "t9" },
      "coX",
    );
    expect(keys).toContainEqual(["thread", "coX", "t9"]);
    expect(keys).toContainEqual(["threads", "coX"]);
  });

  it("returns no keys when the event has no threadId", () => {
    const keys = threadEventToInvalidations(
      { type: "thread.presence" } as { type: string; threadId?: string },
      "co1",
    );
    expect(keys).toEqual([]);
  });
});
