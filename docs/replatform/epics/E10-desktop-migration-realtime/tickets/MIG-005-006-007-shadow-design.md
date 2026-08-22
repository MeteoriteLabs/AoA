# MIG-005 / 006 / 007 — SHADOW ONLY · design

**Terrain** [`MIG-005-006-007-shadow-terrain.md`](./MIG-005-006-007-shadow-terrain.md) ·
**Branch** `docs/replatform-program` (PR #323) · **Wave 3 item 4** ·
**Predecessor** [`REL-004-lane-D-result.md`](../../E11-hardening-release/tickets/REL-004-lane-D-result.md).

Terrain established that the artifact the handoff names — `job-shadow-comparator.ts` — has a
**structurally zero divergence rate** in its production wiring (measured: 2,000 randomized
snapshots, 0 divergences). Wiring three more sinks into it would manufacture the exact evidence
gate clause 2 opens on, and that evidence would be worthless.

This design does not repair the field-diff. It **replaces what is compared.**

---

## 1. The decision: field equality is the wrong comparison; admissibility is the right one

The comparator diffs six fields between the legacy snapshot and a "distributed intent". Ask what
an *honest* independent derivation of each field would be, and the answer collapses:

| Field | Second authority | Verdict |
|---|---|---|
| `policy.effectiveCompletionPolicy` | `resolveAgentCompletionPolicy` | **Same resolver both sides.** Equality is structural. Uncomparable. |
| `policy.model` | run-scoped model resolution | Same resolver. Uncomparable. |
| `policy.budgetPolicyId` | `budget_policies` | Same store. Uncomparable. |
| `provenance.executionPrincipalKind` | `taskSourceIsAdmitted` (`job-submission.ts:157`) | The distributed side can **refuse**. Not a field mismatch — a *denial*. |
| `provenance.credentialKind` | — | Inherited deferral #1: no credential exists to compare. |
| `routing.executionTargetType` | the placement registry target, via `normalizeSubmittedJobPlacementFacts` + `decideJobPlacement` candidate matching | The distributed side can find **no placeable target**. Again a denial, not a mismatch. |

Four of six fields have no second authority at all. The two that do express their disagreement
not as a different value but as **a refusal to run the thing**.

So the informative question a shadow pass can answer is not *"do the two sides agree on the
model string"*. It is:

> **Would the distributed platform have accepted this Commander turn / crew run / one-shot
> operation at all — and if not, why?**

That question has genuinely independent authorities that genuinely return no:

- **Admission** — `repos.jobControl.admission(...)` + the per-kind source checks in
  `submitJobWithinTenant` (`:141-165`): does the Organization exist, is the Company in it, is the
  principal authorized, is the requester kind permitted for this source kind.
- **Placement** — `decideJobPlacement` (`job-placement.ts:572`): is there an active, enrolled,
  non-revoked worker whose profile hash, device generation, provider constraints, capabilities,
  locality and capacity satisfy the job's requirements.

Both can say no for reasons that are precisely what Wave 4 needs to know in advance. Both are
**pure or read-only**. Neither is reachable today: `compare(..., { admissible })` has **zero**
callers that supply it, so the slot has always been `null`.

**Decision D1.** The shadow record's headline becomes an **admissibility verdict** per sink, not
a field-equality boolean. Field capture stays — as *captured provenance*, explicitly marked
uncompared — because the record is still the only place the legacy intent is written down.

## 2. The honesty rule that makes the rest safe

**Decision D2. An uncompared field is recorded as uncompared. Never as matching.**

This is the single change that kills the tautology, and it must land before any sink is wired.
Today `match: true` means "nothing disagreed", which is indistinguishable from "nothing was
checked". The record grows an explicit accounting:

```ts
readonly comparedFields: string[];    // fields with a genuine second authority
readonly uncomparedFields: string[];  // fields captured but not checked, with a reason
readonly mismatchedFields: string[];  // ⊆ comparedFields
```

and `match` becomes `"agree" | "diverge" | "not_compared"` — a three-state, so a run in which
nothing could be compared cannot be counted in the agreement column. `comparedFields` is the
**denominator** for gate clause 2. With no independent derivation supplied, every field lands in
`uncomparedFields` and the verdict is `not_compared` — the honest description of what ships
today, and a rate of `0/0` rather than a rate of `0/N`.

**Rejected:** keeping `match: boolean` and documenting the caveat in the result doc. A boolean
that reads as agreement is read as agreement; the caveat does not travel with the log line into
the evidence rollup. This programme has been bitten by exactly that (`checks-that-nothing-runs`).

## 3. Expressing all four sinks without fabrication

**Decision D3.** `LegacyRunExecutionSnapshot`'s identity half becomes the `SubmitJobSource` union
(`packages/shared/src/types/job-control.ts`), which already carries all six variants. `runId` /
`issueId` / `assigneeAgentId` stop being required top-level fields and live inside the `task_run`
variant where they belong.

`compare()` stops hardcoding `kind: "task_run"` and echoes the supplied source. No fabrication:
`packages/worker-protocol/src/source.ts` is FROZEN and every variant is `.strict()`, so a
fabricated `runId` on a `commander_turn` is refused at the schema boundary — the design does not
need to police what the schema already refuses, but the wiring must never try.

The `organizationId` / `companyId` / `workloadType` half is unchanged — every sink has those.

## 4. Effect-freeness: keep it structural

The comparator's strongest property is that it **holds no `Db` handle, so it cannot write**
(`job-shadow-comparator.ts:9`). An admissibility probe needs reads. Two ways to get them:

- **(a) give the comparator a read-only port.** Effect-freeness becomes an argued property of
  the port's method list rather than an absence. One added method later and the guarantee is
  gone silently.
- **(b) resolve at the seam, pass the verdict in.** The seams (`heartbeat.ts`, `cli-mode.ts`,
  `runner.ts`, `one-shot-sandbox-cli.ts`) already hold a `Db`. They compute the admissibility
  verdict and hand the comparator a finished value.

**Decision D4: (b).** The comparator stays a pure diff/record function with no handle — the
structural guarantee survives untouched — and the probe lives where a `Db` is already legitimate.
This also matches the existing shape: `admissible` is already an *input* to `compare`, not
something it computes.

**Decision D5.** The probe is a single shared function, `probeDistributedAdmissibility`, not four
copies. It is read-only by construction (it receives a `Db` but performs `select` only) and
best-effort: any throw yields `{ admissible: null, reason: "probe_error" }` and is recorded, never
propagated. A shadow probe must never fail a live Commander turn.

## 5. The rollout key — state the limit, do not widen it

Terrain §4: all four sinks are `workloadType: "batch"`, so one rollout switch arms them all.
Benign for shadow. **Not** benign for Wave 4, whose §5 ordering (MIG-005 → 006 → 007, "lowest
blast radius first") is not expressible today.

**Decision D6.** Do not add a per-sink axis here, and specifically do not pass a finer string as
`workloadType` — placement resolves the same policy with the job's real frozen `workloadType`, so
a shadow gated on a key active cannot use would prove nothing about active. The limit is
**stated** in the result doc and raised as a Wave-4 prerequisite owned by JOB-007 / MIG-002.

## 6. Lanes

| Lane | Content | Depends on |
|---|---|---|
| **A** | D2 (three-state + compared/uncompared accounting) + D3 (source union). Pure; unit + mutation. | — |
| **B** | D5 `probeDistributedAdmissibility` — admission + placement, read-only, best-effort. | A |
| **C** | Wire the three seams: MIG-007 (`runOneShotCliInSandbox`, covers all three operation kinds), MIG-005 (`cli-mode.ts`), MIG-006 (`runAoaAgent`). Plus the existing heartbeat seam migrated to the new shape. | A, B |
| **D** | Evidence: run the sinks under `shadow` on the D1 two-replica lane, state the divergence rate **with its denominator**, explain every divergence. | C |

Lane A is the correctness core: until an uncompared field stops reading as agreement, every
downstream number is false. It lands first and alone.

## 7. Acceptance → named executable artifact

| # | Invariant | Artifact |
|---|---|---|
| S1 | The production wiring (no independent derivation supplied) reports `not_compared`, never `agree` | `job-shadow-comparator.test.ts` — the 2,000-snapshot probe from terrain, inverted into a permanent assertion |
| S2 | `comparedFields` and `uncomparedFields` partition the six fields; `mismatchedFields ⊆ comparedFields` | same file, property test |
| S3 | All six source kinds round-trip through `compare` with their own identity fields | same file, table over `EXECUTION_SOURCE_KINDS` |
| S4 | No fabricated `runId`/`issueId` on a non-task variant survives | contract test against the FROZEN `.strict()` variants |
| S5 | The comparator holds no `Db` handle | structural: `createJobShadowComparator`'s deps type; an anti-regression test asserting the dep keys |
| S6 | A throwing admissibility probe never propagates into the caller | `mig-shadow-probe.test.ts` |
| S7 | The probe performs no write | integration test on embedded PostgreSQL: snapshot `jobs`/`job_attempts`/`environment_leases` row counts across a probe |
| S8 | Each of the three seams emits exactly one record per operation, and zero when rollout ≠ shadow | per-seam tests |
| S9 | A denied admission is recorded as a **divergence with a reason**, not as an error | probe test |
| S10 | Rollout key limit (D6) is stated, not silently widened | result doc + a test pinning `HEARTBEAT_TASK_RUN_WORKLOAD_TYPE`-equivalent constants to `"batch"` for all four sinks |

Every guard mutation-tested per §1.8 of the handoff.

## 8. What this design deliberately does not do

1. **It does not make field equality informative.** Four of six fields have one authority; no
   amount of wiring creates a second. They are captured and marked uncompared.
2. **It does not resolve inherited deferral #1** (a worker receives no provider credential).
   Shadow does not need one. It stays a stated blocker for MIG-005/006/007 **active**.
3. **It does not add a per-sink rollout axis** (D6).
4. **It does not touch `packages/worker-protocol/`** — FROZEN, source SHA
   `b7a842870ce7509d8baa75409e0ab19da375c88a`.
5. **It does not claim "real traffic" means production users.** For a pre-release programme the
   traffic source is the D1 two-replica lane's journey. Lane D states the source and the
   denominator rather than implying organic volume.
