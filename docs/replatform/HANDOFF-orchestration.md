# HANDOFF — the orchestration session

**Written 2026-09-03 at HEAD `e8d2d8a52`, from a 15-agent audit whose five load-bearing claims were
each adversarially verified.** Supersedes the parallel-lane framing in `HANDOFF-wave-4.md` and
`HANDOFF-lane-b-browser-service.md`, both of which are stale in specific named ways (§7).

> **You are the orchestrator.** You do not build. You hold the track board, hand out units, verify
> what comes back, serialize the merges, and keep the registers honest. Every line of code is written
> by a different session.

---

## 1. The one operational rule

**Feature-branch PRs are free. Merges into the integration branch are not.**

- `pr.yml` scopes the CI concurrency group **per PR**. Four `claude/*` PRs run four independent CI
  suites and never contend. PRs #339 and #340 proved this.
- The **integration branch** (`docs/replatform-program`, PR #323) keeps **one in-progress + one
  pending** run. A newer push replaces the older *pending* one, which then executes **zero jobs and
  carries no verdict**. 12 of the last 100 pushes produced no check-runs at all.

**So:** let tracks run concurrently on their own branches. **Serialize merges ~20 minutes apart**
(a full run is ~18 min today), and after each merge **confirm a run exists for that sha**:

```bash
gh pr checks 323 --json name,bucket --jq '"pass=\([.[]|select(.bucket=="pass")]|length) fail=\([.[]|select(.bucket=="fail")]|length) pending=\([.[]|select(.bucket=="pending")]|length)"'
```

★ **There is no threshold at two tracks.** The failure mode is push-rate versus run-duration. On
2026-09-01 a *single* lane dropped four verdicts with five pushes ~5 min apart against a ~23 min run;
three lanes pushing hourly would drop nothing. Do not let anyone reintroduce a track cap as a CI rule.

★★ **`jq` is not installed** in the agent Bash environment — use `gh --jq`. A monitor built on
standalone `jq` exits 0 with no output and looks exactly like "nothing to report". Three did, this
session, while CI was red.

---

## 2. The track board

| Track | Branch | First unit | Size | Blocked by |
|---|---|---|---|---|
| **A — E7 critical path** | `claude/cli-008-unit-d` | ~~CLI-008 **Unit D**~~ ✅ **SHIPPED 2026-09-03** (PR into `docs/replatform-program`) — closed **E7-F008** and **E7-F009**. Next: **Unit C** — the brokered MCP config | M → L–XL | nothing |
| **B — free parallel** | `claude/wrk-017-container-enrol` | **WRK-017** — CI-exercised first container-enrol on d1 | M–L | nothing |
| **C — register repair** | `claude/register-repair` | the three duplicate-id / guard-blindness defects | S–M | nothing |
| **D — Lane B revival** | `C:\e8`, branch `lane-b` | **rebase**, then BRW-004 | M | its own rebase |

### Why A takes D before C
Unit D is **M** against Unit C's **L–XL**; it is the first real consumer of the channel Unit B just
built, so it validates that work rather than stacking a second unbuilt thing beside it; and *"the
prompt stops being a positional"* **is** the fix for **E7-F008** — the only **live** refusal among the
open findings (a task whose assembled prompt exceeds 8,192 characters cannot dispatch distributed at
all, today).

> **Outcome, 2026-09-03: that reasoning held.** Unit D shipped and closed E7-F008 — though not by the
> chunked-argv remedy the finding proposed: it removed the prompt from argv entirely, because Unit D
> had to stage the instructions bundle anyway. It also closed E7-F009, and surfaced two
> [[checks-that-nothing-runs]] instances in the code it touched. Track A's next unit is **C**.

### What no track achieves
**None of these flips `capabilityProven`.** A green E7-1 proves the **mechanism**, not capability; the
verifier has computed and printed both since Unit A. **Do not let a green canary be reported as
capability.**

★★★ **But the reason is NOT "Unit F has not shipped yet", and no producer unit will change it.**
Measured 2026-09-06 and filed as **E7-F018** (HIGH, `unowned`): **both arms are structurally
unreachable in every checked-in configuration.** Arm 1 short-circuits at
`server/src/services/e7-distributed-run-verifier-store.ts:200` on `if (run.distributedJobId)` and
issues **no query at all**, because the sole writer of `heartbeat_runs.distributed_job_id`
(`markRunHandedOffToDistributed`, `heartbeat.ts:6921`) has exactly one call site
(`heartbeat.ts:5422`), inside the block gated on `distributedRolloutState === "canary"`
(`heartbeat.ts:5259-5274`) — and nothing checked in arms the rollout dial. Arm 2's projection
(`jobOutputBridge`) is `unwired` with zero production callers.

**So a `workspace_patch` producer is NECESSARY and NOT SUFFICIENT.** What is owed first is a
**deployment precondition**, not a code unit: a compose diff enabling dispatch on a worker, and a
rollout JSON naming an Organization canary. That is why E7-F018 is `unowned` — a ticket could ship in
full and the finding would not move. ★ **Track A's producer chain has been attempted or proposed four
times. Read E7-F018 before anyone starts a fifth.**

★ **And `--require-capability` is not "the flag the campaign flips at F" in any load-bearing sense.**
It is off by default (`server/src/cli/verify-e7-1-distributed-run.ts:65`), and `capabilityProven` is
referenced by **no workflow and no script** — only the verifier, its own test, the CLI, a comment, one
provider test, two registers and docs (re-measured 2026-09-06). Flipping it would gate only a verdict
the campaign itself chooses to demand.

★ **Keep the standing prohibition on redefining the counter — and know it is not airtight.**
**E7-F019** (MEDIUM, `unowned`): `kind` is the caller's declaration, so exporting arbitrary bytes as
`kind='workspace_patch'` satisfies arm 1's predicate *literally*, redefining nothing. The system's own
consumer refuses them (`server/src/services/patch-apply.ts:126-127`, frozen manifest schema,
fail-closed) — but at the **apply** path, not at the counter.

---

## 3. Handoff prompts

Give a builder session the ticket, the plan doc if one exists, and these standing rules. **Do not
paste a summary of the code — make them read it.**

### Standing rules for every builder session

```
Repo C:/e3 (git worktree), branch off docs/replatform-program. Work on claude/<unit-name>,
open a PR into docs/replatform-program, do NOT merge — report back.

Before you start: read docs/replatform/GO-BOOK.md §1.9 (current state, measured 2026-09-03).
Several docs retain SUPERSEDED text deliberately, with a banner — check for one before quoting
any design doc. Two sessions have already quoted CLI-008-design.md §3's refuted body as live.

Gate locally before pushing: `node scripts/ci-local.mjs` (~3.5 min: policy, lint, brand-check,
contract-bytes). It is a first filter, NOT a verdict — it has missed real CI failures.

`ci-local.mjs` runs the FAST gate only. It does not run `verify` — and `verify` is not
*skipped* there, it is never *selected*, so the tool's own honest "skipped jobs are NOT green"
warning never fires for it. If you touched anything a vitest spec reads — including non-TS
files a test PARSES — run that package's suite yourself.

`tsc -p server` does NOT cover server/src/__tests__. Run the actual suite.
`jq` is not installed; use `gh --jq`.

After any rebase or conflict resolution in `scripts/finding-ownership.json`, CHAIN the JSON
parse to the `git add` with `&&` — never two lines. `git rerere` is trained on that file's
conflicts (four branches touched it in one day), and on 2026-09-03 a replayed stale resolution
produced a duplicated key that a running validation caught and an unchained `git add` ignored.
That one operator is the whole difference. Note also which hunks fail SILENTLY: a conflict in a
guarded key (`findings.<id>`) fails loudly as `undeclared_finding`; a conflict inside a `reason`
STRING is read by no guard at all, so read those resolved hunks line by line.

If you file a finding, add its scripts/finding-ownership.json entry in the same commit or the
policy job goes red. `owned` by a SHIPPED ticket needs a real successor on disk that is not
itself complete; otherwise use `unowned` with a reason saying what it blocks.

Report: what you built, what you measured, what you could NOT establish, and every mutation you
ran to prove a test bites. Do not report a guard as passing without having made it fail once.
```

### Track A — CLI-008 Unit D

```
Build CLI-008 Unit D: the instructions bundle reaches the sandbox, and the prompt stops being a
positional argument.

Authority: docs/replatform/epics/E7-coding-e2b/tickets/CLI-008-design.md §4 row D.
Channel: docs/replatform/qa/2026-09-03-cli-008-unit-b-channel-decision.md — Unit B shipped the
staging channel (merged 393f7a251). The pointer rides extensions[]; the bytes ride object storage.

★ STATE WHICH LANE YOU TARGET. E7-F011: there is no stage_files route on the networked/container
lane. That lane is inert and actively guarded against, so you are NOT blocked — but say in the PR
that you target the E2B/desktop lane.

★ This unit should CLOSE E7-F008 (FROZEN_MAX_ARG_CHARS = 8192 in
server/src/services/task-run-batch-workload.ts). If your design does not close it, say why.

★ E7-F009 is open in the code you will touch: pointerFitsExtension projects input.files only, never
the union with already-committed rows. Its cited line numbers have DRIFTED (now ~:194 and ~:260).
Fixing it is a one-argument change and in scope; deduping at the reader instead is explicitly
rejected in the finding.

Read E7-F010's lesson before you start: growing the non-frozen supervisor port leaves every
structure DERIVED from the frozen PROVIDER_OPERATIONS vocabulary behind, and nothing adds the
entry for you.
```

### Track B — WRK-017

```
Build WRK-017: a CI-exercised first container-enrol on d1 (WRK-015 Part 2, split out).
Authority: docs/replatform/epics/E4-worker-daemon/tickets/WRK-017-design.md — it carries a concrete
lettered work plan and its own sequencing section. Both deps (WRK-014, WRK-015) have result docs.

Its Status line reads `scope` but it is NOT a scoping stub — read the whole file before deciding
that a design pass is needed.
```

### Track C — register repair

```
Three live defects, in this order. Each is the programme's own named worst failure class.

1. ★★★ scripts/lib/finding-ownership.mjs parses `**Status:**` (:175) and filters status==="open"
   (:82). E0/E1/E2 findings use the OLDER documented house style (`- **Severity:** /
   - **Disposition:**`, artifact-policy.md:48), so all three registers are INVISIBLE to the guard.
   Positive control before you fix: a synthetic HIGH gate-blocking unowned finding in E0's own
   style returns {ok:true, openCount:0}; the same finding with a `**Status:**` line returns
   undeclared_finding. Decide deliberately whether to teach the parser the old style or migrate the
   registers — and say which, and why, in the PR. Note that fixing this will SURFACE previously
   invisible open findings and may red the policy job; that is the point, not a regression.

2. docs/architecture/decisions.md:854 and :913 are BOTH "## Decision #104" — different locked
   decisions, one day apart. CLAUDE.md cites #104 as load-bearing in four places. Renumbering a
   locked decision is not obviously safe; propose before you act.

3. E1-worker-protocol/findings.md:96 and :132 are both "## E1-F008". The ownership checker keys by
   id, so one silently shadows the other.

Then the GO-BOOK drift named in §1.9.4. Add a uniqueness check for decision and finding ids —
without one, all three recur.
```

### Track D — Lane B revival

```
C:\e8 is on branch lane-b at 30861d0be (2026-08-24): 275 commits behind origin/docs/replatform-program,
0 ahead, ~10 days idle. Rebase it FIRST.

★ Re-pin the migration baseline before generating anything.
HANDOFF-lane-b-browser-service.md §5.4 says "Lane A has taken 0262 and 0263" — the tip is 0271.
Following that text literally collides.

Then BRW-004 (browser secrets, network, human approval). It has NO ticket file — the spec is
program-design.md:972 — so it needs a design pass first, in its own session, before code.
```

---

## 4. Verifying what comes back

**Do not merge on a builder's report.** This session's own record is the argument: five design rounds
failed on the remedy while the diagnosis held every time, and every failure was caught only by
*running* something.

- **Re-run the mutations yourself.** A test that has never been made to fail is not a test.
- **Check the sha the checks ran against**, not just the colour: `gh pr view <n> --json headRefOid`.
  This session reported "all 16 green" from a run belonging to an earlier commit while a newer push
  was already red.
- **A finding's citation must say what the finding says it says.** E7-F011 was filed citing
  `Dockerfile:13` — a comment that establishes the opposite of what it was used for. The audit caught
  it; the author (me) did not.
- **When two sub-agents disagree on a fact, check it yourself.** One searched CI history for a prior
  flake and found nothing; another found it. Verifying the finder took one command.

---

## 5. Merge protocol

1. Builder reports; you verify (§4).
2. `gh pr checks <n>` green **and** `headRefOid` matches what you verified.
3. Squash-merge — the precedent (#339 `0e0904206`, #340 `393f7a251` are both single-parent).
4. **Wait for the integration run to finish** before merging the next track's PR.
5. Update the GO-BOOK row and, if the finding set changed, `finding-ownership.json`.
6. ★ **Read the verdict consumer instead of checking `d1-merge-train` by hand.** DEP-013
   replaced the old habit ("after every merge that touches `docker/**`, check the lane's verdict
   for that sha") with a mechanism. Every merge push runs `verdict-reconcile.yml`, which sweeps
   all watched `(workflow, branch)` streams and rewrites ONE tracking issue — labelled
   `verdict-consumer` — **including when everything is green**, so quiet-and-healthy stays
   distinguishable from dead. A finding there is a verdict that has been read, **not** a claim
   that the lane must be green before anything merges.

   What you should now expect to see:
   - `policy` carries a step **"Verdict consumer is alive (DEP-013)"**. It fails **only** when
     the consumer has gone silent — never because a watched lane is red. If it reds, the
     consumer is broken, not the lane; `gh run list --workflow=verdict-reconcile.yml` is the
     first thing to read.
   - Until the first reconciler run publishes, that step prints `OK (not_bootstrapped)`. **The
     merge that lands DEP-013 is what ends that**, and the very next PR should print
     `OK (fresh)`. If it still says `not_bootstrapped`, the reconciler did not run; if it says
     `ran_but_never_published`, it ran and died before publishing — that one is a real incident
     and is the case the check exists for. Closing steps are in **E6-F013**.
   - The first published sweep will name `cross-platform-weekly.yml@main` (three consecutive
     `cancelled` scheduled runs). That is correct and expected; fixing that lane is its own
     work, not a merge blocker.

★ The GO-BOOK and the findings registers are the **most-touched files across the last 12 landings** —
more than any source file. Two tracks editing §1.9 will conflict before their code does. Have each
track write its GO-BOOK row in its **own** commit at the end, and land those last.

---

## 6. What is NOT true, however often it is repeated

| Claim | Reality |
|---|---|
| "Only two tracks are safe" | No threshold at two. It is a push-cadence limit, and a single lane already tripped it. |
| "Lane B is an active parallel track" | 275 commits behind, ~10 days idle. The GO-BOOK says this in five places; it is a plan, not a state. |
| "The `SandboxProvider` port is frozen" | Measured false 2026-09-03. `capabilities.ts` is a wire vocabulary; the port is non-frozen and already at 13 methods. |
| "argv caps at ~8 KB per job" | The cliff is 8,192 chars **per argument**. What survives is E7-F008. |
| ★★★ "Unit F / output capture is what flips `capabilityProven`" | **Measured false 2026-09-06 — E7-F018 (HIGH, unowned).** Both arms are structurally unreachable in every checked-in configuration, so a producer is **necessary and not sufficient**; the first thing owed is an operator/deployment precondition. One command: `grep -rn AOA_DISTRIBUTED_EXECUTION_ROLLOUT --include=*.yml --include=*.yaml --include=*.json --include=Dockerfile* .` → **the only hit is the finding register's own quotation of that command** (`scripts/finding-ownership.json:154`); add `\| grep -v finding-ownership.json` and it is **zero hits, exit 1**. No compose file, Dockerfile, workflow or manifest arms the dial, so `if (run.distributedJobId)` (`e7-distributed-run-verifier-store.ts:200`) is false and arm 1 issues no query. |
| "E7 is code-complete, blocked only on deployment" | True of CLI-001…007. CLI-008 (size L) has four unbuilt units. |
| "WRK-013 unblocks E5-3" | It unblocks **E4-3**. E5-3's symbol is `createPatchApplyService`, which WRK-013 never touches. |
| "`verify` takes 30–40 minutes" | ~18 min since the 4-way shard. |
| "A cancelled run means another lane cancelled yours" | An in-progress run is never cancelled on this branch. The **pending** one is, and it never runs at all — which looks like nothing happened. |

---

## 7. Superseded handoffs

`HANDOFF-wave-4.md` and `HANDOFF-lane-b-browser-service.md` remain useful for their **deconfliction
contract** (§5 of the latter names the files a second lane may not touch without coordination — that
list is still right). Their **numbers** are not: run duration, the cancellation mechanism, and the
migration slot are all stale, per §6.

---

## 8. State at handoff

- **HEAD:** `e8d2d8a52` on `docs/replatform-program`. Nothing is on `main`; PR #323 is the open
  integration PR, titled "[WIP integration, do not merge]".
- **Just landed:** CLI-008 Unit A (`0e0904206`, PR #339) and Unit B (`393f7a251`, PR #340) — the judge
  and the inbound channel.
- **Open findings:** 17 across 9 registers, 4 unowned. ★ That count **excludes E0/E1/E2 entirely**
  (Track C defect 1), so it is a floor.
- **Dashboard:** the control-room view of all of this is published as an artifact; the GO-BOOK's
  `§1.9` is its source of truth.
