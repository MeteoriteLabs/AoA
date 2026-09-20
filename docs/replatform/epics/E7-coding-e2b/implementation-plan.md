# E7 — Coding/CLI on E2B — Implementation Plan

> ★★★ **CORRECTED 2026-09-20 after review — TWO OF THE LINK CLAIMS WERE WRONG, AND ONE OF THEM
> WAS MINE ABOUT WORK I HAD ALREADY MERGED.** Both were found by adversarial review of this plan
> and both are verified at source. They do not change what Unit F must achieve; they change the
> route, and they move link 5 out of "ordinary engineering".
>
> **(1) `captureSandboxEntries` is the WRONG TOOL for the E2B lane — it pulls bytes through the
> daemon.** `capture-sandbox.ts` does `readFile(absolute)` and then `sha256(bytes)`, so every
> captured file's bytes transit the worker daemon. That contradicts the sequencer's own stated
> contract at `artifact-export.ts`: *"**GRANTS OUT, NEVER BYTES** … the bytes go sandbox →
> provider → object storage and **never touch the daemon**, which is dependency-pinned (E4-D01)
> precisely so it does not handle them."* The provider-side route that honours it already exists
> and is real — `E2bSandboxProvider.digestArtifact` returns `{sha256, sizeBytes}` (**metadata
> only**) and `exportArtifact` re-hashes and PUTs, with `artifactExportMode = "grant_upload"`.
>
> ★ **So the capture half of link 1 is NOT solved for the lane that matters.** It is a
> **local/desktop-lane** tool — the sandbox analogue of DAT-001's local-FS walk, correct where the
> daemon legitimately holds the filesystem — and it is **inert** (zero callers, not re-exported),
> so nothing in production is affected. But it must not be composed on the E2B or networked lane,
> and an earlier record of mine describing it as "link 1's capture half" without that qualifier
> was wrong.
>
> ★ **No guard catches this.** `check-worker-daemon-boundary` passes, because it enforces a
> *dependency* boundary; the *data-plane* rule is prose in a docstring. A guard for it is worth
> considering and is not in this plan's scope.
>
> **(2) Link 5 is NOT ordinary engineering — it needs a designed projection contract.** The frozen
> `artifactPreparedPayloadV1Schema` is `{artifactId, kind}`, `.strict()` — **no path** — and the
> projector says so itself: *"`artifact_prepared` carries an artifactId and a kind, never a path …
> so there is no honest file list to build."* Worse, that `artifactId` identifies a
> **`job_artifacts`** row while `task_outputs.artifactId` references the separate **`artifacts`**
> table. So F5 owes a **lookup and materialization contract** (`job_artifacts` → path, and
> `job_artifacts` → `artifacts`) before any projector work, and the frozen v1 wire constrains how.
>
> **What survives unchanged:** link 2 is built; the export **sequencer** (`createArtifactExportSequencer`)
> is built and correct — it already implements the metadata-first route; link 4 remains ordinary.
> **What changes:** F3's route (metadata-only enumeration + provider digest/export, never
> `captureSandboxEntries`), and F5's classification (**designed contract first**, not ordinary work).

**Plan status:** `draft` — not approvable until (a) the operator approves the read-back, (b) the
`scope-triage.md` dispositions this plan executes are reflected in an owner-approved amendment, and
(c) the shared decisions below (E7-D01…E7-D07) are ratified. This plan covers **only** the E7 work
the first milestone requires: `CLI-008` (disposition **M**, link-scoped) and the arming of the
`E7-1-coding-journey` gate clause. `CLI-001` through `CLI-006` are shipped and out of scope;
`CLI-007` is disposition **N** — *frozen, independently reviewed, live-enforced, no gate clause, no
open finding* — and **owes nothing**, so filing a correction against it would manufacture work.

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` to
> execute this plan ticket by ticket **only after operator approval**. Every ticket uses a fresh
> implementer subagent (strict RED → GREEN) and a DISTINCT independent reviewer subagent. **One
> ticket below — `CLI-008-F1b` — is a DESIGN ticket and may not be assigned as build work under any
> circumstance.** Three mechanisms have been proposed for it and all three were refuted.

**The single most valuable thing this plan does:** it **splits `CLI-008` Unit F into link-scoped
tickets.** Unit F was chartered as one question — *"what supplies the output"* — and has been
`UNSIZED` since 2026-09-04 because one of its six links has no design. The other five are not
blocked by that, and four of them are ordinary engineering. Carrying them inside one UNSIZED ticket
is why nothing in the return path has moved, and why the triage could not put a date on `M1b`.

**Goal:** make the return path buildable link by link, so that `M1b`'s exit criterion 4 — *"the
sandboxed adapter can use the approved tools/workspace and return attributable reviewable output; a
mechanism-only run with `capabilityProven=false` cannot satisfy this criterion"* — has a schedule
rather than a blocker, while stating without softening which single link still has none.

---

## 0. Planning record, freeze, dependency gates, and shared decisions

| Item | Recorded value |
|---|---|
| Planning revision | `e710d8b54027eb7338733e05f422c71cd5127345` — branch `claude/plan-spine-m1-split`. Every `file:line`, caller count and symbol below was measured at this tip. Several published line pins have drifted since they were written; §1 names the ones I found. |
| Plan of record | [`../../epic-regrooming/scope-triage.md`](../../epic-regrooming/scope-triage.md) as amended 2026-09-20, including the `M1a`/`M1b` split and the nine-criterion allocation. |
| Epic status | `backlog` (`README.md:3`). The exit gate is a staging/internal canary Organization completing the full coding journey plus a real-E2B D2 lane. **Neither `M1-D1-SPINE` nor `M1-D2-CODING` completes E7.** |
| `CLI-008` disposition | **M** — *"No result doc; **ten** open findings name it as `ticket`. The largest unbuilt block in the original A."* Verified at this tip: `scripts/finding-ownership.json` names `CLI-008` as `ticket` for exactly ten findings — `E7-F003`, `F015`, `F016`, `F017`, `F023`, `F024`, `F026`, `F027`, `F032`, `F033`. |
| Unit A | ✅ **DONE** 2026-09-02 (PR #339, `0e0904206`). Changed the **judge**, not the capability. |
| Unit B | ✅ **DONE** 2026-09-03 (PR #340, `393f7a251`). The inbound channel. `E7-1-staged-input-write` and `E7-1-staged-input-grant` are both `wired`. |
| Unit C | ✅ **RULED + ENACTED 2026-09-19.** Founder ruled mechanism A transport + mechanism C plumbing, land now **inert-until-authorized**. Slices 1–4 merged (`3a034f40d`..`1523a8353`) behind `AOA_DISTRIBUTED_TOOL_SURFACE_ENABLED` (`server/src/config/distributed-execution.ts:29`); the claude argv emits `--mcp-config "$N" --strict-mcp-config --allowedTools mcp__aoa` at `server/src/services/task-run-sandbox-invocation.ts:218`. **`E7-F003`'s tools row legitimately stays open** — the flag is off and `capabilityProven` is false. |
| Unit D | ✅ **DONE** 2026-09-03. Prompt on stdin from a staged file; instructions bundle on `--append-system-prompt-file`. Closes `E7-F008`, `E7-F009`. |
| Unit E | **Unbuilt, XL, and NOT first-milestone.** See E7-D05. |
| Unit F | **Six links.** Link 2 BUILT; link 1's **capture** half BUILT and inert; links 3/4/5 unbuilt and ordinary; link 1's **emit** half **undesigned after three refutations**; link 6 (the judge) blocked behind it. [`tickets/CLI-008-unit-f-design.md`](./tickets/CLI-008-unit-f-design.md) §1.6. |
| `E7-F014` | **RESOLVED** 2026-09-04 (PR #351). The unit-F design's §5 "blocking dependency — being fixed on a parallel branch" is **discharged**; a non-zero exit no longer throws past every post-execute capture. That staleness is `CLI-008-LEDGER`'s to correct. |
| `E7-F021` | **RESOLVED** 2026-09-11, founder-authorized. `--dangerously-skip-permissions` is on both claude literals in `task-run-sandbox-invocation.ts`, guarded RED-when-removed by `server/src/__tests__/task-run-batch-workload.test.ts`. So the unit-F stop condition's **clause 1 is discharged for `claude_local`**. |
| `E7-F027` | **OPEN, narrowed.** codex is refused by its own trusted-directory gate before any model call. **Stop-condition clause 2 still stands: any near-term mechanism must be `claude_local`-only, not adapter-agnostic.** |
| Formal test authority | Linux CI under DEC-03. Windows short-path evidence is `operator-directed windows-local`. Windows e2e is skipped at the Playwright config level (Issue #114). |
| Keyed E2B | **Do not dispatch a keyed E2B workflow without explicit founder authorization — it spends money.** Every keyed row below is a request, not an entitlement. |

`decisions.md` **does not exist** for this epic and is created by the first executed ticket.
Findings live in [`findings.md`](./findings.md); IDs are `E7-F0xx`, decisions `E7-D0x`.

### ★ The structural hazard this plan must not walk into

`scripts/check-finding-ownership.mjs`'s `findCompletedTicketIds` counts a ticket **complete when its
`-result.md` exists** — that is how `E5-F001` discovered `DSK-002` had shipped while still holding a
residual. `CLI-008` currently owns ten open findings and has **no result doc**, which is the only
reason those ten still have a live owner.

**So creating `tickets/CLI-008-result.md` before the link-scoped successors exist would orphan ten
findings in one commit.** This is the same deadlock the triage recorded for `MIG-010` (D-10: file
the successor first). **The split IS the remedy**: each link-scoped ticket takes the findings that
belong to it, and only then can `CLI-008` carry a result honestly. `CLI-008-LEDGER` sequences that
and is explicitly forbidden from creating the parent result doc.

### Shared decisions and locked contracts (E7-D01…E7-D07)

- **E7-D01 — `capabilityProven` can assert PROVENANCE and never PRODUCTIVITY.** It is computed from
  two SQL counts over control-plane rows (`E7ProducedOutputCounts`,
  `server/src/services/e7-distributed-run-verifier.ts:130-133`). A count over rows can assert *these
  bytes reached durable AoA storage through an attested path*; it can never assert *these bytes are
  the work the task asked for*, because the verifier reads tables and never an artifact's bytes. The
  two arms fail on **different axes** and collapsing them into one word ("non-probative") is what let
  round 1 argue both sides of a single principle. No ticket here may restate the bar as productivity.
- **E7-D02 — The three refutations are binding, and a fourth mechanism proposed without surviving
  §6 will be refuted for the same reason.** Round 1 fell on argv **shape**; round 2 on argv **size**;
  round 3 on **the predicate itself** — its repair (drop the forgeable `task_outputs` arm and widen
  the artifact arm off `kind = 'workspace_patch'`) is satisfied on **every** converted distributed
  run by the run's **own staged input bundle**. The core move is itself the defect.
- **E7-D03 — Links 3, 4 and 5 are NOT blocked by the emit question, and links 4 and 5 flip NO
  counter.** `countProducedOutputs` queries `job_artifacts` directly and joins no events, so **a
  committed artifact counts whether or not anything announced it** (`E7-F016`'s substance). Link 4
  (the `artifact_prepared` emitter) and link 5 (the projector) are what make a committed artifact
  **visible to the founder on the task** — which is exit criterion 4's actual sentence — while the
  **counter** moves on link 3 alone. Confusing the two is the error this plan is written to avoid.
- **E7-D04 — `claude_local` only, for anything Unit-F-shaped, until `E7-F027` is characterised.**
  Clause 1 of the stop condition is discharged; clause 2 is not. A mechanism that looks
  adapter-agnostic while codex is refused before any model call is a fix that leaves codex broken and
  looks like a fix.
- **E7-D05 — Unit E is NOT in `M1b`.** The capture half is deliberately narrow to the Unit-F shape-(a)
  convention: *capture a designated OUTPUT PATH the agent was told to write to, against an EMPTY base
  downstream (→ all `create` ops). No git base, no ignore policy, no Unit-E workspace*
  (`packages/worker-daemon/src/snapshot/capture-sandbox.ts` header). The `workspace_patch` route —
  which is what `E5-3-patch-quarantine` and `E5-result-commit-worker` need — remains XL and
  Unit-E-blocked, and is post-`M1b`.
- **E7-D06 — Grants inbound, references outbound, never bytes.**
  `DECISION-byte-egress-and-provider-topology.md` Option D: the provider reads the file from inside
  its sandbox and PUTs it directly to object storage under a worker-minted grant. Nothing here
  re-opens that; it constrains every candidate mechanism equally. **An S3-compatible store is a hard
  precondition** — `checksumSha256` is supplied only by `storage/s3-provider.ts:212`, the local-disk
  provider supplies none, and `artifact-commit.ts` fails closed when the store cannot supply a
  checksum. Staging sets `AOA_STORAGE_PROVIDER: "s3"`.
- **E7-D07 — No frozen-protocol edit.** `artifact_prepared` is already in the frozen event kinds
  (`packages/worker-protocol/src/events.ts:358`), already has a frozen payload schema (`:387`), and
  is already in the `job_events` CHECK constraint (`packages/db/src/schema/job_events.ts:75`).
  `EventSequencer` is daemon code **outside** the `worker-protocol-contract-bytes` freeze. So link 4
  needs no custodian STOP — which is worth stating, because it is the one link a planner would assume
  was blocked.

### NOT in scope (epic non-goals for the first milestone)

- No Unit E, no `WorkspaceManifestV1` producer, no `--add-dir`, no repository to work in (E7-D05).
- No fourth supply mechanism written under time pressure (E7-D02). `CLI-008-F1b` is a design pass
  whose permitted outcomes include *"do not build it"* — §13 of the unit-F design records that option
  as **recovered but never adversarially attacked**, so adopting it also requires an attack pass.
- No adapter-agnostic mechanism; no codex work beyond characterisation (E7-D04).
- No re-opening of the DE-08 sandbox-egress ruling (CONCEDED at the managed-shared tier, 2026-09-11)
  and no claim that H-06 passes.
- No `packages/db` schema change and no `drizzle-kit generate`.
- No re-opening of `CLI-001`…`CLI-006` or `CLI-007` (disposition N).
- No sink cutover. `E3-17-output` / `jobOutputBridge` is **M2**, not M1, and link 5 must not become a
  second writer of `task_outputs` ahead of it (see `CLI-008-F5`).

---

## 1. Consumed as-built interfaces / what already exists and is reused

### Unit F's six links, at this tip

| # | Link | State, measured | Owner below |
|---|---|---|---|
| 1a | **capture** — walk a designated in-sandbox output root | ⚠️ **BUILT, INERT, AND WRONG-LANE.** Metadata-only *enumeration* is what link 3 needs; the built helper also reads and hashes bytes **in the daemon**, which the sequencer contract forbids — so the capture half is **not** solved for the E2B lane. `captureSandboxEntries` (`packages/worker-daemon/src/snapshot/capture-sandbox.ts:67`) over an INJECTED `listDir`/`readFile` seam, fail-closed on any path outside the root or failing `isSafeWorkspacePath`, deterministic, plain `CapturedFileEntry[]`. **Nothing re-exports it from `snapshot/index.ts` and nothing calls it** — verified: every reference at this tip is its own definition or `src/__tests__/capture-sandbox.test.ts`. | `CLI-008-F1a` |
| 1b | **emit** — tell the agent to write there | ★★★ **UNDESIGNED.** The half the three refutations are about. Nothing yet tells the agent to write to that root, so `captureSandboxEntries` has nothing to walk on a real run. **This flips no counter and closes no finding.** | `CLI-008-F1b` (DESIGN ONLY) |
| 2 | **a real `exportArtifact`/`digestArtifact`** | ✅ **BUILT** 2026-09-04 (PR #353). `packages/sandbox-e2b-provider/src/e2b-provider.ts:246` declares `artifactExportMode = "grant_upload"`; `exportArtifact` reads → size-checks → **re-hashes against the grant** → PUTs → returns `{objectKey}`. Proven on a **real E2B sandbox** (`keyed-e2b-dat-009-export.yml`, 4/4, run `33856478690`), including the TOCTOU refusal. | — (closed) |
| 3 | **worker-side consumer** — sequence digest → mint grant → export → commit | **UNBUILT.** `createArtifactExportSequencer` (`packages/worker-daemon/src/lease/artifact-export.ts:264`) exists with zero production callers; its only other reference is the barrel at `packages/worker-daemon/src/index.ts:178`. The hook and composition are **E5's** `DAT-009-3c`/`3d`; the **producer of `ArtifactExportRequest[]`** is this epic's. | `CLI-008-F3` |
| 4 | **announcement** | **UNBUILT, and NOT blocked.** `EventSequencer` (`packages/worker-daemon/src/supervisor/events.ts`) has no `artifactPrepared` method. The event kind, payload schema and DB CHECK are all already frozen-and-present (E7-D07). | `CLI-008-F4` |
| 5 | **projector** | **UNBUILT.** `foldAttemptEvidence` hard-codes `detectedFiles: []` (`server/src/services/canary-terminal-projection.ts:256`) and `createCanaryRunProjector.projectTerminal` (`server/src/services/canary-run-projector.ts:156`) has four steps — events, terminal, `finalizeRun` (`:219`), run-summary comment (`:238`) — **none of which writes `task_outputs`**. | `CLI-008-F5` |
| 6 | **the judge** | **Counts the wrong things, and its obvious repair is refuted.** The module's only `capabilityFailures.push` is at `server/src/services/e7-distributed-run-verifier.ts:657`. | `CLI-008-F6` |

### Line pins that have drifted since they were published — correct these, do not copy them

| Published | Measured at `e710d8b54` | Where it appears |
|---|---|---|
| `canary-terminal-projection.ts:251` | **`:256`** | unit-F design §1.6 link 5 |
| `canary-run-projector.ts:149` / steps at `:163,:188,:211,:228` | **`:156`** / `:219`, `:238` | unit-F design §1.6 link 5 |
| *"`events.ts` declares exactly seven emitters"* | **false at this tip** — the service emitters (`serviceInstanceStarted` `:269`, `serviceHealth` `:282`, `serviceGracefulStopObserved` `:288`, `serviceInstanceStopped` `:299`, `serviceInstanceLost` `:305`) landed after that census | unit-F design §1.8 |
| `E7-F014` *"being fixed on a parallel branch"* (§5, "blocking dependency") | **RESOLVED** 2026-09-04 (PR #351) | unit-F design §5 |
| `e7-distributed-run-verifier-store.ts:198-218` / `:207` | the predicate moved ~230 lines in W21B/W21C; the store's own header records the move (`countProducedOutputs` 198 → 387, arm 1's `workspace_patch` conjunct 207 → 473) | CLI-008 design §2 |

The lesson these five rows carry is the programme's dominant failure class: **cite by symbol and
treat a line number as a hint.** `ls` every cited file and re-measure at HEAD.

### E5 / E3 surfaces this epic consumes and does not edit

| Surface | Source | E7 use |
|---|---|---|
| `POST /api/worker-control/artifact-transfer-grants` `:605`, `/artifact-commits` `:654` | `server/src/routes/worker-control.ts` | Mint + fenced commit. Mounted whenever distributed execution is on. Live-proven against real MinIO (`DAT-002-live-minio-result.md`, `d1-merge-train` `31885553697`, 13/13). |
| `createArtifactExportSequencer`, `grantPutHeaders` | `packages/worker-daemon/src/lease/artifact-export.ts:264,146` | Link 3's sequencing. **E5 owns the hook + composition** (`DAT-009-3c`/`3d`); this epic owns the producer. |
| `SupervisorDeps.resolveExportArtifacts` | does not exist yet — `DAT-009-3c` | Link 3's seam. `CLI-008-F3` is its first and only caller. |
| `DistributedRunCurrencyResolver` | `server/src/mcp/distributed-run-currency-resolver.ts:35`, composed `server/src/mcp/server.ts:302`, called `:466-479` | The fence-bound gate that scopes the run credential to a live lease. **It is the precondition for arming the tool surface** — the founder ruling names it as such. |
| `E2bTransport.readFile` / `listDir` | `packages/sandbox-e2b-provider/src/real-transport.ts:453,466` | The concrete binding behind link 1a's injected seam. |
| `postRunSummaryComment` | `server/src/services/run-summary-comment.ts` | The shared writer the projector already uses at step 4. Link 5 adds a step; it does not fork the writer. |

---

## 2. Epic shape and runtime rules

### Direction of authority

| Fact | Authority | Rule |
|---|---|---|
| Whether an artifact exists and is committed | The control plane, after a fenced commit re-verifies the declared SHA-256 via `headObject` | The worker's export returns an `{objectKey}`; only the commit makes it real. |
| Whether the founder can see it on the task | The projector writing `task_outputs` | **A committed artifact counts for the verifier whether or not it is visible.** Exit criterion 4 asks for visible; the counter asks for committed. Both are owed (E7-D03). |
| Whether the agent may call `mcp__aoa__*` | The run's identity being **fence-current**, resolved by DAT-007 item #1 | The surface is emitted only under the flag, and the flag is only safe once the resolver is proven (`DAT-007-S3` in E5's plan). |
| Whether the run produced useful work | **Nobody, today.** `capabilityProven` reads tables, never bytes | E7-D01. No ticket may claim otherwise. |

### Runtime rules every ticket obeys

- **Bytes leave the sandbox by a direct provider→object-store PUT under a worker-minted grant**
  (E7-D06). The control plane carries grants and references. No payload crosses the
  dependency-pinned daemon.
- **Best-effort on the way out, fail-closed on the way in.** Staging fails the attempt because an
  agent running without its input produces a clean terminal for mutilated work; export and
  announcement must not discard a successful run because its *evidence* could not be filed.
- **No `capabilityProven` claim from composition.** `E7-1-staged-input-write` already states the
  precedent in its own register reason: `wired` means *reachable from a boot root*, and that seam
  *passes NO files*. **A function that returns `[]` by construction is the vacuously-true clause the
  register exists to prevent** and is forbidden in every ticket below.
- **Never dispatch a keyed E2B workflow without explicit founder authorization.**
- **Do not close, enrol, or upgrade a `deliveryStatus` for half a conjunction.** This programme made
  that error twice and retracted publicly once.

### `E7-1-coding-journey` — why it is dormant, precisely

`scripts/gate-clause-wiring.json` → `E7-1-coding-journey`, symbol `E2bSandboxProvider`,
`expectedReferences: 4`, status `unwired`. Two one-file construction seams name it, two references
each: (a) the **desktop** root `packages/worker-keystore/src/bin/sandbox-provider.ts` (DEP-010), and
(b) the **adapter-manager** host root `packages/adapter-manager/src/bin/adapter-manager.ts:141`
(DEP-012 Slice 3 · Wave β2), which resolves the provider over the real transport and hands it to
`createProviderServer`.

It is `unwired` **in a shipped CI boot**, for two separate reasons, and both belong to E6:

1. **(a)** needs `AOA_WORKER_SANDBOX_PROVIDER=e2b` plus a composed supervisor loop — deferred.
2. **(b)** has a Dockerfile (`docker/adapter-manager`) and a staging compose that injects the AM
   public key, the boot envs and the matched CP mint key — but **the image is not built/pushed in
   CI**. `.github/workflows/deploy-replatform-campaign.yml` builds it (`:408-409`) under
   `workflow_dispatch` on the campaign host, which is an **operator-dispatched deploy, not a shipped
   CI boot**; `M1a`'s bar is explicitly a shipped CI boot. The through-the-daemon consumer is
   **DEP-011 Slice 5**, disposition **M**, and is not built.

The bin **fail-closes** without the CP public key, and `pnpm verify:cp-am-keypair` smoke-checks the
matched pair at C0 before the canary. The `expectedReferences` number is typed out, not computed, so
a later reference fires `unwired_but_now_has_caller`. `CLI-008-E7-1-JOURNEY-ARM` below promotes the
clause **when, and only when, both preconditions ship** — it does not build either of them.

---

## 3. TDD, evidence, and commit protocol for every ticket

1. The controller creates `tickets/<ID>-result.md` at `gate_review` with the exact bare 40-hex Start
   SHA, named implementer/reviewer, acceptance checklist, command ledger and explicit `pending`
   review sentinels. **It does NOT create `tickets/CLI-008-result.md`** — see §0's structural hazard.
2. A fresh implementer writes focused tests first and records a genuine RED on unchanged behavior.
   False REDs caused by imports, build order, or environment are rejected.
3. The implementer makes the smallest GREEN change, runs the focused acceptance suite **plus the
   affected-package typecheck and build**, updates `findings.md`, and commits.
4. A DISTINCT reviewer checks out the reviewed 40-hex revision, reruns the focused command there,
   appends review attempt 1 with plain `git commit`, and alone may set `complete`.
5. Any H-04 / H-05 / H-06 failure is a non-waivable `fail`.

**Traps that apply to these exact files:**

- `server/tsconfig.json` **excludes `src/__tests__`** — a clean `tsc --noEmit` does not typecheck the
  server suites. After merging siblings that touch a shared signature, run both sides' suites at the
  merged head.
- Cross-package suites resolve via `dist/`; build `@armyofagents/worker-protocol` before
  `@armyofagents/worker-daemon`.
- `node scripts/ci-local.mjs` green is **not** CI green (it skips the sharded `verify`).
- The workload seam is **the most heavily pinned surface in the repo** — the unit-F design counts 16
  pins (§3.2). A change to the argv reds tests in several packages at once; that is by design.
- Finding ids collide across parallel branches; **first-filed keeps the id**, and the renumbering
  unit must measure the sibling's head.
- `AOA_RUN_WIN_INTEGRATION=1` for integration tests; `jq` is not on PATH (use `gh --jq`).

```powershell
function Invoke-NativeGate([string]$Label, [scriptblock]$Command) {
  $priorErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Stop'
  try { $global:LASTEXITCODE = 0; & $Command; $ok = $?; $code = $global:LASTEXITCODE }
  catch { throw "$Label failed before a valid native exit: $($_.Exception.Message)" }
  finally { $ErrorActionPreference = $priorErrorAction }
  if (-not $ok -or $code -ne 0) { throw "$Label failed with native exit $code" }
}
```

| Ticket | Exact focused command (RED first, then identical GREEN) |
|---|---|
| `CLI-008-LEDGER` | `Invoke-NativeGate 'finding ownership' { node scripts/check-finding-ownership.mjs }; Invoke-NativeGate 'register citations' { node scripts/check-register-citation-integrity.mjs }; Invoke-NativeGate 'id uniqueness' { node scripts/check-register-id-uniqueness.mjs }; Invoke-NativeGate 'ticket graph' { node scripts/check-ticket-graph-coverage.mjs }; Invoke-NativeGate 'dependency graph' { node scripts/check-dependency-graph.mjs }` |
| `CLI-008-F1a` | `Invoke-NativeGate 'protocol build' { pnpm --filter @armyofagents/worker-protocol build }; Invoke-NativeGate 'F1a' { pnpm --filter @armyofagents/worker-daemon exec vitest run src/__tests__/capture-sandbox.test.ts src/__tests__/capture-sandbox-transport-binding.test.ts }; Invoke-NativeGate 'daemon boundary' { pnpm check:worker-daemon-boundary }; Invoke-NativeGate 'worker typecheck' { pnpm --filter @armyofagents/worker-daemon typecheck }; Invoke-NativeGate 'worker build' { pnpm --filter @armyofagents/worker-daemon build }` |
| `CLI-008-F1b` | **Design ticket — no RED/GREEN.** Evidence is the §6-constraint table, the positive-control table, and an adversarial attack pass on the chosen option (including on §13's *"do not build it"*, which has never had one). |
| `CLI-008-F3` | `Invoke-NativeGate 'protocol build' { pnpm --filter @armyofagents/worker-protocol build }; Invoke-NativeGate 'F3' { pnpm --filter @armyofagents/worker-daemon exec vitest run src/__tests__/export-request-producer.test.ts src/__tests__/supervisor-export-artifacts.test.ts src/__tests__/artifact-export-sequencer.test.ts }; Invoke-NativeGate 'worker typecheck' { pnpm --filter @armyofagents/worker-daemon typecheck }; Invoke-NativeGate 'worker build' { pnpm --filter @armyofagents/worker-daemon build }` |
| `CLI-008-F4` | `Invoke-NativeGate 'protocol build' { pnpm --filter @armyofagents/worker-protocol build }; Invoke-NativeGate 'F4' { pnpm --filter @armyofagents/worker-daemon exec vitest run src/__tests__/events-artifact-prepared.test.ts }; Invoke-NativeGate 'frozen v1' { pnpm check:frozen-worker-protocol-v1 }; Invoke-NativeGate 'worker typecheck' { pnpm --filter @armyofagents/worker-daemon typecheck }; Invoke-NativeGate 'worker build' { pnpm --filter @armyofagents/worker-daemon build }` |
| `CLI-008-F5` | `$env:AOA_RUN_WIN_INTEGRATION='1'; Invoke-NativeGate 'F5' { pnpm --filter @armyofagents/server exec vitest run src/__tests__/canary-run-projector.test.ts src/__tests__/canary-terminal-projection.test.ts src/__tests__/canary-output-projection.integration.test.ts }; Invoke-NativeGate 'gate clause wiring' { node scripts/check-gate-clause-wiring.mjs }; Invoke-NativeGate 'server typecheck' { pnpm --filter @armyofagents/server typecheck }; Invoke-NativeGate 'server build' { pnpm --filter @armyofagents/server build }` |
| `CLI-008-F6` | `Invoke-NativeGate 'F6' { pnpm --filter @armyofagents/server exec vitest run src/__tests__/e7-distributed-run-verifier.test.ts src/__tests__/e7-distributed-run-verifier-store.test.ts src/__tests__/e7-verifier-capability-fixture.test.ts }; Invoke-NativeGate 'server typecheck' { pnpm --filter @armyofagents/server typecheck }; Invoke-NativeGate 'server build' { pnpm --filter @armyofagents/server build }` |
| `CLI-008-C5` | `$env:AOA_RUN_WIN_INTEGRATION='1'; Invoke-NativeGate 'C5' { pnpm --filter @armyofagents/server exec vitest run src/__tests__/task-run-batch-workload.test.ts src/__tests__/mcp-run-currency-gate.test.ts src/__tests__/distributed-tool-surface-arming.integration.test.ts }; Invoke-NativeGate 'server typecheck' { pnpm --filter @armyofagents/server typecheck }; Invoke-NativeGate 'server build' { pnpm --filter @armyofagents/server build }` |
| `E7-1-JOURNEY-ARM` | `Invoke-NativeGate 'gate clause wiring' { node scripts/check-gate-clause-wiring.mjs }; Invoke-NativeGate 'cp/am keypair' { pnpm verify:cp-am-keypair }; Invoke-NativeGate 'E7-1 verifier' { pnpm verify:e7-1-distributed-run }` |

Test filenames not already on disk are **new files this plan authorizes**; the RED is the genuine
absence of the behavior, never a missing import.

---

## 4. Ticket implementation tasks

### `CLI-008-LEDGER` — file the link-scoped successors and re-point the ten findings (S, ≤1 agent-day, M0)

**Depends on:** nothing. **Disposition:** M's record precondition.

**Current state, measured:** `CLI-008` has **no result doc** — the `tickets/` directory holds
`CLI-008-design.md` and `CLI-008-unit-f-design.md` only. `scripts/finding-ownership.json` names it
as `ticket` for exactly ten open findings. Its own design's Status line has been stale before and
says so: *"If you are reading a Status line here, check it against `git log --oneline -- <this file>`
and the GO-BOOK row before trusting it."*

**Outcome:** the link-scoped ticket ids below exist as `#### ID` nodes in `program-design.md` (which
`check-ticket-graph-coverage.mjs` requires before any ticket file may exist), each open finding is
re-pointed from `CLI-008` to the link that will close it, and the five drifted citations in §1 are
corrected **by symbol**.

**Proposed finding → link ownership** (the reviewer confirms each against source; a wrong
re-ownership is worse than none):

| Finding | Severity | Proposed owner | Why |
|---|---|---|---|
| `E7-F003` | MEDIUM | **`CLI-008`** (parent, stays open) | It is the capability gap itself and spans tools + workspace + return path. It is why the parent may not carry a result yet. |
| `E7-F015` | MEDIUM | `CLI-008-F6` | The bar is forgeable by one board POST; the fix is a judge change. |
| `E7-F016` | LOW | `CLI-008-F6` | Clause 6's text misdescribes its own subject. |
| `E7-F017` | LOW | **`DAT-009` slice 3** (already its owner) | Found by DAT-009; the repair is a one-line reorder in Unit B's module. Leave it. |
| `E7-F023` | MEDIUM | `CLI-008-F6` | Clause 4's scanned set is composed at the call site. |
| `E7-F024` | MEDIUM | `CLI-008-F4` | The frozen `log` payload silently truncates at 65,536 chars and caps at 480 events — an announcement-surface property. |
| `E7-F026` | LOW | `CLI-008-F1b` | It is a critique of the fourth candidate answer, which is F1b's subject. |
| `E7-F027` | MEDIUM | **`CLI-008`** (parent) or a new `CLI-008-MX3` | codex's trusted-directory refusal. E7-D04 keeps it out of `M1b`; it must not be orphaned by the split. |
| `E7-F032` | LOW | `CLI-008-F6` | Clause 4 does not scan a sibling attempt's `job_events`. |
| `E7-F033` | MEDIUM | `CLI-008-F6` | The widened secret scanner's residual matchers. |

**Ticket non-goals — and the first is the important one:**
- **Do NOT create `tickets/CLI-008-result.md`.** `findCompletedTicketIds` counts a result's existence
  as completion; ten findings would lose their owner in a single commit (§0).
- Do not close, re-disposition, or downgrade any finding. Re-pointing an owner is not a closure.
- Do not renumber an existing finding id (first-filed keeps the id).

**Files:** `docs/replatform/program-design.md` (the new `#### CLI-008-F1a` … `#### CLI-008-F6`,
`#### CLI-008-C5` nodes); `scripts/finding-ownership.json`; `findings.md` (owner lines only);
`tickets/CLI-008-unit-f-design.md` (an **amendment note**, appended — the document's own convention
— correcting the five drifted citations and recording that `E7-F014` is resolved);
`tickets/CLI-008-LEDGER-result.md`.

**Interfaces:** none — record work.

**Failure behavior:** a guard that reds after the edit stops the ticket. A finding whose proposed
owner cannot be confirmed at source stays with `CLI-008` and is recorded as unconfirmed, not moved
on a guess.

**Migration/compatibility / rollback:** documentation + register only; revert the commit.

**Observability:** all five record guards green **after the last edit**, re-counted. A register row
and the thing it counts must never be edited in the same commit without a re-count.

**RED → GREEN:** RED is `check-finding-ownership.mjs` failing on a deliberately undeclared new
finding id (the positive control — a guard without one is a check that nothing runs); GREEN is all
five guards passing with the successors declared.

**Evidence / commit:** `tickets/CLI-008-LEDGER-result.md`; one documentation commit
`docs(e7): split CLI-008 Unit F into link-scoped tickets and re-point its findings`.

---

### `CLI-008-F1a` — prove the enumeration seam, and FENCE the byte-reading one (S, ≤1 agent-day, M1b)

**Depends on:** `CLI-008-LEDGER`.

**Current state, measured:** `captureSandboxEntries`
(`packages/worker-daemon/src/snapshot/capture-sandbox.ts:67`) is **built and tested**
(`src/__tests__/capture-sandbox.test.ts`: happy path, multi-file ordering, empty root, escape
refusal, unsafe-path refusal, determinism). It is **inert by construction** — `snapshot/index.ts`
does not export it, and nothing calls it. Its header says why: *"because link 3 is still unbuilt."*

★★★ **REWRITTEN 2026-09-20 (second review round). The original outcome was to export
`captureSandboxEntries` and prove its `listDir`/`readFile` binding against `E2bTransport` — i.e. to
prove the exact binding F3 now forbids, because `readFile` + `sha256` pulls sandbox bytes through
the daemon. Exporting it would have made the wrong tool reachable on the wrong lane, one ticket
before the ticket that must not use it.** This was self-contradictory and is corrected here rather
than left for someone to hit.

**Outcome, two halves:**

1. **Prove the ENUMERATION seam** — the half link 3 actually needs. `E2bTransport.listDir`
   (`packages/sandbox-e2b-provider/src/real-transport.ts:466`) returns **absolute file paths, not
   directories**, and that asymmetry is the one thing a consumer gets wrong silently. Bind and test
   it **metadata-only**: no `readFile`, no hashing, no bytes.
2. **FENCE the byte-reading seam.** `captureSandboxEntries` stays **inert on the E2B and networked
   lanes**. It is a local/desktop-lane tool — the sandbox analogue of DAT-001's local-FS walk — and
   this ticket makes that explicit in its header rather than leaving a reader to infer it. If it is
   exported at all, it is exported for the local lane only and carries a comment naming the
   data-plane contract it would otherwise breach.

**★ What this ticket does NOT do.** It gives the agent nothing to write. It is the capture half
only; the emit half is `CLI-008-F1b` and remains undesigned. **Do not read this ticket's completion
as a supply mechanism**, and no result doc may say capture landed as though output landed.

**Ticket non-goals:** calling it (that is F3); a Unit-E workspace, git base, or ignore policy
(E7-D05); a `WorkspaceManifestV1` (link 1b's assembly step, which brands via `.parse()`).

**Files:** create `packages/worker-daemon/src/__tests__/sandbox-listdir-binding.test.ts` (the
metadata-only enumeration proof); modify `packages/worker-daemon/src/snapshot/capture-sandbox.ts`
(header only — state the lane restriction and the contract it would breach). ★ **Do NOT export
`captureSandboxEntries` from `snapshot/index.ts` for the E2B/networked lanes.**

**Interfaces:** a metadata-only path enumerator — `(listDir, root) => readonly string[]`, with the
same fail-closed relativisation and `isSafeWorkspacePath` refusal the capture helper uses. **No
`readFile`, no digest, no bytes.** The digest and size the frozen grant schema requires come from
the provider's `digestArtifact`, which returns `{sha256, sizeBytes}` and no content.

**Failure behavior:** fail-closed, unchanged: a listed path not under `root`, or whose relativised
form fails `isSafeWorkspacePath`, **throws**. A capture that silently dropped or mangled a path
would commit an artifact that misrepresents the sandbox.

**Migration/compatibility:** additive export. The daemon boundary checker must stay green — the
module imports only `@armyofagents/worker-protocol` and relative modules, touching no `node:*` API
and no provider package (E4-D01).

**Observability:** none added; capture is a pure data producer.

**Rollback/disablement:** revert the barrel export; the module returns to inert.

**RED → GREEN:** RED — a binding test in which `listDir` returns directory entries rather than
absolute file paths must fail loudly rather than silently capture nothing; RED — the barrel export
is absent today; GREEN — both, plus the daemon boundary check and worker typecheck/build.

**Evidence / commit:** `tickets/CLI-008-F1a-result.md`; one commit
`feat(worker-daemon): export the sandbox capture half and pin its transport binding`.

---

### `CLI-008-F1b` — the emit half: DESIGN ONLY, founder-ruling gated (≤3 agent-days, M1b, **NOT ASSIGNABLE AS BUILD**)

**Depends on:** `CLI-008-F1a`. **Blocks:** `CLI-008-F6`, and exit criterion 4 in full.

**Current state, measured:** three mechanisms have been proposed and refuted — argv **shape**, argv
**size**, then **the predicate itself**. The ruling of record is **measure first**
(unit-F design §12), and all three probes have returned (run
[`34087197668`](https://github.com/MeteoriteLabs/AoA/actions/runs/34087197668), recorded in
[`tickets/W7U1-output-probe-result.md`](./tickets/W7U1-output-probe-result.md)): **(a)** a sandboxed
`claude` under the exact production argv exits 0 and **writes nothing**, and **writes when the
permission posture is added** — a single-variable differential; **(b)** the template pre-fills
nothing; **(c)** both streams deliver. The stop condition's **clause 1 is discharged** (the posture
shipped 2026-09-11, `E7-F021` resolved); **clause 2 still stands** (`E7-F027`, codex).

§13 records a **fifth option — *"do not build it"*** — that was **lost to a serialization failure
and therefore never adversarially attacked**. It is recorded, **not adopted**.

**Outcome:** exactly one of — (i) a fourth candidate mechanism that survives §6's constraint list
and the §4 refutation pattern, priced and sized, `claude_local`-only per E7-D04; or (ii) a
recommendation to adopt §13's option, **with the adversarial attack pass it has never had**; or
(iii) a recorded statement that neither is reachable, naming what would change it. A founder ruling
follows; **this ticket makes none of the three choices binding on its own.**

**★ The bar this ticket must clear, stated so it cannot be quietly lowered.** A fourth mechanism
proposed before it survives §6 will be refuted for the same reason the first three were (E7-D02).
The specific trap: round 3's repair collapsed because dropping the forgeable arm converted a
forgeable gate into an **unpassable** one, which forced the widening that §4.3 refutes. **That
pressure is real and remains unrelieved** — a proposal that does not address it is not a proposal.

**Ticket non-goals:** **any product change.** No literal in `task-run-sandbox-invocation.ts`, no
argv, no template, no test edit. No adapter-agnostic mechanism. No keyed dispatch.

**Files:** an amendment to `tickets/CLI-008-unit-f-design.md` (appended, per that document's own
convention — a refuted plan left standing in a design document gets built, so nothing is deleted
and nothing is silently demoted); a `DECISION-REQUEST-cli-008-unit-f-emit.md` under
`docs/replatform/`; `tickets/CLI-008-F1b-result.md`. **No source files.**

**Interfaces:** none.

**Failure behavior:** if no option survives, the ticket records **that**, with citations, and `M1b`
is reported as blocked with a named cause. *"A bounded, cited 'not yet, and here is exactly what
blocks it' is the outcome."* That is a successful ticket, not a failed one.

**Migration/compatibility / rollback:** none — no code.

**Observability:** the decision request must name, for each candidate, which §6 constraint it
satisfies and which positive control would prove it — not a narrative.

**Evidence / commit:** `tickets/CLI-008-F1b-result.md`; one documentation commit
`docs(e7): CLI-008 Unit F link 1b — candidate analysis and decision request`.

---

### `CLI-008-F3` — the producer: capture → export requests → the sequencer (M, ≤3 agent-days, M1b)

**Depends on:** `CLI-008-F1a`; **E5's `DAT-009-3c` and `DAT-009-3d` must be `complete`** at recorded
reviewed revisions (they supply `SupervisorDeps.resolveExportArtifacts` and its composition).

**Current state, measured:** the sequencer exists with zero production callers
(`packages/worker-daemon/src/lease/artifact-export.ts:264`); `resolveExportArtifacts` does not exist
at this tip; the daemon's HTTP client declares `artifactCommit`
(`packages/worker-daemon/src/transport/client.ts:294,643`) and **no production code calls it** —
`patch/result-commit.ts:25` names it only in a comment. DAT-009's own design assigns this link
explicitly: *"Slice f — NOT DAT-009's. The producer, the kind, and the counter… That is CLI-008 Unit
F. DAT-009 must not absorb it."*

**Outcome:** a producer that, on attempt completion, **enumerates paths only** under the
designated output root, turns each path into an `ArtifactExportRequest` with an **explicit declared
`kind`**, and hands the list to the sequencer through the E5 hook — so that one file the sandbox
produced becomes a `committed` `job_artifacts` row under a worker-minted grant.

★★★ **IT MUST NOT CALL `captureSandboxEntries`, AND THIS IS A HARD CONSTRAINT, NOT A PREFERENCE.**
That helper does `readFile` then `sha256(bytes)`, so every file's bytes would transit the worker
daemon — against the sequencer's own contract in `packages/worker-daemon/src/lease/artifact-export.ts`:
*"**GRANTS OUT, NEVER BYTES** … the bytes go sandbox → provider → object storage and **never touch
the daemon**, which is dependency-pinned (E4-D01) precisely so it does not handle them."*
`captureSandboxEntries` is a **local/desktop-lane** tool; on the E2B and networked lanes it is the
wrong tool and composing it here would reopen a locked data-plane boundary.

★ **The route that honours the contract already exists.** Enumerate with a metadata-only `listDir`;
let the sequencer's provider-backed `digestArtifact` (which returns `{sha256, sizeBytes}` and no
bytes) supply the digest and size the frozen grant schema requires, and `exportArtifact` do the
upload. The daemon sees paths and metadata, never content.

★ **This ticket owes a test that FAILS if the crossing returns** — a composition assertion that the
producer's dependency surface contains no byte-returning read. No existing guard catches it:
`check-worker-daemon-boundary` passes a violation because it enforces a *dependency* boundary while
the data-plane rule lives in a docstring.

**★ The `kind` decision is this ticket's, and it decides whether the counter moves.**
`countProducedOutputs` arm 1 filters `kind = 'workspace_patch'` and is attempt-scoped as of
`E7-F031`. A `kind` outside that filter produces a real, attributable, committed artifact that the
verifier **does not count**. Both of those are defensible and they are different products: the
former needs the Unit-E `workspace_patch` route (XL, out of `M1b` per E7-D05); the latter needs
link 6 to decide what it counts. **This ticket must state which it chose and why, in `decisions.md`
(E7-D08), and must not silently pick the one that makes a number go up.**

**Ticket non-goals:** telling the agent to write anything (F1b); the announcement (F4); the
projection (F5); changing the counter (F6); a Unit-E workspace.

**Files:** create `packages/worker-daemon/src/lease/export-request-producer.ts`; modify
`packages/worker-daemon/src/index.ts` (barrel); modify the `DAT-009-3d` composition point in
`packages/worker-daemon/src/lifecycle/dispatch-runtime.ts` to pass the real producer instead of
nothing; create `packages/worker-daemon/src/__tests__/export-request-producer.test.ts`; append to
`decisions.md`.

**Interfaces:** `createExportRequestProducer(deps: {capture, outputRoot, kind, contentTypeFor,
retention}) => (input: {handoff, exec}) => Promise<readonly ArtifactExportRequest[]>` — the exact
shape `SupervisorDeps.resolveExportArtifacts` expects. The object key stays **derived**, never a
caller field: `${expectedAttemptObjectPrefix(...)}${artifactId}` with `artifactId` derived from
(jobId, attempt, path), so a retry is a replay rather than a second artifact.

**Failure behavior:** an empty output root produces `[]` and **makes no HTTP call and does not even
fetch the session** (the sequencer's anti-vacuity property, already pinned by its own test — this
ticket must not break it). A capture throw is best-effort per E5-D07: log, `emitOp failed`, truthful
terminal, **attempt not failed** — the work is already done and must not be discarded because its
evidence could not be filed. A grant refusal surfaces its reason (`stale_fence` must survive to the
error message) and never fabricates a reference.

**Migration/compatibility:** additive, worker-only, behind the default-OFF distributed flag. No
schema, no route, no frozen-protocol change.

**Observability:** `emitOp` with the closed `digest_artifact` / `export_artifact` labels. **No path,
byte, grant URL, or file content in any log line or metric label** — the port already classifies the
grant URL as sensitive.

**Rollback/disablement:** pass no producer at composition; `resolveExportArtifacts` goes back to
unset and the lifecycle is byte-identical. The flag remains the operational off-switch.

**RED → GREEN:**
- RED: a fake sandbox with one planted file under the output root yields exactly one request whose
  `sha256`/`sizeBytes` come from the digest step, and one `committed` reference back.
- RED: an empty root yields `[]`, zero HTTP calls, and **zero session fetches** (anti-vacuity).
- RED: a retried attempt presents the SAME `idempotencyKey` and the SAME `artifactId` — a replay,
  not a second artifact.
- RED: a path outside the root is refused at capture and never reaches the sequencer.
- RED: the declared `kind` is the one `decisions.md` records — a mutant that swaps it reds.
- RED: no thrown message, returned value, or logged field contains `grant.url`.
- GREEN: all of the above plus protocol build and worker typecheck/build.

**Evidence / commit:** `tickets/CLI-008-F3-result.md`; one commit
`feat(worker-daemon): produce artifact export requests from the sandbox output root`.
Maps H-04, H-05.

---

### `CLI-008-F4` — the announcement: `EventSequencer.artifactPrepared` (S, ≤1 agent-day, M1b)

**Depends on:** `CLI-008-F3` (there is nothing to announce before it).

**Current state, measured:** `EventSequencer`
(`packages/worker-daemon/src/supervisor/events.ts`) has emitters for `attemptStarted` (`:170`),
`networkDenied` (`:178`), `log` (`:185`), `progress` (`:193`), `usage` (`:201`),
`browserObservation` (`:232`), the five service emitters (`:269`–`:305`) and `terminal` (`:310`) —
and **no `artifactPrepared`**. A repo-wide grep for `artifact_prepared`/`artifactPrepared` outside
tests returns declarations only, never an emission.

**★ And it is not blocked** (E7-D07): the event kind is frozen
(`packages/worker-protocol/src/events.ts:358`), the payload schema is frozen (`:387`), it is already
in the `job_events` CHECK (`packages/db/src/schema/job_events.ts:75`), and `EventSequencer` is daemon
code **outside** the contract-bytes freeze. This is the link a planner is most likely to assume needs
a custodian STOP. It does not.

**★ And it flips NO counter.** `countProducedOutputs` reads `job_artifacts` directly and joins no
events — **a committed artifact counts whether or not anything announced it**. What the emitter buys
is that the artifact becomes visible in the control plane's evidence stream, which is what link 5
projects onto the task. Any result doc claiming this moves `capabilityProven` is wrong.

**Ticket non-goals:** the projection (F5); the counter (F6); any frozen-protocol edit; widening the
`log` payload (`E7-F024` is a disposition here, not a payload change — the frozen `log` payload
**silently truncates** at 65,536 characters and caps at 480 events, so a reconstructed transcript is
corrupt rather than absent, and this ticket records that the artifact route does not inherit that
defect because it carries a reference, not bytes).

**Files:** modify `packages/worker-daemon/src/supervisor/events.ts`; modify the F3 producer to emit
after a successful commit; create
`packages/worker-daemon/src/__tests__/events-artifact-prepared.test.ts`; update `findings.md` for
`E7-F024`'s disposition.

**Interfaces:** `artifactPrepared(input: ArtifactPreparedPayloadV1): Promise<WorkerEventV1>` —
contiguous `seq`, per-event `eventDigest` via `canonicalEventDigestInputV1` + `node:crypto`, into
the injected sink, exactly like every sibling emitter.

**Failure behavior:** best-effort. A sink failure logs and continues to a truthful terminal; it
never fails the attempt and never retracts the commit (the artifact is already durable).

**Migration/compatibility:** additive. `check:frozen-worker-protocol-v1` must stay green — the
frozen package is not edited.

**Observability:** the event itself is the observable. Sequence contiguity and digest validity are
asserted.

**Rollback/disablement:** remove the emit call; the commit is unaffected.

**RED → GREEN:** RED — the emitter does not exist; RED — the emitted event validates against the
frozen `artifactPreparedPayloadV1Schema` and its digest verifies; RED — `seq` stays contiguous with
the surrounding emitters; RED — a sink throw does not fail the attempt; GREEN — all of the above
plus the frozen-consumer check and worker typecheck/build.

**Evidence / commit:** `tickets/CLI-008-F4-result.md`; one commit
`feat(worker-daemon): emit artifact_prepared after a fenced commit`.

---

### `CLI-008-F5` — the projector: make the artifact visible on the task (M, ≤3 agent-days, M1b)

**Depends on:** `CLI-008-F4`.

**Current state, measured:** `foldAttemptEvidence` hard-codes `detectedFiles: []`
(`server/src/services/canary-terminal-projection.ts:256`), and
`createCanaryRunProjector.projectTerminal` (`server/src/services/canary-run-projector.ts:156`) runs
four steps — events, terminal, `finalizeRun` (`:219`) and the run-summary comment (`:238`, via the
**same** `postRunSummaryComment` writer heartbeat and crew use) — **none of which writes
`task_outputs`**.

**Outcome:** a committed artifact for the attempt becomes visible to the founder on the task:
`detectedFiles` is folded from the `artifact_prepared` events rather than hard-coded, and the
projector writes the corresponding `task_outputs` row.

**★ The collision this ticket must not cause, stated up front.** `gate-clause-wiring.json`'s
`E3-17-output` (`jobOutputBridge`, JOB-014) **owns the general distributed-job → `task_outputs`
projection** and is `unwired` pending **M2 sink cutover** — *"task_outputs is still written by the
legacy path."* A second writer landing in M1 would make two mechanisms own one row. **The rule:
this projector writes only for a run whose `execution_owner` is `distributed` and whose attempt it
is projecting, and the result doc must state the boundary against `jobOutputBridge` in the words of
the register entry**, so that M2's cutover inherits a stated seam rather than a surprise.

**★ And the removed arm's cost, priced rather than rediscovered.** Today the question *"can a
distributed run produce a `task_output`"* is enforced by a clause a verify run **reads and prints**.
Moving enforcement into unit tests plus an acceptance criterion is weaker in a specific way: a unit
test reds in CI, but no `verify:e7-1-distributed-run` invocation would ever report *"the artifact
committed and the founder still cannot see it on the task"*. That trade is recorded here so this
ticket prices it rather than re-deriving it.

**Ticket non-goals:** the counter (F6); the sink cutover (M2); the legacy write path; forking
`postRunSummaryComment`.

★★★ **NOT ASSIGNABLE AS BUILD UNTIL ITS CONTRACT IS DESIGNED — the files and interfaces below are
the SECOND half of this ticket, not the first.** *Corrected 2026-09-20 (second review round): an
earlier revision listed only the projector edits, which reads as ordinary work and is not.*

**The blocker, measured.** `artifactPreparedPayloadV1Schema` is `{artifactId, kind}` and `.strict()`
— **it carries no path** — and the projector says so itself: *"`artifact_prepared` carries an
artifactId and a kind, never a path … so there is no honest file list to build."* Worse, that id
identifies a **`job_artifacts`** row, while `task_outputs.artifactId` references the **separate
`artifacts`** table. Following a projector-only task from here forces either an invented path or an
unlinked metadata-only row — both dishonest.

**So F5's FIRST deliverable is a design, recorded in `decisions.md`, covering:**

1. **Lookup** — `job_artifacts` row → a durable relative path, scoped by tenant, job, attempt and
   status. The frozen v1 wire will not carry the path, so the path's **provenance must be durable
   at commit time**, not reconstructed at projection time.
2. **Materialization** — `job_artifacts` → `artifacts`, **idempotent** under retry and re-projection,
   including the viewable version/reference rows `task_outputs` consumers expect.
3. **Ordering and failure** — where materialization sits relative to the terminal, and what happens
   when it fails after the terminal is durable.
4. **What it must NOT do** — mint a path the sandbox never reported, or write a `task_outputs` row
   whose `artifact_id` resolves to nothing.

**Only once that is recorded** does the build half apply — modify
`server/src/services/canary-terminal-projection.ts`, modify
`server/src/services/canary-run-projector.ts` (a fifth step ordered **after** the terminal and
**before** the run-summary comment), create
`server/src/__tests__/canary-output-projection.integration.test.ts`, and extend the two existing
projector suites.

**Failure behavior:** best-effort and ordered last-but-one: a projection failure logs and does not
retract the terminal, does not fail the attempt, and does not block the run-summary comment. A run
with no `artifact_prepared` events projects nothing and writes no row — asserted, because a
projector that writes an empty row on every run is the vacuity trap.

**Migration/compatibility:** additive; no schema change (`task_outputs` exists and is the unified
product index). No route change. Legacy and distributed never own the same run simultaneously.

**Observability:** the `task_outputs` row itself, plus a log line carrying opaque ids only. No file
bytes, no path content beyond the declared relative path, no grant URL.

**Rollback/disablement:** remove the fifth step; `detectedFiles` returns to `[]` and no row is
written. The distributed flag remains the outer off-switch.

**RED → GREEN:**
- RED: a run with one `artifact_prepared` event yields one `task_outputs` row and a non-empty
  `detectedFiles`.
- RED: a run with none yields **no row** and `detectedFiles: []` (anti-vacuity).
- RED: a projection throw leaves the terminal and the run-summary comment intact.
- RED: a run whose `execution_owner` is not `distributed` is **not** projected by this path (the
  `jobOutputBridge` boundary).
- GREEN: all of the above plus the wiring checker, server typecheck and server build.

**Evidence / commit:** `tickets/CLI-008-F5-result.md`; one commit
`feat(server): project committed artifacts onto the task for distributed runs`.

---

### `CLI-008-F6` — the judge: clause 6 and the four scanner findings (M, ≤3 agent-days, M1b)

**Depends on:** `CLI-008-F1b`'s **ruling** and `CLI-008-F3`. **This ticket may not be assigned
before the ruling**, because round 3 proved that changing the predicate without knowing what
supplies the output converts a forgeable gate into an unpassable one.

**Current state, measured:** `E7ProducedOutputCounts` is two numbers
(`server/src/services/e7-distributed-run-verifier.ts:130-133`). Clause 6 is the module's **only**
`capabilityFailures.push` (`:657`). Arm 1 counts committed `workspace_patch` `job_artifacts`,
attempt-scoped as of `E7-F031`; arm 2 counts an applied `output_projection` receipt on `job_id`,
job-granular by deliberate choice — and the store's own header carries a **DO NOT "MAKE THIS
CONSISTENT"** warning at `:297` that this ticket must read before touching either.

**Outcome:** clause 6 asserts something both **provable** and **non-forgeable**, given whatever
`CLI-008-F1b` ruled; and the four scanner/evidence findings are dispositioned with evidence.

| Finding | Disposition this ticket owes |
|---|---|
| `E7-F015` (MEDIUM, narrowed) | The `capabilityProven` flip is already closed; the **forged field still feeds clause 4's leak scan**. Either bound it or record why it is acceptable. |
| `E7-F016` (LOW, two parts) | Part (a) — the structural attribution at `:509-515` — is repairable here. Part (b) is recorded. |
| `E7-F023` (MEDIUM) | Clause 4 **does** scan `job_events`, and its scanned set is composed at the call site: a hard-fail gate reads model-influenced content. Bound it. |
| `E7-F032` (LOW) | Clause 4 does not scan a sibling attempt's `job_events`, so a retried job's leak can reach a clean verdict. |
| `E7-F033` (MEDIUM) | The residual over-matching hard matchers (`provider_key`, `e2b_api_key_assignment`) and the standing precision-AND-recall suite obligation. |

**Ticket non-goals:** re-opening `E7-F031`'s attempt-scoping; making arms 1 and 2 "consistent" (the
store forbids it in terms); widening arm 1 off `kind = 'workspace_patch'` **unless** F1b's ruling
supplies a supply mechanism whose output the widened arm cannot be satisfied by — the staged input
bundle satisfies the naive widening on every run (§4.3), and that refutation stands until a ruling
displaces it.

**Files:** modify `server/src/services/e7-distributed-run-verifier.ts` and
`-store.ts`; extend the pinned capability fixture; `findings.md` for the five dispositions.

**Interfaces:** `E7VerifyResult.capabilityProven` / `.capabilityFailures` keep their separation from
`ok`. **`ok` is not touched** — it means *the distributed journey was corroborated*, it is what the
D1 40/40 evidence proved, and folding capability into it would destroy the one distinction Unit A
bought.

**Failure behavior:** the verifier fails **closed** on capability: unproven is the default and
`--require-capability` is the flag that enforces it. A clause that cannot be evaluated is reported
as unevaluated, never as passed.

**Migration/compatibility:** verifier-only. `pnpm verify:e7-1-distributed-run` output shape changes,
so every consumer of the RESULT line must be re-read.

**Observability:** the RESULT line carries **both** verdicts, so a reader who sees only it cannot
come away with a single word.

**Rollback/disablement:** `--require-capability` stays off by default; a revert restores the prior
predicate.

**RED → GREEN:** RED — the pinned fixture proving the verifier currently blesses a context-free run
must still red under the new predicate; RED — a forged `task_outputs` row must not satisfy the
clause; RED — the sibling-attempt leak (`E7-F032`) is caught; RED — the two over-matching matchers
have precision **and** recall cases; GREEN — all of the above plus server typecheck and build.

**Evidence / commit:** `tickets/CLI-008-F6-result.md`; one commit
`fix(server): make the E7 capability clause provable and non-forgeable`.

---

### `CLI-008-C5` — arm the distributed tool surface behind the fence-bound gate (M, ≤2 agent-days, M1b)

**Depends on:** **E5's `DAT-007-S3` `complete`** at a recorded reviewed revision.

**Current state, measured:** Unit C is **RULED + ENACTED** (2026-09-19) and slices 1–4 are merged
**live-but-inert**: `AOA_DISTRIBUTED_TOOL_SURFACE_ENABLED`
(`server/src/config/distributed-execution.ts:29`) threads through
`server/src/services/job-placement.ts:387`, `run-execution-owner.ts:269-275`,
`execution-secret-handle-mint.ts:214,230` and `heartbeat.ts:5304`, and the claude argv emits
`--mcp-config "$N" --strict-mcp-config --allowedTools mcp__aoa`
(`server/src/services/task-run-sandbox-invocation.ts:218`). `scripts/finding-ownership.json` calls it
*"tool surface, SHIPPED inert"*. **`E7-F003`'s tools row legitimately stays open** — the flag is off.

**Outcome:** the flag is armed for the named internal Organization only, and the arming is **proven
to be gated**: the surface and the second secret handle are emitted only when the run's identity is
fence-current, which is exactly what DAT-007 item #1's resolver decides.

**★ Why this cannot precede `DAT-007-S3`.** The founder ruling's own words: DE-08 leaves **no network
backstop** for the run credential at the managed-shared tier, so the run-JWT cannot be fenced at the
network layer, and **DAT-007 item #1 is the only thing that scopes that credential to a live lease**.
The rejected option — *"turn it on without item #1"* — accepts a company-scoped tool surface
reachable by a stale or replaced sandbox for the run-JWT's lifetime. That is not a sequencing
preference; it is the ruling.

**Ticket non-goals:** codex (`E7-F027`, E7-D04 — the approved first-milestone adapter set is
`claude_local`; a codex `CODEX_HOME` MCP staging sub-unit is **out of M1** and stays with the parent
ticket); re-opening the DE-08 ruling; any egress allowlist (mechanism B was rejected); enabling the
flag for any Organization but the named one.

**Files:** deployment configuration for the named Organization; create
`server/src/__tests__/distributed-tool-surface-arming.integration.test.ts`; `findings.md` for
`E7-F003`'s tools row (**narrowed, not closed**).

**Interfaces:** none new — the flag and the gate both exist.

**Failure behavior:** the gate denies a stale/replaced run with the **same coarse forbidden** as
wrong-tenant, leaking no oracle; a resolver throw propagates and denies (fail-closed). With the flag
off, nothing is emitted and nothing is minted — the default until this ticket.

**Migration/compatibility:** configuration only in the product; no schema, route, or wire change.
Every other deployment is unaffected (flag default false).

**Observability:** record, on the milestone candidate, that the surface is emitted **only** for a
fence-current run — a run whose lease has expired must observably lose the surface. A gate that is
never observed to deny is a check that nothing runs.

**Rollback/disablement:** unset `AOA_DISTRIBUTED_TOOL_SURFACE_ENABLED`. Instant, config-only, and
the rollback rehearsal exit criterion 6 requires must include it.

**RED → GREEN:** RED — with the flag on and the run fence-current, the argv carries the MCP config
and the handle is minted; RED — with the flag on and the lease expired, the surface is denied and
the handle is **not** minted; RED — with the flag off, neither happens (the control proving the rows
measure the flag); GREEN — all three plus server typecheck and build.

**Evidence / commit:** `tickets/CLI-008-C5-result.md`; one commit
`feat(server): arm the distributed tool surface for the named internal Organization`.
Maps H-04, H-05.

---

### `E7-1-JOURNEY-ARM` — promote the coding-journey clause when its two preconditions ship (S, ≤1 agent-day, M1a)

**Depends on:** **E6** — (1) the adapter-manager image built and started in a **shipped CI boot**,
and (2) **DEP-011 Slice 5** (disposition **M**) wiring the through-the-daemon consumer. **This ticket
builds neither.** It may not be assigned until both have committed passing evidence.

**Current state, measured:** `E7-1-coding-journey` is `unwired` with `expectedReferences: 4`; both
construction seams exist (`packages/worker-keystore/src/bin/sandbox-provider.ts`;
`packages/adapter-manager/src/bin/adapter-manager.ts:141`); the image is built only by the
**operator-dispatched** `deploy-replatform-campaign.yml` (`:408-409`, `workflow_dispatch`), and the
staging compose is render-only in CI. See §2 for the full statement.

**Outcome:** the register entry flips to `wired` **with evidence**, and
`pnpm verify:e7-1-distributed-run` is run on the milestone candidate with its verdict recorded —
including, expectedly, `capabilityProven=false` if `M1b` has not landed.

**★ `capabilityProven=false` is a PASS for `M1a`, and saying so is the point of the split.** The
triage is explicit: *"`M1a` explicitly does NOT claim useful agent capability, and a record that
reports `capabilityProven=false` satisfies it."* The result doc must say so in those terms, so no
reader converts a mechanism verdict into a capability one.

★★★ **This ticket's record is an `M1a-D2-MECHANISM` record, not an `M1-D2-CODING` one.** It is
filed under that gate, its `Result` is the mechanism verdict, and it never contributes to the
capability gate — whose `Result` a `capabilityProven=false` run **fails**.

**Ticket non-goals:** building the image or the daemon consumer; flipping any other clause; running
a keyed E2B lane without founder authorization.

**Files:** `scripts/gate-clause-wiring.json` (`E7-1-coding-journey` → `wired`, cited **by symbol**);
`tickets/E7-1-JOURNEY-ARM-result.md`.

**Interfaces:** none.

**Failure behavior:** if either precondition is absent, the ticket **does not run** — it is not a
ticket that can partially succeed. If the wiring checker reports a reference count other than the
typed-out 4, that is a finding, not an edit to the number.

**Migration/compatibility / rollback:** register only.

**Observability:** `node scripts/check-gate-clause-wiring.mjs` reports the clause `wired` with its
caller count; `pnpm verify:cp-am-keypair` green at C0 before the canary; the E7-1 verifier's exit
code recorded, and `capabilityProven` reported alongside it. ★ *Corrected 2026-09-20: “both
verdicts recorded” described one record carrying two `Result`s, which the QA template does not
allow — the verifier PRINTS both values, and the record’s single normative `Result` is the
mechanism verdict.*

**RED → GREEN:** RED — the checker fires `unwired_but_now_has_caller` once the boot exists, before
the register edit (the positive control); GREEN — checker green after it, with the verifier's run
recorded.

**Evidence / commit:** `tickets/E7-1-JOURNEY-ARM-result.md`; one documentation commit
`docs(e7): promote E7-1-coding-journey on the shipped adapter-manager boot`.

---

## 5. Legacy parity mapping (FND-007 / frozen-main crosswalk)

The distributed coding path is **net-new**. The legacy analogue is the in-process heartbeat/adapter
execution path (`server/src/services/heartbeat.ts`, the adapter registry, and the legacy
`claude-local` adapter that assembles `--settings`, `--allowedTools mcp__aoa`, `--model`,
`--append-system-prompt-file`, `--add-dir` and delivers the prompt on stdin). It stays fully
authoritative and untouched; nothing here replaces, wraps, or disables it.

Two parity dimensions are **deliberately not yet bridged** and must not be recorded as passed:

- **`--model`** is still absent from the distributed argv — open since Unit A's row.
- **`--add-dir` / a workspace** is Unit E and is out of `M1b` (E7-D05).

Cutover of any Organization from in-process execution to the distributed worker is an **E10 MIG**
concern and is **M2**, not M1. Absence of a crosswalk row for a distributed coding capability is
recorded as net-new, never as "parity passed."

---

## 6. Failure-mode coverage and observability

| Code path | Realistic production failure | Ticket / test | Handling / signal |
|---|---|---|---|
| Capture | `listDir` returns directories, not files | `CLI-008-F1a` | Binding test fails loudly; no silent empty capture. |
| Capture | A path escapes the output root | `CLI-008-F1a` | Throws — fail-closed; an artifact must not misrepresent the sandbox. |
| Producer | Nothing was written by the agent | `CLI-008-F3` | `[]`, zero HTTP calls, zero session fetches; no orphan grant. |
| Producer | A retry double-commits | `CLI-008-F3` | Same `idempotencyKey`, same derived `artifactId` — a replay. |
| Producer | Export fails after successful work | `CLI-008-F3` | Best-effort: `emitOp failed`, truthful terminal, attempt **not** failed. |
| Producer | A grant URL reaches a log or a thrown message | `CLI-008-F3` | Asserted absent — H-04, zero tolerance. |
| Announcement | The event sink fails | `CLI-008-F4` | Best-effort; the commit is already durable and is not retracted. |
| Announcement | A reconstructed transcript is corrupt | `E7-F024` disposition in `CLI-008-F4` | Recorded: the artifact route carries a reference, not bytes, so it does not inherit the `log` truncation. |
| Projection | Two mechanisms write `task_outputs` | `CLI-008-F5` | Scoped to `execution_owner = distributed`; the `jobOutputBridge` boundary is stated for M2. |
| Projection | An empty row is written on every run | `CLI-008-F5` | No events ⇒ no row (anti-vacuity). |
| Judge | A board POST forges the bar | `CLI-008-F6` (`E7-F015`) | The `capabilityProven` flip is already closed; the clause-4 leak-scan feed is bounded here. |
| Judge | A retried job's leak reaches a clean verdict | `CLI-008-F6` (`E7-F032`) | Sibling-attempt scan. |
| Tool surface | A stale/replaced sandbox keeps calling tools | `CLI-008-C5` + E5's `DAT-007-S3` | Denied by the fence-bound resolver with the coarse wrong-tenant forbidden — no oracle. |
| Tool surface | Armed without the resolver | forbidden by the founder ruling | Not an implementable option. |
| Gate clause | A boot appears and the register does not notice | `E7-1-JOURNEY-ARM` | `unwired_but_now_has_caller` fires; the typed-out count is the tripwire. |

Metrics use bounded labels only and never an Organization, Company, job, path, grant URL, file
content, secret, or session byte.

---

## 7. Gate traceability

| Requirement | Owning evidence |
|---|---|
| D0-T01 focused acceptance | Every ticket's result ledger and the reviewer's rerun on the reviewed revision. |
| D0-T03 validators | `CLI-008-F4`'s digest/sequence assertions; `CLI-008-F6`'s precision-and-recall matcher suite. |
| D0-T04 protocol ownership | **N/A by measurement, not by assumption** — `artifact_prepared` is already frozen, already payload-schema'd, already in the DB CHECK (E7-D07). `check:frozen-worker-protocol-v1` is in the F4 row. |
| D0-T05 hermetic inputs | F1a/F3/F4 use an in-memory sandbox and a recording exporter; F5/F6 use embedded PostgreSQL; only `C5` and `E7-1-JOURNEY-ARM` touch a deployment, and neither dispatches a keyed lane without authorization. |
| H-04 secret containment | No grant URL, file content, path content, or credential in any log, metric label, thrown message, or returned value — asserted in F3 and F4. Zero tolerance. |
| H-05 sandbox boundary | Bytes leave by a direct provider→object-store PUT under a worker-minted grant; the control plane carries grants and references only (E7-D06). |
| H-06 network boundary | **NOT claimed.** The DE-08 residual is accepted at the managed-shared tier and **none of the three partial gates — `M1-D1-SPINE`, `M1a-D2-MECHANISM`, `M1-D2-CODING` — may mark H-06 passed.** ★ *Corrected 2026-09-20 (fourth round): this said “neither partial gate”, which describes the old two-gate model and left the new mechanism record outside the prohibition entirely.* Metadata/control-plane reachability is recorded as an unresolved provider-boundary risk, not as denied. |
| H-08 supply chain | No new runtime dependency; the daemon boundary checker stays green. |
| H-10 evidence integrity | Append-only ticket results; the unit-F design is amended by appended note, never by deletion. |
| Exit criterion 3 (**`M1a-D2-MECHANISM`**) | `E7-1-JOURNEY-ARM`, with `capabilityProven=false` explicitly acceptable. ★ *Corrected 2026-09-20 (third round): this row said “`M1-D2-CODING`, mechanism verdict”. There is no mechanism half of `M1-D2-CODING` — a QA record has ONE normative `Result`, which is why the companion change made the mechanism verdict its own gate. Recording this ticket under `M1-D2-CODING` would either falsely pass the capability gate or leave `M1a` unpassable.* |
| **Exit criterion 4 (useful capability — `M1b` only)** | **`CLI-008-F1b` + `F3` + `F4` + `F5` + `F6`, plus E5's `DAT-009-3c/3d`.** This is the only criterion the split moves, and `F1b` is the one link with no design. |
| Exit criterion 6 (rollback rehearsal) | `CLI-008-C5`'s config-only disablement is part of the rehearsal. |

**What no ticket here satisfies:** the E7 **epic** exit gate. `M1-D1-SPINE`, `M1a-D2-MECHANISM` and
`M1-D2-CODING` are **all three** non-promoting partial gates; a passing milestone handoff changes no epic status and must not use
`epic-completion` in its name.

---

## 8. Controller sequence and parallelization

```text
M0:    CLI-008-LEDGER            (unblocks every ticket id below)

M1a:   E7-1-JOURNEY-ARM          [gated on E6: adapter-manager image in a shipped CI boot
                                  + DEP-011 Slice 5 daemon consumer]

M1b:   CLI-008-F1a ──▶ CLI-008-F1b  ──(founder ruling)──▶ CLI-008-F6
              │                                              ▲
              └──▶ CLI-008-F3 ──▶ CLI-008-F4 ──▶ CLI-008-F5 ─┘
                      ▲
                      └── E5: DAT-009-3c ──▶ DAT-009-3d

       CLI-008-C5     [gated on E5: DAT-007-S3]   — parallel with the F chain

OUT OF M1, named so it is not read as dropped:
       Unit E (workspace, XL), codex MX3 (E7-F027), the M2 sink cutover
```

`CLI-008-F1b` runs **in parallel** with `F3`/`F4`/`F5` — that is the whole point of the split. The
four ordinary links are not blocked by the undesigned one; only `F6` is. `C5` shares no file with
the F chain. Parallel **PRs** are free; only **merges** serialize.

### Commit/evidence boundaries

- One implementer code commit per ticket; the reviewer's separate append-only result commit is the
  only commit that completes it.
- **Re-read every PR comment in the minute before merging** — `gh api repos/<owner>/<repo>/pulls/<n>/comments`,
  not `gh pr view --json comments`. External review files after CI settles; this has caught unread
  findings four separate times. Reply to every finding.
- **Re-read the PR title against the diff** — a squash takes its permanent commit title from it and a
  wrong one is unfixable.
- Merge, then re-check the next PR's mergeability; merges break siblings.
- A register row and the thing it counts are never edited in the same commit without a re-count
  after the last edit.

---

## 9. Planner self-review

- Every ticket is ≤3 agent-days; four are S. `CLI-008` as a whole was **UNSIZED**, and this is the
  substantive change: the six links are sized individually and only one of them is unsizable.
- Every ticket states its **current on-disk state from evidence** before saying what remains, cited
  by symbol and measured at `e710d8b54`. §1 lists five published citations that have drifted.
- The split is sequenced so it cannot orphan findings: `CLI-008-LEDGER` files the successors and
  re-points ownership **before** anything else, and is explicitly forbidden from creating
  `tickets/CLI-008-result.md` — the `findCompletedTicketIds` hazard that produced `MIG-010`'s
  deadlock and `E5-F001`'s orphaned residual.
- Dispositions are respected: `CLI-008` is **M** and is treated as build work; `CLI-007` is **N** and
  owes nothing, and is named once to say so rather than silently omitted.
- Link 1b is stated as undesigned, its three refutations are carried forward as binding, and the
  design ticket's permitted outcomes include *"neither is reachable"*. No fourth mechanism is
  proposed in this plan.
- Links 4 and 5 are stated as flipping **no counter**; only link 3 moves it. That distinction is
  `E7-F016`'s substance and is the error the plan is written to avoid.
- H-06 is not claimed; the DE-08 residual is carried explicitly; no keyed lane is dispatched without
  founder authorization.
- No frozen-protocol edit, no schema change, no new runtime dependency.
- **What I could not establish:**
  1. Whether the adapter-manager image is built in any **non-`workflow_dispatch`** lane. I found it
     built only in `deploy-replatform-campaign.yml` (`:408-409`) under `workflow_dispatch`, and the
     register says the staging compose is render-only in CI — but I did not audit every workflow
     file, so `E7-1-JOURNEY-ARM`'s precondition must be verified by E6 rather than inherited here.
  2. The exact remaining scope of **DEP-011 Slice 5**. Its design names Slice 5 as "deploy: the AM
     image, the compose…" across several sections; I did not find a Slice 5 result doc, so I have
     recorded it as unbuilt on the triage's authority (disposition **M**) and named it as an external
     gate rather than sizing it.
  3. Whether a `CLI-008` Unit C slice **result doc** exists anywhere — the E7 `tickets/` directory
     has none. The ruling, the commits and the shipped-inert code are all verifiable; the ledger is
     not, and `CLI-008-LEDGER` should record that gap rather than this plan asserting its cause.

---

## 10. Implementation tasks

Checkbox only after the named outcome is committed and independently reviewed; these tasks do not
authorize implementation.

- [ ] **T1 (P1 STOP, S)** — `CLI-008-LEDGER`: file the link-scoped successors, re-point the ten
  findings, correct the five drifted citations. Verify: five record guards green after the last
  edit; **`tickets/CLI-008-result.md` does not exist**.
- [ ] **T2 (P1, S)** — `CLI-008-F1a`: export the capture half and pin its transport binding. Verify:
  a directory-returning `listDir` fails loudly; boundary check green.
- [ ] **T3 (P1 STOP, design)** — `CLI-008-F1b`: produce one of the three permitted outcomes with a
  decision request. Verify: every candidate is priced against §6 and given a positive control; §13's
  option, if recommended, has had its first adversarial attack pass. **No product change.**
- [ ] **T4 (P1, M)** — `CLI-008-F3`: the producer, plus the **E7-D08 `kind` decision** recorded in
  `decisions.md`. Verify: anti-vacuity, replay-not-duplicate, escape refusal, no grant-URL leak.
- [ ] **T5 (P2, S)** — `CLI-008-F4`: `artifactPrepared`. Verify: frozen schema validates, digest
  verifies, `seq` contiguous, sink throw harmless, frozen-consumer check green.
- [ ] **T6 (P2, M)** — `CLI-008-F5`: the projection, with the `jobOutputBridge` boundary stated in
  the register entry's own words. Verify: no events ⇒ no row; non-distributed runs not projected.
- [ ] **T7 (P1 STOP, M)** — `CLI-008-F6`: the judge, after F1b's ruling. Verify: the forged row no
  longer satisfies; the sibling-attempt leak is caught; both matchers have precision and recall.
- [ ] **T8 (P1, M)** — `CLI-008-C5`: arm the tool surface after `DAT-007-S3`. Verify: an expired
  lease observably loses the surface and mints no handle; flag-off control.
- [ ] **T9 (P2, S)** — `E7-1-JOURNEY-ARM`: promote the clause once E6 ships both preconditions.
  Verify: `unwired_but_now_has_caller` fired first; the `M1a-D2-MECHANISM` record committed with
  `capabilityProven=false` printed and stated as an `M1a` pass — one record, one `Result`.
