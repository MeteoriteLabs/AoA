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

---

## 11. Second round — the merge with the program tip, and Codex's two findings

*Added 2026-09-23. Sections 1-10 record the state at `5b64b84a`; this section records what changed
after it and does not rewrite them.*

### 11.1 `ci-required` was FAILURE, and the cause was a MERGE, not this diff

Measured at source (run `35861597873`): two jobs red, `distributed-contract` and `verify (4)`, both
on the **same single assertion** —
`packages/sandbox-fake-provider/src/__tests__/per-op-port-mirror.test.ts` >
*"every method on the daemon's SandboxProvider exists on the façade"*:
`AssertionError: façade is missing enumerateOutputs`.

That test **does not exist on this branch's base**; `DEP-019` added it to
`docs/replatform-program` (merge of PR #572) while `CLI-012` was in flight, and CI tests the merge.
It reads the method names out of the daemon's own `SandboxProvider` source and requires each to
exist on `createFakeSandboxProviderPort`. `CLI-012` adds `enumerateOutputs` to that port, so the
mirror was legitimately red: the fake provider is the D1 lane's reference implementation and an op
the worker can call but the façade cannot answer is exactly the drift `DEP-019` built the test for.

**Fixed by declaring it, honestly:** `per-op-provider.ts` gains
`sandboxEnumerationMode: "none"` and `enumerateOutputs: () => unsupported("enumerate_outputs")`,
alongside the export pair it already declines. The façade advertises exactly the frozen CORE ops
and the `m1-spine` journey drives none of the optional ones, so declining is the truthful
declaration, not a stub.

- RED (local, before the fix): `sandbox-fake-provider exec vitest run` →
  `Tests 1 failed | 90 passed (91)`, the assertion above.
- GREEN: `Tests 91 passed (91)`.

### 11.2 Codex P1 — the attempt ceiling was held on ENUMERATION snapshots only

Verified at source, and real: the producer applied `MAX_OUTPUT_TOTAL_BYTES` from listing metadata,
which this ticket's own design says is a snapshot a file may grow past before `digestArtifact`. So
five files listed at 20 MiB could each reach the 25 MiB per-file cap and export 125 MiB.

`createArtifactExportSequencer` now re-applies the ceiling **on the digested size**, after the
digest (only the digest knows what the file was) and **before the mint** (a mint is a durable row),
per-file per `E5-D07`. The charge is taken **at admission, not at success**: a file whose grant was
minted and whose `export` completed has already moved its bytes, and a later `commit` failure does
not bring them back.

★ The producer's constant was **not** pointed at the sequencer's by an import. This module's
dependency surface is asserted TYPE-ONLY by `export-request-producer.test.ts`, and that assertion
**is** this ticket's data-plane guard — the test *"that FAILS if the crossing returns"* the task
section owes. A value import, even of a number, would have traded the guard for a convenience, and
it reds that test. The two constants are pinned against each other by a test instead.

### 11.3 Codex P2 — a rejected control-plane call aborted the whole loop

Also real. `artifactTransferGrant` and `artifactCommit` are HTTP: a timeout, a DNS failure or a
socket reset **rejects** rather than answering, and a raw rejection is not an
`ArtifactExportFailedError`, so the outer catch rethrew it and dropped every later valid output —
the opposite of the per-file policy `E5-D07` ruling 7 assigns to this ticket. Both calls are now
wrapped and classified as `transport_failed` at the stage that was calling. The error is **not
interpolated** into the failure: a client that put a signed url in its own message would leak it,
and a test asserts the serialized outcome contains neither the planted signature nor `https://`.

### 11.4 `E7-D11`'s FAIL condition, asserted on the STORE

`E7-D11` says a swap that produces a **stored** artifact containing the planted canary is a FAIL of
this ticket, not a residual. The two `E7-F039` arms above assert that the **call** rejects, which is
a weaker claim. Added: an arm that stubs `fetch`, records every PUT body, and asserts the store
receives **nothing** on the swap — the store assertion placed **first**, before the error-kind
assertion, so the evidence a regression produces is about bytes at rest. Its positive control
exports an unswapped file and asserts the recorder really captured the real bytes, so the arm
cannot pass against a provider that simply never uploads.

★ Outcome (ii) — *"it exports and SD-5's scan refuses the bytes"* — is **not** assertable here, and
this record does not pretend it is. Verified at source in `decisions.md` `E7-D11`: SD-5's
sandbox-scoped secret handoff and refusal are **`CLI-017-B`'s** build (*"SD-5 cannot be delivered by
adding a content check to `exportArtifact` alone"*). The real-run swap stays pending with
`successor: CLI-017`, as §8 already records.

### 11.5 Second-round mutation table

| # | Mutation | Suite | Result |
|---|----------|-------|--------|
| M15 | Fake façade: remove `enumerateOutputs` (the state CI found) | `per-op-port-mirror` | **RED** (1 failed, `façade is missing enumerateOutputs`) |
| M16 | Sequencer: delete the digested-size attempt ceiling | `artifact-export-sequencer` | **RED** (2 failed) |
| M17 | Sequencer: unwrap the GRANT call's transport classification | `artifact-export-sequencer` | **RED** (1 failed) |
| M18 | Sequencer: unwrap the COMMIT call's transport classification | `artifact-export-sequencer` | **RED** (1 failed) |
| M19 | Sequencer: charge `attemptBytes` only on the success path | `artifact-export-sequencer` | **RED** (1 failed) |
| M20 | Producer: drift `MAX_OUTPUT_TOTAL_BYTES` to 200 MiB | `export-request-producer` | **RED** (2 failed) |
| M21 | Provider: drop the no-follow recheck (M6 re-run against the new STORE arm) | `enumerate-and-bounded-read` | **RED** (3 failed; the store arm reds on the planted canary literally at rest) |

Every mutation was reverted; a `MUTANT` grep over the touched sources returns `0`.

### 11.6 Second-round suite counts

| Command | Result |
|---------|--------|
| `sandbox-fake-provider exec vitest run` | `Tests 91 passed (91)` |
| `worker-daemon exec vitest run src/__tests__/artifact-export-sequencer.test.ts` | `Tests 24 passed (24)` |
| `worker-daemon exec vitest run src/__tests__/export-request-producer.test.ts` | `Tests 20 passed (20)` |
| `worker-daemon exec vitest run` (whole package) | `Tests 1255 passed, 1 skipped (1256)` |
| `sandbox-e2b-provider exec vitest run` (whole package) | `Tests 184 passed, 32 skipped (216)` |
| `pnpm --filter worker-daemon --filter sandbox-e2b-provider --filter sandbox-fake-provider typecheck` | all `Done` |
| full `pr.yml` guard set + `check-evidence-immutability --base origin/docs/replatform-program` | `failures: 0` |

### 11.7 The eight-family self-audit (M1 build rules §A), run before this push

1. **Redaction / secret collision** — the two new failure paths carry `error.name`, never the
   message; asserted by a test whose fake client puts a signed url in its own error.
2. **Vacuous control** — the store arm has a positive control that proves the recorder captures a
   real upload; the drift pin asserts a concrete byte count, not two `undefined`s comparing equal.
3. **Bounds and deadlines** — the ceiling is charged at admission, so a commit-stage failure still
   consumes it.
4. **Replay / idempotency** — untouched; the artifact id stays derived from (jobId, attempt, path).
5. **Crash windows and ordering** — the ceiling check sits before the mint, so an over-ceiling file
   leaves no durable `granted` row.
6. **Authentication of the right half** — the swap test pins the STORE, which is the half that
   matters, not the returned value.
7. **Record rot** — the citation-integrity guard is green after the merge; this section is appended
   rather than rewriting §§1-10.
8. **Fail-closed on missing input** — `maxAttemptBytes` is a test-only override and a `0` refuses
   everything rather than disabling the bound.

### 11.8 Codex round 2, P2 — a MISSING output root was reported as a missing SANDBOX

Real, and verified at source. `RealE2bTransport.listDir` collapsed both cases into
`E2bTransportNotFoundError`, and `E2bSandboxProvider.enumerateOutputs` re-mapped that to
`SandboxNotFoundError`. A successful run that wrote nothing never creates
`/home/user/aoa-output`, so **every normal no-output window would have been reported as
`producer_failed`** — directly against this ticket's own stated Failure behavior, *"an empty
output root produces `[]`"*.

★ The discrimination is **measured, not guessed**: the installed `e2b@2.30.5`'s `dist/index.d.ts`
declares `FileNotFoundError` and `SandboxNotFoundError` as two distinct subclasses of the
deprecated `NotFoundError`, so the two cases are distinguishable at source.

- `transport.ts` gains `E2bTransportPathNotFoundError`, a **subclass** of the sandbox error, so
  every existing `instanceof E2bTransportNotFoundError` handler keeps its behaviour and only a
  caller asking for the narrower class sees any difference.
- `real-transport-helpers.ts` gains `isE2bFileNotFound`, which answers TRUE **only** for a
  positively named `FileNotFoundError`. The ambiguous shapes `isE2bNotFound` also accepts (a bare
  `NotFoundError`, a `SandboxError` carrying a 4xx, any name merely containing "notfound") answer
  FALSE, so an unclassifiable failure stays an error and is **never** laundered into "the run
  produced no output".
- `enumerateOutputs` returns `{entries: []}` for the path variant and still throws
  `SandboxNotFoundError` for the sandbox one.

| # | Mutation | Suite | Result |
|---|----------|-------|--------|
| M22 | Transport: collapse the two not-founds again | `enumerate-and-bounded-read` | **RED** (1 failed) |
| M23 | Provider: drop the empty-listing arm | `enumerate-and-bounded-read` | **RED** (1 failed) |

Suite after: `sandbox-e2b-provider exec vitest run` → `Tests 188 passed, 32 skipped (220)`;
typecheck `Done` for `worker-daemon`, `sandbox-e2b-provider`, `provider-wire`, `adapter-manager`.

### 11.9 Codex round 2, P1 — ESCALATED, not silently descoped

Codex asks that the production composition of the producer be **deferred until `CLI-017` supplies
SD-5**, on the ground that a run writing a redeemed secret under the output root would now be
digested and uploaded with no secret scan in place.

> ★★★ **CORRECTED by the ruling — see §11.10 point 2.** The "behind the default-OFF
> distributed flag" sentence below UNDERSTATES the reach: the boot branch fails closed on
> PROVIDERS, not on the rollout flag, so a deployed worker on an enabled tenant does take this
> path. The paragraph is kept as written because it is what was escalated; the correction
> governs.

**The premise is true and it is already recorded** — §8 of this record and `E7-D11` both state
that SD-5 is `CLI-017-B`'s build and is REQUIRED before `M1b`'s campaign. What is verified at
source and bounds the exposure: `composeDispatchRuntime` runs **only inside the `compose: true`
branch of the boot**, i.e. behind the default-OFF distributed flag, which is exactly the
Migration/compatibility posture the task section states (*"additive, worker-only, behind the
default-OFF distributed flag"*).

**The remedy is refused at this level, and the question is handed up**, because acting on it would
contradict two locked instruments rather than fix a defect in this diff:

- the task section's **Files** list requires this ticket to pass the real producer into the
  composition point (*"removing this edit, as suggested, would leave the producer unconnected, so
  the edit stays"*), and
- **`E5-D07` ruling 4** makes this the commit that promotes `E5-2-fenced-object-commit-worker-half`
  to `wired`. An uncomposed producer would have to un-promote it.

E7-D11 gates the **campaign** on SD-5, not this ticket's composition. Whether the campaign's gate
should additionally be a composition-time gate is a planning-session ruling, not a build decision,
so it is reported rather than taken. This is also the **second Codex round** on this PR, which the
M1 build rules cap.

### 11.10 DISPOSITION of §11.9 — the planning session RULED, and the fix is the opposite shape

*Ruled 2026-09-23 by the planning session under founder delegation F2. §11.9 above records the
escalation as it was made; this section is its disposition and does not rewrite it.*

**The composition STANDS. Codex's remedy is refused — and its PREMISE is upheld.**

1. Deferring the composition would contradict the task section's Files list and would un-promote
   `E5-2-fenced-object-commit-worker-half` under `E5-D07` ruling 4. It asks to undo a locked
   instrument to work around a missing one.
2. ★★★ **AND §11.9's OWN GATE SENTENCE WAS TOO WEAK — corrected here, verified at source.**
   §11.9 said the exposure is bounded because the composition runs *"only inside the boot's
   `compose: true` branch, behind the default-OFF distributed flag"*. Measured at source in
   `bin/worker-daemon.ts`, at the `composeRuntime` call: that branch **fails closed on PROVIDERS**
   (*"the boot gate above refused if neither"* — a desktop `provider` or a container
   `makeRunProvider`), **not on the distributed rollout flag**. A deployed worker on an enabled
   tenant that leases a job **will** take this path. The `compose: true` framing understates the
   reach and is not to be repeated.
3. So the genuine exposure window is *any run before SD-5 ships*, and the only thing closing it was
   `E7-D11`'s **prose** precondition plus keyed-dispatch discipline. In this programme a prose
   precondition is not a control — it is the *"a check that nothing runs is not a check"* class.

**Built in this PR, as ordered: a FAIL-CLOSED REFUSAL AT THE EXPORT BOUNDARY, keyed on the
scanner's PRESENCE.**

- `E2bSandboxProviderOptions.scanExportBytes` is SD-5's seam. `exportArtifact`'s **first** act is
  `typeof scan !== "function"` → `SandboxExportScannerUnavailableError`, so an unscannable export
  does not even read the file, let alone upload it.
- It is keyed on **presence, not on a flag**. A boolean would be a bypass with a name; this cannot
  be satisfied except by supplying the thing itself. It is **not** defaulted to a no-op — a default
  that cleared everything would be exactly the bypass the control exists to refuse.
- A **malformed** scanner (`null`, a number, a string, a plain object) is a refusal.
- A **throwing or rejecting** scanner is a refusal (`SandboxExportScannerRefusedError`): a check
  that did not complete witnessed nothing, and "the scanner errored" must never read as "the scan
  passed". Its own message is **not** chained or interpolated — it has seen the file's bytes and
  may have been handed the grant, so the error is a fixed string.
- The scan runs **after** the digest comparison (so the bytes scanned are provably the bytes the
  grant names) and **before** the upload (so a refusal means nothing at rest).

**The ship order inverts correctly:** the refusal ships first; `CLI-017-B` supplies the scanner
against an interface that **already refuses without it**. This protects every caller, including
callers nobody remembered to defer.

**Blast radius, stated plainly:** every existing export suite went RED on this change, which is the
control being real. Those suites assert other properties of the export path and now supply a clean
scanner (`artifact-export.test.ts`, `put-grant-bytes.test.ts`, and the `E7-F039` arms in
`enumerate-and-bounded-read.test.ts`); the refusal itself is proved with its own controls.

#### The RED the ruling named, and the GREEN

| Arm | Evidence |
|---|---|
| **RED — the positive control** (M24: the presence check AND the scan call both removed) | *"NO SCANNER CONFIGURED"* fails with `expected [ 'SD5-CANARY-redeemed-secret' ] to deeply equal []` — **the export SUCCEEDS and the secret is in the store**. That is the arm proving this control is what stops it, not some other guard. |
| **GREEN** | `sandbox-e2b-provider exec vitest run` → `Tests 193 passed, 32 skipped (225)` (was 188 passed). |
| **Anti-vacuity** | *"a scanner that is PRESENT and CLEAN exports normally"* — `{objectKey: "k"}` returned, `store.puts` equals the file's bytes, and the scanner was handed `SECRET.length` bytes. Without it the refusal would be indistinguishable from "export never works". |
| **Store-first assertions** | Every refusal arm asserts `store.puts` **before** any error-kind assertion, the same shape §11.4 uses, so a regression reds on bytes at rest. |
| **Non-vacuity of the scan** | The rejecting-scanner arm records the byte length the scanner actually received, so it cannot pass against a scanner handed an empty buffer. |

| # | Mutation | Suite | Result |
|---|----------|-------|--------|
| M24 | Remove the SD-5 control entirely (presence check + scan call) | `enumerate-and-bounded-read` | **RED** (5 failed; the absent-scanner arm exports the secret) |

Reverted; a `MUTANT` grep over the touched sources returns `0`. Typecheck `Done` for
`worker-daemon`, `sandbox-e2b-provider`, `provider-wire`, `adapter-manager`; adjacent suites
`worker-daemon 1256 passed, 1 skipped`, `adapter-manager 204 passed`,
`provider-wire 87 passed, 1 skipped`.
