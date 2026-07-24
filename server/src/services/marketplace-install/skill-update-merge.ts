/**
 * @fileoverview The I/O half of the reviewed **skill** merge (T2.8).
 *
 * `POST /updates/:id/merge` used to rewrite `company_skills.markdown` and stop
 * there. For a bundle-carrying skill that is only half the item: the ancillary
 * files (`references/`, `scripts/`, `assets/`) live on disk under
 * `managedCatalogSkillDir(...)`, `metadata.catalogBundleInstallPath` points at
 * them, and `listRuntimeSkillEntries` (`company-skills.ts`) hands exactly those
 * bytes to an agent at run time. Advancing the markdown without re-materializing
 * shipped agents a new SKILL.md next to the OLD scripts — silently, with
 * `sourceRef` already stamped so no later pass would ever repair it.
 *
 * Both other landing paths already materialize (`skill-installer`,
 * `skill-auto-updater`); this one is the gap.
 *
 * ── What it deliberately does NOT do ────────────────────────────────────────
 *
 * **It never overwrites `markdown` with the bundle's SKILL.md.** That is the
 * whole reason a merge exists: `merged` carries the founder's "mine" sections.
 * `applySkillUpdate` writes `payload.markdown` straight from the materializer
 * because it only ever runs on a provably un-customized row; copying that line
 * into here would be the skill-side of the D22 harm this phase spent three
 * tasks removing from the agent side.
 *
 * The divergence that leaves — DB `markdown` is merged, the SKILL.md on disk is
 * upstream's — is not observable at run time: `readAncillarySkillFiles` skips
 * `SKILL.md` by name (`company-skills.ts:798`) and the runtime entry takes
 * `markdown` from the row. The bundle directory supplies ancillary files only.
 *
 * **It is not the agent merge.** Decision #115: the agent path writes its
 * merged bundle file-by-file via `writeMergedAgentBundle` and must NOT be
 * routed through a materializer, because `materializeManagedBundle`'s first act
 * is a recursive `fs.rm` on the founder-editable instruction root. Nothing here
 * touches agent bundles, and nothing here should be "unified" with them. The
 * two are safe to keep separate precisely because a catalog skill's bundle
 * directory is NOT founder-editable — see below.
 *
 * ── Why re-materializing cannot destroy founder edits ───────────────────────
 *
 * For `sourceType = "catalog"` the founder has no write path to the bundle
 * directory at all. `companySkillsService.updateFile` writes to disk only for
 * `sourceType === "local_path"` (`company-skills.ts:1586`); for a catalog skill
 * it updates the `markdown` column and sets `customized = true`, and
 * `readFile` returns `null` for every non-`SKILL.md` path. The founder's edits
 * therefore live entirely in the column that the merge preserves.
 *
 * The destination is additionally **version-scoped**
 * (`.aoa/marketplace-skills/<company>/<item>/<version>`), so a merge to a new
 * version writes a directory that did not exist and deletes nothing. `overwrite`
 * only matters when a merge is retried at the same version, where the delete
 * removes bytes this same function wrote.
 *
 * ── Stale files, and why the pointer is the fix ─────────────────────────────
 *
 * A file removed upstream must not survive locally. It does not: the new
 * version directory is a fresh copy of the upstream tree, `fileInventory` is
 * recomputed from it, and `catalogBundleInstallPath` is moved onto it in the
 * same transaction — so the consumer reads a tree the removed file was never
 * copied into. The previous version's directory is left on disk, deliberately
 * and consistently with `installSkill` / `applySkillUpdate`: it is unreferenced
 * once the pointer moves, and an `fs.rm` of a path derived from a *stale* row
 * is the exact hazard class Decision #115 refused. Moving the pointer is the
 * correctness fix; reclaiming old version directories is disk hygiene and
 * belongs to a sweeper, not to a founder-facing request.
 *
 * ── Ordering, and the failure state each direction leaves ───────────────────
 *
 * The clone runs BEFORE the transaction, matching `applySkillUpdate`.
 *
 * - **Clone fails:** nothing is committed. The pending row stays `pending`, the
 *   skill row keeps its old markdown, `sourceRef` and bundle pointer, and the
 *   founder retries. The failure is loud and total.
 * - **Transaction fails after the clone:** a directory exists at the new
 *   version, referenced by nothing. The row still points at the old version's
 *   files, which still match its old markdown — self-consistent, just not
 *   advanced. A retry re-materializes the same version over itself
 *   (`overwrite: true`) and commits. The residue is dead disk, not corruption.
 *
 * The reverse order is the bug being fixed, now with a stamped `sourceRef`
 * hiding it. Disk-first fails loudly; DB-first fails silently.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { companySkills, marketplacePendingUpdates } from "@armyofagents/db";
import type { CatalogItem } from "@armyofagents/shared";
import { computeSectionDiff, applyMergeDecisions } from "../marketplace-merge.js";
import {
  deriveBundleTrustLevel,
  managedCatalogSkillDir,
  materializeSkillBundle,
} from "./skill-bundle-materializer.js";

/**
 * Ceiling on the bundle checkout for ONE reviewed merge.
 *
 * A merge touches a single bundle, and a depth-1 fetch of one pinned commit was
 * measured at well under a second per repo (T2.3c: 2.6s for the four repos the
 * crew roster draws from). This is not a performance budget — it exists so a
 * stalled `git` subprocess cannot pin an interactive founder request open for
 * git's own network timeout, which is minutes.
 *
 * No `BundleCheckoutCache` is created: the cache exists to deduplicate
 * repos ACROSS the bundles of one install (17 bundles → 4 repos on the crew
 * bootstrap). One merge is one bundle is one repo, so a cache here would hold
 * exactly one entry and save nothing.
 */
export const SKILL_MERGE_CHECKOUT_TIMEOUT_MS = 60_000;

/** Thrown when the upstream SKILL.md could not be fetched. Route maps to 502. */
export class SkillMergeUpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillMergeUpstreamError";
  }
}

/** The `company_skills` columns the skill merge reads. */
export interface MergeableSkillRow {
  id: string;
  markdown: string | null;
  metadata: unknown;
}

export interface MergeSkillUpdateArgs {
  db: Db;
  companyId: string;
  skill: MergeableSkillRow;
  catalogItem: CatalogItem;
  pendingUpdateId: string;
  /** `marketplace_pending_updates.latestVersion` — the version the founder reviewed against. */
  latestVersion: string;
  decisions: Record<string, "mine" | "theirs">;
}

export interface MergeSkillUpdateResult {
  /** False for a markdown-only catalog skill — there is no bundle to write. */
  bundleMaterialized: boolean;
  /** Where the bundle was written, i.e. the new `catalogBundleInstallPath`. */
  bundlePath?: string;
  fileCount?: number;
}

/**
 * Land a reviewed skill merge: merged markdown into the row, upstream bundle
 * files onto disk, pending update closed.
 *
 * @throws SkillMergeUpstreamError when the upstream SKILL.md fetch fails.
 * @throws Error from {@link materializeSkillBundle} (clone, sha mismatch,
 *   timeout) — in every case before anything is committed.
 */
export async function mergeSkillUpdate(
  args: MergeSkillUpdateArgs,
): Promise<MergeSkillUpdateResult> {
  const { db, companyId, skill, catalogItem, pendingUpdateId, latestVersion, decisions } = args;

  const upstreamContent = await fetchUpstreamSkillMarkdown(catalogItem);
  const diff = computeSectionDiff(skill.markdown ?? "", upstreamContent);
  const merged = applyMergeDecisions(diff, decisions);

  // The bundle is keyed by `catalogItem.version`, NOT by the pending row's
  // `latestVersion`: the bytes come from `catalogItem.skill.bundle`, and the
  // catalog cache can have advanced past the pending row between checker runs
  // (`marketplace-update-checker.ts:206` only bumps `latestVersion` when the
  // checker next runs). Keying the directory off anything but the item that
  // produced it would make `catalogBundleInstallPath` name a tree that was
  // never written there.
  //
  // `sourceRef` keeps stamping `latestVersion`, unchanged from before this fix.
  // If the two ever disagree the row under-reports its version and the next
  // checker pass re-raises the update, which converges; the pointer written
  // below is self-describing either way, so the runtime always reads the tree
  // that was actually materialized.
  const bundle = catalogItem.skill?.bundle;
  const bundleDir = bundle
    ? managedCatalogSkillDir(companyId, catalogItem.id, catalogItem.version)
    : null;
  const materialized = bundle && bundleDir
    ? await materializeSkillBundle(bundle, {
        destination: bundleDir,
        overwrite: true,
        signal: AbortSignal.timeout(SKILL_MERGE_CHECKOUT_TIMEOUT_MS),
      })
    : null;

  await db.transaction(async (tx) => {
    await tx
      .update(companySkills)
      .set({
        // `merged`, never `materialized.markdown` — see the file docblock.
        markdown: merged,
        sourceRef: latestVersion,
        customized: true,
        ...(materialized
          ? {
              trustLevel: deriveBundleTrustLevel(materialized.fileInventory),
              fileInventory: materialized.fileInventory as unknown as Record<string, unknown>[],
              metadata: {
                ...asRecord(skill.metadata),
                catalogSkillBundle: bundle,
                catalogBundleInstallPath: materialized.destination,
              },
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(companySkills.id, skill.id));

    await tx
      .update(marketplacePendingUpdates)
      .set({ status: "applied", updatedAt: new Date() })
      .where(eq(marketplacePendingUpdates.id, pendingUpdateId));
  });

  return materialized
    ? {
        bundleMaterialized: true,
        bundlePath: materialized.destination,
        fileCount: materialized.fileCount,
      }
    : { bundleMaterialized: false };
}

/**
 * The upstream side of the diff.
 *
 * Deliberately the same source `GET /updates/:id/diff` uses — `resourceUrl`, not
 * the bundle's SKILL.md. The founder decides against the sections the diff
 * showed them; taking the merge's upstream from a different document than the
 * review did would let a decision land content that was never on screen.
 */
async function fetchUpstreamSkillMarkdown(catalogItem: CatalogItem): Promise<string> {
  if (!catalogItem.resourceUrl) {
    throw new SkillMergeUpstreamError("Catalog resource URL not available");
  }
  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch(catalogItem.resourceUrl, { signal: AbortSignal.timeout(15000) });
  } catch (err) {
    throw new SkillMergeUpstreamError(
      `Failed to fetch upstream content: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!response.ok) {
    throw new SkillMergeUpstreamError("Failed to fetch upstream content");
  }
  return response.text();
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
