import { describe, expect, it } from "vitest";
import {
  buildConnectorSpecs,
  envVarNameFor,
  selectConnectorRowsForAgent,
} from "../mcp-connectors.js";

describe("envVarNameFor", () => {
  it("uppercases and sanitizes the server name", () => {
    expect(envVarNameFor("notion")).toBe("AOA_MCP_NOTION_TOKEN");
    expect(envVarNameFor("my-server.v2")).toBe("AOA_MCP_MY_SERVER_V2_TOKEN");
  });

  it("cannot produce a dangerous key from a hostile name", () => {
    // __proto__ must not survive into an env var name
    expect(envVarNameFor("__proto__")).toBe("AOA_MCP___PROTO___TOKEN");
  });

  it("does not collapse runs of separators (A22)", () => {
    // A `[^a-zA-Z0-9]+` quantifier would map both to AOA_MCP_A_B_TOKEN, so two
    // distinct connectors would share one env var and one secret would win.
    expect(envVarNameFor("a-b")).not.toBe(envVarNameFor("a--b"));
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
      authTokenEnvVar: "AOA_MCP_NOTION_TOKEN",
    });
    expect(env.AOA_MCP_NOTION_TOKEN).toBe("secret-abc");
  });

  it("sets authTokenEnvVar to the same value as the env-map key for CLIs that need a NAME, not a header string", () => {
    const { specs, env } = buildConnectorSpecs([httpRow]);
    const spec = specs.notion as { authTokenEnvVar?: string };
    expect(spec.authTokenEnvVar).toBe("AOA_MCP_NOTION_TOKEN");
    expect(spec.authTokenEnvVar).toBe(Object.keys(env)[0]);
    expect(env[spec.authTokenEnvVar as string]).toBe("secret-abc");
  });

  it("omits authTokenEnvVar on an http spec when the row has no secret", () => {
    const { specs } = buildConnectorSpecs([{ ...httpRow, secretValue: null }]);
    const spec = specs.notion as { authTokenEnvVar?: string };
    expect(spec.authTokenEnvVar).toBeUndefined();
  });

  it("never sets authTokenEnvVar on a stdio spec, even when the row has a secret", () => {
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
    const spec = specs.pg as { authTokenEnvVar?: string };
    expect(spec.authTokenEnvVar).toBeUndefined();
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

  it("substitutes ${TOKEN} in stdio args, not just env", () => {
    const { specs } = buildConnectorSpecs([
      {
        serverName: "pg",
        transport: "stdio",
        url: null,
        command: "npx",
        args: ["-y", "dbhub", "--token", "${TOKEN}"],
        headerTemplate: {},
        envTemplate: {},
        secretValue: "postgres://x",
      },
    ]);
    expect(specs.pg).toEqual({
      kind: "stdio",
      command: "npx",
      args: ["-y", "dbhub", "--token", "${AOA_MCP_PG_TOKEN}"],
      env: {},
    });
  });

  it("skips an unknown transport even when a command is present", () => {
    // Not skipped merely for lack of a command: transport is free text in the
    // schema, and an `else` falling through to stdio would emit a stdio spec.
    const { specs } = buildConnectorSpecs([
      { ...httpRow, serverName: "future", transport: "sse", command: "npx" },
    ]);
    expect(specs.future).toBeUndefined();
  });

  it("omits an http row with no url and a stdio row with no command", () => {
    const { specs } = buildConnectorSpecs([
      { ...httpRow, serverName: "bad1", url: null },
      { ...httpRow, serverName: "bad2", transport: "stdio", command: null },
    ]);
    expect(specs.bad1).toBeUndefined();
    expect(specs.bad2).toBeUndefined();
  });

  it("leaves no env entry for a skipped connector", () => {
    const { env } = buildConnectorSpecs([
      { ...httpRow, serverName: "bad1", url: null },
      { ...httpRow, serverName: "bad2", transport: "stdio", command: null },
      { ...httpRow, serverName: "bad3", transport: "sse" },
    ]);
    expect(Object.keys(env)).toEqual([]);
  });

  it("keeps healthy connectors when another row is malformed", () => {
    const { specs, env, skipped } = buildConnectorSpecs([
      {
        ...httpRow,
        serverName: "broken",
        transport: "stdio",
        command: "npx",
        args: "not-an-array" as unknown as string[],
      },
      httpRow,
    ]);
    expect(specs.notion).toBeDefined(); // the healthy row survives
    expect(specs.broken).toBeUndefined();
    expect(env.AOA_MCP_BROKEN_TOKEN).toBeUndefined();
    expect(skipped).toEqual([{ serverName: "broken", reason: "malformed_row" }]);
  });

  it("reports every skipped connector with a reason", () => {
    const { skipped } = buildConnectorSpecs([
      { ...httpRow, serverName: "no-url", url: null },
      { ...httpRow, serverName: "no-cmd", transport: "stdio", command: null },
      { ...httpRow, serverName: "weird", transport: "sse" },
      {
        ...httpRow,
        serverName: "broken",
        transport: "stdio",
        command: "npx",
        args: "nope" as unknown as string[],
      },
    ]);
    expect(skipped).toEqual([
      { serverName: "no-url", reason: "missing_url" },
      { serverName: "no-cmd", reason: "missing_command" },
      { serverName: "weird", reason: "unknown_transport" },
      { serverName: "broken", reason: "malformed_row" },
    ]);
  });

  it("substitutes every occurrence of ${TOKEN}, not just the first", () => {
    // `replace` instead of `replaceAll` leaves a literal ${TOKEN} that expands
    // to empty at spawn time — an auth failure with no error message.
    const { specs } = buildConnectorSpecs([
      { ...httpRow, headerTemplate: { Authorization: "${TOKEN}", Pair: "${TOKEN}/${TOKEN}" } },
    ]);
    expect(specs.notion).toEqual({
      kind: "http",
      url: "https://mcp.notion.com/mcp",
      headers: {
        Authorization: "${AOA_MCP_NOTION_TOKEN}",
        Pair: "${AOA_MCP_NOTION_TOKEN}/${AOA_MCP_NOTION_TOKEN}",
      },
      authTokenEnvVar: "AOA_MCP_NOTION_TOKEN",
    });
  });

  it("omits the env entry when a connector has no secret", () => {
    const { specs, env } = buildConnectorSpecs([{ ...httpRow, secretValue: null }]);
    expect(specs.notion).toBeDefined();
    expect(env.AOA_MCP_NOTION_TOKEN).toBeUndefined();
  });

  it("builds a null-prototype specs map so a __proto__ connector cannot poison it", () => {
    const { specs, env } = buildConnectorSpecs([{ ...httpRow, serverName: "__proto__" }]);
    expect(Object.prototype.hasOwnProperty.call(specs, "__proto__")).toBe(true);
    expect((specs as Record<string, unknown>).url).toBeUndefined(); // no read-through
    // The env map must be null-prototype too. Not exploitable today (keys are
    // always AOA_MCP_*_TOKEN), but A13 requires it and nothing else would catch
    // a future edit dropping it.
    expect(Object.getPrototypeOf(env)).toBe(null);
  });

  it("keeps two connectors independent", () => {
    const { specs, env, skipped } = buildConnectorSpecs([
      httpRow,
      { ...httpRow, serverName: "linear", url: "https://mcp.linear.app/mcp", secretValue: "secret-xyz" },
    ]);
    expect(specs.notion).toBeDefined();
    expect(specs.linear).toBeDefined();
    expect(env.AOA_MCP_NOTION_TOKEN).toBe("secret-abc");
    expect(env.AOA_MCP_LINEAR_TOKEN).toBe("secret-xyz");
    expect(skipped).toEqual([]); // healthy rows report no skips
  });
});

describe("selectConnectorRowsForAgent", () => {
  const active = { id: "c1", status: "active" };
  const pending = { id: "c2", status: "pending_approval" };
  const disabled = { id: "c3", status: "disabled" };

  it("returns only active connectors the agent opted into", () => {
    const rows = selectConnectorRowsForAgent({
      connectors: [active, pending, disabled],
      enabledConnectorIds: new Set(["c1", "c2", "c3"]),
      isCommander: false,
    });
    expect(rows.map((r) => r.id)).toEqual(["c1"]);
  });

  it("excludes an active connector the agent has not opted into", () => {
    const rows = selectConnectorRowsForAgent({
      connectors: [active],
      enabledConnectorIds: new Set(),
      isCommander: false,
    });
    expect(rows).toEqual([]);
  });

  it("gives Commander every ACTIVE connector regardless of opt-in (D3)", () => {
    const rows = selectConnectorRowsForAgent({
      connectors: [active, pending, disabled],
      enabledConnectorIds: new Set(),
      isCommander: true,
    });
    expect(rows.map((r) => r.id)).toEqual(["c1"]);
  });

  it("never gives Commander a non-active connector", () => {
    const rows = selectConnectorRowsForAgent({
      connectors: [pending, disabled],
      enabledConnectorIds: new Set(["c2", "c3"]),
      isCommander: true,
    });
    expect(rows).toEqual([]);
  });
});
