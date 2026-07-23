import { describe, expect, it } from "vitest";
import { buildConnectorSpecs, envVarNameFor } from "../mcp-connectors.js";

describe("envVarNameFor", () => {
  it("uppercases and sanitizes the server name", () => {
    expect(envVarNameFor("notion")).toBe("AOA_MCP_NOTION_TOKEN");
    expect(envVarNameFor("my-server.v2")).toBe("AOA_MCP_MY_SERVER_V2_TOKEN");
  });

  it("cannot produce a dangerous key from a hostile name", () => {
    // __proto__ must not survive into an env var name
    expect(envVarNameFor("__proto__")).toBe("AOA_MCP___PROTO___TOKEN");
  });
});

describe("buildConnectorSpecs", () => {
  const httpRow = {
    serverName: "notion",
    transport: "http",
    url: "https://mcp.notion.com/mcp",
    command: null,
    args: [],
    headerTemplate: { Authorization: "Bearer ${TOKEN}" },
    envTemplate: {},
    secretValue: "secret-abc",
  };

  it("emits an http spec with a placeholder header, and the secret in env", () => {
    const { specs, env } = buildConnectorSpecs([httpRow]);
    expect(specs.notion).toEqual({
      kind: "http",
      url: "https://mcp.notion.com/mcp",
      headers: { Authorization: "Bearer ${AOA_MCP_NOTION_TOKEN}" },
    });
    expect(env.AOA_MCP_NOTION_TOKEN).toBe("secret-abc");
  });

  it("never emits the raw secret inside the spec", () => {
    const { specs } = buildConnectorSpecs([httpRow]);
    expect(JSON.stringify(specs)).not.toContain("secret-abc");
  });

  it("emits a stdio spec for command transport", () => {
    const { specs } = buildConnectorSpecs([
      {
        serverName: "pg",
        transport: "stdio",
        url: null,
        command: "npx",
        args: ["-y", "@bytebase/dbhub@1.2.3"],
        headerTemplate: {},
        envTemplate: { DSN: "${TOKEN}" },
        secretValue: "postgres://x",
      },
    ]);
    expect(specs.pg).toEqual({
      kind: "stdio",
      command: "npx",
      args: ["-y", "@bytebase/dbhub@1.2.3"],
      env: { DSN: "${AOA_MCP_PG_TOKEN}" },
    });
  });

  it("omits an http row with no url and a stdio row with no command", () => {
    const { specs } = buildConnectorSpecs([
      { ...httpRow, serverName: "bad1", url: null },
      { ...httpRow, serverName: "bad2", transport: "stdio", command: null },
    ]);
    expect(specs.bad1).toBeUndefined();
    expect(specs.bad2).toBeUndefined();
  });

  it("omits the env entry when a connector has no secret", () => {
    const { specs, env } = buildConnectorSpecs([{ ...httpRow, secretValue: null }]);
    expect(specs.notion).toBeDefined();
    expect(env.AOA_MCP_NOTION_TOKEN).toBeUndefined();
  });

  it("builds a null-prototype specs map so a __proto__ connector cannot poison it", () => {
    const { specs } = buildConnectorSpecs([{ ...httpRow, serverName: "__proto__" }]);
    expect(Object.prototype.hasOwnProperty.call(specs, "__proto__")).toBe(true);
    expect((specs as Record<string, unknown>).url).toBeUndefined(); // no read-through
  });

  it("keeps two connectors independent", () => {
    const { specs, env } = buildConnectorSpecs([
      httpRow,
      { ...httpRow, serverName: "linear", url: "https://mcp.linear.app/mcp", secretValue: "secret-xyz" },
    ]);
    expect(specs.notion).toBeDefined();
    expect(specs.linear).toBeDefined();
    expect(env.AOA_MCP_NOTION_TOKEN).toBe("secret-abc");
    expect(env.AOA_MCP_LINEAR_TOKEN).toBe("secret-xyz");
  });
});
