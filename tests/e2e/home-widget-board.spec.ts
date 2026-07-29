import { test, expect } from "@playwright/test";
import { cleanupTestCompanies, seedCompany } from "./helpers/seed-company";

test.describe("home widget board", () => {
  test.beforeEach(async ({ request }) => {
    await cleanupTestCompanies(request, /^E2E-HomeBoard-/);
  });

  test("Home renders header + quick actions after the widget refactor", async ({ page, request }) => {
    const company = await seedCompany(request, `E2E-HomeBoard-${Date.now()}`);
    await page.goto(`/${company.issuePrefix}/home`);

    // A freshly-seeded company has no goals/activity, so those widgets self-hide,
    // and Suggestions shows its "All caught up" empty state. We assert the
    // always-present header + quick actions here; full widget content-parity and
    // composition are covered by ui/src/__tests__/Dashboard.test.tsx and HomeBoard.test.tsx.
    await expect(page.getByText("+ New Task")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible(); // greeting
  });
});
