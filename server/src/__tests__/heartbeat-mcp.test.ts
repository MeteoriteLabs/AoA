import fs from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  ORG_HEARTBEAT_TOOL_ALLOWLIST,
  prepareHeartbeatMcpDelivery,
  resolveHeartbeatEffectiveAutonomy,
} from "../services/heartbeat-mcp.js";
import {
  adapterSupportsConnectors,
  buildConnectorSpecs,
  CONNECTOR_CAPABLE_ADAPTERS,
  type ResolvedConnectorRow,
} from "../services/mcp-connectors.js";

vi.mock("node:fs/promises", () => ({
  default: {
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}));

const params = {
  companyId: "company-1",
  userId: "agent-1",
  userRole: "team_member",
  enabledCapabilities: ["system_actions"],
  bridgeEntrypoint: "C:/aoa/mcp-bridge.js",
  agentKind: "org",
  toolAllowlist: [...ORG_HEARTBEAT_TOOL_ALLOWLIST],
  actorType: "agent",
  agentId: "agent-1",
  runId: "run-1",
  effectiveAutonomy: 1,
} as const;

describe("heartbeat effective autonomy", () => {
  it("uses the source Discussion override before the company dial", () => {
    expect(resolveHeartbeatEffectiveAutonomy({
      companyAutonomyLevel: 2,
      discussionAutonomyLevel: 1,
    })).toBe(1);
  });

  it("falls back to the company dial and fails closed for invalid values", () => {
    expect(resolveHeartbeatEffectiveAutonomy({
      companyAutonomyLevel: 2,
      discussionAutonomyLevel: null,
    })).toBe(2);
    expect(resolveHeartbeatEffectiveAutonomy({
      companyAutonomyLevel: 9,
      discussionAutonomyLevel: undefined,
    })).toBe(0);
  });
});

describe("heartbeat MCP delivery", () => {
  it("exposes only the organization-agent task-work surface", () => {
    expect(ORG_HEARTBEAT_TOOL_ALLOWLIST).toEqual(expect.arrayContaining([
      "get_task",
      "get_heartbeat_context",
      "post_task_comment",
      "attach_task_artifact",
      "set_task_status",
      "ask_human",
    ]));
    expect(ORG_HEARTBEAT_TOOL_ALLOWLIST).not.toEqual(expect.arrayContaining([
      "create_task",
      "assign_task",
      "update_task",
      "create_approval",
    ]));
  });

  it("passes a provider-neutral bridge to Codex without Claude-only arguments", async () => {
    const delivery = await prepareHeartbeatMcpDelivery({
      adapterType: "codex_local",
      agentId: "agent-1",
      runId: "run-1",
      config: { args: ["--existing"] },
      params,
    });

    expect(delivery.config).toEqual({ args: ["--existing"] });
    expect(delivery.mcpBridge).toMatchObject({
      command: "node",
      args: ["C:/aoa/mcp-bridge.js"],
      env: {
        AOA_SESSION_COMPANY_ID: "company-1",
        AOA_ACTOR_TYPE: "agent",
        AOA_AGENT_ID: "agent-1",
        AOA_RUN_ID: "run-1",
        AOA_EFFECTIVE_AUTONOMY: "1",
      },
    });
    await delivery.cleanup();
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(fs.unlink).not.toHaveBeenCalled();
  });

  it("serializes only an explicitly declared human-question capability", async () => {
    const delivery = await prepareHeartbeatMcpDelivery({
      adapterType: "deterministic_test",
      agentId: "agent-1",
      runId: "run-1",
      config: {},
      params: {
        ...params,
        humanQuestionCapabilities: {
          mode: "live_relay",
          preservesProducerInvocationId: true,
          pauseDeadline: true,
          resumeSession: true,
          cancelWait: true,
        },
      },
    });

    expect(JSON.parse(delivery.mcpBridge.env.AOA_HUMAN_QUESTION_CAPABILITIES)).toEqual({
      mode: "live_relay",
      preservesProducerInvocationId: true,
      pauseDeadline: true,
      resumeSession: true,
      cancelWait: true,
    });
  });

  it("adds and removes the Claude MCP config while retaining the neutral bridge", async () => {
    const delivery = await prepareHeartbeatMcpDelivery({
      adapterType: "claude_local",
      agentId: "agent-1",
      runId: "run-1",
      config: { args: ["--existing"] },
      params,
    });

    expect(delivery.config.args).toEqual([
      "--mcp-config",
      expect.stringMatching(/aoa-heartbeat-mcp-agent-1-run-1\.json$/),
      "--strict-mcp-config",
      "--existing",
    ]);
    expect(delivery.mcpBridge.env.AOA_RUN_ID).toBe("run-1");
    expect(fs.writeFile).toHaveBeenCalledOnce();

    await delivery.cleanup();
    expect(fs.unlink).toHaveBeenCalledWith(expect.stringMatching(/aoa-heartbeat-mcp-agent-1-run-1\.json$/));
  });

  it("uses extraArgs when present because the Claude adapter gives them precedence", async () => {
    const delivery = await prepareHeartbeatMcpDelivery({
      adapterType: "claude_local",
      agentId: "agent-1",
      runId: "run-1",
      config: { args: ["--ignored"], extraArgs: ["--allowedTools", "mcp__aoa__ask_human"] },
      params,
    });

    expect(delivery.config.args).toEqual(["--ignored"]);
    expect(delivery.config.extraArgs).toEqual([
      "--mcp-config",
      expect.stringMatching(/aoa-heartbeat-mcp-agent-1-run-1\.json$/),
      "--strict-mcp-config",
      "--allowedTools",
      "mcp__aoa__ask_human",
    ]);
  });
});

describe("heartbeat MCP delivery: user --mcp-config escape hatch is closed (Task 12)", () => {
  it("strips a user-injected --mcp-config from extraArgs while keeping AoA's own config", async () => {
    const delivery = await prepareHeartbeatMcpDelivery({
      adapterType: "claude_local",
      agentId: "agent-1",
      runId: "run-1",
      // Founder tries to smuggle an external MCP server through the Extra args box.
      config: {
        extraArgs: ["--mcp-config", "C:/evil.json", "--strict-mcp-config", "--allowedTools", "mcp__aoa__ask_human"],
      },
      params,
    });

    const args = delivery.config.extraArgs as string[];
    // Property 1 — the hole is closed: the user injection is gone.
    expect(args).not.toContain("C:/evil.json");
    expect(args.filter((a) => a === "--mcp-config")).toHaveLength(1); // only AoA's own
    expect(args.filter((a) => a === "--strict-mcp-config")).toHaveLength(1); // only AoA's own

    // Property 2 — AoA's own injection SURVIVES (the anti-regression trap).
    expect(args[0]).toBe("--mcp-config");
    expect(args[1]).toMatch(/aoa-heartbeat-mcp-agent-1-run-1\.json$/);
    expect(args[2]).toBe("--strict-mcp-config");
    // The user's benign, unrelated args are preserved.
    expect(args).toContain("--allowedTools");
    expect(args).toContain("mcp__aoa__ask_human");
  });

  it("strips a user-injected --mcp-config from args (no extraArgs present)", async () => {
    const delivery = await prepareHeartbeatMcpDelivery({
      adapterType: "claude_local",
      agentId: "agent-1",
      runId: "run-1",
      config: { args: ["--mcp-config=C:/evil.json", "--model", "opus"] },
      params,
    });

    const args = delivery.config.args as string[];
    // Hole closed.
    expect(args).not.toContain("--mcp-config=C:/evil.json");
    expect(args.filter((a) => a === "--mcp-config")).toHaveLength(1); // only AoA's own
    // AoA config survives + benign args preserved.
    expect(args[0]).toBe("--mcp-config");
    expect(args[2]).toBe("--strict-mcp-config");
    expect(args).toContain("--model");
    expect(args).toContain("opus");
  });
});

/** Parse the JSON that was written to the last `--mcp-config` file. */
function lastWrittenMcpConfig(): { mcpServers: Record<string, unknown> } {
  const writeFile = fs.writeFile as unknown as ReturnType<typeof vi.fn>;
  const lastCall = writeFile.mock.calls.at(-1);
  if (!lastCall) throw new Error("fs.writeFile was never called");
  return JSON.parse(lastCall[1] as string);
}

describe("heartbeat MCP delivery with connectors (Plan 1, claude_local)", () => {
  // Faithful end-to-end shape: a resolved connector row -> buildConnectorSpecs
  // -> prepareHeartbeatMcpDelivery. Proves placeholder substitution and the
  // secret-only-in-env boundary through the real chain, not a hand-built spec.
  const httpRow: ResolvedConnectorRow = {
    serverName: "slack",
    transport: "http",
    url: "https://slack.example/mcp",
    command: null,
    args: [],
    headerTemplate: { Authorization: "Bearer ${TOKEN}" },
    envTemplate: {},
    secretValue: "xoxb-super-secret",
  };

  it("splices connector servers into the config FILE with placeholders and NO plaintext secret", async () => {
    const { specs, env } = buildConnectorSpecs([httpRow]);
    const delivery = await prepareHeartbeatMcpDelivery({
      adapterType: "claude_local",
      agentId: "agent-1",
      runId: "run-1",
      config: { args: ["--existing"], env: { PRE_EXISTING: "keep" } },
      params,
      extraMcpServers: specs,
      connectorEnv: env,
    });

    const written = lastWrittenMcpConfig();
    // aoa is always present; the connector rides alongside it.
    expect(written.mcpServers.aoa).toBeDefined();
    expect(written.mcpServers.slack).toEqual({
      type: "http",
      url: "https://slack.example/mcp",
      headers: { Authorization: "Bearer ${AOA_MCP_SLACK_TOKEN}" },
    });
    // The real secret MUST NOT appear anywhere in the config file.
    expect(JSON.stringify(written)).not.toContain("xoxb-super-secret");

    // The delivered config.env carries the REAL token, merged over pre-existing env.
    expect(delivery.config.env).toEqual({
      PRE_EXISTING: "keep",
      AOA_MCP_SLACK_TOKEN: "xoxb-super-secret",
    });
  });

  it("merges connector tokens AFTER config.env so a same-named key cannot shadow the token", async () => {
    const { specs, env } = buildConnectorSpecs([httpRow]);
    const delivery = await prepareHeartbeatMcpDelivery({
      adapterType: "claude_local",
      agentId: "agent-1",
      runId: "run-1",
      // Adversarial: host config already carries a stale value under the token key.
      config: { args: ["--existing"], env: { AOA_MCP_SLACK_TOKEN: "STALE" } },
      params,
      extraMcpServers: specs,
      connectorEnv: env,
    });

    expect((delivery.config.env as Record<string, string>).AOA_MCP_SLACK_TOKEN).toBe(
      "xoxb-super-secret",
    );
  });

  it("stdio connector: substitutes ${TOKEN} in args and env, secret only in delivered env", async () => {
    const stdioRow: ResolvedConnectorRow = {
      serverName: "gh-cli",
      transport: "stdio",
      url: null,
      command: "gh-mcp",
      args: ["--token", "${TOKEN}"],
      headerTemplate: {},
      envTemplate: { GH_TOKEN: "${TOKEN}" },
      secretValue: "ghp_secret_value",
    };
    const { specs, env } = buildConnectorSpecs([stdioRow]);
    const delivery = await prepareHeartbeatMcpDelivery({
      adapterType: "claude_local",
      agentId: "agent-1",
      runId: "run-1",
      config: {},
      params,
      extraMcpServers: specs,
      connectorEnv: env,
    });

    const written = lastWrittenMcpConfig();
    expect(written.mcpServers["gh-cli"]).toEqual({
      command: "gh-mcp",
      args: ["--token", "${AOA_MCP_GH_CLI_TOKEN}"],
      env: { GH_TOKEN: "${AOA_MCP_GH_CLI_TOKEN}" },
    });
    expect(JSON.stringify(written)).not.toContain("ghp_secret_value");
    expect(delivery.config.env).toEqual({ AOA_MCP_GH_CLI_TOKEN: "ghp_secret_value" });
  });

  it("REGRESSION: no connectors produces output identical to before this task", async () => {
    // Baseline: the pre-task call shape (no connector fields at all).
    const baseline = await prepareHeartbeatMcpDelivery({
      adapterType: "claude_local",
      agentId: "agent-1",
      runId: "run-1",
      config: { args: ["--existing"] },
      params,
    });
    const baselineWritten = lastWrittenMcpConfig();

    // Same call, now passing EMPTY connector maps (an agent with no connectors).
    const withEmpty = await prepareHeartbeatMcpDelivery({
      adapterType: "claude_local",
      agentId: "agent-1",
      runId: "run-1",
      config: { args: ["--existing"] },
      params,
      extraMcpServers: {},
      connectorEnv: {},
    });
    const emptyWritten = lastWrittenMcpConfig();

    // The delivered config must be deep-equal, and crucially must NOT gain an
    // `env` key (spreading an absent config.env would coerce it to `{}`).
    expect(withEmpty.config).toEqual(baseline.config);
    expect("env" in withEmpty.config).toBe(false);
    // The written config FILE must be byte-identical.
    expect(emptyWritten).toEqual(baselineWritten);
  });

  it("an unauthenticated connector (no secret) adds a server but no env key", async () => {
    const noSecretRow: ResolvedConnectorRow = {
      serverName: "public-http",
      transport: "http",
      url: "https://public.example/mcp",
      command: null,
      args: [],
      headerTemplate: {},
      envTemplate: {},
      secretValue: null,
    };
    const { specs, env } = buildConnectorSpecs([noSecretRow]);
    expect(Object.keys(env)).toHaveLength(0); // no token minted
    const delivery = await prepareHeartbeatMcpDelivery({
      adapterType: "claude_local",
      agentId: "agent-1",
      runId: "run-1",
      config: { args: ["--existing"] },
      params,
      extraMcpServers: specs,
      connectorEnv: env,
    });

    const written = lastWrittenMcpConfig();
    expect(written.mcpServers["public-http"]).toBeDefined();
    // connectorEnv is empty -> the regression guard leaves config.env untouched.
    expect("env" in delivery.config).toBe(false);
  });
});

describe("connector-capable adapter predicate (Plan 2b Task 3)", () => {
  it("covers exactly the four CLI adapters that can host external MCP servers", () => {
    expect([...CONNECTOR_CAPABLE_ADAPTERS].sort()).toEqual([
      "claude_local",
      "codex_local",
      "gemini_local",
      "opencode_local",
    ]);
  });

  it("admits the CLI adapters and rejects everything without an MCP runtime", () => {
    for (const t of ["claude_local", "codex_local", "gemini_local", "opencode_local"]) {
      expect(adapterSupportsConnectors(t)).toBe(true);
    }
    // These have no MCP client at all — they must never trigger a connector DB read.
    for (const t of ["process", "http", "cursor", "hermes_local", "deterministic_test"]) {
      expect(adapterSupportsConnectors(t)).toBe(false);
    }
    expect(adapterSupportsConnectors(undefined)).toBe(false);
    expect(adapterSupportsConnectors(null)).toBe(false);
  });
});

describe("heartbeat MCP delivery to NON-claude adapters (Plan 2b Task 3)", () => {
  const httpRow: ResolvedConnectorRow = {
    serverName: "slack",
    transport: "http",
    url: "https://slack.example/mcp",
    command: null,
    args: [],
    headerTemplate: { Authorization: "Bearer ${TOKEN}" },
    envTemplate: {},
    secretValue: "xoxb-super-secret",
  };

  /** How many `--mcp-config` files have been written so far (mock is module-scoped). */
  function writeCount(): number {
    return (fs.writeFile as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
  }

  it("merges connectorEnv into the delivered config.env and exposes extraMcpServers", async () => {
    const { specs, env } = buildConnectorSpecs([httpRow]);
    const before = writeCount();
    const delivery = await prepareHeartbeatMcpDelivery({
      adapterType: "codex_local",
      agentId: "agent-1",
      runId: "run-1",
      config: { args: ["--existing"], env: { PRE_EXISTING: "keep" } },
      params,
      extraMcpServers: specs,
      connectorEnv: env,
    });

    // (a) the REAL token reaches the child: every adapter copies config.env into
    // its spawn env, so no new plumbing is needed beyond this merge.
    expect(delivery.config.env).toEqual({
      PRE_EXISTING: "keep",
      AOA_MCP_SLACK_TOKEN: "xoxb-super-secret",
    });
    // (b) the specs ride the carrier for the per-adapter writers (Tasks 4-6).
    expect(delivery.extraMcpServers).toEqual(specs);
    expect(delivery.extraMcpServers?.slack).toBeDefined();
    // (c) NO claude-only delivery leaks in: args untouched, no config FILE written.
    expect(delivery.config.args).toEqual(["--existing"]);
    expect(writeCount()).toBe(before);
    await delivery.cleanup();
  });

  it("merges connector tokens AFTER config.env so a same-named key cannot shadow the token", async () => {
    const { specs, env } = buildConnectorSpecs([httpRow]);
    const delivery = await prepareHeartbeatMcpDelivery({
      adapterType: "opencode_local",
      agentId: "agent-1",
      runId: "run-1",
      config: { env: { AOA_MCP_SLACK_TOKEN: "STALE" } },
      params,
      extraMcpServers: specs,
      connectorEnv: env,
    });

    expect((delivery.config.env as Record<string, string>).AOA_MCP_SLACK_TOKEN).toBe(
      "xoxb-super-secret",
    );
  });

  it("REGRESSION: a non-claude adapter with NO connectors is byte-identical to before this task", async () => {
    const baseline = await prepareHeartbeatMcpDelivery({
      adapterType: "codex_local",
      agentId: "agent-1",
      runId: "run-1",
      config: { args: ["--existing"] },
      params,
    });
    const before = writeCount();
    const withEmpty = await prepareHeartbeatMcpDelivery({
      adapterType: "codex_local",
      agentId: "agent-1",
      runId: "run-1",
      config: { args: ["--existing"] },
      params,
      extraMcpServers: {},
      connectorEnv: {},
    });

    expect(withEmpty.config).toEqual(baseline.config);
    expect(withEmpty.config).toEqual({ args: ["--existing"] });
    // Spreading an absent config.env would coerce it to `{}` — it must stay absent.
    expect("env" in withEmpty.config).toBe(false);
    expect(writeCount()).toBe(before);
  });

  it("the claude branch also exposes extraMcpServers on the delivery", async () => {
    const { specs, env } = buildConnectorSpecs([httpRow]);
    const delivery = await prepareHeartbeatMcpDelivery({
      adapterType: "claude_local",
      agentId: "agent-1",
      runId: "run-1",
      config: {},
      params,
      extraMcpServers: specs,
      connectorEnv: env,
    });
    expect(delivery.extraMcpServers).toEqual(specs);
    await delivery.cleanup();
  });
});
