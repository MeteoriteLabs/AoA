# TRACK-002-B1 Result - the execution census still runs, and its recorded counts are stale

**Status:** `complete`
**Date (UTC):** `2026-09-21`
**Epic:** `E6-deployment-test-harness`
**Plan task:** `E6 implementation-plan TRACK-002-B1 - current census evidence on the milestone candidate (M0)`
**Implementer:** `M0 unit 6 (Claude Opus 5) - re-measure only; none of the underlying work is this record's`
**Start SHA:** `8b629fc25ad6471e04f6fe11cecbacde8fb4cedf`

The implementer leaves `Status` at `gate_review`. A separate reviewer completes the review section
and is the only role that may change it to `complete`.

★★★ This is an EVIDENCE-CURRENCY record, not a rebuild and not a re-approval of the original
ticket. `qa-handoff-recovery.md` section 2 forbids treating a prose `LANDED` header as canonical
ticket approval, so `M0` exit requires a result measured on **this** candidate. The original
[`TRACK-002-result.md`](./TRACK-002-result.md) is not edited: where a measurement disagrees with it, the
disagreement is recorded here as a **delta**, never repaired in place.

---
## 1. What was measured

| Clause | OBSERVED at `8b629fc25ad6471e04f6fe11cecbacde8fb4cedf` | State |
|---|---|---|
| the guard runs and passes | `node scripts/check-execution-census.mjs` exit 0 | **green** |
| manifest coverage | **70** `*.test.mjs` on disk, **67** declared running, **3** declared unrun | **green** |
| vitest project coverage | 28 packages with vitest specs, 25 owning a vitest config, all present among 29 projects | **green** |
| unit tests | `scripts/lib/__tests__/execution-census.test.mjs` - **15** cases | see delta 2 |
| declared in the guard inventory | `scripts/guard-inventory.json` names `check-execution-census.mjs` | **green** |

## 2. Deltas against the original result - TWO, both counts

1. **The manifest counts moved.** The result records *"48 files - 44 running, 4 unrun"*. OBSERVED:
   **70 / 67 / 3**. The mechanism is unchanged; the tree grew and the manifest was maintained with
   it, which is the guard working rather than failing.
2. **The unit-test count moved.** The result records *"13 unit tests"*. OBSERVED: **15**.

★ Neither is repaired in the original file. They are exactly what an evidence-currency record exists
to surface: those figures cited at a later gate would describe a smaller suite than the one that
actually runs.

## 3. The caveat the guard prints, carried verbatim

> `NOTE: 'runs' means the declaration still matches the tree, NOT observed execution`

★★★ This record does not upgrade that into an execution claim. 67 files are *declared* running, and
the declaration is verified against the named workflow step's `run:` block with comments stripped -
a strong check on the WIRING and **no check at all** that the runner executed them on this
candidate. Quoting the count without the caveat is the failure class this programme calls "a check
that nothing runs is not a check", one register over.

## 4. Not re-run here

The 15 unit cases were read, not executed. Recorded as `not re-run`.

## Independent review

**Reviewer:** M0 independent reviewer subagent (Claude) — distinct from the M0 implementation session
**Reviewed revision:** 5f3b47556d0df152db0d53d76c304861f30ffd37
**Disposition:** `approved`
**Attempt:** 1
**Review evidence:**
- Measured SHA `8b629fc25` vs reviewed revision: `git diff --stat 8b629fc25 HEAD` touches no census input (`scripts/test-execution-census.json`, `scripts/lib/execution-census.mjs`, `vitest.config.ts`, no `*.test.mjs` added/removed); the only workflow change is `cross-platform-weekly.yml`. Every value was nevertheless RE-MEASURED at `5f3b47556`, not inherited.
- `node scripts/check-execution-census.mjs` at the reviewed revision -> exit `0`: `70 *.test.mjs on disk, 67 declared running, 3 declared unrun; 28 packages with vitest specs and 25 owning a vitest config, all present among 29 projects`. Independently: `find scripts docker -name '*.test.mjs'` = 70 (the guard's `SEARCH_ROOTS = ["scripts", "docker"]`; repo-wide there are 86, which the guard does not claim to cover); `scripts/test-execution-census.json` `files` = 70 entries, status counter `runs: 67, unrun: 3`; `vitest.config.ts` `projects[]` = 29 entries.
- Unit-test count: `scripts/lib/__tests__/execution-census.test.mjs` has 15 top-level `test(` cases. The row marked `not re-run` is SATISFIED rather than merely accepted: `node --test scripts/lib/__tests__/execution-census.test.mjs` locally -> `tests 15 / pass 15 / fail 0`; and CI run `35561909654` (PR workflow, head `5f3b47556`) job `policy` = success, step `Execution census (a test file that nothing runs is not coverage)` = success -- that step's `run:` block in `.github/workflows/pr.yml` executes exactly this unit test and the guard.
- `scripts/guard-inventory.json` key `scripts/check-execution-census.mjs` -> `status: ci`, confirmed genuinely invoked by `pr.yml` (above).
- Deltas: original `TRACK-002-result.md` records `48 files — 44 running, 4 unrun` and `13 unit tests` -- both deltas are real and correctly stated; the original is unedited in this range.
- Caveat (section 3): the guard prints `NOTE: 'runs' means the declaration still matches the tree, NOT observed execution — see lib header.` The record's "verbatim" quote omits the trailing ` — see lib header.`; the substantive text is exact. Non-blocking. The record correctly refuses to upgrade the 67 into an execution claim.
- Not cited: no `cross-platform-weekly` run is cited (the E6-F023 trap is not engaged). Run `35561909654`'s `ci-required` = failure solely from the `do-not-merge` label on the program PR (all 15 other jobs success) -- not a test-health signal either way.

For `approved`, verify each OBSERVED value above against the named source at the reviewed revision,
and confirm that every row marked `not re-run` is accepted as such rather than read as passing. Then
change the top-level `Status` to `complete` and commit that disposition separately.

★ `M0` exit criterion 6 requires this result **approved**, not merely committed. It was left at
`gate_review` by its author, who may not approve it; a distinct reviewer approved it and set
`Status` to `complete` (see the review attempt history).

## Review attempt history

The implementation author leaves the table body empty. The first independent reviewer appends attempt 1, and later reviewers append monotonically increasing rows without replacing prior attempts. The summary fields above mirror the latest real attempt. No `Review commit` column: a row cannot embed the SHA of the commit that first contains it.

| Attempt | Reviewer | Reviewed revision | Disposition | Evidence/findings |
|---:|---|---|---|---|
| 1 | M0 independent reviewer subagent (Claude) — distinct from the M0 implementation session | `5f3b47556d0df152db0d53d76c304861f30ffd37` | `approved` | Guard re-run at reviewed revision exit 0 with 70/67/3 and 28/25/29; independently re-counted disk (70 under scripts+docker), manifest (67 runs / 3 unrun), `projects[]` (29). Unit tests 15/15 pass locally and in CI run `35561909654` job `policy`, step `Execution census` = success. Both deltas vs original confirmed. Minor non-blocking: section 3 "verbatim" quote drops trailing ` — see lib header.`. |
<!-- Later reviewers append attempt 2+ below without rewriting attempt 1. -->
