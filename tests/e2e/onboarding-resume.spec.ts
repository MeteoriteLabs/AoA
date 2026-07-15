import { test, expect } from "@playwright/test";
import { freshOnboardingState } from "./helpers/onboarding-e2e";

test.beforeEach(async ({ request }) => {
  await freshOnboardingState(request);
});

test("leaving after the profile step and returning resumes at the org step (not profile)", async ({ page }) => {
  await page.goto("/onboarding");

  // Complete PROFILE_SET.
  await expect(page.getByRole("heading", { name: /your profile/i })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("textbox").first().fill("Resumer");
  await page.getByRole("button", { name: /continue/i }).click();
  await expect(page.getByRole("heading", { name: /create your organization/i })).toBeVisible();

  // Abandon, then return.
  await page.goto("/");
  await page.goto("/onboarding");

  // Resumes at the org step — profile is NOT shown again.
  await expect(page.getByRole("heading", { name: /create your organization/i })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("heading", { name: /your profile/i })).toHaveCount(0);
});
