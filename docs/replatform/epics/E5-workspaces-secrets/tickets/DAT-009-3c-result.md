# DAT-009-3c Result — the supervisor export-artifacts hook

**Status:** `complete` (set 2026-09-23 by the M1 review-batch-3B independent reviewer at attempt 2, revision `60aafb32ec6f8316f92079789cf8814f981f3ed3`)
**Date (UTC):** `2026-09-21`
**Epic:** `E5-workspaces-secrets`
**Plan task:** `E5 implementation-plan DAT-009-3c — the supervisor export hook (M, M1b)`
**Decision:** [`decisions.md`](../decisions.md) **E5-D07**, `accepted` (planning session, founder delegation F2)
**Implementer:** `DAT-009-3c build session (Claude Opus 5)`
**Start SHA:** `28a2dd259` (`docs/replatform-program` tip)
**Reviewed revision (the code commits):** `79961c97c46dda930c7f7ceda6c6ee6175fead6a` (the hook) + `f5e2aff1f466cd6ecebc9eaa74313e8251ef93fc` (the Codex latch fix); the tree under review is `f5e2aff1f`

The implementer leaves `Status` at `gate_review`. Only a distinct reviewer may change it to
`complete`.

## 1. What was built

- **`SupervisorDeps.exportArtifacts`**: the sequencer, of type `ArtifactExportSequencer`. It is
  injected at construction, and the dispatch runtime builds it in `3d`. **`resolveExportArtifacts`**
  is the producer (`CLI-012`). **`exportArtifactsDeadlineMs`** is the budget, default 30 s.
- **Construction rule:** a producer without a sequencer throws in `createSupervisor`. A sequencer
  without a producer is inert.
- **`runExportWindow`** (`supervisor.ts`) runs one window per run.
  - **Placement:** batch arm only, after the `observeRun` block and before the normal
    `events.terminal` and `finishRun`.
  - **Budget:** one budget covers the producer and every file. On the networked lane it is clamped to
    `capExpiresAt − now − EXPORT_TEARDOWN_RESERVE_MS` (30 s, `run-op-deadline.ts`). If the clamped
    budget is ≤ 0, the window is not opened (`export_window_exhausted`). If the authority is already
    withdrawn, the producer is not called (`authority_withdrawn`).
  - **Per-run exporter:** closed over this run's `sandboxId`, and it reads `run.effect` **at call
    time**, so withdrawal refuses inside `EffectAuthority`.
  - **Window latch:** closes the exporter when the window ends. It is checked before **and after**
    each awaited provider call (Codex, PR #549): a late digest mints nothing, and a late upload is
    never committed. The uncommitted object is left to the orphan sweep.
  - **Metrics:** `digest_artifact` is emitted per digest call. `export_artifact` is emitted
    **exactly once per window** (`success` / `failed` / `timed_out`).
  - **Logs** carry `{leaseId, resourceLabelsHash, stage, reason, exported}` only. They never include
    the error, its message, a path, the grant URL or bytes.
- **`ArtifactExportFailedError.reason`** (`artifact-export.ts`): a path-free snake_case code. It is
  the server's own refusal code (`attempt_terminal`, `stale_fence`, …) or a fixed local code
  (`digest_failed`, `http_<n>`, `malformed_grant`, …). Anything else becomes `unknown`
  (`exportReasonCode`).
- **`ArtifactExportSequencer` is declared as its own function type**, not
  `ReturnType<typeof createArtifactExportSequencer>`. **Positive control observed:** with the
  `ReturnType` form, `check-gate-clause-wiring` went **red** ("`E5-2` … has 1 reference(s), expected
  0"). Naming the type counted as a reference to the constructor, which would have been a false
  "caller". `E5-2` stays `unwired`, and `createArtifactExportSequencer` still has zero production
  callers.
- **Ruling 6 (`timed_out`):** `emitOp` labels are the worker-daemon's own `SANDBOX_OP_METRIC` allow-list
  (`metrics.ts`), where `timed_out` already exists. `packages/worker-protocol/src` has no `timed_out`.
  `pnpm check:frozen-worker-protocol-v1` → `frozen worker-protocol v1 consumer: OK`.

## 2. RED → GREEN

**RED** (test file written before any source change), run with
`npx vitest run src/__tests__/supervisor-export-artifacts.test.ts`: **14 failed | 5 passed (19)**.
- The 14 red cases include placement, the real sequencer end to end, the construction throw, both
  best-effort cases, the deadline, both withdrawn-authority cases, the path-free reason, the F10
  cross-tenant case and all three networked cases.
- **The 5 cases green at RED are controls, green by construction before the hook existed:**
  hook-absent, sequencer-without-producer, Ruling B cancelled-while-executing, failed-command
  terminal, and no-path. Mutants in §3 prove four of them non-vacuous: M1 (failed-command terminal,
  no-path), M3 (sequencer-without-producer), M6 (no-path) and M12 (Ruling B). Hook-absent pins
  byte-identity when neither dep is set, and no mutant targets it.

**GREEN** at `f5e2aff1f` (21 cases after the Codex fix):
- The task's verify command (the protocol build, then `vitest run` on
  `supervisor-export-artifacts` + `artifact-export-sequencer` + `supervisor-happy.component`) gives
  **3 files, 52 passed** (21 + 16 + 15). *Corrected 2026-09-21 per the attempt-1 review, by the planning session (not the reviewer): Superseded text: "3 files, 50 passed", the count from before the Codex fix. The reviewer reproduced 52 on a clean detached checkout of `f5e2aff1f`.*
- The full worker-daemon suite gives **159 files, 1070 passed, 1 skipped**. The worker-daemon typecheck
  and build exit 0.
- `check-worker-daemon-boundary` gives PASS, and `check:frozen-worker-protocol-v1` gives OK.
- The full `pr.yml` guard set plus `check-evidence-immutability`: **0 failures**.

## 3. Mutation table (each applied alone, test file rerun, source restored)

| # | Mutant | Result | Killed by |
|---|---|---|---|
| M1 | fail-closed: a refusal re-throws out of the window | 4 red | sequencer refusal, producer throw, failed-command terminal, no-path |
| M2 | the window runs **after** the terminal | 1 red | placement (before terminal) |
| M3 | the sequencer runs with no producer (a `[]` stub) | 1 red | sequencer-without-producer inert |
| M4 | no `withDeadline` race | 2 red | both deadline-value cases |
| M5 | no window latch | 1 red | deadline + latch |
| M6 | the error message is logged | 2 red | reason-by-name, no-path |
| M7 | the exporter is bound to the last-created sandbox | 1 red | **F10 two-Organization case** |
| M8 | no networked clamp | 2 red | clamp value, window-exhausted |
| M9 | `exportArtifact` bypasses `EffectAuthority` | 1 red | lease lost mid-window |
| M10 | `reason` = free text | 2 red | reason-by-name, path-free reason |
| M11 | no withdrawn-at-open check | 1 red | authority withdrawn at open |
| M12 | cancelled-while-executing also opens the window | 1 red | Ruling B (only the normal terminal exports) |

| M13 | no latch re-check after the digest await | 1 red | late digest mints no grant |
| M14 | no latch re-check after the export await | 1 red | late upload is never committed |

**14 of 14 killed.** M13 and M14 were added for the Codex P1 finding on `98428225b`: the latch was
checked only before each await. They were run against `f5e2aff1f`. ★ M12 first **survived** (19/19 green). The Ruling B case asserted only that the
producer was not called, and a window opened after a cancel refuses at the withdrawn-authority check
without calling the producer. The case now also asserts that **no** `export_artifact` outcome is
emitted, and M12 goes red. This is recorded because a case that survives its own mutant was a check
that evaluated nothing.

## 4. Multi-tenant (F10)

The two-Organization case runs Organizations A and B concurrently in one supervisor. Both windows are
held until both sandboxes exist.
- Each exporter's `digestArtifact` and `exportArtifact` reach only **its own** `sandboxId`.
- Each grant's `expectedObjectKey` carries its own `organizations/<org>/jobs/<job>/` prefix.
- Each commit manifest carries its own `organizationId`, keyed by its own `leaseId`.
- **Same-tenant positive control:** A's export succeeds under A's prefix.
- **Mutant M7** (a supervisor-scoped "last created sandbox") goes red.

## 5. Findings and plan deltas

1. **The M1 plan (§1.2) says the E5 `decisions.md` "does not exist".** It existed at the start SHA,
   created as a shell in S0-3.
2. **Ruling B's terminal count is stale:** there are **16** `events.terminal(` call sites, not the 14
   counted at `31d33a3b0`. The two new ones are the SVC-008b service arm's, upstream of `execute`.
   Only two sites are downstream of `emitOp("execute","success")`, as before.
3. **The 3c plan's "hook throwing/timing out emits `failed`" is superseded** for the deadline case by
   ruling 6 (`timed_out`).
4. **Not built here, by ruling:**
   - the composition (`3d`);
   - the producer and its fenced enumeration (`CLI-012`);
   - the per-file policy (`CLI-012`, gated on F7);
   - the `E5-2` promotion (`CLI-012`, ruling 4).

## 6. CI

Measured on head `a040e3a39` (which carries the reviewed code tree `f5e2aff1f`), `pr.yml` run
`35590700974`:
- **`ci-required`** (job `106309376411`): **success**.
- **`verify (2)`** (job `106304320350`): executed `supervisor-export-artifacts.test.ts`, **21 tests**,
  all passed. The shard total was **6231 passed, 33 skipped (6264)**.
- `verify (1)`, `(3)` and `(4)`: success.

Codex review on `a040e3a39`: "Didn't find any major issues". Its one earlier P1 (the latch
re-check, on `98428225b`) is fixed in `f5e2aff1f`, replied to and resolved.

This section was added in a docs-only commit after that run, so the final head differs from
`a040e3a39` by this file only.

## 7. Reviewer section

*(Distinct reviewer only.)*

**Reviewer:** M1 review-batch-2B independent reviewer (Claude Opus 5) — distinct from the DAT-009-3c build session and the planning session
**Reviewed revision:** fc2eb7dde6325803c77950ac4adb1d190db0bd9a
**Disposition:** `changes_requested`
**Attempt:** 1 (see *Independent review — attempt 1* and the attempt history)

### Independent review — attempt 1

**Disposition: `changes_requested`.** `Status` stays `gate_review`. Reviewed at
`fc2eb7dde6325803c77950ac4adb1d190db0bd9a` (program tip `docs/replatform-program`, the merge of PR
#547). The start SHA `28a2dd259`, the hook commit `79961c97c46d…`, the Codex fix `f5e2aff1f466…`, the
CI head `a040e3a39df2…` and the Codex-P1 head `98428225b` are all ancestors of it.
`git diff f5e2aff1f fc2eb7dde` over the three focused test files and `lease/artifact-export.ts` is
empty, so for everything this ticket touched the tree the record describes is the tree under review.

**★ BLOCKING — the GREEN focused-command count is false.** §2 says the task's verify command at
`f5e2aff1f` "gives **3 files, 50 passed**". I ran it on a clean detached checkout of
`f5e2aff1f466cd6ecebc9eaa74313e8251ef93fc` (fresh `pnpm install --frozen-lockfile`, protocol build
exit 0) and got **3 files, 52 passed**: `supervisor-export-artifacts.test.ts` 21,
`artifact-export-sequencer.test.ts` 16, `supervisor-happy.component.test.ts` 15. The reviewed tip gives
the same. 50 is the pre-Codex figure (19 + 16 + 15, at `79961c97c`), and the same paragraph already
says there are 21 cases after the Codex fix. A GREEN count that does not match its own command is the
records-disagree-with-code class that this programme treats as a defect, however small.
**Fix:** in §2, state the verify-command result at `f5e2aff1f` as **3 files, 52 passed** (21 + 16 +
15), and keep the old figure as `Superseded text: "3 files, 50 passed"`. Nothing else needs to change.

**Verified at source, and needing no change:**

- **The hook, at source** (`supervisor.ts`: the batch arm of the lifecycle, and `runExportWindow`).
  - The window runs only when both `resolveExportArtifacts` and `exportArtifacts` are set. It runs
    after the `observeRun` block and before the normal `events.terminal` and `finishRun`. The
    cancelled-while-executing branch returns before it (Ruling B).
  - `createSupervisor` throws on a producer with no sequencer.
  - The budget is `exportArtifactsDeadlineMs` (default 30 000). On the networked lane it is clamped to
    `capExpiresAt − now() − EXPORT_TEARDOWN_RESERVE_MS`. `!(budget > 0)` gives
    `export_window_exhausted`. An inactive `run.effect` gives `authority_withdrawn` before the
    producer is called.
  - The exporter is closed over this run's `sandboxId`. It calls `run.effect.digestArtifact` and
    `.exportArtifact` at call time, and runs `assertOpen()` before and after each await.
  - `report()` emits `export_artifact` once per window. It logs only
    `{leaseId, resourceLabelsHash, stage, reason, exported}` and never logs the error object.
- **Path-free reason.** `ArtifactExportFailedError.reason` is set through `exportReasonCode` in
  `lease/artifact-export.ts`. `ArtifactExportSequencer` is a declared function type in the same file.
- **Positive control on the type, reproduced.** I changed `SupervisorDeps.exportArtifacts` to
  `ReturnType<typeof createArtifactExportSequencer>`. `check-gate-clause-wiring` then reported
  "`E5-2-fenced-object-commit-worker-half`: declared unwired but it now HAS a caller …
  `createArtifactExportSequencer` has 1 reference(s), expected 0". After I restored the file, the guard
  was OK and `E5-2` was still dormant. At the tip, `--counts` still gives `createArtifactExportSequencer`
  **0**.
- **Ruling 6.** `timed_out` is a member of the `SANDBOX_OP_METRIC` outcome set in
  `metrics/metrics.ts`. `grep -rn timed_out packages/worker-protocol/src` returns nothing.
  `pnpm check:frozen-worker-protocol-v1` at `f5e2aff1f` gives `frozen worker-protocol v1 consumer: OK`.
- **The eight E5-D07 rulings** (`decisions.md`, "Rulings of record"), each evidenced:
  1. Wiring as designed: the code above. The F10 case and M7 exist.
  2. Best-effort: every failure path calls `report("failed" | "timed_out", …)` and returns. The
     terminal is computed from `exec` alone.
  3. Path-free `reason`: above. `artifact-export.ts` is in the hook commit.
  4. `3d` does not promote `E5-2`: the `3d` task text in `implementation-plan.md` is amended with its
     history kept, and so is T7's checklist line. `E5-2` stays `unwired`.
  5. `CLI-012`'s Files add `effect-authority.ts` and `supervisor.ts`: both are present in the E7 plan
     `### CLI-012`.
  6. `timed_out`: above.
  7. Per-file policy is left to `CLI-012`: the window reports the first failing file's `stage` and
     `reason`.
  8. Design points 1 and 6 are noted in the result: §5 items 1 and 2.
- **F10 is real.** `makeTenantBHandoff` gives a different `organizationId`, `companyId`, `jobId` and
  `leaseId`. The case runs both `accept`s concurrently and holds both producers until both sandboxes
  exist. It asserts digests and exports per sandbox, `expectedObjectKey` prefixes per Organization,
  and the manifest `organizationId` per lease.
- **Full suite, typecheck, build and boundary at `f5e2aff1f`.** `vitest run` in `worker-daemon` gives
  **159 files, 1070 passed, 1 skipped**, which matches. `typecheck` exits 0, `build` exits 0, and
  `check:worker-daemon-boundary` gives PASS.
- **Mutations, reproduced by me and reverted.**
  - M13 (drop the `assertOpen()` after the digest await): **1 failed**, *a digest that resolves AFTER
    the deadline mints no grant*.
  - M14 (drop it after the export await): **1 failed**, *an upload that lands AFTER the deadline is
    never committed*.

  Both match the table. I checked the rest by reading the tests.
- **CI, by job.** Run `35590700974` (`pull_request`, headSha `a040e3a39df2…`, conclusion `success`,
  `ci-required` `106309376411` success). In `verify (2)` (job `106304320350`),
  `supervisor-export-artifacts.test.ts (21 tests)` and `artifact-export-sequencer.test.ts (16 tests)`
  both passed. The shard total is **656 files passed / 2 skipped, 6231 tests passed / 33 skipped
  (6264)**, which matches §6.
- **Codex.** On PR #549, the P1 (latch re-check) was answered as real and fixed in `f5e2aff1f`.
  `chatgpt-codex-connector` then reported "Didn't find any major issues" on `a040e3a39d` and again on
  the final head `17a85bf8c8`.
- **Not blocking, noted.**
  - `Start SHA` is a 9-character short SHA, not the bare 40-hex that the E4 §3 protocol names. It
    resolves unambiguously to an ancestor.
  - The plan asks for one commit. There are two code commits; the second is the Codex fix, and the
    record says so.

### Independent review — attempt 2

**Reviewer:** M1 review-batch-3B independent reviewer (Claude Opus 5) — distinct from the DAT-009-3c
build session, from the planning session that applied the correction, and from the attempt-1 reviewer
**Reviewed revision:** `60aafb32ec6f8316f92079789cf8814f981f3ed3`
**Disposition:** `approved`
**Attempt:** 2

**Disposition: `approved`. `Status` moves to `complete` in a separate commit.** Reviewed at the
`docs/replatform-program` tip (the merge of PR #565). The hook commit `79961c97c`, the Codex latch
fix `f5e2aff1f`, the CI head `a040e3a39`, the attempt-1 reviewed revision `fc2eb7dde` and the
correction PR #562's head `b29be4089` are all ancestors of it.

**The one requested change is made, and it is correct.** Attempt 1 required §2 to state the verify
command's result at `f5e2aff1f` as 52 rather than 50, keeping the old figure as superseded text. §2
now reads *"gives 3 files, 52 passed (21 + 16 + 15)"* with the parenthetical *"Corrected 2026-09-21
per the attempt-1 review, by the planning session (not the reviewer): Superseded text: '3 files, 50
passed', the count from before the Codex fix."* The superseded figure keeps its original wording, the
correction names who made it and why, and the reviewer is correctly not credited with editing the
record under review.

**Verified at source, not taken from the correction.** `git diff f5e2aff1f HEAD` over
`supervisor-export-artifacts.test.ts`, `artifact-export-sequencer.test.ts`,
`supervisor-happy.component.test.ts`, `supervisor/supervisor.ts` and `lease/artifact-export.ts` is
**empty**, so the reviewed tip is the tree the count describes. I ran the task's verify command here
— `worker-protocol` build exit 0, then
`vitest run supervisor-export-artifacts + artifact-export-sequencer + supervisor-happy.component` —
and got **3 files, 52 passed**: 21, 16 and 15 respectively. The corrected number is the measured one.

**Re-checked independently of attempt 1.**

- **The hook.** `runExportWindow` (`packages/worker-daemon/src/supervisor/supervisor.ts`) is called
  from the batch arm at the single site after the `observeRun` block and before the normal
  `events.terminal` and `finishRun`, taking this run's `created.sandboxId` as a parameter. It calls
  `run.effect.digestArtifact(sandboxId, …)` and `run.effect.exportArtifact(sandboxId, …)`, so the
  binding is per-run by construction rather than by discipline.
- **Mutation reproduced by me, and reverted.** **M7**: rebinding the exporter to a supervisor-scoped
  "last created sandbox" gives **1 failed** and 20 passed — the F10 case, on
  `expect([...rec.digests].sort()).toEqual([sbxA, sbxB].sort())`, with tenant B's sandbox id
  appearing twice and tenant A's missing. That is the table's row exactly, and it is the assertion
  that makes the F10 case load-bearing rather than decorative: had the two tenants shared a sandbox
  id or had the case asserted only a count, the mutant would have survived.
- **F10 is real.** The case runs Organizations A and B concurrently in one supervisor and holds both
  windows until both sandboxes exist, which is what gives a runtime-scoped binding the chance to
  cross the tenants that M7 then exercises.
- **M12's recorded survival is the right kind of disclosure.** §3 records that M12 first survived
  because the Ruling B case asserted only that the producer was not called — a refusal at the
  withdrawn-authority check produces the same observation — and that the case now also asserts no
  `export_artifact` outcome is emitted. A case that survives its own mutant is a check that evaluates
  nothing, and writing that down rather than quietly strengthening the test is the behaviour this
  programme wants.
- **Guard set.** The full `pr.yml` guard set minus the six excluded by the M1 rules, plus
  `check-evidence-immutability --base origin/docs/replatform-program`, is **0 failures** at the
  reviewed tip.

**Acceptance.** Attempt 1 verified the eight `E5-D07` rulings, the placement, clamp, latch and
path-free logging at source, the `ReturnType` positive control, ruling 6's `timed_out`, the full
suite, typecheck, build, boundary and frozen-protocol checks, and CI run `35590700974` by job. I
re-derived the parts the correction touches and spot-checked the rest; I found nothing that
contradicts attempt 1. With the one requested change made and independently confirmed, **every
acceptance item is met**.

**Not blocking, carried forward.** Attempt 1's two notes stand: the `Start SHA` is a 9-character
short SHA rather than the bare 40-hex the E4 §3 protocol names, and there are two code commits where
the plan asks for one (the second being the Codex fix, which the record states).

## Review attempt history

Later reviewers append rows with increasing attempt numbers without replacing earlier ones. Do not include a `Review commit` column: a row cannot embed the SHA of the commit that first contains it.

| Attempt | Reviewer | Reviewed revision | Disposition | Evidence/findings |
|---:|---|---|---|---|
| 1 | M1 review-batch-2B independent reviewer (Claude Opus 5) | `fc2eb7dde6325803c77950ac4adb1d190db0bd9a` | `changes_requested` | BLOCKING: §2's GREEN focused count "3 files, 50 passed" is false. A rerun at `f5e2aff1f` on a clean checkout gives **52** (21 + 16 + 15); 50 is the pre-Codex figure. Fix: state 52 and keep the old figure as superseded text. Verified with no change needed: hook placement, clamp, latch and path-free logging at source; all eight E5-D07 rulings evidenced; the ReturnType positive control reproduced (guard red, `E5-2` has 1 reference); the F10 two-Organization case is real; full suite 159 / 1070 / 1 skipped; typecheck and build exit 0; boundary PASS; frozen-protocol OK; M13 and M14 reproduced (1 failed each); run `35590700974` `verify (2)` executed 21 + 16, shard 6231 / 33; Codex clean on `a040e3a39d` and `17a85bf8c8`. |
| 2 | M1 review-batch-3B independent reviewer (Claude Opus 5) | `60aafb32ec` (program tip, the #565 merge) | `approved` | The one requested change is made and independently confirmed: §2 now states **3 files, 52 passed** (21 + 16 + 15) and keeps `Superseded text: "3 files, 50 passed"` with the correction attributed to the planning session. `git diff f5e2aff1f HEAD` over the three test files, `supervisor.ts` and `artifact-export.ts` is empty, and rerunning the task verify command at the tip gives **52**. Re-checked the hook at source (per-run `sandboxId` passed as a parameter). **M7 reproduced** — 1 failed, the F10 case, with B's sandbox id twice and A's missing — which shows the F10 case is load-bearing. M12's recorded first survival is the right disclosure. Guard set 0 failures. Attempt 1's substantive verifications re-derived or spot-checked with no contradiction; every acceptance item met. `Status` moves to `complete`. |
