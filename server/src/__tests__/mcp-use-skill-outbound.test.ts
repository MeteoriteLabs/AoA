import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(
  resolve(__dirname, "../mcp/tools/index.ts"),
  "utf8",
);

describe("outbound MCP: use_skill tool", () => {
  it("exports or registers use_skill in the outbound tool index", () => {
    expect(src).toContain("use_skill");
  });

  it("includes skill key parameter in schema", () => {
    // The tool must accept a 'key' parameter (e.g. 'skill:aoa/brainstorm')
    expect(src).toContain('"key"');
  });
});
