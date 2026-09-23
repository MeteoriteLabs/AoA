# CLI-012 Result — the worker-side output producer: the ruled root is enumerated, refused per file, and committed

**Status:** `gate_review`
**Date (UTC):** `2026-09-23`
**Epic:** `E7-coding-e2b`
**Plan task:** `E7 implementation-plan ### CLI-012 — the producer: capture → export requests → the sequencer (M, ≤3 agent-days, M1b)`, as amended by ruling **F7** (`../decisions.md`, `E7-D11`)
**Implementer:** `M1 CLI-012 build agent (Claude Opus 5)`
**Start SHA:** `a00009a915` (program tip at start, `docs/replatform-program`)
**Implementation commit:** recorded in §9.

The implementer leaves `Status` at `gate_review`. A separate reviewer completes the review section
and is the only role that may change it to `complete`.

★★★ **WHAT IS AND IS NOT PROVEN.** This ticket is proven against a **fixture sandbox**, on both
lanes, end to end through the real sequencer. **Its real-run half is NOT run**, and cannot be by this
ticket: it pairs with `CLI-017` (the emit build), which is **filed and not built**, so no real run
writes anything under `R` yet, and keyed lanes are the planning session's to dispatch. §8 states
exactly what remains pending, including the **deliberate symlink-swap attempt** `E7-F039` owes on a
real run.

---

## 1. The first act: the SDK measurement ruling F7 told this ticket to make

`E7-D11` (*What this ruling does NOT decide*) authorized **two** implementations of the `A-O2-4`
symlink refusal and required this ticket to **measure**, against the installed SDK, which is
reachable — *"do not guess it"*.

**Measured**, in this worktree after `pnpm install --frozen-lockfile`, against
`e2b@2.30.5` (the version `packages/sandbox-e2b-provider/package.json` pins; resolved to
`C:/pn/b012/e2b@2.30.5/node_modules/e2b`, `package.json` `"version": "2.30.5"`), reading
`dist/index.d.ts`:

| Question | Measured answer |
|---|---|
| Any no-follow flag on a read? | **NO.** `interface FilesystemReadOpts extends FilesystemRequestOpts` carries exactly `gzip?: boolean` and `streamIdleTimeoutMs?: number`; `FilesystemRequestOpts` adds `requestTimeoutMs` and `signal`. |
| Any handle/fd-bound read? | **NO.** `Filesystem.read` has four overloads, all keyed on `opts.format` (`text` / `bytes` / `blob` / `stream`) and all taking a **path**. |
| Any no-follow token anywhere in the package's types? | **NO.** `grep -ci 'nofollow\|noFollow\|followSymlink' dist/index.d.ts` → `0`. |
| An `lstat`-shaped op? | **YES.** `getInfo(path, opts?): Promise<EntryInfo>`, and `EntryInfo` carries `size: number`, `type?: FileType` and `symlinkTarget?: string` (*"If the filesystem object is a symlink, this is the target"*). |
| A bounded/streaming read? | **YES.** `read(path, opts & {format: 'stream'}): Promise<ReadableStream<Uint8Array>>`. |

### ★ BRANCH TAKEN, recorded as the ruling requires: **the per-entry `lstat`** (the second means)

The atomic open-and-read is **unreachable through the plain SDK**, so the pre-authorized fallback is
taken and its **+1 agent-day** is carried. It is implemented as
`E2bTransport.statEntry` → `RealE2bTransport.statEntry` over `Filesystem.getInfo`, called by
`E2bSandboxProvider.#readArtifactBytes` — the ONE place both `digestArtifact` and `exportArtifact`
read through — which refuses an entry whose own stat says `symlink: true`.

★★★ **It is NOT presented as atomic.** It is a check-then-read pair and the code says so in terms.
The residual is `E7-F039`, which **stays open**, bounded by `SD-5` exactly as that entry records.
The doubly-negative STOP condition (*"both the primitive is absent AND a per-entry `lstat` proves
unavailable"*) did **not** fire: `getInfo` exists.

---

## 2. What was built

### 2.1 The seam, widened (the transport and the contract)

`RealE2bTransport.listDir` returned `readonly string[]`: `filesOnlyFromListing` used the SDK's `type`
only to drop directories and **discarded `symlinkTarget` and `size`**. The P-011 probe (run
[`35833717162`](https://github.com/MeteoriteLabs/AoA/actions/runs/35833717162), arm `S-P5`) measured
the consequence live — the link arrives typed `"file"` while `files.read` follows it.

- `packages/sandbox-e2b-provider/src/transport.ts` — new `E2bDirEntry` (`{path, sizeBytes, symlink}`);
  `listDir` now returns `readonly E2bDirEntry[]`; `readFile` takes `opts?: {maxBytes?}`; new
  `statEntry`; new `E2bReadBoundExceededError` and `E2bSymlinkRefusedError`.
- `list-dir-contract.ts` — `filesOnlyFromListing` preserves `symlinkTarget` (as a boolean marker) and
  `size`, and **refuses** an entry with no readable size rather than defaulting it to `0`.
  ★ **`E7-D09` is not reopened:** files-only, recursive, absolute-under-root, sorted and bounded are
  unchanged, and the bound constants are untouched.
- `real-transport.ts` — carries the SDK metadata through; `readFile` with a bound uses
  `format: "stream"` and `readStreamBounded`; `statEntry` maps `getInfo` through the fail-closed
  `entryFromInfo`.
- `mock-transport.ts` — models the **same** contract (`E7-F014`'s class is a mock modelling the
  opposite one): a link is listed as a file **with** a marker, `readFile` **follows** it, `statEntry`
  describes the path.

### 2.2 The port (this ticket's, per its graph node)

- `packages/worker-daemon/src/supervisor/provider.ts` — `SandboxOutputEntry`,
  `EnumerateOutputsResult`, `SandboxEnumerationMode`, and a fenced
  `enumerateOutputs(sandboxId, root, ctx)`. **No content field**, and `enumerate_outputs` joins
  `DeclinableOperation` only — the frozen `PROVIDER_OPERATIONS` vocabulary is untouched (`E4-D02`).
- `supervisor/effect-authority.ts` — `enumerateOutputs` is **guarded**, like `digestArtifact`. An
  ungated enumeration would be the second, quieter door onto a gated action.
- `supervisor/noop-provider.ts` — declares `"none"` and throws.
- `sandbox-e2b-provider/e2b-provider.ts` — implements it over the private `#transport.listDir`,
  budget-bounded, declaring `sandboxEnumerationMode = "metadata"`.
- `provider-wire/driver.ts` — the networked binding, which had **no** enumeration; it validates the
  response rather than trusting it (see §5).
- `adapter-manager/server.ts` — the matching route, in `GATE_REQUIRED_OPS` **and** the `routeGated`
  switch, through `gateOwnedOp` (the `stage_files` precedent, `E7-F011`). Without both, the server
  404s the op and the driver binding is unreachable.

### 2.3 The producer

`packages/worker-daemon/src/lease/export-request-producer.ts` —
`createExportRequestProducer({enumerate, outputRoot?, kind, retention, contentTypeFor?, onRefused?})`
returning exactly `SupervisorDeps.resolveExportArtifacts`'s shape. It takes the **per-run** sandbox
view off its input (the supervisor supplies it), so one producer at the boot root serves every run
and never names a sandbox.

### 2.4 The supervisor and the composition

- `supervisor.ts` — `resolveExportArtifacts`'s input gains `enumerate`, bound to THIS run's
  `sandboxId` and `run.effect`, and **latched** exactly like `digest`/`export` (re-checked after the
  await).
- `lifecycle/dispatch-runtime.ts` — composes the producer beside the sequencer. **This is the line
  that promotes `E5-2`.**

### 2.4b The refusals are VISIBLE, and path-free by TYPE

Found by this ticket's own pre-push self-audit (family 1, redaction; family 2, vacuous control).
Nothing consumed the producer's `onRefused`, so a run whose only deliverable was a symlink or an
oversized file would export nothing and **say nothing** — indistinguishable from a run that wrote
nothing at all, which is precisely the ambiguity `E5-D07`'s per-file classification exists to
remove. The composition now logs each refusal.

★ **It cannot leak.** `OutputRefusal` carries ONE closed `snake_case` token and no path, so the
port's observability rule (*"no path, byte, grant URL or file content in any log line or metric
label"*) is satisfied by the **type**, not by discipline at the call site — and mutation **M14**
(adding a `path` field and passing it) reds. **No new `emitOp` label is minted**: that vocabulary
stays closed to `digest_artifact` / `export_artifact`, as the task's Observability section requires.

### 2.5 The per-file failure policy (`E5-D07` ruling 7)

`createArtifactExportSequencer` was **all-or-throw**: one refused file dropped every valid output
after it, and the enumeration is sorted by path, so an agent could name a bad file `a-…` and cost the
run everything else. It now returns `ArtifactExportOutcome = {exported, failures}` and continues per
file. The `fail(...)` throw is kept (it is what lets TypeScript narrow) and caught one request wide.

★ **A defect the per-file policy CREATED, and closed in the same change.** Absorbing failures per file
means a closed window no longer stops the loop by throwing out of it — the sequencer would walk on
and mint a grant for every remaining file against a dead fence. Hence the optional `isOpen` latch,
supplied by `runExportWindow`.

### 2.6 Three consumers the widened `listDir` reached, found by sweeping for them

`listDir` is a shared seam, so widening it reaches past this ticket's file list. All three were swept
for and fixed; none changes a contract.

- **`server/src/services/sandbox-coding-staging.ts`** — `FileStagingTransport.listDir` is declared
  with a doc comment claiming `E2bTransport` is **structurally assignable** to it. Widened to
  `readonly { readonly path: string }[]` so that claim stays TRUE: the seam names only `path`, stays
  provider-neutral, and `E2bDirEntry` carries its extra fields besides. (The method has no caller in
  that service; the test stub was updated with it.)
- **`server/src/__tests__/cli-008-unit-b-staging-channel.integration.test.ts`** — iterates a listing
  to snapshot files. ★ **Caught by the Linux `verify` shard, not locally**: that suite is
  `describe.skipIf(win32)` and executes ZERO tests on Windows, so its evidence has to come from CI,
  and it did — `verify (3)` on `8b487893f`, `1 failed | 6037 passed`. Fixed at source.
- **`packages/sandbox-e2b-provider/src/__tests__/keyed-cli-011-output-probe.test.ts`** — the P-011
  probe. ★★★ **This is a MEASUREMENT INSTRUMENT, so it was changed conservatively and the change is
  recorded.** `paths` keeps its old meaning (the paths the transport returned), so the `S-P5`
  reading `includesL1` still reads what it always read and stays comparable with the committed
  record; `markedLinks` / `markedAsLink` is **added, not substituted**, so a re-run records the new
  fact — the link is no longer indistinguishable from a file — instead of losing it. **The committed
  record `tickets/CLI-011-probe-record.json` is a measurement of the OLD transport and is NOT
  rewritten.**

---

## 3. `E7-D08` — the `kind` decision, and it does NOT move a counter

Recorded in `../decisions.md` as **`E7-D08`**: the production composition declares
**`kind: "other"`**, `retention: "run"`.

`countProducedOutputs` **arm 1** filters `kind = 'workspace_patch'`. Declaring that would make the
E7-1 qualifying-artifact counter move the first time a run writes a file under `R` — while the
Unit-E workspace-patch route is XL and out of `M1b` (`E7-D05`). The task forbids silently picking
the one that makes a number go up, and `other` is also simply the **truthful** description. Per
`E7-D11` and the review's `SD-3` the judge counts through **arm 2** (predicate P-A), which is
unchanged, so nothing is lost. **This ticket's exports are real, attributable and `committed`, and
arm 1 does not count them — stated rather than papered over.**

---

## 4. RED → GREEN

Local runs, this worktree, `pnpm install --frozen-lockfile --virtual-store-dir=C:/pn/b012`.

**RED** (the contract change and the new behaviour, before the code):

```
pnpm --filter @armyofagents/worker-daemon exec vitest run \
  src/__tests__/artifact-export-sequencer.test.ts \
  src/__tests__/supervisor-export-artifacts.test.ts \
  src/__tests__/dispatch-runtime-export-composition.test.ts
→ Tests  13 failed | 33 passed (46)
```
The 13 were the shape and the two flipped claims: the sequencer returning a bare array, and
`dispatch-runtime-export-composition.test.ts`'s *"exportArtifacts is composed; resolveExportArtifacts
is NOT"* / *"built at boot, run by nothing (why E5-2 stays unwired)"* — both now false by design.

**GREEN**, per package:

| Command | Result |
|---|---|
| `worker-daemon exec vitest run src/__tests__/export-request-producer.test.ts` | `Tests 19 passed (19)` |
| `worker-daemon exec vitest run src/__tests__/artifact-export-sequencer.test.ts` | `Tests 19 passed (19)` |
| `worker-daemon exec vitest run src/__tests__/supervisor-export-artifacts.test.ts` | `Tests 21 passed (21)` |
| `worker-daemon exec vitest run src/__tests__/dispatch-runtime-export-composition.test.ts` | `Tests 11 passed (11)` |
| `provider-wire exec vitest run src/__tests__/driver-enumerate.test.ts` | `Tests 5 passed (5)` |
| `adapter-manager exec vitest run src/__tests__/server-enumerate.test.ts` | `Tests 6 passed (6)` |
| `sandbox-e2b-provider exec vitest run src/__tests__/enumerate-and-bounded-read.test.ts` | `Tests 10 passed (10)` |
| `sandbox-e2b-provider exec vitest run` (whole package) | `Tests 182 passed | 32 skipped (214)` |
| `worker-daemon exec vitest run` (whole package) | `Tests 1250 passed | 1 skipped (1251)` (a clean full run; see the flake note below) |
| `provider-wire exec vitest run` | `Tests 87 passed | 1 skipped (88)` |
| `adapter-manager exec vitest run` | `Tests 204 passed (204)` |
| `pnpm -r typecheck` | no error outside `ui`, which fails pre-existing on `toBeInTheDocument` jest-dom types (unrelated, untouched) |
| `pnpm --filter @armyofagents/worker-protocol build` / `worker-daemon build` / `sandbox-e2b-provider build` / `provider-wire build` / `adapter-manager build` | all clean |

★ **The one flake, named rather than hidden.** `supervisor-hung-stage-input.test.ts > "the deadline is
ONE budget across both halves"` failed **once** in an earlier full-package run
(`AssertionError: expected 85 to be less than 70` at `:152`) and **passes in isolation** (`4 passed`).
It is a wall-clock bound on an unrelated staging deadline, in a file this ticket does not touch. Not
introduced here; recorded because a green claim that hid it would be false.

★ **A gap in the plan's own focused command, reported not worked around.** The task's verify command
(`implementation-plan.md` line 333) runs the worker-daemon trio plus `driver-enumerate` and
`server-enumerate`, and typechecks `sandbox-e2b-provider` — but runs **no `sandbox-e2b-provider`
test**, while this ticket's `E5-F009` and `E7-F039` code lives in that package. The provider suite
above is run in full and cited; the command itself is the gate owner's to widen.

---

## 5. Mutation and positive-control table

Every row was applied to the source, run, and **reverted**. `RED` = the named suite goes red.

| # | Mutation | Suite | Result |
|---|---|---|---|
| M1 | Producer: never refuse a `symlink` entry (`A-O2-4` off) | `export-request-producer` | **RED** (3 failed) |
| M2 | Producer: drop the pre-digest per-file size check (review **PC-6**) | `export-request-producer` | **RED** (1 failed) |
| M3 | Producer: drop the outside-the-root refusal | `export-request-producer` | **RED** (1 failed) |
| M4 | Sequencer: delete the `isOpen` window latch | `artifact-export-sequencer` | **RED** (1 failed) |
| M5 | Sequencer: restore ALL-OR-THROW (remove the per-request catch) | `artifact-export-sequencer` | **RED** (10 failed) |
| M6 | Provider: drop the no-follow recheck at the read boundary (`E7-F039`) | `enumerate-and-bounded-read` | **RED** (2 failed) |
| M7 | Provider: unbound `#readArtifactBytes` (`E5-F009`) | `enumerate-and-bounded-read` | **RED** (1 failed) |
| M8 | Contract: discard `symlinkTarget` again (the pre-CLI-012 behaviour) | `list-dir-files-only` | **RED** (2 failed) |
| M9 | Contract: default an unreadable listing size to `0` instead of refusing | `list-dir-files-only` | **RED** (1 failed) |
| M10 | Composition: stop passing the producer (`E5-2` would be unwired again) | `dispatch-runtime-export-composition` | **RED** (6 failed) |
| M11 | Composition: swap the `E7-D08` kind to `workspace_patch` | `dispatch-runtime-export-composition` | **RED** (2 failed) |
| M12 | Real transport: bounded read silently falls back to `format: "bytes"` | `enumerate-and-bounded-read` | **RED** (1 failed) |
| M13 | Composition: the refusal log line carries no real reason | `dispatch-runtime-export-composition` | **RED** (1 failed) |
| M14 | Producer: leak the tenant-authored path into an `OutputRefusal` | `export-request-producer` | **RED** (2 failed) |

★ **Non-vacuity is asserted before the refusal in every arm that could pass on emptiness**: the
end-to-end composition arms assert the sequencer was called **once** and the file was digested before
asserting what committed; the anti-vacuity arm asserts the window really opened (`sequencerCalls() ===
1`) before asserting that no grant was minted; `readStreamBounded`'s arm counts the chunks the source
offered; the crossing test asserts the stripped source still contains the producer before asserting
what it lacks.

---

## 6. `E5-F009` — RESOLVED, by the bounded read

Flipped to `resolved` in `../../E5-workspaces-secrets/findings.md` and its entry removed from
`scripts/finding-ownership.json`, **in this commit**.

It is closed by the **bounded read**, not by the pre-digest check, exactly as the finding demands:
`#readArtifactBytes` passes `maxBytes: E2B_MAX_ARTIFACT_BYTES` (25 MiB) on **both** the digest and
the export path, and `RealE2bTransport.readFile` honours it by streaming and refusing at the chunk
that would cross the cap, cancelling the stream. The proof is the case the finding names — a file
inside the cap at enumeration and over it at digest (M7's suite), which never allocates the oversized
buffer.

★ The finding's own stated blocker (*"needs a `stat`-shaped or streaming op … both drivers would have
to grow"*) was measured **gone twice over**: `files.list` already reports `size` (probe `S-P6`) and
`Filesystem.read` already offers `format: "stream"` (§1).

## 7. `E5-2` — promoted to `wired`

`scripts/gate-clause-wiring.json`, `E5-2-fenced-object-commit-worker-half`: `unwired` → `wired`,
`expectedReferences` 1 → 2, with the caller cited **by symbol** (`createExportRequestProducer`,
composed in `composeDispatchRuntime`) and the prior prose kept as written. The entry's own
*"CAUTION FOR CLI-012: connecting a producer adds NO reference to this symbol, so this guard will NOT
force the promotion"* is discharged — the flip is deliberate. `check-gate-clause-wiring` reports
`OK (28 wired clause(s), 6 declared dormant, 2 provider-capability claim(s) matched to source)`.

---

## 8. What is PENDING, stated plainly

★★★ **There is no live end-to-end run here, and this ticket does not claim one.**

1. **The real-run acceptance is paired with `CLI-017`, which is filed and NOT built.** Until the
   SD-1b directive ships, a real run is never told to write under `R`, so a keyed lane would
   enumerate an empty (or absent) root and prove nothing about the producer. `E7-D11` says this in
   terms: neither ticket's real-run half is provable alone.
2. **`E7-F039`'s deliberate symlink-swap attempt on a REAL run is NOT run.** What is run is its
   fixture analogue, and the mutation between **enumeration and the read** — the placement that
   distinguishes a vulnerable implementation from a safe one — with the canary target hashing
   identically to the original so the existing re-hash TOCTOU check provably cannot catch it. The
   finding stays **open**. The real-run arm needs `CLI-017` plus a keyed dispatch, which is the
   planning session's; **no keyed workflow was dispatched by this ticket.**
3. **The `S-P0` + `A-neg` template precondition is an OPERATOR act** (`E7-D11`, *Conditions on the
   ruling*) and is untouched here.
4. **A no-op run's export window reports `failed`/`producer_failed`**, because a root the agent never
   created makes the transport's `listDir` throw not-found, and the transport conflates a missing
   path with a missing sandbox by design. It is best-effort, so the attempt is not failed and the
   terminal is the command's. Distinguishing "no root" from "no sandbox" would mean returning `[]`
   for a not-found, which would also swallow a genuinely missing sandbox — a fail-open this ticket
   declined to build. Flagged for the gate owner; `CLI-017-A` creating `R` makes it moot in practice
   (the probe measured `rootCreatedDuringArm=true`).

---

## 9. Files changed, commits, and CI

**Implementation commit:** `<filled at §10>` · **Reviewed revision:** `<filled at §10>`

Source: `packages/sandbox-e2b-provider/src/{transport,list-dir-contract,real-transport,mock-transport,e2b-provider}.ts`;
`packages/worker-daemon/src/{lease/export-request-producer.ts (new), lease/artifact-export.ts, lifecycle/dispatch-runtime.ts, supervisor/{provider,effect-authority,supervisor,noop-provider}.ts, index.ts}`;
`packages/provider-wire/src/driver.ts`; `packages/adapter-manager/src/server.ts`.

Tests: `packages/worker-daemon/src/__tests__/export-request-producer.test.ts` (new),
`packages/sandbox-e2b-provider/src/__tests__/enumerate-and-bounded-read.test.ts` (new),
`packages/provider-wire/src/__tests__/driver-enumerate.test.ts` (new),
`packages/adapter-manager/src/__tests__/server-enumerate.test.ts` (new), plus the four suites whose
pinned shape or flipped claim this ticket changes, and
`packages/worker-daemon/src/__tests__/support/fake-provider.ts`.

Records: `../decisions.md` (`E7-D08`), `../../E5-workspaces-secrets/findings.md` (`E5-F009`),
`scripts/{gate-clause-wiring,finding-ownership,test-inventory}.json`, and four moved-line citations
re-pointed **by symbol** in `docs/architecture/distributed-execution-threat-controls.json`
(`DE-05` `createStartupReconciler`, `DE-09` `this.#sdk.create`, `DE-26` `this.#transport.list` and
`ownershipSelector`) — edits my own insertions caused, with the anchors unchanged.

**Guards:** the full `pr.yml` guard set plus `check-evidence-immutability --base
origin/docs/replatform-program` ran locally with `failures: 0`.

---

## 10. Review

*(To be completed by a DISTINCT reviewer. Only the reviewer may set `Status: complete`.)*

- Reviewed revision (40-hex):
- Decision:
- Notes:
