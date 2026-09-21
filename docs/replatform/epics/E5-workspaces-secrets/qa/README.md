# E5 QA Results

Each E5 exit-gate audit is an immutable record named
`<YYYY-MM-DD>-d0-e5-exit-gate-audit-<sha12>-a<attempt>.md`, written from
[`../../../templates/qa-result-template.md`](../../../templates/qa-result-template.md). A record is
write-once from its first commit. A correction, a rerun, a changed decision or a changed candidate
creates a **higher attempt** that links the prior record through `Supersedes`, never an edit.
`scripts/check-evidence-immutability.mjs` enforces this for every `qa/*.md` except this README
(`EVIDENCE_RECORD_RE`).

This README is not evidence and not the audit plan. It indexes the records. The frozen audit plan
that every attempt from `a2` onward follows is its own file,
[`../audit-matrix/2026-09-21-e5-seven-clause-matrix.md`](../audit-matrix/2026-09-21-e5-seven-clause-matrix.md)
(ticket `E5-A2-MATRIX`). Its freeze pin covers that file only, so updating the tables below never
changes it.

## Records

| Attempt | Record | Candidate | Result | Supersedes |
|---|---|---|---|---|
| `a1` | [`2026-08-24-d0-e5-exit-gate-audit-a1.md`](./2026-08-24-d0-e5-exit-gate-audit-a1.md) | `dd8d3c88e` | `awaiting_review` | — |

## Planned attempts

| Attempt | Attests | Written when | Supersedes | Path |
|---|---|---|---|---|
| `a2` | the exact frozen **`M1a`** candidate (M1 exit criterion 7) | after that candidate's `M1a` campaign records are committed, and **before** the `M1a` handoff | `a1` | `qa/<date>-d0-e5-exit-gate-audit-<sha12 of the M1a candidate>-a2.md` |
| `a3` or later | the exact frozen **`M1b`** candidate (a different revision) | after that candidate's `M1b` campaign records are committed, and **before** the `M1b` handoff | the highest prior attempt | `qa/<date>-d0-e5-exit-gate-audit-<sha12 of the M1b candidate>-a<n>.md` |

An audit attests **one exact revision**. `M1b` never reuses `a2`. If an attempt has to be corrected,
or its candidate changes, the correction is the next attempt number. The audit is planned to
**consume** the candidate's campaign records. It is not required to pass before those campaigns
start (scope-triage §Entry criteria).
