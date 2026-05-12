import { expect, test } from "@playwright/test";
import { cleanupTestCompanies, seedCompany } from "./helpers/seed-company";

test.describe("secrets vaults", () => {
  test.beforeEach(async ({ request }) => {
    await cleanupTestCompanies(request);
  });

  test("creates an AWS vault and imports an external reference", async ({ page, request }) => {
    const company = await seedCompany(request, `E2E-Test-Secrets-${Date.now()}`);
    const providerConfigId = "22222222-2222-2222-2222-222222222222";
    const importedSecretId = "11111111-1111-1111-1111-111111111111";
    const providerConfigs: any[] = [];
    const secrets: any[] = [];

    await page.route(`**/api/companies/${company.id}/secret-providers`, async (route) => {
      await route.fulfill({
        json: [
          {
            id: "aws_secrets_manager",
            label: "AWS Secrets Manager",
            requiresExternalRef: false,
            supportsManagedValues: true,
            supportsExternalReferences: true,
            configured: providerConfigs.length > 0,
            status: "ready",
          },
          {
            id: "vault",
            label: "HashiCorp Vault",
            requiresExternalRef: true,
            supportsManagedValues: false,
            supportsExternalReferences: true,
            configured: false,
            status: "coming_soon",
          },
        ],
      });
    });

    await page.route(`**/api/companies/${company.id}/secret-provider-configs`, async (route) => {
      if (route.request().method() === "POST") {
        const body = await route.request().postDataJSON();
        const created = {
          id: providerConfigId,
          companyId: company.id,
          provider: body.provider,
          displayName: body.displayName,
          status: "ready",
          isDefault: body.isDefault,
          config: body.config,
          healthStatus: "ready",
          healthCheckedAt: new Date().toISOString(),
          healthMessage: null,
          healthDetails: null,
          disabledAt: null,
          createdByAgentId: null,
          createdByUserId: "e2e",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        providerConfigs.push(created);
        await route.fulfill({ status: 201, json: created });
        return;
      }
      await route.fulfill({ json: providerConfigs });
    });

    await page.route(`**/api/companies/${company.id}/secrets`, async (route) => {
      await route.fulfill({ json: secrets });
    });
    await page.route("**/api/secrets/*/bindings", async (route) => {
      await route.fulfill({ json: [] });
    });
    await page.route("**/api/secrets/*/access-events", async (route) => {
      await route.fulfill({ json: [] });
    });
    await page.route(`**/api/companies/${company.id}/secrets/remote-import/preview`, async (route) => {
      await route.fulfill({
        json: {
          providerConfigId,
          nextToken: null,
          candidates: [
            {
              externalRef: "arn:aws:secretsmanager:us-east-1:111111111111:secret:aoa/prod/openai",
              name: "OPENAI_API_KEY",
              key: "OPENAI_API_KEY",
              providerVersionRef: "v1",
              description: null,
              status: "ready",
            },
          ],
        },
      });
    });
    await page.route(`**/api/companies/${company.id}/secrets/remote-import`, async (route) => {
      const body = await route.request().postDataJSON();
      secrets.push({
        id: importedSecretId,
        companyId: company.id,
        name: body.secrets[0].name,
        key: body.secrets[0].key,
        status: "active",
        managedMode: "external_reference",
        provider: "aws_secrets_manager",
        providerConfigId,
        providerMetadata: null,
        externalRef: body.secrets[0].externalRef,
        latestVersion: 1,
        description: null,
        lastResolvedAt: null,
        lastRotatedAt: null,
        deletedAt: null,
        createdByAgentId: null,
        createdByUserId: "e2e",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        referenceCount: 0,
      });
      await route.fulfill({
        status: 201,
        json: {
          providerConfigId,
          results: [
            {
              externalRef: body.secrets[0].externalRef,
              name: body.secrets[0].name,
              status: "imported",
              secretId: importedSecretId,
            },
          ],
        },
      });
    });

    await page.goto(`/${company.issuePrefix}/secrets`);
    await expect(page.getByRole("heading", { name: "Secrets" })).toBeVisible();

    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText("Production AWS").first()).toBeVisible();

    await page.getByRole("button", { name: /^import$/i }).click();
    await page.getByRole("button", { name: /^preview$/i }).click();
    const row = page.getByRole("row").filter({ hasText: "OPENAI_API_KEY" });
    await expect(row).toBeVisible();
    await row.getByRole("checkbox").click();
    await page.getByRole("button", { name: /^import$/i }).last().click();

    await expect(page.getByText("imported")).toBeVisible();
    await page.getByRole("button", { name: /^done$/i }).click();
    await expect(page.getByText("OPENAI_API_KEY").first()).toBeVisible();
    await expect(page.getByText("External reference").first()).toBeVisible();
  });
});
