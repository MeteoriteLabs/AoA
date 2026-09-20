# E5 — Workspaces, Artifacts, Secrets, and Network Policy — Implementation Plan

**Plan status:** `draft` — not approvable until (a) the operator approves the read-back, (b) the
`scope-triage.md` dispositions this plan executes are reflected in an owner-approved amendment, and
(c) the four shared decisions below (E5-D01…E5-D06) are ratified. This plan covers **only the E5
work the first milestone requires** — the disposition **B** re-measures (`DAT-011`, `TRACK-001`),
the disposition **A** record correction (`DAT-008`), and the disposition **M** build work
(`DAT-007` residual, `DAT-009` slices **3c / 3d / 3e**). Everything else in E5 is either
disposition **C1** (shipped, retained, **must not be re-opened**) or outside the milestone.

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` to
> execute this plan ticket by ticket **only after operator approval**. Every ticket uses a fresh
> implementer subagent (strict RED → GREEN) and a DISTINCT independent reviewer subagent. No ticket
> may be assigned until its named upstream is `complete` at a recorded reviewed revision.

**Goal:** close the E5 shortfalls the first milestone actually consumes — nothing more. Concretely:
(1) produce **current** evidence for the two B tickets on the milestone candidate rather than
inheriting a landed-once claim; (2) narrow the epic's over-broad "DAT-001 through DAT-011 shipped"
sentence to what the ticket ledgers say; (3) finish the **worker half of fenced object commit**, the
return path's link 3, so an artifact the agent produced can reach durable AoA storage under a
worker-minted grant; and (4) finish `DAT-007`'s remaining slice so arming the distributed flag does
not arm an unproven `/mcp` authorization gate.

**What this plan explicitly does NOT do:** it does not re-open the exit gate's wording, does not
relax "pass in D1", and does not claim any of the four dormant gate clauses become `wired` by
documentation. Three of them (`E5-3`, `E5-6`, `E5-result-commit-worker`) are **not** first-milestone
work and this plan says so with their evidence rather than quietly omitting them.

---

## 0. Planning record, freeze, dependency gates, and shared decisions

| Item | Recorded value |
|---|---|
| Planning revision | `e710d8b54027eb7338733e05f422c71cd5127345` — branch `claude/plan-spine-m1-split`. Every `file:line` and caller count below was measured at this tip, not inherited. |
| Plan of record | [`../../epic-regrooming/scope-triage.md`](../../epic-regrooming/scope-triage.md) as amended 2026-09-20 (founder decisions D-8…D-11), including the `M1a`/`M1b` split and the nine-criterion allocation table. |
| Epic status | tickets `complete`, **exit gate NOT met** (`README.md:3`). The gate is seven clauses; 2 pass in D1, 4 were proven weakly, 1 not at all — [`qa/2026-08-24-d0-e5-exit-gate-audit-a1.md`](./qa/2026-08-24-d0-e5-exit-gate-audit-a1.md). |
| Register clauses owned by E5 | `E5-2-fenced-object-commit-worker-half`, `E5-3-patch-quarantine`, `E5-5-redaction`, `E5-6-denied-egress`, `E5-result-commit-worker` (`scripts/gate-clause-wiring.json`). Only `E5-5` is `wired`. Gate clauses 1, 4 and 7 have **no** register entry at all — stated because their absence is not evidence of health. |
| Findings ledger | [`findings.md`](./findings.md) — `E5-F001` resolved, **`E5-F002` open** (MEDIUM, `unowned`, and it lands squarely on ticket `DAT-009-3e` below). |
| Upstream this epic consumes | E3 job-control (`artifact-transfer-grant.ts`, `artifact-commit.ts`, `worker-control.ts` routes) and E4 worker-daemon (`SandboxProvider` port, `EffectAuthority`, `dispatch-runtime.ts` composition). Both are on `main` and are **consumed, never edited** by this plan. |
| Formal test authority | Linux CI under DEC-03. Windows short-path evidence is operator-directed local evidence and must be labeled `operator-directed windows-local`. |
| Milestone records | Milestone QA/handoffs live under `docs/replatform/milestones/<M>/`, **not** in this epic folder (artifact-policy, founder decision D-11). `docs/replatform/milestones/M1a/` already exists. |

Epic-local decisions belong in `decisions.md`, which **does not exist yet** and is created by the
first executed ticket. Finding IDs are `E5-F0xx`; decision IDs are `E5-D0x`.

### Dispositions this plan executes, verbatim from the triage

| Ticket | Disposition | What that means here |
|---|---|---|
| `DAT-011` | **B** | Shipped and production-wired. Owes **current evidence on the milestone candidate**, not a rebuild. |
| `TRACK-001` | **B** | Shipped guard. Owes current lane-green evidence. |
| `DAT-008` | **A** | Preserve the implementation; narrow the completion claim. Slices 5–7 are not "shipped". |
| `DAT-007` | **M** | Its own result header already says `PARTIAL — the core remote-reach is BLOCKED`. Residual is build work. |
| `DAT-009` | **M** | Slices **3c / 3d / 3e** are `M1b` build work; return-path **link 3**. |
| `DAT-006`, `DAT-010` | **C1** | Shipped, production-wired, **not required by M1**. **Do NOT re-open their acceptance.** `DAT-010` sits on the milestone's own artifact-commit path (`server/src/services/artifact-commit.ts:42,272`). |

`DAT-001` through `DAT-005` are not in the triage's fifty at all. Nothing is owed on them by this
plan, and their inert-until-wired state is recorded by their own designs, not corrected here.

### Sequence + gates (epic-level preamble)

```text
M0 (record + lane health — no feature work):
  DAT-011-B1 ──┐
  TRACK-001-B1 ├──▶ E5-A2-MATRIX (freeze the seven-clause a2 audit matrix)
  DAT-008-A1 ──┘

M1a (the spine — flag armed, capabilityProven=false is a PASS):
  DAT-007-S3   (the /mcp currency gate proven against real PostgreSQL)

M1b (useful capability — the return path):
  DAT-009-3c ──▶ DAT-009-3d ──▶ (consumer: CLI-008 Unit F link 3, E7)
  DAT-009-3e   (parallel; unblocks the networked/container lane and closes E5-F002)

NOT first-milestone, stated with evidence rather than omitted:
  E5-3-patch-quarantine      → needs the workspace_patch route (CLI-008 Unit E + F)
  E5-result-commit-worker    → same route, same blocker
  E5-6-denied-egress         → BRW-004 slice (f); M3 at the earliest
```

### Shared decisions and locked contracts (E5-D01…E5-D06)

- **E5-D01 — The server half of fenced object commit is DONE and is not re-opened.** Mint
  (`server/src/services/artifact-transfer-grant.ts`), commit
  (`server/src/services/artifact-commit.ts`) and a real presigned PUT are **live-proven** against
  real MinIO-over-TLS on the D1 lane — `d1-merge-train` run `31885553697`, 13/13 on `b27817824`
  ([`tickets/DAT-002-live-minio-result.md`](./tickets/DAT-002-live-minio-result.md)). Every ticket
  below consumes that path by URL and wire schema. Any change to it is a STOP.
- **E5-D02 — `E5-2` names the WORKER half, and only the worker half.** The register entry is
  deliberately worded so that "the commit path is unbuilt" is **not** what it says. A ticket that
  reads it the other way repeats the exact substitution `E5-3-patch-quarantine` had to be corrected
  for in 2026-09-03. `createArtifactExportSequencer` has **zero production callers** at this tip —
  its only references are its definition (`packages/worker-daemon/src/lease/artifact-export.ts:264`),
  the barrel re-export (`packages/worker-daemon/src/index.ts:178`) and its own test.
- **E5-D03 — Composing the sequencer is NOT sufficient for a byte to move.** Slice `3d` composes it;
  **nothing produces `ArtifactExportRequest[]`**. The producer is CLI-008 Unit F link 3 (E7) and
  `DAT-009` must not absorb it — its own design says so
  ([`tickets/DAT-009-slice-3-design.md`](./tickets/DAT-009-slice-3-design.md) §4 slice f). A slice-`3d`
  result that claims capability is a half-conjunction close, which this programme has retracted once.
- **E5-D04 — The signed-PUT header contract has ONE home and the shipped uploader does not use it.**
  `grantPutHeaders` (`packages/worker-daemon/src/lease/artifact-export.ts:146`) exists, by its own
  docstring, to stop two providers re-deriving the headers independently. **Four derivations exist
  and they disagree on two axes** (header set, and whether the checksum is of the GRANT's
  `expectedSha256` or of the bytes uploaded) — `E5-F002`. Slice `3e` resolves this at the cause,
  on the keyed lane, and may not assert the choice from a filing.
- **E5-D05 — The orphan sweep's trigger decides WHEN TO LOOK, never WHAT IS ELIGIBLE.**
  `isSweepEligible` stays strictly-after-`expiresAt` and is the single authority
  ([`tickets/DAT-011-design.md`](./tickets/DAT-011-design.md) §3). `DAT-011-B1` re-measures; it must
  not widen a deletion rule while "refreshing evidence".
- **E5-D06 — No egress-enforcement claim, anywhere, from this plan.** `createFenceAwareEgressProxy`
  (`server/src/services/egress-proxy.ts:146`) has **zero production callers** at this tip: the only
  non-test importer is `server/src/__tests__/egress-proxy.integration.test.ts`, and two production
  comments (`server/src/routes/worker-control.ts:166`,
  `server/src/services/execution-secret-resolve.ts:7`) assert the same. Per the triage's dormant
  default-deny qualification, no E5 document may say sandbox egress denial passed because a policy
  object or allowlist was constructed, and `M1-D1-SPINE` / **`M1a-D2-MECHANISM`** / `M1-D2-CODING` may **not** mark H-06
  passed.

### NOT in scope (epic non-goals for the first milestone)

- No re-opening of `DAT-006` or `DAT-010` acceptance (C1).
- No `packages/db` schema change and no `drizzle-kit generate`. The artifact/grant/sweep tables and
  their migrations (`0262`, `0263`) already exist; nothing below adds a column.
- No egress proxy wiring (`E5-6`), no patch-apply wiring (`E5-3`), no result-commit composition
  (`E5-result-commit-worker`). Each is named in §2 with what it would take.
- No Unit-E workspace, no `WorkspaceManifestV1` producer, no `--add-dir`. That is E7.
- No new provider. `E2bSandboxProvider` already declares `artifactExportMode = "grant_upload"` and
  implements both methods for real (`packages/sandbox-e2b-provider/src/e2b-provider.ts:246`);
  slice `3e` is about the **networked/container** lane, not a second E2B provider.
- No timers, schedulers, or cross-tenant enumeration in the sweep path
  ([`tickets/DAT-011-design.md`](./tickets/DAT-011-design.md) §1, §4).

---

## 1. Consumed as-built interfaces / what already exists and is reused

### Control-plane HTTP surface (E3, live whenever distributed execution is on)

| Endpoint / symbol | Source | E5 use |
|---|---|---|
| `POST /api/worker-control/artifact-transfer-grants` | `server/src/routes/worker-control.ts:605` | Mint a short-lived upload grant bound to job/attempt/lease/fence. Consumed by the sequencer. |
| `POST /api/worker-control/artifact-commits` | `server/src/routes/worker-control.ts:654` | Fenced commit; re-verifies the declared SHA-256 via `headObject`. Consumed by the sequencer. |
| `createSweepTrigger` | imported `server/src/routes/worker-control.ts:44`, constructed `:137`, injected `:158` | The DAT-011 orphan-sweep trigger. **Production-wired**, on both commit outcomes. |
| `assertPrimaryDbBypassesRls` | `server/src/index.ts:669-673` (inside the `config.distributedExecutionEnabled` block) | DAT-007's boot precondition: refuse to arm distributed execution unless the primary role bypasses RLS, or the `/mcp` currency resolver reads zero rows and denies every distributed run. |

### Worker-daemon surface (E4, consumed by the export path)

| Symbol | File | State at this tip |
|---|---|---|
| `createArtifactExportSequencer` | `packages/worker-daemon/src/lease/artifact-export.ts:264` | Built, 16 tests / 12 mutants killed. **Zero production callers.** Barrel re-export at `packages/worker-daemon/src/index.ts:178`. |
| `grantPutHeaders` | `packages/worker-daemon/src/lease/artifact-export.ts:146` | Built, re-exported at `index.ts:180`. **Zero production callers** — `E5-F002`. |
| `SandboxProvider.digestArtifact` / `.exportArtifact` / `.artifactExportMode` | `packages/worker-daemon/src/supervisor/provider.ts:414,430,433` | Port declared, conformance suite + `grant_upload` fake double present. |
| `SupervisorDeps.resolveStagedFiles` | `packages/worker-daemon/src/supervisor/supervisor.ts:190` | The **exemplar** slice `3c` mirrors. `resolveExportArtifacts` does not exist — grep returns zero hits repo-wide. |
| `composeDispatchRuntime` / `createStagedInputResolver` composition | `packages/worker-daemon/src/lifecycle/dispatch-runtime.ts:172-178` | The **exemplar** slice `3d` mirrors. |
| `NetworkedProviderDriver` | `packages/provider-wire/src/driver.ts:83` (`artifactExportMode = "none"`), `:182-192` | `digestArtifact` / `exportArtifact` throw `UnsupportedProviderOperation` **unconditionally** — they never read the mode property. Slice `3e`'s subject. |
| `E2bSandboxProvider` | `packages/sandbox-e2b-provider/src/e2b-provider.ts:246` | `artifactExportMode = "grant_upload"`, both methods real, proven on real E2B (`keyed-e2b-dat-009-export.yml`, 4/4, run `33856478690`). **Already built — not a ticket below.** |
| `putGrantBytes` | `packages/sandbox-e2b-provider/src/e2b-provider.ts:142` | The shipped default uploader. Sends the checksum of the **bytes uploaded** and **omits** `x-amz-sdk-checksum-algorithm` — derivation #2 of four, and the only one that would execute in production. `E5-F002`. |

### `/mcp` broker surface (DAT-007, slices 1–2 shipped)

| Symbol | File | State |
|---|---|---|
| `classifyRunCurrency` | `server/src/mcp/distributed-run-currency.ts` | Pure, drizzle-free classifier (Tier-1 unit-testable). Shipped. |
| `createDistributedRunCurrencyResolver` | `server/src/mcp/distributed-run-currency-resolver.ts:35` | The DB reader: a `heartbeat_runs` PK probe LEFT-JOINing the distributed attempt, its lease and the lease's execution target, computing freshness in SQL against `clock_timestamp()`. Shipped. **Fail-closed: a throw propagates and denies.** |
| The gate | `server/src/mcp/server.ts:302` (construct), `:466-479` (call) | Composed at the request-authorization seam, dominating tools/call, tools/list and resources/*. Armed only when `readDistributedExecutionDeploymentFlag(process.env)` is true (`:297`). |

---

## 2. Epic shape and runtime rules

### The seven exit-gate clauses, at this tip

| # | Clause | 2026-08-24 audit | State at `e710d8b54` | First-milestone owner |
|---|---|---|---|---|
| 1 | immutable workspace staging | `proven_weakly` | Unchanged; `job-leasing.ts:371` still hardcodes `workspace: null`. No register clause. | **Not M1.** Needs CLI-008 Unit E. |
| 2 | fenced object commit | **`proven_in_d1`** (server half) | Server half live-proven (E5-D01). **Worker half `unwired`** — `E5-2`, zero callers. | `DAT-009-3c/3d/3e` (M1b). |
| 3 | patch conflict quarantine | `proven_weakly` | `createPatchApplyService` (`server/src/services/patch-apply.ts:88`) has **zero production callers** — every reference outside the definition is `server/src/__tests__/patch-apply.integration.test.ts`. `E5-3` `unwired`. | **Not M1.** See below. |
| 4 | lease-scoped secrets | `proven_weakly` | Slice 5 landed and is `wired` via `E5-5`; slice 7 is `DEFERRED (no code, no test)`; **slice 6 has no record at all**. | `DAT-008-A1` (record only). |
| 5 | redaction | `proven_weakly` | `E5-5` **`wired`** — `synthesiseRunSecrets` referenced by `composeDispatchRuntime`, planted-leak proof on both streams. The residual (a real sandbox authenticating over live E2B) lives in test evidence, not the caller count. | Covered by the M1 campaign. |
| 6 | denied egress | **`proven_in_d1`** (`e6f-08`) | `E5-6` **`unwired`** — `createFenceAwareEgressProxy` zero callers. The `e6f-08` evidence is the D1 harness, not this symbol. | **Not M1** (E5-D06). |
| 7 | brokered internal tool surface (DAT-007) | **`not_proven`** | Item #1 slices 1–2 shipped and armed behind the flag; item #2 (the `brokered:true` dispatch call site) is CLI-008 Unit C's. | `DAT-007-S3` (M1a) + E7 Unit C (M1b). |

### What the three non-milestone dormant clauses each need — stated, not omitted

- **`E5-3-patch-quarantine`** needs a production caller for `createPatchApplyService`. Its register
  reason already records the correction that matters: wiring the startup reconciler (`WRK-013`)
  flips `E4-3-survives-restart` and **does not** flip this clause, because the checker reads
  `createPatchApplyService`'s caller count and no E4 daemon ticket touches it. Its real unblocker is
  the `workspace_patch` route — an in-sandbox manifest capture plus a producer — which is CLI-008
  Units E and F. **Not first-milestone.**
- **`E5-result-commit-worker`** needs `createResultCommitter`
  (`packages/worker-daemon/src/patch/result-commit.ts:66`) composed on a boot path. At this tip its
  only non-test references are the barrel (`patch/index.ts:14`), a comment in
  `snapshot/capture-sandbox.ts:10`, and **two diagnostic string literals** in E7's own verifier
  (`server/src/services/e7-distributed-run-verifier.ts:667`,
  `server/src/cli/verify-e7-1-distributed-run.ts:68`) — the literals `stripStringLiterals` was added
  to stop counting (`E4-F018`). Same blocker as `E5-3`. **Not first-milestone.**
- **`E5-6-denied-egress`** needs some production path to call the proxy. Its register reason was
  re-derived from the charters in 2026-09-07: **two** chartered tickets passed over it and shipped
  (`DAT-005`, which built the symbol and booked itself complete with zero callers; `DSK-002`, whose
  acceptance clause (4) requires it and which shipped having declined it) plus **one nominee who
  declined by silence** (`DSK-003`). **BRW-004 slice (f) is the only remaining candidate owner**, is
  recorded `deferred` rather than unattempted (`BRW-004-result.md:15,:99,:366`), and is
  browser-scoped — so it lands in **M3**, not M1. Until then the DE-08 residual is observed and H-06
  is not claimed (E5-D06).

### Rules every ticket obeys

- **Control-plane authority.** The worker appends authenticated events and requests fenced
  operations. It never mutates a domain table. Grants out, references back — never bytes through
  the control plane (`DECISION-byte-egress-and-provider-topology.md`, Option D).
- **Fence at the boundary, synchronously.** The export path's fence gate is `EffectAuthority`, whose
  `digestArtifact`/`exportArtifact` refuse **before** the provider call is made — a withdrawn
  authority never hands the bearer grant to an implementation, and a redeemed grant cannot be
  recalled because the TTL is the only revocation there is.
- **Export is best-effort; staging is fail-closed.** They are opposite by design: an agent running
  without its input produces a clean terminal for mutilated work, so staging fails the attempt
  (`supervisor.ts:686-690`); the work is already done by export time, so a failed export must not
  discard a successful run. Slice `3c` owns that decision and needs its own mutant for it.
- **No speculative mint.** A grant minted and not redeemed is a durable row. A `digest` that throws
  produces **zero** `artifactTransferGrant` calls.
- **Object keys are derived, never caller-supplied.** `${expectedAttemptObjectPrefix(...)}${artifactId}`,
  matching `server/src/services/job-input-staging.ts:350`; `artifactId` derives from
  (jobId, attempt, path) so a retry is a replay, not a second artifact.

---

## 3. TDD, evidence, and commit protocol for every ticket

1. The controller creates `tickets/<ID>-result.md` at `gate_review` with the exact bare 40-hex Start
   SHA, named implementer/reviewer, acceptance checklist, command ledger, and explicit `pending`
   review sentinels. Implementation-agent self-certification cannot set `complete`.
2. A fresh implementer writes focused tests first and records a genuine RED on unchanged behavior.
   The controller rejects false REDs caused by imports, build order, or environment setup.
3. The implementer makes the smallest GREEN change, runs the focused acceptance suite **plus the
   affected-package typecheck and build**, updates `findings.md` for non-obvious discoveries, and
   commits.
4. A DISTINCT reviewer checks out the reviewed 40-hex revision, reruns the focused command on that
   revision, appends review attempt 1 with plain `git commit` (never `--no-verify`), and is the only
   one who may move `Status` to `complete`.
5. Any H-04 (secret containment), H-05 (sandbox boundary) or H-06 (network boundary) failure is a
   non-waivable `fail`. A dependency, protocol, or frozen-main contradiction is a STOP and a plan
   amendment, never an improvised implementation.

**Traps this epic has already paid for, restated because they apply to these exact files:**

- `server/tsconfig.json` **excludes `src/__tests__`**, so a clean `tsc --noEmit` does not typecheck
  the server suites. After merging siblings that touch a shared signature, run both sides' suites at
  the merged head.
- Cross-package suites resolve via `dist/` while vitest prints `src/` paths. **Build the dependency
  package first** — `@armyofagents/worker-protocol` before `@armyofagents/worker-daemon`.
- `node scripts/ci-local.mjs` green is **not** CI green; it skips the sharded `verify`.
- Windows: `AOA_RUN_WIN_INTEGRATION=1` for integration tests; `git show <rev>:<path>` fails silently
  (use `MSYS_NO_PATHCONV=1 git cat-file blob`); `jq` is not on PATH (use `gh --jq`).
- **Re-measure at HEAD; cite by symbol.** Every caller count in this plan is a measurement with a
  date attached, and the dominant failure class in this programme is a record disagreeing with the
  code it describes.

```powershell
function Invoke-NativeGate([string]$Label, [scriptblock]$Command) {
  $priorErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Stop'
  try {
    $global:LASTEXITCODE = 0
    & $Command
    $invocationSucceeded = $?
    $code = $global:LASTEXITCODE
  }
  catch { throw "$Label failed before a valid native exit: $($_.Exception.Message)" }
  finally { $ErrorActionPreference = $priorErrorAction }
  if (-not $invocationSucceeded -or $code -ne 0) { throw "$Label failed with native exit $code" }
}
```

| Ticket | Exact focused command (RED first, then the identical command GREEN) |
|---|---|
| `DAT-011-B1` | `Invoke-NativeGate 'DAT-011 sweep' { pnpm --filter @armyofagents/server exec vitest run src/__tests__/artifact-sweep-trigger.test.ts src/__tests__/artifact-commit.integration.test.ts }; Invoke-NativeGate 'server typecheck' { pnpm --filter @armyofagents/server typecheck }; Invoke-NativeGate 'server build' { pnpm --filter @armyofagents/server build }` |
| `TRACK-001-B1` | `Invoke-NativeGate 'graph coverage' { node scripts/check-ticket-graph-coverage.mjs }; Invoke-NativeGate 'graph coverage self-test' { node --test scripts/lib/__tests__/ticket-graph-coverage.test.mjs }; Invoke-NativeGate 'dependency graph' { node scripts/check-dependency-graph.mjs }; Invoke-NativeGate 'guard inventory' { node scripts/check-guard-inventory.mjs }` |
| `DAT-008-A1` | `Invoke-NativeGate 'register integrity' { node scripts/check-register-citation-integrity.mjs }; Invoke-NativeGate 'finding ownership' { node scripts/check-finding-ownership.mjs }; Invoke-NativeGate 'gate clause wiring' { node scripts/check-gate-clause-wiring.mjs }` |
| `E5-A2-MATRIX` | `Invoke-NativeGate 'evidence immutability' { pnpm check:evidence-immutability }; Invoke-NativeGate 'register integrity' { node scripts/check-register-citation-integrity.mjs }` |
| `DAT-007-S3` | `Invoke-NativeGate 'DAT-007 classify' { pnpm --filter @armyofagents/server exec vitest run src/__tests__/distributed-run-currency-classify.test.ts src/__tests__/mcp-run-currency-gate.test.ts }; $env:AOA_RUN_WIN_INTEGRATION='1'; Invoke-NativeGate 'DAT-007 real PG' { pnpm --filter @armyofagents/server exec vitest run src/__tests__/distributed-run-currency.integration.test.ts }; Invoke-NativeGate 'server typecheck' { pnpm --filter @armyofagents/server typecheck }; Invoke-NativeGate 'server build' { pnpm --filter @armyofagents/server build }` |
| `DAT-009-3c` | `Invoke-NativeGate 'protocol build' { pnpm --filter @armyofagents/worker-protocol build }; Invoke-NativeGate 'DAT-009 3c' { pnpm --filter @armyofagents/worker-daemon exec vitest run src/__tests__/supervisor-export-artifacts.test.ts src/__tests__/artifact-export-sequencer.test.ts src/__tests__/supervisor-happy.component.test.ts }; Invoke-NativeGate 'worker typecheck' { pnpm --filter @armyofagents/worker-daemon typecheck }; Invoke-NativeGate 'worker build' { pnpm --filter @armyofagents/worker-daemon build }` |
| `DAT-009-3d` | `Invoke-NativeGate 'protocol build' { pnpm --filter @armyofagents/worker-protocol build }; Invoke-NativeGate 'DAT-009 3d' { pnpm --filter @armyofagents/worker-daemon exec vitest run src/__tests__/dispatch-runtime.test.ts src/__tests__/dispatch-runtime-export-composition.test.ts }; Invoke-NativeGate 'gate clause wiring' { node scripts/check-gate-clause-wiring.mjs }; Invoke-NativeGate 'worker typecheck' { pnpm --filter @armyofagents/worker-daemon typecheck }; Invoke-NativeGate 'worker build' { pnpm --filter @armyofagents/worker-daemon build }` |
| `DAT-009-3e` | `Invoke-NativeGate 'wire build' { pnpm --filter @armyofagents/provider-wire build }; Invoke-NativeGate 'DAT-009 3e' { pnpm --filter @armyofagents/provider-wire exec vitest run src/__tests__/driver-artifact-export.test.ts }; Invoke-NativeGate 'AM' { pnpm --filter @armyofagents/adapter-manager exec vitest run src/__tests__/server-artifact-export.test.ts }; Invoke-NativeGate 'e2b headers' { pnpm --filter @armyofagents/sandbox-e2b-provider exec vitest run src/__tests__/put-grant-bytes.test.ts }; Invoke-NativeGate 'AM boundary' { node scripts/check-adapter-manager-boundary.mjs }; Invoke-NativeGate 'e2b boundary' { node scripts/check-sandbox-e2b-provider-boundary.mjs }; Invoke-NativeGate 'wire typecheck' { pnpm --filter @armyofagents/provider-wire typecheck }; Invoke-NativeGate 'wire build' { pnpm --filter @armyofagents/provider-wire build }` |

Test-file names in the `3c`/`3d`/`3e` rows are **new files this plan authorizes**; the implementer
creates them and the RED is the genuine absence of the behavior, not a missing import.

---

## 4. Ticket implementation tasks

### `DAT-011-B1` — current orphan-sweep evidence on the milestone candidate (S, ≤1 agent-day, M0)

**Disposition:** B. **Depends on:** nothing. **Already built:**
[`tickets/DAT-011-result.md`](./tickets/DAT-011-result.md) records `Status: LANDED` — 11 unit tests,
6 mutants / 6 killed, 68 tests across the seven artifact suites. Production wiring re-measured at
this tip: `createSweepTrigger` imported at `server/src/routes/worker-control.ts:44`, constructed at
`:137`, injected at `:158`. `runArtifactOrphanSweep`, `findSweepCandidates` and `markSwept` all have
that same production caller. **Nothing here is a rebuild.**

**Outcome:** a committed re-measure on the exact milestone candidate showing the chain still has
production callers, the debounce is still per-organization, a throwing sweep still cannot reach the
caller, and `isSweepEligible` is still untouched — so exit criterion 3's "every terminal cleanup
path" can cite a current record instead of a landed-once one.

**Ticket non-goals:** changing `isSweepEligible`; adding a timer, scheduler, or cross-tenant
enumeration; marking the refused artifact as a confirmed orphan (all excluded by the design's §7).

**Files:** append only to `tickets/DAT-011-result.md` (it is `LANDED`, so a correction would need a
new ticket — this ticket therefore writes `tickets/DAT-011-B1-result.md` instead and cross-links).
No source file changes expected. If a measurement disagrees with the result doc, that is a
**finding**, not an edit.

**Interfaces:** unchanged. `createSweepTrigger({ ... })` keeps its best-effort contract: it never
fails, slows, or rolls back a commit.

**Failure behavior:** if the re-measure finds a caller count of zero, or the debounce is global
rather than per-org, the ticket **stops** and files an E5 finding; it does not repair in place.

**Migration/compatibility:** none. No schema, no route, no wire change.

**Observability:** the record must name the sweep's log line and the §4 residual verbatim — an
organization whose LAST artifact activity produced an orphan keeps it until that org commits again.
That residual is accepted deliberately and must appear in the milestone record, not be discovered
later.

**Rollback/disablement:** not applicable — no behavior change. The underlying trigger is already
best-effort and already swallows every error.

**RED → GREEN:** RED is the assertion that the re-measure's caller-count query returns the recorded
symbols; run the focused suite on the candidate revision and record exit codes. GREEN is the
identical command passing plus server typecheck/build.

**Evidence / commit:** `tickets/DAT-011-B1-result.md`; one documentation commit
`docs(e5): re-measure DAT-011 orphan sweep on the M1 candidate`.

---

### `TRACK-001-B1` — current lane evidence for the ticket-graph guard (S, ≤1 agent-day, M0)

**Disposition:** B. **Depends on:** nothing. **Already built:**
[`tickets/TRACK-001-result.md`](./tickets/TRACK-001-result.md) — `Status: LANDED`.
`scripts/check-ticket-graph-coverage.mjs` (+ pure logic in `scripts/lib/ticket-graph-coverage.mjs`)
fails when a ticket file exists whose id has no `#### ID` node in `program-design.md`; wired into the
`policy` job in the **same step** as `check-dependency-graph.mjs`, declared in
`guard-inventory.json`, backed by 8 unit tests.

**Outcome:** the guard is green on the candidate **and read** — M0's whole point is that a lane which
is red, or green but unread, cannot produce a `Result: pass` record. `E6-F021` is the worked example:
a lane red for five days on a deleted upstream image, with the consumer built to report it unable to
see it.

**Ticket non-goals:** widening the guard's rule; adding nodes to `program-design.md` to make it pass.
A missing node is a **finding**, because the triage's disposition **X** exists precisely for ticket
ids with zero files (`MIG-001`, `MIG-004`).

**Files:** `tickets/TRACK-001-B1-result.md`. No source changes expected.

**Interfaces:** unchanged.

**Failure behavior:** a red guard is recorded as red with the offending id named. No quarantine
without a named owner.

**Migration/compatibility / rollback:** none — a checker run.

**Observability:** record the guard's exit code, the node count, and any id it names.

**RED → GREEN:** run the guard and its self-test on the candidate; both must exit 0. A deliberately
introduced fixture id with no node must red the guard (the positive control — a guard without one is
a check that nothing runs).

**Evidence / commit:** `tickets/TRACK-001-B1-result.md`; one documentation commit
`docs(e5): record TRACK-001 guard evidence on the M1 candidate`.

---

### `DAT-008-A1` — narrow the lease-scoped-secrets completion claim to the ledgers (S, ≤1 agent-day, M0)

**Disposition:** A — preserve the implementation and its evidence; do not inherit the over-broad
completion claim. **Depends on:** nothing.

**Already built, measured at this tip:** slices 1–4 landed
([`tickets/DAT-008-result.md`](./tickets/DAT-008-result.md), migrations `0262` and `0263`); **slice
5 landed** ([`tickets/DAT-008-slice-5-result.md`](./tickets/DAT-008-slice-5-result.md)) and gives
`E5-5-redaction` its production caller via `synthesiseRunSecrets` ← `composeDispatchRuntime`;
**slice 7 is `DEFERRED (no code, no test)`**
([`tickets/DAT-008-slice-7-result.md`](./tickets/DAT-008-slice-7-result.md)); **slice 6 has no record
on disk at all.**

**Outcome:** `README.md:3`'s sentence — "DAT-001 through DAT-011 shipped" — and the epic's
`complete` ticket line are narrowed to what the ledgers support: the control-plane half plus the
worker redemption slice landed; slice 6 is unaccounted and slice 7 is deferred with no code. This is
the record-truth half of disposition A, and it is the thing that makes exit criterion 1 checkable.

**Ticket non-goals:** building slice 6 or slice 7; touching `E5-5`'s `wired` status (it is correct —
the checker reads caller count, and the live-E2B residual lives in the test evidence, which the
register entry already says); re-opening `DAT-008`'s landed slices.

**Files:** `README.md` (the status sentence); `findings.md` (a new `E5-F003` recording the
unaccounted slice 6 if no record is found on a second search); `tickets/DAT-008-A1-result.md`.
**No source file changes.**

**Interfaces:** none.

**Failure behavior:** if a slice-6 record is found elsewhere in the tree, the finding is not filed
and the ticket records where it was found instead. Exoneration needs strictly more evidence than
conviction — re-test the claim at source before writing it down.

**Migration/compatibility / rollback:** documentation only; revert the commit.

**Observability:** the register-integrity guards must stay green after the edit — a register row
edited in the same commit that changes the thing counted is the recurring defect here. **Re-count
after the last edit.**

**RED → GREEN:** RED is the citation-integrity guard failing against a deliberately wrong symbol
anchor (positive control); GREEN is all three record guards passing after the edit.

**Evidence / commit:** `tickets/DAT-008-A1-result.md`; one documentation commit
`docs(e5): narrow the DAT-008 completion claim to its ticket ledgers`.

---

### `E5-A2-MATRIX` — freeze the seven-clause a2 audit matrix (S, ≤2 agent-days, M0)

**Disposition:** entry-criteria work named by the triage: *"the proposed E5 a2 seven-clause audit
matrix, commands, exact topology, QA owner, and decision owner are approved and frozen; the a2
record is planned to consume the exact M1 candidate campaigns rather than required to pass before
they start."*

**Depends on:** `DAT-011-B1`, `TRACK-001-B1`, `DAT-008-A1` (the matrix cites their records).

**Already built:** the a1 audit exists and is immutable
([`qa/2026-08-24-d0-e5-exit-gate-audit-a1.md`](./qa/2026-08-24-d0-e5-exit-gate-audit-a1.md),
`Result: awaiting_review`). Nothing supersedes it yet.

**Outcome:** a committed, reviewed **plan for a2** — per-clause verdict criteria, the exact commands
and topology, the named QA owner and decision owner — frozen before the campaign starts. a2 itself
is written **after** the M1 campaigns and consumes their records; this ticket does not write a2.

**Ticket non-goals:** writing a2; editing a1 (immutable — a correction creates a higher attempt with
`Supersedes`); relaxing any clause; marking H-06 passed.

**Files:** `qa/README.md` (the planned-a2 entry), `tickets/E5-A2-MATRIX-result.md`. The a2 record
itself will be `qa/<date>-d0-e5-exit-gate-audit-<sha12>-a2.md` with `Supersedes: a1`.

**Interfaces:** the matrix's per-clause verdict vocabulary is `proven_in_d1` / `proven_weakly` /
`not_proven` — a1's, unchanged, because changing the vocabulary between attempts makes the two
records incomparable.

**Failure behavior:** a clause whose evidence is not yet producible is recorded as **planned and
blocked, with the blocker named** — never as a clause dropped from the matrix.

**Migration/compatibility / rollback:** documentation only.

**Observability:** `pnpm check:evidence-immutability` must stay green — a1 must not be touched.

**RED → GREEN:** RED is the immutability checker failing on a deliberate edit to a1 (positive
control, reverted); GREEN is the checker passing with the new planning entry in place.

**Evidence / commit:** `tickets/E5-A2-MATRIX-result.md`; one documentation commit
`docs(e5): freeze the a2 seven-clause audit matrix, commands, topology and owners`.

---

### `DAT-007-S3` — prove the `/mcp` run-currency gate against real PostgreSQL (M, ≤3 agent-days, M1a)

**Disposition:** M. **Depends on:** DAT-007 item #1 slices 1 and 2 (both on disk at this tip).

**Already built, measured:** the pure classifier (`server/src/mcp/distributed-run-currency.ts`), the
DB reader (`server/src/mcp/distributed-run-currency-resolver.ts:35`), the composition
(`server/src/mcp/server.ts:302`) and the call at the request-authorization seam (`:466-479`, guarded
by `distributedExecutionEnabled && protocolActor.source === "agent" && req.actor.signedRunId`). The
boot precondition is wired too: `assertPrimaryDbBypassesRls(db)` at `server/src/index.ts:673`,
inside the `config.distributedExecutionEnabled` block, with the comment stating why — *"the resolver
would read zero rows and deny every distributed run (fail-closed). Loud boot failure beats a silent,
oracle-less 403 storm."* Ticket `DAT-007`'s own result header says
`PARTIAL — the core remote-reach is BLOCKED`, which remains accurate for item #2.

**What remains, and why it is `M1a` and not `M1b`:** `M1a` **arms the distributed flag**. The
moment it is armed, this gate runs on every `/mcp` call from a distributed run-JWT actor and reads
FORCE-RLS'd `leases` / `job_attempts` / `execution_targets` rows. The classifier has Tier-1 unit
coverage; the **query** does not have a proof against a real PostgreSQL with forced RLS and a real
`clock_timestamp()`. An unproven fail-closed authorization query on an armed path is exactly the
safety shape `E3-F037` was ruled an `M1a` blocker for.

**Outcome:** a Tier-3 integration proof, on embedded PostgreSQL with forced RLS, that the resolver's
verdicts are correct for: a local run (`execution_owner` NULL → admit), a distributed run with a
fresh active lease (admit), an expired lease (deny), a replaced `targetGeneration` (deny), a revoked
target (deny), a run in another company (deny with the **same coarse forbidden** as wrong-tenant, no
oracle), and a resolver throw (propagates → 500 → deny). Plus a positive control: the gate off (flag
false) admits every one of those.

**Ticket non-goals:** item #2, the `brokered:true` worker-dispatch call site — that is **CLI-008
Unit C** (E7), and building it here would absorb another epic's ticket. Changing the classifier's
verdict vocabulary. Widening the denial message (it is deliberately identical to wrong-tenant).

**Files:** extend `server/src/__tests__/distributed-run-currency.integration.test.ts`; extend
`server/src/__tests__/mcp-run-currency-gate.test.ts` with the flag-off positive control. Source
changes are expected to be **zero** — if the proof reds, the defect is filed and fixed in the
resolver, and that is the point of the ticket.

**Interfaces:** `DistributedRunCurrencyResolver.resolve({signedRunId, companyId, agentId}) →
RunCurrencyVerdict`. Unchanged. The signed run id is used and the header-overridable
`req.actor.runId` is not — that distinction is load-bearing (`server/src/middleware/auth.ts:363`)
and must be pinned by a test, because a mutant that reads the header would otherwise pass.

**Failure behavior:** fail-closed throughout. A thrown DB error propagates to the route catch and
becomes a 500 that denies. The reader must **never** catch-and-return "admit" — a mutant that does
so must red.

**Migration/compatibility:** none. No schema change, no route added, no wire change. The gate is
inert on every self-hosted deployment (flag default false) and on every non-agent actor.

**Observability:** a denial emits the coarse forbidden with no distinguishing detail. Record the
resolver's query plan shape in the result (every hop is a unique-index probe; the read must never
scan) so a later regression to a scan is visible.

**Rollback/disablement:** `AOA_DISTRIBUTED_EXECUTION_ENABLED=false` disables the gate entirely at
route construction (`server/src/mcp/server.ts:297`). Rollback is the flag, not a code revert.

**RED → GREEN:**
- RED: the seven verdict rows above against embedded PostgreSQL with forced RLS — absent today.
- RED: the header-override mutant (resolve on `req.actor.runId` instead of `signedRunId`) must red.
- RED: the catch-and-admit mutant must red.
- RED: the flag-off control admits all seven (proving the rows measure the gate, not the fixture).
- GREEN: the identical commands pass, plus server typecheck and build.

**Evidence / commit:** `tickets/DAT-007-S3-result.md`; one commit
`test(mcp): prove the DAT-007 run-currency gate against real PostgreSQL`. Maps H-04, H-05.

---

### `DAT-009-3c` — the supervisor export hook (M, ≤3 agent-days, M1b)

**Disposition:** M. **Depends on:** DAT-009 slices 1, 2, `3a`, `3b` — all landed
([`tickets/DAT-009-slice-1-result.md`](./tickets/DAT-009-slice-1-result.md),
[`slice-2-result.md`](./tickets/DAT-009-slice-2-result.md),
[`slice-3-design.md`](./tickets/DAT-009-slice-3-design.md) §4 slices a+b, shipped together).

**Already built:** `createArtifactExportSequencer` (`packages/worker-daemon/src/lease/artifact-export.ts:264`)
— 16 tests, 12 mutants, 12 killed — and `EffectAuthority.digestArtifact` / `.exportArtifact` with
their two metric labels. **`resolveExportArtifacts` does not exist**: a repo-wide grep at this tip
returns zero hits, so the hook is genuinely unbuilt and the RED is real.

**Outcome:** `SupervisorDeps.resolveExportArtifacts?: (input: {handoff, exec}) => Promise<readonly
ArtifactExportRequest[]>`, mirroring `resolveStagedFiles?` (`supervisor.ts:190`). **Absent ⇒ the
lifecycle is byte-identical to today.** Present ⇒ it runs between `observeRun` and `events.terminal`,
raced under a deadline (`withDeadline`, the `stageInputDeadlineMs` pattern), with `emitOp` on both
outcomes.

**The one design decision this ticket owns and `3a` deliberately did not pre-empt: is a failed
export a failed ATTEMPT?** Staging fails closed; export is on the other side of the work. The
recommended answer is **best-effort like `observeRun`** — log, emit `failed`, continue to a truthful
terminal — but it is a real decision with a real cost (evidence silently missing). It requires an
entry in `decisions.md` (**E5-D07**) and its own mutant. An implementer may not pick it silently.

**Ticket non-goals:** producing `ArtifactExportRequest[]` (E5-D03 — that is CLI-008 Unit F link 3);
composing the hook (slice `3d`); touching `isSweepEligible`, the frozen protocol, or any terminal.
The late-output quarantine path must **not** be designed against: `runOrphanQuarantine`'s only
production caller sits behind `E4-3-survives-restart`, which is `unwired`, so it is unreachable.

**Files:** modify `packages/worker-daemon/src/supervisor/supervisor.ts` (the optional dep + the
windowed call); modify `packages/worker-daemon/src/index.ts` (barrel the new dep type); create
`packages/worker-daemon/src/__tests__/supervisor-export-artifacts.test.ts`; append to
`decisions.md`.

**Interfaces:** the hook above, plus the `SandboxArtifactExporter` the sequencer already expects —
satisfied by `EffectAuthority`, so the fence gate stays at the boundary and this module never
becomes a second door.

**Failure behavior:** the hook absent → no call, no metric, byte-identical lifecycle (asserted).
The hook present and throwing/timing out → per E5-D07, log + `emitOp("export_artifact", "failed")`
+ truthful terminal; **the attempt is not failed**. A withdrawn `EffectAuthority` refuses
synchronously before the bearer grant reaches any implementation.

**Migration/compatibility:** additive, worker-only. No schema, no route, no wire change. The frozen
`worker-protocol` package is untouched — `check:frozen-worker-protocol-v1` must stay green.

**Observability:** `emitOp` on both outcomes with the closed labels `digest_artifact` and
`export_artifact` (shipped in `3b` with their `E7-F010` citation). No path, byte, or grant URL in
any log line or metric label.

**Rollback/disablement:** leave `resolveExportArtifacts` unset at composition — the optional dep is
the disablement switch, and `3d` is the only thing that sets it.

**RED → GREEN:**
- RED: hook present → the sequencer runs exactly once, inside the window, after `observeRun` and
  before `events.terminal`.
- RED: hook absent → zero calls and a byte-identical lifecycle (the anti-vacuity control).
- RED: a thrown hook does not fail the attempt (E5-D07) and emits `failed`.
- RED: a hook exceeding the deadline is raced out, emits `failed`, and the terminal is still truthful.
- RED: a withdrawn `EffectAuthority` refuses **synchronously** — the grant never reaches the exporter.
- RED: no log line or metric label carries `grant.url`, a path, or bytes.
- GREEN: the identical command plus protocol build and worker typecheck/build.

**Evidence / commit:** `tickets/DAT-009-3c-result.md`; one commit
`feat(worker-daemon): supervisor export-artifacts hook (DAT-009 slice 3c)`. Maps H-04, H-05.

---

### `DAT-009-3d` — compose the sequencer and promote `E5-2` (S, ≤1 agent-day, M1b)

**Disposition:** M. **Depends on:** `DAT-009-3c` `complete` at a recorded reviewed revision.

**Already built:** the exact exemplar — `createStagedInputResolver` composed at
`packages/worker-daemon/src/lifecycle/dispatch-runtime.ts:172-178` and handed to the supervisor as
`resolveStagedFiles`. This ticket mirrors it for `resolveExportArtifacts`.

**Outcome:** the sequencer is reachable from the dispatch boot root behind the default-OFF
distributed-execution flag, and `scripts/gate-clause-wiring.json`'s
`E5-2-fenced-object-commit-worker-half` flips from `unwired` to `wired` **with evidence**. The
checker is what forces this: it fires `unwired_but_now_has_caller` the moment a caller appears, so
the promotion cannot be skipped or delayed.

**★ The claim this ticket must NOT make (E5-D03).** Composing the sequencer is **not** sufficient
for a byte to move. Nothing produces `ArtifactExportRequest[]` at this tip. The `wired` promotion
means *reachable from a boot root*, the same sense `E7-1-staged-input-write` records — and that
entry states plainly that the seam passes no files. The result doc must say the same in its own
words, and must not claim `capabilityProven` moves. **A stub producer returning `[]` by construction
is the vacuously-true clause this register exists to prevent and is forbidden here.**

**Ticket non-goals:** the producer; any change to `supervisor.ts`; any change to the flag default.

**Files:** modify `packages/worker-daemon/src/lifecycle/dispatch-runtime.ts`; modify
`scripts/gate-clause-wiring.json` (`E5-2` → `wired`, with the caller cited by symbol, not by line);
create `packages/worker-daemon/src/__tests__/dispatch-runtime-export-composition.test.ts`.

**Interfaces:** `composeDispatchRuntime` gains one more optional dep passthrough. No new type.

**Failure behavior:** a composition that throws at boot is a boot failure, not a silent skip —
matching Unit D's lesson that an uncomposed staging port must not be a silent skip.

**Migration/compatibility:** additive; behind the default-OFF flag; no schema/route/wire change.

**Observability:** the register entry itself is the observable — `node scripts/check-gate-clause-wiring.mjs`
must report `E5-2` as `wired` with a non-zero caller count after this commit, and the citation must
anchor on the **symbol** (line pins rot; `E5-2`'s own citation was de-pinned in 2026-09-08 for
exactly that reason).

**Rollback/disablement:** revert the one composition line; the sequencer returns to zero callers and
the register entry returns to `unwired`. The flag remains the operational off-switch.

**RED → GREEN:**
- RED: `composeDispatchRuntime` passes `resolveExportArtifacts` to the supervisor (absent today).
- RED: the wiring checker reports `unwired_but_now_has_caller` before the register edit — the
  positive control proving the register is actually read.
- GREEN: both, plus worker typecheck/build and the wiring checker green.

**Evidence / commit:** `tickets/DAT-009-3d-result.md`; one commit
`feat(worker-daemon): compose the artifact export sequencer and promote E5-2`.

---

### `DAT-009-3e` — the networked-lane export route, and `E5-F002` at the cause (M, ≤3 agent-days, M1b)

**Disposition:** M. **Depends on:** `DAT-009-3c`. Runs **in parallel** with `3d`.

**Already built, and the correction that matters:** `E2bSandboxProvider` declares
`artifactExportMode = "grant_upload"` and implements both methods for real
(`packages/sandbox-e2b-provider/src/e2b-provider.ts:246`), proven against a **real E2B sandbox**
(`keyed-e2b-dat-009-export.yml`, 4/4, run `33856478690`), including the TOCTOU refusal. **That half
is done and this ticket does not rebuild it.** What remains is the other lane:
`packages/provider-wire/src/driver.ts:83` still declares `artifactExportMode = "none"`, and its
`digestArtifact` (`:182-184`) and `exportArtifact` (`:185-192`) throw `UnsupportedProviderOperation`
**unconditionally — they never read the property at all**. So a containerized worker cannot export.

**Outcome:** (a) the `digest_artifact` / `export_artifact` routes relayed over the provider wire to
`adapter-manager`, following the `stage_files` precedent (`E7-F011`: widen `#post`'s op type
**locally** to `ProviderOperation | "…"`, never the frozen vocabulary); and (b) **`E5-F002` resolved
at the cause** — `putGrantBytes` calls `grantPutHeaders` rather than re-deriving the header set, with
the digest-source question decided explicitly and re-proven on the keyed lane.

**★ `E5-F002` is a correctness decision, not a tidy-up.** Four derivations exist and disagree on two
axes. The shipped default uploader (derivation #2) is the **only one that would execute in
production** and the **only one missing `x-amz-sdk-checksum-algorithm`**, and it has never met a real
store on that path — the live-store evidence belongs to the D1 harness derivations #3/#4
(`tests/d1/lib/e6f-harness.mjs:1503`, `:1712`). `grantPutHeaders`' own docstring predicts the
failure: *"A provider that hashed what it actually uploaded would produce a PUT the store accepts and
a commit the control plane refuses `hash_mismatch`."* Which digest a signed PUT carries **must be
re-proven on the keyed lane, not asserted from a filing** — this ticket owns that proof, and until it
runs, the finding stays open.

**Ticket non-goals:** changing the frozen `ProviderOperation` vocabulary; changing
`artifact-commit.ts`'s `headObject` re-verification; minting, committing, or producing requests;
dispatching a keyed E2B workflow **without explicit founder authorization** — it spends money, and
this ticket's keyed run must be requested, not taken.

**Files:** modify `packages/provider-wire/src/driver.ts` (the two methods + the mode);
`packages/adapter-manager/src/server.ts` (the two op routes, provider-agnostic);
`packages/sandbox-e2b-provider/src/e2b-provider.ts` (`putGrantBytes` → `grantPutHeaders`);
`findings.md` (`E5-F002` → resolved) and `scripts/finding-ownership.json` (**delete the key in the
same commit** — the resolve protocol the entry itself specifies); create
`packages/provider-wire/src/__tests__/driver-artifact-export.test.ts`,
`packages/adapter-manager/src/__tests__/server-artifact-export.test.ts`,
`packages/sandbox-e2b-provider/src/__tests__/put-grant-bytes.test.ts`.

**Interfaces:** the wire request/response shapes for `digest_artifact` and `export_artifact`.
**Grants inbound, references outbound, never bytes** — the port carries a grant in and an
`{objectKey}` out, per `DECISION-byte-egress-and-provider-topology.md` Option D. The adapter-manager
half stays provider-agnostic; the concrete `E2bSandboxProvider` is never named in non-test
adapter-manager source.

**Failure behavior:** an unadvertised mode fails **explicitly** with `UnsupportedProviderOperation`,
never a guessed no-op. A size-check or re-hash mismatch refuses **at the cause** rather than at the
fenced commit's `headObject` check in another process. A severed PUT surfaces as a distinguishable
failure and never fabricates a reference.

**Migration/compatibility:** additive to a non-frozen port. `check:frozen-worker-protocol-v1` must
stay green — the frozen vocabulary is untouched. Both boundary checkers
(`check-adapter-manager-boundary.mjs`, `check-sandbox-e2b-provider-boundary.mjs`) must stay green;
`worker-daemon` is already among the five runtime dependencies `@armyofagents/sandbox-e2b-provider`
may declare, so importing `grantPutHeaders` is boundary-legal. If it were not, the helper would have
to move into `worker-protocol` beside the grant — a frozen-package change for a non-frozen concern,
which is a STOP.

**Observability:** provider op IDs on every record; the two closed metric labels from `3b`. No grant
URL, no bytes, no path in any log or label.

**Rollback/disablement:** revert the driver's mode to `"none"`; both methods throw again and the
containerized lane declines honestly, exactly as today.

**RED → GREEN:**
- RED: the networked driver's `digestArtifact`/`exportArtifact` relay rather than throw
  unconditionally.
- RED: the mode property is actually **read** — a driver with the mode set to `"none"` must still
  refuse, which today's code would pass vacuously because it never reads it.
- RED: `putGrantBytes` sends **both** header names, and a hex-forwarding mutant dies.
- RED: the digest-source decision is pinned by an assertion and its opposite reds.
- RED: no thrown message, returned value, or logged field contains `grant.url`.
- GREEN: all of the above plus the three package typechecks/builds and both boundary checkers.
- **Keyed lane (founder-authorized only):** re-run `keyed-e2b-dat-009-export.yml` and record the run
  id. Until that run exists, the result records the header decision as **decided but not
  live-proven**, and `E5-F002` stays open.

**Evidence / commit:** `tickets/DAT-009-3e-result.md`; two commits —
`feat(provider-wire): relay digest/export artifact ops to adapter-manager` and
`fix(sandbox-e2b-provider): derive signed-PUT headers from grantPutHeaders (E5-F002)`.
Maps H-04, H-05, H-08.

---

## 5. Legacy parity mapping (FND-007 / frozen-main crosswalk)

The artifact/export path is **net-new**. The legacy analogue is the in-process artifact and
task-output write path (`server/src/services/artifact-commit.ts` reached from the legacy run, plus
`task_outputs` written by the legacy projector), which stays fully authoritative and untouched.
Nothing in this plan disables, wraps, or races it — `E3-17-output` / `jobOutputBridge` remains
`unwired` and its cutover is **M2**, not M1. Legacy and distributed execution never own the same run
simultaneously; the first milestone runs one internal Organization through the distributed path with
the legacy path still owning everything else.

Absence of a crosswalk row for an export capability is recorded as **net-new**, never as "parity
passed."

---

## 6. Failure-mode coverage and observability

| Code path | Realistic production failure | Ticket / test | Handling / signal |
|---|---|---|---|
| Orphan sweep | A transient storage error silences sweeping for an org for a whole interval | `DAT-011-B1` | The debounce slot is stamped only on success (mutant M3′). Re-measured, not assumed. |
| Orphan sweep | A throwing sweep reaches the commit caller | `DAT-011-B1` | Best-effort; response byte-identical (mutant M4). |
| `/mcp` gate | The resolver throws | `DAT-007-S3` | Propagates → 500 → deny. A catch-and-admit mutant must red. |
| `/mcp` gate | A stale/replaced sandbox keeps calling tools | `DAT-007-S3` | Denied with the coarse wrong-tenant forbidden — no existence oracle. |
| `/mcp` gate | The header-overridable run id is read instead of the signed claim | `DAT-007-S3` | Pinned by test; the mutant reds. |
| Boot | Distributed armed while the primary role does not bypass RLS | already wired (`index.ts:673`) | Loud boot failure, not a silent 403 storm. |
| Export hook | The hook throws or exceeds its deadline | `DAT-009-3c` | Best-effort per E5-D07: `emitOp failed`, truthful terminal, attempt not failed. |
| Export hook | Composition silently skipped | `DAT-009-3d` | A composition failure is a boot failure; the wiring checker fires `unwired_but_now_has_caller`. |
| Export | A withdrawn authority hands out a bearer grant | `DAT-009-3c` | Synchronous refusal before any implementation sees it; a redeemed grant cannot be recalled. |
| Export | A speculative mint leaves a durable orphan row | `3a` (shipped), re-asserted `3c` | A throwing `digest` produces **zero** grant calls. |
| Export | The PUT carries the wrong checksum source or is missing a header | `DAT-009-3e` | Fail-closed at the store or at `headObject`; resolved at the cause, keyed-lane proven. |
| Networked lane | A containerized worker silently no-ops the export | `DAT-009-3e` | `UnsupportedProviderOperation`, explicit; the mode property is read, not ignored. |

No listed path is silent without both a test and a handling rule. Metrics use bounded labels only
(`operation`, `outcome`, `workload`, `provider`) and never an Organization, Company, job, path,
grant URL, secret, or byte.

---

## 7. Gate traceability

| Requirement | Owning evidence in this plan |
|---|---|
| D0-T01 focused acceptance | Every ticket's result ledger and the reviewer's rerun on the reviewed revision. |
| D0-T03 validators | `DAT-007-S3`'s verdict matrix and `DAT-009-3e`'s header/digest assertions run deterministic vectors. |
| D0-T04 protocol ownership | Expected N/A — zero frozen-protocol diff. `check:frozen-worker-protocol-v1` is in every worker-touching row. Any additive need is a custodian STOP. |
| D0-T05 hermetic inputs | `3c`/`3d` use fakes and a recording exporter; `DAT-007-S3` uses embedded PostgreSQL; only `3e`'s optional keyed lane touches a real provider, and only under founder authorization. |
| H-04 secret containment | No grant URL, secret, path, or byte in any log, metric label, thrown message, or returned value — asserted in `3c` and `3e`. Zero tolerance. |
| H-05 sandbox boundary | Bytes leave the sandbox only by a direct provider→object-store PUT under a worker-minted grant; the control plane carries grants and references, never bytes. |
| H-06 network boundary | **NOT claimed.** `E5-6` is `unwired`, the DE-08 residual is accepted and recorded, and neither milestone gate may mark H-06 passed (E5-D06). |
| H-08 supply chain | No new runtime dependency. Both provider boundary checkers stay green. |
| H-09 cleanup | `DAT-011-B1` re-measures the orphan sweep and records its §4 residual verbatim. |
| H-10 evidence integrity | Append-only ticket results; a1 is immutable and a2 supersedes it. |
| Exit criterion 3 (**`M1a-D2-MECHANISM`**, every terminal cleanup path) | `DAT-011-B1`. ★ *Corrected 2026-09-20 (third round): criterion 3 is the mechanism campaign, and terminal cleanup needs no attributable agent output — naming `M1-D2-CODING` would have deferred this evidence from `M1a` to `M1b`.* |
| Exit criterion 4 (useful capability, `M1b` only) | `DAT-009-3c`/`3d`/`3e` supply **link 3**. They do **not** satisfy the criterion — the producer is CLI-008 Unit F. |
| Exit criterion 7 (committed passing E5 a2 audit) | `E5-A2-MATRIX` plans it; a2 is written after the campaigns and consumes their records. |

---

## 8. Controller sequence and parallelization

```text
M0:   DAT-011-B1 ─┐
      TRACK-001-B1 ├─▶ E5-A2-MATRIX
      DAT-008-A1 ──┘

M1a:  DAT-007-S3        (independent; may run alongside M0)

M1b:  DAT-009-3c ─▶ DAT-009-3d ─▶ [E7: CLI-008 Unit F link 3 — the producer]
                 └─▶ DAT-009-3e  (parallel with 3d; different packages)
```

`3c` and `3e` touch different packages and may run in parallel after `3c` lands the hook type; `3d`
is strictly after `3c`. The three M0 tickets are independent of each other and of everything else.
Parallel **PRs** are free; only **merges** serialize.

### Commit/evidence boundaries

- One implementer code commit per ticket (`feat(...)` / `fix(...)` / `test(...)`); the reviewer's
  separate append-only result commit is the only commit that completes the ticket.
- `DAT-009-3e` is the one ticket with two commits, and they are separable by design: the wire route
  and the `E5-F002` fix are independently revertable.
- A register row and the thing it counts are **never** edited in the same commit without re-counting
  after the last edit.
- `findings.md` records discovered behavior, rejected hypotheses, STOP conditions, and resolution; a
  behavior-changing choice (E5-D07 above) also updates `decisions.md` and this plan before
  implementation resumes.

---

## 9. Planner self-review

- Every ticket is ≤3 agent-days; four are S.
- Every ticket states its **current on-disk state from evidence** before saying what remains, cited
  by symbol with a line number as a hint only, measured at `e710d8b54`.
- Dispositions are respected: **B** tickets owe current evidence and not a rebuild; the **A** ticket
  narrows a claim and touches no source; the **M** tickets are the only build work; **C1** tickets
  (`DAT-006`, `DAT-010`) are named once and never re-opened.
- The three dormant clauses that are **not** first-milestone work are stated with their evidence and
  their real unblockers, rather than omitted — omission would read as closure.
- `E5-D03` is the guard against this plan's most likely misreading: composing the sequencer is not
  capability, and a stub producer is forbidden.
- H-06 is not claimed anywhere; the DE-08 residual is carried explicitly.
- No schema change, no `db:generate`, no frozen-protocol edit, no new runtime dependency.
- **What I could not establish:** whether a `DAT-008` slice-6 record exists anywhere outside
  `epics/E5-workspaces-secrets/tickets/` — a search of that directory found none, and
  `DAT-008-A1` is instructed to search again before filing a finding rather than assert absence.
  I also could not establish a current green/red state for any CI lane from this worktree; every
  lane claim in `M0` must be produced by running the lane, not inherited from this plan.

---

## 10. Implementation tasks

Checkbox only after the named outcome is committed and independently reviewed; these tasks do not
authorize implementation.

- [ ] **T1 (P1, S)** — `DAT-011-B1`: re-measure the orphan-sweep chain's production callers and
  debounce properties on the milestone candidate. Verify: the four symbols still have the
  `worker-control.ts` caller; mutants M2/M3′/M4 still kill.
- [ ] **T2 (P1, S)** — `TRACK-001-B1`: run the ticket-graph guard plus its positive control on the
  candidate. Verify: exit 0, and a fixture id with no node reds it.
- [ ] **T3 (P1, S)** — `DAT-008-A1`: narrow `README.md:3` to the ledgers; file a finding for the
  unaccounted slice 6 only after a second search. Verify: three record guards green after the edit.
- [ ] **T4 (P2, S)** — `E5-A2-MATRIX`: freeze the seven-clause matrix, commands, topology and owners.
  Verify: a1 untouched, `check:evidence-immutability` green.
- [ ] **T5 (P1 STOP, M)** — `DAT-007-S3`: prove the run-currency gate against real PostgreSQL with
  forced RLS. Verify: seven verdict rows, the header-override mutant, the catch-and-admit mutant,
  and the flag-off control.
- [ ] **T6 (P1 STOP, M)** — `DAT-009-3c`: the supervisor hook, plus the **E5-D07 decision** on
  whether a failed export fails the attempt, with its own mutant.
- [ ] **T7 (P1, S)** — `DAT-009-3d`: compose it, promote `E5-2` with evidence, and state plainly in
  the result that no byte moves yet. Verify: `unwired_but_now_has_caller` fires before the edit.
- [ ] **T8 (P1, M)** — `DAT-009-3e`: the networked-lane route and `E5-F002` at the cause. Verify:
  the mode property is actually read; both header names sent; the keyed-lane proof requested and
  recorded, or the finding left open.
