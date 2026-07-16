import { test, expect, type Page } from "@playwright/test";
import { freshOnboardingState, fillFounderProfileStep } from "./helpers/onboarding-e2e";

/**
 * Track C visual + interaction coverage (Plan 3 / §6, Task 5).
 *
 * Drives VerifyStep through its `needs_auth` affordances via Playwright route
 * interception — the verify probe + commander-key/login endpoints are mocked so
 * each state is deterministic in CI WITHOUT a real `claude login` / `codex
 * login` device flow (that flow is dogfood-verified only; see the honesty note
 * in the Plan 3 doc). What CI asserts here: the needs_auth panel renders, the
 * API-key paste path re-verifies, and the interactive-login path surfaces the
 * verification URL and completes on poll.
 */

test.beforeEach(async ({ request }) => {
  await freshOnboardingState(request);
});

/** Walk profile → org → environment → commander(provider) → the Verify step. */
async function walkToVerify(page: Page, commander: "Claude" | "Codex"): Promise<void> {
  await page.goto("/onboarding");
  await fillFounderProfileStep(page, "Track C Founder");
  await page.getByRole("button", { name: /continue/i }).click();

  await expect(page.getByRole("heading", { name: /create your organization/i })).toBeVisible();
  await page.getByRole("textbox").first().fill(`E2E-TrackC-${Date.now()}`);
  await page.getByRole("button", { name: /continue/i }).click();

  await expect(page.getByRole("heading", { name: /set up your environment/i })).toBeVisible();
  await page.getByRole("button", { name: /verify & continue/i }).click();

  await expect(page.getByRole("heading", { name: /choose your commander/i })).toBeVisible();
  await page.getByText(commander, { exact: true }).click();
  await page.getByRole("button", { name: /continue/i }).click();

  await expect(page.getByRole("heading", { name: /verify your tooling/i })).toBeVisible();
}

test("needs_auth → API-key paste re-verifies to completion", async ({ page }) => {
  const shot = (name: string) =>
    page.screenshot({ path: `test-results/onboarding/trackc-${name}.png`, fullPage: true });

  // First verify → needs_auth; after the key is saved, verify → verified.
  let verifyCalls = 0;
  await page.route("**/internal-agent/verify", async (route) => {
    verifyCalls += 1;
    if (verifyCalls === 1) {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          outcome: "needs_auth",
          result: { status: "fail", checks: [{ code: "claude_hello_probe_auth_required", message: "sign in" }] },
        }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ outcome: "verified", result: { status: "pass" } }),
      });
    }
  });
  await page.route("**/internal-agent/commander-key", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, secretId: "sec-e2e" }) }),
  );

  await walkToVerify(page, "Claude");
  await page.getByRole("button", { name: /^verify$/i }).click();

  await expect(page.getByText("sign in")).toBeVisible();
  await shot("01-needs-auth");
  const keyField = page.getByPlaceholder(/sk-ant/i);
  await expect(keyField).toBeEnabled();
  await keyField.fill("sk-ant-e2e-secret");
  await page.getByRole("button", { name: /save key & verify/i }).click();

  // Re-verify succeeded → we advance past the verify step.
  await expect(page.getByRole("heading", { name: /create your first department/i })).toBeVisible({ timeout: 20_000 });
});

test("needs_auth → interactive login surfaces the URL and completes on poll", async ({ page }) => {
  const shot = (name: string) =>
    page.screenshot({ path: `test-results/onboarding/trackc-${name}.png`, fullPage: true });

  let verifyCalls = 0;
  await page.route("**/internal-agent/verify", async (route) => {
    verifyCalls += 1;
    await route.fulfill({
      status: verifyCalls === 1 ? 422 : 200,
      contentType: "application/json",
      body: JSON.stringify(
        verifyCalls === 1
          ? { outcome: "needs_auth", result: { checks: [{ message: "sign in" }] } }
          : { outcome: "verified", result: { status: "pass" } },
      ),
    });
  });
  await page.route("**/commander-login/start", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ challengeId: "ch-e2e", loginUrl: "https://claude.ai/oauth?code=E2E" }),
    }),
  );
  // First poll: pending (the URL panel must stay mounted long enough to be
  // seen/screenshotted); next poll: completed → auto re-verify. Returning
  // "completed" on the immediate first poll is a race — the panel can unmount
  // before the visibility assertion runs.
  let statusCalls = 0;
  await page.route("**/commander-login/ch-e2e", (route) => {
    statusCalls += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: statusCalls === 1 ? "pending" : "completed",
        loginUrl: "https://claude.ai/oauth?code=E2E",
      }),
    });
  });

  await walkToVerify(page, "Codex");
  await page.getByRole("button", { name: /^verify$/i }).click();
  // exact: the probe message paragraph — substring matching would also hit
  // the "Sign in with Codex" button (strict-mode violation).
  await expect(page.getByText("sign in", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /sign in with codex/i }).click();
  await expect(page.getByText("https://claude.ai/oauth?code=E2E")).toBeVisible();
  await shot("02-login-url");

  // Immediate poll → completed → auto re-verify → advance past the verify step.
  await expect(page.getByRole("heading", { name: /create your first department/i })).toBeVisible({ timeout: 20_000 });
});
