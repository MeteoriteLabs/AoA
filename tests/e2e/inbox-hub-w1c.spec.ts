import { test, expect, type APIRequestContext } from "@playwright/test";
import { cleanupTestCompanies, seedCompany } from "./helpers/seed-company";
import { seedHubItem } from "./helpers/seed-hub-item";

type SeededHubItem = Awaited<ReturnType<typeof seedHubItem>>;

async function act(
  request: APIRequestContext,
  companyId: string,
  item: Pick<SeededHubItem, "id" | "version">,
  action: "resolve" | "archive" | "claim" | "release",
) {
  const res = await request.post(`/api/companies/${companyId}/hub-items/${item.id}/action`, {
    data: { action, expectedVersion: item.version },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as { item: SeededHubItem; auditId: string };
}

test.describe("Inbox Hub W1c lifecycle", () => {
  test.beforeEach(async ({ request }) => {
    await cleanupTestCompanies(request, /^E2E-HUB-W1C-/);
  });

  test("operator can triage, undo, claim/release, and inspect history audit", async ({
    page,
    request,
  }) => {
    const company = await seedCompany(request, `E2E-HUB-W1C-${Date.now()}`);

    await seedHubItem({
      companyId: company.id,
      semanticType: "approval_request",
      sourceType: "w1c",
      sourceId: "read-toggle",
      title: "Read toggle approval",
    });
    await seedHubItem({
      companyId: company.id,
      semanticType: "approval_request",
      sourceType: "w1c",
      sourceId: "snooze",
      title: "Snooze deployment approval",
    });
    await seedHubItem({
      companyId: company.id,
      semanticType: "approval_request",
      sourceType: "w1c",
      sourceId: "dismiss",
      title: "Dismiss noisy approval",
    });
    await seedHubItem({
      companyId: company.id,
      semanticType: "approval_request",
      sourceType: "w1c",
      sourceId: "resolve",
      title: "Resolve launch approval",
    });
    const historySeed = await seedHubItem({
      companyId: company.id,
      semanticType: "approval_request",
      sourceType: "w1c",
      sourceId: "history",
      title: "Resolved history approval",
    });
    await act(request, company.id, historySeed, "resolve");
    const claimSeed = await seedHubItem({
      companyId: company.id,
      semanticType: "stale_work",
      sourceType: "w1c",
      sourceId: "claim",
      title: "Claim board-pool stale work",
      ownerPool: "board",
    });

    await page.goto(`/${company.issuePrefix}/inbox-hub/waiting`);
    await expect(page.getByText("Read toggle approval")).toBeVisible();

    await page.getByRole("button", { name: /Read toggle approval/i }).click();
    await expect(page.getByRole("button", { name: /mark unread/i })).toBeVisible();
    await page.getByRole("button", { name: /mark unread/i }).click();
    await expect(page.getByRole("button", { name: /mark unread/i })).toBeHidden();

    await page.getByRole("button", { name: /Snooze deployment approval/i }).click();
    await page.getByRole("button", { name: /^snooze$/i }).click();
    await expect(page.getByRole("button", { name: /^Snooze deployment approval$/i })).toBeHidden();

    await page.getByRole("button", { name: /Dismiss noisy approval/i }).click();
    await page.getByRole("button", { name: /^dismiss$/i }).click();
    await expect(page.getByRole("button", { name: /^Dismiss noisy approval$/i })).toBeHidden();

    await page.getByRole("button", { name: /Resolve launch approval/i }).click();
    await page.getByRole("button", { name: /^resolve$/i }).click();
    await expect(page.getByRole("button", { name: /undo resolve/i })).toBeVisible();
    await page.getByRole("button", { name: /undo resolve/i }).click();
    await expect(page.getByRole("button", { name: /^Resolve launch approval$/i })).toBeVisible();

    await page.goto(`/${company.issuePrefix}/inbox-hub/suggestions/${claimSeed.id}`);
    await expect(page.getByRole("button", { name: /^claim$/i })).toBeVisible();
    await page.getByRole("button", { name: /^claim$/i }).click();
    await expect(page.getByRole("button", { name: /^release$/i })).toBeVisible();
    await page.getByRole("button", { name: /^release$/i }).click();
    await expect(page.getByRole("button", { name: /^claim$/i })).toBeVisible();

    await page.goto(`/${company.issuePrefix}/inbox-hub/waiting`);
    await page.getByRole("button", { name: /^resolved$/i }).click();
    await expect(page.getByText("Resolved history approval")).toBeVisible();
    await page.getByRole("button", { name: /Resolved history approval/i }).click();
    await expect(page.getByRole("region", { name: /audit timeline/i })).toContainText(/resolve/i);
  });

  test("bulk archive reports partial stale-version failure", async ({ page, request }) => {
    const company = await seedCompany(request, `E2E-HUB-W1C-${Date.now()}`);
    await seedHubItem({
      companyId: company.id,
      semanticType: "stale_work",
      sourceType: "w1c",
      sourceId: "bulk-fresh",
      title: "Bulk fresh stale work",
      ownerPool: "board",
    });
    const changed = await seedHubItem({
      companyId: company.id,
      semanticType: "stale_work",
      sourceType: "w1c",
      sourceId: "bulk-changed",
      title: "Bulk changed stale work",
      ownerPool: "board",
    });

    await page.goto(`/${company.issuePrefix}/inbox-hub/suggestions`);
    await page.getByRole("checkbox", { name: /select bulk fresh stale work/i }).check();
    await page.getByRole("checkbox", { name: /select bulk changed stale work/i }).check();

    await act(request, company.id, changed, "claim");

    await page.getByRole("button", { name: /archive selected/i }).click();
    await expect(page.locator('[role="status"]').filter({ hasText: /1 succeeded, 1 failed/i })).toBeVisible();
    await expect(page.getByText("Bulk changed stale work")).toBeVisible();
  });
});
