import type { MarketplaceCatalogItem, MarketplacePackage } from "@armyofagents/shared";

const SYNTHESIS_THRESHOLD = 2;

/**
 * Extract canonical `owner/repo` from a github URL, stripping any `tree/SHA/path`
 * suffix and a trailing `.git`. Returns `null` for non-github URLs.
 */
function repoRootFromUrl(url: string): string | null {
  const m = url.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/?#]+)/i);
  if (!m) return null;
  const owner = m[1]!;
  const repo = m[2]!.replace(/\.git$/i, "");
  return `${owner}/${repo}`;
}

/**
 * Derive the package list from catalog items. Items with an explicit
 * `packageId` group under that key (overrides any synthesis); remaining items
 * group by github owner/repo and only emit a package when the group has at
 * least {@link SYNTHESIS_THRESHOLD} members. Items with non-github source URLs
 * and no explicit packageId are skipped (no package).
 *
 * On id collision (an explicit `packageId` matches a synthesizable
 * `owner/repo`), the explicit package wins and the synthesized one is
 * suppressed. The items that would have synthesized are simply not part
 * of any package (they remain in the catalog).
 *
 * The result is deterministic: packages sorted by `id` ascending, member item
 * IDs sorted ascending. `verified` is true iff every member has
 * `trust.tier === "verified"`.
 */
export function derivePackages(items: ReadonlyArray<MarketplaceCatalogItem>): MarketplacePackage[] {
  const explicitGroups = new Map<string, MarketplaceCatalogItem[]>();
  const synthesizedGroups = new Map<string, MarketplaceCatalogItem[]>();

  for (const item of items) {
    if (item.packageId) {
      const list = explicitGroups.get(item.packageId);
      if (list) list.push(item);
      else explicitGroups.set(item.packageId, [item]);
      continue;
    }
    const root = repoRootFromUrl(item.source.url);
    if (!root) continue;
    const list = synthesizedGroups.get(root);
    if (list) list.push(item);
    else synthesizedGroups.set(root, [item]);
  }

  // Resolve id collisions: explicit packageId wins. If a synthesized
  // owner/repo matches an explicit id, suppress the synthesized package
  // entirely (the explicit one supersedes it).
  for (const id of explicitGroups.keys()) {
    synthesizedGroups.delete(id);
  }

  const packages: MarketplacePackage[] = [];

  for (const [id, members] of explicitGroups) {
    packages.push(buildPackage(id, id, members[0]!.source.url, members, /* explicit */ true));
  }

  for (const [id, members] of synthesizedGroups) {
    if (members.length < SYNTHESIS_THRESHOLD) continue;
    const repoName = id.split("/")[1] ?? id;
    const sourceUrl = `https://github.com/${id}`;
    packages.push(buildPackage(id, repoName, sourceUrl, members, /* explicit */ false));
  }

  packages.sort((a, b) => a.id.localeCompare(b.id));
  return packages;
}

function buildPackage(
  id: string,
  name: string,
  sourceUrl: string,
  members: ReadonlyArray<MarketplaceCatalogItem>,
  explicit: boolean,
): MarketplacePackage {
  const memberItemIds = members.map((m) => m.id).sort((a, b) => a.localeCompare(b));
  const verified = members.every((m) => m.trust.tier === "verified");
  return {
    id,
    name,
    sourceUrl,
    memberItemIds,
    count: memberItemIds.length,
    verified,
    explicit,
  };
}
