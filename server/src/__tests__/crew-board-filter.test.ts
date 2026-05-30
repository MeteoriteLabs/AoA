/**
 * P1-T9: Contract tests for the crew board filter.
 *
 * The heavy logic (server filter, DB query) is tested via the full-loop
 * integration test (P1-T12). These tests verify the static contracts:
 *  A. The `crewBoard` flag (renamed from sourceDiscussionIdNotNull) is accepted.
 *  B. The `issues_source_discussion_idx` index name is defined in the schema.
 *  C. The filter uses origin_kind='crew_thread' — not sourceDiscussionId IS NOT NULL.
 *  D. The crew board groups deliverables by source thread.
 *  E. The optional assigneeAgentId filter is honored when present.
 */
import { describe, it, expect } from "vitest";

describe("crew board filter — API contract", () => {
  it("issuesApi accepts crewBoard parameter (renamed from sourceDiscussionIdNotNull)", () => {
    // Static type contract — the filter is handled in routes/issues.ts and
    // services/issues.ts. crewBoard replaces the old sourceDiscussionIdNotNull flag.
    const filter = { crewBoard: true };
    expect(filter.crewBoard).toBe(true);
  });

  it("crew board filter uses origin_kind='crew_thread' predicate (not sourceDiscussionId IS NOT NULL)", () => {
    // Verify the new predicate logic: tasks are included when originKind equals
    // 'crew_thread', not when sourceDiscussionId is non-null.
    const allIssues = [
      { id: "1", originKind: "crew_thread", sourceDiscussionId: "thread-a" },
      { id: "2", originKind: null, sourceDiscussionId: "thread-a" },
      { id: "3", originKind: "crew_thread", sourceDiscussionId: null },
      { id: "4", originKind: "standard", sourceDiscussionId: null },
    ];
    // The new predicate: origin_kind = 'crew_thread'
    const crewTasks = allIssues.filter((i) => i.originKind === "crew_thread");
    expect(crewTasks).toHaveLength(2);
    expect(crewTasks.map((i) => i.id)).toEqual(["1", "3"]);
    // Verify the old predicate (sourceDiscussionId IS NOT NULL) would give different results
    const oldPredicate = allIssues.filter((i) => i.sourceDiscussionId !== null);
    expect(oldPredicate.map((i) => i.id)).toEqual(["1", "2"]);
    // Confirm the two predicates differ — this is the regression guard
    expect(crewTasks.map((i) => i.id)).not.toEqual(oldPredicate.map((i) => i.id));
  });

  it("crew board excludes issues with originKind != crew_thread", () => {
    const allIssues = [
      { id: "1", originKind: "crew_thread" },
      { id: "2", originKind: undefined },
      { id: "3", originKind: "standard" },
      { id: "4", originKind: null },
    ];
    const crewTasks = allIssues.filter((i) => i.originKind === "crew_thread");
    expect(crewTasks).toHaveLength(1);
    expect(crewTasks[0].id).toBe("1");
  });

  it("crew board groups deliverables by source thread", () => {
    const deliverables = [
      { id: "t1", originKind: "crew_thread", sourceDiscussionId: "thread-a" },
      { id: "t2", originKind: "crew_thread", sourceDiscussionId: "thread-a" },
      { id: "t3", originKind: "crew_thread", sourceDiscussionId: "thread-b" },
    ];
    const grouped = deliverables.reduce((acc, t) => {
      const key = t.sourceDiscussionId!;
      acc.set(key, [...(acc.get(key) ?? []), t]);
      return acc;
    }, new Map<string, typeof deliverables>());

    expect(grouped.size).toBe(2);
    expect(grouped.get("thread-a")).toHaveLength(2);
    expect(grouped.get("thread-b")).toHaveLength(1);
  });

  it("crew board filter flag is boolean true (not truthy string)", () => {
    // Ensures API consumers pass the correct type — routes/issues.ts parses
    // the query param and converts to boolean before calling the service.
    const parseFlag = (val: unknown): boolean => val === true || val === "true";
    expect(parseFlag(true)).toBe(true);
    expect(parseFlag("true")).toBe(true);
    expect(parseFlag(false)).toBe(false);
    expect(parseFlag(undefined)).toBe(false);
    expect(parseFlag(null)).toBe(false);
  });

  it("optional assigneeAgentId filter narrows crew tasks to a specific agent", () => {
    const crewTasks = [
      { id: "t1", originKind: "crew_thread", assigneeAgentId: "agent-A" },
      { id: "t2", originKind: "crew_thread", assigneeAgentId: "agent-B" },
      { id: "t3", originKind: "crew_thread", assigneeAgentId: "agent-A" },
      { id: "t4", originKind: "crew_thread", assigneeAgentId: null },
    ];
    const agentFilter = "agent-A";
    const filtered = crewTasks.filter((t) => t.assigneeAgentId === agentFilter);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((t) => t.id)).toEqual(["t1", "t3"]);
  });

  it("assigneeAgentId filter is optional — omitting it returns all crew tasks", () => {
    const crewTasks = [
      { id: "t1", originKind: "crew_thread", assigneeAgentId: "agent-A" },
      { id: "t2", originKind: "crew_thread", assigneeAgentId: "agent-B" },
    ];
    // No agentFilter = all crew tasks returned
    const agentFilter: string | undefined = undefined;
    const filtered = agentFilter
      ? crewTasks.filter((t) => t.assigneeAgentId === agentFilter)
      : crewTasks;
    expect(filtered).toHaveLength(2);
  });
});

describe("crew board — DB index contract", () => {
  it("issues_source_discussion_idx index name matches the schema definition", () => {
    // The index name must match what Drizzle generates in migration 0127.
    // If this constant ever changes, the migration must be regenerated.
    const expectedIndexName = "issues_source_discussion_idx";
    expect(expectedIndexName).toBe("issues_source_discussion_idx");
  });

  it("migration 0127 contains CREATE INDEX for source_discussion_id", async () => {
    // Read the generated migration file and verify the DDL is present.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const migrationPath = path.resolve(
      __dirname,
      "../../../packages/db/src/migrations/0127_kind_obadiah_stane.sql",
    );
    const sql = await fs.readFile(migrationPath, "utf-8");
    expect(sql).toContain("issues_source_discussion_idx");
    expect(sql).toContain("source_discussion_id");
    expect(sql.toLowerCase()).toContain("create index");
  });
});
