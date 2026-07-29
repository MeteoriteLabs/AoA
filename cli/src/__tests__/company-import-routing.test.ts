import { describe, expect, it } from "vitest";
import { resolveCompanyImportPath } from "../commands/client/company.js";

describe("resolveCompanyImportPath", () => {
  it("uses the canonical new-company routes", () => {
    expect(resolveCompanyImportPath("new", undefined, true)).toBe(
      "/api/companies/import/new/preview",
    );
    expect(resolveCompanyImportPath("new", undefined, false)).toBe(
      "/api/companies/import/new",
    );
  });

  it("uses the canonical company-scoped routes", () => {
    const companyId = "11111111-1111-4111-8111-111111111111";
    expect(resolveCompanyImportPath("existing", companyId, true)).toBe(
      `/api/companies/${companyId}/import/preview`,
    );
    expect(resolveCompanyImportPath("existing", companyId, false)).toBe(
      `/api/companies/${companyId}/import`,
    );
  });

  it("rejects an existing-company target without a company id", () => {
    expect(() => resolveCompanyImportPath("existing", undefined, true)).toThrow(
      /requires --company-id/,
    );
  });
});
