import { test, expect } from "@playwright/test";
import {
  agentTrustScores,
  agents,
  createDb,
  heartbeatRuns,
} from "../../packages/db/src/index";
import { cleanupTestCompanies, seedCompany } from "./helpers/seed-company";
import { seedHubItem } from "./helpers/seed-hub-item";

function e2eDatabaseUrl() {
  const explicit =
    process.env.AOA_E2E_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (explicit) return explicit;
  const port = process.env.AOA_E2E_DB_PORT?.trim() || "54329";
  return `postgres://paperclip:paperclip@127.0.0.1:${port}/paperclip`;
}

async function seedTrustedHeartbeatRun(companyId: string) {
  const db = createDb(e2eDatabaseUrl());
  try {
    const [agent] = await db
      .insert(agents)
      .values({
        companyId,
        name: `W3 Trusted Agent ${Date.now()}`,
        role: "engineer",
        kind: "org",
        status: "idle",
      })
      .returning({ id: agents.id });
    if (!agent) throw new Error("Failed to seed trusted agent");

    await db.insert(agentTrustScores).values({
      companyId,
      agentId: agent.id,
      totalCompleted: 10,
      approvedWithoutChanges: 10,
      recentCompleted: 5,
      recentApproved: 5,
      currentScore: 100,
    });

    const [run] = await db
      .insert(heartbeatRuns)
      .values({
        companyId,
        agentId: agent.id,
        invocationSource: "e2e",
        status: "completed",
        startedAt: new Date(),
        finishedAt: new Date(),
      })
      .returning({ id: heartbeatRuns.id });
    if (!run) throw new Error("Failed to seed trusted heartbeat run");

    return run;
  } finally {
    const client = (db as unknown as { $client?: { end: () => Promise<void> } }).$client;
    await client?.end();
  }
}

test.describe("Inbox Hub W3 Autopilot", () => {
  test.beforeEach(async ({ request }) => {
    await cleanupTestCompanies(request, /^E2E-HUB-W3-/);
  });

  test("operator enables Drive, sees an autonomous resolve, and undoes it", async ({
    page,
    request,
  }) => {
    const company = await seedCompany(request, `E2E-HUB-W3-${Date.now()}`);

    await page.goto(`/${company.issuePrefix}/inbox`);
    await expect(page.getByText("Autopilot")).toBeVisible();

    await page.getByRole("button", { name: /hub settings/i }).click();
    const modeSelect = page.getByRole("combobox", { name: /autopilot mode/i });
    const enabledCheckbox = page.getByRole("checkbox", {
      name: /run complete autopilot enabled/i,
    });
    const actionSelect = page.getByRole("combobox", {
      name: /run complete autopilot action/i,
    });
    const minTrustInput = page.getByRole("spinbutton", {
      name: /run complete min trust/i,
    });

    await expect(modeSelect).toBeEnabled();
    await Promise.all([
      page.waitForResponse((response) =>
        response.url().includes("/hub-autopilot/policy") &&
        response.request().method() === "PATCH" &&
        response.status() === 200,
      ),
      modeSelect.selectOption("drive"),
    ]);
    await expect(enabledCheckbox).toBeEnabled();
    await Promise.all([
      page.waitForResponse((response) =>
        response.url().includes("/hub-autopilot/policy") &&
        response.request().method() === "PATCH" &&
        response.status() === 200,
      ),
      enabledCheckbox.click(),
    ]);
    await expect(enabledCheckbox).toBeChecked();
    await expect(actionSelect).toBeEnabled();
    await Promise.all([
      page.waitForResponse((response) =>
        response.url().includes("/hub-autopilot/policy") &&
        response.request().method() === "PATCH" &&
        response.status() === 200,
      ),
      actionSelect.selectOption("resolve"),
    ]);
    await expect(minTrustInput).toBeEnabled();
    await Promise.all([
      page.waitForResponse((response) =>
        response.url().includes("/hub-autopilot/policy") &&
        response.request().method() === "PATCH" &&
        response.status() === 200,
      ),
      minTrustInput.fill("0"),
    ]);

    const run = await seedTrustedHeartbeatRun(company.id);
    const item = await seedHubItem({
      companyId: company.id,
      semanticType: "run_complete",
      sourceType: "heartbeat_run",
      sourceId: run.id,
      title: "W3 trusted run complete",
      summary: "Trusted completion can be auto-resolved.",
      ownerPool: "owner",
    });

    await page.goto(`/${company.issuePrefix}/inbox/notifications`);
    await expect(page.getByRole("button", { name: /W3 trusted run complete/i })).toBeHidden({
      timeout: 15_000,
    });

    await page.goto(`/${company.issuePrefix}/inbox`);
    await expect(page.getByText("Drive")).toBeVisible();
    await expect(page.getByText(/1 handled today/i)).toBeVisible();
    await expect(page.getByText("W3 trusted run complete")).toBeVisible();
    await expect(page.getByText(/Autopilot Drive accepted run_complete/i)).toBeVisible();

    await Promise.all([
      page.waitForResponse((response) =>
        response.url().includes(`/hub-items/${item.id}/undo`) &&
        response.status() === 200,
      ),
      page.getByRole("button", { name: /undo autopilot action w3 trusted run complete/i }).click(),
    ]);

    const itemRes = await request.get(`/api/companies/${company.id}/hub-items/${item.id}`);
    expect(itemRes.ok(), await itemRes.text()).toBeTruthy();
    const restored = (await itemRes.json()) as { status: string };
    expect(restored.status).toBe("open");
  });
});
