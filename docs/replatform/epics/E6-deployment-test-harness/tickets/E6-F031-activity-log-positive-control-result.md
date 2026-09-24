# E6-F031 — the `activity_log` same-tenant positive control: the measured cause, and the harness fix that makes the case earn its own audit row — result

**Status:** `gate_review`
**Epic:** E6 · **Plan task:** `M1a` critical path (probe commissioned by the planning session, 2026-09-25) · **Milestone:** `M1a`
**Date (UTC):** `2026-09-25`
**Implementer:** Claude Opus 5 (M1 probe agent)
**Start SHA:** `1f1c3f9b8e28e44cf2f3eb74fa46aea1b30ca11b` (`origin/docs/replatform-program`)
**PR:** #605, base `docs/replatform-program`

> `Status` is `gate_review` and may be set to `complete` only by a DISTINCT reviewer, never by this
> author.
>
> ★★★ **NO KEYED RUN WAS DISPATCHED BY THIS SESSION.** The one verification dispatch was
> `mode: keyless` — free, no E2B and no model spend.

---

## 0. What this ticket is

`DEP-022` built the fourteen cross-tenant drivers and recorded a **failing** prediction for its own
step-1 keyless rehearsal. `E6-F030` hit that failure twice, byte-identically, and stopped rather than
dispatching keyed. This ticket resolves the prediction.

```
##[error]DEP-015 cross-tenant: activity_log: the owner's own read must return its row:
{"own":0,"foreign":0,"unscoped":0,"ownActions":[]}
```

Reproduced on runs `36047740323` and `36051455003` and established as MinIO-independent.

★ **What the failure IS.** A **same-tenant positive control failing** — the driver declining to grade
a case it could not set up, refusing to let a cross-tenant denial pass because *nothing* worked. The
control was doing its job. Something real made the owner's own `activity_log` read return zero rows.

---

## 1. The measured cause

The finding (`findings.md`, `E6-F031`) carries the chain in full. In brief, with each link marked
**measured** or **inferred**:

| # | Link | How |
|---|---|---|
| 1 | the probe's read predicate — `activityService.list({companyId, entityType:"job", entityId: jobId})`, and the anti-vacuity arm running the same predicate minus the Company as raw SQL **on the owner pool** | **measured** — read `probeLegacyTableIsolation` (`tests/d1/lib/e6f-harness.mjs`) |
| 2 | `unscoped === 0` means the row exists for **no** tenant, so RLS/GRANT (`E2-D03`) and company-scoping are eliminated: both can only yield `own: 0` with `unscoped > 0` | **measured** — from the observed payload plus link 1 |
| 3 | exactly **four** production writers of `entity_type='job'` exist, each with its trigger | **measured** — `grep` on `JOB_AUDIT_ENTITY_TYPE` and `entityType: "job"` across `server/src` and `packages` |
| 4 | none of the first three fire on this lane: `recordJobSubmitActivity` needs `submitJobWithinTenant` (the fixture uses raw-SQL `seedSpineJob`); `recordJobDrainActivity` needs a drain (none is issued); the staged-input audit is gated `pending.length > 0` (nothing is staged) | **measured** — each gate read at source |
| 5 | the fourth, `createAcceptedActivityAuditProjector` (JOB-017), **is registered on every ingest** | **measured** — `job-events.ts`, `acceptedEventProjectors` |
| 6 | `E3-D-AUDIT-SET` is **closed** at `attempt_started` and `terminal`; `usage` is deliberately excluded, having its own durable record (`cost_events` + `authoritative_cost` receipt) | **measured** — `ACCEPTED_ACTIVITY_AUDIT_ACTIONS`, `job-accepted-activity-audit.ts` |
| 7 | the driver uploads exactly **one** own event, `eventType: "usage"` | **measured** — `cross-tenant.mjs` §2 |
| 8 | no other lane phase submits an audited event against *this fixture job* | **INFERRED** — the fixture's `jobId` is minted inside `runCrossTenantCases` by `newScenarioIds()`, so nothing outside that function can name it. A reading, not a row count. |

★ **The observed payload is explained to its last field, including why the SIBLING arm passed.** The
same `usage` batch is what gives `cost_events` its charge — and in `mode: keyless` the enabled
tenants' journey is never dispatched, so that charge can only have come from this case's own batch.
The ingest therefore demonstrably accepted, fenced and priced the batch; the **only** remaining
variable was the event TYPE. `ownActions: []` is the projector correctly reporting that nothing in
the audited set arrived.

★ **A cycle that KILLS a line of reasoning** (E.3 §4): the RLS/GRANT direction the brief named as a
candidate — `E2-D03`, legacy tables granted with no RLS — is **falsified**, by link 2, at the cost of
zero dispatches. It was answerable at source, which is E.3 §1's whole point.

---

## 2. HARNESS, not product — and the second source

Every production writer is correctly gated; the JOB-017 projector is registered on every ingest.
Nothing in the product declines to write a row it owes. The driver asserted a row that no path it
exercised writes.

★ **The second source** (E.2.1 — a completeness claim needs one): the D1 twin
(`tests/d1/m1-fault-matrix.test.mjs`) passes `journeyA.ids.jobId`, the **real journey's** job, and
says so in an assertion of its own — *"tenant A's journey must have run — it is what wrote the cost
and audit rows"*. The shipped-boot port substituted its raw-SQL fixture job, and the lane never
retains the journey's job id in `state`, which is almost certainly why. **The D1 twin is not
affected**, so there is no twin to fix.

---

## 3. The fix

The case now submits the audited `attempt_started` event on the fence it already owns, so the arm
**earns** its row rather than borrowing one another phase left. That is stronger than plumbing the
journey's job id through: it certifies the live JOB-017 audit write instead of depending on journey
ordering, and it keeps the arm self-contained.

- `terminal` is deliberately **not** used — it would end the attempt, and every later arm needs this
  fence live. `attempt_started` drives leased→running and keeps it.
- Sequence numbers shift (own `usage` 1→2, hostile `usage` 2→3) and must stay **distinct**: a
  duplicate seq is rejected as a replay, which would make the hostile refusal indistinguishable from
  a tenant denial — the DEP-016 lesson this file already carries.

★★★ **No control was weakened.** `own > 0`, the `unscoped > 0` anti-vacuity arm and the
`foreign === 0` classification are **untouched**. Relaxing a same-tenant positive control to unblock
the lane would have re-created precisely the `resolveExecutionSecretHttp` defect the control exists to
catch, and it was the worst outcome available here.

---

## 4. The dispatch, with both predictions stated in advance (E.3 §2)

> **Hypothesis:** the `activity_log` arm reded solely because the driver's only own event was `usage`,
> which `E3-D-AUDIT-SET` excludes; adding the audited `attempt_started` event on the same fence makes
> the JOB-017 projector write the row, and the arm's untouched assertions pass.
>
> - **If right:** the `cross-tenant` step gets **past** the `activity_log` assertion — concluding
>   success, or failing at a later and different assertion — and `d2m.tenant.legacy.activity_log`
>   records `own > 0`, `unscoped > 0`, with `ownActions` containing `job.attempt_started`.
> - **If wrong:** either **(a)** `activity_log` still shows `{"own":0,…}`, which falsifies the
>   event-type chain and points instead at the projector being unwired in the shipped compose despite
>   its registration in `job-events.ts` — reclassifying this as a **PRODUCT** defect; or **(b)** the
>   own batch is no longer `accepted`, a seq/state-machine rejection at `attempt_started`, which
>   falsifies the reading that an acked attempt admits that event and means the fix must plumb the
>   journey's job id instead.

Both branches are diagnostic, and branch (a) is the one that would change the OWNER and the SEVERITY
of the whole result — which is what makes the null result informative rather than merely "not that"
(E.3.2).

`m1-shipped-boot`, `mode: keyless`, run **`36057809378`**, `--ref claude/m1-activity-log-probe`,
candidate `1f1c3f9b8e28e44cf2f3eb74fa46aea1b30ca11b` (the program tip; the lane refuses a candidate
that is not already an ancestor of `docs/replatform-program`, so this branch's own head cannot be the
candidate). **Outcome recorded in the final report and in §7.**

---

## 5. Class sweep

**The class, in one sentence:** *a probe arm that asserts a row exists without the case producing it —
it depends on a row some other phase is assumed to have written.*

Enumerated over all four arms of `probeLegacyTableIsolation` — **4 checked, 1 found, 1 fixed**:

| arm | how its row is produced | in the class? |
|---|---|---|
| `task_outputs` | planted through the PRODUCTION writer, `taskOutputService.upsertForIssue` | no |
| `provider_credentials` | planted by owner SQL, in the probe | no |
| `cost_events` | produced by the case's own `usage` event | no (but see the dual) |
| `activity_log` | **nothing planted it** | **YES — fixed** |

**The dual** (E.1(b)), written down and searched for: *an arm that can PASS wrongly on a row another
phase wrote.* **Found: 1** — `cost_events` reads by Company **and agent**, not by job, and the lane's
fixture agent is the tenant's own agent, so in `mode: keyed` the journey's charge satisfies
`ownCents > 0` whether or not the case's own event was priced. Filed as **`E6-F032`** (`open`,
`unowned`, MEDIUM) with its closing condition, deliberately not fixed here so a measured diagnosis is
not mixed with an unrelated control redesign (E rule 4).

★ Reporting the dual even though it changes the count is the point: "4 checked, 1 found" over one
polarity reads as if it covered both.

**My own diff is in the class** (E.1(a)): the `attempt_started` event this PR adds *is* the case
producing its own row — the fix is the class's remedy applied to itself, not a new instance of it.

---

## 6. Two-sided register delta, against the merge ref (E.2 §4)

`scripts/finding-ownership.json` was touched as a **delta** — read the base's copy, add one key, write
back — never rewritten from this worktree, and asserted **two-sided**:

```
base keys: 101 | head keys: 102
added:   E6-F032
dropped: (none)
changed: (none)
```

`E6-F031` is `resolved` in the same commit as the code that earns it, so it takes **no** key — which is
the convention `E6-F030` followed. `E6-F032` is `open`, so it gains one.

---

## 7. CI, guards and evidence

- Pure-node guard set from M1-AGENT-RULES, plus
  `check-evidence-immutability --base origin/docs/replatform-program`: **`failures: 0`**, run after
  `git add -A` so newly-added files were visible to the tracked-file walks.
- The keyless verification run's per-step conclusions and the
  `d2m.tenant.legacy.activity_log` row are recorded in the final report.
- `ci-required` on PR #605: recorded in the final report.

---

## 8. What this does NOT prove, said plainly

- **The keyed step 2 is still not authorised by this ticket.** `DEP-022`'s sequence gates keyed on a
  green step 1; this ticket reports step 1's outcome and nothing further. No keyed dispatch was made
  and none is recommended here.
- **Link 8 of §1 is inferred, not measured.** No row dump was taken of `activity_log` for the whole
  lane; the claim that no other phase writes against this fixture job rests on the fixture id being
  minted inside `runCrossTenantCases`.
- **`E6-F032` is filed, not fixed.** The `cost_events` arm's positive control remains sounder in
  `keyless` than in `keyed` until its owner closes it.
