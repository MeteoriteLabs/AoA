/**
 * FU-23 (codex_local, app-server / bridged path) — the supervised
 * `codex app-server` spawn must strip the SAME connector-aware set as the exec
 * path. `execute()` computes `codexUnsetEnvKeys` once and feeds BOTH spawns; here
 * we inject `deps.runAppServerTurn` and assert the list it receives.
 *
 * ABLATION: remove `unsetEnvKeys: codexUnsetEnvKeys` from the runAppServerTurn
 * call in execute.ts → `input.unsetEnvKeys` falls back to the app-server default
 * `["OPENAI_API_KEY"]` and the "connectors present → DATABASE_URL stripped"
 * assertion goes RED.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { McpServerSpec, AdapterRuntimeDecisionBroker } from "@armyofagents/adapter-utils";
import { execute } from "../execute.js";
import type { RunAppServerTurnInput } from "../execute-app-server.js";

// A real, resolvable fake `codex` command so `ensureCommandResolvable` passes on
// CI (which has no codex binary in PATH). The injected runAppServerTurn spy means
// this executable is never actually spawned — it only needs to exist on disk.
// Same helper as execute-appserver-model-routing.test.ts.
async function writeFakeCodexCommand(commandBase: string): Promise<string> {
  const script = `#!/usr/bin/env node
console.log(JSON.stringify({ type: "thread.started", thread_id: "codex-fu23" }));
`;
  const jsPath = commandBase + ".js";
  await fs.writeFile(jsPath, script, "utf8");
  await fs.chmod(jsPath, 0o755);
  if (process.platform === "win32") {
    const cmdPath = commandBase + ".cmd";
    await fs.writeFile(cmdPath, `@node "%~dp0${path.basename(jsPath)}" %*\r\n`, "utf8");
    return cmdPath;
  }
  await fs.writeFile(commandBase, script, "utf8");
  await fs.chmod(commandBase, 0o755);
  return commandBase;
}

const AMBIENT_SECRETS: Record<string, string> = {
  DATABASE_URL: "postgres://user:pw@localhost:5432/aoa",
  OPENAI_API_KEY: "sk-embeddings-should-not-leak",
  AOA_SECRETS_MASTER_KEY: "raw-master-key-should-not-leak",
};

const NOTION: McpServerSpec = {
  kind: "http",
  url: "https://mcp.notion.com/mcp",
  headers: { Authorization: "Bearer ${AOA_MCP_NOTION_TOKEN}" },
  authTokenEnvVar: "AOA_MCP_NOTION_TOKEN",
};
const BRIDGE = { command: "node", args: ["/b.js"], env: { AOA_SESSION_COMPANY_ID: "c1" } };

// Minimal broker — never invoked in this test (no approval frames from the fake).
const broker: AdapterRuntimeDecisionBroker = {
  requestDecision: async () => ({ decision: "deny" }),
} as unknown as AdapterRuntimeDecisionBroker;

const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const [k, v] of Object.entries(AMBIENT_SECRETS)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
});
afterEach(() => {
  for (const k of Object.keys(AMBIENT_SECRETS)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function captureAppServerInput(withConnectors: boolean): Promise<RunAppServerTurnInput> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aoa-codex-appsrv-fu23-"));
  const workspace = path.join(root, "workspace");
  const codexHome = path.join(root, "codex-home");
  await fs.mkdir(workspace, { recursive: true });
  const commandPath = await writeFakeCodexCommand(path.join(root, "agent"));
  const prevCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;
  let captured: RunAppServerTurnInput | null = null;
  try {
    await execute(
      {
        runId: "run-codex-appsrv-fu23",
        agent: { id: "a1", companyId: "c1", name: "Codex", adapterType: "codex_local", adapterConfig: {} },
        runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
        config: {
          command: commandPath,
          cwd: workspace,
          env: { AOA_MCP_NOTION_TOKEN: "connector-token" },
          promptTemplate: "Prompt.",
          timeoutSec: 10,
          graceSec: 1,
        },
        context: {},
        executionTarget: { type: "local" as const },
        runtimeCommandSpec: { command: commandPath, installCommand: "do-not-run" },
        runtimeDecisionRoutingEnabled: true,
        runtimeDecisionBroker: broker,
        ...(withConnectors ? { mcpBridge: BRIDGE, mcpServers: { notion: NOTION } } : {}),
        authToken: "secret-run-token",
        onLog: async () => {},
      },
      {
        runAppServerTurn: async (input) => {
          captured = input;
          return {
            timedOut: false,
            sessionId: "s1",
            summary: "ok",
            usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
            errorMessage: null,
            errorCode: null,
            clearSession: false,
          };
        },
      },
    );
  } finally {
    if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prevCodexHome;
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  }
  if (!captured) throw new Error("runAppServerTurn was not invoked (bridged path not taken)");
  return captured;
}

describe("codex_local FU-23 env scrub (app-server path)", () => {
  it("connectors present → app-server receives the broadened ambient-secret strip", async () => {
    const input = await captureAppServerInput(true);
    expect(input.unsetEnvKeys).toContain("OPENAI_API_KEY");
    expect(input.unsetEnvKeys).toContain("DATABASE_URL");
    expect(input.unsetEnvKeys).toContain("AOA_SECRETS_MASTER_KEY");
  });

  it("no connectors → app-server keeps only the pre-existing OPENAI_API_KEY strip", async () => {
    const input = await captureAppServerInput(false);
    expect(input.unsetEnvKeys).toEqual(["OPENAI_API_KEY"]);
  });
});
