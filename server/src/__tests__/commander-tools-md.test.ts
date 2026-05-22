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
    "query_tasks", "query_goals", "query_agents", "query_company",
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

  // Browser routing rule must be explicit
  it("contains browser routing instruction (Bash for HTTP, task for QA)", () => {
    expect(src).toContain("Bash");
    expect(src.toLowerCase()).toContain("browser");
  });

  // No more vague category blobs
  it("does not use the vague 'query, action, memory, workflow' blob", () => {
    expect(src).not.toContain(
      "You have query, action, memory, workflow, coordination, analysis, file, and delegation tools",
    );
  });
});
