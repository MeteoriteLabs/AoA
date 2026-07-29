import { describe, it, expect } from "vitest";
import { widgetRegistry, getWidget, listWidgets } from "../../components/home/widgets/registry";

describe("widgetRegistry", () => {
  it("keys each def by its own key", () => {
    for (const [key, def] of Object.entries(widgetRegistry)) expect(def.key).toBe(key);
  });
  it("returns undefined for an unknown key (no throw)", () => {
    expect(getWidget("nope" as never)).toBeUndefined();
  });
  it("registers the four Plan-1 widgets plus the four Plan-2 widgets", () => {
    expect(Object.keys(widgetRegistry).sort()).toEqual([
      "action-queue",
      "activity-feed",
      "agents-now",
      "approvals",
      "budget",
      "my-tasks",
      "objectives",
      "suggestions",
    ]);
  });
  it("listWidgets returns every def", () => {
    expect(listWidgets()).toHaveLength(8);
  });
});
