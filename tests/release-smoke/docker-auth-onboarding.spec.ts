import { expect, test, type Page } from "@playwright/test";

/**
 * Release-smoke: authenticated onboarding against a running AoA Docker
 * container. Validates that `docker run ghcr.io/anthropic/aoa:<tag>` boots,
 * the auth flow works, the onboarding wizard opens, and basic API routes
 * respond — the minimum signal that a published image isn't dead on arrival.
 *
 * MVP SCOPE (per plan H.D6, Phase H plan §Task H.4):
 *
 *   Step 1 (Name company) → Step 2 (Workspace root) transition +
 *   GET /api/companies API round-trip + /api/health endpoint pair.
 *
 * DEFERRED TO PHASE I (expanded coverage, per H.D6):
 *
 *   - Full 6-step wizard click-through. AoA's wizard has 6 steps vs.
 *     Paperclip's 4 (AoA adds Step 2 "Workspace root" + Step 5 "Discussions
 *     intro"). Step 2 mkdir writes to the host filesystem via filesystemApi
 *     and Step 3 adapter config (claude_local / opencode_local / etc.)
 *     requires a local CLI binary — neither assumption is safe inside the
 *     minimal Docker image CI pulls. Phase I adds an adapter-stub mode so
 *     the full click-through can run under `docker run` without real
 *     filesystem writes or external CLIs.
 *   - "Create & Open Issue" → `/issues/:id` URL assertion.
 *   - `/api/companies/:id/agents` + `/api/companies/:id/issues` shape checks
 *     (role === "ceo", assigneeAgentId link).
 *   - `heartbeat-runs` polling for the first CEO run (invocationSource +
 *     status ∈ {queued,running,succeeded,failed}).
 *   - AoA-specific flows: Discussions, MCP inbound, budgets, artifacts.
 *
 * The health-endpoint assertion is paired with the wizard test so CI can
 * distinguish "container didn't boot" (both fail) from "UI regressed"
 * (only wizard fails) — same pattern as tests/e2e/onboarding.spec.ts.
 */

const ADMIN_EMAIL =
  process.env.AOA_RELEASE_SMOKE_EMAIL ??
  process.env.AOA_RELEASE_SMOKE_EMAIL ??
  process.env.SMOKE_ADMIN_EMAIL ??
  "smoke-admin@paperclip.local";

const ADMIN_PASSWORD =
  process.env.AOA_RELEASE_SMOKE_PASSWORD ??
  process.env.AOA_RELEASE_SMOKE_PASSWORD ??
  process.env.SMOKE_ADMIN_PASSWORD ??
  "paperclip-smoke-password";

const COMPANY_NAME = `Release-Smoke-${Date.now()}`;

async function signIn(page: Page) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/auth/);

  await page.locator('input[type="email"]').fill(ADMIN_EMAIL);
  await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page).not.toHaveURL(/\/auth/, { timeout: 20_000 });
}

async function openOnboarding(page: Page) {
  // AoA's NoCompaniesStartPage auto-opens the wizard on mount when the
  // signed-in user has zero companies (see tests/e2e/onboarding.spec.ts).
  // Paperclip's equivalent surfaces a "Start Onboarding" button — we keep
  // that branch as a fallback so the same spec works if AoA adds a manual
  // entry point later.
  const wizardHeading = page.locator("h3", { hasText: "Name your company" });
  const startButton = page.getByRole("button", { name: "Start Onboarding" });

  await expect(wizardHeading.or(startButton)).toBeVisible({ timeout: 20_000 });

  if (await startButton.isVisible()) {
    await startButton.click();
  }

  await expect(wizardHeading).toBeVisible({ timeout: 10_000 });
}

test.describe("Docker authenticated onboarding smoke", () => {
  test("logs in, opens onboarding, advances past step 1, and creates a company", async ({
    page,
  }) => {
    await signIn(page);
    await openOnboarding(page);

    await page.locator('input[placeholder="Acme Corp"]').fill(COMPANY_NAME);
    await page.getByRole("button", { name: "Next" }).click();

    // Step 2 is AoA-only (workspace root). We assert the heading and stop —
    // actually picking a folder would invoke filesystemApi writes, which
    // aren't safe under `docker run` in CI.
    await expect(
      page.locator("h3", { hasText: "Set up workspace root" }),
    ).toBeVisible({ timeout: 10_000 });

    const baseUrl = new URL(page.url()).origin;

    const companiesRes = await page.request.get(`${baseUrl}/api/companies`);
    expect(companiesRes.ok()).toBe(true);
    const companies = (await companiesRes.json()) as Array<{
      id: string;
      name: string;
      issuePrefix: string;
    }>;
    const company = companies.find((entry) => entry.name === COMPANY_NAME);
    expect(company).toBeTruthy();
    expect(company!.issuePrefix).toBeTruthy();
  });

  test("health endpoint responds", async ({ request }) => {
    // Paired with the wizard test above: if this fails but the wizard test
    // also fails, the container didn't boot. If only the wizard test fails,
    // the UI regressed — the server is fine.
    const res = await request.get("/api/health");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body).toHaveProperty("status");
  });
});
