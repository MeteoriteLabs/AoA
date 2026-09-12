# Universe — independent review handoff

**Purpose:** TK takes this completed planning packet to Claude, then returns its findings. The author self-review is recorded; no independent verdict or implementation approval exists yet.

Planned publication branch: `codex/universe-interface`. Source baseline: `183e46a9c65fc3105c7e3d125629276814df7dbb` from replatform. [Publication record](planning-publication.md) records the verified branch/base and documentation-only checks. Review the published branch head and record its exact commit in the review report; do not substitute main or a premature Universe worktree.

## Short review prompt

> Review the Universe implementation-planning packet on `codex/universe-interface` against its pinned replatform base. Start with `docs/architecture/commander-canvas/coding-plans/README.md`, `implementation-bindings.md`, `planning-self-review.md`, the master scope and accepted UI/settings/motion records. Review all nine epics, 31 slices and 69 increments for source accuracy, complete coding steps, producer/consumer contracts, dependencies, authorization, idempotency, failure recovery, migrations, testing, performance and release ordering. Preserve the accepted 30-slice V1 and E3.4-only V2; do not quietly reduce scope. Distinguish conditional qualification plans from genuinely bound runtime implementation. Report severity-ranked findings with file/section and source evidence, concrete corrections, missing decisions and a readiness verdict. Review only: do not implement, install, run providers, change branches or commit changes. Treat the premature implementation draft as excluded. Record the reviewed commit and base.

## Returning findings

Provide the report and reviewed commit. We will check each finding against source and accepted decisions, mark accepted/rejected-with-evidence/unresolved, update valid corrections and re-review material changes. Reviewer approval alone does not authorize coding. TK's explicit implementation approval and affected producer qualifications remain required. Keep the separate decision about deleting, preserving or reusing the premature draft visible before any implementation begins.
