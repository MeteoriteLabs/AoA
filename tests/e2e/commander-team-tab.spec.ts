import { test, expect, type APIRequestContext } from "@playwright/test";
import { cleanupTestCompanies, seedCompany } from "./helpers/seed-company";

/**
 * E2E smoke test — Commander Team tab sub-tab navigation.
 *
 * Validates that the three sub-tabs (Roster, Kanban, Governance) load without
 * error and switch correctly. No agents are needed to confirm the sub-tab bar
 * is rendered; the empty-state path tests that too.
 *
 * Tests that require a populated sub-tab seed one AoA agent via the API.
 */

async function seedAoaAgent(request: APIRequestContext, companyId: string) {
  const res = await request.post(`/api/companies/${companyId}/agents`, {
    data: {
      name: "E2E Commander Agent",
      role: "general",
      title: "E2E Commander Agent",
      kind: "aoa",
      adapterType: "process",
      runtimeConfig: { aoa: { role: "lead" } },
    },
  });
  if (!res.ok()) {
    const body = await res.text().catch(() => "(no body)");
    throw new Error(`seedAoaAgent failed: ${res.status()} ${body}`);
  }
  return res.json();
}

test.describe("Commander Team tab", () => {
  test.beforeEach(async ({ request }) => {
    await cleanupTestCompanies(request, /^E2E-Commander-/);
  });

  test("empty state shown when no AoA agents", async ({ page, request }) => {
    const company = await seedCompany(request, `E2E-Commander-Empty-${Date.now()}`);
    await page.goto(`/${company.issuePrefix}/team?tab=commander`);

    await expect(page.getByText("No AoA agents yet")).toBeVisible({ timeout: 10_000 });
  });

  test("Roster/Kanban/Governance sub-tabs render without error", async ({ page, request }) => {
    const company = await seedCompany(request, `E2E-Commander-Tabs-${Date.now()}`);
    await seedAoaAgent(request, company.id);

    await page.goto(`/${company.issuePrefix}/team?tab=commander`);

    // Sub-tab bar should be visible
    await expect(page.getByTestId("commander-subtab-roster")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("commander-subtab-kanban")).toBeVisible();
    await expect(page.getByTestId("commander-subtab-governance")).toBeVisible();

    // Roster (default) — agent name should appear
    await expect(page.getByText("E2E Commander Agent")).toBeVisible({ timeout: 5_000 });

    // Switch to Kanban — column headers should appear
    await page.getByTestId("commander-subtab-kanban").click();
    await expect(page.getByText("Idle")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Running")).toBeVisible({ timeout: 5_000 });

    // Switch to Governance — Avg trust metric should appear
    await page.getByTestId("commander-subtab-governance").click();
    await expect(page.getByText("Avg trust")).toBeVisible({ timeout: 5_000 });

    // Switch back to Roster
    await page.getByTestId("commander-subtab-roster").click();
    await expect(page.getByText("E2E Commander Agent")).toBeVisible({ timeout: 5_000 });
  });

  test("Governance tab shows oversight table for AoA agents", async ({ page, request }) => {
    const company = await seedCompany(request, `E2E-Commander-Gov-${Date.now()}`);
    await seedAoaAgent(request, company.id);

    await page.goto(`/${company.issuePrefix}/team?tab=commander`);

    await expect(page.getByTestId("commander-subtab-governance")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("commander-subtab-governance").click();

    // Oversight table columns
    await expect(page.getByText("Avg trust")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Monthly spend")).toBeVisible({ timeout: 5_000 });

    // Agent row appears in the oversight table
    await expect(page.getByText("E2E Commander Agent")).toBeVisible({ timeout: 5_000 });
  });
});
