// packages/worker-daemon/src/snapshot/capture-sandbox.ts
//
// CLI-008 Unit F (link 1) — capture an agent's output directory FROM THE SANDBOX into a
// deterministic `WorkspaceEntry[]`.
//
// This is the E2B-sourced analogue of DAT-001's local-FS walk (`build-manifest.ts`): the
// provider's `listDir`/`readFile` seam replaces `readdirSync`/`readFileSync`, so the same
// content manifest can be built from a running sandbox rather than a granted host folder. It is
// the "in-sandbox capture that does not exist" named by `CLI-008-unit-f-design.md` §1.2 — the
// missing link 1 that `buildWorkspacePatch`/`createResultCommitter` (both built, both unwired)
// have nothing to consume without.
//
// Deliberately NARROW to the Unit-F shape-(a) convention: capture a designated OUTPUT PATH the
// agent was told to write to, against an EMPTY base downstream (→ all `create` ops). No git base,
// no ignore policy, no Unit-E workspace — those are DAT-001's concern, not this.
//
// The provider seam is INJECTED (`listDir`/`readFile` already bound to the sandbox id), so this
// module touches no `node:*` API and no provider package — boundary-legal (worker-protocol +
// relative modules only, E4-D01), and unit-testable with an in-memory sandbox.
//
// FAIL-CLOSED: a listed path that does not sit under `root`, or whose relativised form is not a
// safe workspace path (`isSafeWorkspacePath`), THROWS rather than being captured. A capture that
// silently dropped or mangled a path would commit an artifact that misrepresents the sandbox.

import type { WorkspaceEntry } from "@armyofagents/worker-protocol";
import type { Sha256Fn } from "./hashing.js";

export interface SandboxCaptureDeps {
  /** Provider `listDir(sandboxId, path)` PRE-BOUND to the sandbox — the ABSOLUTE paths of the
   * files under `root` (the E2B transport enumerates files, not directories). */
  readonly listDir: (path: string) => Promise<readonly string[]>;
  /** Provider `readFile(sandboxId, path)` PRE-BOUND to the sandbox. */
  readonly readFile: (path: string) => Promise<Uint8Array>;
  /** Injected sha256 (lowercase hex) — the SAME seam DAT-001 uses. */
  readonly sha256: Sha256Fn;
}

export async function captureSandboxEntries(deps: SandboxCaptureDeps, root: string): Promise<WorkspaceEntry[]> {
  // TDD stub (red): enumerates but captures nothing until the real logic lands in green.
  await deps.listDir(root);
  return [];
}
