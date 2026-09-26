# QA Result — `M1a-D2-MECHANISM`, M1a candidate, `7be35ae6b771`, attempt 1

**Date (UTC):** `2026-09-24`
**Milestone:** `M1a`
**Record path:** `docs/replatform/milestones/M1a/qa/2026-09-24-m1a-d2-mechanism-m1a-candidate-7be35ae6b771-a1.md`
**Scope slug:** `m1a-candidate`
**Revision:** `7be35ae6b7719877e61f54ab552de84de8491e7d`
**Attempt:** `1`
**Supersedes:** `none`
**Lane:** `M1a-D2-MECHANISM`
**Result:** `fail`
**Failure class:** `harness`
**Campaign start (UTC):** `2026-09-23T21:12:00Z`
**Campaign end (UTC):** `2026-09-23T21:18:00Z`

> This file is immutable from its first commit. A correction, rerun, changed decision, or changed
> revision creates a higher attempt and links this path through `Supersedes`.

**Author:** the `M1a` QA owner — a review session **distinct** from the planning session that took
the M1 decisions and dispatched the runs (founder ruling **F2**). This session dispatched no
workflow, keyed or keyless, and wrote no milestone handoff.

---

## 0. The verdict in one paragraph, and why it is not a criticism of the run

The keyed shipped CI boot **worked**. Run `35920425288` built all three images from the candidate,
booted them with a CI-generated keypair, and drove a real multi-tenant E2B journey to a clean,
verified, attributed finish for two enabled Organizations while refusing a third. Everything the
planning session reported about it is true; I confirmed each item at source (§3). **The gate is not
what that run proves.** `M1a-D2-MECHANISM` is defined as the journey *"end to end — dispatch,
distributed ownership, lease, secret redemption, staged input, E2B create/execute/teardown, durable
terminal, **cancellation, provider failure, reconciliation and every cleanup path**"* plus *"the
operator-visible audit, cost and failure-classification signals journey item 7 names"*. Of the
emphasised clauses, **none** was exercised: the gate's own fault matrix declares 23 cases and
**every one of them is still `evidence: "pending"` at the candidate**, because the workflow has no
step that runs them. The audit signal came back **empty** and the cost row count came back **zero**.

A gate whose declared cases have all never fired cannot be recorded `pass`, however good the run
underneath it was. **`Result: fail`, failure class `harness`** — the lane does not yet exercise the
clauses; nothing in the product misbehaved.

---

## 1. Candidate and run

| | |
|---|---|
| **Candidate** | `7be35ae6b7719877e61f54ab552de84de8491e7d` |
| **Run** | **`35920425288`**, `.github/workflows/m1-shipped-boot.yml` (*"M1 shipped CI boot (DEP-015)"*), event `workflow_dispatch`, `mode: keyed`, template `aoa-base` |
| **Run head SHA** | `7be35ae6b7719877e61f54ab552de84de8491e7d` — **the candidate exactly.** This record needs no tree-equivalence argument. |
| **Job** | `shipped-boot` — **30 steps, all `success`** (read per step from the API, not from the run conclusion; `E6-F023`) |
| **Keyless rehearsal of the same candidate** | run `35919374111`, same workflow, `shipped-boot` 30/30 `success` |
| **Evidence artifact** | `m1-shipped-boot-keyed-35920425288`, **22 files**, downloaded and read in full |

★ **Ruling F3 is satisfied by this lane.** `m1-shipped-boot.yml` is `workflow_dispatch`-only, is
bound to a named candidate (steps *"Validate the named candidate"* and *"Bind the run to the
candidate"*), builds the control-plane, worker and adapter-manager images from source in-job, and
generates the control-plane keypair in-job (`candidate.json`: `keypair.generatedInJob: true`,
`algorithm: "ed25519"`, `signVerifyProbe: "pass"`). It is not the operator campaign deploy.

**Image digests, from `candidate.json`:**

| Image | Digest |
|---|---|
| control-plane | `sha256:90c1e7aa24c6a1e0f81f0105f397e2e109833745400db908b26bdcfbd07401ba` |
| worker | `sha256:df44724d49d4cfb07ab19f266f149fc8c0bf4432540514caecdf6ee99742ecc4` |
| adapter-manager | `sha256:bba7540e4b34a25e0b5ba564b5c3ac363978bd4e4ba89ea5e0af8232d35f70ff` |

---

## 2. Topology and configuration digest (F10 + the M1a freeze checklist)

| Field | Value |
|---|---|
| Control planes | 2 replicas (`control-plane`, `control-plane-b`) |
| Workers | 3, one per Organization (`m1-worker-a/b/c`), each `status: enrolled`, `scope: organization`, `device_generation: 1`, `live: true` (`workers.json`) |
| Adapter manager | booted; `logs-adapter-manager.txt` retained |
| Provider | **real E2B** |
| Object store | MinIO; `presign-probe.txt` = `PRESIGN_PROBE_OK status=200` from the adapter-manager's seat |
| Enabled Organizations | `2f6229af-f681-4777-9235-8541ed33585e` (a), `c7fe6ae6-2ec6-482c-84d6-e9a330eacab1` (b) |
| Control Organization | `3f09853c-d5b7-42a8-94bf-17c893867e7b` (c) |
| Rollout resolution | a `canary`, b `canary`, c **`off`** (per-run `rolloutResolution` logged by the control plane) |
| Tenant set + must-be-off switches | asserted on **four** replica readings — `control-plane` and `control-plane-b`, each `rendered` **and** `running`: `tenantSet: "exact"`, `crewRolloutEnabled: "false"`, `toolSurfaceEnabled: null`, `mustBeOff: "off"` (`tenant-set-and-flags.json`) |
| Targets | one `aoa-canary-e2b` target per Organization, three distinct `registeredProfileHash` values (`targets.json`) |
| Staging-manifest admission | `manifest-check-pre-boot.txt` **and** `manifest-check-post-rollout.txt` both: *"rendered shipped boot satisfies DEP-015 (scoped), and the unscoped default-off check reds it (6 violation(s)) — the admission is scoped"*. The unscoped `checkDispatchDefaultOff` reding is the positive control that the amendment is overlay-scoped. |
| Preflight | all three Organizations `ok: true`, `credentialAuthority: "company_api_key"` (`reconcile-and-preflight.json`) |

The freeze-checklist assertions the `M1a` campaign owes — tool surface off, crew rollout off, the
exact tenant set, asserted on rendered **and** running replicas — are all present and all hold.

---

## 3. Every planning-session observation, confirmed or refuted at source

I re-derived each of these from the downloaded artifacts. **Nothing below is inherited.**

| Claimed | Verdict | What I measured |
|---|---|---|
| job `shipped-boot` `success`, 30/30 steps `success` | **confirmed** | per-step conclusions from the jobs API |
| `journey.json` `passed: true` | **confirmed** | `journey.json` |
| tenant **a**: `distributed`, `succeeded`, verifier exit 0, tokens 8/618, sandbox `icnga1mdlhrayh683vwcl` | **confirmed** | `journey.json` `outcomes.a`; `verifier-a.txt` *"RESULT: PASS (mechanism)"* |
| tenant **b**: `distributed`, `succeeded`, verifier exit 0, tokens 8/597, sandbox `iw8yiqpx7b0drx4saibqj` | **confirmed** | `journey.json` `outcomes.b` |
| tenant **c** (control): `execution_owner=null`, run `failed`, no sandbox | **confirmed as to the facts; the framing needs narrowing — see §4** | `journey.json` `outcomes.c` |
| each sandbox id appears in ITS OWN tenant's worker log | **confirmed** | `grep -c` per log: `icnga1…` = 1/0/0 and `iw8yiq…` = 0/1/0 across `logs-m1-worker-{a,b,c}.txt`. Both ids also pass `E2B_SANDBOX_ID_SHAPE` (`scripts/lib/m1-shipped-boot.mjs`), which rejects every checked-in test double's id shape |
| env probe: `absent`, 18 classes, `present: []`, planted control `red: true` with the three named classes each detected as expected | **confirmed** | `env-probe-a.json`, `env-probe-b.json`; I counted the `checked` array: **18** |
| usage cardinality: exactly 1 event per enabled tenant, `violations: []`, judged by `evaluateUsageCardinality`; 0 for the control | **confirmed** | `journey.json` `usage`; `evaluateUsageCardinality` exists and is called at `scripts/lib/m1-spine-assertions.mjs` |
| `capabilityProven: false` throughout — a PASS for M1a by the triage's terms | **confirmed for a/b; refined for c** | a and b report `false`; the control reports **`null`**, not `false` (no verifier ran). Immaterial to the verdict, recorded for precision |
| `costEventsForRun: 0`, `costUsd: null` on both tenants; the priced row is NOT proven and `E3-F037` is not closed here | **confirmed** | `journey.json` `signals.cost` on a and b |

### 3.1 What the planning session's list did not mention, and I am adding

1. ★★★ **The DE-08 metadata residual was measured live, and metadata is REACHABLE.** Both enabled
   tenants' env probes carry a `de08MetadataResidual` block: `attempted: true`, `target:
   "169.254.169.254"`, **`reachable: true`**, `httpStatus: 401`. See §7 — this is direct evidence
   that `H-06`'s metadata clause is unmet, which is far stronger than the usual "recorded as an
   unresolved risk".
2. ★★★ **The audit signal is empty.** `signals.audit.jobSubmitted` and
   `signals.audit.securityDenials` are `[]` for **both** enabled tenants. The gate text requires
   *"the operator-visible audit … signals journey item 7 names"*. §5 treats this as a failed clause.
3. ★★★ **All 23 declared fault-matrix cases for this gate are `pending`.** §5.
4. **The participating Organization's own key IS in the sandbox**, by design:
   `allowedPresent: ["ANTHROPIC_API_KEY"]`, `redeemedNames: ["ANTHROPIC_API_KEY"]`, with
   `allowedMismatch: []`. That is the accepted managed-shared model, not a leak, and §7 records it
   as the mitigation it is.
5. **`observeRun` now has 5 production callers** and real `claude_local` usage was parsed
   (`cachedInputTokens` 64287 for a, 77982 for b) — so `WRK-018`'s producer demonstrably works on
   real E2B, which is the evidence `E3-15-budget`'s register entry says its promotion waits on. The
   priced *row* still is not shown here.

---

## 4. The control tenant — what it proves, and what it does not

The control tenant's own heartbeat run **failed**, with
`error: "Command not found in PATH: \"claude\""` and `error_code: "adapter_failed"`.

**What the control proves:** the Organization was **refused** the distributed path. That is
established by `execution_owner: null`, `distributed_job_id: null`, `distributed_attempt_id: null`,
`jobsForOrganization: 0`, no `distributed_execution_selection` event, `usage.events: 0`, and the
control plane logging `rolloutState: "off"` for the run. This is exactly the conjunction
`classifyTenantOutcome` (`scripts/lib/m1-shipped-boot.mjs`) requires of a `role: "control"` tenant,
and its own comment says the point out loud: *"Refused for the RIGHT reason: the control plane
itself resolved the rollout `off` for this run. A legacy run for any other reason (a dead worker, a
stale preflight) is not a control."*

**What the control does NOT prove — and this is the sentence to carry forward:** that the legacy
path is healthy. The control's legacy run failed because the `claude` CLI is not installed in the
control-plane container, an environment fact of the CI boot that has nothing to do with the rollout
decision. **Refusal is proven; legacy-path health is not observed at all.** Nobody may cite this
record for "the control tenant continued to work on the legacy path".

Also structural: the control tenant has **no env probe** (`envProbe: null`) and **no verifier
verdict** (`verdict: null`, `capabilityProven: null`), because no sandbox is created for it. The
`DEP-017` criterion-5 observation therefore covers the two enabled tenants only.

---

## 5. Failures — the clauses this gate requires and this run did not exercise

`scope-triage.md` → `M1a-D2-MECHANISM` requires the journey *"end to end — dispatch, distributed
ownership, lease, secret redemption, staged input, E2B create/execute/teardown, durable terminal,
cancellation, provider failure, reconciliation and every cleanup path — in a shipped CI boot, and
record the operator-visible audit, cost and failure-classification signals journey item 7 names."*

| # | Clause | Observed | Class |
|---|---|---|---|
| F-1 | **cancellation** | **not exercised.** `d2m.cancellation.leased_attempt` is `evidence: "pending"` | `harness` |
| F-2 | **provider failure** | **not exercised.** `d2m.provider_failure.e2b_create_refused` is `pending` | `harness` |
| F-3 | **reconciliation** | **not exercised.** `d2m.reconcile.daemon_restart_with_live_lease` is `pending`. The pre-journey `reconcile` step is a preflight closure pass whose own output says *"This flips no gate"* | `harness` |
| F-4 | **every cleanup path**, incl. E2B teardown | **not exercised.** All three of `d2m.cleanup.sandbox_destroyed_on_terminal`, `…_on_cancel`, `…_on_lease_loss` are `pending`. No artifact records a sandbox teardown | `harness` |
| F-5 | **operator-visible audit signal** | **empty.** `signals.audit.jobSubmitted: []` and `securityDenials: []` on both enabled tenants | `harness` |
| F-6 | **cost signal** | **`costEventsForRun: 0`, `costUsd: null`** on both. The evidence's own note concedes the count is keyed to the usage event rather than the run, so 0 does not disprove a charge — but neither does it show one. **No priced row is proven on real E2B; `E3-F037` is not closed by this run** | `harness` |
| F-7 | **cross-tenant denial in every gate profile (F10)** | **not exercised.** All nine `d2m.tenant.cross.*` cases plus the four `d2m.tenant.legacy.*` cases are `pending`. `providerEvidence.rejected` reads `{shape: 0, foreignLease: 0}` on both tenants — zero rejections, because no hostile attempt was made | `harness` |
| F-8 | **control-tenant refusal as a declared case** | the refusal **is** observed (§4), but `d2m.tenant.control_refused` remains `pending` in the declaration | `harness` |
| F-9 | **the two `M1-D1-SPINE` cases routed here** | `d1.reconcile.worker_startup_lease_probe` and `d1.provider.worker_terminal_mapping` were declared structurally unavailable on D1 and routed by name to this lane. **This lane did not run them.** So `WRK-013`'s deployed-boot restart case and the deployed worker's terminal mapping are certified by **no** campaign | `harness` |
| F-10 | **`d1.credential.production_reader_company_predicate`**, routed here by `E6-D003` as `d2m.credential.production_reader_company_predicate` | `pending`. Uncertified by any campaign | `harness` |

**Root cause, measured at source, one line:** `.github/workflows/m1-shipped-boot.yml` at the
candidate has **no fault-matrix step** — its 30 steps run `journey.mjs` phases (`boot-core`, `seed`,
`apply-rollout`, `assert-tenants`, `provision-targets`, `boot-workers`, `await-workers`,
`reconcile`, `probe-presign`, `dispatch`), collect, scan and upload — and the uploaded artifact
contains no fault-matrix bundle. The `M1a-D2-MECHANISM` profile in `tests/d1/fault-matrix.json`
consequently stands at **23 declared, 23 `pending`, 0 fired**. Each `pending` row is properly formed
(`pendingKind: "keyed"`, a reason, and `pendingOwner: "planning session (F8), on the DEP-015 lane"`),
so `check-campaign-fault-matrix.mjs` is green — **the declaration is honest; the cases simply have
not been run.**

**Why `fail` and not `blocked_external`.** `qa-handoff-recovery.md` §5: `blocked_external` is for
infrastructure or external-dependency prevention **before** a required campaign starts. This
campaign started and completed; keyed E2B was available and was used. The gap is that the lane does
not exercise the clauses. There is no conditional pass and no waiver of a HARD invariant.

---

## 6. What the run DOES establish — recorded at full strength

This is real, and a later reader must not discount it because of §5.

| ID | Class | Required | Observed | Result |
|---|---|---|---|---|
| `MECH-BOOT-1` | REQUIRED | shipped CI boot per F3: dispatch-only, candidate-bound, three images built from source, CI-generated keypair | all four, `candidate.json` | `pass` |
| `MECH-DISPATCH-1` | REQUIRED | distributed ownership per enabled tenant | `execution_owner: "distributed"` with job + attempt ids on a and b; `distributed_execution_selection` and `distributed_execution_handoff` events recorded for each | `pass` |
| `MECH-LEASE-1` | REQUIRED | lease taken | `leaseCount: 1` per enabled tenant; lease ids `34519ffa-…` (a), `6b542298-…` (b); `polls: 1` each | `pass` |
| `MECH-SECRET-1` | REQUIRED | secret redemption | `credentialAuthority: "company_api_key"` for all three Organizations; `redeemedNames: ["ANTHROPIC_API_KEY"]` per enabled tenant | `pass` |
| `MECH-STAGE-1` | REQUIRED | staged input (`M1a` entry requires workspace staging) | the journey stages input and completes; `stageJobInputFiles` has 2 production callers at the candidate and `E7-1-staged-input-write` is `wired` | `pass` |
| `MECH-E2B-1` | REQUIRED | **real** E2B create + execute | two real sandbox ids, each in its own worker's log, both passing `E2B_SANDBOX_ID_SHAPE`; runtimes 18 455 ms and 18 580 ms | `pass` |
| `MECH-TERM-1` | REQUIRED | durable terminal | one `terminal` event per enabled tenant, `status succeeded`, `exit_code "0"`, `projectionReceiptApplied: true`; `attemptStartedEvents: 1` | `pass` |
| `MECH-CLASS-1` | REQUIRED | failure classification recorded | recorded for the success path: `runStatus succeeded`, `terminalErrorCode null`, `placement_disposition "selected"`, `placement_reason_code "target_selected"`. **No failure was injected, so the classifier's failure arms are unexercised** | `pass` (success arm only) |
| `MECH-F10-1` | REQUIRED | per-tenant correctness for each enabled tenant, with its own attribution | both verifiers exit 0 with `ok: true`; each tenant's `organizationId`/`companyId` match its own rows throughout | `pass` |
| `MECH-F10-2` | REQUIRED | the control Organization is refused | §4 | `pass` |
| `MECH-USAGE-1` | REQUIRED | exactly one usage event per enabled tenant, zero for the control | 1, 1, 0; `violations: []`; judged by `evaluateUsageCardinality` | `pass` |
| `MECH-CAP-1` | REQUIRED | `capabilityProven=false` is acceptable and is the gate's defining property | `false` on both enabled tenants, with `clause 6` stating output capture is UNBUILT (`CLI-008` Unit F) | `pass` |
| `MECH-CRED-1` | REQUIRED | live env-absence probe with a planted-canary positive control (`DEP-017`, ruling F9) | §7 | `pass` |
| `H-06` | HARD | metadata / private / worker-control / control-plane denied incl. direct-IP, redirect, DNS-rebinding | **metadata measured REACHABLE**; the other variants untested | **`recorded`, NOT `pass`** — §7 |

---

## 7. DE-08 residual, credential taxonomy, and H-06 — required by scope-triage

`scope-triage.md` → *Dormant default-deny egress qualification*: **all three** partial gates must
record the DE-08 residual and the credential-taxonomy mitigation explicitly, and **none** may mark
`H-06` passed. This section discharges that for `M1a-D2-MECHANISM`, and it is the gate profile where
the residual stops being theoretical.

### 7.1 The DE-08 residual, measured

`de08MetadataResidual`, identical on both enabled tenants:

```
attempted: true   target: 169.254.169.254   reachable: true   httpStatus: 401   errorCode: null
note: "OBSERVED, not enforced: DE-08 is an accepted residual that leaves H-06 unmet;
       this is a record, not a claim."
```

**The cloud metadata endpoint is reachable from inside the sandbox.** The 401 is the endpoint
declining the request, not the network denying the packet. This is the accepted managed-shared
residual made concrete on a real provider, and it is recorded here as an unresolved
provider-boundary risk — never as a denial.

At the candidate, `createFenceAwareEgressProxy` (`server/src/services/egress-proxy.ts`) has **zero
production callers** and the register key `E5-6-denied-egress` is **`unwired`** (both re-measured by
this session). **No sandbox-egress-denial claim is made anywhere in this record**, and none may be
derived from it.

### 7.2 `H-06` is NOT passed

`H-06` requires metadata, private, worker-control and control-plane destinations to remain denied,
**including direct-IP, redirect and DNS-rebinding variants**. The DE-08 scope decision did **not**
amend it. On this run, the metadata destination was **reachable**, and the private, worker-control
and control-plane destinations plus the direct-IP, redirect and DNS-rebinding variants were **not
probed at all**. `H-06` is `recorded`, **not** `pass` (§6). Full `D1`/`D2` and any `E6` or `E7`
completion require live evidence satisfying the current requirement, or a separately reviewed and
approved amendment to `test-gates.md`. Neither exists. **This record is non-promoting.**

### 7.3 The credential-taxonomy mitigation — what actually limits the blast radius

The residual is bounded by the credential taxonomy, and on this lane the taxonomy is **enforced by a
live probe with a red positive control** (`DEP-017`, ruling F9), not asserted. Per enabled tenant:

- `verdict: "absent"`, **18** classes checked: `datastore_credential`, `secrets_master_key`,
  `auth_signing_secret`, `source_control_token`, `subscription_login`, `provider_control_key`,
  `object_store_credential`, `worker_enrollment`, `oauth_client_secret`, `connector_token`,
  `embeddings_key`, `legacy_agent_key`, `host_control_plane_env`, `model_provider_key_not_allowed`,
  `unclassified_credential_shaped`, `cross_tenant_credential`, `provider_credential_value_mismatch`,
  `unredeemed_provider_credential`.
- `present: []`, `presentNames: []`, `allowedMismatch: []`.
- **Positive control `red: true`** — three canaries planted and each detected as its expected class:
  `DATABASE_URL` → `datastore_credential`; `OPENAI_API_KEY` → `cross_tenant_credential`;
  `ANTHROPIC_API_KEY` → `provider_credential_value_mismatch`. All `satisfied: true`. **A probe that
  cannot go red is not a probe; this one can, and did.**
- `allowedPresent: ["ANTHROPIC_API_KEY"]`, `redeemedNames: ["ANTHROPIC_API_KEY"]` — the
  participating Organization's own approved runtime credential, present by design. That is the
  accepted model stated in the triage: host, operator, control-plane, cross-tenant and unrelated
  connector credentials do not enter the sandbox; only the participating Organization's approved
  runtime credential and scoped data are exposed.
- The redaction half held too: the job's step *"Scan the evidence AND the job log for job secrets
  and key material (fails the run on any match)"* passed.

**The limit of the mitigation, stated:** it was observed for the **two enabled tenants only**. The
control tenant has no sandbox and therefore no probe (`envProbe: null`). And it is a **credential**
mitigation — it constrains what a reachable network can be used to reach. It does not make the
network denied, and it is not a partial `H-06`.

---

## 8. What this record does NOT establish — the full list

1. **Cancellation, provider failure, reconciliation and every cleanup path** — §5, F-1 to F-4.
2. **Cross-tenant denial on this gate** — §5, F-7. The only cross-tenant observation here is that
   each sandbox id appears in its own worker's log and nowhere else, which is a separation
   *observation*, not a *denial* of a hostile attempt. Every hostile case on this gate is `pending`.
3. **A priced row on real E2B** — `costEventsForRun: 0`, `costUsd: null`. `E3-F037` is **not**
   closed by this run. The keyless spine lane does show one `cost_events` row per tenant at 83
   cents on the **reference** provider; that is a different claim on a different provider.
4. **Any operator-visible audit signal on this lane** — `jobSubmitted: []`, `securityDenials: []`.
5. **`WRK-013`'s deployed-boot restart** and **the deployed worker's terminal mapping** — routed
   here from the spine, never run (§5 F-9).
6. **Legacy-path health for the control tenant** — §4. Refusal only.
7. **Anything about tools.** The tool surface is off on every replica by design;
   `d2m.tenant.cross.tool_calls` is `pending` and is `M1b`/`CLI-016` work. The switch still has no
   per-Organization dimension.
8. **Anything about output.** `capabilityProven: false` on both tenants, `workspacePatchArtifacts:
   0`, `taskOutputs: 0`. The verifier's own clause 6 says output capture is UNBUILT
   (`CLI-008` Unit F) and `E7-F018` (HIGH) remains open — `projectAcceptedOutput` reads 0 on every
   real run, so *"the bar is CLOSED rather than working"*. **`capabilityProven: false` is a PASS for
   `M1a` by the triage's own terms and is not among this record's failures.**
9. **This is not `D2` and not `M1-D2-CODING`.** A mechanism pass — and this is not even that —
   is never evidence for the capability gate under any wording.

---

## 9. Cleanup

The job's final step, *"Tear down (stack, volumes, keypair, secrets)"*, ran `success`. **Sandbox
termination is not evidenced**: no artifact records an E2B teardown, and all three
`d2m.cleanup.sandbox_destroyed_on_*` cases are `pending` (§5 F-4). Evidence was collected redacted
and scanned for secrets before upload; no credential values appear in this record. `H-09` (zero
provider resources remaining after the lane cleanup deadline) is **not** evidenced by this run.

---

## 10. Gate effect

- **Blocks** `M1a` exit criterion 8 for the gate `M1a-D2-MECHANISM`: that criterion requires a
  committed `Result: pass` QA record for **each partial gate the milestone names**, and this one is
  `fail`. Consequently it also blocks exit criterion 3.
- **Blocks nothing else, and promotes nothing.** `M1a-D2-MECHANISM` is **non-promoting**. It cannot
  complete `E7`, cannot support any useful-capability claim, and unlocks only `M1a`.
- **Does not block** the `M1-D1-SPINE` record, which passes on its own clauses
  (`./2026-09-24-m1-d1-spine-m1a-candidate-7be35ae6b771-a1.md`).
- **Satisfies, as evidence rather than as a gate verdict,** exit criterion 5's *"explicit observation
  of the dormant-egress residual and credential-taxonomy checks, without an egress-enforcement
  claim"* — §7, for the two enabled tenants. Criterion 5 is observation, and the observation was
  made.
- **Ticket state at the candidate, for the decision owner:** `DEP-015`, `DEP-017` and `WRK-018` all
  carry `Status: gate_review`. This run is the keyed acceptance each of them was waiting for, so
  each is now dispositionable — **by a distinct reviewer, not by this QA owner and not by the
  session that dispatched the run.** Until they are dispositioned, exit criterion 1 is unmet.

### 10.1 What a passing attempt 2 would need

Recorded so the path forward is not left to inference. Either:

- **(a)** add a fault-matrix step to `m1-shipped-boot.yml` that runs the `M1a-D2-MECHANISM` profile —
  at minimum the clauses the gate text names by name: cancellation, provider failure, daemon-restart
  reconciliation, the three cleanup paths, and the cross-tenant denial set with same-tenant positive
  controls — plus the two spine cases routed here and `d2m.credential.production_reader_company_predicate`;
  then dispatch one keyed run on the candidate under the F8 envelope and file attempt 2 with
  `Supersedes` naming this path; **or**
- **(b)** the decision owner amends the gate's clause list, which is a gate-owner action and needs
  its own review — and would be a **narrowing of the bar**, which under this programme's own rules
  must be recorded as such, with an owner, and not absorbed into a QA record.

This QA owner recommends **(a)**. The lane exists, it works, and the declaration is already written;
what is missing is a step that runs it.
