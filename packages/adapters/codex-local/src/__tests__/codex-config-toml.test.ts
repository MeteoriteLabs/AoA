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

  // -------------------------------------------------------------------------
  // B5 (Plan 2b): ownership fencing. AoA-written blocks are wrapped in sentinel
  // comments so the writer can strip EVERYTHING it previously owned without
  // enumerating names. Without this, a connector block written by an earlier run
  // survives forever once the connector is disabled/deleted — the agent keeps
  // the tool. Content OUTSIDE the fence is user-authored and must survive.
  // -------------------------------------------------------------------------

  it("wraps the AoA-written block in aoa-managed sentinel comments", async () => {
    await writeCodexMcpConfigToml(tmpDir, {
      command: "node",
      args: ["/bridge.js"],
      env: { AOA_SESSION_COMPANY_ID: "c" },
    });

    const raw = await fs.readFile(path.join(tmpDir, "config.toml"), "utf8");
    const startIdx = raw.indexOf("# >>> aoa-managed");
    const endIdx = raw.indexOf("# <<< aoa-managed");
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(endIdx).toBeGreaterThan(startIdx);
    // The AoA block lives INSIDE the fence.
    const blockIdx = raw.indexOf("[mcp_servers.aoa]");
    expect(blockIdx).toBeGreaterThan(startIdx);
    expect(blockIdx).toBeLessThan(endIdx);
  });

  it("strips ALL previously-fenced AoA blocks (incl. connectors no longer present) and preserves user blocks byte-for-byte", async () => {
    const userBlock = [
      "[mcp_servers.mine]",
      'command = "my-server"',
      'args = ["--flag"]',
      "",
      "[mcp_servers.mine.env]",
      'MY_TOKEN = "keep-me"',
    ].join("\n");

    const preExisting = [
      "[other]",
      'foo = "bar"',
      "",
      userBlock,
      "",
      "# >>> aoa-managed (do not edit below; regenerated each run)",
      "[mcp_servers.aoa]",
      'command = "node"',
      'args = ["/old/bridge.js"]',
      "",
      "[mcp_servers.aoa.env]",
      'AOA_SESSION_COMPANY_ID = "old"',
      "",
      "[mcp_servers.stale_connector]",
      'url = "https://stale.example.com/mcp"',
      'bearer_token_env_var = "AOA_MCP_STALE_TOKEN"',
      "",
      "[mcp_servers.another_stale]",
      'command = "stale-bin"',
      "args = []",
      "# <<< aoa-managed",
      "",
    ].join("\n");
    await fs.writeFile(path.join(tmpDir, "config.toml"), preExisting, "utf8");

    await writeCodexMcpConfigToml(tmpDir, {
      command: "node",
      args: ["/new/bridge.js"],
      env: { AOA_SESSION_COMPANY_ID: "new" },
    });

    const raw = await fs.readFile(path.join(tmpDir, "config.toml"), "utf8");

    // Every previously-fenced AoA block is gone — including ones whose names the
    // writer never knew about.
    expect(raw).not.toContain("stale_connector");
    expect(raw).not.toContain("another_stale");
    expect(raw).not.toContain("AOA_MCP_STALE_TOKEN");
    expect(raw).not.toContain("/old/bridge.js");

    // The user's own block survives byte-for-byte.
    expect(raw).toContain(userBlock);

    // Unrelated settings survive; the fresh AoA block is present exactly once.
    const parsed = parseToml(raw);
    expect(parsed["other"].foo).toBe("bar");
    expect(parsed["mcp_servers.mine"].command).toBe("my-server");
    expect(parsed["mcp_servers.mine.env"].MY_TOKEN).toBe("keep-me");
    expect(parsed["mcp_servers.aoa"].args).toEqual(["/new/bridge.js"]);
    expect(raw.match(/^\[mcp_servers\.aoa\]$/gm) ?? []).toHaveLength(1);
    expect(raw.match(/^# >>> aoa-managed/gm) ?? []).toHaveLength(1);
    expect(raw.match(/^# <<< aoa-managed/gm) ?? []).toHaveLength(1);
  });

  it("upgrades a legacy pre-fence config.toml without duplicating the aoa block", async () => {
    // Exactly what the pre-fence writer produced: an UNFENCED [mcp_servers.aoa].
    const legacy = [
      "[other]",
      'foo = "bar"',
      "",
      "[mcp_servers.aoa]",
      'command = "node"',
      'args = ["/legacy/bridge.js"]',
      "",
      "[mcp_servers.aoa.env]",
      'AOA_SESSION_COMPANY_ID = "legacy"',
      "",
    ].join("\n");
    await fs.writeFile(path.join(tmpDir, "config.toml"), legacy, "utf8");

    await writeCodexMcpConfigToml(tmpDir, {
      command: "node",
      args: ["/new/bridge.js"],
      env: { AOA_SESSION_COMPANY_ID: "new" },
    });

    const raw = await fs.readFile(path.join(tmpDir, "config.toml"), "utf8");

    // Old unfenced block removed, not duplicated.
    expect(raw.match(/^\[mcp_servers\.aoa\]$/gm) ?? []).toHaveLength(1);
    expect(raw.match(/^\[mcp_servers\.aoa\.env\]$/gm) ?? []).toHaveLength(1);
    expect(raw).not.toContain("/legacy/bridge.js");
    expect(raw).not.toContain('AOA_SESSION_COMPANY_ID = "legacy"');

    // Now fenced.
    const startIdx = raw.indexOf("# >>> aoa-managed");
    const blockIdx = raw.indexOf("[mcp_servers.aoa]");
    const endIdx = raw.indexOf("# <<< aoa-managed");
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(blockIdx).toBeGreaterThan(startIdx);
    expect(endIdx).toBeGreaterThan(blockIdx);

    // Unrelated content preserved; a second write stays stable.
    expect(parseToml(raw)["other"].foo).toBe("bar");
    await writeCodexMcpConfigToml(tmpDir, {
      command: "node",
      args: ["/new/bridge.js"],
      env: { AOA_SESSION_COMPANY_ID: "new" },
    });
    const raw2 = await fs.readFile(path.join(tmpDir, "config.toml"), "utf8");
    expect(raw2.match(/^\[mcp_servers\.aoa\]$/gm) ?? []).toHaveLength(1);
    expect(raw2.match(/^# >>> aoa-managed/gm) ?? []).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // I1 regression (data loss). An UNMATCHED start-fence line — a user comment
  // that looks like one, or a real fence whose closing line someone deleted
  // while tidying the file — must NOT be treated as a fence. The previous
  // strip-to-EOF behaviour silently deleted the rest of the user's config.
  // -------------------------------------------------------------------------

  it("an ORPHAN start fence (no end fence) preserves everything after it", async () => {
    const preExisting = [
      "[other]",
      'foo = "bar"',
      "# >>> aoa-managed servers I used to run manually",
      "[mcp_servers.mine]",
      'command = "mine"',
      'token = "SECRET"',
      "",
    ].join("\n");
    await fs.writeFile(path.join(tmpDir, "config.toml"), preExisting, "utf8");

    await writeCodexMcpConfigToml(tmpDir, {
      command: "node",
      args: ["/bridge.js"],
      env: { AOA_SESSION_COMPANY_ID: "c" },
    });

    const raw = await fs.readFile(path.join(tmpDir, "config.toml"), "utf8");

    // The user's tail survives — this is the exact data loss that was reported.
    expect(raw).toContain("[mcp_servers.mine]");
    expect(raw).toContain('token = "SECRET"');
    expect(raw).toContain('command = "mine"');
    expect(raw).toContain("# >>> aoa-managed servers I used to run manually");
    expect(parseToml(raw)["other"].foo).toBe("bar");
    // And the fresh AoA block was still written.
    expect(parseToml(raw)["mcp_servers.aoa"].args).toEqual(["/bridge.js"]);

    // A SECOND write must still find its own (real, matched) fence rather than
    // pairing the orphan start with AoA's end line — otherwise the user's tail
    // would be swallowed on the next run instead of this one.
    await writeCodexMcpConfigToml(tmpDir, {
      command: "node",
      args: ["/bridge2.js"],
      env: { AOA_SESSION_COMPANY_ID: "c" },
    });
    const raw2 = await fs.readFile(path.join(tmpDir, "config.toml"), "utf8");
    expect(raw2).toContain('token = "SECRET"');
    expect(raw2).toContain("[mcp_servers.mine]");
    expect(raw2.match(/^\[mcp_servers\.aoa\]$/gm) ?? []).toHaveLength(1);
    expect(parseToml(raw2)["mcp_servers.aoa"].args).toEqual(["/bridge2.js"]);
  });

  it("an indented orphan start fence also preserves the tail", async () => {
    const preExisting = [
      "[other]",
      'foo = "bar"',
      "   # >>> aoa-managed (leftover from a hand edit)",
      "[mcp_servers.mine]",
      'token = "SECRET"',
      "",
    ].join("\n");
    await fs.writeFile(path.join(tmpDir, "config.toml"), preExisting, "utf8");

    await writeCodexMcpConfigToml(tmpDir, {
      command: "node",
      args: ["/bridge.js"],
      env: { AOA_SESSION_COMPANY_ID: "c" },
    });

    const raw = await fs.readFile(path.join(tmpDir, "config.toml"), "utf8");
    expect(raw).toContain('token = "SECRET"');
    expect(raw).toContain("[mcp_servers.mine]");
  });

  it("does not treat a near-miss comment like '# >>> aoa-managed-notes' as a fence", async () => {
    const preExisting = [
      "# >>> aoa-managed-notes for myself",
      "[mcp_servers.mine]",
      'token = "SECRET"',
      "# <<< aoa-managed-notes",
      "",
    ].join("\n");
    await fs.writeFile(path.join(tmpDir, "config.toml"), preExisting, "utf8");

    await writeCodexMcpConfigToml(tmpDir, {
      command: "node",
      args: ["/bridge.js"],
      env: { AOA_SESSION_COMPANY_ID: "c" },
    });

    const raw = await fs.readFile(path.join(tmpDir, "config.toml"), "utf8");
    // The whole "-notes" region is user content: it must be untouched, even
    // though it has a matching-looking start AND end.
    expect(raw).toContain("# >>> aoa-managed-notes for myself");
    expect(raw).toContain("[mcp_servers.mine]");
    expect(raw).toContain('token = "SECRET"');
    expect(raw).toContain("# <<< aoa-managed-notes");
  });

  it("still strips a MATCHED fence pair written by an older fence format", async () => {
    // Guard the fix above did not cost us the core property: an end line in the
    // ORIGINAL bare format (`# <<< aoa-managed`) still closes a region.
    const preExisting = [
      "[keep_me]",
      'x = "y"',
      "# >>> aoa-managed (do not edit below; regenerated each run)",
      "[mcp_servers.stale_connector]",
      'url = "https://stale.example.com/mcp"',
      "# <<< aoa-managed",
      "",
    ].join("\n");
    await fs.writeFile(path.join(tmpDir, "config.toml"), preExisting, "utf8");

    await writeCodexMcpConfigToml(tmpDir, {
      command: "node",
      args: ["/bridge.js"],
      env: { AOA_SESSION_COMPANY_ID: "c" },
    });

    const raw = await fs.readFile(path.join(tmpDir, "config.toml"), "utf8");
    expect(raw).not.toContain("stale_connector");
    expect(raw).not.toContain("stale.example.com");
    expect(parseToml(raw)["keep_me"].x).toBe("y");
  });

  it("writes atomically and leaves no temp file behind", async () => {
    await writeCodexMcpConfigToml(tmpDir, {
      command: "node",
      args: ["/bridge.js"],
      env: { AOA_SESSION_COMPANY_ID: "c" },
    });

    const entries = await fs.readdir(tmpDir);
    expect(entries).toContain("config.toml");
    expect(entries.filter((name) => name.includes(".tmp-"))).toEqual([]);
  });

  // M1: the strippers are LF-internal, so a CRLF file must be re-emitted as
  // CRLF or a Windows user's config silently changes line endings on every run.
  it("preserves CRLF line endings in an existing config.toml", async () => {
    const preExisting = ["[other]", 'foo = "bar"', ""].join("\r\n");
    await fs.writeFile(path.join(tmpDir, "config.toml"), preExisting, "utf8");

    await writeCodexMcpConfigToml(tmpDir, {
      command: "node",
      args: ["/bridge.js"],
      env: { AOA_SESSION_COMPANY_ID: "c" },
    });

    const raw = await fs.readFile(path.join(tmpDir, "config.toml"), "utf8");
    expect(raw).toContain("\r\n");
    // No bare LF survives (every newline is a CRLF).
    expect(/[^\r]\n/.test(raw)).toBe(false);
    expect(parseToml(raw)["other"].foo).toBe("bar");
    expect(parseToml(raw)["mcp_servers.aoa"].args).toEqual(["/bridge.js"]);
  });

  it("keeps an LF file on LF", async () => {
    await fs.writeFile(path.join(tmpDir, "config.toml"), '[other]\nfoo = "bar"\n', "utf8");
    await writeCodexMcpConfigToml(tmpDir, {
      command: "node",
      args: ["/bridge.js"],
      env: { AOA_SESSION_COMPANY_ID: "c" },
    });
    const raw = await fs.readFile(path.join(tmpDir, "config.toml"), "utf8");
    expect(raw).not.toContain("\r\n");
  });

  it("keeps the top-level model line working alongside the fence", async () => {
    const { writeCodexModelConfigToml } = await import("../server/codex-config-toml.js");
    await writeCodexMcpConfigToml(tmpDir, {
      command: "node",
      args: ["/bridge.js"],
      env: { AOA_SESSION_COMPANY_ID: "c" },
    });
    await writeCodexModelConfigToml(tmpDir, "gpt-5-codex");
    await writeCodexMcpConfigToml(tmpDir, {
      command: "node",
      args: ["/bridge.js"],
      env: { AOA_SESSION_COMPANY_ID: "c" },
    });

    const raw = await fs.readFile(path.join(tmpDir, "config.toml"), "utf8");
    expect(raw.match(/^model = /gm) ?? []).toHaveLength(1);
    expect(raw.match(/^\[mcp_servers\.aoa\]$/gm) ?? []).toHaveLength(1);
    expect(raw.match(/^# >>> aoa-managed/gm) ?? []).toHaveLength(1);
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
      const managedHome = path.join(codexHome, "aoa-instances", "company-1", "agent-1");
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
      const managedHome = path.join(codexHome, "aoa-instances", "company-1", "agent-1");
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
