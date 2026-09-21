# DAT-011-B1 Result - the orphan sweep still has production callers end to end

**Status:** `gate_review`
**Date (UTC):** `2026-09-21`
**Epic:** `E5-workspaces-secrets`
**Plan task:** `E5 implementation-plan DAT-011-B1 - current orphan-sweep evidence on the milestone candidate (M0)`
**Implementer:** `M0 unit 6 (Claude Opus 5) - re-measure only; none of the underlying work is this record's`
**Start SHA:** `8b629fc25ad6471e04f6fe11cecbacde8fb4cedf`

The implementer leaves `Status` at `gate_review`. A separate reviewer completes the review section
and is the only role that may change it to `complete`.

★★★ This is an EVIDENCE-CURRENCY record, not a rebuild and not a re-approval of the original
ticket. `qa-handoff-recovery.md` section 2 forbids treating a prose `LANDED` header as canonical
ticket approval, so `M0` exit requires a result measured on **this** candidate. The original
[`DAT-011-result.md`](./DAT-011-result.md) is not edited: where a measurement disagrees with it, the
disagreement is recorded here as a **delta**, never repaired in place.

---
## 1. What was measured

The ticket's whole point was that `createSweepTrigger` had **no caller**. Re-measured by reading
`server/src/routes/worker-control.ts` at `8b629fc25ad6471e04f6fe11cecbacde8fb4cedf`:

| Symbol | Production caller | OBSERVED line |
|---|---|---|
| `createSweepTrigger` | `routes/worker-control.ts` | imported `:44`, constructed `:137` |
| `runArtifactOrphanSweep` | `routes/worker-control.ts` | called `:145` |
| the trigger reaches the commit path | injected as `sweepTrigger: artifactSweepTrigger` | `:158` |

The chain has production callers end to end, and the injection site is the composition root - so the
trigger is reachable **by construction** rather than by a test harness.

## 2. Deltas against the original result

**One delta — a stale citation.** ★ *Corrected 2026-09-21 in response to review attempt 1:* this section read “None. The result records the import at
`:44` and the construction at `:137`”. It does not: `DAT-011-result.md`'s only line citation is
`worker-control.ts:112`, and at this candidate `:112` is `operatorDb: opts.operatorDb,` inside
`createWorkerEnrollmentService` — unrelated to the sweep. The actual wiring, measured here: import at
`:44`, the trigger **constructed at `:137`** (`createSweepTrigger`), `runArtifactOrphanSweep` called
at `:145`, injected at `:158`. The original is `complete` and is not edited; the delta is recorded
here, which is what this record exists to do. ★ *Corrected 2026-09-21 in response to review attempt 2:* this sentence previously said
"the citation guard did not catch it because the original's citation carries no symbol anchor". That
was false. `check-register-citation-integrity.mjs` reads only the threat-controls register
(`THREAT_CONTROLS_JSON`) and its grandfather and census files; it **never scans ticket result docs**,
and within its own scope an unanchored citation fails rather than slips through. **No guard checks
result docs for citation currency** — which is the actual reason nothing caught it.

## 3. The residual, restated because it belongs in the milestone record

An organization whose **last** artifact activity produced an orphan keeps that orphan until it
commits again: the trigger is debounced, per-organization, and fires on commit, so there is no timer
to catch a final orphan. * That residual is **accepted deliberately**, and exit criterion 3's "every
terminal cleanup path" must be read against it rather than around it.

## 4. Not re-run here

The 11 unit tests, the 6/6 mutation corpus and the 68 tests across the seven artifact suites were
**not** executed in this worktree. Recorded as `not re-run`, not assumed green. * The mutation
corpus is the non-vacuousness evidence, so a reviewer needing that property at this candidate should
require a run.

## Independent review

**Reviewer:** M0 attempt-2 independent reviewer subagent (Claude) — distinct from the M0 implementation session, from the attempt-1 reviewer, and from the correcting session
**Reviewed revision:** 6f9031220bd2a20a6485b83a5b2b74cf6b5782d0
**Disposition:** `changes_requested`
**Attempt:** 2 (see Review attempt history)
**Review evidence (attempt 2):**
- §1 re-measured at the reviewed revision (`worker-control.ts` unchanged since `8b629fc25`, `git diff --stat` empty): `:44` `import { createSweepTrigger } …`; `:137` `const artifactSweepTrigger = createSweepTrigger({`; `:145` `runArtifactOrphanSweep({`; `:158` `sweepTrigger: artifactSweepTrigger,`. All hold.
- Attempt-1 finding (§2 "None" was false) — FIXED at source: `DAT-011-result.md`'s only `path:LINE` citation (`grep -nE ':[0-9]+'`, plus a check for `line N`/`L<n>` forms) is `worker-control.ts:112` (its §1, line 12); at the reviewed revision `:112` is `operatorDb: opts.operatorDb,` inside `createWorkerEnrollmentService({` (`:110`). The corrected §2 states this delta and the actual wiring accurately.
- ★ **NEW DEFECT (introduced by the correction — blocks, because a `complete` record is frozen):** §2 ends *"(The citation guard did not catch it because the original's citation carries no symbol anchor.)"* That causal claim is false. `scripts/check-register-citation-integrity.mjs` reads only `docs/architecture/distributed-execution-threat-controls.json` (`THREAT_CONTROLS_JSON`, `:109`) plus its grandfather/census JSON (`:110-111`); it never scans ticket result docs, so it could not have caught a stale citation in `DAT-011-result.md`, anchored or not. And inside its scope a MISSING anchor on an enforced citation REDS (header comment (d)); it is not a reason to pass. The sentence misstates what a guard enforces — the false-enforcement class. Fix: delete the parenthetical or replace it with "no guard scans ticket result docs for citation currency".
- Optional (attempt 1's suggestion) still not taken: `findSweepCandidates` / `markSwept` (`:148`, `:150`) are not stated; not blocking.
- §3 residual and §4 `not re-run` rows unchanged and honest; the 11 unit tests did run in PR run `35561909654` `verify (3)` (`artifact-sweep-trigger.test.ts (11 tests)` ✓); the mutation corpus was run by no one at this revision.

**Review evidence (attempt 1):**
- **§1 OBSERVED values hold at `8b629fc25` and at the reviewed revision** (`git show <rev>:server/src/routes/worker-control.ts`, file unchanged between them): `import { createSweepTrigger }` `:44`; `const artifactSweepTrigger = createSweepTrigger({` `:137`; `runArtifactOrphanSweep({` `:145`; `sweepTrigger: artifactSweepTrigger,` `:158` inside `createArtifactCommitService({...})`. The commit service fires the trigger on the stale-fence refusal (`artifact-commit.ts:199`, around `resolveWorkerFenceContext`), on `DbJobFenceError` (`:354`) and on success (`:395`). Context the record omits: `workerControlRoutes` is mounted only under `opts.distributedExecutionEnabled` (`server/src/app.ts:490-504`), so "reachable by construction" means reachable when distributed execution is enabled.
- **§2 is FALSE at source — blocking.** It states *"None. The result records the import at `:44` and the construction at `:137`"*. `tickets/DAT-011-result.md` records neither: its only line citation is *"threaded from the composition root at `worker-control.ts:112`"* (§1), and at both `8b629fc25` and the reviewed revision line 112 is `operatorDb: opts.operatorDb,` inside `createWorkerEnrollmentService({` — not the sweep trigger (at the landing commit `bbe50dc7d` the construction was already at `:119`). There IS a delta — the original's `:112` citation is stale — and this record exists to record exactly that kind of delta. Also, §1 re-measures two of the original's four production-caller symbols; `findSweepCandidates` and `markSwept` (`worker-control.ts:148`, `:150`) are present but not stated.
- **§4 not-re-run rows:** honestly recorded. The 11 unit tests in fact ran on the reviewed revision in CI run `35561909654` (`verify (3)`: `src/__tests__/artifact-sweep-trigger.test.ts (11 tests)` passed; all four `verify` shards `success`; `ci-required` failed only on the `do-not-merge` label). The 6/6 mutation corpus was not run by anyone at this revision — acceptable as `not re-run`, not as passing.
- **Residual (§3)** matches `DAT-011-result.md` §5 and the absence of any timer in the trigger's wiring (debounce `intervalMs` only, fired from commit paths).
- **Required to approve:** rewrite §2 to record the `worker-control.ts:112` → `:137` delta against the original (and, optionally, state the other two symbols).

For `approved`, verify each OBSERVED value above against the named source at the reviewed revision,
and confirm that every row marked `not re-run` is accepted as such rather than read as passing. Then
change the top-level `Status` to `complete` and commit that disposition separately.

★ `M0` exit criterion 6 requires this result **approved**, not merely committed. It is left at
`gate_review` because its author may not approve it.

## Review attempt history

The implementation author leaves the table body empty; the pending summary above is not a review attempt. The first independent reviewer appends attempt 1, and later reviewers append monotonically increasing rows without replacing prior attempts. The summary fields above mirror the latest real attempt. Do not include a `Review commit` column: a row cannot embed the SHA of the commit that first contains it.

| Attempt | Reviewer | Reviewed revision | Disposition | Evidence/findings |
|---:|---|---|---|---|
| 1 | M0 independent reviewer subagent (Claude) — distinct from the M0 implementation session | `5f3b47556d0df152db0d53d76c304861f30ffd37` | `changes_requested` | §1 values `:44/:137/:145/:158` hold at `8b629fc25` and HEAD. **§2 false:** original `DAT-011-result.md` cites only `worker-control.ts:112` (stale — now `operatorDb:` in enrollment), never `:44/:137`; the "no delta" claim is wrong. 11 unit tests green in CI `35561909654` verify(3); mutation corpus unrun (acceptable as unrun). Routes mounted only under `distributedExecutionEnabled`. |
| 2 | M0 attempt-2 independent reviewer subagent (Claude) | `6f9031220bd2a20a6485b83a5b2b74cf6b5782d0` | `changes_requested` | Attempt-1 §2 finding FIXED at source: the original's only line citation is `worker-control.ts:112` = `operatorDb: opts.operatorDb,` in `createWorkerEnrollmentService`; `:44/:137/:145/:158` re-verified. NEW DEFECT from the correction: §2's "the citation guard did not catch it because the original's citation carries no symbol anchor" is false — `check-register-citation-integrity.mjs` scans only the threat-controls JSON (`:109`), never ticket result docs, and a missing anchor REDS inside its scope. Must be removed/reworded before freeze. |
<!-- Later reviewers append attempt 2+ below without rewriting attempt 1. -->
