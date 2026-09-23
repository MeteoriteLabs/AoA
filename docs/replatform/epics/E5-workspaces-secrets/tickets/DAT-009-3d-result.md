# DAT-009-3d Result — the export sequencer composed at the dispatch runtime

**Status:** `gate_review`
**Date (UTC):** `2026-09-21`
**Epic:** `E5-workspaces-secrets`
**Plan task:** `E5 implementation-plan DAT-009-3d — compose the sequencer (S, M1b)`, as amended by E5-D07 ruling 4
**Decision:** [`decisions.md`](../decisions.md) **E5-D07**, `accepted`, rulings 1–8
**Implementer:** `DAT-009-3d build session (Claude Opus 5)`
**Start SHA:** `cec1b48a7` (`docs/replatform-program` tip, the #549 merge)
**Reviewed revision (the code commit):** `c69a8b44f7d153f9a3ec2310754acae1216543e9`

The implementer leaves `Status` at `gate_review`. Only a distinct reviewer may change it to
`complete`.

## 1. What was built

- **`composeDispatchRuntime`** (`packages/worker-daemon/src/lifecycle/dispatch-runtime.ts`) builds
  `createArtifactExportSequencer({client: deps.client, key: deps.key, session: () => session.get()})`
  and passes it to the supervisor as **`exportArtifacts`**. This copies the `createStagedInputResolver`
  → `resolveStagedFiles` pattern in the same function.
- **Both lanes get it.** A single `makeSupervisor` call serves both the desktop `provider` lane and
  the container `makeRunProvider` lane, so the sequencer reaches whichever lane is injected.
- **No producer is composed.** `resolveExportArtifacts` belongs to `CLI-012`. `runExportWindow`
  opens only when both deps are present (E5-D07 (a) 1). So the sequencer is **built at boot and run
  by nothing**, and no run invokes it. The tests below pin that on a real run of each lane.
- **`E5-2` stays `unwired`** (E5-D07 ruling 4). The composition is the symbol's first non-test
  reference, so `scripts/gate-clause-wiring.json` raises the entry's `expectedReferences` to `1`. It
  also appends an amendment to the entry's `reason` saying why. The older text is kept as written.
- **The composition adds no new failure path at boot.** `createArtifactExportSequencer` only closes
  over its deps and throws nothing at construction. So the plan's "a composition that throws at boot
  is a boot failure" has nothing to act on here. The sequencer is built with no guard around it, so
  if it ever did throw, `composeDispatchRuntime` would reject.
- **Not changed:** `supervisor.ts`, the flag default, and any producer.

## 2. RED → GREEN

**RED.** `dispatch-runtime-export-composition.test.ts` was written first, against the unmodified
`dispatch-runtime.ts`. Run with
`npx vitest run src/__tests__/dispatch-runtime-export-composition.test.ts`: **8 failed (8)**. The
failures had these causes, and each one comes from the missing composition:
- `expected 'undefined' to be 'function'`: 4 cases. These are the two lane cases and the two inert
  cases, whose non-vacuity precondition checks that the sequencer is composed.
- `composed.exportArtifacts is not a function`: 2 cases. These call the composed sequencer directly
  (bound-to-runtime, and nothing-to-export).
- `createSupervisor: resolveExportArtifacts requires exportArtifacts`: 2 cases. These are the F10
  cases. Their test producer, with no composed sequencer, hits 3c's construction rule.

No case was green at RED.

**GREEN** at `c69a8b44f`:
- The task's verify command was run as its bash equivalent: the protocol build, then
  `vitest run src/__tests__/dispatch-runtime.test.ts src/__tests__/dispatch-runtime-export-composition.test.ts`.
  Result: **2 files, 35 passed** (27 existing and 8 new).
- `node scripts/check-gate-clause-wiring.mjs` reports **OK**. `E5-2` is listed under `DORMANT, on the
  record`.
- The full worker-daemon suite gives **160 files, 1078 passed, 1 skipped**. The worker-daemon
  `typecheck` and `build` both exit 0.
- **The test file is typechecked.** The package `tsconfig.json` excludes `src/__tests__`, so a
  standalone `tsc` was run over the new file. It reported no errors in it. The pre-existing errors in
  `support/*.ts` are not from this ticket.
- The full `pr.yml` guard set plus `check-evidence-immutability --base origin/docs/replatform-program`
  gives **0 failures**. `check-test-inventory` needed the `packages/worker-daemon` pin raised from
  166 to 167, for the one new file. Only that pin was changed.

## 3. Positive controls and mutation table

The source was restored after each row, and the test file was rerun each time.

| # | Mutant (in `dispatch-runtime.ts`) | Result | Killed by |
|---|---|---|---|
| P1 | **the positive control for the register:** composition present, `expectedReferences` not yet raised | `check-gate-clause-wiring` exit 1: `E5-2 … createArtifactExportSequencer has 1 reference(s), expected 0` | the wiring checker reads the register |
| M1 | **the composition removed** (`exportArtifacts` not passed) | **8 red** | every case |
| M2 | a `[]` stub producer composed (`resolveExportArtifacts: async () => []`, the thing E5-D03 forbids) | 4 red | both lane cases, both inert cases |
| M3 | the sequencer bound to a runtime-scoped "first handoff" instead of each run's own | 2 red | **both F10 cases** |
| M4 | the sequencer signs with a different device key | 1 red | bound-to-runtime |
| M5 | the sequencer composed for the desktop lane only | 3 red | the three container-lane cases |

**5 of 5 killed, and P1 observed.** M1 is the control the brief asks for: removing the composition
turns the new tests red. M2 shows that the inert cases are not vacuous. Their non-vacuity
precondition (the sequencer is composed) plus the zero-call assertion goes red as soon as anything
would drive the sequencer.

## 4. Multi-tenant (F10)

Two runs, from Organizations A and B, go through **one** composed runtime and its supervisor at the
same time. The case runs on both lanes. The only thing added to the composition is a test producer.
It enters through the `makeSupervisor` seam, because production has no producer yet. The sequencer
that runs is the composed one, wrapped only to count its calls. On the container lane,
`materializeRunSecrets` is also the composed one, and each run redeems its own capability through
it. Both windows are held until both runs arrive, so any runtime-scoped binding would cross the two
Organizations.
- **Sandbox binding.** Each run's `digestArtifact` and `exportArtifact` reach only its own sandbox.
- **Object keys.** Each grant's `expectedObjectKey` starts with its own
  `expectedAttemptObjectPrefix({organizationId, jobId, attempt})`. The same-tenant positive control
  is A's key under A's prefix. The cross-tenant check is that neither key starts with the other
  Organization's prefix.
- **Commits.** Each commit's manifest carries its own `organizationId` and its own key, matched by
  `leaseId`.
- **Container lane.** Each per-run driver is built over a capability whose `ownedLabels.leaseId` is
  that run's own lease.
- **Terminals.** Both terminals are `succeeded` with exit 0. Export is evidence, not the verdict
  (E5-D07 (b)).
- **Mutant.** M3, which binds to the first handoff, turns both lanes red.

## 5. What this ticket does NOT claim (E5-D03)

- **No byte moves because of this ticket.** Nothing in production produces `ArtifactExportRequest[]`,
  and no run opens an export window. Composing the sequencer is necessary for link 3, but it is not
  enough.
- **`capabilityProven` does not move.**
- **`E5-2` is not promoted.** This is weaker than `E7-1-staged-input-write`: that resolver runs on
  every run and returns `[]`, while this sequencer runs on none.

## 6. Findings and plan deltas

1. **The wiring guard will not force `CLI-012`'s promotion.** The plan's original Outcome relied on
   the checker ("it fires `unwired_but_now_has_caller` the moment a caller appears"). That is
   measured true for **this** composition (P1). It will **not** be true for `CLI-012`. Composing a
   producer adds no reference to `createArtifactExportSequencer`, so the count stays at 1 and the
   guard stays green while `E5-2` stays `unwired`. `CLI-012` has to flip the entry deliberately. The
   register's new amendment says so, so that `CLI-012`'s author sees it next to the entry.
2. **The dependency gate.** The plan's 3d task says "Depends on: `DAT-009-3c` `complete` at a
   recorded reviewed revision". At the start SHA, `tickets/DAT-009-3c-result.md` is at `gate_review`,
   and its reviewer section is empty. 3c's code is merged (#549), and the planning session assigned
   3d on that basis. This result records the gap and does not act on it.

## 7. CI

Measured on head `7292fc942` (which carries the reviewed code tree `c69a8b44f`), `pr.yml` run
`35595160161`:
- **`ci-required`** (job `106323329828`): **success**.
- **`verify (4)`** (job `106318235095`): executed `dispatch-runtime-export-composition.test.ts`,
  **8 tests**, all passed. The shard total was **6131 passed, 2 skipped (6133)** across 658 files.
- `verify (1)`, `(2)` and `(3)`, `policy`, `e2e` and `migrations`: success.

This section was added in a docs-only commit after that run, so the final head differs from
`7292fc942` by this file only.

## 7a. Addendum, 2026-09-21: the program tip merged in

The sections above are kept as written. After they were written, the program tip moved on with
JOB-016 (#547), WRK-018 (#546) and DEP-015 (#554), and #556 then conflicted with it. The tip was
**merged** into this branch in merge commit `32b70c43e`, not rebased. The reviewed code commit
`c69a8b44f7d153f9a3ec2310754acae1216543e9` therefore stays an ancestor of the head
(`git merge-base --is-ancestor` exits 0).

- **The one conflict** was the `packages/worker-daemon` pin in `scripts/test-inventory.json`. It was
  recomputed from the combined tree: 168 at the tip, plus the one file this branch adds, gives
  **169**. `check-test-inventory` pins this tree exactly, and it passes.
- **`dispatch-runtime.ts` auto-merged.** WRK-018's `observeRun: createUsageObserver(...)` and this
  ticket's `exportArtifacts` are now both composed. The real-run cases in §2 and §4 therefore now run
  with the usage observer live. They pass unchanged.
- **`gate-clause-wiring.json` auto-merged.** The tip changed only the `E3-15-budget` row, and that
  row takes the tip's text. The `E5-2` row, including its `expectedReferences: 1` and this ticket's
  dated note, is intact. `check-gate-clause-wiring` reports OK, with `E5-2` listed as dormant.
- **Re-verified on the merged tree:**
  - the verify pair gives **2 files, 36 passed** (the tip added one case to `dispatch-runtime.test.ts`);
  - the full worker-daemon suite gives **162 files, 1107 passed, 1 skipped**;
  - the worker-daemon typecheck and build both exit 0;
  - the standalone `tsc` over the new test file reports no errors in it;
  - the full guard set plus `check-evidence-immutability` gives **0 failures**;
  - the §3 mutation table was re-run, and all five mutants are still killed, with identical red
    counts (8 / 4 / 2 / 1 / 3).
- **The §7 CI figures are for the pre-merge head** `7292fc942`. CI for the merged head is on the PR.

## 8. Reviewer section

*(Distinct reviewer only.)*

**Reviewer:** M1 review-batch-2B independent reviewer (Claude Opus 5) — distinct from the DAT-009-3d build session and the planning session
**Reviewed revision:** 4a3a0000fac90f2a772648fff8fa28dc9ac75538
**Disposition:** `approved` — **`Status` NOT flipped**: the dependency `DAT-009-3c` is not `complete` (see below)
**Attempt:** 1 (see *Independent review — attempt 1* and the attempt history)

### Independent review — attempt 1

**Disposition: `approved` on the merits. The `Status` flip to `complete` is withheld, because this
ticket's own declared dependency is unmet.** Reviewed at `4a3a0000fac90f2a772648fff8fa28dc9ac75538`
(program tip `docs/replatform-program`, the merge of PR #556). The start SHA `cec1b48a7`, the code
commit `c69a8b44f7d1…`, the pre-merge CI head `7292fc942fef…`, the program-tip merge `32b70c43e` and
the final head `d09e77a3da79…` are all ancestors of it.

**Why `Status` stays `gate_review`.** The E5 plan's `### DAT-009-3d` says "**Depends on:**
`DAT-009-3c` `complete` at a recorded reviewed revision." §6 item 2 of this record already flags the
gap. It is still open: in this same batch, `DAT-009-3c` review attempt 1 is `changes_requested`. That
is for a record defect only (a stale GREEN count, 50 where the tree gives 52), not a code defect. So
`3c` is not `complete`, and completing `3d` would complete a ticket ahead of its own dependency gate.
That call belongs to the planning session, not to me.
**To finish:** once `DAT-009-3c` is `complete`, a distinct reviewer may flip this record's `Status` to
`complete` in a separate commit, citing that revision. Nothing here needs re-review. Alternatively,
the planning session may record under F2 that `3d` completes on `3c`'s merged code.

**Verified at source:**

- **The composition.** `composeDispatchRuntime` (`lifecycle/dispatch-runtime.ts`) builds
  `createArtifactExportSequencer({ client: deps.client, key: deps.key, session: () => session.get() })`,
  beside `createStagedInputResolver`. It passes the result as `exportArtifacts` to the single
  `makeSupervisor` call, which receives both `provider` and `makeRunProvider`, so both lanes get it.
  No `resolveExportArtifacts` is composed. `supervisor.ts` is not in the code commit, which touches
  only `dispatch-runtime.ts`, the new test, `gate-clause-wiring.json` and `test-inventory.json`. The
  commit title matches the plan's intent.
- **Register.** In `E5-2-fenced-object-commit-worker-half`, `status` is `unwired` and
  `expectedReferences` is `1`, with the reason amended. At the tip, `check-gate-clause-wiring` gives
  OK with `E5-2` under DORMANT, and `--counts` gives `createArtifactExportSequencer` **1**.
- **Focused and full suites, rerun locally (Windows) at the reviewed tip.**
  - The verify pair (`dispatch-runtime.test.ts` + `dispatch-runtime-export-composition.test.ts`)
    gives **2 files, 36 passed**, matching §7a.
  - The full `worker-daemon` suite gives **162 files, 1107 passed, 1 skipped**, matching §7a.
  - `typecheck` exits 0 and `build` exits 0.

  I did not rerun the pre-merge figures in §2 (35 / 1078). They describe `c69a8b44f` before the merge,
  and §7a supersedes them correctly.
- **Controls, reproduced by me and reverted.**
  - **P1:** with `expectedReferences` set back to `0`, `check-gate-clause-wiring` exits **1** with
    "`E5-2-fenced-object-commit-worker-half`: declared unwired but it now HAS a caller …
    `createArtifactExportSequencer` has 1 reference(s), expected 0". This matches.
  - **M1:** with `exportArtifacts` dropped from the `makeSupervisor` call, the new file gives
    **8 failed (8)**. This matches.

  M2 to M5 I checked by reading the tests.
- **F10 is real.** The F10 case runs two tenants with distinct Organization, job and lease through one
  composed runtime, concurrently, holding both producers.
  - It asserts per-run sandbox digests and exports.
  - It asserts `expectedAttemptObjectPrefix` for A under A and for B under B, and neither under the
    other's prefix.
  - It asserts the manifest `organizationId` and `objectKey` prefix for each commit.
  - On the container lane, each capability's `ownedLabels` come from the resolving run's own
    `leaseId`.
- **§6 item 1 (the guard will not force `CLI-012`'s promotion)** is true by construction. A producer
  adds no reference to `createArtifactExportSequencer`, so the count stays 1.
- **CI, by job.**
  - Pre-merge run `35595160161` (headSha `7292fc942fef…`, `success`): `verify (4)` `106318235095`
    shows `dispatch-runtime-export-composition.test.ts (8 tests)` passed, with a shard total of
    658 files and **6131 passed / 2 skipped (6133)**. This matches §7.
  - Merged-head run `35600903745` (`pull_request` on `d09e77a3da…`, `success`, `ci-required`
    `106342700233` success): `verify (4)` `106336580869` shows the new file **(8 tests)** passed, and
    `verify (3)` `106336580923` shows `dispatch-runtime.test.ts` **(28 tests)** passed.
- **Codex.** On PR #556, `chatgpt-codex-connector` reported "Didn't find any major issues" on
  `7292fc942f`, `478dafbc34` and the final head `d09e77a3da`. There are no review-thread comments.
- **Not blocking, noted.** `Start SHA` is a 9-character short SHA. It resolves to an ancestor.

### Independent review — attempt 2

**Reviewer:** M1 review-batch-3B independent reviewer (Claude Opus 5) — distinct from the DAT-009-3d
build session, from the planning session, and from the attempt-1 reviewer
**Reviewed revision:** `60aafb32ec6f8316f92079789cf8814f981f3ed3`
**Disposition:** `approved` — **`Status` moves to `complete`**
**Attempt:** 2

**Disposition: `approved`, and the withheld flip is now released.** Reviewed at the
`docs/replatform-program` tip (the merge of PR #565). The code commit `c69a8b44f`, the pre-merge CI
head `7292fc942`, the program-tip merge `32b70c43e`, the final head `d09e77a3d` and attempt 1's
reviewed revision `4a3a0000f` are all ancestors of it.

**The dependency, stated explicitly.** Attempt 1 approved this ticket on the merits and withheld the
`Status` flip for exactly one reason: the E5 plan's `### DAT-009-3d` says *"Depends on: `DAT-009-3c`
`complete` at a recorded reviewed revision"*, and at that time `DAT-009-3c` was `changes_requested`.
**In this same batch I have set `DAT-009-3c` to `complete`** at revision
`60aafb32ec6f8316f92079789cf8814f981f3ed3`, as attempt 2 of its review — the requested correction
(the verify count 50 → 52) was made in PR #562 and I confirmed the corrected figure at source by
rerunning the command. The dependency is therefore satisfied at a recorded reviewed revision, which
is the precise condition attempt 1 named, and nothing else was outstanding. Per attempt 1's own
closing instruction — *"once `DAT-009-3c` is `complete`, a distinct reviewer may flip this record's
`Status` to `complete` in a separate commit, citing that revision"* — I flip it, in a separate
commit, citing that revision. §6 item 2 of this record, which flagged the gap honestly at build
time, is now closed rather than merely noted.

**Independently re-verified before flipping** (I did not flip on attempt 1's word alone):

- **The composition, at source.** `composeDispatchRuntime`
  (`packages/worker-daemon/src/lifecycle/dispatch-runtime.ts`) imports
  `createArtifactExportSequencer` beside `createStagedInputResolver`, builds it once, and passes the
  result as `exportArtifacts` into the single `makeSupervisor` call that serves both the desktop
  `provider` lane and the container `makeRunProvider` lane. No `resolveExportArtifacts` is composed,
  so the window still cannot open — which is the ticket's whole claim.
- **Register.** `E5-2-fenced-object-commit-worker-half` is `status: unwired` with
  `expectedReferences: 1` and symbol `createArtifactExportSequencer`.
  `node scripts/check-gate-clause-wiring.mjs` is OK at the tip with `E5-2` on the dormant list, and
  `--counts` gives `createArtifactExportSequencer` **1**. The declared number and the measured one
  agree without either having been edited to fit.
- **Mutation reproduced by me, and reverted.** **M1**: dropping `exportArtifacts` from the
  `makeSupervisor` call gives **8 failed (8)** in
  `dispatch-runtime-export-composition.test.ts` — the whole file, matching the table. That is the
  control the brief asks for.
- **Suites at the reviewed tip.** The verify pair
  (`dispatch-runtime.test.ts` + `dispatch-runtime-export-composition.test.ts`) gives **2 files, 40
  passed**: the new file still at **8**, and `dispatch-runtime.test.ts` now at **32**, up from the
  28 attempt 1 measured. The growth is in the pre-existing file from later merges into the program
  tip, not in this ticket's surface; §7a's figure of 36 remains true of the revision it describes.
- **Guard set.** The full `pr.yml` guard set minus the six excluded by the M1 rules, plus
  `check-evidence-immutability --base origin/docs/replatform-program`, is **0 failures**.

**Acceptance items.** The sequencer is composed at the dispatch runtime for both lanes, no producer
is composed, `E5-2` stays `unwired` with its raised `expectedReferences` and a dated amendment
explaining why, the P1 register control and the M1 composition control both bite, the F10 case runs
two Organizations concurrently through one composed runtime, and CI is green by job on both the
pre-merge and the merged head. **Every acceptance item is met**, and the single gating dependency is
now satisfied.

**§6 item 1 matters beyond this ticket, and is true.** The wiring guard will **not** force
`CLI-012`'s promotion: composing a producer adds no reference to `createArtifactExportSequencer`, so
the count stays at 1 and the checker stays green while `E5-2` stays `unwired`. This ticket's author
found that themselves and wrote the warning into the register entry next to the number, which is the
right place for it. A future session must flip `E5-2` deliberately; no guard will remind it.

**Not blocking, carried forward.** Attempt 1's note stands: the `Start SHA` is a 9-character short
SHA rather than the bare 40-hex the protocol names, and it resolves unambiguously to an ancestor.

## Review attempt history

Later reviewers append rows with increasing attempt numbers without replacing earlier ones. Do not include a `Review commit` column: a row cannot embed the SHA of the commit that first contains it.

| Attempt | Reviewer | Reviewed revision | Disposition | Evidence/findings |
|---:|---|---|---|---|
| 1 | M1 review-batch-2B independent reviewer (Claude Opus 5) | `4a3a0000fac90f2a772648fff8fa28dc9ac75538` | `approved` (Status flip withheld) | The composition was verified at source; both lanes, no producer, `E5-2` unwired at `expectedReferences: 1`. Rerun at the tip: verify pair 36, full suite 162 / 1107 / 1 skipped, typecheck and build 0. P1 reproduced (guard exits 1) and M1 reproduced (8 failed). The F10 two-Organization case is real. CI by job: pre-merge `verify (4)` 8 with shard 6131 / 2, and the merged head's `verify (4)` 8 and `verify (3)` 28. Codex clean on three heads. `Status` stays `gate_review` because the plan's dependency `DAT-009-3c` `complete` is unmet (3c attempt 1 is `changes_requested`, for a record count). Flip once 3c is `complete`, or on a planning-session F2 record. |
| 2 | M1 review-batch-3B independent reviewer (Claude Opus 5) | `60aafb32ec` (program tip, the #565 merge) | `approved` (Status flipped to `complete`) | The sole reason attempt 1 withheld the flip is discharged: in this same batch `DAT-009-3c` was set to `complete` at `60aafb32ec6f8316f92079789cf8814f981f3ed3` after its attempt-2 review confirmed the corrected verify count at source. Dependency satisfied at a recorded reviewed revision, which is the exact condition attempt 1 named. Re-verified independently before flipping: the composition at source (both lanes, no producer), `E5-2` `unwired` with `expectedReferences: 1` and a measured count of 1, **M1 reproduced** (8 failed), the verify pair at the tip giving 2 files / 40 passed (the new file still 8; `dispatch-runtime.test.ts` grew to 32 from later merges, not from this ticket), and the guard set at 0 failures. Every acceptance item met. |
