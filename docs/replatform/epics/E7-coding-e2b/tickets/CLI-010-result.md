# CLI-010 Result - the metadata-only enumeration seam is proven, and the byte-reading helper is fenced

**Status:** `gate_review`
**Date (UTC):** `2026-09-21`
**Epic:** `E7-coding-e2b`
**Plan task:** `E7 implementation-plan ### CLI-010 - prove the enumeration seam, and FENCE the byte-reading one (M1b)`, widened by `E7-D09`
**Implementer:** `M1 CLI-010 build agent (Claude Opus 5)`
**Start SHA:** `66d1f9176` (program tip at start); rebased onto `e5bc0bc81`
**Implementation commit:** `a38f916135bfcfb62414d5048581b58d69c615fd`

The implementer leaves `Status` at `gate_review`. A separate reviewer completes the review section
and is the only role that may change it to `complete`.

★★★ **This is the CAPTURE side of Unit F link 1, and only the enumeration part of it.** It gives the
agent nothing to write. The emit half is `CLI-011` and is still undesigned. **Nothing here is a supply
mechanism, and nothing here means output landed.**

---

## 1. What was found before building, and what was decided

The task said the E2B `listDir` returns **absolute file paths, not directories**. At source, that was
true of the mock only:

- `RealE2bTransport.listDir` (`packages/sandbox-e2b-provider/src/real-transport.ts`) called
  `sandbox.files.list(path)` with no options and kept only `e.path ?? e.name`. It **discarded
  `type`**.
- The installed SDK is `e2b@2.30.5` (`node_modules/.pnpm/e2b@2.30.5/node_modules/e2b`, after
  `pnpm install --frozen-lockfile` in this worktree). In `dist/index.js`, class `Filesystem2`,
  method `list(path2, opts)` sends `depth: opts?.depth ?? 1` to the `listDir` RPC. For each entry it
  **skips any whose wire type `mapFileType` cannot map** (only FILE→`"file"` and
  DIRECTORY→`"dir"` are mapped). It returns `mapEntryInfo(e)` objects `{name, type, path, …}`.
  The typed shape is `EntryInfo extends WriteInfo` (`dist/index.d.ts`) with `type?: FileType`.
- The result: the old real binding returned the root's immediate children, **directories mixed in**,
  and **no nested file**. RED below confirms it: `['/out/a.txt', '/out/sub', '/out/empty']`.

The build agent stopped and reported this. The planning session then decided **Option 1: widen
`CLI-010` to fix the seam**. That is recorded as **`E7-D09`** in
[`../decisions.md`](../decisions.md), **decided under founder delegation F2**, with the reasons.

## 2. What shipped

| File | Change |
|---|---|
| `packages/sandbox-e2b-provider/src/transport.ts` | `listDir` doc now states the contract: files only, recursive, absolute, strictly under root, sorted, bounded. New named constants `E2B_LIST_DIR_MAX_ENTRIES` (100,000) and `E2B_LIST_DIR_MAX_DEPTH` (64). New named errors `E2bListDirBoundExceededError` (`bound: "entries" \| "depth"`, `limit`) and `E2bListDirMalformedEntryError`. |
| `packages/sandbox-e2b-provider/src/list-dir-contract.ts` | **New, pure, and SDK-free.** `filesOnlyFromListing(root, entries)` is the ONE enforcer. It rejects a relative root. It throws on more than MAX_ENTRIES entries, on an entry whose path is not under root or is not a string, on an entry whose `type` is neither `file` nor `dir`, and on an entry deeper than MAX_DEPTH. It keeps only files, dedupes and sorts. |
| `packages/sandbox-e2b-provider/src/real-transport.ts` | `listDir` calls `sandbox.files.list(path, { depth: E2B_LIST_DIR_MAX_DEPTH + 1 })` in **one** call, so any entry past the bound comes back and trips it rather than being cut off. A non-array response throws. The typed entries go to the enforcer. |
| `packages/sandbox-e2b-provider/src/mock-transport.ts` | Uses the same enforcer. The in-memory fs holds files only, so the mock synthesises each implied directory, which makes the entry-count bound count what a real recursive listing would. Change: the listed root itself is no longer returned. |
| `packages/sandbox-e2b-provider/src/index.ts` | Re-exports the two errors and two constants. |
| `packages/worker-daemon/src/snapshot/enumerate-sandbox.ts` | **New.** `enumerateSandboxOutputPaths(listDir, root)` returns `Promise<readonly string[]>` of relative workspace paths in UTF-8 byte order. It takes `listDir` only: **no `readFile`, no digest, no bytes**. Fail-closed rules: a path not under root (or equal to root) throws, and so does a path whose relative form fails `isSafeWorkspacePath`. A duplicate throws. So does a listed path that is an **ancestor** of another listed path, which is a leaked directory. It imports only `@armyofagents/worker-protocol` and `./errors.js`. It is **not exported** from `snapshot/index.ts` or the package barrel. |
| `packages/worker-daemon/src/snapshot/capture-sandbox.ts` | **Header only.** Adds a `FENCE — LOCAL-LANE ONLY` note: the helper reads and hashes bytes in the daemon, which breaches E7-D06 / Option D on the E2B and networked lanes. The header points to the enumerator as the seam for those lanes. The old *"the E2B-sourced analogue"* claim is corrected and kept as a `Superseded text:` quote. The `listDir` field comment now cites the contract. |
| `packages/sandbox-e2b-provider/src/__tests__/list-dir-files-only.test.ts` | **New**, 11 tests (§3). |
| `packages/worker-daemon/src/__tests__/sandbox-listdir-binding.test.ts` | **New**, 10 tests (§3). |
| `scripts/test-inventory.json` | Pinned counts +1 each: `sandbox-e2b-provider` 18→19 and `worker-daemon` 164→165. Floors were not touched. |
| `docs/replatform/epics/E7-coding-e2b/decisions.md` | First entry, `E7-D09`. `E7-D08` is left reserved for `CLI-012`'s `kind` decision. |
| `implementation-plan.md` `### CLI-010`, `program-design.md` `#### CLI-010` | Dated correction notes (history kept) covering the false files-only claim and the widened Files list. |

## 3. Evidence

### RED, before implementation (test files written first)

- **`list-dir-files-only.test.ts`: 10 of 11 tests failed.** The substantive failures came from the old
  real binding:
  - *"returns ONLY files, recursively"*: `expected [ '/out/a.txt', '/out/sub', …(1) ] to deeply equal [ Array(3) ]`.
  - *"BINDING: no returned path is a directory"*: `expected [ '/out/sub', '/out/empty' ] to deeply equal []`.
  - *mock "files only, strictly under the root"*: `expected [ '/out', '/out/a.txt', …(1) ]`. The old mock returned the root itself.
  - The bound and error tests failed because the constants and errors did not exist.
- **`sandbox-listdir-binding.test.ts`**: failed to load (`Failed to load url ../snapshot/enumerate-sandbox.js`). The enumerator did not exist.
- `capture-sandbox.test.ts`: 6 of 6 passed, both before and after.

### GREEN, local on Windows, at `a38f91613`

| Command | Result |
|---|---|
| `pnpm --filter @armyofagents/worker-protocol build` | exit 0 |
| `pnpm --filter @armyofagents/worker-daemon exec vitest run src/__tests__/capture-sandbox.test.ts src/__tests__/sandbox-listdir-binding.test.ts` (focused verify, row `CLI-010`) | **2 files, 16 tests passed** |
| `pnpm check:worker-daemon-boundary` | `worker daemon boundary: PASS` |
| `pnpm --filter @armyofagents/worker-daemon typecheck` / `build` | exit 0 / exit 0 |
| `pnpm --filter @armyofagents/sandbox-e2b-provider typecheck` / `build` | exit 0 / exit 0 |
| `sandbox-e2b-provider` full `vitest run` | 16 files passed, 3 skipped (keyed); **139 passed**, 31 skipped (keyed). `list-dir-files-only.test.ts` **11/11** |
| `worker-daemon` full `vitest run` | **158 files, 1049 passed**, 1 skipped |
| Full guard set (`M1-AGENT-RULES`) + `check-evidence-immutability --base origin/docs/replatform-program` | see §5 |

### Mutation and positive-control table (each mutation was reverted afterwards)

| # | Mutation | Red tests |
|---|---|---|
| M1 | enforcer keeps directories (`files.add(path)` unconditionally) | provider: **4 failed**, including *returns ONLY files* and *BINDING: no returned path is a directory* |
| M2 | depth bound disabled | provider: **2 failed** (the real and mock *DEPTH BOUND* tests) |
| M3 | entry-count bound disabled | provider: **1 failed** (*ENTRY BOUND*) |
| M4 | untyped entries accepted | provider: **1 failed** (*no usable type FAILS LOUDLY*) |
| M7 | real binding back to `files.list(path)` (SDK default depth 1) | provider: **4 failed**, including the nested-files and *asks for depth MAX+1* tests |
| M5 | enumerator's leaked-directory (ancestor) check disabled | daemon: **1 failed** (*FAILS LOUDLY when listDir leaks a directory*) |
| M6 | a `readFile` reference added to the enumerator's code | daemon: **1 failed** (*POSITIVE CONTROL — the enumerator's dependency surface reads no bytes*) |
| M8 | `captureSandboxEntries` exported from `snapshot/index.ts` | daemon: **1 failed** (*neither barrel exports …*) |
| M9 | `isSafeWorkspacePath` refusal disabled | daemon: **1 failed** (*unsafe relativised path*) |

★ The byte-free positive control (M6) is a **source scan**. It strips comments, then requires the
import set to be exactly `{@armyofagents/worker-protocol, ./errors.js}` and forbids `readFile`,
`sha256`, `digest`, `hashing`, `capture-sandbox`, `Uint8Array` and `node:` in the code. It catches
the seam taking on a byte read. It would not catch bytes pulled in through a newly allowed import,
but any such import changes the pinned import set and turns the test red.

### CI

Filled in after CI on the PR head, in a later commit. Jobs and executed counts are recorded in §7.

## 4. Choices and contradictions recorded

1. **Interfaces vs Files.** The task's Interfaces and RED name a new metadata-only enumerator, but its
   Files list creates only a test. I read the task text as requiring the enumerator. It lives in a
   **new module** (`snapshot/enumerate-sandbox.ts`) and is **not exported** from `snapshot/index.ts`
   or the package barrel. The planning session accepted this reading. The plan's Files list now
   carries a dated widening note.
2. **Migration vs Rollback wording.** The task's *Migration/compatibility* line says "additive
   export", but its *Rollback* line says "nothing was exported, so there is no export to revert". They
   contradict each other. I followed Rollback: nothing is barrel-exported, and the only new public
   surface is the provider package's errors and constants. The contradiction is recorded here, and the
   task text is left as written.
3. **The `lease/` → `snapshot/` path.** The brief placed the capture helper at
   `packages/worker-daemon/src/lease/capture-sandbox.ts`. It is at
   `packages/worker-daemon/src/snapshot/capture-sandbox.ts`. **A search of `docs/` at this revision
   finds no `lease/capture-sandbox` string**: the task section, the unit-link table and
   `program-design.md` all already say `snapshot/`. The wrong path was in the build brief only, so no
   doc edit was needed. The one nearby `lease/` citation, `lease/artifact-export.ts` in
   `program-design.md`, is correct.
4. **What the daemon-side test can and cannot see.** A bare string carries no type, so the
   enumerator's ancestor check catches a leaked directory **that has listed contents**, but not a
   leaked **empty** directory. The transport is the authority there, and its binding test is the
   one that fails if any directory path is returned. The worker-daemon test cannot compose the real
   transport, because `sandbox-e2b-provider` depends on `worker-daemon` and not the reverse. So the
   binding is split across the two suites, and each names the other.

## 5. Guards

Run before push, on the rebased head: the full `pr.yml` guard set minus the six excluded by the rules,
plus `check-evidence-immutability --base origin/docs/replatform-program`.

## 6. Not proven here

★★★ **The real SDK's behaviour on a live sandbox is still unproven.** Every arm above drives the
**shipping** `RealE2bTransport.listDir` through the injected-SDK seam. The fake `files.list`
reproduces the installed SDK's documented shape. That proves this code's logic. It proves **nothing**
about what a real envd returns. The open questions are how `depth > 1` behaves in practice, and what
happens to entry kinds (for example symlinks) that the SDK drops before they reach the binding. That
is **`CLI-012`'s keyed real-run acceptance**. No keyed workflow was dispatched for this ticket.

## 7. CI evidence

_Pending: filled in after CI on the PR head._

## Independent review

**Reviewer:** _pending_
**Reviewed revision:** _pending_
**Disposition:** _pending_
**Attempt:** _none yet_

For `approved`, check each claim above against its named source at the reviewed revision. In
particular, confirm three things: the SDK citation (`e2b@2.30.5`, `Filesystem2.list`,
`mapFileType`/`mapEntryInfo`); that neither barrel exports the enumerator or `captureSandboxEntries`;
and that §6's "not proven" is accepted as such rather than read as passing. Then change the top-level
`Status` to `complete` and commit that disposition separately.

## Review attempt history

The implementation author leaves the table body empty. The first independent reviewer appends attempt 1, and later reviewers append rows with increasing attempt numbers without replacing earlier ones. Do not include a `Review commit` column: a row cannot embed the SHA of the commit that first contains it.

| Attempt | Reviewer | Reviewed revision | Disposition | Evidence/findings |
|---:|---|---|---|---|
<!-- The first reviewer appends attempt 1 below. -->
