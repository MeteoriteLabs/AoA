# DEP-020 — The M1a harness gaps: a fault-matrix step on the keyed lane, and the E5 clause-4 / clause-5 floors — result

**Status:** `gate_review`
**Epic:** E6 · **Plan task:** M1a harness-gap closure (planning session under F2, 2026-09-24) · **Milestone:** `M1a`
**Date (UTC):** `2026-09-24`
**Implementer:** Claude Opus 5 (M1 build agent)
**Start SHA:** `6b468773f1` (`origin/docs/replatform-program`)
**PR:** #593 (base `docs/replatform-program`)
**Reviewed revision:** `PLACEHOLDER_HEAD_SHA`

> `Status` is `gate_review` and may be set to `complete` only by a DISTINCT reviewer, never by this
> author.

---

## 0. What this ticket is, and the three records that define it

The `M1a` mechanism was proven; the evidence apparatus around it was not. Three committed,
immutable records name the gaps, and this ticket closes them. **None of those records is edited by
this ticket, and no QA record or milestone handoff is written by it** — a fresh QA attempt is a
distinct session's act.

| Record | What it says is missing |
|---|---|
| `docs/replatform/milestones/M1a/qa/2026-09-24-m1a-d2-mechanism-m1a-candidate-7be35ae6b771-a2.md` | §5, §11.1 — the lane has **no fault-matrix step**, so the profile stands at *"23 declared, 23 pending, 0 fired"*. Recommends option **(a)**: add the step. |
| `docs/replatform/milestones/M1a/qa/2026-09-24-m1-d1-spine-m1a-candidate-7be35ae6b771-a2.md` | §0, §9.1 — two cases are excused by a reason that is **false of the lane that boots the override** (`SPINE-MATRIX-3`). |
| `docs/replatform/epics/E5-workspaces-secrets/qa/2026-09-24-d0-e5-exit-gate-audit-7be35ae6b771-a2.md` | §4 clauses 4 and 5, §9.1 — **no declared D1 lease-expiry / wrong-lease redemption-refusal case**, and *"not one [case in all three profiles] names redaction, a canary, or a planted leak"*. |

---

## 1. GAP 0 — the wall that had to come down first, and the false comment that built it

**The brief assumed the D1 lane could be exercised from a PR. It could not.** Measured at
`6b468773f1`: `.github/workflows/d1-merge-train.yml`'s `on:` block carried only `merge_group:` and
`push:` (branches `main`, `docs/replatform-program`). `pr.yml:605-609` runs only the **declaration**
checker and its unit test. So the live `m1-spine` and `m1-fault-matrix` jobs — the only things that
fire a `d1.*` case — could not run on a feature branch, and a newly declared case's **first
execution would have been the push that merged it**. That is "a declared case that nothing runs",
relocated to where it is harder to see.

This was reported rather than guessed around. The planning session ruled: **add `workflow_dispatch`;
option (b), landing unproven, is refused.**

**The stated reason for the omission was false.** The file said *"workflow_dispatch is omitted
deliberately: it requires the workflow on the default branch (main), and this program keeps
everything on the one integration branch."* The planning session disproved it: `m1-shipped-boot.yml`
is **not** on `origin/main` and was dispatched twice on `docs/replatform-program` — runs
**`35919374111`** and **`35920425288`**. The real mechanism is `E6-D001`'s registration-push pattern,
and `d1-merge-train.yml` already lists its own path in `push.paths`, so registration already held.

The sentence is **not deleted**. It is quoted verbatim, marked superseded and dated, beside the
measurement that refutes it — in the new `workflow_dispatch:` block and again at its old site.

`pull_request` is deliberately **not** added: this lane is not a required check
(`scripts/lib/ci-lanes.mjs`), and a `pull_request` trigger would entangle it with branch protection.

**Two inputs, and the non-dispatch path is byte-identical.** `lanes` selects which job runs; each
job carries
`if: github.event_name != 'workflow_dispatch' || inputs.lanes == 'all' || inputs.lanes == '<job>'`,
whose first disjunct is true on every push and merge-queue event. `campaign` may override the
committed E6F scope for one dispatched run; `committed` (the default) sets the override env to the
empty string, so `CAMPAIGN="${AOA_D1_CAMPAIGN_INPUT:-$CAMPAIGN}"` keeps the committed selector.

### 1.1 ★ A defect found in a guard while doing it

`describeWorkflow` (`scripts/lib/workflow-verdict.mjs`) **lost the `push` trigger entirely** when the
new `workflow_dispatch` inputs block used a folded scalar (`>-`) or an empty-string choice option:
`yaml-lite` dropped the sibling key rather than throwing.

It **fails closed** — `hasPush: false` reds `check-workflow-verdict-manifest.mjs` with
*"coverage mode needs a `push` trigger"* — which is how it was caught, on the first guard run before
the first push. Recorded rather than absorbed: the inputs are written in the subset it parses, and a
future author who reaches for `>-` in an `on:` block will meet the same red.

### 1.2 The trigger's own positive control

**A trigger that has never fired is a claim.** Run **`35932452315`**,
`.github/workflows/d1-merge-train.yml`, event `workflow_dispatch`, ref `claude/m1a-harness-gaps`,
`lanes: m1-fault-matrix`:

- `m1-fault-matrix` — **`success`**, a full live campaign: images built from source, the one-worker
  override brought up, the matrix run live, the checker run over the retained bundle, **and the
  lane's own suppressed-injection positive control exercised**;
- `m1-spine` — `skipped`, `d1-merge-train` — `skipped`. The `lanes` selector works in both
  directions, which is the control for the selector itself: a gate that never excludes anything is
  not a gate.

---

## 2. GAP 1 — the keyed lane now runs its fault matrix

`m1-shipped-boot.yml` gains a `fault-matrix` phase in `scripts/m1-shipped-boot/journey.mjs` and two
**keyed-only** steps after *"Run the journey"*.

**What it claims, and what it refuses to claim.** The phase maps the journey's **own observations**
onto the three cases those observations decide, and emits rows for nothing else:

| Case | Flipped to | The fact that decides it |
|---|---|---|
| `d2m.tenant.journey.A` | `required` | a run exists, `execution_owner = "distributed"`, both distributed ids present (**fired**); `verifierExit === 0 && verdict.ok === true` (**corroborated**) |
| `d2m.tenant.journey.B` | `required` | as above |
| `d2m.tenant.control_refused` | `required` | `classifyTenantOutcome`'s control conjunction passed **and** the control plane logged `rolloutState: "off"`, re-read explicitly rather than trusted through `outcome.pass` |

`capabilityProven` is deliberately **not** part of the corroboration: `false` is a PASS for `M1a` by
the triage's own terms.

**The other twenty cases stay `pending`, with their kind, reason and owner.** They need injections
this lane does not yet perform — cancellation, provider failure, daemon restart, the three cleanup
paths, the nine hostile cross-tenant attempts, the four legacy-table reads. **Declaring them
`required` against a driver nobody has ever run would red the founder's keyed campaign and spend E2B
to discover it.** That is stated as the reason rather than left implicit.

**It fails closed, in four places.** A missing `journey.json`, a missing tenant outcome, a wrong
role, or a keyless invocation each `fail()` the phase. After writing the bundle it re-judges it
through `evaluateFaultMatrixEvidence`, and then refuses if `fired !== required` or `required === 0` —
*"a profile that asserts nothing is not a campaign"*. The second step re-runs
`check-campaign-fault-matrix.mjs --evidence` over the retained bundle, the same shape the D1 lane's
`m1-fault-matrix` job uses, so a QA owner can point at a step rather than read the driver.

**Keyed-only, and why that is not a convenience.** In keyless mode only the control tenant is
dispatched, so the two enabled journeys have no observation at all. A phase that quietly emitted
fewer rows in one mode than the other would be the matrix's own silent-drift tripwire, inverted.

### 2.1 The two wrongly-excused spine cases

The spine `a2` §9.1 permits either running them on the spine lane **or** *"re-declar[ing] them
`pending` with a reason that is true of the lane that boots the override, and rout[ing] them to a
lane that will actually run them."* This ticket takes the second option, and the routing is now real
because the destination lane gained a step in the same change.

Both `pendingReason` fields are rewritten to say what is true: the old reason was measured against
the **base** compose file, `docker/d1/m1-spine.override.yml:137` sets
`AOA_WORKER_DISPATCH_ENABLED: "1"` on `worker-b`, and the cases are **UNBUILT**, not structurally
unavailable. Neither the old text nor the correction invents an owner: both name the planning
session on the DEP-015 lane.

---

## 3. GAP 2 — clause 5, redaction

The E5 audit's blocker: *"no declared planted-leak case with an unseeded control on either M1a
lane"*, after its author *"enumerated every case id in all three profiles … not one names redaction,
a canary, or a planted leak"*. It is explicit that the mechanism lane's secret-scan step is **not**
this clause's path: it is *"a CI scrub of the uploaded bundle"* that *"does not seed per-run canaries
through `synthesiseRunSecrets`, does not read the supervisor's scrubbed event stream, and has no
unseeded control"*.

**Structural first.** `redaction` is now a member of `CASE_FAMILIES` and a **required family in every
profile**, with an enforced shape: `plantedCanary`, `unseededControl`, the `streams` the marker is
asserted on, and the `producer` whose scrubbing is proven. A floor recorded only in a QA record is a
floor the next declaration edit can silently drop — which is exactly how this one came to be missing.

**Live on `M1-D1-SPINE`.** The deployed worker (`worker-b`, dispatch enabled, boot root
`networked-host.js`) leases a real job whose envelope carries a resolvable handle, so
`synthesiseRunSecrets` (`packages/worker-daemon/src/lease/secret-redemption.ts`) redeems a
**high-entropy canary unique to the run** and registers it.

**The unseeded control is a second MARKER in the same run, not a second run**, and that choice is the
point. A run whose streams are clean of the canary is indistinguishable from a run that emitted
nothing at all. So the same run carries a **twin** of identical shape and entropy that is never
registered, and the case requires all three facts together:

- the canary **absent** from the `job_events` payload stream **and** the worker's container log;
- the twin **present verbatim** on at least one of them;
- each stream's observed byte length **> 0**.

Remove the redaction and the canary appears beside its twin. Emit nothing and the twin is missing and
the case reds. **Neither arm passes alone**, and the evidence checker enforces all three as separate
row facts (`redactedOnAllStreams`, `unseededControlLeaked`, `streamBytesObserved`).

**Both streams, deliberately.** A scrubbed event stream beside an unscrubbed container log is still a
leak, so `REQUIRED_REDACTION_STREAMS` names both and a declaration that drops either one reds.

**Nothing secret reaches the bundle**: only booleans and byte counts are recorded — never the canary,
never the twin, never a stream excerpt.

---

## 4. GAP 3 — clause 4, lease-scoped secrets

`proven_in_d1` requires that *"Redemption after the lease ends, or on a different lease, is refused"*
in a D1-topology campaign. Two cases, both live and keyless on `M1-D1-SPINE`, both required by
**kind** in every profile (`REQUIRED_CREDENTIAL_REFUSAL_KINDS`), so a profile that declares one and
not the other reds.

| Case | Injection | Same-tenant positive control |
|---|---|---|
| `d1.credential.lease_expired_redemption_refused` | expire the lease deadlines **and reap** | the identical resolve on the **live** lease, taken FIRST, answers `resolved` |
| `d1.credential.wrong_lease_redemption_refused` | present **another live attempt of the same tenant's** lease | the identical request with the attempt's **own** lease answers `resolved` |

**Expiry alone is not the injection.** `docker/d1/campaign.env`'s E6F-14 THIRD bump records that
back-dating deadlines does not end a lease (*"the commit SUCCEEDED"*); the reaper is what converts an
overdue lease to a terminal one. So the two are paired, and the case treats the injection as fired
only when the expiry reports a **non-zero updated row count** — `assert.ok(result)` would be
vacuously true for any object, which is the same file's own recorded lesson.

**Two handles, never one.** The control and the injected arm use separate handles on the same
attempt, so a refusal can never be explained as *"already redeemed once"*.

**The expiry case classifies on a FENCE-family reason only** — `stale_fence` / `attempt_terminal` /
`target_revoked`, which `admitSandboxLocalResolution` passes through — and never on `malformed`,
which is the route's catch-all and proves nothing about the fence. The wrong-lease case deliberately
does **not** depend on which reason comes back, because the route must not be an oracle for which
lease exists; it depends on the **pair**, which is mutation-sensitive: remove the lease binding and
the control stays green while the injected arm flips to `resolved`.

The tenant's own `security.denied.secret_resolve` `activity_log` rows
(`server/src/services/secret-resolve-denial-audit.ts`) are read and **recorded** beside the wire
answer, and are explicitly **not** classified on: non-disclosure is a property of the protocol reply,
not of the tenant's audit trail, but the wire refusal is the contract.

### 4.1 ★ The measurement that unblocked both gaps

`d1.tenant.cross.secrets` records, of itself, that *"the fenced route collapses every refusal to
denied/malformed by design and this lane's fixture handle is unresolvable, so owner and attacker are
indistinguishable here and **the arm carries no control**."* Both halves were re-measured, and the
second is **false of the lane**:

- the route does **not** collapse everything. `admitSandboxLocalResolution`
  (`server/src/services/execution-secret-resolve.ts`) returns the broker denial's own reason, so a
  fence refusal reaches the wire distinct from a post-fence one; only the route's catch-all answers
  `malformed`.
- the handle is unresolvable only because **that fixture** points `ref_id` at a secret that does not
  exist (`seedExecutionSecretHandle`, by design). `docker/d1/m1-spine.override.yml:99` gives the
  control plane a real `AOA_SECRETS_MASTER_KEY`, and `seedSpineWorkerDrivenJob` **already** writes a
  Company secret through the server's own `secretService`.

So a live-lease resolve on this lane **can** answer `resolved`. That is what gives clause 4 a
positive control worth the name, what supplies the owner-vs-attacker discrimination the cross-tenant
secrets arm's own record says it lacks, and what puts a real redemption canary into clause 5's run.

---

## 5. Self-audit before the first review — and one real finding in my own diff

The M1-BUILD-RULES §A families were walked against this diff. One produced a finding, and it was
fixed at the chokepoint.

**Family 1 (redaction / secret collision).** `dexecModule` returns the container's whole
`stdout`/`stderr`, and `step()` prints both into its assertion message — into a **public CI job log**.
The script goes in on **stdin**, so an embedded value is never in argv; but if node cannot parse or
run it, node echoes the offending **source line** to stderr, and a postgres or secret-service error
could echo the value too. My two new helpers embed real per-run secret values. *A channel that leaks
only when the system is broken is still a channel.*

**Class:** *a harness helper that embeds a caller-supplied secret VALUE into a dexec script whose
streams are printed verbatim on failure.* **Sites enumerated** by
`grep -n "svc.create\|secretValue" tests/d1/lib/e6f-harness.mjs`: **2** —
`seedResolvableProviderSecretHandle` (new) and `seedSpineWorkerDrivenJob` (pre-existing, and now
value-parameterised by this ticket). **Both fixed**, via a new `secrets` option on `dexecModule` that
replaces each value in both streams before returning, longest-first so a value containing another is
not partly revealed.

The fix is at the **chokepoint, not per message**: a per-message fix would have to be repeated by
every future caller and every future assertion, which is how this gap class regenerates.

**Its limit, stated:** the container-log surface has a control (clause 5's case asserts the canary is
absent from `worker-b`'s log); the **dexec-stream surface has no positive control** — forcing a
script-parse failure on demand would mean shipping a deliberately broken helper. It is a hardening
with a named class and no red of its own, and it is recorded as that rather than as a proof.

Families 2–8 produced no finding: every control's non-vacuity is asserted as its own fact (§3, §4);
`composeServiceLogs` and `awaitSpineWorkerDrivenTerminal` carry timeouts and a `maxBuffer`; the
secret seed is idempotent by name and every case uses a per-run nonce; the clause-4 control and
injection differ **only** in the lease presented, which is the half under test; and every new refusal
path fails closed.

---

## 6. ★ Sweep the class, never the instance

**Class A — *a campaign floor recorded only in a QA record, with no structural enforcement, so the
next declaration edit can silently drop it*.** The E5 audit grades seven clauses. **All seven were
checked** for whether any profile declares a case:

| Clause | Case declared before this ticket? | Disposition |
|---|---|---|
| 1 — immutable staging | no | **Not a declaration gap.** `buildWorkspaceManifest` has no production caller and `buildJobEnvelope` sets `workspace: null`. A case would exercise nothing. **Build gap; owner: no M1 ticket composes the DAT-001 producer** (the audit's own blocker). |
| 2 — fenced object commit | yes (3 cases) | no action |
| 3 — patch quarantine | **no** — *"No campaign profile declares a quarantine case at all"* | **Not fixed, and why.** Re-measured at HEAD: `createPatchApplyService` and `createResultCommitter` have **zero production callers** (only definitions and comments). A declared case against an uncomposed symbol is the vacuous claim `E5-D03` forbids. **Build gap; owner: no M1 ticket composes `createPatchApplyService`** — filed here rather than left silent. |
| 4 — lease-scoped secrets | **no** | **fixed** (§4), and enforced by kind in every profile |
| 5 — redaction | **no** | **fixed** (§3), and enforced as a required family in every profile |
| 6 — denied egress | no | **Build gap.** `createFenceAwareEgressProxy` has zero production callers; the floor is a *recording* requirement both records already discharge. |
| 7 — brokered tool surface | yes (`*.tenant.cross.tool_calls`) | no action |

**Checked 7, found 3 undeclared floors (clauses 3, 4, 5), fixed 2, filed 1 with its reason and
owner.** Clauses 1 and 6 are build gaps the audit itself classifies as such.

**Class B — *a `pendingReason` measured against a file the certified lane does not boot*.** Every
`pending` case carrying `pendingKind: "structural"` was enumerated and re-measured at HEAD.
**Checked 3, found 2 false, fixed 2, verified 1 true:**

| Case | Verdict |
|---|---|
| `d1.reconcile.worker_startup_lease_probe` | **false** — corrected (§2.1) |
| `d1.provider.worker_terminal_mapping` | **false** — corrected (§2.1) |
| `d1.credential.production_reader_company_predicate` | **TRUE at HEAD.** `grep -rn ": DeviceLocalCredentialBroker"` over `server/src` and `packages/*/src`, excluding tests, returns exactly one implementation — `failClosedDeviceLocalBroker`, which throws. An admitted read and a denied one are indistinguishable on this lane. Left `pending`, reason unchanged. |

---

## 7. RED and GREEN

### 7.1 RED — the floors, before the declarations existed

With `redaction` and the two credential-refusal kinds added to the checker and **no** cases yet
declared, `node scripts/check-campaign-fault-matrix.mjs` exited **1** with **9 violations** — three
per profile, on the committed declaration:

```
FAIL: tests/d1/fault-matrix.json violates 9 DEP-018 declaration invariant(s):
  - declaration:required_family_missing: … profile M1-D1-SPINE declares no `redaction` case
  - declaration:credential_refusal_kind_missing: … profile M1-D1-SPINE declares no `credential`
      case with credentialCase.kind `lease_expired_redemption_refused` …
  - declaration:credential_refusal_kind_missing: … `wrong_lease_redemption_refused` …
  … the same three for M1a-D2-MECHANISM and for M1-D2-CODING
```

That is the floor doing its job against the exact tree the E5 audit graded.

### 7.2 GREEN — after the declarations

```
OK: tests/d1/fault-matrix.json declares 3 gate profile(s) and 83 case(s)
    (31 required, 52 pending), each with an injection, an observer and an expected
    classification; every profile carries the F10 tenant matrix …
```

83 cases, up from 73: **+9 declared** (three per profile: the redaction case and the clause-4 pair)
and **+3 flipped** from `pending` to `required` on `M1a-D2-MECHANISM`.

`node --test scripts/check-campaign-fault-matrix.test.mjs` — **31 tests, 31 pass, 0 fail** (was 25).

---

## 8. Mutation and positive-control table

Every new checker red is demonstrated by flipping exactly one fact against a zero-violation anchor,
in `scripts/check-campaign-fault-matrix.test.mjs`. **A checker whose reds are not demonstrated is a
check that evaluates nothing.**

| # | Mutation | Required red | Result |
|---|---|---|---|
| 1 | drop the `redaction` case from a profile (×3 profiles) | `declaration:required_family_missing` | red |
| 2 | `plantedCanary: false` | `declaration:redaction_without_planted_canary` | red |
| 3 | `unseededControl: false` | `declaration:redaction_without_unseeded_control` | red |
| 4 | `producer: ""` | `declaration:redaction_without_producer` | red |
| 5 | drop `events`, then drop `logs`, from `streams` | `declaration:redaction_stream_missing` | red, both |
| 6 | delete `redactionCase` | `declaration:redaction_case_missing` | red |
| 7 | put a `redactionCase` on a non-redaction case | `declaration:redaction_case_on_non_redaction` | red |
| 8 | drop either refusal kind (×2 kinds × 3 profiles) | `declaration:credential_refusal_kind_missing`, naming the kind | red, all six |
| 9 | `credentialCase.kind = "something_else"` | `declaration:credential_case_unknown_kind` | red |
| 10 | `credentialCase.positiveControl = false` | `declaration:credential_refusal_without_positive_control` | red |
| 11 | `credentialCase = "nope"` | `declaration:credential_case_not_an_object` | red |
| 12 | put a `credentialCase` on a non-credential case | `declaration:credential_case_on_non_credential` | red |
| 13 | refusal row `positiveControlPassed` ∈ {false, null, absent} | `evidence:credential_positive_control_missing` | red, all three |
| 14 | redaction row `redactedOnAllStreams: false` | `evidence:redaction_not_clean` | red |
| 15 | **redaction row `unseededControlLeaked: false`** — the control's own control | `evidence:redaction_control_did_not_leak` | red |
| 16 | `streamBytesObserved.<stream>` = 0, absent, or the whole object absent | `evidence:redaction_stream_vacuous` | red, all five |

Row 15 is the one that matters most: it is the arm that stops a run which emitted nothing from
reporting a clean scrub. Row 16 is its non-vacuity twin.

**The lane's own controls, unchanged and re-exercised:** the `m1-fault-matrix` job's
suppressed-injection control ran on both dispatched runs and the lane fails if it passes. Both new
credential cases and the redaction case honour `AOA_M1_FAULT_MATRIX_SUPPRESS_INJECTION`: suppressed,
the wrong-lease arm presents its **own** lease and the redaction case plants **no** canary, so each
records the non-injected outcome and the suppression control reds them.

---

## 9. CI jobs, with executed counts

| Lane / job | Run | Result | Executed |
|---|---|---|---|
| `d1-merge-train` / `m1-fault-matrix` — **trigger positive control**, ref `claude/m1a-harness-gaps`, `lanes: m1-fault-matrix` | **`35932452315`** | **`success`** | live campaign + its suppressed-injection control; `m1-spine` and `d1-merge-train` **`skipped`** (the selector's negative arm) |
| `d1-merge-train` / `m1-fault-matrix` — the three new cases | **`35933605253`** | `PLACEHOLDER_RUN2` | `PLACEHOLDER_RUN2_DETAIL` |
| `pr.yml` / `policy` → *Campaign fault matrix declaration (DEP-018)* | PR #593 | `PLACEHOLDER_CI` | `check-campaign-fault-matrix.mjs` + **31** unit tests |
| `ci-required` | PR #593 | `PLACEHOLDER_CI` | — |

**Guards, locally, before every push:** the 38 pure-node `pr.yml` guards plus
`node scripts/check-evidence-immutability.mjs --base origin/docs/replatform-program` — `failures: 0`.

---

## 10. Which cases await a keyed run, exactly

**No keyed workflow was dispatched by this session** (founder ruling F8). Stated precisely:

- **Run keylessly, now, on `M1-D1-SPINE`:** `d1.credential.lease_expired_redemption_refused`,
  `d1.credential.wrong_lease_redemption_refused`, `d1.redaction.planted_canary_scrubbed`.
- **Fire on the next keyed `m1-shipped-boot` run, through the new step:**
  `d2m.tenant.journey.A`, `d2m.tenant.journey.B`, `d2m.tenant.control_refused`.
- **Await a keyed run AND further harness work** (an injection this lane does not yet perform): the
  remaining twenty `M1a-D2-MECHANISM` cases, including the two routed from the spine
  (`d1.reconcile.worker_startup_lease_probe`, `d1.provider.worker_terminal_mapping`) and
  `d2m.credential.production_reader_company_predicate`.
- **Not scheduled at `M1a`:** every `M1-D2-CODING` case.

---

## 11. What this ticket does NOT do

1. **It writes no QA record and no milestone handoff.** A fresh attempt against the two failed gates,
   and an `a3` E5 audit, are distinct sessions' acts.
2. **It does not make `M1a` pass.** It closes harness gaps; the gates are re-run and re-judged by
   others.
3. **It does not close the E5 clause-4 or clause-5 grade.** It supplies the declared, firing cases
   those grades were blocked on. The grading is the audit author's.
4. **It runs no keyed workflow and spends nothing on E2B.**
5. **It does not touch `H-06`, DE-08, or any egress claim.** Clause 6 remains `not_proven`.
6. **The twenty remaining `M1a-D2-MECHANISM` cases are not closed** — §2, §10.
7. **Clauses 1, 3 and 6 remain undeclared**, each a build gap with its reason and owner recorded in
   §6 rather than left silent.
