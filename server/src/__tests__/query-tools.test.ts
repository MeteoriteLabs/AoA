import { describe, expect, it, vi } from "vitest";
import { createQueryTools } from "../services/internal-agent/tools/query-tools.js";
import type { ToolContext, ServiceContainer } from "../services/internal-agent/types.js";

function mockServices(): ServiceContainer {
  return {
    issues: { list: vi.fn().mockResolvedValue([{ id: "t1", title: "Task 1" }]) } as any,
    goals: { list: vi.fn().mockResolvedValue([{ id: "g1", title: "Goal 1" }]) } as any,
    agents: { list: vi.fn().mockResolvedValue([{ id: "a1", name: "Agent 1" }]) } as any,
    projects: { list: vi.fn().mockResolvedValue([{ id: "d1", name: "Dept 1", type: "department" }]) } as any,
    costs: { summary: vi.fn().mockResolvedValue({ totalCents: 5000, count: 10 }) } as any,
    activity: { list: vi.fn().mockResolvedValue([{ id: "act1", action: "created" }]) } as any,
    memory: {} as any,
    discussions: {} as any,
    dependencies: {} as any,
    suggestions: {} as any,
    notifications: {} as any,
    secrets: {} as any,
    artifacts: {} as any,
    heartbeat: {} as any,
    workflows: null,
  };
}

function makeCtx(services: ServiceContainer): ToolContext {
  return {
    companyId: "comp-1",
    userId: "user-1",
    userRole: "founder",
    db: {} as any,
    services,
  };
}

describe("Query Tools", () => {
  it("creates 6 query tools", () => {
    const tools = createQueryTools();
    expect(tools).toHaveLength(6);
    expect(tools.every((t) => t.category === "query")).toBe(true);
  });

  it("query_tasks calls issues.list and returns ToolResult", async () => {
    const services = mockServices();
    const ctx = makeCtx(services);
    const tools = createQueryTools();
    const queryTasks = tools.find((t) => t.name === "query_tasks")!;

    const result = await queryTasks.execute({ status: "todo", limit: 10 }, ctx);

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.summary).toContain("1");
    expect(services.issues.list).toHaveBeenCalledWith("comp-1", expect.objectContaining({ status: "todo" }));
  });

  it("query_goals calls goals.list and returns ToolResult", async () => {
    const services = mockServices();
    const ctx = makeCtx(services);
    const tools = createQueryTools();
    const queryGoals = tools.find((t) => t.name === "query_goals")!;

    const result = await queryGoals.execute({}, ctx);

    expect(result.success).toBe(true);
    expect(services.goals.list).toHaveBeenCalledWith("comp-1", undefined);
  });

  it("all query tools have requiresConfirmation: false", () => {
    const tools = createQueryTools();
    expect(tools.every((t) => t.requiresConfirmation === false)).toBe(true);
  });

  it("all query tools have valid JSON Schema parameters", () => {
    const tools = createQueryTools();
    for (const tool of tools) {
      expect(tool.parameters.type).toBe("object");
      expect(tool.parameters.properties).toBeDefined();
    }
  });
});
