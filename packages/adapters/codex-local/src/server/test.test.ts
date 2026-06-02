import { describe, expect, it, vi } from "vitest";
import type { AdapterProviderSandboxRunInput } from "@armyofagents/adapter-utils";
import { testEnvironment } from "./test.js";

describe("codex_local testEnvironment", () => {
  it("probes provider-sandbox targets through the selected environment with remote CODEX_HOME", async () => {
    const providerInputs: AdapterProviderSandboxRunInput[] = [];
    const providerRunner = {
      execute: vi.fn(async (input: AdapterProviderSandboxRunInput) => {
        providerInputs.push(input);
        if (input.args.includes("exec")) {
          return {
            exitCode: 0,
            signal: null,
            timedOut: false,
            stderr: "",
            stdout: [
              JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "hello" } }),
              JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1, cached_input_tokens: 0 } }),
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
      adapterType: "codex_local",
      companyId: "company-1",
      config: {
        command: "codex",
        env: { OPENAI_API_KEY: "test-openai-key" },
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

    expect(result.status).toBe("pass");
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        code: "codex_environment_target",
        message: "Probing inside environment: E2B Cloud QA",
      }),
    );
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        code: "codex_hello_probe_passed",
      }),
    );
    const runInput = providerInputs.find((input) => input.args.includes("exec"));
    expect(runInput).toBeDefined();
    expect(runInput).toMatchObject({
      command: "bash",
      cwd: "/home/user/aoa-workspace",
      env: {
        OPENAI_API_KEY: "test-openai-key",
        CODEX_HOME: "/home/user/aoa-workspace/.aoa-codex-home",
      },
    });
    expect(runInput!.args.join("\n")).toContain("codex login --with-api-key");
  });
});
