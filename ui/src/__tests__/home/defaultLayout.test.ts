import { describe, it, expect } from "vitest";
import { getDefaultLayout } from "../../components/home/defaultLayout";
import { widgetRegistry } from "../../components/home/widgets/registry";

describe("getDefaultLayout", () => {
  it("returns only registered keys for every role", () => {
    for (const role of ["founder", "team_lead", "team_member", null] as const)
      for (const key of getDefaultLayout(role)) expect(widgetRegistry[key]).toBeDefined();
  });
  it("preserves today's section order for every role (behavior-preserving in Plan 1)", () => {
    const expected = ["action-queue", "suggestions", "objectives", "activity-feed"];
    for (const role of ["founder", "team_lead", "team_member", null] as const)
      expect(getDefaultLayout(role)).toEqual(expected);
  });
});
