import { describe, expect, it } from "vitest";
import type { CompanyPortabilityPreviewRequest } from "@armyofagents/shared";
import { companyImportPath } from "../company-portability";

const source: CompanyPortabilityPreviewRequest["source"] = {
  type: "inline",
  manifest: {
    schemaVersion: 2,
    generatedAt: "2026-07-28T00:00:00.000Z",
    source: null,
    includes: { company: false, agents: false },
    company: null,
    agents: [],
    requiredSecrets: [],
  },
  files: {},
};

describe("companyImportPath", () => {
  it("uses the path-authorized new-company endpoints", () => {
    const request: CompanyPortabilityPreviewRequest = {
      source,
      target: { mode: "new_company", newCompanyName: "Imported" },
    };
    expect(companyImportPath(request, true)).toBe(
      "/companies/import/new/preview",
    );
    expect(companyImportPath(request, false)).toBe("/companies/import/new");
  });

  it("puts the authorized existing company in the path", () => {
    const request: CompanyPortabilityPreviewRequest = {
      source,
      target: {
        mode: "existing_company",
        companyId: "11111111-1111-4111-8111-111111111111",
      },
    };
    expect(companyImportPath(request, true)).toBe(
      "/companies/11111111-1111-4111-8111-111111111111/import/preview",
    );
    expect(companyImportPath(request, false)).toBe(
      "/companies/11111111-1111-4111-8111-111111111111/import",
    );
  });
});
