import fs from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  ORG_HEARTBEAT_TOOL_ALLOWLIST,
  prepareHeartbeatMcpDelivery,
  resolveHeartbeatEffectiveAutonomy,
} from "../services/heartbeat-mcp.js";

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
