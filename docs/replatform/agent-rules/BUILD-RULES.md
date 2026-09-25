# M1 build-agent rules (read in addition to M1-AGENT-RULES.md, which still applies in full)

You are building ONE M1 ticket. Its task section in the owning epic's implementation plan is your
contract: Files, Interfaces, Failure behavior, Acceptance, the focused verify command, Non-goals and
Evidence. Read it fully, plus the ticket's graph node in `docs/replatform/program-design.md` and the
M1 plan (`docs/replatform/qa/2026-09-21-m1-execution-plan.md`). If the task section and the code
disagree, the CODE is the truth: STOP and report it. Never improvise around it.

## Project rules (CLAUDE.md, binding)
- Drizzle ORM only. Schema changes go in `packages/db/src/schema/` plus `pnpm db:generate`. Never
  hand-write DDL. The only exceptions are the narrow C14 classes governed by Decision #122; read it
  before touching one.
- Follow the existing patterns: services like `server/src/services/goals.ts`, routes like
  `server/src/routes/goals.ts`.
- Architectural decisions in `docs/architecture/decisions.md` and the epic `decisions.md` files are
  LOCKED. For example, E2-D03: legacy tables get GRANTs and no RLS. Do not relitigate them.
- **M1 is MULTI-TENANT (ruling F10).** Every behavioural test that touches tenant data needs a
  cross-tenant case: a second Organization must be denied or filtered, with a same-tenant positive
  control.

## TDD, strictly (superpowers:test-driven-development)
1. Write the failing test(s) the task's Acceptance names, including every positive control.
2. Run them and SEE them fail for the right reason. Record the RED output.
3. Write the smallest change that turns them green. Run them again (GREEN).
4. For each positive control or mutation row in the task, prove the test goes red when the
   behaviour is removed. Revert the mutation afterwards.

## Running tests
- Use a short worktree path under `C:/` (deep OneDrive paths break pnpm with ENAMETOOLONG).
- Try `pnpm install --frozen-lockfile` in your worktree. If it fails, do TDD through CI instead:
  push the RED commit and cite the failing job, then push GREEN.
- Integration tests with embedded PostgreSQL: on Windows set `AOA_RUN_WIN_INTEGRATION=1` **only
  for suites that honour it**. A suite guarded by `describe.skipIf(win32)` executes ZERO tests on
  Windows. Its evidence must come from the Linux `verify` shard, and you must cite that shard's
  executed test count, which must be non-zero.
- Run the task's focused verify command, the owning package's typecheck and build, and the full
  guard set from M1-AGENT-RULES before every push.

## Result record
- Write `tickets/<ID>-result.md` (or the name the task specifies) following the epic's existing
  result format.
- Record RED and GREEN evidence, the mutation and positive-control table, the reviewed revision
  (40-hex), and the CI jobs, each with its executed count.
- Leave `Status: gate_review`. **Only a DISTINCT reviewer sets `complete`.**
- If your change touches a register-cited file (`scripts/gate-clause-wiring.json`,
  `distributed-execution-threat-controls.json`, `finding-ownership.json`), keep the citations
  consistent. `check-register-citation-integrity` must stay green; re-point citations by SYMBOL.
- Flipping a register entry to `wired` or `resolved` must happen in the same commit as the code that
  earns it.

## Paid runs
Keyed E2B workflows may be dispatched ONLY if your ticket is on ruling F8's named list AND the
planning session tells you to in a message. Otherwise, never.

## Final report (400 words or fewer)
Include:
- the PR number and head sha;
- the Codex status and `ci-required` result;
- the RED and GREEN evidence;
- mutation results;
- the result doc path;
- anything that contradicts the task section;
- anything you stopped on.

---

## SPEED RULES (added 2026-09-23, after measuring Codex round counts)

Codex has averaged 5–9 rounds per code PR. Every finding was real, and they cluster into a
small number of families. Front-load them instead of discovering them one per round.

### A. Self-audit BEFORE the first push — the observed families

Walk this list against your own diff and fix what it finds. Say in your report that you ran it.

1. **Redaction / secret collision.** Anything you log, emit, serialize or upload: could a redeemed
   secret equal a FIELD NAME, a structural token (`msg`, `time`, `level`), or a digit run inside a
   number? Does the logger or framework add keys BELOW your scrubber? If you cannot enforce the
   boundary caller-side, do not add the channel.
2. **Vacuous control.** For every control you claim reds: does it red for the RIGHT reason? A control
   that reads empty rows, skips, or exits early "passes" while proving nothing. Assert non-vacuity
   first (the thing under test actually ran and produced rows).
3. **Bounds and deadlines.** Every lock, read, upload, list and retry needs a bound. Does the timeout
   cover the operation it names, measured from the right moment (after queueing, not before)?
4. **Replay / idempotency.** Same key twice, same event twice, a lost response retried: exactly one
   effect. Does a stripped or empty idempotency key collapse two runs into one?
5. **Crash windows and ordering.** Between any two durable writes, what happens if the process dies?
   Does the ACK happen before the durable record it depends on?
6. **Authentication of the right half.** If you pin, sign or check something, is it the half an
   attacker controls? (Pinning a wrapper when the payload is what varies proves nothing.)
7. **Record rot.** Citations by symbol, count pins recomputed from the combined tree, reviewed
   revisions still ancestors after a merge.
8. **Fail-closed on missing input.** Absent config, absent session, absent probe result: refuse, and
   never silently prune or treat "not run" as "clean".

### B. ONE Codex review, not one per fix

Fix everything you know about, run the self-audit, THEN request `@codex review` once. Re-requesting
after each small fix invites a fresh round on a surface you were still changing.

### C. Hard cap: TWO Codex rounds

After two rounds on a PR, STOP and report — do not attempt a third fix. Send the planning session
the remaining finding, your verification of it at source, and your proposed fix. The planning
session rules: fix it, file it as a finding, or descope. A ticket is not the place to converge on a
property that keeps regenerating.

### D. Docs-only and record-only PRs

One Codex review. If it raises nothing, merge on guards + CI. Do not iterate for polish.

---

## E. SWEEP THE CLASS, NEVER THE INSTANCE (added 2026-09-24, binding)

Measured over one day of M1 work, the single most expensive pattern was **fixing the instance a
reviewer pointed at and leaving its family standing**. Three separate cases:

- `readFile`'s unsignalled bounded read was fixed; `listDir` had the identical defect, and
  `statEntry` had it too — **found by a sweep, not by review**, after two Codex rounds and an
  independent reviewer had all walked past it.
- `leakScan`'s absent-log refusal was fixed to stop short-circuiting the scans; the TRUNCATED-log
  refusal in the SAME function still short-circuits, and the comment above it now overclaims the
  invariant.
- A marker was made worker-specific in one arm while every `cost:` code still carried the old one.

So, when you fix ANY defect:

1. **Name the class in one sentence** before you fix anything — "a bounded operation that returns at
   its deadline without aborting the underlying work", "a refusal that short-circuits a scan that
   already has a finding". If you cannot state the class, you do not yet understand the defect.
2. **Enumerate every site in that class** by a search you can quote, not by memory. Say in your
   report **how many you checked, how many you found, how many you fixed**.
3. **Fix them together, in the same PR.** A known twin left behind is worse than the original: the
   next reader sees a fixed neighbour and assumes the family is handled.
4. If a site in the class should NOT be fixed, say why, and **file it with an owner** rather than
   leaving it silent. `unowned` with an honest reason beats an invented owner.
5. Each fix carries the same proof the first one did. A test that passes against the defect is not
   a proof — mutate and show the red.

A review that only ever sees one instance at a time cannot find a class. That is the reviewer's
structural blind spot, and closing it is the BUILDER's job, not the reviewer's.

### E.1 — sweep YOUR OWN DIFF, and sweep the class in BOTH directions (added 2026-09-24)

Two refinements, both learned from real misses this week:

**(a) Your own diff is in the class.** A `CLI-013` build filed a finding for *"an emit whose rejection
is swallowed while a later event still goes onto the same stream"*, swept 30 sites — and Codex then
found an instance of that exact class **inside the diff that filed it**. Once you can name a class,
the first place to look is the code you just wrote. You are not exempt from the defect you are
describing; you are the most recent author of it.

**(b) A class has a dual, and your grep will miss it.** That sweep searched for swallowed **emits**
and missed a swallowed **refusal** — the same shape with the polarity flipped. When you write the
class sentence, write its dual too and search for both:

| You searched for | Also search for |
|---|---|
| a swallowed emit | a swallowed refusal / rejection |
| a bound on the caller | a bound on the callee |
| a check that can pass wrongly | a check that can fail wrongly |
| an error path with no test | a success path with no test |

Report the dual you searched for, even when it finds nothing. "Checked 30, found 1" is only
meaningful if the reader knows which 30 — and a count that silently covers one polarity reads as if
it covered both.

### E.2 — NEVER rewrite a shared register from your own copy (added 2026-09-24)

A shared register — `scripts/finding-ownership.json`, `gate-clause-wiring.json`,
`distributed-execution-threat-controls.json`, `test-execution-census.json` — is written by every
branch at once. A `CLI-017` build rewrote the whole ownership file from a worktree two commits
behind the base and **silently dropped an entry another PR had just added**. Two ids it minted were
already taken by a PR that had merged while it worked.

★★★ **Its local guards were GREEN, because they read its own stale file.** Only the merge ref could
see the loss. A guard that reads the artefact you are editing cannot detect that your artefact is
missing something — a check whose input is the thing under test is not a check.

So, whenever you touch a shared register:

1. **`git fetch` first, and mint ids against the FETCHED base**, never against your worktree's copy.
   Ids are allocated from a high-water mark that other branches are also moving.
2. **Apply deltas. Never write the file whole.** Read the base's copy, add or remove your specific
   keys, write back.
3. **Assert the diff is exactly your deltas** before you push: base ∪ {added} ∖ {removed}, and
   nothing else differs. That assertion is the control; without it you are trusting the rewrite.
4. **Verify against the MERGE REF**, not your branch. Compare key sets between
   `origin/<base>` and your head, and print both the added and the dropped list. A rewrite that
   loses an entry shows up only here.
5. Closing a finding means flipping `findings.md` **and** deleting its register key **in the same
   commit** — and adding one means the reverse. A register and its prose drifting apart is the
   dominant record defect in this program.

Related: `E0-F021` records the merge-time half of this class, where a one-sided conflict resolution
keeps one well-formed key and silently loses the other.

### E.3 — PROBE before you FIX, and never dispatch on an inference you could grep (added 2026-09-24)

The dominant waste in this program is not wrong fixes. It is **cycles spent ranking guesses when one
measurement would have decided**. A five-cycle D1 session diagnosed its own pattern exactly:

> *"I dispatched on an inference I could have checked for the cost of two greps. Cycle 3 and cycle 5
> are the same mistake in different places: fixing before measuring."*

Two of its five cycles were that mistake; a third re-trod an earlier cycle's class in different
clothes while its commit message described it as a new finding.

So, when something does not behave as expected:

1. **Before dispatching anything, ask: can I answer this at source?** A `grep`, a schema read, a
   caller count. A ~25-minute CI cycle spent on a question two greps would settle is the expensive
   way to be wrong.
2. **A run must test a HYPOTHESIS, not try an OPTION.** State it in one sentence with **both**
   predictions — what the run shows if you are right, and what it shows if you are wrong. If you
   cannot state the failing prediction, the run cannot teach you anything: do not dispatch it.
3. **When you are out of hypotheses, dispatch a PROBE, not a fix.** Make the system report its own
   view of the state — the row, the status, the lease, the capacity, the reason column. One probe
   that measures beats three that guess, and it converts "I do not know why" into a fact.
4. **A cycle that KILLS a line of reasoning is worth more than one that extends it.** Say so in the
   record; a falsified hypothesis is a finding.
5. **Count honestly.** Two cycles on the same class are one finding, not two. Do not let a commit
   message promote a refinement into a discovery.
6. **A blocked case, filed with its blocker MEASURED, is a legitimate outcome** and beats a
   speculative further run. A driver that cannot fire its case must be discarded, never committed —
   committed, it looks like coverage.

### E.3.1 — measure the WHOLE CHAIN, not the link you happened to open

E.3 says measure before you conclude. That is not sufficient. An agent on the D1 unit was wrong
**twice, in opposite directions, about one fact** — each time after a real measurement:

1. It checked *which functions* bump `device_generation` → concluded no bump on restart.
2. It then found that *enrolment* bumps it → concluded there IS a bump, without checking whether the
   **boot path enrols**.
3. Only reading the boot branch (`if (current !== null) refreshSelfHello(...)`) **and** the refresh
   service (which never advances the generation) settled it: a restart with a persisted identity
   **refreshes**, it does not re-enrol.

Its own conclusion: *"measure the whole chain, not the link you happened to open."*

So when a claim spans a chain — a caller, a branch, a helper, a predicate — **enumerate the links and
measure each one**, then state which links you measured and which you inferred. A measurement of one
link plus inference across the rest is an inference, and it will read in your report as a measurement.

Corollary: **a "correction" is as suspect as the thing it corrects.** Being wrong in the opposite
direction is not evidence of having converged. If you reverse yourself, say what NEW link you
measured that the first pass did not, and if the answer is "none, I reasoned differently", you have
not yet measured it.

### E.3.2 — a probe whose NULL result is uninformative is a vacuous probe

E.3 says dispatch a probe rather than a fix when you are out of hypotheses. Design it so **both**
outcomes teach you something. The D1 agent caught this in its own probe before dispatching it:

> *"If every conjunct holds, `failing` comes back **empty**, and 'nothing is wrong' is the least
> useful answer a probe can give."*

Its first probe read only the predicate's own conjuncts, so a clean result would have said merely
"not that" — burning a ~25-minute cycle to eliminate one branch. It widened the probe to also record
what the predicate **does not express**: whether the worker was even polling (`status`,
`last_seen_at`), and whether admission was starved elsewhere (the Organization's concurrency cap, its
count of `held` attempts, the attempt's own capacity-claim state).

So, before dispatching a probe, ask: **what will I know if it comes back clean?** If the answer is
"only that it is not this one thing", widen it until the null result is itself a diagnosis. This is
the same non-vacuity discipline you apply to a control, pointed at a diagnostic: a control that
cannot red proves nothing, and a probe that cannot distinguish proves nothing either.

Especially true when it is your LAST cycle — a probe that is conclusive in one branch only is a coin
flip on whether the session ends with an answer or with "not that".

### E.2.1 — WELL-FORMED is not COMPLETE, and one source can only answer the first

The general principle behind E.2, articulated by the agent that hit the class three times in a day:

> *"A guard whose input is the file you just wrote can only ever answer **'is what I wrote
> well-formed?'**, never **'is what I wrote complete?'** Completeness is a claim about something the
> artefact does not contain, so it can only be checked against a **second source**."*

This is why all three register losses in one day had **green local guards**. It was not bad luck and
not a weak guard: `check-finding-ownership` validates each entry present and is correct to do so. No
single-source check can detect a missing entry, because the missing entry is not there to fail.

It generalises well past registers. Any claim of the form *"nothing is missing"* — every declared
case ran, every required file shipped, every caller was swept, every route was checked, no test was
deleted — needs a **second source** to check against:

| Claim | The second source |
|---|---|
| no register entry was lost | the merge ref's key set |
| every declared case fired | the declaration, diffed against the evidence bundle |
| no test file vanished | the base's test inventory (`check-test-inventory.mjs`) |
| every caller was swept | an enumeration you can quote, not memory |
| a negative audit is exhaustive | the enumeration of routes, published with the result |

And the check must be **two-sided**: print what was ADDED and what was DROPPED, not a pass/fail. The
same agent's near-miss came from the other direction — writing from the fetched base to avoid
dropping, which imported an entry whose prose it did not have. One-sided reasoning fails both ways;
only a two-sided diff asks both questions.
