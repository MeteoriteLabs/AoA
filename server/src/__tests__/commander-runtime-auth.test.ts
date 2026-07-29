import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzleOperatorStubs, makeTableProxy } from "./helpers/drizzle-mock.js";

vi.mock("drizzle-orm", () => drizzleOperatorStubs());
vi.mock("@armyofagents/db", () => ({
  agents: makeTableProxy("agents"),
}));

const resolveAdapterConfigForRuntime = vi.hoisted(() => vi.fn());
vi.mock("../services/secrets.js", () => ({
  secretService: () => ({ resolveAdapterConfigForRuntime }),
}));

const resolveAgentSubscriptionEnvironment = vi.hoisted(() => vi.fn());
const mayUseLegacySubscriptionHome = vi.hoisted(() =>
  vi.fn((error: unknown, required: boolean) => error === "binding_missing" && !required),
);
vi.mock("../services/provider-credential-bindings.js", () => ({
  resolveAgentSubscriptionEnvironment,
  mayUseLegacySubscriptionHome,
}));

import { resolveCommanderRuntimeEnvironment } from "../services/internal-agent/commander-runtime-auth.js";

function dbWithAgent(
  adapterType: string,
  adapterConfig: Record<string, unknown> = {},
) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ adapterType, adapterConfig }],
        }),
      }),
    }),
  } as never;
}

describe("resolveCommanderRuntimeEnvironment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAdapterConfigForRuntime.mockResolvedValue({ env: {} });
    resolveAgentSubscriptionEnvironment.mockResolvedValue({});
  });

  it("uses a resolved company or agent API key without consulting subscription bindings", async () => {
    resolveAdapterConfigForRuntime.mockResolvedValue({
      env: { OPENAI_API_KEY: "sk-company", IGNORED_NON_STRING: 4 },
    });

    const env = await resolveCommanderRuntimeEnvironment(
      dbWithAgent("codex_local", { env: { OPENAI_API_KEY: { type: "secret_ref" } } }),
      {
        companyId: "company-1",
        commanderAgentId: "commander-1",
        actorUserId: "user-2",
        env: { AOA_SCOPED_CLI_AUTH: "true" },
      },
    );

    expect(env).toEqual({ OPENAI_API_KEY: "sk-company" });
    expect(resolveAgentSubscriptionEnvironment).not.toHaveBeenCalled();
    expect(resolveAdapterConfigForRuntime).toHaveBeenCalledWith(
      "company-1",
      "codex_local",
      expect.any(Object),
      expect.objectContaining({
        consumerType: "agent",
        consumerId: "commander-1",
        actorType: "user",
        actorId: "user-2",
      }),
    );
  });

  it("uses the Commander-bound subscription home when no API key is configured", async () => {
    resolveAdapterConfigForRuntime.mockResolvedValue({ env: { SAFE_FLAG: "1" } });
    resolveAgentSubscriptionEnvironment.mockResolvedValue({
      HOME: "/aoa/company/owner",
      CODEX_HOME: "/aoa/company/owner/codex",
    });

    const env = await resolveCommanderRuntimeEnvironment(dbWithAgent("codex_local"), {
      companyId: "company-1",
      commanderAgentId: "commander-1",
      actorUserId: "teammate-1",
      env: {
        AOA_SCOPED_CLI_AUTH: "true",
        AOA_EXECUTION_TARGET_ID: "hetzner-control-plane",
      },
    });

    expect(env).toEqual({
      SAFE_FLAG: "1",
      HOME: "/aoa/company/owner",
      CODEX_HOME: "/aoa/company/owner/codex",
    });
    expect(resolveAgentSubscriptionEnvironment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId: "company-1",
        agentId: "commander-1",
        provider: "openai",
        executionTargetId: "hetzner-control-plane",
      }),
    );
  });

  it("fails closed when scoped auth is required and the governed binding is missing", async () => {
    resolveAgentSubscriptionEnvironment.mockRejectedValue("binding_missing");

    await expect(
      resolveCommanderRuntimeEnvironment(dbWithAgent("claude_local"), {
        companyId: "company-1",
        commanderAgentId: "commander-1",
        actorUserId: "user-1",
        env: { AOA_SCOPED_CLI_AUTH: "true" },
      }),
    ).rejects.toBe("binding_missing");
  });

  it("preserves the legacy local subscription fallback only while scoped auth is disabled", async () => {
    resolveAdapterConfigForRuntime.mockResolvedValue({ env: { SAFE_FLAG: "1" } });
    resolveAgentSubscriptionEnvironment.mockRejectedValue("binding_missing");

    await expect(
      resolveCommanderRuntimeEnvironment(dbWithAgent("claude_local"), {
        companyId: "company-1",
        commanderAgentId: "commander-1",
        actorUserId: "user-1",
        env: { AOA_SCOPED_CLI_AUTH: "false" },
      }),
    ).resolves.toEqual({ SAFE_FLAG: "1" });
  });
});
