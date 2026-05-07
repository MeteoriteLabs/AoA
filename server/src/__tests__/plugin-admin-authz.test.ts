import { describe, it, expect } from "vitest";

describe("assertCanManageInstanceSettings", () => {
  function makeReq(overrides: Record<string, unknown> = {}) {
    return {
      actor: {
        type: "board",
        source: "session",
        isInstanceAdmin: false,
        ...overrides,
      },
    };
  }

  it("allows local_implicit board regardless of isInstanceAdmin", async () => {
    const { assertCanManageInstanceSettings } = await import("../routes/authz.js");
    expect(() =>
      assertCanManageInstanceSettings(makeReq({ source: "local_implicit" }) as any)
    ).not.toThrow();
  });

  it("allows session board with isInstanceAdmin=true", async () => {
    const { assertCanManageInstanceSettings } = await import("../routes/authz.js");
    expect(() =>
      assertCanManageInstanceSettings(makeReq({ isInstanceAdmin: true }) as any)
    ).not.toThrow();
  });

  it("throws 403 for session board with isInstanceAdmin=false", async () => {
    const { assertCanManageInstanceSettings } = await import("../routes/authz.js");
    expect(() =>
      assertCanManageInstanceSettings(makeReq() as any)
    ).toThrow(/Instance admin access required/);
  });

  it("throws 403 for non-board actor", async () => {
    const { assertCanManageInstanceSettings } = await import("../routes/authz.js");
    expect(() =>
      assertCanManageInstanceSettings({ actor: { type: "agent" } } as any)
    ).toThrow(/Board access required/);
  });
});
