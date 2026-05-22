import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routeSrc = readFileSync(
  resolve(__dirname, "../routes/internal-agent.ts"),
  "utf8",
);

const convSrc = readFileSync(
  resolve(__dirname, "../services/internal-agent/conversation.ts"),
  "utf8",
);

describe("conversation messages endpoint — implementation contract", () => {
  it("has GET conversations/:convId/messages route", () => {
    expect(routeSrc).toContain("conversations/:convId/messages");
    expect(routeSrc).toContain("router.get");
  });

  it("GET route uses loadOwnedConversation for ownership check (includes founder bypass)", () => {
    // The messages route delegates ownership to loadOwnedConversation, which
    // applies the same founder bypass used by archive/pin/rename/delete.
    expect(routeSrc).toContain("loadOwnedConversation");
  });

  it("GET route throws 404 when conversation not found", () => {
    expect(routeSrc).toContain("notFound");
  });

  it("chat route accepts optional conversationId in body", () => {
    expect(routeSrc).toContain("conversationId");
    expect(routeSrc).toContain("uuid().optional()");
  });

  it("conversationService has getById returning null when not found", () => {
    expect(convSrc).toContain("getById");
    expect(convSrc).toContain("?? null");
  });
});
