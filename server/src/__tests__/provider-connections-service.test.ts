// server/src/__tests__/provider-connections-service.test.ts
import { describe, it, expect } from "vitest";
import { assertSubscriptionAllowed } from "../services/provider-connections.js";

describe("BOOT INVARIANT: personal_subscription disabled in multi_tenant/cloud_auth", () => {
  it("throws for personal_subscription in multi_tenant / cloud_auth (create + verify + mint gate)", () => {
    expect(() =>
      assertSubscriptionAllowed("personal_subscription", {
        trustBoundary: "multi_tenant",
      } as never),
    ).toThrow(/subscription/i);
  });
  it("allows personal_subscription in single_tenant (self-hosted)", () => {
    expect(() =>
      assertSubscriptionAllowed("personal_subscription", { trustBoundary: "single_tenant" } as never),
    ).not.toThrow();
  });
  it("never blocks shareable methods, even in multi_tenant", () => {
    expect(() =>
      assertSubscriptionAllowed("api_key", { trustBoundary: "multi_tenant" } as never),
    ).not.toThrow();
    expect(() =>
      assertSubscriptionAllowed("enterprise_gateway", { trustBoundary: "multi_tenant" } as never),
    ).not.toThrow();
  });
});
