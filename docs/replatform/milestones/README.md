# Milestone records

Durable QA and completion-handoff records for **milestones** — deliveries proven on one exact
candidate revision that span more than one epic.

Created 2026-09-20 by founder decision **D-11**.

## Why this exists

[`../artifact-policy.md`](../artifact-policy.md) defines handoff and QA paths only under
`epics/<epic>/`. A milestone record belongs to **no single epic** by construction: `M1a` spans E3,
E4, E5, E6 and E7 at once. Before this folder the options were to misfile it under whichever epic
felt dominant, or to leave it pathless — and the shared-campaign case in
[`../epic-regrooming/qa-handoff-recovery.md`](../epic-regrooming/qa-handoff-recovery.md) §6, which
authorises one immutable campaign record to support several epics, had the same hole.

## Layout

```
milestones/<milestone>/qa/<YYYY-MM-DD>-<gate>-<scope>-<sha12>-a<attempt>.md
milestones/<milestone>/handoffs/<YYYY-MM-DD>-<milestone>-<sha12>-a<attempt>.md
```

`<milestone>` is the identifier from
[`../epic-regrooming/scope-triage.md`](../epic-regrooming/scope-triage.md) → *The milestone
sequence*: `M0`, `M1a`, `M1b`, `M2`, `M3`, `M4`, `M5`.

## The contract is the same one, not a softer one

Everything in `artifact-policy.md` that governs `epics/<epic>/{qa,handoffs}/` governs these:

- **Immutable from first commit.** A superseded record is never edited; a new attempt names the old
  path in `**Supersedes:**`.
- **Required fields** — `**Supersedes:**`, `**Decision:**` (`pass` / `fail` / `blocked_external`),
  `**Attempt:**`, `**Revision:**`.
- **A 12-character revision** in every filename. Six existing epic records violate this and are
  carried as recorded debt rather than renamed, because renaming an immutable record is itself a
  breach — see the amendment banner in `qa-handoff-recovery.md`. **New records here have no such
  excuse.**

## What a milestone record may and may not say

★★★ **A milestone handoff is non-promoting and must say so.** It records that a milestone passed on
an exact candidate. It does **not** change any epic's status: epic completion requires that epic's
own normative gate, and only the Integration Gate Owner flips it. A handoff here must not use
`epic-completion` in its name.

★ **A partial gate is not its normative gate.** `M1-D1-SPINE` is not D1 — D1-00 requires at least
two workers and H-06 stays normative. `M1-D2-CODING` is not D2. A record here may support a
milestone decision and nothing further.
