import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: any[]) => args),
  desc: vi.fn((value: any) => ({ desc: value })),
  eq: vi.fn((left: any, right: any) => ({ eq: [left, right] })),
  sql: Object.assign(
    vi.fn((strings: any, ...values: any[]) => ({
      sql: strings,
      values,
      as: vi.fn().mockImplementation((alias: string) => ({ alias })),
    })),
    { raw: vi.fn((value: any) => value) },
  ),
}));

vi.mock("@paperclipai/db", () => ({
  issues: {
    __table: "issues",
    id: "issues.id",
    companyId: "issues.company_id",
    title: "issues.title",
    description: "issues.description",
    identifier: "issues.identifier",
    status: "issues.status",
    updatedAt: "issues.updated_at",
  },
  goals: {
    __table: "goals",
    id: "goals.id",
    companyId: "goals.company_id",
    title: "goals.title",
    description: "goals.description",
    status: "goals.status",
    updatedAt: "goals.updated_at",
  },
  agents: {
    __table: "agents",
    id: "agents.id",
    companyId: "agents.company_id",
    name: "agents.name",
    role: "agents.role",
    status: "agents.status",
    updatedAt: "agents.updated_at",
  },
  memoryItems: {
    __table: "memory_items",
    id: "memory.id",
    companyId: "memory.company_id",
    title: "memory.title",
    content: "memory.content",
    status: "memory.status",
    layer: "memory.layer",
    category: "memory.category",
    departmentId: "memory.department_id",
    accessedAt: "memory.accessed_at",
    updatedAt: "memory.updated_at",
  },
  projects: {
    __table: "projects",
    id: "projects.id",
    name: "projects.name",
  },
}));

import {
  groupSearchResults,
  sanitizeSearchQuery,
  searchService,
} from "../services/search.js";

function makeMockDb(rowsByTable: Record<string, any[]>) {
  const state = { table: "" };
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn((table: { __table?: string }) => {
      state.table = table.__table ?? "";
      return chain;
    }),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn((value: number) => {
      void value;
      return Promise.resolve(rowsByTable[state.table] ?? []);
    }),
  };
  return chain as any;
}

describe("search service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sanitizes special characters to avoid tsquery syntax issues", () => {
    expect(sanitizeSearchQuery(`"billing:(api) & growth!!!"`)).toBe("billing api growth");
  });

  it("returns recent defaults when the query is empty", async () => {
    const db = makeMockDb({
      issues: [{ id: "issue-1", title: "Recent task", subtitle: null, identifier: "AOA-1", status: "todo", updatedAt: new Date(), score: 1 }],
      goals: [{ id: "goal-1", title: "Recent goal", subtitle: null, status: "active", updatedAt: new Date(), score: 1 }],
      agents: [{ id: "agent-1", title: "Recent agent", role: "engineer", status: "idle", updatedAt: new Date(), score: 1 }],
      memory_items: [{ id: "mem-1", title: "Recent memory", subtitle: "Notes", status: "approved", layer: "domain", category: "reference", departmentId: "dept-1", departmentName: "Engineering", updatedAt: new Date(), score: 1 }],
    });
    const svc = searchService(db);

    const results = await svc.search("company-1", "");

    expect(results.map((result) => result.entityType)).toEqual([
      "tasks",
      "goals",
      "agents",
      "memory",
    ]);
    expect(db.limit).toHaveBeenCalledWith(5);
  });

  it("returns only the requested entity types", async () => {
    const db = makeMockDb({
      memory_items: [{ id: "mem-1", title: "Memory", subtitle: "Content", status: "approved", layer: "identity", category: "context", departmentId: null, departmentName: null, updatedAt: new Date(), score: 0.8 }],
    });
    const svc = searchService(db);

    const results = await svc.search("company-1", "memory", ["memory"]);

    expect(results).toHaveLength(1);
    expect(results[0]?.entityType).toBe("memory");
  });

  it("includes memory metadata for palette badges", async () => {
    const db = makeMockDb({
      memory_items: [{
        id: "mem-1",
        title: "API standards",
        subtitle: "Use JSON responses consistently",
        status: "approved",
        layer: "domain",
        category: "reference",
        departmentId: "dept-1",
        departmentName: "Engineering",
        updatedAt: new Date(),
        score: 0.91,
      }],
    });
    const svc = searchService(db);

    const [result] = await svc.search("company-1", "api", ["memory"]);

    expect(result).toMatchObject({
      entityType: "memory",
      layer: "domain",
      category: "reference",
      departmentId: "dept-1",
      departmentName: "Engineering",
    });
  });

  it("groups flat search results by entity type", () => {
    const grouped = groupSearchResults([
      {
        id: "task-1",
        entityType: "tasks",
        title: "Task",
        subtitle: null,
        score: 0.8,
        identifier: "AOA-1",
        status: "todo",
        role: null,
        layer: null,
        category: null,
        departmentId: null,
        departmentName: null,
        updatedAt: new Date(),
      },
      {
        id: "mem-1",
        entityType: "memory",
        title: "Memory",
        subtitle: null,
        score: 0.7,
        identifier: null,
        status: "approved",
        role: null,
        layer: "domain",
        category: "reference",
        departmentId: null,
        departmentName: null,
        updatedAt: new Date(),
      },
    ]);

    expect(grouped.tasks).toHaveLength(1);
    expect(grouped.memory).toHaveLength(1);
    expect(grouped.goals).toHaveLength(0);
    expect(grouped.agents).toHaveLength(0);
  });
});
