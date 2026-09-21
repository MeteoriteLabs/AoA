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
} from "./transport.js";

/** A native listing entry, as loosely as an SDK may hand it back. */
export interface ListingEntry {
  readonly path?: unknown;
  readonly type?: unknown;
}

/** Reduce a recursive, typed listing of `root` to the contract's files-only result. */
export function filesOnlyFromListing(root: string, entries: readonly ListingEntry[]): string[] {
  if (!root.startsWith("/")) {
    throw new E2bListDirMalformedEntryError(root, "the listed root is not an absolute path");
  }
  if (entries.length > E2B_LIST_DIR_MAX_ENTRIES) {
    throw new E2bListDirBoundExceededError(root, "entries", E2B_LIST_DIR_MAX_ENTRIES);
  }
  const trimmed = root.replace(/\/+$/, "");
  const prefix = `${trimmed}/`;
  const files = new Set<string>();
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
    if (type === "file") files.add(path);
  }
  return [...files].sort();
}
