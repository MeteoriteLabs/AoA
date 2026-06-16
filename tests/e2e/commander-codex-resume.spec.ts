import { test, expect, type Page } from "@playwright/test";
import { cleanupTestCompanies, seedCompany } from "./helpers/seed-company";
import {
  writeFakeCodexControl,
  clearFakeCodexInvocations,
  readFakeCodexInvocations,
} from "./helpers/fake-codex";

/**
 * E2E (P2) — Commander codex two-turn resume continuity.
 *
 * Two sequential codex turns in one conversation, sharing the same sessionId.
 * After the first turn, the shim records the thread_id (= sessionId) in its
 * turn.completed. On the SECOND turn, cli-mode reads the stored sessionId from
 * the conversation state and appends `resume <sessionId> -` to the argv.
 *
 * Key assertions (plan-review fix #2/#3):
 *   • Turn 2's recorded invocation contains `resume <sessionId>` in argv —
 *     proving Commander actually called `codex exec … resume <id> -` (the
 *     real resume path), NOT that the shim inferred it from its own defaults.
 *   • The reasoning block renders on BOTH turns.
 *   • Turn 2's reply text is distinct from turn 1's (the shim re-read the
 *     control file).
 *
 * `clearFakeCodexInvocations()` is called before turn 2 so we scope the argv
 * assertion to the second spawn only.
 */

const SESSION_ID = "codex-e2e-resume-session-42";

const TURN1_REASONING = "Turn 1: analyzing the brief…";
const TURN1_REPLY = "Turn 1 reply: here is my initial assessment.";

const TURN2_REASONING = "Turn 2: continuing from my earlier analysis…";
const TURN2_REPLY = "Turn 2 reply: here is the follow-up, building on turn 1.";

async function sendMessage(page: Page, text: string): Promise<void> {
  const input = page.getByRole("textbox", { name: "Ask the agent..." });
  await input.click();
  await input.fill(text);
  await input.press("Enter");
}

async function waitForTurnEnd(page: Page): Promise<void> {
  await expect(
    page.getByRole("button", { name: "Stop generation" }),
  ).toHaveCount(0, { timeout: 30_000 });
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeVisible({ timeout: 30_000 });
}

/** Flip cliTool to codex for the given company. */
async function setCodexCliTool(
  request: Parameters<typeof test.beforeEach>[0] extends { request: infer R } ? R : never,
  companyId: string,
): Promise<void> {
  const res = await request.patch(
    `/api/companies/${companyId}/internal-agent/config`,
    { data: { cliTool: "codex" } },
  );
  if (!res.ok()) {
    const body = await res.text().catch(() => "(no body)");
    throw new Error(`setCodexCliTool failed: ${res.status()} ${body}`);
  }
}

test.describe("Commander codex two-turn resume", () => {
  test.beforeEach(async ({ request }) => {
    await cleanupTestCompanies(request, /^E2E-CmdResume-/);
  });

  test("turn 2 argv contains resume <sessionId>, reasoning block on both turns", async ({
    page,
    request,
  }) => {
    const company = await seedCompany(
      request,
      `E2E-CmdResume-${Date.now()}`,
    );

    // Flip cliTool → codex.
    await setCodexCliTool(request, company.id);

    // ── Turn 1 ────────────────────────────────────────────────────────────
    clearFakeCodexInvocations();
    writeFakeCodexControl({
      sessionId: SESSION_ID,
      reasoning: TURN1_REASONING,
      text: TURN1_REPLY,
      usage: { input: 50, output: 25 },
    });

    await page.goto(`/${company.issuePrefix}/commander`);

    await sendMessage(page, "Tell me about the project");

    // Turn 1 reasoning block and reply must appear.
    await expect(page.getByTestId("commander-reasoning").first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(TURN1_REPLY)).toBeVisible({ timeout: 15_000 });
    await waitForTurnEnd(page);

    // ── Turn 2 ────────────────────────────────────────────────────────────
    // Clear invocations BEFORE turn 2 so we scope the argv assertion to it.
    clearFakeCodexInvocations();
    writeFakeCodexControl({
      sessionId: SESSION_ID,  // same sessionId — shim echoes it back
      reasoning: TURN2_REASONING,
      text: TURN2_REPLY,
      usage: { input: 80, output: 40 },
    });

    await sendMessage(page, "Follow up on that please");

    // Turn 2 reasoning block and reply must appear (there should now be ≥2
    // reasoning blocks in the page — one per turn).
    await expect(
      page.getByTestId("commander-reasoning").nth(1),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(TURN2_REPLY)).toBeVisible({ timeout: 15_000 });
    await waitForTurnEnd(page);

    // ── RESUME ASSERTION (plan-review fix #2/#3) ───────────────────────────
    // Read the invocation for turn 2 only (clearFakeCodexInvocations was
    // called just before turn 2).
    const invocations = readFakeCodexInvocations();
    expect(invocations.length).toBeGreaterThanOrEqual(1);

    const inv2 = invocations[0];

    // Turn 2 MUST include `resume <SESSION_ID>` in argv — proving cli-mode
    // read the persisted codex sessionId and passed it correctly.
    expect(inv2.argv).toContain("resume");
    const resumeIdx = inv2.argv.indexOf("resume");
    expect(inv2.argv[resumeIdx + 1]).toBe(SESSION_ID);

    // Must still have the standard codex exec contract flags.
    expect(inv2.argv[0]).toBe("exec");
    expect(inv2.argv).toContain("--json");
    expect(inv2.argv).toContain("model_reasoning_effort=high");

    // Must end with "-" (stdin sentinel).
    expect(inv2.argv[inv2.argv.length - 1]).toBe("-");

    // CODEX_HOME is still set on turn 2 (same per-session home).
    expect(inv2.codexHome).toBeTruthy();
  });
});
