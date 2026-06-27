import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { cleanupTestCompanies, seedCompany } from "./helpers/seed-company";
import { clearFakeEmbedderControl, writeFakeEmbedderControl } from "./helpers/fake-embedder";

/**
 * E2E — Memory index status badge + no-LLM-key banner.
 *
 * Tests two surfaces:
 *
 * (a) NO key configured → Memory page shows `data-testid="no-llm-key-banner"`
 *     (amber banner: "Semantic search is off — add an embeddings key in Settings →
 *     Memory") and memory items show the "not indexed" badge
 *     (`data-testid="memory-index-status"`).
 *
 *     The e2e webServer has OPENAI_API_KEY=e2e-fake-openai-key-placeholder in its
 *     env. However, resolveSemanticAvailable() checks the per-COMPANY key stored in
 *     company_secrets (not the instance env var). A freshly seeded company has NO
 *     company secret, so semanticAvailable = false → banner is shown.
 *
 *     This runs on standard embedded-pg (no pgvector needed).
 *
 * (b) GATED behind pgvector (`AOA_E2E_PGVECTOR=1`):
 *     With `AOA_E2E_FAKE_EMBEDDER=1` (already active in e2e env) + a company-level
 *     key configured, create a memory item → poll until the badge shows "Indexed".
 *     Also verifies the key-add-backfill path (key creation triggers reindex sweep).
 *
 * The `memory-index-status` badge testid lives in `ui/src/pages/Memory.tsx`
 * (the legacy /memory/legacy route), which renders the items list with a
 * MemoryIndexBadge per item.
 *
 * The `no-llm-key-banner` (amber "Semantic search is off — add an embeddings
 * key in Settings → Memory") now appears on BOTH surfaces: the legacy
 * `ui/src/pages/Memory.tsx` AND the primary `ui/src/pages/MemoryExplorer.tsx`
 * (the /memory/explore route). Both deep-link to Settings → Memory
 * (`?tab=memory`). This spec asserts the banner on each surface.
 */

const PGVECTOR_AVAILABLE = process.env.AOA_E2E_PGVECTOR === "1";

async function createMemoryItem(
  request: APIRequestContext,
  companyId: string,
  opts: { title: string; content: string; layer?: string },
): Promise<{ id: string; title: string; indexStatus?: string }> {
  const res = await request.post(`/api/companies/${companyId}/memory`, {
    data: {
      title: opts.title,
      content: opts.content,
      layer: opts.layer ?? "domain",
      category: "procedure",
      source: "founder",
      status: "approved",
    },
  });
  if (!res.ok()) {
    const body = await res.text().catch(() => "(no body)");
    throw new Error(`createMemoryItem failed: ${res.status()} ${body}`);
  }
  return res.json() as Promise<{ id: string; title: string; indexStatus?: string }>;
}

async function listMemoryItems(
  request: APIRequestContext,
  companyId: string,
): Promise<{ items: Array<{ id: string; title: string; indexStatus?: string }>; semanticAvailable: boolean }> {
  const res = await request.get(`/api/companies/${companyId}/memory`);
  if (!res.ok()) {
    const body = await res.text().catch(() => "(no body)");
    throw new Error(`listMemoryItems failed: ${res.status()} ${body}`);
  }
  return res.json() as Promise<{ items: Array<{ id: string; title: string; indexStatus?: string }>; semanticAvailable: boolean }>;
}

/** Navigate to /memory/legacy (the Memory page that renders the no-llm-key-banner). */
async function openMemoryPage(page: Page, issuePrefix: string): Promise<void> {
  await page.goto(`/${issuePrefix}/memory/legacy`);
  // The Memory page renders a heading.
  await expect(page.getByRole("heading", { name: /memory/i }).first()).toBeVisible({
    timeout: 10_000,
  });
}

test.describe("memory index status — no-key path (no pgvector needed)", () => {
  test.beforeEach(async ({ request }) => {
    await cleanupTestCompanies(request, /^E2E-MemIdx-/);
    clearFakeEmbedderControl();
  });

  test(
    "fresh company with no per-company key: Memory page shows no-llm-key-banner and not-indexed badge",
    async ({ page, request }) => {
      const company = await seedCompany(request, `E2E-MemIdx-${Date.now()}`);

      // Create a domain memory item. The freshly seeded company has no per-company
      // OpenAI secret, so resolveSemanticAvailable() → false, and
      // deriveIndexStatus({hasVector: false, queueStatus: null}) → "not_indexed".
      await createMemoryItem(request, company.id, {
        title: "E2E: Keyless memory index status test",
        content: "Processes for testing the no-key memory path in e2e.",
      });

      // Verify via API that semanticAvailable is false.
      const listResult = await listMemoryItems(request, company.id);
      expect(listResult.semanticAvailable).toBe(false);
      // The created item must have indexStatus "not_indexed" (no vector, no queue row).
      const item = listResult.items.find((i) => i.title === "E2E: Keyless memory index status test");
      expect(item).toBeTruthy();
      expect(item!.indexStatus).toBe("not_indexed");

      // Navigate to the Memory page.
      await openMemoryPage(page, company.issuePrefix);

      // The no-llm-key-banner must be visible to the founder.
      await expect(page.getByTestId("no-llm-key-banner")).toBeVisible({
        timeout: 10_000,
      });

      // The item must show the "not indexed" badge.
      await expect(page.getByTestId("memory-index-status").first()).toBeVisible({
        timeout: 5_000,
      });
      // Text content of the not_indexed badge is "Not indexed".
      await expect(page.getByTestId("memory-index-status").first()).toContainText(
        /not indexed/i,
      );

      // The PRIMARY surface (MemoryExplorer, /memory/explore) must ALSO show the
      // no-llm-key-banner, deep-linking to Settings → Memory.
      await page.goto(`/${company.issuePrefix}/memory/explore`);
      const explorerBanner = page.getByTestId("no-llm-key-banner");
      await expect(explorerBanner).toBeVisible({ timeout: 10_000 });
      await expect(explorerBanner).toContainText(/Settings\s*→\s*Memory/);
      // The banner links to the Memory settings tab (?tab=memory).
      await expect(
        explorerBanner.getByRole("link", { name: /Settings\s*→\s*Memory/ }),
      ).toHaveAttribute("href", /tab=memory/);
    },
  );
});

test.describe("memory index status — pgvector-gated (AOA_E2E_PGVECTOR=1 required)", () => {
  test.beforeEach(async ({ request }) => {
    await cleanupTestCompanies(request, /^E2E-MemIdxPG-/);
    clearFakeEmbedderControl();
  });

  test(
    "with pgvector + fake embedder: memory item badge flips to 'indexed' after embedding completes",
    async ({ page, request }) => {
      test.skip(
        !PGVECTOR_AVAILABLE,
        "Requires pgvector extension (set AOA_E2E_PGVECTOR=1 to enable)",
      );

      // The fake embedder is always active in e2e (AOA_E2E_FAKE_EMBEDDER=1).
      // Ensure no forced error is set so embeds succeed.
      clearFakeEmbedderControl();

      const company = await seedCompany(request, `E2E-MemIdxPG-${Date.now()}`);

      // The company needs a per-company OpenAI key for resolveSemanticAvailable()
      // to return true and for the embedding worker to process the queue row.
      // In the e2e env, the company_secrets table is backed by a fake AWS Secrets
      // Manager (AOA_E2E_FAKE_AWS_SECRETS_MANAGER=1), so this POST goes through.
      const secretRes = await request.post(
        `/api/companies/${company.id}/secrets`,
        {
          data: { secretType: "llm:openai", value: "e2e-fake-pgvector-key" },
        },
      );
      expect(secretRes.ok()).toBe(true);

      // Create a memory item — this enqueues an embedding row.
      const item = await createMemoryItem(request, company.id, {
        title: "E2E: pgvector indexed memory test",
        content: "This item should be indexed by the fake embedder in pgvector mode.",
      });
      expect(item.id).toBeTruthy();

      // Poll the API until indexStatus flips to "indexed" (fake embedder ran).
      const deadline = Date.now() + 30_000;
      let indexStatus: string | undefined;
      while (Date.now() < deadline) {
        const list = await listMemoryItems(request, company.id);
        const found = list.items.find((i) => i.id === item.id);
        if (found?.indexStatus === "indexed") {
          indexStatus = "indexed";
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      expect(indexStatus).toBe("indexed");

      // Navigate to the Memory page and assert the badge shows "Indexed".
      await openMemoryPage(page, company.issuePrefix);

      // The no-llm-key-banner must NOT be visible (key is present → semantic available).
      await expect(page.getByTestId("no-llm-key-banner")).toHaveCount(0);

      // The item's badge must show "Indexed".
      const badges = page.getByTestId("memory-index-status");
      // At least one badge should say "Indexed".
      await expect(badges.filter({ hasText: /^indexed$/i }).first()).toBeVisible({
        timeout: 5_000,
      });
    },
  );

  test(
    "with pgvector: adding a company key triggers backfill — existing items become indexed",
    async ({ page, request }) => {
      test.skip(
        !PGVECTOR_AVAILABLE,
        "Requires pgvector extension (set AOA_E2E_PGVECTOR=1 to enable)",
      );

      clearFakeEmbedderControl();

      const company = await seedCompany(request, `E2E-MemIdxPG-${Date.now()}`);

      // Create a memory item BEFORE adding a key — it will have no queue row
      // (keyless path: no key → no enqueue when semanticAvailable=false... or
      // the status-agnostic enqueue still fires; the route checks company key
      // resolves before embedding). Either way, after key add, the reindex sweep
      // fires and the item should eventually become indexed.
      const item = await createMemoryItem(request, company.id, {
        title: "E2E: pre-key memory item for backfill test",
        content: "Created before the OpenAI key was added, to test backfill sweep.",
      });
      expect(item.id).toBeTruthy();

      // Now add the company key (this triggers reindexCompany() fire-and-forget
      // in the secrets route handler).
      const secretRes = await request.post(
        `/api/companies/${company.id}/secrets`,
        {
          data: { secretType: "llm:openai", value: "e2e-fake-backfill-key" },
        },
      );
      expect(secretRes.ok()).toBe(true);

      // Poll until the item is indexed (backfill sweep processed the queue).
      const deadline = Date.now() + 30_000;
      let indexStatus: string | undefined;
      while (Date.now() < deadline) {
        const list = await listMemoryItems(request, company.id);
        const found = list.items.find((i) => i.id === item.id);
        if (found?.indexStatus === "indexed") {
          indexStatus = "indexed";
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      expect(indexStatus).toBe("indexed");

      // The Memory page should no longer show the no-llm-key-banner.
      await openMemoryPage(page, company.issuePrefix);
      await expect(page.getByTestId("no-llm-key-banner")).toHaveCount(0);
    },
  );
});
