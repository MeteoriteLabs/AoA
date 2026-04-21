import { test, expect } from "@playwright/test";

/**
 * E2E: Onboarding wizard smoke (SKIP_LLM mode).
 *
 * AoA's OnboardingWizard is a 6-step Dialog (not a dedicated /onboarding
 * route like Paperclip). Landing on `/` with zero companies renders
 * NoCompaniesStartPage, which auto-opens the wizard:
 *
 *   Step 1 — Name your company
 *   Step 2 — Set up workspace root          (AoA-only, NEW vs. Paperclip)
 *   Step 3 — Create your first agent        (adapter selection + config)
 *   Step 4 — Give it something to do        (task creation)
 *   Step 5 — Discussions intro              (AoA-only, NEW vs. Paperclip)
 *   Step 6 — Ready to launch                (summary + "Open Task")
 *
 * This smoke covers Step 1 → Step 2 transition + API round-trip. The full
 * click-through is deferred: Step 2 mkdir + Step 3 adapter environment
 * check both require real filesystem / local adapter CLIs, which aren't
 * a safe assumption for every CI environment. A later session adds an
 * adapter-stub mode so we can drive the full 6-step flow.
 *
 * Set PAPERCLIP_E2E_SKIP_LLM=false to enable LLM-dependent assertions
 * (requires ANTHROPIC_API_KEY).
 */

const SKIP_LLM = process.env.PAPERCLIP_E2E_SKIP_LLM !== "false";

const COMPANY_NAME = `E2E-Test-${Date.now()}`;

test.describe("Onboarding wizard", () => {
  test("opens on first run and advances past step 1", async ({ page }) => {
    await page.goto("/");

    // NoCompaniesStartPage auto-opens the wizard on mount.
    const step1Heading = page.locator("h3", { hasText: "Name your company" });
    await expect(step1Heading).toBeVisible({ timeout: 10_000 });

    // Fill company name. AoA step 1 also has an optional goal textarea;
    // the smoke leaves it blank to keep the assertion surface tight.
    const companyNameInput = page.locator('input[placeholder="Acme Corp"]');
    await companyNameInput.fill(COMPANY_NAME);

    await page.getByRole("button", { name: "Next" }).click();

    // Step 2 is AoA-specific (workspace root). We assert the heading and
    // stop — actually setting the root folder would invoke filesystemApi
    // which writes to the real disk.
    await expect(
      page.locator("h3", { hasText: "Set up workspace root" }),
    ).toBeVisible({ timeout: 10_000 });

    // API round-trip: the company should now exist.
    const baseUrl = page.url().split("/").slice(0, 3).join("/");
    const companiesRes = await page.request.get(`${baseUrl}/api/companies`);
    expect(companiesRes.ok()).toBe(true);
    const companies = await companiesRes.json();
    const company = companies.find(
      (c: { name: string }) => c.name === COMPANY_NAME,
    );
    expect(company).toBeTruthy();
    expect(company.issuePrefix).toBeTruthy();
  });

  test("health endpoint responds", async ({ request }) => {
    // Paired with the wizard test: if this fails but the wizard test
    // also fails, the webServer didn't boot. If only the wizard test
    // fails, the UI regressed — server is fine.
    const res = await request.get("/api/health");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body).toHaveProperty("status");
  });
});

// Keep the SKIP_LLM branch referenced so future specs can gate heartbeat
// assertions off it without re-introducing the import.
void SKIP_LLM;
