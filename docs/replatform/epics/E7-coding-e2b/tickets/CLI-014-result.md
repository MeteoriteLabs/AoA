# CLI-014 — result

**Status:** `gate_review` — set by the author. **Only a DISTINCT reviewer may set `complete`.**
**Ticket:** `CLI-014` · **Epic:** E7 · **Milestone:** `M1b`
**Plan task (the contract):** `../implementation-plan.md` `### CLI-014`
**Design record:** `CLI-014-design.md` · **Ruling:** `../decisions.md` `E7-D13`
**Reviewed revision:** `472c0b4a95158ff70672dc0c43de228da2fe9e2c` (the pre-ruling head, Codex-reviewed
with zero findings); the ruling commit's head is recorded on the PR.

## What this ticket turned out to be

Not a build. `CLI-014`'s task section says it is *"NOT ASSIGNABLE AS BUILD UNTIL ITS CONTRACT IS
DESIGNED"*; doing that design measured two contradictions of the task section, and under the M1
rule *"if the task section and the code disagree, the CODE is the truth"* the build stopped there.
The planning session then ruled (**`E7-D13`**), and this ticket delivers the ruling's one
executable obligation.

- **Contradiction A** — the owed design was already chosen and BUILT by `JOB-017`
  (`projectAcceptedOutputCore`; `resolveAcceptedOutputProjector` / `applyAcceptedOutputEvent` inside
  `acceptEvent`'s savepoint), `E3-17-output` is `wired`, and the owed integration case exists
  **verbatim** in `server/src/__tests__/job-accepted-event-seam.integration.test.ts`. Ruled
  **closed as delivered by `JOB-017`**.
- **Contradiction B** — no relative path is durable anywhere on the control plane, so
  `detectedFiles` cannot be folded honestly. Ruled **descoped for M1**; filed as `E7-F046`,
  re-pointed off this ticket to the post-M1 protocol question.
- **The obligation:** `E7-D13` (c), **OMIT, NEVER INVENT** — pinned below.

## RED and GREEN

★★★ **THERE IS NO RED, AND SAYING SO IS THE POINT.** The behaviour `E7-D13` (c) requires is already
correct at HEAD: `foldAttemptEvidence` returns `detectedFiles: []`. A test written against correct
code passes for free and proves nothing on its own — the `CLI-013` vacuity trap, which this
programme's rules name explicitly (*"a test that passes against the defect is not a proof"*).
Manufacturing a RED by first breaking the code would have been theatre. **The proof is entirely in
the mutation table below**, each row of which was executed and reverted.

- **GREEN:** `pnpm --filter @armyofagents/server exec vitest run
  src/__tests__/cli-014-output-path-omission.test.ts` → **4 passed / 4 executed**, 0 skipped.
- **One real RED did occur, in my own test**, and it is recorded because it is the anti-vacuity arm
  earning its place: the first draft filtered `evidence.events` on `e.eventType`, but
  `foldAttemptEvidence` emits the field as `type`. The arm failed (`expected [] to have length 2`)
  — i.e. it correctly refused to certify an emptiness assertion over events it could not see. Had
  the anti-vacuity arm not been written first, the pin would have passed while folding nothing.

## Mutation and positive-control table

Each mutation was applied to production source, the focused suite was run, and the mutation was
reverted (`git diff --stat` clean afterwards, verified each time).

| # | Mutation | Site | Expected | Observed |
|---|---|---|---|---|
| M1 | Invent a path from the artifact identity: map `artifact_prepared` events to `{ path: artifactId }` | `foldAttemptEvidence`, `server/src/services/canary-terminal-projection.ts` | both invention arms red | **RED, 2 failed / 2 passed.** `expected [ …(2) ] to deeply equal []` and `expected [ Array(1) ] to not include '3f25…3301'` |
| M2 | Widen the frozen wire: add `path: z.string().optional()` to the payload | `artifactPreparedPayloadV1Schema`, `packages/worker-protocol/src/events.ts` | the structural arm reds | **RED, 1 failed / 3 passed.** `frozen artifact_prepared payload must refuse a 'path' field: expected true to be false` |
| M3 | Render a `Files:` line unconditionally (`if (detectedFiles.length > 0)` → `if (true)`) | `formatRunSummary`, `server/src/services/run-summary.ts` | the omission arm reds | **RED, 1 failed / 3 passed.** `expected '🤖 **Run Summary** — Builder…' not to contain 'Files:'` |

**Positive controls inside the suite** (they make the assertions non-vacuous rather than mutating
anything):

| Control | What it refuses to let pass silently |
|---|---|
| The fold is asserted to have **seen** both `artifact_prepared` events, by id, **before** `detectedFiles` is read | an emptiness assertion over a fold that dropped the events, or was handed none |
| `formatRunSummary` **with** `[{ path: "src/main.ts" }]` is asserted to contain `Files:` and the path | a renderer that never emits `Files:` at all, which would pass the omission assertion while proving nothing |
| The frozen payload is asserted to **accept** a valid `{artifactId, kind}` before four widening keys are asserted rejected | a schema that rejects everything, making the `.strict()` arm vacuously green |

## Multi-tenant (founder ruling F10)

**Not engaged, deliberately, and stated rather than skipped.** Every assertion in this suite is over
a pure fold or a frozen-schema parse; nothing reads or writes a row, so there is no tenant data and
no cross-tenant case to write. The tenant-scoped half of this surface is `JOB-017`'s
`applyAcceptedOutputEvent`, whose cross-tenant arms (a foreign Organization refused, with a
same-tenant positive control) live in `job-accepted-event-seam.integration.test.ts`.

## Keyed runs

**None dispatched, and none awaited by any acceptance item here.** Both contradictions are static
measurements of source, and every arm of the pin is pure. This is the full answer to the task
section's evidence obligation, not a deferral.

## Boundary against `jobOutputBridge`, in the register's own words

The task section requires this result to state the seam. `scripts/gate-clause-wiring.json`'s
`E3-17-output` holds it: `projectAcceptedOutput` *"writes ONE `task_outputs` row … plus an
`output_projection` receipt in ONE tenant tx"*, and the capability verifier's admission is that
there is *"exactly one writer"*. This ticket **adds no writer**. It routes nothing beside the
bridge and moves no counter — including `countProducedOutputs` arm 2, which `JOB-017` already
moves.

## CI

Recorded on the PR: `ci-required` **pass**, with `policy`, `lint`, `migrations`, `browser`,
`e2e`, `e2e-pgvector`, `brand-check`, both `worker-protocol-contract-bytes` lanes and all four
`verify` shards green. The focused suite's executed count is **4**, non-zero, on a platform that
does not skip it (no `describe.skipIf`; the suite is pure and runs everywhere).

## What this does NOT close

- **`E7-F046`** stays OPEN and `unowned` — the missing *path* (a display name). ★ Codex P2 found my
  framing of it wrong: the cheapest fix is **not** a protocol widening but the existing `objectKey`
  field, whose suffix is unconstrained; corrected on the finding and on `E7-D13`.
- **`E7-F047`** (HIGH, `unowned`) — filed from Codex P1 during this review, verified at source: the
  projected row leaves `artifactId`/`artifactVersionId`/`assetId`/`url` all null, so the founder's
  viewer renders *"No preview is available"* and the committed bytes are **unreachable from the
  task**. This falsified `E7-D13`'s own *"retrievable bytes"* premise, which is corrected in place
  with the superseded wording preserved. **`E7-D13` (a)'s closure of `CLI-014` is now conditional on
  `E7-F047` getting an owner** — the ruling's conclusions are unchanged, but closing the projection
  half must not be read as `M1b`'s output criterion being satisfied.
- The **materialization residue** (`job_artifacts` → a product `artifacts` row so
  `task_outputs.artifactId` resolves rather than staying null) is unruled and unbuilt — now tracked
  as `E7-F047` rather than left as a sentence.
- **`CLI-015`**'s clause-6 predicate and the QUALIFYING ARTIFACT counter (arm 1) are untouched, as
  the task section's non-goals require.
