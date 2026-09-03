# DEP-013 — Design: a CONSUMER for the D1 verdict (a red check nobody reads is a check that did not run)

**Epic:** E6 · **Plan node:** `docs/replatform/program-design.md`, `#### DEP-013`
**Depends on:** DEP-004 (the merge-train lane + its evidence bundle) · **Size:** M · **Status:** `scope` (2026-09-03)
**Terrain of record:** [`GO-BOOK.md`](../../../GO-BOOK.md) §1.9.8 · [`findings.md`](../findings.md) E6-F010
**Motivated by:** WRK-017 Step 0 — a ticket chartered to be "CI-exercised" measured its own lane and found it red.

---

## 1. The measured defect — and it is NOT that the lane broke

`d1-merge-train.yml` failed on three consecutive integration-branch merges and nobody read the
verdict. Measured 2026-09-03 (`gh run list --workflow=d1-merge-train.yml`):

| date | sha | verdict | evidence artifact uploaded |
|---|---|---|---|
| 2026-08-29 | `c3d26657d` | **failure** | ✅ `d1-merge-train-evidence-33251022081` |
| 2026-08-30 | `07ed2cc42` | **failure** | ✅ `d1-merge-train-evidence-33316702359` |
| 2026-08-31 | `b6e02a478` | **failure** | ✅ `d1-merge-train-evidence-33438919657` |
| 2026-08-25 | `50380b6f7` | success (the last one before the window) | — |
| 2026-09-03 | `ee74f9c8c` | success (WRK-017's fix) | — |

**Read that third column again.** DEP-004's evidence machinery worked *perfectly*: every red run
collected per-service logs, worker events, a DB-state dump and MinIO manifests, and uploaded them
under a 14-day retention. **Three complete diagnostic bundles were produced and nobody fetched
one.** DEP-004's acceptance says *"distributed logs, events, database state, and object manifests
are **retained** on failure"* — retention was specified, built and honoured. **Consumption was
never specified at all.**

So the defect this ticket owns is not the build break (WRK-017 fixed that, and E6-F010 records it).
It is that **the verdict had no reader**, and five days of that was indistinguishable from five days
of green. This is variant 10 of *"a check that nothing runs is not a check"*, and it is the first
one in this programme where the check **did** fire, **did** produce its artifact, and was read by
nobody. Every earlier variant was a check that could not fire. This one is worse in one specific
way: it looks, from every dashboard the programme actually consults, exactly like success.

## ★ 2. It is not one lane. Two more, measured today.

If DEP-013 were scoped to "watch d1-merge-train", it would fix one of at least three live
instances. Measured on 2026-09-03 across every workflow in `.github/workflows/`:

| workflow | state | measured | instance? |
|---|---|---|---|
| `d1-merge-train.yml` | active | the window above; fixed, green on `ee74f9c8c` | **yes** (the chartered one) |
| `cross-platform-weekly.yml` | active | the last **three** scheduled runs — 08-16, 08-23, 08-30, all on `main` — are `cancelled`. Three consecutive weeks with **no cross-platform verdict at all**, still true today | **yes**, and purer: it produced no verdict rather than a red one |
| `release-smoke.yml` | active | last 10 recorded runs **all `failure`**; most recent 2026-04-25 — **131 days** ago. `workflow_dispatch`/`workflow_call` only, so it is the dormant callee of a disabled `release.yml` | **weakly** — the last recorded verdict is red and unread, but nothing re-triggers it |
| `llm-evals.yml`, `release.yml` | `disabled_manually` | last verdicts red, but the workflow announces it is off | **no** — a disabled workflow is a visible state, not a silent one |

**Design consequence, and it is the one that matters:** the consumer must be
**workflow-agnostic by construction**. Making it generic costs nothing over making it d1-specific
(the same API query, one manifest row instead of a hardcoded name), and a d1-specific consumer
would leave `cross-platform-weekly`'s three blank weeks exactly as invisible as they are now.

## 3. Why it was invisible — the two structural facts

1. **`d1-merge-train` runs on `push`, never on `pull_request`.** Its `on:` block is `merge_group` +
   `push` to `main`/`docs/replatform-program`. So no PR can carry its verdict, and the verdict
   arrives only after the merge that could have been reconsidered.
2. **★ The `merge_group` trigger has NEVER FIRED.** Of the last 40 runs, `event` is `push` for
   **40/40** — zero `merge_group`. The repo does not use a merge queue, so the one declared
   pre-merge path in that workflow is itself a dormant clause. Anyone reading the trigger block
   would reasonably conclude the lane gates the merge queue. It gates nothing.

And the fact that decides §4: **`docs/replatform-program` has NO branch protection at all** —
`gh api repos/MeteoriteLabs/AoA/branches/docs%2Freplatform-program/protection` → `404 Branch not
protected`. `main`'s required-context set is exactly `["ci-required"]`.

## ★★ 4. The options, weighed against those measurements

This is the section the ticket exists for. Each option is judged on the same three questions:
does it make the verdict **read**, what does it **block**, and does it generalise to §2.

### Option A — promote `d1-merge-train` to a required check

**Rejected, and the measurements kill it three separate ways:**

1. On **`docs/replatform-program` — where the five-day window actually happened — there is no
   protection to add it to** (404). The option is a literal no-op on the affected branch.
2. On `main`, the lane never runs on `pull_request`, so a required context would leave every PR
   at *"Expected — Waiting for status"* forever. `CLAUDE.md` documents this exact trap ("a skipped
   required check leaves PRs stuck"), and it is the owner's stated concern: **a required check that
   runs post-merge blocks nothing on PRs while blocking the branch.**
3. It violates the repo's own HARD RULE #2, machine-enforced in `scripts/lib/ci-lanes.mjs`: *"NEVER
   an independently-required conditional job. Only `ci-required` is a branch-protection required
   check."* Adding a second required context would have to be exempted from a guard whose whole
   purpose is to prevent that shape.

The owner's instinct is therefore confirmed by measurement rather than by taste, which is why this
got a ticket instead of a settings change.

### Option B — run `d1-merge-train` on pull requests

**Partially useful; not the answer, and not free.**

- **What it genuinely adds:** it is the only option that catches an image-build break *before*
  merge. WRK-017's own first push proves the value — a `.gitignore`d file broke the checkout in a
  way no local run could see. (Though note: `policy` caught that one, not the image build.)
- **What it costs:** a 45-minute-timeout job that builds BOTH split images from source on every
  PR touching `docker/**`, `docker-compose.d1.yml` or `tests/d1/**`. WRK-017's PR pushed three
  times; it would have paid that three times.
- **★ Why it cannot be made cheap safely:** affordability requires a `paths:` filter, and a
  `paths`-filtered trigger on a job that is then required is precisely HARD RULE #1 in
  `ci-lanes.mjs` ("GitHub treats a skipped REQUIRED check as passing"). Left non-required, we are
  back at a verdict with no consumer — just an earlier one.
- **It does not generalise.** `cross-platform-weekly` is a `schedule`; there is no PR to hang it on.

**Disposition:** kept as a NAMED, DEFERRED companion (§8), not folded in. It is a different
trade-off (cost vs. earliness) from the one this ticket settles (production vs. consumption).

### Option C — a consumed watch inside `policy` that reads the last D1 verdict

Add a step to `pr.yml`'s `policy` job — which runs on **every** non-draft PR, has **no `changes`
gate** (`pr.yml:124-127`), and already feeds `ci-required` — that queries the latest completed
`d1-merge-train` run on the PR's base branch and fails when it is not `success`.

- **Pro:** it borrows the ONE required check that exists. No new required context, no rule-2
  violation, and it works on a branch with no protection because `ci-required` is still *reported*
  and the merge protocol already says to confirm it.
- **★ Con, and it is fatal in this form:** it makes MY PR red because SOMEBODY ELSE'S merge broke
  the lane. That is "blocking the branch" again, one level down, and it is the failure mode the
  owner named. During the 08-29 → 08-31 window every unrelated PR in the repo would have been red.
- Needs `actions: read`; `pr.yml` declares only `contents: read` today.

**Rejected in this form** — but its *mechanism* (a reader inside the already-required job) is
correct and is reused in §5 for a strictly narrower question.

### Option D — a scheduled reconciliation that files/updates an issue

A small scheduled workflow enumerates a declared set of non-required workflows, compares each
one's latest verdict and its age against a committed manifest, and opens/updates ONE deterministic
tracking issue when any is red, stale, or absent.

- **Pro:** workflow-agnostic (it catches `cross-platform-weekly`'s three blank weeks too), costs
  seconds, blocks nothing, and the manifest is a human declaration — the same inversion that makes
  `guard-inventory.json` and `test-execution-census.json` work: *verify the cheap direction against
  a declaration rather than infer the hard one.*
- **★★★ Con, and the design must not hand-wave it: the reconciler is itself an unconsumed,
  non-required workflow.** If it goes red — or gets `cancelled` for three weeks, exactly like
  `cross-platform-weekly` — nobody reads it either. Option D alone is the same bug one level up.

### ★ Option E (RECOMMENDED) — D, with the recursion terminated at the one required check

Split "consume" from "block", which is the move the whole ticket turns on:

- **Consuming** is Option D: the reconciler produces the artifact a human reads (an updated issue),
  within a bounded time of a red or missing verdict.
- **Blocking** is a step in `policy` (Option C's mechanism) that asserts **the reconciler itself
  ran recently** — NOT that D1 is green. So:
  - a red D1 does **not** red an unrelated PR; it updates an issue,
  - a **silent** D1 — no reconciler run within the tolerated window — **does** red `policy`, and
    therefore `ci-required`.

**The gate is on the verdict having been READ, never on the verdict itself.** The recursion stops
because the terminating reader lives inside the only check branch protection already requires, and
that check runs on every PR by construction.

This is the same shape TRACK-002 chose for the same reason and is worth naming as precedent: do not
try to observe execution across workflow boundaries; declare it, and verify the cheap direction
from inside the job that always runs.

## ★★ 5. Acceptance, stated in terms of the CONSUMER

An acceptance clause reading *"`d1-merge-train` passes"* would re-file the bug this ticket exists to
close. The clauses are therefore about the reader:

1. **A non-green or missing verdict produces a consumed artifact within a bounded time.** For every
   workflow declared in the manifest, a `failure` / `cancelled` / `timed_out` latest run, or no
   completed run within its declared `maxAgeHours`, causes the tracking issue to exist and to name
   that workflow, its run URL and its conclusion, within one reconciliation interval.
2. **The absence of consumption is itself detectable, and it is the ONLY thing that blocks.**
   `policy` fails when the reconciler has not completed within its own tolerated window. A red
   watched workflow never fails `policy`.
3. **The manifest is complete by construction.** Every file in `.github/workflows/` carries an
   entry — watched, or explicitly not-watched with a reason that says what would have to change.
   Zero workflows discovered, or zero manifest entries, **fails** (anti-vacuity, house style).
4. **The bound is a committed number, not a habit.** `maxAgeHours` per workflow and the reconciler's
   own tolerated silence are values in the manifest, reviewable in a diff.
5. **It has been PROVEN to fire.** See §6 — both directions, against real red verdicts, before the
   ticket closes.

## ★★★ 6. The positive control — because a consumer nobody has watched fail is the same defect

This is not optional and it is not a unit test. Three controls, in increasing order of realism, and
the design commits to all three:

- **PC-1 — the pure evaluator, mutated.** The verdict decision is a pure function of
  `{conclusion, completedAt, now, maxAgeHours}`. Every arm gets a killed mutant: drop the
  `cancelled` arm (→ `cross-platform-weekly`'s real three weeks stop being reported), drop the
  staleness arm, drop the `timed_out` arm, invert the comparison. **Mutate each OR-ARM, not just
  the clause** — the standing E7-1 lesson, and the one that produced a survivor in WRK-015.
- **★ PC-2 — a REPLAY against recorded reality, not a fixture.** Point the evaluator at the real
  API records for `d1-merge-train` over 2026-08-25 → 2026-09-03 and assert it would have reported on
  **2026-08-29** and stayed reporting until `ee74f9c8c`. The input is the actual recorded history
  of the incident, so the control is against reality rather than against a hand-built object. A
  fixture-shaped positive control would be the very thing this ticket is about.
- **★★ PC-3 — the live end-to-end, both directions, and the repo hands us a genuine red for free.**
  1. *The consumer fires:* add `cross-platform-weekly` to the manifest as watched. It is
     **cancelled today, for real** — so the first reconciler run must open the issue naming it,
     with no lane deliberately broken and nothing degraded to arrange it.
  2. *The reader fires:* set the reconciler's tolerated silence to a value its last run already
     violates (or skip one run on purpose) and show `policy` — and therefore `ci-required` — go
     **RED**, then restore. **A guard that has never been made to fail is not reported as passing**
     (the standing rule this programme is built on).

## 7. Slice plan (lettered; each independently landable)

| Slice | What | Runs where | State when it lands |
|---|---|---|---|
| **A** | `scripts/workflow-verdict-manifest.json` + a pure evaluator (`scripts/lib/workflow-verdict.mjs`) + `scripts/check-workflow-verdict-manifest.mjs` asserting every `.github/workflows/*.yml` has an entry (anti-drift, the `check-guard-inventory` asymmetry). PC-1's mutation sweep lands here. | `policy` | **INERT** — it reports on the manifest's completeness only; it queries no live verdict and blocks nothing new |
| **B** | `.github/workflows/verdict-reconcile.yml` — `schedule` + `workflow_dispatch`, `actions: read` + `issues: write`. Reads each watched workflow's latest completed run, applies the Slice-A evaluator, and opens/updates ONE deterministic issue. PC-2's replay lands here. | its own workflow | **CONSUMING, non-blocking** |
| **C** | The terminating reader: a step in `pr.yml`'s `policy` asserting the reconciler's own freshness. Needs `actions: read` added to `pr.yml`. PC-3(2) lands here. | `policy` → `ci-required` | **BLOCKING — and only on silence** |
| **D** | Dispositions for §2's measured instances: `cross-platform-weekly` **watched** (and PC-3(1) is exactly that entry's first run); `release-smoke` **not-watched, with a reason** (dormant callee of a disabled `release.yml`); the `disabled_manually` pair **not-watched, with a reason**. Every not-watched entry states what would have to change — a reason is not an excuse. | manifest | declarative |
| **E** | Docs: `GO-BOOK.md` §1.9.8 repointed from "check the lane after every merge" (a habit) to the consumer (a mechanism); `HANDOFF-orchestration.md`'s merge protocol updated to say what a builder should now expect to see. | docs | — |

★ **A and B are safe to land alone; C is the one that can block, so it lands last and only after
PC-3(2) has been demonstrated.** That ordering is deliberate: a blocking reader wired before its
own failure mode has been observed would be this ticket committing its own sin.

## 8. Out of scope, named

- **Option B (D1 on PRs)** — a real, separable trade-off (cost vs. earliness). Deferred with its
  measurements in §4 so a future sprint can decide it on evidence rather than re-derive them.
- **Fixing `cross-platform-weekly`'s cancellations or `release-smoke`'s 131-day-old red.** DEP-013
  makes them VISIBLE; making them green is each lane's own work. Conflating "report it" with "fix
  it" is how a reporting ticket becomes unlandable.
- **A merge queue.** The dormant `merge_group` trigger (§3) is a real finding about the workflow's
  self-description, not a proposal to adopt one here.
- **Any change to what `d1-merge-train` itself runs.** Untouched by this ticket.

## 9. Two residuals inherited from WRK-017, and where each belongs

### 9.1 The deps-stage closure class → **its own finding, NOT DEP-013**

E6-F010's residual: `check-image-deps-stages.mjs` compares the deps stage's COPY set against the
**production** closure (`computeRuntimeClosure` walks `.dependencies` alone, by design), while the
build stage's `pnpm --filter "pkg..."` traverses **devDependencies too**. Any future workspace
devDependency added to `server` or `ui` re-widens the build selection with nothing warning; WRK-017's
build-stage re-install absorbs it, but does not detect the divergence.

**Filed as E6-F012** (`open`, MED, `unowned` with a reason) rather than folded in, on three grounds:
it is a **different mechanism** (a static closure guard, not a verdict consumer); it is small and
self-contained; and bundling would make DEP-013 about two unrelated things — the precise scope
error the E6 register already carries findings about. Note the two relate but do not overlap:
DEP-013 makes the *next* occurrence loud within a bounded time; E6-F012's successor would stop it
being possible. Neither substitutes for the other.

### 9.2 `ci-local.mjs` does not run the vitest shards → **a standing-rules fix, not a ticket**

This bit WRK-017 once (a worker-daemon test that PARSES `docker-compose.d1.yml` went red in
`verify (4)` after the local gate was green). It is not a DEP-013 concern: it is the *local*
pre-push filter, not a CI verdict.

**Measured mechanism, so the routing decision is on evidence:** `ci-local.mjs`'s default is
`FAST_JOBS = ["policy","brand-check","worker-protocol-contract-bytes","lint"]` — `verify` is not
*skipped*, it is **never selected**, so it never enters the `skipped` array and the summary's own
honest warning (*"★ Skipped jobs are NOT green. Linux CI remains the authority for them."*) **never
fires for it.** The tool is truthful about skips and silent about non-selection.

Two cheap homes, and this design recommends both:

1. **The builder-facing standing rules** (`HANDOFF-orchestration.md`'s per-track prompt) — one line:
   *"`ci-local.mjs` runs the FAST gate only. It does not run `verify`; if you touched anything a
   vitest spec reads — including non-TS files a test parses — run that package's suite."*
2. **A one-line tooling fix** (whoever next touches the file): print the unselected jobs in the
   summary beside the skipped ones, so the existing "NOT green" warning covers them. Not a ticket
   on its own; a rider on the next `scripts/` change.

## 10. Tests

| Area | Test |
|---|---|
| Manifest completeness | a workflow file with no manifest entry **fails** |
| A reason is not optional | a `not-watched` entry with an empty reason **fails** |
| Anti-vacuity | zero discovered workflows, or zero manifest entries, **fails** |
| Evaluator arms (PC-1) | `failure` / `cancelled` / `timed_out` / stale / absent each reported; each arm separately mutated and killed |
| Green is silent | a `success` inside `maxAgeHours` reports nothing (a reporter that reports everything is not a reporter) |
| Replay (PC-2) | the recorded 08-25 → 09-03 `d1-merge-train` history reports from 08-29 and stops at `ee74f9c8c` |
| Issue idempotency | two consecutive reconciliations over the same red state update ONE issue, never open a second |
| Reader (PC-3.2) | `policy` fails when the reconciler's last completion is older than its tolerated silence; passes when it is not |
| Reader is narrow | `policy` does NOT fail merely because a watched workflow is red — proven with a genuinely red watched entry present |
