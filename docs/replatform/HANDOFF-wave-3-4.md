# Re-platform — Wave 3 + 4 handoff (prove, then cut over)

**As of:** branch `docs/replatform-program` tip `6a793766a` (ONE PR #323, worktree `C:\e3`).
Worktree clean, nothing unpushed, PR CI green.
**72 / 95 landed. 23 remain.**

Wave 3 and Wave 4 are executed as **one engagement with a hard gate between them**. The
gate is not advisory — see §4. Everything before it is provably effect-free; everything
after it moves live execution.

---

## 1. The per-ticket process — EVERY ticket below, no exceptions

This is binding. It has now been run on ~20 tickets and has caught a real, often-HIGH
defect on essentially every one, including tickets that looked trivial going in.

1. **Terrain-map first.** Read what already exists before designing anything. On four
   tickets in a row the verbs were already built and the ticket was really about wiring.
2. **Re-verify yourself.** Whatever you concluded in step 1, check it against the code
   again. Six times in the last session a first read or a first measurement was wrong.
3. **Write the design doc and COMMIT IT BEFORE ANY CODE.** Its SHA is the ticket's Start
   SHA. `superpowers:writing-plans`.
4. **Review the plan before building it.** `/plan-eng-review` for architecture, data flow,
   edge cases and tests. For anything touching a live path, also `/plan-ceo-review` for
   scope. A plan that has not been reviewed is not a plan.
5. **Fail-first TDD.** `superpowers:test-driven-development`. Write the test, watch it
   fail for the right reason, then implement.
6. **Adversarial review of your own work.** Attack it; do not re-read it. Every finding of
   value in the last session came from attacking, none from re-reading.
7. **Re-verify and fix.** `superpowers:verification-before-completion`.
8. **Mutation-test every guard.** A guard whose removal leaves the suite green is not a
   guard.
9. **Result doc + fast-forward push + watch CI to green.** `ci-required` is the verdict.

**Steps 3 and 9 produce committed artifacts** — `<TICKET>-design.md` and
`<TICKET>-result.md` under the epic's `tickets/` directory.

### Tests required — all of these, not a selection

- Unit tests for every decision function, fail-first.
- **Mutation tests for every guard**, with survivors either fixed or documented as
  equivalent mutants with the reason.
- Integration tests for anything crossing a process, a transaction, or a tenant boundary.
  They run on Linux CI (`skipIf(win32)` only) and self-provision embedded Postgres.
- Contract tests where a shape is shared across packages.
- For cutover tickets: **shadow-comparison evidence** before any active change (§4).
- E2E where a user-visible path changes.

### Definition of done

A ticket is not done until **all** hold:

- The design doc's SHA is recorded as the Start SHA in the result doc.
- **Every acceptance clause maps to a NAMED EXECUTABLE artifact** — a test file, a
  command, a CI step — or is explicitly deferred with the reason. Prose is not evidence.
  A clause with no named artifact is not satisfied.
- Every guard is mutation-tested.
- The result doc states deferrals honestly, including anything built but not wired.
- CI is watched to green.
- `docker/d1/campaign.env` is bumped **if the change alters runtime behaviour on the
  `server/src` path** — that lane's push filter does not include `server/src`, so without
  a bump the live two-replica lane silently does not exercise the change. Do not bump for
  code with no runtime caller; that spends a 45-minute lane proving nothing.

### The two rules that produced every defect

**Never trust a subagent's green, and never trust your own first read.**

**A check that nothing runs is not a check.** Three fail-closed admission verifiers, a
frozen-protocol guard, and 154 deleted test files all passed CI while proving nothing.
`scripts/check-guard-inventory.mjs` and `scripts/check-test-inventory.mjs` now guard the
mechanical variants; the general shape is still yours to watch for.

---

## 2. What the evidence pass already established — do not redo it

Run 2026-08-22 at tip `6a793766a`. The foundation's evidence base is **sound**; treat
these as verified so the wave does not re-audit them:

| Checked | Result |
|---|---|
| Docs claiming an enforcement by a named artifact (11 claims, 9 artifacts) | 0 false; all exist |
| Result docs naming executable evidence (79 docs) | 72 do |
| Test files named as evidence still present (296 distinct) | 3 absent, 2 already self-flagged by their own docs |
| The 26 tickets whose acceptance cites Windows-local integration runs | All re-run on Linux CI |
| Guard-shaped exported functions with no caller (112 examined) | 0 |
| `check-*` / `verify-*` scripts unclassified | 0 |

**The one open finding:** `JOB-013-result.md` cites `activity-log.test.ts` as acceptance
evidence and no such file exists. Resolve it in Wave 3 — either the test was renamed and
the citation is stale, or a clause has no proof.

---

## 3. Wave 3 — prove what exists. No live sink moves.

Order within the wave is flexible except where noted.

| # | Work | Why here |
|---|---|---|
| 1 | **REL-004 clause 3a** — wire the kill switch | **Prerequisite for Wave 4.** You do not move live execution onto a platform with no stop button. The decision function is built and mutation-tested (`server/src/services/execution-kill-switches.ts`, 18/18 mutants) and calls nothing. |
| 2 | **REL-004 clause 3b** — reconcile active provider resources on kill | Completes the clause; builds on MIG-008's `legacy-resource-reconciliation.ts` seam. |
| 3 | **JOB-013 evidence citation** | The single open finding from §2. |
| 4 | **MIG-005/006/007 in SHADOW ONLY** | Commander turns, crew dispatch, one-shot extraction run distributed *beside* legacy via `job-shadow-comparator.ts`, results compared, **no effect**. This is the highest-information, lowest-risk way to exercise E3+E4 against real traffic. |
| 5 | **Merge PR #323** | Once shadow comparison is clean. 565 commits is its own risk and it compounds. The work is flag-off inert, so merging early reduces integration risk rather than adding it. |

### Wiring the kill switch — terrain already verified

- Storage: `instance_settings.general.killSwitches` — no migration, no new distributed
  table. **But** `instance_settings` is absent from `appTablePrivileges()` and
  `assertExactServingRoleAuthority` enforces EXACT ACLs, so `aoa_app` currently has zero
  privileges on it. A `SELECT` grant surface is required. Less work than a new table; not
  none.
- Provider axis: `execution_targets.kind`. Template axis: the pinned E2B alias in
  `packages/sandbox-e2b-provider`'s capability matrix.
- **Enforcement seam: the poll response's `drain` outcome** (`{outcome, retryAfterMs,
  reason}`), which nothing currently emits. `drainJob` in `job-operations.ts` is a
  *job-level* stop and is NOT the same thing — its own comment documents the missing
  worker-fleet seam that the kill switch fills.
- **Do NOT enforce inside `evaluateStaticLeaseEligibility`'s loop.** It records
  `static_requirements_mismatch` negative certificates; a kill switch is not a
  requirements mismatch and routing it there corrupts the certificates JOB-* depends on.

---

## 4. THE GATE — binding, between Wave 3 and Wave 4

**No active cutover begins until all of the following are true and evidenced:**

1. REL-004 clause 3 is complete and wired — a kill switch can actually stop new leases,
   proven by a test that exercises the poll path, not only the decision function.
2. Shadow comparison for MIG-005/006/007 has run against real traffic with a **stated
   divergence rate and every divergence explained**. "No divergences observed" without a
   volume figure is not evidence.
3. A named rollback path exists per sink, tested at least once.
4. CI green, and the D1 two-replica lane green on the exact candidate SHA.

If a shadow divergence is unexplained, the gate does not open. Explaining it is the work.

---

## 5. Wave 4 — cut over, progressively

| # | Ticket | Note |
|---|---|---|
| 1 | **MIG-002** | Route distributed execution by Organization and workload; retain legacy for everything else. This is the dial the rest of the wave turns. |
| 2 | **MIG-005** | Commander turns → `commander_turn`. Lowest blast radius; start here. |
| 3 | **MIG-006** | Crew dispatch → `crew_run`. |
| 4 | **MIG-007** | Extraction / compaction / readiness probes → `one_shot`. |
| 5 | **MIG-001** | Decision #117 target/credential routing. |

**One sink at a time, each with its own soak before the next.** Do not batch. The kill
switch and the per-org dial exist precisely so a bad cutover is reversible in seconds.

---

## 6. Out of scope for this engagement

- **E8 browser (BRW ×6) and E9 service agents (SVC ×7)** — 13 tickets, **no designs
  written**. They need a design phase of their own. Write those designs *during* Wave 4,
  since design touches no code and does not conflict with cutover.
- **MIG-004** (cross-target mobility) — only if mobility is advertised.
- **REL-001/002/003** (hostile tenants, limits/SLOs, restore/DR) — these validate a
  finished system and cannot move earlier.
- **REL-005** — the beta gate. Requires coding *and* browser *and* service.

---

## 7. Traps that have bitten, in this repo

- **`docker/d1/campaign.env`** — `server/src` is not on the D1 lane's push filter. A
  runtime change without a nonce bump is never exercised live. This has bitten twice.
- **C14 idempotency** — drizzle-generated `CREATE TABLE`/`INDEX`/FK need `IF NOT EXISTS`
  and `duplicate_object` guards hand-appended. `migrations` passes on first apply;
  `migration-idempotency` and `readiness` catch the gap.
- **A new distributed table = two grant surfaces** plus a C14 hand-append. Widening an
  existing table avoids that — **but check the consuming role can actually reach it**, as
  `instance_settings` shows.
- **Windows: shebang + CRLF breaks a vitest import** but not a node execution — green on
  Linux, red locally. Fixed by a scoped `.gitattributes` `eol=lf` pin. `scripts/*.mjs`
  matches only the top level; use `**` and verify with `git check-attr eol`.
- **`lstat`, never `stat`**, wherever a link is possible. This defect class has appeared
  three times, once destroying 154 test files.
- **A guard can be born dead** — a regex with raw control bytes, a pattern that does not
  match what its comment claims. Mutation-test it, and verify patterns against real paths.

## 8. Frozen — never edit

`packages/worker-protocol/` (v1, source SHA `b7a842870ce7509d8baa75409e0ab19da375c88a`),
the worker-daemon `SandboxProvider` port, and `docs/architecture/distributed-execution-threat-*`.
Drizzle-only for schema, C14 the sole hand-edit exception. No new hosted-API call (Rule #11).
