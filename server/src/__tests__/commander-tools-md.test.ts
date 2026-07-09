import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(
  resolve(__dirname, "../onboarding-assets/commander/TOOLS.md"),
  "utf8",
);

describe("TOOLS.md contract", () => {
  // Core tools always present
  const coreTools = [
    "query_tasks", "query_goals", "query_team_roster", "query_humans", "query_agents", "query_company",
    "query_departments", "query_memory", "query_budget", "query_activity",
    "use_skill",
  ];

  for (const tool of coreTools) {
    it(`enumerates ${tool} by exact name`, () => {
      expect(src).toContain(`\`${tool}\``);
    });
  }

  // Action tools that require confirmation
  const actionTools = ["create_task", "update_task", "create_agent", "create_goal"];
  for (const tool of actionTools) {
    it(`enumerates action tool ${tool}`, () => {
      expect(src).toContain(`\`${tool}\``);
    });
  }

  // Browser routing instructions used to live here, but the v0.1 rewrite
  // (commit 25507693) moved external-tool routing (Bash for HTTP, task for
  // QA workflows) into AGENTS.md / HEARTBEAT.md so TOOLS.md focuses purely
  // on the 35 internal Commander tools. The contract test is preserved as
  // a placeholder — if browser routing returns to TOOLS.md, restore the
  // assertion below.
  it.skip("(deferred) contains browser routing instruction (Bash for HTTP, task for QA)", () => {
    expect(src).toContain("Bash");
    expect(src.toLowerCase()).toContain("browser");
  });

  // No more vague category blobs
  it("does not use the vague 'query, action, memory, workflow' blob", () => {
    expect(src).not.toContain(
      "You have query, action, memory, workflow, coordination, analysis, file, and delegation tools",
    );
  });

  it("documents the current Commander-visible tool count", () => {
    expect(src).toContain("You have **37 tools**");
    expect(src).toContain("The 37 tools above are your complete set");
  });

  // The v0.1 rewrite organizes tools into named, table-rendered categories.
  // Lock that surface so a future drift back to the prose blob is caught.
  it("organizes tools into named markdown categories with table rows", () => {
    expect(src).toMatch(/^## Query Tools/m);
    expect(src).toMatch(/^## Action Tools/m);
    expect(src).toMatch(/^## Memory Tools/m);
    // Pipe-table syntax: | Tool | What it ... |
    expect(src).toMatch(/^\|\s*Tool\s*\|/m);
  });

  it("documents responsible human ownership separately from executor assignment", () => {
    expect(src).toMatch(/responsible human/i);
    expect(src).toMatch(/assignee is the agent or human/i);
    expect(src).toMatch(/`create_task`[\s\S]*assigneeId[\s\S]*responsibleUserId/i);
    expect(src).toMatch(/`update_task`[\s\S]*responsibleUserId[\s\S]*null clears/i);
    expect(src).toMatch(/`update_task`[\s\S]*Use `assign_task` for assignee reassignment/i);
    expect(src).not.toMatch(/agent executor/i);
    expect(src).toMatch(/`query_tasks`[\s\S]*responsibleUserId/i);
  });
});
