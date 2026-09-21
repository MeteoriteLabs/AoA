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

- **The frozen audit plan** is in [`../qa/README.md`](../qa/README.md) §"The frozen audit plan". It
  contains:
  - the owners;
  - the unchanged `a1` verdict vocabulary;
  - the exact topology, including the F10 tenant set;
  - the consumed campaign records per attempt;
  - the seven-clause matrix, with per-tenant evidence and cross-tenant denial for each clause, an
    `M1a` floor and an `M1b` floor, and a measured state at freeze;
  - the retained non-certifications;
  - a six-part result rule;
  - the exact commands.
- **One plan for both attempts.** `a2` attests the `M1a` candidate. `a3` or later attests the `M1b`
  candidate and links through `Supersedes`.
- **Freeze pin.** At freeze, the `qa/README.md` git blob SHA is
  **`f6b95d51cc8b96277363f34484bffdfb74867389`**. Every attempt compares the candidate's blob with
  this SHA (the plan's "This plan unchanged since freeze" command).
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
  campaigns.

## Changed files

| File | Responsibility |
|---|---|
| `docs/replatform/epics/E5-workspaces-secrets/qa/README.md` | New. It indexes the E5 audit records and holds the planned-`a2`/`a3+` entries and the frozen plan. `README.md` is excluded from the immutable set (`EVIDENCE_RECORD_RE`, `scripts/check-evidence-immutability.mjs`) |
| `docs/replatform/epics/E5-workspaces-secrets/tickets/E5-A2-MATRIX-result.md` | This result |

## Acceptance evidence

| Acceptance condition | Evidence | Result |
|---|---|---|
| Dependencies `DAT-011-B1`, `TRACK-001-B1`, `DAT-008-A1` have complete results | Each result's top-level `**Status:** \`complete\``. Approved by distinct reviewers: `DAT-011-B1` attempt 4, `TRACK-001-B1` attempt 1, `DAT-008-A1` attempt 1 | `pass` |
| Per-clause verdict criteria, in `a1`'s vocabulary, unchanged | `qa/README.md` §Verdict vocabulary and the `proven_in_d1 requires` column | `pass` |
| Exact commands and topology | `qa/README.md` §Exact topology and §Commands. Every command names its revision explicitly, and the immutability command carries `--base` | `pass` |
| QA owner and decision owner named (F2) | `qa/README.md` §Owners | `pass` |
| Multi-tenant (F10): per-tenant evidence, plus cross-tenant denial where the clause is about isolation | the matrix's two F10 columns, filled for all seven clauses. Result rule R5 | `pass` |
| A clause that cannot be evidenced is planned and blocked with the blocker named, never dropped | Clauses 1, 3 and 6 carry named blockers. Result rule R1 | `pass` |
| Frozen for both attempts | `qa/README.md` §Planned attempts and "One plan for every attempt" | `pass` |
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
- **Where the matrix lives.** The task's Files list names `qa/README.md` and this result. The frozen
  matrix is placed in `qa/README.md`, so attempt authors read it next to the records. This result
  pins its blob SHA.

## Findings

None filed. Three observations are recorded in the matrix rather than as new findings, because each
already has an owner or record:

- Clause 6's `a1` grade rests on a container analog. This is already recorded in the
  `E5-6-denied-egress` register reason, `E8-F003` and DE-08.
- Clauses 1 and 3 have no M1 ticket. This is recorded as `planned and blocked` in the matrix.
- The placement-side residual on clause 4 is already `E5-F004`.

## Follow-up tickets

None filed here. The matrix names two gaps for the planning session. **No M1 ticket composes**:

- the DAT-001 manifest producer (clause 1);
- `createPatchApplyService` (clause 3).

Both clauses therefore stay `planned and blocked` through M1. Neither has an `M1a` or `M1b` floor,
so neither blocks criterion 7.

## Gate recommendation

`ready for independent review`. Approval freezes the plan. The reviewer should check four things
against source:

1. the matrix's state-at-freeze column;
2. the floors, especially that clauses 4 and 5 are floored at `M1a`, and clauses 2 and 7 only at
   `M1b` because of the `tools` + `output` exemption;
3. the result rule;
4. the recorded blob SHA, which must equal `git rev-parse <reviewed sha>:docs/replatform/epics/E5-workspaces-secrets/qa/README.md`.

## Independent review

**Reviewer:** `pending`
**Reviewed revision:** `pending`
**Disposition:** `pending`
**Review evidence:** `pending`

For `approved`, verify the result describes the reviewed revision, all focused acceptance evidence passes, and every accepted finding is resolved; then change the top-level `Status` to `complete` and commit this disposition separately. Otherwise leave `Status` as `gate_review` or set `blocked`, and link stable findings.

## Review attempt history

The implementation author leaves the table body empty; the explicit pending summary above is not a review attempt. The first independent reviewer appends attempt 1, and later reviewers append monotonically increasing rows without replacing prior attempts. The summary fields above mirror the latest real attempt for existing gate tooling. Do not include a `Review commit` column: a row cannot embed the SHA of the commit that first contains it. Repository history identifies that commit, and handoffs pin the resulting ticket-result blob SHA.

| Attempt | Reviewer | Reviewed revision | Disposition | Evidence/findings |
|---:|---|---|---|---|
<!-- First independent reviewer appends attempt 1. -->
