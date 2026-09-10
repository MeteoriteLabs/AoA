# SVC-007a — service create, generation and the desired-state control — RESULT

**Epic:** E9 · **Lane:** B · **Base:** `053f90fc8` (branched from `docs/replatform-program`)
**Terrain + design:** [`SVC-007a-design.md`](./SVC-007a-design.md)
**Register:** gate clause `E9-4-service-create-and-desired-state` enrolled `wired`. **`E9-F006`
OPENED and RESOLVED here. `E9-F002`, `E9-F003` and `E9-F004` are untouched and all three stay
`open`/`unowned`. SVC-007 STAYS OPEN.**

> **★ SVC-007 HAD ZERO FILES ON DISK at `053f90fc8`** — no terrain, no design, no result, only the
> `#### SVC-007` node in `program-design.md` and **55 references across 24 files** (measured at
> `053f90fc8` over `docs/` + `scripts/`, `*.md` and `*.json`) — other tickets' scope-outs,
> register rows in `scripts/gate-clause-wiring.json` and two `docs/architecture/*.json`
> registers, and four findings-register lines that named it as an inheritor. Terrain and design
> were part of this unit's job and are in the companion file. Re-measured at source; no citation
> in either document is inherited.

---

## 1. What shipped, in one paragraph

An org admin can now create a service. `createServiceWithinTenant` writes the `services` row and
its immutable generation-1 `service_generations` row inside ONE transaction, behind a definition
boundary that refuses ingress keys (from SVC-001's own shipped deny-set), control-plane-owned
identity fields, unknown fields and anything the frozen `serviceWorkloadV1Schema` rejects.
`setServiceDesiredState` moves `desired_state` through the FROZEN
`SERVICE_DESIRED_TRANSITIONS` table under SVC-002's own per-service row lock, and a stop also
reaches the SHIPPED `requestCancellation({graceful:true})` channel — the same one JOB-008's
`drain` route uses — then terminalizes the instance that cancellation orphaned. Four routes on
`jobControlRoutes` compose it, behind the same `execution_target:manage` gate every other
operator mutation on that router uses. Zero wire change; zero new relations; zero migrations.

---

## 2. ★★★ WHAT IS NOW TRUE THAT WAS NOT, AND WHAT IS STILL NOT TRUE

**Now true.** Three shipped documents carried the same two sentences at base and all three were
right — `SVC-002-result.md` §7 (*"Nothing creates a service … Nothing writes a generation"*),
`SVC-003a-result.md` §2 (*"NOTHING CREATES A SERVICE … so on a real deployment there is no
`services` row, so no instance, so nothing for this projection to move"*) and this epic's
`README.md` (*"every pass stalls at `no_generation` on a real deployment"*). Those sentences are
no longer true. SVC-002's reconciler and SVC-003a's projection were **shipped and structurally
unreachable**; a service created through this path is converged by the reconciler — including
through `createServiceReconciler(...).tick()` — the SAME sweeper the composition root drives,
with its admitted-organization enumerator stubbed and its backoff timer not exercised, so what
that case proves is that a created service ENTERS `listReconcilableServices`'s window and
converges through the sweep, not that the process wiring around the sweeper runs — into exactly
one instance and one `service` job built from the STORED definition.

**★ STILL NOT TRUE, AND E9'S EXIT GATE IS NOT MET.** The gate names ten things. This unit moves
**two of them partly — `desired state` and `generation` — and touches a third, `drain`**. Rows 3
and 4 below are marked from SVC-002 and SVC-003a and are unchanged by this unit; the remaining
six are not delivered at all:

| # | Gate item | After this unit |
|---|---|---|
| 1 | desired state | **partial** — create (`running`/`paused`) and control (`running`/`paused`/`stopped`) ship. `deleted` is refused (terminal tombstone, SVC-005). |
| 2 | generation | **partial** — generation **1** is written. NOTHING mints N+1: a rollout without SVC-005's overlap fence is the overlap E9's acceptance forbids. |
| 3 | placement | unchanged (SVC-002's control-plane half). **No service job is leased anywhere in this suite** — `E9-F002`. |
| 4 | health | unchanged (SVC-003a). No worker is in the loop here, so no worker-driven projection is exercised. |
| 5 | restart | **not delivered.** SVC-004. |
| 6 | checkpoint | **not delivered**, and not storable — `job_control_commands_kind_check` omits `checkpoint` entirely (SVC-001). SVC-004. |
| 7 | drain | **partial** — a job-level graceful stop is now reachable FOR A SERVICE. Worker drain, replace-before/after-stop and force-kill are SVC-005's. |
| 8 | budgets | **not delivered.** Spend is attributed per job; no per-service budget exists and no TTL is accepted (§5). |
| 9 | UI | **not delivered.** Four HTTP routes, no UI. |
| 10 | D4 72-hour canary | **not run.** SVC-006. |

**Do not read this ticket as closing SVC-007.** Its Outcome is a conjunction —
create/update/pause/resume/stop **and** a view of desired state, generation, active instance,
health, checkpoint, budget and restart history — and `update` (generation rollout), checkpoint,
budget and restart history are all absent. Half of a conjunction is not it.

---

## 3. The arming path, counted rather than asserted

The brief's warning was that this is the unit most likely to ship a create path with no caller —
`repos.services.insert` reads exactly like `createStartupReconciler` and the reaper, both already
on the register as dead arming paths. Measured with the register's own `countProductionCallers`,
base `053f90fc8` vs head:

| Symbol | Base | Head | What the head count is |
|---|---|---|---|
| `createServiceWithinTenant` | — (did not exist) | **1** | `createService` |
| `createService` | — | **1** | the POST route |
| `setServiceDesiredState` | — | **1** | the desired-state route |
| `setServiceDesiredStateWithinTenant` | — | **1** | `setServiceDesiredState` |
| `readService` / `listServices` / `normalizeServiceDefinition` | — | **1** each | the GET routes and the create route |
| `insertServiceGeneration` | — | **3** | ★ the MEASURED figure. For a tenant-repository method the guard counts the interface declaration and the implementation alongside the one call site. The intuitive figure is 1. |
| `updateServiceDesiredState` | — | **3** | same shape |
| `terminalizeServiceInstanceForCancelledAttempt` | — | **3** | same shape |
| `findServiceForCompany` / `listServicesForCompany` | — | **3** each | same shape |
| `findLiveServiceInstance` | — | **4** | declaration + implementation + two call sites (`setServiceDesiredState`, `readService`) |
| **`canTransitionServiceDesiredState`** | **0** | **1** | ★ the one that matters — see below |
| `lockServiceForReconcile` | **3** | **4** | the control REUSES SVC-002's per-service advisory lock rather than minting a second key |
| `decideServiceProjection` | **1** | **2** | the control-plane backstop reads its mapping from the worker path's own decider |
| `findServiceGenerationDefinition` | **3** | **4** | the fourth is `readService` — the operator view resolves the CURRENT generation's definition through SVC-002's own reader rather than a second query. (`T4` reads it back too, but the counter excludes tests, so it is not the delta.) |
| `createStartupReconciler` (the cautionary neighbour) | **0** | **0** | untouched; still zero |
| `createServiceReconciler` | **2** | **2** | untouched |

`repos.services.insert` is a property access the counter cannot see. Measured by grep over
non-test sources: **0** production call sites at base, **1** at head
(`createServiceWithinTenant`). The two other head matches are comments, in this result's own
subject matter — which is exactly the class `stripComments` exists for.

★ **`canTransitionServiceDesiredState` is the vacuous symbol this unit arms**, and it is the
SECOND dead frozen fence in this epic: `canTransitionServiceInstanceStatus` was in the identical
state until SVC-003a. Its only references at base were its own definition, the package barrel
(which the counter strips) and its own unit test. A lifecycle nothing enforces is a clause that
is vacuously true.

**THE COMPOSITION ROOT, BY NAME:** `jobControlRoutes` in `server/src/routes/job-control.ts`,
mounted by `createApp` (`server/src/app.ts`) inside the `opts.distributedExecutionEnabled` block
over the non-owner `aoa_app` pool — the same router that already carries JOB-008's operator
surface. Nothing new is registered in `server/src/index.ts`.

---

## 4. Reds observed, the NAMED POSITIVE CONTROL, and the mutants

**★ HOW THE REDS WERE OBSERVED, stated so they are not over-read.** There is **no genuine
base-tree red** in this suite, and saying so plainly matters: a suite that drives a module which
does not exist at base reds on "cannot import", which proves nothing about the shipped path
(SVC-008b's lesson, restated by SVC-003a). Every red below is a MUTATION result. Each mutant was
applied by a harness that

* **refuses to apply when a backup already exists** — the failure that let five mutants stack
  silently in SVC-003a's run;
* **tries BOTH line-ending forms of its anchor and THROWS when neither matches** — this tree is
  mixed (`packages/db/src/repositories/tenant/job-control.ts` is CRLF, the new module is LF), and
  every applied mutant's report names which form matched;
* **decides applied-ness by comparing bytes**, not by whether a step threw;
* for a repository mutant, **rebuilds `packages/db/dist` and confirms the mutation is PRESENT in
  the rebuilt `dist`** before the result is believed — the server suite resolves
  `@armyofagents/db` through `dist` while vitest prints `src` paths.

> ★ **AND THIS HARNESS FAILED ONCE TOO, recorded for the same reason SVC-003a recorded its two.**
> Its `finally` restored unconditionally. When `M13`'s anchor MISSED — a stale anchor naming a
> method that no longer followed the one being mutated — `apply` threw *before* writing the
> backup, the `finally` then threw `NO BACKUP to restore`, and **that second error replaced the
> first**: the harness reported a restore problem for what was actually a stale anchor. It now
> restores only when the apply provably landed. `git status --porcelain` and a `MUTANT_` grep
> were checked immediately afterwards and the tree was clean, so no partial write survived.
> *An error handler that can throw over the error it is handling is a check that hides one.*

**NAMED POSITIVE CONTROL: `★ T9 POSITIVE CONTROL — a service with no generation still stalls at
no_generation`.** A hand-inserted `services` row with no generation converges NOTHING and
reports `{action:"none", reason:"no_generation"}` — the exact state the whole tree was in at
base. **Green before, green after, and green under all seventeen mutants.** Without it, every
convergence assertion in this suite could be made green a second way: by weakening the
reconciler until it starts a service with no readable definition. If T9 ever reds, a green T2 was
measuring a broken reconciler rather than a working writer.

**SEVENTEEN mutants over 30 cases** (18 pure + 12 integration). Counts are the FINAL figures,
re-measured on the shipped source after the last edit — not the numbers from the first pass,
which were taken over 29 cases before `T12` was added.

| # | Mutant | Result |
|---|---|---|
| 1 | Delete the generation writer entirely — **the BASE-TREE state** (`service_generations` had zero writers) | **9 red**, positive control green |
| 2 | Store the definition under different key names (`cmd`/`argv`/`stopSeconds`) | **6 red** |
| 3 | Ignore the requested `desiredState` and always create `running` | **1 red** — T3 |
| 4 | Write a `ttl_seconds` nothing enforces | **1 red** — T4 |
| 5 | Delete the ingress deny-set loop | **1 red** — P2 |
| 6 | Delete the control-plane-owned field loop | **1 red** — P3, on the REASON (the fields still fall through to `unknown_field`, so collapsing the two reasons would let the loop be deleted with nothing red) |
| 7 | Replace the FROZEN desired-state predicate with `true` | **3 red** |
| 8 | Delete the same-state short-circuit | **3 red** — the frozen table has no self-edges, so a satisfiable request answers `illegal` |
| 9 | Delete the graceful-stop call | **4 red** — the Stop button that moves a column and nothing else |
| 10 | Delete the control-plane attempt-terminal backstop (**E9-F006**) | **2 red** — including T6's resume leg |
| 11 | Run the backstop with an EMPTY predecessor set | **2 red** — the fail-closed shape is load-bearing |
| 12 | Short-circuit the cancellation on `unchanged` | **1 red** — ★ P10b, the retry property |
| 13 | Drop the `companyId` predicate from `findServiceForCompany` | **1 red** — T8 |
| 14 | Delete the "attempt must already be terminal and not succeeded" gate | **1 red** — T10 |
| 15 | Widen the generation-conflict catch to a bare `catch { return null }` | **1 red** — T12(a) |
| 16 | Treat an EMPTY `allowedFromStatuses` as "anything goes" | **1 red** — T10 |
| 17 | Drop the compare-and-set predicate from `updateServiceDesiredState` | **1 red** — T12(b) |

★ **MUTANTS 15 AND 17 DID NOT KILL ON THE FIRST PASS, and that is recorded rather than dropped.**
Both guard properties no shipped caller can violate: the generation insert's narrow `23505` catch
has no reachable non-`23505` failure from `createServiceWithinTenant` (the triple-composite
tenant FK is satisfied by construction — the service row was inserted in the same transaction),
and the compare-and-set predicate is redundant while the caller holds the row lock. *A guard whose
mutant nothing kills is a guard that can be deleted with a green suite.* `T12` was added to drive
both directly against the repository, and both mutants then killed it. The residual is stated in
the test file beside the case: neither property is reachable from a shipped caller today; each
exists for a FUTURE one — the narrow catch so a tenant violation is never reported as "a
generation already exists", the CAS so a caller that forgets the lock cannot overwrite a state it
did not read.

★ **MUTANT 1 IS THE ONE TO READ.** It reproduces the base tree exactly — no generation writer —
and nine of the twelve integration cases go red, including the sweeper case and the
create→reconcile→stop→resume chain. That is the size of the seam this unit closes.

**Suites:** `server/src/__tests__/service-management.test.ts` (18 pure cases, including a walk of
the WHOLE 4×3 desired-state table against the frozen predicate with an anti-vacuity check that
both answers occur) and `server/src/__tests__/service-management.integration.test.ts` (12 cases,
real embedded PostgreSQL, run with `AOA_RUN_WIN_INTEGRATION=1`).

---

## 5. ★★★ E9-F006 — the stop that orphaned its own instance

Found while building the stop control, filed, and resolved in this commit. The full statement is
in `../findings.md`; the short version, because the shape is the lesson:

`repos.jobControl.requestCancellation` has a branch that **FINALIZES** a cancellation directly —
attempt and job both `cancelled` under its own locks — precisely when there is no fenced worker
to drain. **No worker event is emitted, because there is no worker.** SVC-003a's attempt-terminal
backstop lives in `decideServiceProjection`'s `terminal` arm and fires only from an INGESTED
event, so on that branch it never runs: the instance stayed non-terminal inside
`service_instances_live_service_uq` forever, `countNonTerminalInstances` answered 1 for the rest
of the service's life, and a later `stopped → running` resume converged **nothing, on every
tick**, with no error anywhere.

★ **That is the NORMAL path today, not an edge case.** `E9-F002` keeps `workload.service`
unofferable on most fleets, so a service job is typically never leased and every stop takes the
finalize branch. A stop control shipped without this fix would have wedged its own happy path.

The fix reads its mapping **from `decideServiceProjection` itself** for the same attempt status,
so the control-plane path and the worker path cannot drift into two ideas of what a cancelled
attempt means. Four bounds keep it a backstop rather than a licence: the attempt must ALREADY be
terminal and NOT `succeeded` (re-read under the instance's row lock, so a live instance can never
be terminalized — mutant 14); an already-terminal instance is a `noop`, never a refusal on the
happy path; an EMPTY predecessor set REFUSES rather than writing (mutants 11 and 16); and the
write goes through `writeServiceInstanceStatus`, the ONE writer of that column, conditional on
the status read under the lock. No projection receipt is written and that is FORCED rather than
chosen — `job_projection_receipts.source_fence` is `NOT NULL` and this path has no fence, by
definition.

**Not closed by this:** JOB-006's behaviour is unchanged. Any other control-plane path that
terminalizes a service job — SVC-005's TTL stop and budget stop are the named ones — strands its
instance the same way unless it makes the same call. Stated in E9-F006 §4 so it is not
rediscovered a third time.

---

## 6. Decisions this unit made, and what it refused

* **`update` (generation rollout) is NOT here.** SVC-005's acceptance forbids two generations
  performing external effects simultaneously without a later approved decision, and that fence
  does not exist. A generation writer able to mint N+1 without it would be shipping the overlap
  and calling it an update.
* **`ttlSeconds` and `checkpointArtifactId` are REFUSED at the API and written NULL.** Nothing
  enforces a TTL and nothing restores a checkpoint. Storing either would show an operator a bound
  no code keeps — *a column nothing reads makes a clause vacuously true*, which this epic has
  already filed twice.
* **`deleted` is not a controllable state.** Terminal in the frozen table, and the
  `service_generations` RESTRICT FK makes a service with any generation undeletable, so it is an
  irreversible tombstone. SVC-005.
* **The stop's two writes are ordered, and the order is load-bearing.** Desired state first,
  cancellation second: reversed, a reconciler tick between them would replace the instance the
  operator just stopped. The cancellation half therefore also runs on the `unchanged` verdict, so
  a stop whose cancellation failed is retryable — mutant 12 is that property.
* **The desired-state control reuses `lockServiceForReconcile`.** SVC-002's design named this
  control by name as a writer it interlocks with. A second lock helper with its own key would
  serialize against nothing.
* **Clause (d)'s limit is inherited verbatim** from `service-job-config.ts`: "no public
  port/ingress configuration is accepted" governs DECLARATIVE CONFIGURATION and NOT reachability.
  E2B serves arbitrary in-sandbox ports publicly at a URL derivable from the sandbox id, so a
  service that merely LISTENS is reachable with no ingress configuration at all. `args` is not
  scanned for `--port`, for the reason that file gives. **A green refusal test must not be read
  as "services cannot be reached".**

---

## 7. What is still NOT true after this, beyond the gate table

* **No service job has ever been leased in any E9 suite.** SVC-003a said this; it is still true.
  The instance in these tests reaches `pending` and, on a stop, `failed` — driven by the control
  plane, never by a daemon. **"Created, supervised, projected" is NOT proven end to end**, and the
  E9 exit gate is **not claimed**.
* **Create is not idempotent.** `services` has no natural key and no idempotency column, so two
  POSTs create two services. A client-chosen id was considered and REFUSED: `services.id` is a
  GLOBAL primary key, so an "insert, else return the existing row" shape would let one tenant
  probe another tenant's ids. Bounded rather than prevented — the duplicate is visible in the
  list read and stoppable by the control shipped here.
* **Nothing bounds how many services an organization may create.** Spend is bounded downstream by
  the org concurrency cap and budget hard-stop that the reconciler's submission passes through,
  not here.
* **No `activity_log` row is written for a control action** — not by this one and not by the JOB-008
  mutations beside it. `jobAuditBridge` still has zero production callers; already on the register
  under DE-01. The audit is structured logger lines with `action: "service.create"` /
  `"service.desired_state"`.
* **No `E10-REALTIME-FOUNDATION` claim is made.** SVC-007's Depends-on names it and its Acceptance
  says control actions are *"reflected through durable event catch-up"*. This unit's view is a
  plain read with no realtime channel, so that half of the Acceptance is **not delivered** and the
  gate is not consumed.
* **E9-F002, E9-F003 and E9-F004 are untouched.** No conjunct of any of them moved.

---

## 8. Files

| File | Change |
|---|---|
| `server/src/services/service-management.ts` | new — the definition boundary, the create, the desired-state control and the operator read |
| `server/src/routes/job-control.ts` | four routes on the existing distributed-execution router, behind its existing `assertOrgAdmin` gate |
| `packages/db/src/repositories/tenant/job-control.ts` | `insertServiceGeneration`, `updateServiceDesiredState`, `findServiceForCompany`, `listServicesForCompany`, `findLiveServiceInstance`, `terminalizeServiceInstanceForCancelledAttempt`, plus `SERVICE_GENERATION_INDEX` and its narrow conflict detector |
| `server/src/__tests__/service-management.test.ts` | new — 18 pure cases |
| `server/src/__tests__/service-management.integration.test.ts` | new — 12 integration cases |
| `server/src/__tests__/job-fence-surface.contract.test.ts` | the six new repository methods CLASSIFIED on the closed method surface — that contract fails closed on any unclassified addition, and it went red on this diff before they were added. One of the six, `terminalizeServiceInstanceForCancelledAttempt`, gets its own paragraph there, because it is a THIRD unguarded entry point onto `writeServiceInstanceStatus` and the four things that stand in for the fence had to be written down. A stale sentence already on that list — *"`recordServiceHealth` stays the sole (and guarded) writer of instance status"*, made false by SVC-003a and invisible to the test because both writers are inner functions — is CORRECTED in the same edit rather than deleted. |
| `docs/replatform/epics/E9-service-agents/findings.md` | E9-F006 filed and resolved |
| `docs/replatform/epics/E9-service-agents/README.md` | SVC-007a's paragraph |
| `scripts/gate-clause-wiring.json` | `E9-4-service-create-and-desired-state`, `wired` |

**No migration.** No schema change was needed: SVC-001 built both tables and granted `aoa_app`
exactly the rights this unit uses (INSERT on `service_generations`; INSERT/UPDATE on `services`).
