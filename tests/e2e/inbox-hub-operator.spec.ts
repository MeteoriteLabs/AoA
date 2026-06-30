import { test, expect } from "@playwright/test";
import { cleanupTestCompanies, seedCompany } from "./helpers/seed-company";
import { seedHubItem } from "./helpers/seed-hub-item";

test.describe("Inbox Hub final operator flow", () => {
  test.beforeEach(async ({ request }) => {
    await cleanupTestCompanies(request, /^E2E-HUB-OP-/);
  });

  test("founder clears the Inbox Hub operator flow", async ({ page, request }) => {
    const company = await seedCompany(request, `E2E-HUB-OP-${Date.now()}`);
    const approvalRes = await request.post(`/api/companies/${company.id}/approvals`, {
      data: {
        type: "hire_agent",
        payload: { name: "Operator Scout" },
        issueIds: [],
      },
    });
    expect(approvalRes.ok(), await approvalRes.text()).toBeTruthy();
    const approval = (await approvalRes.json()) as { id: string };

    await page.goto(`/${company.issuePrefix}/inbox`);
    await expect(page.getByText(/Autopilot/i)).toBeVisible();
    await page.getByRole("navigation", { name: /hub lanes/i })
      .getByRole("button", { name: /waiting on you/i })
      .click();
    await expect(page.getByText(/Review hire agent approval/i)).toBeVisible();

    await page.getByRole("button", { name: /Review hire agent approval/i }).click();
    await expect(page.getByRole("complementary", { name: /hub viewer/i })).toBeVisible();
    await page.getByRole("link", { name: /open full/i }).click();
    await expect(page).toHaveURL(new RegExp(`/approvals/${approval.id}`));

    await page.goBack();
    await expect(page.getByRole("complementary", { name: /hub viewer/i })).toBeVisible();
    await page.getByRole("button", { name: /^resolve$/i }).click();
    await expect(page.getByRole("button", { name: /undo resolve/i })).toBeVisible();
    await page.getByRole("button", { name: /undo resolve/i }).click();
    await expect(page.getByRole("button", { name: /^resolve$/i })).toBeVisible();

    await page.getByRole("button", { name: /^archive$/i }).click();
    await page.getByRole("button", { name: /^archived$/i }).click();
    await expect(page.getByText(/Review hire agent approval/i)).toBeVisible();
  });

  test("approval canonical routes remain available", async ({ page, request }) => {
    const company = await seedCompany(request, `E2E-HUB-OP-${Date.now()}`);
    const approvalRes = await request.post(`/api/companies/${company.id}/approvals`, {
      data: {
        type: "hire_agent",
        payload: { name: "Route Scout" },
        issueIds: [],
      },
    });
    expect(approvalRes.ok(), await approvalRes.text()).toBeTruthy();
    const approval = (await approvalRes.json()) as { id: string };

    await page.goto(`/${company.issuePrefix}/approvals/pending`);
    await expect(page.getByRole("heading", { name: /Approvals/i })).toBeVisible();
    await page.goto(`/${company.issuePrefix}/approvals/all`);
    await expect(page.getByRole("heading", { name: /Approvals/i })).toBeVisible();
    await page.goto(`/${company.issuePrefix}/approvals/${approval.id}`);
    await expect(page).toHaveURL(new RegExp(`/${company.issuePrefix}/approvals/${approval.id}`));
  });

  test("mobile Inbox Hub navigation has no overlap", async ({ page, request }) => {
    const company = await seedCompany(request, `E2E-HUB-OP-${Date.now()}`);
    await seedHubItem({
      companyId: company.id,
      semanticType: "run_failed",
      sourceType: "operator-mobile",
      sourceId: "notification-1",
      title: "Mobile failed run notification",
      ownerPool: "board",
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${company.issuePrefix}/inbox`);
    await page.getByRole("button", { name: /open hub lanes/i }).click();
    const drawer = page.getByRole("dialog", { name: /hub lanes/i });
    await expect(drawer).toBeVisible();
    await drawer.getByRole("button", { name: /notifications/i }).click();
    await expect(page.getByRole("button", { name: /Mobile failed run notification/i })).toBeVisible();

    await page.getByRole("button", { name: /Mobile failed run notification/i }).click();
    const viewer = page.getByRole("complementary", { name: /hub viewer/i });
    await expect(viewer).toBeVisible();
    const box = await viewer.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(250);
    await expect(page.getByRole("button", { name: /close viewer/i })).toBeVisible();
  });
});
