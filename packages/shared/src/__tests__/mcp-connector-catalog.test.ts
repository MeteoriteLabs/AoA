import { describe, it, expect } from "vitest";
import {
  McpConnectorCatalogEntrySchema,
  parseMcpConnectorCatalog,
} from "../mcp-connector-catalog.js";

describe("McpConnectorCatalogEntrySchema", () => {
  const httpEntry = {
    id: "notion",
    displayName: "Notion",
    serverName: "notion",
    transport: "http",
    url: "https://mcp.notion.com/mcp",
    headerTemplateKeys: ["Authorization"],
    requiresSecret: true,
    trust: { tier: "verified" },
  };

  it("accepts a verified http entry", () => {
    const r = McpConnectorCatalogEntrySchema.safeParse(httpEntry);
    expect(r.success).toBe(true);
  });

  it("defaults trust tier to community when absent (fail-closed)", () => {
    const { trust: _t, ...noTrust } = httpEntry;
    const r = McpConnectorCatalogEntrySchema.parse(noTrust);
    expect(r.trust.tier).toBe("community");
  });

  it("rejects a serverName outside /^[a-z0-9-]+$/", () => {
    const r = McpConnectorCatalogEntrySchema.safeParse({ ...httpEntry, serverName: "Bad_Name" });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown headerTemplate field", () => {
    const r = McpConnectorCatalogEntrySchema.safeParse({
      ...httpEntry,
      headerTemplate: { Authorization: "Bearer sk-live-real" },
    });
    expect(r.success).toBe(false); // .strict() — headerTemplate is not a field
  });

  it("drops an unparseable entry but keeps the good ones (forward compatible)", () => {
    const file = {
      schemaVersion: "1.0.0",
      entries: [httpEntry, { id: "broken", transport: "carrier-pigeon" }],
    };
    const result = parseMcpConnectorCatalog(file);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].id).toBe("notion");
    expect(result.dropped).toEqual(["broken"]);
  });

  it("rejects a headerTemplateKeys entry smuggling a `Name: value` pair", () => {
    const r = McpConnectorCatalogEntrySchema.safeParse({
      ...httpEntry,
      headerTemplateKeys: ["Authorization: Bearer sk-live-actualsecret12345"],
    });
    expect(r.success).toBe(false);
  });

  it("rejects an envTemplateKeys entry smuggling a bare secret value", () => {
    const r = McpConnectorCatalogEntrySchema.safeParse({
      ...httpEntry,
      transport: "stdio",
      command: "npx",
      url: undefined,
      envTemplateKeys: ["sk-live-actualsecret12345"],
    });
    expect(r.success).toBe(false);
  });

  it("accepts legitimate header and env template key names", () => {
    const r = McpConnectorCatalogEntrySchema.safeParse({
      ...httpEntry,
      headerTemplateKeys: ["Authorization", "X-Api-Key"],
      envTemplateKeys: ["NOTION_TOKEN", "_PRIVATE"],
    });
    expect(r.success).toBe(true);
  });

  it("rejects an http entry that also carries a command (symmetric transport exclusion)", () => {
    const r = McpConnectorCatalogEntrySchema.safeParse({ ...httpEntry, command: "npx" });
    expect(r.success).toBe(false);
  });

  it("rejects a stdio entry that also carries a url (symmetric transport exclusion)", () => {
    const r = McpConnectorCatalogEntrySchema.safeParse({
      ...httpEntry,
      transport: "stdio",
      command: "npx",
      // url is still the http one inherited from httpEntry — this is the point of the test
    });
    expect(r.success).toBe(false);
  });
});

describe("parseMcpConnectorCatalog — envelope handling (never throws)", () => {
  const notObjectInputs: Array<[string, unknown]> = [
    ["null", null],
    ["undefined", undefined],
    ["a number", 42],
    ["a string", "not a catalog"],
  ];

  it.each(notObjectInputs)("treats %s input as malformed, never throws", (_label, input) => {
    expect(() => parseMcpConnectorCatalog(input)).not.toThrow();
    expect(parseMcpConnectorCatalog(input)).toEqual({ entries: [], dropped: [], malformed: true });
  });

  it("treats a missing `entries` field as malformed", () => {
    expect(() => parseMcpConnectorCatalog({})).not.toThrow();
    expect(parseMcpConnectorCatalog({})).toEqual({ entries: [], dropped: [], malformed: true });
  });

  it("treats a non-array `entries` field as malformed", () => {
    const input = { entries: "not-an-array" };
    expect(() => parseMcpConnectorCatalog(input)).not.toThrow();
    expect(parseMcpConnectorCatalog(input)).toEqual({ entries: [], dropped: [], malformed: true });
  });

  it("treats a legitimately empty `entries` array as NOT malformed", () => {
    const input = { entries: [] };
    expect(() => parseMcpConnectorCatalog(input)).not.toThrow();
    expect(parseMcpConnectorCatalog(input)).toEqual({ entries: [], dropped: [], malformed: false });
  });

  it("drops a non-object entry as <unidentified>, never throws, and is not malformed", () => {
    const input = { entries: [42] };
    expect(() => parseMcpConnectorCatalog(input)).not.toThrow();
    expect(parseMcpConnectorCatalog(input)).toEqual({
      entries: [],
      dropped: ["<unidentified>"],
      malformed: false,
    });
  });

  it("drops an entry whose id is not a string as <unidentified>", () => {
    const input = { entries: [{ id: 123, transport: "carrier-pigeon" }] };
    expect(() => parseMcpConnectorCatalog(input)).not.toThrow();
    const result = parseMcpConnectorCatalog(input);
    expect(result.dropped).toEqual(["<unidentified>"]);
    expect(result.malformed).toBe(false);
  });
});
