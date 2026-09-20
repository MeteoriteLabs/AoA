# E10 — Desktop, Migration, and Realtime — Implementation Plan (SCOPED)

**Plan status:** `scoped` — deliberately **not** a full ticket-by-ticket implementation plan, with
**one exception** (`MIG-009`, §8.1). E10's cutovers sit at milestone **M2**, two milestones
downstream of HEAD. The programme's doctrine, `GO-BOOK.md:1906-1908`, is that later phases get
scope and sequence only:

> *"Sprints 6–9 have scope and sequence, not implementation plans. Deliberate: they depend on what
> dispatch looks like once live, and a plan written five sprints early goes stale — which is the
> exact failure this audit exists to fix."*

Restated at the milestone layer in `epic-regrooming/scope-triage.md`: *"Scope and gates only
— deliberately NOT implementation plans. … Each milestone's detailed plan is written just-in-time,
at its own Step 0, against HEAD."*

What this file owns is the part that does not go stale: what is already built and provable, what E10
consumes, what is measurably blocked, what the exit gate says, what is out of scope, and what
reopens any of it. §8 names every E10 ticket id with a disposition; only `MIG-009` carries full
ticket detail, because founder decision **D-9** moved it out of the deferred set and onto the
M0/M1 critical path.

---

## ★ 0. E10 has two directories. This is a known defect, and this plan does not fix it.

There are two epic folders on disk for one epic:

| Path | Contents | Indexed? |
|---|---|---|
| `docs/replatform/epics/E10-desktop-migration-realtime/` | `README.md`, `findings.md`, `tickets/` (the MIG set) | yes — `epics/README.md` links it as *"E10 Desktop/migration/realtime"* |
| `docs/replatform/epics/E10-desktop/` | **a bare `tickets/` directory** holding `DSK-001`…`DSK-004` — no `README.md`, no `findings.md` | **no** |

`epic-regrooming/RECONCILIATION-2026-09-20.md:148-150` records it: *"`epics/E10-desktop/` is a bare
`tickets/` directory — the only one of 13 epic folders with neither README nor `findings.md`, in no
index, and its own tickets point evidence at a `qa/` directory that was never created."*

**This plan is written once, in the canonical folder, and covers BOTH the DSK and the MIG tickets.**
No second plan is created and **no file is moved**. Consolidation is a *recommendation pending a
decision*, not an action taken here, for three measured reasons:

1. Six files outside `E10-desktop/` cite paths under it by name, including two E4/E5 findings that
   quote `DSK-001-design.md:351`, `:431` and `DSK-002-design.md:15-17` by line. A move rots those
   citations, which is the programme's dominant failure class.
2. `DSK-001-design.md:418` and `DSK-001-enrollment-client-plan.md:354` direct EVID-04 evidence to
   `docs/replatform/epics/E10-desktop/qa/` — a directory that does not exist. Consolidating means
   deciding where that evidence lands, which is an owner's call.
3. `artifact-policy.md`'s epic-folder contract is per-epic; merging two folders into one is an
   epic-identity decision, and this plan has no authority to make it.

**Recommendation, for the owner:** merge `E10-desktop/tickets/*` into
`E10-desktop-migration-realtime/tickets/` in a single commit that also re-points the six external
citations by symbol, and create the `qa/` directory the DSK tickets already name. Until that is
ruled, treat both folders as one epic and read this plan as covering both.

★ E10 also has **no `decisions.md`**, which `artifact-policy.md`'s epic-folder contract requires of
an active epic. Any epic-local decision taken during M2 creates it.

---

## 1. Status and milestone position

| Item | Recorded value |
|---|---|
| Epic status | `backlog` (`README.md:3`). Only the Integration Gate Owner changes it, on a committed `pass` QA record and a committed `pass` completion handoff for one exact candidate. |
| Plan written at | `e710d8b54` on branch `claude/plan-spine-m1-split`. Every `file:line` below was read at this revision. |
| Milestone position | **M2 — sink cutover**, `scope-triage.md §*The milestone sequence — M1a through M5*`: *"the legacy in-process paths stop owning execution"*, gate `M2-CUTOVER` *(to be named)*, blocked by M1b. |
| M2 scope, verbatim | `scope-triage.md`: *“`MIG-005` (Commander), `MIG-006` (crew — units shipped, cutover deferred), `MIG-007` (extraction). The four parity bridges are **not** here — three are `M1a` (D-8) and the fourth, `jobApprovalBridge`, follows its sink.”* ★★★ **`E10-1-drain` IS NOT IN M2's SCOPE — it is INHERITED, already wired at `M1a`.** *Corrected 2026-09-20 (fourth round): this reproduced a sentence ending “…and `E10-1-drain` promoted from dormant on a real `drainAll` trigger”, which the companion change deleted as self-contradictory — `M1a` owes the drain AND its trigger (D-9) and `M1a` criterion 6 needs a rehearsal that uses it, so a candidate reaching `M2` with it dormant could not have passed `M1a`. Quoting the deleted text would have re-asserted the contradiction from inside E10's own plan.* |
| M2 entry, verbatim | `scope-triage.md`: *“`M1b` passed — which carries `M1a`'s wired `E10-1-drain` with it. `E10-F001`'s prerequisite analysis re-measured at HEAD — it is the finding that records that *no* Sprint-6 sink was buildable, and it must be re-tested rather than inherited.”* |
| M2 exit, verbatim | `scope-triage.md`: *"For each cut-over sink: the distributed path owns the write, the legacy path is provably not reached, and rollback is rehearsed. `E3-5-product-approval`, `E3-17-output`, `E3-audit-parity-bridge` and `E10-1-drain` all `wired` with real callers."* |
| ★ The M0/M1 exception | **`MIG-009` is disposition B, not deferred.** `scope-triage.md` (**D-9**): *"exit criterion 6's rollback rehearsal USES the drain. MIG-009 shipped it deliberately unwired (`E10-1-drain` dormant); wiring it gives criterion 6 a mechanism rather than a runbook."* Reiterated at `:341`: *"the rehearsal USES the `MIG-009` drain, so `E10-1-drain` must be wired — not a manual runbook."* |
| Desktop lane | Retained, not deferred-to-nothing: `scope-triage.md §*Retained after the first milestone*` lists *"installed desktop packaging, updater, desktop beta, and device-loss campaigns"* under **Retained after the first milestone**. `DSK-003`/`DSK-004` are disposition **C1** — shipped, retained, not required by M1 (`:37`). |
| Zero-file tickets | `MIG-001` and `MIG-004`, disposition **X**. `find docs/replatform -iname "*MIG-001*" -o -iname "*MIG-004*"` returns nothing. `scope-triage.md` is explicit that the C/D wordings are *"**vacuous** for these: there is no owner, design, or acceptance intent to preserve."* |
| Open findings | `E10-F001` (**HIGH**, `unowned`). `E10-F002` is **resolved** by MIG-010 Unit 2.3, `597e77715`. |

---

## 2. What is already built — per ticket, from evidence

The most valuable section of a scoped plan, and the one a later planner must not re-derive. Each
entry states what shipped **and** what the shipped thing does not prove.

### Desktop lane

**`DSK-001` — device custody and enrollment client — CLOSED (four lanes, all CI-green).**
Lane D's result: *"**This closes DSK-001.** Lanes A, B, C and D are all landed and CI-green."*
Lane A shipped the six-valued outcome classifier, `identity-store.ts` `load()` failing closed on all
four fault kinds, a Windows DPAPI store using an `[IO.File]::Open(path,'CreateNew')` CAS,
`planVaultCommand` with **no secret parameter** (key material crosses stdin only), the five-field
device-identity envelope, `enrollOnce` + a `--reset-identity` guard, `desktop-hello.ts`,
`custody-bootstrap.ts`, and `scripts/check-worker-keystore-boundary.mjs` with an 18-case adversarial
corpus. Lane B shipped the rejection-vocabulary gate, a widened `DeviceLocalHandoff` with a frozen
key allowlist, `DeviceLocalCredentialBroker` + `failClosedDeviceLocalBroker`, and **migration 0259**
(6 admit / 21 reject vectors, 17 corpus tests, 65 unit tests). Lane C shipped DSK-00 negative
closure — `executionTargetToAdapterConfig` throws for `desktop`, `e2b` and unhandled kinds; a
flag-off create of a `desktop` target is refused 403; and **`scripts/check-desktop-surface-disabled.mjs`**
runs in the always-on `policy` lane. Lane D shipped the redacted projection,
`desktopDeviceLeakKeys`, and `GET /organizations/:orgId/desktop-devices` mounted inside the flag
block.

Not proven: *"`device_local` still has **no production consumer**. Its only one — the fence-aware
egress proxy — correctly *denies* it, and that proxy itself has zero production callers"* (Lane B
§2). macOS is *"entirely unverified"*, code-signing certificates are outstanding, and
*"`bin/desktop-host.ts` and `bin/aoa-worker-desktop.ts` are a **developer host, not a product**"*
(Lane A §6–§7).

**`DSK-002` — keystore isolation and activation policy — shipped, one clause PARTIAL.**
Four lanes, 46 mutants / 46 killed: the `.aoa/` keystore leak fix, capture-root stat, grant↔device
binding, isolation capabilities, the fence-deadline gate, and the activation policy
(`clampActivationExpiry`, ranking `proxy_endpoint > env_name > file_path`). Its §7 is blunt about
what it refused to guess: *"**Lane D shipped the POLICY, not the wiring, and that is a decision.** …
No lease deadline reaches that layer today… A decorator written now would be guessing at an
interface DSK-003 defines."* And: *"**Clause (4) remains PARTIAL** … A same-user child process can
read the OS keychain by construction; real containment needs DSK-003's least-privilege host… That
is a placement refusal, not a containment guarantee, and calling it clause (4) would be dishonest."*

**`DSK-003` — desktop host, control surface, installer admission — shipped, partial closure.**
156 mutants / 156 killed. Owner-only custody rule, local control token, default-deny command
authorization, uninstall-plan identity policy, `check-embedded-secrets.mjs` with a CI self-test,
per-user unprivileged autostart, fail-closed installer admission, host state record with stale-pid
defence, `GET /instance`, the composition root, control-command routing, control-token provisioning,
real effects by default, and the staging manifest.

Not proven (§6): *"**The staging MANIFEST exists; the assembler does not.** … **No installer PACKAGE
is produced.** … it does not ship a `.pkg`, `.msi` or staging root."* Rotation is a named residual;
repair and diagnostics are not built; production code-signing certificates, Apple notarization
credentials and macOS hardware remain operator evidence.

**`DSK-004` — signed update, drain, rollback — shipped, unit-proven only.**
73 mutants / 72 killed + 1 documented equivalent. `update-admission.mjs` (detached signature binding
digest + from + to + platform), `update-compatibility.ts` / `negotiateProtocolVersion`,
`planUpdateSwap`, `writeVersionPointer` (temp-file + rename), `planRollback`,
`assertVaultOutsideInstallRoot`, `createUpdateDrainSteps` composing `createLeaseLifecycleSteps`,
`runDrainBeforeSwap`, and a version deny-list at admission. Clauses 1/4/5/6/7 Done, 2 Partial, 3
Done structurally.

Not proven (§5): *"**No artifact to install.** DSK-003 recorded that no `pnpm deploy` invocation
yields a shippable root, so there is no `.msi`/`.pkg` and therefore **no end-to-end update run**."*
Health confirmation is *"an injected boolean"*; `installedVersions` is *"an injected array"*; clause
2's policy-cancel/fence branch is unwired; `runDrainBeforeSwap` *"awaits each step without a
deadline. A drain that never settles hangs the update."*

### Migration lane

**`MIG-002` — routing dial (slice 1) + convergence (slice 2) — both landed.**
Slice 1: *"the dial is live and per-sink. 11 mutants, 11 killed"* — per-resolution re-read memoized
on the raw env string (rollback needs no restart) and an optional `sources` list filtering by
`sourceKind`. Slice 2: *"inherited deferral #2 is CLOSED. The lease reaper has a live trigger, and a
reaped attempt now converges its heartbeat run"* — 17 mutants, 17 killed; the reaper returns
per-lease identities and the sweeper projects terminals through one projection with two triggers.

★ **Two clauses in these results are stale at HEAD and must not be re-cited.** Both say
*"`listActiveAttempts` has no SQL implementation"* — `MIG-009` shipped it
(`server/src/services/job-distributed-drain-store.ts`, verified at HEAD). Slice 2's
*"its rollback gate calls `assertRollbackSafe(organizationId)` while all three implementations take
a **companyId**"* is likewise fixed: the dep is re-typed to `companyId` at
`server/src/services/job-distributed-drain.ts:78`, and `listOrganizationCompanyIds` at `:60`
enumerates the org. Both are frozen results, so the correction belongs in a finding, never an edit.
What survives: the revocation fan-out is still unwired.

★★★ **THE KILL-SWITCH WRITE API HAS SHIPPED — so treating it as future `REL-005` work is a FALSE
BLOCKER.** *Corrected 2026-09-20 (fifth round), verified at source.* `server/src/routes/instance-settings.ts`
mounts authenticated `GET` (`:87`), `PUT` (`:92`) and `DELETE` (`:131`) `/instance/kill-switches`,
gated by `assertCanManageInstanceSettings`, over `setKillSwitches` (`:192`) / `clearKillSwitches`
(`:208`) in `server/src/services/instance-settings.ts`. The route's own comment says it plainly:
*“this is the missing writer so an operator no longer needs hand-SQL to throw a switch.”*

★ **One correction to the report that raised this:** it also said the shipped path includes
activity logging. I did **not** find an activity write in either the route or the service — so the
switch is authorized but, as far as I measured, **not** actor-attributed in `activity_log`. That is
a separate gap and is not claimed closed here.

★ **The remaining work is DRAIN INTEGRATION AND GRANULARITY, not creating a write path** — how the
existing dimensioned switch triggers the fleet-wide `drainAll`. Describing it as creation risks
building a duplicate operator surface beside the one that already exists.

★ The **UI** is still absent; only the API claim was false.

**`MIG-003` — durable realtime fan-out and sequence catch-up — `complete + review-fixed`.**
The `E10-REALTIME-FOUNDATION` substrate. `live_event_log` + `live_event_sequences` under tenant
FORCE RLS (**migration 0257**), a broker at the `publishLiveEvent` chokepoint with a data-free
`pg_notify(companyId, seq)`, per-replica LISTEN plus a safety-poll drainer with `eventId`
self-suppression, WS `?sinceSeq` catch-up with a per-socket replay latch and
`replayTruncatedBeyondPage`, backpressure hysteresis, `trimRetention` + sweeper, and
`tests/d1/e6f-13-realtime-fanout.test.mjs`. Review blocked it on first pass (14 raw → 9 confirmed,
2 partial, 3 refuted; 4 HIGH + 3 MEDIUM fixed fail-first).

Residual, quoted: *"The **literal cross-container WS socket-receive leg**… is NOT executed by
e6f-13"*, and the d1 lanes are Linux-CI-only.

**`MIG-005` (Commander) and `MIG-007` (extraction) — designs only, both verdict-blocked, no result
files. They are disposition C2 and NOT M1 prerequisites.** `scope-triage.md`: *"**`MIG-005` /
`MIG-007` are NOT M1 prerequisites.** The milestone journey is `task_run`-only. A sibling document
bundled them with the parity bridges into one pre-M1 stage; that bundling is corrected in
`RECONCILIATION-2026-09-20.md`. The **bridges** are M1 work (disposition A, journey item 7); the
**cutovers** are Retained."* MIG-005's own design was reframed by adversarial review: *"do not
execute as a 'Commander cutover.'"* MIG-007's: *"extraction is NOT buildable today, and NOT
recommended even once unblocked."*

**`MIG-005-006-007` shadow — Lanes A–D COMPLETE, gate clause 2 PARTIALLY met.**
52 mutants, 50 killed + 2 documented equivalent. Its root defect is the reusable lesson:
*"`createJobShadowComparator` defaulted its derivation to an identity function… Every field compared
equal to itself. Measured before touching anything: 2,000 randomized snapshots across all six
diffed fields, 0 divergences."* Limits: the evidence is a **seeded corpus, not organic traffic**;
only 1 of 7 fields is compared; there is no per-sink rollout axis, so *"Wave 4's MIG-005 → 006 → 007
ordering is not expressible today"*.

**`MIG-006` — crew routing seam — FOUR OF FIVE UNITS SHIPPED; U4 differs from design; no result
file.** Re-measured at `4df71dada` and re-verified by me at HEAD:

| Unit | State | Evidence at HEAD |
|---|---|---|
| **U1** schema | ✅ SHIPPED | `packages/db/src/migrations/0282_internal_agent_runs_distributed_marker.sql` adds three nullable columns to `internal_agent_runs` — `execution_owner`, `distributed_job_id`, `distributed_attempt_id` — under C14 class (a) `IF NOT EXISTS` guards that leave the snapshot unchanged. Schema at `packages/db/src/schema/internal_agent.ts:404-406`. |
| **U2** handoff marker | ✅ SHIPPED | `server/src/services/internal-agent/aoa-agents/crew-handoff-marker.ts` |
| **U3** terminal projection | ✅ SHIPPED | `server/src/services/internal-agent/aoa-agents/crew-terminal-projection.ts` |
| **U4** loopback-defer | ⚠️ **NOT AS DESIGNED** | see below |
| **U5** seam | ✅ SHIPPED | `server/src/services/internal-agent/aoa-agents/runner.ts:839-906` — the `MIG-006 slice 1` block: gate at `:849` (`readDistributedCrewRolloutFlag`), rollout state at `:853-854`, `buildTaskRunBatchWorkload` at `:856`, `resolveCrewDistributedGate` at `:865`, `resolveExecutionOwner` at `:871`, the owner check `shouldSuppressLegacyExecution(crewOwner) && crewOwner.owner === "distributed"` at `:879`, the marker write at `:885-887`, and the `CREW-SUPPRESSION-RETURN` early return at `:899-903`. Behavioural proof in `server/src/__tests__/crew-seam-suppression.test.ts` (#488). |

★ **U4 is the divergence, and it is worth stating rather than marking done.** The design asked for
*"record the crew result pending, reconcile when Unit F lands (NEVER drop)"*. What shipped fires the
W3a loopback **once, at terminal time, from inside the projector** —
`crew-terminal-projection.ts:118-120`, whose own comment reads: *"the W3a loopback the suppression
return skipped … the loopback's own summary shows duration only (the distributed lane surfaces no
adapter usage to this seam)."* The result is **not dropped**, which was the requirement that
mattered. But it is **not deferred-and-reconciled**, and **nothing enriches it when Unit F lands**.
A founder reading a distributed crew thread sees a completion with no result content, permanently.

The whole seam is doubly gated and off by default:
`server/src/config/distributed-execution.ts:19` defines
`DISTRIBUTED_CREW_ROLLOUT_ENABLED_ENV = "AOA_DISTRIBUTED_CREW_ROLLOUT_ENABLED"`, described in its
own doc comment as *"the SEPARATE, off-by-default gate for CREW distributed execution, deliberately
INDEPENDENT of the task_run rollout dial"*. The design's caveat is unchanged: *"a distributed crew
run is MECHANISM-ONLY — tool-less (Unit C) and result-deferred (Unit F)."*

**`MIG-006` still has no `-result.md`; that remains owed.**

**`MIG-008` — legacy lease reconciliation + credential authority — `complete + review-fixed`, dormant
by design.** The append-only `legacy_resource_reconciliation` crosswalk (**migration 0256**, C14/RLS
hand-append, `POLICY_COUNTS: 2`, both grant surfaces), a pure reconciler plus a Drizzle store, the
`assertClosure` closure gate, and `e2b-credential-authority.ts` with `deriveE2bKeyGeneration` /
`assertKeyGenerationCurrent`. Its own disposition: *"`pass` (scope-honest: in-process/mocked
evidence; no live cutover — that is MIG-002/005/006/007)"*, and *"The live inline `resolveE2bApiKey`
path is NOT removed (retires at MIG-006/007)."* Disposition **A** in the triage — a promise-truth
correction, not new build.

**`MIG-009` — the distributed-execution drain — SHIPPED, deliberately `unwired`.** See §8.1 for the
full ticket. Summary: the two correctness defects are fixed and proven at embedded PG — the
per-Company rollback-safety grain and the missing `listActiveAttempts` SQL — plus status coverage
for `cancelled` and `no_active_lease`. 8 mutants, all killed by deletion, positive control first.
`E10-1-drain` stays `unwired`, count 0, by design.

**`MIG-010` — reconciliation runnable and decidable — units 2.2–2.5 shipped, NO result file, and
that is deliberate.** Its design header now reads `shipped` (PR #336, `597e77715`, migrations
0268/0269/0270) and it resolved `E10-F002`, `E7-F004`, `E7-F005`, `E7-F006`. It has no `-result.md`
because adding one would retire it as `E7-F007`'s owner exactly when that finding needs one.
`scope-triage.md` (**D-10**): *"file a successor for `E7-F007`* so MIG-010 can land a result
honestly. Until that successor exists, criterion 1 is unsatisfiable."*

**`MIG-001`, `MIG-004` — disposition X, zero files on disk.** Nothing is built, nothing is designed,
nothing is owned. `E11-F007` (HIGH) is `unowned` precisely because `MIG-004` is not a ticket the
ownership guard can see.

---

## 3. Consumed as-built interfaces

E10's cutover work builds very little new machinery. It **reuses** the source-agnostic ownership /
convert / placement stack and adds only the per-sink pieces. The re-measured terrain, from
`findings.md:82-93`, is the single most important thing a later planner should not re-derive:

> *"Re-measured at HEAD: the ownership decision is **already source-agnostic**.
> `createRunExecutionOwnerResolver` (`server/src/services/run-execution-owner.ts:278`) → `resolve`
> (`:284`) takes a generic `source: SubmitJobSource` and passes it straight through
> `convert.convertRunToJob({ source, … })`; there is **no `task_run` branch** in the file … So
> prerequisite #1's real task_run coupling is only **(i)** the heartbeat CALLER + **(ii)** the
> workload builder `buildTaskRunBatchWorkload` … NOT the ownership/convert/placement machinery,
> which is reusable as-is."*

| Interface | Where | E10's use and the rule |
|---|---|---|
| `createRunExecutionOwnerResolver` / `resolve` | `server/src/services/run-execution-owner.ts:278,284` | The ownership decision for any sink. Source-agnostic; consume, do not fork. |
| `shouldSuppressLegacyExecution` | `server/src/services/run-execution-owner.ts` (imported at `runner.ts:26`) | The legacy-suppression predicate. Every sink seam pairs it with an explicit `owner === "distributed"` check, as `runner.ts:879` does. |
| `createJobConvertOrchestrator`, `job-admission-bridge.ts` | `job-convert-orchestrator.ts:45` | Also source-agnostic; the admission bridge already maps `crew_run`. |
| `buildTaskRunBatchWorkload` | called at `heartbeat.ts:5303` and, for crew, `runner.ts:856` | The generic workload builder. `MIG-006`'s slice-1 `buildCrewBatchWorkload` wrapper **was the wrong tool and was removed (PR #478)** — it re-derived the adapter from the company provider and would mismatch `runtimeCommandSpec` on provider drift. Do not reintroduce a per-sink wrapper. |
| `resolveCrewDistributedGate` / `readDistributedCrewRolloutFlag` | `crew-distributed-gate.ts`; `config/distributed-execution.ts:19` | The off-by-default crew gate. Independent of the `task_run` dial by founder ruling. |
| `createDistributedExecutionDrain`, `drainAll` | `server/src/services/job-distributed-drain.ts:114,94/118` | The rollback lever. Zero production callers at HEAD (§5). |
| `createDistributedExecutionDrainStore` | `server/src/services/job-distributed-drain-store.ts:47` | `listActiveAttempts` (tenant-scoped `runInTenant` read, `notInArray(TERMINAL_ATTEMPT_STATUSES)`, `selectDistinct` by job, **no `FOR UPDATE`**) + `listOrganizationCompanyIds` reusing the canary primitive by reference. |
| `requestCancellation` | `packages/db/src/repositories/tenant/job-control.ts` | The fence-revoking single-job cancel the drain calls. It takes its own `FOR UPDATE` on job + lease; the drain deliberately does not hold a lock across its loop. |
| `listAdmittedOrganizationIds` | built once at `server/src/index.ts:637`, shared with `createJobControlSweeper` at `:1385` | The admitted-org enumeration any drain trigger reuses. Lives inside the `config.distributedExecutionEnabled && distributedExecutionDatabases` block (`:613`, `:668`, `:1219`). |
| `reconcileOrganizationLegacyResources`, `recordCompletedPass` | driven by `server/src/cli/reconcile-legacy-resources.ts` (`pnpm reconcile:legacy-resources`) | The precedent for an **honest operator trigger**: a real CLI, enrolled in `gate-clause-wiring.json`, proven to bite by mutation. §8.1 follows this pattern. |
| `publishLiveEvent`, `live_event_log` / `live_event_sequences` | MIG-003, migration 0257 | The `E10-REALTIME-FOUNDATION` substrate consumed by CLI-006 / BRW-006 / SVC-007. |
| `scripts/check-desktop-surface-disabled.mjs` | `REQUIRED_DOC_PHRASES` at `:41` = `[/no desktop installer/i, /docker \+ npm only/i]`; route sweep at `:54-59` | The standing negative evidence for DSK-00's desktop-disabled posture. Do not break it while desktop stays off. |
| `scripts/check-gate-clause-wiring.mjs` | `countProductionCallers` at `:66-90`; rules in `evaluateGateClauseWiring` | Counts non-test, non-comment, non-import production references. `unwired` + a caller → `unwired_but_now_has_caller`; `wired` + 0 callers → `claimed_wired_but_no_caller`. **Its own docblock (`:56-64`) says caller count is necessary but NOT sufficient** — that gap is the whole of §8.1's design problem. |

---

## 4. Shared decisions and locked contracts

- **D-9 (founder) — `MIG-009` is M0/M1 work, not deferred.** `scope-triage.md`, and the criterion
  allocation at `:341`. This plan treats it as on the critical path.
- **D-10 (founder) — a successor for `E7-F007` must be filed before `MIG-010` can carry a result.**
  `scope-triage.md §*Exit criteria*`. Until then, exit criterion 1 (*"all required ticket results approved"*) is
  unsatisfiable for M1a **and** M1b.
- **The crew rollout dial is separate from the `task_run` dial, and off by default.** Founder-ruled;
  implemented as `AOA_DISTRIBUTED_CREW_ROLLOUT_ENABLED`
  (`server/src/config/distributed-execution.ts:19`). Do not merge the two dials.
- **A distributed crew run is mechanism-only.** Doubly gated on CLI-008 Unit C (tool surface) and
  Unit F (result loopback). No E10 document may describe crew cutover as delivering useful
  capability before both land.
- **No sink flips without its own routing seam and its own credential path.** `E10-F001`'s shared
  prerequisites: (1) a distributed routing seam for non-`task_run` sources — **shipped for crew,
  still absent for the two agentless sinks**; (2) mint-runner generalization so an agentless /
  non-coding run can mint a Company key. Extraction additionally needs a result-return path, without
  which suppressing the direct call yields *"zero extracted items — a data-loss bug, not honest
  dormancy"*.
- **Caller count is necessary but not sufficient.** Composing a service at boot without a real
  invocation is a vacuous `wired` — *"a check that nothing runs is not a check"*. `MIG-009`'s own
  design rejects exactly that (`MIG-009-drain-design.md:175-180`), and §8.1 inherits the rule.
- **Frozen v1 protocol is untouched by E10.** No `packages/worker-protocol` change in MIG-008,
  MIG-009 or MIG-006.
- **Schema DDL is `db:generate` output.** Migration 0282's hand-appended `IF NOT EXISTS` guards are
  C14 class (a) and do not change the snapshot, so the drift gate stays clean. That exemption does
  not widen.
- **Records are immutable.** The stale clauses identified in §2 (`MIG-002` slice 1/2 on
  `listActiveAttempts`; `GATE-clause-3-rollback-result.md:182-188`) are frozen results; corrections
  are findings or successor records, never edits.

---

## 5. Known blockers, measured

### B1 — `E10-F001` is HIGH, `unowned`, and must be **re-measured at HEAD, not inherited**

`findings.md:3-8` records that *"none of the three sinks can cut over today"*. The finding has been
amended four times as facts moved under it — the `+ E7-1` blocker was removed on 2026-09-18, the
routing-seam estimate was cut down on the same day, and the ownership register was updated again on
2026-09-19 to record that *"the crew routing-seam prerequisite SHIPPED (MIG-006) and the
sink-agnostic drain SHIPPED (MIG-009)"*.

`scope-triage.md` makes re-measurement an explicit **M2 entry condition**: *"`E10-F001`'s
prerequisite analysis re-measured at HEAD — it is the finding that records that *no* Sprint-6 sink
was buildable, and it must be re-tested rather than inherited."* Step 0 of M2 re-derives every
clause from source. Inheriting this finding is the failure it exists to prevent.

What still holds at HEAD, as far as I measured: the two **agentless** sinks (extraction
`one_shot`, Commander `commander_turn`) have no routing seam and refuse at the mint's guard 3; crew
rides the mint iff the company's provider is v1 (`anthropic`/`openai` ride, `google`/`opencode`
refuse `adapter_not_v1_scope`).

### B2 — `E10-1-drain` is dormant: `drainAll` has **zero production callers**, measured at HEAD

`grep -rn "drainAll" --include=*.ts server packages cli scripts`, excluding tests, returns exactly
three hits and **no call site**:

- `server/src/services/job-distributed-drain-store.ts:41` — a comment: *"composition site (a
  `drainAll` trigger owed to REL-005)"*
- `server/src/services/job-distributed-drain.ts:94` — the interface declaration
- `server/src/services/job-distributed-drain.ts:118` — the implementation

`createDistributedExecutionDrain` likewise has no production caller (its definition at `:114`, plus
two comments — `cutover-selection-audit.ts:47` and `heartbeat.ts:5389`, the latter explicitly noting
the clause *"stays vacuous: `createDistributedExecutionDrain` has zero production callers"*). The
register agrees: `scripts/gate-clause-wiring.json` → `E10-1-drain`, `status: "unwired"`,
`symbol: "createDistributedExecutionDrain"`, count 0.

★★★ **This is where D-9 and MIG-009's own DEFER decision collide, and the contradiction is real.**
MIG-009's result §3 and the register reason both say the trigger is *"REL-005 scope"*. **REL-005 has
zero files on disk and is M5 scope** (`scope-triage.md`). D-9 requires the drain wired for
M1's exit criterion 6. Those cannot both stand. §8.1 resolves it the only way that does not
manufacture a vacuous green: build a *narrow operator trigger* now, following the
`reconcile:legacy-resources` precedent, and leave REL-005 the *product* kill-switch write path.

### B3 — Crew's result loopback has no enrichment path when Unit F lands (U4 divergence)

`crew-terminal-projection.ts:118-120`. Duration-only evidence, fired once, with no deferral record
to reconcile against. When CLI-008 Unit F's emit half ships, nothing will retro-enrich the
already-posted loopback. This is not a bug in what shipped — the result is not dropped — but it is a
**permanent content gap** unless U4 is revisited, and no ticket owns revisiting it.

### B4 — The parity bridges are producer-blocked, not merely unwired

`findings.md:54`: *"those projection bridges are PRODUCER-blocked, not merely zero-caller — the
deployed worker emits no artifact/result/usage evidence for them to consume (`observeRun`
uncomposed …), so wiring them is necessary-not-sufficient."* `scope-triage.md` makes the
same point for M1a and names the error class: *"Closure is a conjunction — *a producer AND the
wiring* — and wiring alone would let a reader mark criterion 6 satisfied while distributed spend
still bypasses every cap and auto-pause. That is the 'half a conjunction' error this programme has
retracted publicly once."* Three of the four bridges are M1a (D-8), not E10's; `jobApprovalBridge`
follows its sink and is M2's.

### B5 — `MIG-006` has no result file and `MIG-010` deliberately has none

`MIG-006` shipped across six PRs with no ticket file of any kind
(`RECONCILIATION-2026-09-20.md:143-147`); its design doubles as the as-built record and says so. The
result is owed. `MIG-010`'s absence is deliberate and blocked on D-10's successor filing. Exit
criterion 1 requires results for every required ticket, so both are M0 record-health items.

### B6 — Desktop cannot be advertised: there is no installable artifact

`DSK-003` §6 — the staging manifest exists, the assembler does not, and no `.pkg`/`.msi`/staging
root is produced. `DSK-004` §5 — *"no end-to-end update run"*, health confirmation and
`installedVersions` are injected values, and the admission verifier runs on a **test** trust root.
`DSK-001` Lane A — macOS entirely unverified; signing certificates outstanding. Until an assembler
and real signing roots exist, DSK-01…DSK-10 cannot be attempted and desktop stays disabled, with
`check-desktop-surface-disabled.mjs` as the standing negative evidence.

### B7 — The rollback lever's per-sink ordering is not expressible

The shadow result: *"**No per-sink rollout axis.** … it means Wave 4's MIG-005 → 006 → 007 ordering
is not expressible today."* MIG-002 slice 1 added a `sources` filter to the **dial**, which is
env-config, not a database dial. M2's staged cutover needs this resolved or it cannot stage.

---

## 6. Exit gate, and which partial gates may support it without completing it

**The E10 exit gate**, `README.md:5`: *"every current-main execution path is cut over or disabled
with one authority, the named two-replica durable-realtime preflight passes, and any advertised
desktop/handoff surface passes its conditional gate."*

Three conjuncts, and the middle one is the only one with a named gate on disk.

| Partial record | What it supports | What it explicitly does **not** do |
|---|---|---|
| `E10-REALTIME-FOUNDATION` (`test-gates.md:98-108`, RTF-00…RTF-07) | reconnect-safe claims in CLI-006, BRW-006, SVC-007 | RTF-00: *"It requires JOB-005, DEP-009, MIG-003, and their complete dependency closure on one exact revision. **It does not pass E10**, D3, D4, D5, D6, desktop, cutover, or mobility."* RTF-07 requires the handoff to *"explicitly list desktop distribution, legacy cutover, mobility, browser D3, and service D4 as not certified."* |
| `M2-CUTOVER` *(to be named)* | the sink-cutover milestone | Not defined yet (`scope-triage.md`). Naming it is M2 Step-0 work and is a gate-owner action. |
| `M1-D1-SPINE` | one-CP/one-worker lifecycle evidence, including the criterion-6 rollback rehearsal that consumes the drain | *"not D1 … cannot complete E6, and cannot substitute for an E3–E6 exit gate"* (`scope-triage.md`) |
| `MIG-003`'s `pass` | the realtime substrate half of the exit gate's middle conjunct | Its own disposition is *"scope-honest: in-process + real-two-replica-substrate evidence"*, with the cross-container WS socket-receive leg not executed. |
| `E10-2-legacy-reconciliation` / `E10-2-reconciliation-watermark` (`wired`) | that a production caller exists for the reconciliation pass and its watermark | Both register reasons state the limit in their own words: *"It does NOT mean the canary opens."* |
| `scripts/check-desktop-surface-disabled.mjs` | DSK-00's desktop-**disabled** negative evidence, i.e. the third conjunct when desktop is not advertised | It proves absence. It says nothing about a desktop surface that is advertised. |
| A milestone handoff under `docs/replatform/milestones/<M>/handoffs/` | a milestone decision | *"non-promoting: it changes no epic status and must not use `epic-completion` in its name"* (`artifact-policy.md`). |

★ The binding rule, `scope-triage.md` §*Normative-gate boundary*:
*“All three partial gates — `M1-D1-SPINE`, `M1a-D2-MECHANISM` and `M1-D2-CODING` — are
non-promoting. They may support a separately named milestone decision, but not an
epic-completion handoff.”* ★ *Re-pointed 2026-09-20 from a bare line number to the owning heading: this sentence is quoted verbatim by more than one plan, and editing it in the companion change moved every line citation to it.*

★★★ *This plan previously never named `M1a-D2-MECHANISM` at all, and quoted the superseded
two-gate form of this rule — so a reader could have treated a mechanism record as independently
promotable.* No accumulation of
these substitutes for a full E10 exit campaign on one exact candidate. And the regrooming sheet is
explicit (`epic-regrooming/epics/E10.md`): *"Do not issue a full E10 completion handoff for the
first milestone."*

---

## 7. NOT in scope

- **No sink cutover before its prerequisites are re-measured at HEAD.** `E10-F001` is an M2 *entry*
  condition, not a background note.
- **No extraction cutover, even once unblocked.** `findings.md:72-73`: *"Extraction's cutover is NOT
  recommended even once unblocked (thin value; already sandboxed with the Company key)."*
- **No desktop enablement, no installer package, no notarization, no macOS claim.** B6.
- **No cross-target mobility.** `MIG-004` has zero files; `E11-F007` measured zero mechanism in
  either direction; D6-05 already permits `disabled` with negative evidence.
- **No `MIG-001` work.** Disposition X. Filing it is a scoping decision, not an implementation task.
- **No frozen-protocol change.** `packages/worker-protocol` stays untouched by E10.
- **No re-litigation of `DSK-001`…`DSK-004`, `MIG-002`, `MIG-003`, `MIG-008`, `MIG-010` acceptance.**
  Disposition C1 / A. Their limits are recorded; their verdicts are not reopened.
- **No folder move.** §0 — recommendation only, pending an owner decision.
- **No edit to any frozen `-result.md`.** The three stale clauses in §2 and §5 are corrected by
  finding or successor record.
- **No vacuous composition of the drain.** Composing `createDistributedExecutionDrain` at boot
  without a reachable `drainAll` flips the caller count and forces a false `wired`. Explicitly
  rejected at `MIG-009-drain-design.md:175-180` and rejected again here.
- **No implementation plans for M2 tickets.** By doctrine — except `MIG-009`, which is not an M2
  ticket.

---

## 8. Ticket implementation tasks — WRITTEN AT STEP 0

**With one exception, this section contains no implementation tasks.** The doctrine is
`GO-BOOK.md:1906-1908` and `GO-BOOK.md:3344-3346`: later phases have *"scope and sequence but no
implementation plan, deliberately: a plan written five sprints early goes stale, which is the
failure this whole audit exists to fix. **Step 1 of each is to write the plan.**"* E10's cutovers
are two milestones out and sit behind a finding that must be re-measured before any of them can be
scoped honestly.

| Ticket | On disk | Milestone | Disposition |
|---|---|---|---|
| `DSK-001` | 4 lane results + amendment A1 | shipped | **Closed.** Do not reopen. Residuals (macOS, `device_local` consumer) are owned downstream. |
| `DSK-002` | design + result | shipped | **Done, clause (4) PARTIAL by design.** Wiring is DSK-003's interface; the ticket refused to guess. |
| `DSK-003` | design + result | retained (post-M1) | **C1 — shipped, retained.** Assembler, installer package, repair/diagnostics and signing roots are the open desktop work. Plan at desktop's own Step 0. |
| `DSK-004` | design + result | retained (post-M1) | **C1 — shipped, unit-proven.** Blocked on DSK-003's assembler for any end-to-end run. |
| `MIG-001` | **zero files** | not filed | **X.** Filing it is a scoping decision. Nothing to preserve. |
| `MIG-002` | 2 designs + 2 results + 2 terrain | shipped | **A — promise-truth.** Two stale `listActiveAttempts` clauses to correct by finding (§2). |
| `MIG-003` | design + result | shipped | **Done.** The `E10-REALTIME-FOUNDATION` substrate; cross-container WS leg is a recorded residual. |
| `MIG-004` | **zero files** | not filed | **X.** Blocks `E11-F007` from having an owner. |
| `MIG-005` | design only | **M2** | **C2 — genuinely deferred.** Write the plan at M2 Step 0, after `E10-F001` is re-measured. Largest credential gap (net-new per-user `provider_connection` class). |
| `MIG-006` | design (doubles as as-built) | **M2** | **4 of 5 units shipped, off by default.** Owed: the `-result.md`; a decision on U4's enrichment gap (B3); the cutover itself, gated on CLI-008 Units C + F. |
| `MIG-007` | design only | **M2** | **C2 — deferred and NOT recommended.** If M2 proceeds without it, say so explicitly rather than leaving it implied. |
| `MIG-008` | design + result | shipped | **A — dormant forward-infrastructure.** Retires the inline `resolveE2bApiKey` path at MIG-006/007. |
| **`MIG-009`** | design + result | **M0/M1 (D-9)** | **B — full ticket below.** |
| `MIG-010` | design only, header `shipped` | **M0** | **B — result owed, blocked on D-10.** File the `E7-F007` successor first; the result follows in the same wave. |

---

### 8.1 `MIG-009` — wire the rollback drain to an honest operator trigger (M, ≤3 agent-days, M0/M1)

**Why this one is planned in full.** Founder decision **D-9** moved `MIG-009` from disposition C to
**B**: exit criterion 6's rollback rehearsal *uses* the drain, so *"wiring it gives criterion 6 a
mechanism rather than a runbook"* (`scope-triage.md`). It is therefore M0/M1 work, not M2, and
it is the only E10 item on the first milestone's critical path.

**Depends on:** nothing unbuilt. The drain's correctness work is already shipped and proven
(`MIG-009-drain-result.md`). This ticket adds the trigger that was deferred, and only that.

**Outcome.** A narrow, explicitly-invoked **operator teardown entrypoint** that calls
`drainAll` against the real store and the real budget-cost bridge, so that a distributed-execution
rollback is a mechanism an operator runs and a QA record can cite — not a runbook step someone
performs by hand. On landing, `E10-1-drain` promotes from `unwired` to `wired` **with a caller that
actually reaches `drainAll`**, proven by mutation.

**Ticket non-goals.** No sink cutover and no credential path (the drain is sink-agnostic,
`E10-F001`). No kill-switch **UI** — that stays REL-005's. ★ *The kill-switch **API** is NOT deferred: it has shipped (see the correction above); only the UI and the drain-trigger decision remain.* No change to the drain's
cancellation semantics, its grain, its SQL, or `DRAINED_STATUSES`. No migration. No
`packages/worker-protocol` change. No new `AOA_*` switch unless the operator ruling in ★ below
requires one.

★ **The contradiction this ticket must resolve, stated before any code.** MIG-009's own result §3
and the `E10-1-drain` register reason both say the `drainAll` trigger is *"REL-005 scope"*.
**REL-005 has zero files on disk and is M5 scope.** D-9 requires the drain wired for M1. The
resolution this plan proposes — and it is a **STOP for controller approval before implementation**,
not an improvisation — is to split the trigger:

- **Now (this ticket):** an operator CLI, following the proven precedent of
  `server/src/cli/reconcile-legacy-resources.ts` / `pnpm reconcile:legacy-resources`, which is the
  exact shape `gate-clause-wiring.json` already accepts as an honest caller for
  `E10-2-legacy-reconciliation` and which was *"PROVEN TO BITE"* by mutation.
- **Later (REL-005):** the kill-switch **UI**, and the decision on how the shipped dimensioned
  switch triggers the fleet-wide `drainAll` — ★ **not** the write path, which has shipped (see the
  correction above). The `E11` plan's “still unowned” framing inherits the same false blocker.

If the controller rules otherwise — that MIG-009 must stay deferred and criterion 6 accepts a
runbook — that ruling supersedes D-9 and belongs in a `decisions.md` entry (which E10 does not yet
have; §0). Do not implement either way without the ruling.

**Files.**
- Create `server/src/cli/drain-distributed-execution.ts` — the operator entrypoint. Composes the
  store, the bridge-backed `assertRollbackSafe`, the org enumeration, and `requestCancellation`;
  calls `drainAll`; prints the `DistributedExecutionDrainResult` report; exits non-zero on any
  skipped organization.
- Modify root `package.json` — add a script beside `reconcile:legacy-resources` (e.g.
  `"drain:distributed-execution": "tsx server/src/cli/drain-distributed-execution.ts"`).
- Modify `scripts/gate-clause-wiring.json` — flip `E10-1-drain` from `unwired` to `wired`, rewrite
  its `reason` to name the CLI and to state the scope honestly (a production caller exists **and**
  it reaches `drainAll`; it is an operator action, not an automatic one).
- Create `server/src/__tests__/drain-distributed-execution-cli.test.ts` — the reachability and
  exit-code tests.
- Modify `server/src/__tests__/job-distributed-drain.integration.test.ts` — add the end-to-end
  arm that drives the CLI's composition root rather than a hand-built dep bag.
- Modify `docs/deploy/environment-variables.md` (or the rollback section it already carries) —
  replace the hand-executed-SQL rollback step with the command.
- Create `docs/replatform/epics/E10-desktop-migration-realtime/tickets/MIG-009-wiring-result.md`.
- **Do not modify** `server/src/services/job-distributed-drain.ts` or
  `job-distributed-drain-store.ts`. If either needs to change, that is a STOP.

**Interfaces consumed, verbatim from source at HEAD.**
- `createDistributedExecutionDrain(deps: DistributedExecutionDrainDeps): DistributedExecutionDrain`
  — `job-distributed-drain.ts:114`.
- `drainAll(options?: { pageSize?: number; statementTimeoutMs?: number; reason?: string })
  : Promise<DistributedExecutionDrainResult>` — declared `:94`, implemented `:118`. Defaults:
  `DEFAULT_PAGE_SIZE = 32`, `DEFAULT_STATEMENT_TIMEOUT_MS = 750`,
  `DEFAULT_REASON = "distributed_execution_disabled"`; both numeric options are clamped to those
  ceilings, so the CLI cannot widen them.
- `DistributedExecutionDrainResult` — `{ organizationsScanned, cancelled, skippedOrganizations:
  string[], perOrganization: Array<{ organizationId, skipped, reason?, cancelled }> }`
  (`:82-90`). The CLI prints all four and must not collapse `skippedOrganizations` into a count.
- `DistributedExecutionDrainDeps` — `listOrganizationCompanyIds(organizationId)` (`:60`),
  `requestCancellation(input)` (`:69`), `assertRollbackSafe(companyId)` (`:78`).
- `createDistributedExecutionDrainStore(...)` — `job-distributed-drain-store.ts:47`.
- `listAdmittedOrganizationIds` — `server/src/index.ts:637`, reused rather than re-derived.

**The one inherited handoff, and it is load-bearing.** `MIG-009-drain-result.md:212-216`
(INFORMATIONAL, recorded specifically for the wiring ticket): the drain's `requestCancellation` dep
is deliberately narrower than the repo's `RequestCancellationInput` (it omits `commandId`/`now`), and
*"the REL-005 wiring adapter must supply a STABLE `commandId` derived from the jobId for idempotent
re-runs (a per-call random id would queue duplicate cancels)."* **This is the single most likely way
to get this ticket wrong.** The adapter derives `commandId` deterministically from `jobId`, and a
test asserts that two consecutive CLI runs over the same live job queue **one** cancel, not two.

**Failure behaviour.**
- Flag-off (`config.distributedExecutionEnabled` false, or `distributedExecutionDatabases`
  undefined): the CLI exits non-zero with an explicit message and **opens no pool**. This is the
  same structural safety the convergence sweeper relies on (`index.ts:613`, `:622`).
- An unreadable Company set for an organization: skip that organization with
  `enumerate_companies_error`, record it in **both** `perOrganization` and `skippedOrganizations`,
  never drain it. Fail-closed. (This is the existing 9th guard; the CLI must surface it, not
  swallow it.)
- A pending authoritative-cost receipt on **any** Company under the org, including a sibling: skip
  the whole org `rollback_pending`.
- A row that turns terminal between read and cancel: `requestCancellation` returns
  `job_terminal`/`not_found`, both excluded from `DRAINED_STATUSES` — handled, not raced.
- Any skipped organization ⇒ **non-zero exit**. A drain that silently reports a clean sweep while
  skipping organizations is precisely the dead-lever failure MIG-009 was written to kill.

- ★★★ **`skippedOrganizations` IS NOT SUFFICIENT FOR THE EXIT CODE, and an earlier revision of this
  ticket implied it was.** *Corrected 2026-09-20 (fifth round), verified at source.* The per-attempt
  cancellation in `drainAll` swallows its error — `job-distributed-drain.ts:208` is a bare
  `catch { }` that records **neither** a skipped organization **nor** a failed attempt, and the org
  is still pushed as `skipped: false`. So a transient `requestCancellation` failure leaves an empty
  skip list, this CLI exits **zero**, and **the rollback rehearsal passes while work is still
  active** — which is the exact dead lever above, arriving through the one path the rule did not
  cover.

  **So this ticket owes one of two things, and must state which in `decisions.md`:**

  1. **Widen the result contract** — `DistributedExecutionDrainResult` grows a
     `failedCancellations` count (or per-attempt outcomes), and the CLI fails non-zero on it. This
     edits a shipped service, so it is no longer the purely additive rollback this ticket claims
     and the “no service change” line below must be corrected with it.
  2. **Terminal-state recheck** — after the sweep the CLI re-reads active attempts for every
     organization it did not skip and fails non-zero if any remain. Additive, no service edit, but
     it must re-read through the same tenant-scoped path and not a new query.

  ★ **A RED test is owed either way: a `requestCancellation` that throws for one attempt must make
  this CLI exit non-zero.** Against today's code that test fails, which is the point — it is the
  positive control for the dead lever.
- The CLI never widens `pageSize` or `statementTimeoutMs` past the module's clamps, and never
  invents a `reason` that is not a stable enum-like string.

**Observability.** One structured line per organization — `{organizationId, skipped, reason,
cancelled}` — plus a final summary `{organizationsScanned, cancelled, skippedCount}`. Opaque ids
only: no Company name, no actor, no job content, no key, no secret. The operator invocation itself
is an auditable action; the CLI prints the exact `reason` string it passed to `drainAll`.

★★★ **THERE IS NO `activity_log` ROW ON THIS PATH TODAY, and an earlier revision of this line
implied the console merely “agrees” with one.** *Corrected 2026-09-20 (fifth round), verified at
source.* `job-distributed-drain.ts` imports no audit module, and the job audit helpers
(`JOB_DRAIN_ACTION = "job.drain.requested"`, `server/src/services/job-control-audit.ts:63`) are
composed by the **HTTP** drain route, not by `drainAll`. A CLI calling the service directly
therefore mutates **every active attempt in the fleet** with **no actor-attributed durable audit
record at all** — a fleet-wide rollback with no answer to *who ran it*.

**So this ticket owes an actor identity and an explicit audit write**, recorded in `decisions.md`:
either route the drain through the already-audited control surface, or compose an `activity_log`
write for the invocation using `JOB_DRAIN_ACTION` and a CLI-operator actor. The CLI's file and
interface plan above must gain that dependency — it currently has neither, which is why the gap
was invisible.

★ **The audit write must be ATOMIC with the mutation it records**, not best-effort beside it: a
best-effort audit that is skipped on failure is permanently lost, and this repo has that failure
class on record already.

**Rollback of this ticket.** Purely additive: one new CLI file, one root script, one register
status flip, tests, and docs. No migration, no schema, no service change. Rolling back means
deleting the CLI and reverting `E10-1-drain` to `unwired` — the register enforces the pair, because
`wired` with zero callers reds `claimed_wired_but_no_caller`.

**RED → GREEN.**
- RED `drain-distributed-execution-cli.test.ts` — **positive control first**: a composed CLI over a
  fake-but-real-shaped dep set drains a clean org and reports `cancelled > 0`. This must fail before
  the CLI exists, and it is the test every later mutant is measured against.
- RED — `drainAll` is actually reached. Assert on a spy that `drainAll` is invoked exactly once per
  CLI run. **This is the assertion that distinguishes this ticket from the vacuous compose MIG-009
  rejected**; without it the register's caller count would be satisfied by construction alone.
- RED — stable `commandId`: two consecutive runs over the same live job produce one queued cancel,
  not two. Derived from `jobId`, not random.
- RED — any skipped organization ⇒ non-zero exit.
- RED — flag-off exits non-zero and opens no pool.
- RED — the report prints `skippedOrganizations` verbatim, not a count.
- RED (embedded PG, extend `job-distributed-drain.integration.test.ts`, `describe.skipIf` on Windows
  unless `AOA_RUN_WIN_INTEGRATION=1`) — the CLI's composition root, driving the **real** store and
  the **real** budget-cost bridge: a sibling-Company pending receipt skips the whole org; clearing
  it lets the same org drain (the positive control); a terminal-only org drains zero as a clean
  sweep.
- GREEN — implement the CLI, add the root script, flip the register, update the rollback docs.

**Mutation sweep — delete each guard, positive control first.** Mirror MIG-009's own discipline:
restore every mutant with `git checkout --` and verify the tree is clean afterwards.

| Mutant (a DELETION) | Must redden |
|---|---|
| **M0** (positive control) — delete the drained-count print/propagation | the clean-org drain assertion |
| **M-reach** — compose the drain but never call `drainAll` | the reached-exactly-once assertion. **If this survives, the ticket has shipped a vacuous `wired` and must not land.** |
| **M-commandId** — replace the derived `commandId` with a fresh random value | the idempotent-re-run test (two cancels instead of one) |
| **M-exit** — always exit 0 | the skipped-org non-zero-exit test |
| **M-flagoff** — remove the flag-off guard | the no-pool assertion |
| **M-skiplist** — print a count instead of `skippedOrganizations` | the verbatim-report test |
| **M-register** — revert `E10-1-drain` to `unwired` with the CLI present | `check-gate-clause-wiring.mjs` → `unwired_but_now_has_caller`, exit 1 |

**Evidence and commands.** Every native process runs through `Invoke-NativeGate` (the helper in
`E4-worker-daemon/implementation-plan.md:384-398`), with cleanup only in `finally`, and each RED and
GREEN recording the same invocation and its native exit code.

```powershell
Invoke-NativeGate 'MIG-009w unit' {
  pnpm --filter @armyofagents/server exec vitest run `
    src/__tests__/job-distributed-drain.test.ts `
    src/__tests__/drain-distributed-execution-cli.test.ts
}
Invoke-NativeGate 'MIG-009w registers' { node scripts/check-gate-clause-wiring.mjs }
Invoke-NativeGate 'MIG-009w typecheck' { pnpm --filter @armyofagents/server typecheck }
Invoke-NativeGate 'MIG-009w build'     { pnpm --filter @armyofagents/server build }
```

Embedded-PG lane (Windows requires the opt-in; Linux CI is the formal DEC-03 authority):

```powershell
$env:AOA_RUN_WIN_INTEGRATION = '1'
Invoke-NativeGate 'MIG-009w integration' {
  pnpm --filter @armyofagents/server exec vitest run `
    src/__tests__/job-distributed-drain.integration.test.ts
}
```

All five registers must stay green: `check-gate-clause-wiring`, `check-finding-ownership`,
`check-ticket-graph-coverage`, `check-guard-inventory`, `check-execution-census`. Note that the new
test file moves the execution census, so the census manifest is updated in the same commit.

★ `server/tsconfig.json` excludes `src/__tests__`, so **tests are not type-checked**. A RED must
therefore be **behavioural**, never a compile error — the same trap MIG-009 recorded at
`MIG-009-drain-result.md:40-42`.

**Commit boundary.** Two commits, in this order:

1. `feat(drain): operator teardown entrypoint for distributed-execution rollback` — the CLI, the
   root script, the tests, the register flip, the docs update. One implementer.
2. The reviewer's separate append-only `MIG-009-wiring-result.md` commit, which is the only commit
   that completes the ticket. Plain `git commit`, never `--no-verify`.

The result doc records: the Start SHA, the reached-exactly-once proof, the full mutation table with
`M-reach` explicitly named, the embedded-PG positive control, the `commandId` derivation, the
register transition `unwired → wired` with its new `reason`, and the REL-005 boundary — the product
kill-switch **UI** is **not** delivered here and must not be implied. ★ *The write path is not “not delivered” — it already exists; this ticket simply does not touch it.*

**Size.** ≤3 agent-days. The drain's logic is already correct and mutation-proven; this ticket is a
composition root, an operator entrypoint, an idempotency adapter, and the proof that the trigger is
genuinely reached.

---

## 9. Reopen triggers

Reopen this plan — not merely amend a ticket — when any of the following becomes true:

1. **`E10-F001` is re-measured at HEAD and a clause moves.** It is an M2 entry condition and it has
   already been amended four times; the next re-measurement may shrink or grow M2's scope.
2. **CLI-008 Unit C or Unit F lands.** Crew's cutover is doubly gated on both. Unit F in particular
   changes B3: an enrichment path becomes possible, and the U4 divergence becomes a decision rather
   than a permanent gap.
3. **The `drainAll` trigger question is ruled** — either the §8.1 operator-CLI split, or a ruling
   that MIG-009 stays deferred and criterion 6 accepts a runbook. Either ruling changes M1's exit.
4. **`REL-005` is filed.** It is the named owner of the kill-switch **UI and the drain-trigger decision** — ★ *not the write path, which has shipped*; filing it changes
   the boundary §8.1 draws.
5. **The `E7-F007` successor is filed (D-10).** `MIG-010` can then carry a result, and exit
   criterion 1 becomes satisfiable.
6. **Desktop is advertised.** DSK-01…DSK-10, an assembler, real signing roots, notarization
   credentials and macOS hardware all enter scope at once, and
   `check-desktop-surface-disabled.mjs` flips from standing evidence to a blocker.
7. **`MIG-001` or `MIG-004` is filed.** Both are disposition X today; either changes E10's ticket
   set and `MIG-004` gives `E11-F007` an owner.
8. **A per-sink rollout axis ships.** B7 — without it, M2's staged MIG-005 → 006 → 007 ordering is
   not expressible, and with it, M2's sequencing plan changes.
9. **The `observeRun` producer is composed in the deployed worker.** B4 — the parity bridges stop
   being producer-blocked, which changes what M2's exit can honestly claim.
10. **The two E10 directories are consolidated, or a decision declines to consolidate.** §0. Either
    outcome changes where DSK evidence lands and whether the DSK tickets' `qa/` path is created.
11. **`packages/worker-protocol` changes.** It is frozen; any change is a custodian STOP that
    invalidates MIG-006's and MIG-008's "no protocol change" property.
