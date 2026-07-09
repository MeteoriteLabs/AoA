import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { cleanupTestCompanies, seedCompany } from "./helpers/seed-company";
import {
  clearFakeCodexInvocations,
  writeFakeCodexControl,
} from "./helpers/fake-codex";

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

async function setCodexCliTool(
  request: APIRequestContext,
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

test.describe("Commander codex human tools", () => {
  test.beforeEach(async ({ request }) => {
    await cleanupTestCompanies(request, /^E2E-CmdCodexHumans-/);
  });

  test("renders and persists a Codex query_humans tool call from the Commander UI", async ({
    page,
    request,
  }) => {
    const company = await seedCompany(
      request,
      `E2E-CmdCodexHumans-${Date.now()}`,
    );
    await setCodexCliTool(request, company.id);

    clearFakeCodexInvocations();
    writeFakeCodexControl({
      sessionId: "codex-e2e-human-tools-1",
      toolCalls: [
        {
          name: "query_humans",
          input: { limit: 10 },
          envelope: {
            success: true,
            data: {
              companyId: company.id,
              results: [
                {
                  userId: "local-board",
                  displayName: "Local Board",
                  email: "founder@example.com",
                  role: "founder",
                  departmentName: null,
                },
              ],
            },
            summary: "Found 1 human(s)",
          },
        },
      ],
      text: "The team currently has Local Board as the founder human.",
      usage: { input: 100, output: 40 },
    });

    await page.goto(`/${company.issuePrefix}/commander`);
    await sendMessage(page, "Who is on the human team?");

    await expect(page.getByRole("button", { name: "Used query humans" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByText("The team currently has Local Board as the founder human."),
    ).toBeVisible({ timeout: 30_000 });
    await waitForTurnEnd(page);

    const runsRes = await request.get(
      `/api/companies/${company.id}/internal-agent/runs?limit=5`,
    );
    expect(runsRes.ok()).toBe(true);
    const runsBody = (await runsRes.json()) as {
      runs: Array<{ status: string; toolsCalled: unknown }>;
    };
    expect(runsBody.runs[0]?.status).toBe("completed");
    expect(runsBody.runs[0]?.toolsCalled).toContain("query_humans");
  });
});
