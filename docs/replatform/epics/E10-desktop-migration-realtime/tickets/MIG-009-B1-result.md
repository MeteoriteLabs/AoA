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
[`MIG-009-result.md`](./MIG-009-result.md) is not edited: where a measurement disagrees with it, the
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

The drain's unit and bridge-lane suites were not executed in this worktree. Recorded as `not re-run`.

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
