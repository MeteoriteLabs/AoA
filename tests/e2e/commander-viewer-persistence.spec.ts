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
    await expect(page.getByTestId("commander-resizable-handle")).toBeVisible();

    // Drag the handle to widen the detail panel.
    const handle = page.getByTestId("commander-resizable-handle");
    const box = await handle.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x - 160, box.y + box.height / 2, { steps: 12 });
      await page.mouse.up();
    }
    const widthBefore = await page.getByTestId("commander-viewer-panel").evaluate((el) => el.clientWidth);

    // Reload: expanded state + width restored from localStorage.
    await page.reload();
    await expect(page.getByTestId("commander-viewer-panel")).toBeVisible({ timeout: 20_000 });
    const widthAfter = await page.getByTestId("commander-viewer-panel").evaluate((el) => el.clientWidth);
    expect(Math.abs(widthAfter - widthBefore)).toBeLessThanOrEqual(8); // within a px or two

    // Collapse persists too.
    await page.getByRole("button", { name: "Close viewer" }).click();
    await expect(page.getByTestId("commander-viewer-rail")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("commander-viewer-rail")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("commander-viewer-panel")).toHaveCount(0);
  });
});
