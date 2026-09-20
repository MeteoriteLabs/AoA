# E11 — Hardening and Private-beta Release — Implementation Plan (SCOPED)

**Plan status:** `scoped` — this is deliberately **not** a full ticket-by-ticket implementation
plan, and it must not be read as one. E11's work sits at milestones **M4** (HA + disaster
recovery) and **M5** (private beta), which are four and five milestones downstream of HEAD. The
programme's own doctrine, `GO-BOOK.md:1906-1908`, is that later phases get scope and sequence
only:

> *"Sprints 6–9 have scope and sequence, not implementation plans. Deliberate: they depend on what
> dispatch looks like once live, and a plan written five sprints early goes stale — which is the
> exact failure this audit exists to fix."*

Restated for the milestone layer at `epic-regrooming/scope-triage.md:167-171`: *"Scope and gates
only — deliberately NOT implementation plans. … Each milestone's detailed plan is written
just-in-time, at its own Step 0, against HEAD."*

What this file therefore owns is the part that does **not** go stale: the stable contract — what is
already built and provable, what E11 consumes, what is measurably blocked, what the exit gate
actually says, what is out of scope, and what would reopen any of it. §8 names every E11 ticket id
with a disposition and defers the implementation tasks to each ticket's own Step 0.

**Scope of this file:** epic E11 (`REL-001`…`REL-005`) plus the three non-numeric units filed
against E11 on disk (`REL-FOUNDATION-GATE`, `GATE-clause-3-rollback`, `foundation-suite-unrun`) and
the `DBR-001` successor ticket.

---

## 1. Status and milestone position

| Item | Recorded value |
|---|---|
| Epic status | `backlog` (`README.md:3`). Only the Integration Gate Owner changes it, on a committed `pass` QA record **and** a committed `pass` completion handoff for one exact candidate (`artifact-policy.md`, "Status and evidence rules"). |
| Plan written at | `e710d8b54` on branch `claude/plan-spine-m1-split`. Every `file:line` below was read at this revision. |
| Milestone position | **M4 and M5.** `scope-triage.md:184-185`: M4 proves *"two replicas preserve correctness; a measured restore"* under full **D5**; M5 proves *"three external Organizations, all workloads, 14 days"* under full **D6 → E11 exit**. |
| Milestones between HEAD and E11 | M0 (record + lane health) → M1a (spine) → M1b (useful capability) → M2 (sink cutover) → M3 (workload breadth). E11 is blocked by all five in sequence (`scope-triage.md:177-185`). |
| E11 scope inside M4 | `REL-003`'s owed DR rehearsal with measured RPO/RTO, and `DBR-001` (`scope-triage.md:228-229`), alongside the non-E11 items `DEP-009`'s two-replica half and `WRK-016`. |
| E11 scope inside M5 | `REL-001`, `REL-002`, `REL-005` — *"none of which has a ticket file today"* — plus the D6 campaign itself (`scope-triage.md:235-236`). |
| Ticket files on disk | `REL-003` (design + result + runbook), `REL-004` (result + lanes C/D designs/results/terrain), `REL-FOUNDATION-GATE`, `GATE-clause-3-rollback`, `foundation-suite-unrun`, `DBR-001` (design only). **`REL-001`, `REL-002`, `REL-005`: zero files** — `find docs/replatform -iname "REL-001*" -o -iname "REL-002*" -o -iname "REL-005*"` returns nothing. |
| Open findings | Seven: `E11-F001` (LOW), `E11-F002` (MED), `E11-F004`…`F007` (**HIGH**), `E11-F008` (LOW). `E11-F003` is resolved and its ownership key correctly deleted. |
| Epic-local decisions | One: **`E11-D01`**, `decisions.md:16-18` — *"`proposed` — **NOT ADOPTED. This is a founder decision and it has not been made.**"* It is the only decision in the whole corpus that explicitly says it awaits the founder (`epic-regrooming/RECONCILIATION-2026-09-20.md:165-167`). |

---

## 2. What is already built — per ticket, from evidence

This is the most valuable section of a scoped plan: it is the part a later planner must not
re-derive, and the part a later reader must not over-read. Each row states what shipped **and** what
the shipped thing does not prove.

### `REL-004` — signed images, SBOM, vulnerability policy, provider kill switches — **all four lanes done**

`REL-004-result.md:6-13` records four lanes: A (release manifest + the gate that calls the three
verifiers, `60e658c07`, Done), B (vulnerability policy with expiring exceptions, `d90ffe68b`, Done),
C (provider + template kill switches, `451db1b11`, **WIRED** 2026-08-22), D (reconcile active
provider resources on kill, `573376d13`, **DONE**, closing inherited deferral #5). *"42 mutants
across the two landed lanes, 41 killed, 1 documented equivalent."*

Shipped, verified at HEAD:
- `server/src/services/execution-kill-switches.ts` — `evaluateKillSwitches` (`:230`),
  `KILL_SWITCH_DIMENSIONS` (`:41`), `killedProviders` (`:206`).
- `server/src/services/execution-kill-switch-policy.ts` — the fail-closed policy reader.
- The single production caller: `server/src/services/job-leasing.ts:49` (import), `:720` (call), on
  the real poll path. `node scripts/check-gate-clause-wiring.mjs --counts` measures it at **1**.
- Migrations `0260` (`instance_settings.kill_switches`) and `0261` (`aoa_app` SELECT grant).
- Lane D: `claimTerminalUncleaned`, the STRAND arm and the opt-in provider-scoped RECLAIM arm.
- `scripts/verify-image-admission.mjs`, giving callers to three previously callerless verifiers —
  `evaluateAdmission` (DEP-001), `evaluateInstallerAdmission` (DSK-003), `evaluateUpdateAdmission`
  (DSK-004).

**What it does not prove**, quoted from `REL-004-result.md:176-186`: *"Production signing roots.
Everything runs on a TEST root … Running an actual scanner. Lane B evaluates a normalized report …
**The gate is not yet on the publish path.** `docker.yml` is a plain build-and-push and a hard gate
there needs a release key."* Lane D adds five further limits (`REL-004-lane-D-result.md:165-185`),
of which the load-bearing one is `:176-177`: *"**No write path or UI for throwing a switch** — still
REL-001/005, unchanged from Lane C."*

### `REL-FOUNDATION-GATE` — the E0 release-test gate no longer accepts a bare string — **done**

`REL-FOUNDATION-GATE-result.md:12-20`: 24 of 30 Critical/High trust crossings named
`REL-001/002/003/005`, *"which have **never been written**"*, and E0 reported PASS over all 24. The
gate is now **trackable-strict**: a named REL ticket is admissible if its `<id>-design.md` exists on
disk **or** it is declared with a reason in `docs/architecture/distributed-execution-release-tests.json`.
It ships **0-error at rest** — 6 crossings admit on the written `REL-004`, 24 on manifest-deferral —
while making the unwritten release tests machine-tracked debt. Nine mutants, nine killed.

★ Its own headline is now partly stale: `REL-003`'s deferral was retired when REL-003 landed
(`REL-003-result.md:69-71` removes `deferred["REL-003"]` and the checker passes via
`written.has("REL-003")`), so the unwritten set is **REL-001/002/005**, three not four.

### `foundation-suite-unrun` — the foundation checker's own suite now runs in CI — **done**

`foundation-suite-unrun-result.md:1-12`: the checker's 182-test mutation suite
`scripts/check-distributed-execution-foundation.test.mjs` now runs in the CI `policy` job, so its
guards are enforced *"**against regression** (a running test), not merely **at rest** (the CLI)"*.
A scoped `.gitattributes` `eol=lf` pin fixed a CRLF-only 3-test failure (182 · 179 pass · 3 fail →
182 · 182 · 0). Census moved 49/4 → 50/3. No runtime code, no migration.

### `GATE-clause-3-rollback` — rollback liveness — **satisfied for one sink only**

`GATE-clause-3-rollback-result.md:8-9`: *"**Status: clause 3 SATISFIED for the org heartbeat, WITH
THE CORRECTIONS BELOW. Recorded as NOT ticked on triviality for the three shadow-only sinks, which
must re-satisfy it at activation.**"* Per-sink (`:114-124`): org heartbeat (`task_run`) satisfied;
`commander_turn`, `crew_run`, `one_shot` *"trivially satisfied; **RE-SATISFY at activation**"*.

Its own self-corrections are the load-bearing part, because they are the E11 write-path gap stated
in the plainest terms. `:17-19`: *"**C1 — "throw the REL-004 kill switch — immediate" hid that THERE
IS NO WRITE PATH.** `instance_settings.kill_switches` has **zero production writers** … "Immediate"
is true of the READ … but the operator ACTION is executing SQL against the production database by
hand."* `:28-30`: *"the kill switch has no Organization and no sink dimension. `KILL_SWITCH_DIMENSIONS`
is `["provider", "template"]` … Step 1 stops the named provider for the **whole instance**, not for
one tenant."*

★ **One clause of this result is stale at HEAD and must not be re-cited.** `:182-188` reads *"the
drain's `listActiveAttempts` has no SQL implementation at all"*. `MIG-009` shipped it —
`server/src/services/job-distributed-drain-store.ts` — and the drain's per-Company grain fix landed
with it. What survives from that paragraph is the zero-caller half: `createDistributedExecutionDrain`
and `drainAll` still have no production caller (measured at HEAD, §5).

### `REL-003` — DR + migration rehearsal — **verification core shipped, live rehearsal OWED**

`REL-003-result.md:1-8` is explicit about the split: the result covers *"the **session-buildable
verification core + the operator runbook**. The live staging rehearsal — the measured RPO/RTO, real
backup/restore, pre-0188→prior→candidate, live missing/corrupt injection, timed rollback — is the
**owed operator leg**; REL-003 promotes to done **only on a cited live-rehearsal run**, never on the
embedded-PG / fixture substrate below."*

Shipped: `server/src/services/disaster-recovery/manifest-reconciliation.ts`
(`evaluateRecoveredManifestReconciliation`, `runManifestReconciliation`),
`server/src/services/disaster-recovery/rollback-completeness.ts` (`evaluateRollbackCompleteness`),
four reuse lanes (stale-fence-after-restore, marker rollback over the real `revert0188`, staging
manifest invariants over the real `docker-compose.staging.yml`, re-enrol/revoke with a durable
`execution_target_revocations` cutoff row), and `REL-003-dr-rehearsal-runbook.md`. Totals
(`:63`): *"6 files, **31 tests green**"*; mutation (`:33-37`): *"A 7/7 killed · C 3/3 killed · 10/10
total · 0 survivors."*

Owed, verbatim (`:153-159`): *"**Verifiers + reuse lanes + operator runbook shipped and green; the
live staging rehearsal is OWED.** REL-003 does **not** promote to done here. … `E11-F002` stays
`open`, owned by REL-003, until a real restore entrypoint lands and the cited live rehearsal
exercises it."* The measurement contract is in the runbook, `:110-112`: *"**Measurement vs D5 (record
pass/fail):** DB RPO = `T_fault − newest recoverable DB commit` ≤15 min; DB full-service RTO =
`T_full_service − T_restore_start` ≤4 h (DR02). Object-store RPO ≤15 min; reconciliation RTO ≤4 h
(DR03)."*

### `DBR-001` — operator restore entrypoint + live rehearsal — **part 1 shipped; its design says otherwise**

`DBR-001-design.md:4` is `**Status:** scoping`; there is no result file. It names two deliverables
(`:29-37`): (1) a real operator restore entrypoint, (2) a live staging DR-restore rehearsal
recording measured RPO/RTO against D5.

★★★ **Deliverable 1 has already landed, and the design document still denies it.**
`DBR-001-design.md:14-15` asserts, present tense: *"`runDatabaseRestore` (`packages/db/src/backup-lib.ts`)
has **zero production/CLI callers**, is **not** barrel-exported from `@armyofagents/db`, and **no
`aoa db:restore` command exists** (only `aoa db:backup`)."* All three clauses are **false at HEAD**,
measured directly:

- `cli/src/commands/db-restore.ts` exists.
- `cli/src/index.ts:13` imports `dbRestoreCommand`; `:94` registers `.command("db:restore")`; `:100`
  calls `await dbRestoreCommand(opts)`.
- `packages/db/src/index.ts:39` barrel-exports `runDatabaseRestore`.

`scripts/finding-ownership.json:36` already carries the correction — *"UPDATED 2026-09-19 … DBR-001
has since LANDED `aoa db:restore` … commits `ec9d8b4b3`+`ca0f5c13d`"* — so two committed records of
the same fact disagree. This is the programme's dominant failure class (records disagreeing with
code), and fixing it is the one E11 item that is buildable today (§8, `T1`).

### `REL-001`, `REL-002`, `REL-005` — **nothing on disk**

No design, no result, no terrain, no owner. Confirmed by `find` at HEAD and corroborated three ways
in committed text (`REL-FOUNDATION-GATE-result.md:16-17`; `scripts/finding-ownership.json:255`).
They are M5 scope (`scope-triage.md:235-236`). Because they are unwritten, every fact any document
asserts about their content is a plan statement, not evidence.

---

## 3. Consumed as-built interfaces

E11 builds almost no new mechanism. It **consumes** what E0–E10 shipped and proves it on one exact
candidate. The interfaces it consumes, and the rule for each:

| Interface | Where | E11's use and the rule |
|---|---|---|
| `evaluateKillSwitches` | `server/src/services/execution-kill-switches.ts:230`, called at `job-leasing.ts:720` | D6-09's kill rehearsal and D6-10's disable timing read this verdict. It is **instance-wide per provider/template** — no Organization and no sink dimension (`KILL_SWITCH_DIMENSIONS` at `:41`). Do not plan a per-tenant kill on it. |
| `killedProviders` | same module, `:206` | Deliberately the **inverse polarity** — fail-OPEN on an absent/malformed/unreadable document, and it acts only on entries carrying `reclaim: true`. It is **not** a consumer of the kill verdict. `E11-F003` was filed because a register sentence implied otherwise; do not re-introduce that reading. |
| `runDatabaseRestore` | `packages/db/src/backup-lib.ts`, barrel-exported at `packages/db/src/index.ts:39`, driven by `cli/src/commands/db-restore.ts` via `cli/src/index.ts:94-100` | The restore leg of D5-DR01/DR02. Consume the CLI, not the library function — the whole point of `E11-F002` is that a clause satisfied by a function nothing calls is not satisfied. |
| `runDatabaseBackup` | `packages/db/src/index.ts:38`, `aoa db:backup` | The backup half of D5-DR01. |
| `evaluateRecoveredManifestReconciliation` / `runManifestReconciliation` | `server/src/services/disaster-recovery/manifest-reconciliation.ts` | D5-DR03/DR04/DR05 object-integrity and quarantine verdicts. Shipped and mutation-proven; the live campaign supplies the inputs, not the logic. |
| `evaluateRollbackCompleteness` | `server/src/services/disaster-recovery/rollback-completeness.ts` | D6-11's cutover-rollback verdict. |
| `evaluateAdmission` / `evaluateInstallerAdmission` / `evaluateUpdateAdmission` | driven by `scripts/verify-image-admission.mjs` | D6 signed-artifact evidence. Runs on every PR; **not** on the publish path (`REL-004-result.md:184-186`). |
| `scripts/check-desktop-surface-disabled.mjs` | `REQUIRED_DOC_PHRASES` at `:41` = `[/no desktop installer/i, /docker \+ npm only/i]`; route sweep at `:54-59` | The standing **negative** evidence for DSK-00's desktop-disabled posture. A cloud-only beta consumes this guard as its proof, and enabling desktop reverses it. |
| `docs/architecture/distributed-execution-release-tests.json` | the deferral manifest | Every unwritten REL ticket is declared here with a reason. Writing `REL-001/002/005` means removing their deferral rows in the same commit that adds their design files. |
| `scripts/check-distributed-execution-foundation.mjs` + its 182-test suite in CI `policy` | | The always-on enforcement of the above. A hard-strict flip would red a required check on every PR; `E11-F001` records why that was rejected. |

---

## 4. Shared decisions and locked contracts

- **E11-D01 is the only founder-blocked decision in the corpus, and it is E11's.**
  `decisions.md:16-18`: `proposed` — *"**NOT ADOPTED. This is a founder decision and it has not been
  made.** Adopting a new release gate, or changing any gate's pass/fail semantics, criteria or
  optionality, is outside any agent's scope."* Three options are on the record (`decisions.md`, §7):
  leave the gates as they are; adopt the §4 narrowed substitute; adopt the review's clause as
  written with the §6 costs in full. **No E11 ticket may be planned as though any of the three has
  been chosen.**
- **Gate text is not editable by this plan.** `artifact-policy.md:71`: *"Autonomous agents may
  propose decisions in epic-local `decisions.md`; only the designated custodian or gate owner may
  lock them."* `test-gates.md` is the normative criteria document; nothing here amends it, and every
  D5/D6 figure below is quoted rather than paraphrased.
- **A cloud-only, desktop-disabled, mobility-disabled private beta is already permitted**, in three
  places quoted verbatim in `decisions.md:32-38`: `test-gates.md` DSK-00 *"Desktop remains
  optional."*; D6-03 *"Desktop and cross-target mobility remain optional under their separate
  closure rules."*; `README.md` *"Thus neither desktop packaging nor mobility blocks a cloud-only
  non-mobile private beta."* That is the standing position and E11-D01 does not disturb it.
- **Coding, browser and service are all mandatory and conjunctive.** `README.md` and D6-03. A
  disabled workload flag *"blocks or resets the campaign rather than waiving that workload's floor"*.
  There is no coding-only beta.
- **HIGH findings may never be `accepted`.** Under `scripts/lib/finding-ownership.mjs`, CRITICAL and
  HIGH are identically blocking; both derive into `NOT_ACCEPTABLE`. The four open HIGHs are
  therefore hard blockers on D6-02's *"zero open Critical/High security findings"* clause, and none
  is closable by writing code (§5).
- **`unowned` with a reason is legitimate.** `findings.md:3-6`. Six of E11's seven open findings are
  `unowned` by design; that makes them visible, not orphaned. Do not force-fit an owner.
- **Records are immutable; corrections are new attempts.** `artifact-policy.md`, "Status and
  evidence rules". The stale `DBR-001-design.md` claim (§2) is a **design** document, not a frozen
  result, so it is amendable in place with a dated banner; a frozen `-result.md` never is.

---

## 5. Known blockers, measured

Ordered by how hard they are to remove. Every entry carries a citation; where the blocker is a
decision rather than an engineering gap, it says so.

### B1 — Four open HIGH findings, none owned, none closable by code (the largest E11 risk)

D6-02 requires *"zero open Critical/High security findings"* (`test-gates.md:183`). Four HIGHs are
open, all `unowned`, and each turns on a founder or protocol decision:

| Finding | Measured fact | What would actually close it |
|---|---|---|
| `E11-F004` (HIGH) | A `kind = "e2b"` execution target is structurally inexpressible for an organization and uncreatable at platform scope — seven measured refusals, links 1–7 in `findings.md:174-209`, including `execution-target-resolver.ts:52-56`, `worker-protocol/src/job.ts:88-94`, `capabilities.ts:300-303`, `routes/execution-targets.ts:174,176-186`, `services/execution-targets.ts:124,433`. | Either the clause is withdrawn/rewritten against a mechanism that exists, **or** a production creator ships *and* a successor decision resolves the `PLACEMENT_MATRIX` org-binding contradiction. Neither is owned. |
| `E11-F005` (HIGH) | Nothing in the enrolment protocol identifies a **machine**. `workerHelloV1Schema` (`capabilities.ts:366-379`) is `.strict()` with ten fields whose only platform facts are `{os, arch, runtime}`; `deviceThumbprint` is `sha256(SPKI DER)` per **keystore** (`worker-daemon/src/enrollment/enroll.ts:131-137`), so two thumbprints prove two enrolments, never two machines. | A gate-criteria change, or a machine-binding attestation field on a **FROZEN v1** schema — a protocol decision under D5-HA03, not a ticket line. |
| `E11-F006` (HIGH) | D6-04's row contract names **nine** dimensions and no device (`test-gates.md:187`), so two owner-desktop devices collapse into one row while every per-row floor (≥200 probes, ≥99.5%, ≥3 fail-closed samples) is computed over that single row. | A founder decision either adding a device/enrolment dimension with its own floors, or recording that per-device coverage is deliberately out of the matrix's scope. |
| `E11-F007` (HIGH) | Cross-target handoff has **no mechanism in either direction**. `grep -rni "fenced_restart\|mobility"` over `server/ packages/ ui/` returns zero hits; `packages/db/src/repositories/tenant/job-control.ts:1375-1376` copies the placement snapshot verbatim with the comment *"re-placement is JOB-009, out of scope"*, pinning attempt N+1 to the same target by construction. | `MIG-004` shipping a real directed handoff. **`MIG-004` has zero files on disk**, so it cannot even be declared as owner without redding `owner_ticket_missing`. |

★ The honest reading: **E11's headline blocker is a decision backlog, not an engineering backlog.**
Three of the four are relieved, not by code, but by a founder choosing among the options already
recorded in `E11-D01`. `E11-F007` additionally needs `MIG-004` to be filed at all — and D6-05 already
permits `disabled` with negative evidence, which is the only honest posture today.

### B2 — The live DR rehearsal is owed and needs staging infrastructure

`E11-F002` is `owned` by `REL-003` with `successor: DBR-001`, and
`scripts/finding-ownership.json:35` narrows it precisely: *"The `aoa db:restore` operator entrypoint
has now LANDED (DBR-001), so this stays OPEN **only on the LIVE staging rehearsal leg** (DBR-001 has
design.md, no result.md; no rehearsal evidence)."* The rehearsal must measure against
`test-gates.md:172` (**D5-DR02**: *"RPO ≤15 minutes and full-service RTO ≤4 hours"*) and `:173`
(**D5-DR03**: *"RPO ≤15 minutes … Object-store reconciliation RTO is ≤4 hours from restore start"*).

`DBR-001-design.md:39-43` names the precondition: *"When a staging fleet with a database +
object-store backup path is deployed (the same live-infra dependency the E7-1 canary campaign and
the REL-003 rehearsal share)."* This is infrastructure-blocked, not design-blocked.

### B3 — The kill switch has no write path, and its owner does not exist

Four independent committed records name the same gap: `GATE-clause-3-rollback-result.md:17-19`
(zero production writers to `instance_settings.kill_switches`; the operator action is hand-executed
SQL), `REL-004-lane-D-result.md:176-177` (*"No write path or UI for throwing a switch — still
REL-001/005"*), the `E11-5-provider-kill-switch` register reason
(`scripts/gate-clause-wiring.json`, closing residual), and Lane C's own runbook SQL. All four point
at **REL-001/REL-005, which have zero files on disk.** D6-09 requires a kill rehearsal and D6-10
requires new scheduling to stop within 60 seconds; both are satisfiable today only by an operator
with a `psql` prompt.

### B4 — D6 is calendar-bound and cannot be compressed by engineering

Quoted rather than paraphrased, because the figures are conjunctive and easy to soften by accident.

`test-gates.md:183` — **D6-02**:
> *"at least three external beta Organizations each participate throughout the same 14 consecutive
> calendar days; at least 1,000 attempts complete; end-to-end availability is ≥99.5% under the
> availability SLI contract above; zero Severity 0/1 incidents and zero open Critical/High security
> findings occur; every Medium finding has an owner, mitigation, and due date."*

`test-gates.md:185` — **D6-03**:
> *"at least 100 completed coding jobs, at least 50 completed browser journeys, and at least 72
> accumulated healthy service-hours, conjunctively rather than interchangeably. Every participating
> beta Organization advertises and exercises at least one coding, one browser, and one service row.
> Separate workload flags are per-Organization exposure, incident-disable, and rollback controls
> only; a disabled coding, browser, or service flag blocks or resets the campaign rather than
> waiving that workload's floor. Desktop and cross-target mobility remain optional under their
> separate closure rules."*

`test-gates.md:181` — **D6-01**: *"All D0–D5 records, including D2 coding, D3 browser, and D4
service, must be current for the same release candidate. A coding-only candidate cannot enter or
pass D6."* And `:211` — **D6-14**: *"A canary resets after any hard-invariant failure, Severity 0/1
incident, incompatible schema/protocol change, or release-candidate image change."*

The 14 days are a floor on wall-clock time, the three Organizations are external parties with
executed terms (D6-06A/B), and any image change resets the clock. Fourteen days is the **minimum**
elapsed time from a clean start, assuming nothing resets it.

### B5 — E11's own upstream is five milestones of unbuilt work

`README.md:4` states the dependency set: *"E8, E9, DEP-009, MIG-001 through MIG-003, and MIG-005
through MIG-008"*. Of those, `MIG-001` has **zero files on disk** (disposition **X**,
`scope-triage.md:61-65`), `MIG-005`/`MIG-007` are unbuilt (**C2**, `:41`), and E8's browser lane
carries the blocker `scope-triage.md:219-222` states up front: `packages/browser-runtime` has *"zero
importers anywhere in the tree"*, declares `playwright` as a devDependency *"so it is unshippable as
written"*, and `workload.browser_session` is filtered out of the worker hello, so *"a browser job can
be submitted and placed-for but never leased."* D6-03's ≥50 browser journeys sit behind that.

### B6 — Accepted residuals that E11 must record but cannot claim

`scope-triage.md:296`: the accepted managed-shared **DE-08** residual *"conflicts with the
still-normative H-06/D2 network boundary"*, and the scope decision *"did not amend that gate."*
Neither M1 partial gate *"may mark H-06 passed"*, and *"Any full D1/D2, E6, or E7 completion
requires live evidence satisfying the current requirement or a separately approved normative
amendment."* E11's exit consumes D2 (via D6-01), so this residual propagates all the way to the
E11 exit gate and must be recorded, unclaimed, in every E11 candidate record.

### Not a blocker, but a record defect to fix first

`DBR-001-design.md:14-15` is false at HEAD (§2). `GATE-clause-3-rollback-result.md:182-188`'s
*"`listActiveAttempts` has no SQL implementation at all"* is false at HEAD (MIG-009 shipped
`server/src/services/job-distributed-drain-store.ts`); that file is a frozen result, so the
correction belongs in a finding or a successor record, never in an edit.

---

## 6. Exit gate, and which partial gates may support it without completing it

**The E11 exit gate**, `README.md:5`: *"tenant/secret adversarial, load/fairness, disaster recovery,
signed-image, provider-kill, and mandatory coding/browser/service private-beta evidence gates pass
on one release candidate."*

Structurally, from `scope-triage.md:185`: full **D6 → E11 exit**, and D6-01 requires all of D0–D5
current on the same candidate. So the E11 exit gate consumes, on one exact revision: D0, D1, D2
(coding), D3 (browser), D4 (service), D5 (HA + load + DR), then D6 itself, then a committed `pass`
E11 QA record and a committed `pass` completion handoff (`artifact-policy.md`).

**What may support it without completing it.** Each of these is a real, citable record that a
reviewer may consume — and each is explicitly non-promoting:

| Partial record | What it supports | What it explicitly does **not** do |
|---|---|---|
| `M1-D1-SPINE` | one-CP/one-worker lifecycle evidence | *"not D1 … does not satisfy D1-00's at-least-two-worker topology, does not certify every full-D1 fault volume or HARD invariant, cannot complete E6"* (`scope-triage.md:144`) |
| `M1-D2-CODING` | real-E2B coding mechanism and, separately, capability | *"not D2. It cannot complete E7, satisfy D2's full run counts/schedule, or substitute for full D2 in a later D5/D6 or release decision"* (`:155`) |
| `E10-REALTIME-FOUNDATION` | reconnect-safe claims in CLI-006/BRW-006/SVC-007 | RTF-00, `test-gates.md:100`: *"It does not pass E10, D3, D4, **D5**, D6, desktop, cutover, or mobility."* |
| `REL-003`'s verification core | D5-DR03/DR04/DR05 **verifier** correctness | proves the verifiers, not a restore. `REL-003-result.md:153-155`: *"a green buildable core is not a live rehearsal, and this result does not claim one."* |
| `REL-004` lanes A–D | signed-artifact and kill-switch mechanism | test signing root only; the gate is not on the publish path; no write path for the switch |
| `scripts/check-desktop-surface-disabled.mjs` | DSK-00's desktop-**disabled** negative evidence | it proves absence, which is the only thing a cloud-only beta needs from it |
| A milestone handoff under `docs/replatform/milestones/<M>/handoffs/` | a milestone decision | *"A milestone handoff is **non-promoting**: it changes no epic status and must not use `epic-completion` in its name"* (`artifact-policy.md`) |

★ The rule that binds all of them: **`scope-triage.md:159`** — *"Both partial gates are
non-promoting. They may support a separately named milestone decision, but not an epic-completion
handoff for E3–E7."* The same logic applies to E11: no accumulation of partial records substitutes
for a fresh full-D6 campaign on one candidate.

---

## 7. NOT in scope

- **No gate-text edits.** No D5, D6, DSK-00 or REL-005 criterion, and no optionality, floor or pass
  condition, is changed by this plan or by any ticket it names. `E11-D01` is the standing record of
  what that would require.
- **No adoption of `E11-D01`.** Not the review's clause, not the narrowed substitute, not a
  rejection. All three are the gate owner's.
- **No desktop enablement.** Desktop stays optional and disabled, with `check-desktop-surface-disabled.mjs`
  as the standing negative evidence. Enabling it pulls in DSK-01…DSK-10, `DSK-003`/`DSK-004`,
  `MIG-001` (zero files), `DAT-006`, and desktop-covered `REL-001/003/004` evidence — the full §6
  cost table in `decisions.md`.
- **No mobility enablement.** D6-05 `disabled` with negative evidence is the only posture the
  mechanism supports (`E11-F007`).
- **No machine-binding attestation.** That is a change to a FROZEN v1 `WorkerHelloV1` and an N/N-1
  compatibility event under D5-HA03 — a protocol decision, not E11 work.
- **No new `kind = "e2b"` execution-target creator.** `E11-F004`'s option (ii) is a successor
  decision to `PLACEMENT_MATRIX`, not a ticket line.
- **No commercial scope.** D6-07, `test-gates.md:200`: *"Billing, pricing, invoicing, payment
  collection, and commercial metering are explicitly outside this gate."*
- **No production signing roots, no real scanner, no publish-path gate flip.** All three are
  operator/infra steps recorded as deliberate residuals in `REL-004-result.md:176-186`; they change
  no logic in this epic.
- **No re-litigation of `REL-004`, `REL-FOUNDATION-GATE` or `foundation-suite-unrun` acceptance.**
  They are done, mutation-proven, and independently reviewed. Their limits are recorded; their
  verdicts are not reopened.
- **No implementation plans for M4/M5 tickets.** By doctrine — see the plan status header.

---

## 8. Ticket implementation tasks — WRITTEN AT STEP 0

**This section deliberately contains no implementation tasks.** The doctrine is
`GO-BOOK.md:1906-1908` and `GO-BOOK.md:3344-3346`: later phases have *"scope and sequence but no
implementation plan, deliberately: a plan written five sprints early goes stale, which is the
failure this whole audit exists to fix. **Step 1 of each is to write the plan.**"* E11's tickets are
four and five milestones out; a task list written now would be re-derived from a different HEAD
before anyone executed it.

What is fixed here is the ticket set and each ticket's disposition. Each ticket's own Step 0 writes
its plan to the Sprint 1–3 standard — verified state at tip, every cited line opened and recorded,
fail-first steps, a mutation table, and an acceptance mapping in which no clause is satisfiable by a
function nothing calls.

| Ticket | On disk | Milestone | Disposition |
|---|---|---|---|
| `REL-001` — tenant/secret adversarial + load/fairness release tests | **zero files** | M5 | **Write at Step 0 of M5.** Its deferral row in `docs/architecture/distributed-execution-release-tests.json` is removed in the same commit that adds `REL-001-design.md`. Also the natural home for the kill-switch **write path** (B3) unless a founder assigns it elsewhere. |
| `REL-002` — release hardening remainder | **zero files** | M5 | **Write at Step 0 of M5.** Same manifest rule. Its content is genuinely unspecified today; do not infer it from the README's prose. |
| `REL-003` — DR + migration rehearsal | design + result + runbook | **M4** | **Partially shipped; promotion owed.** Verification core and runbook green (§2). Promotes *"only on a cited live run with measured RPO/RTO vs D5-DR02/DR03"* (`REL-003-result.md:93`). No new design needed — the runbook is the plan. |
| `REL-004` — signed images, SBOM, vulnerability, kill switches | result + lanes C/D | shipped | **Done, with recorded residuals.** Do not reopen acceptance. Its five Lane-D limits and three deferrals are inputs to M4/M5 planning, not defects. |
| `REL-005` — selected-Organization private beta | **zero files** | M5 | **Write at Step 0 of M5**, after the D6-04 frozen matrix is committed. Carries the `E10-1-drain` `drainAll` trigger and the kill-switch operator surface unless reassigned. Cannot start before D6-01 closure. |
| `DBR-001` — operator restore entrypoint + live rehearsal | design only, `Status: scoping` | **M4** | **Amend now, execute at M4.** Part 1 shipped (`aoa db:restore`); part 2 is the live rehearsal. See `T1`. |
| `REL-FOUNDATION-GATE` | design + result | shipped | **Done.** Graph-inert and non-numeric by design; outside the 50-ticket accounting (`scope-triage.md:380`). |
| `GATE-clause-3-rollback` | design + result + terrain | shipped, **one sink** | **Re-satisfy at activation** for `commander_turn`, `crew_run`, `one_shot` — which is M2 work, not E11's. One stale clause to correct (§5). |
| `foundation-suite-unrun` | design + result | shipped | **Done.** Closed `REL-FOUNDATION-GATE` §0h. |

**The one task that is buildable today**, stated because it is a record-integrity defect and those
do not age out:

- **`T1` — correct `DBR-001-design.md`.** Its `:14-15` claim (zero callers / not barrel-exported /
  *"no `aoa db:restore` command exists"*) is false at HEAD and contradicts
  `scripts/finding-ownership.json:36`. Add a dated amendment banner recording that deliverable 1
  landed in `ec9d8b4b3`+`ca0f5c13d`, narrow the ticket's remaining scope to the live rehearsal, and
  flip `**Status:** scoping` to whatever the owner rules. Verify by re-reading
  `cli/src/index.ts:94-100` and `packages/db/src/index.ts:39`. This is a design document, not a
  frozen result, so it is amendable in place.

---

## 9. Reopen triggers

Reopen this plan — not merely amend a ticket — when any of the following becomes true:

1. **`E11-D01` is ruled.** Any of the three options changes what E11's acceptance asserts, and two
   of them change which findings can close. This is the single largest reopen trigger.
2. **Any of `E11-F004`…`F007` closes or changes severity.** D6-02's "zero open Critical/High"
   clause is a conjunct of the exit gate; the open set is load-bearing on whether a campaign may
   start at all.
3. **`MIG-004` or `MIG-001` is filed.** Both are zero-files today, and both are named by the E11
   README as conditional preconditions. Filing either makes an `unowned` HIGH ownable.
4. **Desktop or mobility is advertised.** Either flips `check-desktop-surface-disabled.mjs` from
   standing evidence to a blocker, and pulls DSK-01…DSK-10 / D6-05's ≥10-handoffs-per-direction
   requirement into scope.
5. **The advertised target/provider/OS/credential/locality/fallback/mobility matrix changes**, or
   D6-04 gains a dimension. Row counts and per-row floors are recomputed for every partner.
6. **A release-candidate image change, a hard-invariant failure, a Severity 0/1 incident, or an
   incompatible schema/protocol change during a canary** — D6-14 resets the campaign, and the
   14-day clock restarts from zero.
7. **The staging fleet with a database + object-store backup path is deployed.** That unblocks B2
   and makes `REL-003`/`DBR-001` immediately executable.
8. **A kill-switch write path ships**, or `KILL_SWITCH_DIMENSIONS` gains an Organization or sink
   axis. B3 and the D6-09/D6-10 evidence shape both change.
9. **The DE-08 residual is amended, or H-06 gets a successor decision.** B6 propagates from D2 to
   the E11 exit; a change there changes what an E11 candidate may claim.
10. **A milestone before M4 slips its scope** — in particular if M3's browser lane
    (`packages/browser-runtime`, zero importers, `playwright` as a devDependency) does not ship,
    D6-03's ≥50 browser journeys are unreachable and E11 cannot enter D6 at all.
