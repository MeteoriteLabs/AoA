// packages/db/src/__tests__/tenant-repository-surface.test.ts
//
// Compile/export-surface guard for the tenant repository boundary (TEN-001a).
//
// The tenant repository is the ONLY sanctioned reader of the new-path tables, and
// it is bound to a caller-supplied tenant transaction handle (`tx`). The package
// public surface must therefore expose EXACTLY `tenantRepositories` (a factory)
// and nothing else at runtime — no raw unscoped cross-tenant reader (e.g.
// `getAllJobs(db)`) that could sidestep the TEN-003 `runInTenant` context and
// forced RLS. TypeScript types (`TenantRepositories`, insert/select aliases)
// erase at runtime, so a correct module has exactly one own enumerable key.
//
// Plain unit test (no DB) — Windows-visible, always runs.
//
// RED (before repositories/tenant/index.ts exists): the import throws
// (module missing). GREEN (after): exactly one runtime export, a function.
import { describe, expect, it } from "vitest";
import * as tenantRepoModule from "../repositories/tenant/index.js";

describe("tenant repository public surface (TEN-001a)", () => {
  it("exports exactly tenantRepositories and no raw unscoped reader", () => {
    expect(Object.keys(tenantRepoModule).sort()).toEqual(["tenantRepositories"]);
  });

  it("tenantRepositories is a factory function", () => {
    expect(typeof tenantRepoModule.tenantRepositories).toBe("function");
  });
});
