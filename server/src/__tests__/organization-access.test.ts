import { describe, it, expect } from "vitest";
import { orgRoleCan } from "../services/organization-access.js";

describe("orgRoleCan (role x capability matrix)", () => {
  it("owner can do everything org-scoped", () => {
    for (const cap of [
      "company:create", "company:delete", "org:member:manage",
      "org:role:set", "org:transfer", "org:dissolve", "billing:manage", "company:list:all",
    ] as const) {
      expect(orgRoleCan("owner", cap)).toBe(true);
    }
  });
  it("admin can create/delete companies + manage members but not transfer/billing", () => {
    expect(orgRoleCan("admin", "company:create")).toBe(true);
    expect(orgRoleCan("admin", "org:member:manage")).toBe(true);
    expect(orgRoleCan("admin", "org:transfer")).toBe(false);
    expect(orgRoleCan("admin", "billing:manage")).toBe(false);
  });
  it("member cannot create companies", () => {
    expect(orgRoleCan("member", "company:create")).toBe(false);
    expect(orgRoleCan("member", "company:list:scoped")).toBe(true);
  });
  it("billing can only manage billing + read metadata", () => {
    expect(orgRoleCan("billing", "billing:manage")).toBe(true);
    expect(orgRoleCan("billing", "company:create")).toBe(false);
    expect(orgRoleCan("billing", "company:list:metadata")).toBe(true);
  });
});
