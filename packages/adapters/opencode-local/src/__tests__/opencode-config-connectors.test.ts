// Plan 2b Task 6 — opencode external MCP connectors.
//
// opencode expands `{env:VAR}`, NOT `${VAR}`. Specs arrive carrying the
// `${AOA_MCP_*}` form (D5: placeholder on disk, real value in the spawn env),
// so this writer must translate. THE TRAP (B2N9) is translating only headers —
// that reproduces the "connector authenticates as no-one" bug on every stdio
// connector, silently.

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AOA_MCP_MANIFEST_FILENAME, type McpServerSpec } from "@armyofagents/adapter-utils";
import { writeOpenCodeMcpConfigJson } from "../server/opencode-config-json.js";

const BRIDGE_SPEC = {
  command: "node",
  args: ["/path/to/mcp-bridge.js"],
  env: { AOA_SESSION_COMPANY_ID: "co-1" },
};

/**
 * Exactly what `buildConnectorSpecs` produces for a connector whose stored
 * secret is the literal string REALSECRET: the spec carries only the
 * PLACEHOLDER, and the value travels separately in the spawn env.
 */
const REAL_SECRET_VALUE = "REALSECRET";
const HTTP_CONNECTOR: McpServerSpec = {
  kind: "http",
  url: "https://mcp.notion.com/mcp",
  headers: { Authorization: "Bearer ${AOA_MCP_NOTION_TOKEN}" },
  authTokenEnvVar: "AOA_MCP_NOTION_TOKEN",
};
const STDIO_CONNECTOR_WITH_SECRET: McpServerSpec = {
  kind: "stdio",
  command: "npx",
  args: ["-y", "srv", "--token", "${AOA_MCP_SLACK_TOKEN}"],
  env: { SLACK_TOKEN: "${AOA_MCP_SLACK_TOKEN}" },
};

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aoa-opencode-conn-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

async function readRaw(): Promise<string> {
  return fs.readFile(path.join(tmpDir, "opencode.json"), "utf8");
}
async function readConfig(): Promise<Record<string, any>> {
  return JSON.parse(await readRaw());
}

describe("opencode external connectors — emitted shape", () => {
  it("emits an http connector as type:remote with {env:VAR} headers", async () => {
    await writeOpenCodeMcpConfigJson(tmpDir, BRIDGE_SPEC, {
      externalServers: { notion: HTTP_CONNECTOR },
    });

    const written = await readConfig();
    expect(written.mcp.notion).toEqual({
      type: "remote",
      url: "https://mcp.notion.com/mcp",
      headers: { Authorization: "Bearer {env:AOA_MCP_NOTION_TOKEN}" },
      enabled: true,
    });
    expect(written.mcp.aoa.type).toBe("local");
  });

  it("REWRITES ${VAR} in stdio args AND environment values, not just headers (B2N9)", async () => {
    await writeOpenCodeMcpConfigJson(tmpDir, BRIDGE_SPEC, {
      externalServers: { slack: STDIO_CONNECTOR_WITH_SECRET },
    });

    const written = await readConfig();
    expect(written.mcp.slack).toEqual({
      type: "local",
      command: ["npx", "-y", "srv", "--token", "{env:AOA_MCP_SLACK_TOKEN}"],
      environment: { SLACK_TOKEN: "{env:AOA_MCP_SLACK_TOKEN}" },
      enabled: true,
    });
    // A surviving `${AOA_MCP_...}` anywhere means opencode hands the server
    // those literal characters as its credential.
    expect(await readRaw()).not.toContain("${AOA_MCP_");
  });

  it("leaves unrelated ${...} text alone", async () => {
    await writeOpenCodeMcpConfigJson(tmpDir, null, {
      externalServers: {
        srv: {
          kind: "stdio",
          command: "npx",
          args: ["--home", "${HOME}/x"],
          env: { PATH_HINT: "${HOME}/bin" },
        },
      },
    });
    const written = await readConfig();
    expect(written.mcp.srv.command).toEqual(["npx", "--home", "${HOME}/x"]);
    expect(written.mcp.srv.environment).toEqual({ PATH_HINT: "${HOME}/bin" });
  });

  it("writes without a bridge (connectors-only run)", async () => {
    const result = await writeOpenCodeMcpConfigJson(tmpDir, null, {
      externalServers: { notion: HTTP_CONNECTOR },
    });
    const written = await readConfig();
    expect(written.mcp.aoa).toBeUndefined();
    expect(written.mcp.notion.type).toBe("remote");
    expect(result.managedServerNames).toEqual(["notion"]);
  });

  it("is idempotent — same input, byte-identical output", async () => {
    const opts = {
      externalServers: { notion: HTTP_CONNECTOR, slack: STDIO_CONNECTOR_WITH_SECRET },
    };
    await writeOpenCodeMcpConfigJson(tmpDir, BRIDGE_SPEC, opts);
    const first = await readRaw();
    await writeOpenCodeMcpConfigJson(tmpDir, BRIDGE_SPEC, opts);
    expect(await readRaw()).toBe(first);
  });
});

describe("opencode external connectors — D5: no live secret on disk", () => {
  it("a connector whose token is REALSECRET never puts REALSECRET in the file", async () => {
    // The value NEVER enters the writer: it rides in the spawn env under the
    // name the placeholder points at. This is the whole D5 indirection.
    const connectorEnv = { AOA_MCP_NOTION_TOKEN: REAL_SECRET_VALUE };

    await writeOpenCodeMcpConfigJson(tmpDir, BRIDGE_SPEC, {
      externalServers: { notion: HTTP_CONNECTOR, slack: STDIO_CONNECTOR_WITH_SECRET },
    });

    const raw = await readRaw();
    expect(raw).not.toContain(REAL_SECRET_VALUE);
    // ...and the file references the env var that DOES hold it.
    expect(raw).toContain("{env:AOA_MCP_NOTION_TOKEN}");
    expect(connectorEnv.AOA_MCP_NOTION_TOKEN).toBe(REAL_SECRET_VALUE);

    // The sidecar manifest must not leak it either.
    const manifest = await fs.readFile(path.join(tmpDir, AOA_MCP_MANIFEST_FILENAME), "utf8");
    expect(manifest).not.toContain(REAL_SECRET_VALUE);
  });
});

describe("opencode external connectors — reserved names + classified skips", () => {
  it("reserved names never displace AoA's own servers", async () => {
    await writeOpenCodeMcpConfigJson(tmpDir, BRIDGE_SPEC, {
      externalServers: {
        aoa: { kind: "http", url: "https://evil.example.com", headers: {} },
        playwright: { kind: "http", url: "https://evil2.example.com", headers: {} },
      },
    });
    const written = await readConfig();
    expect(written.mcp.aoa.type).toBe("local");
    expect(written.mcp.aoa.command).toEqual(["node", "/path/to/mcp-bridge.js"]);
    expect(written.mcp.playwright).toBeUndefined();
  });

  it("honours a NON-DEFAULT bridge name as reserved too (M2)", async () => {
    await writeOpenCodeMcpConfigJson(tmpDir, BRIDGE_SPEC, {
      serverName: "aoa-crew",
      externalServers: {
        "aoa-crew": { kind: "http", url: "https://evil.example.com", headers: {} },
      },
    });
    const written = await readConfig();
    expect(written.mcp["aoa-crew"].type).toBe("local");
    expect(written.mcp["aoa-crew"].command).toEqual(["node", "/path/to/mcp-bridge.js"]);
  });

  it("reports reserved-name and unsupported-transport skips instead of dropping silently", async () => {
    const result = await writeOpenCodeMcpConfigJson(tmpDir, BRIDGE_SPEC, {
      externalServers: {
        aoa: { kind: "http", url: "https://evil.example.com", headers: {} },
        weird: { kind: "sse", url: "https://x" } as unknown as McpServerSpec,
        notion: HTTP_CONNECTOR,
      },
    });
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        { serverName: "aoa", reason: "reserved_name" },
        { serverName: "weird", reason: "unsupported_transport" },
      ]),
    );
    expect(result.managedServerNames.sort()).toEqual(["aoa", "notion"]);
  });

  it("does NOT skip a stdio connector carrying a secret (that is codex-only)", async () => {
    // opencode expands {env:VAR} in args/env, so its credential route works.
    const result = await writeOpenCodeMcpConfigJson(tmpDir, BRIDGE_SPEC, {
      externalServers: { slack: STDIO_CONNECTOR_WITH_SECRET },
    });
    expect(result.skipped).toEqual([]);
    expect(result.managedServerNames).toContain("slack");
  });
});

describe("opencode external connectors — B5 stale sweep", () => {
  it("removes a connector that is no longer active on the next run", async () => {
    await writeOpenCodeMcpConfigJson(tmpDir, BRIDGE_SPEC, {
      externalServers: { notion: HTTP_CONNECTOR },
    });
    expect((await readConfig()).mcp.notion).toBeDefined();

    // Founder deletes the connector → the next run delivers an EMPTY set.
    await writeOpenCodeMcpConfigJson(tmpDir, BRIDGE_SPEC, { externalServers: {} });

    const written = await readConfig();
    expect(written.mcp.notion).toBeUndefined();
    expect(written.mcp.aoa).toBeDefined();
  });

  it("NEVER removes a server the user added by hand", async () => {
    await fs.writeFile(
      path.join(tmpDir, "opencode.json"),
      JSON.stringify({ mcp: { mine: { type: "local", command: ["my-srv"] } } }),
      "utf8",
    );
    await writeOpenCodeMcpConfigJson(tmpDir, BRIDGE_SPEC, {
      externalServers: { notion: HTTP_CONNECTOR },
    });
    await writeOpenCodeMcpConfigJson(tmpDir, BRIDGE_SPEC, { externalServers: {} });

    const written = await readConfig();
    expect(written.mcp.mine).toEqual({ type: "local", command: ["my-srv"] });
    expect(written.mcp.notion).toBeUndefined();
  });

  it("preserves unrelated top-level user keys", async () => {
    await fs.writeFile(
      path.join(tmpDir, "opencode.json"),
      JSON.stringify({ theme: "dark", model: "x" }),
      "utf8",
    );
    await writeOpenCodeMcpConfigJson(tmpDir, BRIDGE_SPEC, {
      externalServers: { notion: HTTP_CONNECTOR },
    });
    const written = await readConfig();
    expect(written.theme).toBe("dark");
    expect(written.model).toBe("x");
  });

  it("adds NO unknown top-level key — opencode rejects the whole config", async () => {
    // Probed live against opencode v1.18.4:
    //   Error: Configuration is invalid ... ↳ Unrecognized key: $aoaManagedMcpServers
    // An invalid config loads ZERO MCP servers, killing AoA's own bridge with
    // it. That is why ownership is tracked in a sidecar, not in this file.
    await writeOpenCodeMcpConfigJson(tmpDir, BRIDGE_SPEC, {
      externalServers: { notion: HTTP_CONNECTOR },
    });
    expect(Object.keys(await readConfig())).toEqual(["mcp"]);
  });

  it("records ownership in the sidecar manifest", async () => {
    await writeOpenCodeMcpConfigJson(tmpDir, BRIDGE_SPEC, {
      externalServers: { notion: HTTP_CONNECTOR },
    });
    const manifest = JSON.parse(
      await fs.readFile(path.join(tmpDir, AOA_MCP_MANIFEST_FILENAME), "utf8"),
    );
    expect(manifest.managedServerNames).toEqual(["aoa", "notion"]);
  });

  it("sweeps nothing when the manifest was deleted (degrades, never data-loss)", async () => {
    await fs.writeFile(
      path.join(tmpDir, "opencode.json"),
      JSON.stringify({ mcp: { mine: { type: "local", command: ["my-srv"] } } }),
      "utf8",
    );
    await writeOpenCodeMcpConfigJson(tmpDir, BRIDGE_SPEC, {
      externalServers: { notion: HTTP_CONNECTOR },
    });
    await fs.rm(path.join(tmpDir, AOA_MCP_MANIFEST_FILENAME));

    await writeOpenCodeMcpConfigJson(tmpDir, BRIDGE_SPEC, { externalServers: {} });

    const written = await readConfig();
    expect(written.mcp.mine).toBeDefined(); // user entry intact
    expect(written.mcp.notion).toBeDefined(); // stale, but never deleted user data
  });
});

describe("opencode external connectors — adversarial names", () => {
  it("a connector named __proto__ neither pollutes the prototype nor vanishes", async () => {
    const result = await writeOpenCodeMcpConfigJson(tmpDir, BRIDGE_SPEC, {
      externalServers: {
        ["__proto__"]: { kind: "http", url: "https://attacker.example.com", headers: {} },
      },
    });

    // 1. No prototype pollution in-process.
    expect(({} as Record<string, unknown>).url).toBeUndefined();
    expect(({} as Record<string, unknown>).type).toBeUndefined();

    // 2. It did not silently vanish: it is an OWN key and is tracked as owned,
    //    so the next sweep can remove it.
    const written = await readConfig();
    expect(Object.prototype.hasOwnProperty.call(written.mcp, "__proto__")).toBe(true);
    expect(result.managedServerNames).toContain("__proto__");

    // 3. The bridge survived intact — the real risk of a lost/aliased key.
    expect(written.mcp.aoa.command).toEqual(["node", "/path/to/mcp-bridge.js"]);
  });

  it("sweeps a previously-written __proto__ connector without disturbing the prototype", async () => {
    await writeOpenCodeMcpConfigJson(tmpDir, BRIDGE_SPEC, {
      externalServers: {
        ["__proto__"]: { kind: "http", url: "https://attacker.example.com", headers: {} },
      },
    });
    await writeOpenCodeMcpConfigJson(tmpDir, BRIDGE_SPEC, { externalServers: {} });

    const written = await readConfig();
    expect(Object.prototype.hasOwnProperty.call(written.mcp, "__proto__")).toBe(false);
    expect(written.mcp.aoa).toBeDefined();
    expect(({} as Record<string, unknown>).url).toBeUndefined();
  });
});
