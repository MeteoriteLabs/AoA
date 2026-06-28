import { expect, type APIRequestContext, type Page } from "@playwright/test";

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

/**
 * Open the OnboardingWizard from the lobby empty state.
 *
 * This is the cold-path interaction of the whole e2e suite: the webServer
 * serves the UI via vite-dev-middleware, so the FIRST test to visit the lobby
 * pays a one-time on-demand module compile + server warmup (~7.8s observed cold
 * on a fast unloaded machine) before the "Create organization" button paints.
 * The button itself is gated behind the companies query (Lobby.tsx), which is
 * fast (GET /companies measured 38-706ms) — the latency is app-load, not the
 * query. Budget 30s so a slow/loaded CI runner doesn't time out before paint.
 * The per-test timeout is 60s (playwright.config.ts), so 30s here is safe.
 *
 * This single helper is the ONE place the cold-path budget lives — every
 * wizard-driving spec funnels through it. See
 * docs/aoa/plans/2026-06-28-onboarding-wizard-flake-fix.md.
 */
export async function openOnboardingWizard(page: Page): Promise<void> {
  await page.goto("/");
  // The empty-state "Create organization" CTA (LobbyEmptyState) only renders
  // when ZERO companies exist; once any company is present — e.g. left behind by
  // an earlier spec in the same run — the sole entry point is the sidebar's
  // always-present "New organization" button (LobbySidebar). Match EITHER so this
  // helper is robust regardless of how many companies prior specs accumulated.
  // `.first()` guards the empty-state case where both buttons render at once.
  const createCompanyButton = page
    .getByRole("button", { name: /^(create|new) organization$/i })
    .first();
  await expect(createCompanyButton).toBeVisible({ timeout: 30_000 });
  await createCompanyButton.click();
}

/**
 * Drive the OnboardingWizard through Step 4 (the step that POSTs /companies),
 * then resolve the created company's { id, issuePrefix } from /api/companies.
 *
 * Step 5 needs a real local adapter CLI to advance, so specs that need a
 * created company bail out of the wizard after Step 4 and continue via the API
 * or by navigating directly.
 *
 * Opts:
 *  - `companyName` controls the name (and thus the cleanup prefix the calling
 *    spec's beforeEach expects); defaults to a generic `E2E-Wizard-<ts>`.
 *  - `commanderProvider`/`commanderModel`/`crewProvider`/`crewModel` pick the
 *    onboarding provider+model. Defaults preserve the original picks:
 *    Commander = anthropic + "claude-sonnet-4-6", Crew = openai + "" (blank).
 *
 * NOTE: the route-local updateConfigSchema.model is NULLABLE (a blank model →
 * `model: null` is accepted; the CLI default is used). Pass an empty string to
 * exercise the provider-default path.
 */
export async function seedCompanyViaWizard(
  page: Page,
  request: APIRequestContext,
  opts: {
    companyName?: string;
    commanderProvider?: string;
    commanderModel?: string;
    crewProvider?: string;
    crewModel?: string;
  } = {},
): Promise<{ companyId: string; issuePrefix: string; companyName: string }> {
  const companyName = opts.companyName ?? `E2E-Wizard-${Date.now()}`;
  const commanderProvider = opts.commanderProvider ?? "anthropic";
  const crewProvider = opts.crewProvider ?? "openai";
  const commanderModel = opts.commanderModel ?? "claude-sonnet-4-6";
  const crewModel = opts.crewModel ?? "";

  await openOnboardingWizard(page);

  // ── Step 1: company name ──
  await expect(
    page.locator("h3", { hasText: "Name your company" }),
  ).toBeVisible({ timeout: 10_000 });
  await page.locator('input[placeholder="Acme Corp"]').fill(companyName);
  await page.getByTestId("step1-next").click();

  // ── Step 2: workspace root (accept the auto-suggested path; fall back) ──
  await expect(
    page.locator("h3", { hasText: "Set up workspace root" }),
  ).toBeVisible({ timeout: 10_000 });
  const rootInput = page.locator(
    'input[placeholder="/path/to/company/workspace"]',
  );
  await expect(rootInput).toBeVisible({ timeout: 5_000 });
  if ((await rootInput.inputValue()).trim() === "") {
    await rootInput.fill("/tmp/aoa-e2e-wizard");
  }
  await page.getByTestId("step2-next").click();

  // ── Step 3: Commander pick ──
  await expect(
    page.locator("h3", { hasText: "Choose your Commander" }),
  ).toBeVisible({ timeout: 10_000 });
  await page
    .getByTestId("commander-provider")
    .selectOption({ value: commanderProvider });
  await page.getByTestId("commander-model").fill(commanderModel);
  await page.getByTestId("step3-next").click();

  // ── Step 4: Crew pick (this is the step that POSTs /companies) ──
  await expect(
    page.locator("h3", { hasText: "Choose your Crew" }),
  ).toBeVisible({ timeout: 10_000 });
  await page
    .getByTestId("crew-provider")
    .selectOption({ value: crewProvider });
  await page.getByTestId("crew-model").fill(crewModel);
  await page.getByTestId("step4-next").click();

  // ── Wait for the company to land — Step 5 heading is the signal ──
  await expect(
    page.locator("h3", { hasText: "Create your first agent" }),
  ).toBeVisible({ timeout: 15_000 });

  // ── Resolve the created company from the API ──
  const companiesRes = await request.get("/api/companies");
  expect(companiesRes.ok()).toBe(true);
  const companies = (await companiesRes.json()) as Array<{
    id: string;
    name: string;
    issuePrefix: string;
  }>;
  const company = companies.find((c) => c.name === companyName);
  expect(company).toBeTruthy();
  expect(company?.id).toBeTruthy();
  expect(company?.issuePrefix).toBeTruthy();

  return {
    companyId: company!.id,
    issuePrefix: company!.issuePrefix,
    companyName,
  };
}
