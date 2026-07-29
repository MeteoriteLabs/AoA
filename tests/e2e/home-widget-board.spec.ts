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
    // always-present header + the "+ New" creator menu trigger (Plan 6 Task 1
    // replaced the three always-visible quick-action cards with this single
    // trigger) here; full widget content-parity and composition are covered by
    // ui/src/__tests__/Dashboard.test.tsx and HomeBoard.test.tsx.
    await expect(page.getByRole("button", { name: "Create", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible(); // greeting
  });

  // Task D4: the real RGL drag/resize smoke the Phase-0 spike mandated, plus
  // add/remove/persist. Per the plan, mouse-drag on RGL's transformed tiles is
  // flaky in Playwright, so this prefers deterministic affordances throughout:
  // tray clicks (add), the per-tile `x` (remove), and the keyboard a11y
  // handlers (Task D2 — focus a tile, Arrow to move, Shift+Arrow to resize)
  // instead of a real mouse drag.
  //
  // "Agents working now" and "Suggestions" are the two widgets used below
  // because neither ever self-hides regardless of data (AgentsNowWidget has
  // no early-return at all; SuggestionsWidget renders an "All caught up"
  // empty state instead of returning null when there are zero suggestions —
  // see ui/src/components/home/widgets/{AgentsNowWidget,SuggestionsWidget}.tsx),
  // and both are present on EVERY role's default board (MEMBER's 6 keys are a
  // subset of FOUNDER's 8 — see ui/src/components/home/defaultLayout.ts). That
  // makes this scenario deterministic no matter which role the seeded actor
  // resolves to, unlike e.g. Objectives/Action queue/My tasks/Activity feed,
  // which all self-hide on a freshly-seeded company with no goals/tasks/
  // activity (see the empty-state comment on the smoke test above).
  test("board edit mode: header link navigates, add/remove/move/resize persist across reload", async ({
    page,
    request,
  }) => {
    const company = await seedCompany(request, `E2E-HomeBoard-${Date.now()}`);
    await page.goto(`/${company.issuePrefix}/home`);

    // Step 1: not editing -> a tile's header IS a link that navigates to its
    // drill-in route (AgentsNowWidget -> "/agents"), then back to Home.
    const homeUrl = page.url();
    const agentsNowOpenLink = page.getByRole("link", { name: "Open Agents working now", exact: true });
    await expect(agentsNowOpenLink).toBeVisible({ timeout: 10_000 });
    await agentsNowOpenLink.click();
    await expect(page).toHaveURL(/\/agents(?:[/?]|$)/);
    await page.goBack();
    await expect(page).toHaveURL(homeUrl);

    // Step 2: enter edit mode -> a remove `x` and a keyboard-focusable tile
    // (role=group + tabindex=0, Task D2) appear per tile. Plan 7 Task 3: the
    // customize icon now opens a Radix dropdown instead of entering edit
    // mode directly — select "Rearrange tiles" to actually enter it. Done
    // (and every other arrange-mode affordance) now lives in the floating
    // ArrangeToolbar, not the pinned header.
    await page.getByRole("button", { name: "Customize board", exact: true }).click();
    await page.getByRole("menuitem", { name: "Rearrange tiles", exact: true }).click();
    await expect(page.getByRole("button", { name: "Done", exact: true })).toBeVisible();
    const agentsNowTile = page.getByRole("group", { name: /^Agents working now tile/ });
    await expect(agentsNowTile).toBeVisible();
    await expect(agentsNowTile).toHaveAttribute("tabindex", "0");
    const removeAgentsNow = page.getByRole("button", { name: "Remove Agents working now", exact: true });
    await expect(removeAgentsNow).toBeVisible();

    // Step 4 (remove via `x`): drops the tile from the board immediately.
    await removeAgentsNow.click();
    await expect(page.getByRole("group", { name: /^Agents working now tile/ })).toHaveCount(0);

    // Step 3 (add from the floating ArrangeToolbar's own Add-widget dropdown
    // — Plan 7 Task 3 retired HomeBoardControls' hand-rolled tray):
    // "Agents working now" is guaranteed to be offered now that it was just
    // removed, regardless of whether the seeded actor's default board was
    // the founder 8-widget set or the team_member 6-widget subset (see the
    // widget-choice note above the test).
    await page.getByRole("button", { name: "Add widget", exact: true }).click();
    const tray = page.getByRole("menu", { name: "Add widget", exact: true });
    await expect(tray).toBeVisible();
    await tray.getByRole("button", { name: "Agents working now", exact: true }).click();
    // AddWidgetMenu's rows are plain buttons, not Radix DropdownMenuItems, so
    // selecting one doesn't auto-close the surrounding (modal-by-default)
    // dropdown — close it explicitly before interacting elsewhere on the page.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("group", { name: /^Agents working now tile/ })).toBeVisible();

    // Step 5: keyboard move + resize on the (untouched) "Suggestions" tile —
    // Arrow nudges position, Shift+Arrow cycles allowed sizes. Asserted via
    // the tile's own aria-label (which encodes column/row/size — see
    // HomeBoard.tsx's `tileLabel`), never hardcoded coordinates, so this
    // doesn't depend on the seeded actor's role or default packing order.
    const suggestionsTile = page.getByRole("group", { name: /^Suggestions tile/ });
    await expect(suggestionsTile).toBeVisible();
    const initialLabel = await suggestionsTile.getAttribute("aria-label");
    expect(initialLabel).toBeTruthy();
    await suggestionsTile.focus();
    await expect(suggestionsTile).toBeFocused();

    await page.keyboard.press("ArrowRight");
    await expect(suggestionsTile).not.toHaveAttribute("aria-label", initialLabel as string);
    const movedLabel = await suggestionsTile.getAttribute("aria-label");

    await page.keyboard.press("Shift+ArrowDown");
    await expect(suggestionsTile).not.toHaveAttribute("aria-label", movedLabel as string);
    const finalLabel = await suggestionsTile.getAttribute("aria-label");
    expect(finalLabel).toBeTruthy();

    // Step 6: exit edit ("Done") flushes the dirty draft immediately (Task
    // C1) — wait for the PATCH that persists the canonical desktop (lg)
    // layout rather than a fixed sleep.
    const [patchResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/home-board-layout/me") && res.request().method() === "PATCH",
      ),
      page.getByRole("button", { name: "Done", exact: true }).click(),
    ]);
    expect(patchResponse.ok()).toBe(true);
    await expect(page.getByRole("button", { name: "Customize board", exact: true })).toBeVisible();

    // Step 7: reload -> the layout persisted. Wait for the layout GET so the
    // subsequent assertions read the persisted state rather than a
    // pre-fetch default. The re-added widget survived (present exactly once,
    // and not editing so its header is a link again), and the moved+resized
    // tile kept its exact final position/size (re-entering edit mode exposes
    // its aria-label again for a direct comparison against `finalLabel`).
    const [getResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/home-board-layout/me") && res.request().method() === "GET",
      ),
      page.reload(),
    ]);
    expect(getResponse.ok()).toBe(true);

    const reloadedAgentsNowLink = page.getByRole("link", { name: "Open Agents working now", exact: true });
    await expect(reloadedAgentsNowLink).toBeVisible({ timeout: 10_000 });
    await expect(reloadedAgentsNowLink).toHaveCount(1);

    await page.getByRole("button", { name: "Customize board", exact: true }).click();
    await page.getByRole("menuitem", { name: "Rearrange tiles", exact: true }).click();
    await expect(page.getByRole("group", { name: /^Suggestions tile/ })).toHaveAttribute(
      "aria-label",
      finalLabel as string,
    );
  });
});
