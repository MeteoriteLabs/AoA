# MIG-009-B1 Result - the drain is still correct, and its trigger is still absent

**Status:** `gate_review`
**Date (UTC):** `2026-09-21`
**Epic:** `E10-desktop-migration-realtime`
**Plan task:** `E10 implementation-plan section 8.1a MIG-009-B1 - the M0 half: current drain evidence (M0)`
**Implementer:** `M0 unit 6 (Claude Opus 5) - re-measure only; none of the underlying work is this record's`
**Start SHA:** `8b629fc25ad6471e04f6fe11cecbacde8fb4cedf`

The implementer leaves `Status` at `gate_review`. A separate reviewer completes the review section
and is the only role that may change it to `complete`.

★★★ This is an EVIDENCE-CURRENCY record, not a rebuild and not a re-approval of the original
ticket. `qa-handoff-recovery.md` section 2 forbids treating a prose `SHIPPED` header as canonical
ticket approval, so `M0` exit requires a result measured on **this** candidate. The original
[`MIG-009-drain-result.md`](./MIG-009-drain-result.md) is not edited (★ *Corrected 2026-09-21 in response to review attempt 1:* this link read `./MIG-009-result.md`, a file that does not exist): where a measurement disagrees with it, the
disagreement is recorded here as a **delta**, never repaired in place.

---
## 0. The summary line, where the dormancy belongs

★★★ The rollback drain is correct and NOTHING CAN CALL IT. Both halves are in the first line of this
record because exit criterion 6's rollback rehearsal *uses* this drain: a record that said "the
drain is verified" and left the dormancy to its body would let a gate owner read criterion 6 as
satisfiable today. It is not.

## 1. What was measured

| Clause | OBSERVED at `8b629fc25ad6471e04f6fe11cecbacde8fb4cedf` |
|---|---|
| `E10-1-drain` is still dormant | `node scripts/check-gate-clause-wiring.mjs` prints `DORMANT, on the record: E10-1-drain, ...` |
| the guard passes with it dormant | exit 0 - `22 wired clause(s), 12 declared dormant` |

The register and the code still agree. Declaring the clause dormant is what keeps the guard honest
rather than green-by-omission.

## 2. Deltas against the original result

**None.** `MIG-009-drain-result.md` records `E10-1-drain` as *"honestly `unwired`"*, and it still is.

## 3. The split, so no reader merges the two halves

- **`M0`** - this record: evidence currency.
- **`M1a`** - E10 plan section 8.1: design and wire the real `drainAll` invocation, *"so criterion
  6's rehearsal has a mechanism rather than a runbook"* (**D-9**).

★★★ The frozen `MIG-009-drain-result.md` may NOT be reused for `M1a` criterion 1, because it records
the trigger as deliberately `unwired` - the precise thing `M1a` must change. `M1a` owes a **new**
result. This record does not discharge it and must not be cited as if it did.

## 4. Not re-run here

The drain's unit and bridge-lane suites were not executed in this worktree. ★ *Corrected 2026-09-21 in response to review attempt 1:* they **were**
executed at the reviewed revision `5f3b47556` in PR run `35561909654`, across **two** jobs, both
`success`: job **`verify (3)`** (id `106216273934`) ran `job-distributed-drain.test.ts` 8 and
`controller-inline-drain.test.ts` 6; job **`verify (2)`** (id `106216273935`) ran
`job-distributed-drain.integration.test.ts` 5 (embedded PostgreSQL, Linux). ★ *Corrected 2026-09-21 in response to review attempt 2:* the
attempt-1 correction attributed all three suites to `verify (3)`, which the per-job logs contradict. ★ Cite the **job**, not the
run: the run concludes `failure` solely because `ci-required` refuses a PR carrying the
`do-not-merge` label; all fifteen other jobs succeeded. This is what backs §0's "the drain is
correct"; the record previously asserted correctness with no evidence attached.

## Independent review

**Reviewer:** M0 attempt-2 independent reviewer subagent (Claude) — distinct from the M0 implementation session, from the attempt-1 reviewer, and from the correcting session
**Reviewed revision:** 6f9031220bd2a20a6485b83a5b2b74cf6b5782d0
**Disposition:** `changes_requested`
**Attempt:** 2 (see Review attempt history)
**Review evidence (attempt 2):**
- Attempt-1 finding (preamble linked non-existent `./MIG-009-result.md`) — FIXED: the link now reads `./MIG-009-drain-result.md`, and `tickets/` at the reviewed revision contains `MIG-009-drain-result.md` (no `MIG-009-result.md`).
- §1 still holds at the reviewed revision: `node scripts/check-gate-clause-wiring.mjs` → exit 0, `OK (22 wired clause(s), 12 declared dormant, …)`, `E10-1-drain` first in `DORMANT, on the record`. The commits between `5f3b47556` and the reviewed revision touch only `docs/` records, `findings.md` and `scripts/finding-ownership.json` — no drain source.
- PR run `35561909654` (`gh run view --json jobs`): head `5f3b47556d0d…`, event `pull_request`, run conclusion `failure`; 16 jobs, 15 `success`, only `ci-required` `failure`. The `ci-required` log's only emitted error is ``the `do-not-merge` label is present`` — so "concludes `failure` solely because `ci-required` refuses a PR carrying the `do-not-merge` label; all fifteen other jobs succeeded" is TRUE.
- ★ **NEW DEFECT (introduced by the correction — blocks, because a `complete` record is frozen):** §4 says the three suites ran in job **`verify (3)`** and insists "Cite the **job**, not the run". Per-job logs (`gh run view --job <id> --log`): `verify (3)` (job `106216273934`) ran `job-distributed-drain.test.ts (8 tests)` ✓ and `controller-inline-drain.test.ts (6 tests)` ✓, but **`job-distributed-drain.integration.test.ts` does not appear in `verify (3)`'s log at all** — it ran in **`verify (2)`** (job `106216273935`, `ubuntu-24.04`, embedded PostgreSQL linux-x64): `✓ src/__tests__/job-distributed-drain.integration.test.ts (5 tests)`. Attempt 1's evidence already said `verify (2)` for this suite; the correction mis-transcribed it. Fix: attribute the integration suite to `verify (2)` (e.g. "jobs `verify (3)` … and `verify (2)` …").
- Counts otherwise correct: 8 / 5 / 6 match the CI output; the integration suite really is embedded-PostgreSQL on Linux.

**Review evidence (attempt 1):**
- `node scripts/check-gate-clause-wiring.mjs` at the reviewed revision → exit `0`, `gate-clause-wiring: OK (22 wired clause(s), 12 declared dormant, ...)`, and `E10-1-drain` is first in the `DORMANT, on the record` list. §1's two OBSERVED values **hold** at the reviewed revision (the record measured them at `8b629fc25`, an ancestor; `git diff 8b629fc25 HEAD` is empty for `job-distributed-drain.ts`, `job-distributed-drain-store.ts`, `scripts/gate-clause-wiring.json`, `scripts/check-gate-clause-wiring.mjs`, `server/src/index.ts`).
- Dormancy confirmed at source, not only via the guard: `scripts/gate-clause-wiring.json` → `E10-1-drain` is `status: "unwired"`, `symbol: "createDistributedExecutionDrain"`; `node scripts/check-gate-clause-wiring.mjs --counts` → `0  createDistributedExecutionDrain`; the only non-test mentions outside its definition (`job-distributed-drain.ts` `createDistributedExecutionDrain`) are comments (`cutover-selection-audit.ts`, `heartbeat.ts`, `job-distributed-drain-store.ts`). `drainAll` (defined in `job-distributed-drain.ts`) has no production invoker. §0's "nothing can call it" is **true**.
- §2 "no delta": `MIG-009-drain-result.md` records `E10-1-drain` as honestly `unwired` (its lines 10, 98, 119, 226) — **true**.
- §3 split: matches `scope-triage.md` § `M0` (evidence currency is M0's; trigger build is `M1a`'s) and E10 `implementation-plan.md` §8.1a — **true**. The "M0 exit criterion 6" numbering matches `docs/replatform/qa/2026-09-20-m0-record-lane-health-plan.md` row 6 (disposition-B results) — **true**.
- §4 `not re-run`: honestly unrun locally, but **actually satisfied** at the reviewed revision by CI run `35561909654` (PR workflow, `headSha` = `5f3b47556d0d…`): `verify (3)` → `job-distributed-drain.test.ts (8 tests)` ✓ and `controller-inline-drain.test.ts (6 tests)` ✓; `verify (2)` → `job-distributed-drain.integration.test.ts (5 tests)` ✓ (embedded-PG, Linux). All jobs `success`; `ci-required` is `failure` **only** on `the do-not-merge label is present`. The drain source is unchanged since `c7ead3a73` (#333).
- ★ **DEFECT (blocks approval, because an approved record is frozen and could not be repaired afterwards):** the preamble cites the original as [`MIG-009-result.md`](./MIG-009-result.md). **That file does not exist** at the reviewed revision (`tickets/` has `MIG-009-drain-design.md`, `MIG-009-drain-result.md`, `MIG-009-B1-result.md` only). The record's own §2/§3 name the right file (`MIG-009-drain-result.md`). The one sentence that says which record this currency check is *against* names a record that is not there. Fix: point the link at `./MIG-009-drain-result.md`.
- Recommended, not blocking: §0 says "the drain is correct" and the plan (§8.1a *Outcome*) requires the record to state correctness is current, yet §4 records the suites as `not re-run` — so as written the correctness half is asserted, not evidenced. Citing CI run `35561909654` (above) would make it evidenced at this exact revision.

For `approved`, verify each OBSERVED value above against the named source at the reviewed revision,
and confirm that every row marked `not re-run` is accepted as such rather than read as passing. Then
change the top-level `Status` to `complete` and commit that disposition separately.

★ `M0` exit criterion 6 requires this result **approved**, not merely committed. It is left at
`gate_review` because its author may not approve it.

## Review attempt history

The implementation author leaves the table body empty; the pending summary above is not a review attempt. The first independent reviewer appends attempt 1, and later reviewers append monotonically increasing rows without replacing prior attempts. The summary fields above mirror the latest real attempt. Do not include a `Review commit` column: a row cannot embed the SHA of the commit that first contains it.

| Attempt | Reviewer | Reviewed revision | Disposition | Evidence/findings |
|---:|---|---|---|---|
| 1 | M0 independent reviewer subagent (Claude) | `5f3b47556d0df152db0d53d76c304861f30ffd37` | `changes_requested` | `check-gate-clause-wiring.mjs` exit 0 (22 wired / 12 dormant, `E10-1-drain` dormant); `--counts` → `createDistributedExecutionDrain` 0 production callers; §2/§3 true at source; §4 unrun rows satisfied by CI run `35561909654` at this SHA (drain unit 8/8, integration 5/5, controller-inline 6/6). DEFECT: preamble link `./MIG-009-result.md` names a file that does not exist — must be `./MIG-009-drain-result.md` before the record is frozen. |
| 2 | M0 attempt-2 independent reviewer subagent (Claude) | `6f9031220bd2a20a6485b83a5b2b74cf6b5782d0` | `changes_requested` | Attempt-1 link defect FIXED (`./MIG-009-drain-result.md` exists; no `MIG-009-result.md`). §1 re-run at reviewed revision: exit 0, 22 wired / 12 dormant, `E10-1-drain` dormant. Run `35561909654`: 16 jobs, only `ci-required` failed, sole error = do-not-merge label (claim true). NEW DEFECT from the correction: §4 says all three suites ran in `verify (3)`; `job-distributed-drain.integration.test.ts (5 tests)` ran in `verify (2)` (job `106216273935`) and is absent from `verify (3)`'s log. The record insists on citing the job, so the wrong job must be fixed before freeze. |
<!-- Later reviewers append attempt 2+ below without rewriting attempt 1. -->
