import { test, expect, type Page } from "@playwright/test";
import { cleanupTestCompanies, seedCompany } from "./helpers/seed-company";
import { writeFakeCodexControl } from "./helpers/fake-codex";

/**
 * E2E (P1) — Commander error states: not-configured + codex failure.
 *
 * Two cases asserting the chat surface shows an ERROR bubble (NOT a hung
 * "Thinking" spinner) when Commander cannot complete a turn:
 *
 * (a) Not-configured: cliTool=null — cli-mode yields
 *     {type:"error", message:"No CLI tool configured…"} immediately. The UI
 *     renders the error text as the message content and the send button is
 *     restored (no perpetual spinner).
 *
 * (b) Codex JSONL failure: cliTool="codex" + control {fail:"model-400"} →
 *     fake-codex emits turn.failed, parseCodexJsonl surfaces errorMessage →
 *     cli-mode yields {type:"error"} → SSE "error" event → UI renders the
 *     "model-400" error text. Guards the gpt-5.3-codex 400-rejection fix
 *     end-to-end.
 *
 * NOTE: The "true binary-missing" case (detectCliTool returns unavailable) is
 * NOT testable per-spec because fake-codex is permanently on the webServer
 * PATH — prepending the fixture dir means `which codex` always succeeds.
 * That case is covered by the no-browser server unit tests (plan-review fix
 * #4). This spec covers the route's {type:"error"} SSE path via the model-400
 * JSONL failure, which exercises the same error-bubble render path.
 *
 * Fresh company auto-seeds internal_agent_config with cliTool=null (→ claude
 * default), so case (a) needs NO config mutation — just send immediately.
 */

async function sendMessage(page: Page, text: string): Promise<void> {
  const input = page.getByRole("textbox", { name: "Ask the agent..." });
  await input.click();
  await input.fill(text);
  await input.press("Enter");
}

/**
 * Wait for the turn to finish (Stop generation disappears → Send message
 * reappears). Confirms no perpetual spinner — the send button is restored
 * even when the turn ends with an error.
 */
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

test.describe("Commander error states", () => {
  test.beforeEach(async ({ request }) => {
    await cleanupTestCompanies(request, /^E2E-CmdError-/);
  });

  test("(a) not-configured: cliTool=null → 'No CLI tool configured' error message, no perpetual spinner", async ({
    page,
    request,
  }) => {
    // Fresh company: cliTool=null by default — no PATCH needed.
    const company = await seedCompany(
      request,
      `E2E-CmdError-NoCLI-${Date.now()}`,
    );

    await page.goto(`/${company.issuePrefix}/commander`);

    // Send a message. cli-mode detects cliTool=null immediately and yields
    // {type:"error"} — no subprocess is spawned. The SSE "error" event arrives
    // quickly and replaces the streaming bubble content.
    await sendMessage(page, "Hello Commander");

    // The error text (exact message from cli-mode.ts line 513) must render.
    await expect(
      page.getByText(/No CLI tool configured/i),
    ).toBeVisible({ timeout: 20_000 });

    // No perpetual "Thinking" state — Stop generation must disappear and
    // Send message must be restored once the error event fires.
    await waitForTurnEnd(page);

    // Confirm the raw "No CLI tool configured" message is present in the chat.
    await expect(
      page.getByText(/No CLI tool configured/i),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("(b) codex JSONL failure (model-400): error bubble renders, no perpetual spinner", async ({
    page,
    request,
  }) => {
    const company = await seedCompany(
      request,
      `E2E-CmdError-CodexFail-${Date.now()}`,
    );

    // Flip cliTool → codex so cli-mode dispatches the codex path.
    await setCodexCliTool(request, company.id);

    // Script the fake-codex shim to emit turn.failed with the model-400 message.
    // parseCodexJsonl surfaces this as errorMessage → runCodexTurn yields
    // {type:"error", message:"The 'gpt-5.3-codex' model is not supported…"}.
    writeFakeCodexControl({
      fail: "model-400",
      text: "This text should never render — the turn fails before it",
    });

    await page.goto(`/${company.issuePrefix}/commander`);

    await sendMessage(page, "What's the plan?");

    // The turn.failed error message must appear in the chat bubble.
    await expect(
      page.getByText(/gpt-5\.3-codex.*not supported|not supported.*gpt-5\.3-codex/i),
    ).toBeVisible({ timeout: 20_000 });

    // No perpetual spinner — the turn settles on error.
    await waitForTurnEnd(page);

    // The success text must NOT render (the turn failed before agent_message).
    await expect(
      page.getByText("This text should never render"),
    ).toHaveCount(0);
  });
});
