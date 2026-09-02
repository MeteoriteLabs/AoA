# E7 — Coding/CLI on E2B — findings

## E7-F001 — The canary mints no execution-secret handle, so the canary sandbox receives no provider credential

**Status:** resolved · **Owner:** CLI-007 (`epics/E7-coding-e2b/tickets/CLI-007-design.md`, result `CLI-007-result.md`)
**Severity:** HIGH
**Filed:** Sprint 5 (CLI-006/D2 execution), 2026-08-26, by terrain re-verification of the CLI-006 ↔ DAT-008 seam.
**Correction (2026-08-26, CLI-007 adversarial review).** The original mechanism below is INCOMPLETE: it named
only guard 4 (`owner_authority_disagreement`) as the canary's block, but a real canary refuses one gate earlier,
at guard 2 (`executor_not_agent`). The mint gated the EXECUTOR on `executorPrincipalKind === "agent"`, yet NO
execution source ever stamps an `"agent"` executor — the frozen executor authority (Decision #121) makes
`task_run`/`crew_run`/`one_shot` executors `worker`/`sandbox`; `"agent"` is only ever a *requester* kind
(`job-control.ts` `taskSourceIsAdmitted` → `{kind:"worker", id: agentId}`). So the mint had never minted for
ANY real run — a pre-existing DAT-008 slice-1 gap on which this canary-specific finding sat. The original trace
reached guard 4 only because it assumed an `"agent"` executor. **Both gates are the fix.**

**Resolved:** Sprint 5a (CLI-007), 2026-08-26. The canary (and every real coding-agent run) now mints a Company
`provider_key` handle. Two corrections landed together:
1. **Guard 2 (executor gate).** `isAgentBackedExecutorKind` (`execution-secret-handle-mint.ts`) admits the real
   agent-backed execution kinds (`worker`/`sandbox`, per Decision #121); the real coding gate is guard 3 (v1
   adapter scope) plus the agent-binding lookup keyed on `executorPrincipalId`, so a `worker`/`sandbox` run whose
   principal is not a v1 coding agent (browser/service/commander/system) still refuses. The mint runner's
   binding-load gate uses the same predicate.
2. **Guard 4 (owner authority).** The MIG-008 preflight emits the Company ownership authority
   (`credentialAuthority: "company_api_key"`, only on `ok`), `resolveRunExecutionOwner` threads it as
   `mintCredentialAuthority`, and the mint sources its `credentialKind` from that out-of-band authority
   (`canary-mint-authority.ts` `mintCredentialKindFor`) — WITHOUT touching the four-null placement binding, so
   the replay digest stays byte-identical and the owner-authority gate is unchanged in strength.

Proven at embedded-PG (`job-placement.integration.test.ts` `[CLI-007]`) using the REAL executor shape
(`executor_principal_kind = 'worker'`, `executor_principal_id` = the coding agent): the canary places to the
same digest across attempts and mints exactly one `provider_key` handle; the no-authority control mints none
(fail-closed). This UNBLOCKS but does NOT promote E7-1 (that still needs a cited dispatched real-E2B run of the
full journey — go-book §4 Sprint 5).

**What.** The composed canary placement path **never mints an execution-secret handle**, so the
canary lease envelope carries `secretHandles: []`, the worker redeems nothing, and a coding CLI
inside the canary sandbox has **no provider credential to authenticate with** — on real E2B just as
on the D1 fake provider.

**The mechanism (source-traced at tip `88c6a8b66`).**
- CLI-006 wires the canary credential binding to `resolveCanaryCredentialBinding`
  (`server/src/index.ts:1182`), which returns **four explicit nulls** — `credentialKind: null`
  (`server/src/services/canary-credential-binding.ts:59-64`), deliberately, to keep the placement
  digest replay-stable and to structurally exclude `owner_desktop` routing.
- That binding flows into the placement authority (`server/src/services/job-placement.ts:455-461`)
  and thence to the DAT-008 mint as `credentialKind: authority.credentialBinding.credentialKind`
  (`server/src/services/job-placement-transaction.ts:377`), on the canary `selected/active/
  lease-eligible` path (`:363-365`).
- The mint's step 4 requires **both** owner authorities to exist and agree:
  `ownerAuthoritiesAgree(placementOwner, credentialKind)` returns `false` whenever `credentialKind
  === null` (`server/src/services/execution-secret-handle-mint.ts:122-127`), so
  `decideExecutionSecretHandle` refuses with `owner_authority_disagreement`
  (`:149-151`). No handle is written.
- `owner_authority_disagreement` is an **actionable** refusal
  (`isActionableMintRefusal`, `execution-secret-handle-mint.ts:104-106`), so every canary placement
  also emits a `job.execution_secret_mint.refused` warning
  (`job-placement-transaction.ts:385-393`) — a "should be impossible" owner-disagreement signal
  firing as the steady state of the canary.

**Consequence for the journey (hop 5 / E7-1).** The "execute" hop cannot run a real credentialed
coding task for the canary: the CLI in the sandbox has no key. This is the same bound
`CLI-006-result.md` deferral 2 records, but its stated mechanism there
(`secretHandles: []` hardcoded at `job-leasing.ts:349`; "no production writer") is **stale** — DAT-008
now advertises handles from `listActiveExecutionSecretHandles` (`job-leasing.ts:601-613`) and mints
via `mintExecutionSecretHandleForPlacement` (`job-placement-transaction.ts:367`). The delivery gap is
real; the reason moved. **E7-1 stays `unwired` for this reason too**, independent of the
provider-vs-fake and control-plane-reach reasons.

**Why it is not fixed here.** Making the canary mint a credential is architectural, not a line in the
D2 lane: enriching the four-null binding with a non-null `credentialKind` is **explicitly forbidden**
by CLI-006's design (`canary-credential-binding.ts:39-47` — it re-opens owner routing and breaks
placement-digest replay), and credential-generation freshness is stated to belong to the preflight
(`canary-preflight.ts`). The fix is a **canary-aware credential path** (a mint that can authorize a
Company-key `provider_key` handle for a canary agent run whose owner authority is established without
a personal-subscription `credentialKind`), which is a decision with a blast radius and its own ticket.

**Scope note.** This does not change any shipped behaviour and is fail-closed (no credential ⇒ the
canary coding CLI cannot authenticate ⇒ the run degrades visibly, never double-executes or leaks). It
bounds what a real-E2B canary campaign can prove until it is owned.

## E7-F002 — Blocker A: a converted `task_run` carried an EMPTY workload, so no canary attempt could ever be leased

**Status:** resolved · **Owner:** Unit 1 "the mechanism" (Blocker A+B fix, `qa/2026-08-31-blocker-ab-fix-design.md`)
**Severity:** HIGH
**Filed:** 2026-09-01, on filing Unit 1's result. FIRST FILED HERE — see "why this entry exists" below.

**Why this entry exists at all.** This defect was found during BRW-001 and recorded ONLY as prose, in
another epic's design doc, under a heading that says it is not being fixed:
`epics/E8-browser-automation/tickets/BRW-001-design.md` §F3 — *"[P1] (confidence 9/10) — CROSS-LANE.
NOT FIXED HERE, BY DECISION."* It named no ticket and no owner, so it existed in no register, and
`check-finding-ownership.mjs` — the guard whose entire purpose is that noticing has a consequence —
could not see it. It sat there while CLI-006 went green, because shadow mode does not build envelopes.
A finding with no ticket is indistinguishable from a finding nobody had; this entry ends that, and it
is filed even though the defect is now fixed, because the REGISTER is the durable record and a fix
that leaves no trace teaches nobody.

**The mechanism (as verified at `156e2b25e`, matching BRW-001's original trace).** The canary seam
called `resolveExecutionOwner({source, actor, organizationId, idempotencyKey, rolloutState})` with **no
`input` key**. The optional `input` was plumbed end to end and nothing pushed into it:

```
heartbeat.ts               (no `input:`)
  -> heartbeat-distributed-rollout.ts   jobInput: input        (undefined)
  -> run-execution-owner.ts             input: jobInput
  -> job-convert-orchestrator.ts        admitAndSubmit(..., input)
  -> job-admission-bridge.ts            admitAndSubmit(source, actor, key, input = {})
```

So a converted `task_run` got `job.input = {}`. Measured against the frozen schema, `{}` fails
`batchWorkloadV1Schema` on all four fields, `buildJobEnvelope` returns `null`, and the attempt is never
leasable — a SILENT non-lease with the failure surfacing as an absence rather than an error. And had a
lease somehow been offered, `createSpecFor` falls back to `command = workloadType`, so the sandbox would
have run a binary called `batch`.

**Resolution.** `server/src/services/task-run-batch-workload.ts` builds a real `batch` workload (the
adapter's actual binary from `runtimeCommandSpec`, a per-adapter argv shape, the real
`context.currentTaskMarkdown` as the prompt) and the seam pushes it as `input`. A workload that cannot
be built is a REFUSAL, not an empty object: the run resolves
`{owner:"legacy", reason:"workload_unavailable"}` and the legacy executor keeps it.

**What it does NOT resolve.** See E7-F003 — a leasable attempt is the MECHANISM, not the capability.

## E7-F003 — Unit 1's workload is argv-only: a green distributed run proves the mechanism, not that the agent can work

**Status:** open
**Severity:** MEDIUM
**Filed:** 2026-09-01, by Unit 1 (Blocker A+B) on landing the workload builder — filed BY the author of
the thing it limits, deliberately, so the bound is on the record before the campaign reads a green run.

**The bound.** `argv is the only channel into the sandbox`: `createSpecFor` reads only
`workload.command` + `workload.args`, `ExecuteInput` has no stdin, `stdinArtifactId` has zero consumers,
and `workspace` is hard-coded `null`. So the workload Unit 1 emits is deliberately minimal — the binary,
a per-adapter flag set, and the task markdown as one positional argument. Everything the legacy adapters
also pass is ABSENT, and each absence is a real capability gap:

| Absent | Why | Consequence in the sandbox |
|---|---|---|
| `--mcp-config` / `--strict-mcp-config` | names HOST paths that do not exist in the sandbox | no `mcp__aoa__*` tools: no memory, no task updates, no ask-human |
| `--append-system-prompt-file` / instructions bundle | same | no agent identity, role, or company context |
| `--add-dir` / workspace | `workspace` is hard-coded `null` | no repository to work in |
| `renderTemplate(promptTemplate, ...)` | rendering happens INSIDE `adapter.execute`, after the canary returns; the field is DELETED for agents migrated to the instructions bundle | the prompt is raw task markdown with no framing |
| `--model`, permission flags | config-derived fidelity deliberately deferred | provider default model; default permission posture |
| output capture (`observeRun`, `buildWorkspacePatch`) | `observeRun` is not composed; the E5 boundary returns an opaque `stdoutRef` only | NOTHING the agent produces reaches AoA |

**Why this is a finding and not just a scope note.** The acceptance verifier's clause 5 keys on
`attempt_started`, which is emitted after create succeeds. A run with a mutilated or context-free prompt
still creates a sandbox, still executes, still terminalizes, and still SATISFIES the verifier. So the
gap is invisible to the machine check that the campaign will read — which is exactly the shape of defect
this programme keeps producing, and the reason it is written down rather than left in a design doc.

**Owner: CLI-008** (`epics/E7-coding-e2b/tickets/CLI-008-design.md`, no result doc), repointed from
`unowned` on 2026-09-02 after a 39-agent scoping sweep produced the evidence a ticket could be written
from. The previous `unowned` declaration was correct at the time — Unit 2 was sketched in a qa design
with no ticket on disk, and naming a plausible-sounding existing ticket would have been a false claim
of ownership. There is now an honest thing to point at.

**★ The sweep sharpened this finding in two ways.** First, the blind spot is worse than described:
clause 3 is labelled *"Terminal-AGNOSTIC"* in its own comment, so `failed` and `timed_out` are
accepted, and **no clause anywhere reads `workload`, `args`, `exitCode`, stdout or any produced
artifact** — a run that exits 127 satisfies the verifier. Second, and better: **the verifier already
COMPUTES the signal that would catch it.** `countProducedOutputs` counts committed `workspace_patch`
artifacts plus `task_outputs` by run; the result rides on `observed.producedArtifacts` and is
**printed**. It appears at exactly four lines — type, zero-init, assignment, print — and none of the
fourteen `failures.push` calls touches it. Promoting it to an asserted clause is an **S**, and it is
the first unit of CLI-008 because every later unit is judged by this verifier.

## E7-F004 — The canary preflight's inventory is a strict SUPERSET of any reconcile pass's, by construction

**Status:** **resolved** · **Resolved by:** MIG-010 Units 2.4a + 2.4b, 2026-09-02.
**Severity:** HIGH
**Filed:** 2026-09-01, by Blocker E-3 terrain verification at `c7ead3a73` (Units 1.6+1.7 / PR #333).

**Resolved.** The gate's lease inventory is narrowed to the DB-clock snapshot instant of the latest
COMPLETED reconciliation pass, so a lease created after the pass is no longer an unmapped key.
Mechanism, end to end:

* Migration `0269` adds `legacy_reconciliation_passes` — the durable per-Company marker of a completed
  pass, carrying the snapshot instant, the provider-control generation observed, completion, scope and
  a pass identity. `aoa_operator` holds `SELECT, INSERT` and nothing else; `aoa_app` holds nothing.
* `reconcileOrganizationLegacyResources` reads that instant from the DATABASE once, before listing
  anything, and writes the marker as its LAST write for each Company — so a crash leaves "records, no
  marker", which the gate reads as not reconciled.
* `environmentService.acquireLease` stopped stamping `created_at` from the application clock, so the
  watermark comparison is database-clock on both sides (§3.3).
* Migration `0270` DROPs `canary_preflight_evidence_leases(uuid, uuid)` and re-creates it with a
  REQUIRED, no-DEFAULT `p_watermark` returning `(lease_ids uuid[], unnarrowed_total bigint)` — ONE ROW,
  always.
* `canary-preflight.ts` refuses `reconciliation_stale` on a missing marker, on a marker past
  `RECONCILIATION_EVIDENCE_MAX_AGE_SECONDS`, on a superseded marker generation, and on churn
  (`unnarrowed_total > 0` with an empty narrowed set).

★ **The semantics decision this finding asked for, made explicitly.** A lease created *after* the
reconciliation decision is current traffic on the legacy path, not an unreconciled legacy resource, and
it is waved through without a crosswalk record. §9.1 names that residual rather than hiding it: the
freshness window bounds how much of it can accumulate; it does not eliminate it. Two guards bound the
two ways evidence goes stale — the constant bounds TIME, the churn arm bounds FLEET TURNOVER — because
a fleet can turn over completely inside the window.

★ **The Unit 2.2 repro was INVERTED IN PLACE, not deleted**, and its inversion is mutation-proven:
disabling the narrowing (a far-future watermark, nothing else changed) reds both the inverted assertion
and the anti-vacuity twin that pins a PRE-watermark lease still re-closing the gate.

**Item (2) of the mechanism below no longer exists.** Option R (Unit 2.3) removed `casClaimPaused`
entirely, so there is no lost-CAS `continue` and no unrecorded paused row.

**What this does NOT resolve.** Nothing about `unattributable` records, which still refuse
`reconciliation_incomplete` permanently with no remedy in code — design §9.2's operator resolution path
is Unit 2.5, and E7-1 remains gated on the execution substrate besides.

**What.** The gate re-derives its inventory read-only from **live rows** — every lease the Company
currently holds, whatever its status (`canary-preflight.ts:115-122`, `:141`). A reconcile pass's
inventory is fixed at its own snapshot. Two independent mechanisms make the gate's set strictly
larger, so the two can never agree:

1. **Post-pass leases.** `environmentService.acquireLease` inserts a new `environment_leases` row on
   every legacy acquisition (`environments.ts:141-165`), from three sites in `environment-runtime.ts`
   (`:219`, `:578`, `:636`). Any lease created after the pass has no record → `unmapped` → refuse.
2. **Lost-CAS paused rows.** On a lost `casClaimPaused` the pass `continue`s
   (`legacy-resource-reconciliation.ts:347-350`) recording **nothing**, while the row still exists for
   the gate to count → `unmapped` → refuse.

(1) alone makes the gate unopenable on any box taking traffic. `canary-preflight.ts:16-19` describes
this as "self-healing in the safe direction". It is safe. It is also **permanently shut**, which is
not a gate but a wall.

**★ The fix is a semantics decision, not a caller.** A lease created *after* the reconciliation
decision is not an unreconciled *legacy* resource — it is current traffic on the legacy path, and the
rollout flag steers only NEW ownership decisions. Requiring it to carry a crosswalk record is a
category error. Deciding what closure is asserted *as of* changes what this gate may answer, which is
why it is owned by a ticket rather than patched.

**Interacts with E10-F002.** That finding says nothing writes the crosswalk; this one says that even
once something does, the gate still refuses. Both must close for the canary to flip.

**Blocks.** E7-1.

## E7-F005 — A NULL `key_generation` is never "superseded", so the gate's authority check passes vacuously

**Status:** **resolved** · **Resolved by:** MIG-010 Units 2.4a + 2.4b, 2026-09-02.
**Severity:** MEDIUM
**Filed:** 2026-09-02, by the design §12 attack (three lenses converged); confirmed by reading shipped code.

**Resolved, belt and braces, exactly as §13.3 required.** The `records.filter((r) => r.keyGeneration
!== null && …)` clause is GONE: §12 moved the comparison onto the marker, so the vacuous clause no
longer exists to pass vacuously. Where the comparison now lives, the NULL is unrepresentable —
`legacy_reconciliation_passes.key_generation` is `NOT NULL` with an explicit `'ungenerationed'`
sentinel (migration 0269) — and it is still made with `IS DISTINCT FROM` semantics
(`isDistinctFrom` / `isMarkerGenerationStale`), so a future nullable input cannot silently re-open it.

All four §13.3 combinations are pinned in `cli-006-canary-preflight.test.ts`, including the second —
sentinel marker against a real current generation — which is the one every naive implementation gets
wrong, and which SQL `<>` measurably misses. `canary-preflight.ts:150` is UNCHANGED: "no current
generation at all" is a different question and remains correct.

Mutation-proven: deleting the generation arm reds exactly one test.

**What.** `canary-preflight.ts:157-158` filters superseded records as:

```ts
records.filter((r) => r.keyGeneration !== null && r.keyGeneration !== keyGeneration)
```

The `!== null` conjunct means a record whose `key_generation` is NULL is **never** counted as
superseded. `deriveE2bKeyGeneration` returns null for a company with no default e2b
`runtime_provider_keys` row (`e2b-credential-authority-wiring.ts:32`), and the column is documented
as *"Null for an operator-env-default (ungenerationed) company"*
(`legacy_resource_reconciliation.ts:61-65`) — so NULL is a normal, expected value, not a corruption.

**The reachable sequence — no race, no rotation.** Reconcile a company with no BYO e2b key (every
record gets `keyGeneration = null`), then give the company a provider key. The `:150-156` arm does
not refuse, because it fires only when the *current* generation is null. `superseded` is empty
because every record is NULL. The authority half of the acceptance clause passes vacuously — for
exactly the company whose provider-control authority moved **after** its evidence was gathered.

**Why it has not bitten.** The gate is still shut for other reasons (E7-F004), and MIG-008's pass had
no production caller until `597e77715`, so no company has records at all yet. It becomes reachable
the moment operators start running the pass.

**Fix, and why it is owned by MIG-010.** Design §13 settles it: comparisons use `IS DISTINCT FROM`
semantics, and the marker's generation column (Unit 2.4a) is `NOT NULL` with an explicit
`'ungenerationed'` sentinel so the value is unrepresentable there. MIG-010 owns it because §12 moves
this exact comparison onto the marker — fixing it separately would fix the copy that is about to stop
being read.

## E7-F006 — One `unattributable` record refuses the gate forever, and ordinary agent deletion creates one

**Status:** open · **Owner:** MIG-010 (`epics/E10-desktop-migration-realtime/tickets/MIG-010-design.md`, no result doc)
**Severity:** HIGH
**Filed:** 2026-09-02, after Units 2.3 + 2.4 made the path reachable. Flagged BLOCKING by two
independent terrain sweeps and carried in design §9.2 since 2026-09-01 — **but never filed as a
finding, so nothing owned it and `check-finding-ownership.mjs` could not see it.** That is the same
gap that let BLOCKER E sit unowned for MIG-008's entire life.

**What.** `assertClosure` fails on *any* record with disposition `unattributable`
(`legacy-resource-reconciliation.ts:290`), and `resolveResourceType` returns null — producing that
disposition — for a lease that is not `ephemeral` and carries no `agentId`,
`commanderConversationId` or `executionWorkspaceId` (`:95-101`). The crosswalk is **append-only**:
`0256` grants no DELETE, `insertRecordIfAbsent` is `onConflictDoNothing`, and no application code
updates a record. So one such record refuses the canary gate **permanently**, and neither the pass
(insert-if-absent) nor the gate (read-only) can clear it.

**Reachable through ordinary operation, not corruption.** `environment_leases.agent_id` and
`execution_workspace_id` are `references(..., { onDelete: "set null" })`
(`packages/db/src/schema/environment_leases.ts:16,:21`). **Deleting an agent nulls the owner FK on
every lease it held**, turning classifiable leases into unclassifiable ones. A founder removing an
agent is enough.

**★ Why it is filed NOW.** It was latent while the pass had no caller. Unit 2.3 (`597e77715`) gave it
one and Unit 2.4 (`effa591d6`) made the gate read the result — so **we enabled the path that reaches
this trap** and must close it before operators start running passes in earnest.

**Fix.** Design §9.2 settles the shape: a narrow operator command resolving ONE record, using the
`UPDATE` grant `0256` already provisions and no application code uses. It may transition **only**
`unattributable → terminal_cleanup`, never mint `mapped` (an operator asserting "this live resource
is accounted for" is precisely the forgeable claim), requires a non-empty operator justification,
takes one `resourceKey` at a time, and asserts its connected role first. It ships with an amendment
to `legacy_resource_reconciliation.ts:31-32`, which currently states there is no update path in
application code.
