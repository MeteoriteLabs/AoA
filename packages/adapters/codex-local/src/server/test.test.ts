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

type FakeRun = { exitCode: number; stdout: string; stderr?: string; timedOut?: boolean };

/** Realistic `codex exec --json` JSONL for a failed hello probe. */
function failedHelloStdout(event: Record<string, unknown>): string {
  return JSON.stringify({ type: "error", ...event });
}

async function runProbeWith(opts: { hello: FakeRun; authStatus: FakeRun }) {
  const runner = {
    execute: vi.fn(async (input: AdapterProviderSandboxRunInput) => {
      if (input.args.includes("login") && input.args.includes("status")) {
        const r = opts.authStatus;
        return { exitCode: r.exitCode, signal: null, timedOut: r.timedOut ?? false, stdout: r.stdout, stderr: r.stderr ?? "" };
      }
      if (input.args.includes("exec")) {
        const r = opts.hello;
        return { exitCode: r.exitCode, signal: null, timedOut: r.timedOut ?? false, stdout: r.stdout, stderr: r.stderr ?? "" };
      }
      return { exitCode: 0, signal: null, timedOut: false, stdout: "", stderr: "" };
    }),
  };
  const result = await testEnvironment({
    adapterType: "codex_local",
    companyId: "company-1",
    config: { command: "codex", env: { OPENAI_API_KEY: "test-openai-key" } },
    environmentName: "probe-test",
    executionTarget: {
      type: "provider-sandbox",
      provider: "e2b",
      providerLeaseId: "sandbox-1",
      remoteCwd: "/home/user/aoa-workspace",
      shell: "bash",
      runner,
    },
  });
  return { result, runner };
}

function calledAuthStatus(runner: { execute: ReturnType<typeof vi.fn> }): boolean {
  return runner.execute.mock.calls.some((call) => {
    const input = call[0] as AdapterProviderSandboxRunInput;
    return input.args.includes("login") && input.args.includes("status");
  });
}

describe("codex_local testEnvironment — auth_required vs auth_expired", () => {
  // Field evidence shape: a revoked/expired token surfaces as a `type: "error"`
  // JSONL event with an auth-flavored message, and a nonzero exit code.
  const REVOKED_HELLO: FakeRun = {
    exitCode: 1,
    stdout: failedHelloStdout({ message: "Unauthorized: your token has expired or been revoked" }),
  };

  it("emits codex_hello_probe_auth_expired with the auth method when status is logged in", async () => {
    const { result, runner } = await runProbeWith({
      hello: REVOKED_HELLO,
      authStatus: { exitCode: 0, stdout: "Logged in using ChatGPT" },
    });

    expect(result.checks).toContainEqual(
      expect.objectContaining({
        code: "codex_hello_probe_auth_expired",
        message: expect.stringContaining("ChatGPT"),
      }),
    );
    expect(result.checks.some((c) => c.code === "codex_hello_probe_failed")).toBe(false);
    expect(calledAuthStatus(runner)).toBe(true);
  });

  it("emits codex_hello_probe_auth_required when status is logged out", async () => {
    const { result } = await runProbeWith({
      hello: REVOKED_HELLO,
      authStatus: { exitCode: 0, stdout: "Not logged in" },
    });

    expect(result.checks).toContainEqual(expect.objectContaining({ code: "codex_hello_probe_auth_required" }));
    expect(result.checks.some((c) => c.code === "codex_hello_probe_auth_expired")).toBe(false);
  });

  it("degrades to auth_required, without throwing, when the status command is unavailable", async () => {
    const { result } = await runProbeWith({
      hello: REVOKED_HELLO,
      authStatus: { exitCode: 1, stdout: "error: unknown command 'login'" },
    });

    expect(result.checks).toContainEqual(expect.objectContaining({ code: "codex_hello_probe_auth_required" }));
    expect(result.checks.some((c) => c.code === "codex_hello_probe_failed")).toBe(false);
  });

  it("emits codex_hello_probe_failed for a non-auth failure and never spawns the status probe", async () => {
    const { result, runner } = await runProbeWith({
      hello: {
        exitCode: 1,
        stdout: failedHelloStdout({ message: "API Error: 500 internal server error" }),
      },
      authStatus: { exitCode: 0, stdout: "Logged in using ChatGPT" },
    });

    expect(result.checks).toContainEqual(expect.objectContaining({ code: "codex_hello_probe_failed" }));
    expect(calledAuthStatus(runner)).toBe(false);
  });

  it("passes as before on a successful hello probe, without spawning the status probe", async () => {
    const { result, runner } = await runProbeWith({
      hello: {
        exitCode: 0,
        stdout: [
          JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "hello" } }),
          JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1, cached_input_tokens: 0 } }),
        ].join("\n"),
      },
      authStatus: { exitCode: 0, stdout: "Logged in using ChatGPT" },
    });

    expect(result.checks).toContainEqual(expect.objectContaining({ code: "codex_hello_probe_passed" }));
    expect(calledAuthStatus(runner)).toBe(false);
  });
});
