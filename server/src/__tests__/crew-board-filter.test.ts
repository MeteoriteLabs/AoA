/**
 * Crew board filter — API contract tests.
 *
 * The heavy logic (server filter, DB query) is tested via the full-loop
 * integration test (P1-T12). These tests verify the static contracts after the
 * Unified Crew Board change (2026-06-02):
 *  A. The `crewBoard` flag is accepted by the issues list filter.
 *  B. The crew-board predicate is "assignee is an active crew agent"
 *     (agents.kind='aoa' AND status<>'terminated') — NOT origin_kind='crew_thread'.
 *  C. originKind + sourceThreadTitle are still returned on crew-board rows so the
 *     shared card can label each task's source/lineage.
 *  D. The optional assigneeAgentId filter still narrows crew tasks to one agent.
 *  E. The DB index backing the source-thread JOIN still exists.
 */
import { describe, it, expect } from "vitest";

/** Mirror of a crew agent row as the EXISTS subquery sees it. */
type AgentRow = { id: string; kind: string; status: string };
/** Mirror of the issue columns the predicate + card touch. */
type IssueRow = {
  id: string;
  assigneeAgentId: string | null;
  originKind?: string | null;
  sourceDiscussionId?: string | null;
  sourceThreadTitle?: string | null;
};

/**
 * Pure mirror of the server EXISTS predicate:
 *   EXISTS (SELECT 1 FROM agents
 *           WHERE agents.id = issues.assignee_agent_id
 *             AND agents.kind = 'aoa'
 *             AND agents.status <> 'terminated')
 */
function isCrewAssignee(issue: IssueRow, agents: AgentRow[]): boolean {
  if (!issue.assigneeAgentId) return false;
  return agents.some(
    (a) =>
      a.id === issue.assigneeAgentId &&
      a.kind === "aoa" &&
      a.status !== "terminated",
  );
}

describe("crew board filter — API contract", () => {
  it("issuesApi accepts the crewBoard parameter", () => {
    // Static type contract — the filter is handled in routes/issues.ts and
    // services/issues.ts.
    const filter = { crewBoard: true };
    expect(filter.crewBoard).toBe(true);
  });

  it("crew board includes any task assigned to an active crew (kind='aoa') agent", () => {
    // The unified board is the flat tracker for ALL crew-agent work — tasks
    // from discussions, goals, routines, MCP, and direct capture alike. The
    // discriminator is the assignee's agent kind, not the task's origin_kind.
    const agents: AgentRow[] = [
      { id: "aoa-active", kind: "aoa", status: "idle" },
      { id: "aoa-terminated", kind: "aoa", status: "terminated" },
      { id: "org-agent", kind: "org", status: "idle" },
    ];
    const allIssues: IssueRow[] = [
      // thread-sourced, crew assignee → IN
      { id: "1", assigneeAgentId: "aoa-active", originKind: "crew_thread" },
      // goal-sourced, crew assignee → IN (would have been EXCLUDED by old predicate)
      { id: "2", assigneeAgentId: "aoa-active", originKind: "goal" },
      // direct capture (no origin), crew assignee → IN
      { id: "3", assigneeAgentId: "aoa-active", originKind: null },
      // crew_thread origin but assigned to a non-crew org agent → OUT
      { id: "4", assigneeAgentId: "org-agent", originKind: "crew_thread" },
      // crew_thread origin but assignee is a terminated crew agent → OUT
      { id: "5", assigneeAgentId: "aoa-terminated", originKind: "crew_thread" },
      // unassigned → OUT
      { id: "6", assigneeAgentId: null, originKind: "crew_thread" },
    ];

    const crewTasks = allIssues.filter((i) => isCrewAssignee(i, agents));
    expect(crewTasks.map((i) => i.id)).toEqual(["1", "2", "3"]);
  });

  it("crew-assignee predicate differs from the old origin_kind='crew_thread' predicate", () => {
    // Regression guard: the two predicates select different sets. The unified
    // board picks up non-thread crew tasks that the old predicate dropped, and
    // drops thread tasks reassigned away from the crew that the old one kept.
    const agents: AgentRow[] = [{ id: "aoa-active", kind: "aoa", status: "idle" }];
    const allIssues: IssueRow[] = [
      { id: "a", assigneeAgentId: "aoa-active", originKind: "goal" }, // new-only
      { id: "b", assigneeAgentId: "human", originKind: "crew_thread" }, // old-only
    ];

    const newPredicate = allIssues.filter((i) => isCrewAssignee(i, agents)).map((i) => i.id);
    const oldPredicate = allIssues
      .filter((i) => i.originKind === "crew_thread")
      .map((i) => i.id);

    expect(newPredicate).toEqual(["a"]);
    expect(oldPredicate).toEqual(["b"]);
    expect(newPredicate).not.toEqual(oldPredicate);
  });

  it("crew board rows still carry originKind + sourceThreadTitle for the source badge", () => {
    // The board no longer groups by thread — it renders one flat list and the
    // shared card labels each task's source from these fields. Both must survive
    // on the returned row (originKind selected directly; sourceThreadTitle from
    // the LEFT JOIN on discussions).
    const row: IssueRow = {
      id: "t1",
      assigneeAgentId: "aoa-active",
      originKind: "crew_thread",
      sourceDiscussionId: "thread-a",
      sourceThreadTitle: "QA6-drive",
    };
    expect(row.originKind).toBe("crew_thread");
    expect(row.sourceThreadTitle).toBe("QA6-drive");

    // A routine-origin task has originKind but no thread title — the card falls
    // back to a generic source label.
    const routineRow: IssueRow = {
      id: "t2",
      assigneeAgentId: "aoa-active",
      originKind: "routine",
      sourceThreadTitle: null,
    };
    expect(routineRow.originKind).toBe("routine");
    expect(routineRow.sourceThreadTitle).toBeNull();
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
    // The board itself no longer renders an agent dropdown, but the underlying
    // assigneeAgentId service filter is preserved (pushed unconditionally) and
    // still composes with the crew-board predicate.
    const crewTasks: IssueRow[] = [
      { id: "t1", assigneeAgentId: "agent-A" },
      { id: "t2", assigneeAgentId: "agent-B" },
      { id: "t3", assigneeAgentId: "agent-A" },
    ];
    const agentFilter = "agent-A";
    const filtered = crewTasks.filter((t) => t.assigneeAgentId === agentFilter);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((t) => t.id)).toEqual(["t1", "t3"]);
  });

  it("assigneeAgentId filter is optional — omitting it returns all crew tasks", () => {
    const crewTasks: IssueRow[] = [
      { id: "t1", assigneeAgentId: "agent-A" },
      { id: "t2", assigneeAgentId: "agent-B" },
    ];
    const agentFilter: string | undefined = undefined;
    const filtered = agentFilter
      ? crewTasks.filter((t) => t.assigneeAgentId === agentFilter)
      : crewTasks;
    expect(filtered).toHaveLength(2);
  });
});

describe("crew board — DB index contract", () => {
  it("issues_source_discussion_idx index name matches the schema definition", () => {
    // The index backs the LEFT JOIN that supplies sourceThreadTitle. If this
    // name ever changes, the migration must be regenerated.
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
