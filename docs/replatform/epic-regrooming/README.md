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

- This proposal has been reconciled through `origin/docs/replatform-program` revision `3bdca18da3ca3051f740957311291fd1f8a950f3` (2026-09-20). That update advances E3 audit/census evidence, ships E7 CLI-008 Unit C behind a default-off flag, adds `SVC-009`, and supplies E9's first keyless leased/supervised service mechanism proof. None of those changes supplies a named M1 partial-gate record or a normative epic-completion QA/handoff.
- The formal program index still records E0–E2 as `complete`, E3/E4/E6 as `in_progress`, and E5/E7–E11 as `backlog`.
- Several epic-local READMEs differ: E3, E4, and E6 say `complete`; E5 says its tickets are complete while its exit gate is not met.
- E7 has a September 18 real-E2B mechanism run with `ok=true` and `capabilityProven=false`. CLI-008 Unit C has since landed as live-but-inert plumbing: its dedicated flag defaults off, is enabled in no CI workflow, and still has no keyed live proof. Neither item is useful-agent capability evidence or an E7 completion gate.
- The proposed one-control-plane/one-worker milestone cannot pass the current full D1 gate: [`../test-gates.md`](../test-gates.md) D1-00 requires at least two workers, and H-06 remains normative for D1–D6. This proposal therefore defines only the named `M1-D1-SPINE` and `M1-D2-CODING` partial gates; they cannot complete E6/E7 or substitute for full D1/D2.
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
4. Should the named milestone partial gates unlock the internal alpha dependency set while leaving the current full D1/D2/H-06 requirements untouched?
5. Should each epic’s proposed candidate gate and reopen triggers become the basis for a separately approved implementation-plan amendment?
6. Are any deferred surfaces accidentally implied to be deleted rather than retained for later phases?

## Approval effect

Approval of this proposal would authorize grooming work, not completion. Status changes remain the Integration Gate Owner’s action after the artifact-policy prerequisites are satisfied. Until that happens, existing authoritative records retain their present status and history.
