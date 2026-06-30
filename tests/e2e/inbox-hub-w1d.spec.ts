import { test, expect } from "@playwright/test";
import { cleanupTestCompanies, seedCompany } from "./helpers/seed-company";
import { seedHubItem } from "./helpers/seed-hub-item";

test.describe("Inbox Hub W1d grouping, settings, and mobile", () => {
  test.beforeEach(async ({ request }) => {
    await cleanupTestCompanies(request, /^E2E-HUB-W1D-/);
  });

  test("founder searches, groups, changes settings, and uses keyboard navigation", async ({
    page,
    request,
  }) => {
    const company = await seedCompany(request, `E2E-HUB-W1D-${Date.now()}`);

    for (let index = 1; index <= 6; index += 1) {
      await seedHubItem({
        companyId: company.id,
        semanticType: "approval_request",
        sourceType: "w1d-alpha",
        sourceId: `alpha-${index}`,
        title: index === 3 ? "W1d unique deploy approval" : `W1d alpha approval ${index}`,
      });
      await seedHubItem({
        companyId: company.id,
        semanticType: "approval_request",
        sourceType: "w1d-beta",
        sourceId: `beta-${index}`,
        title: `W1d beta approval ${index}`,
      });
    }
    await seedHubItem({
      companyId: company.id,
      semanticType: "stale_work",
      sourceType: "w1d-mobile",
      sourceId: "mobile-target",
      title: "W1d mobile stale work",
      ownerPool: "board",
    });

    await page.goto(`/${company.issuePrefix}/inbox-hub/waiting`);
    const alphaGroup = page.getByRole("button", { name: /w1d-alpha/i });
    await expect(alphaGroup).toBeVisible();
    await expect(alphaGroup).toHaveAttribute("aria-expanded", "false");

    await page.getByRole("button", { name: /hub settings/i }).click();
    await Promise.all([
      page.waitForResponse((response) =>
        response.url().includes("/hub-items/preferences/me") &&
        response.request().method() === "PATCH" &&
        response.status() === 200,
      ),
      page.getByRole("combobox", { name: /default landing/i }).selectOption("suggestions"),
    ]);
    await page.goto(`/${company.issuePrefix}/inbox-hub`);
    await expect(page).toHaveURL(new RegExp("/inbox-hub/suggestions$"));

    await page.goto(`/${company.issuePrefix}/inbox-hub/waiting`);
    await page.getByRole("searchbox", { name: /search hub/i }).fill("unique deploy");
    await expect(page.getByText("W1d unique deploy approval")).toBeVisible();
    await expect(page.getByText("W1d beta approval 1")).toBeHidden();

    await page.getByRole("searchbox", { name: /search hub/i }).fill("");
    await expect(alphaGroup).toHaveAttribute("aria-expanded", "false");
    await alphaGroup.click();
    await expect(alphaGroup).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("button", { name: /W1d alpha approval 1/i })).toBeVisible();

    await page.keyboard.press("j");
    await expect(page.getByRole("heading", { name: /W1d alpha approval 1/i })).toBeFocused();
    await page.keyboard.press("j");
    await expect(page.getByRole("heading", { name: /W1d alpha approval 2/i })).toBeFocused();
    await page.keyboard.press("k");
    await expect(page.getByRole("heading", { name: /W1d alpha approval 1/i })).toBeFocused();

    await page.getByRole("button", { name: /hub settings/i }).click();
    await Promise.all([
      page.waitForResponse((response) =>
        response.url().includes("/hub-items/preferences/me") &&
        response.request().method() === "PATCH" &&
        response.status() === 200,
      ),
      page.getByRole("checkbox", { name: "Notifications" }).uncheck(),
    ]);
    await expect(
      page.getByRole("navigation", { name: /hub lanes/i }).getByRole("button", {
        name: /notifications/i,
      }),
    ).toBeHidden();
  });

  test("mobile drawer switches lanes and the viewer can close without overlap", async ({
    page,
    request,
  }) => {
    const company = await seedCompany(request, `E2E-HUB-W1D-${Date.now()}`);
    await seedHubItem({
      companyId: company.id,
      semanticType: "stale_work",
      sourceType: "w1d-mobile",
      sourceId: "mobile-target",
      title: "W1d mobile stale work",
      ownerPool: "board",
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${company.issuePrefix}/inbox-hub/waiting`);

    await page.getByRole("button", { name: /open hub lanes/i }).click();
    const drawer = page.getByRole("dialog", { name: /hub lanes/i });
    await expect(drawer).toBeVisible();
    await drawer.getByRole("button", { name: /suggestions/i }).click();
    await expect(page).toHaveURL(new RegExp("/inbox-hub/suggestions$"));
    await expect(page.getByRole("button", { name: /W1d mobile stale work/i })).toBeVisible();

    await page.getByRole("button", { name: /W1d mobile stale work/i }).click();
    const viewer = page.getByRole("complementary", { name: /hub viewer/i });
    await expect(viewer).toBeVisible();
    const viewerBox = await viewer.boundingBox();
    expect(viewerBox?.width ?? 0).toBeGreaterThan(250);
    await page.getByRole("button", { name: /close viewer/i }).click();
    await expect(page.getByRole("button", { name: /W1d mobile stale work/i })).toBeFocused();
  });
});
