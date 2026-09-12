# Universe — independent review handoff

**Purpose:** TK takes this completed planning packet to Claude, then returns its findings. The initial independent review of f63b844 has been received and reconciled in planning documents. No implementation approval exists; the correction round needs user-managed re-review.

Planned publication branch: `codex/universe-interface`. Source baseline: `183e46a9c65fc3105c7e3d125629276814df7dbb` from replatform. [Publication record](planning-publication.md) records the verified branch/base and documentation-only checks. Review the published branch head and record its exact commit in the review report; do not substitute main or a premature Universe worktree.

## Short review prompt

> Review the Universe implementation-planning packet on `codex/universe-interface` against its pinned replatform base. Start with `docs/architecture/commander-canvas/coding-plans/README.md`, `implementation-bindings.md`, `planning-self-review.md`, the master scope and accepted UI/settings/motion records. Review all nine epics, 31 slices and 69 increments for source accuracy, complete coding steps, producer/consumer contracts, dependencies, authorization, idempotency, failure recovery, migrations, testing, performance and release ordering. Preserve the accepted 30-slice V1 and E3.4-only V2; do not quietly reduce scope. Distinguish conditional qualification plans from genuinely bound runtime implementation. Report severity-ranked findings with file/section and source evidence, concrete corrections, missing decisions and a readiness verdict. Review only: do not implement, install, run providers, change branches or commit changes. Treat the premature implementation draft as excluded. Record the reviewed commit and base.

## Short prompt for this correction round

> Re-review the current head of codex/universe-interface against the original reviewed commit f63b84461341fc93f65417103fc8e57357a93939 and source base 183e46a9c65fc3105c7e3d125629276814df7dbb. Start with docs/architecture/commander-canvas/independent-review-response.md, the preserved review report and user-acceptance-plan.md; inspect the changed owning slice/coding plans and shared bindings. Verify H1/H2, M1–M13 and L1–L7 across producer and consumers, acyclic increment dependencies, all 31 slices/69 increments and unchanged V1 scope. Challenge the author's qualifications, especially #104, cross-role publication and routine timer cadence, against actual source. Confirm U01–U10 and all slices have real future UAT records without invented sign-offs. Return remaining findings and readiness verdict with exact commit/source evidence. Review only: no implementation, installations, providers, branch edits or commits.

## Returning findings

Provide the report and reviewed commit. We will check each finding against source and accepted decisions, mark accepted/rejected-with-evidence/unresolved, update valid corrections and re-review material changes. Reviewer approval alone does not authorize coding. TK's explicit implementation approval and affected producer qualifications remain required. Keep the separate decision about deleting, preserving or reusing the premature draft visible before any implementation begins.
