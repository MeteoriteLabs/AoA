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
> **50 distinct tickets, 52 entries, two declared splits** (`DEP-011`, `MIG-006`); nothing was
> dropped and nothing invented. *(`DEP-009` was briefly a third split; corrected — see disposition
> D. `MIG-006` became the second split in the sixth review round: its seam shipped and its cutover
> did not, and one row could not honestly say both.)*

### A. Promise-truth corrections — 20

These items reconcile what the program promised with what the shipped or partially shipped mechanism actually proves. Preserve their implementation and evidence, but do not inherit an over-broad completion claim.

`PRT-007`, `TEN-006`, `JOB-009`, `JOB-010`, `JOB-011`, `JOB-012`, `JOB-013`, `JOB-014`, `JOB-015`, `WRK-008`, `WRK-010`, `WRK-011`, `WRK-014`, `WRK-015`, `DAT-008`, `DEP-009`, `DEP-010`, `DEP-011` *(record half — split)*, `DEP-012`, `MIG-008`.

### B. Pre-milestone assurance and operations — 8

These items are required to make the narrow milestone supportable and honestly observable. Their evidence must be current for the milestone candidate even where a mechanism already exists.

`TRACK-001`, `TRACK-002`, `DAT-011`, `DEP-008`, `DEP-013`, `WRK-017`, `MIG-009`, `MIG-010`.

### C. Later original-program phase — 10 tickets, 11 entries

★ *Eleven entries because `MIG-006` is split across C1 (its shipped seam) and C2 (its deferred
crew cutover) — the second of the two declared splits. Ten distinct tickets, as the header says.*

These remain required or valuable in the original broader program, but they do not block the first milestone. **Split in two, because "deferred" was describing two different states and the distinction changes what is owed.**

**C1 — shipped, retained, not required by M1 (6).** Finished and production-wired, or inert by design. Nothing is owed but a later milestone's evidence; do NOT re-open their acceptance.

`DAT-006`, `DAT-010`, `DSK-003`, `DSK-004`, `SVC-008`, `MIG-006` *(seam half only — split)*.

★★★ **`MIG-006` IS A SPLIT, AND CLASSIFYING THE WHOLE TICKET C1 WAS WRONG.** *Corrected 2026-09-20
(sixth round), verified at source.* C1 promises the work is finished and that its acceptance must
not be re-opened — but `MIG-006-crew-routing-seam-design.md` says the ticket **still has no
`-result.md`**, that a distributed crew run is *“MECHANISM-ONLY”*, and in terms that it is
***“not an end-to-end crew cutover”***, with the rollout dial default-OFF for crew. Meanwhile `M2`
below assigns exactly that cutover as build work. Both could not be true.

- **C1 — the routing seam**: shipped and production-wired, doubly gated (Unit C tool-less, Unit F
  result-deferred), default-OFF. Do not re-open THIS.
- **C2 — the crew cutover**: unbuilt and genuinely deferred to **M2**, where it keeps its owner,
  dependencies and acceptance intent. This half is what `M2` schedules.

**C2 — unbuilt, genuinely deferred (5).** Deferral preserves their owners, dependencies, findings, and acceptance intent.

`WRK-012`, `MIG-005`, `MIG-006` *(crew-cutover half — split; the seam is C1)*, `MIG-007`, `DBR-001`.

### D. Optional expansion — 1

These are explicit expansion choices, not silent prerequisites for the first milestone. If selected later, they re-enter through their own approved scope and evidence gates.

`WRK-016`.

★★★ *Corrected 2026-09-20: `DEP-009` was listed here as a split, on the reading that its
two-replica HA half was later expansion. **It is not — it shipped.** `DEP-009-result.md` reads
`complete + CI-GREEN`, with the live two-replica boot and `e6f-11` **6/6** proven on
`d1-merge-train`, and `docker-compose.d1.yml` carries the `control-plane-b` replica. Filing shipped
work under "if selected later, they re-enter through their own approved scope and evidence gates"
repeats the error the C1/C2 split was made to fix. `DEP-009` is now wholly disposition **A** —
and its promise-truth correction is precisely that proving **two replicas boot in D1** is not
proving **production-scale HA behind a load balancer**, which is D5's bar and M4's work, owned by
D5 rather than by this ticket.*

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

★★★ **AND WIRING THE BRIDGE IS NOT ENOUGH — `M1a` MUST ALSO COMPOSE THE USAGE PRODUCER.**
Corrected 2026-09-20 after review. `E3-15-budget`'s own register reason records the measurement:
the deployed worker composes its supervisor **without `observeRun`**
(`packages/worker-daemon/src/lifecycle/dispatch-runtime.ts`, pinned by its own test asserting
`observeRun` is `undefined`), and usage is emitted only inside `if (deps.observeRun)`
(`packages/worker-daemon/src/supervisor/supervisor.ts`). **So there is no usage event for the bridge
to price.** Closure is a conjunction — *a producer AND the wiring* — and wiring alone would let a
reader mark criterion 6 satisfied while distributed spend still bypasses every cap and auto-pause.
That is the "half a conjunction" error this programme has retracted publicly once.

★ **This does NOT pull Unit F into `M1a`.** `observeRun` is the supervisor's *instrumentation* seam
— it already exists and is merely passed `undefined` at composition — and it yields usage and logs.
Unit F's emit half is about *artifacts*, and stays in `M1b`. `M1a` owes the smaller piece: compose
the seam the daemon already has.

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

> ★★★ **SERVES `M1b` ONLY. `M1a` DOES NOT CONSUME THIS GATE AT ALL.** `M1a` is gated by
> `M1-D1-SPINE` + [`M1a-D2-MECHANISM`](#m1a-d2-mechanism--real-e2b-mechanism-partial-gate), which
> is a separate gate with its own campaign record and its own `Result`.
>
> ★ *Corrected 2026-09-20 (second review round). An earlier revision said `M1a` was gated by "the
> mechanism half of this gate". **There is no such half.** A QA record has one normative
> `**Result:**`, so a "half" is not a thing a gate owner can record — and leaving that sentence
> here meant an operator could still pass `M1a` by putting a partial verdict on THIS record instead
> of producing the standalone mechanism one, which is exactly the ambiguity `M1a-D2-MECHANISM` was
> created to remove. Creating the new gate without deleting the old sentence fixed the description
> and not the instruction.*

On the same exact candidate, run the included real-E2B `task_run` journey through an approved sandbox-local adapter, tool surface, workspace input, attributable output, cancellation, usage, provider failure, artifact integrity, and terminal cleanup. **This record's `Result` is the useful-capability verdict, and a run reporting `capabilityProven=false` FAILS it.** (It may also print the mechanism verdict for context, but the mechanism *gate* is `M1a-D2-MECHANISM` and only that record's `Result` passes `M1a`.)

This is not D2. It cannot complete E7, satisfy D2’s full run counts/schedule, or substitute for full D2 in a later D5/D6 or release decision. It unlocks only the internal alpha milestone after `M1-D1-SPINE` and its named dependencies pass.

### `M1a-D2-MECHANISM` — real-E2B mechanism partial gate

★★★ **Added 2026-09-20 after review, and it fixes a real defect rather than renaming one.** The
M1a/M1b split originally allocated *"the mechanism verdict"* of `M1-D2-CODING` to `M1a` and *"both
verdicts"* to `M1b`. **That cannot work.** Exit criterion 8 requires a committed `Result: pass` QA
record for **each partial gate a milestone names**; `M1-D2-CODING` is defined above as the *useful-coding*
gate and requires **attributable output**; and `templates/qa-result-template.md` gives a QA record a
**single** normative `**Result:**`. Annotating one field as a "mechanism verdict" does not create a
second `Result`. So the original wording either **falsely passed the useful-capability gate at
M1a**, or left **M1a impossible to pass** — and which of the two it did depended on who read it.

So the mechanism claim gets its OWN gate, with its own campaign and its own `Result` — never a share of another gate's:

On the same exact candidate, run the included real-E2B `task_run` journey end to end — dispatch,
distributed ownership, lease, secret redemption, staged input, E2B create/execute/teardown, durable
terminal, cancellation, provider failure, reconciliation and every cleanup path — **in a shipped CI
boot**, and record the operator-visible audit, cost and failure-classification signals journey item
7 names.

★ **It does NOT require attributable agent output, and a record reporting `capabilityProven=false`
satisfies it.** That is the gate's defining property, not a waiver: it is what makes `M1a` a real
checkpoint rather than a weakened `M1b`.

This is not D2 and not `M1-D2-CODING`. It cannot complete E7, cannot support any useful-capability
claim, and unlocks only `M1a`.

### Normative-gate boundary

**All three partial gates — `M1-D1-SPINE`, `M1a-D2-MECHANISM` and `M1-D2-CODING` — are non-promoting.** ★ *Corrected 2026-09-20 (fourth round): this read “Both partial gates are non-promoting”, which pre-dates the mechanism gate and is the ROOT of the stale-quantifier class — two epic plans quote this sentence verbatim as their binding non-promotion rule, so the count was wrong in three documents at once. A gate left out of a non-promotion rule is a gate that may promote.* They may support a separately named milestone decision, but not an epic-completion handoff for E3–E7. Full D1/D2 and any E6/E7 completion still require the current normative gates, including H-06, or a separately reviewed and approved amendment to `test-gates.md`.

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
| **M1a** | The spine | mechanism: one org, one CP, one worker, real E2B, in a **shipped CI boot** | `M1-D1-SPINE` + **`M1a-D2-MECHANISM`** | M0 |
| **M1b** | Useful capability | an agent's output reaches the founder | **all three, fresh on the `M1b` candidate** — `M1-D1-SPINE` + `M1a-D2-MECHANISM` + `M1-D2-CODING` ★ *corrected twelfth round: this named only `M1-D2-CODING`. Criterion 8 derives the required passing records from **the gates a milestone names**, so naming one here permitted an `M1b` handoff omitting the two exact-candidate records the recovery procedure requires.* | M1a, `CLI-008` Unit F, `DAT-009` 3c–3e |
| **M2** | Sink cutover | the legacy in-process paths stop owning execution | `M2-CUTOVER` *(to be named)* | M1b |
| **M2-RTF** | Realtime foundation | reconnect-safe realtime, proven on one revision | **`E10-REALTIME-FOUNDATION`** | M1b *(its three input tickets are already shipped)* |
| **M3** | Workload breadth | browser and service workloads run distributed | full **D3** + full **D4** | M2 **and `E10-REALTIME-FOUNDATION`** |
| **M4** | HA and disaster recovery | two replicas preserve correctness; a measured restore | full **D5** | M3 |
| **M5** | Private beta | three external Organizations, all workloads, 14 days | full **D6** → **E11 exit** → **program integration checkpoint** (merge to `main`) | M4 |

### `M0` — record and lane health

**Scope.** Disposition **B**, plus the record-truth half of **A**.

★ **NOT "no feature work" — one build item is deliberately inside it, and pretending otherwise
would let M0 complete without finishing its own scope.** *Corrected 2026-09-20 (second round).*
`MIG-009` is in disposition B and is **split across two milestones**: its **evidence currency** (a
record on the M0 candidate) is M0's, and its **trigger build** — designing and wiring the real
`drainAll` invocation so criterion 6's rehearsal has a mechanism — is **`M1a`'s**, where it appears
in the required result set. M0 introduces **no new product capability**; that is the honest claim,
and it is narrower than the one this line used to make.

**Why it is a milestone and not a chore.** Every later milestone's exit criteria are *"a committed
`Result: pass` QA record on the exact candidate"*. A lane that is red, or green but unread, cannot
produce one. `E6-F021` is the worked example: the `E6-D1-FOUNDATION` lane was red for five days on a
deleted upstream image and the consumer built to report that could not see it.

**Exit.** `d1-merge-train` and every keyed lane green or explicitly quarantined with an owner; the
DEP-013 consumer reporting zero unowned findings — ★ *where a finding is on a stream that can only
run from `main`, it is satisfied by being recorded **blocked on the program integration checkpoint,
with a named owner**, not by clearing (founder ruling 2026-09-21; see below)*; disposition-A record corrections landed; a
successor filed for `E7-F007` so `MIG-010` can carry a result (**D-10**); **and an approved,
candidate-current result for every disposition-B ticket — `TRACK-001`, `TRACK-002`, `DAT-011`,
`DEP-008`, `WRK-017`, and `MIG-009`'s evidence-currency record** (its trigger build is `M1a`'s).

★★★ **A SCHEDULED LANE CANNOT BE CLEARED FROM THE PROGRAM BRANCH, and criterion 2 as first written
did not know that.** *Added 2026-09-21 after M0 executed; founder ruling "blocked, with owner".*
GitHub runs `schedule` triggers **only from the default branch**, so a `cadence`-mode stream such as
`cross-platform-weekly.yml@main` executes `main`'s copy of the workflow. `docs/replatform-program`
is **not** an ancestor of `main` and, by the LOCKED integration strategy
(`program-design.md` §*Integration branch and PR strategy*), does not reach it until the **program
integration checkpoint**. A fix landed on the program branch therefore **cannot** change that
stream's verdict inside M0 — or inside any milestone before the checkpoint. Such a finding is
recorded **blocked on the integration checkpoint** with a named owner, which satisfies criterion 2
the same way "quarantined with an owner" satisfies criterion 1. It is **not** cleared, and it is
**not** evidence that the lane is healthy: see `E6-F023`, under which a green run of that lane
does not imply its tests passed.

★ *Corrected 2026-09-21 (Codex, PR #526):* **this amends criterion 2; it does not claim M0 meets it.** The checkpoint-blocked item
is the DEP-013 consumer's `cross-platform-weekly.yml@main` stream verdict, **not** `E6-F023`. Its
owner has **not** been named yet: naming it, and recording it where the consumer reads it, is
remaining M0 work, and M0 does not exit until both are done.

★★★ **BOTH DONE 2026-09-21 — and the consumer had to be taught what "owned" means first.** At
source the DEP-013 consumer had **no ownership concept at all**: `WATCH_MODES` was exactly
`coverage | cadence | not-watched` (`scripts/lib/workflow-verdict.mjs`) and a finding carried no
owner, so every finding it reported was unowned by construction and "zero unowned" was unreachable
except by reporting nothing. Founder ruling: add a real **`blocked`** state rather than marking the
stream `not-watched`, because `not-watched` stops the sweep looking and this stream is the
manifest's declared **free positive control** — unwatching it would make "zero unowned" true by
removing the thing being counted.

- **Owner:** `founder (gate owner)` — named by the founder.
- **Recorded where the consumer reads it:** `scripts/workflow-verdict-manifest.json` →
  `cross-platform-weekly.yml@main.blocked` `{ on, owner, reason }`.
- **Still evaluated, still reported:** a block tags the lane's VERDICT with its owner; it never
  suppresses evaluation, and it never tags a mechanism failure (`workflow_file_missing`,
  `cron_unreadable`), so it cannot launder a broken consumer into "owned".
- **Measured on this branch** (`reconcile-workflow-verdicts.mjs --dry-run`, 17 watched streams):
  `FINDING cross-platform-weekly.yml@main: not_success … [OWNED by founder (gate owner), blocked on
  the program integration checkpoint (M5)]` → **`1 finding(s), 0 UNOWNED`**. The published issue
  confirms it on `docs/replatform-program` once the reconciler runs after merge.
- **Remove the block at M5** and read the stream on its own verdict — the manifest's `reason` says so. `E6-F023` is a separate register
finding, cited above only for the lane-health caveat. It is `unowned` in
`scripts/finding-ownership.json`, which is a legal register state. It is being **resolved** inside
M0 by implementing its option-3 ruling, not carried as checkpoint-blocked. The ruling's heading,
"gate owner: option 3", records who ruled, not who owns it.

★ That enumeration is B in full: B has **eight** members. `DEP-013` is named by its own clause
above (the consumer). **`MIG-010` owes an approved result too, and M0 does not exit without it** —
★★★ *corrected 2026-09-20 (eighth round): an earlier revision treated the D-10 clause as
discharging `MIG-010`. It does not. Filing the `E7-F007` successor only removes the ownership
deadlock **so that** `MIG-010` CAN receive a result; it neither creates nor approves one. As
written, M0 could exit with a disposition-B ticket still lacking canonical evidence, and the `M1a`
required-result set does not pick it up either — so the result would have been owed by nobody.*
The order is therefore: file the successor, **then** commit and approve `MIG-010`'s result, both
before M0 exits. None of the eight is exempt.

★★★ **THE B CLAUSE WAS MISSING, AND WITHOUT IT M0 COULD PASS WITHOUT ITS OWN DECLARED SCOPE.**
*Corrected 2026-09-20 (sixth round).* M0's scope is *“Disposition **B**, plus the record-truth half
of **A**”*, but this exit list named only the lanes, the consumer, the A corrections and the
`E7-F007` successor — so every B ticket could be skipped and `M1a` could start on exactly the
stale assurance evidence M0 exists to refresh. A milestone whose exit does not require its own
scope is not a checkpoint.

### `M2` — sink cutover

★★★ **`MIG-001` IS SCHEDULED HERE TOO, BECAUSE THE SEQUENCE CANNOT REACH ITS OWN FINAL EXIT
WITHOUT IT.** *Added 2026-09-20 (thirteenth round), verified at source.* `epics/E11-hardening-release/README.md`
lists *“E8, E9, DEP-009, **MIG-001 through MIG-003**, and MIG-005 through MIG-008”* as
**unconditional** E11 dependencies, and `M5` exits through E11 — but `MIG-001` is disposition **X**
(zero files on disk) and **no milestone named it**, so an M5 planner would have discovered the
Decision #117 target/credential-routing cutover outside every milestone. `MIG-003` has shipped and
`MIG-002` has a ticket; `MIG-001` is the one with nothing.

★ **It is a cutover, so `M2` is its natural home — and like the `M1a` `TO FILE` rows, FILING IT IS
STEP-0 WORK**: it has no ticket, so it cannot carry a result until one exists. ★ *My own
ticket-coverage sweep missed this, because it excluded disposition X as legitimately unscheduled —
an exclusion is only safe if nothing else declares the ticket required, and E11's dependency set
did.*

**Scope.** `MIG-001` *(Decision #117 target/credential routing cutover — **TO FILE at M2 Step 0**)*,
`MIG-005` (Commander), `MIG-006` (crew — units shipped, cutover deferred), `MIG-007`
(extraction). The four parity
bridges are **not** here — three are `M1a` (D-8) and the fourth, `jobApprovalBridge`, follows its
sink.

★★★ **`E10-1-drain` IS NOT M2's TO PROMOTE — it is an INHERITED PREREQUISITE, already wired at
`M1a`.** *Corrected 2026-09-20 (fourth round).* An earlier revision listed it here as *“promoted
from dormant on a real `drainAll` trigger”*, which contradicts two things this document says
earlier: `M1a`'s required result set owes **the drain and its trigger** (D-9), and `M1a` exit
criterion 6 requires a **recorded rollback rehearsal** that USES that drain rather than a manual
runbook. Since `M2` cannot be entered until `M1b` has passed — which is after `M1a` — a candidate
arriving at `M2` with `E10-1-drain` still dormant is one that could not have passed `M1a`. Leaving
the line would have either reopened approved `M1a` work or given two milestones contradictory
ownership of the same clause. `M2` **verifies** the drain it inherits; it does not promote it.

**Entry.** `M1b` passed — which carries `M1a`'s wired `E10-1-drain` with it. `E10-F001`'s
prerequisite analysis re-measured at HEAD — it is the finding that records that *no* Sprint-6 sink
was buildable, and it must be re-tested rather than inherited.

**Exit.** For each cut-over sink: the distributed path owns the write, the legacy path is
provably not reached, and rollback is rehearsed. `E3-5-product-approval`, `E3-17-output`,
`E3-audit-parity-bridge` and `E10-1-drain` all `wired` with real callers.

### `M3` — workload breadth

**Scope.** E8 browser (**`BRW-003c`**, `BRW-004`, `BRW-005`, `BRW-006`, **`BRW-007`**, **`BRW-008`** — the last two **TO FILE at M3 Step 0**: authorized by the E8 scope addendum, but with no graph node or ticket file yet) and the E9 service remainder
(`SVC-003`, `SVC-005` and `SVC-007` **residuals**, `SVC-004`, `SVC-006`, `SVC-009`).

★★★ **IDS ARE WRITTEN OUT IN FULL HERE ON PURPOSE.** *Corrected 2026-09-20 (thirteenth round).*
An earlier revision wrote `` `SVC-003`/`005`/`007` ``, which reads fine and is **invisible to every
mechanical check** — a coverage sweep scanning for ticket ids sees only `SVC-003`, so `SVC-005` and
`SVC-007` appear unscheduled while in fact being in scope. My own ticket-coverage sweep reported
exactly that false gap, which is how the abbreviation was found. **An id that a checker cannot read
is an id that is not really enumerated**, and this document's whole method depends on its lists
being machine-checkable.

★ **`SVC-008a` is a known residual with a design and no result**, and it is covered by `SVC-008`'s
**C1** disposition (shipped, retained). It is named here so that a dependency sweep reading E9's
`README.md` — which lists it among E9's dependencies — does not report it as unowned.

★★★ **`SVC-009` WAS SCHEDULED BY NOTHING, and M3 could not have reached its own exit without it.**
*Added 2026-09-20 (eighth round), verified at source and independently by a mechanical
ticket-coverage sweep of this document.* It sits outside the 50-ticket roster, so no disposition
carries it, and no milestone named it — yet `epic-regrooming/epics/E9.md` requires *“`SVC-009`
worker-side renewal-capability consumption and the E2B TTL extension”* **before a service run beyond
240 seconds can be proven**, and M3 exits on the full **D4** campaign, which is 72 hours. An
enumerated scope that omits it sends the planner to discover unscheduled work at the exit gate.
`SVC-009` and its duration follow-up are M3's.

★★★ **`BRW-003c` WAS SCHEDULED BY NO MILESTONE AT ALL, and that is why it is named here.**
*Added 2026-09-20 (seventh round), verified at source.* `BRW-003`'s retention slice is
**design-only** — a design file exists, there is no result — and `E8-browser-automation/findings.md`
makes shipping it part of the resolution condition for the **HIGH** finding `E8-F011`, whose owner
is currently `unowned` *because* `BRW-003c` is design-only. `BRW-005` and `BRW-006` depend on
`BRW-003`. Since no later milestone named it, a planner could have completed every listed browser
ticket and left the sensitive-artifact **retention / purge / audit** gap permanently unscheduled —
an enumerated scope that silently drops a HIGH finding's only route to closure.

★★★ **RETRACTED — I WAS WRONG ABOUT `BRW-007` AND `BRW-008`, AND THEY ARE M3 SCOPE.**
*Corrected 2026-09-20 (thirteenth round), verified at source.* An earlier correction of mine said
they *“have no program-design node and no ticket file … filing them is a programme-owner
decision”*. The first half is true and **the conclusion does not follow**: the authority already
exists. `epics/E8-browser-automation/scope-addendum-agent-and-commander.md` is titled *“E8 scope
addendum — BRW-007 and BRW-008”*, records **“Authority: programme owner decision”**, sizes both
tickets, and fixes the chain `BRW-004 → BRW-006 → BRW-007 → BRW-008`. E8's `README.md` lists
*“BRW-001 through BRW-008”* and its **exit gate** includes the agent session request and retiring
the host-side path — i.e. exactly these two.

★ **Absence of a design NODE is not absence of AUTHORITY**, and that is the distinction I collapsed.
Since `M5` exits through E11, which depends on E8, leaving them unscheduled would have parked
required E8 work outside every milestone — the same defect as `MIG-001`. They are named in M3's
scope above; the missing graph node and ticket files are **M3 Step-0 filings**, exactly like the
other `TO FILE` rows.*

★★★ **ENTRY BLOCKER THIS SEQUENCE ORIGINALLY MISSED — `E10-REALTIME-FOUNDATION`.**
`epics/README.md` records that **`BRW-006` requires it** and **`SVC-007` requires it**, and
`test-gates.md` RTF-00 states the gate "exists only to unblock reconnect-safe claims in CLI-006,
BRW-006, and SVC-007". Since `BRW-006` carries D3 and `SVC-007` carries D4, **M3 as first written
could not pass.** It now has its own milestone, `M2-RTF`, because the work is a campaign rather
than a ticket:

- **Its three input tickets have ALL shipped** — `JOB-005`, `DEP-009`, `MIG-003` each carry a
  `-result.md`. So the gate is **passable today**.
- **The gate itself is UNPASSED.** Measured 2026-09-20: **zero** QA records anywhere under
  `epics/*/qa/` reference `E10-REALTIME-FOUNDATION`, and **no** handoff named
  `e10-realtime-foundation` exists. RTF-07 requires that handoff by name.
- ★ **`MIG-003` shipping is not the gate passing.** Its result doc says `complete` /
  `Disposition: pass` — that is a **ticket** result. The gate additionally requires RTF-01…RTF-06
  proven on **one exact revision**: two interchangeable replicas authorising by Organization and
  Company, ≥10,000 durable events across ≥2 Organizations with 100 reconnect gaps recovered in
  exact order and 100 duplicate injections suppressed, a 15-minute broker outage, bounded
  backpressure, control-versus-presence, and the redaction canary corpus. **Treating the ticket
  result as the gate record is exactly the "a ticket shipped" / "an epic passed its gate" collapse
  this proposal exists to prevent.**

**★ The known blocker, stated up front.** `packages/browser-runtime` has **zero importers anywhere
in the tree**, and `workload.browser_session` is filtered out of the worker hello — so a browser job
can be submitted and placed-for but never leased. M3 begins by fixing that, not by writing a
campaign.

★★★ **THE `playwright` devDependency IS NOT A BLOCKER — it is the STAGED architecture working as
designed, and calling it “unshippable as written” was false.** *Corrected 2026-09-20 (seventh
round), verified at source.* `packages/browser-runtime/src/runner.ts` is **staged into the sandbox**,
not installed, and `e2b/e2b.Dockerfile:44-50` installs Playwright **globally** and sets `NODE_PATH`
for exactly that reason — its own comment says so: *“Installed GLOBALLY with NODE_PATH set, because
the runner is STAGED, not installed … so the guest has no node_modules of its own.”*
`runtime-dependency.test.ts` documents and tests that architecture. Treating the intentional
devDependency as fatal would make M3 require an unnecessary manifest change and would propagate a
false prerequisite into the E8 and E11 plans. **The real remaining blockers are reachability/staging
and capability advertisement** — the two named above.

**Exit.** Full **D3** and full **D4**, including D4's 72-hour continuity campaign.

### `M4` — HA and disaster recovery

**Scope.** `WRK-016` (replica-safe worker volumes), `REL-003`'s owed
DR rehearsal with measured RPO/RTO, `DBR-001`, and **the production-scale HA bar itself, owned by
D5** — not by `DEP-009`.

★ *Corrected 2026-09-20: this scope line still named "`DEP-009`'s two-replica half" after that
ticket was un-split and moved wholly to **A**. Leaving it would have told the M4 planner to re-open
an approved `complete + CI-GREEN` ticket instead of naming the real D5 work owner. Same incomplete
sweep as the amendment row below — one fact corrected in one place and not its siblings.*

**Exit.** Full **D5**.

★★★ **FULL `D2` IS AN UNSCHEDULED ENTRY PREREQUISITE FOR `M5`, AND SOMEBODY MUST OWN IT.**
*Added 2026-09-20 (twelfth round), verified at source.* `test-gates.md` `D6-01` requires *“all
D0–D5 records, including **D2 coding**, D3 browser, and D4 service … current for the same release
candidate”*, and it says plainly that *“a coding-only candidate cannot enter or pass D6”*. `M1b` is
explicit that its `M1-D2-CODING` record **cannot substitute for full D2**, and **none of M2, M3 or
M4 schedules a full-D2 campaign** — so the sequence arrives at its final milestone with an entry
prerequisite nobody owns.

★ **Full `D2` belongs to `M3` or `M4`, and D6 consumes it only if it is CURRENT FOR THE SAME
CANDIDATE** — so whichever milestone owns it, `M5` still owes a same-candidate rerun unless it
inherits a record attesting M5's own candidate. **Which milestone takes it is a programme-owner
decision**; the files do not settle it, and inventing one here would repeat the mistake this note
exists to catch.

### `M5` — private beta

★★★ **M5 IS WHERE THE PROGRAM BRANCH REACHES `main`, and this is a LOCKED decision, not a new one.**
*Pinned 2026-09-21.* `program-design.md` §*Integration branch and PR strategy (LOCKED)*: *"No
per-epic PRs and no per-epic merges to `main`"*; *"Merge to `main` happens only at the program
integration checkpoint (governed by the Release/gate policy), never per epic."* The milestone
sequence never said which milestone that checkpoint is. It is the end of the programme — after the
E11 exit, which is the release gate. Nothing before M5 merges to `main`.

★ **Consequences to plan around, not to fix early:** (1) any lane that runs only on `schedule`
measures `main`'s code, not the program branch, for the whole programme — cross-platform health of
the program branch is unmeasured by schedule until then, and needs a `workflow_dispatch` or push
trigger on `docs/replatform-program` if it is wanted sooner; (2) `release.yml` and `docker.yml`
publish **automatically** only on `push` to `main`, so nothing is published by merge before the
checkpoint — ★ **but both also declare `workflow_dispatch`**, and a manual `docker.yml` dispatch
from `docs/replatform-program` pushes a `type=sha` image to GHCR (`latest` is applied only on the
default branch). So pre-checkpoint publication is **possible by manual action**, not impossible; it
must be treated as a deliberate, authorized act, never a side effect. *Corrected 2026-09-21 (Codex,
PR #526): an earlier revision said no artifact could be published before the checkpoint.*

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
- **`WRK-012`** — the self-model refresh channel for a long-lived worker. ★★★ **It is CONDITIONAL, not optional, and its trigger is recorded here so retention cannot quietly become abandonment.** *Added eleventh round:* `WRK-012-design.md` states when it becomes **REQUIRED** — long-lived workers with operational mid-life constraint rotation. No milestone blocks on it today and the files do not establish which one should, so **naming that milestone is a programme-owner decision**; until it is made, this trigger is the thing to watch, not the ticket's absence from a scope list;
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

The accepted managed-shared DE-08 residual conflicts with the still-normative H-06/D2 network boundary: H-06 requires metadata, private, worker-control, and control-plane destinations to remain denied, including direct-IP, redirect, and DNS-rebinding variants. The DE-08 scope decision did not amend that gate. **all three partial gates — `M1-D1-SPINE`, `M1a-D2-MECHANISM` and `M1-D2-CODING` —** must record the residual and the credential-taxonomy mitigation explicitly, and **none** may mark H-06 passed ★ *(corrected thirteenth round: this named two gates, so an `M1a` campaign — which owns dormant-egress criterion 5 — could have omitted the required safety evidence entirely)*. Any full D1/D2, E6, or E7 completion requires live evidence satisfying the current requirement or a separately approved normative amendment.

The qualification limits blast radius; it does not turn a dormant control into a delivered one or a hard-invariant failure into a pass.

## Entry criteria

★★★ **THESE ENTRY CRITERIA ARE `M1b`'s. `M1a` ENTERS ON THE SUBSET BELOW, AND WITHOUT THAT SPLIT
THE CHECKPOINT IS UNREACHABLE AT ENTRY.** *Added 2026-09-20 (twelfth round).* The M1a/M1b split
divided the **exit** criteria and left these **entry** criteria shared — and they require *“every
required E3–E7 ticket”* and *“the supported adapter, **tools, workspace, output**, audit/cost and
cleanup paths”* to be enabled before any integrated campaign may start. That is the `M1b` result set
and the output capability `M1a` exists to defer, so an `M1a` candidate could never be admitted — the
same defect the recovery order had, one document further up, and splitting only the exits did not
cure it.

★★★ **`M1a`'s FIRST ENTRY BLOCKER IS `EVID-04`.** *Added 2026-09-21.* M0 needed no milestone QA
record — its row names no gate — so `EVID-04` did not block it. `M1a` names two gates
(`M1-D1-SPINE`, `M1a-D2-MECHANISM`) and owes their QA records under
`docs/replatform/milestones/M1a/qa/`, a path `test-gates.md` `EVID-04` does not permit
(*"Use `docs/replatform/epics/<epic>/qa/…`"*). Amending a gate is a **gate-owner action**. Until
it is amended, `M1a` cannot file a conforming gate record and so cannot pass. `M2-RTF` is blocked
the same way.

★ **`M1a` entry — THE EXACT DEFERRED SUBSET IS `tools` AND `output`.** The **adapter**,
**workspace**, **audit/cost** and **cleanup** paths must be enabled for the named internal
Organization; the **tools** and **output** paths need not be. `M1a` is satisfied by a run reporting
`capabilityProven=false`, and the tool surface is armed by `CLI-016` (was `CLI-008-C5`), which is an **`M1b`**
ticket — so requiring tools at `M1a` entry would make the checkpoint depend on `M1b` work. Workspace
staging IS required: the `M1a` journey stages input. The required-ticket bullet is scoped to
**`M1a`'s own required result set**, not to every E3–E7 ticket. Every other bullet applies to both
milestones unchanged.

★★★ *Corrected 2026-09-20 (thirteenth round): an earlier revision exempted only the output half,
which still required the tool surface that `C5` does not arm until `M1b` — while the recovery
procedure deferred tools, workspace AND output. The two documents named different subsets, so an
operator could freeze a candidate that fails `M1a`'s own entry conditions. **`tools` + `output`,
stated identically in both places.***

**`M1b` entry — and, except as scoped above, `M1a` entry** — the milestone candidate may enter its
integrated QA campaign only when:

- the proposal is approved and its dispositions are reflected in owner-approved epic plan amendments;
- E0–E2 historical completion evidence has passed a current dependency/delta review, including superseding records for any immutable-record breach;
- every required E3–E7 ticket has either a canonical approved result or a policy-compliant successor/adoption record that pins the retained historical blob and closes its stated delta;
- E3–E6 have candidate-specific ledgers showing which mechanisms are production-reachable rather than merely present and which clauses are certified only by `M1-D1-SPINE`;
- every E5 implementation/build gap required by the M1 subset is closed and production-wired, with focused acceptance green;
- the proposed E5 seven-clause audit matrix, commands, exact topology, QA owner, and decision owner are approved and frozen — ★ *the matrix is frozen once and reused across attempts; `a2` attests the `M1a` candidate and `M1b` owes `a3` or later, corrected twelfth round* — ; the audit record is planned to consume the exact M1 candidate campaigns rather than required to pass before they start;
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
7. a committed passing **E5 audit attempt for that exact candidate** — `a2` for `M1a`, and `a3` or later for `M1b` — consuming that milestone's campaign records and retaining every full-gate non-certification. ★★★ *Corrected eleventh round: this said “a2 audit” while being allocated to **both** milestones, and `M1b` freezes a different candidate. An audit attests one exact revision exactly as a gate record does, so `M1b` reusing `a2` would point its criterion-7 evidence at the older tree — the defect the gate-record rule already forbids. A correction or changed candidate creates a new attempt linked by `Supersedes`, never an edit.*;
8. committed `Result: pass` QA records for **each partial gate that milestone names** on the exact candidate (★ *was “both named partial gates” — phrased by count, it silently excluded the third gate; phrased by the naming relation it cannot go stale when a gate is added*); and
9. a later committed, explicitly non-epic-completing `Decision: pass` milestone handoff by the named owner for the same candidate.

Ticket shipment or an earlier mechanism run cannot substitute for items 2–9. Passing this milestone does not change E3–E7 to `complete`; their normative epic gates remain outstanding.

> ★★★ **ALLOCATION ACROSS THE M1a/M1b SPLIT (2026-09-20).** The nine criteria are not relaxed;
> they are divided, and `M1b` inherits every `M1a` criterion unchanged.
>
> | Criterion | `M1a` | `M1b` | Note |
> |---|---|---|---|
> | 1 — all required ticket results approved | ✅ *(scoped — see below)* | ✅ | **TWO tickets make the unscoped reading unsatisfiable**, not one. `MIG-010` (B) carries no result so `E7-F007` keeps an owner — D-10 files the successor. **`CLI-008` (M) may not carry a parent result WHILE IT STILL OWNS OPEN FINDINGS**, and none is required for M1: ten findings name it as `ticket` and none names a successor, so a parent result written today orphans all ten at once. ★ *Corrected 2026-09-20 (fifth round): this said “can NEVER”. The reason given is conditional — it stops being true once `CLI-008-LEDGER` re-points the findings to the link-scoped successors — so the prohibition cannot be permanent, and the E7 plan says so in as many words: “only then can `CLI-008` carry a result honestly.”* |

> ★★★ **CRITERION 1 IS SCOPED PER MILESTONE — AND THE SETS ARE ENUMERATED BELOW, because a scope
> nobody can check is an exemption.** *Corrected 2026-09-20 (second round): an earlier revision said
> `M1a` requires results for "the tickets in ITS OWN set" without defining that set anywhere, so a
> gate owner could have dropped `WRK-013`, `DAT-007` or `DEP-011` by declaring them out of scope
> without contradicting a word of the criterion. That is the thing it claimed not to be.*
>
> **`M1a` required result set** — every one of these owes a `-result.md` before `M1a` passes:
>
> ★ **Each row says where its task is defined, because a set whose members resolve to nothing is
> the same exemption in a longer form.** *Self-review 2026-09-20 found three of these six had no
> task: one was cited too narrowly, and two had none at all — including `DEP-011-S5`, an id this
> document had invented. Corrected below rather than left to be discovered at M1a Step 0.*
>
> ★★★ **THE THREE ✅ TASKS ARE DEFINED IN THE COMPANION CHANGE, NOT IN THIS ONE — so a repo-wide
> search of THIS commit finds `DAT-007-S3` and `E7-1-JOURNEY-ARM` nowhere but this table, and that
> observation is correct.** *Added 2026-09-20 (third review round), which raised exactly that.* The
> epic implementation plans land as a **separate change on this same base branch**, merged
> back-to-back with this one because the dependency runs both ways: those plans are written against
> these dispositions, and these rows cite those plans. **A ✅ here is a claim about the merged base,
> not about this commit** — stated plainly so nobody reads it as a claim this commit can support.
>
> ★ **If the companion change does not land, these three rows become `TO FILE` and `M1a` Step 0
> files seven tickets instead of four.** That is the honest contingency; it is not the plan.
>
> | Ticket | Epic | Task defined | What it owes M1a |
> |---|---|---|---|
> | `MIG-009` | E10 | ✅ companion — E10 plan **§8.1**, *“wire the rollback drain to an honest operator trigger”* | the drain **and its trigger** (D-9), for criterion 6's rehearsal. ★★★ **The frozen `MIG-009-drain-result.md` DOES NOT SATISFY THIS ROW and may not be reused for criterion 1** — it records the trigger as deliberately `unwired`, which is the precise thing `M1a` must change. A **new** result is required. |
> | `DAT-007-S3` | E5 | ✅ companion — E5 plan, *“prove the `/mcp` run-currency gate against real PostgreSQL”* (task + verify command + mutation rows) | the `/mcp` run-currency gate proven against real PostgreSQL |
> | `E7-1-JOURNEY-ARM` | E7 | ✅ companion — E7 plan, *“promote the coding-journey clause when its two preconditions ship”* (S, ≤1 agent-day) | promote `E7-1-coding-journey` on a shipped CI boot. ★ Its E6 precondition (the adapter-manager image in a shipped boot) is **`DEP-011`'s deploy half, the `TO FILE` row below** — so this row is ordered behind it. |
> | `WRK-013` | E4 | ❌ **TO FILE** | the startup reconciler — journey item 8's restart recovery; closes `E4-F009`. Its design is `Status: scoping` and **no plan carries a task for it**. |
> | DEP-011's remaining deploy half | E6 | ❌ **TO FILE, scope unestablished** | the adapter-manager image + control-plane key in a **shipped** deploy. ★ An earlier revision called this `DEP-011-S5`; **that id does not exist** — no result doc, and neither the E6 nor E7 plan defines its task. Its exact remaining scope was explicitly recorded as *not established* by the plan drafting, and must be measured before it is assignable. |
> | the parity bridges + the usage producer | E3 + E4 | ❌ **TO FILE** | the three consumers (`jobBudgetCostBridge`, `jobAuditBridge`, `jobOutputBridge`) **and** the `observeRun` producer — **D-8**. |
>
> ★★★ **So `M1a`'s first act is filing four tickets, not building.** Three of the six rows have no
> task today. `M1a` cannot pass until every row carries a result, and a row cannot carry a result
> until it has a task — which makes the gap visible rather than letting a gate owner discover it
> mid-milestone.
>
> **`M1b` required result set:** `CLI-010`, **`CLI-011`**, `CLI-012`, `CLI-013`, `CLI-014`, `CLI-015`, `CLI-016`, `DAT-009-3c`, `DAT-009-3d`, `DAT-009-3e`, **and the emit build** (❌ **TO FILE** once `CLI-011` rules; it has no id until then).
> ★ *Corrected 2026-09-21 (Codex, PR #526):* the emit build was missing from this set. Without it every listed result can land without the chosen emit mechanism ever being built, and then `CLI-012`'s real-run acceptance and the useful-capability gate cannot be met. So `M1b`'s Step 0 files it right after the `CLI-011` ruling, and its result is a prerequisite of `CLI-012`'s real-run acceptance and of `CLI-015`.
> ★★★ **RENUMBERED 2026-09-21 (M0 unit 4, founder decisions D1 + D5) — the ids changed, the
> set did not.** *Superseded text: `CLI-008-F1a`, `CLI-008-F1b`, `CLI-008-F3`, `CLI-008-F4`,
> `CLI-008-F5`, `CLI-008-F6`, `CLI-008-C5`.* Those link-scoped ids **cannot be expressed to the
> guards**: `check-finding-ownership.mjs:423` tests an exact `tickets.has(entry.ticket)` and
> `findTicketIds` (`:50`) derives ids from filenames with `/^([A-Z]+-\d+)/`, so `CLI-008-F1a`
> resolves to nothing — and a `CLI-008-F1a-result.md` resolves to **`CLI-008`**, marking the
> parent shipped and orphaning every finding it owns. This enumeration is corrected because it
> is the **mechanically checkable artefact**: a coverage check reads the list, not the prose —
> the same reason `CLI-008-F1b` was added to it in the twelfth round. The full old→new mapping
> is in `program-design.md`, immediately before the `CLI-010` node.
> ★★★ *`CLI-008-F1b` added to the LIST twelfth round: the sentence after it already said its result
> is required and mandatory before `M1b` passes, while the enumeration omitted it — and the
> enumeration is the mechanically checkable artefact. A coverage check reads the list, not the
> prose, so this inconsistency would have let the output-mechanism design review be dropped by
> exactly the kind of automated check written to prevent that.* ★★★ **`CLI-011`'s result IS in the `M1b` set** — it is
> **design-only as to BUILD** (no build may be assigned from it), but its
> `CLI-011-result.md` (was `CLI-008-F1b-result.md`) is required and must be **approved before `M1b` passes**.
> *Corrected 2026-09-20 (eighth round): an earlier revision listed F1b as “not in either set”, which
> read as exempting its record. But the E7 plan requires that result by name, exit criterion 4
> depends on F1b, and `F6` cannot proceed without its founder ruling — so `M1b` could have passed on
> an **unreviewed output-mechanism decision**, which is the one decision the milestone most needs
> reviewed. “Design-only” limits what F1b may PRODUCE; it does not make its design review optional.*
> ★ *Corrected 2026-09-20 (fifth round): this said F1b “produces a design, not a result” while the
> E7 plan requires that record by name and requires committing it — an executor could not satisfy
> both. Design-only constrains what F1b may PRODUCE AS WORK, not whether it records what it did.*
> ★ The parent `CLI-008` produces **no result for M1**, and none may be created while it still owns
> open findings (one written today would orphan ten at once). ★ *Corrected 2026-09-20 (fifth round):
> this said “no result, ever”, which contradicts the E7 plan's “only then can `CLI-008` carry a
> result honestly” — after the ledger re-points the findings the bar lifts. ★ *M0 unit 4 re-pointed the two that genuinely map (`E7-F026`→`CLI-011`, `E7-F016`→`CLI-015`); **eight remain on `CLI-008`** because the ten findings do not correspond to the six Unit F links (D5). The bar has NOT lifted.* It is not in
> either required set either way.*
> | 2 — fresh `M1-D1-SPINE` campaign | ✅ | ✅ | |
> | 3 — fresh real-E2B campaign | ✅ **`M1a-D2-MECHANISM`** | ✅ **`M1-D2-CODING`** | two gates, two QA records, two `Result` fields. One campaign run may produce both, but a QA record has ONE normative `Result`, so the mechanism verdict needed its own gate — see above. |
> | **4 — useful-agent capability evidence** | ✖ | ✅ | **The split lives here.** `M1a` is satisfied by a record reporting `capabilityProven=false`; `M1b` is not, and the bar is unchanged. |
> | 5 — dormant-egress residual observed | ✅ | ✅ | |
> | 6 — zero blocking findings + **recorded rollback rehearsal** | ✅ | ✅ | **D-9:** the rehearsal USES the `MIG-009` drain, so `E10-1-drain` must be wired — not a manual runbook. |
> | 7 — committed passing E5 audit **for that milestone's candidate** | ✅ **`a2`** | ✅ **`a3` or later** | ★★★ *Corrected twelfth round: both cells said `a2`. This table is the **executable allocation** of the nine criteria, so leaving it unchanged authorised an `M1b` handoff whose audit attests the older `M1a` revision — exactly what criterion 7 and the recovery procedure had already been corrected to forbid. `M1b` freezes a different candidate; an audit attests one exact revision, and a later attempt links by `Supersedes`.* |
> | 8 — `Result: pass` QA records for its named gates | ✅ *(`M1-D1-SPINE` + `M1a-D2-MECHANISM`)* | ✅ *(those two + `M1-D2-CODING`)* | criterion 8 is scoped by the **naming relation**, not a count — so `M1a` owes two records and `M1b` three, and adding a gate never silently exempts it |
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
| `MIG-009` | C → **B** | **D-9:** exit criterion 6's rollback rehearsal USES the drain. MIG-009 shipped it deliberately unwired (`E10-1-drain` dormant); wiring it gives criterion 6 a mechanism rather than a runbook. ★ **The apparent conflict with the register is resolved in D-9's favour — see below.** |
| `DEP-009` | D → **A** *(whole ticket)* | Its shipped admission half is load-bearing on journey item 1 — `admitAttemptCapacity` is composed on the live submit path (`server/src/services/job-submission.ts:34,131,136`). ★ **And its two-replica half shipped too** — `complete + CI-GREEN`, live boot and `e6f-11` 6/6 on `d1-merge-train`, `control-plane-b` in the D1 compose. An earlier revision of this row said "Two-replica HA stays D"; that was the third of three sites stating the superseded split, and is corrected here. The production-scale HA bar is **D5's**, not this ticket's. |
| `WRK-013` | A → **M** | `Status: scoping`, no result, `E4-F009` open. `StartupReconcilerDeps.leaseCandidates` still has no durable source. No claim exists, so there is no promise to correct. |
| `DAT-007` | A → **M** | Its own result header: `PARTIAL — the core remote-reach is BLOCKED`. Already honest; the residual is build work on the tools-in path. |
| `CLI-008` | A → **M** | No result doc; **ten** open findings name it as `ticket`. The largest unbuilt block in the original A. |
| `DEP-011` | A → **split A + M** | Inverted sign — an UNDER-claim. `E6-F003` (HIGH, open) still reads that the driver API "is unspecified" and the adapter-manager has "zero implementation", both false at HEAD (`packages/adapter-manager/src/`; daemon consumer `packages/worker-networked-host/src/bin/networked-host.ts:41`). Record half → A; Slice 5 go-live → M. |
| `FND-006`, `FND-007`, `FND-008` | A → **N** | Frozen reviewed ledgers, no clause, no finding, and live enforcement — `isCloudPluginExecutionBlocked` has 23 production call sites; FND-007's authority JSON is read by the always-on `policy` checker. |
| `WRK-009`, `CLI-007` | A → **N** | Narrow and complete. `CLI-007` already carries its own caveat ("unblocks but does not promote E7-1") and resolved `E7-F001`. |
| `MIG-001`, `MIG-004` | C / D → **X** | Zero files on disk, confirmed by `find`. |
| `DAT-006`, `DAT-010`, `DSK-003`, `DSK-004`, `SVC-008` | C → **C1** | All shipped. C's "deferral preserves their owners" misdescribes finished, production-wired work — `DAT-010` sits on the milestone's own artifact-commit path (`server/src/services/artifact-commit.ts:42,272`). |

| `MIG-006` | C1 → **split C1 + C2** | Its routing seam shipped and is production-wired, but the ticket **has no `-result.md`**, a distributed crew run is *“MECHANISM-ONLY”*, and its own design says it is ***“not an end-to-end crew cutover”*** with the rollout dial default-OFF for crew. C1 forbids re-opening acceptance while `M2` schedules the cutover as build — one row could not say both. Seam stays C1; the cutover is C2, deferred to M2. This is the **second** declared split. |

### Not moved, but recorded

- **`MIG-010` (B) had a structural deadlock.** It has no `-result.md` deliberately — adding one would retire it as `E7-F007`'s owner exactly when that finding needs one — while exit criterion 1 requires results for every REQUIRED ticket. **D-10: file a successor for `E7-F007`** so MIG-010 can land a result honestly. Until that successor exists, criterion 1 is unsatisfiable.
- ★★★ **`CLI-008` has the SAME structural deadlock as `MIG-010`, and D-10 did not cover it.**
  Measured 2026-09-20: **ten** open findings name `CLI-008` as their `ticket` — `E7-F003`, `F015`,
  `F016`, `F017`, `F023`, `F024`, `F026`, `F027`, `F032`, `F033` — and **none names a successor**.
  `check-finding-ownership.mjs` treats a ticket as complete once any `<ID>*-result.md` exists, and
  a shipped owner must name a real on-disk, non-self, unshipped successor or the guard reds
  (`successor_already_complete` / the E4-F013 chain). **So creating `tickets/CLI-008-result.md`
  would orphan ten findings in a single commit.**

  The remedy is the **link-scoped split** the E7 implementation plan now carries: file the Unit F
  link tickets as real successors, re-point the ten findings onto them, and ★ **create no parent** — ★★★ *corrected eleventh round: this remedy still said “never” after the restriction above was made conditional. The bar is “**while `CLI-008` still owns open findings**”, and none is required for M1; the E7 plan says a result becomes honest once the findings are re-pointed. An operative remedy that stays absolute silently overrides the corrected rule it implements.* Superseded wording: **never create a parent
  `CLI-008` result doc**. That is stronger than D-10's single-successor remedy because it also
  breaks the ticket into buildable units — but the constraint is the same, so record it the same
  way: `CLI-008` is a ticket that **cannot be marked complete as a unit**.
- **`DBR-001` (C2) design text is stale.** It says "**no `aoa db:restore` command exists**"; the command shipped in #484 (`cli/src/commands/db-restore.ts`). Its DR scope placement is still correct.
- **`MIG-005` / `MIG-007` are NOT M1 prerequisites.** The milestone journey is `task_run`-only. A sibling document bundled them with the parity bridges into one pre-M1 stage; that bundling is corrected in [`RECONCILIATION-2026-09-20.md`](RECONCILIATION-2026-09-20.md). The **bridges** are M1 work (disposition A, journey item 7); the **cutovers** are Retained.
- ★★★ **`E10-1-drain`: the register said REL-005 owns the trigger, and that premise is STALE.**
  Drafting the E10 plan surfaced what looked like a flat contradiction: **D-9** requires the drain
  wired for M1 exit criterion 6, while both `MIG-009-drain-result.md` and the `E10-1-drain` register
  reason say promoting it needs *"a real operator teardown / kill-switch write path — which is
  **REL-005** scope"*, and `REL-005` has **zero files** and sits at M5. Both cannot stand.

  Measured at HEAD, the conflict dissolves: **an operator kill-switch write path SHIPPED in REL-004
  Lane C** (PR #485) — `server/src/routes/instance-settings.ts` serves `kill_switches_set` /
  `kill_switches_cleared`, and `server/src/services/instance-settings.ts` writes the dedicated
  `kill_switches` column. The route's own comment already describes the semantics as a drain
  (*"refuses an unreadable document, which would drain every fleet"*). So the trigger the register
  was waiting on is **no longer REL-005's to deliver** — it exists.

  ★ **What genuinely remains is a GRAIN question, not a blocker.** Kill switches are *dimensioned*
  (`evaluateKillSwitches` matches exactly on provider or template and gates new placement at
  `job-leasing.ts:720`), whereas `drainAll` is fleet-wide. Connecting them naively would let killing
  one template drain another provider's in-flight work. Reconciling that grain is **MIG-009's design
  question**, and it is M1-sized.

  ★ This is the *"X is blocked — wrong six times out of six"* pattern from the operating rules,
  caught once more: the blocked-claim was inherited from a register reason rather than re-measured,
  and re-measuring it at HEAD falsified the premise. **`REL-005` is not a prerequisite of M1.**
- **Two gate clauses share the `E9-4` ordinal** — `E9-4-service-liveness-deadline` and
  `E9-4-service-create-and-desired-state`. The keys are unique so no guard breaks and nothing is
  mis-reported; the ordinal simply stopped being a sequence. Recorded, not renamed: renaming a
  clause key would rot every citation into it for a cosmetic gain.
- **A fifth parity bridge is live and tracked by nothing.** `jobAdmissionBridge` (JOB-010) HAS a production caller (`server/src/index.ts:1225` import, `:1250` construct) and **no gate clause names it**. `E3-F038` closed this census class, but its scope was the guard header's fourteen named symbols and this is not among them. The four genuinely callerless bridges are **JOB-011/012/013/014**, not JOB-010..014.

`REL-FOUNDATION-GATE` is deliberately outside this 50-ticket accounting: its current program-design entry says it is nonnumeric, inert, and retained for human traceability rather than ticket-graph coverage.
