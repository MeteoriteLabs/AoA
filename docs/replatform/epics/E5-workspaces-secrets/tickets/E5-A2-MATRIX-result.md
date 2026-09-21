# E5-A2-MATRIX Result — freeze the seven-clause audit matrix, commands, topology and owners

**Status:** `gate_review`
**Date (UTC):** `2026-09-21`
**Epic:** `E5-workspaces-secrets`
**Plan task:** `E5 implementation-plan E5-A2-MATRIX — freeze the seven-clause audit matrix (S, ≤2 agent-days, M0)`; M1 plan §3 unit `S0-6`
**Implementer:** `M1 S0-6 unit session (Claude Opus 5)`
**Start SHA:** 1cc7e2fdba42282ebecca04dde14246e543037cf

The implementer leaves `Status` at `gate_review`. A separate reviewer completes the section below and is the only role that may change it to `complete`.

This file is a controlled append-only review ledger until `complete`; do not delete or rewrite prior review attempts. Once `complete`, it is frozen. Ticket commands are focused acceptance evidence, not the immutable epic D0 rollup.

## Delivered scope

- **The frozen audit plan** is its own file,
  [`../audit-matrix/2026-09-21-e5-seven-clause-matrix.md`](../audit-matrix/2026-09-21-e5-seven-clause-matrix.md),
  which holds nothing but the plan. It contains:
  - the owners;
  - the unchanged `a1` verdict vocabulary;
  - the exact topology, including the F10 tenant set;
  - the consumed campaign records per attempt;
  - the seven-clause matrix, with per-tenant evidence and cross-tenant denial for each clause, an
    `M1a` floor and an `M1b` floor, and a measured state at freeze;
  - the planning session's ruling on clause 1 (below);
  - the retained non-certifications;
  - a six-part result rule;
  - the exact commands.
- **One plan for both attempts.** `a2` attests the `M1a` candidate. `a3` or later attests the `M1b`
  candidate and links through `Supersedes`.
- **Freeze pin.** At freeze, the matrix file's git blob SHA is
  **`4d8a43a55d760bfa6fe84b91c8854082ea488643`**. Every attempt verifies it with exactly:

  ```
  git rev-parse <candidate sha>:docs/replatform/epics/E5-workspaces-secrets/audit-matrix/2026-09-21-e5-seven-clause-matrix.md
  ```

  The output must equal the pinned SHA. The pin covers that file only. The records index and the
  planned-attempts table stay in [`../qa/README.md`](../qa/README.md), **outside** the pin, so
  filing and indexing `a2` never changes the pinned blob.
  ★ *Corrected 2026-09-21 after review attempt 1 (`changes_requested`), by the planning session's
  ruling under F2. Superseded text: "At freeze, the `qa/README.md` git blob SHA is
  **`f6b95d51cc8b96277363f34484bffdfb74867389`**. Every attempt compares the candidate's blob with
  this SHA (the plan's "This plan unchanged since freeze" command)." That pinned the whole README,
  which is also the records index, so the check would have failed at every attempt from `a3` on.*
- **Clause-1 ruling (planning session, F2, made on PR #534), recorded in the matrix file.** Clause 1
  (E5's immutable-manifest staging through `buildWorkspaceManifest`) has **no `M1a` floor**. `M1a`'s
  "workspace staging" entry requirement is met by the wired staged-input path (`stage_files`,
  `E7-1-staged-input-grant` / `-write`). `buildJobEnvelope` sets `workspace: null`, and E5's clause 1
  stays an E5 epic-gate gap that M1 does not certify.
- **Owners (F2).**
  - Decision owner: **founder (delegated to the M1 planning session)**.
  - QA owner: **a distinct review session, never the deciding session**.
- **Topology (F10).** The topology requires at least three Organizations:
  - `T-A` and `T-B`, enabled through `AOA_DISTRIBUTED_EXECUTION_ROLLOUT`;
  - `T-C`, not enabled, as the control.

  Each clause states its per-tenant evidence. Each clause that is about isolation also states a
  cross-tenant denial, which must be denied (not merely empty) and needs a same-tenant positive
  control.

**Non-goals preserved:**

- `a2` is not written.
- `a1` is not touched in any commit of this branch.
- No clause is relaxed.
- H-06 is not marked passed.
- No file under `qa/` other than `README.md` is created. The attempt records are filed at their
  campaigns. The matrix file is outside `qa/`, so `EVIDENCE_RECORD_RE` does not treat it as an
  evidence record.

## Changed files

| File | Responsibility |
|---|---|
| `docs/replatform/epics/E5-workspaces-secrets/audit-matrix/2026-09-21-e5-seven-clause-matrix.md` | New (review attempt 1 fix). The frozen plan, moved out of `qa/README.md` unchanged in substance, plus the pin statement with its exact command and the clause-1 ruling. This is the pinned file |
| `docs/replatform/epics/E5-workspaces-secrets/qa/README.md` | New in `299dca66e`, and now the **index only**: the E5 audit records and the planned-`a2`/`a3+` entries, pointing to the matrix file. `README.md` is excluded from the immutable set (`EVIDENCE_RECORD_RE`, `scripts/check-evidence-immutability.mjs`) |
| `docs/replatform/epics/E5-workspaces-secrets/tickets/E5-A2-MATRIX-result.md` | This result |

## Acceptance evidence

| Acceptance condition | Evidence | Result |
|---|---|---|
| Dependencies `DAT-011-B1`, `TRACK-001-B1`, `DAT-008-A1` have complete results | Each result's top-level `**Status:** \`complete\``. Approved by distinct reviewers: `DAT-011-B1` attempt 4, `TRACK-001-B1` attempt 1, `DAT-008-A1` attempt 1 | `pass` |
| Per-clause verdict criteria, in `a1`'s vocabulary, unchanged | matrix file §Verdict vocabulary and the `proven_in_d1 requires` column | `pass` |
| Exact commands and topology | matrix file §Exact topology and §Commands. Every command names its revision explicitly, and the immutability command carries `--base` | `pass` |
| QA owner and decision owner named (F2) | matrix file §Owners | `pass` |
| Multi-tenant (F10): per-tenant evidence, plus cross-tenant denial where the clause is about isolation | the matrix's two F10 columns, filled for all seven clauses. Result rule R5 | `pass` |
| A clause that cannot be evidenced is planned and blocked with the blocker named, never dropped | Clauses 1, 3 and 6 carry named blockers. Result rule R1 | `pass` |
| Frozen for both attempts | `qa/README.md` §Planned attempts, and the matrix file's "One plan for every attempt" | `pass` |
| The pin survives filing an attempt (review attempt 1) | The pinned blob is the matrix file's, and the index lives in `qa/README.md`. Checked by simulation: appending an `a2` row to `qa/README.md` in the working tree leaves `git hash-object` of the matrix file at `4d8a43a5…` (see Commands) | `pass` |
| `a1` untouched in every commit of this branch (GREEN) | see Commands | `pass` |
| RED positive control, in a disposable fixture only | see Commands and Deviations | `pass` |

### State at freeze: measured at `1cc7e2fdb`, by symbol

- **Wiring counts.** `node scripts/check-gate-clause-wiring.mjs --counts` reports:
  - `createArtifactExportSequencer`, `createFenceAwareEgressProxy`, `createPatchApplyService` and
    `createResultCommitter`: **0** production callers each;
  - `synthesiseRunSecrets`: **1**;
  - `createStagedInputResolver`: **1**;
  - `stageJobInputFiles`: **2**.
- **No workspace on the lease.** `buildJobEnvelope` in `server/src/services/job-leasing.ts` builds
  the lease with `workspace: null` (about `:524`).
- **`buildWorkspaceManifest` has no production caller.** Its non-test references are its definition,
  the barrel re-exports (`snapshot/index.ts`, `worker-daemon/src/index.ts`) and a doc comment in
  `git-runner.ts`. No gate-clause entry names it.
- **Denied egress.** The `E5-6-denied-egress` register reason records two facts. First, `e6f-08`
  proves docker-network segmentation around a container analog and never touches
  `createFenceAwareEgressProxy`. Second, `E8-F003` measured E2B reaching IMDS and a non-allowlisted
  host.
- **DAT-007 gate.** The run-currency gate is composed in `server/src/mcp/server.ts`: the
  `createDistributedRunCurrencyResolver` default, and the guard
  `distributedExecutionEnabled && protocolActor.source === "agent" && req.actor.signedRunId`.
- **Tool-surface flag.** The tool surface is deployment-wide:
  `DISTRIBUTED_TOOL_SURFACE_ENABLED_ENV = "AOA_DISTRIBUTED_TOOL_SURFACE_ENABLED"` in
  `server/src/config/distributed-execution.ts`.
- **Rollout policy.** The per-Organization rollout policy is `DISTRIBUTED_EXECUTION_ROLLOUT_ENV` in
  `server/src/config/distributed-execution-rollout-source.ts`.

## Commands

| Command | Exit code | Result summary |
|---|---:|---|
| **RED (positive control), in a disposable fixture repo at `C:/e5fx`, since deleted.** Base commit `0e007ad42d7dec35932ff33871e2757d83b63673` holds `docs/replatform/artifact-policy.md` and a byte-identical copy of `a1` (blob `eb9186f7114d9f3551e55b00c4f6bf4bf38f47b0`, the same blob as this repo). Candidate commit `eb6992048a30096e8d2f316821202f3ff9c18d05` appends one line to that copy. The guard and its one import (`check-distributed-execution-foundation.mjs`) were copied, untracked, into the fixture's `scripts/`. Then: `node scripts/check-evidence-immutability.mjs --base 0e007ad42d7dec35932ff33871e2757d83b63673 --candidate eb6992048a30096e8d2f316821202f3ff9c18d05` | `1` | `Evidence-ledger immutability FAILED:` / `- evidence immutability: base record docs/replatform/epics/E5-workspaces-secrets/qa/2026-08-24-d0-e5-exit-gate-audit-a1.md was modified after commit`. It names the mutated record |
| Fixture control, same guard: `--base 0e007ad4… --candidate 0e007ad4…` | `0` | `Evidence-ledger immutability OK: 1 base records (…) all present and byte-identical in the candidate (…, 1 records); 0 candidate commit(s) walked, …`. This shows the RED is caused by the mutation, not by the fixture |
| **GREEN**: `node scripts/check-evidence-immutability.mjs --base origin/docs/replatform-program --candidate <this branch's head>`, both revisions explicit, run after the commit | `0` | `Evidence-ledger immutability OK: … all present and byte-identical in the candidate …; 1 candidate commit(s) walked, and no record introduced by one of them was rewritten or removed by a later one.` The branch has one commit and it does not touch `a1` |
| `node scripts/check-register-citation-integrity.mjs` | `0` | `397 enforced (explicit, repo-anchored) citations checked; best-effort (unenforced): 154 bare :LINE, 11 unanchored, 72 filename-only. 1 grandfathered.` / `PASS` |
| **Pin survives an index update (attempt-1 fix).** In the working tree, before the fix commit: append a simulated `a2` row to `qa/README.md`, then `git hash-object` both files, then restore the README | `0` | `qa/README.md` becomes `a84036ca…` (it changed). The matrix file stays `4d8a43a55d760bfa6fe84b91c8854082ea488643` (unchanged), before and after the restore |
| The 38 pure-node `pr.yml` guards in the M1 agent-rules set (every `node scripts/check-*.mjs` in `pr.yml` except the six the rules exclude) | `0` each | `failures: 0` |

## Deviations

- **The plan's literal RED command gives a false RED.** The task says to run
  `node <this-repo>/scripts/check-evidence-immutability.mjs --base "$BASE" --candidate "$CAND"`
  "with its repo root pointed at the fixture". The guard has no root flag. `runEvidenceImmutability`
  takes `repoRoot ?? REPO_ROOT`, where `REPO_ROOT` is the script's own parent directory. So run from
  this repo's path, the guard reads **this** repository and fails with
  `cannot read the base revision "0e007ad4…" — fatal: not a tree object`. That was observed, exit
  `1`. It is a RED for the wrong reason: a check that never evaluated the mutation. The control above
  points the root at the fixture by running a copy of the guard from the fixture's own `scripts/`.
  The plan text is not edited here. The correction is recorded for whoever next edits the E5 plan.
- **Where the matrix lives.** The task's Files list names `qa/README.md` and this result. After review
  attempt 1, the planning session ruled (F2) that the frozen plan moves to its own file outside
  `qa/`: `audit-matrix/2026-09-21-e5-seven-clause-matrix.md`. `qa/README.md` stays as the index.
  ★ *Superseded text: "The frozen matrix is placed in `qa/README.md`, so attempt authors read it next
  to the records. This result pins its blob SHA."*

## Findings

None filed. Three observations are recorded in the matrix rather than as new findings, because each
already has an owner or record:

- Clause 6's `a1` grade rests on a container analog. This is already recorded in the
  `E5-6-denied-egress` register reason, `E8-F003` and DE-08.
- Clauses 1 and 3 have no M1 ticket. This is recorded as `planned and blocked` in the matrix, and
  for clause 1 by the planning session's ruling.
- The placement-side residual on clause 4 is already `E5-F004`.

## Follow-up tickets

None filed here. The matrix names two gaps for the planning session. **No M1 ticket composes**:

- the DAT-001 manifest producer (clause 1);
- `createPatchApplyService` (clause 3).

Both clauses therefore stay `planned and blocked` through M1. Neither has an `M1a` or `M1b` floor,
so neither blocks criterion 7.

## Gate recommendation

`ready for independent review` (attempt 2). Approval freezes the plan. The reviewer should check five things
against source:

1. the matrix's state-at-freeze column;
2. the floors, especially that clauses 4 and 5 are floored at `M1a`, and clauses 2 and 7 only at
   `M1b` because of the `tools` + `output` exemption;
3. the result rule;
4. the recorded blob SHA, which must equal `git rev-parse <reviewed sha>:docs/replatform/epics/E5-workspaces-secrets/audit-matrix/2026-09-21-e5-seven-clause-matrix.md`;
5. that the attempt-1 blocker is fixed: the index and the pinned plan are separate files.

## Independent review

**Reviewer:** M1 review-batch-1 independent reviewer (Claude Opus 5) — distinct from the S0-6 unit session and the planning session
**Reviewed revision:** 28a2dd259ed7bdd8d64d68ad8a5999500d80b69e
**Disposition:** `changes_requested`
**Review evidence:** see *Independent review — attempt 1* below

For `approved`, verify the result describes the reviewed revision, all focused acceptance evidence passes, and every accepted finding is resolved; then change the top-level `Status` to `complete` and commit this disposition separately. Otherwise leave `Status` as `gate_review` or set `blocked`, and link stable findings.

### Independent review — attempt 1

**Disposition: `changes_requested`.** `Status` stays `gate_review`. Reviewed at
`28a2dd259ed7bdd8d64d68ad8a5999500d80b69e`. The start SHA `1cc7e2fdba42…` and the ticket's single
commit `299dca66e6cf…` (parent `1cc7e2fdb`, touching only `qa/README.md` and this result) are
ancestors of it. Everything the record measures holds. The one blocker is in the freeze mechanism
itself, and approval is what freezes it, so it has to be fixed first.

**★ BLOCKING — the freeze pin covers the whole `qa/README.md`, including the records index that every
attempt must update.**

- The recorded pin is the **file** blob: `git rev-parse <sha>:docs/replatform/epics/E5-workspaces-secrets/qa/README.md`
  = `f6b95d51cc8b96277363f34484bffdfb74867389`. It is correct today; I measured the same value at the
  reviewed revision.
- The same file is also the E5 **records index**. Its `## Records` table lists `a1` only, its
  `## Planned attempts` table lists `a2` and `a3+`, and `artifact-policy.md` §`README.md` makes a
  README the navigation ledger that "links to the latest accepted evidence".
- So when `a2` is filed and indexed, the blob changes. Every later attempt then runs the plan's own
  *"This plan unchanged since freeze"* command, and it **necessarily** fails: `a3`'s `M1b` candidate
  contains the `a2` index row. The command's only escape is "the attempt cites the recorded decision
  that changed it", and an index update is not a plan decision.
- The alternatives are both bad. Either the escape is abused routinely, which empties the freeze
  guarantee, or the index is never updated, which leaves a stale ledger.
- The README's own wording already shows the mismatch: *"If this **section's** blob no longer matches"*.
  Git has no per-section blob; the only blob is the file's.
- **Fix (either option; then re-record the pin):**
  - **(a)** Pin the **section**, not the file. Record the hash of
    `git show <sha>:…/qa/README.md | sed -n '/^## The frozen audit plan/,$p' | git hash-object --stdin`,
    and state that exact command in both the result and the plan's command table. Keep the frozen plan
    the last section of the file.
  - **(b)** Move the frozen plan into a file of its own that holds nothing but the plan, and pin that
    file's blob. It must not be a `qa/*.md` other than `README.md`, because `EVIDENCE_RECORD_RE` would
    treat it as an immutable evidence record. `tickets/` or the E5 epic root would work.

  Either way, add a sentence stating that the records and planned-attempts tables are **outside** the pin.

**Verified at source, and needing no change:**

- **Dependencies.** `DAT-011-B1` (attempt 4 `approved`), `TRACK-001-B1` (attempt 1 `approved`) and
  `DAT-008-A1` (attempt 1 `approved`) each carry top-level `**Status:** \`complete\``.
- **`a1` untouched.** `git log 1cc7e2fdb..28a2dd259 -- …/qa/2026-08-24-d0-e5-exit-gate-audit-a1.md` is
  empty, and its blob at the tip is `eb9186f7114d9f3551e55b00c4f6bf4bf38f47b0`, the blob the fixture
  used. GREEN re-run: `node scripts/check-evidence-immutability.mjs --base 1cc7e2fdba42… --candidate 299dca66e6cf…`
  gives `OK: 31 base records … byte-identical …; 1 candidate commit(s) walked`.
- **RED positive control, reproduced** in a disposable fixture at `C:/e5rv`, since deleted, following
  the plan's corrected procedure. The a1 copy's blob is `eb9186f7…`, and the guard and its one import
  were copied untracked into the fixture's `scripts/`. The mutated candidate exits **1** with
  `base record docs/replatform/epics/E5-workspaces-secrets/qa/2026-08-24-d0-e5-exit-gate-audit-a1.md was modified after commit`.
  The base-vs-base control exits **0** with `OK: 1 base records`. The §Deviations false RED (no
  repo-root flag; `REPO_ROOT` is the script's parent) is **true**, and the E5 plan has since recorded
  that correction (S0-8).
- **State at freeze.** `git diff 1cc7e2fdb 28a2dd259` over `server/src` and `packages` is tests only
  (CLI-010 and DAT-007-S3), and `scripts/gate-clause-wiring.json` is unchanged.
  `node scripts/check-gate-clause-wiring.mjs --counts` at the tip reports:
  - `createArtifactExportSequencer`, `createFenceAwareEgressProxy`, `createPatchApplyService` and `createResultCommitter`: **0** each;
  - `synthesiseRunSecrets`: **1**;
  - `createStagedInputResolver`: **1**;
  - `stageJobInputFiles`: **2**.

  All match. Further checks at `1cc7e2fdb`:
  - `job-leasing.ts:524` is `workspace: null,`.
  - The non-test, non-doc references to `buildWorkspaceManifest` are its definition, the two barrels
    and the `git-runner.ts` comment. `gate-clause-wiring.json` does not name it.
  - The `E5-6-denied-egress` reason names `e6f-08` as a docker-network analog and cites `E8-F003`.
  - `DE-08` is `not-delivered` with the 2026-09-11 founder amendment.
  - `tests/d1/e6f-05-live-minio.test.mjs`, `e6f-14-orphan-sweep.test.mjs` and
    `packages/worker-daemon/src/__tests__/supervisor-secret-materialization.test.ts` exist.
  - `maybeProvisionDistributedExecutionRoles` and `assertPrimaryDbBypassesRls` are in `server/src/index.ts`.
- **Floors versus scope-triage.** `scope-triage.md` §`M1a` entry defers exactly `tools` + `output`, so
  clauses 2 and 7 floored only at `M1b`, and 4 and 5 floored at `M1a`, are consistent. The verdict
  vocabulary is `a1`'s, unchanged.
- **Guard count.** `pr.yml` at `1cc7e2fdb` names 44 distinct `node scripts/check-*.mjs`. Minus the six
  excluded, that is **38**, as recorded.

**Not blocking; for the planning session.** `scope-triage.md` says of `M1a`: *"Workspace staging IS
required: the `M1a` journey stages input."* The matrix gives clause 1 (immutable workspace staging) no
floor at either milestone and plans it blocked. So an `a2` can pass exit criterion 7 with clause 1
`planned and blocked`. The record raises the missing DAT-001 composition ticket itself (§Follow-up).
The planning session should confirm, as a recorded decision, that the staged-input path (`proven_weakly`
at most) satisfies scope-triage's "workspace staging IS required" for `M1a`, **before** the plan is
frozen. Otherwise clause 1 needs an `M1a` floor.

## Review attempt history

The implementation author leaves the table body empty; the explicit pending summary above is not a review attempt. The first independent reviewer appends attempt 1, and later reviewers append monotonically increasing rows without replacing prior attempts. The summary fields above mirror the latest real attempt for existing gate tooling. Do not include a `Review commit` column: a row cannot embed the SHA of the commit that first contains it. Repository history identifies that commit, and handoffs pin the resulting ticket-result blob SHA.

| Attempt | Reviewer | Reviewed revision | Disposition | Evidence/findings |
|---:|---|---|---|---|
| 1 | M1 review-batch-1 independent reviewer (Claude Opus 5) | `28a2dd259ed7bdd8d64d68ad8a5999500d80b69e` | `changes_requested` | BLOCKING: the freeze pin is the whole `qa/README.md` blob (`f6b95d51…`, correct today), but that file is also the records index that must be updated when `a2` lands. `a3`'s "plan unchanged since freeze" command would then necessarily fail. The README's "this section's blob" wording has no git referent. Fix: pin a section hash, stated as an exact command, or move the plan to its own non-`qa/` file; then re-record the pin. Verified with no change needed: dependencies complete; `a1` untouched (GREEN OK, 31 records); RED reproduced in a fixture (exit 1, names the record; control exit 0); state-at-freeze counts all match at source; floors consistent with the `tools` + `output` exemption; 38 guards. Non-blocking: clause 1 has no `M1a` floor despite scope-triage's "workspace staging IS required", so the planning session should confirm. |
<!-- First independent reviewer appends attempt 1. -->
