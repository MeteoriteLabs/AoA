# Reconciliation addendum — measured at `4df71dada`, 2026-09-20

> **This addendum does not change the proposal's status.** It brings the proposal forward
> four merges, records what an independent reconciliation pass verified and what it found
> that the proposal did not contain, and writes down the founder decisions of 2026-09-20
> that authorized adopting the proposal as the grooming base. The
> [proposal index](README.md)'s "proposal only" caveat still governs everything else.

Every number below was produced by running a command or reading source at `4df71dada`, not
inherited from a document.

---

## 1. Verified state at HEAD

**The tip is CI-green, and this is provable rather than asserted.** `4df71dada`'s tree hash
`33f27ceaa0892840a919df7e8f8b93961e5359f1` is byte-identical to PR #514's head
`63f8f2850`, which passed `ci-required`. The program branch never runs CI on its own merge
commits, so tree identity with the last verified PR head is what makes the claim checkable.

All ten register guards pass locally at the tip:

| Guard | Result |
|---|---|
| `check-finding-ownership` | OK — **72 open findings** across 12 registers |
| `check-gate-clause-wiring` | OK — **22 wired, 12 declared dormant** |
| `check-ticket-graph-coverage` | OK — 114 ticket ids on disk, 123 graph nodes, **9 never started** |
| `check-dependency-graph` | OK — 121 tickets, 0 cycles, **3 declared open gaps** (CM-008/009/012) |
| `check-register-citation-integrity` | PASS — 397 enforced citations |
| `check-register-id-uniqueness` | OK — 190 findings, 125 decisions |
| `check-threat-control-audit-debt` | PASS — 0 of 30 Critical/High crossings unaudited |
| `check-distributed-execution-foundation` / `check-guard-inventory` / `check-execution-census` | PASS (51 guards, 2828 test files) |

Finding ownership splits **48 unowned / 16 owned / 8 accepted**. Of the 22 open HIGH
findings, **20 are unowned**. Ten of the sixteen owned findings point at one ticket,
`CLI-008`.

**The 12 dormant gate clauses are the honest capability picture**, and they cluster into
five blockers rather than twelve:

| Cluster | Clauses | Blocker |
|---|---|---|
| Return path | `E5-result-commit-worker`, `E5-2-fenced-object-commit-worker-half`, `E5-3-patch-quarantine` | nothing composes the worker-side result/artifact path |
| Parity bridges | `E3-5-product-approval`, `E3-15-budget`, `E3-17-output`, `E3-audit-parity-bridge` | zero callers **and** no producer — the worker composes its supervisor with `observeRun` undefined (`dispatch-runtime.ts`, pinned by its own test) |
| Egress | `E5-6-denied-egress` | `createFenceAwareEgressProxy` imported only by its integration test |
| Restart | `E4-3-survives-restart` | E4-F009 — no durable lease-candidate source |
| Shipped boot / breadth | `E7-1-coding-journey`, `E8-1-sandbox-local-browser`, `E10-1-drain` | adapter-manager image is built only by the manual campaign deploy; `packages/browser-runtime` has zero importers; the drain needs a real `drainAll` trigger (REL-005) |

**E1, E2 and E6 have zero gate clauses enrolled at all** — the wiring register reports
dormancy only for clauses that exist, and reports nothing for an epic that enrolled none.

---

## 2. What this pass confirms in the proposal

Checked against source, the proposal's load-bearing claims hold:

- The four-claim separation (*a ticket shipped* / *a mechanism was exercised* / *a useful
  capability was proven* / *an epic passed its gate*) is the distinction the rest of the
  corpus collapses, and it is the right spine for the regrooming.
- E7's sheet is correct that CLI-008 Unit C slices 1–4 are live-but-inert behind
  `AOA_DISTRIBUTED_TOOL_SURFACE_ENABLED`, which defaults off and is enabled in no CI
  workflow. Verified in `server/src/config/distributed-execution.ts` and across seven
  production server files.
- `M1-D1-SPINE` cannot substitute for full D1: `test-gates.md` D1-00 requires at least two
  workers, and H-06 stays normative. The proposal says so itself.
- The index/epic-README status split is real and is worse than the index's own disclaimer
  admits — see §4.

---

## 3. What this pass adds

Five items the proposal does not contain. Each was measured, not argued.

### 3.1 The D1 gate lane was RED and nobody could see it — `E6-F021`

`d1-merge-train.yml@docs/replatform-program`, the lane that **constitutes the
`E6-D1-FOUNDATION` gate**, concluded `failure` on 2026-09-15 and 2026-09-17, both in *Bring
up the D1 stack*, both on `pull access denied for minio/minio`. MinIO's Docker Hub
repository is gone (anonymous pull token → **401**; Hub API → `object not found`), and
`docker-compose.d1.yml` defaulted to `minio/minio:latest` with no workflow override.

The half that matters: DEP-013's consumer was alive and publishing, and **did not report
it**. `evaluateCoverageStream` evaluates the run covering the newest `paths:`-matching
commit within `COVERAGE_WINDOW = 40` heads; the newest `docker/**` commit was 105 commits
back, so the evaluator returned `null`. **The lane went red, stopped being triggered, and
disappeared from the guard written to stop exactly that** — [[E6-F010]] and GO-BOOK §1.9.8's
class, reproduced one layer inside its own detector.

Both halves repaired; see `E6-deployment-test-harness/findings.md` → `E6-F021`.

### 3.2 CLI-008 Unit F link 1 was half-built on an abandoned branch

`claude/unit-f-link1-e2b-capture` (2026-09-18, no PR) carried a TDD-green
`captureSandboxEntries`. Unit F being unbuilt is the recorded blocker for `capabilityProven`
and for the four E3 parity bridges, so this was the most consequential orphan.

★ **Link 1 has two halves.** The **capture** half is built and inert by construction; the
**emit** half — telling the agent to write to a designated root — is untouched, and is
exactly what the three refutations in `CLI-008-unit-f-design.md` §4 are about. Recorded as
a §1.6 amendment in that file. It flips no counter and closes no finding.

### 3.3 Unit F is not one undesigned thing — it is six links, of which one is undesigned

`CLI-008-unit-f-design.md` §1.6 enumerates six missing links. Measured at HEAD: link 2 is
**built**; link 1's capture half is **built** (§3.2); links **3, 4 and 5 are ordinary
engineering** — the export sequencer already exists in
`packages/worker-daemon/src/lease/artifact-export.ts` and is merely uncomposed,
`EventSequencer` needs an `artifactPrepared`, and `foldAttemptEvidence` hard-codes
`detectedFiles: []`. Link 6 was settled by the 2026-09-20 §13 ratification.

**Only link 1's emit half survived the three refutations.** Splitting Unit F into
link-scoped tickets converts the program's stated hard blocker into four small tickets plus
one real question. This is a scoping proposal, not a claim that the work is done.

### 3.4 `keyed-e2b-unit-d` is red, and the "no E2B key" premise is false

`E2B_API_KEY` **is** a repo secret (since 2026-08-26) and six of seven keyed lanes are
green. `keyed-e2b-unit-d` failed 2026-09-10 and 2026-09-19 on two real assertions — the
claude and codex argv shapes drifted when Unit C added MCP flags and the keyed test was not
updated. It is the one finding the DEP-013 consumer **is** reporting, and it is unclaimed.

### 3.5 A latent migration collision, recorded and deliberately not acted on

`codex/universe-interface` (75 commits, 638 files, ~181k insertions, no PR, branched
2026-09-13) independently allocated migrations **`0281` and `0282`** off the shared `0280`
base, colliding head-on with the program's own `0281_provider_credential_broker` and
`0282_internal_agent_runs_distributed_marker`. The founder ruled on 2026-09-20 to **ignore
that branch entirely**; it is recorded here once so the collision is not rediscovered as a
surprise, and no work is planned against it. The renumber cost grows with every program
migration.

---

## 4. Record-integrity deltas beyond the proposal's scope

- **Every epic from E7 onward self-declares `backlog`** while carrying 6–13 committed
  `*-result.md` files each. E3/E4/E6 epic READMEs say `complete` while the index says
  `in_progress`.
- **`epics/README.md`'s ticket ranges are wrong** and its own disclaimer covers only the
  status *cells*: E3 −1, E4 −10, E5 −5, E6 −4, E7 −2, E9 −2. Its "Current tip" is pinned to
  `85599b192` — **1,015 commits behind**.
- **`MIG-006` shipped across six PRs with no ticket file of any kind.** Its design sits in
  unmerged PR #475; a post-build amendment there declares it a lifecycle epic (U1 schema /
  U2 marker / U3 projection / U4 loopback-defer / U5 seam) and records that slice 1's
  `buildCrewBatchWorkload` was the wrong tool and was removed.
- **`epics/E10-desktop/` is a bare `tickets/` directory** — the only one of 13 epic folders
  with neither README nor `findings.md`, in no index, and its own tickets point evidence at
  a `qa/` directory that was never created.
- **7 of 13 epics have no `implementation-plan.md`** — hierarchy level 5, the "epic
  implementation contract": E5, E7, E8, E9, both E10 folders, E11.
- **Two competing "current" handoffs** were written nine hours apart on 2026-09-18 and
  neither references the other; the earlier one claims to be *"the current forward-work
  authority"* and carries no superseded banner. They prescribe different next waves.
- **`test-gates.md` contains zero mentions of `E7-1`** while GO-BOOK mentions it 76 times.
- **24% of the corpus (102 of 428 files) carries a self-invalidation marker**, 343
  occurrences. Five top-level docs assert things that are false at HEAD with **no banner** —
  worst is `WAVE-4-BLOCKER-worker-session-lifetime.md:5-6`, whose three clauses about
  `E4-F007` (open / HIGH / unowned) are each false, its ownership key having been deleted.
- **The "blocked on a founder ruling" narrative is largely a classification artifact.**
  Exactly one decision in the corpus explicitly says it awaits the founder
  (`E11-hardening-release/decisions.md` E11-D01). Four decision papers keep an
  `AWAITING FOUNDER RULING` heading or an unsigned signature block directly above a banner
  saying `RULED + ENACTED`. Far less is founder-blocked than the handoffs claim.

---

## 5. Founder decisions, 2026-09-20

Taken after review of the reconciliation. These authorize grooming work; they do not flip
any epic status, which remains the Integration Gate Owner's action.

| # | Decision |
|---|---|
| D-1 | **Adopt this proposal as the grooming base** and rebase it onto HEAD. Superseding it with a fresh proposal was rejected. |
| D-2 | **`codex/universe-interface`: ignore entirely.** No merge, no renumber, no plan. Recorded in §3.5 and nowhere else. |
| D-3 | **Recover `claude/unit-f-link1-e2b-capture`** as a PR. |
| D-4 | **Repair the D1 lane and the verdict-consumer blind spot** (`E6-F021`). |
| D-5 | **Ratify current integration practice.** `program-design.md` still declares the single-PR model (#323) as LOCKED while 178 feature PRs have landed into the branch and CI runs on their heads. Current practice is ratified; the written model is to be corrected rather than restored. |
| D-6 | **The machine-checked registers become authoritative for status.** GO-BOOK is demoted to historical narrative; one short generated `STATE.md` replaces it as the status entry point. |
| D-7 | **PR dispositions:** keep #323 (resolve its single conflict); rebase-and-merge #475; cherry-pick the heading corrections from #510 then close it; lift #417's process sections into `agent-execution-guide.md` then close it. |

### Still open — the proposal's own six review questions

D-1 adopts this proposal as the base. It does **not** answer the six questions in
[README](README.md#review-questions): the milestone's narrowness, the 50-ticket
dispositions, the recovery procedure, whether the named partial gates unlock the internal
alpha dependency set, whether each epic's candidate gate becomes an implementation-plan
amendment, and whether any deferred surface is accidentally implied to be deleted. Those
remain open and are the next thing to settle.

---

## 6. In flight

| PR | What |
|---|---|
| #515 | `E6-F021` — D1 lane recovery (quay.io pin) + the `unread_failure` arm that makes a stranded red reportable |
| #516 | CLI-008 Unit F link 1 capture half, recovered from the orphan branch, plus the §1.6 amendment |

Neither flips a gate clause or closes a finding that carries a keyed-real-E2B conjunct.

---

## 7. Proposed execution order

The existing E0–E11 epics are cut by **subsystem**, but every remaining dependency chain
runs **across** them — which is why work moved between epics rather than completing one at a
time. Measured: all 13 epic groups took commits in August alone; a mean of 7.3 of 13 groups
were touched per week; 11 of 13 went dormant ≥4 days and were reopened, 28 times in total.
Only E1 and E2 were ever single-pass.

Keeping E0–E11 as archival labels on shipped work, the remaining work sequences by
**capability seam**:

| # | Epic | Exit criterion |
|---|---|---|
| **R1** | Record truth | every epic README's status is derivable from a guard |
| **R2** | Lane health | `d1-merge-train` green; the consumer reports both red lanes |
| **R3** | The return path (Unit F links 1-emit/3/4/5) | an artifact produced in a sandbox lands in `task_outputs` and the founder sees it on the task |
| **R4** | Sink cutover (MIG-005 Commander / MIG-006 crew / MIG-007 extraction + `E10-1-drain`) | the distributed path owns each write; the legacy path is provably unreached |
| **R5** | Shipped boot (AM/worker/CP images in CI + DEP-011 daemon consumer) | `E7-1-coding-journey` flips `wired` on a CI boot, not a manual staging run |
| **R6** | **M1 internal alpha** — this proposal's milestone, `M1-D1-SPINE` + `M1-D2-CODING` | one org, one CP, one worker, real E2B, useful output |
| **R7** | Workload breadth (E8, E9 remainder) | D3 / D4 |
| **R8** | Release (REL-001/002/005, DBR-001, D5/D6) | private beta |

R1 and R2 are cheap and unblock honest measurement of everything after them. R3 is the only
genuinely hard item.

> ★★★ **CORRECTED 2026-09-20 — R4 bundled two different things, and the bundle was wrong.**
> As first written, R4 read *"4 parity bridges + `E10-1-drain` + MIG-005/007"* and sat before R6,
> which implied the Commander and extraction cutovers were first-milestone prerequisites. **They are
> not** — the milestone journey is `task_run`-only, and `scope-triage.md` correctly retains those
> cutovers for later. The **parity bridges** are the milestone's (journey item 7, disposition A), and
> three of them are `M1a` blockers under founder decision **D-8** because `E3-F037` makes a
> handed-off run's spend invisible to budget policy. The row above now carries only the cutovers.
>
> ★ **R1–R8 is superseded as a sequence by `scope-triage.md`'s M0–M5**, which is the plan of record.
> It is kept here as the reasoning that produced it: the observation that the dependency chains run
> *across* E0–E11, which is why execution order never matched epic order.
