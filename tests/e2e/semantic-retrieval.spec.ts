import { test, expect, type APIRequestContext } from "@playwright/test";
import { cleanupTestCompanies, seedCompany } from "./helpers/seed-company";
import { clearFakeEmbedderControl } from "./helpers/fake-embedder";

/**
 * E2E — semantic RETRIEVAL from pgvector (the vector READ path).
 *
 * This is the first test that exercises an actual cosine-distance query against
 * the vector column and asserts ranked results — the write-side specs only prove
 * the "indexed" badge. pgvector-gated: `GET /memory/search` only takes the vector
 * path when pgvector is present AND a per-company OpenAI key resolves; otherwise
 * it falls back to ilike text search (ordered by priority/updatedAt), which would
 * NOT prove similarity ranking.
 *
 * The fake embedder (AOA_E2E_FAKE_EMBEDDER=1) is deterministic by text, and the
 * memory embed text is `${title}\n${content}` (memory-write.ts). So a query equal
 * to an item's title+content produces an identical vector → cosine distance 0 →
 * that item ranks first. We query for EACH item's exact text and assert it comes
 * back ranked #1, proving the search discriminates between items.
 *
 * `GET /companies/:cid/memory/search?q=` returns a BARE ARRAY (memory.ts route:
 * `res.json(results)`), not `{ items }`.
 */
const PGVECTOR_AVAILABLE = process.env.AOA_E2E_PGVECTOR === "1";

async function addKey(request: APIRequestContext, companyId: string): Promise<void> {
  const res = await request.post(`/api/companies/${companyId}/secrets`, {
    data: { name: "llm:openai", value: "e2e-fake-retrieval-key" },
  });
  expect(res.ok()).toBe(true);
}

async function createItem(
  request: APIRequestContext,
  companyId: string,
  title: string,
  content: string,
): Promise<{ id: string }> {
  const res = await request.post(`/api/companies/${companyId}/memory`, {
    data: { title, content, layer: "domain", category: "procedure", source: "founder", status: "approved" },
  });
  expect(res.ok()).toBe(true);
  return (await res.json()) as { id: string };
}

async function waitIndexed(
  request: APIRequestContext,
  companyId: string,
  id: string,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const res = await request.get(`/api/companies/${companyId}/memory`);
    const body = (await res.json()) as { items: Array<{ id: string; indexStatus?: string }> };
    if (body.items.find((i) => i.id === id)?.indexStatus === "indexed") return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`item ${id} never reached indexStatus="indexed"`);
}

async function search(
  request: APIRequestContext,
  companyId: string,
  q: string,
): Promise<Array<{ id: string }>> {
  const res = await request.get(
    `/api/companies/${companyId}/memory/search?q=${encodeURIComponent(q)}`,
  );
  expect(res.ok()).toBe(true);
  return (await res.json()) as Array<{ id: string }>;
}

test.describe("semantic retrieval — pgvector cosine ranking", () => {
  test.beforeEach(async ({ request }) => {
    await cleanupTestCompanies(request, /^E2E-Retr-/);
    clearFakeEmbedderControl();
  });

  test("indexed items are returned ranked by similarity to the query", async ({ request }) => {
    test.skip(!PGVECTOR_AVAILABLE, "Requires pgvector (set AOA_E2E_PGVECTOR=1)");

    const company = await seedCompany(request, `E2E-Retr-${Date.now()}`);
    await addKey(request, company.id);

    const billingTitle = "Billing refund policy";
    const billingContent =
      "Refunds are processed within thirty days via Stripe for all paid plans.";
    const wifiTitle = "Office wifi";
    const wifiContent =
      "The guest wifi password rotates on the first Monday of every month.";

    const billing = await createItem(request, company.id, billingTitle, billingContent);
    const wifi = await createItem(request, company.id, wifiTitle, wifiContent);
    await waitIndexed(request, company.id, billing.id);
    await waitIndexed(request, company.id, wifi.id);

    // Query with the EXACT embedded text of each item (title\ncontent). The
    // deterministic fake embedder yields an identical vector → distance 0 → the
    // matching item ranks first. This proves cosine ranking discriminates.
    const billingResults = await search(request, company.id, `${billingTitle}\n${billingContent}`);
    expect(billingResults.length).toBeGreaterThan(0);
    expect(billingResults[0].id).toBe(billing.id);

    const wifiResults = await search(request, company.id, `${wifiTitle}\n${wifiContent}`);
    expect(wifiResults.length).toBeGreaterThan(0);
    expect(wifiResults[0].id).toBe(wifi.id);

    // Both items are retrievable through the vector index.
    expect(billingResults.some((i) => i.id === billing.id)).toBe(true);
    expect(wifiResults.some((i) => i.id === wifi.id)).toBe(true);
  });
});
