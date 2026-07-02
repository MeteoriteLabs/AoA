import { test, expect } from "@playwright/test";
import { cleanupTestCompanies, seedCompany } from "./helpers/seed-company";
import {
  markRuntimeDecisionRelayed,
  seedRuntimePermissionDecision,
} from "./helpers/seed-runtime-decision";

const PREFIX = /^E2E-HUB-W5-/;

test.describe("Inbox Hub W5 runtime decisions", () => {
  test.beforeEach(async ({ request }) => {
    await cleanupTestCompanies(request, PREFIX);
  });

  test("operator answers a runtime permission prompt and the hub item resolves after relay", async ({
    page,
    request,
  }) => {
    const company = await seedCompany(request, `E2E-HUB-W5-${Date.now()}`);
    const agentRes = await request.post(`/api/companies/${company.id}/agents`, {
      data: { name: "Runtime Bridge Agent" },
    });
    expect(agentRes.status(), await agentRes.text()).toBe(201);
    const agent = (await agentRes.json()) as { id: string };

    const seeded = await seedRuntimePermissionDecision({
      companyId: company.id,
      agentId: agent.id,
      title: "Allow deploy smoke command?",
      promptText: "The agent wants permission to run the deploy smoke command.",
      command: "pnpm test:run server/src/__tests__/agent-runtime-decisions.test.ts",
    });

    await page.goto(`/${company.issuePrefix}/inbox/waiting`);
    await expect(page.getByText("Allow deploy smoke command?")).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("button", { name: /Allow deploy smoke command/i }).click();
    const viewer = page.getByRole("complementary", { name: /hub viewer/i });
    await expect(viewer).toBeVisible();
    await expect(page.getByRole("region", { name: /runtime decision/i })).toContainText(
      "created",
    );
    await expect(page.getByText("pnpm test:run server/src/__tests__/agent-runtime-decisions.test.ts")).toBeVisible();

    const answerResponse = page.waitForResponse((response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith(
        `/agent-runtime-decisions/${seeded.decision.id}/answer`,
      ),
    );
    await page.getByRole("button", { name: /^allow once$/i }).click();
    expect((await answerResponse).status()).toBe(200);
    await expect(page.getByRole("region", { name: /runtime decision/i })).toContainText(
      "answered",
      { timeout: 10_000 },
    );
    await expect(page.getByRole("button", { name: /^allow once$/i })).toBeDisabled();

    await markRuntimeDecisionRelayed({
      runId: seeded.run.id,
      decisionId: seeded.decision.id,
    });
    await page.goto(`/${company.issuePrefix}/inbox/waiting`);
    await expect(page.getByText("Allow deploy smoke command?")).toBeHidden({
      timeout: 10_000,
    });
  });
});
