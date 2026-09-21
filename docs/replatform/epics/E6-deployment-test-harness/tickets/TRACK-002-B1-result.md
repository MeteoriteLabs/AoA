# TRACK-002-B1 Result - the execution census still runs, and its recorded counts are stale

**Status:** `gate_review`
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

**Reviewer:** `pending`
**Reviewed revision:** `pending`
**Disposition:** `pending`
**Attempt:** none recorded

For `approved`, verify each OBSERVED value above against the named source at the reviewed revision,
and confirm that every row marked `not re-run` is accepted as such rather than read as passing. Then
change the top-level `Status` to `complete` and commit that disposition separately.

★ `M0` exit criterion 6 requires this result **approved**, not merely committed. It is left at
`gate_review` because its author may not approve it.
