import { test, expect } from "@playwright/test";
import { cleanupTestCompanies, seedCompany } from "./helpers/seed-company";

test.describe("Commander viewer geometry persistence", () => {
  test.beforeEach(async ({ request }) => {
    await cleanupTestCompanies(request, /^E2E-CmdGeom-/);
  });

  test("collapse + width persist across reload (global, per-user)", async ({ page, request }) => {
    const company = await seedCompany(request, `E2E-CmdGeom-${Date.now()}`);
    await page.goto(`/${company.issuePrefix}/commander`);

    // Default = collapsed rail.
    await expect(page.getByTestId("commander-viewer-rail")).toBeVisible({ timeout: 20_000 });

    // Expand via the rail; the detail card appears and the resize handle is present.
    await page.getByRole("button", { name: "Viewer home" }).click();
    await expect(page.getByTestId("commander-viewer-panel")).toBeVisible();
    await expect(page.locator("[data-separator]")).toBeVisible();

    // Capture the DEFAULT width first, then drag the handle LEFT to widen the detail panel.
    const panel = page.getByTestId("commander-viewer-panel");
    const widthAtDefault = await panel.evaluate((el) => el.clientWidth);
    const handle = page.locator("[data-separator]");
    const box = await handle.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x - 160, box.y + box.height / 2, { steps: 12 });
      await page.mouse.up();
    }
    const widthBefore = await panel.evaluate((el) => el.clientWidth);
    // The drag MUST have materially widened the panel — otherwise the persistence
    // assertion below could pass trivially against an unchanged default width
    // (silent no-op if the handle wasn't hit or the move clamped to ~0).
    expect(widthBefore).toBeGreaterThan(widthAtDefault + 40);

    // Reload: expanded state + width restored from localStorage.
    await page.reload();
    await expect(panel).toBeVisible({ timeout: 20_000 });
    const widthAfter = await panel.evaluate((el) => el.clientWidth);
    expect(Math.abs(widthAfter - widthBefore)).toBeLessThanOrEqual(8); // within a px or two

    // Collapse persists too.
    await page.getByRole("button", { name: "Close viewer" }).click();
    await expect(page.getByTestId("commander-viewer-rail")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("commander-viewer-rail")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("commander-viewer-panel")).toHaveCount(0);
  });
});
