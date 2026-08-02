import { describe, expect, it } from "vitest";
import {
  createOrganizationSchema,
  inviteToOrganizationSchema,
} from "../validators/organization.js";

describe("organization validators", () => {
  it("accepts the self-serve create payload", () => {
    const parsed = createOrganizationSchema.parse({ name: "Acme" });
    expect(parsed.name).toBe("Acme");
  });
  it("rejects an empty name", () => {
    expect(() => createOrganizationSchema.parse({ name: "" })).toThrow();
  });
  it("rejects caller-controlled slug and plan fields", () => {
    expect(() => createOrganizationSchema.parse({ name: "Acme", slug: "acme" })).toThrow();
    expect(() => createOrganizationSchema.parse({ name: "Acme", plan: "enterprise" })).toThrow();
  });
  it("invite defaults role to member and requires a valid email", () => {
    const parsed = inviteToOrganizationSchema.parse({ email: "a@b.com" });
    expect(parsed.role).toBe("member");
    expect(() => inviteToOrganizationSchema.parse({ email: "nope" })).toThrow();
  });
  it("invite rejects a role outside owner|admin|member|billing", () => {
    expect(() =>
      inviteToOrganizationSchema.parse({ email: "a@b.com", role: "founder" }),
    ).toThrow();
  });
});
