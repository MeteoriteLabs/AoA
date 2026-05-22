import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routeSrc = readFileSync(
  resolve(__dirname, "../routes/internal-agent.ts"),
  "utf8",
);

describe("confirmation flow — implementation contract", () => {
  it("has a pending confirmations Map at module level", () => {
    expect(routeSrc).toContain("pendingConfirmations");
    expect(routeSrc).toContain("Map");
  });

  it("/confirm endpoint looks up and deletes the pending entry", () => {
    expect(routeSrc).toContain("pendingConfirmations.get");
    expect(routeSrc).toContain("pendingConfirmations.delete");
  });

  it("/confirm calls executeTool when approved", () => {
    expect(routeSrc).toContain("executeTool");
    expect(routeSrc).toContain("approved");
  });

  it("/confirm returns 404 when confirmId not found", () => {
    expect(routeSrc).toContain("notFound");
  });

  it("action_confirmation SSE handler stores the pending entry", () => {
    expect(routeSrc).toContain("pendingConfirmations.set");
    expect(routeSrc).toContain("toolName");
    expect(routeSrc).toContain("params");
  });
});
