# QA Result — D0 — E5 workspaces/secrets exit-gate audit — `7be35ae6b771` — a2

**Date (UTC):** `2026-09-24`
**Epic:** `E5-workspaces-secrets`
**Record path:** `docs/replatform/epics/E5-workspaces-secrets/qa/2026-09-24-d0-e5-exit-gate-audit-7be35ae6b771-a2.md`
**Scope slug:** `e5-exit-gate-audit`
**Revision:** `7be35ae6b7719877e61f54ab552de84de8491e7d`
**Attempt:** `2`
**Supersedes:** `docs/replatform/epics/E5-workspaces-secrets/qa/2026-08-24-d0-e5-exit-gate-audit-a1.md`
**Lane:** `D0`
**Result:** `fail`
**Failure class:** `harness`
**Campaign start (UTC):** `not_applicable` — this attempt runs no campaign; it consumes committed campaign records (frozen matrix §Commands, *"The attempt **consumes** campaign records and runs no campaign itself. Its lane is `D0`."*)
**Campaign end (UTC):** `not_applicable`

> This file is immutable from its first commit. A correction, rerun, changed decision, or changed
> revision creates a higher attempt and links this path through `Supersedes`.

**Author:** the `a2` audit author — a session **distinct** from the M1 planning session that took the
M1 decisions and dispatched the campaigns, and distinct from the sessions that wrote `E5-A2-MATRIX`
and the two consumed campaign records (founder ruling **F2**). This session **dispatched no workflow,
keyed or keyless**, and wrote no milestone handoff.

**This session is NOT the QA owner, and this record is not certified by writing it.** The frozen
plan's §Owners is explicit that the QA owner *"certifies the audit record"* and *"may not be the
session that wrote the audit or that took any decision the audit relies on."* Author and QA owner are
two roles; collapsing them would make this record self-certifying against the very plan it executes.
**Certification is pending, and is owed by a third session** — distinct from the planning session and
from this one. See §0.2.

---

## 0. What this attempt is, and why it exists

This is the `a2` attempt named by `qa-handoff-recovery.md` §4: *"E5's exit-gate audit a1 was committed
and later modified. Treat its observations as historical input only; create a new a2 audit that names
a1 in `Supersedes`, reruns the current candidate, and records the complete seven-clause result."*
`a1` is **not edited**. Its observations are not carried forward; every grade below is measured afresh
at this candidate.

It is also `M1a` **exit criterion 7** (`scope-triage.md:691`, allocation table `:824`): *"a committed
passing **E5 audit attempt for that exact candidate** — `a2` for `M1a`, and `a3` or later for `M1b` —
consuming that milestone's campaign records and retaining every full-gate non-certification."*

**This attempt is `fail`. Criterion 7 is therefore NOT met on this candidate.** The reason is
recorded in §5 and is, in one line: **two of the seven clauses miss their `M1a` floor, both consumed
campaign records carry `Result: fail`, and the frozen plan's R2 command cannot be executed by any
attempt (§5.1).** Three of the six result rules fail — **R2, R4 and R5**. Nothing in the E5 product
misbehaved. The failure class is `harness` throughout — the campaigns did not exercise what the
frozen matrix asks of them.

### 0.1 The frozen plan this attempt executes

The matrix, verdict vocabulary, topology, owners, result rule and commands are **frozen** by ticket
[`../tickets/E5-A2-MATRIX-result.md`](../tickets/E5-A2-MATRIX-result.md) (`Status: complete`,
independently approved at attempt 2). The plan is
[`../audit-matrix/2026-09-21-e5-seven-clause-matrix.md`](../audit-matrix/2026-09-21-e5-seven-clause-matrix.md).
This attempt relaxes no clause, drops no clause, and changes no verdict term.

**Plan unchanged since freeze — verified:**

```
git rev-parse 7be35ae6b7719877e61f54ab552de84de8491e7d:docs/replatform/epics/E5-workspaces-secrets/audit-matrix/2026-09-21-e5-seven-clause-matrix.md
→ 4d8a43a55d760bfa6fe84b91c8854082ea488643
```

That equals the blob SHA recorded in `E5-A2-MATRIX-result.md` §Freeze pin. The plan is the one that
was frozen.

### 0.2 Owners, per ruling F2

| Role | Holder | Constraint discharged |
|---|---|---|
| Decision owner | founder, delegated to the M1 planning session | Takes each decision under the delegation and records it with its reason |
| **Audit author** (this session) | this session | Wrote the record. Took no decision the record relies on; dispatched no workflow; is not the planning session, the `E5-A2-MATRIX` session, or either campaign-record session |
| **QA owner** | ★ **pending — a distinct review session, not yet assigned** | *"It certifies the audit record. It may not be the session that wrote the audit or that took any decision the audit relies on."* **It may therefore be neither the planning session nor this one.** Until that session certifies this record, `a2` is a written attempt, not a certified one |

★ **Why this is spelled out rather than assumed.** The plan gives the QA owner one job — certifying
the audit — and forbids the audit's own author from holding it. An earlier draft of this record named
this session as the QA owner, which would have been self-certification against the plan it executes.
It is corrected here, before the record was ever merged. **It changes no grade and no `Result`:**
certification decides whether this record is accepted, not what it measured.

---

## 1. Candidate

| | |
|---|---|
| **Attested candidate** | `7be35ae6b7719877e61f54ab552de84de8491e7d` |
| Candidate base for the immutability guard | `origin/docs/replatform-program` |
| Tip of `docs/replatform-program` when this attempt was written | `7be35ae6b7719877e61f54ab552de84de8491e7d` — the candidate is the program tip |

The audit reads this revision and nothing else. **Nothing is carried from `a1`** (candidate
`dd8d3c88e`) or from any other candidate (result rule **R2**).

---

## 2. Topology and environment

This record's own lane is `D0`: a documentation audit run against a checkout of the candidate and
against the GitHub API. It deploys nothing. The topologies below are those of the **consumed**
records, restated from them and re-checked against the runs.

| | `M1-D1-SPINE` | `M1a-D2-MECHANISM` |
|---|---|---|
| Run | `35912752449`, `.github/workflows/d1-merge-train.yml`, event `push` | `35920425288`, `.github/workflows/m1-shipped-boot.yml`, event `workflow_dispatch`, `mode: keyed` |
| Run head SHA | `8c01f4e94f8e25d7abaf524e8b266b809c67b8cb` — **one commit before the candidate**; see §2.1 | `7be35ae6b7719877e61f54ab552de84de8491e7d` — **the candidate exactly** |
| Jobs | `d1-merge-train` 17 steps (15 `success`, 2 `skipped`); `m1-spine` 19/19 `success`; `m1-fault-matrix` 18/18 `success` | `shipped-boot` 30/30 `success` |
| Compose / boot | `docker-compose.d1.yml` + `docker/d1/m1-spine.override.yml` | shipped CI boot, three images built from source in-job, CI-generated control-plane keypair |
| Control planes / workers | 1 / **1** (`worker-b`, dispatch enabled) | 2 replicas / **3** (one per Organization) |
| Provider | reference/fake provider — **not E2B** | **real E2B** |
| Tenants (F10) | 3 Organizations: enabled `…0000a`, `…0000b`; control `…0000c` (`off`) | 3 Organizations: enabled `2f6229af-…`, `c7fe6ae6-…`; control `3f09853c-…` (`off`) |
| Enabled-tenant sandboxes | none (no sandbox on this lane) | `icnga1mdlhrayh683vwcl` (a), `iw8yiqpx7b0drx4saibqj` (b) |
| Tool surface | `toolSurfaceArmed false`; `organizationToolSurface` false ×3 | `toolSurfaceEnabled null`; false on all four replica readings |
| Crew switch | `crewEnabled false` | `crewRolloutEnabled "false"` on all four replica readings |
| Keyless rehearsal | — | run `35919374111`, same workflow, same head, `shipped-boot` 30/30 `success` |

> ★ **`E6-F023` discipline applied throughout.** No run conclusion was relied on. Per-job and
> per-step conclusions were read from the jobs API, and the campaign facts come from the consumed
> records' reading of the downloaded evidence artifacts. Concretely: the pull-request run on this
> candidate (`35916221803`) concluded **`failure`** while all four `verify` shards, `policy`,
> `migrations`, `e2e`, `lint`, `brand-check`, `distributed-contract` and both
> `worker-protocol-contract-bytes` jobs concluded `success` — only `ci-required` failed. A run
> conclusion is not a job verdict, in either direction.

### 2.1 The `M1-D1-SPINE` run's revision, re-measured by me

The frozen matrix requires every grade to rest on evidence **on the attested candidate** (R2). The
spine run executed at `8c01f4e94`, one commit before. **I re-measured the delta myself** with
`git rev-parse <rev>:<dir>` at both revisions, rather than adopting the consumed record's table:

| Subtree | `8c01f4e94` | `7be35ae6b` | |
|---|---|---|---|
| `server` | `0f3beb68836583f6e994c93a1cbb4d12633cad51` | same | identical |
| `packages` | `e0c74fc0070eea339d7d21d9fbac16416ea9f51f` | same | identical |
| `ui` | `d21b1b7a26588abd949667fbc70d59a5bb4ba69c` | same | identical |
| `scripts` | `5b37e11ebac822ab9e1d0828c0c4a3124ca85f20` | same | identical |
| `.github` | `9a9cf9a424217e829164bfd41558b7f4aaf91194` | same | identical |
| `docker` | `e765f70c1043ebd9037f72d181e2258ad1bc70bf` | same | identical |
| `tests` | `bfb4fba5a0e7637a7082489cb7096f5c3296fac2` | same | identical |
| `e2b` | `bea90c8907042093a0b52cfca07daac63de9bac6` | same | identical |
| `cli` | `0dd693e752e04eb7513be6628cabae683d592ba3` | same | identical |
| `docs` | `f76b9677ece0f30c442962120649ae9857b69d8a` | `797b608af3e04d4da355e7c49101b4af5aedfcd8` | **differs** |

`git diff --stat` between the two revisions: **1 file changed, 120 insertions(+), 0 deletions(−)** —
`docs/replatform/epics/E6-deployment-test-harness/tickets/DEP-017-result.md`. No root-level file
changed.

**Does this satisfy my matrix?** **Yes, for the E5 clauses, and only because the rule is written
down.** `qa-handoff-recovery.md` §1 permits *"documentation-only disposition commits [to] follow an
independently reviewed implementation revision"* provided *"the QA record must state both and prove
the candidate code is byte-identical where it carries evidence forward."* The table above is that
proof, measured by me: every directory that can change what the D1 lane builds, boots or asserts —
including `docker`, `.github`, `tests` and `scripts`, not merely `server` and `packages` — is
byte-identical. So the lane's behaviour at `8c01f4e94` **is** its behaviour at the candidate.

**Its limits, so nobody widens it:** it holds because the delta is doc-only **and** measured subtree
by subtree. It would not hold for a one-line source change. **And it is not why this attempt fails** —
the failures in §5 are identical had the spine run executed on the candidate exactly.

### 2.2 The consumed records are committed, but not yet merged at this attempt's base

The matrix's command *"Campaign records consumed: `git show <candidate sha>:<record path>`"* cannot
be satisfied literally, and not through anyone's fault: a campaign record is written **after** the
candidate is frozen, so it can never be inside the candidate's own tree. The verifiable form of R2's
requirement — *"a **committed** record … on the attested candidate, cited by path"* — is that the
record be committed and attest the candidate. Both do:

| Record | Path | Commit | Merged at this attempt's base? |
|---|---|---|---|
| `M1-D1-SPINE` a2 | `docs/replatform/milestones/M1a/qa/2026-09-24-m1-d1-spine-m1a-candidate-7be35ae6b771-a2.md` | `f30a0c6a8` (branch `claude/m1a-qa`, **PR #586**, base `docs/replatform-program`) | **no — PR #586 is OPEN** |
| `M1a-D2-MECHANISM` a2 | `docs/replatform/milestones/M1a/qa/2026-09-24-m1a-d2-mechanism-m1a-candidate-7be35ae6b771-a2.md` | `f30a0c6a8`, same PR | **no — PR #586 is OPEN** |

Both carry `Revision: 7be35ae6b7719877e61f54ab552de84de8491e7d`, the candidate exactly. I read both
in full at `f30a0c6a8`. **This is stated, not hidden:** the relative links above resolve once PR #586
merges, and until then they dangle. **This is why result rule R2 is recorded `FAILED`** (§5, §5.1) —
an immutable audit may not rest on an input that is still mutable. **It does not change the
attempt's `Result`, which is `fail` on R4 and R5 independently**, because the two
determinative measurements in §5 — the `M1a-D2-MECHANISM` fault-matrix declaration, and the absence
of any D1 redaction or lease-expiry-refusal case — are read from `tests/d1/fault-matrix.json` **at
the candidate itself**, not from either record's prose. If PR #586 is revised before it merges, the
paths above must be re-checked; a changed consumed record is a changed decision and needs an `a3`.

---

## 3. Commands

Every command was run by **this record's author** (§0.2 — not the QA owner, who certifies and is a
distinct session), on a clean worktree of the candidate at `C:/e5a2`, or against the GitHub API.
**No workflow was dispatched, keyed or keyless.**

| Command | Exit code | Duration | Result summary |
|---|---:|---:|---|
| `git rev-parse 7be35ae6b77…:docs/replatform/epics/E5-workspaces-secrets/audit-matrix/2026-09-21-e5-seven-clause-matrix.md` | `0` | <1 s | `4d8a43a55d760bfa6fe84b91c8854082ea488643` — equals the pin in `E5-A2-MATRIX-result.md`. **The plan is unchanged since freeze** |
| `node scripts/check-gate-clause-wiring.mjs --counts` @ candidate | `0` | ~20 s | `createArtifactExportSequencer` **1**; `createFenceAwareEgressProxy` **0**; `createPatchApplyService` **0**; `createResultCommitter` **0**; `createStagedInputResolver` **1**; `stageJobInputFiles` **2**; `synthesiseRunSecrets` **1**. ★ The first of these was **0** at freeze — see §4.1 |
| `node scripts/check-gate-clause-wiring.mjs` @ candidate | `0` | ~2 s | `OK (28 wired clause(s), 6 declared dormant …)`; dormant set includes `E5-3-patch-quarantine`, `E5-6-denied-egress`, `E5-result-commit-worker` |
| `node -e` over `scripts/gate-clause-wiring.json` for every `E5-*` and staged-input entry | `0` | <1 s | `E5-2-fenced-object-commit-worker-half` **`wired`**; `E5-5-redaction` `wired`; `E7-1-staged-input-grant`/`-write` `wired`; `E5-3-patch-quarantine`, `E5-result-commit-worker`, `E5-6-denied-egress` **`unwired`** |
| `node scripts/check-register-citation-integrity.mjs` | `0` | ~15 s | `397 enforced … citations checked`; `PASS` |
| `node scripts/check-finding-ownership.mjs` | `0` | ~3 s | `OK (94 open finding(s) across 12 register(s))`; open and `UNOWNED`: `E5-F002`–`E5-F008` |
| `grep -n "workspace: null" server/src/services/job-leasing.ts` | `0` | <1 s | **`524: workspace: null,`** — `buildJobEnvelope` puts no manifest on the lease |
| `grep -rn createArtifactExportSequencer --include=*.ts packages server \| grep -v test` | `0` | <1 s | definition, barrel re-export, and **one real caller**: `packages/worker-daemon/src/lifecycle/dispatch-runtime.ts:275` |
| `gh run view 35920425288 --json headSha,conclusion,event,jobs` | `0` | <5 s | head `7be35ae6b77…`, `workflow_dispatch`, job `shipped-boot` `success`, **30 steps** |
| `gh run view 35919374111 --json …` (keyless rehearsal) | `0` | <5 s | same workflow, `shipped-boot` `success` |
| `gh run view 35912752449 --json headSha,conclusion,event,jobs` | `0` | <5 s | head `8c01f4e94f8e…`, `push`; `d1-merge-train` `success` (15 success / 2 skipped), `m1-spine` 19/19, `m1-fault-matrix` 18/18 |
| `git rev-parse <rev>:<dir>` for `server packages ui scripts .github docker tests e2b cli docs` at `8c01f4e94` and `7be35ae6b` | `0` | <1 s | 9 identical, `docs` differs — §2.1 |
| `git diff --stat 8c01f4e94… 7be35ae6b…` | `0` | <1 s | 1 file changed, 120 insertions(+) — `DEP-017-result.md` |
| `gh run list --commit 7be35ae6b77… --json databaseId,workflowName,conclusion,event` | `0` | <5 s | 4 runs; the `pull_request` run `35916221803` concluded **`failure`** while every job except `ci-required` concluded `success` (§2) |
| `gh run view 35916221803 --log --job 107368345308` (job **`verify (4)`**), grepped for the DAT-007-S3 suite | `0` | ~60 s | `✓ @armyofagents/server src/__tests__/distributed-run-currency.integration.test.ts (**14 tests**) 3224ms`; shard total `Test Files 663 passed (663)`. **Non-zero executed count — clause 7's required Tier-3 record** |
| `node -e` listing every `tests/d1/fault-matrix.json` case id and `evidence` per profile, @ candidate | `0` | <1 s | `M1-D1-SPINE` **28** cases (25 required, 3 `pending`); `M1a-D2-MECHANISM` **23** cases, **23 `pending`, 0 required**; `M1-D2-CODING` 23, all `pending`. **No case in any profile names redaction, a canary, a workspace manifest, patch quarantine, or lease-expiry secret refusal** |
| `grep -n '^\*\*Status:\*\*' …/E4-worker-daemon/tickets/WRK-018-result.md` | `0` | <1 s | `gate_review` — the stdout/usage redaction channel the matrix names is not dispositioned at the candidate |
| the pure-node `pr.yml` guards from the M1 agent rules (every `node scripts/check-*.mjs` in `pr.yml` except the six the rules exclude) | `0` each | ~3 min | **`ran: 41  failures: 0`.** ★ **41, not the 38 that `E5-A2-MATRIX-result.md` and the M0-era records cite.** `pr.yml` names **47** distinct such guards at this candidate, up from 44 at the freeze revision `1cc7e2fdb`; 47 − 6 = 41. Those records are correct for the revision each measured and are not edited. A reader comparing the two must re-count at their own candidate |
| `node scripts/check-evidence-immutability.mjs --base origin/docs/replatform-program --candidate HEAD` | `0` | ~2 s | `OK: 33 base records … all present and byte-identical in the candidate (HEAD, 34 records); 1 candidate commit(s) walked, and no record introduced by one of them was rewritten or removed by a later one` |

---

## 4. The seven-clause result

Verdict vocabulary, unchanged from `a1` and from the frozen matrix: `proven_in_d1` /
`proven_weakly` / `not_proven`.

| # | Clause | `M1a` floor | Grade at `7be35ae6b` | Floor | Basis, and the blocker where one exists |
|---|---|---|---|---|---|
| 1 | Immutable workspace staging (`buildWorkspaceManifest`) | graded; no floor | **`proven_weakly`** | **met** | The clause's own producer receives **zero** evidence: it has no production caller, and `buildJobEnvelope` sets `workspace: null` (`server/src/services/job-leasing.ts:524`, measured). The grade rests entirely on the **adjacent** staged-input path, which the matrix caps at `proven_weakly`: `createStagedInputResolver` 1 caller, `stageJobInputFiles` 2, both register entries `wired`, and the `M1a-D2-MECHANISM` journey staged input per enabled tenant on real E2B. Cross-tenant staged-input denial is proven on D1 only (`d1.tenant.cross.staged_inputs`, 409 with a 200 same-tenant control); `d2m.tenant.cross.staged_inputs` is `pending`. **Blocker: no M1 ticket composes the DAT-001 manifest producer.** Planning-session ruling (matrix §Clause-1 ruling) stands: `M1a`'s staging entry requirement is met by the staged-input path, and E5's clause 1 is an epic-gate gap M1 does not certify |
| 2 | Fenced object commit | graded; no floor (output exempt at `M1a`) | **`proven_weakly`** | **met** | **Server half proven on this candidate's D1 lane**: `d1.fault.object_store.truncated_upload` → `fenced_commit_refuses_unverifiable_object`; `d1.cleanup.orphan_object_swept` → `uncommitted_object_deleted`; `d1.tenant.cross.outputs` denied `409` with a `200 committed` same-tenant control. **Worker half not exercised anywhere**: `capabilityProven false`, `workspacePatchArtifacts 0`, `taskOutputs 0` on both enabled tenants. Per the matrix, *"The server half alone grades `proven_weakly`."* ★ The worker half's symbol is now **wired** — see §4.1 |
| 3 | Patch conflict quarantine (`createPatchApplyService`) | graded; no floor | **`not_proven`** | **met** | `createPatchApplyService` **0** production callers, `createResultCommitter` **0**; `E5-3-patch-quarantine` and `E5-result-commit-worker` both `unwired` and declared dormant. **No campaign profile declares a quarantine case at all.** No evidence reaches the production path. **Planned and blocked. Blocker: no M1 ticket composes `createPatchApplyService`** |
| 4 | Lease-scoped secrets | **`proven_in_d1`** + an `M1a-D2-MECHANISM` observation | **`proven_weakly`** | ★ **UNMET** | The mechanism observation is **present and passing**: `credentialAuthority "company_api_key"` for all three Organizations, `redeemedNames ["ANTHROPIC_API_KEY"]` per enabled tenant, on real E2B. But `proven_in_d1` also requires that *"Redemption after the lease ends, or on a different lease, is refused"* **in a D1-topology campaign**, and the `M1-D1-SPINE` profile declares **no such case**: its only credential case, `d1.credential.production_reader_company_predicate`, is `pending`, and the one cross-tenant secrets arm that did fire concedes in its own record that *"the fenced route collapses every refusal to denied/malformed by design and this lane's fixture handle is unresolvable, so owner and attacker are indistinguishable here and **the arm carries no control**."* A denial without a control is not a denial (R5). **Blocker: no declared D1 lease-expiry / wrong-lease redemption-refusal case.** Retained residual: `E5-F004` (placement-side, slice 7 deferred) |
| 5 | Redaction (`synthesiseRunSecrets`) | **`proven_in_d1`** + an `M1a-D2-MECHANISM` observation (zero tolerance, H-04) | **`proven_weakly`** | ★ **UNMET** | `synthesiseRunSecrets` is `wired`, 1 production caller. **But no campaign on this candidate plants a secret and checks the streams.** I enumerated every case id in all three profiles of `tests/d1/fault-matrix.json` at the candidate: **not one names redaction, a canary, or a planted leak**, and the `M1-D1-SPINE` profile has no redaction case of any kind. The mechanism lane's *"Scan the evidence AND the job log for job secrets"* step is a **CI scrub of the uploaded bundle**, not the clause's path: it does not seed per-run canaries through `synthesiseRunSecrets`, does not read the supervisor's scrubbed event stream, and has **no unseeded control** proving an unseeded run would leak verbatim. So the clause's only evidence remains the in-process `supervisor-secret-materialization.test.ts` — exactly where the matrix recorded it at freeze. The stdout/usage channel is `WRK-018`, whose result is `Status: gate_review` at the candidate. **Blocker: no declared planted-leak case with an unseeded control on either M1a lane** |
| 6 | Denied egress (`createFenceAwareEgressProxy`) | graded, **no** `proven_in_d1` claim; the DE-08 residual and the credential-taxonomy mitigation **recorded** | **`not_proven`** | **met** | `createFenceAwareEgressProxy` **0** production callers; `E5-6-denied-egress` `unwired`. On the path this candidate **enables** — real E2B — the mechanism record measured `169.254.169.254` `reachable: true`, `httpStatus 401`. That is the vocabulary's second `not_proven` arm exactly: *"a committed measurement shows the clause failing on a path the candidate enables."* The floor is a **recording** requirement, and both records discharge it: the DE-08 residual is recorded in each, and the credential-taxonomy mitigation is enforced by a live 18-class env-absence probe with a **red positive control** (three planted canaries, each detected as its expected class). ★ **`a1` graded this clause `proven_in_d1`; that basis differs and does not transfer** — `e6f-08` proves docker-network segmentation around a container analog, never touches the symbol, and never touches E2B. **`H-06` is NOT passed. Blocker: DE-08, no M1 ticket** |
| 7 | Brokered internal tool surface (DAT-007) | graded; no floor (tools exempt at `M1a`); the `DAT-007-S3` Tier-3 record **required** as a consumed record | **`proven_weakly`** | **met** | **The required Tier-3 record is present and passing on the candidate**: PR run `35916221803`, job **`verify (4)`** (`107368345308`), `src/__tests__/distributed-run-currency.integration.test.ts` — **14 tests**, passed, in a shard reporting `663 passed (663)`. It is real CI evidence against real PostgreSQL through the real resolver, including the cross-Organization deny cases with same-tenant admit controls. **But no distributed run called tools in any campaign**: the surface is off on every replica of both lanes (`toolSurfaceArmed false`; `organizationToolSurface` false ×3; `toolSurfaceEnabled null` on all four mechanism replica readings), and `d2m.tenant.cross.tool_calls` is `pending`. The production path is not exercised in a D1-topology campaign — the vocabulary's definition of `proven_weakly` |

**Score: 0 of 7 clauses `proven_in_d1`. 5 `proven_weakly` (clauses 1, 2, 4, 5, 7). 2 `not_proven`
(clauses 3, 6). Two clauses miss their
`M1a` floor.** For comparison, and as history only: `a1` recorded 2 `proven_in_d1`, on a different
candidate, and one of those two (clause 6) is now measurably wrong for the path this candidate
enables.

### 4.1 One state change since the freeze, recorded rather than absorbed

The matrix's *State at freeze (`1cc7e2fdb`)* column recorded `createArtifactExportSequencer` at
**0** production callers and `E5-2-fenced-object-commit-worker-half` as **`unwired`**. At the
candidate both have changed: the count is **1**, the caller is
`packages/worker-daemon/src/lifecycle/dispatch-runtime.ts:275`, and the register entry is
**`wired`**. The matrix says a column labelled *State at freeze* is correctly historical and *"an
attempt re-measures at its own candidate"*; this is that re-measurement.

**It changes no grade.** Wiring is reachability, not proof. Clause 2's worker half was still not
exercised by any campaign on this candidate (`workspacePatchArtifacts 0`, `taskOutputs 0`,
`capabilityProven false`), so the clause stays at the server half's ceiling, `proven_weakly`. It is
recorded because a reader comparing this record to the frozen matrix would otherwise find a
discrepancy and have to guess which is stale.

---

## 5. The result, against the frozen result rule

The matrix's result rule: *"An attempt's `Result` is `pass` only if **all** of these hold. Otherwise
it is `fail`."*

| Rule | Verdict | Why |
|---|---|---|
| **R1 — complete** | **met** | All seven clauses graded in the frozen vocabulary. Clauses 1, 3, 4, 5 and 6 carry named blockers. No clause dropped, none relaxed |
| ★ **R2 — exact candidate** | **FAILED** | The frozen command requires each consumed campaign record to be readable with `git show <candidate sha>:<record path>`. **Neither is** — both are committed only on the open PR #586 (§2.2). An earlier draft of this record marked R2 *met* on the rule's intent, arguing the literal command is unsatisfiable by construction. That argument is sound (§5.1) **and it is not a discharge**: a rule is not met by explaining why it cannot be. Marking it met would also have rested this immutable record on an input that is still mutable — PR #586 may be revised or may not merge. **R2 fails, fail-closed.** What *is* verified, and stands on its own: every measurement in §4 was taken at the candidate, the mechanism run's head **is** the candidate, the spine run is a doc-only delta with all nine code-bearing subtrees byte-identical (re-measured by me), and the Tier-3 count is from a job on the candidate |
| **R3 — no over-grade** | **met** | No grade exceeds its clause's `proven_in_d1 requires` cell. In particular clause 6 is not softened by the credential-taxonomy probe, and clause 2 is not lifted by the worker half's new wiring |
| ★ **R4 — floors** | **FAILED** | **Clause 4** and **clause 5** are floored at `proven_in_d1` for `M1a` and both grade `proven_weakly`. Separately, R4 requires *"every required observation is present and passing"*, and **both consumed campaign records carry `Result: fail`** — `M1-D1-SPINE` a2 (two required cases unrun without a valid reason; no `MIG-009` rollback rehearsal) and `M1a-D2-MECHANISM` a2 (all 23 declared cases `pending`, 0 fired) |
| ★ **R5 — tenancy** | **FAILED** | The `M1a-D2-MECHANISM` lane declares **nine** `d2m.tenant.cross.*` cases and **every one is `pending`**; its own evidence reports `providerEvidence.rejected = {shape: 0, foreignLease: 0}` — zero rejections, because no hostile attempt was made. Its only cross-tenant observation is that each sandbox id appears in its own worker's log: a separation *observation*, not a *denial*. And on D1, clause 4's cross-tenant secrets arm carries **no positive control** by its own admission. The rule requires every cross-tenant case to be denied **and** controlled |
| **R6 — non-certifications retained** | **met** | §6 |

**`Result: fail`. Failure class `harness`. Three of the six rules fail: R2, R4 and R5.**

The class is `harness` and not `product` for a reason worth stating: **nothing in the E5 code
misbehaved in either campaign.** Every failure above is a case the campaigns do not run — either
never declared (redaction, lease-expiry refusal, patch quarantine), or declared and left `pending`
(all 23 mechanism cases) — or, for R2, a plan command that cannot be executed. `blocked_external`
does not apply: both campaigns started and completed, keyed E2B was available and was used, and no
HARD invariant was waived.

### 5.1 A defect in the frozen plan, recorded for the decision owner — not repaired here

R2's command is *"`git show <candidate sha>:<record path>` for each record in the topology table."*
**No attempt can ever satisfy it.** A campaign record is written *after* its candidate is frozen, so
it can never be inside that candidate's own tree — not for `a2`, not for `a3`, not for any successor.
The rule's evident intent (evidence must attest the candidate, and nothing may be carried from
another candidate) is achievable and is met; its stated command is not.

**This record does not repair it.** The plan is frozen at blob `4d8a43a55d76…`, and changing it needs
*"its own recorded decision"* by the decision owner (matrix header). An audit that quietly reinterpreted
a frozen command to reach a `pass` would be doing exactly what this programme's records keep failing
at. So R2 is recorded `FAILED` and the defect is handed to the decision owner, who has two clean
options:

- **(a)** amend the plan, by recorded decision, so R2's command reads *"the record is committed, its
  `Revision` field equals the candidate, and it is an ancestor of the attempt's own commit"* — which
  is checkable, and which `a3` could then satisfy; or
- **(b)** leave the command as written and accept that R2 fails in every attempt, which makes R2
  inert.

**(a)** is this author's recommendation. Either way it is a decision, not a QA judgement, and **it
does not change this attempt's `Result`**: R4 and R5 fail on their own measured merits (§4, clauses 4
and 5), and would fail identically had R2 been discharged.

**A note on what this `fail` is not.** It is not a claim that the E5 work is weak. The staged-input
path, the fenced server-half commit, the D1 tenant isolation set and the `DAT-007-S3` Tier-3 suite
are real, substantive, CI-run evidence measured on this exact candidate, and §4 retains each at full
strength. **A successor attempt on THIS EXACT REVISION may carry them forward; an `M1b` attempt may
not.** ★ *Stated precisely, because the shorthand "a future `a3`" is wrong in the case the index
allocates:* `qa/README.md` §Planned attempts allocates `a3` **to the `M1b` candidate, a different
revision**, which must consume fresh `M1b` campaign records and may carry nothing from here — doing
so would itself breach R2. A corrected `M1a` attempt would also be numbered `a3` under the same
index, and only that one may carry these measurements. Two clauses are short of their floor, and a
`pass` would have had to argue past that.

---

## 6. Retained full-gate non-certifications

Restated in full, as the frozen matrix requires of every attempt whatever its grades:

1. **E5's exit gate is NOT certified by this or any M1 attempt.** All three M1 partial gates are
   **non-promoting** (`scope-triage.md` §Normative-gate boundary). **E5 is not complete.** No grade
   in this record completes an epic, and none may be cited as a D1 pass.
2. **DE-08 leaves `H-06` unmet** (clause 6). `H-06` requires metadata, private, worker-control and
   control-plane destinations to remain denied, **including direct-IP, redirect and DNS-rebinding
   variants**. The DE-08 scope decision did not amend it. On this candidate the metadata destination
   was measured **reachable** from a real sandbox, and the other destinations and variants were not
   probed. **No sandbox-egress-denial claim is made anywhere in this record, and none may be derived
   from it.**
3. **The `E5-F004` placement-side residual and deferred slice 7** remain open (clause 4). `E5-F002`
   through `E5-F008` are all open and `UNOWNED` on the register, measured at the candidate.
4. **Clause 1 — E5's immutable-manifest staging — is an E5 epic-gate gap that M1 does not certify**
   (the planning session's recorded ruling under F2).
5. **Every clause graded below `proven_in_d1`, with its blocker and owner** — that is **all seven**,
   itemised in §4: clause 1 (no DAT-001 composition ticket), clause 2 (worker half unexercised;
   `M1b` owners `DAT-009-3c/3d/3e`, `CLI-012`–`CLI-014`), clause 3 (no composition ticket for
   `createPatchApplyService`), clause 4 (no declared D1 lease-expiry refusal case), clause 5 (no
   declared planted-leak case with an unseeded control), clause 6 (DE-08, no M1 ticket), clause 7
   (surface off on both lanes; `CLI-016` keys it per Organization at `M1b`).

---

## 7. What this record does NOT establish

Stated plainly, because a reader's most likely error is to over-read the five `proven_weakly` grades.

1. **No clause of the E5 exit gate passes in D1 on this candidate.** Zero `proven_in_d1`.
2. **No redaction evidence of any kind exists on either M1a lane.** The mechanism lane's secret-scan
   step protects the *evidence bundle*; it says nothing about whether the supervisor scrubs a run's
   event or log streams, and there is no unseeded control.
3. **No lease-expiry or wrong-lease secret-redemption refusal was ever attempted** on this candidate.
4. **No cross-tenant denial was attempted on real E2B at all.** Every hostile case on the mechanism
   gate is `pending`. Cross-tenant denial is proven **only** on the keyless reference-provider D1
   lane, and there the secrets arm has no control.
5. **No priced cost row on real E2B.** `costEventsForRun: 0`, `costUsd: null` on both enabled
   tenants. ★ **`E3-F037` is NOT closed by this record or by the run it consumes.** The 83-cent
   `cost_events` rows on the spine lane are the **reference** provider — a different claim about a
   different provider, and the two must not be reconciled with each other.
6. **No operator-visible audit signal on the mechanism lane** (`jobSubmitted: []`,
   `securityDenials: []`).
7. **Nothing about output capture.** `capabilityProven: false` throughout — which is a **PASS for
   `M1a` by the triage's own terms** and is not among this record's failures — but it means clause 2's
   worker half, `E7-F018` and `CLI-008` Unit F are untouched by this evidence.
8. **Nothing about tools in production.** The brokered surface was off on every replica of both
   lanes. Clause 7's grade rests on a Tier-3 suite, not on a live brokered call.
9. **No sandbox teardown is evidenced** (`H-09` not evidenced), and legacy-path health for the
   control tenant is not observed — refusal is proven, health is not.
10. **This record decides nothing, and certifies nothing.** It is the author's audit, and it is
    **not yet certified** — that is the QA owner's act, and the QA owner is a distinct session that
    has not yet held it (§0.2). Whether `M1a` proceeds, and how, is the decision owner's call under
    F2.

---

## 8. Cleanup

This attempt deployed nothing, created no sandbox, spent nothing and dispatched no workflow. The
temporary worktree used to run the commands in §3 is removed after the record is committed. No
secrets appear in this record; the identifiers quoted are run, job, blob, commit, sandbox and
Organization ids already present in public CI evidence or in git.

---

## 9. Gate effect

- **Blocks `M1a` exit criterion 7** on candidate `7be35ae6b7719877e61f54ab552de84de8491e7d`.
  Criterion 7 requires *a committed **passing** E5 audit attempt for that exact candidate*; this
  attempt is `fail`.
- **Promotes nothing, and completes nothing.** `D0`, non-promoting. It does not complete `E5`, does
  not change any epic's status, and cannot support an epic-completion handoff.
- **Retains at full strength** every measurement in §4. An `a3` on this exact revision may carry them
  forward.
- **Supersedes `a1`** and discharges `qa-handoff-recovery.md` §4's first named breach: the `a1`
  immutability breach is repaired in provenance, **not erased**. `a1` stays exactly as committed, and
  its observations remain historical input only.
- **Does not disposition any ticket.** Measured at the candidate by reading each result's status
  line: **`DEP-017` and `WRK-018` carry `Status: gate_review`**, so exit criterion 1 is unmet until a
  distinct reviewer dispositions them. **`DEP-015` does NOT** — it carries `Status: complete`, set by
  the distinct reviewer of attempt 2 and re-affirmed 2026-09-23 by the reviewer of attempt 3. ★ *An
  earlier draft of this record listed `DEP-015` with the other two as `gate_review`. That was adopted
  from a consumed campaign record's prose instead of read at the candidate — this programme's
  records-disagreeing-with-code class, committed inside an audit whose job is to catch it. Corrected
  before merge, by reading the file.* Dispositioning is a distinct reviewer's act and not this
  author's in any case.

### 9.1 What a passing `a3` would need on this candidate

Only clauses 4 and 5 are short of the `M1a` floor. Both gaps are **declaration-and-harness** gaps, not
build gaps — the production symbols are wired and the lanes exist:

1. **Clause 5.** Declare a planted-leak case on `M1-D1-SPINE` that seeds a canary through
   `synthesiseRunSecrets`, asserts the marker in the run's event **and** log streams, and carries an
   **unseeded control that leaks the value verbatim**. A control that cannot go red is not a control.
   This is **keyless** — the spine lane costs nothing.
2. **Clause 4.** Declare a D1 case that redeems a handle after its lease ends, and one that redeems it
   on a different lease, each refused, each with a same-tenant positive control; and give the
   cross-tenant secrets arm a control that distinguishes owner from attacker, which its own record
   says it currently cannot. Also **keyless**.
3. **R4/R5.** Both consumed campaign records must themselves reach `Result: pass` — which, per their
   own §9.1/§11.1, needs the two wrongly-excused spine cases run (keyless), the `MIG-009` rollback
   rehearsal recorded (keyless), and a fault-matrix step added to `m1-shipped-boot.yml` followed by
   **one** keyed run under the F8 envelope.
4. **R2.** The decision owner rules on §5.1 — option (a), amending the frozen command by recorded
   decision so that it is executable, or option (b), accepting that R2 fails in every attempt. Until
   one is recorded, `a3` fails R2 exactly as this attempt does, whatever else it proves.
5. **Certification.** `a3` is certified by a **QA owner distinct from its author** and from the
   planning session (§0.2) — the role this attempt records as pending.
6. File `a3` with `Supersedes` naming this path, against whatever candidate is then frozen.

**Nothing in items 1 and 2 requires E2B spend.** The `M1a` E5 floor gap is, in full, two declared
cases on a lane that already boots.
