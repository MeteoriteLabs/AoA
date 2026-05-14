import type { CatalogItem } from "@armyofagents/shared";

export const FETCH_TIMEOUT_MS = 30_000;

/**
 * Fetch the body of a catalog item's resourceUrl.
 *
 * Used by snapshot installers (skill/agent/team) for the HTTP-fetch path.
 * Returns the response body as text. Caller is responsible for parsing.
 *
 * @param item - Catalog item with a resourceUrl
 * @param kind - Human-readable label for error messages (e.g. "skill content", "agent template", "team template")
 * @throws Error if resourceUrl missing or HTTP returns non-ok
 */
export async function fetchCatalogResource(item: CatalogItem, kind: string): Promise<string> {
  if (!item.resourceUrl) {
    throw new Error(`${kind}: ${item.id} has no resourceUrl`);
  }
  return fetchCatalogResourceUrl(item.resourceUrl, kind);
}

export async function fetchCatalogResourceUrl(url: string, kind: string): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${kind}: HTTP ${res.status} from ${url}`);
  }
  return await res.text();
}

/**
 * Resolve skill content from a catalog item.
 * Returns inline content if present (no network call), otherwise fetches from resourceUrl.
 *
 * Used by both the initial install flow and the auto-updater.
 */
export async function loadSkillContent(item: CatalogItem): Promise<string> {
  if (item.content?.inline) return item.content.inline;
  return fetchCatalogResource(item, "skill content");
}
