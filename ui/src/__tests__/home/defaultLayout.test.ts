import { describe, it, expect } from "vitest";
import { getDefaultLayout } from "../../components/home/defaultLayout";
import { widgetRegistry } from "../../components/home/widgets/registry";

describe("getDefaultLayout", () => {
  it("returns only registered keys for every role", () => {
    for (const role of ["founder", "team_lead", "team_member", null] as const)
      for (const key of getDefaultLayout(role)) expect(widgetRegistry[key]).toBeDefined();
  });

  it("founder default is the full 8-widget board, including budget and approvals", () => {
    const founder = getDefaultLayout("founder");
    expect(founder).toContain("budget");
    expect(founder).toContain("approvals");
  });

  it("team_lead and null get the same oversight board as founder", () => {
    expect(getDefaultLayout("team_lead")).toEqual(getDefaultLayout("founder"));
    expect(getDefaultLayout(null)).toEqual(getDefaultLayout("founder"));
  });

  it("member default excludes budget and approvals and starts with my-tasks", () => {
    const member = getDefaultLayout("team_member");
    expect(member).not.toContain("budget");
    expect(member).not.toContain("approvals");
    expect(member[0]).toBe("my-tasks");
  });
});
