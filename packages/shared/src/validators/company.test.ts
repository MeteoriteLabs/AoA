import { describe, expect, it } from "vitest";
import { createCompanySchema, updateCompanySchema } from "./company.js";

const ORG = "00000000-0000-0000-0000-0000000000a1";

describe("updateCompanySchema — tenant key (organizationId) is immutable on update", () => {
  it("strips organizationId from a PATCH body (never reparent a company cross-tenant)", () => {
    const parsed = updateCompanySchema.parse({ name: "Renamed", organizationId: ORG });
    expect(parsed).not.toHaveProperty("organizationId");
    expect(parsed.name).toBe("Renamed");
  });

  it("still accepts the other mutable update fields", () => {
    const parsed = updateCompanySchema.parse({
      vision: "V",
      requireBoardApprovalForNewAgents: true,
      budgetMonthlyCents: 5000,
    });
    expect(parsed).toMatchObject({
      vision: "V",
      requireBoardApprovalForNewAgents: true,
      budgetMonthlyCents: 5000,
    });
    expect(parsed).not.toHaveProperty("organizationId");
  });

  it("createCompanySchema still accepts organizationId (create-time tenant pick unchanged)", () => {
    const parsed = createCompanySchema.parse({ name: "New Co", organizationId: ORG });
    expect(parsed.organizationId).toBe(ORG);
  });
});
