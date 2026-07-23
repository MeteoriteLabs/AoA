import { describe, expect, it } from "vitest";
import { isHttpServerSpec, isStdioServerSpec, type McpServerSpec } from "../mcp-server-spec.js";

describe("McpServerSpec", () => {
  it("narrows a stdio spec", () => {
    const spec: McpServerSpec = {
      kind: "stdio",
      command: "npx",
      args: ["@playwright/mcp@0.0.75"],
      env: {},
    };
    expect(isStdioServerSpec(spec)).toBe(true);
    expect(isHttpServerSpec(spec)).toBe(false);
  });

  it("narrows an http spec with headers", () => {
    const spec: McpServerSpec = {
      kind: "http",
      url: "https://mcp.notion.com/mcp",
      headers: { Authorization: "Bearer ${AOA_MCP_NOTION_TOKEN}" },
    };
    expect(isHttpServerSpec(spec)).toBe(true);
    expect(isStdioServerSpec(spec)).toBe(false);
  });

  it("rejects non-objects", () => {
    for (const value of [null, undefined, "http", 42, true]) {
      expect(isStdioServerSpec(value)).toBe(false);
      expect(isHttpServerSpec(value)).toBe(false);
    }
  });

  it("rejects an object with the right kind but a missing required field", () => {
    expect(isStdioServerSpec({ kind: "stdio" })).toBe(false);
    expect(isHttpServerSpec({ kind: "http" })).toBe(false);
  });

  it("rejects an object with the right kind but a wrong-typed required field", () => {
    expect(isStdioServerSpec({ kind: "stdio", command: 123 })).toBe(false);
    expect(isHttpServerSpec({ kind: "http", url: 123 })).toBe(false);
  });

  it("rejects an unrelated object", () => {
    expect(isStdioServerSpec({ foo: "bar" })).toBe(false);
    expect(isHttpServerSpec({ foo: "bar" })).toBe(false);
  });
});
