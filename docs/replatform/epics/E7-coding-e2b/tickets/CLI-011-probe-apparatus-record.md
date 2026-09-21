# CLI-011 probe apparatus — build record (P-011, dispatch-only; evidence for F7)

**Status:** `gate_review`
**Date (UTC):** `2026-09-21`
**Epic:** `E7-coding-e2b`
**Design:** [`CLI-011-review.md`](./CLI-011-review.md) §10.1–10.5 (with §3.2 and §3.7)
**Implementer:** `M1 CLI-011 probe build agent (Claude Opus 5)`
**Start SHA:** `28a2dd259` (program tip)
**PR:** #551 (base `docs/replatform-program`)

The implementer leaves `Status` at `gate_review`. Only a separate reviewer may set it to
`complete`.

★ **Why the file name ends in `-record` and not `-result`.** `check-finding-ownership` treats any
`CLI-011*-result.md` on disk as proof that CLI-011 has **shipped**. It then reds `E7-F026`, whose
owner is `CLI-011`, because a shipped owner must name a successor. CLI-011 has not shipped: its
result follows the F7 ruling (review §13.7). **The same guard will red on §10.3's planned
`CLI-011-probe-result.md`.** That file needs a name that does not end in `-result.md`, or the
`E7-F026` ownership has to be settled first.

★ **This is the apparatus only.** It has **not been dispatched.** The probe's own verdict belongs in
`tickets/CLI-011-probe-result.md`, which the planning session writes from the durable record after
it dispatches (§10.3). **Nothing here is evidence about the output mechanism yet.**

---

## 1. What was built

| path | what |
|---|---|
| `.github/workflows/keyed-e2b-cli-011-output-probe.yml` | **`workflow_dispatch` only**. Inputs are `e2b_template` (empty means `aoa-base`) and `arms` (`all` or `shell-only`). Secrets are `E2B_API_KEY` and `ANTHROPIC_API_KEY`, bound as env only. It has an `always()` fallback record, an `always()` upload of `cli-011-output-probe-record` (90 days), an `always()` skip guard, and `timeout-minutes: 45`. |
| `scripts/lib/cli-011-output-probe.mjs` | The pure core. It holds the verdict for each arm, the `$HOME` census diff and its classification, `evaluateDecisionTable` (all 12 rows of §10.5), `evaluateControls`, `packDisposition`, `buildProbeRecord`, and `evaluateWorkflowShape`. |
| `packages/sandbox-e2b-provider/src/__tests__/keyed-cli-011-output-probe.test.ts` | The keyed observer: P-011a in one sandbox, and P-011b with one fresh sandbox per claude arm. The no-key wiring tests run in `verify`. |
| `scripts/lib/__tests__/cli-011-output-probe.test.mjs` | 34 tests, run in `policy` (step *"CLI-011 P-011 output-probe decision logic (proven WITHOUT the key)"*). |

Registrations:
- `scripts/test-execution-census.json`.
- `scripts/test-inventory.json`: `scripts` 66→67 and `packages/sandbox-e2b-provider` 19→20.
- `scripts/workflow-verdict-manifest.json`: `keyed-e2b-cli-011-output-probe.yml@*`, `not-watched`, with a reason and `wouldTakeToWatch`.
- The `policy` step went in as the job's last step, so no register-cited `policy` line moves. It still shifts the downstream `verify` and `distributed-contract` lines. The 15 citations in `docs/architecture/distributed-execution-threat-controls.json` were re-pointed: `pr.yml:1118→1134` and `pr.yml:1599→1615`. Their anchors are unchanged, and `check-register-citation-integrity` passes.

## 2. How each §10.5 row is made decidable

For every row, the durable record carries `{id, result, reading, fired: true|false|"undecidable",
because}`. `because` quotes the arm facts the row read. A row is `undecidable` only when an arm it
reads is `inconclusive` or `not-run`, and it names that arm. For example, `R5` reads
`A-neg=inconclusive` when there is no key. The record also carries each arm's raw evidence, redacted
and bounded: listings with `type`, `size` and `symlinkTarget`; the census delta per arm; claude's
stdout, capped at 8000 characters; the `init` frame's `permissionMode`; and the final `result` text.
A reader can therefore re-derive every verdict.

| row | read from |
|---|---|
| R1 | S-P0: `files.list(R)`, a transport read of R, and `files.list(/home/user, depth 3)`, before any write or exec |
| R2 | S-P2: SDK `files.list(R)` at its default depth, checked for `dir` entries. The deep listing and the CLI-010 `transport.listDir(R)` are recorded next to it |
| R3 | S-P5: whether `l1`/`l2` appear with `symlinkTarget`/type in the depth-8 list, and whether a transport read of `R/l1` returns the staged prompt's bytes |
| R4 | S-P7: the canary is set through `provider.create`'s `spec.env` (the production `[Cred-1]` channel), the shell writes it to `R/env.txt`, and a transport read checks for it. If the shell never saw the env var, the arm is inconclusive |
| R5, R6 | A-neg: the census delta classified as under-root, cwd-other or cli-home-state. R5 names **OPTION 2 REFUTED** when A-dir's R also holds non-`hello.txt` files |
| R7–R10 | A-dir and A-cwd: whether `R/hello.txt` exists **and contains the arm's nonce**. Exactly one of the four rows fires (pinned in `policy`) |
| R11 | A-decl: the last line of the **final** `result` frame, `AOA-OUTPUT: <path>`, resolved against R and matched to a file the arm wrote |
| R12 | The pack disposition: an arm is inconclusive or missing, or a control did not hold |

## 3. Positive controls (each expects the NEGATIVE outcome)

| id | live arm | expectation | if it does not hold |
|---|---|---|---|
| PC-1 (§8) | S-PC1 | after S-P0, a file planted in R with `writeFiles`, then the **same** S-P0 check, must report `present` | the pack is `inconclusive` and R12 fires |
| PC-2 (§8) | S-PC2 | the S-P1 check run on the real listing with `R = /home/user` must find all 3 staged paths | the same |
| C-census (proposed here) | C-census, before A-neg | a shell write under R and one in cwd must both appear in the census diff | the same, because otherwise A-neg's "nothing written" could just mean the census is blind |

The `policy` suite reds if PC-1 or PC-2 is forced to the wrong outcome. That is the test
*"POSITIVE CONTROL: a control that did not produce its expected negative reds the whole pack"*.

## 4. Deviations from §10.4, and why

1. **One fresh sandbox per claude arm**, where §10.4 names a single sandbox S2. Session state the CLI
   creates on its first run would already exist when a later arm ran, so A-cwd's "the CLI writes into
   cwd = R" could read false only because the CLI had nothing left to create. Production runs one
   attempt per fresh sandbox (review §9.1 A-O2-12). The number of claude turns is unchanged: four,
   each capped at 180 s.
2. **The claude arms stage the no-bundle, no-MCP-config literal.** That is the production default
   while Unit C's tool surface is off (`distributed-execution.ts`). S-P1 stages the full set, as
   §10.4 asks.
3. **`cli-home-state`.** Changed paths under `~/.claude/`, `~/.claude.json`, `~/.config/`,
   `~/.cache/`, `~/.npm/` and `~/.local/` are reported but not counted as cwd writes, because
   `$HOME` = cwd = `/home/user` here (§3.4). The prefix list is written into the record, so a reader
   can reclassify.
4. **The added `arms=shell-only` mode** runs P-011a alone and spends no model tokens.

## 5. Evidence

**RED.** Before the workflow and the keyed test existed, the policy suite ran 34 tests: 31 passed
and 3 failed, all on `ENOENT` for the workflow and keyed-test files (*"the committed workflow
satisfies every shape rule"*, *"POSITIVE CONTROL: each workflow mutation…"*, *"the keyed test
imports buildSandboxInvocation…"*).

**GREEN (local, Windows).**
- The policy suite passes 34/34.
- `pnpm --filter @armyofagents/sandbox-e2b-provider exec vitest run`: 17 files passed and 3 skipped
  (147 tests passed, 32 skipped). The keyed block is skipped because there is no key; this file's 8
  no-key tests pass.
- `tsc --noEmit` is clean.
- The full `pr.yml` guard set and `check-evidence-immutability --base origin/docs/replatform-program`
  report 0 failures.

**Mutations.** Each mutation was applied, run, and reverted. All eight went RED.

| # | mutation | suite that reds |
|---|---|---|
| M1 | `withSandbox` never calls `terminate` | vitest, no-key: *"withSandbox terminates the sandbox when the arm THROWS"* |
| M2 | `withCwdPrefix` returns the script unchanged | policy: the shipped-literal transform test |
| M3 | `diffSnapshots` ignores mtime | policy: the census diff test |
| M4 | `evaluateWorkflowShape` accepts extra triggers | policy: the workflow-mutation positive control (the push-trigger case) |
| M5 | PC-1 always holds | policy: the control positive control |
| M6 | the model-contact gate is dropped | policy: *"a model arm is NOT a measurement without … model contact"* |
| M7 | the record is written unredacted | vitest, no-key: the record test (the canary appears) |
| M8 | CLI home state is counted as cwd | policy: the classification and census tests |

**CI.** Run `35590097325` on code head `d30847e57f031b2e56996e98b525ed99ca547db4`. That commit
holds all the apparatus code. The only later commits change this record.
- Job **`policy`** (`106302304785`), success. In step *"CLI-011 P-011 output-probe decision logic
  (proven WITHOUT the key)"*: `tests 34 / pass 34 / fail 0`.
- Job **`verify (1)`** (`106302356653`), success. `keyed-cli-011-output-probe.test.ts (9 tests | 1
  skipped)`: the 8 no-key wiring tests ran, and the keyed block was skipped because CI has no key.
  Shard total: `655 passed | 3 skipped` files and `6396 passed | 13 skipped` tests.
- **`ci-required`** (`106307552159`): success.

## 6. ★ Stop item: a dispatch-only workflow may not be dispatchable

After this branch was pushed, `gh api repos/{owner}/{repo}/actions/workflows/keyed-e2b-cli-011-output-probe.yml`
returned **HTTP 404**. The workflow is not indexed. Two records point the same way:
- `keyed-e2b-w7u1-output-probe.yml`'s header records the same 404 for a lane that had never run
  (`keyed-e2b-egress-constraint-probe.yml`, 2026-09-04).
- Every sibling keyed lane on this branch was first indexed by a **push** run.

§10.2 designed a push route on **only** `.github/keyed-e2b-cli-011-output-probe-trigger`, a file
the PR does not create, so merging fires nothing. The brief for this build said "workflow_dispatch
ONLY — NO push trigger", and this PR follows the brief; `evaluateWorkflowShape` reds on any other
trigger. **If the dispatch 404s after merge**, the planning session has to choose between two
options:
- (a) add §10.2's trigger-file-only push route, and relax the shape check to allow exactly that one
  path;
- (b) land the workflow file on `main` so that it gets indexed.

This record does not choose.
