# M1 — the spine and useful capability: execution plan

> **For agentic workers:** this is a **milestone** plan. It fixes order, ownership, the founder
> decisions and each unit's acceptance. Per-ticket RED/GREEN detail belongs in each ticket's task
> section in its epic implementation plan, which is the repo's contract (`artifact-policy.md`).
> Step 0 writes the missing task sections. Build one ticket at a time with
> superpowers:subagent-driven-development, or superpowers:executing-plans, against that task section.

**Goal:** Pass `M1a` (the spine: the mechanism proven in a shipped CI boot, with spend visible to
budget policy), then `M1b` (useful capability: an agent's output reaches the founder), on exact
frozen candidates, as defined in `epic-regrooming/scope-triage.md`.

**Architecture:** Two tracks run in parallel from one Step 0.
- **Track A** builds what `M1a` requires.
- **Track B** builds the output chain `M1b` requires. It is gated by one founder ruling (`CLI-011`).
- `M1a` is proven first, with its own gate records. `M1b` inherits every `M1a` criterion unchanged
  and adds criterion 4.

**Base:** `docs/replatform-program` at `0c6ad7c13` (M0 candidate; M0 `Decision: pass`, PR #529).
**Status:** APPROVED 2026-09-21 by the founder, with two changes to the recommendations.
- **F10 overruled: M1 is multi-tenant.** "It's not one organization. It's a multi-tenant thing. So we have to make sure that part works for all tenants properly." F10 now reads as below: every campaign runs several tenants and proves per-tenant correctness and cross-tenant isolation.
- **F2 changed: the founder is the owner of everything and delegates every M1 decision to the planning session** ("I am the owner and you can take a decision for all of it"). The planning session records each decision it takes, with its reason, in the E-epic `decisions.md` or here. QA independence still holds (F2).

F1, F3–F6, F8 and F9 are ruled as recommended, including the F4 narrowing and the F8 named-run spend list. **F7 stays open** until the `CLI-011` design review exists. The planning session then takes it under the delegation.

---

## 1. Starting state, measured at `0c6ad7c13`

Seven read-only terrain passes. Every claim marked ✔ was re-read at source by the planning session.
The rest are terrain-measured and are re-verified at each ticket's start.

### 1.1 `M1a` required result set (scope-triage §Exit criteria)

| Row | State at the base | Evidence |
|---|---|---|
| `MIG-009` drain **trigger** | Drain built. Zero production callers ✔. | `job-distributed-drain.ts:114` `createDistributedExecutionDrain`. Only mentions are comments. E10 plan §8.1 task exists: "M", a STOP for controller approval on the trigger split. |
| — the drain's silent-cancel path | A thrown cancel is swallowed ✔. The org still reports `skipped: false`, so a drain can read clean with work running. | `job-distributed-drain.ts` `drainAll` `catch {}` (~:208). §8.1 already owes two RED tests for this. |
| `DAT-007-S3` | Resolver, `/mcp` mount, currency gate and boot RLS precondition all exist. Tests owed. | 5 Tier-3 cases green. Missing: replaced `targetGeneration`, disabled target, wrong company, Tier-3 throw, and a pin that the gate reads `signedRunId` (fixture sets both ids to `run-99`, so a header-id mutant survives). Tier-3 suite `describe.skipIf(win32)` ignores `AOA_RUN_WIN_INTEGRATION`: evidence comes from a Linux `verify` shard. |
| `WRK-013` startup reconciler | `createStartupReconciler` fully built (WRK-007), **zero production callers**. `createStartupSteps(deps.reconciler)` gets nothing. | `E4-F009` owned by WRK-013. `E4-3-survives-restart` `unwired`. Design is two sentences, `Status: scoping`. |
| DEP-011 deploy half | **Daemon consumer is BUILT** ✔ (`worker-networked-host/src/bin/networked-host.ts:41`, Slice 2b-ii). **Deploy ("Slice 5") is not**: no CI builds or boots the adapter-manager. Only `deploy-replatform-campaign.yml` (operator dispatch → Hetzner) does. | `d1-merge-train` compose has no AM service. `checkDispatchDefaultOff` (`staging-manifest-invariants.mjs`) rejects the worker's `AOA_WORKER_PROVIDER_URL`. mTLS on worker→AM not built. **"Shipped CI boot" is defined nowhere** (§2 F3). |
| `E7-1-JOURNEY-ARM` | Task exists (E7 plan, S). Ordered behind the deploy half. | `E7-1-coding-journey` `unwired`. The checker counts references only, so promotion is evidence-judged. |
| Parity bridges (D-8) | `jobBudgetCostBridge` / `jobAuditBridge` / `jobOutputBridge`: **zero production callers** ✔. | `E3-F037` HIGH, **unowned**. `E3-15-budget`, `E3-17-output`, `E3-audit-parity-bridge` all `unwired`. |
| Usage producer (D-8) | `observeRun` omitted from `makeSupervisor({...})` ✔ (`dispatch-runtime.ts:187`). **There is nothing for it to read.** `ExecuteResult` has only `stdoutRef`/`stderrRef` ✔ (`provider.ts:366`), and E2B builds those as placeholders. | The real transport supports `onStdout`/`onStderr`. Nothing uses them. |

### 1.2 `M1b` required result set

All ten open, none with a `-result.md`.
- `CLI-010`: ready now (S).
- `CLI-011`: design review **not started**; the ruling is the long pole.
- `CLI-012`: waits on `DAT-009-3c`/`3d`.
- `CLI-013` → `CLI-014` → `CLI-015`: a serial chain. `CLI-014` needs design first.
- `DAT-009-3c`: needs the supervisor↔runtime connection designed and recorded first (E5 plan :769).
  **The epic `decisions.md` it records into does not exist.**
- `3d` → `3e`: `3e` shares `driver.ts` and `server.ts` with `CLI-012`.
- `CLI-016`: after `DAT-007-S3`.
- The emit build: TO FILE after the ruling.

### 1.3 Gates and process

- **EVID-04** (`test-gates.md:38`) permits only `epics/<epic>/qa/`. No guard change is needed.
  `EVIDENCE_RECORD_RE` already accepts `(?:epics|milestones)` ✔
  (`check-evidence-immutability.mjs:97-98`).
- **No harness exists for any of the three partial gates.** The D1 train is **two**-worker, has no
  `m1-spine` scope, and keeps evidence only on failure. No real-E2B lane runs in a CI boot.
- **Criterion 7:** `E5-A2-MATRIX` (E5 plan :470, S) was allocated to M0 and **not done**. There is no
  result and no `qa/README.md`. Only `a1` exists, marked "Gate owner TBD".
- **Criterion 5:** `E8-F012` (HIGH, unowned) says the credential taxonomy is not enforced on every
  stage-in path. No live env-absence probe exists for the distributed path.
- **Entry criteria:** no partial-gate, QA, rollback or decision owner is recorded anywhere. There is
  no E0–E2 delta review and no candidate-specific E3–E6 reachability ledgers.
- **M0 follow-ups:** no guard reads `cross-platform-weekly.yml`'s shape (E6-F023's fix is
  unenforced). M5's exit list does not mention lifting the `@main` block.

---

## 2. Founder decisions owed

Ordered by when each is needed. ★ **Ruled 2026-09-21: every recommendation below was accepted, except F2 and F10, which the founder changed (rows rewritten below). F7 stays open.**

| # | Decision | Needed by | Recommendation |
|---|---|---|---|
| **F1** | Amend `EVID-04` to also permit `docs/replatform/milestones/<M>/qa/<date>-<gate>-<scope>-<sha12>-a<n>.md` | Step 0 — **without it no M1 gate record can exist** | Yes, one sentence; no guard change needed |
| **F2** | Name the owners: partial-gate owner, QA owner, rollback owner, decision owner. The decision owner may not also certify the QA record. | Step 0 | ★ **RULED (changed):** the **founder** owns every role and **delegates all M1 decisions to the planning session**, which records each with its reason. **The QA owner stays a distinct review session**: the session that decides may not certify its own QA record, and a decision it takes may not be approved by itself. |
| **F3** | Define **"shipped CI boot"** | Before `DEP-015` | (a) A **dispatch-only** CI job, never on push, bound to a named candidate (F8), on the frozen candidate **builds** the control-plane, worker and adapter-manager images from source and boots them together with a CI-generated control-plane keypair. The journey then runs in that boot, in a keyed lane. **Not** the operator campaign deploy. Boot-only is too weak (the gate asks for a journey). |
| **F4** | `WRK-013`: on the **container** path, a restarted daemon cannot enumerate orphans (its lease capability has lapsed). Is journey item 8 met by the lease probe, outbox recovery **and** the adapter-manager reaper, without a worker-side sandbox teardown? | Before `WRK-013` | Yes for M1, **but this is a real narrowing of the gate's "cleanup/recovery" clause, not a residual**: on the container path no worker-side teardown runs, and orphan reclamation rests on the adapter-manager reaper. Record it as a named narrowing with an owner. |
| **F5** | `WRK-013`: a "live" probe renews the lease, but D2 forbids re-attaching. Keep, lapse, or fence? | Before `WRK-013` | **Fence**: stop renewing and let the control plane's reaper end the attempt. Keeping a supervisor-less sandbox alive is the worst option. |
| **F6** | `MIG-009` trigger grain: a whole-fleet CLI now, kill-switch UI later (REL-005)? | Before `MIG-009` build | CLI now. The audit write is atomic with **each attempt's** cancel. `drainAll` cancels attempt by attempt across Organizations, so one fleet-wide atomic write is not possible. |
| **F7** | **The `CLI-011` output-mechanism ruling**: a fourth mechanism, priced and sized, or "neither is reachable", with a named cause | After the `CLI-011` review; **gates the emit build and `M1b`** | No recommendation until the review exists. It is the M1b long pole. |
| **F8** | **Keyed E2B spend envelope for M1**: authorize these runs, each dispatched only on a named candidate | Rolling | Authorize as a list, not blanket: the `CLI-011` `files.read` probe, `DAT-009-3e` conformance, `CLI-016` +/- controls, `WRK-018` usage acceptance, `E7-1-JOURNEY-ARM`, the `M1a-D2-MECHANISM` campaign and the `M1-D2-CODING` campaign. |
| **F9** | Criterion 5: build the live env-absence probe for the distributed stage-in path (closes the `E8-F012` gap for M1), or narrow the claim | Before the M1a campaign | Build it (`DEP-017`, M). Plus the reviewers' acknowledgement that DE-08 leaves H-06 unmet. "Narrow the claim" is available, but it **weakens criterion 5**. |
| **F10** | Tenancy of the M1 deployment | Campaign freeze | ★ **RULED (founder override): MULTI-TENANT.** M1 is proven for **every tenant it serves**, not for one organization:
- **Topology:** each campaign runs at least **three Organizations**: two enabled through the existing per-Organization rollout policy (`AOA_DISTRIBUTED_EXECUTION_ROLLOUT`, `server/src/config/distributed-execution-rollout-source.ts`), and one **not** enabled, as the control.
- **Per-tenant correctness:** the journey passes **for each enabled tenant**, with that tenant's own audit, `cost_events` and budget attribution.
- **Isolation:** hostile cross-tenant cases in **every** gate profile. A cannot lease, read, cancel or see B's jobs, events, secrets, staged inputs, outputs, cost rows or tool calls. Attempts are denied, not merely empty, and run through the non-owner `aoa_app` pool with RLS, which flag-on already uses (`index.ts` `maybeProvisionDistributedExecutionRoles`).
- **The control tenant** is refused distributed execution and stays on the legacy path.
- **Every deployment-wide switch gets a per-Organization dimension before M1b.** Today `AOA_DISTRIBUTED_TOOL_SURFACE_ENABLED` is `process.env`-wide, so `CLI-016` must key the tool surface on the per-Organization rollout policy too. Otherwise enabling tools for one tenant enables them for all.
- **The spec changes to match:** S0-1 amends scope-triage's entry bullet "enabled only for the named internal Organization" to "enabled only for the named set of Organizations via the per-Organization rollout policy, with isolation proven". |

---

## 3. Step 0 — before any build (one docs/CI PR per item, all parallel)

| Unit | What | Owner | Size |
|---|---|---|---|
| **S0-1** | Record F1–F10 rulings in `scope-triage.md` (a dated "M1 rulings" block). F7 stays open. Also amend scope-triage's entry bullet for F10 (multi-tenant). The S0-3 plan amendments are approved under the founder's delegation (F2), and a distinct reviewer checks them. | planning session | XS |
| **S0-2** | Enact **F1**: the EVID-04 amendment in `test-gates.md` + `artifact-policy.md` §milestone paths. Gate-owner commit. | founder | XS |
| **S0-3** | **File the tickets** (§4 ids): graph nodes in `program-design.md` + task sections in the epic plans + `finding-ownership.json` re-points (`E3-F037` → `JOB-016`; `E4-F009` stays `WRK-013`). Create the missing `epics/E3-*/decisions.md`, `epics/E5-*/decisions.md` and `epics/E7-*/decisions.md` shells. **And rewrite scope-triage's `M1a` required result set with the filed ids**: `MIG-009`, `DAT-007-S3`, `E7-1-JOURNEY-ARM`, `WRK-013`, `WRK-018`, `JOB-016`, `JOB-017`, `DEP-014`, `DEP-015`, `DEP-016`, `DEP-017`, `DEP-018`. Once F7 is ruled, `CLI-017` enters the `M1b` enumeration the same way. The enumeration is the mechanically checkable artefact, so "the parity bridges" and "DEP-011's deploy half" must become ids there, not only here. | planning session | S |
| **S0-4** | **Record corrections** found by the terrain passes, each verified at source first. See the list below. | planning session | S |
| **S0-5** | **M0 follow-ups:** (a) a shape guard for `cross-platform-weekly.yml`. It fails if `continue-on-error` reappears on `verify-cross-platform`, `e2e-cross-platform` or `Install Playwright`. It needs a positive control proving the guard reds on each re-added flag, and joins `policy`. (b) Add "remove the `cross-platform-weekly.yml@main` block" to M5's exit list. | planning session | S |
| **S0-6** | **`E5-A2-MATRIX`**: freeze the seven-clause matrix, commands, topology, QA owner and decision owner (uses F2). | E5 | S |
| **S0-7** | **E0–E2 dependency/delta review** record, plus the skeleton of the candidate-specific E3–E6 reachability ledgers. They are filled at candidate freeze. | distinct reviewer | S |

**S0-4 corrections to make:**
- The E7 plan and GO-BOOK call the daemon consumer "unbuilt".
- `E6-F003` reads "unspecified".
- The `E3-17-output` reason still says "Wire at sink cutover (Sprint 6)"; D-8 made it M1a.
- The E7 plan's `CLI-015` "four findings dispositioned" contradicts D5 and the register.
- The `CLI-015` graph node is missing its `CLI-012` edge.
- `CLI-011`: the graph node's "ruling recorded" and (S) disagree with the plan's "neither choice binding" and "≤3 days".
- The E5 plan calls the resolver-throw case "genuinely absent". It exists at Tier-1.
- The `CLI-016` graph node requires a keyed run; its plan task does not. Also, its Windows verify
  command runs zero tests unless the new test honours `AOA_RUN_WIN_INTEGRATION`.

**Step 0 exit:** every §4 ticket has a graph node and an executable task section, F1 is enacted,
F2 owners are recorded, and all 38 pure-node guards plus evidence-immutability are green.

---

## 4. The tickets

Ids are the next free numeric id per prefix. Verified: real maximums are `JOB-015`, `WRK-017`,
`DEP-013` and `CLI-016`; `WRK-042` is a test fixture. S0-3 re-runs
`check-register-id-uniqueness` + `check-ticket-graph-coverage` before committing.

### ★ The shared seam — build it once, and not the naive way

Three units need the same thing: `JOB-016` pricing, `JOB-017` audit/output, and `CLI-014` output
projection. Each must act on an accepted event **while the fence is still live**. The after-commit
`onAttemptTerminal` hook is too late: ingest has already made the attempt terminal, so
`lockActiveFence` throws and `projectAcceptedOutput` throws `attempt_terminal`. The supervisor emits
`usage` immediately before `terminal`, and the outbox batches, so they usually arrive in one call.

**Measured constraints (adversarial review, re-verified):**
- `acceptEvent` (`packages/db/.../tenant/job-control.ts`) inserts the batch, then loops per event
  and applies the `attempt_terminal` projection. The terminal step is therefore reachable *before*
  it runs, and `serviceProjection` is the existing precedent for in-transaction projection there.
- **Registering the existing bridges would deadlock.** Each opens its own `runInTenant(appDb, …)`, a
  new transaction (`job-budget-cost-bridge.ts:240`, `job-audit-bridge.ts:187`,
  `job-output-bridge.ts:261`), and then takes `lockActiveFence` FOR UPDATE on the attempt the
  outer ingest transaction already holds.
- `packages/db` cannot import server bridges.
- **A throwing projector would roll back the append.** `job-events.ts` forbids that, because the
  worker would then replay the terminal forever. An unknown-rate fail-closed would do exactly this.

**Decision `E3-D-ACC` (engineering; recorded in E3 `decisions.md` as `JOB-016`'s first commit;
reviewer-approved before any build).** It must fix four things:
- **(a) Tx-taking cores.** Each bridge gains a core that takes the caller's `tx`/`repos` and never
  opens its own transaction. Today's `runInTenant` entry points stay as thin wrappers.
- **(b) Where the seam lives.** Choose, with the reason recorded, between two options:
  - **(b1)** a projector callback passed through `AcceptEventInput`, on the `serviceProjection`
    precedent; or
  - **(b2)** `job-events.ts` splitting the batch into two `acceptEvent` calls: events before the
    terminal event first (fence live, projectors run in that transaction), then the terminal.
- **(c) Failure semantics.** A projector failure never rolls back the append. It writes a `pending`
  or `failed` receipt that a detector surfaces, and it is tested.
- **(d) A same-transaction test.** Cancel-then-terminal, and usage-then-terminal, in one batch do
  not trip `guardActiveFence`. A replay re-runs nothing (idempotency comes from the receipt tables).

`JOB-016` builds the seam. `JOB-017` and `CLI-014` register onto it.

### Track A — `M1a`

| Id | Ticket | Epic | Depends on | Size | Keyed? |
|---|---|---|---|---|---|
| `DAT-007-S3` | Real-PG run-currency proof: 4 deny cases + Tier-3 throw + `signedRunId` pin; evidence from the Linux shard with a non-zero executed count | E5 | — | S–M | no |
| `MIG-009` (§8.1) | Drain CLI trigger + atomic actor-attributed audit + the two silent-cancel RED tests; `E10-1-drain` → `wired`; new `MIG-009-wiring-result.md` | E10 | F6 | M | no |
| `WRK-013` | Durable lease-candidate store (written on ACK, pruned on end). Compose the reconciler **before** the poll loop. Named reason on empty. Positive control: removing the store reds. | E4 | F4, F5 | M | no |
| **`WRK-018`** *(new)* | **Usage producer.** An optional stdout/usage stream channel on the provider port, through E2B (`onStdout`) **and** provider-wire, redacted by the per-run canaries (H-04, zero tolerance). Parse `claude_local` usage. Compose `observeRun`. Flip the pinning test. | E4 | — | L | acceptance: 1 run |
| **`JOB-016`** *(new)* | **Price at ingest.** Build the `E3-D-ACC` seam. Register `priceAcceptedUsage` onto it. Compose `jobBudgetCostBridge` default-off. Owns `E3-F037`. Closes it **only** with `WRK-018` merged. Acceptance: (1) one handed-off run produces exactly one `cost_events` row **with cost > 0**, plus one `authoritative_cost` receipt; (2) a replay produces `replayed`; (3) after a hard-stop breach, **the next dispatch is refused or paused** — usage arrives just before `terminal`, so cancelling the breaching attempt proves nothing; (4) **an attempt that goes terminal with no `usage` event emits a classified signal**, tested — the producer is best-effort, so without this a parse miss silently reproduces `E3-F037`. | E3 | `WRK-018` (for closure only) | M–L | via campaign |
| **`JOB-017`** *(new)* | **Audit + output bridges** on the seam. `recordAcceptedActivity` for a named set of accepted mutations. Decision recorded: `projectTerminalWinner` is **retired**, because the canary/crew projections already complete the attempt and write the summary, or it is reworked. `E3-17-output` / `E3-audit-parity-bridge` → `wired`. | E3 | `JOB-016` (seam) | M | no |
| **`DEP-014`** *(new)* | The adapter-manager image in `docker/images/build.sh` (digest, SBOM, admission), pushed by CI; the D1 train builds it | E6 | — | M | no |
| **`DEP-015`** *(new)* | **The shipped CI boot lane** per F3: CI-generated CP keypair, worker provider-URL overlay, and a `checkDispatchDefaultOff` amendment **scoped to that overlay only**. The job runs the journey. | E6 | `DEP-014`, F3 | M | yes |
| `E7-1-JOURNEY-ARM` | Promote `E7-1-coding-journey` on a `DEP-015` run + `pnpm verify:e7-1-distributed-run`; `capabilityProven=false` passes | E7 | `DEP-015` | S | 1 run |
| **`DEP-016`** *(new)* | **`m1-spine` campaign profile**: a one-worker topology on the D1 compose, evidence retained **on pass**, audit/cost assertions. The reference provider emits **canned usage**, and the profile asserts exactly one `cost_events` row with cost > 0. A positive control (usage suppressed) must red. Without it, the spine prices nothing and still passes. | E6 | `JOB-016`, `JOB-017` | M | no |
| **`DEP-017`** *(new)* | **Live env-absence probe** on the distributed stage-in path (criterion 5). **Positive control:** a planted canary credential must turn the probe red. | E6 | F9 | M | via campaign |
| **`DEP-018`** *(new)* | **Campaign fault matrix + injection harness**, per gate profile, with declared cases and expected classifications. `M1-D1-SPINE`: the journey's fault controls (Toxiproxy), restart/reconciliation (`WRK-013`), cancellation. `M1a-D2-MECHANISM`: cancellation, provider failure, reconciliation, every cleanup path. `M1-D2-CODING`: plus credential cases. **Every profile also carries the F10 tenant matrix**: per-tenant journey correctness for each enabled tenant, cross-tenant denial (lease, read, cancel, events, secrets, staged inputs, outputs, cost rows, tool calls), and refusal of the control tenant. Every case needs a run showing its injection fired, and each tenant denial needs a positive control, a same-tenant request that succeeds. | E6 | `DEP-016`, `DEP-015`, `WRK-013` | M | via campaigns |

### Track B — `M1b` (starts in parallel with Track A)

| Id | Ticket | Depends on | Size | Keyed? |
|---|---|---|---|---|
| `CLI-010` | Metadata-only enumeration seam test + fence the byte-reading helper | — | S | no |
| `CLI-011` | **Design review → F7.** Writer census (§9.1). The `files.read` probe (§9.2, keyed). §6-constraint table. Positive-control table. Adversarial pass. Pins moved. **Must price the `WRK-018` stdout channel as input**, since it makes the "captured transcript" option cheaper. | — | M | probe |
| `DAT-009-3c` | Design the supervisor↔runtime connection + E5-D07 (record first), then the hook | — | M | no |
| `DAT-009-3d` | Compose the sequencer; `E5-2` → `wired` | `3c` | S | no |
| `DAT-009-3e` | Relay digest/export over the wire; fix E5-F002 headers; conformance run | `3c` | M | yes |
| `CLI-012` | Producer + the enumeration op across port → E2B → driver → adapter-manager (gated owned op) | `CLI-010`, `3c`, `3d` | L | acceptance needs the emit build |
| `CLI-013` | Emit `artifactPrepared` + the contiguity decision | `CLI-012` | S | no |
| `CLI-014` | Output projection **registered on `E3-D-ACC`** (not a second seam) + `job_artifacts` → `artifacts` | `CLI-013`, `JOB-016` seam | M–L | no |
| `CLI-017` *(filed after F7)* | The emit build | F7 | ? | yes |
| `CLI-015` | The judge counts what F7 ruled | F7, `CLI-017`, `CLI-012` | M | no |
| `CLI-016` | Arm the tool surface (spec reconciled in S0-4), **per Organization** (F10): key the tool surface on the per-Organization rollout policy instead of the deployment-wide `AOA_DISTRIBUTED_TOOL_SURFACE_ENABLED`. A tenant not enabled for tools must be denied even when another tenant is enabled. | `DAT-007-S3` complete | M–L | yes |

**Merge-order constraint:** `DAT-009-3e` and `CLI-012` both edit `provider-wire/src/driver.ts` and
`adapter-manager/src/server.ts`. `3e` merges first, then `CLI-012` rebases.

---

## 5. Order and critical paths

```
Step 0 (S0-1..S0-7, parallel) ──┬─ Track A ──────────────────────────────────────────────┐
                                │  DAT-007-S3 · MIG-009 · WRK-013          (independent) │
                                │  JOB-016(seam) ──► JOB-017 ──► DEP-016 ──► DEP-018     │
                                │  WRK-018 ··► (closes E3-F037 with JOB-016)            │
                                │  DEP-014 ──► DEP-015 ──► E7-1-JOURNEY-ARM              │
                                │  DEP-017                                               ├─► M1a campaign
                                │                                                        │
                                └─ Track B ──────────────────────────────────────────────┤   (freeze → spine +
                                   CLI-010 · DAT-007-S3 ──► CLI-016                      │    mechanism records,
                                   DAT-009-3c ──► 3d ──► CLI-012 ──► CLI-013 ──► CLI-014 │    rollback rehearsal,
                                              └► 3e (merges before CLI-012)              │    E5 a2, handoff)
                                   CLI-011 review ──► F7 ──► CLI-017 ──► CLI-015         └─► M1b campaign
                                                                                             (fresh spine +
                                                                                              mechanism + coding,
                                                                                              E5 a3, handoff)
```

- **M1a critical path:** the `JOB-016` seam → `JOB-017` → `DEP-016` → `DEP-018` → campaign, with
  `WRK-018` (L) in parallel. `WRK-018` gates only `E3-F037`'s closure, not the seam, but it must
  merge before the campaign. `DEP-015` runs alongside, gated by F3.
- **M1b critical path:** the `CLI-011` review → **F7** → `CLI-017` → `CLI-015`. Everything else in
  Track B finishes before F7 can be ruled.

---

## 6. The campaigns

**`M1a` campaign.**
1. Freeze the candidate: revision, topology, config digests and owners. The config digest must assert:
   - `AOA_DISTRIBUTED_TOOL_SURFACE_ENABLED` is **off**, and output is not required (the `M1a` tools + output exemption);
   - **no excluded flag is enabled** (workload, desktop, mobility, cutover, HA, beta);
   - **the tenant set (F10)**: the enabled Organizations and the control Organization, read from the rollout policy digest, and asserted unchanged at campaign start and end.
   - **`AOA_DISTRIBUTED_CREW_ROLLOUT_ENABLED` is off** (unset, or a false value). ★ *Added at M1 Step 0 (S0-8), a planning-session decision under founder delegation (F2), verified at source:* it is the deployment-wide crew switch (`DISTRIBUTED_CREW_ROLLOUT_ENABLED_ENV`, read by `readDistributedCrewRolloutFlag` in `server/src/config/distributed-execution.ts`, called from `process.env` in `runAoaAgent`, `server/src/services/internal-agent/aoa-agents/runner.ts`). It has **no per-Organization dimension**: when on, every Organization whose rollout state is `canary` transfers its crew runs (`crew-distributed-gate.ts`), so it would arm crew for every enabled tenant at once. Crew distributed execution is not in the M1 claim, so the digest asserts it off, and the same assertion is made in the `DEP-015` and `DEP-016` boots.
2. Then, on that exact candidate:
   - a `M1-D1-SPINE` record (`DEP-016` profile **as made worker-driven by `DEP-019`**), including the
     **rollback rehearsal via the `MIG-009` CLI**, attributed to the rollback owner (criterion 6).
     ★ *Amended 2026-09-23 under founder delegation F2, after the distinct reviewer of `DEP-016`
     measured that the gate's worker clause — the included lifecycle on "one separately deployed
     worker" — is NOT satisfiable from `DEP-016` alone: its profile has a deployed worker service,
     but the journey is harness-driven (`DEP-016-result.md` §5.3). The record may not be produced
     from a harness-driven run.* (Superseded text: `a M1-D1-SPINE record (DEP-016 profile), including
     the **rollback rehearsal via the MIG-009 CLI**, attributed to the rollback owner (criterion 6);`)
   - a `M1a-D2-MECHANISM` record (the `DEP-015` lane, keyed), recording audit, cost and failure
     classification, with `capabilityProven=false` acceptable;
   - criterion 5 observed via `DEP-017`;
   - the E5 audit `a2`;
   - zero open milestone-blocking findings.
3. Then the non-promoting handoff under `milestones/M1a/handoffs/`.

**`M1b` campaign.** A new candidate. Fresh `M1-D1-SPINE` + `M1a-D2-MECHANISM` +
`M1-D2-CODING` records (the last one **fails** on `capabilityProven=false`). Also criterion 5
observed again via `DEP-017`, criterion 6 (zero blocking findings **and** a fresh rollback
rehearsal on this candidate), E5 audit `a3`, and a handoff. The freeze checklist is the `M1a` one,
minus the tools + output exemption.

---

## 7. Rules carried from M0

- **Guards:** run all 38 pure-node `pr.yml` guards plus `check-evidence-immutability --base
  origin/docs/replatform-program` before every push. `ci-local.mjs` green is not CI green.
- **Verify at source:** cite code by symbol, and cite CI jobs, not runs.
- **Positive controls:** every new guard or reconciler needs one. A check that evaluates nothing is
  not a check.
- **Review protocol:** only a distinct reviewer sets a ticket `complete`. Merge with `--merge` when
  a reviewed revision must stay an ancestor.
- **Keyed E2B runs** are dispatched only inside the F8 envelope, on a named candidate.
- **LF only.** No secrets in `docs/replatform/`.

## 8. Not in scope

- mTLS on the worker→AM hop (`DEP-011` Slice 5 remainder). It is recorded as a named residual.
- The worker-side sandbox pass on the container path (the F4 narrowing).
- The codex adapter (`E7-F027`, `claude_local` only).
- Unit E / `workspace_patch` artifacts.
- The M2 sink cutover.

## 9. What would prove this plan wrong

- `WRK-018` finds that `claude_local` emits no parseable usage in `--print` mode. That breaks
  `JOB-016`'s closure and `E3-F037` stays open, so M1a is blocked. **Check this first**, with one
  local transcript before the L estimate stands.
- `E3-D-ACC` (b1) and (b2) both prove infeasible without the tx-taking bridge refactor touching the
  budget-check path's own transaction assumptions. `JOB-016` then grows, and `JOB-017` and
  `CLI-014` wait.
- F3 is ruled "campaign deploy counts". `DEP-015` shrinks, but the programme's "manual staging run
  ≠ shipped CI boot" distinction is gone.
- F7 rules "neither is reachable". `M1b` then cannot pass as defined, and that is an honest outcome
  the milestone must record rather than reinterpret.

## 10. Review record

- **2026-09-21, adversarial plan review (distinct agent, read-only).**
  - Checked 12 code claims at source: 11 held. One was false: the E3 `decisions.md` did not exist,
    so S0-3 now creates it.
  - **Blockers applied.**
    - **B1:** the naive seam would deadlock, because each bridge opens its own transaction and
      re-locks the fence. A throwing projector would also roll back the append. `E3-D-ACC` was
      rewritten with tx-taking cores, a seam location, failure semantics and a same-transaction test.
    - **B2:** no unit owned fault injection. Added `DEP-018`.
  - **Majors applied.**
    - Canned usage plus a positive control in the spine (`DEP-016`).
    - The hard-stop acceptance is now "the next dispatch is refused".
    - A terminal-without-usage signal (`JOB-016`).
    - `M1b` states criteria 5 and 6 explicitly.
    - The `M1a` freeze asserts the tools flag is off and no excluded flags are on.
    - A planted-canary positive control for `DEP-017`.
  - **Weakened bars now stated as such:** F4 and F9. (F10 was listed here too, but the founder then overruled it to multi-tenant, which **raises** the bar.)
  - **Minors applied:** the diagram edge and critical path, `CLI-017` into the `M1b` enumeration,
    per-attempt audit atomicity (F6), `DEP-015` dispatch-only, and owner approval in S0-1.
- **2026-09-21, founder ruling.** "Accept all", with two changes: **F10 → multi-tenant** (a stronger bar: at least three Organizations per campaign, per-tenant correctness, cross-tenant denial in every gate profile, and a per-Organization tool surface in `CLI-016`), and **F2 → founder owns everything and delegates every M1 decision to the planning session**, with QA independence kept.
