# DECISION REQUEST — the six clause-halves E0-F013 says cannot be delivered as written

**Date:** 2026-09-10
**Decision:** `E0-F013` **Decision 1** — *"What happens to the clause-halves that cannot be
delivered as written."*
**Register under discussion:** `docs/architecture/distributed-execution-threat-controls.json`
**Status changes made by this document:** **NONE.** No finding is closed, struck, re-dispositioned
or re-owned; no `deliveryStatus` is moved; no clause text in the register is edited; no
`scripts/gate-clause-wiring.json` enrolment is added or changed. **Amending the register IS the
decision being requested**, so this paper does not pre-empt it by making the amendment.
**Production code written:** none.

---

## 0. The headline, stated so it cannot outrun its own measurement

Six clause-halves were queued here. **Measured at source, they are not one shape and not one
verdict — and three of the six are not blocked in the way the finding says they are.**

| # | Clause-half | E0-F013's stated blocker | Measured verdict |
|---|---|---|---|
| 1 | **DE-01** `audit`, read-denial conjunct | "needs a `BYPASSRLS` comparator, the privilege `client.ts:325` forbids" | ★ **THE BLOCKER IS FALSE** — already refuted in-tree and in CI. Deliverable. The residual objection is a **design** cost, not an impossibility. |
| 2 | **DE-27** `audit`, cross-replica + partition conjuncts | "the system has no replica identity; the clause is unsatisfiable" | **SPLIT.** The *partition* conjunct is genuinely vacuous. The *cross-replica admission* conjunct is **ambiguous, not unsatisfiable** — under the weaker of its two readings it is ordinary Group B/C work. |
| 3 | **DE-12** `audit`, generation-change conjunct | "`services.generation` has no writer" | **CONFIRMED undeliverable — and WORSE than filed.** The clause has **three** conjuncts and **all three** are vacuous, not one. |
| 4 | **DE-20** `audit`, rollback conjunct | "`createDistributedExecutionDrain` has zero production callers" | **CONFIRMED undeliverable** for the rollback conjunct. ★ But the *other* conjunct (legacy selection) is **closable today** and does not belong in this decision at all. |
| 5 | **DE-11** `audit` (whole clause) | "the controls themselves are absent; nothing decides, so there is nothing to record" | ★★ **THE PREMISE IS STALE.** Something *does* decide, at a named line, with a tenant and a live DB handle already in scope. **Deliverable, cheaply.** |
| 6 | **DE-17** `audit` (whole clause) | "needs a wire hop, and `worker-protocol` is v1-FROZEN" | ★ **THE FREEZE IS NOT THE BLOCKER.** The frozen envelope ships a bounded extension container *for exactly this*, already carried on the worker-event schema. What is missing is a catch point and a drain — code, not a freeze ruling. |

**So: of the six, TWO are hard (DE-12, DE-20's rollback conjunct), ONE is half-hard (DE-27), and
THREE were mis-blocked (DE-01, DE-11, DE-17).** Per §1 of the brief's own standing rule —
*exoneration needs strictly more evidence than conviction* — each of those three is evidenced at a
file:line below, and none of them is claimed **delivered**; they are claimed **not blocked for the
stated reason**.

**And the arithmetic in the finding is off by one, in the direction that flatters it.** §7 shows the
working: under `E0-F013`'s *own* groupings the number is **ELEVEN**, not twelve.

---

## 1. Method, and what this paper refuses to inherit

Every clause below is quoted **verbatim** from
`docs/architecture/distributed-execution-threat-controls.json` at branch point `743c30f08`, then
decomposed into **conjuncts** and judged one conjunct at a time.

**★ THE UNIT OF ANALYSIS IS THE CONJUNCT, NOT THE ROW, AND NOT THE "HALF".** This programme has
twice recorded a whole clause for a half (`DE-06`'s retraction, 2026-09-09) and once corrected it in
the same document that committed it (`E7-F011`). It has also recorded a *half* for a *third*: `DE-12`'s
audit clause is a **three**-way conjunction and `E0-F013` queues only one of the three here. That is
the same error at a smaller scale, and §4 fixes it.

Nothing below is inherited from `E0-F013`'s Group D, from the register's `deliveryEvidence`, or from
the Decision 2 paper. Each is re-run at tip.

---

## 2. DE-01 (Critical) — the read-denial conjunct

### 2.1 The clause, verbatim

> `"audit": "query and policy-denial events recorded in the control-plane audit log"`

### 2.2 Conjuncts

| # | Conjunct | Verdict | Why |
|---|---|---|---|
| 1a | **"query … events recorded"** | **ABSENT — and never blocked by anything.** | The tenant GUC has exactly two writers, both in `server/src/db/with-tenant-tx.ts` (`withTenantTx` `:36`, `withReadOnlyTenantTx` `:75`), and a whole-tree sweep for `set_config('aoa.organization_id'` outside tests returns those two lines and nothing else. Recording who queried what under which organization needs **no database privilege at all**. ★ **This conjunct is not in Decision 1's queue and never was** — it is unblocked instrumentation nobody has written. |
| 1b | **"policy-denial events recorded" — WRITE side** | **ABSENT, closable.** | An RLS `WITH CHECK` violation raises catchable SQLSTATE `42501`; `with-tenant-tx.ts` is the single interception point. `E0-F013` already classes this "genuinely closable". |
| 1c | **"policy-denial events recorded" — READ side** | ★ **ABSENT, and NOT BLOCKED FOR THE STATED REASON.** | See below. |

### 2.3 The measured refutation of 1c's stated blocker

`E0-F013` Group D and `E0-F010` both say the read half needs "a `BYPASSRLS`/owner connection,
exactly the privilege `packages/db/src/client.ts:325` throws at boot to forbid."

**That is measured FALSE**, in-tree, against real PostgreSQL, and in CI —
`docs/replatform/MEASUREMENT-de-01-read-half-does-not-need-bypassrls.md` with harness
`server/src/__tests__/de01-read-half-alternatives.integration.test.ts` (10 arms, green on the
`verify (1)` shard of PR #400's run `34381776576`). Two shipped shapes deliver a cross-tenant read
with the serving pool at `rolbypassrls=false` and `client.ts:325` still passing:

- **ALT-B** — a role-targeted `CREATE POLICY … TO "aoa_operator"` on a FORCE-RLS table. **No
  precondition, no privileged role anywhere.** Already in production on
  `distributed_cutover_markers` (`0233_distributed_cutover_marker_rls.sql:49-51`) and thirteen
  sibling `aoa_operator` policies.
- **ALT-A** — an owner-owned `SECURITY DEFINER` function on the `0268` model. **Carries a
  precondition** (the function's owner must itself be `SUPERUSER`/`BYPASSRLS`; `ALT-A(iii)` is the
  control that shows the identical function returning **zero rows** without it, *silently*).

The finding's own text already carries this correction inline, so **`E0-F013` has caught up on the
page — but its Group D verdict and its arithmetic have not.** That is the drift this paper closes.

**What the correction does NOT do.** It does not make the clause advisable. The clause asks for
**service-path** recording — denial events as they happen on the live tenant query path — and the
only mechanism that produces a read-denial *event* is re-running each query without the policy and
diffing. That is a comparator on **the hot path of every tenant read across 24+ relations, holding
authority the serving pool deliberately does not have.** The measurement doc declines to promote it
and this paper agrees: **possible is not advisable.**

### 2.4 Options

**(a) AMEND.** Exact replacement text (the original words are kept; the amendment is appended, in
the house style of `DE-15.audit` and `DE-20.revocation`):

> `"audit": "query and policy-denial events recorded in the control-plane audit log. ★ AMENDED <date> by founder ruling (E0-F013 Decision 1). The clause is SPLIT along its own conjunction and one conjunct is NARROWED. (1) 'query events': unchanged and unblocked -- the tenant GUC has exactly two writers (server/src/db/with-tenant-tx.ts:36 and :75) and recording them needs no database privilege. (2) 'policy-denial events', WRITE side: unchanged -- an RLS WITH CHECK violation raises catchable SQLSTATE 42501 at the same chokepoint. (3) 'policy-denial events', READ side: NARROWED to 'no read-denial event is recorded, because PostgreSQL emits none'. An RLS USING clause filters rows inside a query that SUCCEEDS; zero rows is a legal, indistinguishable result. ★ THIS IS A DELIBERATE DECLINE, NOT A LIMIT: docs/replatform/MEASUREMENT-de-01-read-half-does-not-need-bypassrls.md measured that a cross-tenant comparator needs NO BYPASSRLS and that packages/db/src/client.ts:325 is not the obstacle (ALT-B, a role-targeted policy, needs no privileged role at all). The programme declines the mechanism because it is a comparator on the hot path of every tenant read holding authority the serving pool is built not to have -- a materially worse control surface than what it would detect. WHAT IS LOST: a successful cross-tenant READ that RLS silently filtered leaves no trace, so probing for another tenant's rows is invisible to the audit log; only writes and the query itself are visible. WHAT COMPENSATES: RLS still DENIES the read (the confidentiality clause is separately measured holding), and the two boot certificates at server/src/db/distributed-execution-databases.ts:1754-1770 pin the serving role's authority and the exact SECURITY DEFINER function set, so a privilege that WOULD enable such a read cannot be added without failing startup."`

- **What is lost, and who is harmed.** An operator investigating a suspected cross-tenant probe
  cannot tell a *filtered* read from a legitimately empty one. The party harmed is **a tenant whose
  rows were probed for and not returned**: the probe leaves no evidence in anyone's log, so it
  cannot be counted, rate-limited on evidence, or produced in an incident review. This is a
  **detection** loss, not a containment loss — the read is still refused.
- **How a reader knows the scope changed.** The original clause text is retained verbatim ahead of
  the amendment, exactly as `DE-15.audit` and `DE-20.revocation` do today; the amendment names the
  ruling and the measurement that says the decline is a choice.

**(b) CHARTER.** A serving-path read comparator. Tickets: none exist; it would need a new `TEN-*`
ticket plus an ALT-B migration (C14 class (b), Decision #122, delta-free `--custom`) and a
certificate update at `assertExactCatalogCertificate`. Depends on nothing — it could start today.
**Does the programme intend to build it? No**, and it should say so rather than leave it implied:
the mechanism is a per-read cross-tenant query on every serving path, which is a larger attack
surface than the thing it detects.

**(c) THIRD PATH — split the conjunct and charter only the offline half.** Amend conjunct 3 as in
(a), and separately charter a **narrow offline verifier** — one org-bound, column-projected `0268`-
shape function answering a specific invariant on a schedule, not on the serving path. That is what
`0268` already is; it is within the measured alternatives; and it recovers *some* detection without
the hot-path surface.

### 2.5 ★ RECOMMENDATION — **(c)**

Amend conjunct 3 to the decline, and charter the offline verifier as a separate, later ticket that
does **not** gate this class. Rationale: (a) alone loses all read-side detection; (b) buys detection
at a price the measurement itself argues against; (c) is the only option that keeps the register
honest *and* leaves a chartered route to partial detection.

**★ THE STRONGEST ARGUMENT AGAINST (c).** *A chartered-but-unscheduled verifier is this programme's
own worst failure class.* A clause that says "declined on the serving path, offline verifier
chartered" reads as covered while the verifier has zero files — which is exactly what `DE-12`'s
three `SVC-*` ownerTickets do today (`SVC-002`, `SVC-003`, `SVC-005`: **zero files on disk**, the
only crossing in the register with no on-disk owner ticket at all). If the founder is not prepared
to fund the verifier in a named wave, **take (a) plain and write the loss down** — a stated,
unmitigated gap is worth more than a mitigation that never lands.

---

## 3. DE-27 (High) — the cross-replica and partition conjuncts

### 3.1 The clause, verbatim

> `"audit": "cross-replica admission and partition events are audited"`

### 3.2 Conjuncts

| # | Conjunct | Verdict | Why |
|---|---|---|---|
| 2a | **"cross-replica admission … events are audited"** | ★ **AMBIGUOUS — one reading is deliverable, the other is not.** | See §3.3. |
| 2b | **"… partition events are audited"** | **UNDELIVERABLE — vacuous.** | Re-measured at tip, whole-tree over `server/` and `packages/`: `replicaId\|replica_id\|AOA_CONTROL_PLANE_REPLICA\|controlPlaneId` returns **ZERO hits**. There is no partition **detector**, so there is no partition **event** to record. Nothing to instrument. |

### 3.3 ★ The ambiguity, which the finding reads as a machine problem and is really a wording problem

The admission decisions themselves **exist, fire, and are already serialized across replicas**:

- `server/src/services/worker-admission-rate-limit.ts:138-140` returns `over_cap`, taken as a 429 at
  `server/src/routes/worker-control.ts:412-416`.
- `server/src/services/org-concurrency.ts:222-224` takes `pg_advisory_xact_lock` over the
  organization id — *that lock is what makes admission cross-replica-serialized* — and denies at
  `:247-249`.

So the register has **two readings** of the word "cross-replica", and they have opposite verdicts:

- **STRONG reading** — *the record must name WHICH replica decided.* Undeliverable: no replica
  identity exists to name.
- **WEAK reading** — *admission is cross-replica-serialized, and the admission decisions are
  audited.* **Deliverable**, and it is already ordinary work: the `over_cap` deny is Group C
  (`sendWorkerOperationProtocolError` carries no db handle or tenant — `worker-protocol-http.ts:83-93`)
  and the capacity deny is Group B (a `throw` inside the tenant transaction, so an in-transaction
  write rolls back with it).

`E0-F013` reads it strong and calls the whole clause "unsatisfiable as written". That is defensible,
but it is **a reading, not a measurement**, and the register does not disambiguate. Under the weak
reading, `DE-27`'s admission conjunct is **not** a Decision 1 item at all — it is already inside
Groups B and C.

### 3.4 Options

**(a) AMEND.** Exact replacement text:

> `"audit": "cross-replica admission and partition events are audited. ★ AMENDED <date> by founder ruling (E0-F013 Decision 1). The clause is SPLIT. (1) 'cross-replica admission events': the WEAK reading is adopted and is what this clause now asserts -- that each admission REFUSAL is durably recorded (server/src/services/worker-admission-rate-limit.ts:138-140 over_cap, and server/src/services/org-concurrency.ts:247-249 capacity), and that admission is serialized across replicas by pg_advisory_xact_lock at org-concurrency.ts:222-224 and FOR UPDATE ... SKIP LOCKED at packages/db/src/repositories/tenant/job-control.ts:1983. It does NOT assert that a record names WHICH replica decided: the system has no replica identity (a whole-tree sweep for replicaId|replica_id|AOA_CONTROL_PLANE_REPLICA|controlPlaneId returns zero hits) and this clause no longer implies one. STILL ABSENT: neither refusal writes a row today; this is Group B (in-transaction throw) and Group C (sendWorkerOperationProtocolError carries no db handle or tenant) work, NOT a delivered control. (2) 'partition events': DROPPED as vacuous. There is no partition detector, so no partition event exists to audit. ★ WHAT IS LOST: a forensic reader cannot attribute an admission decision to a replica, and cannot learn from this log that a replica was ever partitioned. Double-admission is prevented by the database (job_attempts_placement_atomic_check and the conditional offerLease UPDATE), not detected by this record."`

- **What is lost, and who is harmed.** Two distinct losses. (i) *Attribution:* an operator debugging
  a double-admission incident cannot tell whether one replica or two produced a decision. (ii)
  *Partition visibility:* nobody is told a replica went partitioned — the system will simply behave
  correctly-by-construction (admission authority is re-derived per request from the shared database,
  never held) and say nothing. The harmed party is **the operator during an incident**, not a
  tenant; there is no tenant-visible exposure, because the integrity property is a database
  invariant.
- **★ THE HONEST RISK IN THIS AMENDMENT.** It narrows a **High** control to something the current
  single-writer architecture satisfies. If the programme ever *does* run multiple control-plane
  replicas with divergent local state, this amended clause will not notice. It must therefore be
  read together with `DE-27`'s `revocation` clause, which the register already records as
  **NOT-DELIVERED-AS-NAMED** ("there is no leader lease, fencing token or membership authority a
  replica could lose") — the two together, not this one alone, are what say the multi-replica story
  is by-construction rather than by-control.

**(b) CHARTER.** A replica identity (config-injected id, a heartbeat/membership table, a partition
detector) plus the Group B/C recorders. Tickets: `FND-005` exists on disk but **its entire
contribution to this crossing is a policy paragraph** — no admission code, no migration, no
two-replica test; `REL-002` has **zero files**. The ticket that actually built every enforcement
control here, `DEP-009`, is **not named by this row**. So chartering means writing `FND-005`'s
missing body, not extending it. **Does the programme intend to build it?** There is no evidence it
does: no ticket names replica identity, and the D1 merge-train two-replica campaign passes today
without one.

**(c) THIRD PATH — split, and move the admission conjunct out of Decision 1.** Amend conjunct 2b
(partition) as dropped-vacuous *now*, adopt the weak reading for 2a *now*, and let 2a's actual
delivery ride the Group B and Group C mechanism work already planned. Nothing new is chartered and
nothing is quietly narrowed to satisfiable-by-doing-nothing — because 2a stays **absent** after the
amendment.

### 3.5 ★ RECOMMENDATION — **(c)**

It is the only option that is honest about *both* conjuncts: the partition conjunct is dropped
because it names a non-existent detector, and the admission conjunct is **kept as an open
obligation** rather than either dropped or fantasised into a replica-identity project. Critically,
(c) leaves `DE-27` `partial` and in the cohort *after* the ruling.

**★ THE STRONGEST ARGUMENT AGAINST (c).** *"Cross-replica" was in the clause for a reason, and the
weak reading reads it out of existence.* The threat this row names is `Multi-replica coordination
hazard` / `two control-plane replicas double-admit the same work`. A reader of the amended clause
learns that admissions are audited and could reasonably conclude the multi-replica hazard is
observable. It is not. If the founder finds that too close to a false claim of enforcement, the
correct move is (b) — or at minimum, require the amendment to name the residual hazard in the same
sentence, which the text in §3.4 does.

---

## 4. DE-12 (Critical) — the generation-change conjunct, and the two the finding did not count

### 4.1 The clause, verbatim

> `"audit": "partition, drain, and generation changes are audited"`

### 4.2 ★ Conjuncts — the clause is a THREE-way conjunction and E0-F013 queues ONE of the three

| # | Conjunct | Verdict | Why, measured at tip |
|---|---|---|---|
| 3a | **"partition … audited"** | **UNDELIVERABLE — vacuous.** ★ Not queued by `E0-F013`. | Same measurement as `DE-27` 2b: no replica identity, no partition detector, whole-tree zero hits. |
| 3b | **"drain … audited"** | **UNDELIVERABLE — vacuous.** ★ Not queued by `E0-F013`. | There is no service drain. The register's own evidence says it: *"There is no reconciler file, no instance fence, no drain."* |
| 3c | **"generation changes are audited"** | **UNDELIVERABLE — vacuous.** The one queued. | `services.generation` has **no writer**. Re-measured whole-tree at tip: `update(services)` returns **zero hits anywhere** (including tests); `insert(services)` returns exactly two (`packages/db/src/repositories/tenant/index.ts:217`, one adversarial test). `generation` is `integer().notNull().default(1)` (`packages/db/src/schema/services.ts:26`) and its only reader is a `WHERE` predicate at `packages/db/src/repositories/tenant/job-control.ts:1675`. **No generation ever changes, so no change event exists.** |

**★ This is the conjunct-level correction this paper owes.** `E0-F013` files "DE-12's change half"
as one of five. Measured, it is **three of three** — the row's entire audit clause is vacuous, and
calling it a "half" understates it by two conjuncts. That matters for the amendment text: an
amendment that drops only "generation changes" leaves two vacuous conjuncts standing in a
**Critical** row.

### 4.3 Options

**(a) AMEND.** Exact replacement text:

> `"audit": "partition, drain, and generation changes are audited. ★ AMENDED <date> by founder ruling (E0-F013 Decision 1). ALL THREE CONJUNCTS ARE DROPPED AS VACUOUS, and the clause now asserts NOTHING pending the controls it depends on. Measured whole-tree at tip: (1) 'partition' -- no replica identity and no partition detector exist (replicaId|replica_id|AOA_CONTROL_PLANE_REPLICA|controlPlaneId returns zero hits), so no partition event exists; (2) 'drain' -- there is no service reconciler, no instance fence and no drain, so no drain event exists; (3) 'generation changes' -- services.generation has NO WRITER anywhere in the tree (update(services) returns zero hits; the column is notNull().default(1) at packages/db/src/schema/services.ts:26 and is read only as a WHERE predicate at packages/db/src/repositories/tenant/job-control.ts:1675), so no generation ever changes. ★ THIS IS AN AUDIT CLAUSE WITH NOTHING TO AUDIT, NOT AN AUDIT GAP: the three components this row's control names -- 'desired-state reconciler, generation, active fence' -- are themselves unbuilt (E0-F011). This clause becomes deliverable only when SVC-002/SVC-003/SVC-005 build them, and all three ownerTickets have ZERO FILES ON DISK. Do not read the drop as coverage."`

- **What is lost, and who is harmed.** **Nothing that exists today.** A vacuous conjunct protects
  nobody; dropping it removes a *false* assertion, not a real guarantee. The genuine risk is the
  opposite one: a reader skimming the amended row could take "dropped as vacuous" for "handled".
  The replacement text answers that in its own last sentence, and `DE-12` must stay `partial` with
  its `E0-F011` reference intact.

**(b) CHARTER.** Build the desired-state reconciler, the instance fence and the drain — i.e. build
`SVC-002`, `SVC-003` and `SVC-005`, which have **zero files between them**. This is not an audit
ticket; it is the service-lifecycle epic. **Does the programme intend to build it?** The only
authored `SVC` ticket **explicitly disclaims this crossing in writing**
(`SVC-001-terrain.md:216-218`), and its `releaseTest` `REL-002` and its `verificationLane` D4 are
both unwritten. On the evidence, **no.**

**(c) THIRD PATH — none worth naming.** There is no conjunct here to split off and close; splitting
requires at least one deliverable side, and all three are vacuous.

### 4.4 ★ RECOMMENDATION — **(a), covering all three conjuncts, not one**

`DE-12` is the clearest case in this paper. Drop all three, keep the row `partial`, keep `E0-F011`
as its owner, and make the amendment say in terms that the *control* is unbuilt so the audit clause
has no subject.

**★ THE STRONGEST ARGUMENT AGAINST (a).** *A Critical crossing whose entire audit clause is dropped
is a Critical crossing that now asserts less than a Low one — and the honest response to "the
control is unbuilt" is to build it, not to edit the register down to match.* If `DE-12`'s
`failureMode` (`two service instances act as active simultaneously`) is genuinely Critical, the
register's job is to keep saying so loudly until someone funds `SVC-002`. Against that: the row's
`deliveryStatus` and `deliveryEvidence` already say all of this at length, and it is the *clause*
field that the register's own note defines as "a charter, not a report" — so the amendment moves
the charter to match the intent while `deliveryEvidence` keeps the alarm. **This argument is strong
enough that the founder should consider a variant of (a) that drops the conjuncts but ALSO
re-raises `E0-F011`'s visibility** — the loss here is not in the register, it is in the empty
`SVC-*` tickets.

---

## 5. DE-20 (Critical) — the rollback conjunct, and the conjunct that should not be in this decision

### 5.1 The clause, verbatim

> `"audit": "cutover selection and rollback transitions are audited"`

### 5.2 Conjuncts

| # | Conjunct | Verdict | Why, measured at tip |
|---|---|---|---|
| 4a | **"cutover selection … audited"** | ★ **HALF DELIVERED, and the missing half is CLOSABLE TODAY. Not a Decision 1 item.** | A **distributed** selection writes one `distributed_execution_handoff` heartbeat-run event (`server/src/services/heartbeat.ts:6937`). A **legacy** selection — the other arm of the same decision — writes nothing: the non-suppressed path falls straight to `adapter.execute` at `heartbeat.ts:5453`. Both arms sit in `heartbeat.ts`, which is on the control plane, holds a db handle, is async, and already owns the event writer. **This is a wiring job in the same file, not a decision.** |
| 4b | **"… rollback transitions are audited"** | **UNDELIVERABLE — vacuous.** | Re-measured whole-tree at tip: `createDistributedExecutionDrain` has **zero production callers** — the census returns its declaration (`server/src/services/job-distributed-drain.js:114`), two test files, and nothing else. Removing an organization from the rollout dial cancels nothing in flight; it only changes what the **next** wake resolves. **There is no rollback transition, so there is no transition event.** |

**★ Conjunct 4a does not belong in Decision 1.** `E0-F013` files "DE-20's rollback half" — correctly
— but a founder ruling that treats `DE-20` as a Decision 1 row risks the selection conjunct being
amended away alongside it. It should be explicitly excluded from the ruling and left as ordinary
work.

**Note on the precedent already set.** `DE-20`'s `revocation` clause was **already amended by
founder ruling on 2026-09-09**, dropping the word "atomically" and narrowing "the rollback lever
cannot be pulled" to "the ORG-WIDE SWEEP has no production caller" (per-job cancellation ships and
is routed: `server/src/routes/job-control.ts:218` → `job-operations.ts:291` → `requestCancellation({graceful:true})`).
**The audit clause was not amended with it.** So the row currently holds an amended `revocation`
clause that concedes there is no org-wide rollback, beside an unamended `audit` clause that asserts
rollback transitions are audited. **The two clauses in the same row contradict each other today.**
That is an argument for ruling on 4b now rather than deferring it.

### 5.3 Options

**(a) AMEND 4b only.** Exact replacement text:

> `"audit": "cutover selection and rollback transitions are audited. ★ AMENDED <date> by founder ruling (E0-F013 Decision 1), consistent with the 2026-09-09 amendment to this row's revocation clause. (1) 'cutover selection': UNCHANGED and still an open obligation. A distributed selection writes one distributed_execution_handoff heartbeat_run_event (server/src/services/heartbeat.ts:6937); a LEGACY selection writes no durable row, and that gap is ordinary wiring in the same file, NOT covered by this amendment. (2) 'rollback transitions': DROPPED AS VACUOUS. createDistributedExecutionDrain (server/src/services/job-distributed-drain.ts:114) has ZERO PRODUCTION CALLERS, so no org-wide rollback transition occurs and none can be recorded. This matches the revocation clause's own amendment. ★ WHAT IS LOST: nothing that exists -- there is no rollback to fail to record. WHAT REMAINS TRUE AND MUST NOT BE READ AWAY: an operator removing an organization from the rollout dial gets NO record because NOTHING HAPPENS, not because the recording is missing; in-flight distributed runs continue and must be stopped one at a time via POST /organizations/:organizationId/companies/:companyId/jobs/:jobId/drain. The absent control is owned by E0-F014."`

- **What is lost, and who is harmed.** Nothing real is lost by 4b. The danger is misreading: an
  operator could take the dropped conjunct as "rollback is fine, just unlogged". The replacement
  text says the opposite explicitly and points at `E0-F014`.

**(b) CHARTER.** Wire the org-wide drain sweep to the rollout dial, then audit its transitions.
Tickets: `MIG-002`, `MIG-008` and `REL-003` all have files on disk, **but none closes this** —
`MIG-002-dial-result` records convergence as "unchanged and still absent", `MIG-008-result` defers
the live cutover, and `REL-003-result` names the live rehearsal as an owed operator leg. The ticket
that would own the missing rollback trigger, **`REL-005`, has zero files AND is not among this row's
`ownerTickets`**, so the obligation has no chartered exit at all. **Does the programme intend to
build it?** `E0-F014` is open and owns the dead drain; there is a real argument that the *control*
(not the audit) should be built. But that is `E0-F014`'s decision, not this one.

**(c) THIRD PATH — move 4b behind `E0-F014`, as `DE-21`'s board half went to Decision 3.** Do not
amend the audit clause at all; instead record that 4b is **blocked on `E0-F014`** and will be ruled
when `E0-F014` rules on whether the drain gets a caller. Cost: the row keeps a contradiction between
its amended `revocation` clause and its unamended `audit` clause for however long that takes.

### 5.4 ★ RECOMMENDATION — **(a), scoped to 4b only, with 4a named as excluded**

The 2026-09-09 `revocation` amendment already made this call for the control; leaving the audit
clause asserting the opposite in the same row is the kind of internal contradiction a register
cannot carry. Amending 4b costs nothing real and removes the contradiction today.

**★ THE STRONGEST ARGUMENT AGAINST (a).** *This is amendment-by-attrition.* `DE-20`'s `revocation`
clause was narrowed in September; now its `audit` clause is narrowed to match the narrowed
revocation; the next reader sees a `Critical` cutover row that asserts almost nothing and has never
once been exercised in a deployment (the register's own note: *"this crossing's enforcement has
never once been exercised in a deployment — the rollout source has zero deployment hits, so the
suppression return at heartbeat.ts:5451 is proven only in CI"*). Each step is locally justified and
the sequence is a Critical control dissolving. **(c) is the answer to that objection**: it keeps the
contradiction visible until someone rules on the control itself. The founder should choose (a) only
if willing to accept that `DE-20` is now, in substance, a *documented* single-owner invariant rather
than a *reversible* cutover.

---

## 6. DE-11 (High) and DE-17 (Critical) — the two whose blockers do not hold

### 6.1 DE-11 — ★ the premise is stale

**Clause, verbatim:**

> `"audit": "sensitive-artifact access and retention are audited"`

**`E0-F013`'s stated reason for blocking:** *"the sensitive-artifact access and retention controls
are themselves absent (`E8-F011`). Nothing decides, so there is nothing to record."*

**Measured at tip, that is not true of either conjunct.**

| # | Conjunct | Verdict | The decision that exists |
|---|---|---|---|
| 5a | **"sensitive-artifact access … audited"** | **ABSENT, but DECISIONS EXIST and some already record.** | Access is gated and **denies** at `server/src/services/artifact-transfer-grant.ts:113` (upload key must be under this org's attempt prefix) and `:201-202` (download requires a committed row for this tenant), and at `packages/db/src/repositories/tenant/job-control.ts:2750` `wrong_prefix` / `:2751` `tenant_mismatch`. ★ **Refusals at that surface ALREADY write `security.denied.artifact_transfer_grant` rows** (`server/src/services/artifact-denial-audit.ts:66`, wired by DE-06's Unit C). What is missing is the **successful** access record — which is precisely `DE-06`'s open "object put/get" conjunct, i.e. **already-scheduled work, not a decision.** |
| 5b | **"… retention are audited"** | ★★ **ABSENT, AND DELIVERABLE TODAY, CHEAPLY.** | `resolveStoredRetention` (`server/src/services/artifact-retention-authority.ts:49`) is a **live control-plane retention decision**, called at `server/src/services/artifact-commit.ts:253`, that overrides a worker's declared class. It returns `declarationIgnored: boolean`, and `artifact-commit.ts:257` branches on it. **The code's own comment at `:259-260` says: "This is a LOG LINE, not an audit record — DE-11 claims retention is audited and nothing audits it; this ticket does not pretend to close that."** That is a **deferral**, not an impossibility. |

**★ WHY 5b IS THE MOST VALUABLE THING IN THIS PAPER.** The record point sits inside a closure that
**already has everything the write needs**: `input.appDb` (the same handle `recordSecurityDenial` is
called with at `artifact-commit.ts:374`), `ctx.companyId` (the **locked lease's** company, not the
manifest's self-asserted one — `:187-188`), the artifact id, the kind, the declared class and the
derived class. `recordSecurityDenial` is **already imported in this file** (`:46`). This is roughly
the same shape and size as the `DE-19` closure, in a file that has already been wired twice.

**Two caveats stated rather than implied, because exoneration needs more evidence than conviction:**

1. **`declarationIgnored` is not a security denial.** The authority's own doc comment says so:
   *"a worker declaring a SHORTER class than derived is not an attack, but it is the same bug
   class."* So this record belongs in the retention-audit namespace, not necessarily under
   `security.denied.*` — a wiring unit must decide that, and the reserved-namespace guard
   (`assertUnreservedActivityNamespace`) will make it decide deliberately.
2. **Coverage caveat.** Nothing in production uploads `browser_cookie_state` / `browser_storage_state`
   today, because `BRW-003` is unbuilt. The decision point at `:253` fires for **every** artifact
   kind, so the record would be real and live — but it would not *yet* see the specific sensitive
   kinds `DE-11`'s boundary names. **That is a coverage gap, not an impossibility**, and it must be
   written down by whoever wires it.

**Options.**
**(a) AMEND** — not recommended. There is no honest narrowing available: the controls are not
absent, so an amendment would have to say something false or say nothing.
**(b) CHARTER** — one small ticket. 5b is a few lines at `artifact-commit.ts:257` plus a
provocation test; 5a is `DE-06`'s existing put/get obligation and needs no new charter. Depends on
nothing. Owner: the same wave that owns `DE-06`'s remaining half. `BRW-003`'s retention slice
`BRW-003c` is design-only today, and `REL-001` has zero files, so the ticket must be new.
**(c) THIRD PATH** — split: charter 5b now, and let 5a ride `DE-06`.

**★ RECOMMENDATION — (c), and REMOVE DE-11 FROM DECISION 1 ENTIRELY.** It is not an undeliverable
clause; it is unscheduled work with a live decision point and a ready record sink.

**★ THE STRONGEST ARGUMENT AGAINST.** *`DE-11`'s boundary is "Browser-session workload ↔ sensitive
artifacts", and the browser workload does not exist.* Wiring a retention-audit record on the generic
artifact path produces rows about `screenshot` and code artifacts and **never once** about a
`browser_cookie_state` — so the crossing could be marked as having a wired audit while the actual
sensitive path remains unbuilt and unobserved. That is a real risk and it is this programme's own
failure class. **The mitigation is not to skip the wiring; it is to forbid the `deliveryStatus`
move** — `DE-11` must stay `partial` until `BRW-003` ships and the record is provoked on a genuinely
sensitive kind. Whoever wires 5b must write that constraint into the row.

### 6.2 DE-17 — ★ the freeze is not the blocker

**Clause, verbatim:**

> `"audit": "post-fence cleanup and denied escalations are audited"`

**Conjuncts:**

| # | Conjunct | Verdict |
|---|---|---|
| 6a | **"post-fence cleanup … audited"** | **ABSENT.** No record of a cleanup action is written anywhere; `packages/adapter-manager/src/server.ts`'s only metric counts reaper sweeps, not gate outcomes. |
| 6b | **"… denied escalations are audited"** | **ABSENT.** Re-measured whole-tree at tip: every single reference to `CleanupAuthorityDeniedError` is a **throw site, a class declaration, a barrel re-export, or a conformance/test assertion**. **Nothing catches it.** |

**`E0-F013`'s stated blocker:** the two packages *"run off the control plane and hold no
control-plane DB handle, so a durable row needs a wire hop — and `packages/worker-protocol` is
v1-FROZEN behind a hash-pinned cross-version conformance test. Its own ticket, with its own freeze
decision."*

**The DB-handle half is confirmed.** Whole-tree: `packages/adapter-manager/src` has **zero** imports
of `@armyofagents/db` or `drizzle`; `packages/worker-daemon/src/index.ts:5` states the constraint is
**statically enforced**. A durable row genuinely cannot be written in-process.

**★ But "the freeze blocks the wire hop" does not hold, and there are TWO independent channels.**

1. **The frozen envelope ships a bounded extension container built for exactly this.**
   `packages/worker-protocol/src/extensions.ts` defines `{namespace, schemaVersion, critical, value}`
   with locked limits, and **`extensions` is a field on the worker EVENT schema**
   (`packages/worker-protocol/src/events.ts:347`, refined at `:405`). V1 recognises **no** critical
   namespaces, so a `critical: false` extension is ignored by a frozen v1 consumer **by design** —
   which is what makes it additive under the freeze rather than a breach of it. The daemon's own
   emitter already takes it: `EventSequencer.#emit(eventType, payload, extensions = [])`
   (`packages/worker-daemon/src/supervisor/events.ts:138`), and the daemon already **reads**
   extensions off inbound envelopes (`lease/staged-input.ts:98`, `lease/control-commands.ts:112`).
   The precedent for a governed refusal riding the wire is in the frozen vocabulary already:
   **`network_denied`** (`events.ts:371`) is exactly that shape.
2. **The adapter-manager already has an authenticated HTTP channel to the control plane.**
   `server/src/app.ts:525` mounts `adapterManagerControlRoutes` with the comment *"adapter-manager
   PULLs to classify orphan sandboxes"*, and `server/src/routes/adapter-manager-control-auth.ts`
   exists as its dedicated auth module. A denial at `packages/adapter-manager/src/owned-op-gate.ts:154-156`
   can be reported over a channel that is **already built, already authenticated, and not governed
   by `worker-protocol` at all.**

**What is genuinely missing, then:** a **catch point** (nothing catches `CleanupAuthorityDeniedError`
today), a **carrier** (choose channel 1 or 2), and a **CP-side drain** into `activity_log`. That is
three pieces of ordinary code across two packages — real work, plausibly a wave — but **it is not a
freeze decision and it is not architecturally blocked.**

★ **The counter-evidence I am obliged to state.** `E7-F011` records that `CLI-008` Unit B's channel
*"has no route on the networked/container lane"* — but measured, that finding is about a **provider
operation** (`stage_files`) missing from the frozen **operation vocabulary**
(`capabilities.ts:142-153`), which is a different mechanism from the **extensions container on a
worker event**. It does not transfer. I have **not** measured that any control-plane consumer drains
worker-event extensions into `activity_log` today; a chartering unit must establish that itself.

**Options.**
**(a) AMEND** — narrow to "denied escalations are recorded in the worker's local log". Cost: a
Critical cleanup-authority crossing would assert only a process-local log line that dies with the
process, on a boundary whose whole point is that the worker is **less** trusted. **Reject.**
**(b) CHARTER** — a ticket for the catch point + carrier + drain. `DE-17`'s four ownerTickets
(`WRK-004`, `DEP-008`, `CLI-004`, `REL-004`) all have files on disk, so the route does not terminate
nowhere — but **`REL-004` names no `DE-17` post-fence-cleanup test**, so the exit criterion is only
as specific as `REL-004`, and that must be fixed in the same charter.
**(c) THIRD PATH** — split by channel: charter the **adapter-manager** half (6a/6b at the wire, over
the existing HTTP control channel — no protocol question at all) **now**, and defer the
**worker-daemon** half (extensions on a worker event) behind a named later decision that establishes
whether anything drains extensions today.

**★ RECOMMENDATION — (c).** It closes the half that needs no protocol judgement, and it forces the
open question about the extensions drain to be *measured* rather than assumed in either direction.

**★ THE STRONGEST ARGUMENT AGAINST (c).** *A split delivers the wrong half.* `DE-17`'s
`failureMode` is *"cleanup authority is escalated into effect authority"*, and the register records
that **at the wire the opposite line exists** — `packages/adapter-manager/src/server.ts:89-98` puts
`create` and `execute` **inside** `GATE_REQUIRED_OPS` beside `cancel`/`kill`/`destroy`, and
`OwnedLabelsCapability` is `{v, audience, ownedLabels, expiresAt, sig}` with **no operation or scope
field**, so a cleanup-only wire capability is *unrepresentable*. Auditing denials on a wire whose
`authorization` clause is itself not delivered records refusals of a gate that cannot express the
distinction the clause names. **Against that:** an audit record is still strictly better than
silence, and `E0-F014` already owns the authorization gap separately. But the founder should not
read a wired 6a/6b as evidence that `DE-17` is closing — it is not, and the `authorization` clause
is the reason.

---

## 7. ★ THE ARITHMETIC — verified independently, and E0-F013's own number is off by one

**The seventeen, verified.** The class is *crossings whose `audit` clause asserts that denials are
recorded*. Two findings carry it:

- **`E0-F010`, eight** (its own text, `findings.md:271`): `DE-01`, `DE-03`, `DE-04`, `DE-06`,
  `DE-11`, `DE-12`, `DE-13`, `DE-14`.
- **`E0-F013`, nine** (its table, `findings.md:504` ff.): `DE-15`, `DE-16`, `DE-17`, `DE-18`,
  `DE-19`, `DE-20`, `DE-21`, `DE-27`, `DE-29`.

8 + 9 = **17**. ✔ No crossing appears in both.

**Closed: one.** `DE-19` (2026-09-08), scoped to `memory.get`. `DE-06` and `DE-21` each received a
*fraction* of a conjunction in Unit C (2026-09-09) and **neither closed**. **Open: sixteen.**

**Now the count E0-F013 states.** Its own words:

> *"of the seventeen, ONE is closed and at most ELEVEN more are closable end to end. Five
> clause-halves are not, and DE-17 is a sixth behind the protocol freeze. Any plan must state
> twelve, not seventeen."*

**Working, from the finding's own Group D:**

| | |
|---|---|
| Total in class | **17** |
| Group D members the finding treats as **not closable** | `DE-01` (read half), `DE-27`, `DE-12`, `DE-20` (rollback half), `DE-11`, `DE-17` = **6** |
| *(`DE-14` is also in Group D but the finding calls it closable — "~5 lines, take it as a freebie" — so it is not in the six)* | |
| Therefore closable, ever | 17 − 6 = **11** |
| Of those, already closed | `DE-19` = **1** |
| Therefore **more** closable | 11 − 1 = **10** |

**★ THE FINDING SAYS "ELEVEN MORE", WHICH GIVES 1 + 11 = 12. THE CORRECT FIGURES ARE TEN MORE AND
ELEVEN TOTAL.** The slip is visible inside the sentence itself: it subtracts **five**
("Five clause-halves are not") and then adds `DE-17` as **a sixth** without re-subtracting.
17 − 5 = 12; 17 − 6 = 11. **Yes — DE-17 makes it eleven.**

Enumerated, so the eleven can be checked one at a time: `DE-03`, `DE-04`, `DE-06`, `DE-13`, `DE-14`,
`DE-15`, `DE-16`, `DE-18`, `DE-19` *(closed)*, `DE-21`, `DE-29`.

**★ AND MY OWN MEASUREMENT MOVES IT AGAIN — which is why this paper does not hand over a single
number.** Under §2, §6.1 and §6.2, three of the six are not blocked as filed:

| Premise | Hard-blocked crossings | Honest ceiling |
|---|---|---|
| `E0-F013`'s Group D as written | `DE-01`, `DE-11`, `DE-12`, `DE-17`, `DE-20`, `DE-27` (6) | **11** |
| This paper's measurement (DE-11 and DE-17 rescheduled; DE-01 deliverable at a declined cost) | `DE-12`, `DE-20`, `DE-27` (3) | **14** |

**The number a plan may state depends on this ruling, and on nothing else.** State it as a band with
its premise attached — *"eleven under the current dispositions; up to fourteen if Decision 1
reschedules DE-11 and DE-17 and funds DE-01's read half"* — and **never** as seventeen. The only
figure that is pure arithmetic rather than judgement is the correction above: **`E0-F013`'s "twelve"
should read "eleven."**

**One drift noted in passing, changing nothing here.** `E0-F013` records Decision 2's acceptance
condition **(a)** — a production reader of `security.denied.*` — as **OPEN**. At this branch point
the reader **ships**: `activityService.securityDenials` (`server/src/services/activity.ts:308`) behind
`GET /instance/security-denials` (`server/src/routes/activity.ts:112`, gated by
`assertCanManageInstanceSettings`). That is a Decision 2 bookkeeping item, not a Decision 1 one, and
this paper does not amend it.

---

## 8. ★ DECISION BLOCK — six signatures, not one

The six are different shapes and must be signed separately. **Signing a blanket "amend everything"
would narrow two Critical controls that are not actually blocked.**

---

### ▢ **DECISION 1.1 — DE-01 (Critical), `audit`, read-denial conjunct**

- ▢ **(a)** Amend to the decline (exact text in §2.4). Read-denial detection is given up.
- ▢ **(b)** Charter a serving-path comparator. *Not recommended by the measurement that unblocked it.*
- ▢ **(c) ★ RECOMMENDED** — Amend as (a), **and** charter a narrow **offline** verifier on the `0268`
  shape as a separate, later ticket.
- ▢ **(a) plain** — take (a) and explicitly decline the verifier, writing the loss down unmitigated.
  *Choose this if (c)'s verifier will not be funded in a named wave.*

**Also record:** conjuncts 1a ("query events") and 1b (write-side `42501`) are **unblocked and
unwritten**, and are **not** covered by this ruling.

---

### ▢ **DECISION 1.2 — DE-27 (High), `audit`**

- ▢ **(a)** Amend both conjuncts (exact text in §3.4).
- ▢ **(b)** Charter replica identity + a partition detector. *`FND-005` has only a policy paragraph;
  `REL-002` has zero files.*
- ▢ **(c) ★ RECOMMENDED** — Adopt the **weak** reading of "cross-replica admission" (so the conjunct
  stays an **open obligation** inside Groups B/C), and **drop** the partition conjunct as vacuous.
  `DE-27` stays `partial` and stays in the cohort.

---

### ▢ **DECISION 1.3 — DE-12 (Critical), `audit`**

- ▢ **(a) ★ RECOMMENDED** — Amend, dropping **all three** conjuncts as vacuous (exact text in §4.3),
  keeping `partial`, keeping `E0-F011` as owner, and stating in the clause that the *control* is
  unbuilt so the audit clause has no subject.
- ▢ **(a) + escalate** — as (a), **and** raise `E0-F011`/`SVC-002`'s visibility, since the real loss
  is three ownerTickets with zero files.
- ▢ **(b)** Charter the reconciler / fence / drain (`SVC-002`, `SVC-003`, `SVC-005`). *`SVC-001-terrain.md:216-218`
  disclaims this crossing in writing.*

**★ Do not amend only the "generation changes" conjunct.** The clause has three and all three are
vacuous.

---

### ▢ **DECISION 1.4 — DE-20 (Critical), `audit`**

- ▢ **(a) ★ RECOMMENDED, SCOPED TO 4b ONLY** — Amend the *rollback* conjunct as vacuous (exact text
  in §5.3), explicitly leaving the *cutover selection* conjunct untouched and open.
- ▢ **(c)** Do not amend; move 4b **behind `E0-F014`** and rule when `E0-F014` rules on the dead
  drain. *Keeps the row's current internal contradiction visible.*

**Also record:** conjunct 4a's missing legacy-selection record is **closable today** in
`heartbeat.ts` and is **not** a Decision 1 item.

---

### ▢ **DECISION 1.5 — DE-11 (High), `audit`**

- ▢ **★ RECOMMENDED — REMOVE FROM DECISION 1.** The premise ("nothing decides") is **stale**.
  `resolveStoredRetention` decides at `artifact-commit.ts:253` and `:257`, with `input.appDb` and
  `ctx.companyId` in scope and `recordSecurityDenial` already imported at `:46`. Charter the
  retention record as a small ticket; let the access conjunct ride `DE-06`'s open put/get half.
- ▢ **Constraint to attach if chartered:** `DE-11` **must stay `partial`** until `BRW-003` ships and
  the record is provoked on a genuinely sensitive kind — the decision point fires for all kinds, but
  no `browser_cookie_state` exists to be seen today.
- ▢ **(a)** Amend anyway. *No honest narrowing is available; an amendment here would have to assert
  something false.*

---

### ▢ **DECISION 1.6 — DE-17 (Critical), `audit`**

- ▢ **★ RECOMMENDED — (c), SPLIT BY CHANNEL.** Charter the **adapter-manager** half now over the
  **existing authenticated CP control channel** (`server/src/app.ts:525`,
  `routes/adapter-manager-control-auth.ts`) — no protocol question arises. Defer the
  **worker-daemon** half behind a named later decision that first **measures** whether any
  control-plane consumer drains worker-event `extensions[]`.
- ▢ **(b)** Charter both halves as one ticket, and fix `REL-004` to name a `DE-17` post-fence-cleanup
  test in the same charter.
- ▢ **(a)** Amend to "recorded in the worker's local log". *Reject — a process-local line on a
  less-trusted boundary is not an audit record.*

**★ Record with whichever is chosen:** the *stated* blocker — the v1 protocol freeze — **does not
hold**. `extensions[]` is on the worker-event schema (`events.ts:347`) and V1 recognises no critical
namespaces, which is precisely what makes a `critical:false` extension additive under the freeze.
**And record the counterweight:** `DE-17`'s `authorization` clause is separately not delivered at the
wire (`server/src/adapter-manager` capability cannot express cleanup-only), so a wired audit must not
be read as `DE-17` closing.

---

### ▢ **DECISION 1.7 — THE COUNT**

- ▢ **★ RECOMMENDED** — Record that `E0-F013`'s **"twelve"** is **eleven** under its own groupings
  (working in §7), and that any plan states the number **as a band with its premise attached** —
  *eleven under current dispositions, up to fourteen if 1.5 and 1.6 reschedule and 1.1 funds the
  read half* — **never seventeen**.

---

## 9. What this paper is not

It changes **no** finding status, **no** `deliveryStatus`, **no** ownership, **no** clause text and
**no** gate-clause enrolment. It wires nothing and writes no production code. It exists so Decision 1
can be signed per clause — and so that three of the six are not amended away on a blocker that
measurement does not support.
