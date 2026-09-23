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

---

## E6-D002 — criterion 5's PER-TENANT observation belongs to `M1a-D2-MECHANISM`, not to `M1-D1-SPINE`

**Date (UTC):** 2026-09-23
**Status:** `locked`. Decided by the planning session under founder delegation **F2**
(`docs/replatform/qa/2026-09-21-m1-execution-plan.md` §2: the founder delegates every M1 decision to
the planning session, which records each with its reason). QA independence still holds: a distinct
reviewer approves the ticket, not the session that decided it.
**Owner role:** planning session (decision owner, under F2)
**Allocates** a clause between two partial gates. It does **not** weaken, narrow or waive it, and it
changes neither gate's topology clause.
**Affected tickets:** `DEP-019` (raised it), `DEP-016` (acceptance item 6), `DEP-017` (the probe),
`DEP-015` (the lane that now carries the per-tenant half)

### Context

`DEP-017`'s env-absence probe is criterion 5's evidence. `DEP-016` acceptance item 6 carried it into
the `m1-spine` profile, and `DEP-019` built the half that made it observable there at all: the
reference provider now EXECUTES, so the probe runs inside a real reference sandbox and reports.

Codex then found (P1, PR #572, verified at source) that `DEP-019` closes criterion 5 for ONE enabled
tenant while the acceptance said *per enabled tenant*. The `DEP-019` build flagged it rather than
widening the claim, which is what produced this decision.

**The cause is a collision between two LOCKED requirements, not a shortfall of the build:**

- the probe runs INSIDE a sandbox (`packages/worker-daemon/src/supervisor/env-probe.ts` runs it
  through the run's own `effect.execute`);
- only a **dispatching worker** creates one;
- `M1-D1-SPINE` is *"one control-plane instance, **one separately deployed worker**"*
  (`docs/replatform/epic-regrooming/scope-triage.md`).

One deployed worker drives one tenant's sandbox. A second deployed worker would satisfy the probe
clause **by breaking the gate's own topology clause**, so per-tenant observation is structurally
unavailable on that lane. No amount of build effort changes that.

### Decision

**Criterion 5's per-tenant observation is satisfied by the `M1a-D2-MECHANISM` campaign, not by
`M1-D1-SPINE`.**

- `M1-D1-SPINE` observes criterion 5 for its single worker-driven tenant, and **RECORDS the other
  enabled tenants as unobserved**, held in both directions by the `DEP-016` tripwire
  `evaluateEnvProbeObservability` (`scripts/lib/m1-spine-assertions.mjs`): it reds if a probe summary
  ever appears on such an attempt, and it reds if observation is claimed without one. That record is
  a RECORD, and `DEP-019` is directed not to convert it into a claim.
- The `DEP-015` shipped-boot lane boots **one worker per tenant** (`m1-worker-a`, `m1-worker-b`,
  `m1-worker-c` in `docker/m1-boot/docker-compose.m1-boot.yml`, each with `AOA_WORKER_ENV_PROBE=1`),
  which is exactly the topology the probe was designed for. That lane observes criterion 5 for every
  enabled tenant, and its keyed run is already an `M1a` exit requirement.

**Nothing is lost and no clause is weakened.** The per-tenant obligation is not dropped — it is
allocated to the only gate whose topology can bear it. `M1-D1-SPINE`'s topology clause stands
unchanged, and **no extra workers are added to it**.

### Consequences

- `DEP-019` keeps its honest record of the other enabled tenant as UNOBSERVED, with the tripwire.
- The E6 implementation plan's `DEP-019` acceptance 4 is amended, with its superseded text kept
  verbatim, and points here.
- The `M1a` campaign-readiness statement points at the mechanism lane for the per-tenant half.
- A future gate owner reading `M1-D1-SPINE`'s record must not read "criterion 5 observed" as
  per-tenant on that lane; the record says which tenant, and why the others cannot be observed there.
