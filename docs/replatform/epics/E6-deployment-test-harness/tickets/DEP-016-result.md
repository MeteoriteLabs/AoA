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
| The verdicts' self-test | `scripts/lib/__tests__/m1-spine-assertions.test.mjs` (66 tests) | Each verdict has a zero-violation anchor and defect fixtures. Wired into `pr.yml` `policy` → *m1-spine profile verdict self-test (DEP-016)*, declared in `scripts/test-execution-census.json`. |
| The live profile | `tests/d1/m1-spine.test.mjs` (6 tests) + helpers in `tests/d1/lib/e6f-harness.mjs` (`seedSpineOrganization`, `seedSpineTarget`, `seedSpineJob`, `probeReplicaRollout`, `placeSpineAttemptOnReplica`, `querySpineAttempt`, `querySpineControl` — all additive) | The profile itself. |
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
| 1 | A passing profile run retains its evidence bundle | The job collects the bundle into `…/passing/` IMMEDIATELY after the passing profile and BEFORE either negative control (Codex: the controls share the live database, and the duplicate-usage control appends a second usage event and cost row per tenant, so a later bundle would describe the mutated state); a second collection under `…/post-controls/` runs `if: always()`, and the upload is `if: always()`. The profile writes `m1-spine-evidence.json` (per-replica rollout, crew and tool-surface posture; per tenant the ids, events, usage events, cost rows, receipts, audit rows and the criterion-5 record) into the uploaded directory |
| 2 | Per priced attempt: exactly one `cost_events` row with cost > 0 and one `authoritative_cost` receipt; the named audit rows present | `evaluateEnabledTenantSpine`, live: §3 GREEN |
| 2a | **Usage cardinality** (added 2026-09-23 — the `WRK-018` acceptance-1 collection point, see §7): per attempt, EXACTLY ONE accepted `usage` event in `job_events`, of this tenant, whose stored units are the ones the provider reported, and to which the single cost row is keyed | `evaluateEnabledTenantSpine` (`usage:*` codes), live: §3 |
| 3 | **Positive control:** the same profile with usage suppressed **reds**, and a DUPLICATE usage event **reds** | §4 row PC, and the lane step *POSITIVE CONTROL — with usage suppressed, the profile MUST go red* |
| 4a | **F10 isolation** (added 2026-09-23, Codex P1 — the plan's F10 requires *hostile cross-tenant cases in EVERY gate profile*, `docs/replatform/qa/2026-09-21-m1-execution-plan.md` §2 F10) | `evaluateCrossTenantIsolation`, live: §3a |
| 4 | **F10:** three Organizations — two enabled, one control; journey, audit and cost attribution asserted PER enabled tenant; the control tenant refused and left legacy. The rollout is set on BOTH replicas, identically, and the bundle records its digest | `evaluateReplicaRollout` + `evaluateControlTenant`, live: §3 |
| 6 | **The DEP-017 env probe, carried in** (added 2026-09-23) | **Second fork taken, with a tripwire** — §4b |
| O | **The Outcome's rollback rehearsal through the `MIG-009` CLI** (criterion 6) | §3c |
| 5a | **Tool surface off** on both replicas — the deployment flag AND every tenant's per-Organization `tools` opt-in (added 2026-09-23, Codex; M1 plan §6 freeze checklist) | `evaluateReplicaRollout` (`tools:*`); live: `toolSurfaceRaw: null`, `toolSurfaceArmed: false`, all three Organizations `false` on both replicas |
| 5 | **Crew switch off** on both replicas, recorded in the bundle | `evaluateReplicaRollout` (`crew:switch_on` / `crew:switch_unparseable`); live: `crewRaw: null`, `crewEnabled: false` on both replicas |

## 3. GREEN — the live run (local, real D1 stack)

★ **Re-run and rewritten 2026-09-23 after the placement and topology fixes (Codex P1).** The
superseded text described the run BEFORE them: it reported the enabled-path control as
`disposition: failed` / `invalid_placement_input` and two control-plane replicas, neither of which
the code in this commit would accept. Nothing below is carried over from it; every number here is
from the run of the CURRENT code.

Run against `docker-compose.d1.yml` + `docker/d1/m1-spine.override.yml` (the one-worker,
one-control-plane topology), with images built from this branch's tree (the server tree of the
branch base `dd839129b` is byte-identical to `d15b35c02`, the revision the control-plane image was
built from: `git diff d15b35c02 dd839129b -- server packages` is empty).

```
AOA_D1_LIVE=1 AOA_D1_CAMPAIGN=m1-spine node --test --test-concurrency=1 tests/d1/m1-spine.test.mjs
→ pass 6, fail 0
```

What the server wrote, from `m1-spine-evidence.json`:

| Tenant | accepted `usage` events | `cost_events` | `cost_cents` | idempotency key | receipts | audit rows |
|---|---|---|---|---|---|---|
| A (`0d016a00…`) | **1** | **1** | **81** | `cost:0d016a01…:42bd7a7e…` — that event | `authoritative_cost:applied` (targeting the cost row, keyed to that event), 2 × `activity_audit:applied` (each targeting its own activity row) | `job.attempt_started`, `job.attempt_terminal`, actor `system` / `worker:94771649…` |
| B (`0d016b00…`) | **1** | **1** | **81** | `cost:0d016b01…:d903393e…` — that event | same shape, under B's own tenant | same, actor `worker:12d6c16d…` |

- **81 cents is the derived expectation**, not an observation: 120 000/1e6 × 300 + 30 000/1e6 × 1500
  at `claude_local` / `claude-sonnet-4-6` / rate version 1, all four of which the verdict pins.
- Each row's `company_id` and `agent_id` are that tenant's own. The cost query matches on the key's
  EVENT half across **all** Companies, so a row written under the wrong Company is seen and judged.
- **The single control plane:** rollout sha256 `02cebb95542a…`, `deploymentEnabled: true`, A and B
  `canary`, C `off`, `crewRaw: null`, tool surface `armed: false` with no Organization opted in.
  `control-plane-b` is configured identically in the override (held byte-for-byte, per block, by the
  static check) and is not started.
- **Control tenant C:** the REAL placement service — composed on the running control plane exactly as
  `server/src/index.ts` composes it (its rollout source, deployment flag and mode, the production
  `resolveCanaryCredentialBinding`, over the non-owner `aoa_app` + operator pools) — decided
  `legacy` / `organization_disabled` / `leaseEligible false`; its worker's poll returned `no_work`;
  it has 0 `job_events`, 0 `cost_events`, 0 receipts, 0 leases.
- **The positive control for that refusal:** the SAME service, on an unplaced attempt of tenant A,
  returned **`disposition: "selected"`, `mode: "active"`, `leaseEligible: true`,
  `reasonCode: "target_selected"`** — a working enabled placement onto A's own
  `organization_dedicated` target. So the control tenant's refusal is the rollout's, and not
  "placement refuses everything".

### 3a. Hostile cross-tenant cases, live (F10 isolation — denied, not merely empty)

Against a FRESH, LIVE-fenced attempt of tenant A, with tenant B's real worker session and device key:

| Case | Result |
|---|---|
| **Same-tenant control, first:** A's own worker uploads a `usage` event onto its own lease | `200`, ack `accepted` — so everything below is demonstrably possible on this exact attempt and batch shape |
| B's worker uploads a `usage` event naming A's Organization, Company, job, lease and fence — with **B's own worker id** in the batch and its events, so the refusal cannot be an identity mismatch between session and batch (Codex P1); distinct seq, so it cannot be a sequence clash either | **`401 unauthorized`** — `"Worker control request denied"` |
| B's worker acknowledges A's lease | **`409 stale_fence`** |
| A's `job_events` read under **B's** tenant scope through the non-owner `aoa_app` pool with RLS | **0 rows**, while the same read under A's own scope returns **1** (the control that makes the 0 isolation, not a broken grant) |
| A's accepted `usage` events, before → after the hostile traffic | **1 → 1** — a foreign worker moved neither money nor usage |
| A's cost rows and accepted usage events, before → after the hostile traffic | **1 → 1** and **1 → 1**: the foreign worker moved neither money nor usage |

### 3c. The rollback rehearsal, live (MIG-009 — criterion 6)

The profile's last case seeds one fresh placed, un-leased attempt per enabled tenant and then runs
the **real operator CLI inside the control-plane container**, with that container's own owner DSN,
bounded `aoa_app`/`aoa_operator` pools and distributed flag:
`node /cp-app/dist/cli/drain-distributed-execution.js --operator m1-spine-<nonce>`.

| | Observed |
|---|---|
| CLI exit | **0** — its own contract: no Organization skipped, every cancel committed |
| Summary line | `organizationsScanned: 3`, `cancelled: 5`, `skippedCount: 0`, `failedCancellations: []`, `reason: distributed_execution_rollback`, `actorId: operator-cli:m1-spine-<nonce>` (the cancelled count is whatever was non-terminal at that moment; the assertions are per named job, never on that number) |
| Per tenant | each tenant's drainable attempt is **`cancelled`** in `job_attempts` after the drain — the EFFECT, asserted alongside the audit (Codex P1) — with exactly one `job.drain.requested` activity row for its own job, carrying that tenant's own Company and (in `details.organizationId`) its own Organization, attributed to the operator the CLI was given |
| Every attempt the drain could touch | the rehearsal takes a CENSUS of every non-terminal attempt of the three Organizations BEFORE the drain — not only the two it seeded — and judges each one. Measured on the last local run: **9 candidates, 5 of them LEASED**. The two branches differ and both are pinned: an **unleased** attempt is `cancelled` outright, a **LEASED** one goes to `cancel_requested` with a `cancel` command carrying `reason: distributed_execution_rollback` (its lease holder completes it; nothing on this lane does, which is why such an attempt legitimately accumulates one audit row per later drain — the verdict scopes rows to THIS drain's operator nonce) |
| Selectivity control | the two journey attempts, already `succeeded`, are **not** drained and carry no drain audit row — so a drain that cancelled everything indiscriminately could not pass as a rehearsal |

Measured while writing it: `activity_log.organization_id` is **null** on these rows — `MIG-009`
records the Organization in the row's `details`, and the verdict reads whichever the row carries.

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
| **P2** (second round) — one applied `authoritative_cost` receipt of the right tenant could name a DIFFERENT event and still pass, so replay/re-drive idempotency would be attached to the wrong event | True; `sourceIdentity` and `aggregateKind` were already returned and unchecked | `cost:receipt_not_keyed_to_event` and `cost:receipt_wrong_aggregate`. Live: the receipt reads `cost:<that tenant's company>:<that attempt's usage event id>`, aggregate `cost_events` |
| **P1** — the enabled-path control accepted any non-legacy placement (`queued`/`failed` included), so a regression where the real service can select NO target would leave the campaign green | True at source | Each tenant's journey target now carries `CANARY_EXECUTION_TARGET_SLUG`, the slug the production credential binding routes to, so the REAL placement service SELECTS it; the verdict requires `disposition: "selected"`, `mode: "active"`, `leaseEligible: true`. Live: exactly that. (The slug is a single per-Organization slot, so the seed retires a previous run's holder by renaming it, and only the journey target takes it.) |
| **P2** — every non-acceptance counted as a denial, so a 500 or a transport error would pass as enforcement | True | The expected refusals are pinned: `401 unauthorized` for the foreign upload, `409 stale_fence` for the foreign ack, with `isolation:foreign_*_not_denied` otherwise. Fixtures cover 500, a transport-shaped failure and a right-status/wrong-code response |
| **P1** — the job produced the gate artifact without the `MIG-009` rollback rehearsal the Outcome requires | True: no drain invocation existed anywhere in the profile or the lane | §3c — the real CLI, run in the control-plane container, with per-tenant audit attribution and a selectivity control |
| **P1** — the override still started `control-plane-b`, contradicting the one-control-plane topology `M1-D1-SPINE` names | True (`docs/replatform/epic-regrooming/scope-triage.md`) | `control-plane-b` moved into the excluded profile and out of `test-runner`'s dependencies; the live verdicts now run against the RUNNING control plane, while the static check still holds BOTH replica blocks to the identical rollout value (the S0-8 config claim, unchanged). A new `override:second_replica_not_excluded` code guards it |
| **P1** — the journey is driven by the harness, not by the deployed worker container | **True, and not fixable in this lane** — see §5.3, kept as a stated limitation and flagged for the planning session |
| **P1** (ninth round) — the rehearsal inspected only the two jobs it seeded, although the drain reported five cancellations; a regression on the leased branch, or a wrongly-cancelled control tenant, would have stayed green | True | The pre-drain CENSUS above. It also made the real semantics visible and pinned them: leased → `cancel_requested` + a cancel command, unleased → `cancelled`. Fixtures cover a leased attempt left running, a leased one jumping straight to `cancelled`, a missing command, a wrong command reason, and a stray command on an unleased attempt |
| **P1** (tenth round) — post-drain state was mapped by JOB, so one attempt could mask a sibling the drain left running (the drain's store deduplicates cancellation per job) | True | The probe returns `attempt_id`, and the verdict keys state per ATTEMPT; the terminal check reads every attempt of the job. Fixture: a job with a `cancelled` attempt and a `running` sibling reds |
| **P2** (tenth round) — the audit row's `reason` was never read, so a row recording no reason, or another one, would pass | True | The probe returns `details->>'reason'` and `rollback:audit_wrong_reason` requires `distributed_execution_rollback`. Live: every row carries it |
| **P2** (eleventh round) — cancel commands were grouped by JOB, so a stale command from an earlier lease could satisfy a leased candidate that had none of its own; and a census candidate's audit row was accepted with a non-`system` actor type | Both true | Commands are keyed per ATTEMPT (the probe returns `attempt_id` and `lease_id`), and the audit-row filter requires `actorType === "system"` for every candidate, not only the seeded pair. Fixtures: a command of another attempt of the same job, and a `user`-actor row |
| **P2** (twelfth round) — a cancel command on a PREVIOUS lease of the same attempt would satisfy the current lease holder, which an attempt can acquire after a re-lease | True | The census returns each leased candidate's ACTIVE lease id (scoped to that attempt) and `rollback:command_wrong_lease` requires the cancel command to target it. Live: the one leased candidate's command carries its active lease |
| **P1** (eleventh round) — the hostile upload carried the VICTIM's worker id, so the refusal was the session-vs-batch identity check rather than the tenant boundary | True | The batch and its events now carry the ATTACKER's worker id with the victim's Organization, Company, job, lease and fence. Live: still `401 unauthorized`, now from that boundary |
| **P2** (thirteenth round) — the lane's path filter did not name the PRODUCTION code the profile asserts, so a change to the ingest's pricing/audit registration, placement, the rollout source or the drain could land without refreshing the spine evidence | True | 16 named production paths added to the trigger (a named list rather than `server/**`: this lane runs ~45 minutes with `cancel-in-progress: false`, and the comment states that trade) |
| **P2** (thirteenth round) — only the pure self-test was in the execution census; the LIVE profile was not, and the plan's Files line requires it | True, and the cause was structural: the census walked only `scripts/` and `docker/` | `tests/` joined the census roots, so ALL 17 `tests/d1/*.test.mjs` are now declared. That in turn forced the D1 lane to **enumerate** the 12 E6F files it had been globbing (a glob names none of them, so their `runs` verdict was unverifiable), and gave `evidence-retention.test.mjs` — which nothing invoked — a real invocation in `pr.yml`. The census now discovers 92 files, 89 running |
| **P2** (eighth round) — `cost > 0` would pass a charge of 1 or 810 cents, although the units and the rate are both pinned and deterministically produce 81 | True | `cost:unexpected_amount` pins the EXACT charge, **derived** (`M1_SPINE_EXPECTED_COST_CENTS` = round(120 000/1e6 × 300 + 30 000/1e6 × 1500) = 81), plus `usage:units_not_canned` so the amount expectation cannot detach from the units the provider actually reported |
| **P2** (seventh round) — the config probe never read `AOA_DISTRIBUTED_TOOL_SURFACE_ENABLED`, which the M1a freeze checklist requires off | True (M1 plan §6: the freeze asserts the tools flag off and output not required) | The probe reads it through the server's own `readDistributedToolSurfaceFlag` (which throws on the legacy truthy spellings → reported as unparseable) AND each Organization's `tools` opt-in via `resolveOrganizationToolSurface`, since either alone is necessary-not-sufficient. Three verdict codes, three fixtures |
| **P2** (sixth round) — the first target fix compared the two SETS, which passes a SWAP (the `attempt_started` receipt targeting the terminal row and vice versa) | True, and a good catch on my own fix | Each receipt is now resolved through its OWN source event to the action its target row must carry, so a swap reds. The self-test fixture asserts the two sorted sets are identical before asserting the verdict reds |
| **P2** (fifth round) — a receipt's `target_aggregate_id` could point at an unrelated row, so the replay/re-drive evidence would claim a link that does not exist | True; the probe did not even return the field, nor the activity-row ids | The probe returns both; `cost:receipt_target_mismatch` requires the `authoritative_cost` receipt to target the one cost row, and `audit:receipt_target_mismatch` requires the two `activity_audit` receipts to target exactly this attempt's two activity rows |
| **P2** (fourth round) — a POSITIVE charge priced from another known model, provider or rate version would still pass | True; `provider`, `model`, `rateId` and `rateVersion` were returned and unchecked | `cost:wrong_rate_metadata` pins all four against the seeded agent config (`M1_SPINE_AGENT_ADAPTER_TYPE`, `M1_SPINE_AGENT_MODEL`) and `M1_SPINE_RATE_VERSION` — one constant, used by the seed AND the expectation, so a charge that names anything else means the resolver did not price from this agent. A re-price bumps `AUTHORITATIVE_RATE_VERSION` and this profile goes red until the campaign's expectation is updated with it, which is the intent |
| **P2** (third round) — the audit receipts were only counted, statused and tenant-checked, so two receipts keyed to unrelated events of the same job would pass while a named mutation had no replay guard | True; the same unchecked fields as the cost receipt | `audit:receipt_not_keyed_to_events` requires exactly `activity:<company>:<the accepted attempt_started event>` and `…:<the terminal event>`; `audit:receipt_wrong_aggregate` requires `activity_log` |
| **P2** — the audit verdict never inspected `actorType`/`actorId` | True; both were already returned | `audit:wrong_actor` requires `system` / `worker:<the leased worker>` |

## 4b. Acceptance 6 — the DEP-017 env probe, and criterion 5

Acceptance 6 was added to this ticket on 2026-09-23 (from `DEP-017`'s build, ratified by the planning
session under F2) and offers two forks: make the reference provider execute the probe command
faithfully, or **record that criterion 5 is observed only in the `DEP-015` lane**. Measured at source,
the second fork is the only honest one here, and the ticket's own wording anticipates it:

- The probe does not exist in this tree at all. `AOA_WORKER_ENV_PROBE`,
  `packages/worker-daemon/src/supervisor/env-probe.ts` and `evaluateEnvProbeEvidence`
  (`scripts/lib/m1-shipped-boot.mjs`) are on `DEP-017`'s unmerged branch; `grep` over this branch
  finds no occurrence of any of them. "The profile arms `AOA_WORKER_ENV_PROBE=1`" is not expressible
  here.
- Even with it, nothing would probe: the D1 workers do not dispatch
  (`AOA_WORKER_DISPATCH_ENABLED` is declared **ABSENT** for them — `scripts/lib/d1-dispatch-declared.mjs`,
  enforced by `check-d1-dispatch-declared`), this profile plays the worker over the real HTTP
  endpoints as every E6F suite does, and the reference provider's `execute`
  (`packages/sandbox-fake-provider/src/fake-driver.ts`) runs **no command** — it returns a terminal
  state, and now canned usage. A probe measures a process environment; there is no process.
- Making the fake "execute the probe command faithfully" would mean the fake reporting on the
  test-runner's own environment, which is not a distributed sandbox's. That is a fabricated pass of
  exactly the kind the acceptance forbids.

**So this profile records criterion 5 as NOT observed here, and makes that record self-policing.**
Per enabled tenant it reads the attempt's `log`-event messages and asserts none carries the DEP-017
summary prefix (`evaluateEnvProbeObservability`), writing
`criterion5EnvProbe: { observed: false, reason, logMessages: 0 }` into the retained bundle. The
verdict reds in **both** directions: a bundle that records the probe unobserved while a summary IS
present (someone armed it, or the lane gained a real executor) and a bundle that CLAIMS observation
with no summary. So the absence cannot silently become a stale pass, and criterion 5 for M1a rests
on the `DEP-015` shipped-boot lane, where `DEP-017` built it.

## 5. Deviations from the task section, measured

1. **The profile is a JOB, not a campaign scope** (§1, with the reason). The `m1-spine` scope value
   still exists as `AOA_D1_CAMPAIGN=m1-spine`, set by the job and REQUIRED by the test.
2. **`tests/d1/m1-spine.test.mjs` is not declared in `scripts/test-execution-census.json`.** The
   census only walks `scripts/` and `docker/` (`SEARCH_ROOTS` in `check-execution-census.mjs`), and
   no `tests/d1/*.test.mjs` file is declared there today. Adding an entry for a file the checker
   cannot discover would be a declaration nothing verifies. What IS declared is the pure self-test,
   which the census does walk. The live file's execution is pinned instead by
   `scripts/test-inventory.json` (`tests` 107 → 108) and by the workflow step that names it.
3. **The worker is the harness, not the daemon — and Codex is right that this bounds the claim.** As in every E6F suite, the profile plays the worker
   over the real `/worker-control/*` endpoints with genuine Ed25519 device proofs; no security check
   is weakened. The D1 workers do not dispatch (`AOA_WORKER_DISPATCH_ENABLED` is declared ABSENT for
   them — `scripts/lib/d1-dispatch-declared.mjs`), so there is no worker-executed path on this lane
   to use. The one real worker container (`worker-b`, the WRK-017 enrolling container) is what makes
   the topology one-worker.
   ★ **Stated plainly, because the gate definition says "one separately deployed worker":** a broken worker
   daemon or a broken usage-forwarding path in the daemon would NOT red this profile. What this
   profile proves is the CONTROL-PLANE half of the spine — placement, lease, fenced ingest,
   pricing, audit, isolation, drain — against a real stack with one worker container present and
   enrolled. The worker-executed half is what the `DEP-015` shipped-boot lane and `WRK-018`'s keyed
   acceptance prove. Making this lane worker-driven would mean arming
   `AOA_WORKER_DISPATCH_ENABLED` on D1 (declared ABSENT and guarded by
   `check-d1-dispatch-declared`) and giving the worker a provider-wire adapter-manager the D1
   compose does not have — a topology change beyond this ticket. **Flagged for the planning
   session:** if `M1-D1-SPINE` must include the worker-executed journey, that is a D1 topology
   ticket, not a line in this profile.
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
- `scripts/lib/__tests__/m1-spine-assertions.test.mjs`: **66/66**.
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
