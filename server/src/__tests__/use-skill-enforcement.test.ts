import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const src = readFileSync(join(__dirname, "../mcp/tools/skill-tools.ts"), "utf-8");

describe("use_skill skillKeys enforcement", () => {
  it("enforces only for the commander actor", () => {
    expect(src).toContain('ctx.actor.source === "commander"');
  });
  it("resolves the commander agent via internalAgentConfig.agentId", () => {
    expect(src).toContain("internalAgentConfig");
    expect(src).toMatch(/agentId:\s*internalAgentConfig\.agentId/);
  });
  it("rejects skills not present in the agent's skillKeys", () => {
    expect(src).toMatch(/allowed\.includes\(parsed\.key\)/);
    expect(src).toContain("not enabled for Commander");
  });
});
