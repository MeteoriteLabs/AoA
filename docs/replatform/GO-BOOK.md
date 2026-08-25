# GO-BOOK — the re-platform, sprint by sprint

**This is the only document you need to start a session.** Hand it to any session, name a
sprint, and that session runs the sprint end to end. Written 2026-08-25 (Sprint 0), against
branch `docs/replatform-program`, worktree `C:\e3`.

**Read §1 and §2 once. Then jump to your sprint in §4** (Sprints 1-3 have full plans linked in §3.1).

> **★ In a hurry? Go straight to §9.** It holds a **copy-paste prompt per sprint** — self-contained,
> and each one ends by updating this document and the registers, so the next session starts from
> what is true rather than from what was true when its plan was written.
>
> **Before Sprint 1, read §2.0.** The branch's required check cannot currently pass, and it is not
> the Sprint-0 work.

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

### ★ 2.0 READ THIS BEFORE SPRINT 1 — `verify` cannot currently go green on this branch

**A sprint is not done until CI is green, and right now CI cannot be green.** The `verify` job
has hit its `timeout-minutes: 60` cap on **five consecutive runs**, and `ci-required` correctly
fails as a result (`verify=cancelled (required for code changes)`).

| Run | SHA | `verify` wall clock | Outcome |
|---|---|---|---|
| 32727172193 | `259dba6c4` | 48m | **failure** (a real test failure, not a timeout) |
| 32751635948 | `5fbd3b3fb` | 65m00s | cancelled at the cap |
| 32753452892 | `30861d0be` | 65m00s | cancelled at the cap |
| 32769954082 | `e33f33efa` | 65m01s | cancelled at the cap |
| 32775229849 | `43acb1a91` | 65m01s | cancelled at the cap |
| 32780086655 | `5314e62a3` | 64m59s | cancelled at the cap |

**It predates the Sprint-0 work.** The first two timeouts are on SHAs pushed hours before any
Sprint-0 commit existed, and on `5314e62a3` **every other job is green** — `policy`,
`brand-check`, `lint`, `e2e`, `e2e-pgvector`, `migrations`, `distributed-contract`, `browser`,
`changes`, and both `worker-protocol-contract-bytes` lanes.

**What is known and what is not.** The job's own comment budgets ~37 min of tests plus ~8 min of
build and calls 60 "durable headroom" — so this is a regression against a measured baseline, not
drift. Beyond that, do not trust the logs without re-measuring: the two timed-out logs stop at
very different points (one after ~3.5 min of the test step, one after ~49 min), which is more
consistent with **log truncation** than with a single hang, and I did not resolve which. Five
identical 60-minute stops is deterministic; **stop re-running it and bisect.**

**Suspect window:** the last `verify` that produced a full run is before ~12:30 on 2026-08-24;
the first cap-out is ~16:41. Both lanes pushed heavily in between. `git log --since` over that
window is the bisect range.

**Consequence for the sequence:** Sprint 1's "Gate to start: none" is true of its *code*, and
false of its *definition of done*. Either fix `verify` first, or accept that Sprints 1-3 land
with the required check red and say so out loud in each result doc. **Do not raise
`timeout-minutes` to make it green** — that converts a regression into a permanently slower gate
and hides whatever caused it.

---

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
  S1   WRK-010/1  renewal ROUTE (server only)   (E4)   ── no callers yet
  S2   DEP-010    provider seam + composition   (E6/E4)
  S2.5 WRK-010/2  the route gets its CALLER     (E4)   ── or S1 was for nothing
  S2.75 WRK-011   a worker can be OFFERED work  (E4)   ── closes E4-F010
  S3   WRK-008/2b dispatch COMPOSED (not live)  (E4)   ── composes on a worker S2.75 made matchable
  S4  DAT-008/5,7 credentials reach the sandbox (E5)
  S5  CLI-006/D2  prove ONE real journey       (E7)   ── needs S2.75 SHIPPED, not just owned

  BREADTH — scale it out
  S6  MIG-005/6/7 ACTIVE, MIG-001              (E10)
  S7  BRW-004/5/6 (+007/008)                   (E8)
  S8  SVC-002..007                             (E9)
  S9  REL-001/002/003/005 + re-open E0         (E11/E0)
```

**Sprints 1–5 are the critical path.** After Sprint 5 you have a demonstrably working
distributed agent. **Sprint 2.5 was added after the plans were reviewed as a set** — see §4; it is
the sprint that stops Sprint 1 from shipping a route nothing calls. **Sprint 2.75 was added when
E4-F010 was traced to an actual fix** and that fix was written up as WRK-011 — it is the sprint that
makes an offer *possible at all*, and without it Sprints 3 and 4 both execute against a fleet that
provably cannot be offered work. Sprints 6–9 scale it to every sink and agent type, then release.

---

## ★ 3.1 Sprint 1-3 have FULL implementation plans; 4-9 do not, deliberately

| Sprint | Plan | State |
|---|---|---|
| 1 | [`WRK-010-design.md`](./epics/E4-worker-daemon/tickets/WRK-010-design.md) + [`WRK-010-result.md`](./epics/E4-worker-daemon/tickets/WRK-010-result.md) | **★ SHIPPED (slice 1), `c1c5530f5`.** Renewal ROUTE lands server-side with **ZERO callers on purpose**; **8 mutants / 8 killed / 0 survivors / 0 equivalents**; a 4-reviewer adversarial pass found **0 HIGH/BLOCKING** and 3 LOW (all fixed). **E4-F007 stays `open`** (§0e — closes at Sprint 2.5) and its manifest key is untouched; a new LOW **E4-F014** (DSK-001's phantom `IdentityLifecycle.acquireSession()`) is filed `unowned`. Local review needs `AOA_RUN_WIN_INTEGRATION=1` (six of nine clauses are embedded-PG-only). `verify` inherits the pre-Sprint-1 red (§2.0). |
| 2 | [`DEP-010-design.md`](./epics/E6-deployment-test-harness/tickets/DEP-010-design.md) + [`DEP-010-result.md`](./epics/E6-deployment-test-harness/tickets/DEP-010-result.md) | **★ SHIPPED, `176eb5f8e … 6b2c27fb9`.** 12 fail-first steps, every guard mutation-proven by DELETION; **D-3's three conditions verified in what shipped**; the shipped desktop default constructs **NO provider** (proven by guard, not merely flag-off); even provider+flag composes no loop (§4.1 structural lock, **which expires at Sprint 3** — §4.2, Sprint 3 REPLACES not inherits). **E4-F011 (HIGH) resolved** + key deleted; **E6-F003 repointed** to new successor **DEP-011** (E4-F013); **E6-F008/F004 resolved**. A **5-reviewer adversarial pass found 0 HIGH/BLOCKING** (2 LOW comment fixes applied). `verify` inherits the pre-Sprint-2 red (§2.0). |
| 3 | [`WRK-008-slice-2b-design.md`](./epics/E4-worker-daemon/tickets/WRK-008-slice-2b-design.md) | complete, **revised after TWO adversarial review rounds** - 11 steps, 53 mutants, a **§0.1 pre-DEP-010 preamble**, the D1 question answered, and the gate story corrected to **per boot root** (container 4, desktop **3** — round 2 caught the plan counting two under a table that said three) |
| 2.5 | none — WRK-010 §9 scopes it | **write at sprint start.** Small, but it is the sprint that gives Sprint 1 a caller. Two known requirements are already written down in §4. |
| 2.75 | [`WRK-011-design.md`](./epics/E4-worker-daemon/tickets/WRK-011-design.md) | **complete plan, written 2026-08-25.** 10 fail-first steps (Step 0 is a POSITIVE CONTROL, on the E1-F008 precedent), **18 mutants, every one a DELETION, ZERO declared equivalents**, and an acceptance table with a per-clause **tier** column that names the two clauses it deliberately does NOT write. Owns **E4-F010**. ★ Its §0 corrects three of that finding's claims against the code and adds a **third blocker the finding never named** — the enrolled all-zero capacity — which fires *earlier* than either half it does. ★ Its §5.2 carries ONE open question for the §8 ledger (per-target vs per-worker activation): take it **before Step 1**, not during Step 7 — option (b) makes this L into XL |
| 4-9 | scope + sequence only (§4) | **Step 1 of each sprint is: write the plan.** A plan written five sprints early goes stale, which is the exact failure this audit exists to fix. |

### ★ Three things the planning pass found that change what you do

**1. Sprint 2 widens the keystore boundary — APPROVED, see §8 D-3.** `worker-keystore` is pinned by
`scripts/lib/worker-keystore-boundary.mjs` to exactly two dependencies, and the file says adding
anything is **"a STOP for controller approval"** - because that package is injected INTO the
daemon's process and holds the device private key. DEP-010 needs to add the provider package,
which transitively pulls the `e2b` network SDK into that process. The plan asks for it explicitly
and pays for it: a new `PROVIDER_HOST_PATH` confinement means only ONE file may name the provider,
so the guard ends up **tighter**, not just wider. The approval rests on that confinement plus a
provider-less shipped desktop default — **not** on the staging-manifest mitigation the plan
originally cited, which turned out to be a build that refuses to run. The costed alternative (a
new `worker-desktop-host` package) is recorded in the plan's §3.4 and is not being taken.

**2. `IdentityLifecycle.acquireSession()` does not exist.** DSK-001's design says it "is landed
as the seam the renewal successor implements" and the blocker doc repeats it. `grep` returns only
those two documents. The real seam is `SessionStoreDeps.renew`. WRK-010 targets the real one and
files the discrepancy - the fourth documented fact this programme has found with no code behind it.

**3. Sprint 3 has SIX gates, not three - and they are not the same six on both shipped roots.**
The plan expected three (no provider, flag off, no self-model reader). Reading the code found six:
`no_provider`, `dispatch_disabled`, `no_worker_identity`, `no_event_outbox_path`, `no_session`,
`no_self_model`. Two consequences, and the second is the one that changes what Sprint 2 does.

*Consequence A - why Sprint 3 writes a whole identity/session module.* `MountedSecretKeyStore` is
constructed nowhere outside tests, and `enrollOnce` deliberately DISCARDS the session (I13) so a
token can never reach a log line. So "thread a session" is not passing a value along - after boot,
by design, no session exists to thread.

*Consequence B - the review found the four-gate claim FALSE on the second boot root, and nobody had
noticed there were two.* `packages/worker-keystore/src/bin/desktop-host.ts` builds both OS-custody
stores and passes them **unconditionally** on every non-control boot (`:114-125`, `:254-260`), and
`resolveCustody` makes `mounted_secret`-plus-a-store a fatal exit. So **any desktop that boots at
all runs `os_keychain` with custody present** - gate 3 is already satisfied there, and gate 5 is
reachable within ten minutes of a code. **The container stands on four gates; the desktop stands on
three of the four that somebody has to LAND: gate 1, the flag, and the event-outbox path.**

> **★ Read that count precisely — it is a subset, not the whole list.** Slice 2b's §2 table has
> **six** rows. Four are things somebody lands (a provider, the flag, custody + enrolment, the
> outbox path); the other two are runtime state — a live session, and an admin-set placement
> profile — and they gate dispatch just as hard. So the container has six outstanding conditions
> and the desktop five; "four and three" counts only the landable subset. Two review rounds put a
> number under that table that did not match it (first two, then three); an independent review
> caught that the table itself says six. The lesson is the same every time: **an aggregate sentence
> that contradicts the detail directly above it.**

That is why §4 Sprint 2's acceptance clause is written the way it is:
the day DEP-010 puts a provider in that composition root, every installed desktop running the build
is two env vars from taking real leases. Filed as **E4-F011**, owned by DEP-010.

*(Round 2 corrected this count from two gates to three: the slice's own table marked the desktop as
gated on the event-outbox path and the sentence underneath still said two. Both the plan and the
register entry said two; the table was right. The substance is unchanged — one of the container's
four gates is already satisfied on the desktop.)*

### One consequence worth reading before Sprint 3 — ★ SUPERSEDED by Sprint 2.75, kept as the record

**Kept, not deleted:** this is the record of how the gap was found, and the sequence below only makes
sense with it. What is superseded is the *ownership* claim in its last paragraph, not the diagnosis.

A composed worker still **cannot be OFFERED work**, and would refuse the offer if it were. The
only production hello builder is deliberately unmatchable (`poll-loop.ts:538` self-checks against
the worker's OWN hello, which carries a 64-zero `policyHash`) **and** `workers.profile_snapshot`
has no update channel a running daemon can reach. Either half alone is sufficient: a worker can
assemble a perfect self-model, self-check correctly, and dispatch nothing, forever.

> **★ Two corrections, from WRK-011 §0, where this text and the code disagreed — the code wins.**
> (1) The shipped hello emits **no capabilities at all**, not `sandbox.*`: `desktop-hello.ts:144`
> takes `capabilitiesForIsolation(isolation ?? "none")`, which is `[]`, and the only production call
> site passes no isolation. That makes the conclusion *stronger* — the ceiling ∩ reported
> intersection is empty for **any** ceiling. (2) `profile_snapshot` does have one update channel —
> enrolment **rotation** — but a daemon can never travel it twice, so the fix has to be a new
> channel rather than a way to reach the old one. WRK-011 also found a **third** blocker neither
> half names and that fires *first*: the enrolled all-zero capacity is a hard `Math.min` ceiling on
> the polled capacity (`job-leasing.ts:566`), so the admissible workload list is empty and zero
> lease candidates come back before the matcher this section is about is ever reached.

This is **E4-F010** in `epics/E4-worker-daemon/findings.md`, filed into the register at planning time
and carried as `unowned` for exactly as long as that was true — no ticket in the graph fixed either
half, and attaching it to Sprint 3 would have been the false claim of ownership
`check-finding-ownership.mjs` exists to prevent. **It is owned now: WRK-011, scheduled as Sprint
2.75, which runs BEFORE Sprint 3.** So the line this section used to end on — *"Sprint 5 cannot pass
until it is owned"* — is retired: ownership is settled, and what Sprint 5 needs is Sprint 2.75
**shipped**, which is a stronger condition than owned. The finding itself **stays `open`** until
WRK-011 has a result doc; it is still the line between "dispatch composed" and "dispatch working".

---

## 4. The sprints

### Sprint 1 — WRK-010: a worker stays logged in
**Epic E4 · ★ SHIPPED `c1c5530f5` · design + result: `epics/E4-worker-daemon/tickets/WRK-010-{design,result}.md`**

**★ LANDED (slice 1, server-side).** The renewal route exists with **zero production callers, by
design**; 8/8 mutants killed; a 4-reviewer adversarial pass found 0 HIGH/BLOCKING (3 LOW fixed).
**E4-F007 stays `open`** (Sprint 2.5 closes it); a new LOW **E4-F014** records the DSK-001 phantom
`IdentityLifecycle.acquireSession()` seam. `verify` inherits the pre-Sprint-1 red (§2.0), stated
in the result doc. Everything below is the sprint AS IT WAS SCOPED, kept as the record.

**Why first.** Today the enrollment code lives 10 minutes and a session 15, with **no
renewal route** — so a wired worker goes authority-less at T0+15min and a human re-pastes a
code every ten minutes. That is not shippable, and every later sprint inherits it.

**What.** A device-proof-bound renewal endpoint: the worker presents a signed proof from its
own device key and receives a fresh, still-15-minute-bounded session. No human step. The
long-lived key never leaves the host.

**★ This is SLICE 1 — server side only. It has no callers until Sprint 2.5.** Read that
sentence twice: shipping it alone builds a route nothing calls, which is the exact shape of the
17 unprovable gate clauses this programme's audit exists to fix. Sprint 1 does **not** close
E4-F007; Sprint 2.5 does.

**Gate to start:** none. **Done when:** a worker obtains a session after the code route has
lapsed; revoked/disabled/stale-generation each refuse with the same coarse code; the route is
absent when distributed execution is off.

**Settled (§8 D-1, D-2):** the route reuses `createWorkerSessionAuthenticator`
(`server/src/middleware/worker-session-auth.ts:109`), which performs **nine of the ten authority
guards in full and the tenth (identity) in part** — including the `scope` check the original plan
omitted, and skipping only the `workerId`/`targetId` arms, which are the query keys
`findSessionAuthority` selects on and so can never differ. Unlike the thin function the
plan first reached for, does **not** deny a platform-physical claim. That one denial is kept as
guard R1 in the ticket. One re-used authenticator plus one denial is not a new authority system,
so WRK-010 stays **one E4 ticket**. Nothing to decide at sprint start.

---

### Sprint 2 — DEP-010: the provider seam
**Epic E6/E4 · ★ SHIPPED `176eb5f8e … 6b2c27fb9` · design + result: `epics/E6-deployment-test-harness/tickets/DEP-010-{design,result}.md`**

**★ LANDED.** 12 fail-first steps, every guard mutation-proven by DELETION (with positive
controls). Go-book §8 **D-3's three conditions verified in what shipped**: one-file
`PROVIDER_HOST_PATH` confinement, a *tightened* checker (a zero-file credential ban whose own
self-test proves a second naming file fails), and a provider-less shipped default asserted by a
guard. **"Inert" proven the strict way** — the shipped desktop default constructs **no provider
at all** (the resolver returns `{kind:"none"}` before the loader is called; Steps 4/6/8/10), and
even provider+flag composes no loop (the §4.1 structural lock — which **expires at Sprint 3**,
§4.2, and Sprint 3 must REPLACE not inherit). **E4-F011 (HIGH) resolved** + manifest key deleted;
**E6-F003 repointed** to a filed successor **DEP-011** (E4-F013 — an open finding may not be left
owned by shipped work); **E6-F008/E6-F004 resolved**. A **5-reviewer adversarial pass found 0
HIGH/BLOCKING** (2 LOW comment fixes applied). `verify` inherits the pre-Sprint-2 red (§2.0),
stated in the result doc. Everything below is the sprint AS SCOPED, kept as the record.

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

**Read this before writing the guard (§8 D-3).** `desktop-host.ts` hands the daemon both
OS-custody stores on every non-control boot, so on the desktop the only thing standing between
a composed provider and live dispatch is two environment variables —
`AOA_WORKER_DISPATCH_ENABLED` and `AOA_WORKER_EVENT_OUTBOX_PATH` — where the container path also
has a structural gate no env edit can open. "inert" therefore has a precise meaning here: the
**shipped desktop default constructs no provider at all**, and a guard asserts it. Prove that,
not merely that the flag is off.

---

### ★ Sprint 2.5 — WRK-010 slice 2: the renewal route gets its first caller
**Epic E4 · design: write at sprint start (WRK-010 §9 already scopes it)**

**Why this exists, and why it was nearly missed.** The completeness critic asked one question no
single-plan reviewer could: *after all three sprints ship exactly as written, who calls the
renewal route?* The answer was **nobody**. Sprint 1 is server-side; Sprint 3's composition wires
`SessionStoreDeps.renew` to `Enroller.renew`, which is the **enrolment code replay** — its own
module header says there is no dedicated renew route and that it only succeeds while the 10-minute
code route is live. So Sprints 1 + 2 + 3 would have left the route with zero callers and the
worker still losing authority at the code-route boundary: Sprint 1's product, built and unused.

**What.** The worker-side renewal client, plus the one behavioural change that makes it usable:
`SessionStore.ensureFresh` currently refreshes **only once the session is absent or already
expired**, and its own docblock says it "is NOT a near-expiry renewal scheduler". The WRK-010
route refuses an expired session by construction (`verifyWorkerSessionToken` fails
`claims.exp <= now`). So a `renew` thunk pointed at the route from today's store fires exactly
when the credential it must present is already dead. **Slice 2 adds the near-expiry threshold**,
and it must be at least the **5-minute headroom** WRK-010 §3.5(i) derives — below that a
proof-replay window of up to ~4.9 minutes opens.

**★ And a second thing, found later and bigger: the route cannot mint a FIRST session.**
`enroll-once.ts:310` discards the enrolment session on purpose — *"`result.session` is dropped here
and never returned (I13)"* — so a composed daemon starts with none. `SessionStoreDeps.renew` takes
**zero arguments**, and the route's authenticator refuses a request with no bearer
(`worker-session-auth.ts:125-127`). So the first `ensureFresh()` has nothing to present on the one
call that matters most. Filed as **E4-F012**, owned by this sprint. **It is a decision, not
plumbing** — I13 exists so a bearer can never reach a log line, and every route to a first session
either re-opens that or changes the `SessionStoreDeps` contract. Answer it in the plan, with a
security argument, before writing code.

**★ This sprint owns the production session wiring — Sprint 3 does not.** As first written, Sprint
2.5's done-condition ("a production caller") was **unreachable**: the only production `SessionStore`
construction lives in slice 2b, which runs *after*. That is a cycle. Resolution: **the production
identity + `SessionStore` construction moves here**, and Sprint 3 composes the poll loop and
supervisor on top of a session lifecycle that already works. Slice 2b's §4 and Step 2 must be
re-scoped accordingly at Sprint 3's Step 0.

**Gate to start:** Sprints 1 and 2 green. **Done when:** a composed daemon obtains its **first**
session and then a **renewed** one from the route, both in an integration test; the route has a
production caller; a worker crosses T0+15min still authorised; `E4-F007` moves to `resolved`
**here, not in Sprint 1**; `E4-F012` closes.

**Why 2.5 and not a renumber:** sprints 3-9 are referenced by number across the plans and the
registers. A fractional insert costs one odd-looking label; a renumber costs a day of chasing
stale references. The same reasoning admits **2.75** below.

---

### ★ Sprint 2.75 — WRK-011: a worker can be OFFERED work, and can accept it
**Epic E4 · node exists · design: `epics/E4-worker-daemon/tickets/WRK-011-design.md`**

**Why.** Everything before this gives a worker durable *authority*; none of it makes it
**matchable**. A desktop that enrols perfectly, on a target whose placement profile an administrator
has ratified, is invisible to the scheduler on **three** independent axes and would refuse an offer
on a fourth. That is **E4-F010**, and it is not an edge case — it is the steady state of every worker
this programme can currently produce. WRK-011 is the ticket that fixes it, and the only one in the
graph that does.

**What.** One ticket, both halves — the split is refused deliberately (plan §2.1). The server route
is **not inert on success**: it replaces `profile_hash`, and by `worker-session-auth.ts:167` (plus
`job-leasing.ts:259`/`:297`) that invalidates the *caller's own* session, so a worker that calls it
and discards the response is **worse off than before it called**. A worker holding a live session and
its enrolled device key presents a **refreshed hello** to a new **local** route — beside the
self-model read, not an eleventh frozen worker-control operation — and if that hello stays inside the
administrator-ratified ceiling, `profile_snapshot`, `profile_hash` and a fresh session move **inside
one transaction**, with the mint *before* commit so a mint failure rolls the update back. The daemon
builds that hello from the WRK-008 slice-1 self-model read, giving that route its **first production
caller**, once per boot before it polls. No migration, no new column, no frozen-contract change.

**★ Take the plan's §5.2 decision BEFORE Step 1, not during Step 7.** Inside a ratified ceiling this
route lets an already-enrolled device flip itself from unmatchable to matchable with **no further
operator action** — so an admin ratifying a profile for one future well-isolated device enables every
device already enrolled on that target. The plan recommends (a) *the target is the unit of admin
intent*, plus a structured audit record, and says plainly the call is not its own to make. It belongs
in **§8's ledger**, at this sprint's planning. If (b) — a per-worker activation flag — is taken, the
design changes materially: a fifth guard, a new column, a migration, and **L becomes XL**.

**Gate to start:** Sprints 1, 2 and **2.5** green. **That is a hard dependency, not a preference.**
The success response *is* a new session, and until Sprint 2.5 the daemon has nowhere to put one:
`enroll-once.ts:310` drops the enrolment session in as many words (*"`result.session` is dropped here
and never returned (I13)"*), and **E4-F012** records that nothing acquires a first session at all.
Landed earlier, WRK-011 does not merely lack a caller — **its success path breaks any worker that
calls it**, which is categorically different from Sprint 1's honest dormancy.

**Done when:** a provisioned worker is **actually offered work**, proven through the **real `poll`
service** behind a `no_work` precondition control rather than against the matcher in isolation, and
the daemon's own `offerSatisfiesWorker` admits that same offer; both columns are proven to move
together; the new session works and the **old one is proven dead**; a throwing signer leaves no
committed refresh; and **E4-F010** moves to `resolved` with its key DELETED from
`scripts/finding-ownership.json` **in the same commit** — the manifest fails the always-on `policy`
job the moment a key outlives its open finding.

> **★ What it does NOT mean.** Not "a composed daemon polls, ACKs and supervises": `createPollLoop`
> still has **zero production callers** after this sprint, and Sprint 3 gives it its first. Not "work
> executes end to end" — that is Sprint 5, on real E2B. Accordingly
> `scripts/gate-clause-wiring.json` is **not touched here**: `E4-1-leases-through-protocol` stays
> `unwired`, because caller count is the only thing that checker reads. Sprint 3 promotes it.

---

### Sprint 3 — WRK-008 slice 2b: dispatch gets COMPOSED
**Epic E4 · design: `epics/E4-worker-daemon/tickets/WRK-008-slice-2b-design.md`**

**Not "the moment it becomes real" — an earlier draft of this line said that and it is false.**
It used to be false for a *second* reason as well: E4-F010 meant a composed worker was offered
nothing and would refuse it anyway. **Sprint 2.75 removes that reason** — after WRK-011 the server
offers a provisioned worker work and its self-check admits the offer. What remains true is the first
reason: **composing is not demonstrating.** Dispatch stays default-off, credentials do not reach the
sandbox until Sprint 4, and the one real journey is Sprint 5. What this sprint does is real and
necessary: compose `createPollLoop` + `createSupervisor` (+ the startup
reconciler and event outbox, or defer them with a stated reason — E4 gate clauses 3 and 4
depend on them).

**Gate to start:** Sprints 1, **2, 2.5 and 2.75** green. Without slice 2 a composed worker still dies
at the 10-minute code-route boundary — Sprint 1 alone does not remove that ceiling — and, per
**E4-F012**, it cannot obtain a first session at all. Without **2.75** it composes a loop that can
never be offered work (**E4-F010**), which is what forced the earlier drafts of this section to
downgrade E4 clause 1 to reachability. Sprint 2.5 also now owns the production
identity + `SessionStore` construction, so this sprint's §4 and Step 2 must be **re-scoped at
Step 0** to compose on top of it rather than to build it.

**★ Written against the pre-Sprint-2 tree.** Slice 2b was planned before DEP-010 existed and the
go-book runs it after. Four of its assertions become false the moment Sprint 2 lands a provider in
`desktop-host.ts`: Step 8b's `"provider" in call === false`, Step 9b's declared guard property,
§2's "desktop gate 1 = no", and Step 9a's `AOA_WORKER_PROVIDER_URL` gate (DEP-010's resolver reads
`AOA_WORKER_SANDBOX_PROVIDER` instead — declare it dead env, not a gate). Reformulate them
**before** Sprint 3 starts, not inside it; slice 2b's §0.1 carries the table.

**★ And against the pre-Sprint-2.75 tree.** Slice 2b also *reasons from* E4-F010 in two places — its
§9 gate-promotion row for `E4-1-leases-through-protocol` and its §2 gate story — both of which
conclude the clause must stay `unwired` **because the worker refuses 100% of offers**. Sprint 2.75
removes that premise. The disposition is now a decision to take **on evidence** (see this sprint's
Done-when block), not a foregone downgrade: re-derive it at Step 0 rather than copying the plan's
reason across.

One thing round 2 *refuted* while doing this, worth knowing so nobody re-raises it: **D1's gate 1
stays structural through Sprint 2.** The critic expected D1's provider gate to become an env var
the guard does not declare; it does not, because `docker/worker/Dockerfile` runs the **container**
root and DEP-010 touches only `desktop-host.ts`. The hazard class is real; that instance of it is
not.

**Largest risk in the whole plan, named:** D1's "worker" is currently a *harness script*, not
the daemon. Turning dispatch on changes what those suites observe. Budget time to re-baseline.

**Done when:** with a provider injected **and** the flag on, the daemon composes a real poll
loop, supervisor, renewal driver and durable event outbox — giving `createPollLoop` and
`createSupervisor` their first production callers in the programme's history; with either absent
it is provably inert; `AOA_WORKER_DISPATCH_ENABLED` remains default-off.

> **★ It still does NOT mean "a worker leases, executes and reports" — but the REASON changed, and
> so does what you may promote.** Earlier versions of this line rested on **E4-F010**: the worker
> self-checked every offer against an unmatchable hello, so the check was `false` for 100% of
> offers and slice 2b downgraded E4 clause 1 to *reachability only*. **Sprint 2.75 closes that**, so
> the downgrade is no longer forced and `E4-1-leases-through-protocol` becomes promotable **on
> evidence** — evidence being a composed loop that actually took a lease in this sprint's own
> suite, never caller count and never a caveat in a `reason` field (the wiring checker validates
> `wired` on caller count alone and never reads that field). What remains true regardless: this
> sprint composes and does not demonstrate. Do not promote **E4-2** on the strength of a composed
> supervisor — production reaches the supervisor only after an ACK, so that clause needs an
> actually-supervised sandbox, which is Sprint 5's journey.

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
| **brand-check guard 9 is blind to the `ENV`-map convention** | `pr.yml:650-663` matches only literal `process.env.AOA_[A-Z_]+`, and `worker-daemon/src/config/config.ts` reads through an `ENV` map — so a new `AOA_WORKER_*` switch can ship undocumented with **no guard firing**. Three new operator-facing switches arrive in Sprints 2 and 3; two get documented by author discipline and one would not. The standing fix is to extend guard 9 to the map convention. |
| **`check-execution-census` trips on any new `*.test.mjs`** | Not a defect — it is working as designed — but it is the guard most likely to redden a sprint that adds a script test and forgets `scripts/test-execution-census.json`. Sprint 3 adds two. |
| **Kill switch has no write path** | `evaluateKillSwitches` is genuinely wired, but throwing it means hand-executed SQL, instance-wide per provider, no Organization or sink dimension. REL-005 scope. |

---

## 6. The registers that keep this honest

Four guards, all in the always-on `policy` job (never code-gated — their trigger *is* a docs
change):

| Guard | Fails when |
|---|---|
| `check-gate-clause-wiring.mjs` | a gate clause claims `wired` and nothing in production calls the symbol |
| `check-finding-ownership.mjs` | an open finding has **no entry at all**, or its entry claims a ticket that does not exist / already shipped. **NOT** "has no owner": `status: "unowned"` with a reason is accepted by design, and **one** finding sits there right now — **E4-F013**, a hole in the guard itself, which no product ticket is the natural owner of (E4-F010 left that list on 2026-08-25 when WRK-011 took it) — the guard's job is to make ownerlessness *visible*, not impossible |
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

---

## 8. Decisions ledger — settled 2026-08-25, do not relitigate

Each row was an open question when the Sprint 1–3 plans were first written. All are now
closed. If a plan you are reading still argues one of these, the plan is stale — trust this
table and fix the plan.

| # | Question | Disposition | Consequence for the plans |
|---|---|---|---|
| **D-1** | WRK-010: verify the renewal proof with `verifyWorkerOperationProof` (thin transport check) plus ten hand-written authority guards, or reuse `createWorkerSessionAuthenticator`? | **Reuse the authenticator** (`server/src/middleware/worker-session-auth.ts:109-210`). | It performs **nine of the ten in full, and the tenth (identity) in part** — the two unperformed arms are `workerId`/`targetId`, which `findSessionAuthority` is keyed by, so they can never differ — and, decisively, it performs the `scope` check (`:165`) the hand-written list **omitted**. **But it is not strictly stronger, and the difference is a security one:** `verifyWorkerOperationProof:50` denies a platform-physical claim outright; the authenticator does **not** — `claims.organizationId === null` takes the operator-DB branch at `:180-182` and returns a valid principal. Adopting it without noticing would have silently shipped platform-physical renewal against §9 of the plan. The revision keeps that denial as guard **R1** in the ticket's own pure admission function, which is now most of what that function still does. Second cost: refusals collapse into `WorkerSessionError`'s **two** codes (`:47-52`) — `target_revoked` from `verifyCurrent`, `unauthorized` from every `fail()` — so nineteen distinct conditions become two operator classes, not nine. Therefore the plan's guard-**ordering** argument is deleted, not kept: its only observable consumer was untested, which is exactly what review defect HIGH-2 flagged. |
| **D-2** | Does WRK-010's server route belong in E3 (where sessions are minted) or E4 (where finding E4-F007 lives)? | **One ticket, stays in E4.** | Follows from D-1: reusing the E3-owned authenticator leaves the route with **one** authority guard of its own — R1, the platform-physical denial the authenticator drops — plus the identity half of the fresh claims. One denial is not an authority system, so there is nothing substantial for an E3 ticket to own. No E3 node is created. |
| **D-3** | DEP-010 needs the provider package inside `worker-keystore`, which `scripts/lib/worker-keystore-boundary.mjs` pins to two dependencies and calls a controller STOP. | **Approved**, on three real conditions. | The earlier approval leaned partly on the staging-manifest mitigation — that build **refuses to run**, so it mitigates nothing. Replaced by: (a) a `PROVIDER_HOST_PATH` confinement so exactly one file may name the provider; (b) the boundary checker is *tightened*, not merely widened, and its own test proves a second naming file fails; (c) the shipped desktop default stays provider-less and a guard asserts it. **What it actually costs, measured** (the draft asserted "small" and never checked): the `e2b@2.30.5` lockfile closure is **36 packages, ~1,752 files, ~15.2 MiB unpruned**, entering the process that holds the device private key. The risk that carries is not size — it is the DSK-003 installer **secret scan**, which already has to prune pino's README and `@pinojs/redact`'s benchmarks. That handoff is now written down. DEP-010's Step 0 is therefore no longer a STOP but a **conditions check** against this row. |
| **D-4** | All three plan-review finding sets (WRK-010, DEP-010, WRK-008/2b — 23 defects, 3 CI-blocking, 8 HIGH). | **Apply all.** | Revisions landed into the three design docs; see each plan's revision note. No defect is carried as accepted debt. |

**What is NOT settled and is deliberately deferred to its own sprint:** the
`dependency-graph` regex (§5 row 2 — widening was measured and breaks the crosswalk-dominance
computation), and the four ticket families invisible to the coverage checker (§5 row 3).

**Consequence, already applied:** D-2 and D-3 were the ownership calls
`scripts/finding-ownership.json` was explicitly waiting on, and making them cleared every one of
the four findings that had been parked — E4-F007 → WRK-010, E6-F003/F004/F008 → DEP-010.

> **★ CORRECTION.** An earlier revision of this paragraph said the register reported *zero unowned
> findings*. That was true for about an hour and is now false: filing **E4-F010** (a composed
> worker cannot be offered work) added a HIGH that is `unowned` **on purpose**, because no ticket
> in the graph fixes either half of it. `node scripts/check-finding-ownership.mjs` prints it on
> every green run. The count that matters is not zero — it is *one, named, and visible*, which is
> the whole point of the register. Caught by the completeness critic, in the paragraph headed "do
> not relitigate", which is exactly where a stale claim does the most damage.
>
> **★ FOLLOW-ON, 2026-08-25 — E4-F010 is no longer unowned, and this paragraph would have gone
> stale in exactly the way it warns about.** WRK-011 was written, owns it, and is sequenced as
> **Sprint 2.75**; `scripts/finding-ownership.json` now carries it as `owned` and the register
> prints **E4-F013** — a hole in the ownership guard itself — as the only remaining `unowned`
> entry. **Ownership is not closure:** E4-F010 stays `open` until WRK-011 has a result doc. Nothing
> above is deleted, because the record of a HIGH sitting deliberately unowned for a day is worth
> more than a tidy paragraph. The same edit corrected E4-F007's own text, which asserted
`IdentityLifecycle.acquireSession()` was "already landed as the drop-in seam"; `grep` finds that
name in two design documents and no source file (§3.1 item 2).

---

## 9. Copy-paste sprint prompts

One block per sprint. Copy it verbatim into a fresh session — each is self-contained and ends by
updating this go-book and the registers, so the next session starts from truth rather than from
what was true when the plan was written.

**Every prompt now carries an adversarial-review step, and it is the most load-bearing paragraph
in this section.** Every real defect this programme has found came from the same shape: independent
reviewers, then a **skeptic told to refute** each HIGH — which killed 7 of 11 findings in one pass,
three of the four kills being strawman readings of work that already handled the case — and, for
anything whose deliverable is a document, a **completeness critic** told to ask only what is
missing across the set. The prompts describe that behaviour rather than naming a skill, deliberately:
the house plan format (`epics/<EPIC>/tickets/<TICKET>-design.md` plus a `#### ID` node in
`program-design.md`) is what `check-ticket-graph-coverage.mjs` enforces, and a general-purpose
plan-writing skill will put a good plan in the wrong place and turn that register red.

**Two more lines appear in every prompt on purpose.** *"Mutation-test every guard: DELETE it, do not
rewrite it into an equivalent"* and *"if you find something that invalidates the plan's premise,
STOP"* — the first because a guard nobody can falsify is this repo's most common defect, the second
because it has already happened twice and both times the catch came from checking before building.

### Sprint 1 — WRK-010 slice 1

```text
Work in the git worktree C:\e3 on branch docs/replatform-program.

Read first, in this order:
1. docs/replatform/GO-BOOK.md — §2.0 (the CI blocker), §2 (the per-ticket process),
   §4 Sprint 1, and §8 decisions D-1 and D-2 (SETTLED — do not relitigate them).
2. docs/replatform/epics/E4-worker-daemon/tickets/WRK-010-design.md — the plan.
   Start at §0: it lists corrections verified at tip, and §3.4 maps every authority
   guard onto the shipped authenticator.

Execute Sprint 1 (WRK-010 slice 1) end to end, following the plan's TDD steps in order.

Binding rules:
- Fail-first. Write the RED test, run it, confirm it fails for the RIGHT reason, then implement.
- Mutation-test every guard you add: DELETE the guard — do not rewrite it into an equivalent —
  run the named test, and confirm it goes red. Run a POSITIVE CONTROL first so you know the
  harness measures anything at all.
- packages/worker-protocol is FROZEN. Consuming it is fine; editing it is a STOP — come back and ask.
- The route REUSES createWorkerSessionAuthenticator. Do not hand-write the authority guards.
  Guard R1 — the platform-physical denial the authenticator does NOT perform — is yours to write.
- E4-F007 STAYS OPEN. Slice 1 builds a route with no callers; Sprint 2.5 closes the finding.
  Do not touch its status or its key in scripts/finding-ownership.json.


BEFORE you call it done, run an ADVERSARIAL REVIEW with subagents. This is not optional polish.
It is the step that has caught a real, often-HIGH defect on every ticket in this programme, and
no single reader has yet matched it.
- Spawn INDEPENDENT reviewers, one per dimension you actually changed. Each checks claims
  against source and reports only what it verified by opening the file. Zero findings is a
  respected answer; inventing findings to look thorough is not.
- For every HIGH or BLOCKING finding, spawn a SKEPTIC told to REFUTE it, and to default to
  "refuted" if it cannot reproduce the finding from the cited source. In this repo roughly three
  in four such findings DIE on inspection — they are strawman readings of work that already
  handled the case. Fix only what survives, and say which ones you killed and why.
- Do NOT delegate this to a plan-writing or auto-fixing skill. The house format and the
  fail-first / delete-the-guard mutation discipline above are stricter, and they are what the
  registers and CI actually check.

When the code is green:
- Run all five registers; every one must pass:
  node scripts/check-ticket-graph-coverage.mjs
  node scripts/check-finding-ownership.mjs
  node scripts/check-guard-inventory.mjs
  node scripts/check-gate-clause-wiring.mjs
  node scripts/check-execution-census.mjs
- Write epics/E4-worker-daemon/tickets/WRK-010-result.md: what shipped, what did NOT,
  the mutation table, and every claim you could not prove.
- Update GO-BOOK.md §3.1's Sprint 1 row and §4 Sprint 1 to what is now true.
- Commit, push, and report CI honestly — including `verify`, which is red for reasons
  that predate this sprint (§2.0). Do not raise its timeout to make it green.

If you find something mid-sprint that invalidates the plan's premise, STOP and say so
rather than absorbing it.
```

### Sprint 2 — DEP-010

```text
Work in the git worktree C:\e3 on branch docs/replatform-program.

Read first, in this order:
1. docs/replatform/GO-BOOK.md — §2.0, §2, §4 Sprint 2, and §8 decision D-3.
2. docs/replatform/epics/E6-deployment-test-harness/tickets/DEP-010-design.md.
   Its §0 carries the citation convention, §2 the findings disposition, and §4.2 and §10
   the two things that make this sprint dangerous.

Execute Sprint 2 (DEP-010) end to end.

Binding rules:
- The keystore dependency-boundary widening is ALREADY APPROVED (§8 D-3) on three named
  conditions. Do not re-ask for approval; DO verify all three hold in what you ship.
- This sprint does NOT turn dispatch on. On the desktop, "inert" means the shipped default
  constructs NO PROVIDER AT ALL, proven by a guard — not merely that the flag is off.
- You own E4-F011. Closing it requires a WRITTEN decision naming which boot root gets a
  provider and what the dispatch flag defaults to there. When you resolve it in
  epics/E4-worker-daemon/findings.md, DELETE its key from scripts/finding-ownership.json in
  the SAME commit — a manifest entry for a non-open finding fails the always-on policy job.
- Mutation-test every guard: DELETE it, do not rewrite it. Positive control first.
- Cite living documents (this go-book, findings registers) by SECTION AND ID, never by line.
- §10 lists four WRK-008 slice 2b assertions this ticket invalidates. Leave that section
  accurate — Sprint 3 reads it before it starts.
- E6-F003 is `owned` by this ticket, and the plan's §2 keeps it that way (correct — a ticket
  that will act on it owns it). But DEP-010 DEFERS it rather than resolving it, so at completion
  you must REPOINT its manifest `ticket` to a successor that exists on disk (file one if none
  does) — NOT leave it owned by this shipped ticket with only a rewritten reason. A non-empty
  `ownerStillOpen` string is all the guard checks, so a deferred finding left owned by a shipped
  ticket reads as owned by nobody and fails nothing (E4-F013). Same duty for any gate count you
  write: label which enumeration you mean — shipped-union (4), landable (4), or total incl.
  runtime (6); a bare number is the defect (E4-F015).


BEFORE you call it done, run an ADVERSARIAL REVIEW with subagents. This is not optional polish.
It is the step that has caught a real, often-HIGH defect on every ticket in this programme, and
no single reader has yet matched it.
- Spawn INDEPENDENT reviewers, one per dimension you actually changed. Each checks claims
  against source and reports only what it verified by opening the file. Zero findings is a
  respected answer; inventing findings to look thorough is not.
- For every HIGH or BLOCKING finding, spawn a SKEPTIC told to REFUTE it, and to default to
  "refuted" if it cannot reproduce the finding from the cited source. In this repo roughly three
  in four such findings DIE on inspection — they are strawman readings of work that already
  handled the case. Fix only what survives, and say which ones you killed and why.
- Do NOT delegate this to a plan-writing or auto-fixing skill. The house format and the
  fail-first / delete-the-guard mutation discipline above are stricter, and they are what the
  registers and CI actually check.

When green: run all five registers, write DEP-010-result.md, update GO-BOOK.md §3.1's
Sprint 2 row and §4 Sprint 2, commit, push, report CI honestly.

If you find something that invalidates the plan's premise, STOP and say so.
```

### Sprint 2.5 — WRK-010 slice 2

```text
Work in the git worktree C:\e3 on branch docs/replatform-program.

Read first:
1. docs/replatform/GO-BOOK.md — §2.0, §2, §4 "Sprint 2.5", and the §3.1 note that this
   sprint writes its own plan.
2. docs/replatform/epics/E4-worker-daemon/tickets/WRK-010-design.md §9.1 — slice 2 is
   already scoped there, including the two requirements below.
3. WRK-010-result.md (Sprint 1's output) for what actually shipped.

STEP 1 IS TO WRITE THE PLAN, to the same standard as the Sprint 1-3 designs: verified state
at tip with citations, architecture, fail-first TDD steps, a mutation table, and an acceptance
table mapping each clause to the test that proves it. Save it as
epics/E4-worker-daemon/tickets/WRK-010-slice-2-design.md. Then execute it.

Why this sprint exists — do not lose the thread: after Sprints 1, 2 and 3 as originally
sequenced, the renewal route Sprint 1 built would have had ZERO CALLERS, because slice 2b
wired the session's renew to Enroller.renew — the enrolment CODE REPLAY, which only survives
the ~10-minute code route. This sprint is what makes Sprint 1 worth having.

ANSWER E4-F012 FIRST — it is a DECISION, not plumbing, and the plan is not writable until it
is made. enroll-once.ts:310 discards the enrolment session on purpose ("result.session is
dropped here and never returned (I13)"), SessionStoreDeps.renew takes ZERO arguments, and the
renewal route's authenticator refuses a request with no bearer. So a composed daemon has
nothing to present on its FIRST ensureFresh(). Options are in the finding; each either
re-opens I13 (a bearer must never reach a log line) or changes the SessionStoreDeps contract.
Pick one, write the security argument, then plan.

THIS SPRINT OWNS THE PRODUCTION SESSION WIRING. The production identity + SessionStore
construction moves here from WRK-008 slice 2b — otherwise this sprint's own acceptance
("the route has a production caller") is unreachable, because the only production SessionStore
lives in a sprint that runs after this one. Say so in the plan; Sprint 3 re-scopes at its Step 0.

Three further requirements are already established and must survive into the plan:
- SessionStore.ensureFresh refreshes only when the session is absent or ALREADY EXPIRED, and
  the renewal route refuses an expired session by construction. Slice 2 adds the near-expiry
  threshold. Without it the thunk fires exactly when its credential is dead.
- That threshold must be at least FIVE MINUTES of headroom, as an INVARIANT rather than a
  scheduling preference — below it a proof-replay window of up to ~4.9 minutes opens
  (WRK-010 §3.5(i) derives the arithmetic).
- Acceptance must prove BOTH transitions against a real database: a composed daemon obtaining
  its FIRST session, and then a RENEWED one from the route. A test that injects a fake session
  proves neither — slice 2b's positive control does exactly that today.

E4-F007 AND E4-F012 RESOLVE HERE. For each, in the same commit: flip its status in
epics/E4-worker-daemon/findings.md AND delete its key from scripts/finding-ownership.json.
Doing one without the other reddens the always-on policy job.


BEFORE you call it done, run an ADVERSARIAL REVIEW with subagents. This is not optional polish.
It is the step that has caught a real, often-HIGH defect on every ticket in this programme, and
no single reader has yet matched it.
- Spawn INDEPENDENT reviewers, one per dimension you actually changed. Each checks claims
  against source and reports only what it verified by opening the file. Zero findings is a
  respected answer; inventing findings to look thorough is not.
- For every HIGH or BLOCKING finding, spawn a SKEPTIC told to REFUTE it, and to default to
  "refuted" if it cannot reproduce the finding from the cited source. In this repo roughly three
  in four such findings DIE on inspection — they are strawman readings of work that already
  handled the case. Fix only what survives, and say which ones you killed and why.
- Do NOT delegate this to a plan-writing or auto-fixing skill. The house format and the
  fail-first / delete-the-guard mutation discipline above are stricter, and they are what the
  registers and CI actually check.

AND — because this sprint's deliverable is a DOCUMENT that everything downstream depends on —
add a COMPLETENESS CRITIC after the reviewers: a subagent told "do NOT re-review the plan; ask
what is MISSING, and whether what this sprint BUILDS matches what the next sprint CONSUMES, by
name, signature and package." That question, and only that question, is what caught the defect
that would otherwise have left Sprint 1's renewal route with zero callers.

Worth it here, optional elsewhere: ONE independent pass from a different tool —
`codex exec --sandbox read-only "<your review brief>"` in C:\e3. An independent reviewer found a
BLOCKING defect that two in-house adversarial rounds had missed, by tracing the FIRST call
instead of the contract and by counting the rows of a table instead of trusting the sentence
underneath it.

When green: run all five registers, write the result doc, update GO-BOOK.md §3.1 and
§4 Sprint 2.5, commit, push, report CI honestly.
```

### Sprint 2.75 — WRK-011

```text
Work in the git worktree C:\e3 on branch docs/replatform-program.

Read first, in this order:
1. docs/replatform/GO-BOOK.md — §2.0 (the CI blocker), §2 (the per-ticket process),
   §4 "Sprint 2.75", and §8 (settled decisions).
2. docs/replatform/epics/E4-worker-daemon/tickets/WRK-011-design.md — the plan. Start at §0:
   it records the state verified at tip, corrects THREE of E4-F010's claims against the code,
   and adds a THIRD blocker the finding never named that fires before either half it does.
3. epics/E4-worker-daemon/findings.md — E4-F010. This sprint owns it and closes it.
4. The result docs of Sprints 1, 2 and 2.5 — the record of what actually shipped, which is
   not always what their plans said. In particular: where slice 2 put the SessionStore, since
   that is where this route's response has to land.

Execute Sprint 2.75 (WRK-011) end to end, following the plan's steps in order.

BEFORE STEP 1, TAKE THE §5.2 DECISION and record it in GO-BOOK §8. Inside a ratified ceiling
this route lets an ALREADY-ENROLLED device flip itself from unmatchable to matchable with no
further operator action, so an admin ratifying a profile for one future device enables every
device already on that target. Option (a) — the target is the unit of admin intent, plus a
structured audit record — is what the plan recommends. Option (b) — a per-worker activation
flag — adds a fifth guard, a column and a migration, and turns this from L into XL. Taking it
at Step 7 is taking it by omission, which is the thing §5.2 exists to prevent.

Binding rules:
- Fail-first. Write the RED test, run it, confirm it fails FOR THE REASON WRITTEN DOWN, then
  implement. A step whose RED fails for a different reason proved nothing — stop and find out why.
- POSITIVE CONTROL FIRST, before any refusal case is built on the fixture, and every refusal
  case asserts its SPECIFIC reason rather than a bare admit:false. E1-F008: five placement
  guards passed their own named tests while DELETED, because every fixture was already
  refusing earlier for an unrelated reason.
- Mutation-test every guard: DELETE it, do not rewrite it into an equivalent. The plan lists
  18, all deletions, ZERO declared equivalents. A mutant that will not COMPILE is not an
  equivalent mutant and may not be counted — three plans in this programme have retracted
  mutants on exactly that ground.
- packages/worker-protocol is FROZEN, and this ticket CONSUMES it: the frozen hello schema is
  a field of a server-local envelope, the same pattern WRK-008 slice 1 and WRK-010 slice 1
  used. If review requires the refresh to become an ELEVENTH FROZEN worker-control operation,
  or requires new fields on pollRequestV1Schema, STOP — that is a freeze decision for the §8
  ledger, before any code is written. Do not "just add one field".
- THE ATOMIC TRIPLE IS THE TICKET: profile_snapshot, profile_hash and the new session move
  together or not at all, and the MINT HAPPENS INSIDE THE TRANSACTION so a mint throw rolls
  the UPDATE back. One column without the other makes the worker permanently unplaceable
  (job-placement.ts re-derives the digest); returning no session locks it out immediately with
  no route back. Four of the mutants exist for exactly this.
- The embedded-PostgreSQL suite is the ONLY evidence for five of the eleven acceptance
  clauses, and on Windows it is describe.skipIf'd — which vitest renders as GREEN. Run it with
  AOA_RUN_WIN_INTEGRATION=1 (PowerShell: $env:AOA_RUN_WIN_INTEGRATION = "1" on its own line),
  or you have signed off five clauses against a run that evaluated nothing.
- packages/worker-daemon is `pinned` at 131 in scripts/test-inventory.json. Adding daemon
  tests without bumping it reds check-test-inventory.mjs; `server` is `floor` and does not bite.
- Do NOT touch scripts/gate-clause-wiring.json. E4-1-leases-through-protocol stays `unwired`
  after this ticket, because createPollLoop still has zero production callers. Sprint 3
  promotes it. Writing anything else there is the false claim of wiring that checker exists
  to prevent.
- E4-F010 RESOLVES HERE. In the SAME commit: flip its status in
  epics/E4-worker-daemon/findings.md AND delete its key from scripts/finding-ownership.json.
  Doing one without the other reddens the always-on policy job. Also file the LOW for the two
  desktop-hello.ts comments §0(d) falsifies, WITH its own manifest key in that same commit —
  a new open finding is born undeclared, and undeclared fails.
- Cite living documents (this go-book, findings registers, the ownership manifest) by SECTION
  AND ID, never by line.


BEFORE you call it done, run an ADVERSARIAL REVIEW with subagents. This is not optional polish.
It is the step that has caught a real, often-HIGH defect on every ticket in this programme, and
no single reader has yet matched it.
- Spawn INDEPENDENT reviewers, one per dimension you actually changed. Each checks claims
  against source and reports only what it verified by opening the file. Zero findings is a
  respected answer; inventing findings to look thorough is not.
- For every HIGH or BLOCKING finding, spawn a SKEPTIC told to REFUTE it, and to default to
  "refuted" if it cannot reproduce the finding from the cited source. In this repo roughly three
  in four such findings DIE on inspection — they are strawman readings of work that already
  handled the case. Fix only what survives, and say which ones you killed and why.
- Do NOT delegate this to a plan-writing or auto-fixing skill. The house format and the
  fail-first / delete-the-guard mutation discipline above are stricter, and they are what the
  registers and CI actually check.

AND — because this sprint's deliverable is a DOCUMENT that everything downstream depends on —
add a COMPLETENESS CRITIC after the reviewers: a subagent told "do NOT re-review the plan; ask
what is MISSING, and whether what this sprint BUILDS matches what the next sprint CONSUMES, by
name, signature and package." That question, and only that question, is what caught the defect
that would otherwise have left Sprint 1's renewal route with zero callers.

Worth it here, optional elsewhere: ONE independent pass from a different tool —
`codex exec --sandbox read-only "<your review brief>"` in C:\e3. An independent reviewer found a
BLOCKING defect that two in-house adversarial rounds had missed, by tracing the FIRST call
instead of the contract and by counting the rows of a table instead of trusting the sentence
underneath it.

When green:
- Run all five registers; every one must pass:
  node scripts/check-ticket-graph-coverage.mjs
  node scripts/check-finding-ownership.mjs
  node scripts/check-guard-inventory.mjs
  node scripts/check-gate-clause-wiring.mjs
  node scripts/check-execution-census.mjs
- Write epics/E4-worker-daemon/tickets/WRK-011-result.md: what shipped; what it does NOT claim
  (§6.3 — Sprint 3 composes the loop, Sprint 5 demonstrates the journey); the third blocker
  E4-F010 never named; the §5.2 decision as taken, or as still open with who owes it; the
  mutation line in the §8 form; that this route's dormancy is ONE conditional registration and
  weaker than worker-control's structural non-mount; and every claim you could not prove.
- Update GO-BOOK.md §3.1's 2.75 row and §4 Sprint 2.75 to what is now true, and delete the
  E4-F010 caveat wherever shipping this made it false.
- Commit, push, and report CI honestly — including `verify`, which is red for reasons that
  predate this sprint (§2.0). Do not raise its timeout to make it green.

If you find something mid-sprint that invalidates the plan's premise, STOP and say so rather
than absorbing it.
```

### Sprint 3 — WRK-008 slice 2b

```text
Work in the git worktree C:\e3 on branch docs/replatform-program.

Read first, in this order:
1. docs/replatform/GO-BOOK.md — §2.0, §2, §4 Sprint 3.
2. docs/replatform/epics/E4-worker-daemon/tickets/WRK-008-slice-2b-design.md, and its
   §0.1 BEFORE anything else: this plan was written against the pre-DEP-010 tree, and §0.1
   tables four of its own assertions that Sprint 2 invalidated.
3. DEP-010-result.md §10 — the same four, from the other side.
4. WRK-011-result.md — Sprint 2.75. It changes what a composed worker can be OFFERED, which
   is the premise slice 2b's §9 E4-1 row and §2 gate story reason from.

STEP 0: reformulate those four assertions against the tree as it now is, and confirm §2's
per-root gate table still matches reality. Do this BEFORE any implementation. One of them is
a guard that lands in the always-on policy job and would be red on every PR, docs-only ones
included. Re-derive the two places that plan reasons from E4-F010 as well — its §9 E4-1
promotion row and its §2 gate story — because Sprint 2.75 removed that premise.

Then execute the plan's TDD steps in order.

Binding rules:
- Sprints 1, 2, 2.5 AND 2.75 must be green first. Without slice 2 a composed worker still dies
  at the ~10-minute code-route boundary; without 2.75 (WRK-011) it composes a loop that can
  never be offered work.
- Mutation-test every guard: DELETE it, do not rewrite it. Positive control first.
- packages/worker-protocol is FROZEN.
- E4-F010 IS OWNED BY WRK-011 AND CLOSES IN SPRINT 2.75, WHICH RUNS BEFORE THIS SPRINT. If it
  is still `open` in epics/E4-worker-daemon/findings.md when you start, 2.75 has not shipped and
  you are out of sequence — STOP and say so rather than re-scoping around it. Once it is closed,
  this slice may be offered work; it still may not claim "a worker leases, executes and reports"
  without a test that shows a composed loop actually taking a lease. Composing is not
  demonstrating: Sprint 5 is the journey.
- Gate-clause promotion is a DELIBERATE decision, in the plan's Step 10. The wiring checker
  validates a `wired` clause on caller count alone and never reads its `reason`, so a caveat
  parked in a reason field is a caveat nothing surfaces. In particular: do NOT promote
  E4-2 ("supervises only sandboxes") on the strength of a composed supervisor — production
  reaches the supervisor only after an ACK, so that clause needs an ACTUALLY SUPERVISED
  sandbox. (Until Sprint 2.75 the reason was E4-F010, which refused every production offer
  before the supervisor was reached; that reason is gone, the clause's requirement is not.)
  Promoted on composition alone it would go green over zero supervised sandboxes.
  E4-1-leases-through-protocol is now promotable ON EVIDENCE — a composed loop that took a
  lease in this sprint's own suite — rather than downgraded to reachability.
- Sprint 2.5 now owns the production identity + SessionStore construction. Re-scope §4 and
  Step 2 at Step 0 to compose ON TOP of it rather than to build it.
- E4-F008 and E4-F009 are owned by THIS TICKET. When you write the result doc, either resolve
  them or TRANSFER them to a named successor ticket that exists on disk. A non-empty
  `ownerStillOpen` string is all the guard checks, so leaving them is silent (E4-F013).
- This slice adds new *.test.mjs files: add them to scripts/test-execution-census.json in the
  same commit or the always-on policy job goes red. It also adds a new AOA_WORKER_* switch
  that brand-check cannot see — document it in docs/deploy/environment-variables.md.


BEFORE you call it done, run an ADVERSARIAL REVIEW with subagents. This is not optional polish.
It is the step that has caught a real, often-HIGH defect on every ticket in this programme, and
no single reader has yet matched it.
- Spawn INDEPENDENT reviewers, one per dimension you actually changed. Each checks claims
  against source and reports only what it verified by opening the file. Zero findings is a
  respected answer; inventing findings to look thorough is not.
- For every HIGH or BLOCKING finding, spawn a SKEPTIC told to REFUTE it, and to default to
  "refuted" if it cannot reproduce the finding from the cited source. In this repo roughly three
  in four such findings DIE on inspection — they are strawman readings of work that already
  handled the case. Fix only what survives, and say which ones you killed and why.
- Do NOT delegate this to a plan-writing or auto-fixing skill. The house format and the
  fail-first / delete-the-guard mutation discipline above are stricter, and they are what the
  registers and CI actually check.

When green: run all five registers, write WRK-008-slice-2b-result.md, update GO-BOOK.md §3.1
and §4 Sprint 3, commit, push, report CI honestly.

Budget time to re-baseline the D1 lane. If you find something that invalidates the plan's
premise, STOP and say so.
```

### Sprints 4-9 — the template

These have scope and sequence but no implementation plan, deliberately: a plan written five
sprints early goes stale, which is the failure this whole audit exists to fix. **Step 1 of each is
to write the plan.** Substitute the bracketed parts from §4.

```text
Work in the git worktree C:\e3 on branch docs/replatform-program.

Read first:
1. docs/replatform/GO-BOOK.md — §2.0, §2 (the per-ticket process), §4 "[SPRINT HEADING]",
   §5 (debt carried deliberately), and §8 (settled decisions).
2. The result docs of the sprints before this one — they are the record of what actually
   shipped, which is not always what their plans said.
3. docs/replatform/epics/[EPIC]/findings.md and scripts/finding-ownership.json — anything
   open and owned by this sprint's tickets is yours.

STEP 1 IS TO WRITE THE PLAN, to the same standard as the Sprint 1-3 designs:
- Verified state at tip. Open every file you cite and record the line. Where a document and
  the code disagree, the code wins and you say so.
- COUNT THE CALLERS of anything an acceptance clause depends on. A clause satisfied by a
  function nothing calls is vacuous, and that is the defect this programme keeps shipping.
- Fail-first TDD steps, a mutation table (DELETE each guard, never rewrite it), and an
  acceptance table mapping every clause to the test that could turn RED.
Save it as epics/[EPIC]/tickets/[TICKET]-design.md. Then execute it.

Binding rules: packages/worker-protocol is FROZEN. All five registers must pass. Cite living
documents by section and id, never by line.


BEFORE you call it done, run an ADVERSARIAL REVIEW with subagents. This is not optional polish.
It is the step that has caught a real, often-HIGH defect on every ticket in this programme, and
no single reader has yet matched it.
- Spawn INDEPENDENT reviewers, one per dimension you actually changed. Each checks claims
  against source and reports only what it verified by opening the file. Zero findings is a
  respected answer; inventing findings to look thorough is not.
- For every HIGH or BLOCKING finding, spawn a SKEPTIC told to REFUTE it, and to default to
  "refuted" if it cannot reproduce the finding from the cited source. In this repo roughly three
  in four such findings DIE on inspection — they are strawman readings of work that already
  handled the case. Fix only what survives, and say which ones you killed and why.
- Do NOT delegate this to a plan-writing or auto-fixing skill. The house format and the
  fail-first / delete-the-guard mutation discipline above are stricter, and they are what the
  registers and CI actually check.

AND — because this sprint's deliverable is a DOCUMENT that everything downstream depends on —
add a COMPLETENESS CRITIC after the reviewers: a subagent told "do NOT re-review the plan; ask
what is MISSING, and whether what this sprint BUILDS matches what the next sprint CONSUMES, by
name, signature and package." That question, and only that question, is what caught the defect
that would otherwise have left Sprint 1's renewal route with zero callers.

Worth it here, optional elsewhere: ONE independent pass from a different tool —
`codex exec --sandbox read-only "<your review brief>"` in C:\e3. An independent reviewer found a
BLOCKING defect that two in-house adversarial rounds had missed, by tracing the FIRST call
instead of the contract and by counting the rows of a table instead of trusting the sentence
underneath it.

When green: write the result doc, update GO-BOOK.md §3.1 and the §4 entry for this sprint,
commit, push, report CI honestly.

If you find something that invalidates the sprint's premise, STOP and say so.
```
