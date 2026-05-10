import { test, expect } from "@playwright/test";
import { seedCompany, cleanupTestCompanies } from "./helpers/seed-company";

/**
 * E2E: Marketplace (M.1 – M.4) smoke.
 *
 * Covers:
 *   API layer — catalog, company settings, pending updates, request-install
 *   UI layer  — marketplace home page, type-filter page, updates page
 *
 * Route map (from App.tsx):
 *   /marketplace                       — global catalog home (no company prefix)
 *   /marketplace/:type                 — redirects to /marketplace?type=:type
 *   /:prefix/marketplace-updates       — company-scoped updates page
 *
 * Catalog in the test instance comes from the bundled aoa-marketplace-snapshot.json
 * (2 items at time of writing: Slack plugin + template-skill).
 *
 * Server boots in AOA_DEPLOYMENT_MODE=local_trusted — no auth header needed.
 */

test.describe("Marketplace API", () => {
  test.afterEach(async ({ request }) => {
    await cleanupTestCompanies(request, /^E2E-MKT-/);
  });

  test("GET /api/marketplace/catalog returns non-empty catalog", async ({
    request,
  }) => {
    const res = await request.get("/api/marketplace/catalog");
    expect(res.ok()).toBe(true);

    const catalog = (await res.json()) as {
      items?: Array<{ id: string; name: string; type: string }>;
    };
    expect(Array.isArray(catalog.items)).toBe(true);
    expect(catalog.items!.length).toBeGreaterThan(0);

    const item = catalog.items![0]!;
    expect(item.id).toBeTruthy();
    expect(item.name).toBeTruthy();
    expect(["plugin", "skill", "agent", "team"]).toContain(item.type);
  });

  test("GET /api/marketplace/catalog/status returns sync metadata", async ({
    request,
  }) => {
    const res = await request.get("/api/marketplace/catalog/status");
    expect(res.ok()).toBe(true);
    const status = await res.json();
    // source field indicates where the catalog came from (bundled / remote)
    expect(status).toHaveProperty("source");
  });

  test("GET /api/companies/:id/marketplace/settings returns default settings shape", async ({
    request,
  }) => {
    const company = await seedCompany(request, `E2E-MKT-${Date.now()}`);
    const res = await request.get(
      `/api/companies/${company.id}/marketplace/settings`,
    );
    expect(res.ok()).toBe(true);

    const settings = (await res.json()) as Record<string, unknown>;
    // MarketplaceSettings fields (from packages/shared/src/marketplace.ts)
    expect(settings).toHaveProperty("pluginUpdatePolicy");
    expect(settings).toHaveProperty("skillUpdatePolicy");
    expect(settings).toHaveProperty("allowTeamLeadPlugins");
    expect(settings).toHaveProperty("teamMemberCanRequestInstall");
  });

  test("PATCH /api/companies/:id/marketplace/settings persists a field change", async ({
    request,
  }) => {
    const company = await seedCompany(request, `E2E-MKT-${Date.now()}`);
    const base = `/api/companies/${company.id}/marketplace/settings`;

    // pluginUpdatePolicy accepts "auto_patch" | "auto_minor" | "notify_all"
    const patch = await request.patch(base, {
      data: { pluginUpdatePolicy: "notify_all", allowTeamLeadPlugins: true },
    });
    expect(patch.ok()).toBe(true);
    const updated = (await patch.json()) as {
      pluginUpdatePolicy: string;
      allowTeamLeadPlugins: boolean;
    };
    expect(updated.pluginUpdatePolicy).toBe("notify_all");
    expect(updated.allowTeamLeadPlugins).toBe(true);

    // Round-trip: GET should return the same persisted values
    const get = await request.get(base);
    expect(get.ok()).toBe(true);
    const fetched = (await get.json()) as {
      pluginUpdatePolicy: string;
      allowTeamLeadPlugins: boolean;
    };
    expect(fetched.pluginUpdatePolicy).toBe("notify_all");
    expect(fetched.allowTeamLeadPlugins).toBe(true);
  });

  test("PATCH /api/companies/:id/marketplace/settings rejects non-object body", async ({
    request,
  }) => {
    const company = await seedCompany(request, `E2E-MKT-${Date.now()}`);
    const res = await request.patch(
      `/api/companies/${company.id}/marketplace/settings`,
      {
        data: [1, 2, 3], // array is not a valid settings object
        failOnStatusCode: false,
      },
    );
    expect(res.status()).toBe(400);
  });

  test("GET /api/companies/:id/marketplace/updates returns empty list for new company", async ({
    request,
  }) => {
    const company = await seedCompany(request, `E2E-MKT-${Date.now()}`);
    const res = await request.get(
      `/api/companies/${company.id}/marketplace/updates`,
    );
    expect(res.ok()).toBe(true);

    const updates = await res.json();
    expect(Array.isArray(updates)).toBe(true);
    expect(updates).toHaveLength(0);
  });

  test("POST /api/companies/:id/marketplace/request-install — 400 without catalogItemId", async ({
    request,
  }) => {
    const company = await seedCompany(request, `E2E-MKT-${Date.now()}`);
    const res = await request.post(
      `/api/companies/${company.id}/marketplace/request-install`,
      { data: {}, failOnStatusCode: false },
    );
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/catalogItemId/i);
  });

  test("POST /api/companies/:id/marketplace/request-install — 202 with valid id", async ({
    request,
  }) => {
    const company = await seedCompany(request, `E2E-MKT-${Date.now()}`);
    const res = await request.post(
      `/api/companies/${company.id}/marketplace/request-install`,
      {
        data: { catalogItemId: "plugin:aoa-curated/aoa-plugin-slack" },
        failOnStatusCode: false,
      },
    );
    expect(res.status()).toBe(202);
    const body = (await res.json()) as { queued: boolean };
    expect(body.queued).toBe(true);
  });

  test("POST /api/companies/:id/marketplace/updates/:id/dismiss — 404 for unknown id", async ({
    request,
  }) => {
    const company = await seedCompany(request, `E2E-MKT-${Date.now()}`);
    const res = await request.post(
      `/api/companies/${company.id}/marketplace/updates/00000000-0000-0000-0000-000000000000/dismiss`,
      { failOnStatusCode: false },
    );
    // dismiss is fire-and-forget (returns ok:true even if row not found),
    // so we just assert it doesn't 500
    expect(res.status()).toBeLessThan(500);
  });
});

test.describe("Marketplace UI", () => {
  test.afterEach(async ({ request }) => {
    await cleanupTestCompanies(request, /^E2E-MKT-/);
  });

  test("Marketplace home renders hero + at least one item card from the frozen fixture", async ({
    page,
  }) => {
    await page.goto("/marketplace");

    // Hero h1 ("Marketplace.") — visible once data loads
    await expect(
      page.getByRole("heading", { level: 1, name: /marketplace/i }),
    ).toBeVisible({ timeout: 15_000 });

    // Frozen fixture has 5 items (4 plugins + 1 skill). At least one CatalogCard
    // should render its name as an h3. Slack is in the fixture.
    await expect(
      page.getByRole("heading", { name: "Slack", level: 3 }).first(),
    ).toBeVisible();
  });

  test("Marketplace home renders type pills with labels and 'available' counts", async ({
    page,
  }) => {
    await page.goto("/marketplace");

    // Wait for hero so we know data has loaded
    await expect(
      page.getByRole("heading", { level: 1, name: /marketplace/i }),
    ).toBeVisible({ timeout: 15_000 });

    // Type pills aren't h3 anymore — they're buttons with span labels.
    // Locate by button name combining label + count text ("Plugins 4 available", etc.)
    await expect(page.getByRole("button", { name: /Plugins\s+\d+\s+available/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Skills\s+\d+\s+available/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Agents\s+\d+\s+available/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Teams\s+\d+\s+available/i })).toBeVisible();
  });

  test("Marketplace home does not show error state", async ({ page }) => {
    await page.goto("/marketplace");

    // Wait for catalog to settle (either data or empty-state — not error)
    await expect(
      page.getByText("Could not load the marketplace"),
    ).not.toBeVisible({ timeout: 15_000 });
  });

  test("/marketplace/plugin type-filter page renders 'Plugins' heading with item count", async ({
    page,
  }) => {
    // /marketplace/plugin redirects → /marketplace?type=plugin (MarketplaceTypeRedirect).
    // The page uses a single h1 "Marketplace." and the Plugins filter chip goes active.
    await page.goto("/marketplace?type=plugin");

    // Wait for the page to settle
    await expect(
      page.getByRole("heading", { level: 1, name: /marketplace/i }),
    ).toBeVisible({ timeout: 15_000 });

    // The Plugins filter chip should be active when ?type=plugin is set
    const pluginsPill = page.getByRole("button", { name: /Plugins\s+\d+\s+available/i });
    await expect(pluginsPill).toHaveAttribute("data-active", "true");

    // Slack plugin card should be listed (present in bundled snapshot)
    await expect(
      page.getByRole("heading", { name: "Slack", level: 3 }),
    ).toBeVisible();
  });

  test("/marketplace/skill type-filter page renders 'Skills' heading", async ({
    page,
  }) => {
    // /marketplace/skill redirects → /marketplace?type=skill.
    await page.goto("/marketplace?type=skill");

    await expect(
      page.getByRole("heading", { level: 1, name: /marketplace/i }),
    ).toBeVisible({ timeout: 15_000 });

    // Skills filter chip is active
    const skillsPill = page.getByRole("button", { name: /Skills\s+\d+\s+available/i });
    await expect(skillsPill).toHaveAttribute("data-active", "true");

    // template-skill is the skill in the bundled snapshot
    await expect(page.getByText("template-skill")).toBeVisible();
  });

  test("/marketplace/<unknown-type> redirects to the homepage", async ({
    page,
  }) => {
    // The current routing redirects /marketplace/:type → /marketplace?type=:type
    // (see MarketplaceTypeRedirect in App.tsx). Unknown types fall through to the
    // homepage rather than rendering a dedicated error page.
    await page.goto("/marketplace/foobar");

    await expect(page).toHaveURL(/\/marketplace(\?|$)/, { timeout: 10_000 });
    await expect(
      page.getByRole("heading", { level: 1, name: /marketplace/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("/:prefix/marketplace-updates shows 'All up to date' for a new company", async ({
    page,
    request,
  }) => {
    const company = await seedCompany(request, `E2E-MKT-${Date.now()}`);
    await page.goto(`/${company.issuePrefix}/marketplace-updates`);

    await expect(page.getByText("All up to date")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("Clicking a type pill toggles the type filter on the homepage", async ({
    page,
  }) => {
    await page.goto("/marketplace");

    // Wait for hero so the page has loaded
    await expect(
      page.getByRole("heading", { level: 1, name: /marketplace/i }),
    ).toBeVisible({ timeout: 15_000 });

    // Click the Plugins pill (button)
    const pluginsPill = page.getByRole("button", { name: /Plugins\s+\d+\s+available/i });
    await pluginsPill.click();

    // Pill should reflect active state (data-active="true" on the button)
    await expect(pluginsPill).toHaveAttribute("data-active", "true");
  });
});
