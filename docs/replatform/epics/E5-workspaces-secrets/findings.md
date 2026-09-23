# E5 Workspaces & Secrets — findings

Findings filed against Epic E5. Created 2026-09-06 (W5U1); E5 previously had no register, so its
findings lived only inside ticket results and QA snapshots.

Every OPEN finding must have a declaration in `scripts/finding-ownership.json` (the
`check-finding-ownership` guard fails otherwise: a new open finding is born `undeclared_finding`).
`unowned` with a reason is legitimate — it makes an unscheduled item visible rather than impossible.

## E5-F001 — E5-6's register reason names the wrong owner, and the OTHER owner it omits shipped without the symbol and handed the residual to a ticket that never mentions it

**Status:** resolved_by_w16a · **Owner:** — (closed; the ownership entry is deleted in this commit)
**Severity:** MEDIUM (register accuracy plus an orphaned charter; the security substance is
E8-F003's, which is already open)
**Filed:** 2026-09-06 (W5U1), measured at `e1f723df2`.
**Resolved:** 2026-09-07 (W16A, branch `replatform/w16a-register-sentences`), re-measured at
`8075cd7a1`.

> ★ **HOW IT WAS RESOLVED, AND WHAT W16A ADDED TO IT.** `E5-6-denied-egress`'s `reason` now names
> every ticket that passed over this capability and shipped, and says that BRW-004 slice (f) is the
> only REMAINING named candidate rather than the only one there has ever been:
>
> - **CHARTERED (1) — DAT-005**, which BUILT the symbol and booked itself COMPLETE with zero
>   production callers (`DAT-005-result.md:3`). This finding as filed named only DSK-002 and
>   BRW-004 (f); W16A added DAT-005, because a reader planning the wiring should know the symbol's
>   own author shipped it unwired.
> - **CHARTERED (2) — DSK-002**, whose Outcome and acceptance clause (4) require the capability and
>   which shipped having explicitly DECLINED it.
> - **NOMINATED, NEVER CHARTERED — DSK-003.** It was named by DSK-002's *result*
>   (`DSK-002-result.md:168-179`, "belongs with DSK-003"), which is a nomination and not a charter.
>   Its own charter carries no egress requirement at all: the Outcome (`DSK-003-design.md:14-16`)
>   is a least-privilege desktop background host with signed installers, none of the five
>   acceptance clauses (`:20-24`) names egress, a proxy or a broker, and `grep -ni egress` over
>   both DSK-003 documents returns zero hits. It shipped without taking the residual.
>
> ★★ **CORRECTED 2026-09-07 (W16A-FIX), and the correction is the point.** The first version of
> this note and of the register sentence said "**three** chartered tickets". That was an
> overstatement by one — flagged independently by Codex on PR #380 and by an adversarial reviewer,
> and refuted by `scripts/finding-ownership.json` itself, whose `E8-F008` `successor` field already
> said "DAT-005 and DSK-002, **the two tickets that were chartered** to reach this path". Counting a
> nominee as a charter inside the very PR that exists to fix register overstatement is the defect
> eating itself, so the count is now stated as **two chartered plus one nominee who declined by
> silence**. Both spellings are load-bearing: two tickets were *told* to build this and did not;
> one was *asked* to inherit it and never acknowledged it.
>
> One thing this finding said that W16A did NOT copy forward as written: BRW-004 slice (f) is
> described in the register as **deferred**, not "unattempted". `BRW-004-result.md` is on disk
> at Status `gate_review`, covering slices (a)-(d) only, with (f)-(h) recorded not attempted
> (`:15`, `:99`) and the acceptance condition "allowed domains … are enforced" booked `deferred`
> (`:366`). The programme's newest record (`E8-F003`'s successor field) calls that slice "real and
> still open", so calling it *shipped past* would have been a correction that was itself wrong.
>
> **This is a BRANCH STATE.** True on `replatform/w16a-register-sentences`. If that PR is not
> merged, restore the `E5-F001` key in `scripts/finding-ownership.json` and set this back to
> `open`.

**What the register SAID.** `scripts/gate-clause-wiring.json` -> `E5-6-denied-egress`, under "WHAT
WOULD HAVE TO CHANGE for 'wired'" (this text no longer exists in the file):

> "**BRW-004 slice (f) is the only chartered candidate**, is unattempted, and is browser-scoped;
> the org/crew sandbox egress path that E8-F003 measured has no chartered owner at all."

**Measured: "only" is false.** DSK-002's charter names a fence-aware egress path in its outcome
sentence and in an acceptance clause:

- `docs/replatform/epics/E10-desktop/tickets/DSK-002-design.md:15-17` — Outcome: "…mediate
  device-local handles through the DAT-004 broker **plus a fence-aware egress path**."
- The same file's acceptance clause (4), `:25`: "The sandbox cannot read OS credential storage or
  **bypass the broker/proxy**."
- `DSK-002-design.md:198-200` (D5) makes it concrete: "'Governed' means: committing a patch,
  activating a device-local credential, or **performing an egress through the broker**."

The symbol E5-6 declares — `createFenceAwareEgressProxy`, `server/src/services/egress-proxy.ts:146` —
is not browser-scoped: its own header calls it "the FENCE-AWARE egress proxy (server-side,
inert-until-wired)" whose live request channel "is an INERT seam wired at E4-D12", and its step 2 is
`broker.resolve()` — the DAT-004 broker DSK-002's outcome names. So DSK-002's chartered outcome
requires this symbol's capability, and E5-6's `reason` does not mention it.

**And the omission is worse than a missing name — the charter is now ORPHANED.** DSK-002 has
SHIPPED (`DSK-002-result.md` exists, so `check-finding-ownership.mjs`'s own `findCompletedTicketIds`
counts it complete). Its result declines the egress half explicitly:

- `DSK-002-result.md:161-163` — "`sandbox.filtered_egress` is claimed by no mechanism. … It becomes
  reportable when **Lane D's fence-aware egress path exists**; claiming it now is the exact
  over-report D4 forbids."
- `DSK-002-result.md:168-179` — "Lane D shipped the POLICY, not the wiring, and that is a decision.
  … threading one … needs the least-privilege host and **belongs with DSK-003**."

And `grep -n egress docs/replatform/epics/E10-desktop/tickets/DSK-003-*.md` returns **zero hits** in
both DSK-003 documents — and DSK-003 has a result doc too. So the residual was handed to a ticket
that never took it and has since shipped. That is precisely the "carried past its own resolution
point and nothing noticed" shape `scripts/lib/finding-ownership.mjs` was written for, occurring in a
register the ownership guard does not read.

**What is NOT claimed.** E5-6's `unwired` status, its 0 caller count
(`node scripts/check-gate-clause-wiring.mjs --counts` -> `0 createFenceAwareEgressProxy`), its
re-enrolment rationale and its "DO NOT read the D1 grade as evidence" paragraph are all correct and
untouched. Nor is this a second copy of E8-F003: that finding owns the security consequence (a
Critical threat control recorded as delivered while enforcement exists nowhere). This one owns the
narrower fact that the register's account of WHO WOULD WIRE IT names one candidate and there are
two, and the second one's residual has no holder.

**What would close it.** Correct E5-6's `reason` to name both charters and to say that DSK-002's
half is currently held by nobody. Not done by W5U1: its charter forbids changing an existing
clause's declaration. **DONE by W16A** — see the resolution note at the top of this entry, which
also records the chartered ticket this entry missed (DAT-005, the symbol's own author) and, after
W16A-FIX, keeps DSK-003 out of the charter count it never belonged in.

## E5-F002 — The two-header upload contract has a designated single home with zero callers, and the code that actually runs re-derives it differently — including one header it omits

**Status:** open
**Severity:** MEDIUM (a dormant path; the divergence is real and measured, and the shipped variant
is the one never run against a real store)
**Filed:** 2026-09-06 (W5U1), measured at `e1f723df2`.

**What.** `grantPutHeaders` (`packages/worker-daemon/src/lease/artifact-export.ts:140-145`) exists,
by its own docstring, to stop exactly the divergence that exists:

> "This function is that knowledge, lifted out of a test harness and put beside the grant it derives
> from — **because two providers re-deriving it independently is how the second one gets it wrong
> silently.**"

It has **zero non-test callers**: `grep -rn grantPutHeaders --include=*.ts .` returns the definition,
the `packages/worker-daemon/src/index.ts:180` re-export, one comment at `index.ts:173`, and
`artifact-export-sequencer.test.ts`. Nothing in production calls it.

**FOUR independent derivations exist. They do not agree.** (The report named three; re-grepping
the harness found a fourth, identical in header set to #3.)

| # | site | `x-amz-checksum-sha256` is the digest of… | `x-amz-sdk-checksum-algorithm` | other |
|---|---|---|---|---|
| 1 | `artifact-export.ts:140` `grantPutHeaders` — the designated home, **0 callers** | the GRANT's `expectedSha256` (hex->base64) | **sent** | grant headers spread last |
| 2 | `e2b-provider.ts:142` `putGrantBytes` — **the shipped default uploader** | the BYTES BEING UPLOADED | **absent** | also sends `content-type` |
| 3 | `tests/d1/lib/e6f-harness.mjs:1503` `putPresignedBytes` — the D1 harness | the BYTES BEING UPLOADED | **sent** | — |
| 4 | `tests/d1/lib/e6f-harness.mjs:1712` `putPresignedBytesAllowError` — the harness's toxic-truncation variant | the BYTES BEING UPLOADED | **sent** | catches a severed TLS connection |

Two divergences, both measured:

1. **The header set differs.** #2 — the only one that would run in production — omits
   `x-amz-sdk-checksum-algorithm`. #1, #3 and #4 all send it, and #3's own docstring says it sets
   "both … headers **the signed PUT's query demands**".
2. **The checksum SOURCE differs.** #1 signs the server's EXPECTATION; #2, #3 and #4 sign what they
   actually uploaded. #1's docstring anticipates precisely this and calls it out: "A provider that
   hashed what it actually uploaded would produce a PUT the store accepts and a commit the control
   plane refuses `hash_mismatch`." The shipped provider is that provider.

**★ The sharpest part, and it is not in the original report.** The only live-store evidence for this
contract was gathered with derivations **#3/#4**, not #2. `keyed-dat-009-artifact-export.test.ts:28-34`
states it plainly: "It does not perform a real HTTPS PUT. The uploader is **injected**, so the store
half is not exercised here — that half is already live-proven against real MinIO by DAT-002". DAT-002
ran through the D1 harness. So the ONE of the four derivations that would actually execute in
production is the ONLY one missing a header the live-proven path sends, and it has never met a real
store on that path.

**Why MEDIUM.** Nothing calls `exportArtifact` in production
(`createArtifactExportSequencer` measures 0 callers; E5-2 says so), so no byte moves today and no
run is affected. The failure mode when it does move is fail-closed (a rejected PUT, or a
`hash_mismatch` at commit) rather than a silent bad commit. What is at stake is a contract with a
stated single home that the running code does not use, discovered late and far from the cause —
which is the outcome the single home was created to prevent.

**What would close it.** Have `putGrantBytes` call `grantPutHeaders` (spreading its own
`content-type` default and its own byte digest over the result, if the byte digest is the intended
semantics — that choice is DAT-009's, not this filing's), which would also give the designated home
a production caller. Not done here: `putGrantBytes` is on the export path DAT-009 slice 3 owns, and
changing which digest a signed PUT carries is a correctness decision with live-store consequences
that must be re-proven on the keyed lane, not asserted from a filing unit.

**Progress, 2026-09-21 (`DAT-009-3e`): decided and built, NOT live-proven. Status stays `open`.**

- **Built.** `putGrantBytes` (`packages/sandbox-e2b-provider/src/e2b-provider.ts`) now takes its
  header set from `grantPutHeaders` and re-derives nothing. That gives the designated home its
  first production caller, and the uploader now sends `x-amz-sdk-checksum-algorithm`. Its only own
  addition is a `content-type` default placed before the grant's headers.
- **Decided: the digest source is the GRANT's `expectedSha256`.** The reason: the signer binds the
  algorithm and not the value, so the store checks the body against whatever this header says.
  With the grant's value, the store refuses bytes the grant was not minted for at the PUT, instead
  of the commit refusing `hash_mismatch` later. On `exportArtifact`'s own path the two values are
  equal, because it re-hashes and refuses a mismatch before calling the uploader.
  `put-grant-bytes.test.ts` pins this, and a bytes-digest mutant goes red.
- **Why this is not closed.** The `DAT-009-3e` task says the finding stays open until the keyed lane
  re-proves the choice. Measured at source, the named lane cannot do that:
  `keyed-dat-009-artifact-export.test.ts` injects its uploader, so no real PUT happens. Its own
  header says the store half is not exercised there, and the workflow header says the same. A re-run
  of `keyed-e2b-dat-009-export.yml` would re-prove the sandbox half and would not execute
  `putGrantBytes` at all. Closing this needs a live PUT through the default uploader against a real
  store. That choice belongs to the planning session, and the `DAT-009-3e` result records it as a
  stop.

---

## E5-F003 - the approved-workspace-root check compares paths lexically while git resolves symlinks, so cleanup refuses on any symlinked root

**Status:** open
**Severity:** MEDIUM (fails CLOSED - it preserves the worktree and warns, so nothing is deleted
wrongly; the defect is that legitimate cleanup never happens and the operator is told the path is
"outside approved runtime workspace roots", which reads like a misconfiguration)
**Filed:** 2026-09-21 (M0 unit 2), measured at `169be1f2c` from `cross-platform-weekly` run
`35493290194`.

**What.** `isApprovedRuntimeWorkspacePath`
([`server/src/services/runtime-workspace-path-policy.ts:14-27`](../../../../server/src/services/runtime-workspace-path-policy.ts))
builds its approved roots with `path.resolve` and tests membership with `isStrictDescendant`
(`:4-7`), which is `path.relative` over `path.resolve`. Both are **lexical**: neither resolves
symlinks. Git, however, normalises symlinks when it creates a worktree, so a realized workspace's
`cwd` comes back RESOLVED while the project root it was derived from stays as configured.

When the configured root traverses a symlink, the resolved candidate is not a lexical descendant of
the unresolved root. `realizeExecutionWorkspace` cleanup then takes the refusal arm at
[`workspace-runtime.ts:1531-1537`](../../../../server/src/services/workspace-runtime.ts), sets
`preserve = true`, and pushes
*"Refusing to remove path ... because it is outside approved runtime workspace roots."*

**Evidence.** macOS makes this reproducible for free: `os.tmpdir()` is `/var/folders/...`, a symlink
to `/private/var/folders/...`. Three `workspace-runtime.test.ts` cases failed on
`cross-platform-weekly` for exactly this reason - the cleanup-and-remove case, the keep-unmerged-
branch case and the teardown-operations case - all three reporting the same refusal against
`/private/var/.../paperclip-worktree-repo-*/.aoa/worktrees/...`. It is not macOS-specific: a
symlinked home directory or a bind-mounted checkout produces the same shape on Linux.

**Not fixed here, and why.** M0 unit 2 repairs the LANE by resolving the fixtures' temp roots at
creation, which is what git will produce anyway; it does not touch the predicate. That predicate is
the boundary that bounds recursive deletion ("Recursive workspace cleanup is limited to server-owned
allocation roots ... Persisted row metadata is deliberately not trusted", `:9-13`), so changing it
is a security-sensitive change, and M0 introduces no new product capability. Any repair must resolve
BOTH sides - resolving only the candidate would widen the boundary rather than align it.

**Blocks gate:** no.

---

## E5-F004 - DAT-008 slice 6 is closed on the mint side only, and no standalone slice-6 record indexes it

**Status:** open
**Severity:** LOW (record-indexing) and MEDIUM (the placement-side residual) - two separable facts,
kept apart deliberately so neither is read as the other
**Filed:** 2026-09-21 (`DAT-008-A1`, M0 unit 7), verified at `5a796928bc1a64773ad7ca77971e18f9a58b6f66`.

★★★ **THIS FINDING EXISTS BECAUSE AN EARLIER DRAFT OF ITS OWN TICKET WAS WRONG.** The E5 plan
records that `DAT-008-A1` was first written to assert *"slice 6 has no record on disk at all"* and
that founder decision **D7** struck it as a **false absence claim**, verified at source. What is
absent is a `DAT-008-slice-6-*` FILENAME, not the slice. D7 also forbids a specific absence-claiming
word in any artefact this ticket writes; that word is named in the E5 plan's `DAT-008-A1` task and
is deliberately not reproduced here, because reproducing it in a register is how a struck claim
comes back through a search.

### (i) The record-indexing gap - LOW

No standalone `DAT-008-slice-6-*` result file exists. The slice is nonetheless accounted for three
times over, each re-verified at `5a796928bc1a64773ad7ca77971e18f9a58b6f66`:

- **Named:** *"Slice 6 - deferral #3, the tautological owner check"* -
  [`tickets/DAT-008-design.md:233`](./tickets/DAT-008-design.md).
- **Dispositioned:** *"Deferral #3 is closed on the MINT side only. The mint refuses unless two
  independently-derived owner authorities agree. The *original* tautological comparison in the
  placement path is untouched - DAT-008 stops relying on it; it does not delete it."* -
  [`tickets/DAT-008-result.md:111-113`](./tickets/DAT-008-result.md).
- **Implemented (mint side):** `server/src/services/execution-secret-handle-mint.ts:174` -
  `if (!ownerAuthoritiesAgree(input.placementOwner, input.credentialKind)) return
  refuse("owner_authority_disagreement");`

So the defect is that nothing INDEXES those three under a slice-6 name - a navigability problem,
not a missing-work problem.

### (ii) The placement-side residual - MEDIUM

The original tautological owner comparison **in the placement path is untouched**, deliberately.
`DAT-008` stopped relying on it; it did not delete it. Only the mint side is closed.

★ **What this is NOT.** It is not a live escape: the mint refuses unless two independently-derived
owner authorities agree, so the path `DAT-008` armed is guarded. The residual is that a second,
older comparison still exists in the placement path and still compares a value with itself.

### Disposition

`DAT-008-A1` narrows the E5 README's completion sentence to what the ledgers support and files this.
It builds neither half: the placement-side residual and slice 7 are unbuilt and stay that way, and
re-deriving the mint-side evidence is a non-goal because it is cited above.

**Blocks gate:** no.

---

## E5-F005 - the late-exit runtime-service rollback case is a real-process RACE, and it resolves differently on Windows

**Status:** open
**Severity:** LOW (one test, on an advisory lane; no product claim rests on it)
**Filed:** 2026-09-21 (M0 unit 2), measured on `cross-platform-weekly` run `35532248020`.

**What.** `ensureRuntimeServicesForRun > rejects and rolls back the whole run batch when an earlier
service exits during later readiness`
(`server/src/__tests__/workspace-runtime.test.ts:1031`) spawns **real** `node -e` child processes
and depends on their relative timing: a survivor service sleeps 700ms before listening, against a
3s readiness timeout polled every 100ms. It then asserts the failure is specifically a
`RuntimeServiceActivationFenceError`.

OBSERVED on Windows: the rejection is a plain
`Error: Failed to start runtime service "d..."` instead. The batch **is** rejected - the behaviour
under test happens - but the race resolves down a different arm, so the type assertion fails.
Green on macOS and on the required Linux lane.

★★★ **NOT FIXED BY RAISING THE TIMEOUT, DELIBERATELY.** Widening the window until Windows
wins the race would make the test pass without making it deterministic, and this repo has already
paid for that lesson in the opposite direction: a probe asserting strict `<` on same-millisecond
timestamps passed on Windows and failed on Linux, and the record of it says *"an assertion that
holds only on slow hardware is a flake, not a check."* The same applies to one that holds only on
fast hardware.

★ **Nor is it fixed by skipping on Windows.** A skip would restore the green without changing
what is known, and this lane has just finished paying for a green that hid its failures
(`E6-F023`).

### What a fix would be

Make the ordering **injected rather than raced** - the test owns the child processes it spawns, so
the survivor's listen moment and the earlier service's exit can be sequenced explicitly instead of
being scheduled against a wall clock. Then the assertion tests the fence arm because the fence arm
is the one the test arranged, on every platform.

★★★ **AMENDED 2026-09-21 - IT IS A FAMILY OF TWO, NOT ONE CASE.** Run `35533383104` turned up
a sibling with the same shape on Windows:
`startRuntimeServicesForWorkspaceControl > validates the whole batch before committing any service`
(`server/src/__tests__/runtime-service-control.test.ts`). Same subject - batch validation and
rollback over REAL spawned services - same platform, same single-test failure. Filing it as a second
finding would have split one cause across two records, so it is named here instead.

★ **That makes the fix scope clearer, not larger.** Both cases race real child processes against a
wall clock to reach a specific arm. Injecting the ordering fixes the family; widening a timeout
fixes neither, because the two cases want opposite timings.

**Blocks gate:** ~~no. These are two advisory tests, and the batch-rejection behaviour they exercise
is observed on all three platforms - only the error TYPE, or which arm is reached, differs.~~
★ **See the 2026-09-23 widening below: this line is superseded.**

★★★ **WIDENED 2026-09-23 (record custodian), verified at source - THE WINDOWS SCOPING IS
CONTRADICTED, AND THE NEW ARM IS WORSE THAN THE OLD ONE.** Recorded here rather than as a new
finding: same test, same subject, same cause family.

**The occurrence.** `ensureRuntimeServicesForRun > rejects and rolls back the whole run batch when an
earlier service exits during later readiness` failed on **`ubuntu-latest`**, on the **required**
`pr.yml` gate: run **`35877620179`**, job **`107237619508`** (`verify (2)`, conclusion `failure`,
labels `["ubuntu-latest"]`, head `5e14340c3ee79f4b7b1365cb62c4d9b27a981b05`), `1 failed | 661 passed
| 2 skipped`. It was PR #580, whose diff is `.github/workflows/d1-merge-train.yml`,
`scripts/lib/m1-spine-assertions.mjs` + its self-test, `tests/d1/m1-spine.test.mjs` and a result doc
- **nothing in `workspace-runtime.ts` or its test**. It passed on rerun.

**Two sentences in this finding are now false, and they are the two that set its scope.**
- *"Green on macOS and on the required Linux lane"* - not on this run.
- *"**Blocks gate:** no. These are two advisory tests"* - the `verify` shards on `pr.yml` **are** the
  required gate. This case can red it on an unrelated PR, and just did. `E5-F005` is therefore no
  longer confined to an advisory lane. **Severity is left at LOW and the finding is left `unowned`**
  - that is a re-rating for the owner, not a custodian's call - but the LOW rationale *"one test, on
  an advisory lane"* no longer holds as written.

**★★★ THE LINUX ARM IS NOT THE WINDOWS ARM, and this is the load-bearing difference.** On Windows
*"the batch **is** rejected - the behaviour under test happens - but the race resolves down a
different arm, so the type assertion fails."* On Linux the assertion was
`AssertionError: promise resolved "[ { ...(26) }, { ...(26) } ]" instead of rejecting`: the promise
**resolved with two service refs**. There was no rejection at all, and no rollback. So the claim
*"the rejection itself is observed on all three platforms; only the error TYPE differs"* - the whole
basis for "blocks gate: no" - **is refuted**.

**Is it a harness race or a product race? THE EVIDENCE DOES NOT DISTINGUISH THEM, and this note will
not guess.** Read at source: the batch is rejected by `validateRuntimeServiceAcquisition`
(`server/src/services/workspace-runtime.ts`), which throws `RuntimeServiceActivationFenceError` when
a record's `status` is neither `starting` nor `running`. The test arranges `exits-early`
(`node -e "setTimeout(() => process.exit(0), 100)"`, no readiness config) to die inside the survivor's
~700 ms readiness window. A resolve means `exits-early`'s record was still `starting`/`running` at
validation time, and there are two ways to get there, observationally identical in this log:
- **(H) harness/arrangement race** - the `node -e` child had not yet exited, because process spawn
  plus node startup on a loaded shared runner outran the survivor's 700 ms. The test's own
  precondition never held, no service had failed, and no rollback was owed. **This is the reading
  consistent with the existing finding's diagnosis** (both cases race real children against a wall
  clock) and with the failure being load-correlated and passing on rerun.
- **(P) product race** - the child HAD exited and the record's `status` had not caught up, so a dead
  service was still reported live to the acquisition validator. That would be a real staleness window
  in the product's view of its own children, not merely a flaky assertion.

Nothing in the job log separates (H) from (P): both yield exactly the observed resolve, and the log
carries no child-process exit timestamp. **Distinguishing them requires an instrumented rerun** that
records when `exits-early`'s process actually exited relative to the validation call - which the
"inject the ordering" fix above would also settle, because under injected ordering (P) would still
fail and (H) could not.

**What does NOT change.** The recommended fix is unchanged: inject the ordering rather than race
it. Raising the readiness timeout is still wrong for the reason already given above - it makes the
test pass without making it deterministic - and, ★ *corrected 2026-09-23 on an accepted Codex P2*,
**this occurrence is not evidence about timeout direction either way.** `waitForReadiness`
(`server/src/services/workspace-runtime.ts`) returns as soon as the survivor answers, at ~700 ms;
`timeoutSec: 3` is a DEADLINE, not a delay, so raising it does not move the validation moment on a
path where readiness succeeds. Lengthening the survivor's 700 ms sleep would give `exits-early` MORE
time to exit and make the expected rejection MORE likely - the opposite of what was observed - so
this run says nothing about extra time. *(Superseded text: "Raising the timeout is still wrong, and
now visibly so - the two platforms want opposite timings and Linux failed in the direction extra time
makes more likely.")*
Skipping remains refused (`E6-F023`). The sibling case
(`startRuntimeServicesForWorkspaceControl > validates the whole batch before committing any service`)
has **not** been observed on Linux; only this one has, and only once - no second Linux occurrence was
found in the last 120 `pr.yml` runs (17 failures, every failed `verify` job's log searched for
`workspace-runtime.test.ts`; zero hits). **One occurrence is an observation, not a pattern** - but the
platform-scoping contradiction stands on this single run, because it is a claim about where the case
*can* fail, not about how often.
---

## E5-F006 - the relayed upload grant is unauthenticated at the adapter-manager, and the redemption guard that narrows the replay is per-instance and in-memory

**Status:** open
**Severity:** MEDIUM (nothing produces `ArtifactExportRequest[]` in production yet, so no byte moves
on this path today; when it does move, the guard is real but partial)
**Filed:** 2026-09-23 (`DAT-009-3e`), verified at source on the ticket's own head.

**What.** `ArtifactUploadGrantV1` (`packages/worker-protocol/src/artifacts.ts`) carries no
control-plane signature over its integrity fields, and the presigned url binds the checksum
ALGORITHM, not the value (`grantPutHeaders`' own docstring says so). The adapter-manager therefore
cannot verify that the `expectedSha256`, `maxBytes`, `objectKey` and `url` a worker hands it are the
ones the control plane minted. `DAT-009-3e` confines what a forged or replayed grant can do
(`assertUploadGrantBound` in `packages/adapter-manager/src/server.ts`: an upload/PUT grant, an https
url on a configured store origin, an object key under the caller's own attempt prefix, a url that
targets that key, and an unexpired grant), and makes a successful redemption one-time per object key
with a lost-response replay allowed under the same `idempotencyKey`. **It does not authenticate the
grant.**

**The residual, stated precisely.** The redemption ledger is a `Map` inside one server process:
- it does not survive a restart, and it does not reach a second replica, so a re-PUT that lands on a
  different instance than the first redemption is not seen by this guard;
- two concurrent FIRST exports of one object key can both pass the check;
- retention is a fixed server-side window (`UPLOAD_REDEMPTION_RETENTION_MS`, 24 h, measured from the
  redemption on the server's own clock - deliberately not the worker's `expiresAt`, which a worker
  could shorten to buy its own eviction). Memory is bounded by one window's exports, and the window
  is a constant rather than a configured policy.

**Why this is not a defect the ticket left behind.** The complete fix is a control-plane signature
over the grant's integrity fields - i.e. a change to the FROZEN `worker-protocol` package. The E5
implementation plan names exactly that move as a STOP for this ticket (`DAT-009-3e`,
migration/compatibility: a frozen-package change for a non-frozen concern "is a STOP"), so the
ticket narrowed the replay and filed the rest rather than improvising a protocol change.

**What would close it.** One of: (a) a control-plane-signed grant covering `objectKey`,
`expectedSha256`, `maxBytes` and the url, verified at the adapter-manager - a protocol decision, not
an engineering one; or (b) a durable, shared redemption record (the control plane already refuses to
MINT a second grant for a committed artifact in
`server/src/services/artifact-transfer-grant.ts`, so the same authority could refuse a second
REDEMPTION), which would also remove the per-instance and restart limits.

**Blocks gate:** no. `E5-2` stays `unwired`; nothing produces export requests in production.

---

## E5-F007 - the shipped adapter-manager bin configures no artifact store origin, so a deployed networked export fails closed

**Status:** open
**Severity:** LOW (fail-closed and deploy-owed: an export is refused, never mis-sent)
**Filed:** 2026-09-23 (`DAT-009-3e`), verified at source on the ticket's own head.

**What.** `createProviderServer` accepts `artifactUploadOrigins`, the allow-list of object-store
origins a relayed upload grant may target, and refuses every export when it is empty - the
fail-closed default that stops a forged grant sending sandbox bytes to an arbitrary endpoint. The
composition root `packages/adapter-manager/src/bin/adapter-manager.ts` does not read any environment
variable for it (it reads the provider, template, control-plane public key, ledger dir and reaper
envs, each via `env[CONST]`). So a deployed adapter-manager refuses `export_artifact` until a deploy
ticket supplies the store origin.

**Why it was not done here.** Adding a boot env is deploy-surface work (the staging compose and the
D1/E6 harness own how the store origin reaches the container), and `DAT-009-3e`'s files are the wire
route, the adapter-manager route and the provider's header derivation. Refusing loudly and honestly
was preferred to defaulting to "any origin", which would have made the binding decorative.

**What would close it.** A DEP/E6 deploy ticket that threads the configured store origin into the
adapter-manager bin the way the control-plane public key is threaded, with a boot case proving an
unset origin still refuses.

**Blocks gate:** no. No shipped CI boot starts this bin today (`E7-1-coding-journey` records that).
---

## E5-F008 - the supervisor hands each export RPC the RUN's budget, not its own export-window budget

**Status:** open
**Severity:** MEDIUM (a lifecycle-window mismatch: the window can close while an RPC it started is
still admissible on its own budget; no byte is mis-committed, because the window latch and the
fenced commit both still refuse)
**Filed:** 2026-09-23 (`DAT-009-3e`), verified at source.

**What.** `runExportWindow` (`packages/worker-daemon/src/supervisor/supervisor.ts`) races the WHOLE
export sequence against `exportArtifactsDeadlineMs` (default 30 s, clamped on the networked lane to
`capExpiresAt - now - EXPORT_TEARDOWN_RESERVE_MS`). But each provider call inside it is made with
`run.makeCtx()`, which carries the RUN's per-op budget (resolved from `workload.maxRuntimeSeconds`,
minimum 60 s). So the ctx budget an RPC carries can be LARGER than the window that is racing it.

Downstream of that, `DAT-009-3e`'s adapter-manager clamps an artifact op to
`min(now + ctx.deadlineMs, capability.expiresAt - EXPORT_TEARDOWN_RESERVE_MS)`. It cannot clamp to
the supervisor's window, because nothing on the wire tells it what that window is: the capability's
expiry and the ctx budget are all it has.

**What is NOT at risk.** A late result is not committed: `runExportWindow`'s latch is re-checked
after every await, and the fenced commit re-verifies at the control plane. What can happen is that
an adapter-manager operation remains admissible on its own clamp for longer than the supervisor's
window, holding that sandbox's adapter-manager mutex while the supervisor has already moved on to
teardown - which is the reserve being consumed by a caller/callee disagreement rather than by a hang.

**Why `DAT-009-3e` did not fix it.** The fix belongs on the CALLER: the export window should pass a
ctx whose `deadlineMs` is its own remaining budget, which is `supervisor.ts` - `DAT-009-3c`'s file
and outside this ticket's Files list. Compensating for it at the adapter-manager would mean guessing
another process's window from a number it was never sent.

**What would close it.** An E5/E7 change in `runExportWindow` that derives each exporter call's ctx
from the window's remaining budget (the same `withDeadline` figure it already computes), with a case
asserting the ctx a provider receives never exceeds the window that is racing it.

**Blocks gate:** no.

---

## E5-F009 - an artifact is read whole into the adapter-manager's memory before any size check

**Status:** open
**Severity:** MEDIUM (a shared-process resource exposure on a path with no production producer yet;
it is not a data-integrity or cross-tenant defect)
**Filed:** 2026-09-23 (`DAT-009-3e`), verified at source.

**What.** `E2bSandboxProvider.#readArtifactBytes` (`packages/sandbox-e2b-provider/src/e2b-provider.ts`)
returns the whole file as a `Uint8Array` via `transport.readFile`. `exportArtifact` checks
`grant.maxBytes` only AFTER that read, and `digestArtifact` has no size guard at all. The control
plane permits artifacts up to the ceiling in `server/src/services/artifact-size-ceiling.ts`, so one
large artifact - or several concurrent ones across sandboxes - materializes fully in whichever
process runs the provider. Before `DAT-009-3e` that process was the desktop/self-hosted worker's own;
the wire route makes it the SHARED adapter-manager as well, which is why this is filed now.

**Why it was not fixed here.** A pre-read refusal needs a size the provider can learn WITHOUT
reading: a `stat`-shaped or streaming call on `E2bTransport`
(`packages/sandbox-e2b-provider/src/transport.ts`), which both driver implementations would have to
grow. That is a port change outside this ticket's Files list (the wire route, the adapter-manager
route, and the uploader's header derivation), and inventing a partial guard - say, refusing above an
arbitrary constant - would trade a real ceiling for a decorative one.

**What would close it.** An E7/CLI ticket that adds a size/stat op (or a streaming read) to
`E2bTransport`, refuses above `grant.maxBytes` BEFORE materializing bytes, gives `digestArtifact` the
same ceiling, and proves both with a case that never allocates the oversized buffer.

★★★ **OWNER 2026-09-23: `CLI-012` (E7)** — `epics/E7-coding-e2b/tickets/CLI-012-design.md`. *Updated with ruling F7
(`epics/E7-coding-e2b/decisions.md`, `E7-D11`); raised by Codex on PR #575. The manifest
(`scripts/finding-ownership.json`, key `E5-F009`) is updated in the same commit.*
★ *The flip happened in the commit it was promised for.* This entry previously read: *"Why it is not
declared `owned`: `check-finding-ownership` tests `tickets.has(entry.ticket)` … `CLI-012` has a graph
node and a plan task but **no ticket file** … This flips to `owned: CLI-012` in the commit that gives
`CLI-012` its first ticket file, and not before — a false claim of ownership is worse than a declared
`unowned`."* That file now exists, created so `E7-F039` could clear the same guard bar. `CLI-012` is the
ticket this entry was already describing — it owns the enumeration port and is the first production
producer of `ArtifactExportRequest[]`. **And a separate `stat` op turns out not to be needed:** the
`CLI-011` P-011 probe measured on a live sandbox (run
[`35833717162`](https://github.com/MeteoriteLabs/AoA/actions/runs/35833717162), arm `S-P6`) that
`files.list` already reports a **correct byte size** — `listSize` 3,145,728, `listSizeMatches: true`
against the real file — so the size rides the enumeration entry the port is being widened for anyway,
and the pre-read refusal costs no new transport operation. `CLI-012`'s task now requires `size` in
every entry and the `SD-6` bounds enforced from that metadata **before** `digestArtifact`, with the
review's **PC-6** as its control (drop the pre-digest check → the provider reads the whole file).
★★★ **But the pre-digest check alone does NOT discharge this finding.** *Added 2026-09-23 (Codex P1,
PR #575).* The listing size is a **snapshot**: a background writer can leave a file inside the cap at
enumeration and grow it to gigabytes before `digestArtifact`, after which the metadata check passes
and `#readArtifactBytes` still materialises the enlarged file. **`E5-F009` is discharged by a bounded
or streaming read** that stops and refuses at the cap on **both** the digest and the export path —
the pre-digest check is only the cheap arm that avoids the read at all in the common case — proven by
a case whose file **grows between enumeration and digest** and which never allocates the oversized
buffer.
The *"Why it was not fixed here"* paragraph above stands as written: it is `DAT-009-3e`'s record of
why the fix was not its.

**Blocks gate:** no. Nothing produces `ArtifactExportRequest[]` in production; `E5-2` stays
`unwired`.
