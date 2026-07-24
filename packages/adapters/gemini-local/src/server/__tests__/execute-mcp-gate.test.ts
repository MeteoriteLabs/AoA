// Plan 2b Task 6 (D) — the C2 presence gate at execute() level.
//
// The gate must test PRESENCE, not truthiness. `mcpServers: {}` means "every
// connector was deleted or disabled" and MUST still reach the writer, because
// the writer's sweep is what removes the entries a previous run wrote. Gating
// on non-emptiness (or on `ctx.mcpBridge` alone) leaves a revoked connector in
// .gemini/settings.json forever and the agent keeps the tool.

import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { McpServerSpec } from "@armyofagents/adapter-utils";
import { execute } from "../execute.js";

async function writeFakeGeminiCommand(commandPath: string): Promise<string> {
  const script = `#!/usr/bin/env node
console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "s1", model: "gemini-test" }));
console.log(JSON.stringify({ type: "result", usage: { input_tokens: 1, output_tokens: 1, cached_input_tokens: 0 }, total_cost_usd: 0 }));
`;
  await fs.writeFile(commandPath + ".js", script, "utf8");
  await fs.chmod(commandPath + ".js", 0o755);
  if (process.platform === "win32") {
    const cmdPath = commandPath + ".cmd";
    await fs.writeFile(cmdPath, `@node "%~dp0agent.js" %*\r\n`, "utf8");
    return cmdPath;
  }
  await fs.writeFile(commandPath, script, "utf8");
  await fs.chmod(commandPath, 0o755);
  return commandPath;
}

const BRIDGE = {
  command: "node",
  args: ["/path/to/mcp-bridge.js"],
  env: { AOA_SESSION_COMPANY_ID: "company-1" },
};

const NOTION: McpServerSpec = {
  kind: "http",
  url: "https://mcp.notion.com/mcp",
  headers: { Authorization: "Bearer ${AOA_MCP_NOTION_TOKEN}" },
  authTokenEnvVar: "AOA_MCP_NOTION_TOKEN",
};

interface RunOpts {
  mcpBridge?: typeof BRIDGE;
  mcpServers?: Record<string, McpServerSpec>;
  workspace: string;
  commandPath: string;
}

async function runOnce(opts: RunOpts): Promise<string[]> {
  const logs: string[] = [];
  const result = await execute({
    runId: "run-gemini-mcp-gate",
    agent: {
      id: "agent-1",
      companyId: "company-1",
      name: "Gemini Coder",
      adapterType: "gemini_local",
      adapterConfig: {},
    },
    runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
    config: {
      command: opts.commandPath,
      cwd: opts.workspace,
      env: {},
      promptTemplate: "Prompt.",
      timeoutSec: 10,
      graceSec: 1,
    },
    context: {},
    executionTarget: { type: "local" },
    runtimeCommandSpec: { command: "gemini", installCommand: "do-not-run" },
    ...(opts.mcpBridge !== undefined ? { mcpBridge: opts.mcpBridge } : {}),
    ...(opts.mcpServers !== undefined ? { mcpServers: opts.mcpServers } : {}),
    authToken: "secret-run-token",
    onLog: async (_stream, chunk) => {
      logs.push(chunk);
    },
  });
  expect(result.exitCode).toBe(0);
  return logs;
}

async function setup(): Promise<{ root: string; workspace: string; commandPath: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aoa-gemini-mcp-gate-"));
  const workspace = path.join(root, "workspace");
  await fs.mkdir(workspace, { recursive: true });
  const commandPath = await writeFakeGeminiCommand(path.join(root, "agent"));
  return { root, workspace, commandPath };
}

function settingsPath(workspace: string): string {
  return path.join(workspace, ".gemini", "settings.json");
}

describe("gemini execute — C2 MCP presence gate", () => {
  it("writes settings.json when ONLY ctx.mcpServers is present (no bridge)", async () => {
    const { root, workspace, commandPath } = await setup();
    try {
      await runOnce({ workspace, commandPath, mcpServers: { notion: NOTION } });

      const written = JSON.parse(await fs.readFile(settingsPath(workspace), "utf8")) as Record<
        string,
        any
      >;
      expect(written.mcpServers.notion.httpUrl).toBe("https://mcp.notion.com/mcp");
      // gemini's native syntax IS ${VAR} — emitted verbatim, never rewritten.
      expect(written.mcpServers.notion.headers.Authorization).toBe(
        "Bearer ${AOA_MCP_NOTION_TOKEN}",
      );
      expect(written.mcpServers.aoa).toBeUndefined();
    } finally {
      await fs.rm(root, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("an EMPTY mcpServers map still reaches the writer and sweeps a stale connector", async () => {
    const { root, workspace, commandPath } = await setup();
    try {
      await runOnce({ workspace, commandPath, mcpBridge: BRIDGE, mcpServers: { notion: NOTION } });
      let written = JSON.parse(await fs.readFile(settingsPath(workspace), "utf8")) as Record<
        string,
        any
      >;
      expect(written.mcpServers.notion).toBeDefined();

      // Founder deletes the connector — emptiness is NOT absence.
      await runOnce({ workspace, commandPath, mcpBridge: BRIDGE, mcpServers: {} });

      written = JSON.parse(await fs.readFile(settingsPath(workspace), "utf8")) as Record<
        string,
        any
      >;
      expect(written.mcpServers.notion).toBeUndefined();
      expect(written.mcpServers.aoa).toBeDefined();
    } finally {
      await fs.rm(root, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("does not write settings.json when NEITHER field is present", async () => {
    const { root, workspace, commandPath } = await setup();
    try {
      await runOnce({ workspace, commandPath });
      await expect(fs.access(settingsPath(workspace))).rejects.toThrow();
    } finally {
      await fs.rm(root, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("surfaces a classified connector skip on the run log", async () => {
    const { root, workspace, commandPath } = await setup();
    try {
      const logs = await runOnce({
        workspace,
        commandPath,
        mcpBridge: BRIDGE,
        mcpServers: { aoa: NOTION },
      });
      expect(logs.join("")).toContain(
        '[aoa] gemini MCP connector "aoa" skipped: reserved_name',
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true }).catch(() => {});
    }
  });
});
