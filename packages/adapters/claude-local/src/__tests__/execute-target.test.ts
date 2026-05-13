import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execute } from "../server/execute.js";
import type { AdapterInvocationMeta } from "@armyofagents/adapter-utils";

async function writeFakeClaudeCommand(commandPath: string): Promise<string> {
  const script = `#!/usr/bin/env node
const fs = require("node:fs");

const capturePath = process.env.AOA_TEST_CAPTURE_PATH;
const payload = {
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  prompt: fs.readFileSync(0, "utf8"),
  env: {
    AOA_API_KEY: process.env.AOA_API_KEY,
    AOA_RUN_ID: process.env.AOA_RUN_ID,
    CUSTOM_ENV: process.env.CUSTOM_ENV,
  },
};
if (capturePath) {
  fs.writeFileSync(capturePath, JSON.stringify(payload), "utf8");
}
console.log(JSON.stringify({
  type: "system",
  subtype: "init",
  session_id: "claude-session-1",
  model: "claude-test",
}));
console.log(JSON.stringify({
  type: "assistant",
  message: { content: [{ type: "text", text: "hello" }] },
}));
console.log(JSON.stringify({
  type: "result",
  subtype: "success",
  session_id: "claude-session-1",
  result: "ok",
  usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 0 },
  total_cost_usd: 0,
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

describe("claude execute target", () => {
  it("uses explicit local target without changing command, stdin, env, or metadata", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aoa-claude-execute-target-"));
    const workspace = path.join(root, "workspace");
    const commandBase = path.join(root, "agent");
    const capturePath = path.join(root, "capture.json");
    await fs.mkdir(workspace, { recursive: true });
    const commandPath = await writeFakeClaudeCommand(commandBase);

    const metaEvents: AdapterInvocationMeta[] = [];

    try {
      const result = await execute({
        runId: "run-claude-target",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "Claude Coder",
          adapterType: "claude_local",
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
            CUSTOM_ENV: "custom-value",
          },
          promptTemplate: "Prompt for {{agent.id}} in {{runId}}.",
          timeoutSec: 10,
          graceSec: 1,
        },
        context: {},
        executionTarget: { type: "local" },
        runtimeCommandSpec: { command: "claude", installCommand: "do-not-run" },
        authToken: "secret-run-token",
        onLog: async () => {},
        onMeta: async (next) => {
          metaEvents.push(next);
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.errorMessage).toBeNull();

      const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as {
        argv: string[];
        cwd: string;
        prompt: string;
        env: Record<string, string>;
      };
      expect(capture.cwd).toBe(workspace);
      expect(capture.argv).toEqual(expect.arrayContaining(["--print", "-", "--output-format", "stream-json"]));
      expect(capture.prompt).toBe("Prompt for agent-1 in run-claude-target.");
      expect(capture.env).toMatchObject({
        AOA_API_KEY: "secret-run-token",
        AOA_RUN_ID: "run-claude-target",
        CUSTOM_ENV: "custom-value",
      });
      const meta = metaEvents.at(-1);
      expect(meta?.commandNotes).toContain("Execution target: local");
      expect(meta?.env?.AOA_API_KEY).toBe("***REDACTED***");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
