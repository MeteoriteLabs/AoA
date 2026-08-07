# E0 — Program Foundation

**Status:** `planning`
**Depends on:** approved [`program-design.md`](../../program-design.md)
**Tickets:** FND-001 through FND-005
**Implementation plan:** [`implementation-plan.md`](implementation-plan.md)

## Outcome

Lock workload lifecycles, state authority, security controls, golden journeys, rollout policy, merge gates, and custodian roles before protocol implementation.

## Exit gate

- Structured lifecycle/authority/threat/fixture foundation checker passes; Markdown and JSON authorities agree.
- Hosted unsafe override regression passes.
- All nine deterministic golden fixtures and their strict schema are committed.
- Every trust crossing has complete control fields and every Critical/High item owns a release test.
- Every applicable D0 REQUIRED condition plus HARD/INITIAL threshold in `test-gates.md` passes on one revision.
- Repository typecheck, tests, and build pass. A failure outside the changed paths still blocks completion; a focused pass or baseline-failure note is evidence, not a waiver or pass.
- Completion handoff links every ticket result and QA run.

## Records

- [`decisions.md`](decisions.md)
- [`findings.md`](findings.md)
- [`tickets/`](tickets/)
- [`qa/`](qa/)
- [`handoffs/`](handoffs/)
