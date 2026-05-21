import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Commander's use_skill runs through the internal-agent bridge tool, NOT the
// HTTP MCP-server handler. Enforcement must live in the bridge tool.
const src = readFileSync(
  join(__dirname, "../services/internal-agent/tools/skill-tools.ts"),
  "utf-8",
);

describe("use_skill skillKeys enforcement (bridge tool)", () => {
  it("enforces only for the commander actor", () => {
    expect(src).toContain('ctx.actorType === "commander"');
  });
  it("resolves the commander agent via internalAgentConfig.agentId", () => {
    expect(src).toContain("internalAgentConfig");
    expect(src).toMatch(/agentId:\s*internalAgentConfig\.agentId/);
  });
  it("rejects skills not present in the agent's skillKeys", () => {
    expect(src).toMatch(/allowed\.includes\(key\)/);
    expect(src).toContain("not enabled for Commander");
  });
});

describe("HTTP MCP use_skill handler stays company-scoped (no dead commander branch)", () => {
  const httpSrc = readFileSync(join(__dirname, "../mcp/tools/skill-tools.ts"), "utf-8");
  it("does not contain a commander enforcement branch (that path never emits a commander actor)", () => {
    expect(httpSrc).not.toContain("not enabled for Commander");
  });
});
