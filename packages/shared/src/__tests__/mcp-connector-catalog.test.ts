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

  it("rejects an entry carrying a secret VALUE rather than a key", () => {
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
});
