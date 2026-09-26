# JOB-017 — Audit and output bridges registered on the accepted-event seam — result

**Status:** `complete` (set 2026-09-23 by the M1 review-batch-3B independent reviewer at attempt 1, revision `60aafb32ec6f8316f92079789cf8814f981f3ed3`). The implementer left it at `gate_review`; only a DISTINCT reviewer sets `complete`.
**Reviewed revision (code):** `f551565de6ff55c2c1691dba63c71b8ac6e0f3fd` (branch `claude/m1-job-017`), the one code commit `feat(job-control): register audit and output bridges on the E3-D-ACC seam`, based on program tip `fc2eb7dde`.
**Date (UTC):** `2026-09-21`
**Decisions:** `E3-D-AUDIT-SET`, `E3-D-OUTPUT-MAP` and `E3-D-TERMINAL-WINNER` in [`../decisions.md`](../decisions.md), all under the accepted `E3-D-ACC` seam contract, decided under founder delegation F2.
**Register:** `E3-17-output` and `E3-audit-parity-bridge` in `scripts/gate-clause-wiring.json` → `wired`, in the same commit as the code that earns them.

## Outcome

- **Transaction-taking cores (E3-D-ACC (a)).**
  - `recordAcceptedActivityCore` (`server/src/services/job-audit-bridge.ts`) writes the `activity_log` row, plus the optional `hub_audit` row, and returns the prepared live event.
  - `projectAcceptedOutputCore` (`server/src/services/job-output-bridge.ts`) writes one `task_outputs` row through the existing `upsertTaskOutputForIssue`, with `isPrimary` forced to false.
  - Neither core opens a transaction, locks the fence, touches a receipt, reads a flag or publishes. Each refuses a Company that its Organization does not own: `activity_log` and `task_outputs` have no RLS (E2-D03), so the scoping is the core's job.
  - `recordAcceptedActivity` and `projectAcceptedOutput` keep their public shapes and now call the cores. The JOB-013 and JOB-014 parity suites pass unchanged.
- **Audit registration.** `createAcceptedActivityAuditProjector` (`server/src/services/job-accepted-activity-audit.ts`) is registered on every ingest (`createJobEventIngestService`, `server/src/services/job-events.ts`), next to JOB-016's pricing. It covers the named set `E3-D-AUDIT-SET`:
  - `attempt_started` → `job.attempt_started`;
  - `terminal` → `job.attempt_terminal`.
  The ingest publishes `activity.logged` only **after** commit, and only for an `applied` outcome. This is the same after-commit pattern as JOB-016's Codex P2 fixes.
- **Output registration.** `resolveAcceptedOutputProjector` (`server/src/services/job-accepted-output-projection.ts`) runs once per batch inside the ingest transaction. It registers the output projection only for a `task_run` job whose batch carries `artifact_prepared`. That event projects only if it names a **committed** `job_artifacts` row of the same Organization, job and attempt (`E3-D-OUTPUT-MAP`). The row is written under a provider namespace that only this projector uses.
- **`projectTerminalWinner` is retired in place (`E3-D-TERMINAL-WINNER`).** Measured writers:
  - the ingest (`acceptEvent` → `applyProjectionForFence`) is the single writer of attempt terminal state;
  - the canary projector (`createCanaryRunProjector` step (4) → `postRunSummaryComment`) and the crew projection (`releaseIssueLockAndLoopback` → `postCrewRunSuccess` / `postCrewRunFailure`) are the single writers of the run summary;
  - `completeAttempt` has no production caller.

  The method carries `@deprecated`, and a zero-production-caller guard pins the retirement. It is not deleted, because the DE-04 dormant-arm test drives it and the threat-control register cites its drain site.

## Acceptance → test

| # | Acceptance | Test (`job-accepted-event-seam.integration.test.ts` unless stated) |
|---|---|---|
| 1 | each named accepted mutation → exactly one activity row + one `activity_audit` receipt in the ingest tx; replay → none; rejected/stale observation → none | `[acc 1]`, `[acc 1 replay]`, `[acc 1 rejected/stale/observation]` (with a same-fence positive control), and through the REAL ingest `[acc 1 + acc 2 + acc 4]` and `[acc 1 stale]` (with a live-fence positive control) |
| 2 | output + terminal in ONE batch → one `task_outputs` row + its `output_projection` receipt, no `attempt_terminal` throw | `[acc 2]`; REAL ingest `[acc 1 + acc 2 + acc 4]` |
| 3 | projector failure → append committed, receipt surfaced | `[acc 3]`: the audit and output registrations each write through the real core and then throw. The append (3 events) and the terminal commit, both writes roll back, and there are 3 `pending` receipts on the attempt. Also `[E3-D-OUTPUT-MAP] provenance is fail-closed` (a real, uninjected failure → `pending`) |
| 4 | `projectTerminalWinner` decision recorded; retired ⇒ no production path can call it; the ingest remains the single writer of terminal state; canary/crew remain the single writer of the summary | `job-output-parity.integration.test.ts` `[E3-D-TERMINAL-WINNER]` (zero production references, plus a positive control that the scanner does see references), and the REAL ingest test (attempt `succeeded`, **0** `task_terminal` receipts, **0** `issue_comments`) |
| 5 | F10: every row carries the attempt's own Organization and Company; neither tenant sees the other's | `[acc 5 / F10]`: two Organizations side by side, plus a tenant read under Organization B's RLS that sees 0 of A's receipts and ≥ 3 of its own. `[acc 5 / F10 cross-tenant denial]`: B's job naming A's task writes nothing into A (`pending`), and the same-tenant control projects. `[F10]`: both cores refuse a foreign Company, with a same-tenant control |
| 6 | positive control: either registration removed → acceptance reds and `check-gate-clause-wiring` reports zero callers | mutations **M1** and **M2** below |

Also: `[E3-D-OUTPUT-MAP] a source with NO task (one_shot)` checks that no output registration is made, so there is no row and no receipt.

## RED → GREEN, with a TDD deviation stated

**The deviation.** The cores, registrations and tests were written in one sitting, and the code was not held back until a failing run existed. This is the same kind of deviation JOB-016 recorded; a distinct reviewer should judge it.

**The recorded RED** is the task's own definition of RED: *"each acceptance above against the unregistered bridges"*. `server/src/services/job-events.ts` was set back to base `fc2eb7dde`, so there were no registrations, while every other change stayed in place. Then the JOB-017 tests were run (`AOA_RUN_WIN_INTEGRATION=1 npx vitest run src/__tests__/job-accepted-event-seam.integration.test.ts -t "JOB-017"`):
- **2 failed and 10 passed.** Both production-ingest tests are red for the right reason:
  - `[acc 1 + acc 2 + acc 4]` expected `["job.attempt_started","job.attempt_terminal"]` and received `[]`;
  - `[acc 1 stale]` is red at its live-fence positive control (expected 1 audit row, received 0).
- The 10 seam-level tests pass in that state because they drive the registrations directly. Their RED is the per-behaviour mutation table below.

**GREEN (local, Windows, embedded PG, `AOA_RUN_WIN_INTEGRATION=1`, at the reviewed revision):**
- The focused command's three files (`job-accepted-event-seam`, `job-audit-parity`, `job-output-parity`) pass **63/63**: 61 in the first GREEN run, plus the 2 retirement-guard tests added after it.
- Related suites pass **245/245** across 16 files: `job-events` (15; see below), `de-04-18-fence-denial-audit`, `de-03-worker-replay-denial-audit`, `e7-f020-arm2-provenance`, `job-fence-surface.contract`, `job-leasing-contract`, `job-budget-cost-parity`, both sweeper suites, `cli-006-attempt-terminal-signal`, `cli-006-projector-wiring`, `crew-terminal-projection`, `task-outputs-service`, `activity-reserved-namespace`, `worker-control-log-redaction`, and `e7-distributed-run-verifier` (72).
- A further **29/29** across `service-health-projection`, `service-leased-supervised` and `job-control-legacy-grants.contract`.
- `tsc --noEmit` is green for `@armyofagents/server`, and `pnpm --filter @armyofagents/server lint` is green.
- The full M1 policy guard set is green (0 failures), including `check-gate-clause-wiring` (25 wired: both clauses now count **1** production caller each) and `check-register-citation-integrity`.

**One existing test changed on purpose.** In the JOB-005 `job-events.integration.test.ts`, the `state()` helper counts **every** projection receipt on the attempt. An accepted `attempt_started` now writes two: its JOB-005 projection receipt and the `activity_audit` receipt. Three expectations changed from `receipts: 1` to `receipts: 2`, with a comment. Because the replay and eventId-reuse cases still read exactly 2, that file now also proves through the real ingest that a replay writes no second audit receipt.

## Mutation table (each run, then reverted with `git checkout`; script `j017-mutate.py`)

| Mutation | Removes | Red |
|---|---|---|
| M1 | the ingest's **audit** registration | `[acc 1 + acc 2 + acc 4]`, `[acc 1 stale]`; **`check-gate-clause-wiring` fails**: `E3-audit-parity-bridge` declared WIRED, `createAcceptedActivityAuditProjector` has 0 production callers |
| M2 | the ingest's **output** registration | `[acc 1 + acc 2 + acc 4]`; **`check-gate-clause-wiring` fails**: `E3-17-output`, `resolveAcceptedOutputProjector` has 0 production callers |
| M3 | the committed-artifact provenance check | `[E3-D-OUTPUT-MAP] provenance is fail-closed` |
| M4 | the audit core's Company-belongs-to-Organization check | `[F10] both cores refuse …` |
| M5 | the output core's Company-belongs-to-Organization check | `[F10] both cores refuse …` |
| M6 | the after-commit publish (publishes inside the tx) | `[acc 1 + acc 2 + acc 4]` (the listener's separate connection sees the rows uncommitted) |
| M7 | the task_run-only output registration | `[E3-D-OUTPUT-MAP] a source with NO task (one_shot)` |
| M8 | the closed named set (adds `log`) | `[acc 1 rejected/stale/observation]` |
| M9 | the retirement (a production reference to `projectTerminalWinner`) | `[E3-D-TERMINAL-WINNER] has ZERO production callers` |
| M10 | the pricing-only telemetry filter | JOB-016 `[acc 4]` (audit outcomes would be counted as `priced`) |

## Differences from the task section, measured at source

1. **The gate-clause symbols changed**: `jobOutputBridge` → `resolveAcceptedOutputProjector`, and `jobAuditBridge` → `createAcceptedActivityAuditProjector`. The registrations call the cores, not the factories. The cores are also called by the wrappers inside their own files, so only the registration symbol can return to zero when a registration is removed, which is what acceptance 6 asks. Both factories keep zero production callers, as before.
2. **"Default-off composition, same switch as JOB-016".** JOB-016's Amendment 1 removed that switch. Both registrations follow pricing: they are registered on every ingest, and the ingest exists only when `distributedExecutionEnabled` mounts `workerControlRoutes` (`server/src/app.ts`). The rollback lever is that flag and the rollout dial.
3. **`projectTerminalWinner` is retired in place, not deleted** (reason in `E3-D-TERMINAL-WINNER`).
4. **The output mapping is deliberately minimal** (`artifactId` null, no `detectedFiles`). `CLI-014` owns promotion into product `artifacts`, and it must extend this registration, not add a second one.

## Things a reviewer should know

- **The E7 verifier's printed disclosure was touched.** `E7_CAPABILITY_LIMITATIONS` and the `countProducedOutputs` comment said that `projectAcceptedOutput` is the only writer of an `output_projection` receipt. The seam registration is now a second writer, also behind the live fence. The disclosure now says so and keeps the original sentences. All 72 of its tests pass, including the deny-lists. The E7-F018 conclusion is unchanged: arm 2 still reads 0 on a real run, because no worker emits `artifact_prepared` (CLI-013).
- **Threat-control citations re-pointed by symbol** through the exact `git diff -U0` line map (DE-01 `jobAuditBridge`, DE-03 `recordProof`, DE-04 `drainFenceGuardDenialSink`, DE-18 `drainFenceGuardDenial`). No evidence text changed.
- **Residuals, stated:**
  - A second `attempt_started` event (a new event id) on an already-running attempt would be audited although it changed nothing (see `E3-D-AUDIT-SET`).
  - A `pending` `activity_audit` or `output_projection` receipt has **no re-drive**. JOB-016's re-drive is for `authoritative_cost` only. Such a receipt is surfaced by the stale-pending detector's warn line on every sweep, and it does not block the MIG-009 drain, whose gate reads only `authoritative_cost`. Whether these kinds need a re-drive is not decided here.

## Files

- **Created:**
  - `server/src/services/job-accepted-activity-audit.ts`
  - `server/src/services/job-accepted-output-projection.ts`
  - this record
- **Modified:**
  - `server/src/services/job-audit-bridge.ts` and `server/src/services/job-output-bridge.ts` (the cores; the wrappers call them; `@deprecated` on `projectTerminalWinner`)
  - `server/src/services/job-events.ts` (the registrations; telemetry and budget flush scoped to `authoritative_cost`; after-commit publish)
  - `server/src/services/e7-distributed-run-verifier.ts` and `server/src/services/e7-distributed-run-verifier-store.ts` (disclosure)
  - tests: `job-accepted-event-seam.integration.test.ts` (+12), `job-output-parity.integration.test.ts` (+2), `job-events.integration.test.ts` (receipt count)
  - `scripts/gate-clause-wiring.json`
  - `docs/architecture/distributed-execution-threat-controls.json` (citations)
  - `docs/replatform/epics/E3-job-control/decisions.md`

## CI evidence

To be recorded, by job with its executed count, in an addendum once the PR's run on the reviewed revision completes. This section is not rewritten.

## CI evidence — addendum (2026-09-21)

- **Run `35603384158` on `1cccda8cf79186c0f0a2a2e54b398d4897f67e6d`:** `ci-required` **success**, and every job passed. That commit is the reviewed code revision `f551565de` plus this record's first commit, which changes only this file.
  - `verify (3)` executed `job-accepted-event-seam.integration.test.ts` **(30 tests)** and `job-output-parity.integration.test.ts` **(20 tests)**. Neither reported skipped tests, so the 12 JOB-017 seam and ingest tests and the 2 retirement-guard tests ran on Linux.
  - `verify (1)` executed `job-audit-parity.integration.test.ts` **(13 tests)**.
  - `verify (2)` executed `job-events.integration.test.ts` **(15 tests)**, including the updated receipt count.
  - `policy`, `lint`, `migrations`, `e2e`, `e2e-pgvector`, `distributed-contract` and `browser` all passed.
- **Codex** (`chatgpt-codex-connector`) reviewed `1cccda8`. It completed with no findings (a 👍 reaction and no review comments).

## Addendum — one more thing a reviewer should know (2026-09-21)

**This makes arm 2 of the E7-1 capability counter reachable.** `countProducedOutputs` arm 2 counts `task_outputs` rows that carry an applied `output_projection` receipt. The JOB-017 registration writes exactly such a row for any committed `job_artifacts` row that a `task_run` attempt announces with `artifact_prepared`, **whatever its `kind`**. The `CLI-014` graph node says `CLI-014` "moves" this counter. After this ticket, the counter's writer already exists, and it has two limits:
- it is gated on a **committed** artifact of the same attempt, not merely a declared one;
- it does not check the artifact's `kind` (the arm-1 question `E7-F019` records).

It still reads 0 on every real run, because no worker emits `artifact_prepared` until `CLI-013`. Whether arm 2 should also require a particular `kind` is left to `CLI-014` and the E7-F018/F019 owners. This record does not decide it.

## Addendum — the re-drive is generalized (2026-09-21, planning-session ruling, F2)

**The ruling.** The "Things a reviewer should know" section above states as a residual that a
`pending` `activity_audit` or `output_projection` receipt has no re-drive. The planning session
ruled, under founder delegation F2, that this is the programme's lost-audit class, and required the
change in this PR. That residual is **closed** by the change below. The earlier text is kept as
written.

**The change.** Commit `dbf4628cf3b36fe907410ed0f2b8ba111eaa7b5e`, `feat(job-control): re-drive
pending activity_audit and output_projection receipts`. It is recorded in `E3-D-ACC`'s as-built
notes in `decisions.md`.
- **One dispatcher, `redrivePendingProjection`, keyed by receipt kind.** This is JOB-016's method,
  generalized in place; the name `redrivePendingAuthoritativeCost` is kept as the same function. It
  locks the pending receipt, re-reads the stored event and runs the kind's core through the seam's
  own mapping. The seam and the re-drive now share `applyAcceptedEventAudit` and
  `applyAcceptedOutputEvent`, which were extracted from the projectors. It then flips the receipt to
  `applied`.
- **The JOB-006 sweep** drives it with the same bound, `AUTHORITATIVE_COST_REDRIVE_MAX_ATTEMPTS`, and
  raises the same single, durable Inbox item.
- **Live events** are performed only after the re-drive commits.
- **`readAcceptedEvent`** (`packages/db`) additively returns the stored sequence, attempt number,
  lease id and the lease's worker.

**Tests** (`job-accepted-event-seam.integration.test.ts`, describe "JOB-017 re-drive of pending
activity_audit and output_projection receipts", 6 tests):

| Test | Asserts |
|---|---|
| `[re-drive audit]` | A pending audit receipt is re-driven to `applied`, producing exactly one `activity_log` row (the seam's row: action, entity, worker actor, `terminalStatus`, `leaseId`). `activity.logged` is published once, after commit: the listener's separate connection already sees the row. A second re-drive returns `not_pending`, and a replayed batch adds nothing. |
| `[re-drive output]` | An output announced before its commit is `pending`. Once the artifact is committed, the re-drive produces exactly one `task_outputs` row, and a replay adds nothing. |
| `[re-drive via the sweeper]` | The job-control sweep re-drives both kinds in one pass. |
| `[bound, output]` and `[bound, audit]` | A persistent failure makes exactly `AUTHORITATIVE_COST_REDRIVE_MAX_ATTEMPTS` re-drive calls and raises exactly one Inbox item. A restarted sweep neither retries nor raises again. |
| `[re-drive F10]` | Two Organizations. Organization B's sweep re-drives only B's receipts, and A's stay pending (the same-tenant control is A's own sweep). Every row lands in its receipt's own Organization and Company. |

**Mutations** (script `j017-mutate2.py`; each is reverted after the run):

| Mutation | Removes | Red |
|---|---|---|
| M11 | `activity_audit` from the dispatcher | `[re-drive audit]`, `[re-drive via the sweeper]`, `[bound, audit]`, `[re-drive F10]` |
| M12 | `output_projection` from the dispatcher | `[re-drive output]`, `[re-drive via the sweeper]`, `[bound, output]`, `[re-drive F10]` |
| M13 | the re-drive's after-commit publish (publishes inside the transaction) | `[re-drive audit]` |
| M14 | the shared mapping (the re-drive audits a different action than the seam would) | `[re-drive audit]` |

**GREEN (local, embedded PG, `AOA_RUN_WIN_INTEGRATION=1`, at `dbf4628cf`, which includes a merge of
program tip `81c5a940c`):**
- The seam suite passes **36/36**.
- 22 related files pass **343/343**. These are the earlier 19 plus the three service/legacy-grants
  files, and they include the JOB-016 Amendment 3 tests, which still exercise the kept name.
- `tsc` passes for `@armyofagents/db` and `@armyofagents/server`, and server lint passes.
- The full guard set passes.

CI evidence for the new head will be cited in PR #560; this section is not rewritten for it.

## Open question handed to CLI-014, CLI-015 and ruling F7 (2026-09-21)

**Arm 2 of the E7-1 capability counter currently counts any committed artifact, regardless of its
`kind`.** `countProducedOutputs` arm 2 counts `task_outputs` rows that carry an applied
`output_projection` receipt. The JOB-017 registration, and now its re-drive, writes such a row for
every committed `job_artifacts` row that a `task_run` attempt announces with `artifact_prepared`,
whatever its `kind` (`E3-D-OUTPUT-MAP` checks commitment, not kind). So once `CLI-013` makes a worker
emit `artifact_prepared`, **any** committed artifact would move arm 2, including one that is not a
work product (the arm-1 question, `E7-F019`, in a new place).

JOB-017 does not decide this. It is handed to:
- **`CLI-014` / `CLI-015`**, which own the output projection's rich mapping and the capability
  counter;
- **ruling F7**, which governs what `M1b` must show.

The question is whether arm 2, or the registration's mapping, must require a particular `kind`
before a row counts toward capability, or whether "any committed artifact" is the intended meaning.
Today arm 2 still reads 0 on every real run, because no worker emits `artifact_prepared`.

## CI evidence — the re-drive head (addendum, 2026-09-21)

- **Correction to the re-drive addendum above.** That addendum says the full guard set passed at
  `dbf4628cf`, and **that is not accurate for that commit**. Growing `readAcceptedEvent` shifted
  lines in `packages/db/src/repositories/tenant/job-control.ts`, so `check-register-citation-integrity`
  failed on three DE-30 citations there. The fix is commit `a58278c3928cd9e43be719cea23328780ccc10a7`:
  it re-points the file's citations in `distributed-execution-threat-controls.json` through the
  exact `git diff -U0` line map. The one historical SVC-007a citation ("of that commit") is left at
  its original line, as its grandfather entry requires. The full guard set is green at `a58278c`.
  The addendum above is not rewritten.
- **Run `35608914951` on `a58278c3928cd9e43be719cea23328780ccc10a7`:** `ci-required` **success**, and
  every job passed.
  - `verify (3)` executed `job-accepted-event-seam.integration.test.ts` **(36 tests)**, which includes
    the 6 re-drive tests, `job-output-parity.integration.test.ts` **(20)** and
    `job-control-sweeper-pending-projections.test.ts` **(4)**.
  - `verify (1)` executed `job-audit-parity.integration.test.ts` **(13)**.
  - `verify (2)` executed `job-events.integration.test.ts` **(15)**.
- **Codex** (`chatgpt-codex-connector`) reviewed `a58278c`. It completed with no findings (a 👍
  reaction and no review comments).

## Post-review fix — Codex P2 ×2 on `37a9c72` (2026-09-21)

- **The findings.** Both were verified at source.
  - A `pending` seam receipt points at the **attempt** (`aggregateKind = 'job_attempts'`).
  - The fast paths of `recordAcceptedActivity` and `projectAcceptedOutput` returned any existing
    receipt as `replayed`, with its target as `activityId` / `outputId`. So a caller could be handed
    an attempt id as if it were an `activity_log` or `task_outputs` row.
  - JOB-016 had already fixed the same shape in the pricing wrapper.
- **The fix.** Commit `56313ae361ba2ea652e432cbf2e0cd0bdce6d2fb`.
  - Both fast paths now check the receipt's status. A `pending` receipt returns `status: "pending"`
    with a null id, and the receipt is left for the re-drive.
  - The change to the public outcome types is **additive**: the `status` union gains `pending`.
- **Tests.** One test per wrapper, `[JOB-017 Codex P2]`, in `job-audit-parity` and
  `job-output-parity`.
- **Mutations.**
  - **M15** removes the audit check and turns the audit test red (1 failed).
  - **M16** removes the output check and turns the output test red (1 failed).
- **Local GREEN.** The three focused files pass **71/71**. `tsc` passes.
- **Threads.** Both review threads were answered and resolved.
- **Citation.** The fix moved `drainFenceGuardDenial` in `job-output-bridge.ts` down 7 lines, so
  the DE-18 citation is re-pointed by symbol from `:508` to `:515`. The commit that carries it also
  carries this record, and the guard set passes there.
- **The previous addendum.** Its Codex line records the `a58278c` review. The `37a9c72` review then
  raised these two findings, so the reviewed revision moves to the head that carries this fix. CI
  for that head is cited in PR #560; this record is not rewritten for it.

## Independent review

**Reviewer:** M1 review-batch-3B independent reviewer (Claude Opus 5) — distinct from the JOB-017 build session and the planning session
**Reviewed revision:** `60aafb32ec6f8316f92079789cf8814f981f3ed3`
**Disposition:** `approved`
**Attempt:** 1

### Independent review — attempt 1

**Disposition: `approved`.** Reviewed at the `docs/replatform-program` tip (the merge of PR #565).
The code commit `f551565de`, the re-drive `dbf4628cf`, the citation re-point `a58278c39`, the
Codex-P2 fix `56313ae361ba2ea652e432cbf2e0cd0bdce6d2fb` and the record head `b5c84fd94` are all
ancestors of it.

- **The P2 fix, at source.** In `job-audit-bridge.ts` the fast path returns
  `{status: "pending", activityId: null, receiptId, hubAuditId: null}` when the existing receipt is
  `pending`; in `job-output-bridge.ts` it returns `{status: "pending", outputId: null}`. Only a
  non-pending receipt is reported `replayed` with its `targetAggregateId`. Both outcome unions gain
  `pending` additively. I checked the third wrapper as well: `projectTerminalWinner`'s fast path
  cannot hand back a wrong-kind id, because it returns `commentId` only when the receipt's
  `aggregateKind` is `issue_comments`. Both Codex findings were real and are fixed at the cause.
- **The retirement guard is not a blind scan.** The `[E3-D-TERMINAL-WINNER]` describe in
  `job-output-parity.integration.test.ts` strips comments before scanning, asserts zero production
  references outside `job-output-bridge.ts`, and its positive control requires the same scanner to
  see the method in the test tree AND to see `createAcceptedActivityAuditProjector` referenced from
  `job-events.ts`. A zero there is a measured zero.
- **Mutation reproduced by me, and reverted.** **M9**: appending a production reference to
  `projectTerminalWinner` in `job-events.ts` gives **1 failed** — *has ZERO production callers
  outside its own definition file* — with the positive-control arm still green. Restoring the file
  returns **2 passed**. The other fifteen rows I checked by reading the tests; each names a test
  whose assertion the mutation defeats.
- **Register.** `scripts/gate-clause-wiring.json` carries `E3-17-output`
  (`resolveAcceptedOutputProjector`) and `E3-audit-parity-bridge`
  (`createAcceptedActivityAuditProjector`), both `wired`, both retaining the prior unwired reason
  verbatim. `node scripts/check-gate-clause-wiring.mjs` is OK at the reviewed tip and neither clause
  appears on the dormant list.
- **F10 is real.** `[acc 5 / F10]` seeds two leased attempts under `TENANT_A` / `TENANT_B` with
  `COMPANY` / `COMPANY_B`, drives both through the real ingest, and partitions `activity_log`,
  `task_outputs` and the six projection receipts by Organization and Company. `[acc 5 / F10
  cross-tenant denial]`, `[F10] both cores refuse …` and `[re-drive F10]` each carry their own
  same-tenant control.
- **CI on the FINAL head, by job with executed counts.** The record defers this to PR #560 and does
  not restate it, so I measured it. Run `35613948895` (`pull_request`, headSha
  `b5c84fd94574d3c35a4aa69370b1cbab802101b9`, conclusion `success`); all sixteen jobs `success`,
  including `ci-required` `106387307109`. Per job:
  - `verify (3)` `106379861080`: `job-accepted-event-seam.integration.test.ts` **(36 tests)**,
    `job-output-parity.integration.test.ts` **(21 tests)** and
    `job-control-sweeper-pending-projections.test.ts` **(4 tests)**; shard 657 files passed, 4 skipped.
  - `verify (1)` `106379860991`: `job-audit-parity.integration.test.ts` **(14 tests)**.
  - `verify (2)` `106379860974`: `job-events.integration.test.ts` **(15 tests)**.

  The two `+1`s over the `a58278c` addendum's 20 and 13 are exactly the two `[JOB-017 Codex P2]`
  tests, one per wrapper. Locally, `job-output-parity.integration.test.ts` also collects 21 cases.
- **Codex.** On PR #560, `chatgpt-codex-connector` reported no major issues on `240c240593`,
  `a58278c392` and the final head `b5c84fd945`. Its two P2s on `37a9c72` are the ones fixed in
  `56313ae36`; both threads are answered and resolved.
- **The TDD deviation, judged.** The record states it plainly: cores, registrations and tests were
  written in one sitting, and the code was not held back until a failing run existed. What is
  genuine is the recorded RED — setting `job-events.ts` alone back to base `fc2eb7dde` reds
  `[acc 1 + acc 2 + acc 4]` (expected the two audit actions, received `[]`) and `[acc 1 stale]` at
  its live-fence positive control, which is precisely the task's own definition of RED. What that
  RED cannot show is that the ten seam-level cases would have failed against unwritten code, and the
  record says so rather than implying otherwise. The sixteen-row mutation table is the substitute,
  and each row names the specific case it reds. I reproduced one exactly.
  **Judgement: an acceptable substitution, recorded without overclaim.** It is weaker than test-first
  and should not become this programme's norm; a reviewer can only confirm that the substitute was
  actually run, which here it demonstrably was.
- **Acceptance items, against the record's own `Acceptance → test` table.**
  - 1, 2 and 3: evidenced, each through the real ingest and each with a named same-fence or
    live-fence positive control.
  - 4: evidenced by the scanner pair plus the REAL ingest case reading attempt `succeeded`, **0**
    `task_terminal` receipts and **0** `issue_comments`.
  - 5 (F10): evidenced, above.
  - 6 (positive control: either registration removed reds acceptance AND `check-gate-clause-wiring`
    reports zero callers): M1 and M2 state exactly that, and the register reason records why the
    cited symbol had to move from the factory to the registration for that count to be able to
    return to zero at all.
  - The residual the record itself declared — a `pending` `activity_audit` or `output_projection`
    receipt with no re-drive — is **closed** by the F2-ruled generalization, with six tests, four
    mutations and the bound shared with JOB-016's.
  Every acceptance item is met.
- **Not blocking, noted.**
  - The header's `Reviewed revision (code)` still names `f551565de`. The record's final section says
    the reviewed revision moves to the head that carries the P2 fix, and the record is append-only,
    so the header is stale by design rather than false — but a reader must reach the last section to
    learn which tree was actually reviewed.
  - The re-drive addendum's "the full guard set passes" at `dbf4628cf` was corrected by the record's
    own next section, which names the three DE-30 citations that were red and the `a58278c` fix.
    That correction is the right shape: it quotes the earlier claim instead of rewriting it.
  - The arm-2 `kind` question stays open with `CLI-014` / `CLI-015` / ruling F7. Arm 2 still reads 0
    on every real run because no worker emits `artifact_prepared` until `CLI-013`; I confirmed that
    independently in the keyed journey run `35619555883`, whose verifier reports
    `capabilityProven=false` with the arm-2 clause unmoved.

## Review attempt history

Later reviewers append rows with increasing attempt numbers without replacing earlier ones. Do not include a `Review commit` column: a row cannot embed the SHA of the commit that first contains it.

| Attempt | Reviewer | Reviewed revision | Disposition | Evidence/findings |
|---:|---|---|---|---|
| 1 | M1 review-batch-3B independent reviewer (Claude Opus 5) | `60aafb32ec` (program tip, the #565 merge) | `approved` | Both Codex P2s verified fixed at source (both fast paths return `pending` with a null id; the third wrapper cannot mis-type an id either). The retirement guard has a real positive control; **M9 reproduced** — 1 failed, then 2 passed once restored. Register: both clauses `wired`, checker OK, neither dormant. F10 real: two Organizations, six receipts partitioned, per-case same-tenant controls. CI measured on the FINAL head `b5c84fd945`, run `35613948895`, all sixteen jobs green — `verify (3)` 36 + 21 + 4, `verify (1)` 14, `verify (2)` 15; the two `+1`s are the P2 tests. Codex clean on the final head and both P2 threads resolved. TDD deviation judged: the recorded RED is genuine for the task's own definition of RED, the mutation table is an adequate substitute, and the record does not overclaim. Noted, non-blocking: the header's reviewed revision is stale relative to the record's own final section. |
