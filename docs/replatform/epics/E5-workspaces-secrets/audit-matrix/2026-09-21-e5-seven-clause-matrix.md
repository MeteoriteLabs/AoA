# E5 seven-clause audit matrix — the frozen audit plan (`E5-A2-MATRIX`)

**Frozen by:** ticket `E5-A2-MATRIX` ([`../tickets/E5-A2-MATRIX-result.md`](../tickets/E5-A2-MATRIX-result.md)).
It takes effect when a distinct reviewer approves that ticket.

**What the pin covers: this whole file, and nothing else.** This file holds only the frozen plan.
The E5 records index and the planned-attempts table live in [`../qa/README.md`](../qa/README.md),
**outside** the pin, so filing and indexing an attempt never changes this file's blob. The result
records this file's git blob SHA at freeze. Every attempt from `a2` onward verifies it with:

```
git rev-parse <candidate sha>:docs/replatform/epics/E5-workspaces-secrets/audit-matrix/2026-09-21-e5-seven-clause-matrix.md
```

If the output differs from the recorded SHA, the plan changed after the freeze. That change needs its
own recorded decision before any attempt may rely on it. This file is deliberately **not** under
`qa/`: every `qa/*.md` other than `README.md` is an immutable evidence record (`EVIDENCE_RECORD_RE`,
`scripts/check-evidence-immutability.mjs`), and this is a plan, not evidence.

**One plan for every attempt.** The matrix, commands, topology and owners below are frozen once and
reused unchanged by `a2`, `a3` and later attempts. Keeping them fixed is what makes the attempts
comparable.

## Owners (founder ruling F2, 2026-09-21)

| Role | Owner | Constraint |
|---|---|---|
| Decision owner | **founder (delegated to the M1 planning session)** | The planning session takes each decision under the delegation and records it with its reason. |
| QA owner | **a distinct review session, never the deciding session** | It certifies the audit record. It may not be the session that wrote the audit or that took any decision the audit relies on. |

The founder owns every role. The only thing F2 keeps separate is QA: the session that decides may not
certify its own QA record.

## Verdict vocabulary (unchanged from `a1`)

`proven_in_d1` / `proven_weakly` / `not_proven`. These are `a1`'s three values with `a1`'s meaning.
Changing them between attempts would make the records incomparable.

- **`proven_in_d1`**: the clause's named production path **executes and is asserted** in a
  committed campaign record on the D1 compose topology (`docker-compose.d1.yml`) **for the exact
  candidate**, on every execution path that candidate enables for the clause.
- **`proven_weakly`**: real, CI-run evidence exists, such as in-process tests, a Tier-3 real-PostgreSQL
  suite in a Linux `verify` shard, or an adjacent D1 test. But the clause's production path is not
  exercised in a D1-topology campaign, or it is exercised on only some of the paths the candidate
  enables.
- **`not_proven`**: no evidence reaches the clause's production path, or a committed measurement
  shows the clause failing on a path the candidate enables.

Real-E2B observations from `M1a-D2-MECHANISM` or `M1-D2-CODING` are recorded in the matrix's
**D2-partial observation** column. They do **not** change the vocabulary: a D2-partial observation
alone never grades a clause `proven_in_d1`. All three M1 partial gates are **non-promoting**
(scope-triage §Normative-gate boundary). So no grade in any attempt certifies the E5 exit gate.

## Exact topology

**Candidate.** One exact 40-hex revision per attempt: the milestone candidate frozen at campaign
freeze (M1 plan §6, step 1). The audit reads that revision and nothing else. It re-grades nothing
from `a1` or from an earlier candidate.

**Tenancy (founder ruling F10: M1 is multi-tenant).** Every campaign record an attempt consumes
must run **at least three Organizations**:

| Tenant | Rollout state | Role in the audit |
|---|---|---|
| `T-A` | enabled through the per-Organization rollout policy `AOA_DISTRIBUTED_EXECUTION_ROLLOUT` (`DISTRIBUTED_EXECUTION_ROLLOUT_ENV`, `server/src/config/distributed-execution-rollout-source.ts`) | per-tenant correctness; attacker **and** victim in cross-tenant cases |
| `T-B` | enabled through the same policy | per-tenant correctness; attacker **and** victim in cross-tenant cases |
| `T-C` | **not** enabled (the control) | must be refused distributed execution and stay on the legacy path |

The tenant set is read from the rollout-policy digest in the candidate freeze. It must be the same
at campaign start and end. Distributed database access runs through the non-owner `aoa_app` pool
with `FORCE ROW LEVEL SECURITY`, which flag-on provisions (`maybeProvisionDistributedExecutionRoles`
and `assertPrimaryDbBypassesRls`, `server/src/index.ts`). A cross-tenant case counts only if it is
**denied**, not merely empty. It also needs a **same-tenant positive control**: the identical
request made by the owning tenant succeeds. Without that control, a denial could just mean the path
never ran.

**Campaign records consumed, all on the same candidate:**

| Record | Topology | `a2` (`M1a`) | `a3`+ (`M1b`) |
|---|---|---|---|
| `M1-D1-SPINE` | D1 compose. One control plane, one worker, real PostgreSQL (non-owner `aoa_app` + RLS), MinIO object store over TLS, the reference provider (the `m1-spine` profile, M1 plan §4 `DEP-016`), and the F10 tenant matrix (`DEP-018`) | required | required, fresh |
| `M1a-D2-MECHANISM` | Shipped CI boot (M1 plan F3, `DEP-015`). Control-plane, worker and adapter-manager images are built from source on the candidate, with a CI-generated control-plane keypair. Real E2B, keyed, inside the F8 spend envelope. F10 tenant matrix | required | required, fresh |
| `M1-D2-CODING` | As `M1a-D2-MECHANISM`, plus the tool surface, workspace input, attributable output and credential cases | not consumed | required |
| criterion-5 observation | the live env-absence probe on the distributed stage-in path (`DEP-017`), plus the dormant-egress residual | required | required, fresh |
| DAT-007 Tier-3 evidence | the Linux `verify` shard job on the candidate that runs the `DAT-007-S3` real-PostgreSQL suite. The evidence is the **executed-test count**, not the exit code (E5 plan, `DAT-007-S3` command row) | required | required |

## The seven-clause matrix

The gate, verbatim (`E5-workspaces-secrets/README.md`): *"immutable workspace staging, fenced object
commit, patch conflict quarantine, lease-scoped secrets, redaction, denied egress, and the brokered
internal tool surface (DAT-007) pass in D1."* Clause numbering follows `a1` and
`scripts/gate-clause-wiring.json` (`E5-2`, `E5-3`, `E5-5`, `E5-6`).

A clause whose evidence cannot yet be produced is recorded as **planned and blocked, with the
blocker named**. It is never dropped.

| # | Clause and production path | `proven_in_d1` requires | Per-tenant evidence (F10) | Cross-tenant denial (F10) | `M1a` floor | `M1b` floor | State at freeze (`1cc7e2fdb`) |
|---|---|---|---|---|---|---|---|
| 1 | **Immutable workspace staging**: the DAT-001 manifest producer `buildWorkspaceManifest` (`packages/worker-daemon/src/snapshot/build-manifest.ts`) delivering a frozen `WorkspaceManifestV1` on the lease | The lease for a campaign job carries a workspace manifest built by that producer, and the worker stages from it immutably. The staged-input path (`createStagedInputResolver` / `stageJobInputFiles`, register `E7-1-staged-input-grant` / `-write`, both `wired`) is **adjacent**: on its own it grades at most `proven_weakly` | For each of `T-A` and `T-B`: the staged content the worker used matches that tenant's own manifest/input digest. `T-C`: no distributed lease and no staging | `T-B`'s lease or grant cannot fetch `T-A`'s staged inputs or manifest, and vice versa. Denied, with a same-tenant control | graded; no floor | graded; no floor | **Planned and blocked.** `buildJobEnvelope` (`server/src/services/job-leasing.ts`) sets `workspace: null`. The producer's only production references are its barrel re-exports. **No M1 ticket composes it.** Blocker: an unfiled composition ticket for DAT-001 |
| 2 | **Fenced object commit**. Server half: mint `artifact-transfer-grant.ts`, commit `artifact-commit.ts`, orphan sweep `createSweepTrigger` (DAT-011). Worker half: `createArtifactExportSequencer` (register `E5-2-fenced-object-commit-worker-half`) | Both halves execute in a D1-topology campaign: digest, then mint the upload grant, then export, then commit under a live fence. A stale fence is refused, and the orphan sweep reaches a stranded object. The server half alone grades `proven_weakly` | Per enabled tenant: its committed objects sit under its own Organization and carry its own fence; its orphan sweep reclaims only its own objects | `T-B` cannot commit into `T-A`'s job with `T-B`'s fence, and cannot read `T-A`'s committed outputs. Both denied, with same-tenant controls | graded; no floor (output is exempt at `M1a`: scope-triage §`M1a` entry, the `tools` + `output` subset) | **`proven_in_d1`** (output and artifact integrity are part of `M1-D2-CODING`) | Server half live-proven earlier on the D1 lane (`e6f-05-live-minio`, `e6f-14-orphan-sweep`). The sweep has production callers (`DAT-011-B1`, `complete`). Worker half **`unwired`**, 0 production callers (`check-gate-clause-wiring --counts`). M1 owners: `DAT-009-3c`/`3d`/`3e`, `CLI-012`–`CLI-014` (`M1b`) |
| 3 | **Patch conflict quarantine**: `createPatchApplyService` (register `E5-3-patch-quarantine`). The worker producer is `createResultCommitter` (`E5-result-commit-worker`) | A conflicting patch in a campaign is quarantined and **not promoted**, and the quarantine row is written by the production path | Per enabled tenant: its quarantined output is attributed to its own job and Organization | `T-B` cannot see, promote or apply `T-A`'s quarantined output. Denied, with a same-tenant control | graded; no floor | graded; no floor | **Planned and blocked.** Both symbols **`unwired`**, 0 production callers. Composing the startup reconciler (`WRK-013`) does **not** flip this clause (the register reason says so). No M1 ticket composes `createPatchApplyService`. Blocker: an unfiled composition ticket |
| 4 | **Lease-scoped secrets**: handle mint `execution-secret-handle-mint.ts` (both owner authorities must agree), then worker redemption | A handle is minted for, and redeemed within, one lease and fence in a D1-topology campaign. Redemption after the lease ends, or on a different lease, is refused | Per enabled tenant: its handles are minted and redeemed only under its own lease. `T-C`: no handle is minted | `T-B`'s lease cannot redeem `T-A`'s handle. Denied, not empty, with a same-tenant control | **`proven_in_d1`** (secret redemption is part of the `M1a` journey), plus a `M1a-D2-MECHANISM` observation | **`proven_in_d1`**, plus observations in both D2 partial gates | The mint side is closed with a **placement-side residual** and slice 7 deferred (`E5-F004`, `DAT-008-A1`, `complete`). The residual is recorded as a retained non-certification. It does not block the floor, because the mint is guarded |
| 5 | **Redaction**: `synthesiseRunSecrets` (register `E5-5-redaction`, `wired`) seeds per-run canaries that the supervisor's event sequencer scrubs | In a D1-topology campaign, a planted secret in the run's event and log streams (and, once `WRK-018` lands, the usage/stdout stream) reaches the control plane only as the redaction marker. An unseeded control leaks it verbatim | Per enabled tenant: its own canaries are scrubbed from its own streams | `T-A`'s secret value never appears in `T-B`'s events, logs or cost rows, and `T-B` cannot read `T-A`'s event stream. Denied, with a same-tenant control | **`proven_in_d1`**, plus a `M1a-D2-MECHANISM` observation (zero tolerance, H-04) | **`proven_in_d1`**, plus observations in both D2 partial gates | Wired, 1 production caller. Proven so far only by a planted-leak **in-process** test on both streams (`supervisor-secret-materialization.test.ts`). The stdout channel is `WRK-018` (`M1a`) |
| 6 | **Denied egress**: `createFenceAwareEgressProxy` (register `E5-6-denied-egress`) on the container path. On real E2B, the provider network policy | Metadata, private, worker-control and control-plane destinations are **denied on every execution path the candidate enables** (H-06, including direct-IP, redirect and DNS-rebinding variants) | Per enabled tenant: the tenant's sandbox is refused each H-06 destination | `T-A`'s sandbox cannot reach `T-B`'s worker or its control endpoints | **graded, no `proven_in_d1` claim.** The dormant-egress residual and the credential-taxonomy mitigation must be **recorded** (criterion 5, `DEP-017`) | same as `M1a` | **`unwired`**, 0 production callers. `a1` graded this clause `proven_in_d1` on `e6f-08-egress-isolation`. That test proves docker-network segmentation around a container analog and never touches the symbol or E2B. On E2B, `E8-F003` measured the provider **reaching** IMDS and a non-allowlisted host, and **DE-08 is an accepted residual that leaves H-06 unmet**. Because the M1 candidate enables E2B, this clause **cannot** grade `proven_in_d1` in M1. The attempt must say that `a1`'s basis differs. Blocker: DE-08 (no M1 ticket) |
| 7 | **Brokered internal tool surface (DAT-007)**: the `/mcp` run-currency gate (`createDistributedRunCurrencyResolver`, composed in `server/src/mcp/server.ts`) and the brokered MCP config `brokeredAoaMcpConfig` (dispatch in `heartbeat.ts`) | A distributed run calls tools through the brokered surface in a D1-topology campaign. A stale, replaced or cross-company run is refused at the gate | Per enabled tenant: its run's tool calls are attributed to its own company and run. **A tenant not enabled for tools is denied even while another tenant is enabled** (`CLI-016`, per-Organization tool surface) | `T-A`'s run JWT cannot call tools for `T-B`'s company (the `DAT-007-S3` wrong-company deny case, live). Denied, with a same-tenant control | graded; no floor (tools are exempt at `M1a`). The `DAT-007-S3` Tier-3 evidence is still **required** as a consumed record | **`proven_in_d1`** if the spine profile exercises the brokered surface. Otherwise `proven_weakly`, recorded as a non-certification, and the `M1-D2-CODING` per-tenant observation is **required** | Gate, resolver, `/mcp` mount and boot RLS precondition exist. The Tier-3 deny cases are owed by `DAT-007-S3` (`M1a`). The tool surface is deployment-wide (`AOA_DISTRIBUTED_TOOL_SURFACE_ENABLED`, `server/src/config/distributed-execution.ts`) until `CLI-016` (`M1b`) keys it per Organization |

## Planning-session ruling on clause 1 (F2 delegation, made on PR #534)

The first independent review of `E5-A2-MATRIX` asked whether clause 1 needs an `M1a` floor, because
`scope-triage.md` §`M1a` entry says *"Workspace staging IS required: the `M1a` journey stages input."*
The planning session ruled, under the founder's F2 delegation:

- **Clause 1** (E5's immutable-manifest staging through `buildWorkspaceManifest`) has **no `M1a`
  floor**.
- **`M1a`'s "workspace staging" entry requirement is met by the wired staged-input path**: the
  `stage_files` route and the register entries `E7-1-staged-input-grant` (`createStagedInputResolver`)
  and `E7-1-staged-input-write` (`stageJobInputFiles`), both `wired`.
- `buildJobEnvelope` (`server/src/services/job-leasing.ts`) sets `workspace: null`. **E5's clause 1
  stays an E5 epic-gate gap that M1 does not certify.** An attempt grades it by the clause-1 row above
  (the staged-input path alone is at most `proven_weakly`) and lists it among the retained
  non-certifications.

## Retained full-gate non-certifications

Every attempt restates each of these, whatever its grades:

- E5's exit gate is **not certified** by any M1 attempt, because every M1 partial gate is non-promoting;
- DE-08 leaves H-06 unmet (clause 6);
- the `E5-F004` placement-side residual and deferred slice 7 (clause 4);
- clause 1, E5's immutable-manifest staging, which M1 does not certify (ruling above);
- and every clause graded below `proven_in_d1`, with its blocker and owner.

## Result rule

An attempt's `Result` is `pass` only if **all** of these hold. Otherwise it is `fail`. A correction
is always a new attempt.

1. **R1: complete.** All seven clauses are graded in the vocabulary above. A clause that cannot be
   evidenced is recorded as `planned and blocked` with its blocker named. No clause is dropped.
2. **R2: exact candidate.** Every grade rests on a committed record or a CI job **on the attested
   candidate**, cited by path or by job. Nothing is carried from `a1` or from another candidate.
3. **R3: no over-grade.** Each grade meets its clause's `proven_in_d1 requires` cell, and a grade is
   never higher than its evidence supports.
4. **R4: floors.** Every clause meets the floor for the attempt's milestone (`M1a` for `a2`, `M1b`
   for `a3` and later), and every required observation is present and passing.
5. **R5: tenancy.** Every tenant-scoped observation shows a result for **each** enabled tenant.
   `T-C` is refused. Every cross-tenant case is denied and has its same-tenant positive control.
6. **R6: non-certifications retained.** The attempt lists every retained full-gate
   non-certification above, and it states that E5 is not complete.

## Commands (run by the attempt's author, on a clean detached checkout of the candidate)

| Purpose | Exact command | Evidence |
|---|---|---|
| a1 and every prior attempt untouched | `node scripts/check-evidence-immutability.mjs --base <candidate base> --candidate <candidate sha>` | exit `0`, verbatim `OK` line. `--base` is **required**, because the guard refuses to run without one |
| Clause symbol reachability at the candidate | `node scripts/check-gate-clause-wiring.mjs --counts` | the `E5-*` rows and `createStagedInputResolver` / `stageJobInputFiles` counts, quoted |
| Register citations still resolve | `node scripts/check-register-citation-integrity.mjs` | exit `0` |
| Findings still owned | `node scripts/check-finding-ownership.mjs` | exit `0`; `E5-F00x` statuses quoted |
| This plan unchanged since freeze | `git rev-parse <candidate sha>:docs/replatform/epics/E5-workspaces-secrets/audit-matrix/2026-09-21-e5-seven-clause-matrix.md` | equals the blob SHA recorded in `E5-A2-MATRIX-result.md`, **or** the attempt cites the recorded decision that changed it |
| Campaign records consumed | `git show <candidate sha>:<record path>` for each record in the topology table | each record's `Revision` equals the candidate, and its `Result` is quoted |
| DAT-007 Tier-3 count | read the candidate's Linux `verify` shard job log for the `DAT-007-S3` suite | a non-zero executed-test count, cited by job |

The attempt **consumes** campaign records and runs no campaign itself. Its lane is `D0`.
