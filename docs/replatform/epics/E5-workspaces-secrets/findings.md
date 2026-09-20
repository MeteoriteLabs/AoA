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

**Blocks gate:** no. These are two advisory tests, and the batch-rejection behaviour they exercise
is observed on all three platforms - only the error TYPE, or which arm is reached, differs.
