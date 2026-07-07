import { test, expect } from "@playwright/test";
import { cleanupTestCompanies, seedCompany } from "./helpers/seed-company";

test.describe("Human profile page", () => {
  test.beforeEach(async ({ request }) => {
    await cleanupTestCompanies(request, /^E2E-Humans-/);
  });

  test("renders profile fields, overview dashboard, and settings form", async ({ page, request }) => {
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

    await expect(page.getByRole("heading", { name: "E2E Human" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Founder Operator")).toBeVisible();
    await expect(page.getByText("Owns human-agent operating cadence.")).toBeVisible();
    await expect(page.getByText("Remote")).toBeVisible();
    await expect(page.getByText("UTC")).toBeVisible();
    await expect(page.getByRole("link", { name: "Website" })).toHaveAttribute("href", "https://example.com");
    await expect(page.getByText("Authority")).toBeVisible();
    await expect(page.getByText("Assigned Tasks").first()).toBeVisible();
    await expect(page.getByText("Created Tasks").first()).toBeVisible();
    await expect(page.getByText("Activity")).toBeVisible();

    await page.getByRole("button", { name: /edit/i }).click();
    await expect(page.getByRole("region", { name: "Profile" })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByLabel("Display name")).toHaveValue("E2E Human");
    await expect(page.getByLabel("Title")).toHaveValue("Founder Operator");
    await expect(page.getByLabel("Location")).toHaveValue("Remote");
    await expect(page.getByLabel("Timezone")).toHaveValue("UTC");
  });
});
