import { test, expect } from "@playwright/test";
import { cleanupTestCompanies, seedCompany } from "./helpers/seed-company";

test.describe("Human profile page", () => {
  test.beforeEach(async ({ request }) => {
    await cleanupTestCompanies(request, /^E2E-Humans-/);
  });

  test("renders profile fields, overview dashboard, and profile edit modal", async ({ page, request }) => {
    const company = await seedCompany(request, `E2E-Humans-${Date.now()}`);

    const teamRes = await request.get(`/api/companies/${company.id}/team`);
    expect(teamRes.ok()).toBe(true);
    const team = (await teamRes.json()) as {
      currentUser: { userId: string };
    };
    const userId = team.currentUser.userId;

    const profileRes = await request.patch(`/api/companies/${company.id}/team/users/${userId}/profile`, {
      data: {
        displayName: "E2E Human",
        title: "Founder Operator",
        bio: "Owns human-agent operating cadence.",
        location: "Remote",
        timezone: "UTC",
        socialLinks: [{ type: "website", label: "Website", url: "https://example.com" }],
      },
    });
    expect(profileRes.ok()).toBe(true);

    await page.goto(`/${company.issuePrefix}/team/${userId}`);
    const main = page.locator("#main-content");

    await expect(main.getByRole("heading", { name: "E2E Human" })).toBeVisible({ timeout: 10_000 });
    await expect(main.getByText("Founder Operator")).toBeVisible();
    await expect(main.getByText("Owns human-agent operating cadence.")).toBeVisible();
    await expect(main.getByText("Remote")).toBeVisible();
    await expect(main.getByText("UTC")).toBeVisible();
    await expect(main.getByRole("link", { name: "Website" })).toHaveAttribute("href", "https://example.com");
    await expect(main.getByText("Authority")).toBeVisible();
    await expect(main.getByText("Assigned Tasks").first()).toBeVisible();
    await expect(main.getByText("Created Tasks").first()).toBeVisible();
    await expect(main.getByText("Activity")).toBeVisible();

    await page.goto(`/${company.issuePrefix}/team/${userId}/settings`);
    await expect(main.getByText("Role & Department")).toBeVisible({ timeout: 10_000 });
    await expect(main.getByRole("region", { name: "Profile" })).toHaveCount(0);

    await page.getByRole("button", { name: "Edit profile" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit Profile" });
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByLabel("Display name")).toHaveValue("E2E Human");
    await expect(dialog.getByLabel("Title")).toHaveValue("Founder Operator");
    await expect(dialog.getByLabel("Location")).toHaveValue("Remote");
    await expect(dialog.getByLabel("Timezone")).toHaveValue("UTC");

    await dialog.getByLabel("Display name").fill("E2E Human Updated");
    await dialog.getByLabel("Title").selectOption("Founder Partner");
    await dialog.getByLabel("Timezone").selectOption("Asia/Kolkata");
    await dialog.getByRole("button", { name: "Save Profile" }).click();

    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(main.getByRole("heading", { name: "E2E Human Updated" })).toBeVisible();
    await expect(main.getByText("Founder Partner")).toBeVisible();
    await expect(main.getByText("Asia/Kolkata")).toBeVisible();
  });
});
