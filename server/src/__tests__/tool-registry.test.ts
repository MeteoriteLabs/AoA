import { describe, expect, it } from "vitest";
import {
  createToolRegistry,
  getToolsForMessage,
  toolToAnthropicFormat,
  toolToOpenAIFormat,
  executeTool,
} from "../services/internal-agent/tool-registry.js";
import type { AgentTool, ToolContext } from "../services/internal-agent/types.js";

const mockCtx: ToolContext = {
  companyId: "comp-1",
  userId: "user-1",
  userRole: "founder",
  db: {} as any,
  services: {} as any,
};

describe("Tool Registry", () => {
  describe("createToolRegistry", () => {
    it("returns all 29 tools", () => {
      const tools = createToolRegistry();
      expect(tools).toHaveLength(29);
    });

    it("every tool has required fields", () => {
      const tools = createToolRegistry();
      for (const tool of tools) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.parameters.type).toBe("object");
        expect(tool.category).toBeTruthy();
        expect(typeof tool.requiredRole).toBe("string");
        expect(typeof tool.requiresConfirmation).toBe("boolean");
        expect(typeof tool.execute).toBe("function");
      }
    });

    it("has no duplicate tool names", () => {
      const tools = createToolRegistry();
      const names = tools.map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
    });
  });

  describe("getToolsForMessage", () => {
    const allTools = createToolRegistry();

    it("always includes core 3 tools", () => {
      const tools = getToolsForMessage("hello", allTools);
      const names = tools.map((t) => t.name);
      expect(names).toContain("query_tasks");
      expect(names).toContain("query_memory");
      expect(names).toContain("query_goals");
    });

    it("includes action tools for creation intents", () => {
      const tools = getToolsForMessage("create a new task for the design team", allTools);
      const names = tools.map((t) => t.name);
      expect(names).toContain("create_task");
    });

    it("includes memory tools for memory-related messages", () => {
      const tools = getToolsForMessage("what do we remember about the onboarding process?", allTools);
      const names = tools.map((t) => t.name);
      expect(names).toContain("find_similar_memory");
    });

    it("returns max 15 tools", () => {
      const tools = getToolsForMessage("create a task and add memory and start a workflow and check dependencies", allTools);
      expect(tools.length).toBeLessThanOrEqual(15);
    });

    it("returns core + query tools for unclear intent", () => {
      const tools = getToolsForMessage("what's going on?", allTools);
      const categories = [...new Set(tools.map((t) => t.category))];
      expect(categories).toContain("query");
    });
  });

  describe("toolToAnthropicFormat", () => {
    it("produces correct Anthropic tool shape", () => {
      const tool = createToolRegistry()[0];
      const formatted = toolToAnthropicFormat(tool);
      expect(formatted).toHaveProperty("name", tool.name);
      expect(formatted).toHaveProperty("description", tool.description);
      expect(formatted).toHaveProperty("input_schema", tool.parameters);
    });
  });

  describe("toolToOpenAIFormat", () => {
    it("produces correct OpenAI function shape", () => {
      const tool = createToolRegistry()[0];
      const formatted = toolToOpenAIFormat(tool);
      expect(formatted.type).toBe("function");
      expect(formatted.function.name).toBe(tool.name);
      expect(formatted.function.description).toBe(tool.description);
      expect(formatted.function.parameters).toEqual(tool.parameters);
    });
  });

  describe("executeTool", () => {
    it("catches 403 errors and returns FORBIDDEN result", async () => {
      const tool: AgentTool = {
        name: "test_tool",
        description: "test",
        parameters: { type: "object", properties: {} },
        category: "query",
        requiredRole: "founder",
        requiresConfirmation: false,
        execute: async () => {
          const err = new Error("Forbidden") as any;
          err.status = 403;
          throw err;
        },
      };
      const result = await executeTool(tool, {}, mockCtx);
      expect(result.success).toBe(false);
      expect(result.error).toBe("FORBIDDEN");
    });

    it("catches general errors and returns INTERNAL result", async () => {
      const tool: AgentTool = {
        name: "test_tool",
        description: "test",
        parameters: { type: "object", properties: {} },
        category: "query",
        requiredRole: "founder",
        requiresConfirmation: false,
        execute: async () => { throw new Error("something broke"); },
      };
      const result = await executeTool(tool, {}, mockCtx);
      expect(result.success).toBe(false);
      expect(result.error).toBe("INTERNAL");
      expect(result.summary).toContain("something broke");
    });
  });
});
