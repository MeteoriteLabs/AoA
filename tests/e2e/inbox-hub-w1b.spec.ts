import { test, expect } from "@playwright/test";
import { cleanupTestCompanies, seedCompany } from "./helpers/seed-company";
import { seedHubItem } from "./helpers/seed-hub-item";

test.describe("Inbox Hub W1b preview", () => {
  test.beforeEach(async ({ request }) => {
    await cleanupTestCompanies(request, /^E2E-HUB-/);
  });

  test("founder opens hub preview, switches lanes, opens item, deep-links it, and opens full approval detail", async ({
    page,
    request,
  }) => {
    const company = await seedCompany(request, `E2E-HUB-${Date.now()}`);

    const approvalRes = await request.post(`/api/companies/${company.id}/approvals`, {
      data: {
        type: "hire_agent",
        payload: { name: "Scout" },
        issueIds: [],
      },
    });
    expect(approvalRes.ok(), await approvalRes.text()).toBeTruthy();
    const approval = (await approvalRes.json()) as { id: string };

    await page.goto(`/${company.issuePrefix}/inbox-hub`);
    await expect(page.getByRole("navigation", { name: /hub lanes/i })).toBeVisible();
    await page.getByRole("button", { name: /waiting on you/i }).click();
    await expect(page.getByText(/Review hire agent approval/i)).toBeVisible();

    await page.getByRole("button", { name: /Review hire agent approval/i }).click();
    await expect(page.getByRole("complementary", { name: /hub viewer/i })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/inbox-hub/waiting/.+`));

    const selectedUrl = page.url();
    await page.goto(selectedUrl);
    await expect(page.getByRole("complementary", { name: /hub viewer/i })).toBeVisible();
    await page.getByRole("link", { name: /open full/i }).click();
    await expect(page).toHaveURL(new RegExp(`/approvals/${approval.id}`));
  });

  test("preview route exposes notifications and suggestions lanes without replacing legacy Inbox", async ({
    page,
    request,
  }) => {
    const company = await seedCompany(request, `E2E-HUB-${Date.now()}`);

    await seedHubItem({
      companyId: company.id,
      semanticType: "agent_error",
      sourceType: "test_notification",
      sourceId: "n-1",
      title: "Agent failed to finish run",
      ownerPool: "board",
    });
    await seedHubItem({
      companyId: company.id,
      semanticType: "suggestion",
      sourceType: "test_suggestion",
      sourceId: "s-1",
      title: "Review stale project risk",
      ownerPool: "board",
    });

    await page.goto(`/${company.issuePrefix}/inbox-hub/notifications`);
    await expect(page.getByText("Agent failed to finish run")).toBeVisible();

    await page.getByRole("button", { name: /suggestions/i }).click();
    await expect(page).toHaveURL(new RegExp(`/inbox-hub/suggestions`));
    await expect(page.getByText("Review stale project risk")).toBeVisible();

    await page.goto(`/${company.issuePrefix}/inbox/new`);
    await expect(page).not.toHaveURL(new RegExp(`/inbox-hub`));
  });
});
