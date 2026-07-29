import { describe, expect, it } from "vitest";
import {
  createOrganizationSchema,
  inviteToOrganizationSchema,
} from "../validators/organization.js";

describe("organization validators", () => {
  it("accepts a minimal create payload and defaults plan/slug omitted", () => {
    const parsed = createOrganizationSchema.parse({ name: "Acme" });
    expect(parsed.name).toBe("Acme");
  });
  it("rejects an empty name", () => {
    expect(() => createOrganizationSchema.parse({ name: "" })).toThrow();
  });
  it("rejects a slug with uppercase or spaces", () => {
    expect(() => createOrganizationSchema.parse({ name: "Acme", slug: "Acme Inc" })).toThrow();
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
