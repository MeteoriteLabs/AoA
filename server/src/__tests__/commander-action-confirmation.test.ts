import { describe, expect, it, vi } from "vitest";
import { createToolCallHandler } from "../services/internal-agent/mcp-bridge.js";
import type { AgentTool } from "../services/internal-agent/types.js";

function makeTool(name: string, requiresConfirmation: boolean): AgentTool {
  return {
    name,
    description: `${name} tool`,
    parameters: { type: "object", properties: {}, required: [] },
    category: "action",
    requiredRole: "team_member",
    requiresConfirmation,
    execute: async () => ({ success: true, data: { done: true }, summary: "done" }),
  };
}

const neverExecute = async () => ({ success: true, data: {}, summary: "" });

// Minimal valid ToolContext for testing the confirmation gate.
// userRole must be a recognised role string so the role enforcement gate
// (which runs before requiresConfirmation) does not block these calls.
// These action-category fixtures also need system_actions enabled because
// capability enforcement runs before requiresConfirmation.
const baseCtx = { userRole: "team_member", enabledCapabilities: ["system_actions"] } as any;

describe("createToolCallHandler: requiresConfirmation gate", () => {
  it("executes tools with requiresConfirmation: false normally", async () => {
    const tool = makeTool("query_tasks", false);
    const executeSpy = vi.fn().mockResolvedValue({ success: true, data: { items: [] }, summary: "ok" });
    const handler = createToolCallHandler({
      tools: [tool],
      executeTool: executeSpy,
      toolContext: baseCtx,
    });
    const result = await handler("query_tasks", {});
    expect(result.isError).toBeFalsy();
    expect(executeSpy).toHaveBeenCalledOnce();
  });

  it("returns a CONFIRM marker (not an error) for requiresConfirmation: true tools", async () => {
    const tool = makeTool("create_task", true);
    const executeSpy = vi.fn().mockResolvedValue({ success: true, data: {}, summary: "" });
    const handler = createToolCallHandler({
      tools: [tool],
      executeTool: executeSpy,
      toolContext: baseCtx,
    });
    const result = await handler("create_task", { title: "Test task" });
    expect(executeSpy).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("⚡CONFIRM:");
    expect(result.content[0].text).toContain("create_task");
    expect(result.isError).toBeFalsy();
  });

  it("includes serialized params in the CONFIRM marker", async () => {
    const tool = makeTool("create_task", true);
    const handler = createToolCallHandler({
      tools: [tool],
      executeTool: neverExecute,
      toolContext: baseCtx,
    });
    const params = { title: "Sprint planning task", priority: "high" };
    const result = await handler("create_task", params);
    const text = result.content[0].text;
    expect(text).toContain(JSON.stringify(params));
  });
});
