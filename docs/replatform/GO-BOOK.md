# GO-BOOK — the re-platform, sprint by sprint

**This is the only document you need to start a session.** Hand it to any session, name a
sprint, and that session runs the sprint end to end. Written 2026-08-25 (Sprint 0), against
branch `docs/replatform-program`, worktree `C:\e3`.

**Read §1 and §2 once. Then jump to your sprint in §4** (Sprints 1-3 have full plans linked in §3.1).

---

## 1. What we are building, and where it actually stands

A founder runs agents — coding, browser, long-running services. Those agents execute in an
isolated place: an **E2B cloud sandbox**, the founder's **own desktop**, or **any device
connected to the account**. Many devices connect to one account; each becomes a *worker*; the
control plane routes each job to a worker allowed to run it.

**The engine is built. It is not connected to the controls.**

The shipped worker daemon starts, reports healthy, and never asks for work. Three wires are
open, by deliberate design:

1. no **sandbox provider** is injected (and the daemon may not construct one — E4-D01),
2. `AOA_WORKER_DISPATCH_ENABLED` is **default-off**,
3. it cannot yet read **its own self-model** (no session is threaded to the read).

Consequence, stated plainly: **no agent has ever run on a distributed worker.** Everything
that works today runs the legacy in-process path. That is why 17 epic gate clauses name a
capability whose production path has **zero callers** — the audit's central finding.

**The good news:** the foundation is real and honest. The wire protocol, tenant isolation
(forced RLS, non-owner role), job control, and the D1 harness are genuinely proven. Every
ticket doc told the truth about what it did and did not do. What over-claimed was the
aggregation — "epic complete" counted tickets shipped, not capability delivered.

### The one-paragraph status

105 plan nodes · 88 with ticket files · 17 backlog. Of ~70 gate clauses: ~19 genuinely
proven, ~17 proven weakly, ~17 not proven, **17 unprovable (no caller)**. `ci-required` is
green-capable again as of Sprint 0. The distance from here to "an agent runs on a real
distributed worker, proven once" is **Sprints 1–5**.

---

## 2. How to run a sprint (read once, applies to every sprint)

### 2.1 Boot

```bash
cd C:\e3
git fetch origin docs/replatform-program && git reset --hard origin/docs/replatform-program
node scripts/check-guard-inventory.mjs && node scripts/check-gate-clause-wiring.mjs
```

One branch, `docs/replatform-program` (PR #323). One worktree, `C:\e3`. **Execution is
strictly sequential — one sprint per session, no parallel sprints.** Parallel *subagents
within* a session are fine and encouraged for research and review; parallel *sprints* are
not, because they share this branch and cancel each other's CI.

### 2.2 The per-ticket process — every ticket, no exceptions

1. **Terrain** — read the code the ticket touches. Verify every claim the plan makes; plans
   go stale. Where a doc and the disk disagree, **trust the disk and say so**.
2. **Design** — write it, **commit it before any code**. That commit SHA is the ticket's
   **Start SHA**. (Sprints 1–3 already have full plans — see §3.1. Sprints 4–9 write theirs at
   sprint start, deliberately, so they are written against the code as it exists then.)
3. **Fail-first TDD** — write the failing test, run it, *see it fail*, then the minimal
   implementation, run it, see it pass. Commit.
4. **Adversarial review** — attack your own work, or dispatch a reviewer subagent. Every
   ticket in this programme that ran this step found a real defect.
5. **Mutation-test every guard** — delete the guard, re-run, confirm the test fails. Rules
   learned the hard way, all three from real incidents:
   - **Positive control FIRST.** Break the function outright; if the suite still passes, it
     does not exercise the function and every later result is meaningless.
   - **DELETE a guard; never rewrite it into an equivalent.** `return false && false` *is*
     `return false` — that mutation measured nothing and nearly produced ten phantom gaps.
   - **Print whether your anchor matched.** CRLF and indentation mismatches produced three
     confident wrong verdicts in one day.
   - A surviving mutant is a **question**, not a verdict. Prove equivalence by deleting both
     the guard and its backstop and showing the suite then fails.
6. **Result doc** — `<TICKET>-result.md`: what landed, what did not, what you got wrong.
7. **Push, watch CI to green.** Not "pushed" — **green**.

### 2.3 The traps this repo has actually hit

- **A check that nothing runs is not a check.** Four blockers reached the top of the critical
  path unscheduled; three were already written down. Noticing is not scheduling.
- **A refusal suite with no positive control** cannot tell "correctly refused" from "never
  got there". Finding E1-F008: five security guards were deletable with their own named tests
  still passing, because one helper line discarded a fixture field and every test refused at
  an earlier check than the one it was named for.
- **A comment naming a symbol is not a call site.** Strip comments before concluding. One
  comment that read "this function has zero callers" was itself counted as a caller.
- **Counting nodes is not counting capability.** That is the whole reason for
  `check-gate-clause-wiring.mjs`.

### 2.4 If you find something mid-sprint

**Do not silently absorb it, and do not let it derail the sprint.**

1. **File it as a finding** in the epic's `findings.md` with `**Status:** open` and a severity.
2. **Declare it** in `scripts/finding-ownership.json` — `owned` (naming a ticket that exists),
   `unowned` (with a reason saying what it blocks), or `accepted` (LOW only; a HIGH/CRITICAL
   may never be quietly accepted). **CI fails if you skip this**, which is the point.
3. **In scope?** If it is inside the ticket's own outcome sentence, fix it now. If not, the
   finding is the deliverable — carry on.
4. **If it invalidates the sprint's premise, STOP and say so.** That has happened: DAT-008
   slice 6 turned out to be already delivered, and slice 7 had nothing to attach to. Both were
   caught by checking before building. Checking first is cheaper every time.

### 2.5 Definition of done, per sprint

- Every ticket has a design (committed as Start SHA) **and** a result doc.
- Every new guard is mutation-proven with a positive control.
- `check-gate-clause-wiring.mjs` reflects reality — a clause you wired is promoted to
  `wired`; one you did not is `unwired` **with a reason**.
- CI is **green**, not merely pushed.

---

## 3. The sequence at a glance

```
  SPINE — dormant to provably working
  S1  WRK-010   worker stays logged in         (E4)   ── unblocks everything
  S2  DEP-010   provider seam + composition    (E6/E4)
  S3  WRK-008/2b dispatch goes LIVE            (E4)   ── first real job
  S4  DAT-008/5,7 credentials reach the sandbox (E5)
  S5  CLI-006/D2  prove ONE real journey       (E7)   ── "it works" becomes TRUE

  BREADTH — scale it out
  S6  MIG-005/6/7 ACTIVE, MIG-001              (E10)
  S7  BRW-004/5/6 (+007/008)                   (E8)
  S8  SVC-002..007                             (E9)
  S9  REL-001/002/003/005 + re-open E0         (E11/E0)
```

**Sprints 1–5 are the critical path.** After Sprint 5 you have a demonstrably working
distributed agent. Sprints 6–9 scale it to every sink and agent type, then release.

---

## ★ 3.1 Sprint 1-3 have FULL implementation plans; 4-9 do not, deliberately

| Sprint | Plan | State |
|---|---|---|
| 1 | [`WRK-010-design.md`](./epics/E4-worker-daemon/tickets/WRK-010-design.md) | complete - 12 TDD steps, 10 guards, 30+ mutants, acceptance mapping |
| 2 | [`DEP-010-design.md`](./epics/E6-deployment-test-harness/tickets/DEP-010-design.md) | complete - 12 steps, **Step 0 is a controller STOP** (see below) |
| 3 | [`WRK-008-slice-2b-design.md`](./epics/E4-worker-daemon/tickets/WRK-008-slice-2b-design.md) | complete - 11 steps, ~43 mutants, the D1 question answered |
| 4-9 | scope + sequence only (§4) | **Step 1 of each sprint is: write the plan.** A plan written five sprints early goes stale, which is the exact failure this audit exists to fix. |

### ★ Three things the planning pass found that change what you do

**1. Sprint 2 opens with a decision only you can make.** `worker-keystore` is pinned by
`scripts/lib/worker-keystore-boundary.mjs` to exactly two dependencies, and the file says adding
anything is **"a STOP for controller approval"** - because that package is injected INTO the
daemon's process and holds the device private key. DEP-010 needs to add the provider package,
which transitively pulls the `e2b` network SDK into that process. The plan asks for it explicitly
and pays for it: a new `PROVIDER_HOST_PATH` confinement means only ONE file may name the provider,
so the guard ends up **tighter**, not just wider. **If you refuse, the plan has a costed
alternative** (a new `worker-desktop-host` package) - it is larger, and §3.4 says why.

**2. `IdentityLifecycle.acquireSession()` does not exist.** DSK-001's design says it "is landed
as the seam the renewal successor implements" and the blocker doc repeats it. `grep` returns only
those two documents. The real seam is `SessionStoreDeps.renew`. WRK-010 targets the real one and
files the discrepancy - the fourth documented fact this programme has found with no code behind it.

**3. Sprint 3 has a FOURTH gate nobody had written down.** The plan expected three (no provider,
flag off, no self-model reader). There is a fourth: **no device key**. `MountedSecretKeyStore` is
constructed nowhere outside tests, and `enrollOnce` deliberately DISCARDS the session (I13) so a
token can never reach a log line. So "thread a session" is not passing a value along - no session
exists after boot, by design. That is why Sprint 3 writes a whole identity/session module.

### One consequence worth reading before Sprint 3

A composed worker still **cannot be OFFERED work**. The only production hello builder is
deliberately unmatchable and `workers.profile_snapshot` has no update channel - so a worker can
assemble a perfect self-model, self-check correctly, and be offered nothing, forever. Sprint 3
files it as a HIGH finding rather than letting "dispatch composed" read as "dispatch working".
**Sprint 5 cannot pass until it is owned.**

---

## 4. The sprints

### Sprint 1 — WRK-010: a worker stays logged in
**Epic E4 · node exists · design: `epics/E4-worker-daemon/tickets/WRK-010-design.md`**

**Why first.** Today the enrollment code lives 10 minutes and a session 15, with **no
renewal route** — so a wired worker goes authority-less at T0+15min and a human re-pastes a
code every ten minutes. That is not shippable, and every later sprint inherits it.

**What.** A device-proof-bound renewal endpoint: the worker presents a signed proof from its
own device key and receives a fresh, still-15-minute-bounded session. No human step. The
long-lived key never leaves the host.

**Gate to start:** none. **Done when:** a worker obtains a session after the code route has
lapsed; revoked/disabled/stale-generation each refuse with the same coarse code; the route is
absent when distributed execution is off.

**Decision to confirm at sprint start:** the server route belongs in E3 (JOB-002's family,
where sessions are minted) or E4 (where the finding lives). *Recommendation: authority in E3,
client in E4.* Not a blocker — pick and record it.

---

### Sprint 2 — DEP-010: the provider seam
**Epic E6/E4 · node exists · design: `epics/E6-deployment-test-harness/tickets/DEP-010-design.md`**

**Why.** No production process can construct a sandbox provider. `E2bSandboxProvider` exists
but is in **no** package's dependency list. Four open findings are one question:
composition root, **E6-F008** (two structurally-distinct provider ports), **E6-F004** (where
the fake imports the port from), **E6-F003** (the networked driver API).

**What.** Name ONE authoritative port; give the **existing** composition root
(`packages/worker-keystore/src/bin/desktop-host.ts`) a dependency path to a real provider.

**Gate to start:** Sprint 1 green. **Done when:** a composition root injects a real provider;
the daemon *still* cannot import one (boundary checker green); **and the shipped default is
proven still inert.**

**Hard constraint:** this sprint does **not** turn dispatch on.

---

### Sprint 3 — WRK-008 slice 2b: dispatch goes live
**Epic E4 · design: `epics/E4-worker-daemon/tickets/WRK-008-slice-2b-design.md`**

**The moment it becomes real.** Compose `createPollLoop` + `createSupervisor` (+ the startup
reconciler and event outbox, or defer them with a stated reason — E4 gate clauses 3 and 4
depend on them).

**Gate to start:** Sprints 1 **and** 2 green. Without WRK-010 a composed worker dies at
T0+15min.

**Largest risk in the whole plan, named:** D1's "worker" is currently a *harness script*, not
the daemon. Turning dispatch on changes what those suites observe. Budget time to re-baseline.

**Done when:** with a provider injected **and** the flag on, a worker leases, executes, and
reports; with either absent it is provably inert; `AOA_WORKER_DISPATCH_ENABLED` remains
default-off. Promote E4-1/2 (and 3/4 if composed) to `wired` in the gate register.

---

### Sprint 4 — DAT-008 slices 5 and 7: credentials reach the sandbox
**Epic E5 · parent design exists; write per-slice designs at sprint start.**

**Why.** The server half is **done** — the handle is minted at placement, advertised in the
lease envelope, and a resolve route is live. The gap is **worker-side only**: `worker-daemon`
has zero runtime references to `secretHandle` and no resolve client.

- **Slice 5** — worker redemption + env synthesis + canary seeding. Note: `redactionCanaries`
  is currently **per-supervisor, not per-run**; slice 5 must make it per-run before it can
  seed anything.
- **Slice 7** — warm-resume re-resolution. **Check first:** the distributed path has no warm
  resume today (no lease pause/resume; `provider.restore` has no production caller). If
  Sprint 3 did not add one, slice 7 still has nothing to attach to — say so rather than
  building against an absent mechanism.

**Gate to start:** Sprint 3 green. **Done when:** a sandbox authenticates to the model
provider using a redeemed handle; a denied redemption fails closed; promote E5-5.

---

### Sprint 5 — prove ONE real journey
**Epic E7 · CLI-006 exists; this runs the D2 lane.**

**The milestone that matters.** Create → schedule → lease → stage → execute → stream →
produce → review → cancel → audit, for one org's coding task, on **real E2B**.

**Gate to start:** Sprint 4 green. Needs the operator's E2B key — the keyed lanes
(`keyed-e2b-conformance.yml`) are **dispatch/sentinel-file triggered** and are *not* part of
`ci-required`. Any claim of real-E2B coverage must cite a dispatched run.

**Done when:** one full journey completes against real E2B with evidence retained. Promote
E7-1. **After this sprint, "distributed execution works" is a true statement.**

---

### Sprint 6 — cut over the execution sinks
**Epic E10 · MIG-005/006/007 ACTIVE (create tickets), MIG-001 (node exists, no file)**

Today MIG-005/6/7 are **shadow observers** — they record a probe beside the legacy call and
change nothing. Cutting over means the sink actually routes to the distributed path.

**One sink at a time, each with its own soak. Do not batch.** Each owes its own rollback
evidence (gate clause 3 was explicitly not ticked for the three shadow sinks). Order:
MIG-005 (Commander, lowest blast radius) → MIG-006 (crew) → MIG-007 (extraction) → MIG-001.

**Also here:** promote the E3 parity bridges (`jobApprovalBridge`, `jobBudgetCostBridge`,
`jobOutputBridge`) — all currently zero-caller — and fix
`createDistributedExecutionDrain`, which calls `assertRollbackSafe(organizationId)` where
every implementation takes a `companyId`.

**Write the terrain + design at sprint start** against the code as it exists then.

---

### Sprint 7 — browser agents
**Epic E8 · BRW-004 (dependency-ready), BRW-005, BRW-006; BRW-007/008 need nodes**

`packages/browser-runtime` has **zero importers** — nothing stages `runner.ts`. Sprint 3
gives it an execution path.

**Also here, and it is a live security item:** E8's gate says *"no host-side browser spawn is
reachable from a boot root."* **That is false today** — `cli-mode.ts:347` spawns
`npx @playwright/mcp --headless` whenever `browser_use` is enabled, reached from
`heartbeat-mcp.ts:165` and `aoa-agents/runner.ts:795`. Either close it or rewrite the clause.

**Write designs at sprint start.**

---

### Sprint 8 — service agents
**Epic E9 · SVC-002 (dependency-ready) through SVC-007**

SVC-001 landed the storage half. The immutable-generation guarantee is currently enforced
only by table grants — **no code writes `service_generations`**, so it describes a property
of an empty table. Long-running services need dispatch (Sprint 3) plus health/restart/drain.

**Write designs at sprint start.**

---

### Sprint 9 — hardening and release
**Epic E11/E0 · REL-001, REL-002, REL-003 (dependency-ready), REL-005**

**Read this before planning:** E0's gate passed on the strength of REL-001/002/003/005 being
*named* as the release test for **30 of 30** Critical/High trust crossings. Four of those five
have never been written, and `check-distributed-execution-foundation.mjs` accepts a non-empty
*string* as proof — it reports PASS and will keep doing so.

**Two jobs:** write the REL tickets, **and** make the foundation checker require the named
release-test ticket to *exist on disk*. That flips E0 from falsely-green to honestly-red
until E11 lands. Same move as the gate-clause guard, one level up.

---

## 5. Known debt, carried deliberately

Not blockers; do not rediscover them.

| Item | State |
|---|---|
| **Security guards with no falsifiable test** | `egress-policy.ts:199` is a **real fail-open** (deleting the fail-closed guard passes the suite — reproduced). Also `worker-session-auth` (22 of 25 guards deletable, unverified on Linux), `worker-device-proof` (Ed448 accepted; garbage `issuedAt` makes the skew window vacuous), `policy.ts` path grammar. **All protect the DORMANT path — fix before Sprint 3, not after.** |
| **dependency-graph regex** | `[A-Z]{3,4}` cannot match `TRACK`, so the checker that stops graph drift is blind to TRACK-001/002. Widening to `{2,5}` was **measured**: it fails the self-test and the checker, because the crosswalk-dominance computation shares the regex. Needs its own ticket. |
| **4 ticket families invisible to the coverage checker** | `GATE-clause-3-rollback`, `DEFERRAL-1-credential`, `E4-D12-live-dispatch`, `CLI-realE2B-hardening` — no 3-digit id, so the checker skips them. Three are the Wave-3/4 blocker artifacts. |
| **TRACK-003 / BRW-007 / BRW-008** | Shipped or scoped with no `#### ID` node. |
| **E2's gate cites a failing revision** | `README.md:6` names `acf2b32fb`, which its own artifact table records as `blocked_external`, superseded by a pass at `9a5455071f8c`. |
| **E6 clause 7** | The DEP-009 shared-admission proof **re-implements** the advisory-lock SQL inline in the test rather than calling `admitAttemptCapacity` — change the production key and the test stays green. |
| **Kill switch has no write path** | `evaluateKillSwitches` is genuinely wired, but throwing it means hand-executed SQL, instance-wide per provider, no Organization or sink dimension. REL-005 scope. |

---

## 6. The registers that keep this honest

Four guards, all in the always-on `policy` job (never code-gated — their trigger *is* a docs
change):

| Guard | Fails when |
|---|---|
| `check-gate-clause-wiring.mjs` | a gate clause claims `wired` and nothing in production calls the symbol |
| `check-finding-ownership.mjs` | an open finding has no owner, or claims a ticket that does not exist / already shipped |
| `check-ticket-graph-coverage.mjs` | a ticket file exists with no `#### ID` node in the plan |
| `check-guard-inventory.mjs` / `check-execution-census.mjs` | a check or test file exists that nothing runs |

**Keep them green by updating them, not by weakening them.** Each was written because the
thing it checks actually went wrong here.

---

## 7. Honest limits of this go-book

- **Sprints 6–9 have scope and sequence, not implementation plans.** Deliberate: they depend
  on what dispatch looks like once live, and a plan written five sprints early goes stale —
  which is the exact failure this audit exists to fix. Step 1 of each is "write the plan".
- **Sprint estimates are shapes, not schedules.** Sprints 1–5 are roughly a session each,
  Sprint 3 possibly two (D1 re-baselining). Sprints 6–9 are multi-session.
- **"Finish till the end" is Sprints 0–9** — many sessions. The milestone worth aiming at is
  **Sprint 5**, after which distributed execution is demonstrably real.
