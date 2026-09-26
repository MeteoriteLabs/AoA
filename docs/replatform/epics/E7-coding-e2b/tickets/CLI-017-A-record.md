# CLI-017-A Record — the SD-1b output-root directive, `R`'s server-side constant, and SD-4's equality check

**Status:** `gate_review`
**Date (UTC):** `2026-09-24`
**Epic:** `E7-coding-e2b`
**Plan task:** `E7 implementation-plan ### CLI-017 — the EMIT build`, slice **`CLI-017-A`**
**Graph node:** `program-design.md #### CLI-017`
**Implementer:** `M1b CLI-017 build agent (Claude Opus 5)`
**Start SHA:** `9ad5666df6` (program tip at start; rebased onto `6b468773f1` when the base moved)
**Reviewed revision (implementation commit):** `147d5454c9161e7b401064e232100299b334a6e9`
★ *Re-pointed 2026-09-24 after the branch was rebased onto `6a3882f39` (the base moved twice during this ticket). The pre-rebase id was `b790d1f7f2e2d01137e775f119412212d4d1fb2f`, which is no longer an ancestor of the PR head — a reviewed revision that is not an ancestor is the record-rot failure this programme keeps paying for, so the id is re-pointed rather than left to read as authoritative. The tree of this commit is unchanged by the rebase; only its parent moved.*
**Ruling:** `decisions.md` `E7-D11` (ruling F7, decided under founder delegation F2)
**Acceptance rows carried:** **1, 3, 4** and the **directive half of 5**

★★★ **THIS IS A RECORD, NOT A RESULT, AND THE FILENAME IS THE POINT.** The task section records
why: `-A-result.md` would match `findCompletedTicketIds`' `/^([A-Z]+-\d+).*-result\.md$/` and
resolve to **`CLI-017`**, so landing this slice alone would mark the whole ticket shipped while the
**security** slice did not exist. The aggregate `tickets/CLI-017-result.md` is written **only after
both slice records are approved by a distinct reviewer**, and its existence is the only signal that
`CLI-017` shipped. **This record does not write it.**

The implementer leaves `Status` at `gate_review`. A separate reviewer completes the review section
and is the only role that may change it to `complete`.

---

## 1. What was measured before building

Re-measured at source at the start SHA, because the task section's "Current state" block was
measured at `499ec4d1c` and the code is the truth:

| the task section says | measured at `9ad5666df6` |
|---|---|
| "Nothing tells the agent where to write." | **Confirmed.** `buildSandboxInvocation` (`server/src/services/task-run-sandbox-invocation.ts`) stages three flat files under `STAGED_INPUT_DIR = "/home/user"` and emits a claude script with no cwd change and no output-location directive. |
| "The caller-side seam exists and is unpinned." | **Confirmed.** `heartbeat.ts`'s canary block passes `currentTaskMarkdown` into `buildTaskRunBatchWorkload`. No test asserted the staged prompt bytes at that call site. |
| "`R` has no constant … no production `aoa-output` literal exists in `server/src/`, `packages/worker-daemon/src/` or `packages/sandbox-e2b-provider/src/`." | ★ **DIVERGES, AND IN THIS SLICE'S FAVOUR.** The **worker-side** constant now EXISTS: `DEFAULT_OUTPUT_ROOT = "/home/user/aoa-output"` in `packages/worker-daemon/src/lease/export-request-producer.ts`, shipped by `CLI-012` after that measurement was taken. So this slice creates the **server-side** half only, and SD-4's check compares the two rather than minting both. The task's Files line ("create the worker-side `R` constant where `CLI-012` composes `outputRoot`") is already discharged. Recorded rather than silently absorbed. |
| "`exportArtifact` inspects size and hash only." | **DIVERGES** — `CLI-012` also shipped the SD-5 **presence** refusal and the `lstat` recheck. Neither affects this slice; both are `CLI-017-B`'s surface and are recorded there. |

## 2. The one design decision this slice made, and why

**`R` lives in a NEW module, `server/src/services/sandbox-output-root.ts`, not beside
`STAGED_INPUT_DIR`.** The task section names `task-run-sandbox-invocation.ts` as the natural home
and states the cost in the same breath: that file is on `.github/workflows/keyed-e2b-unit-d.yml`'s
`paths`, so **editing it auto-fires a keyed E2B lane on merge** to `docs/replatform-program` (review
§3.7). Keyed spend is the planning session's under founder ruling **F8** and is not this ticket's to
authorize, so the task's own stated alternative is taken — *"put the constant in a new server module
instead and say so in the result"*. **This is that saying-so.** A consequence worth naming: because
`task-run-sandbox-invocation.ts` is untouched, every `E7-F026` staged-byte pin stays green
**unedited**, which is also part of acceptance row 4's evidence.

## 3. RED

`server/src/__tests__/cli-017-output-root-directive.test.ts`, run before the `heartbeat.ts` append
existed (the module was written first, so the behavioural arms already passed; the arms that
*matter* are the call-site ones, and those were the RED):

```
 FAIL  src/__tests__/cli-017-output-root-directive.test.ts > … > PC-12 call site …
       > the canary block's `currentTaskMarkdown` is the DIRECTIVE's output, not the raw context
 FAIL  … > the call site passes BOTH gates — the adapter type and the sandbox target
       AssertionError: expected -1 to be greater than -1
 Tests  3 failed | 7 passed (10)
```

That is the review's own complaint made mechanical: *"SD-1b's 'none' is a search result, not a
proof. No test asserts the staged prompt bytes at the heartbeat call site … an unpinned directive
can be deleted silently."*

## 4. GREEN

```
 ✓ src/__tests__/cli-017-output-root-directive.test.ts (10 tests)
 Tests  10 passed (10)

 node --test scripts/lib/__tests__/sandbox-output-root-check.test.mjs
 ℹ tests 8   ℹ pass 8   ℹ fail 0

 node scripts/check-sandbox-output-root.mjs
 check-sandbox-output-root: OK — one R, "/home/user/aoa-output", on both sides.
```

Row 4's *"the codex shape pins (census rows 4 and 7) stay green unedited"*:

```
 ✓ src/__tests__/cli-008-unit-b-byte-source.integration.test.ts (5 tests)   [file UNEDITED]
 ✓ src/__tests__/task-run-batch-workload.test.ts (95 tests)                 [file UNEDITED]
```

## 5. Mutation and positive-control table

Every mutant was applied to the **real source tree**, run, and reverted.

| id | mutant | expected | observed |
|---|---|---|---|
| **M-A1** | Delete the append at the `heartbeat.ts` call site (restore `currentTaskMarkdown: context.currentTaskMarkdown`) — **acceptance row 1's named mutant** | PC-12 reds | **RED.** `Tests 2 failed | 8 passed (10)`; both call-site arms. The behavioural arms stayed green, which is exactly why the call-site arm has to exist. |
| **M-A2** | Drop the `claude_local` gate so the directive is appended for every adapter — **acceptance row 4's named mutant** | the codex arm reds | **RED.** `Tests 1 failed | 9 passed (10)` — *"row 4: `codex_local` is UNTOUCHED"*. |
| **M-A3** | Change one word of the directive text | the byte pin reds | **RED.** `Tests 1 failed | 9 passed (10)` — *"row 1: the EXACT directive text is pinned byte-for-byte"*. |
| **M-A4** | Drift the SERVER `R` constant to `/home/user/aoa-out` — **acceptance row 3's named mutant** | the `policy` check reds | **RED.** `check-sandbox-output-root: SD-4 violated` with both a `mismatch:` and an `unruled:` problem, `exit 1`. Reverted: `OK — one R … on both sides`, `exit 0`. |

**Positive controls inside the guard's own suite** (`sandbox-output-root-check.test.mjs`, 8 tests):
server drift reds; worker drift reds; **both moved together to an unruled value still reds** (SD-4
is agreement *and* the ruled value, so a coordinated edit cannot sail through); a **renamed**
constant reads as `absent:` and reds; an **unreadable** file reds rather than skipping; the
extractor refuses template literals and computed expressions; and a **non-vacuity** arm reads the
REAL tree so the six synthetic cases cannot all pass against a repo where neither constant exists.

**And it demonstrably runs.** Declared `"status": "ci"` in `scripts/guard-inventory.json` and wired
into `.github/workflows/pr.yml`'s `policy` job as the step *"Sandbox output root is ONE value
(SD-4)"*, which invokes the CLI **and** `node --test` on its positive controls. Its test file is
declared `"status": "runs"` against that workflow and step in `scripts/test-execution-census.json`.

## 6. Acceptance rows

| # | row | where |
|---|---|---|
| **1** | PC-12 — the directive reaches the agent, exact text | `cli-017-output-root-directive.test.ts`: the byte-for-byte pin, the staged-prompt-bytes arm through the **real** `buildTaskRunBatchWorkload`, the empty-base arm, and the three call-site arms. Mutant **M-A1**. |
| **3** | `R` cannot drift, checked in `policy` | `scripts/check-sandbox-output-root.mjs` + its 8 controls; declared in `guard-inventory.json`. Mutant **M-A4**. |
| **4** | `codex_local` untouched, `R` stays absent | the codex arm (through the real builder) + the census pins green **unedited**. Mutant **M-A2**. |
| **5** (directive half) | Cross-tenant, founder ruling **F10** | two Organizations resolved concurrently; each prompt carries its own task and the same tenant-independent directive; **neither contains a byte of the other's**, asserted on the staged bytes; **same-tenant positive control** asserts each string *does* appear in its own tenant's bytes, so the cross-tenant assertion is not vacuous; and re-resolving B does not perturb A. |

## 7. Stated behaviour change, carried from the ruling

Under SD-1b the directive is part of the staged prompt, so it counts against
`MAX_STAGED_FILE_BYTES` (`1_048_576`, `server/src/services/task-run-batch-workload.ts`). A task
within roughly 200 bytes of that ceiling which built before is now **refused — never truncated**.
Rollback is removing the append: the staged prompt returns byte-identical, and a non-distributed or
`codex_local` run is byte-identical today.

## 8. What awaits a keyed run — stated, not glossed

★★★ **This slice dispatched NO keyed workflow.** Ruling F8 reserves keyed spend to the planning
session, and this ticket is not on its named list. The following are **not** proven here:

- **The joint real-run case with `CLI-012`.** A distributed run whose agent actually writes under
  `R`, one `committed` `job_artifacts` row for that file, and the SD-5 refusal exercised on a
  planted canary in the same lane. `CLI-012`'s result must say the same thing, and it does.
  Until it runs, **`CLI-017-A` is proven against unit pins** — the directive's bytes and its call
  site — and **not against an agent that obeyed it**.
- **The template precondition** (`E7-D11`, *Conditions on the ruling*): `S-P0` (root empty) **and**
  `A-neg` (a no-op run writes nothing under it) on the template the `M1b` campaign actually runs
  on, dispatched `-f arms=a-neg-only`. It is an **OPERATOR** precondition; `CLI-017` cannot
  discharge it and this record does not claim to.

## 9. Files

| file | change |
|---|---|
| `server/src/services/sandbox-output-root.ts` | **new** — `SANDBOX_OUTPUT_ROOT`, `SANDBOX_OUTPUT_ROOT_DIRECTIVE`, `applySandboxOutputRootDirective` |
| `server/src/services/heartbeat.ts` | the SD-1b append at the canary block's `buildTaskRunBatchWorkload` call |
| `server/src/__tests__/cli-017-output-root-directive.test.ts` | **new** — PC-12 |
| `scripts/check-sandbox-output-root.mjs`, `scripts/lib/sandbox-output-root-check.mjs`, `scripts/lib/__tests__/sandbox-output-root-check.test.mjs` | **new** — SD-4 and its controls |
| `.github/workflows/pr.yml` | the `policy` step |
| `scripts/guard-inventory.json`, `scripts/test-execution-census.json` | declarations |
| `docs/architecture/distributed-execution-threat-controls.json` | citation lines re-pointed where this slice's edits moved them (`heartbeat.ts` +20, `pr.yml` +10/+11); census stays **397** |

## 10. CI

Recorded by the reviewer against the PR head. Local, at the reviewed revision:

| suite | executed |
|---|---|
| `server` — `cli-017-output-root-directive.test.ts` | **10 passed** |
| `server` — `cli-008-unit-b-byte-source.integration.test.ts` (unedited census pins) | **5 passed** |
| `server` — `task-run-batch-workload.test.ts` (unedited) | **95 passed** |
| `node --test scripts/lib/__tests__/sandbox-output-root-check.test.mjs` | **8 passed** |
| full pure-node guard set + `check-evidence-immutability --base origin/docs/replatform-program` | **0 failures** |

`server` typecheck: no error in any file this slice touches. 70 pre-existing errors remain, all in
`plugin-*` / `capability-*` modules whose `@armyofagents/plugin-sdk` and
`@armyofagents/provider-capability` dists are not built in this environment; the set is unchanged by
this slice.


## CI on the final head — `verify (1)` is RED on a DIAGNOSED harness port collision, not on this diff

**Measured, not assumed.** All four `verify` shards, `e2e`, `policy`, `migrations`, `lint`,
`browser`, `distributed-contract`, `brand-check` and **`ci-required`** were **pass** on
`e610a5a72` — the last head carrying code. The only delta to `87005e7b0` is a single Markdown file
in `docs/replatform/`, yet `verify (1)` then failed **twice**, and on a DIFFERENT test of the same
file each time (`distributed-execution-db-startup.integration.test.ts`).

**The cause, read out of the captured child output rather than guessed.** The server **boots
successfully** — the banner prints, `Auth ready`, `Migrations already applied` — and reports:

```
Server          58991 (requested 58990)
API             http://127.0.0.1:58991/api (health: http://127.0.0.1:58991/api/health)
```

It fell back a port because 58990 was taken. The harness's readiness probe polls
`http://127.0.0.1:${httpPort}/api/health` — the **requested** port (verified at source in the
`startServer` helper of that file) — so it can never succeed, and the 30-second race resolves to
`timeout`. Whichever case happens to draw a colliding port is the one that fails, which is exactly
the "different test each run" pattern.

**Why it is not this diff:** the server booted, so no module-level regression from the `heartbeat.ts`
import is involved; a boot break would fail every server suite, and 662 of 663 test files pass. The
base branch's own `verify (1)` is **success** on the same shard.

**Not fixed here, and FILED with the diagnosis so nobody re-derives it: `E7-F045`** (`findings.md`,
LOW, open, declared `unowned` in `scripts/finding-ownership.json`, carrying both port numbers). It is
a harness defect in a file no chartered ticket owns; naming `CLI-017` would be the invented
ownership `check-finding-ownership` exists to prevent. The closure route is written into the entry:
preferably have the probe read the server's **actual** bound port (the banner already reports it and
the helper already accumulates that stdout), otherwise allocate with the `allocateEmbeddedPgPort`-style
helper the other integration suites use — with a positive control that a deliberately **pre-bound**
requested port still boots and is still detected, or the fix is unproven against the very case that
produced it.

---

## Review

*(to be completed by a distinct reviewer — the implementer may not set `complete`)*

**Reviewer:** `M1b independent reviewer (Claude Opus 5)`
**Date (UTC):** `2026-09-24`
**Decision:** `approved`; `Status` stays `gate_review` (keyed items) — see review attempt 1 below.

### Review attempt 1 — independent reviewer

**Reviewer:** `M1b independent reviewer (Claude Opus 5)` — distinct from the implementer.
**Date (UTC):** `2026-09-24`
**Reviewed revision (40-hex):** `d9b25579d001515d24dfb1a84a9fa4758ffd31c3` (the squash of PR #592, an ancestor of this review's HEAD). ★ **The re-point is genuine and current for THIS slice.** `147d5454c9161e7b401064e232100299b334a6e9`
**is** an ancestor of the PR head `2aaeb1169b6adbd37e3ac77ff7a230f68bb1b077` (`git merge-base
--is-ancestor`), and the pre-rebase id is kept as written. Every product file this slice owns —
`sandbox-output-root.ts`, `heartbeat.ts`, `cli-017-output-root-directive.test.ts`,
`check-sandbox-output-root.mjs` and its lib + controls, `pr.yml` — is **unchanged** between
`147d5454c9` and the PR head; the one later edit to a slice-A-caused pin
(`cli-006-seam-suppression.test.ts`) is disclosed in slice B's §11a. So the cited revision describes
this slice's code as it now stands.
**Disposition:** `approved` (code and record). **`Status` stays `gate_review`** — see below.

#### Verified at source

- **★ PC-12 exists and it REDS — it is not a search result.** `cli-017-output-root-directive.test.ts`
  carries the byte-for-byte directive pin, a staged-prompt-bytes arm through the **real**
  `buildTaskRunBatchWorkload`, an empty-base arm, the `codex_local` arm, a non-distributed arm, the
  F10 arm, **and** three call-site arms that read `heartbeat.ts` and anchor on
  `buildTaskRunBatchWorkload({` rather than searching the whole file — so leaving the helper called
  dead elsewhere would not keep them green. At source, `heartbeat.ts:5351` is
  `currentTaskMarkdown: applySandboxOutputRootDirective({ adapterType: agent.adapterType,
  runTargetsSandbox, currentTaskMarkdown: context.currentTaskMarkdown })`, i.e. both gates inside the
  pinned expression. **M-A1** (restore the raw context) necessarily reds the two anchored arms; that
  is `E7-D11`'s required positive control, so PC-12 is present and mandatory-satisfying.
  ★ I record the shape honestly: the call-site half is a **source-text** pin, not a behavioural one,
  and the behavioural arm proves the helper's output. Together they meet the ruling's requirement
  (a pin at the SD-1 site whose positive control is that deleting the directive reds it); the record
  says as much in its own M-A1 row.
- **★ M-A4 RE-EXECUTED, not taken on trust.** I mutated `SANDBOX_OUTPUT_ROOT` to
  `/home/user/aoa-out` in the real tree and ran the guard:
  `check-sandbox-output-root: SD-4 violated (E7-D11 §1, CLI-017-A)` with both a `mismatch:` and an
  `unruled:` problem, **exit 1**; reverted → `OK — one R … on both sides`, exit 0. Its 8 controls also
  pass here (`node --test … sandbox-output-root-check.test.mjs` → `pass 8`), and the guard is wired
  into `pr.yml`'s `policy` job (lines 214–215) with `guard-inventory.json` status `ci`. A guard that
  runs and that reds: acceptance row 3 is met.
- **Row 4** — the codex arm goes through the real builder, and the two census pin files are
  **unedited** in the diff (confirmed against the PR range), which is the row's own evidence.
- **The new-module design decision** is the task's own stated alternative, taken to avoid auto-firing
  `keyed-e2b-unit-d.yml` (keyed spend is F8's), and it is recorded rather than silently absorbed.
- **The `E7-F045` re-mint** is handled correctly: the id was re-minted from `E7-F043` after `CLI-013`
  took it, the collision was caught by `check-register-id-uniqueness` on the merge ref, and the
  superseded id is quoted rather than rewritten.
- **CI:** `ci-required` is `success` on the final head `2aaeb1169b`, and no check on that head is
  non-success. ★ The record's closing "verify (1) is RED on the final head" section is therefore
  **stale as written** — it describes `87005e7b0`, not `2aaeb1169b`. The diagnosis it records is
  sound and is filed as `E7-F045`; I flag only that a reader will take "final head" literally.

#### Why `Status` stays `gate_review`

The code is approved and every **unit** row this slice carries is met. `CLI-017`'s acceptance also
includes the plan's *"Real-run acceptance — it PAIRS WITH `CLI-012`"* — a distributed real-E2B run
whose agent writes under `R`, with one `committed` `job_artifacts` row and the SD-5 refusal exercised
on a planted canary in the same lane — and the `E7-D11` template precondition (`S-P0` + `A-neg`,
`-f arms=a-neg-only`). **Neither has run.** Keyed dispatch is the planning session's under ruling F8
and is not this ticket's or this review's to fire, so the flip is not mine to make. §8 of this record
states the same thing, which is what the plan requires of it.

#### ★ Addendum — the reviewer RERUN, at the full 40-hex revision

*Appended 2026-09-24 by the same reviewer. Two Codex findings on PR #595, both verified before
acting: the reviewed-revision field was written abbreviated (`d9b25579d…`) where the protocol asks for
a bare 40-hex id — **real, and corrected above**; and this review had recorded no rerun of the focused
command at the reviewed revision — **real**, and done here.*

Run at `d9b25579d001515d24dfb1a84a9fa4758ffd31c3`, checked out detached, with dependencies installed
in the review worktree:

| command | result |
|---|---|
| `pnpm --filter @armyofagents/server exec vitest run src/__tests__/cli-017-output-root-directive.test.ts` | **10 passed** |
| `node scripts/check-sandbox-output-root.mjs` | `OK — one R, "/home/user/aoa-output", on both sides` |
| `node --test scripts/lib/__tests__/sandbox-output-root-check.test.mjs` | **pass 8** |

**★ M-A1 RE-EXECUTED by the reviewer.** Restoring `currentTaskMarkdown: context.currentTaskMarkdown`
at the `heartbeat.ts` call site gives exactly **`2 failed | 8 passed`** — the two anchored call-site
arms — reproducing the record's own row to the count, and confirming that the behavioural arms alone
would NOT have caught the deletion. That is `E7-D11`'s required positive control for PC-12, measured
here. Reverted; baseline back to `10 passed`.

**Disposition unchanged: `approved`, `Status` stays `gate_review`** on the unrun keyed half.
