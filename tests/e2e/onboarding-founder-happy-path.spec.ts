import { test, expect } from "@playwright/test";
import { freshOnboardingState } from "./helpers/onboarding-e2e";

// Selectors below were validated against the live app during Plan-1 planning
// (the full founder flow was driven end-to-end in a browser).
test.beforeEach(async ({ request }) => {
  await freshOnboardingState(request);
});

test("founder completes profile → org → environment → commander → verify → department → agent → review", async ({
  page,
  request,
}) => {
  await page.goto("/onboarding");

  // Profile
  await expect(page.getByRole("heading", { name: /your profile/i })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("textbox").first().fill("E2E Founder");
  await page.getByRole("button", { name: /continue/i }).click();

  // Organization
  await expect(page.getByRole("heading", { name: /create your organization/i })).toBeVisible();
  await page.getByRole("textbox").first().fill(`E2E-Test-Org-${Date.now()}`);
  await page.getByRole("button", { name: /continue/i }).click();

  // Environment — the prefilled ~/AoA path under the temp home is writable.
  await expect(page.getByRole("heading", { name: /set up your environment/i })).toBeVisible();
  await page.getByRole("button", { name: /verify & continue/i }).click();

  // Commander — pick Claude (fake-claude fixture verifies in CI).
  await expect(page.getByRole("heading", { name: /choose your commander/i })).toBeVisible();
  await page.getByText("Claude", { exact: true }).click();
  await page.getByRole("button", { name: /continue/i }).click();

  // Verify tooling
  await expect(page.getByRole("heading", { name: /verify your tooling/i })).toBeVisible();
  await page.getByRole("button", { name: /^verify$/i }).click();

  // Department — name is prefilled "Engineering"; wait for the async local-folder
  // prefill before clicking, or create throws "Local folder must be an absolute
  // path" (Codex P1 #10, observed live).
  await expect(page.getByRole("heading", { name: /create your first department/i })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByDisplayValue(/[\\/]engineering$/i)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /create department/i }).click();

  // Agent
  await expect(page.getByRole("heading", { name: /create your first agent/i })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: /create & assign/i }).click();

  // Review (terminal)
  await expect(page.getByRole("heading", { name: /you're set up/i })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: /go to dashboard/i }).click();

  // Landed in the app (a company-prefixed home).
  await expect(page).toHaveURL(/\/[A-Z0-9]+\/home/i, { timeout: 15_000 });

  // Progress assertion (Plan 1 P2 #12): the user layer records PROFILE_SET.
  const progress = await (await request.get("/api/onboarding/progress")).json();
  expect(progress?.progress?.completedStates ?? []).toContain("PROFILE_SET");
});
