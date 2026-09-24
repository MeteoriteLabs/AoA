# CLI-014 — the projector: the owed design, and the two contradictions it found

**Status:** `design-recorded, build BLOCKED` — no code written. Measured 2026-09-24 at
`eb8458bb3538c99ee5cb54b6872202c5f268dd74` (`origin/docs/replatform-program`).
**Epic:** E7 · **Plan task (the contract):** `../implementation-plan.md` `### CLI-014`
**Depends on:** `CLI-013` (shipped) · **Owns:** `E7-F046`
**Milestone:** `M1b`

The task section says this ticket is **"NOT ASSIGNABLE AS BUILD UNTIL ITS CONTRACT IS DESIGNED"**
and names four design items. Doing that design measured two things at HEAD that the task section
contradicts. Under the M1 build rule *"if the task section and the code disagree, the CODE is the
truth: STOP and report it"*, this file records the measurement and stops. **It rules nothing** — the
remaining choice is a frozen-protocol change, which is above this ticket.

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

## The admissible dispositions, unruled

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

**A ruling is owed before `CLI-014` is assignable.** Nothing here chooses.

## What was NOT done

No code, no test, no register edit, no `-result.md` (a `-result.md` would make
`check-finding-ownership` treat `CLI-014` as completed, and `E7-F046` would then be owned by
nothing). No keyed E2B workflow was dispatched; none is needed for either contradiction — both are
static measurements of source.
