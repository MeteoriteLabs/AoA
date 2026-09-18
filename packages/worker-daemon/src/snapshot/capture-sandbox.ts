// packages/worker-daemon/src/snapshot/capture-sandbox.ts
//
// CLI-008 Unit F (link 1) — capture an agent's output directory FROM THE SANDBOX into a
// deterministic, plain `CapturedFileEntry[]`.
//
// This is the E2B-sourced analogue of DAT-001's local-FS walk (`build-manifest.ts`): the
// provider's `listDir`/`readFile` seam replaces `readdirSync`/`readFileSync`, so the same
// content manifest can be built from a running sandbox rather than a granted host folder. It is
// the "in-sandbox capture that does not exist" named by `CLI-008-unit-f-design.md` §1.2 — the
// missing link 1 that `buildWorkspacePatch`/`createResultCommitter` (both built, both unwired)
// have nothing to consume without.
//
// ★ Returns PLAIN, UNBRANDED entries. The frozen `workspaceEntrySchema` brands its `sha256`
// (`BRAND<"Sha256Digest">`) and `path`, so the branding authority is `.parse()`, not this
// producer: link-1b assembles these into a `WorkspaceManifestV1` and runs the schema, which
// validates + brands the whole set. Keeping capture a pure data producer avoids scattering
// brand casts and keeps the fail-closed validation in one place.
//
// Deliberately NARROW to the Unit-F shape-(a) convention: capture a designated OUTPUT PATH the
// agent was told to write to, against an EMPTY base downstream (→ all `create` ops). No git base,
// no ignore policy, no Unit-E workspace — those are DAT-001's concern, not this. Entries carry
// `provenance: "untracked"`, matching how `build-manifest.ts` labels every content_manifest file.
//
// The provider seam is INJECTED (`listDir`/`readFile` already bound to the sandbox id), so this
// module touches no `node:*` API and no provider package — boundary-legal (worker-protocol +
// relative modules only, E4-D01), and unit-testable with an in-memory sandbox.
//
// FAIL-CLOSED: a listed path that does not sit under `root`, or whose relativised form is not a
// safe workspace path (`isSafeWorkspacePath`), THROWS rather than being captured. A capture that
// silently dropped or mangled a path would commit an artifact that misrepresents the sandbox.

import { isSafeWorkspacePath } from "@armyofagents/worker-protocol";
import { compareUtf8, type Sha256Fn } from "./hashing.js";
import { WorkspaceSnapshotError } from "./errors.js";

export interface SandboxCaptureDeps {
  /** Provider `listDir(sandboxId, path)` PRE-BOUND to the sandbox — the ABSOLUTE paths of the
   * files under `root` (the E2B transport enumerates files, not directories). */
  readonly listDir: (path: string) => Promise<readonly string[]>;
  /** Provider `readFile(sandboxId, path)` PRE-BOUND to the sandbox. */
  readonly readFile: (path: string) => Promise<Uint8Array>;
  /** Injected sha256 (lowercase hex) — the SAME seam DAT-001 uses. */
  readonly sha256: Sha256Fn;
}

/** A captured FILE entry — plain (unbranded) data. Structurally a `workspaceEntrySchema` file
 * entry minus the branding, which link-1b applies via `.parse()`. Directories are not represented
 * (the E2B transport lists files, and the downstream patch diff ignores directory entries). */
export interface CapturedFileEntry {
  readonly path: string;
  readonly kind: "file";
  readonly provenance: "untracked";
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly executable: false;
}

/** Strip the absolute in-sandbox `root` prefix → a relative workspace path (fail-closed). */
function relativise(absolute: string, root: string): string {
  const prefix = root.endsWith("/") ? root : `${root}/`;
  if (!absolute.startsWith(prefix)) {
    throw new WorkspaceSnapshotError(`captured path ${absolute} is not under output root ${root}`);
  }
  return absolute.slice(prefix.length);
}

export async function captureSandboxEntries(deps: SandboxCaptureDeps, root: string): Promise<CapturedFileEntry[]> {
  const entries: CapturedFileEntry[] = [];
  for (const absolute of await deps.listDir(root)) {
    const path = relativise(absolute, root);
    if (!isSafeWorkspacePath(path)) {
      throw new WorkspaceSnapshotError(`unsafe workspace path ${JSON.stringify(path)} captured under ${root}`);
    }
    const bytes = await deps.readFile(absolute);
    entries.push({
      path,
      kind: "file",
      provenance: "untracked",
      sizeBytes: bytes.byteLength,
      sha256: deps.sha256(bytes),
      executable: false,
    });
  }
  // Deterministic: ascending UTF-8 byte order over the (unique) relative path.
  entries.sort((a, b) => compareUtf8(a.path, b.path));
  return entries;
}
