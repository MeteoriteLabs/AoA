import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { cleanupTestCompanies, seedCompany } from "./helpers/seed-company";
import {
  createArtifactTurn,
  queryArtifactsTurn,
  writeFakeClaudeControl,
} from "./helpers/fake-claude";

/**
 * E2E — Commander viewer, driven through the REAL chat UI against a
 * deterministic fake `claude` CLI.
 *
 * The playwright config prepends tests/e2e/fixtures/fake-claude to the
 * webServer's PATH, so Commander's cli-mode (`which claude` + spawn) resolves
 * the fake binary. Each test writes the control file (helpers/fake-claude)
 * BEFORE sending a message; the fake emits that scripted turn as stream-json
 * (tool_use → tool_result-with-outputRefs-envelope → text deltas → result),
 * exercising the full pipeline: parser ref-lift → SSE `tool_result {name,
 * refs}` → chips → viewer panel → persistence on internal_agent_messages.
 *
 * Commander runs one fake-claude process per send (`--print` exits after the
 * turn and the session is reaped on exit), so each send re-reads the control
 * file — "write control, then send" fully scripts the next reply.
 *
 * A fresh company auto-seeds internal_agent_config (executionMode 'cli',
 * cliTool null → agent-loop defaults to 'claude_cli'), so no config seeding
 * is needed.
 */

const ARTIFACT_TITLE = "Launch Plan Q3";
const ARTIFACT_MARKER = "Phase one: ship the fake-CLI demo";
const ARTIFACT_CONTENT = `# ${ARTIFACT_TITLE}\n\n${ARTIFACT_MARKER}.\n\nPhase two: profit.`;

const REPLY_CREATED = "I drafted the launch plan and saved it as an artifact.";
const REPLY_REFERENCED =
  "We already have the launch plan artifact. Reply marker: zebra-quokka.";

interface SeededArtifact {
  id: string;
  versionId: string | null;
  title: string;
}

/** Seed a REAL artifact (with an initial markdown version) via the API. */
async function seedArtifact(
  request: APIRequestContext,
  companyId: string,
  opts: { title: string; content: string },
): Promise<SeededArtifact> {
  const res = await request.post(`/api/companies/${companyId}/artifacts`, {
    data: {
      title: opts.title,
      type: "document",
      source: "founder",
      content: opts.content,
    },
  });
  if (!res.ok()) {
    const body = await res.text().catch(() => "(no body)");
    throw new Error(`seedArtifact failed: ${res.status()} ${body}`);
  }
  const body = (await res.json()) as {
    id: string;
    currentVersionId?: string | null;
    versions?: Array<{ id: string }>;
  };
  return {
    id: body.id,
    versionId: body.versions?.[0]?.id ?? body.currentVersionId ?? null,
    title: opts.title,
  };
}

/**
 * Send a message through the REAL composer: the contenteditable rich input
 * (role=textbox, aria-label from placeholder "Ask the agent...") submits on
 * Enter (CommanderInput.handleKeyDown → submit → onSubmit → sendText).
 */
async function sendMessage(page: Page, text: string): Promise<void> {
  const input = page.getByRole("textbox", { name: "Ask the agent..." });
  await input.click();
  await input.fill(text);
  await input.press("Enter");
}

/**
 * Wait for the streaming turn to finish: while streaming the Send button is
 * swapped for "Stop generation"; when the SSE stream ends it swaps back.
 */
async function waitForTurnEnd(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "Stop generation" })).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible({
    timeout: 30_000,
  });
}

test.describe("Commander viewer", () => {
  test.beforeEach(async ({ request }) => {
    await cleanupTestCompanies(request, /^E2E-CmdViewer-/);
  });

  test("full interaction loop: created chip auto-opens, history chips, referenced chip, home, reply pop-out", async ({
    page,
    request,
  }) => {
    const company = await seedCompany(request, `E2E-CmdViewer-Loop-${Date.now()}`);
    const artifact = await seedArtifact(request, company.id, {
      title: ARTIFACT_TITLE,
      content: ARTIFACT_CONTENT,
    });

    await page.goto(`/${company.issuePrefix}/commander`);

    // Desktop default state: collapsed rail visible, panel not mounted.
    await expect(page.getByTestId("commander-viewer-rail")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("commander-viewer-panel")).toHaveCount(0);

    // ── Turn 1: create_artifact (action: created) ──────────────────────────
    writeFakeClaudeControl(createArtifactTurn(artifact, REPLY_CREATED));
    await sendMessage(page, "Draft a launch plan for Q3");

    // Chip with the artifact title appears under the reply.
    const chipContainers = page.getByTestId("output-ref-chips");
    await expect(
      chipContainers.getByRole("button", { name: new RegExp(ARTIFACT_TITLE) }),
    ).toBeVisible({ timeout: 30_000 });

    // Created ref auto-opens the panel (desktop) and the artifact's real
    // markdown content renders inside it.
    const panel = page.getByTestId("commander-viewer-panel");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByText(ARTIFACT_MARKER)).toBeVisible({ timeout: 15_000 });

    await waitForTurnEnd(page);

    // Collapse the panel back to the rail.
    await page.getByRole("button", { name: "Close viewer" }).click();
    await expect(page.getByTestId("commander-viewer-rail")).toBeVisible();
    await expect(panel).toHaveCount(0);

    // ── Reload: chips re-render from persisted history (output_refs) ───────
    await page.reload();
    await expect(page.getByTestId("commander-viewer-rail")).toBeVisible({
      timeout: 15_000,
    });
    const historyChip = page
      .getByTestId("output-ref-chips")
      .getByRole("button", { name: new RegExp(ARTIFACT_TITLE) });
    await expect(historyChip).toBeVisible({ timeout: 15_000 });

    // Clicking the history chip reopens the artifact content.
    await historyChip.click();
    await expect(panel).toBeVisible();
    await expect(panel.getByText(ARTIFACT_MARKER)).toBeVisible({ timeout: 15_000 });

    // Collapse again so the no-auto-open assertion below is meaningful.
    await page.getByRole("button", { name: "Close viewer" }).click();
    await expect(panel).toHaveCount(0);

    // ── Turn 2: query_company_artifacts (action: referenced) ───────────────
    writeFakeClaudeControl(queryArtifactsTurn([artifact], REPLY_REFERENCED));
    await sendMessage(page, "What artifacts do we have?");

    // Second chip row renders (one per refs-bearing assistant message)...
    await expect(page.getByTestId("output-ref-chips")).toHaveCount(2, {
      timeout: 30_000,
    });
    await waitForTurnEnd(page);

    // ...but referenced refs do NOT auto-open: still on the rail.
    await expect(page.getByTestId("commander-viewer-rail")).toBeVisible();
    await expect(panel).toHaveCount(0);

    // ── Home tab: both groups ───────────────────────────────────────────────
    await page.getByRole("button", { name: "Viewer home" }).click();
    const home = page.getByTestId("commander-viewer-home");
    await expect(home).toBeVisible();
    await expect(home.getByText("Recent from this conversation")).toBeVisible();
    await expect(home.getByText("Recent in company")).toBeVisible({
      timeout: 15_000,
    });

    // ── Reply pop-out: hover the last reply, open it in the viewer ─────────
    await page.getByText("zebra-quokka").last().hover();
    await page.getByRole("button", { name: "Open reply in viewer" }).last().click();
    await expect(panel.getByText(/zebra-quokka/)).toBeVisible({ timeout: 15_000 });
  });

  test("tool indicator settles to the completed label once the refs-bearing tool_result lands", async ({
    page,
    request,
  }) => {
    const company = await seedCompany(request, `E2E-CmdViewer-Spin-${Date.now()}`);
    const artifact = await seedArtifact(request, company.id, {
      title: ARTIFACT_TITLE,
      content: ARTIFACT_CONTENT,
    });

    await page.goto(`/${company.issuePrefix}/commander`);
    await expect(page.getByTestId("commander-viewer-rail")).toBeVisible({
      timeout: 15_000,
    });

    // Hold the stream open after the tool_result so the (transient,
    // un-persisted) tool indicator stays observable. Tool-call indicators live
    // only in local streaming state — the assistant message persists content +
    // outputRefs, never toolCalls — so they vanish on the post-turn server sync.
    // The spinner fix is a DURING-STREAM guarantee; we assert it while open.
    writeFakeClaudeControl({
      ...createArtifactTurn(artifact, REPLY_CREATED),
      holdMs: 2500,
    });
    await sendMessage(page, "Create the launch plan artifact");

    // The chip renders once the refs-bearing tool_result is processed.
    await expect(
      page
        .getByTestId("output-ref-chips")
        .getByRole("button", { name: new RegExp(ARTIFACT_TITLE) }),
    ).toBeVisible({ timeout: 30_000 });

    // While the stream is still held open, the tool indicator has SETTLED to the
    // completed label — completedToolLabel("mcp__aoa__create_artifact") =
    // "Used mcp aoa create artifact" (InternalAgentPanel). This is the spinner
    // fix: tool_result.name now resolves to the real tool name, so it matches
    // and settles the running entry. With the pre-fix bug (name = tool_use_id)
    // the indicator would still read "Running mcp aoa create artifact..." here.
    await expect(page.getByText("Used mcp aoa create artifact")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByText(/^Running mcp aoa create artifact/),
    ).toHaveCount(0);

    // The held stream then completes normally.
    await waitForTurnEnd(page);
  });

  test("mobile: pill badges on created ref without auto-opening the sheet; tap opens viewer tabs", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 480, height: 800 });

    const company = await seedCompany(request, `E2E-CmdViewer-Mob-${Date.now()}`);
    const artifact = await seedArtifact(request, company.id, {
      title: ARTIFACT_TITLE,
      content: ARTIFACT_CONTENT,
    });

    await page.goto(`/${company.issuePrefix}/commander`);

    // Mobile breakpoint (< 1024px): floating pill instead of the rail/panel.
    const pill = page.getByTestId("commander-viewer-pill");
    await expect(pill).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("commander-viewer-rail")).toHaveCount(0);

    writeFakeClaudeControl(createArtifactTurn(artifact, REPLY_CREATED));
    await sendMessage(page, "Draft a launch plan for Q3");

    // Chip renders under the reply...
    await expect(
      page
        .getByTestId("output-ref-chips")
        .getByRole("button", { name: new RegExp(ARTIFACT_TITLE) }),
    ).toBeVisible({ timeout: 30_000 });

    // ...but the sheet did NOT auto-open (no desktop panel on mobile either),
    // and the pill shows a pending badge instead.
    await expect(page.getByTestId("commander-viewer-panel")).toHaveCount(0);
    await expect(page.getByTestId("commander-viewer-tabs")).toHaveCount(0);
    await expect(pill.getByText("1")).toBeVisible({ timeout: 15_000 });

    await waitForTurnEnd(page);

    // Tapping the pill opens the sheet with the viewer tab bar.
    await pill.click();
    await expect(page.getByTestId("commander-viewer-tabs")).toBeVisible({
      timeout: 15_000,
    });
  });
});
