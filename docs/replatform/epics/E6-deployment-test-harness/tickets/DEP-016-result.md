# DEP-016 — The `m1-spine` campaign profile on the D1 compose — result

**Status:** `gate_review`. Only a DISTINCT reviewer sets `complete`.
**Epic:** E6 · **Plan task:** `E6 implementation-plan §4c DEP-016` (as amended at M1 Step 0, S0-8) · **Milestone:** `M1a`
**Date (UTC):** `2026-09-23`
**Implementer:** Claude Opus 5 (M1 build agent)
**Start SHA:** `dd839129b` (`origin/docs/replatform-program`)
**PR:** #TBD (base `docs/replatform-program`)
**Owns:** finding **E3-F037** — **NOT resolved here.** See §7.

---

## 1. What shipped

| Piece | File | What it is |
|---|---|---|
| Canned usage on the reference provider | `packages/sandbox-fake-provider/src/fake-driver.ts` (`FAKE_PROVIDER_CANNED_USAGE_V1`, `FAKE_PROVIDER_USAGE_MODES`) | `execute` now reports fixed units (120 000 in / 30 000 out / 0 cached / 4 200 ms) that satisfy the frozen `usagePayloadV1Schema`. A provider id scripted `usageMode: "suppressed"` reports `usage: null`. An unknown mode is refused. `reset()` restores the default. Threaded through both control servers (`control-server.ts`, `docker/d1/fake-provider-entry.mjs`). |
| The one-worker topology | `docker/d1/m1-spine.override.yml` | A compose OVERRIDE, never an edit of the train: `worker-a` moves into a profile nothing enables, `test-runner`'s `depends_on` is `!override`-replaced, and the F10 rollout policy is set on BOTH control-plane replicas, identically. The crew switch is not set. |
| The tenant set + the verdicts | `scripts/lib/m1-spine-assertions.mjs` | `M1_SPINE_TENANTS` (two enabled Organizations, one control), `M1_SPINE_ROLLOUT_ENV_VALUE`, and four pure verdict functions: `evaluateSpineOverrideText`, `evaluateReplicaRollout`, `evaluateEnabledTenantSpine`, `evaluateControlTenant`. |
| The verdicts' self-test | `scripts/lib/__tests__/m1-spine-assertions.test.mjs` (39 tests) | Each verdict has a zero-violation anchor and defect fixtures. Wired into `pr.yml` `policy` → *m1-spine profile verdict self-test (DEP-016)*, declared in `scripts/test-execution-census.json`. |
| The live profile | `tests/d1/m1-spine.test.mjs` (5 tests) + helpers in `tests/d1/lib/e6f-harness.mjs` (`seedSpineOrganization`, `seedSpineTarget`, `seedSpineJob`, `probeReplicaRollout`, `placeSpineAttemptOnReplica`, `querySpineAttempt`, `querySpineControl` — all additive) | The profile itself. |
| The lane | `.github/workflows/d1-merge-train.yml` job **`m1-spine`** | Builds the split images, brings up the override, asserts exactly ONE worker service is running, runs the profile, runs the usage-suppressed POSITIVE CONTROL and fails the lane if it passes, collects the evidence bundle **`if: always()`** (on pass as well as on failure) and uploads it. New path triggers: `scripts/lib/m1-spine-assertions.mjs`, `packages/sandbox-fake-provider/**`. |

**Not a scope of `AOA_D1_CAMPAIGN` — a second job, deliberately.** The plan's §3 row names
`AOA_D1_CAMPAIGN=m1-spine`. The scope selector is single-valued, so a third value would DISPLACE
`foundation` on any run that selected it, and the profile would run only when someone edited a
committed file — the class of check that quietly stops running (the `campaign.env` block records
that same lesson for WRK-017). The topologies also differ (two workers vs one), which a single
bring-up cannot serve. The profile therefore runs on every trigger of the workflow, in its own job,
with `AOA_D1_CAMPAIGN=m1-spine` set as job env; the test REFUSES to run under any other campaign
value, so it can never be run against the two-worker train by accident. The existing
`bounded`/`foundation` scopes and the train job are untouched.

## 2. Acceptance → evidence

| # | Acceptance (E6 plan §4c) | Where it is proven |
|---|---|---|
| 1 | A passing profile run retains its evidence bundle | The `m1-spine` job's collect + upload steps are `if: always()`, and the profile writes `m1-spine-evidence.json` (per-replica rollout digests; per tenant the ids, event types, cost rows, receipts and audit rows) into the uploaded directory |
| 2 | Per priced attempt: exactly one `cost_events` row with cost > 0 and one `authoritative_cost` receipt; the named audit rows present | `evaluateEnabledTenantSpine`, live: §3 GREEN |
| 2a | **Usage cardinality** (added 2026-09-23 — the `WRK-018` acceptance-1 collection point, see §7): per attempt, EXACTLY ONE accepted `usage` event in `job_events`, of this tenant, whose stored units are the ones the provider reported, and to which the single cost row is keyed | `evaluateEnabledTenantSpine` (`usage:*` codes), live: §3 |
| 3 | **Positive control:** the same profile with usage suppressed **reds**, and a DUPLICATE usage event **reds** | §4 row PC, and the lane step *POSITIVE CONTROL — with usage suppressed, the profile MUST go red* |
| 4a | **F10 isolation** (added 2026-09-23, Codex P1 — the plan's F10 requires *hostile cross-tenant cases in EVERY gate profile*, `docs/replatform/qa/2026-09-21-m1-execution-plan.md` §2 F10) | `evaluateCrossTenantIsolation`, live: §3a |
| 4 | **F10:** three Organizations — two enabled, one control; journey, audit and cost attribution asserted PER enabled tenant; the control tenant refused and left legacy. The rollout is set on BOTH replicas, identically, and the bundle records its digest | `evaluateReplicaRollout` + `evaluateControlTenant`, live: §3 |
| 5 | **Crew switch off** on both replicas, recorded in the bundle | `evaluateReplicaRollout` (`crew:switch_on` / `crew:switch_unparseable`); live: `crewRaw: null`, `crewEnabled: false` on both replicas |

## 3. GREEN — the live run (local, real D1 stack)

Run on the reviewed code, against `docker-compose.d1.yml` + `docker/d1/m1-spine.override.yml`
brought up with images built from this branch's tree (the server tree of the branch base
`dd839129b` is byte-identical to `d15b35c02`, the revision the control-plane image was built from:
`git diff d15b35c02 dd839129b -- server packages` is empty).

```
AOA_D1_LIVE=1 AOA_D1_CAMPAIGN=m1-spine node --test --test-concurrency=1 tests/d1/m1-spine.test.mjs
→ pass 5, fail 0
```

What the server actually wrote, from `m1-spine-evidence.json`:

| Tenant | `cost_events` | `cost_cents` | model / provider | idempotency key | receipts | audit rows |
|---|---|---|---|---|---|---|
| A (`0d016a00…`) | **1** | **81** | `claude-sonnet-4-6` / `claude_local`, `rate_version` 1 | `cost:0d016a01…:a5eade20…` (the accepted `usage` event) | `authoritative_cost:applied`, 2 × `activity_audit:applied` (+ JOB-005's `attempt_started`/`attempt_terminal`) | `job.attempt_started`, `job.attempt_terminal`, actor `worker:602fc713…` |
| B (`0d016b00…`) | **1** | **81** | same | `cost:0d016b01…:8035233d…` | same | same, actor `worker:81451e6d…` |

- **Usage cardinality.** Each attempt has **exactly one** accepted `usage` event in `job_events`
  (A: `a7fe176a…` seq 2; B: `f7b5d7c2…` seq 2), each carrying its own tenant's
  `organization_id`/`company_id` and the stored units `{in 120000, out 30000, cached 0, ms 4200}` —
  byte-equal to the units the reference provider reported — and each tenant's single cost row is
  keyed to its own event (`cost:<that tenant's company>:<that event id>`), with the row's token
  columns equal to the stored units.
- Each row's `company_id` and `agent_id` are that tenant's own (`0d016a01…`/`0d016a02…` and
  `0d016b01…`/`0d016b02…`). The cost query matches on the key's EVENT half across **all** Companies,
  so a row written under the wrong Company would be seen and judged, not missed.
- Both replicas: rollout sha256 `02cebb95542abbd4…` (identical), `deploymentEnabled: true`,
  A and B resolve `canary`, C resolves `off`, `crewRaw: null` / `crewEnabled: false`.
- Control tenant C: the REAL placement service — composed on each replica exactly as
  `server/src/index.ts` composes it (that replica's rollout source, its deployment flag and mode, and
  the production `resolveCanaryCredentialBinding`, over the non-owner `aoa_app` + operator pools) —
  decided `legacy` / `organization_disabled` / `leaseEligible false` on **both** replicas; its worker's
  poll returned `no_work`; it has 0 `job_events`, 0 `cost_events`, 0 receipts, 0 leases. The positive
  control — the SAME service on tenant A's unplaced attempt — reached `disposition: failed`,
  `mode: active`, `reasonCode: invalid_placement_input`, i.e. a real non-legacy decision, so the
  refusal is the rollout's and not "placement refuses everything".

### 3a. Hostile cross-tenant cases, live (F10 isolation — denied, not merely empty)

Against a FRESH, LIVE-fenced attempt of tenant A, with tenant B's real worker session and device key:

| Case | Result |
|---|---|
| **Same-tenant control, first:** A's own worker uploads a `usage` event onto its own lease | `200`, ack `accepted` — so everything below is demonstrably possible on this exact attempt and batch shape |
| B's worker uploads a `usage` event naming A's Organization, Company, job, lease and fence (distinct seq, so a denial cannot be a sequence clash) | **`401 unauthorized`** — `"Worker control request denied"` |
| B's worker acknowledges A's lease | **`409 stale_fence`** |
| A's `job_events` read under **B's** tenant scope through the non-owner `aoa_app` pool with RLS | **0 rows**, while the same read under A's own scope returns **1** (the control that makes the 0 isolation, not a broken grant) |
| A's cost rows and accepted usage events, before → after the hostile traffic | **1 → 1** and **1 → 1**: the foreign worker moved neither money nor usage |

## 4. RED and the mutation table

Each row is a real run of the same test file against the same stack with ONE thing changed; every
one of them fails on the cost assertion and on nothing else (the journey, the audit rows and their
receipts still pass), and each was reverted afterwards.

| Row | The one thing changed | Result |
|---|---|---|
| **RED-1** | The reference provider image built **before** this ticket (no usage code at all) | `pass 2 / fail 2` — `cost:no_cost_row` + `cost:receipt_missing` for A and B; evidence shows `usage: null`, events `attempt_started,terminal` |
| **PC-1** (acceptance 3) | The shipped provider, scripted `usageMode: "suppressed"` | identical: `pass 2 / fail 2`, the same two cost codes plus `usage:no_usage_event` (0 accepted usage events), `usage: null` |
| **RED-2** | A control-plane image built with **`JOB-016`'s `createAcceptedUsagePricingProjector` registration removed** from `server/src/services/job-events.ts` | `pass 2 / fail 2` — and here the `usage` event **is** accepted (events `attempt_started,usage,terminal`) and the `activity_audit` receipts **are** written, yet there is still **no cost row and no `authoritative_cost` receipt**. This is what shows the assertion measures the pricing registration specifically, not merely the presence of a usage event |
| **PC-2** (acceptance 3, cardinality) | The worker sends a SECOND `usage` event for the same attempt with a DISTINCT event id (`AOA_M1_SPINE_USAGE_MODE=duplicate`) | `pass 2 / fail 2` — `usage:not_exactly_one` (2 accepted usage events) **and** `cost:not_exactly_one` (2 cost rows) + `cost:receipt_not_exactly_one` for both tenants. Two things this measured, both worth the reviewer's attention: the ingest's replay guard keys on the EVENT ID, so a distinct-id duplicate is accepted and priced again — which is exactly why a stored usage row cannot establish a cardinality claim; and the "exactly one" arms are shown to fail in the `> 1` direction, not only the `0` direction |
| **Codex P2a** | `cost:wrong_agent` — a row rolled up to another agent of the SAME Company | self-test fixture; the Company check alone stays green, which is the point |
| **Codex P2b** | `audit:wrong_actor` — an audit row with the right action and Company but a different worker, or a non-`system` actor | self-test fixtures |
| **F1–F4** | Four single-behaviour mutations of the canned-usage code (suppression ignored; no canned default; `reset()` keeps modes; unknown mode accepted) | each reds its named test in `packages/sandbox-fake-provider/src/__tests__/canned-usage.test.ts` (2, 2, 1, 1 failures) |

The verdict functions' own non-vacuity is `scripts/lib/__tests__/m1-spine-assertions.test.mjs`: 26
tests, each defect fixture flipping exactly one fact (no cost row, zero cost, two rows, a row under
another tenant's Company, a pending/duplicated/foreign receipt, a missing/duplicated/foreign audit
row, a control tenant placed distributed, a control refused for the wrong reason, a positive control
that is itself legacy or errored, a replica whose rollout differs, a replica with the crew switch on
or unparseable, an override that sets the rollout on only one replica / arms the crew switch / keeps
worker-a in the default profile).

**TDD order, stated.** The canned-usage tests were written first and run RED (4 failed / 1 passed
vacuously) before the provider code existed. The verdict self-test was written first and run RED
(module not found) before `m1-spine-assertions.mjs` existed. The LIVE profile was written before the
D1 runs, and its first two runs were red for real defects of my own (a `task_run` job whose executor
principal was not the assignee agent → the offer's envelope parse refused it with
`internal_unavailable`); it is the RED-1 / RED-2 / PC rows above, not a test-first run, that show the
live assertion can fail.

## 4a. Codex review findings on this PR, verified at source and fixed

| Finding | Verified | Fix |
|---|---|---|
| **P1** — the profile had no hostile cross-tenant case; F10 requires them in **every** gate profile | True. Read at source: the plan's F10 bullet *"Isolation: hostile cross-tenant cases in every gate profile … denied, not merely empty, and run through the non-owner `aoa_app` pool with RLS"*. The per-tenant loop only ever used matching identities, and the control tenant case only shows an un-enabled tenant gets no work | The new live case (§3a) + `evaluateCrossTenantIsolation`, with a same-tenant positive control for **every** denial. The full tenant matrix (secrets, staged inputs, outputs, tool calls, cancel) remains `DEP-018`'s |
| **P2** — the cost verdict checked only the Company, not the agent | True; `querySpineAttempt` already returned `agentId` | `cost:wrong_agent` compares every row's `agent_id` with the tenant's own agent |
| **P2** — the audit verdict never inspected `actorType`/`actorId` | True; both were already returned | `audit:wrong_actor` requires `system` / `worker:<the leased worker>` |

## 5. Deviations from the task section, measured

1. **The profile is a JOB, not a campaign scope** (§1, with the reason). The `m1-spine` scope value
   still exists as `AOA_D1_CAMPAIGN=m1-spine`, set by the job and REQUIRED by the test.
2. **`tests/d1/m1-spine.test.mjs` is not declared in `scripts/test-execution-census.json`.** The
   census only walks `scripts/` and `docker/` (`SEARCH_ROOTS` in `check-execution-census.mjs`), and
   no `tests/d1/*.test.mjs` file is declared there today. Adding an entry for a file the checker
   cannot discover would be a declaration nothing verifies. What IS declared is the pure self-test,
   which the census does walk. The live file's execution is pinned instead by
   `scripts/test-inventory.json` (`tests` 107 → 108) and by the workflow step that names it.
3. **The worker is the harness, not the daemon.** As in every E6F suite, the profile plays the worker
   over the real `/worker-control/*` endpoints with genuine Ed25519 device proofs; no security check
   is weakened. The D1 workers do not dispatch (`AOA_WORKER_DISPATCH_ENABLED` is declared ABSENT for
   them — `scripts/lib/d1-dispatch-declared.mjs`), so there is no worker-executed path on this lane
   to use. The one real worker container (`worker-b`, the WRK-017 enrolling container) is what makes
   the topology one-worker.
4. **The enabled tenants' attempts are placed by direct SQL**, as every E6F seed does; the REAL
   placement service is exercised for the control tenant and for the enabled-tenant positive control.
   The production gate that keeps a non-enabled Organization legacy — `resolveRunRolloutState` at the
   run seam — is asserted directly, per replica, through the server's own rollout source.
5. **The in-container probes read the container's environment**, which is the environment the
   replica's server process was started with; they do not read that process's memory.

## 6. Non-goals honoured

The fault matrix (`DEP-018`), real E2B, and the `foundation`/`bounded` scopes are untouched.

## 7. `E3-F037` — what is now delivered, and what remains

**Not resolved in this PR, deliberately.** This ticket's clause is delivered and proven (§3, §4):
a handed-off attempt through the REAL ingest writes exactly ONE `cost_events` row with cost > 0 and
one applied `authoritative_cost` receipt, per enabled tenant, attributed to that tenant, with a
usage-suppressed control that reds. The finding's closure conditions also require **`WRK-018`
acceptance 1** — the one keyed E2B run proving the real `claude_local` stream-json usage parser on
the deployed worker — and `WRK-018`'s own record states that run as PENDING (F8 envelope; the
planning session dispatches it). The spine's units are CANNED by construction, which is what keeps
this lane keyless and deterministic and is exactly why it cannot discharge the real-parser clause.

**This profile is also where `WRK-018` acceptance 1 is collected** (added 2026-09-23, from a Codex
P1 on PR #564 that the planning session accepted). That acceptance reads *"one real keyed run emits
**exactly one** `usage` equal to the result line"* — a CARDINALITY claim, and the keyed run's stored
`usage_json` row cannot establish it: a stored row cannot be told apart from a duplicate or a replay
of itself. A cardinality claim needs a counted population. This profile has one — the accepted
`usage` events of a single attempt, counted in `job_events` — and now asserts, per enabled tenant
under the F10 topology: exactly one such event (never `>= 1`), belonging to that tenant, whose
stored units equal the ones the provider reported, with the single cost row keyed to that event.
The **PC-2** run in §4 is its positive control, and it measured something the reviewer should carry
forward: a duplicate with a DISTINCT event id is accepted and priced again, because the ingest's
replay guard keys on the event id. So the chain is: this assertion establishes the cardinality half
on a keyless lane with canned units; `WRK-018` acceptance 1 still needs its one keyed run for the
REAL `claude_local` parser, and it stays PENDING.

`scripts/finding-ownership.json` therefore moves `E3-F037` from `owned` (`DEP-016`) to **`unowned`**,
with the full reason: this ticket has now filed a result record, so the guard would otherwise report
an open finding owned by shipped work, and the guard's `successor` field has no eligible ticket to
name — `WRK-018` has filed its own result, and `DEP-018` has a program-design node but no ticket file
on disk. Naming any other ticket would be the false-ownership claim `E4-F013` exists to refuse.
**For the planning session:** the honest ways to make it `owned` again are to file the ticket that
carries the keyed acceptance, or to record that run and close the finding. `E3-15-budget` stays
`unwired`, with a dated note recording what this ticket delivered.

## 8. Guards, typecheck, builds

- The full `pr.yml` pure-node guard set: **0 failures**, plus
  `check-evidence-immutability --base origin/docs/replatform-program` OK.
- `check-register-citation-integrity`: PASS after re-pointing the four `.github/workflows/pr.yml`
  citations my 8-line `policy`-job insertion moved (`:766→:776`, `:1599→:1611`, `:1118→:1130`),
  through the exact line map, anchor by anchor.
- `packages/sandbox-fake-provider`: `vitest run` **20/20**, `tsc --noEmit` clean;
  `packages/sandbox-provider-contract`: **22/22** (the fake is its reference driver).
- `scripts/lib/__tests__/m1-spine-assertions.test.mjs`: **39/39**.
- `scripts/test-inventory.json`: three pinned counts bumped (`packages/sandbox-fake-provider` 4 → 5,
  `scripts` 68 → 69, `tests` 107 → 108). `--write` also wanted to raise unrelated FLOOR counts; those
  were reverted, since they are other tickets' growth.

## 9. CI evidence

To be recorded, by job with its executed count, in an addendum once the PR's run on the reviewed
revision completes. This section is not rewritten.

## 10. CI evidence — addendum (2026-09-23): the run was REFUSED, not red

PR #566, head `9e49de33923a46c2836f8b4b379dca993de63977`.

- **`pr.yml` run `35796722874` concluded `failure` with ZERO steps executed in every job.** The
  check annotation states the cause: *"The job was not started because recent account payments have
  failed or your spending limit needs to be increased."* It is account-wide, not this branch's —
  every `pr.yml` run started in the same window failed identically (`claude/m1-wrk-013`
  `35796939537`, `claude/m1-cli-011-probe` `35796564516`, `claude/m1-dat-009-3e` `35796527264`,
  `claude/m1-dep-017-probe` `35796310711`, `claude/m1-keyed-evidence` `35796158394`). **No job of
  this PR has produced a verdict**, and a `failure` with no steps is not evidence about the code.
  `ci-required` must be re-run and seen green before this PR is merged.
- **Codex** (`chatgpt-codex-connector`) reviewed `9e49de3392`: *"Didn't find any major issues."*
- The local evidence in §3, §4 and §8 stands on its own: the live D1 runs and the whole pure guard
  set were executed on this tree, on a real stack, and the runs are named there.
