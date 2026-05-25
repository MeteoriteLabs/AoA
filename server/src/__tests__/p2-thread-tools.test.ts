import { describe, expect, it, vi } from "vitest";
import { createThreadTools } from "../services/internal-agent/tools/thread-tools.js";
import type { ToolContext } from "../services/internal-agent/types.js";

describe("Thread Tools (P2.1)", () => {
  describe("query_threads", () => {
    it("returns filtered ThreadSummary list", async () => {
      const tools = createThreadTools();
      const queryThreadsTool = tools.find((t) => t.name === "query_threads");
      expect(queryThreadsTool).toBeDefined();
      expect(queryThreadsTool?.category).toBe("query");
      expect(queryThreadsTool?.requiredRole).toBe("team_member");
      expect(queryThreadsTool?.requiresConfirmation).toBe(false);

      // Mock discussions.list to return an array of thread-like objects
      const mockThreads = [
        {
          id: "thread-1",
          title: "Sprint Planning",
          phase: "scope",
          entryCount: 5,
          pendingItemCount: 2,
          scopeType: "project",
          scopeId: "proj-1",
        },
        {
          id: "thread-2",
          title: "Team Sync",
          phase: "discuss",
          entryCount: 3,
          pendingItemCount: 0,
          scopeType: "department",
          scopeId: "dept-1",
        },
      ];

      const mockCtx = {
        companyId: "co-1",
        userId: "user-1",
        userRole: "team_member",
        db: {} as any,
        services: {
          discussions: {
            list: vi.fn().mockResolvedValue(mockThreads),
          },
        },
      } as ToolContext;

      const result = await queryThreadsTool!.execute({}, mockCtx);

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data).toHaveLength(2);
      expect((result.data as any)[0].id).toBe("thread-1");
      expect((result.data as any)[0].phase).toBe("scope");
      expect(result.summary).toContain("2");
    });

    it("filters threads by phase", async () => {
      const tools = createThreadTools();
      const queryThreadsTool = tools.find((t) => t.name === "query_threads")!;

      const mockThreads = [
        { id: "t-1", title: "Plan", phase: "scope", entryCount: 2, pendingItemCount: 1, scopeType: "project", scopeId: "p-1" },
        { id: "t-2", title: "Discuss", phase: "discuss", entryCount: 1, pendingItemCount: 0, scopeType: null, scopeId: null },
        { id: "t-3", title: "Assign", phase: "scope", entryCount: 3, pendingItemCount: 2, scopeType: "goal", scopeId: "g-1" },
      ];

      const mockCtx = {
        companyId: "co-1",
        userId: "user-1",
        userRole: "team_member",
        db: {} as any,
        services: {
          discussions: {
            list: vi.fn().mockResolvedValue(mockThreads),
          },
        },
      } as ToolContext;

      const result = await queryThreadsTool.execute({ phase: "scope" }, mockCtx);

      expect(result.success).toBe(true);
      const filtered = result.data as any[];
      expect(filtered).toHaveLength(2);
      expect(filtered.every((t) => t.phase === "scope")).toBe(true);
    });

    it("filters threads by scopeType", async () => {
      const tools = createThreadTools();
      const queryThreadsTool = tools.find((t) => t.name === "query_threads")!;

      const allThreads = [
        { id: "t-1", title: "Plan", phase: "scope", entryCount: 2, pendingItemCount: 1, scopeType: "project", scopeId: "p-1" },
        { id: "t-2", title: "Discuss", phase: "discuss", entryCount: 1, pendingItemCount: 0, scopeType: "department", scopeId: "d-1" },
        { id: "t-3", title: "Assign", phase: "scope", entryCount: 3, pendingItemCount: 2, scopeType: "goal", scopeId: "g-1" },
      ];

      const goalOnlyThreads = allThreads.filter((t) => t.scopeType === "goal");

      const mockCtx = {
        companyId: "co-1",
        userId: "user-1",
        userRole: "team_member",
        db: {} as any,
        services: {
          discussions: {
            list: vi.fn().mockImplementation((companyId: string, filters: any) => {
              if (filters.scopeType === "goal") {
                return Promise.resolve(goalOnlyThreads);
              }
              return Promise.resolve(allThreads);
            }),
          },
        },
      } as ToolContext;

      const result = await queryThreadsTool.execute({ scopeType: "goal" }, mockCtx);

      expect(result.success).toBe(true);
      const filtered = result.data as any[];
      expect(filtered).toHaveLength(1);
      expect(filtered[0].scopeType).toBe("goal");
    });

    it("respects limit parameter", async () => {
      const tools = createThreadTools();
      const queryThreadsTool = tools.find((t) => t.name === "query_threads")!;

      const mockThreads = Array.from({ length: 50 }, (_, i) => ({
        id: `t-${i}`,
        title: `Thread ${i}`,
        phase: "discuss",
        entryCount: 1,
        pendingItemCount: 0,
        scopeType: null,
        scopeId: null,
      }));

      const mockCtx = {
        companyId: "co-1",
        userId: "user-1",
        userRole: "team_member",
        db: {} as any,
        services: {
          discussions: {
            list: vi.fn().mockResolvedValue(mockThreads),
          },
        },
      } as ToolContext;

      const result = await queryThreadsTool.execute({ limit: 5 }, mockCtx);

      expect(result.success).toBe(true);
      expect((result.data as any[]).length).toBe(5);
    });

    it("handles non-array return from discussions.list", async () => {
      const tools = createThreadTools();
      const queryThreadsTool = tools.find((t) => t.name === "query_threads")!;

      // Some edge case where discussions.list returns an object instead of array
      const mockCtx = {
        companyId: "co-1",
        userId: "user-1",
        userRole: "team_member",
        db: {} as any,
        services: {
          discussions: {
            list: vi.fn().mockResolvedValue({}),
          },
        },
      } as ToolContext;

      const result = await queryThreadsTool.execute({}, mockCtx);

      expect(result.success).toBe(true);
      expect(result.summary).toContain("0");
    });
  });

  describe("query_extracted_items", () => {
    it("returns items for a thread", async () => {
      const tools = createThreadTools();
      const queryItemsTool = tools.find((t) => t.name === "query_extracted_items");
      expect(queryItemsTool).toBeDefined();
      expect(queryItemsTool?.category).toBe("query");
      expect(queryItemsTool?.requiredRole).toBe("team_member");
      expect(queryItemsTool?.requiresConfirmation).toBe(false);

      const mockItems = [
        {
          id: "item-1",
          type: "task",
          title: "Build Feature",
          status: "pending",
          description: "Create new dashboard",
          entryId: "entry-1",
          resultTaskId: "issue-1",
        },
        {
          id: "item-2",
          type: "decision",
          title: "Use React",
          status: "approved",
          description: "Framework choice",
          entryId: "entry-1",
          resultTaskId: null,
        },
      ];

      // Mock the db query chain
      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue(mockItems),
            }),
          }),
        }),
      };

      const mockCtx = {
        companyId: "co-1",
        userId: "user-1",
        userRole: "team_member",
        db: mockDb as any,
        services: {} as any,
      } as ToolContext;

      const result = await queryItemsTool!.execute({ threadId: "thread-1" }, mockCtx);

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data).toHaveLength(2);
      expect((result.data as any)[0].type).toBe("task");
      expect(result.summary).toContain("2");
    });

    it("filters items by status", async () => {
      const tools = createThreadTools();
      const queryItemsTool = tools.find((t) => t.name === "query_extracted_items")!;

      const mockItems = [
        {
          id: "item-1",
          type: "task",
          title: "Build",
          status: "pending",
          description: "Create",
          entryId: "entry-1",
          resultTaskId: null,
        },
        {
          id: "item-2",
          type: "decision",
          title: "Use React",
          status: "approved",
          description: "Framework",
          entryId: "entry-1",
          resultTaskId: null,
        },
        {
          id: "item-3",
          type: "insight",
          title: "Budget",
          status: "pending",
          description: "Cost",
          entryId: "entry-2",
          resultTaskId: null,
        },
      ];

      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue(mockItems),
            }),
          }),
        }),
      };

      const mockCtx = {
        companyId: "co-1",
        userId: "user-1",
        userRole: "team_member",
        db: mockDb as any,
        services: {} as any,
      } as ToolContext;

      const result = await queryItemsTool.execute(
        { threadId: "thread-1", status: "pending" },
        mockCtx
      );

      expect(result.success).toBe(true);
      const filtered = result.data as any[];
      expect(filtered).toHaveLength(2);
      expect(filtered.every((i) => i.status === "pending")).toBe(true);
    });

    it("filters items by type", async () => {
      const tools = createThreadTools();
      const queryItemsTool = tools.find((t) => t.name === "query_extracted_items")!;

      const mockItems = [
        { id: "item-1", type: "task", title: "Build", status: "pending", description: "Create", entryId: "entry-1", resultTaskId: null },
        { id: "item-2", type: "decision", title: "Use React", status: "approved", description: "Framework", entryId: "entry-1", resultTaskId: null },
        { id: "item-3", type: "task", title: "Test", status: "approved", description: "QA", entryId: "entry-2", resultTaskId: "issue-2" },
      ];

      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue(mockItems),
            }),
          }),
        }),
      };

      const mockCtx = {
        companyId: "co-1",
        userId: "user-1",
        userRole: "team_member",
        db: mockDb as any,
        services: {} as any,
      } as ToolContext;

      const result = await queryItemsTool.execute({ threadId: "thread-1", type: "task" }, mockCtx);

      expect(result.success).toBe(true);
      const filtered = result.data as any[];
      expect(filtered).toHaveLength(2);
      expect(filtered.every((i) => i.type === "task")).toBe(true);
    });

    it("filters items by both status and type", async () => {
      const tools = createThreadTools();
      const queryItemsTool = tools.find((t) => t.name === "query_extracted_items")!;

      const mockItems = [
        { id: "item-1", type: "task", title: "Build", status: "pending", description: "Create", entryId: "entry-1", resultTaskId: null },
        { id: "item-2", type: "decision", title: "Use React", status: "approved", description: "Framework", entryId: "entry-1", resultTaskId: null },
        { id: "item-3", type: "task", title: "Test", status: "approved", description: "QA", entryId: "entry-2", resultTaskId: "issue-2" },
      ];

      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue(mockItems),
            }),
          }),
        }),
      };

      const mockCtx = {
        companyId: "co-1",
        userId: "user-1",
        userRole: "team_member",
        db: mockDb as any,
        services: {} as any,
      } as ToolContext;

      const result = await queryItemsTool.execute(
        { threadId: "thread-1", status: "approved", type: "task" },
        mockCtx
      );

      expect(result.success).toBe(true);
      const filtered = result.data as any[];
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe("item-3");
    });
  });
});
