import type { APIRequestContext } from "@playwright/test";

/**
 * Seed a company for an e2e spec that needs a company-prefixed route to load.
 *
 * `pnpm aoa onboard --yes --run` (the e2e webServer command) creates an empty
 * instance — no companies. Specs that navigate to `/` and expect a redirect to
 * `/{prefix}/home` need to seed at least one company first.
 *
 * In local_trusted mode the synthetic local-board actor is automatically
 * authorised by /api/companies, so no Bearer token is needed.
 *
 * Returns the seeded company so the spec can pin an issuePrefix or id.
 */
export async function seedCompany(
  request: APIRequestContext,
  name = `E2E-Test-Company-${Date.now()}`,
): Promise<{ id: string; name: string; issuePrefix: string }> {
  const res = await request.post("/api/companies", {
    data: { name },
  });
  if (!res.ok()) {
    const body = await res.text().catch(() => "(no body)");
    throw new Error(`seedCompany failed: ${res.status()} ${body}`);
  }
  const company = (await res.json()) as { id: string; name: string; issuePrefix: string };
  if (!company.id || !company.issuePrefix) {
    throw new Error(`seedCompany returned invalid company: ${JSON.stringify(company)}`);
  }
  return company;
}

/**
 * Best-effort cleanup of any test-prefixed companies left behind by previous
 * runs. Safe to call from beforeEach — silently skips on permission errors.
 */
export async function cleanupTestCompanies(
  request: APIRequestContext,
  prefixRegex = /^E2E-(Test|MCP)-/,
): Promise<void> {
  const res = await request.get("/api/companies");
  if (!res.ok()) return;
  const companies = (await res.json()) as Array<{ id: string; name: string }>;
  for (const c of companies) {
    if (!prefixRegex.test(c.name)) continue;
    await request.delete(`/api/companies/${c.id}`).catch(() => {});
  }
}
