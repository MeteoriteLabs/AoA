import { describe, it, expect, beforeEach } from "vitest";
import {
  memoryContextService,
  estimateTokens,
  formatMemoryItem,
  fillLayerBudget,
  LAYER_TOKEN_BUDGETS,
} from "../services/memory-context.js";
import {
  memoryItems as memoryItemsTable,
  companies as companiesTable,
  issues as issuesTable,
  projects as projectsTable,
  goals as goalsTable,
  taskDependencies as taskDepsTable,
} from "@paperclipai/db";
import type { Db } from "@paperclipai/db";

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------
let memoryItemsData: any[];
let companiesData: any[];
let issuesData: any[];
let projectsData: any[];
let goalsData: any[];
let taskDepsData: any[];
let updatedAccessedAtIds: string[];

let idCounter = 0;
function newId(prefix = "id") { return `${prefix}-${++idCounter}`; }

const COMPANY_ID = "company-1";
const ISSUE_ID = "issue-1";

// ---------------------------------------------------------------------------
// Drizzle AST evaluator (reused from memory-versioning.test.ts)
// ---------------------------------------------------------------------------
function getStringChunkValue(chunk: any): string | null {
  if (!chunk || chunk.constructor?.name !== "StringChunk") return null;
  const arr = chunk.value;
  if (Array.isArray(arr) && arr.length > 0) return arr[0];
  return null;
}

function isColumn(chunk: any): boolean { return !!chunk?.columnType; }
function isParam(chunk: any): boolean { return chunk?.constructor?.name === "Param"; }
function isSqlNode(chunk: any): boolean { return chunk?.constructor?.name === "SQL" && Array.isArray(chunk.queryChunks); }

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function rowVal(row: any, col: any): any {
  const camel = snakeToCamel(col.name);
  if (camel in row) return row[camel];
  return row[col.name];
}

function extractValue(chunk: any): any {
  if (chunk === null || chunk === undefined) return chunk;
  if (isParam(chunk)) return chunk.value;
  if (typeof chunk === "string" || typeof chunk === "number" || typeof chunk === "boolean") return chunk;
  if (chunk.valueOf && typeof chunk.valueOf === "function") return chunk.valueOf();
  return chunk;
}

function evalCondition(node: any, row: any): boolean {
  if (!node) return true;
  const chunks: any[] = node.queryChunks;
  if (!chunks) return true;

  // and/or wrapper
  if (chunks.length === 3 && isSqlNode(chunks[1])) {
    const openStr = getStringChunkValue(chunks[0]);
    if (openStr === "(" || openStr === "") {
      return evalInnerAndOr(chunks[1].queryChunks, row);
    }
  }

  // inArray: [StringChunk(""), Column, StringChunk(" in "), Array, StringChunk("")]
  // Drizzle inArray passes the values as a plain JS Array at chunks[3]
  if (chunks.length === 5 && isColumn(chunks[1])) {
    const opStr = getStringChunkValue(chunks[2])?.trim();
    if (opStr === "in" && Array.isArray(chunks[3])) {
      const colVal = rowVal(row, chunks[1]);
      return (chunks[3] as any[]).some((v: any) => {
        const ev = extractValue(v);
        return ev == colVal;
      });
    }
  }

  // eq/comparison: [StringChunk, Column, StringChunk(" = "), Param, StringChunk]
  if (chunks.length === 5) {
    const col = chunks[1];
    const opChunk = chunks[2];
    const valChunk = chunks[3];
    if (isColumn(col)) {
      if (isSqlNode(valChunk)) return true;
      const op = getStringChunkValue(opChunk)?.trim() ?? "=";
      const rv = rowVal(row, col);
      const condVal = extractValue(valChunk);
      if (op === "=") return rv == condVal;
      if (op === ">") {
        if (rv instanceof Date && condVal instanceof Date) return rv > condVal;
        return rv > condVal;
      }
      return rv == condVal;
    }
  }

  // IS NULL check: [StringChunk, Column, StringChunk(" is null")]
  if (chunks.length === 3 && isColumn(chunks[1])) {
    const op = getStringChunkValue(chunks[2])?.trim().toLowerCase();
    if (op === "is null") return rowVal(row, chunks[1]) === null || rowVal(row, chunks[1]) === undefined;
    if (op === "is not null") return rowVal(row, chunks[1]) !== null && rowVal(row, chunks[1]) !== undefined;
  }

  return true;
}

function evalInnerAndOr(innerChunks: any[], row: any): boolean {
  const conditions: any[] = [];
  let operator = "and";
  for (const c of innerChunks) {
    if (isSqlNode(c)) {
      conditions.push(c);
    } else {
      const str = getStringChunkValue(c)?.trim().toLowerCase() ?? "";
      if (str === "or") operator = "or";
    }
  }
  if (operator === "or") return conditions.some((c) => evalCondition(c, row));
  return conditions.every((c) => evalCondition(c, row));
}

function evalOrderBy(node: any): ((a: any, b: any) => number) | null {
  if (!node) return null;
  const chunks: any[] = node.queryChunks ?? [];
  if (chunks.length === 3) {
    const col = chunks[1];
    const dirChunk = chunks[2];
    if (isColumn(col)) {
      const dir = getStringChunkValue(dirChunk)?.trim().toLowerCase() ?? "asc";
      const isDesc = dir === "desc";
      return (a, b) => {
        const av = rowVal(a, col);
        const bv = rowVal(b, col);
        if (av === bv) return 0;
        return isDesc ? (av > bv ? -1 : 1) : (av < bv ? -1 : 1);
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Table resolver
// ---------------------------------------------------------------------------
function resolveTableData(table: any): any[] {
  if (table === memoryItemsTable) return memoryItemsData;
  if (table === companiesTable) return companiesData;
  if (table === issuesTable) return issuesData;
  if (table === projectsTable) return projectsData;
  if (table === goalsTable) return goalsData;
  if (table === taskDepsTable) return taskDepsData;
  return [];
}

// ---------------------------------------------------------------------------
// Mock Db factory
// ---------------------------------------------------------------------------
function createMockDb(): Db {
  const db: any = {
    select(colsArg?: any) {
      let _projection: Record<string, string> | null = null;

      if (colsArg && typeof colsArg === "object") {
        const keys = Object.keys(colsArg);
        if (keys.length > 0) {
          const proj: Record<string, string> = {};
          for (const [k, v] of Object.entries(colsArg as Record<string, any>)) {
            if (isColumn(v)) proj[k] = v.name;
          }
          if (Object.keys(proj).length > 0) _projection = proj;
        }
      }

      return {
        from(table: any) {
          let _conditions: any[] = [];
          let _orderByFns: Array<(a: any, b: any) => number> = [];
          let _limitVal: number | null = null;

          const builder: any = {
            where(cond: any) {
              if (cond) _conditions.push(cond);
              return builder;
            },
            orderBy(...args: any[]) {
              for (const arg of args) {
                const fn = evalOrderBy(arg);
                if (fn) _orderByFns.push(fn);
              }
              return builder;
            },
            limit(n: number) {
              _limitVal = n;
              return builder;
            },
            then(resolve: (rows: any[]) => any, reject?: (e: any) => any): Promise<any> {
              return Promise.resolve().then(() => {
                try {
                  let rows = resolveTableData(table).filter((r) =>
                    _conditions.every((c) => evalCondition(c, r)),
                  );

                  if (_orderByFns.length > 0) {
                    rows = [...rows].sort((a, b) => {
                      for (const fn of _orderByFns) {
                        const result = fn(a, b);
                        if (result !== 0) return result;
                      }
                      return 0;
                    });
                  }
                  if (_limitVal !== null) rows = rows.slice(0, _limitVal);

                  if (_projection) {
                    rows = rows.map((r) => {
                      const out: any = {};
                      for (const [k, colName] of Object.entries(_projection!)) {
                        out[k] = r[snakeToCamel(colName)] ?? r[colName];
                      }
                      return out;
                    });
                  }

                  return resolve(rows);
                } catch (e) {
                  if (reject) return reject(e);
                  throw e;
                }
              });
            },
          };
          return builder;
        },
      };
    },

    update(table: any) {
      return {
        set(data: any) {
          return {
            where(cond: any) {
              return {
                returning() {
                  return {
                    then(resolve: (rows: any[]) => any): Promise<any> {
                      return Promise.resolve().then(() => {
                        const arr = resolveTableData(table);
                        const updated: any[] = [];
                        for (const row of arr) {
                          if (evalCondition(cond, row)) {
                            Object.assign(row, data);
                            updated.push(row);
                            // Track accessedAt updates for memory items
                            if (table === memoryItemsTable && data.accessedAt) {
                              updatedAccessedAtIds.push(row.id);
                            }
                          }
                        }
                        return resolve(updated);
                      });
                    },
                  };
                },
                then(resolve: (rows: any[]) => any): Promise<any> {
                  return Promise.resolve().then(() => {
                    const arr = resolveTableData(table);
                    for (const row of arr) {
                      if (evalCondition(cond, row)) {
                        Object.assign(row, data);
                        if (table === memoryItemsTable && data.accessedAt) {
                          updatedAccessedAtIds.push(row.id);
                        }
                      }
                    }
                    return resolve([]);
                  });
                },
              };
            },
          };
        },
      };
    },

    transaction(fn: any) {
      return fn(db);
    },
  };
  return db as Db;
}

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------
function addCompany(overrides: Partial<any> = {}) {
  const company = {
    id: COMPANY_ID,
    name: "TestCo",
    description: "A test company",
    vision: "Test vision",
    mission: "Test mission",
    values: "Test values",
    ...overrides,
  };
  companiesData.push(company);
  return company;
}

function addProject(overrides: Partial<any> = {}) {
  const project = {
    id: newId("proj"),
    companyId: COMPANY_ID,
    name: "Test Department",
    type: "department",
    goalId: null,
    ...overrides,
  };
  projectsData.push(project);
  return project;
}

function addGoal(overrides: Partial<any> = {}) {
  const goal = {
    id: newId("goal"),
    companyId: COMPANY_ID,
    title: "Test Goal",
    ...overrides,
  };
  goalsData.push(goal);
  return goal;
}

function addIssue(overrides: Partial<any> = {}) {
  const issue = {
    id: overrides.id ?? newId("issue"),
    companyId: COMPANY_ID,
    projectId: null,
    goalId: null,
    status: "todo",
    ...overrides,
  };
  issuesData.push(issue);
  return issue;
}

function addDependency(dependentIssueId: string, dependencyIssueId: string) {
  taskDepsData.push({
    id: newId("dep"),
    companyId: COMPANY_ID,
    dependentIssueId,
    dependencyIssueId,
  });
}

function addMemoryItem(overrides: Partial<any> = {}) {
  const item = {
    id: newId("mem"),
    companyId: COMPANY_ID,
    title: "Memory Item",
    content: "Some content",
    category: "reference",
    status: "approved",
    layer: "identity",
    priority: 0,
    visibility: "scoped",
    departmentId: null,
    projectId: null,
    goalId: null,
    taskId: null,
    expiresAt: null,
    accessedAt: null,
    updatedAt: new Date("2024-01-01"),
    createdAt: new Date("2024-01-01"),
    ...overrides,
  };
  memoryItemsData.push(item);
  return item;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("memory-context", () => {
  let svc: ReturnType<typeof memoryContextService>;

  beforeEach(() => {
    memoryItemsData = [];
    companiesData = [];
    issuesData = [];
    projectsData = [];
    goalsData = [];
    taskDepsData = [];
    updatedAccessedAtIds = [];
    idCounter = 0;
    svc = memoryContextService(createMockDb());
  });

  // ── Pure helper tests ─────────────────────────────────────────────────

  describe("estimateTokens", () => {
    it("returns ceil(length / 4)", () => {
      expect(estimateTokens("")).toBe(0);
      expect(estimateTokens("abcd")).toBe(1);
      expect(estimateTokens("abcde")).toBe(2);
      expect(estimateTokens("a")).toBe(1);
    });
  });

  describe("formatMemoryItem", () => {
    it("formats without annotation", () => {
      expect(formatMemoryItem({ title: "T", content: "C", category: "ref" }))
        .toBe("[ref] T: C");
    });

    it("formats with annotation", () => {
      expect(formatMemoryItem({ title: "T", content: "C", category: "ref" }, "[cancelled]"))
        .toBe("[cancelled] [ref] T: C");
    });
  });

  describe("fillLayerBudget", () => {
    it("returns empty for zero budget", () => {
      const items = [{ id: "1", title: "T", content: "C", category: "ref" }];
      const result = fillLayerBudget(items, 0);
      expect(result.text).toBe("");
      expect(result.selectedIds).toEqual([]);
    });

    it("returns empty for empty items", () => {
      expect(fillLayerBudget([], 100)).toEqual({ text: "", selectedIds: [] });
    });

    it("always includes at least one item even if it exceeds budget", () => {
      const items = [{ id: "1", title: "Title", content: "Very long content that exceeds budget", category: "ref" }];
      const result = fillLayerBudget(items, 1);
      expect(result.selectedIds).toEqual(["1"]);
      expect(result.text).toContain("Title");
    });

    it("respects budget and stops adding items", () => {
      const items = [
        { id: "1", title: "A", content: "short", category: "ref" },
        { id: "2", title: "B", content: "short", category: "ref" },
        { id: "3", title: "C", content: "short", category: "ref" },
      ];
      // Each item "[ref] X: short" = 15 chars ≈ 4 tokens
      // Budget of 5 tokens should fit 1 item
      const result = fillLayerBudget(items, 5);
      expect(result.selectedIds.length).toBeLessThanOrEqual(2);
      expect(result.selectedIds).toContain("1");
    });

    it("includes annotation in formatted text", () => {
      const items = [{ id: "1", title: "T", content: "C", category: "ref", annotation: "[from cancelled task]" }];
      const result = fillLayerBudget(items, 100);
      expect(result.text).toContain("[from cancelled task]");
    });
  });

  describe("LAYER_TOKEN_BUDGETS", () => {
    it("minimal has zero active_context and working", () => {
      expect(LAYER_TOKEN_BUDGETS.minimal.active_context).toBe(0);
      expect(LAYER_TOKEN_BUDGETS.minimal.working).toBe(0);
    });

    it("standard has balanced budgets", () => {
      expect(LAYER_TOKEN_BUDGETS.standard.identity).toBe(400);
      expect(LAYER_TOKEN_BUDGETS.standard.domain).toBe(1000);
    });

    it("full has largest budgets", () => {
      expect(LAYER_TOKEN_BUDGETS.full.identity).toBe(500);
      expect(LAYER_TOKEN_BUDGETS.full.working).toBe(1500);
    });
  });

  // ── sweep_context mode ────────────────────────────────────────────────

  describe("sweep_context mode", () => {
    it("returns stub result", async () => {
      const result = await svc.fetchMemoryContext(COMPANY_ID, null, "sweep_context");
      expect(result.company).toBeNull();
      expect(result.memory).toEqual([]);
      expect(result.layeredContext).toBeNull();
    });
  });

  // ── Identity layer ────────────────────────────────────────────────────

  describe("identity layer", () => {
    it("always included regardless of task scope", async () => {
      addCompany();
      const dept = addProject();
      const issue = addIssue({ id: ISSUE_ID, projectId: dept.id });
      addMemoryItem({ layer: "identity", title: "Vision", content: "Our vision", priority: 10 });

      const result = await svc.fetchMemoryContext(COMPANY_ID, ISSUE_ID);
      expect(result.layeredContext).toContain("=== IDENTITY ===");
      expect(result.layeredContext).toContain("Our vision");
    });

    it("included even for unscoped tasks (no project)", async () => {
      addCompany();
      addIssue({ id: ISSUE_ID, projectId: null });
      addMemoryItem({ layer: "identity", title: "Core", content: "Core value" });

      const result = await svc.fetchMemoryContext(COMPANY_ID, ISSUE_ID);
      expect(result.layeredContext).toContain("=== IDENTITY ===");
      expect(result.layeredContext).toContain("Core value");
    });

    it("included when no issueId provided", async () => {
      addCompany();
      addMemoryItem({ layer: "identity", title: "Mission", content: "Our mission" });

      const result = await svc.fetchMemoryContext(COMPANY_ID, null);
      expect(result.layeredContext).toContain("=== IDENTITY ===");
      expect(result.layeredContext).toContain("Our mission");
    });

    it("excludes non-approved identity items", async () => {
      addCompany();
      addIssue({ id: ISSUE_ID });
      addMemoryItem({ layer: "identity", title: "Pending", content: "Not approved", status: "pending" });
      addMemoryItem({ layer: "identity", title: "Approved", content: "Approved item", status: "approved" });

      const result = await svc.fetchMemoryContext(COMPANY_ID, ISSUE_ID);
      expect(result.layeredContext).toContain("Approved item");
      expect(result.layeredContext).not.toContain("Not approved");
    });
  });

  // ── Domain layer ──────────────────────────────────────────────────────

  describe("domain layer", () => {
    it("fetches department-scoped items", async () => {
      addCompany();
      const dept = addProject({ type: "department", name: "Engineering" });
      addIssue({ id: ISSUE_ID, projectId: dept.id });
      addMemoryItem({ layer: "domain", departmentId: dept.id, title: "Style", content: "Use TypeScript" });

      const result = await svc.fetchMemoryContext(COMPANY_ID, ISSUE_ID);
      expect(result.layeredContext).toContain("=== DOMAIN: Engineering ===");
      expect(result.layeredContext).toContain("Use TypeScript");
    });

    it("fetches project-scoped items", async () => {
      addCompany();
      const proj = addProject({ type: "project", name: "Website" });
      addIssue({ id: ISSUE_ID, projectId: proj.id });
      addMemoryItem({ layer: "domain", projectId: proj.id, title: "Tech", content: "Use React" });

      const result = await svc.fetchMemoryContext(COMPANY_ID, ISSUE_ID);
      expect(result.layeredContext).toContain("=== DOMAIN: Website ===");
      expect(result.layeredContext).toContain("Use React");
    });

    it("includes shared domain items with lower priority than scoped", async () => {
      addCompany();
      const dept = addProject({ type: "department", name: "Engineering" });
      const otherDept = addProject({ type: "department", name: "Design" });
      addIssue({ id: ISSUE_ID, projectId: dept.id });

      // Scoped item for this department
      addMemoryItem({
        layer: "domain",
        departmentId: dept.id,
        title: "Scoped",
        content: "A",
        priority: 5,
        visibility: "scoped",
      });
      // Shared item from another department
      addMemoryItem({
        layer: "domain",
        departmentId: otherDept.id,
        title: "Shared",
        content: "B",
        priority: 5,
        visibility: "shared",
      });

      const result = await svc.fetchMemoryContext(COMPANY_ID, ISSUE_ID);
      expect(result.layeredContext).toContain("Scoped");
      expect(result.layeredContext).toContain("Shared");
      // Scoped should come before shared
      const scopedIdx = result.layeredContext!.indexOf("Scoped");
      const sharedIdx = result.layeredContext!.indexOf("Shared");
      expect(scopedIdx).toBeLessThan(sharedIdx);
    });

    it("deduplicates shared items that overlap with scoped", async () => {
      addCompany();
      const dept = addProject({ type: "department", name: "Eng" });
      addIssue({ id: ISSUE_ID, projectId: dept.id });

      // Item that is both scoped to this dept AND shared
      const sharedItem = addMemoryItem({
        layer: "domain",
        departmentId: dept.id,
        title: "Both",
        content: "Overlap",
        visibility: "shared",
      });

      const result = await svc.fetchMemoryContext(COMPANY_ID, ISSUE_ID);
      // Should appear only once
      const matches = (result.layeredContext ?? "").match(/Overlap/g);
      expect(matches?.length).toBe(1);
    });

    it("skips domain layer for unscoped tasks", async () => {
      addCompany();
      addIssue({ id: ISSUE_ID, projectId: null });
      addMemoryItem({ layer: "domain", title: "Orphan", content: "Should not appear" });

      const result = await svc.fetchMemoryContext(COMPANY_ID, ISSUE_ID);
      expect(result.layeredContext ?? "").not.toContain("DOMAIN");
    });
  });

  // ── Active Context layer ──────────────────────────────────────────────

  describe("active context layer", () => {
    it("fetches goal-scoped items with valid expiresAt", async () => {
      addCompany();
      const goal = addGoal({ title: "Ship MVP" });
      const dept = addProject();
      addIssue({ id: ISSUE_ID, projectId: dept.id, goalId: goal.id });

      addMemoryItem({
        layer: "active_context",
        goalId: goal.id,
        title: "Sprint",
        content: "Focus on auth",
        expiresAt: new Date(Date.now() + 86400000), // tomorrow
      });

      const result = await svc.fetchMemoryContext(COMPANY_ID, ISSUE_ID);
      expect(result.layeredContext).toContain("=== ACTIVE CONTEXT: Ship MVP ===");
      expect(result.layeredContext).toContain("Focus on auth");
    });

    it("includes items with null expiresAt", async () => {
      addCompany();
      const goal = addGoal({ title: "Goal" });
      const dept = addProject();
      addIssue({ id: ISSUE_ID, projectId: dept.id, goalId: goal.id });
      addMemoryItem({
        layer: "active_context",
        goalId: goal.id,
        title: "Permanent",
        content: "Always active",
        expiresAt: null,
      });

      const result = await svc.fetchMemoryContext(COMPANY_ID, ISSUE_ID);
      expect(result.layeredContext).toContain("Always active");
    });

    it("excludes expired items", async () => {
      addCompany();
      const goal = addGoal();
      const dept = addProject();
      addIssue({ id: ISSUE_ID, projectId: dept.id, goalId: goal.id });
      addMemoryItem({
        layer: "active_context",
        goalId: goal.id,
        title: "Expired",
        content: "Old context",
        expiresAt: new Date(Date.now() - 86400000), // yesterday
      });

      const result = await svc.fetchMemoryContext(COMPANY_ID, ISSUE_ID);
      expect(result.layeredContext ?? "").not.toContain("Old context");
    });

    it("skips when task has no goal", async () => {
      addCompany();
      const dept = addProject();
      addIssue({ id: ISSUE_ID, projectId: dept.id, goalId: null });
      addMemoryItem({ layer: "active_context", title: "X", content: "Y" });

      const result = await svc.fetchMemoryContext(COMPANY_ID, ISSUE_ID);
      expect(result.layeredContext ?? "").not.toContain("ACTIVE CONTEXT");
    });

    it("falls back to project goal if issue has no goal", async () => {
      addCompany();
      const goal = addGoal({ title: "Project Goal" });
      const proj = addProject({ goalId: goal.id });
      addIssue({ id: ISSUE_ID, projectId: proj.id, goalId: null });
      addMemoryItem({
        layer: "active_context",
        goalId: goal.id,
        title: "FromProjectGoal",
        content: "Inherited context",
        expiresAt: null,
      });

      const result = await svc.fetchMemoryContext(COMPANY_ID, ISSUE_ID);
      expect(result.layeredContext).toContain("=== ACTIVE CONTEXT: Project Goal ===");
      expect(result.layeredContext).toContain("Inherited context");
    });
  });

  // ── Working Memory layer ──────────────────────────────────────────────

  describe("working memory layer", () => {
    it("follows dependency chain order", async () => {
      addCompany();
      const dept = addProject();

      addIssue({ id: "dep-a", projectId: dept.id, status: "done" });
      addIssue({ id: "dep-b", projectId: dept.id, status: "done" });
      addIssue({ id: ISSUE_ID, projectId: dept.id });

      // main depends on dep-b, dep-b depends on dep-a
      addDependency(ISSUE_ID, "dep-b");
      addDependency("dep-b", "dep-a");

      addMemoryItem({ layer: "identity", title: "Base", content: "Identity base" });
      addMemoryItem({ layer: "working", taskId: "dep-a", title: "First", content: "From A" });
      addMemoryItem({ layer: "working", taskId: "dep-b", title: "Second", content: "From B" });

      const result = await svc.fetchMemoryContext(COMPANY_ID, ISSUE_ID);
      expect(result.layeredContext).toContain("=== WORKING MEMORY ===");
      // dep-a is deeper in the chain, should appear first
      const idxA = result.layeredContext!.indexOf("From A");
      const idxB = result.layeredContext!.indexOf("From B");
      expect(idxA).toBeLessThan(idxB);
    });

    it("annotates cancelled dependency working memory", async () => {
      addCompany();
      const dept = addProject();

      addIssue({ id: "dep-cancelled", projectId: dept.id, status: "cancelled" });
      addIssue({ id: ISSUE_ID, projectId: dept.id });
      addDependency(ISSUE_ID, "dep-cancelled");

      addMemoryItem({ layer: "identity", title: "Base", content: "Identity base" });
      addMemoryItem({ layer: "working", taskId: "dep-cancelled", title: "Stale", content: "From cancelled" });

      const result = await svc.fetchMemoryContext(COMPANY_ID, ISSUE_ID);
      expect(result.layeredContext).toContain("[from cancelled task]");
      expect(result.layeredContext).toContain("From cancelled");
    });

    it("detects circular dependency and breaks safely", async () => {
      addCompany();
      const dept = addProject();

      addIssue({ id: "a", projectId: dept.id, status: "todo" });
      addIssue({ id: "b", projectId: dept.id, status: "todo" });
      addIssue({ id: ISSUE_ID, projectId: dept.id });

      // Circular: issue -> a -> b -> a
      addDependency(ISSUE_ID, "a");
      addDependency("a", "b");
      addDependency("b", "a");

      addMemoryItem({ layer: "identity", title: "Base", content: "Identity base" });
      addMemoryItem({ layer: "working", taskId: "a", title: "WM-A", content: "Content A" });
      addMemoryItem({ layer: "working", taskId: "b", title: "WM-B", content: "Content B" });

      // Should not throw, should return some results
      const result = await svc.fetchMemoryContext(COMPANY_ID, ISSUE_ID);
      expect(result.layeredContext).toContain("WORKING MEMORY");
    });

    it("empty when no dependencies", async () => {
      addCompany();
      const dept = addProject();
      addIssue({ id: ISSUE_ID, projectId: dept.id });
      addMemoryItem({ layer: "working", taskId: "other-task", title: "X", content: "Y" });

      const result = await svc.fetchMemoryContext(COMPANY_ID, ISSUE_ID);
      expect(result.layeredContext ?? "").not.toContain("WORKING MEMORY");
    });
  });

  // ── Token budgets ─────────────────────────────────────────────────────

  describe("token budget enforcement", () => {
    it("minimal mode excludes active_context and working layers", async () => {
      addCompany();
      const goal = addGoal();
      const dept = addProject();
      const depIssue = addIssue({ id: "dep-1", projectId: dept.id, status: "done" });
      addIssue({ id: ISSUE_ID, projectId: dept.id, goalId: goal.id });
      addDependency(ISSUE_ID, "dep-1");

      addMemoryItem({ layer: "identity", title: "ID", content: "Identity" });
      addMemoryItem({ layer: "domain", departmentId: dept.id, title: "DOM", content: "Domain" });
      addMemoryItem({ layer: "active_context", goalId: goal.id, title: "AC", content: "Active", expiresAt: null });
      addMemoryItem({ layer: "working", taskId: "dep-1", title: "WK", content: "Working" });

      const result = await svc.fetchMemoryContext(COMPANY_ID, ISSUE_ID, "task_context", "minimal");
      expect(result.layeredContext).toContain("IDENTITY");
      expect(result.layeredContext).toContain("DOMAIN");
      expect(result.layeredContext ?? "").not.toContain("ACTIVE CONTEXT");
      expect(result.layeredContext ?? "").not.toContain("WORKING MEMORY");
    });

    it("limits items within a layer based on token budget", async () => {
      addCompany();
      addIssue({ id: ISSUE_ID });

      // Add many identity items that would exceed minimal budget (200 tokens)
      for (let i = 0; i < 20; i++) {
        addMemoryItem({
          layer: "identity",
          title: `Item${i}`,
          content: "A".repeat(100), // ~25 tokens per item
          priority: 20 - i, // descending priority
        });
      }

      const result = await svc.fetchMemoryContext(COMPANY_ID, ISSUE_ID, "task_context", "minimal");
      // With 200 token budget and ~30 tokens per formatted item, should include ~6-7 items, not all 20
      const identitySection = result.layeredContext!.split("===")[2]; // after "IDENTITY ==="
      const lineCount = identitySection.trim().split("\n").length;
      expect(lineCount).toBeLessThan(20);
      expect(lineCount).toBeGreaterThan(0);
    });
  });

  // ── Unscoped task edge case ───────────────────────────────────────────

  describe("unscoped task", () => {
    it("gets identity + working only (no domain/active_context)", async () => {
      addCompany();
      const depIssue = addIssue({ id: "dep-x", status: "done" });
      addIssue({ id: ISSUE_ID, projectId: null, goalId: null });
      addDependency(ISSUE_ID, "dep-x");

      addMemoryItem({ layer: "identity", title: "ID", content: "Identity" });
      addMemoryItem({ layer: "working", taskId: "dep-x", title: "WK", content: "Working mem" });
      addMemoryItem({ layer: "domain", title: "DOM", content: "Domain mem" });
      addMemoryItem({ layer: "active_context", title: "AC", content: "Active ctx" });

      const result = await svc.fetchMemoryContext(COMPANY_ID, ISSUE_ID);
      expect(result.layeredContext).toContain("IDENTITY");
      expect(result.layeredContext).toContain("WORKING MEMORY");
      expect(result.layeredContext).not.toContain("DOMAIN");
      expect(result.layeredContext).not.toContain("ACTIVE CONTEXT");
    });
  });

  // ── accessedAt updates ────────────────────────────────────────────────

  describe("accessedAt batch update", () => {
    it("updates accessedAt for all served items", async () => {
      addCompany();
      const dept = addProject();
      addIssue({ id: ISSUE_ID, projectId: dept.id });

      const mem1 = addMemoryItem({ layer: "identity", title: "A", content: "X" });
      const mem2 = addMemoryItem({ layer: "domain", departmentId: dept.id, title: "B", content: "Y" });

      await svc.fetchMemoryContext(COMPANY_ID, ISSUE_ID);

      expect(updatedAccessedAtIds).toContain(mem1.id);
      expect(updatedAccessedAtIds).toContain(mem2.id);
    });
  });

  // ── Company info ──────────────────────────────────────────────────────

  describe("company info", () => {
    it("returns company name and description", async () => {
      addCompany({ name: "ACME", description: "Best company" });
      addIssue({ id: ISSUE_ID });

      const result = await svc.fetchMemoryContext(COMPANY_ID, ISSUE_ID);
      expect(result.company).toEqual({ name: "ACME", description: "Best company" });
    });

    it("returns null company when not found", async () => {
      addIssue({ id: ISSUE_ID });

      const result = await svc.fetchMemoryContext("nonexistent", ISSUE_ID);
      expect(result.company).toBeNull();
    });
  });

  // ── Precedence note ───────────────────────────────────────────────────

  describe("precedence note", () => {
    it("includes layer precedence note in output", async () => {
      addCompany();
      addIssue({ id: ISSUE_ID });
      addMemoryItem({ layer: "identity", title: "X", content: "Y" });

      const result = await svc.fetchMemoryContext(COMPANY_ID, ISSUE_ID);
      expect(result.layeredContext).toContain(
        "Working Memory > Active Context > Domain > Identity",
      );
    });
  });

  // ── walkDependencyChain ───────────────────────────────────────────────

  describe("walkDependencyChain", () => {
    it("returns empty chain for task with no deps", async () => {
      addIssue({ id: ISSUE_ID });
      const result = await svc.walkDependencyChain(COMPANY_ID, ISSUE_ID);
      expect(result.chainIds).toEqual([]);
      expect(result.hasCycle).toBe(false);
    });

    it("returns chain in topological order", async () => {
      addIssue({ id: "a" });
      addIssue({ id: "b" });
      addIssue({ id: ISSUE_ID });
      addDependency(ISSUE_ID, "b");
      addDependency("b", "a");

      const result = await svc.walkDependencyChain(COMPANY_ID, ISSUE_ID);
      // a is deepest, then b
      expect(result.chainIds).toEqual(["a", "b"]);
      expect(result.hasCycle).toBe(false);
    });

    it("detects cycle", async () => {
      addIssue({ id: "a" });
      addIssue({ id: "b" });
      addIssue({ id: ISSUE_ID });
      addDependency(ISSUE_ID, "a");
      addDependency("a", "b");
      addDependency("b", "a");

      const result = await svc.walkDependencyChain(COMPANY_ID, ISSUE_ID);
      expect(result.hasCycle).toBe(true);
      // Should still return some chain IDs (acyclic portion)
      expect(result.chainIds.length).toBeGreaterThan(0);
    });
  });

  // ── resolveTaskHierarchy ──────────────────────────────────────────────

  describe("resolveTaskHierarchy", () => {
    it("returns nulls for nonexistent issue", async () => {
      const result = await svc.resolveTaskHierarchy(COMPANY_ID, "nonexistent");
      expect(result).toEqual({ departmentId: null, projectId: null, goalId: null, projectName: null });
    });

    it("resolves department type project as departmentId", async () => {
      const dept = addProject({ type: "department", name: "Eng" });
      addIssue({ id: ISSUE_ID, projectId: dept.id });

      const result = await svc.resolveTaskHierarchy(COMPANY_ID, ISSUE_ID);
      expect(result.departmentId).toBe(dept.id);
      expect(result.projectId).toBeNull();
      expect(result.projectName).toBe("Eng");
    });

    it("resolves project type as projectId", async () => {
      const proj = addProject({ type: "project", name: "Web" });
      addIssue({ id: ISSUE_ID, projectId: proj.id });

      const result = await svc.resolveTaskHierarchy(COMPANY_ID, ISSUE_ID);
      expect(result.projectId).toBe(proj.id);
      expect(result.departmentId).toBeNull();
      expect(result.projectName).toBe("Web");
    });

    it("uses issue goalId over project goalId", async () => {
      const issueGoal = addGoal({ title: "Issue Goal" });
      const projGoal = addGoal({ title: "Project Goal" });
      const dept = addProject({ goalId: projGoal.id });
      addIssue({ id: ISSUE_ID, projectId: dept.id, goalId: issueGoal.id });

      const result = await svc.resolveTaskHierarchy(COMPANY_ID, ISSUE_ID);
      expect(result.goalId).toBe(issueGoal.id);
    });

    it("falls back to project goalId when issue has none", async () => {
      const projGoal = addGoal({ title: "Project Goal" });
      const dept = addProject({ goalId: projGoal.id });
      addIssue({ id: ISSUE_ID, projectId: dept.id, goalId: null });

      const result = await svc.resolveTaskHierarchy(COMPANY_ID, ISSUE_ID);
      expect(result.goalId).toBe(projGoal.id);
    });
  });
});
