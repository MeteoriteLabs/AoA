/**
 * @fileoverview The managed marketplace-skills root, and the containment check
 * that jails it (plan task T2.8c(b)).
 *
 * `managedCatalogSkillDir(...)` materializes every catalog skill bundle under
 * `<cwd>/.aoa/marketplace-skills/<company>/<item>/<version>`. The catalog
 * installer is the ONLY writer that tree is meant to have: a re-materialize
 * stages-and-renames a fresh copy of the upstream tree, and `trustLevel` /
 * `fileInventory` on the row describe exactly those bytes. Anything else
 * writing there would make the row's description of what an agent executes a
 * lie.
 *
 * Two founder-reachable chains could otherwise get a differently-typed row —
 * one whose editability is gated on its `sourceType`, not on its path — to name
 * a directory inside this root and then write into it:
 *
 *   - `POST /companies/:cid/skills/import` with `source` set to a bundle dir
 *     produces a `local_path` row, after which `PATCH /skills/:id/files` writes
 *     inside it.
 *   - `PATCH /agents/:id/instructions-bundle` with `mode: "external"` accepts
 *     any absolute `rootPath`, then both writes and `fs.rm`s inside it.
 *
 * {@link isInsideManagedMarketplaceSkillsRoot} lets both chains reject such a
 * path with one shared check rather than two divergent copies.
 *
 * Containment is `path.resolve`-based, matching the rest of the server's jails
 * (`resolvePathWithinRoot` in `agent-instructions.ts`,
 * `validatePackageFileKey`). On case-insensitive filesystems (win32/darwin —
 * and win32 is the primary platform) the compared paths are lower-cased first,
 * so a case-variant like `.AOA\Marketplace-Skills\…` — which names the SAME
 * directory the OS would open — cannot slip past a case-sensitive string
 * compare and defeat the jail. It does NOT resolve symlinks, 8.3 short names
 * (`MARKET~1`), or UNC/`\\?\` prefixes; the threat model is an authenticated
 * founder holding an invariant, not an anonymous escape, and those vectors are
 * consistent with the rest of the codebase's `path.resolve` jails.
 */
import path from "node:path";

/**
 * Filesystems where two paths differing only in case name the same directory.
 * Comparisons are lower-cased on these so a case-variant path can't bypass the
 * jail (Linux is case-sensitive, so it is compared verbatim).
 */
const CASE_INSENSITIVE_FS = process.platform === "win32" || process.platform === "darwin";

/** Resolve to absolute, then fold case on case-insensitive filesystems. */
function normalizeForContainment(candidatePath: string): string {
  const resolved = path.resolve(candidatePath);
  return CASE_INSENSITIVE_FS ? resolved.toLowerCase() : resolved;
}

/**
 * The parent of every {@link managedCatalogSkillDir}. Keyed off `process.cwd()`
 * so it always agrees with where bundles are actually materialized — do not
 * swap this for `resolveAoaInstanceRoot()`, which is a different (AOA_HOME-aware)
 * base used for managed *instruction* bundles.
 */
export function managedMarketplaceSkillsRoot(): string {
  return path.join(process.cwd(), ".aoa", "marketplace-skills");
}

/**
 * True when `candidatePath` resolves to the managed marketplace-skills root or
 * anything nested inside it. A path equal to the root, or on a different drive,
 * or above/beside the root, is not contained.
 */
export function isInsideManagedMarketplaceSkillsRoot(candidatePath: string): boolean {
  const root = normalizeForContainment(managedMarketplaceSkillsRoot());
  const candidate = normalizeForContainment(candidatePath);
  if (candidate === root) return true;
  const rel = path.relative(root, candidate);
  return rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel);
}
