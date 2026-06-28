import { test, expect } from "@playwright/test";
import {
  cleanupTestCompanies,
  seedCompanyViaWizard,
} from "./helpers/seed-company";

/**
 * E2E: Phase 1 thread pipeline — onboarding → first thread → entry.
 *
 * Drives the 8-step OnboardingWizard end-to-end:
 *   Step 1 — Name your company
 *   Step 2 — Set up workspace root
 *   Step 3 — Choose your Commander (provider + model)
 *   Step 4 — Choose your Crew      (provider + model; this is the step that
 *                                   actually POSTs /companies)
 *   Steps 5–8 are not driven here because Step 5 requires a real local
 *   adapter CLI (claude_local / codex_local etc.) to pass the adapter
 *   environment test, which is not a safe assumption for every CI runner.
 *   Once the company is created (after Step 4) the test bails out of the
 *   wizard, navigates manually to /{prefix}/discussions, and exercises the
 *   thread-creation + entry-posting surface.
 *
 * The "Adjutant responds" leg of the pipeline is intentionally NOT asserted.
 * That requires either:
 *   (a) AOA_E2E_SKIP_LLM=false plus a real ANTHROPIC_API_KEY, or
 *   (b) Playwright route-mocking against an in-browser LLM call.
 * Neither is feasible here because the LLM round-trip happens inside the
 * Adjutant subprocess (not in the browser fetch layer), so page.route() can't
 * intercept it. Documented gap — see "LLM gap" comment below.
 */

const SKIP_LLM = process.env.AOA_E2E_SKIP_LLM !== "false";

test.describe("Onboarding → first thread → entry", () => {
  test.beforeEach(async ({ request }) => {
    await cleanupTestCompanies(request, /^E2E-/);
  });

  test("drives onboarding through Step 4 and lands the company", async ({
    page,
    request,
  }) => {
    // Drive the wizard through Step 4 (the step that POSTs /companies) via the
    // shared helper, which owns the cold-path lobby-button budget. Preserve the
    // original crew model ("gpt-5.5") + the E2E-Onboard- cleanup prefix.
    const { issuePrefix } = await seedCompanyViaWizard(page, request, {
      companyName: `E2E-Onboard-${Date.now()}`,
      crewModel: "gpt-5.5",
    });

    // ── Navigate to the discussions list — the post-onboarding landing per
    // the plan. Step 5 needs a real local adapter CLI to advance so we leave
    // the wizard and drive the discussions surface directly. ──
    await page.goto(`/${issuePrefix}/discussions`);
    await expect(
      page.getByRole("heading", { name: /Discussions/i }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // ── The "New Thread" button is the modern label (was "New Discussion" in
    // an older plan revision). Match what the UI actually renders. ──
    const newThreadButton = page
      .getByRole("button", { name: /^new thread$/i })
      .first();
    await expect(newThreadButton).toBeVisible({ timeout: 10_000 });

    // ── Create a thread via the dialog and post one entry. The dialog's
    // submit shortcut adds an entry inline via `description` (see
    // NewThreadDialog → addEntry). The entry appears in the thread on
    // navigation to the detail page. ──
    await newThreadButton.click();
    const threadDialog = page.getByRole("dialog", { name: /^new thread$/i });
    await expect(threadDialog).toBeVisible({ timeout: 5_000 });

    const title = `E2E thread ${Date.now()}`;
    await threadDialog.locator("#thread-title").fill(title);
    await threadDialog
      .locator("#thread-description")
      .fill("Hello from Playwright — kickoff entry.");
    await threadDialog
      .getByRole("button", { name: /create thread/i })
      .click();

    // Dialog closes on success; toast appears.
    await expect(threadDialog).toBeHidden({ timeout: 10_000 });

    // ── Navigate into the newly created thread. The list query fan-out from
    // the create-mutation invalidation makes the row appear on the list
    // page; click it. ──
    const threadRow = page.getByText(title).first();
    await expect(threadRow).toBeVisible({ timeout: 10_000 });
    await threadRow.click();

    // ── Verify our kickoff entry rendered. ──
    await expect(
      page.getByText("Hello from Playwright — kickoff entry."),
    ).toBeVisible({ timeout: 10_000 });

    // ── LLM gap ──
    // The plan calls for "wait for Adjutant response up to 60s". That assertion
    // is omitted because the Adjutant LLM round-trip happens inside the
    // adapter subprocess (not in the browser fetch layer), so Playwright's
    // page.route() cannot intercept it. To enable this assertion in CI you'd
    // need either:
    //   1) AOA_E2E_SKIP_LLM=false + a working ANTHROPIC_API_KEY exposed to
    //      the spawned crew adapter subprocess, OR
    //   2) An AOA_E2E_FAKE_CREW_LLM=1 env switch that bypasses the real LLM
    //      subprocess and writes a canned response directly via the
    //      crewAgentService — out of scope for this task.
    test.fixme(
      !SKIP_LLM,
      "Adjutant response assertion requires LLM + crew adapter — see LLM gap comment",
    );
  });

  test("health endpoint responds", async ({ request }) => {
    // Paired with the wizard test as a webServer sanity check. If both fail
    // the server didn't boot; if only the wizard test fails, the UI regressed.
    const res = await request.get("/api/health");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body).toHaveProperty("status");
  });
});

// Keep the SKIP_LLM branch referenced so future specs can gate Adjutant
// assertions off it without re-introducing the import.
void SKIP_LLM;
