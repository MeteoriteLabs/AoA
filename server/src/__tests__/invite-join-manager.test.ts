import { describe, expect, it } from "vitest";
import { resolveJoinRequestAgentManagerId } from "../routes/access-helpers.js";

describe("resolveJoinRequestAgentManagerId", () => {
  it("returns null when no CEO exists in the company agent list", () => {
    const managerId = resolveJoinRequestAgentManagerId([
      { id: "a1", role: "cto", reportsTo: null },
      { id: "a2", role: "engineer", reportsTo: "a1" },
    ]);

    expect(managerId).toBeNull();
  });

  it("selects the root CEO when available", () => {
    const managerId = resolveJoinRequestAgentManagerId([
      { id: "ceo-child", role: "ceo", reportsTo: "manager-1" },
      { id: "manager-1", role: "cto", reportsTo: null },
      { id: "ceo-root", role: "ceo", reportsTo: null },
    ]);

    expect(managerId).toBe("ceo-root");
  });

  it("selects the root CEO using parentId when available", () => {
    const managerId = resolveJoinRequestAgentManagerId([
      { id: "ceo-child", role: "ceo", reportsTo: "manager-1", parentType: "agent", parentId: "manager-1" },
      { id: "manager-1", role: "cto", reportsTo: null, parentType: null, parentId: null },
      { id: "ceo-root", role: "ceo", reportsTo: null, parentType: null, parentId: null },
    ]);

    expect(managerId).toBe("ceo-root");
  });

  it("falls back to the first CEO when no root CEO is present", () => {
    const managerId = resolveJoinRequestAgentManagerId([
      { id: "ceo-1", role: "ceo", reportsTo: "mgr" },
      { id: "ceo-2", role: "ceo", reportsTo: "mgr" },
      { id: "mgr", role: "cto", reportsTo: null },
    ]);

    expect(managerId).toBe("ceo-1");
  });
});
