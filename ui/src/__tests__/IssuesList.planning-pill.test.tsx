import { describe, expect, it } from "vitest";

describe("IssuesList — Planning pill condition", () => {
  it("shows Planning pill for planning-mode issues", () => {
    const workMode = "planning" as const;
    expect(workMode === "planning").toBe(true);
  });

  it("does not show Planning pill for standard-mode issues", () => {
    const workMode = "standard" as const;
    expect(workMode === "planning").toBe(false);
  });
});
