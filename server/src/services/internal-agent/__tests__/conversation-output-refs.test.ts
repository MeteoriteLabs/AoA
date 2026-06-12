// server/src/services/internal-agent/__tests__/conversation-output-refs.test.ts
import { describe, it, expect } from "vitest";
import { conversationService } from "../conversation.js";

function mockDb() {
  const captured: { values?: any } = {};
  const db = {
    insert: () => ({
      values: (v: any) => {
        captured.values = v;
        return {
          returning: () => ({
            then: (fn: any) => Promise.resolve(fn([{ id: "m1", ...v }])),
          }),
        };
      },
    }),
    // appendMessage calls: db.update(...).set({...}).where(...) — must be awaitable
    update: () => ({
      set: () => ({
        where: () => Promise.resolve(),
      }),
    }),
  } as any;
  return { db, captured };
}

const validRef = { v: 1, kind: "artifact", id: "a1", action: "created" };

describe("appendMessage outputRefs", () => {
  it("persists valid refs", async () => {
    const { db, captured } = mockDb();
    await conversationService(db).appendMessage("conv-1", {
      role: "assistant",
      content: "done",
      outputRefs: [validRef],
    });
    expect(captured.values.outputRefs).toEqual([
      expect.objectContaining({ id: "a1" }),
    ]);
  });

  it("drops invalid refs individually but still saves the message", async () => {
    const { db, captured } = mockDb();
    await conversationService(db).appendMessage("conv-1", {
      role: "assistant",
      content: "done",
      outputRefs: [{ v: 99, nope: true }, validRef],
    });
    expect(captured.values.outputRefs).toEqual([
      expect.objectContaining({ id: "a1" }),
    ]);
    expect(captured.values.content).toBe("done");
  });

  it("all-invalid refs → null", async () => {
    const { db, captured } = mockDb();
    await conversationService(db).appendMessage("conv-1", {
      role: "assistant",
      content: "done",
      outputRefs: [{ v: 99, nope: true }],
    });
    expect(captured.values.outputRefs).toBeNull();
  });

  it("null when absent", async () => {
    const { db, captured } = mockDb();
    await conversationService(db).appendMessage("conv-1", {
      role: "user",
      content: "hi",
    });
    expect(captured.values.outputRefs).toBeNull();
  });
});
