import { describe, expect, it } from "vitest";
import {
  isHttpServerSpec,
  isStdioServerSpec,
  mergeExternalMcpServers,
  RESERVED_MCP_SERVER_NAMES,
  stripReservedMcpServerNames,
  type McpServerSpec,
} from "../mcp-server-spec.js";

const httpSpec = (url: string): McpServerSpec => ({ kind: "http", url, headers: {} });

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

// These two helpers are consumed by the server AND by three Plan 2 adapter
// writers, so they are covered directly here rather than only through
// buildMcpConfig in the server package.

describe("stripReservedMcpServerNames", () => {
  it("drops every reserved name", () => {
    const out = stripReservedMcpServerNames(
      Object.fromEntries(
        RESERVED_MCP_SERVER_NAMES.map((name) => [name, httpSpec("https://evil.example.com/mcp")]),
      ),
    );
    expect(Object.keys(out)).toEqual([]);
  });

  it("preserves non-reserved connectors untouched", () => {
    const notion = httpSpec("https://mcp.notion.com/mcp");
    const out = stripReservedMcpServerNames({ notion, aoa: httpSpec("https://evil.example.com") });
    expect(Object.keys(out)).toEqual(["notion"]);
    expect(out.notion).toBe(notion);
  });

  it("handles empty input", () => {
    expect(Object.keys(stripReservedMcpServerNames({}))).toEqual([]);
  });

  it("returns a null-prototype object", () => {
    expect(Object.getPrototypeOf(stripReservedMcpServerNames({}))).toBeNull();
  });
});

describe("mergeExternalMcpServers", () => {
  const passthrough = (spec: McpServerSpec) => spec;

  it("returns a null-prototype object", () => {
    expect(Object.getPrototypeOf(mergeExternalMcpServers({}, {}, passthrough))).toBeNull();
  });

  it("lets reserved entries win over a colliding connector", () => {
    const ours: McpServerSpec = { kind: "stdio", command: "node", args: [], env: {} };
    const out = mergeExternalMcpServers<McpServerSpec>(
      { aoa: ours },
      { aoa: httpSpec("https://evil.example.com/mcp") },
      passthrough,
    );
    expect(out.aoa).toBe(ours);
    expect(Object.keys(out)).toEqual(["aoa"]);
  });

  it("keeps a __proto__-named connector as an own key", () => {
    const out = mergeExternalMcpServers<McpServerSpec>(
      {},
      { ["__proto__"]: httpSpec("https://x.example.com/mcp") },
      passthrough,
    );
    expect(Object.prototype.hasOwnProperty.call(out, "__proto__")).toBe(true);
    // The connector must not have become the map's prototype.
    expect((out as Record<string, unknown>).url).toBeUndefined();
  });

  it("applies toEntry to each external spec but never to reserved entries", () => {
    const reservedEntry = { tag: "reserved" };
    const out = mergeExternalMcpServers(
      { aoa: reservedEntry },
      { a: httpSpec("https://a.example.com"), b: httpSpec("https://b.example.com") },
      (spec) => ({ tag: isHttpServerSpec(spec) ? spec.url : "stdio" }),
    );
    expect(out.aoa).toBe(reservedEntry);
    expect(out.a).toEqual({ tag: "https://a.example.com" });
    expect(out.b).toEqual({ tag: "https://b.example.com" });
  });

  it("merges an empty connector set without disturbing reserved entries", () => {
    const out = mergeExternalMcpServers<McpServerSpec>(
      { aoa: httpSpec("https://loopback.example.com") },
      {},
      passthrough,
    );
    expect(Object.keys(out)).toEqual(["aoa"]);
  });
});
