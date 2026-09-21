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

**None.** The result records the import at `:44` and the construction at `:137`; both are exact at
this candidate, and the injection at `:158` is as recorded.

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

**Reviewer:** `pending`
**Reviewed revision:** `pending`
**Disposition:** `pending`
**Attempt:** none recorded

For `approved`, verify each OBSERVED value above against the named source at the reviewed revision,
and confirm that every row marked `not re-run` is accepted as such rather than read as passing. Then
change the top-level `Status` to `complete` and commit that disposition separately.

★ `M0` exit criterion 6 requires this result **approved**, not merely committed. It is left at
`gate_review` because its author may not approve it.
