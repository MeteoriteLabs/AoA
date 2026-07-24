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
export async function fetchCatalogResource(
  item: CatalogItem,
  kind: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!item.resourceUrl) {
    throw new Error(`${kind}: ${item.id} has no resourceUrl`);
  }
  return fetchCatalogResourceUrl(item.resourceUrl, kind, signal);
}

/**
 * @param signal - optional CALLER deadline, combined with (not replacing) the
 *   per-request {@link FETCH_TIMEOUT_MS}. An install made of N sequential
 *   requests is otherwise bounded only by N × FETCH_TIMEOUT_MS, which for the
 *   real crew roster (27 requests) is ~13.5 minutes — unacceptable inside the
 *   interactive company-create POST. The caller's signal is what makes the
 *   AGGREGATE bounded; aborting it rejects the in-flight request immediately
 *   rather than merely abandoning the result.
 */
export async function fetchCatalogResourceUrl(
  url: string,
  kind: string,
  signal?: AbortSignal,
): Promise<string> {
  let res: Response;
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  try {
    res = await fetch(url, {
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to fetch ${kind}: ${message} from ${url}`, { cause: err });
  }
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
