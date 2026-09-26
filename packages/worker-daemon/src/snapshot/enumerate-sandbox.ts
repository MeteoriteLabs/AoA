// packages/worker-daemon/src/snapshot/enumerate-sandbox.ts
//
// CLI-010 (E7-D09) — the METADATA-ONLY enumeration seam Unit F link 3 needs: which output
// files a sandbox holds under a designated output root, as relative workspace paths.
//
// ★ NO BYTES. This module takes a `listDir` and nothing else: no `readFile`, no digest, no
// file content ever reaches the daemon through it (E7-D06 — grants inbound, references
// outbound, never bytes). The size and sha256 the frozen export grant needs come from the
// provider's `digestArtifact`, which returns `{sha256, sizeBytes}` and no content. The
// byte-reading `captureSandboxEntries` (`capture-sandbox.ts`) is the LOCAL-LANE tool and must
// not be used on the E2B/networked lanes.
//
// The injected `listDir` is the provider's `listDir(sandboxId, path)` PRE-BOUND to the
// sandbox, under the `E2bTransport.listDir` contract: FILES ONLY, recursively, absolute paths
// strictly under the root, bounded (the transport throws rather than truncating).
//
// FAIL-CLOSED, the same as the capture helper: a listed path not under `root`, or whose
// relativised form fails `isSafeWorkspacePath`, THROWS. As a second line behind the transport
// contract it also throws on a listed path that is an ANCESTOR of another listed path (a
// directory leaked into a files-only listing) and on a duplicate. It cannot detect a leaked
// EMPTY directory — a bare string carries no type — so the transport is the authority there.
//
// Boundary-legal (E4-D01): imports only `@armyofagents/worker-protocol` and a relative module;
// no `node:*` API, no provider package.
//
// ★ INERT BY DESIGN: not exported from `snapshot/index.ts` or the package barrel. Calling it
// (and deciding its export) is CLI-012's.

import { isSafeWorkspacePath } from "@armyofagents/worker-protocol";
import { WorkspaceSnapshotError } from "./errors.js";

/** Provider `listDir(sandboxId, path)` PRE-BOUND to the sandbox (files only, recursive,
 * absolute, bounded — the `E2bTransport.listDir` contract). */
export type SandboxListDir = (path: string) => Promise<readonly string[]>;

/** Ascending UTF-8 byte order (the snapshot ordering authority), without importing the
 * hashing module into this byte-free surface. */
function byUtf8(a: string, b: string): number {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  const len = Math.min(x.length, y.length);
  for (let i = 0; i < len; i += 1) {
    if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  }
  return x.length === y.length ? 0 : x.length < y.length ? -1 : 1;
}

/** Enumerate the output files under `root` as sorted relative workspace paths (fail-closed). */
export async function enumerateSandboxOutputPaths(listDir: SandboxListDir, root: string): Promise<readonly string[]> {
  const prefix = root.endsWith("/") ? root : `${root}/`;
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const absolute of await listDir(root)) {
    if (!absolute.startsWith(prefix) || absolute.length === prefix.length) {
      throw new WorkspaceSnapshotError(`listed path ${absolute} is not under output root ${root}`);
    }
    const path = absolute.slice(prefix.length);
    if (!isSafeWorkspacePath(path)) {
      throw new WorkspaceSnapshotError(`unsafe workspace path ${JSON.stringify(path)} listed under ${root}`);
    }
    if (seen.has(path)) {
      throw new WorkspaceSnapshotError(`listDir returned ${absolute} more than once under ${root}`);
    }
    seen.add(path);
    paths.push(path);
  }
  paths.sort(byUtf8);
  for (let i = 0; i + 1 < paths.length; i += 1) {
    // Sorted by UTF-8 bytes, a directory "d" is immediately followed by the first "d/…" entry
    // unless some "d<c>" with c < "/" sits between — so check every later sibling run.
    for (let j = i + 1; j < paths.length && paths[j].startsWith(paths[i]); j += 1) {
      if (paths[j].startsWith(`${paths[i]}/`)) {
        throw new WorkspaceSnapshotError(
          `listDir returned directory ${prefix}${paths[i]} (it contains ${prefix}${paths[j]}) — the listing must be files only`,
        );
      }
    }
  }
  return paths;
}
