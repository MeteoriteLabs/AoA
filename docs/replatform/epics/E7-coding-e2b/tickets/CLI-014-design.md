# CLI-014 — the projector: the owed design, and the two contradictions it found

**Status:** `design-recorded, RULED` — see **`E7-D13`** (`../decisions.md`). Measured 2026-09-24 at
`eb8458bb3538c99ee5cb54b6872202c5f268dd74` (`origin/docs/replatform-program`).
**Epic:** E7 · **Plan task (the contract):** `../implementation-plan.md` `### CLI-014`
**Depends on:** `CLI-013` (shipped) · **Filed:** `E7-F046` (re-pointed off this ticket by `E7-D13`)
**Milestone:** `M1b`

The task section says this ticket is **"NOT ASSIGNABLE AS BUILD UNTIL ITS CONTRACT IS DESIGNED"**
and names four design items. Doing that design measured two things at HEAD that the task section
contradicts. Under the M1 build rule *"if the task section and the code disagree, the CODE is the
truth: STOP and report it"*, this file records the measurement and stopped before writing code.
★ *At filing it read "**It rules nothing** — the remaining choice is a frozen-protocol change, which
is above this ticket." That was correct then; the planning session has since taken the ruling, and
it is recorded as **`E7-D13`** and summarised below.*

## Contradiction A — the owed design was already chosen and BUILT, by `JOB-017`

The task section states the design *"is one of exactly two shapes, and it must name which"*:
(1) a transaction-aware callback inside `acceptEvent`, or (2) a bridge operation that accepts an
existing repository transaction. It then states that **until one is chosen and recorded, the
same-batch projection this ticket promises is not implementable**.

Both were built, before this ticket was scheduled:

- **Shape 2 exists** as `projectAcceptedOutputCore` (`server/src/services/job-output-bridge.ts`) —
  a transaction-taking core that *"never opens a transaction, never locks or guards the fence"*. Its
  own doc comment says `CLI-014` *"is meant to call it too, supplying a richer `output`"*.
- **Shape 1 exists** as `resolveAcceptedOutputProjector` / `applyAcceptedOutputEvent`
  (`server/src/services/job-accepted-output-projection.ts`), which `createJobEventIngestService`
  runs inside `acceptEvent`'s savepoint *"for each newly accepted `artifact_prepared` event while
  the fence is still live"*.
- `scripts/gate-clause-wiring.json`'s **`E3-17-output` is `status: wired`**, not `unwired`, and its
  reason names both symbols. The superseded framing quoted in the task section
  (*"task_outputs is still written by the legacy path"*) is that entry's **PRIOR** reason, retained
  inside the same entry.

So the second half of this ticket's Outcome — *"the projector writes the corresponding
`task_outputs` row"* — **already ships**, through the bridge, with its `output_projection` receipt,
which is what `countProducedOutputs` arm 2 counts.

**And the owed test already exists, by name.** The task section owes
*"ingesting `artifact_prepared` and the terminal event in the same batch, asserting one
`task_outputs` row with its `output_projection` receipt and no `attempt_terminal` throw"*. That is
verbatim the case `[acc 2] an output event and the terminal event in ONE batch yield ONE
task_outputs row with its output_projection receipt, and no attempt_terminal throw`, in
`server/src/__tests__/job-accepted-event-seam.integration.test.ts`. Writing it again under the
owed filename would be a **vacuous** RED: it passes at HEAD against no new code, which is the trap
`CLI-013` caught in its own build.

## Contradiction B — the remaining half is unsatisfiable: no path is durable anywhere

What genuinely remains is the half the wiring entry explicitly disclaims —
*"promoting a `job_artifacts` row into a product `artifacts` row, and folding `detectedFiles` into
the run summary, are `CLI-014`'s"* — and design item 1 (a durable relative path, *"durable at
commit time, not reconstructed at projection time"*) **cannot be satisfied at HEAD**. See
**`E7-F046`** for the full measurement. In short, the path exists in the worker and is dropped at
successive `.strict()` boundaries, and nothing on the control plane ever receives it:

| Where the path is | What crosses | Source |
|---|---|---|
| `ArtifactExportRequest.path` (absolute, in-sandbox) | — | `packages/worker-daemon/src/lease/artifact-export.ts` |
| the export's own identity | `exportArtifactId` = `deterministicUuid("artifact-export:<jobId>:<attempt>:<path>")` — a **one-way** digest | same file |
| the commit manifest | `artifactManifestV1Schema`, `.strict()`, fields `artifactId, kind, sensitivity, retention, objectKey, sizeBytes, sha256, contentType, createdAt` — **no path** | `packages/worker-protocol/src/artifacts.ts` |
| the object key | the attempt prefix plus `artifactId` — the digest again, not the path | `artifact-export.ts` |
| the announcement | `artifactPreparedPayloadV1Schema` = `{artifactId, kind}`, `.strict()`; `announcementsFor` **has** `ref.path` and deliberately does not send it | `packages/worker-daemon/src/supervisor/supervisor.ts` |
| `job_artifacts` | `objectKey, sha256, sizeBytes, contentType, kind, versionNumber, …` — **no path column** | `packages/db/src/schema/job_artifacts.ts` |

`detectedFiles` is `ReadonlyArray<{ path: string; type?: string }>`
(`server/src/services/canary-run-projector.ts`) and `formatRunSummary`
(`server/src/services/run-summary.ts`) renders those `path` values into a founder-visible comment.
`foldAttemptEvidence`'s hard-coded `detectedFiles: []` is annotated with exactly this reason
(`server/src/services/canary-terminal-projection.ts`). So folding a file list from
`artifact_prepared` would require **minting a path the sandbox never reported**, which the task
section's own design item 4 forbids.

## Why this is not this ticket's to rule

★★★ **CORRECTED 2026-09-24 (Codex P2, PR #596), verified at source: there is a THIRD channel and
it needs no widening at all.** `artifactManifestV1Schema` already carries `objectKey`, whose only rule
is `objectKeyHasPrefix` (safe relative POSIX key + the exact attempt prefix + a non-empty suffix); the
`${prefix}${artifactId}` shape is a **convention**, not a schema constraint. A reversibly-encoded,
bounded relative path could ride that existing field, recovered from `job_artifacts.objectKey` — no
schema widening, no fixture re-mint, no new column. It needs an **E5 convention ruling** (the key is
pinned by an equality check on both sides) and a **leak ruling** (the key reaches logs and receipts),
and the 1024-char key bound needs its own encoding bound and refusal. `E7-F046` records it as the
option to evaluate first. ★ *The list below, retained as filed, said "one of" these two; that framing
was wrong.*

Creating the missing provenance means one of:

1. widening the frozen `artifactPreparedPayloadV1Schema`, or
2. widening the frozen `artifactManifestV1Schema` on the commit path **and** adding a path column to
   `job_artifacts`,

and either way re-minting the hash-pinned frozen consumer fixture
(`check:frozen-worker-protocol-v1` = `scripts/check-frozen-worker-protocol-consumer.mjs`, which
pins the whole `packages/worker-protocol/src` tree at a recorded source sha). This ticket's own
**Migration/compatibility** note says *"additive; no schema change"*, and the commit path belongs
to `CLI-012`/`DAT-009`, not to a projector. A protocol widening is also the one axis ruling **F7**
(`../decisions.md`, `E7-D11`) declined to move.

## THE RULING — `E7-D13`, taken 2026-09-24

The planning session verified both contradictions independently at source (including the trap that
`artifactManifestV1Schema`'s `path:` at the `superRefine` is a Zod **issue** path, not a data field)
and ruled:

- **(a) the same-batch projection is CLOSED AS DELIVERED BY `JOB-017`** — disposition (c) below.
  The framing this ticket's task section quotes is the wiring entry's **PRIOR** reason, so no later
  reader should re-open it.
- **(b) `detectedFiles.path` is DESCOPED for M1. Do not widen the wire** — disposition (a) below.
  `M1b`'s criterion is *"an agent's output reaches the founder"*, which `{artifactId, kind}` plus
  retrievable bytes satisfies; **a displayed filename is fidelity, not capability**, and is not
  worth changing a frozen protocol leaf for inside a milestone.
- **(c) OMIT, NEVER INVENT** — the honesty constraint, pinned by
  `server/src/__tests__/cli-014-output-path-omission.test.ts` with its positive controls and
  mutations (`tickets/CLI-014-result.md`).
- **(d) `E7-F046` stays OPEN**, re-pointed off `CLI-014` to the post-M1 protocol question.

The **materialization residue** (disposition (a)'s second half — `job_artifacts` → a product
`artifacts` row so `task_outputs.artifactId` resolves) is **not ruled**; it is independent of the path
question. ★★★ **CORRECTED 2026-09-24 (Codex P1, PR #596): it is no longer merely "available as
separate work" — it is filed as `E7-F047` (HIGH), and (a)'s closure is CONDITIONAL on that finding
getting an owner.** Measured at source: `applyAcceptedOutputEvent` leaves `artifactId`,
`artifactVersionId`, `assetId` and `url` all null, and `OutputRefTabBody` dispatches on exactly those
four, so a distributed artifact renders *"No preview is available for this output."* The bytes are
durable and **unreachable from the task**, so closing the projection half must not be read as `M1b`'s
output criterion being satisfied.

## The admissible dispositions, as put to the ruling

- **(a) Descope `detectedFiles`.** Keep the CLI-014 residue as **materialization only**:
  `job_artifacts` → an `artifacts` row plus `artifact_versions`, idempotent, written inside the
  existing seam savepoint, so `task_outputs.artifactId` resolves instead of staying null. Buildable
  today without any path — the title would derive from `kind` and `versionNumber`, so two output
  files of one attempt are distinguishable only by version and `sha256`. Honest but degraded.
- **(b) Widen the wire** (option 1 above) to carry the relative path under the ruled output root,
  and fold `detectedFiles` from it. Satisfies the Outcome as written; costs a protocol version, a
  fixture re-mint and a new leak review (the path is tenant-authored — `artifact-export.ts` keeps
  its failure channel path-free *on purpose*, and `E7-D11`'s Observability note allows only
  *"the declared relative path"*, which is exactly what does not exist).
- **(c) Close `CLI-014`** as delivered-by-`JOB-017` and re-file the materialization residue as its
  own ticket.

★ **Ruled 2026-09-24 by `E7-D13`: (b) for the path half — descope, do not widen — and (c) for the
projection half — closed as delivered by `JOB-017`.** The sentence this replaces read *"A ruling is
owed before `CLI-014` is assignable. Nothing here chooses."*, which was true when written.

## What was and was NOT done

**Done:** this design record; `E7-D13` (`../decisions.md`); `E7-F046`; and the ruling's honesty pin,
`server/src/__tests__/cli-014-output-path-omission.test.ts` — four assertions, three mutations,
tabled in `CLI-014-result.md`.

**Not done:** no projector change, no materialization, no wire widening. ★ *At filing this section
read "No code, no test, no register edit, no `-result.md`", which was accurate for the pre-ruling
commit: a `-result.md` would then have made `check-finding-ownership` treat `CLI-014` as completed
and leave `E7-F046` owned by nothing. `E7-D13` (d) re-points `E7-F046` off this ticket, which
dissolves that constraint, so the result record is now written.*

No keyed E2B workflow was dispatched, and none is needed: both contradictions are static
measurements of source, and every arm of the pin is a pure fold or a frozen-schema parse.
