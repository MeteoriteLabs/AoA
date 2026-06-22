import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeCodexMcpConfigToml } from "../server/codex-config-toml.js";
import { execute } from "../server/execute.js";

// ---------------------------------------------------------------------------
// Minimal hand-rolled TOML reader. Codex's config.toml MCP block is a tiny,
// known shape:
//
//   [mcp_servers.aoa]
//   command = "node"
//   args = ["/b r/idge.js"]
//
//   [mcp_servers.aoa.env]
//   KEY = "value"
//
// We only need to verify that exact structure round-trips (string scalars,
// a string array, a nested env table) with correct TOML escaping. No TOML
// dependency exists in the workspace, so we parse the subset ourselves.
// ---------------------------------------------------------------------------

function unescapeTomlBasicString(raw: string): string {
  // raw is the content between the surrounding double quotes.
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = raw[++i];
    switch (next) {
      case "n":
        out += "\n";
        break;
      case "t":
        out += "\t";
        break;
      case "r":
        out += "\r";
        break;
      case '"':
        out += '"';
        break;
      case "\\":
        out += "\\";
        break;
      case "b":
        out += "\b";
        break;
      case "f":
        out += "\f";
        break;
      case "u": {
        const hex = raw.slice(i + 1, i + 5);
        out += String.fromCharCode(parseInt(hex, 16));
        i += 4;
        break;
      }
      default:
        out += next;
        break;
    }
  }
  return out;
}

function parseTomlBasicStringAt(text: string, startQuoteIdx: number): { value: string; endIdx: number } {
  // startQuoteIdx points at the opening double-quote.
  let i = startQuoteIdx + 1;
  let body = "";
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      body += ch + (text[i + 1] ?? "");
      i += 2;
      continue;
    }
    if (ch === '"') {
      return { value: unescapeTomlBasicString(body), endIdx: i };
    }
    body += ch;
    i++;
  }
  throw new Error("unterminated TOML string");
}

function parseStringArray(rawInsideBrackets: string): string[] {
  const result: string[] = [];
  let i = 0;
  while (i < rawInsideBrackets.length) {
    const ch = rawInsideBrackets[i];
    if (ch === '"') {
      const { value, endIdx } = parseTomlBasicStringAt(rawInsideBrackets, i);
      result.push(value);
      i = endIdx + 1;
      continue;
    }
    i++;
  }
  return result;
}

interface ParsedToml {
  [tablePath: string]: Record<string, string | string[]>;
}

/** Parse the narrow subset of TOML this feature emits. */
function parseToml(text: string): ParsedToml {
  const tables: ParsedToml = {};
  let currentTable = "";
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const tableMatch = /^\[([^\]]+)\]$/.exec(trimmed);
    if (tableMatch) {
      currentTable = tableMatch[1];
      tables[currentTable] ??= {};
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const valuePart = trimmed.slice(eq + 1).trim();
    tables[currentTable] ??= {};
    if (valuePart.startsWith("[")) {
      const inner = valuePart.slice(1, valuePart.lastIndexOf("]"));
      tables[currentTable][key] = parseStringArray(inner);
    } else if (valuePart.startsWith('"')) {
      tables[currentTable][key] = parseTomlBasicStringAt(valuePart, 0).value;
    } else {
      tables[currentTable][key] = valuePart;
    }
  }
  return tables;
}

describe("writeCodexMcpConfigToml", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aoa-codex-cfgtoml-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("writes a config.toml with the codex [mcp_servers.aoa] (+ .env) shape", async () => {
    await writeCodexMcpConfigToml(tmpDir, {
      command: "node",
      args: ["/b r/idge.js"],
      env: {
        AOA_SESSION_COMPANY_ID: "c",
        AOA_TOOL_ALLOWLIST: "submit_extracted_items",
      },
    });

    const raw = await fs.readFile(path.join(tmpDir, "config.toml"), "utf8");
    const parsed = parseToml(raw);

    expect(parsed["mcp_servers.aoa"].command).toBe("node");
    expect(parsed["mcp_servers.aoa"].args).toEqual(["/b r/idge.js"]);
    expect(parsed["mcp_servers.aoa.env"].AOA_SESSION_COMPANY_ID).toBe("c");
    expect(parsed["mcp_servers.aoa.env"].AOA_TOOL_ALLOWLIST).toBe("submit_extracted_items");
  });

  it("TOML-escapes special characters in args and env values", async () => {
    await writeCodexMcpConfigToml(tmpDir, {
      command: "node",
      args: ['/weird "path"\\with\ttab/bridge.js'],
      env: {
        WITH_QUOTE: 'a"b',
        WITH_BACKSLASH: "a\\b",
        WITH_NEWLINE: "line1\nline2",
        WITH_TAB: "a\tb",
      },
    });

    const raw = await fs.readFile(path.join(tmpDir, "config.toml"), "utf8");
    // Raw file must not contain a bare unescaped double quote inside a value
    // that would break TOML parsing — assert escape sequences are present.
    expect(raw).toContain('\\"');
    expect(raw).toContain("\\\\");
    expect(raw).toContain("\\n");
    expect(raw).toContain("\\t");

    const parsed = parseToml(raw);
    expect(parsed["mcp_servers.aoa"].args).toEqual(['/weird "path"\\with\ttab/bridge.js']);
    expect(parsed["mcp_servers.aoa.env"].WITH_QUOTE).toBe('a"b');
    expect(parsed["mcp_servers.aoa.env"].WITH_BACKSLASH).toBe("a\\b");
    expect(parsed["mcp_servers.aoa.env"].WITH_NEWLINE).toBe("line1\nline2");
    expect(parsed["mcp_servers.aoa.env"].WITH_TAB).toBe("a\tb");
  });

  it("preserves pre-existing unrelated config.toml content and a sibling auth.json", async () => {
    const preExisting = '[other]\nfoo = "bar"\n\n[profiles.default]\nmodel = "o3"\n';
    await fs.writeFile(path.join(tmpDir, "config.toml"), preExisting, "utf8");
    await fs.writeFile(
      path.join(tmpDir, "auth.json"),
      JSON.stringify({ OPENAI_API_KEY: "sk-existing" }),
      "utf8",
    );

    await writeCodexMcpConfigToml(tmpDir, {
      command: "node",
      args: ["/bridge.js"],
      env: { AOA_SESSION_COMPANY_ID: "c" },
    });

    const raw = await fs.readFile(path.join(tmpDir, "config.toml"), "utf8");
    const parsed = parseToml(raw);
    // Unrelated content intact.
    expect(parsed["other"].foo).toBe("bar");
    expect(parsed["profiles.default"].model).toBe("o3");
    // New block present.
    expect(parsed["mcp_servers.aoa"].command).toBe("node");
    expect(parsed["mcp_servers.aoa"].args).toEqual(["/bridge.js"]);
    expect(parsed["mcp_servers.aoa.env"].AOA_SESSION_COMPANY_ID).toBe("c");
    // auth.json untouched.
    const auth = JSON.parse(await fs.readFile(path.join(tmpDir, "auth.json"), "utf8"));
    expect(auth).toEqual({ OPENAI_API_KEY: "sk-existing" });
  });

  it("is idempotent — calling twice yields exactly one [mcp_servers.aoa] block", async () => {
    const spec = {
      command: "node",
      args: ["/bridge.js"],
      env: { AOA_SESSION_COMPANY_ID: "c" },
    };
    await writeCodexMcpConfigToml(tmpDir, spec);
    await writeCodexMcpConfigToml(tmpDir, spec);

    const raw = await fs.readFile(path.join(tmpDir, "config.toml"), "utf8");
    const serverHeaders = raw.match(/^\[mcp_servers\.aoa\]$/gm) ?? [];
    const envHeaders = raw.match(/^\[mcp_servers\.aoa\.env\]$/gm) ?? [];
    expect(serverHeaders).toHaveLength(1);
    expect(envHeaders).toHaveLength(1);

    const parsed = parseToml(raw);
    expect(parsed["mcp_servers.aoa"].command).toBe("node");
    expect(parsed["mcp_servers.aoa.env"].AOA_SESSION_COMPANY_ID).toBe("c");
  });

  it("strips a stale [mcp_servers.aoa] block and regenerates fresh values", async () => {
    await writeCodexMcpConfigToml(tmpDir, {
      command: "node",
      args: ["/old/bridge.js"],
      env: { AOA_SESSION_COMPANY_ID: "old" },
    });
    await writeCodexMcpConfigToml(tmpDir, {
      command: "node",
      args: ["/new/bridge.js"],
      env: { AOA_SESSION_COMPANY_ID: "new", AOA_TOOL_ALLOWLIST: "submit_extracted_items" },
    });

    const raw = await fs.readFile(path.join(tmpDir, "config.toml"), "utf8");
    expect(raw).not.toContain("/old/bridge.js");
    expect(raw).not.toContain('AOA_SESSION_COMPANY_ID = "old"');
    const parsed = parseToml(raw);
    expect(parsed["mcp_servers.aoa"].args).toEqual(["/new/bridge.js"]);
    expect(parsed["mcp_servers.aoa.env"].AOA_SESSION_COMPANY_ID).toBe("new");
    expect(parsed["mcp_servers.aoa.env"].AOA_TOOL_ALLOWLIST).toBe("submit_extracted_items");
  });
});

// ---------------------------------------------------------------------------
// Execute-level: when ctx.mcpBridge is set, execute() must write config.toml
// (with [mcp_servers.aoa]) into the managed CODEX_HOME, and the codex argv
// must contain NO --mcp-config.
// ---------------------------------------------------------------------------

async function writeFakeCodexCommand(commandPath: string): Promise<string> {
  const script = `#!/usr/bin/env node
const fs = require("node:fs");

const capturePath = process.env.AOA_TEST_CAPTURE_PATH;
const payload = {
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  prompt: fs.readFileSync(0, "utf8"),
  env: {
    CODEX_HOME: process.env.CODEX_HOME,
  },
};
if (capturePath) {
  fs.writeFileSync(capturePath, JSON.stringify(payload), "utf8");
}
console.log(JSON.stringify({ type: "thread.started", thread_id: "codex-session-1" }));
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "hello" } }));
console.log(JSON.stringify({
  type: "turn.completed",
  usage: { input_tokens: 1, output_tokens: 2, cached_input_tokens: 0 },
}));
`;
  const jsPath = commandPath + ".js";
  await fs.writeFile(jsPath, script, "utf8");
  await fs.chmod(jsPath, 0o755);

  if (process.platform === "win32") {
    const cmdPath = commandPath + ".cmd";
    await fs.writeFile(cmdPath, `@node "%~dp0agent.js" %*\r\n`, "utf8");
    return cmdPath;
  }

  await fs.writeFile(commandPath, script, "utf8");
  await fs.chmod(commandPath, 0o755);
  return commandPath;
}

describe("codex execute writes the MCP bridge into managed CODEX_HOME", () => {
  it("writes config.toml [mcp_servers.aoa] into the managed home and adds no --mcp-config", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aoa-codex-mcpbridge-"));
    const workspace = path.join(root, "workspace");
    const commandBase = path.join(root, "agent");
    const capturePath = path.join(root, "capture.json");
    const codexHome = path.join(root, "codex-home");
    await fs.mkdir(workspace, { recursive: true });
    const commandPath = await writeFakeCodexCommand(commandBase);

    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;

    try {
      const result = await execute({
        runId: "run-codex-mcp",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "Codex Coder",
          adapterType: "codex_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: workspace,
          env: {
            AOA_TEST_CAPTURE_PATH: capturePath,
          },
          promptTemplate: "Prompt for {{agent.id}}.",
          timeoutSec: 10,
          graceSec: 1,
        },
        context: {},
        executionTarget: { type: "local" },
        runtimeCommandSpec: { command: "codex", installCommand: "do-not-run" },
        mcpBridge: {
          command: "node",
          args: ["/path with space/mcp-bridge.js"],
          env: {
            AOA_SESSION_COMPANY_ID: "company-1",
            AOA_TOOL_ALLOWLIST: "submit_extracted_items",
          },
        },
        authToken: "secret-run-token",
        onLog: async () => {},
      });

      expect(result.exitCode).toBe(0);

      const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as {
        argv: string[];
        env: Record<string, string>;
      };
      // No --mcp-config injected for codex.
      expect(capture.argv).not.toContain("--mcp-config");
      // CODEX_HOME points at the managed per-company dir.
      const managedHome = path.join(codexHome, "aoa-instances", "company-1");
      expect(capture.env.CODEX_HOME).toBe(managedHome);

      // config.toml written into exactly that managed dir.
      const raw = await fs.readFile(path.join(managedHome, "config.toml"), "utf8");
      const parsed = parseToml(raw);
      expect(parsed["mcp_servers.aoa"].command).toBe("node");
      expect(parsed["mcp_servers.aoa"].args).toEqual(["/path with space/mcp-bridge.js"]);
      expect(parsed["mcp_servers.aoa.env"].AOA_SESSION_COMPANY_ID).toBe("company-1");
      expect(parsed["mcp_servers.aoa.env"].AOA_TOOL_ALLOWLIST).toBe("submit_extracted_items");
    } finally {
      if (previousCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = previousCodexHome;
      }
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("does not write config.toml when ctx.mcpBridge is absent", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aoa-codex-nomcp-"));
    const workspace = path.join(root, "workspace");
    const commandBase = path.join(root, "agent");
    const codexHome = path.join(root, "codex-home");
    await fs.mkdir(workspace, { recursive: true });
    const commandPath = await writeFakeCodexCommand(commandBase);

    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;

    try {
      const result = await execute({
        runId: "run-codex-nomcp",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "Codex Coder",
          adapterType: "codex_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: workspace,
          promptTemplate: "Prompt for {{agent.id}}.",
          timeoutSec: 10,
          graceSec: 1,
        },
        context: {},
        executionTarget: { type: "local" },
        runtimeCommandSpec: { command: "codex", installCommand: "do-not-run" },
        authToken: "secret-run-token",
        onLog: async () => {},
      });

      expect(result.exitCode).toBe(0);
      const managedHome = path.join(codexHome, "aoa-instances", "company-1");
      const exists = await fs
        .stat(path.join(managedHome, "config.toml"))
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    } finally {
      if (previousCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = previousCodexHome;
      }
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
