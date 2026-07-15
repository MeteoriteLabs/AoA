import type { APIRequestContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";

/** Clear the local-board user's onboarding progress so a spec starts clean. */
export async function resetOnboarding(request: APIRequestContext): Promise<void> {
  const res = await request.delete("/api/test/onboarding-progress");
  if (!res.ok()) {
    throw new Error(`resetOnboarding failed: ${res.status()} ${await res.text().catch(() => "")}`);
  }
}

/**
 * Strict pre-spec isolation (Plan 1 P2 #12): reset progress + delete any
 * E2E-prefixed companies + assert ZERO remain, so a stale company can't be
 * reused instead of proving organization creation.
 */
export async function freshOnboardingState(request: APIRequestContext): Promise<void> {
  await resetOnboarding(request);
  const list = async () =>
    ((await (await request.get("/api/companies")).json()) as Array<{ id: string; name: string }>) ?? [];
  for (const c of await list()) {
    if (/^E2E-/i.test(c.name)) await request.delete(`/api/companies/${c.id}`).catch(() => {});
  }
  const remaining = (await list()).filter((c) => /^E2E-/i.test(c.name));
  expect(remaining, "stale E2E companies must be cleared before the spec").toHaveLength(0);
}

/** Click a step's primary control and wait for the next heading. */
export async function advanceStep(page: Page, buttonName: RegExp, nextHeading: RegExp): Promise<void> {
  await page.getByRole("button", { name: buttonName }).click();
  await page.getByRole("heading", { name: nextHeading }).waitFor({ state: "visible", timeout: 15_000 });
}
