# Scope Triage and First-Milestone Baseline

> **Proposal only.** This triage does not close, cancel, approve, or reprioritize a ticket by itself. It is a review map for subsequent owner-approved plan amendments.

## The 50-ticket triage

Each ticket below appears exactly once in one of four proposed dispositions.

This is the fixed set of 50 tickets identified when the numbered program graph had grown from 72 to 122 nodes. The 2026-09-20 origin refresh adds one later successor, `SVC-009`, making the current graph 123 nodes / 114 ticket IDs. `SVC-009` owns the still-open E9 effect-authority lifetime follow-up and belongs to E9's deferred service milestone; it is outside this historical 50-ticket accounting and does not enter the first milestone by implication.

> ★★★ **AMENDED 2026-09-20 after an independent per-ticket audit against code and the
> registers (founder decisions D-8…D-11).** Nineteen of the fifty dispositions moved. The
> original four buckets could not express three real states, so three were added: **M**
> (in-milestone build), **N** (no correction owed) and **X** (not filed). Every change is
> evidenced in the amendment record below — read it before disputing a row. Arithmetic:
> **50 distinct tickets, 52 entries, two declared splits** (`DEP-009`, `DEP-011`); nothing
> was dropped and nothing invented.

### A. Promise-truth corrections — 20

These items reconcile what the program promised with what the shipped or partially shipped mechanism actually proves. Preserve their implementation and evidence, but do not inherit an over-broad completion claim.

`PRT-007`, `TEN-006`, `JOB-009`, `JOB-010`, `JOB-011`, `JOB-012`, `JOB-013`, `JOB-014`, `JOB-015`, `WRK-008`, `WRK-010`, `WRK-011`, `WRK-014`, `WRK-015`, `DAT-008`, `DEP-009` *(admission half — split)*, `DEP-010`, `DEP-011` *(record half — split)*, `DEP-012`, `MIG-008`.

### B. Pre-milestone assurance and operations — 8

These items are required to make the narrow milestone supportable and honestly observable. Their evidence must be current for the milestone candidate even where a mechanism already exists.

`TRACK-001`, `TRACK-002`, `DAT-011`, `DEP-008`, `DEP-013`, `WRK-017`, `MIG-009`, `MIG-010`.

### C. Later original-program phase — 10

These remain required or valuable in the original broader program, but they do not block the first milestone. **Split in two, because "deferred" was describing two different states and the distinction changes what is owed.**

**C1 — shipped, retained, not required by M1 (6).** Finished and production-wired, or inert by design. Nothing is owed but a later milestone's evidence; do NOT re-open their acceptance.

`DAT-006`, `DAT-010`, `DSK-003`, `DSK-004`, `SVC-008`, `MIG-006`.

**C2 — unbuilt, genuinely deferred (4).** Deferral preserves their owners, dependencies, findings, and acceptance intent.

`WRK-012`, `MIG-005`, `MIG-007`, `DBR-001`.

### D. Optional expansion — 2

These are explicit expansion choices, not silent prerequisites for the first milestone. If selected later, they re-enter through their own approved scope and evidence gates.

`WRK-016`, `DEP-009` *(two-replica HA half — split)*.

### M. In-milestone build — 5

Unbuilt engineering the first milestone **requires**. These are not wording corrections and must not be read as deferrable: each is a build item on the M1 critical path.

`WRK-013`, `DAT-007`, `DAT-009` *(slices 3c/3d/3e)*, `DEP-011` *(Slice 5 go-live — split)*, `CLI-008` *(link-scoped)*.

### N. No correction owed — 5

Frozen, independently reviewed, live-enforced, with no gate clause and no open finding. There is no over-broad claim to narrow, so filing them as corrections would manufacture work.

`FND-006`, `FND-007`, `FND-008`, `WRK-009`, `CLI-007`.

### X. Not filed — 2

**Zero files on disk.** The C and D wordings ("deferral preserves their owners… acceptance intent"; "re-enter through their own approved scope") are **vacuous** for these: there is no owner, design, or acceptance intent to preserve. `E11-F007` (HIGH) is `unowned` precisely because `MIG-004` is not a ticket the ownership guard can see.

`MIG-001`, `MIG-004`.

---

## Proposed first milestone

### Included journey

One internal Organization runs `task_run` coding work through one control-plane instance and one separately deployed worker, backed by external PostgreSQL, object storage, and real E2B. On one exact candidate revision, the journey must cover:

1. authenticated task submission and current tenant/source admission;
2. authoritative target selection, lease, ACK, renewal, fencing, cancellation, and terminal projection;
3. immutable workspace input and attributable output/artifact handling;
4. lease-scoped secret materialization with no database or raw OAuth authority in the worker;
5. a supported sandbox-local coding adapter that can use the approved tool surface and produce reviewable output;
6. provider creation, execution, teardown, reconciliation, and kill/cleanup operations on real E2B;
7. operator-visible audit, cost/budget, failure classification, and cleanup evidence; and
8. recovery from the declared control-plane, worker, network, and provider failure cases in the candidate campaign.

This is an internal alpha, not a private-beta promotion and not proof of the whole replatform program.

> ★★★ **SPLIT 2026-09-20 into M1a and M1b (founder ruling).** As written, the journey's item 5
> and exit criterion 4 both require the agent to **return attributable reviewable output** — the
> return path, CLI-008 Unit F, whose emit half is the one genuinely undesigned thing in the
> programme. That put the entire first milestone behind the hardest remaining item, leaving no
> provable checkpoint between today and it. The split creates one, **without softening the
> capability bar**: the bar moves to M1b intact rather than being relaxed.

#### `M1a` — the spine

Journey items **1, 2, 4, 6, 7, 8**. One Organization, one control-plane instance, one separately
deployed worker, external PostgreSQL and object storage, **real E2B**, proven in a **shipped CI
boot** rather than a manual staging run. It proves the *mechanism*: dispatch → distributed owner →
lease → secret redemption → sandbox create/execute/teardown → durable terminal → operator-visible
audit, cost, failure classification and cleanup.

★ **`M1a` explicitly does NOT claim useful agent capability**, and a record that reports
`capabilityProven=false` satisfies it. Saying so is the point of the split.

★★★ **`E3-F037` is an `M1a` gate, not an `M1b` one (founder decision D-8).** A handed-off
distributed attempt currently writes **no `cost_events` row**, which the finding rates HIGH because
"arming the rollout dial produces spend no budget policy can see, cap or pause". That is a **safety**
property, not a capability one: an alpha must not arm a dial whose spend is invisible. So
`jobBudgetCostBridge` — and with it journey item 7's audit and failure-classification siblings
`jobAuditBridge` and `jobOutputBridge` — must be wired before `M1a` passes, not deferred to `M1b`.

#### `M1b` — useful capability

Journey items **3 and 5**, and **exit criterion 4 in full**. The return path: an artifact the agent
produced inside the sandbox reaches the control plane and is visible to the founder on the task.
Requires `CLI-008` Unit F (links 1-emit / 3 / 4 / 5) and `DAT-009` slices 3c/3d/3e.

★ **`M1b` inherits every `M1a` criterion unchanged** and adds criterion 4. Passing `M1a` grants
nothing about capability; failing to reach `M1b` leaves the programme exactly where the E7-1 run
left it — mechanism proven, capability not.

## Proposed milestone partial gates

These names define review boundaries for this proposal; they do not amend [`../test-gates.md`](../test-gates.md).

### `M1-D1-SPINE` — one-control-plane/one-worker local-distributed partial gate

Run the included lifecycle on one control-plane instance, one separately deployed worker, external PostgreSQL, object storage, the declared local/reference provider path, and the fault controls required by the included journey. Record exact revision, topology, production boot roots, tenant isolation, lifecycle/fence behavior, workspace/secret/output behavior, audit/cost signals, and cleanup/recovery.

This is not D1. In particular, it does not satisfy D1-00’s at-least-two-worker topology, does not certify every full-D1 fault volume or HARD invariant, cannot complete E6, and cannot substitute for an E3–E6 exit gate that normatively consumes full D1. A passing handoff unlocks only the dependency set explicitly named by the approved first-milestone plan.

### `M1-D2-CODING` — real-E2B useful-coding partial gate

> ★ **Serves `M1b`.** `M1a` is gated by `M1-D1-SPINE` plus the real-E2B *mechanism* half of this
> gate; the *useful-capability* half below is `M1b`'s. One campaign may produce both records on the
> same candidate, but the two verdicts are recorded separately and the mechanism verdict never
> implies the capability one.

On the same exact candidate, run the included real-E2B `task_run` journey through an approved sandbox-local adapter, tool surface, workspace input, attributable output, cancellation, usage, provider failure, artifact integrity, and terminal cleanup. The record must report both mechanism and useful-capability verdicts.

This is not D2. It cannot complete E7, satisfy D2’s full run counts/schedule, or substitute for full D2 in a later D5/D6 or release decision. It unlocks only the internal alpha milestone after `M1-D1-SPINE` and its named dependencies pass.

### Normative-gate boundary

Both partial gates are non-promoting. They may support a separately named milestone decision, but not an epic-completion handoff for E3–E7. Full D1/D2 and any E6/E7 completion still require the current normative gates, including H-06, or a separately reviewed and approved amendment to `test-gates.md`.

## The milestone sequence — M1a through M5

> **Added 2026-09-20.** The proposal previously defined exactly one milestone and left everything
> after it as a scope list, so there was no sequence from the internal alpha to an E11 exit. This
> section supplies one.
>
> ★★★ **Scope and gates only — deliberately NOT implementation plans.** GO-BOOK §7 records why:
> *"a plan written five sprints early goes stale — which is the exact failure this audit exists to
> fix."* Each milestone's detailed plan is written just-in-time, at its own Step 0, against HEAD.
> What is fixed here is the **boundary** of each milestone and **what would have to be true** to
> pass it.
>
> ★ **`E0`–`E11` are unchanged.** They remain the ticket and gate namespace; every register is keyed
> by them. Milestones are the delivery layer on top — what can be proven on one candidate revision.
> A milestone never completes an epic: epic completion still requires that epic's normative gate.

| # | Milestone | Proves | Named gate(s) | Blocked by |
|---|---|---|---|---|
| **M0** | Record + lane health | the records match the code, and every lane a milestone will cite is green and read | *(no gate — entry criteria for M1a)* | nothing |
| **M1a** | The spine | mechanism: one org, one CP, one worker, real E2B, in a **shipped CI boot** | `M1-D1-SPINE` + the mechanism half of `M1-D2-CODING` | M0 |
| **M1b** | Useful capability | an agent's output reaches the founder | the useful-capability half of `M1-D2-CODING` | M1a, `CLI-008` Unit F, `DAT-009` 3c–3e |
| **M2** | Sink cutover | the legacy in-process paths stop owning execution | `M2-CUTOVER` *(to be named)* | M1b |
| **M3** | Workload breadth | browser and service workloads run distributed | full **D3** + full **D4** | M2 |
| **M4** | HA and disaster recovery | two replicas preserve correctness; a measured restore | full **D5** | M3 |
| **M5** | Private beta | three external Organizations, all workloads, 14 days | full **D6** → **E11 exit** | M4 |

### `M0` — record and lane health

**Scope.** Disposition **B** in full, plus the record-truth half of **A**. No feature work.

**Why it is a milestone and not a chore.** Every later milestone's exit criteria are *"a committed
`Result: pass` QA record on the exact candidate"*. A lane that is red, or green but unread, cannot
produce one. `E6-F021` is the worked example: the `E6-D1-FOUNDATION` lane was red for five days on a
deleted upstream image and the consumer built to report that could not see it.

**Exit.** `d1-merge-train` and every keyed lane green or explicitly quarantined with an owner; the
DEP-013 consumer reporting zero unowned findings; disposition-A record corrections landed; a
successor filed for `E7-F007` so `MIG-010` can carry a result (**D-10**).

### `M2` — sink cutover

**Scope.** `MIG-005` (Commander), `MIG-006` (crew — units shipped, cutover deferred), `MIG-007`
(extraction), and `E10-1-drain` promoted from dormant on a real `drainAll` trigger. The four parity
bridges are **not** here — three are `M1a` (D-8) and the fourth, `jobApprovalBridge`, follows its
sink.

**Entry.** `M1b` passed. `E10-F001`'s prerequisite analysis re-measured at HEAD — it is the finding
that records that *no* Sprint-6 sink was buildable, and it must be re-tested rather than inherited.

**Exit.** For each cut-over sink: the distributed path owns the write, the legacy path is
provably not reached, and rollback is rehearsed. `E3-5-product-approval`, `E3-17-output`,
`E3-audit-parity-bridge` and `E10-1-drain` all `wired` with real callers.

### `M3` — workload breadth

**Scope.** E8 browser (`BRW-004`…`008`) and the E9 service remainder (`SVC-003`/`005`/`007`
residuals, `SVC-004`, `SVC-006`).

**★ The known blocker, stated up front.** `packages/browser-runtime` has **zero importers anywhere
in the tree**, declares `playwright` as a *devDependency* so it is unshippable as written, and
`workload.browser_session` is filtered out of the worker hello — so a browser job can be submitted
and placed-for but never leased. M3 begins by fixing that, not by writing a campaign.

**Exit.** Full **D3** and full **D4**, including D4's 72-hour continuity campaign.

### `M4` — HA and disaster recovery

**Scope.** `DEP-009`'s two-replica half, `WRK-016` (replica-safe worker volumes), `REL-003`'s owed
DR rehearsal with measured RPO/RTO, `DBR-001`.

**Exit.** Full **D5**.

### `M5` — private beta

**Scope.** `REL-001`, `REL-002`, `REL-005` — none of which has a ticket file today — plus the D6
campaign itself.

**★ This is calendar-bound and cannot be compressed by engineering.** D6-02 requires at least three
external beta Organizations participating throughout the same **14 consecutive calendar days**, at
least 1,000 completed attempts, ≥99.5% availability, zero Severity 0/1 incidents. D6-03 adds
conjunctive per-workload floors: ≥100 coding jobs, ≥50 browser journeys, ≥72 healthy service-hours.

**Exit.** Full **D6** → the E11 exit gate → `REL-005` selected-Organization private beta.

---

### Retained after the first milestone

- browser-session execution and its D3 campaign;
- long-running service execution and its D4/72-hour campaign;
- installed desktop packaging, updater, desktop beta, and device-loss campaigns;
- cross-target mobility and handoff advertising;
- Commander, crew, and one-shot cutovers;
- two-control-plane high availability and replicated/autoscaled worker fleets;
- the three-Organization, all-workload private-beta campaign and its D6 matrix;
- **`MIG-001`** — Decision #117 target and credential routing cutover *(not filed; see disposition X)*;
- **`MIG-009`** — reclassified to **B** by D-9; retained here only for the post-M1 sinks it also serves;
- **`DAT-009` / `DAT-010` / `DAT-011`** — provider-side artifact export under a worker-minted grant,
  control-plane-owned artifact retention, and tenant-free orphan sweep. *(`DAT-009` is now **M** and
  `DAT-011` **B**; the retention expansion beyond M1 stays retained.)*;
- **`WRK-012`** — the self-model refresh channel for a long-lived worker;
- **additional coding adapters beyond the approved first-milestone set** — no ticket exists for
  these, which is why they are named here explicitly rather than left to an implicit disposition;
- **threat controls recorded `partial` or `not-delivered`** other than DE-08, which has its own
  qualification below. No later epic sheet enumerates them, so they are retained here by name.

> ★ **AMENDED 2026-09-20 (Q6 audit).** The seven original bullets were materially incomplete: six
> surfaces were deferred somewhere and appeared in **no** retention list, so a reader could conclude
> they had been dropped. **Nothing was ever deleted** — every one had a retention statement
> somewhere in disposition C's prose — but this list is the retention set of record, so it now
> carries them.
These later phases are deferred, not deleted. Their program-design entries, findings, implemented slices, and conditional gates remain available for later milestone proposals.

### Program exclusions, not later phases

- tenant-defined public ingress;
- cloud plugin execution;
- multi-region active-active control-plane writes; and
- a self-hosted Firecracker **fleet** — ★ but *"only the provider-neutral extension seam is in
  scope"* (`program-design.md:50`). The qualifier is restored here: the **seam** is in scope and is
  not excluded by this line. Dropping it, as this list originally did, lets a reader of the triage
  alone conclude the seam was cut too.

These are not part of the current program and are not queued behind the first milestone. Adding any of them requires a separate future design and explicit scope decision.

## Dormant default-deny egress qualification

The checked-in default-deny/allowlist shape is not an enforcement claim while the provider path does not enforce it. For this milestone:

- no document may say sandbox egress denial passed merely because a policy object or allowlist was constructed;
- the managed-shared internal alpha may proceed only under the recorded accepted-residual model: host, operator, control-plane, cross-tenant, and unrelated connector credentials do not enter the sandbox; only the participating Organization’s approved runtime credential and scoped data are exposed;
- metadata/control-plane reachability is recorded as an unresolved provider-boundary risk rather than silently treated as denied;
- browser, service, and external beta claims remain blocked, while public ingress remains a program exclusion; and
- any self-hosted or tenant-hosted tier that promises egress denial must produce live packet-path enforcement evidence before enablement.

The accepted managed-shared DE-08 residual conflicts with the still-normative H-06/D2 network boundary: H-06 requires metadata, private, worker-control, and control-plane destinations to remain denied, including direct-IP, redirect, and DNS-rebinding variants. The DE-08 scope decision did not amend that gate. `M1-D1-SPINE` and `M1-D2-CODING` must record the residual and the credential-taxonomy mitigation explicitly, but neither may mark H-06 passed. Any full D1/D2, E6, or E7 completion requires live evidence satisfying the current requirement or a separately approved normative amendment.

The qualification limits blast radius; it does not turn a dormant control into a delivered one or a hard-invariant failure into a pass.

## Entry criteria

The milestone candidate may enter its integrated QA campaign only when:

- the proposal is approved and its dispositions are reflected in owner-approved epic plan amendments;
- E0–E2 historical completion evidence has passed a current dependency/delta review, including superseding records for any immutable-record breach;
- every required E3–E7 ticket has either a canonical approved result or a policy-compliant successor/adoption record that pins the retained historical blob and closes its stated delta;
- E3–E6 have candidate-specific ledgers showing which mechanisms are production-reachable rather than merely present and which clauses are certified only by `M1-D1-SPINE`;
- every E5 implementation/build gap required by the M1 subset is closed and production-wired, with focused acceptance green;
- the proposed E5 a2 seven-clause audit matrix, commands, exact topology, QA owner, and decision owner are approved and frozen; the a2 record is planned to consume the exact M1 candidate campaigns rather than required to pass before they start;
- the supported adapter, tools, workspace, output, audit/cost, and cleanup paths are enabled only for the named internal Organization;
- no excluded workload, desktop, mobility, cutover, HA, or beta flag is enabled;
- the candidate revision, topology, configuration digests, external dependencies, partial-gate owner, QA owner, and rollback owner are frozen before the run starts; and
- reviewers acknowledge that the accepted DE-08 residual leaves H-06 unsatisfied for full D1/D2 and therefore prevents E6/E7 completion absent a separately approved normative amendment.

## Exit criteria

The first milestone passes only when one exact candidate has:

1. all required ticket results approved with no pending review sentinel;
2. a fresh `M1-D1-SPINE` partial-gate campaign on the declared one-control-plane/one-worker topology;
3. a fresh `M1-D2-CODING` partial-gate campaign covering the included journey, hostile tenant/credential cases, cancellation, output/artifact integrity, and every terminal cleanup path;
4. useful-agent capability evidence: the sandboxed adapter can use the approved tools/workspace and return attributable reviewable output; a mechanism-only run with `capabilityProven=false` cannot satisfy this criterion;
5. explicit observation of the dormant-egress residual and credential-taxonomy checks, without an egress-enforcement claim;
6. zero unresolved milestone-blocking findings and a recorded rollback rehearsal for the enabled path;
7. a committed passing E5 a2 audit for that exact candidate, consuming both M1 campaign records and retaining every full-gate non-certification;
8. committed `Result: pass` QA records for both named partial gates on the exact candidate; and
9. a later committed, explicitly non-epic-completing `Decision: pass` milestone handoff by the named owner for the same candidate.

Ticket shipment or an earlier mechanism run cannot substitute for items 2–9. Passing this milestone does not change E3–E7 to `complete`; their normative epic gates remain outstanding.

> ★★★ **ALLOCATION ACROSS THE M1a/M1b SPLIT (2026-09-20).** The nine criteria are not relaxed;
> they are divided, and `M1b` inherits every `M1a` criterion unchanged.
>
> | Criterion | `M1a` | `M1b` | Note |
> |---|---|---|---|
> | 1 — all required ticket results approved | ✅ | ✅ | **Unsatisfiable until D-10 lands**: `MIG-010` is a required (B) ticket that deliberately carries no result so `E7-F007` keeps an owner. File the successor first. |
> | 2 — fresh `M1-D1-SPINE` campaign | ✅ | ✅ | |
> | 3 — fresh `M1-D2-CODING` campaign | ✅ *(mechanism verdict)* | ✅ *(both verdicts)* | one campaign may produce both records; the verdicts are recorded separately |
> | **4 — useful-agent capability evidence** | ✖ | ✅ | **The split lives here.** `M1a` is satisfied by a record reporting `capabilityProven=false`; `M1b` is not, and the bar is unchanged. |
> | 5 — dormant-egress residual observed | ✅ | ✅ | |
> | 6 — zero blocking findings + **recorded rollback rehearsal** | ✅ | ✅ | **D-9:** the rehearsal USES the `MIG-009` drain, so `E10-1-drain` must be wired — not a manual runbook. |
> | 7 — committed passing E5 a2 audit | ✅ | ✅ | |
> | 8 — `Result: pass` QA records for both named gates | ✅ | ✅ | |
> | 9 — non-epic-completing `Decision: pass` handoff | ✅ | ✅ | filed under `docs/replatform/milestones/<M>/handoffs/` per **D-11** |
>
> ★ **`E3-F037` is an `M1a` blocker under criterion 6** (**D-8**): a distributed attempt writes no
> `cost_events` row, so arming the dial produces spend no budget policy can see, cap or pause. That
> is a safety property, and an alpha must not arm such a dial.

---

## Amendment record — 2026-09-20

Nineteen disputes, each verified at `4df71dada` against source rather than inherited from a document.

### Moved

| Ticket | From → to | Verified evidence |
|---|---|---|
| `DAT-009` | C → **M** | Slice 3 owns `createArtifactExportSequencer`, whose ONLY references are its own definition and the barrel re-export at `packages/worker-daemon/src/index.ts:178` — **zero production callers**. It is return-path link 3, which exit criterion 4 requires. |
| `DAT-011` | C → **B** | LANDED and production-wired: `createSweepTrigger` imported at `server/src/routes/worker-control.ts:44`, constructed at `:137`. Exit criterion 3 demands "every terminal cleanup path"; M1 mints artifact grants. |
| `MIG-009` | C → **B** | **D-9:** exit criterion 6's rollback rehearsal USES the drain. MIG-009 shipped it deliberately unwired (`E10-1-drain` dormant); wiring it gives criterion 6 a mechanism rather than a runbook. |
| `DEP-009` | D → **split A + D** | Its shipped admission half is load-bearing on journey item 1 — `admitAttemptCapacity` is composed on the live submit path (`server/src/services/job-submission.ts:34,131,136`). Leaving a `complete + CI-GREEN` ticket under "re-enter through their own approved scope" would re-open evidence M1 depends on. Two-replica HA stays D. |
| `WRK-013` | A → **M** | `Status: scoping`, no result, `E4-F009` open. `StartupReconcilerDeps.leaseCandidates` still has no durable source. No claim exists, so there is no promise to correct. |
| `DAT-007` | A → **M** | Its own result header: `PARTIAL — the core remote-reach is BLOCKED`. Already honest; the residual is build work on the tools-in path. |
| `CLI-008` | A → **M** | No result doc; **ten** open findings name it as `ticket`. The largest unbuilt block in the original A. |
| `DEP-011` | A → **split A + M** | Inverted sign — an UNDER-claim. `E6-F003` (HIGH, open) still reads that the driver API "is unspecified" and the adapter-manager has "zero implementation", both false at HEAD (`packages/adapter-manager/src/`; daemon consumer `packages/worker-networked-host/src/bin/networked-host.ts:41`). Record half → A; Slice 5 go-live → M. |
| `FND-006`, `FND-007`, `FND-008` | A → **N** | Frozen reviewed ledgers, no clause, no finding, and live enforcement — `isCloudPluginExecutionBlocked` has 23 production call sites; FND-007's authority JSON is read by the always-on `policy` checker. |
| `WRK-009`, `CLI-007` | A → **N** | Narrow and complete. `CLI-007` already carries its own caveat ("unblocks but does not promote E7-1") and resolved `E7-F001`. |
| `MIG-001`, `MIG-004` | C / D → **X** | Zero files on disk, confirmed by `find`. |
| `DAT-006`, `DAT-010`, `DSK-003`, `DSK-004`, `SVC-008`, `MIG-006` | C → **C1** | All shipped. C's "deferral preserves their owners" misdescribes finished, production-wired work — `DAT-010` sits on the milestone's own artifact-commit path (`server/src/services/artifact-commit.ts:42,272`). |

### Not moved, but recorded

- **`MIG-010` (B) had a structural deadlock.** It has no `-result.md` deliberately — adding one would retire it as `E7-F007`'s owner exactly when that finding needs one — while exit criterion 1 requires results for every REQUIRED ticket. **D-10: file a successor for `E7-F007`** so MIG-010 can land a result honestly. Until that successor exists, criterion 1 is unsatisfiable.
- **`DBR-001` (C2) design text is stale.** It says "**no `aoa db:restore` command exists**"; the command shipped in #484 (`cli/src/commands/db-restore.ts`). Its DR scope placement is still correct.
- **`MIG-005` / `MIG-007` are NOT M1 prerequisites.** The milestone journey is `task_run`-only. A sibling document bundled them with the parity bridges into one pre-M1 stage; that bundling is corrected in [`RECONCILIATION-2026-09-20.md`](RECONCILIATION-2026-09-20.md). The **bridges** are M1 work (disposition A, journey item 7); the **cutovers** are Retained.
- **A fifth parity bridge is live and tracked by nothing.** `jobAdmissionBridge` (JOB-010) HAS a production caller (`server/src/index.ts:1225` import, `:1250` construct) and **no gate clause names it**. `E3-F038` closed this census class, but its scope was the guard header's fourteen named symbols and this is not among them. The four genuinely callerless bridges are **JOB-011/012/013/014**, not JOB-010..014.

`REL-FOUNDATION-GATE` is deliberately outside this 50-ticket accounting: its current program-design entry says it is nonnumeric, inert, and retained for human traceability rather than ticket-graph coverage.
