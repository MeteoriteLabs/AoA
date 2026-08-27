# GO-BOOK — the re-platform, sprint by sprint

**This is the only document you need to start a session.** Hand it to any session, name a
sprint, and that session runs the sprint end to end. Written 2026-08-25 (Sprint 0), against
branch `docs/replatform-program`, worktree `C:\e3`.

**Read §1 and §2 once. Then jump to your sprint in §4** (Sprints 1-3 have full plans linked in §3.1).

> **★ In a hurry? Go straight to §9.** It holds a **copy-paste prompt per sprint** — self-contained,
> and each one ends by updating this document and the registers, so the next session starts from
> what is true rather than from what was true when its plan was written.
>
> **CI is green.** As of 2026-08-27 (PR #327) `verify` is a 4-shard matrix and §2.0 is RESOLVED —
> `ci-required` passes. A red shard is now a REAL failure to own, not an inherited timeout. (The
> §3.1 rows below say "inherits the §2.0 red" as an accurate record of each sprint's ship-time
> state; that condition is now retired.)

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

### ★ 2.0 — `verify`: RESOLVED 2026-08-27 (sharded + two timeout-masked bugs fixed → `ci-required` green)

**RESOLVED — `ci-required` is green for the first time in the programme.** PR #327 (run
`33037143412`): all four `verify` shards pass in **12.8–16.2 min**, `ci-required` **PASS**. `verify`
was one job running the whole vitest suite in a single lane (~56 min at `maxForks=2`), capping out at
`timeout-minutes: 60` on 5+ consecutive runs. It is now a `fail-fast:false` shard matrix of 4 legs
(`pnpm exec vitest run --shard=i/4`); the 60-min cap is **unchanged** (now a per-shard cap). Full
plan + evidence: `docs/replatform/CI-VERIFY-PARALLELIZATION.md`.

**The timeout was masking two real, pre-existing failures** (verify had not *completed* since
~2026-08-24, so CI never reported them). Sharding surfaced both; both are fixed in the same PR:
1. `job-control-module-load-sentinel.mjs` threw `ReferenceError: normalized is not defined`
   (`e7b58cec3` deleted the `const normalized = specifier…` line but kept using it) → 5 failing tests
   in `distributed-execution-db-startup.integration.test.ts`.
2. `redact-sensitive.ts` logged request-body strings verbatim, so a 4 MB oversized-payload field
   (`job-submission` size-ceiling tests) became a multi-MB log line that stalled a vitest fork past
   the birpc timeout and **HUNG** a whole shard (42 min of silence → cap). Logged strings are now
   capped at 8192 chars. **Lesson: the "slowness" was PART volume and PART a real hang — a single
   complete run does NOT prove "no hang"; the STEP-0 diagnostic that trusted one completed run was
   wrong on this, and only executing the sharded matrix exposed it.**

The diagnostic record below (how the regression was first found) is kept for the audit trail; its
"do not raise `timeout-minutes`" instruction still holds and was honoured (the cap was not raised).

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
  S5  CLI-006/D2  prove ONE real journey       (E7)   ── ★ STEP 1 GREEN: E4-1/E4-2 WIRED on evidence; E7-1 still needs the operator real-E2B run (Step 2)
  S5a CLI-007     canary gets a real credential (E7)   ── ★ SHIPPED; E7-F001 resolved; unblocks S5 (E7-1 still needs its run)
  S5b canary campaign  full journey on real E2B    (E7)   ── the E7-1 promoter; live staging + real spend (operator)

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
| 3 | [`WRK-008-slice-2b-design.md`](./epics/E4-worker-daemon/tickets/WRK-008-slice-2b-design.md) + [`WRK-008-slice-2b-result.md`](./epics/E4-worker-daemon/tickets/WRK-008-slice-2b-result.md) | **★ SHIPPED, `a62b8e06a … ` (through the result-doc commit).** Dispatch COMPOSED: `createPollLoop` + `createSupervisor` + the lease-renewal driver + the durable event outbox get their **first production callers in the programme's history**, composed ON TOP of Sprint 2.5's session lifecycle and WRK-011's provisioning behind the default-OFF flag. Both shipped roots proven inert (Step 8a container / 8b desktop, with positive controls). **47 mutants / 47 killed / 0 survivors / 1 documented N/A** (the WRK-010 ceiling WARN, made moot by Sprint 2.5). Step 2 re-scoped 6→2 mutants (Sprint 2.5 owns the store). A **4-reviewer adversarial pass (security / composition / inertness+guards / completeness) found 0 HIGH/BLOCKING/confirmed defects.** `E4-4-event-outbox-replay` → **`wired`**; `E4-1`/`E4-2` stay **`unwired` (expectedReferences: 2)** on evidence, NOT the removed E4-F010 premise — composing is not demonstrating a lease (Sprint 5). `E4-F008` → **WRK-012**, `E4-F009` → **WRK-013** (on-disk scoping stubs). `verify` inherits the pre-Sprint-3 red (§2.0). |
| 2.5 | [`WRK-010-slice-2-design.md`](./epics/E4-worker-daemon/tickets/WRK-010-slice-2-design.md) + [`WRK-010-slice-2-result.md`](./epics/E4-worker-daemon/tickets/WRK-010-slice-2-result.md) | **★ SHIPPED, `16c7dc705 … ` (through the result-doc commit).** The renewal route gets its FIRST production caller. Adopts WRK-010 §9.1.1's decided mechanism verbatim: the enrolment SINK (`onSessionMinted`, I13-safe — the outcome is unchanged) + `SessionStoreDeps.renew(current)` and a REQUIRED `bootstrap()` (E4-F012 becomes a compile error). Ships the worker-side device-proof renewal client, the ≥5-min near-expiry threshold (`RENEWAL_HEADROOM_MS`, the §3.5(i) invariant), and the production `createWorkerSessionLifecycle` the boot root composes when a provider + `AOA_WORKER_DISPATCH_ENABLED` are present. **Proven at embedded-PG with the REAL daemon lifecycle** (no fixture session): FIRST session from the sink, RENEWED from the route (`s1≠s0`), authority sustains past T0+15min, steady-state boot bootstraps via code replay. **12 mutants (11 killed + 1 type-level property), 0 survivors.** A **6-agent adversarial pass** (5 dimension reviewers + a completeness critic), a **refutation skeptic**, and an **independent codex pass** found 0 HIGH/BLOCKING (a MED "recovery-regression" reading was **refuted** — the session always outlives its code, so both recovery paths stop identically; and the poll loop is not composed until Sprint 3). **`E4-F007` and `E4-F012` RESOLVED** here (status flipped + keys deleted, same commit). The route's repeated near-expiry renewal in a RUNNING process is Sprint 3's poll-loop driver; the mechanism is built, wired, and proven here. `verify` inherits the pre-Sprint-2.5 red (§2.0). |
| 2.75 | [`WRK-011-design.md`](./epics/E4-worker-daemon/tickets/WRK-011-design.md) + [`WRK-011-result.md`](./epics/E4-worker-daemon/tickets/WRK-011-result.md) | **★ SHIPPED, `5c10a0f32 … ` (through the result-doc commit).** A worker can now be OFFERED work and can ACCEPT it: the atomic triple (`profile_snapshot` + `profile_hash` + a fresh session, mint before commit) on `POST /api/execution-targets/self/hello`, plus the provisioned `buildDesktopHello`/`deriveHelloProvisioning` and `client.selfHelloRefresh()`. **Proven at embedded-PG through the REAL `poll` service** (`no_work` precondition → refresh → `offer`; the daemon self-check admits the captured offer; old session dead; throwing-signer rollback). **18 mutants, 18 killed, 0 survivors** (M6 verified via the positive control; the platform-physical narrow is type-enforced). **§5.2 decision taken BEFORE Step 1 as §8 D-5 — option (a), per-target.** A **5-reviewer adversarial pass + completeness critic + skeptic + independent codex pass** found **0 HIGH/BLOCKING** in-house; 2 LOW coverage gaps fixed (a real-route HTTP success test A8; A6 tightened); codex's 3 HIGH all **refuted** (frozen matcher / dead-on-arrival session / declared non-goal), 1 MED **fixed** (platform-physical guard order), 1 MED **documented**. **E4-F010 RESOLVED** (status flipped + key deleted, same commit); new LOW **E4-F016** filed. `verify` inherits the pre-Sprint-2.75 red (§2.0). |
| 4 | [`DAT-008-slice-5-{design,result}.md`](./epics/E5-workspaces-secrets/tickets/DAT-008-slice-5-design.md) + [`DAT-008-slice-7-{design,result}.md`](./epics/E5-workspaces-secrets/tickets/DAT-008-slice-7-design.md) | **★ SHIPPED (slice 5; slice 7 DEFERRED), `bc288f004 … ` (through the result docs).** The worker daemon now REDEEMS the `env`/`sandbox_local_only` handle from the lease envelope through a LOCAL resolve op (device proof + session), synthesises it into `CreateSandboxSpec.env` (**M2 closed** — was `env:{}`), and seeds every redeemed value as a **per-run** redaction canary into BOTH the supervisor lifecycle stream and the fence-close-proxy stream before create (**M7 closed**). FAIL-CLOSED is the core: denial is HTTP 200, so the worker branches on the body `outcome` and any non-`resolved` result fails the attempt with no sandbox. **`E5-5-redaction` → `wired`** (symbol re-pointed off the unused DAT-005 egress-proxy to `synthesiseRunSecrets`, proven by a planted-leak test on both streams; real-E2B auth stays Sprint 5). Mutation sweep by DELETION killed the credential fail-OPEN core + every guard (1 documented equivalent — the retry cap, killed as a pair). 32 new unit tests + an embedded-PG round-trip proof (device proof over the resolve path verifies; the worker fails closed on the fence-first denial). **Slice 7 DEFERRED**: the distributed path has no warm-resume mechanism (`EffectAuthority.resume()`/`SandboxProvider.restore()` still zero production callers post-S3; no distributed lease pause/resume), and the one live warm-lease lifecycle is the legacy #320 server substrate MIG-005 will replace — not built against an absent mechanism (§4). `verify` inherits the pre-Sprint-4 red (§2.0). |
| 5 | [`CLI-006-D2-step1-{design,result}.md`](./epics/E7-coding-e2b/tickets/CLI-006-D2-step1-design.md) (+ the pre-CLI-007 `CLI-006-D2-{execution-plan,result}.md`) | **★ STEP 1 GREEN (post-CLI-007) — the composed loop takes a real lease + runs a task; `E4-1`/`E4-2` PROMOTED to `wired` ON EVIDENCE. E7-1 still `unwired` (real E2B = Step 2).** `composed-journey.component.test.ts` drives `composeDispatchRuntime` with its REAL factories (createPollLoop + createSupervisor + renewal driver + durable drain) through ONE lease: real ACK POST → supervise create/execute/destroy → redeem the CLI-007 provider_key handle into `spec.env` → drain a digest-valid terminal → fail-closed on a denied redemption. Per-op fake provider + protocol-faithful control-plane double (extended with the DAT-008 resolve route); no real E2B, no key, no spend. **5 mutants (M0/M1/M2/M3/M5) killed by ASSERTIONS + 1 documented N/A (M4 — the composed path never streams the value)**; M1/M2 are mirrors isolating each clause at the CASE level. A 3-reviewer pass (composition-fidelity / credential-no-leak / completeness critic) found the promotion **DEFENSIBLE, not a vacuous green** (a real embedded-PG server leg is not required for the WORKER clauses); fixed a real MED (the no-leak assertion inspected upload METADATA not event bodies — now scans decrypted bodies with a positive control) + the case-split + label reconcile. **The pre-CLI-007 session** (`ba30b2ba4 … c43e7ae35`) built the keyed real-E2B artifact-commit case + filed E7-F001 (RESOLVED by CLI-007). Leg B **Part 1 LANDED** (`composed-loop-real-server.integration.test.ts` — the SAME `createPollLoop` leases a real server-minted attempt over the real embedded-PG worker-control routes; dist-rebuilt-M1 + negative-control proven), upgrading E4-1's evidence to a real control plane. **Leg B Part 2 LANDED (Sprint 5b, `36114ca50`)** — `composed-loop-secret-resolve.integration.test.ts` proves the credential resolve over a REAL server-minted fence (DAT-008 §8's residual) at embedded-PG: a real active lease + a minted `provider_key` handle + a real AES-GCM Company key → a genuine `resolved` value; mutation-proven (M0/M1), promotes nothing. **Owed:** the operator-dispatched staging-canary campaign that alone promotes E7-1 (see the Sprint 5b row). `verify` inherits the §2.0 red. |
| 5a | [`CLI-007-{design,result}.md`](./epics/E7-coding-e2b/tickets/CLI-007-design.md) | **★ SHIPPED — E7-F001 RESOLVED; the journey's last CODE blocker is gone.** The canary now mints a Company `provider_key` handle: the MIG-008 preflight emits the Company ownership authority (`credentialAuthority:"company_api_key"`, `ok`-only), `resolveRunExecutionOwner` threads it to placement as `mintCredentialAuthority`, and the DAT-008 mint sources its `credentialKind` from that **out-of-band** authority (`canary-mint-authority.ts`) — the four-null placement binding is **UNCHANGED**, so the replay digest stays byte-identical and the mint's owner-authority gate is unmodified. Proven at embedded-PG (`job-placement.integration.test.ts` `[CLI-007]`): a canary places to the same digest across attempts and mints exactly one handle; the no-authority control mints none (fail-closed). Every guard mutation-proven by DELETION (incl. the replay guard and the gate null-arm; one false "survivor" caught as a CRLF-anchor miss and re-killed). A **4-reviewer adversarial pass (security / replay / gate-strength / composition) + completeness critic** found **0 HIGH/BLOCKING** (1 LOW test-file-reference drift fixed). **E7-F001 → `resolved`** (status flip + `finding-ownership.json` key delete, same commit). **`E7-1-coding-journey` stays `unwired`** — this UNBLOCKS but does NOT promote it; that still needs a cited dispatched real-E2B run of the full journey. `verify` inherits the pre-Sprint-5a red (§2.0). |
| 5b | [`CLI-006-D2-legB2-design.md`](./epics/E7-coding-e2b/tickets/CLI-006-D2-legB2-design.md) + [`CLI-006-staging-canary-runbook.md`](./epics/E7-coding-e2b/tickets/CLI-006-staging-canary-runbook.md) + [`CLI-006-campaign-result.md`](./epics/E7-coding-e2b/tickets/CLI-006-campaign-result.md) | **★ CAMPAIGN HARNESS + RUNBOOK READY; the distributed journey on real E2B is UNPROVEN — `E7-1` stays `unwired` (the honest "staging run owed" end-state, not a failure).** The session built the one buildable, genuinely-missing hop — **Leg B Part 2** (`composed-loop-secret-resolve.integration.test.ts`, `36114ca50`): the credential resolve over a REAL server-minted fence (DAT-008 §8's residual). It aligns a real active lease (via Leg B Part 1's poll→ack) + a minted `provider_key` handle advertised in the offer + a real AES-256-GCM Company key (`secretService.create`) in ONE embedded-PG harness, and drives the worker's REAL redemption (`createRedeemer` + `synthesiseRunSecrets`, replicating `dispatch-runtime.ts:138-150`) over the REAL resolve route → a genuine `outcome:"resolved"` with the real decrypted value (asserted `=== ` a per-run random synthetic key). Two fail-closed negative controls (stale fence, nonexistent key). **Mutation-proven non-vacuous:** M0 (positive control — `synthesiseRunSecrets`→empty, worker-daemon dist rebuild) reddens all 3; M1 (broker value→constant, server-src) reddens case 1+3 while case 2 (stale fence) stays green — the fence guard runs BEFORE the broker, both paths separately load-bearing. **No gate-clause promotion** (E5-5 already `wired`; this is added evidence for its residual). A **4-reviewer adversarial pass** (harness-fidelity / credential-no-leak / runbook-accuracy / completeness critic) found **0 HIGH**; fixes: 1 LOW (design A4 claimed a log-capture assertion the test doesn't implement — corrected to the actual containment evidence), 2 runbook wording imprecisions, and the result doc (the completeness critic's MEDIUM). The **runbook** states exactly what arming a canary Org requires (rollout dial `AOA_DISTRIBUTED_EXECUTION_ROLLOUT` canary JSON — absent from the staging compose; per-Company default `e2b` key for the preflight; enrolled worker; E2B key on adapter-manager) and the honest fact that the distributed fleet (`docker-compose.staging.yml`) is **not deployed today** (`deploy-testing.yml` = single-node app; real bring-up deferred to a REL/deploy-pipeline task). **E7-1 promotes ONLY on a cited dispatched real-E2B run of the DISTRIBUTED journey** — never the keyed provider lane ([32995765059](https://github.com/MeteoriteLabs/AoA/actions/runs/32995765059), primitives only), a D1 fake-provider run, or this embedded-PG harness. `server` is a test-inventory floor (no bump); frozen `worker-protocol` untouched; no new `AOA_*`. `verify` inherits the §2.0 red. |
| 6 (MIG-009) | [`MIG-009-drain-{design,result}.md`](./epics/E10-desktop-migration-realtime/tickets/MIG-009-drain-design.md) | **★ SHIPPED (Sprint 6 first unit — the one landable, sink-agnostic item), `65bbb8a3b … ` (through the result-doc commit).** The flag-disable rollback drain is now CORRECT WHEN WIRED. Two unconditional correctness fixes: (1) **per-Company rollback grain** — the drain asserted `assertRollbackSafe(organizationId)` against a Company-keyed gate (an interface lie that fails **CLOSED** against the real bridge — a dead cancel-nothing lever, NOT the "fails open" the extracted §4 analysis claimed); it now enumerates every Company under the org (`listOrganizationCompanyIds`, the canary primitive reused by reference) and asserts each, so a pending authoritative-cost receipt on **any** Company (incl. a **sibling**) skips the whole org — closing the genuine sibling fail-open. (2) **the missing `listActiveAttempts` SQL** — a new tenant-scoped store (`job-distributed-drain-store.ts`): `runInTenant` read, `notInArray(TERMINAL_ATTEMPT_STATUSES)`, `selectDistinct(company_id, job_id)`, **no `FOR UPDATE`**. Plus status coverage for the two untested `DRAINED_STATUSES` members (`cancelled` + `no_active_lease`) and the excluded `job_terminal`/`not_found`. All five pre-existing unit tests **reworked** to the new `DrainDeps` shape (test 2 re-keyed org→sibling-Company); a new embedded-PG suite proves the SQL + the grain end-to-end **through the real budget-cost bridge**. **8 mutants killed by DELETION** (positive control first: M0/M-sibling/M-enum-throw/M-cancelled×2/M-notfound unit; M-grain/M-SQL/M-terminal embedded-PG — M-grain's honest kill is the Step-5 positive control "clean org stops draining", never a false "drains unsafely"). **M4 is N/A** — the DEFER branch has no production `drainAll` caller to mutate, which is exactly why the clause stays honest. **`E10-1-drain` DEFERRED to `wired`** — it stays **`unwired` (count 0)**: promoting needs a real operator `drainAll` teardown/kill-switch trigger, which is **REL-005** scope (boot/SIGTERM/sweeper are the wrong triggers). `index.ts` is **not** touched (composing without a trigger is the vacuous-green anti-pattern the register catches). No migration; no `worker-protocol` change (FROZEN). A **3-agent adversarial pass** (source reviewer / refutation skeptic / completeness critic) found **0 HIGH**, the claim **NOT REFUTED**, coverage complete: 1 LOW fixed (`enumerate_error` skip now recorded in `skippedOrganizations`, + its missing test) and 2 doc notes (both reviewers converged that the rollback gate is currently **forward-looking** — the live bridge writes `authoritative_cost` receipts `applied` atomically, so the immediate value is the dead-lever fix, not a live fail-open; and the REL-005 wiring adapter must derive a stable `commandId` from jobId). `ci-required` green (§2.0 RESOLVED). |
| 9 (unit 1) | [`REL-FOUNDATION-GATE-{design,result}.md`](./epics/E11-hardening-release/tickets/REL-FOUNDATION-GATE-design.md) | **★ SHIPPED (Sprint 9 first unit — the one landable, ships-green unit), `e8e1975a5 … ` (through the result-doc commit).** The E0 foundation checker no longer accepts a bare string as a release test. `crossingHasReleaseTest` (bare-string / any `REL-\d+`-shaped owner) is replaced by a **trackable-strict admissibility gate**: a Critical/High crossing must NAME a REL ticket, and EVERY named REL ticket must exist on disk (`<id>-design.md`) **or** be declared, with a reason, in a NEW manifest `docs/architecture/distributed-execution-release-tests.json`. The manifest declares the four unwritten tickets (REL-001/002/003/005; REL-003's is **transitional**, removed in unit 2); REL-004 is written and NOT declared. Manifest-hygiene guards: **stale** (a deferral whose design doc now exists), **malformed** (no reason), **unreferenced** (named by no crossing); an **absent manifest fails closed**. **★ HEADLINE: makes E0 honest WITHOUT re-reddening `ci-required`** — ships **0-error at rest** (6 crossings admit on written REL-004, 24 on manifest-deferral), so `policy` → `ci-required` stays green while the 24 unwritten release tests become **machine-tracked debt**; each REL ticket's landing is forced to retire its own deferral. **NOT a hard-strict flip** (option b), which would red 24 crossings → `policy` → `ci-required` on every PR — proven from source (the M2 mutant *is* that state). **9 mutants killed by DELETION, 0 survivors** (M0 positive-control first — its no-op leaves the rest-CLI green, demonstrating the §0h residual: enforced-at-rest, not against-regression; M5 diagnostic-with-backstop documented; M8 isolated by a design-doc-only REL-006 fixture because REL-004 has both design+result docs). `makeFixture` extended to copy the E11 tickets dir + manifest into the fixture root (§3.4 trap avoided — no fail-open-on-missing). A **3-agent adversarial pass** (0-error-at-rest + hard-strict-reds source reviewer / refutation skeptic / M0–M8 + finding⇄ownership completeness critic) found **0 HIGH/BLOCKING**. **E11-F001 filed** (`unowned`, LOW): the dated 2026-08-27 terrain audit still carries the pre-CI-green "flips E0 to honestly-red" framing. **Residual named, not folded in** (§0h): the checker's own suite is `unrun` + in no CI job → the gate is not enforced against a re-vacuation regression; fixing the `additionalProperties` no-op + moving the suite into `policy` is a candidate later S9 hardening unit (GO-BOOK §5, the census's "single highest-value item"). No REL-001/002/003/005 test written (units 2–5, dependency-blocked). No migration; no `worker-protocol` change (FROZEN); no new `AOA_*`. `ci-required` green **contingent on the full `code=true` suite** (this PR touches `scripts/*.mjs` + `finding-ownership.json`). |
| 9 (unit 2) | [`REL-003-{design,result}.md`](./epics/E11-hardening-release/tickets/REL-003-design.md) + [`REL-003-dr-rehearsal-runbook.md`](./epics/E11-hardening-release/tickets/REL-003-dr-rehearsal-runbook.md) | **★ VERIFICATION CORE + OPERATOR RUNBOOK SHIPPED; the live staging rehearsal is OWED (the honest Sprint-5b end-state, NOT a failure), `1519b650c … ` (through the result-doc commit).** The DR/migration rehearsal is drawn as a session-buildable verification core + an operator-owed live leg. **Two NEW pure verifiers, mutation-tested by DELETION (positive-control FIRST):** Lane A `evaluateRecoveredManifestReconciliation` (over `job_artifacts status='committed'` × `HeadObjectResult` — bytes/hash/size/scope, missing/corrupt→FROZEN `QUARANTINE_REASONS`, missing-required blocks the verdict, promoted-set excludes non-verified, fail-closed on an unverifiable checksum; the scope guard uses the exact FROZEN `objectKeyHasPrefix` incl. `isSafeWorkspacePath`; **12 tests**) + the anti-orphan harness `runManifestReconciliation` (I8); and Lane C-pure `evaluateRollbackCompleteness` (marker-deletion-only refused = DE-20, accepted needs a real revert, empty fail-closed; **6 tests**). **A 7/7 + C 3/3 = 10/10 new-guard mutants killed, 0 survivors.** **Three reuse lanes, each with a positive control that the DR scenario reaches the ALREADY-WIRED guard (no new guard, D7):** Lane B (embedded-PG — the REAL `guardActiveFence`→`classifyFence` gate; active fence ADMITTED, expired/absent-row/gen-bump refused = I9+I13-fence), Lane C-embedded (marker-delete leaves the 0188 schema intact + real `revert0188` refusal = I10/I11), Lane D (the real `docker-compose.staging.yml` passes the EXPORTED `evaluateStagingManifestInvariants` at parallelism 1 + FROZEN-v1 N/N-1 baseline via `negotiateProtocolVersion` = I12), Lane E (advanceTargetGeneration re-enroll; **`revokeExecutionTarget` writes the durable `execution_target_revocations` cutoff while `revokeTargetAuthority` writes none = the B1 correction** = I13). **31 tests / 6 files green** (pure lanes everywhere; embedded-PG Linux-gated, Issue #114, verified locally with `AOA_RUN_WIN_INTEGRATION=1`). **Gate self-clean intact** — `deferred["REL-003"]` already removed by the prep commit; DE-20/DE-23 admit via disk; foundation checker PASS. **E11-F002 filed** (`owned` REL-003, key `ticket` not `owner_ticket` = C1, `ownerStillOpen` set): `runDatabaseRestore` has ZERO prod/CLI callers, is not barrel-exported, and no `aoa db:restore` exists — the runbook names the exact `runDatabaseRestore`/`pg_restore` invocation. Review-round-2 corrections applied (C1-C4, B1-B3). **A 3-agent adversarial pass on the IMPLEMENTATION** (source verifier / refutation skeptic / completeness critic) found **0 HIGH/BLOCKING surviving**: the verifier's 1 MED (dropped `isSafeWorkspacePath`) was FIXED, the skeptic REFUTED every fail-open (2 caveats hardened), the critic PASSED all clause→test/step, invariant, mutation, and boundary checks. **REL-003 does NOT promote to done** — `E7-1` + every dormant clause untouched; it promotes only on a CITED live-staging rehearsal run. No migration; no `worker-protocol` change (FROZEN); no new `AOA_*`; no census/guard-inventory bump. `code=true` PR → `ci-required` rides the full heavy suite. |
| 6-9 | scope + sequence only (§4) | **Step 1 of each sprint is: write the plan.** A plan written four sprints early goes stale, which is the exact failure this audit exists to fix. |

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
**shipped**, which is a stronger condition than owned. **★ UPDATE 2026-08-25 — WRK-011 SHIPPED and
E4-F010 is `resolved`** (status flipped + manifest key deleted in the result commit). The line between
"dispatch composed" and "dispatch working" is now crossed on the offer/accept axis: a provisioned
worker is offered work through the real `poll` service and its self-check admits the offer. What
remains for Sprint 3 is *composing* the loop (`createPollLoop` still has zero production callers) and
for Sprint 5 the one real E2B journey.

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
**Epic E4 · ★ SHIPPED · design + result: `epics/E4-worker-daemon/tickets/WRK-010-slice-2-{design,result}.md`**

**★ LANDED.** Adopted WRK-010 §9.1.1's decided mechanism verbatim (the sink + `renew(current)`/`bootstrap`
split — E4-F012 is now a compile error). Shipped the worker-side device-proof renewal client
(`createSessionRenewer` → `ControlPlaneClient.sessionRenew` → the slice-1 route), the ≥5-min near-expiry
threshold (`RENEWAL_HEADROOM_MS`), and the production `createWorkerSessionLifecycle` the boot root
composes on `provider && AOA_WORKER_DISPATCH_ENABLED` (a WEAKER gate than full dispatch, because a
session is a prerequisite to the self-model read Sprint 3 adds). **Proven at embedded-PG with the REAL
daemon lifecycle** — first session from the sink, renewed from the route, authority past T0+15min,
steady-state bootstrap — with NO fixture session. **`E4-F007` + `E4-F012` RESOLVED** (status flipped +
keys deleted in the same commit). The repeated near-expiry renewal in a RUNNING process is Sprint 3's
poll-loop driver; the mechanism is built, wired, and proven here (the honest §11 R2 residual — a cold
restart after the code window needs re-enrolment — is named, not solved). `verify` inherits the
pre-Sprint-2.5 red (§2.0). Everything below is the sprint AS SCOPED, kept as the record.

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
**Epic E4 · ★ SHIPPED · design + result: `epics/E4-worker-daemon/tickets/WRK-011-{design,result}.md`**

**★ LANDED.** The §5.2 decision was taken **before Step 1** as go-book §8 **D-5** — option **(a)**,
the target is the unit of admin intent, plus a structured `worker.hello.refreshed` audit record; the
shipped admission function has exactly four guards and no activation column (option b, L→XL, rejected).
The atomic triple lands on `POST /api/execution-targets/self/hello` (mint before commit, so a mint
throw rolls the UPDATE back), proven at embedded-PG through the **real `poll` service** — `no_work`
precondition → refresh → `offer`, the daemon self-check admits the captured offer, the old session is
proven dead, a throwing signer leaves no committed refresh, and a real HTTP round-trip (session +
device proof) returns 200 + a minted-session header. **18 mutants / 18 killed / 0 survivors.** A
**5-reviewer + completeness-critic + skeptic + independent-codex** pass found **0 HIGH/BLOCKING**
in-house (2 LOW coverage gaps fixed); codex's 3 HIGH were all **refuted** (the frozen matcher bounds
the ceiling TOCTOU; a revoked worker's refreshed session is dead on arrival; the daemon's zero callers
are the declared Sprint-3 deferral), 1 MED fixed, 1 MED documented. **E4-F010 RESOLVED** (status flipped
+ manifest key deleted, same commit); new LOW **E4-F016** filed. `gate-clause-wiring.json` untouched —
`E4-1-leases-through-protocol` stays `unwired` (Sprint 3 promotes it). `verify` inherits the
pre-Sprint-2.75 red (§2.0). Everything below is the sprint AS SCOPED, kept as the record.

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
**Epic E4 · ★ SHIPPED `a62b8e06a … ` · design + result: `epics/E4-worker-daemon/tickets/WRK-008-slice-2b-{design,result}.md`**

**★ LANDED.** `createPollLoop` + `createSupervisor` + the lease-renewal driver + the durable event
outbox get their **first production callers in the programme's history** — composed by
`composeDispatchRuntime` (Step 6) and wired into `bootstrapWorkerDaemon` (Step 7) ON TOP of Sprint
2.5's session lifecycle (hoisted per GAP-1) and WRK-011's provisioning, behind the default-OFF flag.
The composed worker is **matchable** (the provisioned `self.report` makes `offerSatisfiesWorker`
ADMIT a valid offer) and refreshes the server snapshot at boot via `refreshSelfHello` (WRK-011's
daemon caller's first production use). **Both shipped roots proven inert** (Step 8a container / 8b
desktop refusal ladder, each with a positive control proving the composeDispatch spy is reachable).
**47 mutants / 47 killed / 0 survivors / 1 documented N/A**; Step 2 re-scoped 6→2 (Sprint 2.5 owns the
store). Two new always-on `policy` declaration guards (D1-dispatch + boot-roots). **A 4-reviewer
adversarial pass found 0 HIGH/BLOCKING/confirmed defects.** `E4-4` → **`wired`**; `E4-1`/`E4-2` stay
**`unwired` (expectedReferences: 2)** — promotable ON EVIDENCE (a lease taken), which is Sprint 5, not
on the removed E4-F010 premise. `E4-F008`→**WRK-012**, `E4-F009`→**WRK-013**. `verify` inherits the
pre-Sprint-3 red (§2.0). Everything below is the sprint AS SCOPED, kept as the record.

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
**Epic E5 · ★ SHIPPED (slice 5; slice 7 DEFERRED) · design + result:
`epics/E5-workspaces-secrets/tickets/DAT-008-slice-{5,7}-{design,result}.md`**

**★ LANDED.** The worker half of DAT-008 is built: `worker-daemon` had **zero** runtime references
to a secret handle (the gap was real); it now reads `handoff.offer.job.secretHandles`, redeems each
`env`/`sandbox_local_only` handle through a LOCAL resolve op (`resolveExecutionSecret`, device proof
+ session, E4-D01-clean), synthesises `env[target]=value` into `CreateSandboxSpec` (**M2 closed** —
was `env:{}`), and seeds every redeemed value as a **per-run** redaction canary — into BOTH the
supervisor lifecycle stream AND the fence-close-proxy stream, via a shared per-lease coordinator,
before create (**M7 closed**; both sinks were per-construction `[]`, now per-run). **FAIL-CLOSED is
the core**: denial is HTTP 200, so the worker branches on the body `outcome`; any non-`resolved`
result (denial, timeout, unknown target, empty value) fails the attempt with **no sandbox** — the
mutation sweep deleted that branch and turned a test red. **`E5-5-redaction` → `wired`** (symbol
re-pointed off the unused DAT-005 egress-proxy — Direction B — to `synthesiseRunSecrets`, proven by a
planted-leak test on both streams). **Slice 7 DEFERRED** — the distributed path has no warm-resume
mechanism (`EffectAuthority.resume()`/`SandboxProvider.restore()` still zero production callers after
Sprint 3; no distributed lease pause/resume), and the one live warm-lease lifecycle is the legacy
#320 server substrate MIG-005 will replace, not the distributed path DAT-008 targets. `verify`
inherits the pre-Sprint-4 red (§2.0). Everything below is the sprint AS SCOPED, kept as the record.

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
**Epic E7 · ★ STEP 1 GREEN (E4-1/E4-2 promoted on evidence); real-E2B leg (E7-1) owed to Step 2 ·
plans + results: `epics/E7-coding-e2b/tickets/CLI-006-D2-step1-{design,result}.md`
(+ pre-CLI-007 `CLI-006-D2-{execution-plan,result}.md`)**

**★ STEP 1 DONE (post-CLI-007).** The go-book's two-step ordering held: cheap first, then the operator's
key. **Step 1 (free, no key)** drove the milestone journey's WORKER half end-to-end on the D1 fake
substrate — `composed-journey.component.test.ts` composes the REAL dispatch runtime and takes a real
lease (real ACK POST), supervises `create/execute/destroy`, redeems the CLI-007 provider_key handle into
`spec.env`, drains a digest-valid terminal, and fails closed on a denied redemption. This is "a composed
loop that actually took a lease and ran a task", so **`E4-1-leases-through-protocol` and
`E4-2-supervises-sandboxes` are PROMOTED to `wired` ON EVIDENCE** (mutation-proven; the completeness
critic ruled the promotion defensible, not a vacuous green). **`E7-1-coding-journey` STAYS `unwired`** —
Step 1 uses a fake provider + a fake control plane, so it reaches no real E2B, by design.

**★ Step 2 (real E2B) — the keyed PROVIDER lane is now DISPATCHED + GREEN; the DISTRIBUTED journey remains
OWED.** With the operator's `E2B_API_KEY` in repo secrets, this session fired the sentinel and the keyed lane
ran on real E2B — **cited run [32995765059](https://github.com/MeteoriteLabs/AoA/actions/runs/32995765059),
19/19 PASSED / 0 skipped**, incl. the CLI-006/D2 artifact-commit case, key masked, tenant-probe seam held
(`CLI-006-D2-step1-result.md` §6). This proves the provider/adapter primitives on real E2B but does NOT
promote E7-1 (it never runs the distributed create/schedule/lease/review); the
E7-1-promoting run is the **staging/testing-instance canary campaign** (real spend). **Leg B Part 1 is
LANDED** — the composed `createPollLoop` leases a real server-minted attempt over a REAL embedded-PG control
plane (`composed-loop-real-server.integration.test.ts`), upgrading E4-1's evidence off the in-process double;
**Leg B Part 2** (the credential resolve over a live fence, DAT-008 §8's residual) folds into that campaign.
Until a dispatched real-E2B run of that journey is cited, **the real-E2B leg is UNPROVEN and E7-1 stays
`unwired`** — an honest state, not a failure. The **pre-CLI-007 session** (`ba30b2ba4 … c43e7ae35`) built
the keyed real-E2B artifact-commit case and filed E7-F001 (RESOLVED by Sprint 5a / CLI-007); everything
below is the sprint AS ORIGINALLY SCOPED, kept as the record.

**The milestone that matters.** Create → schedule → lease → stage → execute → stream →
produce → review → cancel → audit, for one org's coding task, on **real E2B**.

**Gate to start:** Sprint 4 green. Needs the operator's E2B key — the keyed lanes
(`keyed-e2b-conformance.yml`) are **dispatch/sentinel-file triggered** and are *not* part of
`ci-required`. Any claim of real-E2B coverage must cite a dispatched run.

**Done when:** one full journey completes against real E2B with evidence retained. Promote
E7-1. **After this sprint, "distributed execution works" is a true statement.**

> **★ Still owed after this session (see `CLI-006-D2-result.md` §5).** (a) The operator fires the
> keyed provider lane (sentinel push — `workflow_dispatch` is unavailable off `main`) to prove the
> provider hops incl. the new artifact-commit case; it does **not** promote E7-1. (b) The full journey
> needs a **staging/testing-instance canary campaign** (the exit gate's named substrate —
> `docker-compose.staging.yml` + the `testing.armyofagents.org` deploy, both real-E2B but dormant/
> deploy-only today). **★ UPDATE — Sprint 5a (CLI-007) RESOLVED E7-F001**, so the code blocker
> ("the coding CLI cannot authenticate") is gone and the journey is now RUNNABLE; what remains is purely
> the operator-dispatched run. Only a cited dispatched run of that journey promotes E7-1.
>
> **★ UPDATE — Sprint 5b built the campaign harness + the operator runbook (`36114ca50`; see the §3.1
> Sprint 5b row and `CLI-006-campaign-result.md`).** Leg B **Part 2 LANDED** — the credential resolve over a
> REAL server-minted fence at embedded-PG (a real lease + a minted handle + a real Company key → a genuine
> `resolved` value; mutation-proven; promotes nothing). The **runbook** (`CLI-006-staging-canary-runbook.md`)
> gives the exact arming steps + the honest fact that the distributed fleet (`docker-compose.staging.yml`) is
> **not deployed today** (`deploy-testing.yml` = single-node app; real bring-up deferred to a REL/deploy
> task). **E7-1 STAYS `unwired`:** no dispatched run of the DISTRIBUTED journey on real E2B exists. The
> honest end-state is "campaign harness + runbook ready, staging run owed" — a legitimate, respected outcome.

---

### Sprint 6 — cut over the execution sinks
**Epic E10 · MIG-005/006/007 ACTIVE (create tickets), MIG-001 (node exists, no file)**

Today MIG-005/6/7 are **shadow observers** — they record a probe beside the legacy call and
change nothing. Cutting over means the sink actually routes to the distributed path.

**One sink at a time, each with its own soak. Do not batch.** Each owes its own rollback
evidence (gate clause 3 was explicitly not ticked for the three shadow sinks).

**★ RE-SCOPED 2026-08-27 (E10-F001) — no sink is buildable today; the real work is shared
prerequisites + the drain.** Making the first two cutover designs (MIG-005 Commander, MIG-007
extraction) and reviewing them established that **none** of the three sinks can cut over yet. They
share two unbuilt prerequisites — (1) distributed transfer routing exists only for `task_run`
(`run-execution-owner.ts`), and (2) the mint refuses every non-agent-coding run at guard 3
(`execution-secret-handle-mint.ts`), which is the SAME gate for `commander_turn`, `one_shot`, `service`,
`browser`, `system`. (An earlier version of this note said "lead with extraction because it rides the
mint" — the MIG-007 design proved that false: extraction's agentless principal refuses at guard 3 too,
AND extraction has a sync→async result-return blocker that would drop every extracted item.) **So Sprint
6's actual first tickets are the shared-prerequisite work** (a routing seam for non-`task_run` sources +
a mint-runner generalization to mint a Company key for an agentless run), **plus the sink-agnostic drain
fix, which is the only immediately-landable item.** Per-sink readiness, smallest gap first: extraction
(Company-key mint-runner change, but thin value — already sandboxed — and the result-return blocker) →
crew (agent-backed, may ride the mint, but shadow-refused on admission) → Commander (net-new per-user
credential class, largest). Details + citations in `qa/2026-08-27-breadth-terrain-audit.md` and
E10-F001.

**★ The executable first unit was [MIG-009 — the drain fix](./epics/E10-desktop-migration-realtime/tickets/MIG-009-drain-design.md) — now SHIPPED** ([result](./epics/E10-desktop-migration-realtime/tickets/MIG-009-drain-result.md); §3.1 row). The per-Company rollback grain and the missing `listActiveAttempts` SQL are fixed and proven at embedded-PG; `E10-1-drain` stays honestly `unwired` (its `drainAll` trigger is REL-005 scope). The sink cutovers wait on the shared prerequisites (routing seam + mint-runner generalization), which are scoped when Sprint 6 is next.

**Also here:** promote the E3 parity bridges (`jobApprovalBridge`, `jobBudgetCostBridge`,
`jobOutputBridge`) — all currently zero-caller. **(`createDistributedExecutionDrain`'s
`assertRollbackSafe(organizationId)`/`companyId` grain bug + its missing `listActiveAttempts`
SQL are FIXED — MIG-009 SHIPPED; the drain is correct when wired, its trigger owed to REL-005.)**

**Write the terrain + design at sprint start** against the code as it exists then.

**★ Terrain-verified 2026-08-27** (`qa/2026-08-27-breadth-terrain-audit.md`). All claims hold. Three
additions for the plan: (1) there are **five** parity bridges, not three — `jobAuditBridge` is also
zero-caller and tracked by **no** gate clause; (2) ~~the drain needs more than the `organizationId`/
`companyId` rename — `listActiveAttempts` has **no SQL impl**~~ — **DONE (MIG-009): the per-Company
grain + the real `listActiveAttempts` SQL shipped, proven at embedded-PG**; `createExecutionTargetRevocationFanout`
(E3-18) remains zero-caller with a live producer; (3) **Deferral #1** (no provider credential) blocks the
sinks going *active*. Favorable: MIG-002's per-sink dial shipped, so "one sink at a time" is now
actually expressible.

---

### Sprint 7 — browser agents
**Epic E8 · BRW-004 (dependency-ready), BRW-005, BRW-006; BRW-007/008 need nodes**

`packages/browser-runtime` has **zero importers** — nothing stages `runner.ts`. Sprint 3
gives it an execution path.

**Also here, and it is a live security item:** E8's gate says *"no host-side browser spawn is
reachable from a boot root."* **That is false today** — `cli-mode.ts:347` spawns
`npx @playwright/mcp --headless` whenever `browser_use` is enabled, reached from
`heartbeat-mcp.ts:165` and `aoa-agents/runner.ts:795`. Either close it or rewrite the clause.

**★ Terrain-verified 2026-08-27** (`qa/2026-08-27-breadth-terrain-audit.md`). Still live — and worse
than the note says: the "no host-side spawn" clause has **zero automated coverage**. The wiring
register tracks only the positive `runBrowserSession` symbol, not this negative clause, so
`check-gate-clause-wiring.mjs` cannot catch it and it stays green-by-absence while false. The guard
that would flag it is **BRW-008's anti-orphan check, which does not exist** (no ticket, no node).
Also: Sprint 3 did **not** deliver `browser-runtime`'s execution path — it still has zero importers.

**Write designs at sprint start.**

---

### Sprint 8 — service agents
**Epic E9 · SVC-002 (dependency-ready) through SVC-007**

SVC-001 landed the storage half. The immutable-generation guarantee is currently enforced
only by table grants — **no code writes `service_generations`**, so it describes a property
of an empty table. Long-running services need dispatch (Sprint 3) plus health/restart/drain.

**★ Terrain-verified 2026-08-27** (`qa/2026-08-27-breadth-terrain-audit.md`). All claims hold, with
one sharpening: **service dispatch is not reachable at all yet** — the daemon is batch-only
(`SUPERVISABLE_WORKLOAD_CAPABILITIES = ["workload.batch"]`, `serviceSlots: 0`), so **enabling
`workload.service` dispatch is a prerequisite step before** health/restart/drain, not a given. And
E9 has **no gate-clause entry** in the wiring register — create one so a false "E9 complete" can be
caught the way E3-E11 are.

**Write designs at sprint start.**

---

### Sprint 9 — hardening and release
**Epic E11/E0 · REL-FOUNDATION-GATE (unit 1, SHIPPED) → REL-003 (unit 2, SHIPPED — verifiers + runbook; live rehearsal owed) → REL-001/002/005 (blocked on S7/S8)**

**Read this before planning:** E0's gate passes because all **30 of 30** Critical/High trust
crossings *name* a REL release test — but `check-distributed-execution-foundation.mjs:745-751`
accepts a non-empty *string* (or a `REL-\d+`-shaped `ownerTicket`) as proof and never checks the
ticket file exists. **6** of the 30 name the written **REL-004**; the other **24** name
REL-001/002/003/005, which have **never been written**. So E0 reports PASS over 24 unwritten release
gates, and will keep doing so.

**Unit 1 is the checker fix — but NOT the naive "require exist on disk" flip.** ★ CORRECTED
2026-08-27 (review round 2): a hard-strict flip would red the always-on `policy` job
(`pr.yml:161`) → `ci-required` on **every** PR until all four unwritten REL tickets land. Since §2.0's
timeout is RESOLVED (PR #327), a red required check now **BREAKS** the gate — the earlier "flips E0 to
honestly-red until E11 lands / two lines from honest" framing predates CI going green and is now
**wrong; DO NOT act on it.** The resolution is a **trackable-strict gate** (the `finding-ownership`
`unowned`-with-reason pattern, one level up): a named REL ticket is admissible if its `-design.md`
exists OR is declared, with a reason, in a new deferral manifest
`docs/architecture/distributed-execution-release-tests.json`. It ships **0-error at rest** (6 pass on
written REL-004, 24 on manifest-deferral — verified + adversarially reviewed), so `ci-required` stays
green while E0 becomes honest (the 24 unwritten tests = machine-tracked debt). When each REL ticket
lands and removes its deferral, the checker collapses into the pure existence check the old framing
wanted. Full design + the review-round-2 corrections:
`epics/E11-hardening-release/tickets/REL-FOUNDATION-GATE-design.md`; §9 has the copy-paste prompt.

**Sprint 9 does NOT complete in one pass.** Only **unit 1** (the gate — SHIPPED CI-green) and **unit 2**
(REL-003, dependency-ready DR/migration rehearsal — deps DEP-006/MIG-002/E10-REALTIME-FOUNDATION all
landed) are buildable today. **Unit 2 is now SHIPPED** (see §3.1): the session-buildable verification
core (two NEW mutation-tested pure verifiers + three reuse lanes, 31 tests green) + the operator runbook
landed, E11-F002 filed, a 3-agent adversarial pass on the implementation found 0 HIGH surviving — but
**the live staging rehearsal is the OWED operator leg** (measured RPO/RTO, real backup/restore,
pre-0188→prior→candidate, live injection, timed rollback), so **REL-003 does not promote to done** and
promotes only on a cited live run. REL-001/002 hard-block on Sprints 7/8 (BRW-006/SVC-006/007) and REL-005 on all of
them — a green gate is **NOT** license to attempt them (the §2.4 STOP trap against absent workloads).
**Residual named by the review:** the foundation checker's own test suite is `unrun` and wired into
no CI job, so the gate ships enforced-at-rest but **not against-regression** (the CLI passes at rest
under both the vacuous and the strict form); fixing that — the census's "single highest-value item"
(the `additionalProperties` mutate no-op + move the suite into `policy`) — is a candidate later S9
hardening unit.

---

## 5. Known debt, carried deliberately

Not blockers; do not rediscover them.

| Item | State |
|---|---|
| **Security guards with no falsifiable test** | `egress-policy.ts:199` is a **real fail-open** (deleting the fail-closed guard passes the suite — reproduced). Also `worker-session-auth` (22 of 25 guards deletable, unverified on Linux), `worker-device-proof` (Ed448 accepted; garbage `issuedAt` makes the skew window vacuous), `policy.ts` path grammar. **All protect the DORMANT path — fix before Sprint 3, not after.** |
| **dependency-graph regex** | `[A-Z]{3,4}` cannot match `TRACK`, so the checker that stops graph drift is blind to TRACK-001/002. Widening to `{2,5}` was **measured**: it fails the self-test and the checker, because the crosswalk-dominance computation shares the regex. Needs its own ticket. |
| **5 ticket families invisible to the coverage checker** | `GATE-clause-3-rollback`, `DEFERRAL-1-credential`, `E4-D12-live-dispatch`, `CLI-realE2B-hardening`, `REL-FOUNDATION-GATE` — no 3-digit id, so the checker skips them (both `expandTicketIdsFromFilename` and `parseAuthorityNodes` require `\d{3}`). Three are the Wave-3/4 blocker artifacts; `REL-FOUNDATION-GATE` (S9 unit 1) is graph-inert **by design** — its enforcement is the CLI checker in the `policy` job, not a coverage node. |
| **Foundation checker's own test suite is `unrun` + in no CI job** | `check-distributed-execution-foundation.test.mjs` is RED at tip (one `additionalProperties:false` mutate no-op; the general `mutate` mechanism works — `valid: the real repository passes` is green) and kept out of `policy` (`status:"unrun"` in `test-execution-census.json`). So S9 unit 1's release-test gate ships enforced-at-rest but its M0–M8 regression tests don't run in CI. The census calls fixing the mutate no-op + moving the suite into `policy` **"the single highest-value item"** — a candidate S9 hardening unit. |
| **TRACK-003 / BRW-007 / BRW-008** | Shipped or scoped with no `#### ID` node. |
| **E2's gate cites a failing revision** | `README.md:6` names `acf2b32fb`, which its own artifact table records as `blocked_external`, superseded by a pass at `9a5455071f8c`. |
| **E6 clause 7** | The DEP-009 shared-admission proof **re-implements** the advisory-lock SQL inline in the test rather than calling `admitAttemptCapacity` — change the production key and the test stays green. |
| **brand-check guard 9 is blind to the `ENV`-map convention** | `pr.yml:650-663` matches only literal `process.env.AOA_[A-Z_]+`, and `worker-daemon/src/config/config.ts` reads through an `ENV` map — so a new `AOA_WORKER_*` switch can ship undocumented with **no guard firing**. Three new operator-facing switches arrive in Sprints 2 and 3; two get documented by author discipline and one would not. The standing fix is to extend guard 9 to the map convention. |
| **`check-execution-census` trips on any new `*.test.mjs`** | Not a defect — it is working as designed — but it is the guard most likely to redden a sprint that adds a script test and forgets `scripts/test-execution-census.json`. Sprint 3 adds two. |
| **Kill switch has no write path** | `evaluateKillSwitches` is genuinely wired, but throwing it means hand-executed SQL, instance-wide per provider, no Organization or sink dimension. REL-005 scope. |

**Retired 2026-08-27:** the `verify` 60-min timeout drag (§2.0). `verify` was sharded into a 4-way
`fail-fast:false` matrix (`pnpm exec vitest run --shard=i/4`, cap unchanged), and the two failures the
timeout had been masking were fixed (the `normalized` ReferenceError and the `redact-sensitive`
multi-MB-body hang). `ci-required` now goes green (PR #327, run `33037143412`). No longer carried
debt. Plan + evidence: `docs/replatform/CI-VERIFY-PARALLELIZATION.md`.

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
| **D-5** | WRK-011 §5.2: inside a ratified ceiling, the self-hello-refresh route lets an **already-enrolled** device flip itself from unmatchable to matchable with **no further operator action** — so an admin ratifying a placement profile for one future well-isolated device enables **every** device already enrolled on that target. Make the **target** the unit of admin intent (option a), or gate each device behind a **per-worker activation flag** (option b)? | **Option (a): the target is the unit of admin intent, plus a structured audit record.** Taken at Sprint 2.75 planning, before Step 1, by the same authority that took D-2/D-3. | WRK-011 ships (a): **no fifth guard, no new column, no migration — the size stays L.** The refresh route emits a structured audit line (`action: "worker.hello.refreshed"`, worker id, target id, old hash, new hash, capability delta) at the `execution_target.placement_profile.ratified` log-site style (`execution-targets.ts:305-310`). The residual (WRK-011 §5.2 / R4) is **accepted as bounded**, on three code-proven grounds already in the design: (1) admin ratification of a per-target ceiling already *is* the statement "devices on this target may take this work" — the device is what would execute the job either way; (2) the durable snapshot only ever records claims the device itself signed under its own device key within that ceiling (refuse-don't-clamp, G2/G3); (3) the frozen matcher intersects `ceiling ∩ reported` and the worker report "can only ever narrow, never widen" (`capabilities.ts:28-34`, §5.1 layer 3), so the residual is ceiling-bounded, not unbounded. It is the **same hazard shape** as E4-F011 (a provider landing in the desktop root) at a different seam — made *reachable* by this ticket, not *created* by it — and is the price of removing the human re-paste step E4-F007/WRK-010 exist to remove. **Option (b) is rejected here** (not forever): it would add a fifth admission guard, a `workers` column, an admin route + UI, a migration, and a new refusal reason, turning L into XL, for a governance grain finer than the per-target ceiling an admin already sets. If a later multi-tenant hardening pass wants per-device approval, it re-opens this row with a successor decision. |

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
> entry. **★ CLOSED 2026-08-25 — WRK-011 SHIPPED and E4-F010 is `resolved`** (status flipped +
> manifest key deleted in the same commit); the register's `unowned` list is now E4-F013/F014/F015
> (a new LOW **E4-F016** was filed `accepted`). Nothing
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
- Commit, push, and report CI honestly. **`verify` is now a 4-shard matrix and §2.0 is RESOLVED
  (as of 2026-08-27, PR #327) — `ci-required` should PASS.** If a shard goes red, it is a REAL
  failure this sprint must own (not an inherited timeout); investigate, don't dismiss it.

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
2. docs/replatform/epics/E4-worker-daemon/tickets/WRK-010-design.md §9.1 (when the thunk
   fires, how much headroom) AND §9.1.1 (the E4-F012 first-session decision — adopt it).
3. WRK-010-result.md (Sprint 1's output) for what actually shipped.

STEP 1 IS TO WRITE THE PLAN, to the same standard as the Sprint 1-3 designs: verified state
at tip with citations, architecture, fail-first TDD steps, a mutation table, and an acceptance
table mapping each clause to the test that proves it. Save it as
epics/E4-worker-daemon/tickets/WRK-010-slice-2-design.md. Then execute it.

Why this sprint exists — do not lose the thread: after Sprints 1, 2 and 3 as originally
sequenced, the renewal route Sprint 1 built would have had ZERO CALLERS, because slice 2b
wired the session's renew to Enroller.renew — the enrolment CODE REPLAY, which only survives
the ~10-minute code route. This sprint is what makes Sprint 1 worth having.

E4-F012's MECHANISM IS ALREADY DECIDED — do not re-derive it. WRK-010 §9.1.1 ("E4-F012,
DECIDED") records the full decision with its security argument: (1) enrollOnce gains a session
SINK (not a return), so the enrolment session reaches the store without ever entering the
loggable EnrollmentOutcome — I13's invariant is about the RETURN VALUE, and §9.1.1 quotes the
source docblock proving it; (2) SessionStoreDeps.renew changes signature from zero args to
renew(current: WorkerSession), so the no-session first call becomes a compiler error rather than
something a reviewer must catch. ADOPT that mechanism. Your remaining job is to IMPLEMENT and
PROVE it, and to close any residual §9.1.1 flags — in particular, be explicit in the plan about
where the FIRST session comes from on every boot path the composed daemon actually takes (the
sink fires at enrolment; state what happens on a boot that does not re-enrol), so "the route has
a production caller" is genuinely reachable and not just compile-clean.

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
- packages/worker-daemon is `pinned` in scripts/test-inventory.json (the exact count moves
  every sprint that adds daemon tests — read the current value, do not trust a number quoted
  here). Adding daemon tests without bumping it reds check-test-inventory.mjs; `server` is
  `floor` and does not bite.
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

### Sprint 4 — DAT-008 slices 5 and 7: credentials reach the sandbox

**First of the scope-only sprints. Step 1 is WRITE THE PLAN(S).** The generic 4–9 template
below still applies; this card fills in the E5 specifics so you do not have to.

```text
Work in the git worktree C:\e3 on branch docs/replatform-program.

Read first, in this order:
1. docs/replatform/GO-BOOK.md — §2.0 (the CI blocker), §2 (the per-ticket process),
   §4 "Sprint 4", §5 (debt carried deliberately), and §8 (settled decisions D-1..D-5).
2. The DAT-008 PARENT design in docs/replatform/epics/E5-.../ (find it under the E5 epic;
   the server half — handle minted at placement, advertised in the lease envelope, resolve
   route live — is already done; this sprint is the WORKER half).
3. The result docs of Sprints 1, 2, 2.5, 2.75 and 3 — the record of what actually shipped.
   In particular WRK-008-slice-2b-result.md: it composed createPollLoop + createSupervisor,
   which is what slice 7 (warm resume) would attach to IF it exists.

STEP 1 IS TO WRITE TWO PER-SLICE DESIGN DOCS, to the same standard as the Sprint 1-3 plans
(verified state at tip with path:line citations, architecture, fail-first TDD steps, a
mutation table with DELETE-not-rewrite guards + a positive control first, and an acceptance
table mapping every clause to a test that could turn RED). Save them under the E5 epic's
tickets/ directory, each with a matching "#### <ID>" node in program-design.md (or
check-ticket-graph-coverage.mjs reds). Then execute them.

TWO TERRAIN FACTS TO RE-VERIFY AT STEP 0 — the scope note is written from a pre-Sprint-3
tree and Sprint 3 changed the composition:
- SLICE 5 (worker redemption + env synthesis + canary seeding): worker-daemon still has ZERO
  runtime references to `secretHandle` (verified post-S3) — the gap is real, this is the work.
  And `redactionCanaries` is now a REQUIRED field on the fence-close proxy
  (`lease/fence-close-proxy.ts:141`), no longer `?? []`. Confirm whether it is threaded
  PER-RUN or still PER-SUPERVISOR before seeding anything — slice 5 must make it per-run.
- SLICE 7 (warm-resume re-resolution): the scope note says "provider.restore has no
  production caller." That may have changed — `supervisor/effect-authority.ts:96` calls
  `this.#provider.restore(...)`, and Sprint 3 composed the supervisor. CHECK whether that path
  is now reachable from a production caller. If warm resume STILL has no production mechanism
  (no lease pause/resume), slice 7 has nothing to attach to — SAY SO and defer it rather than
  building against an absent mechanism. Do not invent the mechanism to give slice 7 a target.

Binding rules:
- Sprint 3 green first. Fail-first: RED for the reason written down, then implement.
- Mutation-test every guard by DELETION, positive control first. A credential-redemption path
  that fails OPEN is the worst defect class here — a denied redemption must fail CLOSED, and a
  mutant that deletes the fail-closed branch must turn a test red.
- packages/worker-protocol is FROZEN. A new frozen worker-control operation or a new field on
  an existing frozen schema is a §8 freeze decision BEFORE any code — do not "just add a field".
- Never serialize a provider key or a redeemed secret into a prompt, a protocol message, an
  event, or a log line (Decision #104 / the redaction discipline). The canary seeding exists to
  catch exactly that; prove it catches a planted leak.
- Cite living documents (this go-book, findings registers, the manifest) by SECTION AND ID,
  never by line.
- New *.test.mjs files → add to scripts/test-execution-census.json in the same commit. New
  AOA_* switch → document it in docs/deploy/environment-variables.md (brand-check guard 9 is
  blind to the ENV-map convention). Bump the worker-daemon test-inventory pin from its CURRENT
  value (read the file — it moves every sprint).

BEFORE you call it done, run an ADVERSARIAL REVIEW with subagents — the step that has caught a
real, often-HIGH defect on every ticket in this programme.
- Independent reviewers, one per dimension you changed; each reports only what it verified by
  opening source. Zero findings is a respected answer.
- For every HIGH/BLOCKING, a SKEPTIC told to REFUTE it, defaulting to "refuted" if it cannot
  reproduce the finding from source — ~3 in 4 die on inspection here.
- Because each deliverable includes a PLAN, add a COMPLETENESS CRITIC: "do NOT re-review the
  plan; ask what is MISSING, and whether what this sprint BUILDS (a redeemed handle reaching a
  sandbox) matches what Sprint 5's journey CONSUMES, by name, signature and package."
- Do NOT delegate to a plan-writing or auto-fixing skill — the house format and the
  DELETE-the-guard mutation discipline are stricter, and they are what the registers and CI check.

When green:
- Run all five registers; every one must pass.
- Write a result doc per slice: what shipped; whether slice 7 had a mechanism to attach to or
  was deferred and why; the mutation line; which E5 gate clause (E5-5) you promoted and on what
  evidence; and every claim you could not prove.
- Update GO-BOOK.md §3.1 and §4 Sprint 4 to what is now true.
- Commit, push, and report CI honestly — including `verify`, red for reasons predating this
  sprint (§2.0). Do not raise its timeout to mask it.

If you find something mid-sprint that invalidates the plan's premise, STOP and say so.
```

### Sprint 5 — prove ONE real journey (CLI-006 / the D2 lane)

**The milestone: after this, "distributed execution works" is a TRUE statement — not a
composed one.** Unlike S1–S4, this sprint **cannot finish headless**: the real-E2B green
needs the operator's E2B key and a **dispatched** run of `keyed-e2b-conformance.yml`, which is
`workflow_dispatch`-triggered and deliberately **not** part of `ci-required`. The session does
everything up to that line; the dispatched run is the operator's action. See the ★ boundary
below.

```text
Work in the git worktree C:\e3 on branch docs/replatform-program.

Read first, in this order:
1. docs/replatform/GO-BOOK.md — §2.0, §2, §4 "Sprint 5", §5 (debt), §8 (D-1..D-5).
2. docs/replatform/epics/E7-coding-e2b/tickets/CLI-006-design.md, CLI-006-result.md, and
   CLI-006-seam-plan.md — the coding-journey ticket already exists; this sprint RUNS its D2
   lane end to end on REAL E2B, it does not re-invent it.
3. The result docs of Sprints 1–4 — the composed loop (S3), the provisioning that makes a
   worker matchable (S2.75), and the redeemed-credential path (S4) are the pieces the journey
   now threads together.
4. .github/workflows/keyed-e2b-conformance.yml — the dispatch-triggered real-E2B lane. Note
   its triggers (`workflow_dispatch` + a sentinel-file push path) and that it is NOT in
   `ci-required`.

★ STATE AT SPRINT START (post-CLI-007). E7-F001 is RESOLVED — Sprint 5a (CLI-007) fixed the
mint's guard 2 AND guard 4, so a real canary now mints a Company `provider_key` handle and the
worker redeems a real credential in the sandbox. The last CODE blocker is gone; the journey is
runnable. Re-verify that at Step 0 (E7-F001 should be `resolved` in the findings register and
absent from the ownership manifest) — if it is still open you are out of sequence, STOP.

THE JOURNEY TO PROVE (one org's coding task):
create → schedule → lease → stage → execute → stream → produce → review → cancel → audit.

★ DO IT IN TWO STEPS — cheap first, then spend the operator's key. This ordering exists because
CLI-007 found a gap (the mint never minted for a real run) that only surfaced on the REAL
executor path, not on a manufactured one. Prove it free before spending real E2B.

STEP 1 — THE FULL JOURNEY ON THE D1 FAKE-PROVIDER LANE, end to end, no key, no spend. Now that
the canary mints a credential, drive create→…→audit against the D1 fake provider and prove every
hop with real evidence (not a per-hop mock). This is itself a milestone: it is what lets E4-1
(leases-through-protocol) and any other clause be promoted ON EVIDENCE — a composed loop that
actually took a lease and ran a task. If a hop is still unwired, that hop is the work — build it
fail-first to the Sprint 1–3 standard.

STEP 2 — THE REAL-E2B DISPATCH (operator-owned). Only once Step 1 is green end to end, prepare
the dispatch (the workflow input, the sentinel file, the exact `gh workflow run
keyed-e2b-conformance.yml` command) and hand it to the operator, OR trigger it yourself if a run
is available — triggering does not require the key, the run reads it from repo secrets. A local
mock is NOT evidence for a keyed hop.

★★★ THE BOUNDARY — WHAT THE SESSION DOES vs WHAT THE OPERATOR DOES. State this in the plan and
hold to it:
- The SESSION may: build/repair every hop's wiring; run everything that runs without a live
  E2B key (unit, embedded-PG, contract); prepare the dispatch (the workflow input, the
  sentinel file, the exact `gh workflow run keyed-e2b-conformance.yml` command); and, once a
  dispatched run exists, READ its logs/artifacts as the evidence.
- Only the OPERATOR can: supply the E2B key (a provider secret — never ask the session to
  enter or handle it) and TRIGGER the dispatched run. If the key/run is not available in-
  session, STOP at the dispatch boundary, hand the operator the exact command + what to
  capture, and say plainly "the real-E2B leg is unproven until a dispatched run is cited." Do
  NOT fabricate, assume, or mock-substitute a real-E2B pass.

★★★ E7-1 PROMOTION IS THE VACUOUS-GREEN TRAP OF THE WHOLE PROGRAMME. E7-1-coding-journey is
`unwired` with expectedReferences: 2. Promote it to `wired` ONLY on a CITED dispatched real-E2B
run that actually completed the journey — never on a composed loop, a local fake provider, or a
skipped/green-by-skip lane. The go-book §4 Sprint 5 says it in one line: "Any claim of real-E2B
coverage must cite a dispatched run." If no dispatched run exists yet, E7-1 STAYS unwired and
the sprint is "harness ready, journey unproven" — an honest state, not a failure.

Binding rules:
- Sprint 4 green first. Fail-first; mutation-test new guards by DELETION, positive control first.
- packages/worker-protocol is FROZEN.
- Never serialize a provider key or redeemed secret into a prompt, event, protocol message, or
  log (Decision #104). The S4 canary seeding is your tripwire — a planted leak must be caught.
- Cite living documents by SECTION AND ID, never by line. New *.test.mjs → test-execution-census
  in the same commit; new AOA_* switch → environment-variables.md; bump the worker-daemon
  test-inventory pin from its CURRENT value.

BEFORE you call it done, run the ADVERSARIAL REVIEW: independent reviewers per changed
dimension; a SKEPTIC to REFUTE each HIGH (default refuted if not reproducible from source); and
— because the deliverable includes a plan and an end-to-end claim — a COMPLETENESS CRITIC asked
"what hop is proven only by a mock, and does the evidence chain actually reach real E2B?" Do NOT
delegate to a plan-writing or auto-fixing skill.

When green (to the extent the session CAN close it):
- Run all five registers.
- Write CLI-006 / D2 result notes: which hops are proven on real E2B (with the dispatched run
  id), which are proven only locally, whether E7-1 was promoted and on what cited evidence, and
  the exact operator step still owed if the dispatched run is not yet in hand.
- Update GO-BOOK §3.1 and §4 Sprint 5 to what is now true — including, honestly, if the real-E2B
  leg is still pending an operator-dispatched run.
- Commit, push, report CI honestly (`verify` is now a sharded matrix — §2.0 RESOLVED, so `ci-required` should PASS; a red shard is a real failure to own, not an inherited timeout).

If you find something mid-sprint that invalidates the premise, STOP and say so.
```

### Sprint 5a — CLI-007: give the canary a real credential (unblocks the journey)

**The one code blocker between "harness ready" and a provable real-E2B journey.** Sprint 5
found and filed E7-F001: the canary sandbox gets no provider credential, so the execute hop
can't run a credentialed task even on real E2B. This ticket fixes that. It is **pure code — no
E2B key, no dispatched run, no operator step.** Once it lands, Sprint 5's journey becomes
runnable (that run, with your key, is the separate step that finally promotes E7-1).

```text
Work in the git worktree C:\e3 on branch docs/replatform-program.

Read first, in this order:
1. docs/replatform/GO-BOOK.md — §2.0 (the CI blocker), §2 (the per-ticket process), §8 (D-1..D-5).
2. docs/replatform/epics/E7-coding-e2b/findings.md — E7-F001, the finding this ticket owns.
   It traces the mechanism end to end. RE-VERIFY every path:line it cites against the tree as
   it is now — the finding was filed at tip 88c6a8b66 and the tree moves.
3. docs/replatform/epics/E7-coding-e2b/tickets/CLI-007-design.md — the scoping doc: what this
   ticket must NOT do (do not just set credentialKind non-null — it breaks placement-digest
   replay; do not weaken the mint's owner-authority gate), and the shape of the fix.
4. The DAT-008 result docs (Sprint 4) and CLI-006-design.md / CLI-006-result.md — the credential
   path this rides on, and why the canary binding is four explicit nulls.

STEP 1 IS TO WRITE THE FULL DESIGN, to the Sprint 1-3 standard (verified state at tip with
path:line citations, architecture, fail-first TDD steps, a mutation table with DELETE-not-rewrite
guards + a positive control first, and an acceptance table mapping every clause to a test that
could turn RED). Overwrite CLI-007-design.md with it. Then execute.

THE FIX, and its three hard constraints (all provable, all in the acceptance table):
- A canary placement must mint a Company-key `provider_key` execution-secret handle (or an
  explicitly reasoned equivalent) so the canary lease envelope carries a NON-EMPTY secretHandles
  and the worker redeems a real credential in the sandbox. The Company already configures a
  model-provider key (Decision #104); the canary rides that COMPANY authority, never a personal
  subscription credentialKind. Establishing the canary's owner authority belongs in the preflight
  (canary-preflight.ts), per CLI-006.
- The PLACEMENT-DIGEST REPLAY INVARIANT MUST STILL HOLD — a canary places to the same digest
  across attempts. Breaking it is the exact failure mode this ticket exists to avoid; prove it
  holds with a test, and make a mutant that breaks replay turn that test red.
- The MINT'S OWNER-AUTHORITY GATE STAYS FAIL-CLOSED AND UNCHANGED IN STRENGTH — it still refuses
  a genuine disagreement. The canary now presents a LEGITIMATE owner authority; you do not remove
  or loosen the check. A mutant that lets a null through must turn a test red.

Binding rules:
- Sprints 1-5 green first. Fail-first: RED for the reason written down, then implement.
- Mutation-test every guard by DELETION, positive control first.
- packages/worker-protocol is FROZEN. A new frozen worker-control op or a new field on a frozen
  schema is a §8 freeze decision BEFORE any code — do not "just add a field".
- NEVER serialize a provider key or redeemed secret into a prompt, event, protocol message, or
  log line (Decision #104). Prove the canary key never leaves the sandbox and never reaches a
  log — the S4 canary seeding is your tripwire; a planted leak must be caught.
- Fail-closed is the invariant: a canary that cannot establish owner authority gets NO handle and
  degrades visibly — it never double-executes or leaks.
- Cite living documents (this go-book, findings registers, the manifest) by SECTION AND ID, never
  by line. New *.test.mjs → test-execution-census in the same commit; new AOA_* switch →
  environment-variables.md; bump the worker-daemon/server test-inventory pin from its CURRENT
  value (read the file).

BEFORE you call it done, run the ADVERSARIAL REVIEW with subagents — the step that has caught a
real, often-HIGH defect on every ticket in this programme.
- Independent reviewers, one per dimension changed; each reports only what it verified from source.
- A SKEPTIC per HIGH/BLOCKING, told to REFUTE and default to "refuted" if it cannot reproduce the
  finding from source (~3 in 4 die on inspection here).
- A COMPLETENESS CRITIC: "does the canary now get a credential WITHOUT breaking replay or
  weakening the gate, and does the security argument hold that the Company key never leaves the
  sandbox and never reaches a log?"
- Do NOT delegate to a plan-writing or auto-fixing skill.

When green:
- Run all five registers; every one must pass.
- E7-F001 RESOLVES HERE: in the SAME commit, flip its status in
  epics/E7-coding-e2b/findings.md AND delete its key from scripts/finding-ownership.json. Doing
  one without the other reddens the always-on policy job.
- Write CLI-007-result.md: what shipped; the mutation line; the replay-invariant proof; the
  security argument; and — explicitly — that this UNBLOCKS but does NOT promote E7-1 (that still
  needs a cited dispatched real-E2B run of the full journey).
- Update GO-BOOK §3.1 and §4 (note that the journey is now runnable, E7-1 still pending its run).
- Commit, push, report CI honestly (`verify` is now a sharded matrix — §2.0 RESOLVED, so `ci-required` should PASS; a red shard is a real failure to own, not an inherited timeout).

If you find something mid-sprint that invalidates the premise, STOP and say so.
```

### Sprint 5b — the staging-canary campaign (the E7-1 promoter, the last mile)

**This finishes the milestone.** Sprint 5 proved the worker layer real (E4-1/E4-2 wired) and the
provider hops on real E2B. What's left is the JOINED journey — create→schedule→lease→execute→
review on a real E2B sandbox through the distributed path — which promotes **E7-1** and only then
makes "distributed execution works" true. **This is a live-infrastructure campaign with real
spend, not a pure code session.** Hold the operator/session boundary below; do not fake a green.

```text
Work in the git worktree C:\e3 on branch docs/replatform-program.

Read first, in this order:
1. docs/replatform/GO-BOOK.md — §2.0, §2, §4 "Sprint 5" (the "Still owed" note), §8.
2. docs/replatform/epics/E7-coding-e2b/tickets/CLI-006-D2-result.md — §5 names the owed
   staging-canary campaign and the substrate. This sprint executes that.
3. CLI-006-design.md / CLI-006-seam-plan.md — the journey hops.
4. The result docs of Sprints 5 and 5a — E4-1/E4-2 are wired on evidence; CLI-007 made the
   canary mint a real credential. Those are the pieces this campaign joins on real E2B.
5. docker-compose.staging.yml and any testing.armyofagents.org deploy notes — the real-E2B
   distributed substrate this campaign runs on (dormant until armed).

STEP 0 — SEQUENCE + SUBSTRATE CHECK. Confirm E4-1/E4-2 are `wired` and E7-1 is still `unwired`
(else out of sequence, STOP). Then establish, from source and config, exactly what arming a
canary Organization on the staging substrate requires: the rollout dial (canary mode), the
preflight's Company provider-key generation (CLI-007's authority), a real enrolled worker, and
the E2B key on that substrate. Write it down as a RUNBOOK before touching anything.

THE JOURNEY TO PROVE ON REAL E2B (one canary Organization):
create → schedule → lease → stage → execute → stream → produce → review → cancel → audit,
with the credential resolved over a LIVE FENCE (Leg B Part 2 — DAT-008 §8's residual folds in
here: a real fence + a minted handle + a Company provider-key store aligned in one harness).

★★★ THE OPERATOR/SESSION BOUNDARY — state it in the runbook and hold it:
- The SESSION may: verify every hop's wiring against source; build/repair any missing journey
  harness fail-first to the Sprint 1-3 standard; run everything that runs without live staging
  or a real key (unit, embedded-PG); prepare the EXACT campaign steps (arm the canary Org,
  enroll the worker, run the journey, where the evidence lands); and, if a dispatched
  staging run exists, READ its evidence.
- Only the OPERATOR can: stand up / reach the staging substrate, arm the canary Organization,
  authorize the real E2B spend, and run the campaign. The E2B key is a provider secret — never
  ask the session to enter or handle it. If the session cannot reach the live substrate, STOP
  at that boundary, hand the operator the runbook + the exact commands + what evidence to
  capture, and say plainly "the E7-1 leg is unproven until a cited staging-canary run exists."
  Do NOT mock-substitute a real-E2B journey.

★★★ E7-1 PROMOTION — THE PROGRAMME'S CENTRAL VACUOUS-GREEN TRAP, at its highest-stakes moment.
Promote E7-1-coding-journey to `wired` ONLY on a CITED dispatched real-E2B run that actually
completed the DISTRIBUTED journey (create/schedule/lease/review) end to end — never on the keyed
provider lane (that proves primitives, not the journey), never on a D1 fake-provider run, never
on a local harness. If no such run exists, E7-1 STAYS `unwired` and the honest end-state is
"campaign harness + runbook ready, staging run owed" — a legitimate, respected outcome, not a
failure. "Any claim of real-E2B coverage must cite a dispatched run" (go-book §4 Sprint 5).

Binding rules:
- Sprints 1-5 + 5a green first. Fail-first; mutation-test new guards by DELETION, positive
  control first.
- packages/worker-protocol is FROZEN.
- NEVER serialize a provider key or redeemed secret into a prompt, event, protocol message, or
  log (Decision #104). The S4 canary seeding is the tripwire; prove a planted leak is caught,
  and prove the live-fence resolve puts the value ONLY inside the sandbox.
- Fail-closed everywhere: a canary that cannot establish authority or resolve a credential gets
  no run, degrades visibly, never double-executes.
- Cite living documents by SECTION AND ID, never by line. New *.test.mjs → test-execution-census
  same commit; new AOA_* switch → environment-variables.md; bump pins from CURRENT values.

BEFORE you call it done, run the ADVERSARIAL REVIEW: independent reviewers per changed dimension;
a SKEPTIC to REFUTE each HIGH (default refuted if not reproducible); and a COMPLETENESS CRITIC:
"does the evidence chain actually reach real E2B through the DISTRIBUTED journey, or does it stop
at a mock/keyed-lane/D1 boundary that is being passed off as the journey?" Do NOT delegate to a
plan-writing or auto-fixing skill.

When green (to the extent the session CAN close it):
- Run all five registers.
- Write CLI-006-campaign-result.md (or extend the D2 result): which hops are proven on real E2B
  through the distributed journey (with the dispatched run id), which are proven only locally,
  whether E7-1 was promoted and on what cited evidence, and the exact operator steps still owed
  if the staging run is not yet in hand.
- Update GO-BOOK §3.1 and §4 Sprint 5 to what is now true — honestly, including if E7-1 is still
  pending an operator-run staging campaign.
- Commit, push, report CI honestly (`verify` is now a sharded matrix — §2.0 RESOLVED, so `ci-required` should PASS; a red shard is a real failure to own, not an inherited timeout).

If you find something mid-sprint that invalidates the premise, STOP and say so.
```

### CI hardening — parallelize `verify` (retire the §2.0 timeout before S6)

**Retire the §2.0 CI drag before the breadth sprints.** `verify` is one 60-min job that times out
on volume (~165 embedded-PG integration tests, one lane); after E4-F017 the timeout is its ONLY red
reason. Shard it into a parallel matrix so `ci-required` goes green. **Self-contained — no operator
step, no real spend.** (The MEMORY.md consolidation is already done — not part of this session.)

```text
Work in the git worktree C:\e3 on branch docs/replatform-program.

Read first, in this order:
1. docs/replatform/GO-BOOK.md — §2.0 (the verify timeout — do NOT raise it), §2 (the per-ticket
   process), §5 (debt), and the CI-platform notes in §1/the CI status section.
2. docs/replatform/CI-VERIFY-PARALLELIZATION.md — the scoping doc: the measured problem, the
   hard "do NOT"s (don't raise the timeout, don't break the ci-required wiring, no paths filter),
   the fix shape, and the acceptance.
3. .github/workflows/pr.yml — the `verify` job (~:729) and the `ci-required` aggregator (~:1316,
   its `needs` lists `verify` BY NAME, and it computes the verdict from needs.*.result). Read
   how R_VERIFY is derived.
4. vitest.config.ts — the single `projects: [...]` run and `pool: "forks"`.

STEP 0 — DIAGNOSTIC (before any workflow edit). Confirm the slowness is VOLUME, not a single
pathological/hung test: verify went from ~40 min green (b296d9ee9) to ~60 min around 2026-08-24.
Measure the per-file / per-project timing enough to (a) rule out a hang and (b) balance the shards.
If you find a real hang or a pathological test, STOP, file it as a finding, and bring it back —
sharding must not hide it.

STEP 1 — WRITE THE PLAN to the Sprint 1-3 standard (verified CI state with the exact pr.yml lines,
the matrix design justified by your measured timing, the ci-required wiring analysis, and an
acceptance table). Overwrite CI-VERIFY-PARALLELIZATION.md with it (it lives outside epics/tickets,
so no graph node is needed). Then execute.

THE FIX — shard `verify` into a parallel matrix (`vitest run --shard=i/N`), N chosen from your
measured timing so the slowest shard is comfortably under an UN-RAISED cap. fail-fast: false so a
red shard does not cancel the others.

THE THREE HARD CONSTRAINTS (all provable, all in the acceptance table):
- The timeout is NOT raised. If a shard still can't finish under cap, that is a signal to shard
  finer or to investigate a slow test — never to raise the cap.
- ci-required STILL fails on a real failure. This is the security-critical part: a matrix surfaces
  as several check runs, and a mis-wire can let a shard failure pass through as pass-by-skip. PROVE
  it: temporarily force one shard to fail (e.g. a throwaway `expect(false)` on a branch) on a scratch
  push, confirm ci-required goes RED, then remove it. Do not land the proof, land the evidence.
- No test file is silently dropped. The union of the shards must equal today's full set — the
  execution-census / test-inventory guards must stay green, and the total count must not fall.

Binding rules:
- Only `verify` changes. Do NOT touch e2e/e2e-pgvector/keyed lanes, and do NOT add a
  paths/paths-ignore trigger filter (route conditional execution through ci-required).
- packages/worker-protocol is FROZEN (you are not touching it; noted for completeness).
- Cite living documents by SECTION AND ID, never by line. Any new script/test file that a policy
  guard tracks (*.test.mjs → execution-census; check-*.mjs → guard-inventory) must be registered in
  the same commit.

BEFORE you call it done, run the ADVERSARIAL REVIEW with subagents:
- An independent reviewer that reads the pr.yml diff and confirms, from the workflow semantics, that
  a shard failure reaches ci-required (no pass-by-skip) and that fail-fast:false is set.
- A SKEPTIC told to find a way a broken shard could report green — default "refuted" only if it
  genuinely cannot construct one.
- A completeness check: is any test file now in zero shards, or in two?
Do NOT delegate to a plan-writing or auto-fixing skill.

When green:
- Run all five registers; every one must pass.
- Update GO-BOOK §2.0 and §5: the verify timeout debt is RETIRED (or, if the diagnostic found a real
  hang, narrow §2.0 to that filed finding instead of claiming it fixed).
- Commit, push, and WATCH the real CI run: confirm every verify shard goes green and ci-required
  passes for the first time in the programme. Report the shard wall-clocks honestly.

If you find something mid-session that invalidates the premise (e.g. the slowness IS a hang), STOP
and say so rather than sharding around it.
```

### Sprint 6 (first unit) — MIG-009: fix the distributed-execution drain (the one unblocked item)

**Sprint 6's sinks are all blocked (E10-F001) — this is the one landable piece.** A rollback-safe
drain, sink-agnostic, no credential path needed. Its design is **written and review-verified**;
execute it. **Pure code — no operator step, no spend.**

```text
Work in the git worktree C:\e3 on branch docs/replatform-program.

Read first, in this order:
1. docs/replatform/GO-BOOK.md — §2.0 (the CI blocker), §2 (the per-ticket process), §4 Sprint 6,
   §5 (the E10-1-drain + kill-switch debt rows), §8 (decisions).
2. docs/replatform/epics/E10-desktop-migration-realtime/findings.md — E10-F001: no sink cuts over
   today; the drain is the one unblocked, sink-agnostic Sprint-6 item. This ticket does NOT cut
   over any sink and needs NO credential path.
3. docs/replatform/epics/E10-desktop-migration-realtime/tickets/MIG-009-drain-design.md — the FULL
   design (review-verified). Its ★ banner lists three Step-0 precision fixes to apply. Follow the
   design's TDD steps.

STEP 0: re-verify the design's ~25 path:line citations at tip (the tree moves), and apply the
banner's three fixes: (a) M-grain reddens only in Step 5 (the REAL budget-cost bridge), not the
unit lane — the unit `vi.fn` no-op won't throw on an org id; (b) the store's RLS `runInTenant`
pattern comes from the bridges, not canary-preflight-store (which reads the owner db); (c) the
citation drift (`TERMINAL_ATTEMPT_STATUSES` = job-fence.ts:60, `requestCancellation` = job-control.ts
:3207-3312).

Execute the three unconditional correctness fixes:
- GRAIN (load-bearing): per-Company rollback-safety. Add listOrganizationCompanyIds to the drain
  deps (reuse the existing canary primitive), re-type assertRollbackSafe to per-Company, enumerate
  the org's Companies and assert each — a pending authoritative-cost receipt on ANY Company skips
  the WHOLE org. This closes the sibling-Company fail-open. (The CURRENT org/Company mismatch fails
  CLOSED — a dead cancel-nothing lever — so prove the fix by a "a clean org DOES get drained"
  positive control, never a "drains unsafely" assertion, which can't reproduce.)
- listActiveAttempts SQL: a new tenant-scoped store over job_attempts, notInArray(terminal),
  selectDistinct(company_id, job_id), NO FOR UPDATE (requestCancellation takes its own per-job lock).
- Status coverage: count `cancelled` and `no_active_lease`; exclude terminal/not-found.

Binding rules:
- Fail-first: RED for the reason written down, then implement. POSITIVE CONTROL FIRST.
- Mutation-test every guard by DELETION (never rewrite to an equivalent). The grain guard and the
  SQL are load-bearing; M-grain's kill is in Step 5 (real bridge), not the unit lane.
- The EXISTING drain tests (job-distributed-drain.test.ts, all five) need REWORK for the new
  DrainDeps shape (new required listOrganizationCompanyIds; assertRollbackSafe re-keyed org->Company)
  — this is not just the `cancelled` case. Do not assume the pre-existing mocks stay valid.
- E10-1-drain PROMOTION: DEFER by default — keep it `unwired` and only rewrite its reason. There is
  no clean `drainAll` production caller in scope (the operator kill-switch write path is REL-005;
  boot/SIGTERM/sweeper are the WRONG triggers — they'd cancel in-flight work on every restart). Do
  NOT compose createDistributedExecutionDrain in index.ts just to flip the caller count to >=1 —
  that forces a vacuous `wired` green, the exact anti-pattern the register exists to catch. Promote
  ONLY if a genuine M-proven admin-teardown invocation lands in this ticket; otherwise stay unwired
  with the reason. The acceptance table accepts either outcome.
- packages/worker-protocol is FROZEN. Cite living documents by section/id, never by line. Any new
  *.test.mjs -> test-execution-census same commit; new store/service file -> no register touches it
  unless it's a check-*.mjs or *.test.mjs.

BEFORE you call it done, run the ADVERSARIAL REVIEW with subagents (the design already had one pass;
this verifies the IMPLEMENTATION): independent reviewer(s) on the grain fix + SQL from source; a
SKEPTIC on "can the drain still cancel-nothing or drain-unsafely after the fix"; a completeness check
that the reworked tests actually exercise the new dep shape. Do NOT delegate to a plan-writing or
auto-fixing skill.

When green:
- Run all five registers; every one must pass. E10-1-drain stays unwired (or promotes on a real
  caller) — never a vacuous wired.
- Write MIG-009-drain-result.md: the fixes, the mutation line, the promotion decision (defer or
  promote + why), and the reworked-test note.
- Update GO-BOOK §3.1 (add a MIG-009 row) and §4 Sprint 6 + §5 (the drain debt is retired), and
  E10-F001 if the drain shipping changes anything it says.
- Commit, push, report CI honestly (`verify` is now a sharded matrix — §2.0 RESOLVED, so `ci-required` should PASS; a red shard is a real failure to own, not an inherited timeout).

If you find something mid-ticket that invalidates the premise, STOP and say so.
```

### Sprint 9 (first unit) — REL-FOUNDATION-GATE: stop E0 accepting a bare string

**Sprint 9's release tests are mostly blocked (REL-001/002 on S7/S8, REL-005 on all) — this is the
one landable unit.** It flips the E0 foundation checker from vacuous-green (24 named-but-unwritten
release tests pass today) to honest, WITHOUT the naive hard-strict flip that would red `ci-required`
on every PR. Its design is **written and review-verified (3-way adversarial pass)**; execute it.
**Pure guard/docs — no operator step, no spend.** This is a `code=true` PR, so it rides the full CI
suite, not just `policy`.

```text
Work in the git worktree C:\e3 on branch docs/replatform-program.

Read first, in this order:
1. docs/replatform/GO-BOOK.md — §4 "Sprint 9" (the CORRECTED framing: trackable-strict, NOT a
   hard-strict flip — that breaks ci-required), §2 (the per-ticket process), §5 (the two new debt
   rows: the 5-family coverage-invisibility and the foundation-suite-unrun residual), §8.
2. docs/replatform/epics/E11-hardening-release/tickets/REL-FOUNDATION-GATE-design.md — the FULL
   design. Read its "★★ Review round 2" banner (corrections C1-C8) and §0(h) (the residual) FIRST;
   they are the fixes to fold in. Then follow §4 (the decision function), §7 (the RED/GREEN steps),
   §8 (the mutation table).

STEP 0: re-verify the design's ~30 path:line citations at tip (the tree moves) and apply the
banner's C1-C8. The load-bearing ones: (C1) the graph node is INERT — REL-FOUNDATION-GATE has no
3-digit id, so it reds no coverage checker; add a `#### REL-FOUNDATION-GATE` heading only for human
traceability, never claim it is enforced. (C2) REL-001 is named by 14 crossings, not 10 — assert on
the error substring, not a count. (C3) the finding you file MUST be `## E11-F001 — <title>` (em-dash
or hyphen, NEVER a colon) + `**Status:** open`, with a byte-equal `E11-F001` key in
scripts/finding-ownership.json, status `unowned` (forced — the non-numeric id makes `owned` red
owner_ticket_missing), in the SAME commit. (C4) resolve both new inputs against `root`, not cwd.

THE CHANGE — the trackable-strict gate (design option c):
- Replace crossingHasReleaseTest with an admissibility gate: a Critical/High crossing must NAME a REL
  ticket, and EVERY named REL ticket must either have its <id>-design.md on disk OR be declared, with
  a non-empty reason, in a NEW manifest docs/architecture/distributed-execution-release-tests.json.
- Create that manifest declaring the four unwritten tickets (REL-001/002/003/005) with reasons;
  REL-004 is written, so it is NOT declared. Note in REL-003's reason that its deferral is
  transitional (removed in unit 2). Add the manifest-hygiene guards (stale / malformed / unreferenced,
  §3.3). An ABSENT manifest is a FAIL, not an empty allow-list (fail-closed, §3.4).
- Extend makeFixture (check-distributed-execution-foundation.test.mjs) to copy the E11 tickets dir +
  the manifest into the fixture root — §3.4 is the trap: without it, `valid: an unmutated fixture
  copy passes` breaks, and the wrong "fix" (fail-open on missing inputs) reintroduces the vacuous
  green. Do NOT do that.

Binding rules:
- SHIPS 0-ERROR AT REST — this is the whole point; a hard-strict flip (require-exist, no deferrals)
  reds `policy` -> `ci-required` on every PR and is FORBIDDEN. Prove rest-green with
  `node scripts/check-distributed-execution-foundation.mjs` (exit 0) after every step.
- Fail-first: RED for the reason written down, then implement. POSITIVE CONTROL FIRST (M0: neuter the
  gate to a no-op, watch the "undeclared+nonexistent -> error" case fail to fire).
- Mutation-test every guard by DELETION (never rewrite to an equivalent). Run the RELEVANT test cases
  INDIVIDUALLY via `node --test --test-name-pattern="…"` — the full suite is RED at tip for a
  pre-existing unrelated reason (the additionalProperties mutate no-op) and is wired into no CI job
  (§0h). `valid: the real repository passes` is the truest green signal and passes in isolation.
- THE RESIDUAL (§0h) is real, not a blocker: the gate ships enforced-at-rest but not
  against-regression (the CLI passes at rest under BOTH the vacuous and strict form; only the unwired
  M0-M8 cases catch a re-vacuation). Do NOT fold the suite-wiring into this unit — name it in the
  result doc + GO-BOOK §5 as a candidate later S9 hardening unit (the census's "highest-value item").
- Do NOT write any REL-001/002/003/005 test — that is units 2-5, dependency-blocked (§0d). A green
  gate is NOT license to attempt them.
- packages/worker-protocol is FROZEN. Cite living documents by section/id, never by line. This unit
  adds NO new *.test.mjs (it extends the existing one) -> verify no execution-census bump is needed;
  the new .json is a data input, tracked by no register.

BEFORE you call it done, run the ADVERSARIAL REVIEW with subagents (the design had a 3-way pass; this
verifies the IMPLEMENTATION): an independent reviewer that the checker is 0-error at rest AND that a
hard-strict variant would red (from source, not assertion); a SKEPTIC told to construct any ships-red
scenario (default refuted if not reproducible); a completeness check that every guard (M0-M8) is
killed by a case and the finding+ownership pairing is byte-consistent. Do NOT delegate to a
plan-writing or auto-fixing skill.

When green:
- Run all five registers; every one must pass.
- Write REL-FOUNDATION-GATE-result.md: what shipped, the mutation line (N killed / 0 survivors, with
  the anchor-matched note), the finding filed, and — as a HEADLINE — this unit makes E0 honest
  WITHOUT re-reddening ci-required; the four unwritten release tests are now tracked debt.
- Update GO-BOOK §3.1 (add the S9 unit-1 ship row). §4 Sprint 9 and §5 were already corrected by the
  orchestrator in review round 2 — confirm they match what shipped, don't re-litigate.
- Commit, push, report CI honestly: this is a code=true PR, so ci-required also requires
  verify/lint/e2e/e2e-pgvector/migrations/browser — green is contingent on the whole suite (C5).

If you find something mid-ticket that invalidates the premise, STOP and say so.
```

### Sprint 9 (unit 2) — REL-003: the DR + migration rehearsal (buildable core + operator runbook)

**The second landable S9 unit.** Unlike unit 1 (a checker fix), REL-003 is a *real* DR/migration
rehearsal: a **session-buildable verification core** (pure verifiers + embedded-PG scenarios over
already-wired guards, fail-first + mutation-tested) **plus an operator-owed live staging rehearsal**
that alone supplies the measured RPO/RTO and real backup/restore. Its design is **written + 3-agent
review-verified**; the design doc and the gate self-clean (deferral removed) are **already committed** —
execute the buildable core + the runbook. **Not a pure-code session: hold the operator boundary.**

```text
Work in the git worktree C:\e3 on branch docs/replatform-program.

Read first, in this order:
1. docs/replatform/GO-BOOK.md — §4 "Sprint 9", §2 (the per-ticket process), §5 (debt), §8.
2. docs/replatform/epics/E11-hardening-release/tickets/REL-003-design.md — the FULL design. Read its
   "★★ Review round 2" banner (corrections C1-C4, B1-B3) FIRST — those are the fixes to apply — then
   §2 (the buildable-vs-operator boundary), §5/§6 (the fail-first lanes + mutation table), §9 (the
   operator runbook), §11 (the E11-F002 finding).

STEP 0: re-verify the design's citations at tip (line numbers rot). The gate self-clean is ALREADY
DONE (the prep commit removed deferred["REL-003"] and landed the design; DE-20/DE-23 now admit via
disk) — do NOT re-remove it. Apply the banner corrections, the load-bearing ones being:
- C1 (CI-breaking): the E11-F002 finding-ownership entry key is `ticket`, NOT `owner_ticket`
  (`"E11-F002": { "status": "owned", "ticket": "REL-003", "reason": … }`) — a wrong key reds `policy`.
- B1: the durable `execution_target_revocations` cutoff row is written by `revokeExecutionTarget`
  (execution-targets.ts, via job-operations.ts), NOT `revokeTargetAuthority` (which only bumps the
  generation + flips status). Assert the record row against the right function or the test asserts a
  row nothing in that path writes.
- C2: mobility is DISABLED in the initial coding release, so the acceptance's MIG-004 prerequisite is
  inapplicable — state it in the boundary + promotion rule.
- B2: `checkRolloutPolicy` is private — drive the exported `evaluateStagingManifestInvariants`.

BUILD THE VERIFICATION CORE (fail-first, POSITIVE CONTROL FIRST, mutation-test each new guard by
DELETION):
- Lane A: the NEW pure `evaluateRecoveredManifestReconciliation(manifest, probes)` over
  `job_artifacts status='committed'` × `HeadObjectResult` — bytes/hash/size/scope/prefix/exists,
  missing/corrupt→quarantine-classify, missing-required→verdict-fails, promoted-set excluded (I1-I7).
- Lane B: stale-fence rejection after restore drives the wired `classifyFence` (embedded-PG).
- Lane C: the NEW pure `evaluateRollbackCompleteness` + marker-deletion-negative + the real
  `revert0188` refusals (embedded-PG).
- Lane D: N-1 rollout via the exported `evaluateStagingManifestInvariants` (fixture compose).
- Lane E: re-enroll (`advanceTargetGeneration`) + revoke (`revokeExecutionTarget` writes the cutoff;
  `revokeTargetAuthority` bumps gen/status) after restore, pre-restore-gen fence stale (embedded-PG).

PREPARE THE OPERATOR RUNBOOK (do NOT fake it): the live staging DB + object-store backup/restore, the
pre-0188 snapshot→prior-release→candidate rehearsal, live missing/corrupt injection, timed rollback,
and measured RPO/RTO vs D5-DR02 (RPO ≤15 min) / DR03 (RTO ≤4 h). Name the exact restore invocation
(E11-F002: there is no `aoa db:restore` — the runbook wraps `runDatabaseRestore`/`pg_restore`).

★★ THE OPERATOR/SESSION BOUNDARY — hold it. The SESSION builds + proves the verifiers and prepares
the runbook. Only the OPERATOR runs the live staging rehearsal and authorizes any spend. REL-003
promotes to done ONLY on a CITED live-rehearsal run — never on embedded-PG/fixture/mock. Honest
end-state: "verifiers + runbook shipped; the staging rehearsal is owed." Do NOT mock-substitute it.

Binding rules:
- File E11-F002 (`owned`, `ticket:REL-003`) + its byte-equal findings.md entry in the same commit
  (C1 format). Resolving it later = flip Status + DELETE the key in the SAME commit (C4).
- The `#### REL-003` node already exists — no node add. Tests are vitest `*.test.ts` — no
  execution-census bump; no new `check-*.mjs` — no guard-inventory bump (verify at tip).
- packages/worker-protocol is FROZEN. NEVER serialize a provider key / redeemed secret into a prompt,
  event, protocol message, or log (Decision #104). Cite living documents by section/id, never by line.

BEFORE you call it done, run the ADVERSARIAL REVIEW with subagents (the design had a 3-agent pass;
this verifies the IMPLEMENTATION): independent reviewer(s) on the new verifiers from source; a SKEPTIC
on "can a corrupt/missing object slip the reconciler, or a stale fence be admitted after restore"; a
completeness critic that every acceptance clause maps to a green test OR a runbook step, and every new
guard is mutation-killed. Do NOT delegate to a plan-writing or auto-fixing skill.

When green:
- Run all five registers; every one must pass.
- Write REL-003-result.md: the verifiers + mutation line, E11-F002 filed, the runbook, and — honestly
  — whether the live rehearsal is owed (it is, unless an operator run is cited).
- Update GO-BOOK §3.1 (add the S9 unit-2 row) and §4 Sprint 9 to what is now true.
- Commit, push, report CI honestly (code=true PR → the full heavy suite gates it).

If you find something mid-ticket that invalidates the premise, STOP and say so.
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
