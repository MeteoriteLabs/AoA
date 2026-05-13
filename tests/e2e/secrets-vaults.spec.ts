import { expect, test } from "@playwright/test";
import { cleanupTestCompanies, seedCompany } from "./helpers/seed-company";

test.describe("secrets vaults", () => {
  test.beforeEach(async ({ request }) => {
    await cleanupTestCompanies(request);
  });

  test("creates an AWS vault and imports an external reference", async ({ page, request }) => {
    const company = await seedCompany(request, `E2E-Test-Secrets-${Date.now()}`);

    await page.goto(`/${company.issuePrefix}/secrets`);
    await expect(page.getByRole("heading", { name: "Secrets" })).toBeVisible();

    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText("Production AWS").first()).toBeVisible();

    await page.getByRole("button", { name: /^import$/i }).click();
    await page.getByRole("button", { name: /^preview$/i }).click();
    const row = page.getByRole("row").filter({ hasText: "OPENAI_API_KEY" });
    await expect(row).toBeVisible();
    await row.getByRole("checkbox").click();
    await page.getByRole("button", { name: /^import$/i }).last().click();

    await expect(page.getByText("imported")).toBeVisible();
    await page.getByRole("button", { name: /^done$/i }).click();
    await expect(page.getByText("OPENAI_API_KEY").first()).toBeVisible();
    await expect(page.getByText("External reference").first()).toBeVisible();
  });
});
