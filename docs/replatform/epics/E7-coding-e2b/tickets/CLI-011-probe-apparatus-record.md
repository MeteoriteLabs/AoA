# CLI-011 probe apparatus — build record (P-011, dispatch-only; evidence for F7)

**Status:** `gate_review`
**Date (UTC):** `2026-09-21`
**Epic:** `E7-coding-e2b`
**Design:** [`CLI-011-review.md`](./CLI-011-review.md) §10.1–10.5 (with §3.2 and §3.7)
**Implementer:** `M1 CLI-011 probe build agent (Claude Opus 5)`
**Start SHA:** `28a2dd259` (program tip), rebased (last) onto the program tip of 2026-09-21 ~12:30 UTC
**Reviewed revision (apparatus code):** `c467e47ddb96bb2ef8737ba63c1dc0624a3e1a25` (apparatus `8ee8e1de3` plus the Codex-review fix)
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
| `.github/workflows/keyed-e2b-cli-011-output-probe.yml` | **It runs only on `workflow_dispatch`**, plus a push trigger that only registers the lane (§6). Inputs are `e2b_template` (empty means `aoa-base`) and `arms` (`all` or `shell-only`). Secrets are `E2B_API_KEY` and `ANTHROPIC_API_KEY`, bound as env only. It has an `always()` fallback record, an `always()` upload of `cli-011-output-probe-record` (90 days), an `always()` skip guard, and `timeout-minutes: 45`. |
| `scripts/lib/cli-011-output-probe.mjs` | The pure core. It holds the verdict for each arm, the `$HOME` census diff and its classification, `evaluateDecisionTable` (all 12 rows of §10.5), `evaluateControls`, `packDisposition`, `buildProbeRecord`, and `evaluateWorkflowShape`. |
| `packages/sandbox-e2b-provider/src/__tests__/keyed-cli-011-output-probe.test.ts` | The keyed observer: P-011a in one sandbox, and P-011b with one fresh sandbox per claude arm. The no-key wiring tests run in `verify`. |
| `scripts/lib/__tests__/cli-011-output-probe.test.mjs` | 36 tests at the final head (34 before the second Codex fix), run in `policy` (step *"CLI-011 P-011 output-probe decision logic (proven WITHOUT the key)"*). |

Registrations:
- `scripts/test-execution-census.json`.
- `scripts/test-inventory.json`: +1 on `scripts` and +1 on `packages/sandbox-e2b-provider` (68→69 and 19→20 at the last rebase).
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
2. **The claude arms stage the no-bundle, no-MCP-config literal.** That is the production literal for
   any Organization whose rollout policy has not armed the tool surface: CLI-016 made arming
   per-Organization, and an absent `tools` means not armed. S-P1 stages the full set, as §10.4
   asks. ★ **Not measured:** the claude literal for a tools-armed Organization. That literal adds
   `--mcp-config "$N" --strict-mcp-config --allowedTools mcp__aoa`
   (`buildSandboxInvocation`, the `stageAoaConfig` branch). A probe cannot mint the run JWT or the
   control-plane `/mcp` that branch needs, so A-neg's census says nothing about MCP-side writes.
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

**Codex review fixes** (commit `c467e47dd`). RED: the new tests against the previous core fail 3 of 34
(*readDeclaration…*, *R5/R6 split A-neg…*, *R11 needs a correct declaration…*). GREEN: 34/34.
- **P1: deletions count as A-neg mutations.** `censusDelta` used to drop removed entries, so a
  CLI that deleted a file under R or in cwd read as `nothing-under-root-or-cwd`, even though the
  A-neg prompt forbids deleting. It now keeps `removedUnderRoot` and `removedCwdOther`, and
  `stagedMutated` for the run's own inputs. R5 fires on a deletion under R, and R6 requires all
  three lists to be empty.
- **P2: an A-decl path must be relative.** An absolute path, `~`, a `.`/`..` segment, an empty
  segment or a backslash is refused (`relative:false`), so it can never fire R11.
- **P2 (second review): a timed-out leg is not a measurement.** An S-P3 leg whose command timed
  out is now `inconclusive`, even when its file is there, because the file may have been written
  before the deadline and no exit was observed. A leg that `threw` stays admissible, since whether a
  non-zero exit throws is part of what S-P3 records (E7-F014). S-P7 gets the same channel check.
  RED: 2 of 36 fail on the previous core. GREEN: 36/36.
- **P1 (third review): a non-zero exit must actually be observed.** An S-P3 leg counts only if it
  `returned` with a numeric exit code other than 0. A leg that `threw` has no exit code that can be
  checked, and a returned exit 0 is not the case under test. Both are now inconclusive, and the
  reason names which one it was. This supersedes the second review's "`threw` stays admissible".
  RED: 1 of 37 fails on the previous core. GREEN: 37/37.
- **P2 (fourth review): the fallback record JSON-encodes operator input.** The `always()` fallback
  step used to insert `e2b_template` and `arms` raw into a JSON string, so a `"` or a newline would
  have made the one record a failed run leaves unparseable. They are now encoded with
  `json.dumps` first. `evaluateWorkflowShape` fails a raw `": "${…}"` interpolation with the code
  `fallback-unescaped-input`, and there is a positive control for each input. I ran the step
  locally with the template ``bad"name<newline>x``, and it wrote valid JSON.
- **P1 (eleventh review): the reporting proxy must BIND its pass-throughs.** The proxy added for
  the partial-create teardown used `Reflect.get(target, prop, receiver)`, which returns a class
  method unbound; called through the proxy, `RealE2bTransport`'s `#sdk`/`#apiKey` private fields
  fail their brand check. `E2bSandboxProvider.create` calls `setTimeout` immediately after
  `transport.create`, so on the real keyed lane EVERY P-011a creation would have thrown into the
  partial-create path and the pack could never have been `measured`. Pass-throughs are now bound to
  the target, and a no-key test drives the proxy with a double that has a private field. RED: the
  unbound version throws `TypeError: Cannot read private member #calls…`, exactly as the review
  predicted.
- **Tenth review — four more, all fixed.**
  - **P1: A-decl needs a readable final `result` frame.** claude can exit 0 with an assistant frame
    and no parseable `result`; recording "no declaration" from that let R11 call option 1b
    infeasible on missing protocol evidence. A-decl is now inconclusive without one, and R11 reads
    `undecidable`. The other arms do not need a `result` frame to answer their own question.
  - **P2: a sandbox allocated before the create step threw is now terminated.**
    `E2bSandboxProvider.create` calls `transport.create` and then `setTimeout`, so a throw in the
    second step left a live sandbox whose id never reached `withSandbox`. The create callback now
    gets a `report(id)` handle (P-011a passes the provider a transport proxy that reports on
    `create`), and a create that throws afterwards is terminated and recorded as
    `<lane>(partial-create)`. Positive control included.
  - **P2: S-P7 needs a successful write before an absence counts.** A shell that saw the canary and
    then failed mid-write leaves a readable empty file; "absent" read off that would let R4 say
    SD-5 is not required. A non-zero exit with no nonce is inconclusive; a present nonce stays
    positive evidence.
  - **P2: the fallback record resolves the template exactly like the probe.** It now trims before
    defaulting, so a whitespace-only input records `aoa-base`/`default-cli-bearing` rather than an
    explicit template the probe never used. Checked by a shape rule with a positive control, and
    exercised locally with a whitespace-only input.
- **P2 (ninth review): the declaration must name the REQUESTED file.** Declaring a scratch file it
  also wrote satisfied "matches something written". `matchesRequested` compares the resolved
  declaration with `R/hello.txt` itself; R11 requires it, and so does A-decl's positive signal.
- **P1 (eighth review): A-decl's positive signal is the DECLARATION.** A failed A-decl run that
  wrote the file but never produced a valid final declaration used to pass the gate on the file
  alone, and R11 would then report option 1b infeasible from a run that never got to try. A-decl's
  signal is now the file **and** a final-frame declaration that resolves to it.
- **P2 (eighth review): S-P4 no longer reads an empty stdout as evidence.** The command's stdout is
  redirected, so it is empty in both worlds. The arm now checks that the target directory was
  absent beforehand (otherwise inconclusive: the premise is wrong), reads the redirect TARGET back
  and treats the marker there as "the command ran", and reports `exit 0` with no marker anywhere as
  inconclusive rather than as "the redirect failed first". RED: 2 of 38 fail on the previous core
  (this row and the one below). GREEN: 38/38.
- **P1 (seventh review): a failed model run is not a negative result.** The CLI can reach a model
  and then fail during a tool call or at finalisation. An arm with a non-zero exit, or an
  `is_error` final `result` frame, is now **inconclusive** — unless it already holds its positive
  signal, because a write that happened before the failure is real evidence (PC-10's case). The
  positive signal is `R/hello.txt` carrying the arm's nonce for A-dir/A-cwd/A-decl, and any
  mutation for A-neg. This matters most for R10 ("neither writes" is outcome (iii)), which now
  reads `undecidable` instead of firing on a broken run. `exitCode` and `finalIsError` are in every
  model arm's findings. RED: 1 of 38 fails on the previous core. GREEN: 38/38.
- **P2 (sixth review): a record that cannot be written FAILS the run.** A failed `writeFileSync`
  used to be caught and logged, so a run that measured everything could finish green while the only
  artefact published was the workflow's `inconclusive` fallback — E7-F025 from the other side.
  `RECORD_STATUS` now carries `written`/`skipped`/`detail`, the keyed assertion requires
  `skipped || written`, and a positive control points the record path at a child of a FILE so the
  write must fail. RED: the control fails on the old emitter (no status at all), and making the
  catch set `written = true` reds it too. GREEN: 10 tests in the file (9 + 1 keyed skip).
- **P1 (fifth review): S-P4 needs a returned exit code.** When the transport threw, S-P4 used to
  read `null !== 0` as "failed closed". It is now inconclusive unless the command `returned` with a
  numeric exit code. The other shell arms (and C-census) already required a returned command, or a
  returned command with exit code 0, before any conclusion; I swept them for this class.

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

**CI.** Run `35827689850` on head `11add718f`, after merging the DEP-016/DEP-017 tip: **all jobs
green, `ci-required` success**.
- Job **`policy`** (`107072950145`): step *"CLI-011 P-011 output-probe decision logic (proven
  WITHOUT the key)"* — `tests 39 / pass 39 / fail 0`.
- Job **`verify`** (`107073003862`): `keyed-cli-011-output-probe.test.ts (11 tests | 1 skipped)` —
  the no-key wiring tests ran, the keyed block skipped for want of a key. Shard total:
  `6436 passed | 13 skipped`.
- The final head adds only the proxy-binding fix above (the pure core is untouched), and its own
  run is the newest on PR #551.
- Earlier green run on the pre-merge branch: `35825564850` (16/16 jobs).

## 6. Registration: the E6-D001 shape (ruled)

**What was measured.** After this branch was pushed as dispatch-only,
`gh api repos/{owner}/{repo}/actions/workflows/keyed-e2b-cli-011-output-probe.yml` returned **HTTP 404**.
A `workflow_dispatch`-only file that is not on the default branch cannot be dispatched until it has
run once.

**The ruling.** The planning session (under founder delegation F2) applied the registration pattern
already ruled for DEP-015: **`E6-D001`** in
[`../../E6-deployment-test-harness/decisions.md`](../../E6-deployment-test-harness/decisions.md).
Putting the file on `main` is out, because the locked strategy forbids any change to `main` before
M5. The lane now has this shape:

1. `on:` keeps `workflow_dispatch` and adds
   `push: { branches: [docs/replatform-program], paths: [".github/workflows/keyed-e2b-cli-011-output-probe.yml"] }`.
   The only push path is the workflow's own path, so no code change can fire it.
2. The one job, `probe`, has the job-level guard `if: github.event_name == 'workflow_dispatch'`. A
   run created by a push executes **zero steps** and reads **zero secrets**. §3.7's warning about
   pushes that spend money on merge does not apply, because every job is skipped.

**Enforcement.** `evaluateWorkflowShape` runs in `policy` and accepts exactly this shape. Each
deviation fails with its own code, and each has a positive-control test:
- a push without `paths` (`push-without-paths`);
- extra paths, or §10.2's trigger-file path instead of the workflow's own (`push-extra-paths`);
- another branch (`push-branch`);
- `paths-ignore` or another filter (`push-other-filter`);
- no registration push (`registration-push-missing`);
- a job with no guard, or with a weaker `if` (`job-not-dispatch-gated`), and a second, unguarded job;
- `pull_request`, `schedule`, `workflow_call`, `merge_group` or `workflow_run` (`non-dispatch-trigger`).

`readJobGates` is tested against the committed file (anti-vacuity: it must read at least one job).

- **RED:** the previous shape check, run on the ruled workflow, rejects the ruled shape
  (`["non-dispatch-trigger"]`). It also has no job-guard check: a workflow with the guard removed
  produced the same single code.
- **GREEN:** 37/37.
- **Mutations:** disabling the guard check, or the `paths` check, turns the positive-control test RED.

`workflow-verdict-manifest.json` declares the stream `keyed-e2b-cli-011-output-probe.yml@docs/replatform-program`
as `not-watched`, the same as DEP-015's: a verdict on a skipped job would be a check that nothing runs.

**The pattern is live on its first lane.** DEP-015's `m1-shipped-boot.yml` registered exactly this
way: run `35598343418` (`push`, conclusion `skipped`, head `947b684d8`) and again `35612758100`
(`push`, `skipped`, head `d0f065b13`) — a push-created run whose job executed nothing — after which
`gh workflow run m1-shipped-boot.yml` dispatched for real (runs `35618468241` and `35619555883`,
both `workflow_dispatch`, both `success`). So the shape both registers the lane and spends nothing on
merge.

**Registration run.** GitHub records one run when #551 merges. The planning session cites that run
here and checks that its `probe` job was `skipped`. **(Pending merge.)**

## 7. Known limits

- **The CLI-016 MCP tool surface.** The probe does not run the claude invocation with CLI-016's MCP
  tool surface turned on. M1-D2-CODING exercises that combination.
- **Two deviations, accepted by the planning session:** a separate sandbox for each claude arm, and
  the record name `CLI-011-probe-apparatus-record.md`, which avoids the `-result.md` trap.
