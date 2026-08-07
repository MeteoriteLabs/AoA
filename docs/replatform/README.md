# AoA Re-platform Program Workspace

This folder is the durable operating record for moving AoA from an in-process/local execution architecture to a cloud control plane with separately deployed workers.

The program is a selective re-platform, not a blank-slate product rewrite. The existing AoA domain model and user experience are preserved unless an epic explicitly changes them.

## Start here

1. [`program-design.md`](program-design.md) — approved architecture, 72-ticket backlog, dependency graph, deployment progression, and release gates.
2. [`artifact-policy.md`](artifact-policy.md) — where plans, results, decisions, findings, QA evidence, and handoffs belong.
3. [`epics/README.md`](epics/README.md) — live epic status and navigation.
4. [`templates/`](templates/) — mandatory formats for execution records.

## Source-of-truth hierarchy

1. Locked product-wide decisions: `docs/architecture/decisions.md`.
2. Approved re-platform architecture: `docs/replatform/program-design.md`.
3. Epic implementation contract: `docs/replatform/epics/<epic>/implementation-plan.md`.
4. Epic-local decisions and findings: the epic’s `decisions.md` and `findings.md`.
5. Execution evidence: ticket results, QA results, and handoffs inside the epic folder.

If two artifacts disagree, the higher item wins until an explicit decision updates it.

## Epic status values

- `backlog`: program design exists; implementation plan has not been approved.
- `planning`: implementation plan is being written or reviewed.
- `planned`: implementation plan is approved and dependencies are being checked.
- `in_progress`: one or more epic tickets are executing.
- `gate_review`: implementation tickets are complete and integration evidence is under review.
- `complete`: the epic exit gate passed and a completion handoff is recorded.
- `blocked`: a concrete external dependency prevents progress and is recorded in findings.

The Integration Gate Owner updates [`epics/README.md`](epics/README.md) and the epic README. Individual agents do not declare an epic complete from their own ticket results.

## Continuing after E0 and E1

The program can continue in the same agent conversation or in a fresh one. This folder is the durable handoff, so progress must not depend on retained chat context.

1. Execute E0 and commit its ticket results, QA records, decisions, findings, and completion handoff.
2. Revalidate the E1 implementation plan against the completed E0 evidence, amend it through the decision process if required, and then execute E1.
3. After both completion gates pass, write and approve the remaining implementation plans in this order:
   1. E2 Tenant kernel.
   2. E6 D1 deployment/test foundation.
   3. E3 Job control.
   4. E4 Worker daemon.
   5. E5 Workspaces/secrets.
   6. E7 Coding/E2B.
   7. E8 Browser automation.
   8. E9 Service agents.
   9. E10 Desktop/migration/realtime.
   10. E11 Hardening/release.
4. Execute a plan only when every dependency gate named in the program design is green on main.

Do not fully groom all remaining epics in advance. Findings from E0 and E1—especially protocol constraints, tenancy boundaries, deployment topology, and test-harness behavior—must inform E2 and later plans.

Use this prompt to resume in a fresh agent task:

> Read `docs/replatform/README.md`, `program-design.md`, the E0/E1 completion handoffs, decisions, findings, and QA results. Verify their gates, then produce the implementation plan for the next unblocked epic according to `artifact-policy.md`.

## Recording rule

Do not paste raw secrets, provider tokens, customer source, private browser state, or unredacted logs into this folder. Store durable evidence as redacted summaries and link to controlled CI/object-storage artifacts when bytes must be retained.
