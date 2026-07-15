import { describe, expect, it } from "vitest";
import { resolveTaskCommentAction } from "./CommentThread";

const base = {
  isClosed: false,
  reopenRequested: false,
  hasActiveRun: false,
  interruptRequested: false,
  hasReassignment: false,
};

describe("resolveTaskCommentAction", () => {
  it("keeps an ordinary comment non-interrupting while an agent is running", () => {
    expect(resolveTaskCommentAction({ ...base, hasActiveRun: true })).toBe("comment");
  });

  it("requires an active run before an interrupt effect is emitted", () => {
    expect(resolveTaskCommentAction({ ...base, interruptRequested: true })).toBe("comment");
    expect(resolveTaskCommentAction({ ...base, hasActiveRun: true, interruptRequested: true })).toBe("interrupt");
  });

  it("maps a closed-task comment with reopen enabled to reopen", () => {
    expect(resolveTaskCommentAction({ ...base, isClosed: true, reopenRequested: true })).toBe("reopen");
  });

  it("prioritizes reassignment as its own governed mutation", () => {
    expect(resolveTaskCommentAction({
      ...base,
      hasActiveRun: true,
      interruptRequested: true,
      hasReassignment: true,
    })).toBe("reassign");
  });
});
