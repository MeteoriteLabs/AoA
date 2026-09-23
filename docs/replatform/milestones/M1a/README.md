# M1a — working documents (not records)

This folder holds **mutable working documents** for milestone `M1a`. It also holds `M1a`'s
immutable records, once they exist, in `qa/` and `handoffs/`. Those two subfolders follow
[`../README.md`](../README.md) and `EVID-04` (`../../test-gates.md`). **Nothing outside `qa/` and
`handoffs/` is an evidence record.** A file outside them grants nothing and can be corrected in place.

| Path | What | Entry bullet it serves (`../../epic-regrooming/scope-triage.md` → *Entry criteria*) |
|---|---|---|
| [`2026-09-21-e0-e2-delta-review-b71f0dd539fe.md`](./2026-09-21-e0-e2-delta-review-b71f0dd539fe.md) | E0–E2 current dependency/delta review, measured at the program tip `b71f0dd539fe` | *"E0–E2 historical completion evidence has passed a current dependency/delta review, including superseding records for any immutable-record breach"* |
| [`reachability/`](./reachability/) | One candidate-specific reachability ledger per epic, E3–E6. ★ **FILLED 2026-09-24 at the `M1a` candidate `7be35ae6b7719877e61f54ab552de84de8491e7d`** by the QA owner (a distinct review session, F2). *(Superseded text, kept as first written: "**Skeletons**: filled at candidate freeze.")* | *"E3–E6 have candidate-specific ledgers showing which mechanisms are production-reachable rather than merely present and which clauses are certified only by `M1-D1-SPINE`"* |

## Why these are not under `qa/` or `handoffs/`

- **Neither document is a gate run or a gate decision.** A QA record carries a `Result` and a
  handoff carries a `Decision`. A delta review and a ledger carry neither. `qa-handoff-recovery.md`
  and `../README.md` name no path for either document.
- **Both must be re-measured.** The delta review is measured against a moving tip, and the ledgers
  are skeletons that are filled when the candidate is frozen. An immutable record cannot be filled in
  later. Each edit would have to be a new attempt, and no template defines an attempt of this kind.
- **Neither belongs to one epic.** The delta review spans E0–E2, and the ledgers exist to feed the
  `M1a` entry check. So they live in the milestone folder, beside the records they feed.

★ **When the `M1a` candidate is frozen, the QA owner cites these documents at that candidate's
SHA.** The candidate-freeze record pins their blob SHAs, so the version that was relied on is fixed
by the record that relies on it, not by making the working document immutable.

★ **`M1b` freezes a different candidate** (`../../epic-regrooming/qa-handoff-recovery.md` steps 7–9).
Its ledgers are **new copies** under `milestones/M1b/`, measured on the `M1b` candidate. They are not
these files, updated.
