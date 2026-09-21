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
milestones/<milestone>/handoffs/<YYYY-MM-DD>-<milestone-or-gate-slug>-<sha12>-a<attempt>.md
```

`<milestone>` is the identifier from
[`../epic-regrooming/scope-triage.md`](../epic-regrooming/scope-triage.md) → *The milestone
sequence*: `M0`, `M1a`, `M1b`, `M2`, **`M2-RTF`**, `M3`, `M4`, `M5`.

★★★ **THE MIDDLE SEGMENT IS THE MILESTONE ID *OR* THE GATE SLUG, AND `M2-RTF` IS EXACTLY WHY.**
*Corrected 2026-09-20 (fifth round): the form demanded `<milestone>`, which would force
`…-M2-RTF-…`, while **RTF-07 requires the handoff to be named `e10-realtime-foundation`** — so an
operator following this layout could not create the very record the realtime gate consumes. Existing
handoffs already use their gate slug in this position; the form now says so instead of contradicting
them.* For a milestone handoff with no distinct gate slug, the segment is the milestone id.

★ `M2-RTF` carries the `E10-REALTIME-FOUNDATION` campaign record and its `e10-realtime-foundation`
handoff (RTF-07 requires that handoff **by name**, which is the gate slug, not `M2-RTF`). It was added to the milestone sequence and
initially omitted from this list, which would have left an operator with no valid directory for a
required campaign — so `milestones/M2-RTF/` is inside the contract, not outside it.

## The contract is the same one, not a softer one

Everything in `artifact-policy.md` that governs `epics/<epic>/{qa,handoffs}/` governs these:

- **Immutable from first commit.** A superseded record is never edited; a new attempt names the old
  path in `**Supersedes:**`.
- **Required fields** — `**Supersedes:**`, `**Attempt:**`, **the revision field — ★ spelled
  `**Revision:**` on a QA record and `**Reviewed revision:**` on a handoff, which are NOT
  interchangeable either** (*corrected 2026-09-20, fifth round: this bullet split `Result` from
  `Decision` but still demanded `Revision` of **every** record, so a milestone handoff could not
  satisfy both this contract and its own template*) — and then **one of two
  verdict fields, which are NOT interchangeable**: a **QA record** carries `**Result:**`
  (`../templates/qa-result-template.md`), a **handoff** carries `**Decision:**`
  (`../templates/handoff-template.md`). Both take `pass` / `fail` / `blocked_external`. The
  milestone exit criteria consume `Result: pass` from the QA record and `Decision: pass` from the
  handoff, so a QA record written with `Decision:` cannot satisfy its gate.
- **A 12-character revision** in every filename. **Eleven** existing epic records violate this and are
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

## Working documents beside the records

*Added 2026-09-21 (M1 Step 0, S0-7).* A milestone folder may also hold **mutable working
documents** outside `qa/` and `handoffs/`, such as a delta review or a reachability ledger. They are
not evidence records. They carry no `Result` or `Decision`, grant nothing, and may be corrected in
place. A record that relies on one pins the document's blob SHA at the candidate. The immutability guard (`EVIDENCE_RECORD_RE` in
`scripts/check-evidence-immutability.mjs`) matches only files under `qa/` and `handoffs/`. See
[`M1a/README.md`](./M1a/README.md).
