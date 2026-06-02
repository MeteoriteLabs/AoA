import { describe, expect, it, vi } from "vitest";
import type { AdapterProviderSandboxRunInput } from "@armyofagents/adapter-utils";
import { testEnvironment } from "./test.js";

describe("claude_local testEnvironment", () => {
  it("probes provider-sandbox targets through the selected environment", async () => {
    const providerInputs: AdapterProviderSandboxRunInput[] = [];
    const providerRunner = {
      execute: vi.fn(async (input: AdapterProviderSandboxRunInput) => {
        providerInputs.push(input);
        if (input.args.includes("--print")) {
          return {
            exitCode: 0,
            signal: null,
            timedOut: false,
            stderr: "",
            stdout: [
              JSON.stringify({
                type: "system",
                subtype: "init",
                session_id: "claude-session-1",
                model: "claude-test",
              }),
              JSON.stringify({
                type: "result",
                subtype: "success",
                session_id: "claude-session-1",
                result: "hello",
                usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
                total_cost_usd: 0,
              }),
            ].join("\n"),
          };
        }
        return {
          exitCode: 0,
          signal: null,
          timedOut: false,
          stderr: "",
          stdout: "",
        };
      }),
    };

    const result = await testEnvironment({
      adapterType: "claude_local",
      companyId: "company-1",
      config: {
        command: "claude",
        env: { ANTHROPIC_API_KEY: "test-anthropic-key" },
      },
      environmentName: "E2B Cloud QA",
      executionTarget: {
        type: "provider-sandbox",
        provider: "e2b",
        providerLeaseId: "sandbox-1",
        remoteCwd: "/home/user/aoa-workspace",
        shell: "bash",
        runner: providerRunner,
      },
    });

    expect(result.status).toBe("warn");
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        code: "claude_environment_target",
        message: "Probing inside environment: E2B Cloud QA",
      }),
    );
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        code: "claude_hello_probe_passed",
      }),
    );
    const runInput = providerInputs.find((input) => input.args.includes("--print"));
    expect(runInput).toBeDefined();
    expect(runInput).toMatchObject({
      command: "bash",
      cwd: "/home/user/aoa-workspace",
      env: { ANTHROPIC_API_KEY: "test-anthropic-key" },
    });
  });
});
