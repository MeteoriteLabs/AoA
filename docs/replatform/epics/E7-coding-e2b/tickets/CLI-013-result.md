# CLI-013 Result — the announcement: `EventSequencer.artifactPrepared`

**Status:** `gate_review`
**Date (UTC):** `2026-09-24`
**Epic:** `E7-coding-e2b`
**Plan task:** `E7 implementation-plan ### CLI-013 — the announcement: EventSequencer.artifactPrepared (M1b)`
**Implementer:** `M1 CLI-013 build agent (Claude Opus 5)`
**Start SHA:** `7be35ae6b7` (program tip at start)
**Implementation commit:** `26c3df23b3d6c3a24054ac3a938fdd72acf329c2`

The implementer leaves `Status` at `gate_review`. A separate reviewer completes the review section
and is the only role that may change it to `complete`.

★★★ **THIS IS NOT A SUPPLY MECHANISM AND IT DOES NOT MEAN OUTPUT LANDED.** It flips **no counter**:
`countProducedOutputs` reads `job_artifacts` directly and joins no events, so a committed artifact
counts whether or not anything announced it. Nothing here moves `capabilityProven`. What it buys is
that a committed artifact becomes visible in the evidence stream, which is what link 5 projects.

---

## 1. The decision this ticket owed, and how it was answered

The task section says `CLI-013` **"owes a DECISION before it is assignable as build"** on event
contiguity, and none was recorded at the start tip (`decisions.md` held `E7-D08`…`E7-D11`, and its
header still listed *"the `CLI-013` event-contiguity decision"* as expected-but-not-recorded).

Recorded as **`E7-D12`** in `docs/replatform/epics/E7-coding-e2b/decisions.md`: **option 1, FATAL.**
A sink rejection on `artifact_prepared` propagates; it is not caught. Reasons are in the decision;
in short, option 2 changes the shared sequencer (the task rules it out of this ticket) and option 3
assumes a transient failure the measured sink does not have — `DurableWorkerEventSink` writes a
LOCAL encrypted outbox, so its failure modes are disk and KEK and a retry loop does not clear them.

### ★★★ The correction this ticket makes to its own acceptance, verified at source

The task's *Failure behavior* says fatal means "a sink failure fails the attempt". **Measured at
source, `createSupervisor().accept` never rejects** — it catches everything out of `runLifecycle`
by design (*"never reject out of `accept`"*), logs `run lifecycle error`, and calls
`escalateCleanup(run, "lifecycle_error")`. A first draft of the acceptance test asserted
`rejects.toThrow(...)` and went red against a correct implementation. The observable consequence of
option 1 in this daemon is therefore:

1. the lifecycle **aborts at the emit**;
2. **no terminal is written after the hole** — the property that matters, because the ingest accepts
   nothing past a gap, so a terminal emitted there would never land anyway;
3. the attempt is left non-terminal for the `JOB-006` reaper, with cleanup escalated.

The test asserts (1)–(3), not a rejection. This is recorded in `E7-D12` under *What "fails the
attempt" actually means here*.

---

## 2. What changed

| File | Change |
|---|---|
| `packages/worker-daemon/src/supervisor/events.ts` | `EventSequencer.artifactPrepared(input: ArtifactPreparedPayloadV1)` — the emitter, identical in shape to every sibling (contiguous `seq`, `canonicalEventDigestInputV1` + `node:crypto` digest, frozen-schema parse, injected sink). It PROJECTS `{artifactId, kind}`, so a path handed to it cannot ride along. |
| `packages/worker-daemon/src/supervisor/supervisor.ts` | `runExportWindow` now returns the announcements for the **committed** references (`announcementsFor`, joining each `ExportedArtifactRef` back to the request that named it for its `kind`); `runLifecycle` emits one `artifact_prepared` per announcement **after the window and before the terminal**, deliberately OUTSIDE the window's catch. |
| `packages/worker-daemon/src/__tests__/events-artifact-prepared.test.ts` | New — 9 tests. |
| `docs/replatform/epics/E7-coding-e2b/decisions.md` | `E7-D12` (new). |
| `docs/replatform/epics/E7-coding-e2b/findings.md` | `E7-F024` disposition paragraph; `E7-F043` (new, the class twin). |
| `scripts/finding-ownership.json` | `E7-F043` entry, `unowned` with its reason. |
| `scripts/test-inventory.json` | worker-daemon pin 173 → 174. |

**Nothing in `packages/worker-protocol` was edited.** The event kind, the payload schema and the
`job_events` CHECK were already frozen and in place; `check:frozen-worker-protocol-v1` is unaffected.
No schema change, so no Drizzle migration and no `db:generate`.

### Three points a reviewer should check deliberately

1. **The announcements are built BEFORE the partial-failure exit, not after it.** A window that
   committed some files and refused others still made those commits durable. `report` classifies the
   WINDOW; the announcement is per COMMITTED artifact, and the two are different questions. Mutation
   **M2** proves the test reds if this is collapsed onto the all-success path.
2. **The `kind` is the one the REQUEST declared** (`E7-D08`: `other` in production), never invented.
   `ExportedArtifactRef` carries no `kind`, which is why `requests` is hoisted out of the IIFE.
   Mutation **M4** proves it.
3. **`artifactId` is PARSED, not cast.** It is a branded type and `ExportedArtifactRef.artifactId`
   is a plain string; an `as` would assert a shape nobody checked, so `announcementsFor` runs the
   frozen `artifactPreparedPayloadV1Schema`. A committed path with no request **throws** rather than
   announcing a guessed `kind` — fail-closed, same posture as a sink failure and for the same reason.

**The announcement loop is BOUNDED, upstream.** It emits once per committed reference, and the
producer caps accepted files at `MAX_OUTPUT_FILES = 64`
(`packages/worker-daemon/src/lease/export-request-producer.ts`), so `exported.length <= 64` however
long a listing the tenant authors. The loop runs after the export window's deadline has closed
(`open = false`), like the terminal emit below it; both are local outbox writes, not sandbox or
network operations, so neither is inside that deadline and neither needs to be.

**Crash window, stated rather than hidden.** If the process dies between a commit and its
announcement, the artifact is committed and unannounced. That is the safe direction: the artifact is
durable and counts without the event (`countProducedOutputs` joins no events), and the ACK the
control plane acts on — the terminal — is emitted strictly AFTER the announcements, never before.

**It does not route around `CLI-012`'s fail-closed export refusal.** The announcement is derived
from `ArtifactExportOutcome.exported` — references the sequencer produced only after
`artifactCommit` returned `committed`. Bytes that `exportArtifact` refused never produce a reference,
so a refused export is structurally unannounceable. Nothing here touches the charge invariant.

---

## 3. RED

`pnpm --filter @armyofagents/worker-daemon exec vitest run src/__tests__/events-artifact-prepared.test.ts`
at the start tip, with the test file present and no implementation:

```
Tests  7 failed | 1 passed (8)
 -> seq.artifactPrepared is not a function          (x3, the emitter cases)
 FAIL announces ONE artifact_prepared per COMMITTED reference, after the window and BEFORE the terminal
 FAIL a PARTIAL window still announces what COMMITTED - the refused file loses nothing else
 FAIL E7-D12 (FATAL) - a sink failure on the announcement ...
 FAIL F10 - two Organizations through ONE supervisor: each announcement carries its OWN tenant
```

★ **The 1 passing case is recorded honestly:** `nothing committed ⇒ NO announcement` passed
VACUOUSLY at RED, because nothing announced anything. It is not vacuous at GREEN — mutation **M6**
reds it.

Two of the eight initially failed against a *correct* implementation and were corrected, not
force-fitted: the `rejects.toThrow` mechanism error in §1, and a case asserting the frozen payload
would reject an extra field when the emitter's projection drops it first. Both now assert the
behaviour that is actually there.

## 4. GREEN

| Command | Result |
|---|---|
| `pnpm --filter @armyofagents/worker-protocol build` | pass |
| `pnpm --filter @armyofagents/worker-daemon exec vitest run src/__tests__/events-artifact-prepared.test.ts` (this ticket's file) | **1 file, 9 tests passed** |
| neighbours: `+ supervisor-export-artifacts` `+ event-sequencer-producers` `+ dispatch-runtime-export-composition` | **4 files, 46 tests passed** |
| ★ the one flake, named not hidden | `supervisor-hung-stage-input.test.ts > "the deadline is ONE budget across both halves"` went red in 2 of 3 full-package runs and green alone and in the third. It is a **real-clock** test (`setTimeout(…, 30)` against a small budget) and it references **none** of `resolveExportArtifacts` / `exportArtifacts` / `artifactPrepared`, so this diff cannot reach it — the announcement path runs only when both export deps are present. Already named as a flake in `CLI-012-result.md`; not re-filed. |
| `pnpm --filter @armyofagents/worker-daemon exec vitest run` (whole package) | **167 files, 1277 passed, 1 skipped** |
| `pnpm check:worker-daemon-boundary` | `worker daemon boundary: PASS` |
| `pnpm --filter @armyofagents/worker-daemon typecheck` | pass |
| `pnpm --filter @armyofagents/worker-daemon build` | pass |
| pure-node guard set + `check-evidence-immutability --base origin/docs/replatform-program` | `failures: 0` |

## 5. Mutation and positive-control table

Each mutation was applied to the implementation, the focused suite run, then **reverted**; the
baseline was re-run afterwards and returned `9 passed (9)`.

| # | Mutation | Expected red | Result |
|---|---|---|---|
| **M1** | Remove the emit loop in `runLifecycle` | every placement case | **4 failed / 4 passed** — placement, partial, FATAL, F10 |
| **M2** | Return `[]` on the partial-failure exit (announce only on all-success) | the PARTIAL case only | **1 failed** — `a PARTIAL window still announces what COMMITTED` |
| **M3** | Wrap the emit loop in `try { … } catch { /* swallow */ }` | the FATAL case only | **1 failed** — `E7-D12 (FATAL) …` |
| **M4** | Announce `kind: "workspace_patch"` instead of the request's | the placement case | **1 failed** — `announces ONE artifact_prepared per COMMITTED reference …` |
| **M5** | Emit after the terminal (defer the loop) | ordering + presence | **4 failed / 4 passed** |
| **M6** | Build announcements from `requests` instead of `exported` | partial + the anti-vacuity control | **5 failed / 3 passed** — incl. `nothing committed ⇒ NO announcement`, which is how that control is shown non-vacuous |
| **M7** | Drop the payload projection in the emitter (`#emit(…, input)`) | the reference case | **1 failed** — `the payload is a REFERENCE — a path handed to the emitter cannot ride along` |
| **M8** | Restore the pre-fix shape: put `announcementsFor` back inside the window's catch | the fail-closed-escape case | **1 failed / 8 passed** — `the fail-closed join ESCAPES the window's catch …` |

**Positive controls, and what makes each non-vacuous**

| Control | Non-vacuity assertion | Proven by |
|---|---|---|
| `nothing committed ⇒ NO announcement` | asserts the exact stream `["attempt_started","terminal"]`, not merely "no artifact_prepared" | **M6** |
| FATAL | asserts `seen` **contains** `artifact_prepared` (the emit was attempted and the sink threw) before asserting no terminal | **M3** |
| PARTIAL | asserts **exactly one** announcement — not zero, not two | **M2** |
| F10 cross-tenant | asserts **two** announcements exist, and that `orgA !== orgB`, before comparing identities | **M1** |

## 6. Multi-tenant (founder ruling F10)

`F10 — two Organizations through ONE supervisor` drives two handoffs whose `organizationId`,
`companyId`, `jobId` and `leaseId` all differ, through **one** supervisor instance.

- **Same-tenant positive control:** tenant A's announcement carries A's `organizationId`,
  `companyId`, `jobId` and `leaseId`.
- **Cross-tenant:** tenant B's announcement is bound to B, and the serialized event contains
  **none** of A's organization id, company id or lease id.
- Each attempt's stream is contiguous from 1 — one sequencer per lease/attempt.

## 7. Class sweep (M1-BUILD-RULES §E)

**The class, in one sentence:** *a supervisor-path event emit whose rejection is swallowed while a
later event — in particular the terminal — is still emitted onto the same attempt's stream.* Because
`#emit` allocates `seq` before awaiting the sink, the swallow leaves a hole and the ingest accepts
nothing past it, so the "truthful terminal" such a caller continues to cannot land.

**The search (quotable), over the daemon's non-test source:**

```
grep -rn "events\.\(attemptStarted\|log\|progress\|usage\|terminal\|networkDenied\|browserObservation\|artifactPrepared\|service[A-Za-z]*\)(" \
  --include=*.ts packages/worker-daemon/src --exclude-dir=__tests__
```

**Checked 30 emit call sites across 3 files** (29 pre-existing plus this ticket's own; the raw
grep also matches one prose line in `artifact-export.ts`, which is not a call site).
**Found 1** pre-existing site in the class, covering 3 emits under one catch. **Fixed 0. Filed 1.**

| Site class | Verdict |
|---|---|
| `observeRun` block, `supervisor.ts` — `events.log`/`progress`/`usage` under ONE swallowing catch, terminal below | **IN CLASS** → filed as **`E7-F043`** |
| every `events.terminal` inside a `catch` (create / execute / env-probe / cancel exits) | not in class — the terminal is the LAST event, so a later swallow cannot strand anything |
| `service-lifecycle.ts`, six emitters | not in class — the enclosing block is `try { … } finally { settleFinished(); }`, a `finally`, so the rejection propagates |
| `FenceCloseProxy.openEgress`'s `networkDenied` | not in class — not swallowed; the emit precedes a `throw` |
| this ticket's announcement loop | fixed here, by `E7-D12` |

**Why `E7-F043` was filed rather than fixed:** the swallow is a DECLARED contract
(`CLI-003`/D3+D5, restated by `WRK-018` 1(b) — *"Instrumentation must NEVER fail the run"*), so
reversing it needs a recorded decision at the same level as `E7-D12`, and its blast radius is
materially larger: three emit kinds on EVERY run, versus one emit on runs that exported. `unowned`
with the honest reason, per §E rule 4, rather than an invented owner. Note that `E7-D12`'s option 2
(allocate-on-success in the shared sequencer) would close both sites at once and supersede `E7-D12`.

## 8. Findings

- **`E7-F024`** — DISPOSITION added, as the task requires, and it is a disposition **not** a payload
  change: the artifact route carries a REFERENCE (`artifactId` + `kind`), so there is no transcript
  to truncate and no 480-event cap in play. **The finding stays open against the `log` route.**
- **`E7-F043`** — NEW, filed by the class sweep above. Id minted after taking the true max across
  the repo (`git grep -oh "E7-F[0-9]\+" -- docs scripts server packages ui` → max `E7-F042`).
- **`E7-F044`** — NEW, from Codex round 1 P1 (see §8a).
- **`E7-F040`** (owner `CLI-017`), **`E7-F042`** (`unowned`) — untouched, neither duplicated nor closed.
- **`E7-F041`** — checked before assuming, per the brief: it is already `resolved (2026-09-24, the
  class sweep)`. Not re-opened, not re-filed.

## 8a. Codex round 1 (PR #589) — both findings real, verified at source

| Finding | Verdict | Action |
|---|---|---|
| **P1** — a timed-out window discards announcements for files it had already committed | **REAL.** On `withDeadline` → `TIMEOUT` the sequencer promise has not resolved, so its accumulated `exported` is unreachable. | **Filed as `E7-F044`** (LOW, `unowned`). Not fixable here: every fix needs an incremental-progress signal on the **E5-owned** `ArtifactExportSequencer` seam, and the two alternatives — awaiting the pending promise past the deadline, or announcing after the terminal — reintroduce the unbounded wait and break this ticket's own ordering invariant respectively. |
| **P2** — the fail-closed join throws inside the window's broad catch | **REAL, and it was this ticket's own bug.** `announcementsFor`'s throw was converted into `report("failed", …, "sequencer_failed")` + an empty list, and the terminal was emitted anyway — hiding a committed artifact instead of aborting per `E7-D12`. | **FIXED.** `runExportWindow`'s tail is restructured so the try covers only the await; the join runs after it, outside the catch. New test + mutation **M8**. |

★★★ **P2 is an instance of the class this ticket had already filed as `E7-F043`** — a refusal
short-circuited by an enclosing catch — sitting inside my own diff. The sweep in §7 searched for
*swallowed emits* and did not search for *swallowed refusals*, which is why it walked past this one.
Recorded as a miss, not smoothed over: a class sweep is only as wide as the class you name.

## 9. Non-goals honoured

The projection (F5), the counter (F6), any frozen-protocol edit, and any widening of the `log`
payload. No new register wiring, and no keyed workflow dispatched (keyless only).

## 10. CI and review

**PR #589**, base `docs/replatform-program` (never `main`).

**Code-reviewed revision (40-hex): `c3f71519eef55035ebc80a97e0e704b1055b01f8`.** Codex round 2 on
that revision: *"Didn't find any major issues."* Round 1 raised two findings, both real, both
verified at source before acting — see §8a. The only commit after this revision is the docs-only one
that fills in this section.

`ci-required` — the single required check — is **SUCCESS** on `c3f71519ee`. Executed counts, by job:

| Job | Result |
|---|---|
| `ci-required` (aggregator) | **SUCCESS** |
| `verify` shards 1–4 (Linux, the required gate; this ticket's 9 tests run here) | SUCCESS |
| `e2e` | SUCCESS |
| `migrations` | SUCCESS — no schema change in this diff, so nothing to drift |
| `policy` (the guard set, incl. `check-finding-ownership`, `check-register-citation-integrity`, `check-test-inventory`, `check-evidence-immutability`) | SUCCESS |
| `brand-check`, `lint`, `changes`, `browser` | SUCCESS |
| `worker-protocol-contract-bytes` (ubuntu + windows) | SUCCESS — the frozen package is untouched |
| `distributed-contract` | SKIPPED (unchanged from the base; not a regression of this PR) |

Locally, before every push: the pure-node guard set plus
`node scripts/check-evidence-immutability.mjs --base origin/docs/replatform-program` → `failures: 0`.

★ **One flake, named not hidden.** `supervisor-hung-stage-input.test.ts > "the deadline is ONE budget
across both halves"` went red in 2 of 3 local full-package runs and green alone and in the third. It
is a real-clock test (`setTimeout(…, 30)` against a small budget) and references **none** of
`resolveExportArtifacts` / `exportArtifacts` / `artifactPrepared`, so this diff cannot reach it — the
announcement path runs only when both export deps are present. Already recorded as a flake in
`CLI-012-result.md`; not re-filed here.

---

## 11. Reviewer section

*To be completed by a DISTINCT reviewer. `complete` requires EVERY acceptance item met.*

**Reviewer:** `M1b independent reviewer (Claude Opus 5)`
**Reviewed revision (40-hex):** `a88966c23d306cf52b1c4b2cd6cff7def45432ce`
**Disposition:** `approved` — see review attempt 1 below.

### Review attempt 1 — independent reviewer

**Reviewer:** `M1b independent reviewer (Claude Opus 5)` — distinct from the implementer; built none
of this work.
**Date (UTC):** `2026-09-24`
**Reviewed revision (40-hex):** `a88966c23d306cf52b1c4b2cd6cff7def45432ce` — the squash of PR #589
onto `docs/replatform-program`, and a genuine ancestor of this review's HEAD. The record's own cited
revision `c3f71519eef55035ebc80a97e0e704b1055b01f8` is a genuine ancestor of the PR head
`7d187de1e4`, and **the code has not moved since it**: `events.ts`, `supervisor.ts` and
`events-artifact-prepared.test.ts` are **blob-identical** at `c3f71519ee` and at the current program
tip `eb8458bb35` (checked by `git rev-parse <rev>:<path>`), and the only delta from `c3f71519ee` to
the PR head is this record's own §10. So the certified revision describes the code as it now stands.
**Disposition:** `approved`

#### What I verified at source, not from the record

- **The emitter.** `EventSequencer.artifactPrepared` (`supervisor/events.ts`) is one line:
  `#emit("artifact_prepared", { artifactId: input.artifactId, kind: input.kind })` — the projection
  is in the emitter, so a path handed in cannot ride along. Sibling-shaped, no frozen-package edit;
  `check:frozen-worker-protocol-v1` runs in `policy` and I ran
  `check-frozen-worker-protocol-consumer.mjs --source-sha b7a8428…` locally: **OK**.
- **The placement.** `runLifecycle` emits `for (const announcement of prepared) await
  events.artifactPrepared(announcement)` **after** `runExportWindow` returns and **before**
  `events.terminal`, outside the window's catch. `announcementsFor(raced.exported, requests)` is the
  window's **last** statement, after both `report` arms and outside the `try`, so its fail-closed
  throw escapes — the §8a P2 fix is really there and is not a comment.
- **The `kind`.** `announcementsFor` joins on `r.path` from `requests` and throws when a committed
  path has no request; the payload is `artifactPreparedPayloadV1Schema.parse(…)`, not a cast.
  `E7-D08`'s `other` is the request's, never invented.
- **The 8 mutations.** Each is a real inversion of a distinct decision in the diff (the emit loop, the
  partial-exit return, the swallow, the kind, the ordering, the `requests`/`exported` source, the
  projection, the catch boundary), and each expected red maps onto a test that asserts exactly that
  property. I could not re-execute them — this worktree has no installed `node_modules` — so the
  mutants' **shape and reachability** are verified at source and their REDs are taken from the
  implementer's recorded runs.
- **★ The anti-vacuity claim is TRUE at GREEN, and M6 does establish it.** `nothing committed ⇒ NO
  announcement` sets `resolveExportArtifacts: async () => [REQ_A]` — **a request is present** — while
  `exportArtifacts` returns `exported: []`, and asserts the **exact** stream
  `["attempt_started","terminal"]`. So M6 (build announcements from `requests` instead of `exported`)
  makes that case emit one `artifact_prepared` and reds the equality. The author's honesty about the
  RED being vacuous is correct, and the GREEN non-vacuity is proven rather than asserted.
- **The three contradictions of the task section.** (a) The undecided contiguity decision is recorded
  as `E7-D12` (option 1, FATAL) with its reasons measured at source — confirmed against
  `decisions.md`. (b) *"fails the attempt"* is **not** a rejection out of `accept()`: `createSupervisor`
  catches everything out of `runLifecycle` by design, so the test asserts abort + no-terminal-past-the-hole
  + escalated cleanup, which is what the mechanism has. Correct, and correctly carried into `E7-D12`.
  (c) ★ **Partly unrecorded, and I say so rather than let it pass.** The task's *Files* line names only
  `events.ts`, the new test and `findings.md`, while its placement clause mandates the supervisor path —
  so `supervisor.ts` is required by the task and absent from its file list. The record declares
  `supervisor.ts` in §2 but does **not** flag the omission as a contradiction. A documentation gap, not
  a defect, and not a bar to approval: the placement taken is the one the task directs.
- **`E7-F043` and `E7-F044` are correctly scoped, and neither is unfixed work wearing a finding's
  name.** `E7-F043` (`observeRun`'s three emits under one swallowing catch, terminal below) is a
  DECLARED contract (`CLI-003` D3/D5, `WRK-018` 1(b)) whose reversal needs a decision at `E7-D12`'s
  level and touches every run — out of an `S` ticket, `unowned` with that reason. `E7-F044` (a
  timed-out window loses announcements for files it had already committed) is real and is confirmed at
  source: the `raced === TIMEOUT` arm `return []`s, and the accumulated `exported` is unreachable
  because the sequencer only surfaces it on resolve — closing it needs an incremental-progress signal
  on the **E5-owned** seam. Both carry a closure route in `findings.md` and an ownership entry.
- **Register hygiene.** `E7-F024`'s disposition is added and the finding stays open against the `log`
  route; `E7-F043`/`E7-F044` exist in `findings.md` and in `scripts/finding-ownership.json`.

#### Why `complete`, and what it does not certify

`CLI-013`'s acceptance list carries **no keyed item** — it is the emitter, its placement, the
contiguity decision, the frozen-consumer check and the typecheck/build, all of which are met, and
`ci-required` is `success` on the PR head `7d187de1e4`. So unlike `CLI-012`/`CLI-016`/`CLI-017`, this
ticket has nothing pending that a keyed run must supply, and I set `Status: complete` in a separate
commit.

**Not certified by this approval:** anything about supply or about `capabilityProven` — the record is
right that this flips no counter; `E7-F043`, `E7-F044` and `E7-F024` all stay open; the
`supervisor-hung-stage-input` flake is pre-existing and unrelated (I confirmed the announcement path
is unreachable without both export deps); and the mutation REDs are the implementer's recorded runs,
not re-executed here.
