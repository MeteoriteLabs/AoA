import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { cleanupTestCompanies, seedCompany } from "./helpers/seed-company";
import { seedHubItem } from "./helpers/seed-hub-item";
import {
  ensureLocalBoardUser,
  seedNotificationDigestItem,
} from "./helpers/seed-notification-digest";

type DeliveryMode = "realtime" | "digest" | "silent";

test.describe("Inbox Hub realtime notifications", () => {
  test.beforeEach(async ({ request }) => {
    await cleanupTestCompanies(request, /^E2E-HUB-W2L3-/);
  });

  test("operator sees realtime toasts, digest suppression, silent suppression, and quiet-hours fallback", async ({
    page,
    request,
  }) => {
    const company = await seedCompany(request, `E2E-HUB-W2L3-${Date.now()}`);
    await ensureLocalBoardUser();

    await page.goto(`/${company.issuePrefix}/inbox/waiting`);
    await expect(page.getByRole("navigation", { name: /hub lanes/i })).toBeVisible();

    await updateNotificationPreferences(request, company.id, {
      deliveryMode: "realtime",
      quietHours: { enabled: false, start: "18:00", end: "09:00", timezone: "UTC" },
    });

    const realtime = await seedRealtimeHubItem(company.id, {
      sourceId: "realtime",
      title: "W2 realtime approval toast",
    });
    await publishHubItemChange(request, company.id, realtime);
    await expect(page.getByRole("button", { name: /W2 realtime approval toast/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(toast(page, "W2 realtime approval toast")).toBeVisible();
    await dismissToasts(page);

    await openNotificationPreferences(page);
    await page.getByLabel(/approval request delivery/i).selectOption("digest");
    await expect(page.getByLabel(/approval request delivery/i)).toHaveValue("digest");

    const digest = await seedRealtimeHubItem(company.id, {
      sourceId: "digest",
      title: "W2 digest approval summary",
    });
    await seedNotificationDigestItem({
      companyId: company.id,
      hubItemId: digest.id,
      semanticType: "approval_request",
    });
    await publishHubItemChange(request, company.id, digest);

    await expect(page.getByRole("button", { name: /W2 digest approval summary/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(toast(page, "W2 digest approval summary")).toHaveCount(0);
    await expect(page.getByText("W2 digest approval summary")).toHaveCount(2);

    await page.getByLabel(/approval request delivery/i).selectOption("silent");
    await expect(page.getByLabel(/approval request delivery/i)).toHaveValue("silent");

    const silent = await seedRealtimeHubItem(company.id, {
      sourceId: "silent",
      title: "W2 silent approval hidden",
    });
    await publishHubItemChange(request, company.id, silent);

    await expect(page.getByRole("button", { name: /W2 silent approval hidden/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(toast(page, "W2 silent approval hidden")).toHaveCount(0);
    await expect(page.getByText("W2 silent approval hidden")).toHaveCount(1);

    await page.getByLabel(/approval request delivery/i).selectOption("realtime");
    await page.getByRole("checkbox", { name: /quiet hours/i }).check();
    await page.getByLabel(/quiet hours start/i).fill("00:00");
    await page.getByLabel(/quiet hours end/i).fill("00:00");
    await expect(page.getByLabel(/approval request delivery/i)).toHaveValue("realtime");

    const quiet = await seedRealtimeHubItem(company.id, {
      sourceId: "quiet-hours",
      title: "W2 quiet hours digest fallback",
    });
    await seedNotificationDigestItem({
      companyId: company.id,
      hubItemId: quiet.id,
      semanticType: "approval_request",
    });
    await publishHubItemChange(request, company.id, quiet);

    await expect(page.getByRole("button", { name: /W2 quiet hours digest fallback/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(toast(page, "W2 quiet hours digest fallback")).toHaveCount(0);
    await expect(page.getByText("W2 quiet hours digest fallback")).toHaveCount(2);

    expect(realtime.id).toBeTruthy();
  });
});

async function updateNotificationPreferences(
  request: APIRequestContext,
  companyId: string,
  options: {
    deliveryMode: DeliveryMode;
    quietHours: { enabled: boolean; start: string; end: string; timezone: string };
  },
) {
  const res = await request.patch(
    `/api/companies/${companyId}/notifications/preferences/me`,
    {
      data: {
        rules: [
          {
            semanticType: "approval_request",
            deliveryMode: options.deliveryMode,
            toastEnabled: true,
          },
        ],
        quietHours: options.quietHours,
        digest: { enabled: true, cadence: "daily" },
      },
    },
  );
  expect(res.ok(), await res.text()).toBeTruthy();
}

async function seedRealtimeHubItem(
  companyId: string,
  input: { sourceId: string; title: string },
) {
  return seedHubItem({
    companyId,
    semanticType: "approval_request",
    sourceType: `w2-layer3-e2e-${input.sourceId}`,
    sourceId: input.sourceId,
    title: input.title,
    ownerPool: "board",
  });
}

async function publishHubItemChange(
  request: APIRequestContext,
  companyId: string,
  item: Awaited<ReturnType<typeof seedHubItem>>,
) {
  const res = await request.post(`/api/companies/${companyId}/hub-items/${item.id}/action`, {
    data: { action: "claim", expectedVersion: item.version },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

async function openNotificationPreferences(page: Page) {
  const settings = page.getByRole("button", { name: /hub settings/i });
  await settings.click();
  const notifications = page.getByRole("button", { name: /notification preferences/i });
  await notifications.click();
  await expect(page.getByRole("heading", { name: /notification preferences/i })).toBeVisible();
}

function toast(page: Page, title: string) {
  return page.locator('[role="status"]').filter({ hasText: title });
}

async function dismissToasts(page: Page) {
  const buttons = page.getByRole("button", { name: /dismiss notification/i });
  while ((await buttons.count()) > 0) {
    await buttons.first().click();
  }
}
