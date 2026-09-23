# QA Result — `M1-D1-SPINE`, M1a candidate, `7be35ae6b771`, attempt 1

**Date (UTC):** `2026-09-24`
**Milestone:** `M1a`
**Record path:** `docs/replatform/milestones/M1a/qa/2026-09-24-m1-d1-spine-m1a-candidate-7be35ae6b771-a1.md`
**Scope slug:** `m1a-candidate`
**Revision:** `7be35ae6b7719877e61f54ab552de84de8491e7d`
**Attempt:** `1`
**Supersedes:** `none`
**Lane:** `M1-D1-SPINE`
**Result:** `pass`
**Failure class:** `none`
**Campaign start (UTC):** `2026-09-23T20:05:00Z`
**Campaign end (UTC):** `2026-09-23T20:11:00Z`

> This file is immutable from its first commit. A correction, rerun, changed decision, or changed
> revision creates a higher attempt and links this path through `Supersedes`.

**Author:** the `M1a` QA owner — a review session **distinct** from the planning session that took
the M1 decisions and dispatched the runs (founder ruling **F2**; scope-triage → *M1 rulings*). This
session dispatched no workflow and wrote no milestone handoff; the `Decision` is the planning
session's.

---

## 0. The one thing to read first

This record **passes the spine gate** and it **certifies nothing about the mechanism gate**. Read
§8 before citing it anywhere: this lane runs the **reference provider**, not E2B, and three of its
declared fault cases are `pending` and routed by name to the `M1a-D2-MECHANISM` lane — which, as
that gate's own record states, fired **none** of its 23 declared cases. A clause this record calls
"certified by the spine" is therefore certified **once, keylessly**, and nowhere else.

**This record does not mark `H-06` passed.** See §7.

---

## 1. Candidate, and the revision the evidence was produced on

| | |
|---|---|
| **Frozen candidate** | `7be35ae6b7719877e61f54ab552de84de8491e7d` |
| **Revision the cited run executed** | `8c01f4e94f8e25d7abaf524e8b266b809c67b8cb` |
| **Delta** | **one file**: `docs/replatform/epics/E6-deployment-test-harness/tickets/DEP-017-result.md`, +120 lines, 0 deletions (`git diff --stat 8c01f4e94 7be35ae6b`) |
| **Root-level files changed** | none (`git diff --name-only 8c01f4e94 7be35ae6b \| grep -v /` is empty) |

### 1.1 Byte-identity of every product subtree — re-measured by this session

Measured with `git rev-parse <rev>:<dir>` at both revisions. **Not inherited from the planning
session's statement; each pair was run here.**

| Subtree | `8c01f4e94` | `7be35ae6b` | |
|---|---|---|---|
| `server` | `0f3beb68836583f6e994c93a1cbb4d12633cad51` | `0f3beb68836583f6e994c93a1cbb4d12633cad51` | **identical** |
| `packages` | `e0c74fc0070eea339d7d21d9fbac16416ea9f51f` | `e0c74fc0070eea339d7d21d9fbac16416ea9f51f` | **identical** |
| `ui` | `d21b1b7a26588abd949667fbc70d59a5bb4ba69c` | `d21b1b7a26588abd949667fbc70d59a5bb4ba69c` | **identical** |
| `scripts` | `5b37e11ebac822ab9e1d0828c0c4a3124ca85f20` | `5b37e11ebac822ab9e1d0828c0c4a3124ca85f20` | **identical** |
| `.github` | `9a9cf9a424217e829164bfd41558b7f4aaf91194` | `9a9cf9a424217e829164bfd41558b7f4aaf91194` | **identical** |
| `docker` | `e765f70c1043ebd9037f72d181e2258ad1bc70bf` | `e765f70c1043ebd9037f72d181e2258ad1bc70bf` | **identical** |
| `tests` | `bfb4fba5a0e7637a7082489cb7096f5c3296fac2` | `bfb4fba5a0e7637a7082489cb7096f5c3296fac2` | **identical** |
| `e2b` | `bea90c8907042093a0b52cfca07daac63de9bac6` | `bea90c8907042093a0b52cfca07daac63de9bac6` | **identical** |
| `cli` | `0dd693e752e04eb7513be6628cabae683d592ba3` | `0dd693e752e04eb7513be6628cabae683d592ba3` | **identical** |
| `docs` | `f76b9677ece0f30c442962120649ae9857b69d8a` | `797b608af3e04d4da355e7c49101b4af5aedfcd8` | **differs** (the one file above) |

### 1.2 My judgement on the tree-equivalence question — stated plainly

**A run on `8c01f4e94` satisfies this gate for the candidate `7be35ae6b`, and the reason is a
written rule, not a precedent I am stretching.**

`epic-regrooming/qa-handoff-recovery.md` §1 says, in the paragraph immediately after the freeze
list: *"Documentation-only disposition commits may follow an independently reviewed implementation
revision, but the QA record must state both and prove the candidate code is byte-identical where it
carries evidence forward."* That is exactly this case, and §1.1 is that proof. The sole delta is a
ticket **result** record — a disposition document — and every directory that can change what the
lane builds, boots or asserts (`server`, `packages`, `scripts`, `tests`, `docker`, `e2b`,
`.github`) is byte-identical, so the lane's *behaviour* at `8c01f4e94` **is** its behaviour at the
candidate. The E2 `a6` handoff's "byte-identical to program tip" carry-forward is a consistent
precedent, but it is not what this rests on.

**The limits of that judgement, stated so a later reader cannot widen it.** It holds because the
delta is doc-only **and** measured subtree by subtree. It would not hold for a one-line source
change, and it does not extend to the `M1a-D2-MECHANISM` record — that run was on the candidate
exactly, and needs no such argument. I record it as an accepted, reasoned carry-forward; if the
`M1a` decision owner prefers a re-run of `d1-merge-train` on `7be35ae6b`, nothing in this record
resists that, and it would cost one keyless lane.

---

## 2. Topology and environment

| Field | Value |
|---|---|
| Lane | `.github/workflows/d1-merge-train.yml`, run **`35912752449`**, event `push` |
| Jobs consumed | **`d1-merge-train`** (17 steps: 15 `success`, 2 `skipped`), **`m1-spine`** (19/19 `success`), **`m1-fault-matrix`** (18/18 `success`) |
| Profiles | `m1-spine` (`DEP-016`, worker-driven by `DEP-019`) and the `M1-D1-SPINE` fault matrix (`DEP-018`) |
| Control planes | 1 (`control-plane`) |
| Workers | **1 separately deployed worker**, and `executor: "worker"` is recorded in every profile bundle |
| Provider | reference/fake provider (`packages/sandbox-fake-provider`) — **not E2B** |
| Database / object store / fault injector | PostgreSQL, MinIO, Toxiproxy, all from `docker-compose.d1.yml` |
| Images | built in-job by `docker/images/build.sh`; SBOM, provenance and `trust-root.pub.pem` retained in artifact `d1-image-chain-35912752449` |
| Tenants (**F10**) | 3 Organizations: enabled `0d016a00-…-00000000000a` and `0d016b00-…-00000000000b`; control `0d016c00-…-00000000000c` |
| Rollout digest | `rolloutSha256 02cebb95542abbd49ff4b646d8ee1dc730ce584e49d6287c08b04f1160a9012f`; `resolved` = `canary / canary / off` |
| Crew switch | `crewRaw: null`, `crewEnabled: false` |
| Tool surface | `toolSurfaceRaw: null`, `toolSurfaceArmed: false`, `organizationToolSurface` **false for all three** Organizations |

> ★ **`E6-F023` discipline applied.** The run's own conclusion was not relied on. Each job's
> per-step conclusions were read from the API, and every assertion below comes from the **downloaded
> evidence artifacts**, not from a green tick.

---

## 3. Commands and artifacts read

| What | Result |
|---|---|
| `gh run view 35912752449 --json jobs` | three jobs, all `success`, step conclusions as §2 |
| `gh run download 35912752449` | 40 files across `d1-image-chain-…`, `m1-spine-evidence-…`, `m1-fault-matrix-evidence-…` |
| `m1-spine-evidence-…/passing/manifest.json` | `aoa-d1-evidence-bundle/v1`, `reason: "m1-spine PASSING profile on 8c01f4e94f8e25d7abaf524e8b266b809c67b8cb"`; sections `logs` 7 files / 875 398 B, `events` 11 / 15 640 B, `dbState` 2 / 592 424 B, each with a SHA-256 |
| `m1-fault-matrix-evidence-…/profile/…json` | `profile: "M1-D1-SPINE"`, `ticket: "DEP-018"`, `suppressInjection: false` |
| `m1-fault-matrix-evidence-…/suppressed-control/…json` | same profile, `suppressInjection: true` |
| `tests/d1/fault-matrix.json` @ candidate | the declaration; `M1-D1-SPINE` = 28 cases, 3 `pending` |
| `node scripts/check-campaign-fault-matrix.mjs` @ candidate | green |

---

## 4. Assertions and evidence

| ID | Class | Required | Observed | Evidence | Result |
|---|---|---|---|---|---|
| `SPINE-TOPO-1` | REQUIRED | one control plane, **one separately deployed worker**, external PG, object store, reference provider | as required; `executor: "worker"` in the profile bundle, with a red control (step *"POSITIVE CONTROL — with the deployed worker NOT the executor, the claim MUST NOT stand"*) | job `m1-spine` steps; profile JSON | `pass` |
| `SPINE-F10-1` | REQUIRED | ≥2 enabled Organizations + 1 control, asserted from the rollout digest | 2 + 1; `resolved` `canary/canary/off` | profile `replicas.control-plane` | `pass` |
| `SPINE-F10-2` | REQUIRED | per-tenant journey correctness for **each** enabled tenant | `d1.tenant.journey.A` and `.B`: `attemptStatus succeeded`, `acceptedThroughSeq 3`, `violations: []` | fault-matrix `detail` | `pass` |
| `SPINE-F10-3` | REQUIRED | cross-tenant denial on lease, read, cancel, events, secrets, staged inputs, outputs, cost rows, tool calls — **each with a same-tenant positive control** | all nine fired, all `denied_with_same_tenant_positive_control`, all `positiveControlPassed: true`. Measured pairs: events `hostileUpload 401 unauthorized` / `ownUpload 200 accepted` / `hostileAck 409 stale_fence`; lease `409 stale_fence` / `200 renewed`; staged inputs `409` / `200 upload_granted`; outputs `409` / `200 committed`; cancel `not_found` / `queued` with a fenced command; read `foreignScopeEventCount 0` / `ownScopeEventCount 1` | fault-matrix `cases` + `detail` | `pass` **with the §5 secrets caveat** |
| `SPINE-F10-4` | REQUIRED | the four RLS-less legacy tables filtered, **with an anti-vacuity foreign row** | `cost_events`, `activity_log`, `task_outputs`, `provider_credentials`: each `filtered_by_query_predicate_not_rls`, `positiveControlPassed: true`, **`antiVacuityObservedForeignRow: true`**. Counts: own 1 / foreign 0 / unscoped 2 (`cost_events`), own 2 / foreign 0 (`activity_log`), own 1 / foreign 0 (`task_outputs`, planted id `2e08f22f-…`), own 1 / foreign 0 (`provider_credentials`) | fault-matrix `detail.legacyTables` | `pass` |
| `SPINE-F10-5` | REQUIRED | the control Organization is **refused** | `d1.tenant.control_refused` → `legacy_for_organization_disabled`; rollout resolves `off` | fault-matrix `cases` | `pass` |
| `SPINE-COST-1` | REQUIRED | exactly **one** `cost_events` row **with cost > 0** per enabled tenant | `costRows: 1` on both journeys; `legacyTables.cost_events.ownCents: 83`, `foreign: 0` | fault-matrix `detail` | `pass` |
| `SPINE-COST-2` | REQUIRED | a **suppressed-usage positive control must red** | job step *"POSITIVE CONTROL — with usage suppressed, the profile MUST go red"* passed; its bundle (`positive-control/`, `usageMode: "suppressed"`) shows `providerUsage: null`, `usageEvents: []`, `costRows: []` | `m1-spine` job + bundle | `pass` |
| `SPINE-COST-3` | REQUIRED | a **duplicate usage event must red** | job step passed; `duplicate-usage-control/`, `usageMode: "duplicate"`, `providerUsage 120000/30000` | `m1-spine` job + bundle | `pass` |
| `SPINE-AUDIT-1` | REQUIRED | operator-visible audit parity | both journeys record `activity: ["job.attempt_started","job.attempt_terminal"]`, and applied `activity_audit` receipts carry `sourceIdentity activity:<companyId>:<eventId>` | profile bundle `receipts` | `pass` |
| `SPINE-FENCE-1` | REQUIRED | lifecycle / fence behaviour | `d1.cancel.unleased_attempt` → `cancelled_directly_without_command`; `d1.cancel.leased_attempt` → `cancel_requested_with_fenced_command` (fence token recorded, `commandSeq 1`, `commandKind cancel`) | fault-matrix | `pass` |
| `SPINE-CLEAN-1` | REQUIRED | cleanup / recovery | `d1.fault.object_store.truncated_upload` → `fenced_commit_refuses_unverifiable_object`; `d1.cleanup.orphan_object_swept` → `uncommitted_object_deleted`; `d1.reconcile.expired_lease_reaped` → `single_winner_retry_minted`; `d1.restart.control_plane_process` → `durable_lease_state_survives_restart`; `d1.fault.link_cut.*` both fired | fault-matrix | `pass`, **narrowed by §5** |
| `SPINE-MATRIX-1` | REQUIRED | every **required** declared case fires | `summary`: `declared 28, required 25, pending 3, fired 25` | fault-matrix `summary` | `pass` |
| `SPINE-MATRIX-2` | REQUIRED | a **suppress-every-injection** control reds | job step passed; suppressed arm `fired 16` vs `25` | suppressed-control bundle | `pass`, **narrowed by §5** |
| `SPINE-FLAGS-1` | REQUIRED | crew switch off; tool surface off; no excluded flag on | `crewEnabled false`; `toolSurfaceArmed false`; `organizationToolSurface` false ×3 | profile `replicas` | `pass` |
| `H-06` | HARD | metadata / private / worker-control / control-plane destinations denied, incl. direct-IP, redirect and DNS-rebinding variants | **not exercised on this lane and NOT PASSED** — see §7 | — | **`recorded`, not `pass`** |
| `EVID` | REQUIRED | evidence retained **on pass** | `passing/` bundle collected *before* any control mutated the stack, plus `post-controls/` | `m1-spine` steps 10 and 14 | `pass` |

---

## 5. What this record does NOT establish — read as carefully as §4

1. **No real provider.** Every assertion above is on the **reference provider**. Nothing here is
   evidence about E2B create, execute, teardown, or a real charge.
2. **Three declared cases never ran, and their destination lane did not run them either.**
   `M1-D1-SPINE` carries three `pending` cases, each with a declared kind, reason and owner (which
   is what `check-campaign-fault-matrix.mjs` requires, and it is green):
   - `d1.reconcile.worker_startup_lease_probe` — structural; routed to *"DEP-015 shipped-boot lane
     (keyed)"*. **`WRK-013`'s deployed-boot restart case is therefore uncertified by any campaign.**
     Its evidence remains `startup-reconcile-composed.component.test.ts`, an in-process test.
   - `d1.provider.worker_terminal_mapping` — structural; routed to the same lane. **The deployed
     worker's terminal mapping is uncertified by any campaign.**
   - `d1.credential.production_reader_company_predicate` — structural, routed by `E6-D003` to
     `d2m.credential.production_reader_company_predicate`. **Also uncertified.**

   I verified the structural reason at source: `AOA_WORKER_DISPATCH_ENABLED` is declared ABSENT for
   both D1 workers (`scripts/lib/d1-dispatch-declared.mjs`), so a D1 worker holds no lease to
   reconcile. The routing is honest; **the destination did not deliver.** That is §8, and it is the
   single most important thing in this record.
3. **The suppression control does not cover the 16 tenant cases.** In the `suppressInjection: true`
   arm, every `d1.tenant.*` case still reports `injectionFired: true` (16 of 25). The control
   discriminates only the 9 non-tenant fault cases. The tenant cases carry their own same-tenant
   positive controls, which is a different and adequate control — but the suppression arm is not it.
4. **Two fault cases report the identical `observedClassification` in both arms.**
   `d1.fault.link_cut.worker_to_control_plane` (`lease_reclaimed_and_late_ack_refused`) and
   `d1.fault.link_cut.control_plane_to_postgres` (`database_link_severed_and_restored`) read the
   same with injection on and off; only `injectionFired` differs. `d1.restart.control_plane_process`
   is a third. For those three the *observed outcome* is not caused by the injection.
5. **The cross-tenant secrets case is half-uncontrolled, by its own admission.** Its
   `routeObservationOnly` block states: *"the fenced route collapses every refusal to
   denied/malformed by design and this lane's fixture handle is unresolvable, so owner and attacker
   are indistinguishable here and the arm carries no control."* The classified denial is the RLS row
   read (`foreignScopedRows 0 / ownScopedRows 1`). The route arm is recorded, not certified — and
   its named successor, `d2m.tenant.cross.secrets`, is `pending`.
6. **This is not D1.** `D1-00` requires at least two workers; this lane deploys one. It cannot
   complete E6, cannot substitute for any E3–E6 normative gate, and is **non-promoting**.
7. **Nothing about tools or output.** The tool surface is off on every replica by design (`M1a`
   exempts `tools` + `output`). `task_outputs` appears here only as a legacy-table isolation
   surface, never as evidence that output works.
8. **`E3-15-budget` remains `unwired` in the register at the candidate**, deliberately: its reason
   says the D1 units are canned by the reference provider and promotion waits on the `WRK-018` keyed
   acceptance. This record's `SPINE-COST-1` pass is a pass of the **spine profile's** assertion, not
   a promotion of that clause. *(Its reason text cites `cost_cents 81` from the `DEP-016`
   acceptance run; the run this record cites measured **83**. Different runs, not a contradiction —
   recorded so nobody reconciles the two by editing one.)*

---

## 6. Failures

None. No assertion in §4 failed, and the run's three jobs each reported every step `success` except
two deliberate `skipped` steps in `d1-merge-train`. **Failure class: `none`.**

---

## 7. DE-08 residual, credential taxonomy, and H-06 — required by scope-triage

`scope-triage.md` → *Dormant default-deny egress qualification*: **all three** partial gates must
record the DE-08 residual and the credential-taxonomy mitigation explicitly, and **none** may mark
`H-06` passed. This section discharges that for `M1-D1-SPINE`.

- **The DE-08 residual is accepted and unresolved.** The checked-in default-deny / allowlist shape
  is **not** an enforcement claim while the provider path does not enforce it. At the candidate
  `createFenceAwareEgressProxy` (`server/src/services/egress-proxy.ts`) has **zero production
  callers** and the register key `E5-6-denied-egress` is **`unwired`** — re-measured by this session
  with `countProductionCallers`. No document may say sandbox egress denial passed because a policy
  object was constructed, and this one does not.
- **`H-06` is NOT passed by this record.** `H-06` requires metadata, private, worker-control and
  control-plane destinations to remain denied, **including direct-IP, redirect and DNS-rebinding
  variants**. The DE-08 scope decision did **not** amend it. This lane has no sandbox and probes no
  such destination, so it produces **no** H-06 evidence of any kind. `H-06` is recorded as
  **`recorded`, not `pass`**, in §4. ★ The companion `M1a-D2-MECHANISM` record measured metadata as
  **reachable** from a real sandbox; that measurement belongs to that record and is cited here only
  so no reader infers silence means denial.
- **The credential-taxonomy mitigation, as it applies here.** The accepted managed-shared model is:
  host, operator, control-plane, cross-tenant and unrelated connector credentials do not enter the
  sandbox; only the participating Organization's approved runtime credential and scoped data are
  exposed. On this lane the mitigation's *storage-side* half is what is exercised —
  `d1.tenant.legacy.provider_credentials` shows own 1 / foreign 0 with an observed foreign row, on
  the non-owner `aoa_app` pool, filtered by query predicate because `provider_credentials` has **no
  RLS**. The *sandbox-side* half — the live env-absence probe over 18 credential classes — runs on
  the mechanism lane only (`DEP-017`, ruling F9); it is **not** evidence this record carries.
- **Consequence, stated as the triage requires it.** Full `D1`/`D2` and any `E6` or `E7` completion
  require live evidence satisfying `H-06` or a separately reviewed and approved amendment to
  `test-gates.md`. Neither exists. This record unlocks nothing beyond `M1a`.

---

## 8. The cross-record finding — and why it is here, not only in the mechanism record

Three `M1-D1-SPINE` cases are `pending` because D1's topology structurally cannot host them, and
each names the `M1a-D2-MECHANISM` / `DEP-015` keyed lane as its owner. I measured what that lane
delivered:

- `tests/d1/fault-matrix.json` at the candidate declares **23** cases for `M1a-D2-MECHANISM`, and
  **all 23 carry `evidence: "pending"`**.
- `.github/workflows/m1-shipped-boot.yml` at the candidate contains **no fault-matrix step** and its
  evidence artifact contains **no fault-matrix bundle** (22 files, listed in the mechanism record).
- Therefore the keyed run `35920425288` fired **zero** declared cases, and the three routed spine
  cases remain unfired at their destination.

I record this here because a reader of the spine record alone would see three neatly owned `pending`
rows and reasonably assume they were satisfied elsewhere. **They were not.** The routing is sound;
the destination is empty. The `M1a-D2-MECHANISM` record at
`./2026-09-24-m1a-d2-mechanism-m1a-candidate-7be35ae6b771-a1.md` carries `Result: fail` for this
reason among others.

This does **not** change this record's `Result`. A gate is answerable for the clauses its topology
can host, and this lane fired all 25 of them with controls. It is the destination lane that owes the
other three.

---

## 9. Cleanup

The `m1-spine` and `m1-fault-matrix` jobs each ran their teardown step (*"Tear down the … stack"*),
both `success`. Evidence bundles were collected **before** any negative control mutated the stack
(`passing/`) and again afterwards (`post-controls/`), and uploaded on pass. No secrets appear in
this record; ids quoted are run, job, attempt, lease, command and Organization identifiers, plus one
fence token already present in the public evidence bundle for a disposable fixture attempt.

---

## 10. Gate effect

- **Permits:** the `M1a` `M1-D1-SPINE` clause of exit criterion 2, on the candidate
  `7be35ae6b7719877e61f54ab552de84de8491e7d`, via the §1.2 documentation-only carry-forward.
- **Permits:** exit criterion 8's `Result: pass` requirement **for this gate only**.
- **Blocks nothing, and promotes nothing.** `M1-D1-SPINE` is **non-promoting** (scope-triage →
  *Normative-gate boundary*). It does not change any epic's status, is not `D1`, and cannot support
  an `E3`–`E7` completion handoff.
- **Does not satisfy** exit criterion 3 (`M1a-D2-MECHANISM`), criterion 4 (which `M1a` does not
  carry), criterion 5 (the live env-absence observation is the mechanism lane's), criterion 6's
  rollback rehearsal, or criterion 7 (the E5 `a2` audit).
- **Open at the candidate, and the `M1a` decision owner's to weigh:** `DEP-015`, `DEP-017` and
  `WRK-018` all carry `Status: gate_review` in their result records at `7be35ae6b`, so exit
  criterion 1 (*"all required ticket results approved with no pending review sentinel"*) is **not
  met by the tree this record attests**. Dispositioning them is a distinct reviewer's act, not this
  QA owner's.
