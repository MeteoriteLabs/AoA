import { test, expect } from "@playwright/test";

/**
 * E2E: Planning mode dispatch gate (SKIP_LLM mode).
 *
 * AoA's Planning mode tasks are not dispatched to the heartbeat system
 * on creation. They are added to the board in "todo" status, awaiting
 * explicit user action (e.g., "Start working" → transitions to "in_progress").
 *
 * This smoke validates:
 * 1. Creating a task with "Planning" work mode shows the Planning pill
 * 2. Planning-mode task does NOT trigger an automatic heartbeat run
 *    (status remains "todo" instead of auto-advancing to "in_progress")
 *
 * The second test is LLM-dependent because it must wait for a heartbeat
 * that should NOT occur. Set AOA_E2E_SKIP_LLM=false to enable this assertion
 * (requires ANTHROPIC_API_KEY and a running heartbeat system).
 */

const SKIP_LLM = process.env.AOA_E2E_SKIP_LLM !== "false";

test.describe("planning mode dispatch gate", () => {
  test("creating a planning-mode task shows Planning pill", async ({ page }) => {
    // Navigate to the home page (assumes a company exists).
    await page.goto("/");

    // Wait for the page to load by checking for common home elements.
    // Typically a "New Task" button or the main board.
    await expect(page).toHaveTitle(/\w+/);

    // Open the task creation dialog. The exact selector depends on current UI;
    // common patterns: button with "new task" or "create task" text, or a + icon.
    const newTaskButton = page
      .getByRole("button")
      .filter({ hasText: /new task|create task|\+/i })
      .first();
    await expect(newTaskButton).toBeVisible({ timeout: 5_000 });
    await newTaskButton.click();

    // Fill in the task title. Look for a placeholder or label matching "title", "task name", etc.
    const titleInput = page
      .locator('input[placeholder*="title" i], input[placeholder*="task" i]')
      .first();
    await expect(titleInput).toBeVisible({ timeout: 5_000 });
    await titleInput.fill("Planning review: architecture");

    // Set the work mode to "Planning". This assumes a "Work mode" or "Mode" selector
    // that shows options like "Standard" and "Planning".
    const modeButton = page
      .getByRole("button")
      .filter({ hasText: /standard|mode|work/i })
      .first();
    await expect(modeButton).toBeVisible({ timeout: 5_000 });
    await modeButton.click();

    // Click the "Planning" option from the dropdown.
    const planningOption = page.getByRole("option", { name: /planning/i });
    await expect(planningOption).toBeVisible({ timeout: 5_000 });
    await planningOption.click();

    // Submit the task creation dialog by clicking "Create" or "Save".
    const createButton = page.getByRole("button", { name: /create|save/i }).last();
    await expect(createButton).toBeVisible({ timeout: 5_000 });
    await createButton.click();

    // Verify the task appears on the board with the title.
    const taskTitle = page.getByText("Planning review: architecture");
    await expect(taskTitle).toBeVisible({ timeout: 5_000 });

    // Verify the "Planning" pill is visible (indicating the work mode was set).
    // This may be rendered as a badge, chip, or label near the task title.
    const planningPill = page
      .locator("text=Planning")
      .filter({ hasText: /planning/i });
    await expect(planningPill.first()).toBeVisible({ timeout: 5_000 });
  });

  test("planning-mode task does not trigger a heartbeat run", async ({ page }) => {
    test.skip(SKIP_LLM, "skipped unless AOA_E2E_SKIP_LLM=false");

    // Navigate to the home page.
    await page.goto("/");

    // Verify the task created in the previous test is still visible.
    // This assumes test isolation or a persistent task across tests.
    const taskTitle = page.getByText("Planning review: architecture");
    await expect(taskTitle).toBeVisible({ timeout: 5_000 });

    // Locate the task row and check its status is "todo" (not "in_progress").
    // The status may be shown as a badge, label, or column in a list/board view.
    const taskRow = page
      .locator("text=Planning review: architecture")
      .locator("..")
      .locator("..");
    const statusElement = taskRow.locator("text=todo");
    await expect(statusElement).toBeVisible({ timeout: 5_000 });

    // Wait briefly to ensure no heartbeat dispatch was triggered.
    // If a heartbeat run occurred, the task would transition to "in_progress".
    // This sleep is a simple heuristic; in production, monitor the heartbeat
    // run event log or query the task history.
    await page.waitForTimeout(2000);

    // Re-check the status — it should still be "todo".
    await expect(statusElement).toBeVisible({ timeout: 5_000 });
  });
});

// Keep the SKIP_LLM branch referenced so future specs can gate heartbeat
// assertions off it without re-introducing the import.
void SKIP_LLM;
