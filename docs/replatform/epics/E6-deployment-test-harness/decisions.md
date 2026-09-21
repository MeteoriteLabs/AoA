# E6 Deployment & test harness — decisions

Epic-local decisions. Product-wide decisions are promoted to
`docs/architecture/decisions.md` and linked here.

**Created 2026-09-21 by DEP-015.** Until then this epic had no decisions file. The M1 execution plan
(`docs/replatform/qa/2026-09-21-m1-execution-plan.md` §2, F2) has the planning session record each M1
decision it takes, with its reason, in the E-epic `decisions.md`.

---

## E6-D001 — F3 clarified: a REGISTRATION-ONLY push trigger does not break "dispatch-only"

**Date (UTC):** 2026-09-21
**Status:** `locked`. Decided by the planning session under founder delegation **F2**
(`docs/replatform/qa/2026-09-21-m1-execution-plan.md` §2: the founder delegates every M1 decision to
the planning session, which records each with its reason). QA independence still holds: a distinct
reviewer approves the ticket, not the session that decided it.
**Owner role:** planning session (decision owner, under F2)
**Clarifies:** founder ruling **F3** (the definition of "shipped CI boot"). It does not supersede F3.
**Affected tickets:** `DEP-015` (the lane), `E7-1-JOURNEY-ARM` (consumes the lane's run)

### Context

F3 requires the shipped CI boot to be "a **dispatch-only** CI job, never on push". `DEP-015` built it
as `.github/workflows/m1-shipped-boot.yml` with `workflow_dispatch` as its only trigger.

GitHub will not dispatch a `workflow_dispatch` workflow unless one of two things is true:
- the file is on the **default branch**; or
- the workflow has already run at least once.

After the push, the DEP-015 build measured `GET /repos/MeteoriteLabs/AoA/actions/workflows/m1-shipped-boot.yml` → **404**. Codex raised the same point on PR #554.

Two fixes were considered:
- **Option (a):** place the file on `main`. This is **rejected**. The locked integration strategy forbids any change to `main` before the M5 checkpoint.
- **Option (b):** add a push trigger that only *registers* the workflow. The existing `keyed-e2b-*` lanes already do this; each registered through a push trigger on this branch.

### Decision

F3's intent is that **the journey never runs, and nothing is spent, on push**. A push trigger that
only REGISTERS the workflow, with every job skipped, satisfies that intent. The shape is fixed exactly:

1. `on:` keeps `workflow_dispatch` and adds
   `push: { branches: [docs/replatform-program], paths: [".github/workflows/m1-shipped-boot.yml"] }`.
   The paths entry is the workflow file's own path and nothing else, so no code change can ever fire it.
2. **Every** job carries `if: github.event_name == 'workflow_dispatch'` at job level. A push-created run
   therefore executes **zero steps** and touches **zero secrets**.

`scripts/check-m1-shipped-boot-shape.mjs` (pr.yml `policy`) enforces exactly this shape. The check reds on each of the following, with a test for every case:
- a push trigger without the paths restriction;
- a paths list naming anything other than the workflow file;
- a branch other than `docs/replatform-program`;
- a `paths-ignore` or any other push filter;
- any job missing the gate, or carrying a weaker `if`;
- any other trigger (`pull_request`, `schedule`, `merge_group`, `workflow_call`, `workflow_run`).

### Consequence

The lane **registers when PR #554 merges**. The merge pushes the file onto `docs/replatform-program`,
which matches the push path, so GitHub records one run in which the job is `skipped`. From then on,
`gh workflow run m1-shipped-boot.yml --ref docs/replatform-program -f candidate=… -f mode=…` works.

The registration run is cited in `tickets/DEP-015-result.md` §8 once it exists.

The workflow-verdict consumer declares the stream `not-watched`: a verdict on a skipped job would be a
check that nothing runs.
