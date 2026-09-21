# CLI-011 — Unit F link 1, the output-mechanism design review

**Status:** `scoping` · **Epic:** E7 · **Was:** `CLI-008-F1b` (see `program-design.md`, the
link-scoped successor mapping) · **Filed:** 2026-09-21 (M0 unit 4, founder decisions D1 + D5)
**Depends on:** `CLI-008` · **Milestone:** `M1b`
**Owns:** [`E7-F026`](../findings.md#e7-f026)

---

## Why this ticket exists under this id

`scope-triage.md`'s `M1b` required-result set called this `CLI-008-F1b`. That id cannot be expressed
to the guards: `check-finding-ownership.mjs:423` tests ownership with an exact
`tickets.has(entry.ticket)` and `findTicketIds` (`:50`) derives ids from filenames with
`/^([A-Z]+-\d+)/`, so `CLI-008-F1b` resolves to nothing — and a `CLI-008-F1b-result.md` would
resolve to **`CLI-008`**, marking the parent shipped and orphaning every finding it owns. The id is
numeric for that reason and that reason only; the scope is unchanged.

## Scope

The founder ruling on **how output leaves the sandbox**, recorded as a decision with its refutations
intact. `CLI-008-unit-f-design.md` §4 carries three rounds of refutation — §4.2 on argv SIZE and
§4.3 at the predicate itself, which is a **scope** conclusion rather than a sizing one — and this
ticket answers them rather than re-arguing them.

**Design-only as to BUILD.** No build may be assigned from this ticket. Its `-result.md` is
nonetheless **required before `M1b` passes**: `CLI-015` (the judge) cannot proceed without the
ruling, and exit criterion 4 depends on it. *"Design-only limits what this may PRODUCE; it does not
make its design review optional"* (`scope-triage.md`).

## The finding it owns

**E7-F026** — *the "agent declares its own output" option's "no test edits" claim is false against
three existing pins, because its mechanism touches the staged PROMPT while its argument is about the
WORKLOAD.* That finding is a claim about one of the options under review here, which is why it moves
with the decision rather than staying on the parent.

★ It was re-pointed from `CLI-008` in M0 unit 4. Nothing was orphaned by the move: `CLI-008` has no
`-result.md`, so it was never in `completedTicketIds` and the finding validated throughout.

## Acceptance

A committed result naming the chosen mechanism, each option refuted and why, and the pin census the
choice moves — `CLI-008-unit-f-design.md` §3.2 enumerates 16 pins BY SEARCH and records that 2 move.
A ruling that does not say which pins move is not actionable by `CLI-010` or `CLI-015`.

## Non-goals

Building the emit half (that is `CLI-010`); changing `captureSandboxEntries`, which is a local-lane
tool that must NOT be composed on the E2B lane; touching the counter (`CLI-015`).

## Test

Not a build ticket. The evidence is the decision record and the pin census it cites, both committed.
