// -----------------------------------------------------------------------------
// CLI-010 (E7-D09) — the ONE place the `E2bTransport.listDir` contract is enforced.
//
// Both transports reduce their native listing to typed `{path, type}` entries and hand
// them here, so the real SDK binding and the mock cannot drift apart:
//
//   FILES ONLY (directories are dropped), RECURSIVE (the caller lists every level up to the
//   depth bound), ABSOLUTE paths strictly under the root, sorted, and BOUNDED — a breach of
//   E2B_LIST_DIR_MAX_ENTRIES / E2B_LIST_DIR_MAX_DEPTH throws a named error. Nothing is ever
//   silently dropped: an entry that cannot be classified file-vs-directory, or that does not
//   sit under the root, throws too.
//
// SDK-free and key-free (pure), so the no-key suite pins it.
// -----------------------------------------------------------------------------

import {
  E2B_LIST_DIR_MAX_DEPTH,
  E2B_LIST_DIR_MAX_ENTRIES,
  E2bListDirBoundExceededError,
  E2bListDirMalformedEntryError,
  type E2bDirEntry,
} from "./transport.js";

/** A native listing entry, as loosely as an SDK may hand it back. */
export interface ListingEntry {
  readonly path?: unknown;
  readonly type?: unknown;
  /**
   * CLI-012 (ruling F7) — PRESERVED, not discarded. The SDK sets this on a symlink even while
   * reporting `type: "file"` (P-011 probe, arm `S-P5`), so dropping it is what made the
   * `A-O2-4` refusal unimplementable.
   */
  readonly symlinkTarget?: unknown;
  /** CLI-012 (`E5-F009`) — PRESERVED. Arm `S-P6` measured the SDK reporting a correct size. */
  readonly size?: unknown;
}

/**
 * Reduce a recursive, typed listing of `root` to the contract's files-only result.
 *
 * ★ CLI-012 widened the RESULT (`E2bDirEntry[]`, carrying the link marker and the size) and
 * changed NOTHING about the contract itself: files-only, recursive, absolute-under-root, sorted
 * and bounded all stand exactly as `E7-D09` decided them. A symlink is NOT dropped here — it is
 * a file-typed entry that is MARKED, so the consumer can refuse it with a classification rather
 * than silently losing it (`E5-D07`: one refusal never drops the others).
 */
export function filesOnlyFromListing(root: string, entries: readonly ListingEntry[]): E2bDirEntry[] {
  if (!root.startsWith("/")) {
    throw new E2bListDirMalformedEntryError(root, "the listed root is not an absolute path");
  }
  if (entries.length > E2B_LIST_DIR_MAX_ENTRIES) {
    throw new E2bListDirBoundExceededError(root, "entries", E2B_LIST_DIR_MAX_ENTRIES);
  }
  const trimmed = root.replace(/\/+$/, "");
  const prefix = `${trimmed}/`;
  const files = new Map<string, E2bDirEntry>();
  for (const entry of entries) {
    const path = entry?.path;
    if (typeof path !== "string" || !path.startsWith(prefix) || path.length === prefix.length) {
      throw new E2bListDirMalformedEntryError(root, `path ${JSON.stringify(path)} is not an absolute path under the root`);
    }
    const type = entry.type;
    if (type !== "file" && type !== "dir") {
      throw new E2bListDirMalformedEntryError(root, `entry ${path} has no file/dir type (${JSON.stringify(type)})`);
    }
    const depth = path.slice(prefix.length).split("/").length;
    if (depth > E2B_LIST_DIR_MAX_DEPTH) {
      throw new E2bListDirBoundExceededError(root, "depth", E2B_LIST_DIR_MAX_DEPTH);
    }
    if (type !== "file") continue;
    // ★ A SIZE THAT CANNOT BE READ IS MALFORMED, NEVER 0. `E5-F009`'s admission check is applied
    // from this number: defaulting an unreadable one to 0 would admit an unbounded file as a
    // zero-byte one, which is a check that evaluates nothing.
    const size = entry.size;
    if (typeof size !== "number" || !Number.isFinite(size) || size < 0) {
      throw new E2bListDirMalformedEntryError(root, `entry ${path} has no byte size (${JSON.stringify(size)})`);
    }
    // ★ THE MARKER IS PRESENCE, not target shape: any non-empty `symlinkTarget` means the SDK
    // resolved this entry through a link, whatever it points at.
    const symlinkTarget = entry.symlinkTarget;
    const symlink = typeof symlinkTarget === "string" && symlinkTarget.length > 0;
    files.set(path, { path, sizeBytes: size, symlink });
  }
  return [...files.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
