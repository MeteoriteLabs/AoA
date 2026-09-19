# Epic Regrooming Proposal

> **Proposal only — non-authoritative pending review.** Nothing in this directory changes an epic status, approves scope, passes a gate, or supersedes an existing result, QA record, or handoff. The authority hierarchy in [`../README.md`](../README.md) continues to govern.

## Why this exists

The program has accumulated substantial implementation and useful evidence, but its formal epic records no longer give a consistent answer to “what can enter gate review?” This workspace proposes a return to milestone-scoped epic QA and exact-candidate completion handoffs without rewriting the record that got us here.

The proposal distinguishes four claims that must not collapse into one another:

1. a ticket shipped;
2. a mechanism was exercised;
3. a useful product capability was proven;
4. an epic completed its exit gate on an exact candidate.

## Current status, unchanged by this proposal

- The formal program index still records E0–E2 as `complete`, E3/E4/E6 as `in_progress`, and E5/E7–E11 as `backlog`.
- Several epic-local READMEs differ: E3, E4, and E6 say `complete`; E5 says its tickets are complete while its exit gate is not met.
- E7 has a September 18 real-E2B mechanism run with `ok=true` and `capabilityProven=false`. It is not useful-agent capability evidence and is not an E7 completion gate.
- This local proposal branch, and PR #323 as described by the current program records, have no fresh `ci-required` result attached by this proposal. No CI conclusion is inferred from historical prose.

## Proposed decision package

- [`scope-triage.md`](scope-triage.md) — the 50-ticket disposition, first-milestone boundary, entry criteria, and exit criteria.
- [`qa-handoff-recovery.md`](qa-handoff-recovery.md) — how to adopt useful historical evidence and restore policy-compliant exact-revision QA and handoffs.
- Per-epic recovery sheets:
  - [E0](epics/E0.md)
  - [E1](epics/E1.md)
  - [E2](epics/E2.md)
  - [E3](epics/E3.md)
  - [E4](epics/E4.md)
  - [E5](epics/E5.md)
  - [E6](epics/E6.md)
  - [E7](epics/E7.md)
  - [E8](epics/E8.md)
  - [E9](epics/E9.md)
  - [E10](epics/E10.md)
  - [E11](epics/E11.md)

## Review questions

1. Is the proposed first milestone narrow enough to be reviewable while still proving a useful distributed coding journey?
2. Are the 50 ticket dispositions correct, especially the boundary between promise-truth correction, pre-milestone assurance, later original scope, and optional expansion?
3. Does the recovery procedure preserve every historical record while making gate ownership and exact-candidate evidence unambiguous?
4. Should each epic’s proposed candidate gate and reopen triggers become the basis for a separately approved implementation-plan amendment?
5. Are any deferred surfaces accidentally implied to be deleted rather than retained for later phases?

## Approval effect

Approval of this proposal would authorize grooming work, not completion. Status changes remain the Integration Gate Owner’s action after the artifact-policy prerequisites are satisfied. Until that happens, existing authoritative records retain their present status and history.
