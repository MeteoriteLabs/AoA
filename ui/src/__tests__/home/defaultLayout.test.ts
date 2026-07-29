import { describe, it, expect } from "vitest";
import { getDefaultLayout } from "../../components/home/defaultLayout";
import { widgetRegistry } from "../../components/home/widgets/registry";

describe("getDefaultLayout", () => {
  it("returns only registered keys for every role", () => {
    for (const role of ["founder", "team_lead", "team_member", null] as const)
      for (const key of getDefaultLayout(role)) expect(widgetRegistry[key]).toBeDefined();
  });

  it("founder default is the full 10-widget board, including budget, approvals, discussions, and memory-review", () => {
    const founder = getDefaultLayout("founder");
    expect(founder).toContain("budget");
    expect(founder).toContain("approvals");
    expect(founder).toContain("discussions");
    expect(founder).toContain("memory-review");
    expect(founder).toHaveLength(10);
  });

  it("team_lead and null get the same oversight board as founder", () => {
    expect(getDefaultLayout("team_lead")).toEqual(getDefaultLayout("founder"));
    expect(getDefaultLayout(null)).toEqual(getDefaultLayout("founder"));
  });

  it("member default excludes budget, approvals, and memory-review, includes discussions, and starts with my-tasks", () => {
    const member = getDefaultLayout("team_member");
    expect(member).not.toContain("budget");
    expect(member).not.toContain("approvals");
    expect(member).not.toContain("memory-review");
    expect(member).toContain("discussions");
    expect(member[0]).toBe("my-tasks");
    expect(member).toHaveLength(7);
  });
});
