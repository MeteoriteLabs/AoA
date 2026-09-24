# Re-groom investigation — evidence surfaces (M1b–M5) and result-record state

**Date:** 2026-09-24 · **Measured at:** `3966a01f9f` (tip of `docs/replatform-program`)
**Status:** investigation + proposal. **Read-only.** This document changes no gate, no ticket, no
register and no `scope-triage.md` row. It is input to a planning-session ruling.

> **What this is not.** The milestone decomposition (`M0`→`M1a`→`M1b`→`M2`→`M2-RTF`→`M3`→`M4`→`M5`
> → E11 exit → merge to `main`) is not in question here and nothing below proposes re-cutting it.
> Two defects are investigated: criteria that demand evidence from a surface that does not exist,
> and result records that carry no machine-readable state.

---

## 0. Method, and what makes a claim here checkable

Every "does the surface exist" answer below comes from reading code or a register at this tip, not
from a plan, a design doc or a finding's own reachability claim. Claims are cited by **symbol**
(file + function/const/table), with a line only as a hint, because a register that cites bare lines
rots on the next commit.

A **surface** here is the thing evidence is *read off*: a log channel, a counter, a durable row, a
route, a harness that can be pointed at a topology. It is deliberately distinct from the
**property**. All four M1a precedents in §1.1 are cases where the property HELD and the surface was
missing, which is why they were only discovered at the gate.

Classification, used throughout:

| Class | Meaning |
|---|---|
| **EXISTS+EXERCISED** | the surface exists and something (test, harness, production caller) drives it |
| **EXISTS+UNEXERCISED** | the surface exists; nothing at the gate's scale or on the gate's path drives it |
| **DOES NOT EXIST** | no symbol, table, channel or harness at HEAD from which the criterion could be observed |
| **CANNOT TELL** | I could not settle it read-only, and I say why |

**`DOES NOT EXIST` is a claim about HEAD, not about difficulty.** Several of these are a day's work
(a resume-cursor field). Others are a milestone (a load generator). The class says only that a gate
owner arriving today has nothing to point a camera at.

---

## 1. The surface-availability table

### 1.1 The four M1a precedents, as worked examples

These are the measured cases this investigation generalises from. In each, the property held.

| Criterion | Evidence demanded | Surface that was missing | Class at the time |
|---|---|---|---|
| criterion 5 (`DEP-017`) | an env-absence probe observed per enabled tenant | the probe had never run on the real distributed stage-in path; only a keyed campaign could fire it | EXISTS+UNEXERCISED |
| `WRK-018` acceptance 1(b) | usage cardinality proven live | the optional stdout channel that carries usage was dropped (`E4-F019`) — `observeRun` composed `undefined` in `dispatch-runtime.ts` | DOES NOT EXIST (channel) |
| `M1-D1-SPINE` reconcile case | a fenced-lease arm of the startup reconciler | the reconciler is unreachable without a durable lease-candidate session to reconcile | EXISTS+UNEXERCISED |
| E5 clause 5 (redaction) | a planted canary observed scrubbed | the same dropped log channel — redaction works and is applied twice, and nothing could watch it happen | DOES NOT EXIST (channel) |

**The shared shape:** three of the four are a *channel* or a *driver*, not a behaviour. A criterion
that names an observation ("observed per tenant", "proven live", "observed scrubbed") silently
assumes a channel, and the channel is what gets dropped — because dropping it breaks no test.

### 1.2 `M1b`

`M1b` inherits every `M1a` criterion unchanged and adds criterion 4.

| Criterion | Surface its evidence must come from | Class | Evidence |
|---|---|---|---|
| 4 — useful-agent capability: attributable reviewable output reaching the founder | a founder-available readback route for a committed job artifact | **DOES NOT EXIST** | already measured by the planning session at `c6107c760c` as `E7-F047` (HIGH) and ticketed `CLI-018`. Re-confirmed here at this tip: `server/src/routes/worker-control.ts` is the only route reading `job_artifacts`, and its download path (`createArtifactTransferGrantService`) requires device-proof headers plus a signed raw body — **a founder/board session cannot satisfy it**. The projected `task_outputs` metadata carries `jobArtifactId` and **not** `objectKey`. |
| 1–3, 5–9 | as `M1a` | — | in flight under the M1a required-result set |

★ Criterion 4 is the *existing* worked example of this defect at `M1b`, and it was found the same
way the four in §1.1 were: at the gate. Everything below §1.3 is the attempt to find the rest
**before** their gates.

### 1.3 `M2` — sink cutover

Exit: *"for each cut-over sink: the distributed path owns the write, the **legacy path is provably
not reached**, and rollback is rehearsed"*, plus four register keys `wired` with real callers.

| Criterion | Surface | Class | Evidence |
|---|---|---|---|
| legacy-not-reached, **crew** (`MIG-006`) | three observable surfaces: the durable marker `buildCrewHandoffMarkerPatch` (`server/src/services/internal-agent/aoa-agents/crew-handoff-marker.ts`), the `distributedHandoff` field on `aoa-run-result.ts`, and the suppression return guarded by `shouldSuppressLegacyExecution` (`server/src/services/run-execution-owner.ts`) | **EXISTS+EXERCISED** | driven by `server/src/__tests__/crew-seam-suppression.test.ts`, which asserts `adapter.execute` was suppressed **and** the negative cases. This is the model the other two sinks lack. |
| legacy-not-reached, **Commander** (`MIG-005`) | none | **DOES NOT EXIST** | `shouldSuppressLegacyExecution` has exactly three call sites: heartbeat, the crew runner, and its own test. `server/src/services/internal-agent/cli-mode.ts` carries only *shadow observation* (`distributed-shadow-port.ts`, `job-shadow-comparator.ts`), which records intent and does not suppress or observe non-reach. Cutover exists as `MIG-005-cutover-design.md` and nothing else. |
| legacy-not-reached, **extraction** (`MIG-007`) | none | **DOES NOT EXIST** | same: `server/src/services/one-shot-sandbox-cli.ts` observes in shadow only. |
| `MIG-001` — Decision #117 target/credential routing cutover | none | **DOES NOT EXIST** | zero `.ts` files anywhere reference `MIG-001`; it is documentation-only, and disposition **X**. It is an *unconditional* E11 dependency per `epics/E11-hardening-release/README.md`, and `M2` schedules its filing at Step 0. |
| `E3-5-product-approval` → `wired` | `jobApprovalBridge` (`server/src/services/job-approval-bridge.ts`) | **EXISTS+UNEXERCISED** | register `scripts/gate-clause-wiring.json` records it `unwired`; zero production callers; its reason defers it to the sinks cutting over, i.e. to this milestone. Correctly ordered. |
| `E3-17-output`, `E3-audit-parity-bridge` → `wired` | `resolveAcceptedOutputProjector`, `createAcceptedActivityAuditProjector`, both on the `createJobEventIngestService` seam | **EXISTS+EXERCISED** | mounted only when `distributedExecutionEnabled`. |
| `E10-1-drain` → `wired` | `createDistributedExecutionDrain` / `drainAll`, driven by `runDistributedExecutionDrainTrigger` and the CLI `server/src/cli/drain-distributed-execution.ts` | **EXISTS+EXERCISED** | ★ **and the E10 implementation plan is stale about this** — three passages still assert `E10-1-drain` is dormant with zero `drainAll` callers. The register at HEAD says `wired`. Recorded, not fixed (this pass changes no register). |

★ **The `M2` finding worth ruling on:** the exit clause is written once, for "each cut-over sink",
as if the sinks were symmetric. They are not. One of the three has a suppression seam with a
behavioural test; two have shadow observation, which is **the opposite** — shadow records that the
legacy path *was* reached and what the distributed path *would* have done. An `M2` planner reading
the exit clause today would find one sink provable and two with no instrument at all.

### 1.4 `M2-RTF` — `E10-REALTIME-FOUNDATION`

The gate is *passable today* by ticket dependency (`JOB-005`, `DEP-009`, `MIG-003` all carry
results) and **unpassed** — zero QA records anywhere reference it and no `e10-realtime-foundation`
handoff exists (RTF-07). Surface-wise:

| Criterion | Surface | Class | Evidence |
|---|---|---|---|
| RTF-01 two interchangeable replicas authorize by Org **and** Company | `authorizeUpgrade` / `enforceLiveEventSocketAuthorization` (`server/src/realtime/live-events-ws.ts`); replica-independent by construction (pure DB-membership predicate, shared-Postgres cursor) | **EXISTS+UNEXERCISED** | the only two-replica exercise is `tests/d1/e6f-13-realtime-fanout.test.mjs`, which is store-level and **states in its own header that it does not exercise the WS leg on replica B**. The authorization-on-both-replicas claim has no driver. |
| RTF-02 ≥10,000 events / 2 Orgs / 100 gaps / 100 duplicate injections | `liveEventLog` + `liveEventSequences` (`packages/db/src/schema/live_event_log.ts`), `createLiveEventLogStore`, `SocketSeqCursor` / `orderReplayBuffer` (`live-event-catchup.ts`), dedup via `orgEventUq` + `wasLocallyPublished` | **EXISTS+UNEXERCISED** | exercised only at unit scale against `InMemoryLiveEventLogStore`. No volume harness exists. ★ Also a **contract mismatch to rule on**: the sequence is **per-company contiguous**, and RTF-02 says *"one monotonic source sequence/cursor"*. Those are not the same claim. |
| RTF-03 15-minute **broker** outage | there is **no broker** — the substrate is Postgres `LISTEN/NOTIFY` plus a safety poll (`attachLiveEventBrokerListener`) | **EXISTS+UNEXERCISED**, and the clause is mis-worded | NOTIFY-drop recovery is proven small-scale (`live-events-broker.test.ts`; `e6f-13` test 2). A "15-minute broker outage" is not expressible against this substrate without restating it as a NOTIFY-suppression window. |
| RTF-04 backpressure returns an explicit snapshot-required response **whose snapshot and resume cursor are consistent** | `needsSnapshotFallback`, `buildSnapshotResumeFrame`, `resolveBackpressure` (`live-event-catchup.ts`), production callers in `live-events-ws.ts` | **partly DOES NOT EXIST** | the frame is `{type:"__resume",payload:{resume:"snapshot"}}` and carries **no resume-cursor field** — the client refetches blanket. The clause's consistency half has nothing to read. This is the cheapest DNE in the whole table. |
| RTF-05 control ACK durable/idempotent vs presence ephemeral | presence: `ThreadPresenceStore` / `touchAuthorizedThreadPresence`, excluded from the durable log by `isDurableEligible`; ACK: `createJobEventIngestService` / `acceptEvent` | **CANNOT TELL** | both halves exist and are separately exercised. I found no test or harness that exercises the *contrast* — that presence cannot be used as execution authority — as one claim, which is what RTF-05 asserts. |
| RTF-06 payload **and metadata** redaction against a secret-canary corpus | none | **DOES NOT EXIST** | searched `canary corpus`, `secret canary`, `canaryCorpus`, `CANARY_`, `corpus` across `server`, `packages`, `scripts`, `tests`. Every `canary*` symbol is E7 canary-*run* machinery (`canary-credential-binding.ts`, `canary-mint-authority.ts`) — unrelated. Redaction modules exist (`server/src/redaction.ts`, `log-redaction.ts`) and **none references the live-event path**; realtime's redaction argument is structural instead (`buildDurableNotifyPayload` emits a data-free `{companyId,seq}`). A structural argument is a good design and it is **not an observation**, which is exactly the E5-clause-5 shape from §1.1. |

### 1.5 `M3` — full D3 + full D4

**D3 — browser.**

| Criterion | Surface | Class | Evidence |
|---|---|---|---|
| D3-01 ≥100 journeys | a way to run one at all | **DOES NOT EXIST** | `packages/browser-runtime` has **zero importers** in the tree (only its own `src`, `vitest.config.ts`, a `Dockerfile` COPY, and four JSON manifests). Its entry point `runnerMain`/`runFromConfig` is spawned by nothing. Independently, `workload.browser_session` is filtered out of the worker hello by `deriveHelloProvisioning` against `SUPERVISABLE_WORKLOAD_CAPABILITIES = ["workload.batch","workload.service"]` (`packages/worker-daemon/src/enrollment/hello-provisioning.ts`). Slots and classification exist (`WORKLOAD_CLASSES`, `browserSessionSlots`); a supervisor does not. **Both blockers are already named in `scope-triage.md` M3; this confirms them at HEAD.** |
| D3-02 approval allow/deny/**timeout** | `awaitApprovalDecision`, `classifyBrowserPermissionDecision`, refusal `timed_out` (`packages/browser-runtime/src/approval.ts`) | **EXISTS+UNEXERCISED end-to-end** | unit-tested; the production resolver is `inertRefusingResolver`, which returns `deny` unconditionally, and `SessionConfig.requireApproval` defaults off — because no control-plane hop delivers a decision. The **allow** path cannot be observed. |
| D3-02 reconnect catch-up (session-scoped) | none | **DOES NOT EXIST** | the only `sinceSeq` catch-up is discussions, unrelated. |
| D3-02 upload policy | none | **DOES NOT EXIST** | `SessionStep.action` is the single literal `"navigate"`; `BrowserApprovalAction` is `"navigate" \| "download"`. |
| D3-02 cancellation (browser-scoped) | none | **DOES NOT EXIST** | `runBrowserSession` takes no abort signal. Job-level `cooperativeCancel` exists and is a different grain. |
| D3-02 credential rotation / revocation | none | **DOES NOT EXIST** | `browser_cookie_state` / `browser_storage_state` are declared `ARTIFACT_KINDS` with no rotation consumer. |
| D3-02 private/metadata denial | host-side only (`egress-policy.ts`, `outbound-url-guard.ts`, `w10c-internal-range-deny-set.ts`) | **DOES NOT EXIST** in the browser session | none is reachable from `runBrowserSession`; `navigationTarget(url)` consults no deny-set. |
| D3-02 download; D3-03 no CDP/control endpoint | `safeDownloadName`/`resolveUnderRoot`; `checkBrowserLaunchSafety` + `readListeningPorts`/`listeningPortDelta` with a before/after `measurePorts` that fails `port_opened` | **EXISTS+EXERCISED** | with a meta-guard `scripts/check-browser-suite-executed.mjs` proving the real-Chromium lane ran. ★ The D3-03 wording is *"zero public or **cross-tenant** CDP endpoints"*; what exists is **guest-local**. No fleet enumeration exists. |
| D3-04 zero secret values in events/logs | `createRunSecretExportScanner` (`packages/sandbox-e2b-provider/src/export-secret-scan.ts`) | **DOES NOT EXIST** for browser artifacts | its own header says literal-value only, on exported file bytes, and *"IT IS NOT A LOG REDACTOR"*. Its single production wiring is the adapter-manager boot. It never sees browser events or logs, and browser-runtime has no export path through it. No cookie/token/storage-state canary corpus exists. |
| D3-06 ordered by event sequence | digest exists (`artifactManifestV1Schema.sha256`, finalize superRefine, `job_artifacts.sha256`) | **ordering DOES NOT EXIST** | `job_artifacts` has **no sequence column**, nothing joins an artifact row to the `job_events.sequence` that produced it, and `browser-runtime` emits no sequenced event at all. |

**D4 — service, and the availability SLI contract.**

| Criterion | Surface | Class | Evidence |
|---|---|---|---|
| **SLI-00 frozen schedule + schedule-manifest hash** | none | **DOES NOT EXIST** | see below |
| **SLI-01 per-UTC-minute sampler** | none | **DOES NOT EXIST** | see below |
| **SLI-04 reconstruct numerator/denominator from retained evidence** | none | **DOES NOT EXIST** | see below |
| D4-06 availability ≥99.5% | depends entirely on the above | **DOES NOT EXIST** | |
| D4-01 72 consecutive wall-clock hours | a service that can live that long | **DOES NOT EXIST** | E2B TTL is **set-once**: `e2b-provider.ts` passes `timeoutMs` at create and calls `setTimeout(sandboxId, ttlMs)` once as a belt-and-braces; that create-time line is the transport's **only** production caller and nothing extends it later. Worker-side, the owned-labels capability is minted with a 5-minute TTL on one route and **never re-minted**, capping a service at `RUN_OP_DEADLINE_CEILING_MS` (240 s). `SVC-009` slice b1 is shipped-but-inert (`job-fencing.ts` re-mint) and **b2 is not built**. E9's own plan files this as `E9-F002` HIGH, *"Blocks D4-01 outright"*. |
| D4-02 fault schedule (2 CP restarts, 2 worker restarts, partition, drain, generation update, checkpoint restore, budget/TTL stop) | `scripts/check-campaign-fault-matrix.mjs` + `scripts/lib/campaign-fault-matrix.mjs`, declaration `tests/d1/fault-matrix.json` | **EXISTS, wrong profile** | the checker is a real declaration-and-evidence judge with non-vacuity reds, but its profiles are `M1-D1-SPINE` / `M1a-D2-MECHANISM` / `M1-D2-CODING`. **There is no D4 profile**, and the checker does not itself inject — it judges evidence that injection fired. |
| D4-09 checkpoint hash / service ID / generation match before restore | identity half: `service_generations` with `service_generations_service_generation_uq` | **hash half DOES NOT EXIST; restore DOES NOT EXIST** | `checkpointArtifactId` is a restore **input pointer only**; `job-control.ts` states in situ that *"nothing restores a checkpoint (SVC-004)"* and `checkpoint` is omitted from the frozen command kinds, so a checkpoint request cannot even be expressed. No `checkpointHash` symbol anywhere. |
| D4-10 budget/TTL stop not overridable by worker | budget half declared (`job-approval-bridge.ts` `budget_stop`, folded into the `cancelRequested` floor) | **CANNOT TELL / TTL half DOES NOT EXIST** | `job-control.ts` states *"Nothing enforces a TTL (SVC-005)"*, and generations are created with `ttlSeconds` NULL. No symbol refuses a worker-side override, and no test is named for it. |
| D4-03/04 single authority, post-fence denial | `guardActiveFence` / `classifyFence` | **EXISTS+EXERCISED** | |
| D4-05 health never extends lease | the health projection path in `job-control.ts`, with `lease-truth.ts` deliberately refusing to consult the expiry deadline | **EXISTS+EXERCISED** | named test `★ T6 — a health projection does not extend the lease` in `service-health-projection.integration.test.ts`. This is the best-instrumented clause in D4 and shows the standard is reachable. |

★★★ **The SLI void is the single most consequential finding in this document.** A whole-tree search
over `*.ts`/`*.mjs`/`*.js`/`*.sql`/`*.py`/`*.sh` for `schedule.?manifest`, `scheduledTimestamp`,
`scheduled_timestamp`, `availabilitySli`, `sliSample`, `syntheticProbe`, `perMinuteSample` returns
**zero hits**, and `scripts/` contains no `probe-*`, `sample-*`, `sli-*` or `availability-*` script.
The availability SLI contract exists **only as prose in `test-gates.md`**. It is normative for
**D4-06 (M3)** and **D6-02/SLI-02 (M5)**, so one missing surface gates two milestones — and it is
the class the M1a precedents taught: a criterion phrased as an observation, with no channel.

### 1.6 `M4` — full D5

| Criterion | Surface | Class | Evidence |
|---|---|---|---|
| D5-00 ≥2 CP replicas, ≥4 workers, 2 failure domains, external stores | `docker-compose.staging.yml` — `control-plane` + `control-plane-b` in `domain-a`/`domain-b`, four workers at `replicas: 2`, external endpoints injected, `/run/secrets/*` mounts | **EXISTS+UNEXERCISED** | statically checked by `scripts/check-staging-manifest.mjs` + `scripts/lib/staging-manifest-invariants.mjs` in the always-on `policy` lane, and rendered by `tests/d1/e6f-12-staging-render.test.mjs`. Its own header says it is *additive and dormant*, brought up by no CI lane. **A verified manifest, not a deployment that runs.** |
| D5-00 **production load balancer** | none | **DOES NOT EXIST** | no nginx/haproxy/traefik/caddy/ingress service anywhere; no terraform (`*.tf`: none) and no k8s manifests. Nothing sits in front of the two replicas, so "behind the production load balancer" has no referent. |
| D5-HA01 replica loss preserves correctness | `tests/d1/e6f-11-two-replica.test.mjs` | **EXISTS+EXERCISED** | ★ with its own header caveat: the harness plays the worker, so a green run is evidence about the control plane only. |
| D5-HA02 failover RTO ≤60 s, RPO = 0 | none | **DOES NOT EXIST** | a whole-tree search for `\brto\b|\brpo\b|failover` returns three incidental prose hits. `e6f-11` has no clock, no 60-second budget, no RPO assertion. |
| D5-HA03 **non-identical** N/N-1 producer/consumer | the *shape* exists — `scripts/freeze-worker-protocol-consumer.mjs`, `check-frozen-worker-protocol-consumer.mjs`, fixtures at `tests/fixtures/worker-protocol-consumers/v1/`, plus the staging `update_config.parallelism` invariant | **identical baseline EXISTS+EXERCISED; non-identical DOES NOT EXIST** | `packages/worker-protocol/src/cross-version.test.ts` states the position itself: these run identical builds today. There is no second, genuinely different protocol build to test against. |
| D5-L01 20 Orgs / 2,000 queued / 100 leases / 10,000 ev·min⁻¹ / 60 min | none | **DOES NOT EXIST** | |
| D5-L02/L03 noisy tenant + fairness | none | **DOES NOT EXIST** | no `fairness` or noisy-tenant symbol anywhere |
| D5-L04 API 5xx rate ≤0.1% | none as a *rate* | **DOES NOT EXIST** | 5xx appears only as per-request classification assertions |
| D5-L05 submit / lease-poll / event-ACK p95 | none for those endpoints | **DOES NOT EXIST** | the repo's only two `percentile()` implementations are both E3-PERF-01 (`job-leasing-load.integration.test.ts`, `scripts/run-e3-perf-01.mjs`) and measure **single-tenant SQL claim latency**, not API endpoints |
| D5-L06 quota accounting under load | `admitAttemptCapacity`, the quota integration suites | **EXISTS+EXERCISED as an invariant; unexercised under load** | correctness proven, accounting-under-load not |
| D5-DR04/05 object integrity + quarantine | `classifyObject` / `evaluateRecoveredManifestReconciliation` / `runManifestReconciliation` (`server/src/services/disaster-recovery/manifest-reconciliation.ts`), reusing the frozen `QUARANTINE_REASONS` | **EXISTS+UNEXERCISED in production** | genuinely good: dispositions cover exactly the injection classes D5-DR04 names, `hash_unverifiable` is never `verified`, and the test carries a stated positive control. **Its only caller is its own test** — the real invocation lives in a human runbook step. |
| D5-DR02/DR03 RPO ≤15 min, RTO ≤4 h | none | **DOES NOT EXIST** | no timing instrumentation on backup age or restore duration |
| D5-DR01 same-candidate coupling of DB restore and object reconciliation | `cli/src/commands/db-restore.ts` (`dbRestoreCommand`) exists; the coupling does not | **CANNOT TELL / runbook-only** | |
| D5-DR06 restored state rejects pre-restore stale fences | `dr-stale-fence-after-restore.integration.test.ts` driving the **real wired** `guardActiveFence` via `acceptEvent` on embedded PG | **EXISTS+EXERCISED** | strongest item in D5 |
| D5-DR07 re-enrollment / revocation after restore | `advanceTargetGeneration`, `revokeExecutionTarget`, `revokeTargetAuthority` driven by `dr-reenroll-revoke.integration.test.ts` | **EXISTS+EXERCISED** | |

★ **D5-L is not partially built — there is no load generator in the repository at all** (no k6,
artillery or autocannon dependency; no soak/throughput/rps harness). And the E11 exit gate names
*"load/fairness"* among the gates that must pass, so **the E11 exit gate is unsatisfiable today
regardless of who writes `REL-001`.** That is a finish-line dependency discovered here, not at M5.

### 1.7 `M5` — full D6 → E11 exit → merge to `main`

| Criterion | Surface | Class | Evidence |
|---|---|---|---|
| D6-02 golden-journey probe ≥1 / 5 min / workload | none | **DOES NOT EXIST** | generic scheduling exists (`server/src/services/cron.ts`); nothing schedules workload probes |
| D6-03 per-workload floors (100 coding / 50 browser / 72 service-hours) | none | **DOES NOT EXIST** | no counter, no accumulator |
| D6-04 immutable support-matrix row IDs, ≥200 probes per row, separate fail-closed denial probes | none | **DOES NOT EXIST** | no schema table, no JSON registry, no checker. The rich denial-vector machinery that exists (`check-campaign-fault-matrix.mjs`, `check-egress-policy-vectors.mjs`, `check-cross-tenant-suppression.mjs`) is keyed to **D1 gate profiles**, not to D6 matrix rows, and has no availability numerator to be excluded from. |
| D6-05 mobility closure | none | **DOES NOT EXIST** | `MIG-004` is docs-only (confirmed: no `.ts`/`.tsx`/`.mjs`/`.sql` file mentions it), and the *concept* is absent too — zero hits for `mobility` or `fenced_restart`; every `handoff` hit is an unrelated homonym. ★ Note the trap: the `disabled` branch requires *"same-candidate **negative evidence** proves no route can advertise or invoke mobility"*. **Absence of code is not committed negative evidence**, and there is no flag or route to observe the absence against. |
| D6-06 partner legal/data-handling checklist | none | **DOES NOT EXIST** | `docs/replatform/templates/` holds exactly four templates (decision, handoff, qa-result, ticket-result). No partner template, no per-partner record surface, and no access control over one — which D6-06 requires. |
| D6-09 kill rehearsal | `execution-kill-switches.ts` (`KILL_SWITCH_DIMENSIONS`, `buildKillSwitchDocument`, `evaluateKillSwitches`), `instance_settings.kill_switches` column, operator routes with attributed audit (`instance.kill_switches_set`) | **EXISTS+EXERCISED** | production consumer confirmed at lease time in `server/src/services/job-leasing.ts`. Fail-closed on a malformed document; permissive on an absent one. |
| D6-10 new scheduling stops ≤60 s; work drained ≤60 min | the mechanism exists; the **clock** does not | **DOES NOT EXIST** | nothing measures stop latency and nothing bounds the drain |
| D6-11 tenant cutover + rollback **with active work** | each component exists and is exercised (drain + its trigger + CLI; seven cutover/rollback test files; `rollback-completeness.ts` with `REAL_REVERT_ACTIONS`) | **EXISTS+UNEXERCISED as the conjunction** | no test performs cutover *and* rollback *with work in flight* |
| M5 exit — remove the `cross-platform-weekly.yml@main` block and read a `success` run | `scripts/workflow-verdict-manifest.json` `blocked {on, owner, reason}` + `scripts/lib/workflow-verdict.mjs` (`WATCH_MODES`, validator refusing a block on a `not-watched` stream) | **EXISTS+EXERCISED, structurally unreadable until the merge** | correct by design: `cadence` streams fire only from the default branch, so this verdict is a property of `main` and no program-branch work can move it. Listed here so nobody plans around it. |
| E11 exit gate | prose in `epics/E11-hardening-release/README.md` | **EXISTS as prose, no machine-checkable form** | and it names load/fairness — see §1.6 |

### 1.8 Roll-up

**33 criteria across M1b–M5 have no evidence surface at HEAD.** By milestone: M1b 1 · M2 3 ·
M2-RTF 2 · M3 18 · M4 9 (M3/M4 overlap on the SLI cluster is counted once, in M3). A further ~14
are EXISTS+UNEXERCISED and 4 are CANNOT TELL.

**The worst three, by how much they gate:**

1. **The availability SLI sampler, schedule manifest and sample record (SLI-00/01/04).** Zero
   implementation of any kind. Gates D4-06 (M3) and SLI-02/D6-02 (M5) — two milestones, one void.
2. **The D5-L load and fairness harness (L01–L05).** No load generator exists in the repository.
   Gates M4 **and**, through the E11 exit gate's own wording, the finish line.
3. **Browser-session reachability (D3-01, and with it all of D3-02).** `packages/browser-runtime`
   has zero importers and `workload.browser_session` is filtered out of the hello by
   `deriveHelloProvisioning`. There is no surface on which a journey can be observed because there
   is no way to run one.

Honourable mention, because it is the cheapest: **RTF-04's resume cursor** — the snapshot-required
frame exists and simply omits the field the clause reads.

---

## 2. The record-state census

### 2.1 Totals, measured at `3966a01f9f`

**177** `*-result.md` files under `docs/replatform/epics/*/tickets/`.

| Bucket | Count | How measured |
|---|---|---|
| machine-readable `**Status:** \`complete\`` or `\`gate_review\`` | **77** | `grep -E '^\*\*Status:\*\* \`(complete\|gate_review)\`'` |
| a line-anchored `**Status:**` field, but **prose** (`✅ complete`, `COMPLETE — CI GREEN`, `SHIPPED`, `PARTIAL`) | **46** | `grep -E '^\*\*Status:\*\*'`, fails the pattern above |
| **no line-anchored `**Status:**` field at all** | **54** | |

★ *Corrected 2026-09-24 (Codex P2, PR #601), verified at source. **Superseded text:** "179 …
**79** … **64** … **36**", with a parenthetical claiming the two-file delta was M1a work that had
landed since. **That was wrong in both halves.** The two extra files are
`epics/E3-job-control/prerequisites/{E1-frozen-checker-correction,E2-serving-role-correction}-result.md`
— outside the declared `tickets/` scope, not newer — and my prose/no-status split used an
unanchored `**Status` match, which counts the word appearing anywhere in a file, including inside a
clause table. Both corrected figures are reproduced above.*

★ **The split is measure-dependent and the counts here are not robust; the 100 is.** An unanchored
match gives 70/30 and a line-anchored `^**Status` without the colon gives 52/48, against 46/54 for
the strict form used above. **The number that matters — 100 records carrying no machine-readable
status — is identical under all three measures**, and so is the per-epic distribution below, which
is why the classification in §2.2 is unaffected by this correction. Both excluded prerequisites
files carry a machine-readable status, so the classified set is exactly the same 100 files.

Per-epic, non-machine-readable: `E3` 11 · `E4` 11 · `E5` 16 · `E6` 10 · `E7` 13 ·
`E8` 11 · `E9` 8 · `E10-desktop` 7 · `E10-desktop-migration-realtime` 6 · `E11` 7 = **100**.

### 2.2 What state those 100 records are actually in

Classified by reading each record's header, `**Status:**` line where present, self-disclaiming
vocabulary, and evidence density (a landed SHA, a CI run id with a conclusion, named suites with
counts):

| Class | Count | Meaning |
|---|---|---|
| **(a) genuinely complete but pre-discipline** | **42** | asserts completion with concrete, still-checkable evidence and disclaims nothing. *A claim about code that can still be checked.* |
| **(b) genuinely incomplete / self-disclaiming** | **46** | the record itself says partial, inert, unwired, shadow-only, blocked, "stays OPEN", "not an end-to-end cutover" |
| **(c) unknowable without re-measurement** | **12** | asserts something but pins no verifiable anchor, or its evidence is an expiring CI artifact or a transient environment. *No longer verifiable from the record.* |

Per epic — (a) / (b) / (c): E3 7/4/0 · E4 3/8/0 · E5 4/7/5 · E6 3/4/3 · E7 5/7/1 ·
E8 8/1/2 · E9 3/5/0 · E10-desktop 3/4/0 · E10-mig-realtime 1/4/1 · E11 5/2/0.

★★★ **The headline is that (b) is the largest class, and it is good news.** 46 of the 100 records
are *honest about being incomplete* — `SVC-003a`: "**SVC-003 stays OPEN**"; `DAT-007`:
"`**Status:** PARTIAL` — the ticket's core remote-reach is **BLOCKED**"; `MIG-009-drain`:
"`E10-1-drain` stays honestly **`unwired`**"; `WRK-014`: "SHIPPED (inert) … The container path is
UNWIRED"; `MIG-005-006-007-shadow`: "SHADOW ONLY". **These are not a discipline failure. They are
the discipline working, recorded in a format no guard can read.** The missing thing is a token, not
an assessment.

**Which are still checkable:** all 42 in (a) and all 46 in (b) are claims about code. (b)'s claims
are the *easier* kind — "this is unwired" is falsifiable in one grep, and several are already stale
in the true direction (`MIG-009-drain`'s `unwired` was superseded by `MIG-009-wiring-result.md` and
the register now reads `wired`).

**Which are no longer verifiable:** the 12 in (c), and they fall into three named causes —

- **no anchor at all:** `DAT-003`, `DAT-004` ("COMPLETE … all local gates green") name no SHA, no
  run and **no test file**; `DAT-009-slice-1`, `DAT-010`, `TRACK-001` give only a *design* Start SHA
  with no landed SHA; `MIG-008` carries a `complete` status with no test, count, run or landed SHA.
- **own gate never cited:** `DEP-012-unit-a`, `-b1`, `-b2` each say "SHIPPED, **CI pending**", and
  no follow-up run id ever appears.
- **expiring or transient evidence:** `W7U1-output-probe` and `W10B-egress-enforcement` rest on
  dispatched runs whose artifacts carry **90-day retention** and measure a live E2B/provider network
  tier — not re-derivable from code. `BRW-003d-5` says *"End SHA: see the `feat(BRW-003d-5)`
  commit"* and does not identify it.

★ Recorded uncertainty: E3's (a) records all rest on **local Windows embedded-PG** runs and defer
formal authority to Linux CI *without citing a run*. They are checkable (test names and counts are
given) but nobody pinned the authoritative green. `DSK-001-lane-B` is a coin-flip between (b) and
(c): it claims a green gate at a tip SHA and also records a multi-hour CI billing outage mid-lane.
And the longest files were read by header plus targeted section, not end to end — a mid-file
disclaimer could move `SVC-002`, `REL-004-lane-C` or `DSK-001-lane-A` from (a) to (b).

### 2.3 The `findCompletedTicketIds` exposure — measured, not inferred

`findCompletedTicketIds` (`scripts/check-finding-ownership.mjs`) derives shipped-ness from
**filenames only**:

```
const m = /^([A-Z]+-\d+).*-result\.md$/.exec(file);
if (m) ids.add(m[1]);
```

It never opens the file. Its own doc comment is candid about what it is for — *"the repo's own
signal that a ticket shipped. An open finding 'owned' by one of these is owned by nothing."*

Measured at this tip: **124 ticket ids read as complete, out of 137 ticket ids on disk.** Ids that
read as complete while their own record says otherwise include:

| Id reads COMPLETE | The record that mints it says |
|---|---|
| `SVC-005` | `SVC-005a-result.md`: "**SVC-005 stays OPEN.** E9's exit gate is not moved" |
| `SVC-003` | `SVC-003b-result.md`: "NO finding is closed. **SVC-003 STAYS OPEN**" |
| `SVC-007` | `SVC-007b-result.md`: "`E9-F011` OPENED and left OPEN … **SVC-007 STAYS OPEN**" |
| `BRW-003` | `BRW-003b-result.md` is the producer slice; the retention half `BRW-003c` is **design-only**, which is *why* the HIGH finding `E8-F011` is `unowned` |
| `DAT-007` | `DAT-007-result.md`: "`**Status:** PARTIAL` — core remote-reach is **BLOCKED**" |
| `MIG-002` | `MIG-002-convergence-result.md`: "**The drain is still unwired** … the revocation fan-out is still unwired" |

**Why this is worse than a cosmetic mismatch.** `check-finding-ownership` reds when an open finding
is owned by a ticket it believes shipped, and the documented remedy is to name a successor. So a
premature completion inference does not fail loudly — it **pressures the register toward
re-pointing findings away from the ticket that actually owns the work**. `scope-triage.md` already
records the two cases where this was caught by hand (`MIG-010` and `CLI-008`, where a parent result
*"would orphan ten findings in a single commit"*). The census shows the same mechanism operating
**unnoticed on at least six more ids**, in exactly the epics that gate M3 and M5.

★ The one id that behaves correctly, `CLI-008`, does so only because someone **deliberately declined
to write a file**. A guard whose correct outcome depends on an author's restraint is not enforcing
anything.

★★★ **AND THE COLLAPSE IS PER-TICKET, NOT PER-FILE — so "make the guard read the body" DOES NOT FIX
IT.** *Added 2026-09-24 (Codex P1, PR #601), verified at source.* `DAT-007-S3-result.md` already
carries an exact machine-readable `**Status:** \`complete\``. The regex collapses it to `DAT-007`,
whose own `DAT-007-result.md` reads `**Status:** PARTIAL … BLOCKED`. So a body-reading guard finds a
valid completion token and marks the parent complete anyway — the slice's honest token is what mints
the parent's false one. The same shape covers `SVC-003a`/`SVC-003b`, `SVC-005a`, `SVC-007a`/`SVC-007b`
and `BRW-003a`…`BRW-003d-5`: **every one of §2.3's six ids is minted by a slice file, not by the
parent's.** The remedy has to **aggregate every `<ID>*-result.md` for an id** and mark the ticket
complete only when they all agree, which §3.2's Job A now says. Requiring a token per file would have
left the exposure exactly where it is while reporting that it was closed.

★★★ And note which way the exposure runs: it is **not** caused by the 100 missing status tokens. It
would survive all 100 being fixed, because the guard never reads the body. Fixing the tokens and
fixing this are two different jobs, and conflating them would leave the real one undone.

---

## 3. Proposal

### 3.1 How criteria should be written

Three changes, all to *form*, none lowering a bar.

**P1 — every criterion names its surface, and a criterion whose surface does not exist is written
`surface: TO BUILD (<ticket>)`.** The four M1a precedents and the 33 in §1.8 share one shape: the
criterion names an observation and assumes a channel. Make the channel a *declared field* of the
criterion, so that "the surface is missing" is a statement the criterion itself can carry, rather
than a discovery. This is the same move `scope-triage.md` already made for the M1a required-result
set when it forced every row to say *where its task is defined* — for the identical reason: a set
whose members resolve to nothing is an exemption in a longer form.

**P2 — a criterion may not be phrased as an observation of a structural argument.** E5 clause 5 and
RTF-06 are the two live instances: redaction is *correct* in both, and in both the evidence demanded
is "a planted canary observed scrubbed" against a path that emits nothing to plant one in. Either
the criterion demands the channel (and P1 makes that visible), or it is restated as a *design*
clause proven by a structural test. Today it is written as the first and satisfied like the second,
which is the ambiguity that makes it fail at the gate.

**P3 — a gate clause whose substrate changed gets restated, not waived.** RTF-03 says "broker
outage"; there is no broker. RTF-02 says "one monotonic source sequence"; the sequence is
per-company contiguous. Both are gate-owner restatements, both are cheap now and both become a
campaign-day argument if left. Restating a clause against the substrate is not lowering it.

### 3.2 Bringing E8–E11 under the discipline **before** M3

The cheapest route is **not** to re-measure 100 records. It is three separable jobs, in this order,
because each is cheap only if the one before it landed.

**Job A — make completion an AGGREGATE over a ticket's result files, not a filename match. 1 ticket,
~1–2 agent-days.**
Change `findCompletedTicketIds` so an id counts as complete only when **every** `<ID>*-result.md`
on disk asserts completion and none disclaims. Reading the body is necessary and, per the correction
in §2.3, **not sufficient**: `DAT-007-S3-result.md` supplies a valid `complete` token for a parent
whose own record says `PARTIAL`, so a per-file rule closes nothing.

Positive control, and it must be this one: assert the guard goes red for `DAT-007` **while
`DAT-007-S3-result.md` still carries its honest `complete`**. A control that only exercises a
missing token would pass against the per-file rule too, and so would not distinguish the fix from
the thing it replaces.

This must land **first**: after Job B, the same false completions would be re-minted through the new
tokens.

★ It will red the register on the ids in §2.3. That is the finding, not a regression, and each red
is a real ownership question someone has to answer. **Budget for the answers, not just the change.**

**Job B — an out-of-band ticket-status index, because the records themselves may not be edited.
1 ticket, ~2 agent-days.**

★★★ *Rewritten 2026-09-24 (Codex P1, PR #601), verified at source. **Superseded text:** a per-epic
backfill of the token into the 88 class-(a) and class-(b) records, asserting that "these records are
not immutable — the immutability rule covers `qa/` and `handoffs/`, not `tickets/*-result.md`".
**That was half right and the wrong half was load-bearing.** `check-evidence-immutability.mjs` does
exclude `tickets/` — its own comment says so — but `artifact-policy.md` freezes a ticket result by
**policy** the moment its status becomes `complete`: "Once status becomes `complete`, the file is
frozen; a later correction creates a finding and a new ticket/result rather than rewriting approved
evidence." Every class-(a) record asserts completion in prose. So the proposal would have directed
an agent to edit 42 frozen records, and the guard's silence would have let it.*

So the status is recorded **beside** the records, never inside them: one reviewed index keyed by
ticket id, which Job A's aggregate reads. It has three further advantages over the backfill, which is
why it is not merely the fallback:

- it is **per ticket**, which is the grain Job A needs and the grain a filename cannot express;
- it **cannot rewrite approved evidence**, so it is available without a gate-owner ruling; and
- it is one reviewed artefact rather than 88 edits across ten epics, so a distinct reviewer can
  actually read it.

The judgements are transcription, not new assessment — §2.2 found that (a) and (b) records already
state their own status. ★ Where an index entry disagrees with its record, **the record wins and the
index cites it**; the index is a machine-readable view of the ledger, never a second source of truth.

**Job C — the 12 records in class (c). 1 ticket, ~1 agent-day, and it is a filing job.**
Do **not** re-measure them. Mark each `unverifiable` with its named cause (§2.2's three causes) and,
where the claim still matters to a milestone, file the re-measurement as its own ticket against that
milestone. Two of the twelve (`W7U1-output-probe`, `W10B-egress-enforcement`) rest on 90-day
artifacts that are already gone; pretending otherwise is the more expensive option.

**Total: 3 tickets, ~4–5 agent-days**, plus the unbudgeted tail of answering Job A's reds. ★ *Was
"8 tickets, ~5 agent-days" before the Job B rewrite above: six of the eight were the per-epic
backfill tickets, which the index replaces with one. The day count barely moves — the saving is in
review surface and in not editing frozen evidence, not in effort.* Compare
with doing it inside M3, where the same work arrives as gate-blocking discoveries on a frozen
candidate — which is what happened four times inside M1a alone.

### 3.3 The surface work, sized but not scheduled

Not proposed for before-M3 — this is what §1 says someone must own, and **which milestone takes each
is a programme-owner decision**, exactly as `scope-triage.md` left full-D2 ownership open rather
than inventing one.

| Item | Gates | Rough size |
|---|---|---|
| availability SLI sampler + frozen schedule manifest + hash + sample record | D4-06 (M3), SLI-02/D6-02 (M5) | L — a ticket in its own right, and it is **two milestones' prerequisite**, so it wants an owner now |
| D5-L load/fairness harness | M4, **and the E11 exit gate's own wording** | L |
| browser-session reachability: an importer for `packages/browser-runtime` + `workload.browser_session` in `SUPERVISABLE_WORKLOAD_CAPABILITIES` | all of D3 (M3) | M — already named as M3's opening work in `scope-triage.md`; this confirms both halves at HEAD |
| `SVC-009` b2 — worker-side renewal consumption + E2B TTL extension | D4-01's 72 hours (M3) | M — `E9-F002` already rates it *"Blocks D4-01 outright"* |
| legacy-not-reached instruments for `MIG-005` and `MIG-007`, on the crew seam's model | M2 exit | M — the pattern exists and is tested; it is a port, not a design |
| RTF-04 resume cursor on `buildSnapshotResumeFrame` | M2-RTF | **S — the cheapest item in this document** |
| RTF-06 realtime canary corpus, or P2's restatement | M2-RTF | S–M depending on the ruling |
| a production caller for `manifest-reconciliation.ts` | D5-DR04/05 (M4) | S — the verifier is built, mutation-tested and fail-closed; only the caller is a runbook step |

---

## 4. What I could not determine

Stated explicitly, because a negative audit is only as good as the set it enumerates.

1. **Whether the (a)-class records are actually true.** I classified 42 records as *checkable*
   claims about code. I did **not** check them. "Still checkable" is a property of the record, not a
   verdict on the code, and nothing here should be read as revalidating them.
2. **RTF-05.** Both halves exist and are separately exercised; I found no harness exercising the
   *contrast* that the clause asserts. I cannot rule out that one exists under a name I did not
   search.
3. **D4-10's budget half.** The authority is declared and folded into the `cancelRequested` floor. I
   found no symbol that *refuses a worker-side override* and no test named for it. That is absence
   of evidence in a large surface, not proof of absence.
4. **Whether the D1 fault matrix is intended to be extended to D4 and D6.** `check-campaign-fault-matrix.mjs`
   is well built and carries only D1/D2 profiles. Whether D6-04's denial probes are meant to reuse
   it or to be a separate mechanism is a design question the files do not settle, and I did not
   invent an answer.
5. **D5-DR01's same-candidate coupling.** The DB restore and the object reconciliation both exist;
   whether the runbook's coupling is considered sufficient evidence is a gate-owner reading, not a
   code fact.
6. **The exact (b)/(c) boundary for the longest records.** `SVC-003b` (465 lines), `SVC-007a` (455),
   `W10B` (425), `REL-004-lane-C` (406), `SVC-002` (406), `JOB-015` (397) and `DSK-003` (387) were
   read by header plus targeted section. A mid-file disclaimer I did not see could move `SVC-002`,
   `REL-004-lane-C` or `DSK-001-lane-A` from (a) to (b). The counts in §2.2 carry that uncertainty.
7. **Whether any of the 33 DOES-NOT-EXIST items is deliberately out of scope under a decision I did
   not read.** I read `scope-triage.md`, `qa-handoff-recovery.md` and `test-gates.md` in full, and
   the epic READMEs and plans only where a probe led there. A ruling in an epic `decisions.md` could
   already dispose of one of these.
8. **Cost estimates in §3.2 are estimates.** They assume the transcription in Job B is mechanical,
   which §2.2 supports but does not prove, and they explicitly exclude the tail of answering Job A's
   register reds — which I could not size without knowing how many of the six ids need a successor
   rather than a re-point.
9. **How many ids beyond §2.3's six are minted by a slice file.** The per-ticket collapse corrected
   in §2.3 was measured on the six ids I had already flagged; I did not sweep all 124 for the same
   pattern. Job A's aggregate is written to be sound regardless, but **the size of its red set is
   unmeasured and is probably larger than six.**
10. **Whether Job B's index is an acceptable artefact to the gate owner.** It records status outside
    the record, which no current policy contemplates in either direction. `artifact-policy.md`
    forbids rewriting a frozen result; it says nothing about a derived index citing one. I read that
    as permitted, and it is a reading, not a rule I found written down.
