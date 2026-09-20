# M0 — record and lane health: execution plan

**Milestone:** `M0` (`epic-regrooming/scope-triage.md` → *The milestone sequence*).
**Candidate at planning time:** `169be1f2c13bc6f766abcac520a193168e572e7e` (= `origin/docs/replatform-program` tip, 0 commits either way).
**Plan status:** proposal. This document schedules work; it approves nothing and flips no status.

---

## 1. Starting state, re-measured at the candidate

Every row below was measured at `169be1f2c`, not inherited from a document.

| # | M0 exit criterion | State | Evidence |
|---|---|---|---|
| 1 | `d1-merge-train` + every keyed lane green or quarantined with an owner | **NOT MET** | SS-1 |
| 2 | the `DEP-013` consumer reporting zero unowned findings | **NOT MET** — 2 findings | SS-2 |
| 3 | disposition-A record corrections landed | **NOT MET** — 1 of 20 has a task | SS-3 |
| 4 | a successor filed for `E7-F007` | **NOT MET** | SS-4 |
| 5 | `MIG-010`'s own result committed and approved | **NOT MET** | SS-5 |
| 6 | approved, candidate-current result for every disposition-B ticket | **NOT MET** — 7 owed, 4 have no task | SS-6 |

All seven policy guards are green at the candidate, including
`check-evidence-immutability.mjs --base origin/docs/replatform-program`.

### SS-1 — lane health

`d1-merge-train@docs/replatform-program` is **green** at `52626d80e` (2026-09-20) and the consumer
reports coverage satisfied ("nothing owed"). Six of the seven keyed lanes are green on their watched
branch. Two streams are red:

- `keyed-e2b-unit-d.yml@docs/replatform-program` — `failure` at `74103f95d`.
- `cross-platform-weekly.yml@main` — `cancelled` on every scheduled run from 2026-08-16 to
  2026-09-20 inclusive (six consecutive weeks). Measured cause: `verify-cross-platform
  (macos-latest)` **fails** at `Run tests`; `(windows-latest)` exceeds its 25-minute
  `timeout-minutes` at the same step, and a timed-out job reports `cancelled`, which is what rolls
  up to the run. `e2e-cross-platform` is green on both platforms.

### SS-2 — what the `DEP-013` consumer actually reports

Measured by running the consumer itself
(`GITHUB_REPOSITORY=MeteoriteLabs/AoA node scripts/reconcile-workflow-verdicts.mjs --dry-run`,
17 watched streams, nothing published):

| stream | code | detail |
|---|---|---|
| `cross-platform-weekly.yml@main` | `not_success` | latest completed run concluded `cancelled` |
| `keyed-e2b-unit-d.yml@docs/replatform-program` | `unread_failure` | `74103f95d` concluded `failure` and no later commit matches the lane's `paths:` filter, so nothing re-triggers it |

**Criterion 2 is NOT the `check-finding-ownership` register.** That guard reports 48 unowned
findings and passes, and reading criterion 2 against it would make M0 unpassable for the wrong
reason. `DEP-013` shipped `scripts/lib/workflow-verdict.mjs`, `.github/workflows/verdict-reconcile.yml`
and `scripts/check-verdict-consumer-freshness.mjs` (`DEP-013-result.md` §1);
`check-finding-ownership.mjs` is not among them and is not its consumer.

### SS-3 — disposition A

Of the twenty A tickets, exactly one carries a defined task: `DAT-008-A1`
(`epics/E5-workspaces-secrets/implementation-plan.md:389`). `MIG-002`'s two stale
`listActiveAttempts` clauses are named at
`epics/E10-desktop-migration-realtime/implementation-plan.md:492` but carry no task heading. The
remaining eighteen have no task anywhere.

### SS-4 — `E7-F007`

`epics/E7-coding-e2b/findings.md:395-397`: status `open`, severity MEDIUM,
`Owner: MIG-010 (… no result doc)`. No successor exists.

### SS-5 — `MIG-010`

`epics/E10-desktop-migration-realtime/tickets/MIG-010-design.md` exists; there is no
`MIG-010*-result.md` anywhere in the tree.

The deadlock is real and was verified at source rather than taken from the plan:
`scripts/check-finding-ownership.mjs:50` extracts a ticket id with `/^([A-Z]+-\d+)/`, so **any**
file named `MIG-010*-result.md` marks `MIG-010` as shipped (`findCompletedTicketIds`, `:56-70`), and
`E7-F007` then reports `owner_ticket_already_complete` — "owned by nothing".

### SS-6 — disposition B

Seven results are owed. `DEP-013` discharges through criterion 2 and `MIG-010` through criterion 5;
with those two, the set is all eight B members.

| B ticket | result on disk | prose status (NOT canonical approval) | M0 task defined? |
|---|---|---|---|
| `TRACK-001` | yes | `LANDED` | yes — `TRACK-001-B1` (E5 plan) |
| `DAT-011` | yes | `LANDED` | yes — `DAT-011-B1` (E5 plan) |
| `MIG-009` | yes | `SHIPPED`, trigger `unwired` | **no** — E10 §8.1 is the `M1a` trigger build, not the M0 evidence-currency record |
| `MIG-010` | **none** | — | yes (E10 plan, blocked on D-10) |
| `TRACK-002` | yes | `LANDED` | **no** |
| `DEP-008` | yes | `complete` | **no** |
| `WRK-017` | yes | `BUILT` | **no** |

`qa-handoff-recovery.md` §2 forbids treating `LANDED` / `SHIPPED` / `BUILT` / `complete` prose as
canonical ticket approval, so every one of the seven needs a classification pass (`adoptable` /
`delta_required` / `historical_only` / `invalid_record`) and a candidate-current attempt regardless
of its prose header.

**M0 therefore has the same Step-0 shape `M1a` has: it must file tasks before it can build.** The
implementation plans merged as PR #524 cover E5, E7, E8, E9, E10 and E11; E4 and E6 — which own
`WRK-017`, `TRACK-002` and `DEP-008` — received none.

---

## 2. Founder rulings taken this session

1. **`keyed-e2b-unit-d`** — fix and dispatch. **Keyed-E2B spend is explicitly authorized** for this
   lane's verification run.
2. **`cross-platform-weekly`** — repair the lane inside M0 rather than quarantine it.
3. **`TRACK-002` / `DEP-008` / `WRK-017`** — M0 Step 0 files the missing tasks, then executes them.
4. **`CLI-008-LEDGER`** — in M0 **and execute it**: resolve the id scheme and re-point the ten
   findings. This overrides the reading that disposition M is outside M0's declared scope, and
   supplies the founder ruling the id-scheme question was waiting on.

---

## 3. `EVID-04` precondition — determination, not an amendment

`artifact-policy.md` and `qa-handoff-recovery.md` both carry a blocking precondition: `EVID-04`
(`test-gates.md:38`) states the QA-record path normatively as
`docs/replatform/epics/<epic>/qa/…`, so a record under `milestones/<milestone>/qa/` does not
conform, and amending policy/templates/guards does not amend a gate.

**M0 is not blocked by it, and M0 will not attempt to amend it.** Reasons, each checkable:

- M0's row in the milestone sequence names **no gate**: *"(no gate — entry criteria for M1a)"*.
- Exit criterion 8 is scoped by the **naming relation** ("`Result: pass` QA records for each partial
  gate that milestone names"), so a milestone naming no gate owes **zero** QA records.
- M0's own exit list requires no QA record and no handoff — only lane health, the consumer verdict,
  the A corrections, the `E7-F007` successor, `MIG-010`'s result, and the B results.
- Every artefact M0 produces is a `-result.md` under `epics/<epic>/tickets/`, which
  `artifact-policy.md`'s epic-folder contract already defines and `EVID-04` does not constrain.
  `EVIDENCE_RECORD_RE` in `scripts/check-evidence-immutability.mjs:97` deliberately excludes
  `tickets/`.

The precondition remains live and blocking for `M1a` and for the required `M2-RTF` campaign. It is a
gate-owner action. **M0 files no milestone QA record.**

---

## 4. Record corrections this plan already owes

Both were measured at source during the starting-state pass, and both are the
record-disagrees-with-code class M0 exists to close.

### RC-1 — the `keyed-e2b-unit-d` failure is misattributed in the reconciliation

`epic-regrooming/RECONCILIATION-2026-09-20.md` §3.4 says the lane *"failed 2026-09-10 and 2026-09-19
on two real assertions — the claude and codex argv shapes drifted when Unit C added MCP flags and the
keyed test was not updated."*

**The attribution is false.** Measured from both runs' logs:

- Run `34533429893` (`db0edd932`, 2026-09-10) and run `35438996937` (`74103f95d`, 2026-09-19) fail
  with **byte-identical** assertions.
- The observed argv diff is the **permission-posture** flags only:
  `+ "--dangerously-skip-permissions"` (claude) and `+ "--skip-git-repo-check"`,
  `+ "--dangerously-bypass-approvals-and-sandbox"` (codex).
- **No MCP flag appears in either diff.** Unit C's MCP segment is emitted only on the
  `stageAoaConfig` branch (`server/src/services/task-run-sandbox-invocation.ts:217-221`), which this
  test does not exercise.
- The drift therefore predates Unit C by nine days and belongs to E7-F021 / E7-F027 — the permission
  posture founder-authorized 2026-09-11 and shipped in `db0edd932`. Unit C's merge only **re-fired**
  the lane, because `task-run-sandbox-invocation.ts` is in its `paths:` filter.

The correction is recorded by finding, not by editing a committed record.

### RC-2 — `CLAUDE.md`'s CI platform table is false at the candidate

It states macOS `Verify` is *"Advisory (green)"* and Windows `Verify` is *"Advisory (4 tests skipped
— Issues #113/#127)"*. Measured: macOS `verify-cross-platform` **fails** and Windows
`verify-cross-platform` **times out**, and have done for six consecutive weeks. The row describing
Windows e2e as skipped is still correct.

---

## 5. Unit sequence

Units are ordered so each one's evidence exists before the unit that consumes it. Every unit is
planned, reviewed, executed, reviewed and shipped separately; this list is the sequence, not a
licence to batch them.

| Unit | Scope | Closes | Depends on |
|---|---|---|---|
| **U1** | repair `keyed-e2b-unit-d` + the MCP-branch case + RC-1 | criterion 1 (half), criterion 2 (half) | — |
| **U2** | repair `cross-platform-weekly` + RC-2 | criterion 1 (half), criterion 2 (half) | — |
| **U3** | M0 Step 0: file `TRACK-002-B1`, `DEP-008-B1`, `WRK-017-B1` and the `MIG-009` evidence-currency task | makes criterion 6 assignable | — |
| **U4** | the `CLI-008` ledger: numeric successor ids, filed + re-pointed, + the enumeration sweep | founder ruling 4 (**D1**) | — |
| **U5** | the `E7-F007` successor, **then** `MIG-010`'s result | criteria 4 then 5 | — |
| **U6** | the seven disposition-B currency results | criterion 6 | U3; `MIG-010`'s slice only, on U5 |
| **U7** | disposition-A record corrections, starting with `DAT-008-A1` | criterion 3 | — |
| **U8** | the non-promoting `M0` milestone handoff | gives `M1a`'s entry a pinned artifact (**D3**) | all of U1–U7 |

U1, U2, U3, U4 and U7 are mutually independent. U5's internal order is fixed by the plan of record:
filing the successor removes the ownership deadlock **so that** `MIG-010` can receive a result; it
neither creates nor approves one.

★ **U5 does NOT depend on U4** — *corrected at review (D1).* An earlier revision coupled them "because
they share the id scheme". They do not: `CLI-008`'s problem is specific to **link-scoped** ids
(`CLI-008-F1a`), while `E7-F007`'s successor needs only an ordinary numeric id, which the guards
already express. The coupling serialised two independent units for no mechanical reason. Likewise U6
depends on U5 only for `MIG-010`'s own slice; the other six currency results depend on U3 alone.

### U8 — the `M0` milestone handoff (**D3**)

M0's exit list requires no QA record and no handoff, yet the milestone table says `M1a` is **blocked
by M0** — so `M1a`'s entry check would have nothing to point at. `EVID-04` constrains only the **qa**
path, so a handoff under `milestones/M0/handoffs/` conforms **today**, with no gate amendment and no
contradiction of §3. U8 files one:
`milestones/M0/handoffs/<YYYY-MM-DD>-M0-<sha12>-a1.md`, carrying `Supersedes:`, `Attempt:`,
`Reviewed revision:` and `Decision:` (not `Result:` — the two are not interchangeable), explicitly
non-promoting, and not using `epic-completion` in its name.

### U4 — the id scheme, settled (**D1**)

The premise this unit inherited was mechanically false, and the correction is recorded here because
it changes what the unit does.

- Ownership is **declared in `scripts/finding-ownership.json`**, not parsed from register prose
  (`scripts/lib/finding-ownership.mjs:16-22` — "WHY IT IS DECLARATION-BASED"). Re-pointing is a
  manifest edit, not a findings.md rewrite.
- Exactly **ten** entries name `ticket: "CLI-008"`: `E7-F003`, `F015`, `F016`, `F017`, `F023`,
  `F024`, `F026`, `F027`, `F032`, `F033`. The plan of record's count is correct.
- **Nothing is orphaned at HEAD.** `CLI-008` has no `-result.md`, so it is not in
  `completedTicketIds` and all ten validate today. The hazard is prospective, not live.
- **Link-scoped ids are unrepresentable**: `finding-ownership.mjs:423` does an exact
  `tickets.has(entry.ticket)`, and `findTicketIds` (`:50`) derives ids with `/^([A-Z]+-\d+)/` over
  filenames — so `CLI-008-F1a` resolves to nothing.
- **A `CLI-008-LEDGER-result.md` would itself be the orphaning act**, extracting to `CLI-008` and
  flipping it complete.

**Scheme:** numeric ids in the existing `CLI-` namespace. `CLI-009` is the ledger ticket and carries
the only result file; `CLI-010`…`CLI-0NN` are the link-scoped successors, design-only. `CLI-008` is
never marked complete by a filename.

**Work:** derive the ten-findings → N-successors mapping from each finding's content (it is not
1:1 — the `M1b` set names seven link ids for ten findings); file a design file and a `#### ID`
program-graph node per successor (`check-ticket-graph-coverage` fails on a ticket file with no
node); re-point the manifest; and **sweep every site that enumerates the old ids** —
`scope-triage.md`'s `M1b` required-result set, the E7 plan, and `qa-handoff-recovery.md` step 7 —
carrying a mapping table. Correcting the prose and leaving the enumeration is this programme's most
repeated defect.

---

## 6. Unit 1 — repair the `keyed-e2b-unit-d` lane

### The defect

The lane's frozen argv expectations are stale; **production is correct and independently pinned.**
Refutation of the alternative reading (that the emitter is the defect):

- `server/src/services/task-run-sandbox-invocation.ts:209-211` and `:244-248` cite E7-F021 and
  E7-F027 as founder-authorized 2026-09-11, and scope both flags to the throwaway sandbox.
- `scripts/lib/__tests__/w7u1-agent-output-probe.test.mjs:103-104` pins the two claude tails
  **verbatim**, `:115` asserts the tail still contains `--dangerously-skip-permissions`, and that
  file runs in the required `policy` lane.
- A **third** independent pin: `E7-F021` (`epics/E7-coding-e2b/findings.md:1982`) records itself
  `resolved` by the founder-authorized posture PR and names
  `server/src/__tests__/task-run-batch-workload.test.ts` as guarding it RED-when-removed, via both
  an exact-script assertion and a dedicated `skips permission prompts for unattended execution`
  case.

So three observers assert the flags and one denies them. The one that denies them is this lane.

So realigning the keyed test with the already-pinned shape weakens no check; it makes a second
observer agree with the first. Were it the other way round, the fix would belong in the emitter and
the `policy` lane would already be red — it is not.

### The change

`packages/sandbox-e2b-provider/src/__tests__/keyed-cli-008-unit-d-invocation.test.ts`, two sites:

- `:171` (claude) — insert `"--dangerously-skip-permissions"` between `"-"` and `"--output-format"`.
- `:248` (codex) — `["exec", "--json", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox", "-"]`.

Each site gains a comment naming E7-F021 / E7-F027 and the 2026-09-11 authorization, so the flags
read as **asserted posture** rather than incidental drift, and a future removal reds this lane on
purpose.

**Plus a third case — the MCP branch (D4).** The lane exercises only `stageAoaConfig === false`.
Unit C's config branch (`task-run-sandbox-invocation.ts:217-221`) has **no keyed coverage at all**,
which is precisely how the reconciliation could attribute the drift to MCP flags with nothing to
contradict it. The new case passes `aoaMcpConfig` to `buildSandboxInvocation` alongside
`instructions`, and asserts the full config-branch argv:

```
["--print", "-", "--dangerously-skip-permissions",
 "--output-format", "stream-json", "--verbose",
 "--append-system-prompt-file", STAGED_INSTRUCTIONS_PATH,
 "--mcp-config", STAGED_AOA_MCP_CONFIG_PATH, "--strict-mcp-config",
 "--allowedTools", "mcp__aoa"]
```

plus the staged JSON readable at `STAGED_AOA_MCP_CONFIG_PATH` with the exact bytes, and the prompt
still intact on stdin. It runs in the same dispatched run — no extra dispatch, one extra sandbox.
`STAGED_AOA_MCP_CONFIG_PATH` joins the test's existing static import, so a rename reds the no-key
suite too.

### The two keyed runs (D2)

The spend is **two runs, not one**, and the plan states it rather than discovering it:

```
branch dispatch ──► proves the fix      (gh workflow run --ref <branch>)
                    does NOT clear the consumer finding
                            │
                            ▼
merge to docs/replatform-program
  the merge commit touches the test file, which is in the lane's `paths:`
                            │
                            ▼
push-triggered run ─► clears `unread_failure` on the WATCHED stream
```

The DEP-013 consumer watches `keyed-e2b-unit-d.yml@docs/replatform-program` in `coverage` mode, and
this branch is not in the workflow's push `branches:` list. So a branch dispatch can prove the argv
and cannot close criterion 2; only a push-triggered run on the watched branch does. Both runs are
covered by the founder's keyed-spend authorization, recorded in §2.

### RED and GREEN

There is no local RED: this worktree has no `node_modules` (deep-OneDrive `ENAMETOOLONG`) and the
case requires a live `E2B_API_KEY`. The RED is **already recorded, twice, and provably can fail** —
runs `34533429893` and `35438996937`, byte-identical assertions, on two different candidates nine
days apart. GREEN is a dispatched `keyed-e2b-unit-d` run on the fix branch reporting **6 passed, 0
failed, 0 skipped** — five pre-existing cases plus the MCP-branch case D4 added — with the lane's
own positive-control step ("Fail if the cases SKIPPED") reporting the key was present.

★ *Corrected after Codex review of PR #525: this read "5 passed", written before D4 added the sixth
case and not swept when it did. The plan is E7-F037's durable evidence, so a count contradicting
the linked run would read as a stale or partial lane result at a later gate audit. Observed:
run `35528929017`, `Test Files 1 passed (1)` / `Tests 6 passed (6)`.*

**OBSERVED (run `35528929017`, 2026-09-20):** `Tests 6 passed (6)`, `Test Files 1 passed (1)`, all
six cases named `✓` — claude shape, claude shape with the brokered MCP config, codex shape, the
exit-78 staging refusal, and both E7-F014 exit-code cases. The positive-control step ran with
`E2B_API_KEY` present and concluded `success`.

The positive control matters here more than usual: `describe.skip` without a key is a green vitest
run, so a keyless lane would report success while proving nothing. The GREEN claim is not made from
the run conclusion alone.

### Non-goals

- Touching the emitter, the `w7u1` guard, or the permission posture itself.
- Re-running any other keyed lane.
- Repairing `cross-platform-weekly` — that is U2.

★ *"Adding a case for the `stageAoaConfig` branch" was a non-goal until review (D4). It is now in
scope: the marginal cost is one case inside a run already being dispatched, and it closes the exact
blind spot that let RC-1's false attribution stand unchallenged.*

### What would prove this unit wrong

1. The `policy` lane going red on `w7u1-agent-output-probe.test.mjs` after the change — it would
   mean the two observers disagree and the emitter, not the test, is the defect.
2. The dispatched run failing on a **different** assertion — it would mean a second, unmeasured
   drift exists and the root cause was incomplete.
3. The dispatched run passing while the positive-control step reports the key absent — a vacuous
   green, treated as a failure.

### Evidence and commits

- `fix(cli-008): realign the Unit D keyed argv with the shipped permission posture` — the two stale
  expectations plus the MCP-branch case.
- `docs(replatform): the Unit D drift predates Unit C (RC-1)` — the finding recording RC-1 with the
  two run ids and the source citations.

Both guarded by the full aggregated guard set before push, per the programme rule that a push is
never chained to one check's exit code.

---

## 6b. Unit 2 — repair the `cross-platform-weekly` lane

Designed 2026-09-21 after measuring run `35493290194`. Two independent causes, one per platform.

### macOS — 4 real test failures, and one of them is a product finding

`verify-cross-platform (macos-latest)` fails at `Run tests`: `Test Files 2 failed | 2060 passed |
23 skipped (2085)`, `Tests 4 failed | 18703 passed | 107 skipped`. Duration 1049s — well inside its
cap. All four are the **`/var` → `/private/var` symlink** class:

| File | Case | Observed |
|---|---|---|
| `company-workspace-fs-routes.test.ts` | browse defaults to the jail root | `expected '/private/var/folders/…' to be '/var/folders/…'` |
| `workspace-runtime.test.ts` | removes a created git worktree and branch during cleanup | `expected [ Array(1) ] to deeply equal []` — the array is a refusal warning |
| `workspace-runtime.test.ts` | keeps an unmerged runtime-created branch and warns | got `Refusing to remove path "/private/var/…"` instead of the skip message |
| `workspace-runtime.test.ts` | records teardown and cleanup operations | `expected [ 'workspace_teardown' ] to deeply equal [ 'workspace_teardown', …(2) ]` |

**Mechanism, read at source rather than inferred.** Both files build their world from
`fs.mkdtemp(path.join(os.tmpdir(), …))`, which on macOS returns `/var/folders/…` — a symlink to
`/private/var/folders/…`. Git normalises that when it creates a worktree, so the workspace's own
`cwd` comes back real while the project root stays symlinked. `isApprovedRuntimeWorkspacePath`
(`server/src/services/runtime-workspace-path-policy.ts:14-27`) then compares them **lexically**, via
`path.relative`/`path.resolve` in `isStrictDescendant` (`:4-7`) — never `realpath` — so the real
candidate is not a descendant of the symlinked root, cleanup refuses, and `preserve = true`
(`workspace-runtime.ts:1531-1537`). The three `workspace-runtime` failures are all that one refusal.

**Fix — the established idiom, not a new one.** `fs.realpath` the `mkdtemp` result at the point of
creation, so the test's world is already resolved and matches what git will produce. This file
already knows the hazard: `workspace-runtime.test.ts:36` is a realpath-comparing `expectSamePath`
helper, and `git-service.test.ts:35`, `local-execution-target.test.ts:9`,
`scoped-cli-auth-home.test.ts:40` and `cursor-local-skill-injection.test.ts:45` use the same idiom.
On Linux and Windows `realpath` of a freshly created real directory is identity, so no lane but
macOS changes behaviour.

★★★ **AND THE PRODUCT INCONSISTENCY IS RECORDED, NOT PAPERED OVER.** The lexical comparison is not
only a test artefact: any deployment whose project root traverses a symlink (macOS `/var`, a
symlinked home, a bind-mounted checkout) gets the same refusal, and legitimate worktrees are
silently preserved with a warning. It **fails closed**, so it is a correctness/UX defect rather than
a safety hole — and `isApprovedRuntimeWorkspacePath` is the predicate that bounds recursive
deletion, so changing it is a security-sensitive change and explicitly **not** M0's (M0 introduces
no new product capability). U2 files it as a finding with an owner and leaves the predicate alone.

### Windows — the job never finishes

`verify-cross-platform (windows-latest)` is killed at `Run tests` by `timeout-minutes: 25`; a
timed-out job reports `cancelled`, which is what rolls the whole run to `cancelled` and is what the
DEP-013 consumer reads as `not_success`. macOS needs 1049s unsharded and Windows is consistently
slower, so the cap is not the defect — the unsharded shape is.

**Fix — mirror the required lane, because the repo already ruled on this.** `pr.yml:1023-1052`
shards `verify` four ways and its own comment states the rule: *"A PER-SHARD cap. Do NOT raise: a
shard that still can't finish under it is a signal to shard finer or to investigate a slow test,
never to raise the cap (GO-BOOK §2.0)."* So U2 shards `verify-cross-platform` on the same axis
rather than raising 25.

★ **The known trap is inherited too.** `pr.yml:1102-1114` records that `pnpm test:run -- --shard=…`
is **silently ignored** — pnpm 9.15.4 forwards the `--` literally, so every shard runs the whole
suite (proven on run 33012727670: 4 shards each ~52 min, no split). The command must be
`pnpm exec vitest run --shard=<i>/<n>`, and the denominator must equal the matrix length.

### RED and GREEN

RED is recorded and reproducible: six consecutive weekly runs `cancelled`, most recently
`35493290194`, with the four named assertions on macOS. GREEN is a dispatched
`cross-platform-weekly` run on the fix branch in which **every** `verify-cross-platform` job
concludes `success` and the run's own conclusion is no longer `cancelled`. The lane is
GitHub-hosted, so this verification costs no keyed spend.

★ **What this unit does NOT claim.** Windows has never finished, so its failure set beyond the
timeout is **unmeasured**. Sharding may surface real Windows failures that the timeout was hiding.
If it does, those are reported as findings and this unit does not declare the lane green on the
strength of the macOS half.

## 7. What already exists (review output)

Nothing in this plan builds new machinery. Every unit consumes something already shipped:

| Need | Existing mechanism | Reused or rebuilt |
|---|---|---|
| lane verdicts nobody reads | `DEP-013`: `reconcile-workflow-verdicts.mjs` + `workflow-verdict-manifest.json` + `check-verdict-consumer-freshness.mjs` | **reused** — the starting-state measurement is that consumer's own dry-run output, not a re-implementation |
| finding ownership | `scripts/finding-ownership.json` + `check-finding-ownership.mjs` (declaration-based) | **reused** — U4 edits declarations; it does not add a guard |
| record immutability | `check-evidence-immutability.mjs`, `EVIDENCE_RECORD_RE` | **reused** — U8 files under a path the guard already covers |
| the keyed invocation-shape observation | `keyed-e2b-unit-d.yml` + its test | **reused** — U1 repairs the expectations; the lane, probe and staging channel are untouched |
| the emitter's shape contract | `w7u1-agent-output-probe.test.mjs`, `task-run-batch-workload.test.ts` | **reused as the refutation** — they are why U1 corrects the test, not the emitter |

## 8. NOT in scope (review output)

| Deferred | Rationale |
|---|---|
| amending `EVID-04` | a gate-owner action; M0 owes no QA record, so it is not M0's blocker (§3). Still blocking for `M1a` and `M2-RTF`. |
| `MIG-009`'s trigger build (wiring `drainAll`) | explicitly `M1a`'s; M0 owns only its evidence-currency record |
| `M1a` Step 0's four `TO FILE` tickets | `M1a`'s work by the plan of record |
| `CLI-008-F5`'s ingest-transaction design | design-blocked on an owed decision; not M0's |
| `MIG-001` (M2), `BRW-003c` / `BRW-007` / `BRW-008` (M3) | `TO FILE` at later milestones |
| the stranded-answer sweep | unowned, and no milestone claims it |
| re-sharding the required Linux `verify` lane | U2 touches the advisory weekly lane only; the required lane is green |
| `E7-F021`'s stale `:183`/`:184` citations in the register | real citation drift (the literals are at `:220-225` at HEAD), but the citation guard carries them as best-effort. Candidate for U7, not U1. |

## 9. Failure modes (review output)

| Path | Realistic production failure | Test? | Error handling? | Silent? |
|---|---|---|---|---|
| keyed lane loses its secret | `describe.skip` makes a keyless run GREEN while proving nothing | yes — the lane's own "Fail if the cases SKIPPED" step | yes, `exit 1` | **no** — loud |
| emitter drops a permission flag | unattended runs hang on a prompt, no human to answer | yes — three independent pins, and U1 makes the keyed lane a fourth | n/a | no |
| MCP branch argv drifts | tool surface silently unarmed when Unit C is enabled | **no today** — closed by U1's new case (D4) | n/a | **was silent** |
| consumer finding never clears | a repaired lane still reads red; M0 cannot close | covered by D2's sequencing: only the push run on the watched branch clears it | n/a | no |

No critical gaps: every row is either already covered or closed by this plan.

## 10. Parallelization (review output)

| Lane | Units | Modules |
|---|---|---|
| **A** | U1 | `packages/sandbox-e2b-provider/`, `docs/replatform/epics/E7-*` |
| **B** | U2 | `.github/workflows/`, `CLAUDE.md` |
| **C** | U3 → U6 | `docs/replatform/epics/E4,E5,E6,E10` |
| **D** | U4 | `docs/replatform/epics/E7-*`, `scripts/finding-ownership.json`, `program-design.md` |
| **E** | U5 | `docs/replatform/epics/E7,E10` |
| **F** | U7 | `docs/replatform/epics/E5,E10` |
| — | U8 | `docs/replatform/milestones/M0/` — waits for all |

Launch A, B, C, D, E, F in parallel; U8 last. **Conflict flags:** lanes A, D and E all touch
`epics/E7-coding-e2b/findings.md`, and C and F both touch `epics/E5` / `epics/E10` — register files
are append-heavy and conflict readily, so those lanes serialise their register edits even when their
code edits do not. Merges serialise regardless; only the work parallelises.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | clean | 4 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | not applicable (no UI scope) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

**Findings, all resolved by founder decision:**

- **D1** (confidence 10/10) `scripts/lib/finding-ownership.mjs:423`, `:50` — U4's premise was
  mechanically false; link-scoped ids are unrepresentable and nothing is orphaned at HEAD.
  → numeric successors, filed and re-pointed, with the enumeration sweep.
- **D2** (confidence 9/10) `.github/workflows/keyed-e2b-unit-d.yml` push `branches:`/`paths:` — the
  keyed spend is two runs and only the merge-triggered one clears the consumer.
  → both runs, dispatch then merge.
- **D3** (confidence 8/10) `scope-triage.md` milestone table — M0 produces no record of its own
  completion while `M1a` is blocked by it. → file a non-promoting M0 handoff (U8).
- **D4** (confidence 9/10) `server/src/services/task-run-sandbox-invocation.ts:217-221` — the MCP
  branch has no keyed coverage. → add the case in U1.

**VERDICT:** ENG CLEARED — ready to implement.

NO UNRESOLVED DECISIONS
