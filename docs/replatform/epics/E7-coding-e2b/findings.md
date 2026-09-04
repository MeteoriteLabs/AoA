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

**★ Unit A landed 2026-09-02 — the blind spot is now COMPUTED. The finding stays OPEN.** The
verifier reports two independent dimensions. `ok` is unchanged: *the distributed journey was
corroborated* — the MECHANISM — and it is still true of a context-free run. `capabilityProven`
is new and answers *did anything the agent produced reach AoA*; its clause-6 failure names what
is unbuilt (the four missing links in the return path) rather than restating that a count was
zero. The RESULT line now carries both verdicts, so neither can be quoted alone, and a
`capability:` block with both counts prints on pass and fail alike.

`capabilityProven` is **false on every real run today**, and that is the intended outcome — the
verifier started telling a truth it already had the data for. The CLI's `--require-capability`
turns an unproven capability into a non-zero exit and is **OFF by default**: `producedArtifacts`
is structurally 0 until Unit F ships a producer, so on-by-default would be a gate nobody can
pass, and `scripts/lib/gate-clause-wiring.mjs` records in its own header what happens to those.
It is the flag the campaign flips once Unit F lands.

**Nothing here is an unblock.** No tools, no instructions bundle, no workspace and no output
capture were built; the capability gap is exactly as wide as it was. What changed is that the
machine now says so, where before only prose did — which is why the finding stays open.

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

**Status:** **resolved** · **Resolved by:** MIG-010 Unit 2.5, 2026-09-02.
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

**Resolved.** MIG-010 Unit 2.5, exactly as §9.2 settled it. `server/src/cli/resolve-unattributable-record.ts`
is the operator remedy — `pnpm resolve:unattributable-record --company <id> --resource-key <key>
--reason "<justification>"`. **No migration:** `aoa_operator` has held `SELECT, INSERT, UPDATE` on the
crosswalk since `0256` and the operator-write policy is `ALL` with `USING (true)`; the grant existed and
nothing used it. This is its first consumer.

* **The transition guard is in the `WHERE` clause**, not in TypeScript — `AND disposition =
  'unattributable'`. The target disposition and cleanup outcome are file constants, not arguments, so
  minting `mapped` is structurally impossible; the predicate makes a second run a no-op rather than a
  silent overwrite, and makes a mistyped `--resource-key` that hits a real row a no-op rather than a
  rewrite.
* **Both guards are mutation-checked** (`mig-010-unit-2-5-unattributable.integration.test.ts`, 12 cases
  on a real migrated database, on the real `aoa_operator` serving role). Removing the `WHERE` predicate
  reds two cases — the `mapped`-rewrite refusal and the idempotence no-op — both failing as the command
  *succeeding*. Deleting the `assertOperatorRole` call reds exactly one, and its failure is the **owner
  run succeeding**, which is the shape that matters: an owner URL bypasses every GRANT and RLS policy,
  so without the assertion the command would work identically had `0256` never granted the operator
  `UPDATE` at all.
* **The record survives its own repair.** `resource_type` stays at the `unattributable` sentinel and
  `cleanup_outcome` is stamped `operator_resolved` (a value the pass never writes), so the row says both
  what the machine could not classify and what the human decided, and a human-asserted terminal record
  stays distinguishable from a machine-derived one. Closure is satisfied because the resource is
  accounted for, not because the register was emptied.
* The `legacy_resource_reconciliation.ts` comment amendment shipped in the same unit, plus two more the
  unit falsified (the SECURITY MODEL's "only the reconciliation pass writes these rows", and the
  `cleanupOutcome` value list).

**★ A CORRECTION TO THIS FINDING'S OWN REACHABILITY CLAIM, measured rather than reasoned.** "Deleting an
agent creates one" is true only when the deletion happens **before** the company's first pass. Reproduced
on a real database (Unit 2.5 Task 1, ORG_B): delete the agent *after* a pass has already recorded the
lease as `mapped`, and `insertRecordIfAbsent`'s `onConflictDoNothing` means the newly-unattributable
record is **never written** — the row on disk stays `mapped`, byte for byte. So that ordering does not
produce the durable trap this finding describes. It produces a different failure, now filed separately as
**E7-F007**: the pass refuses forever while the gate opens, and this remedy cannot touch it because there
is no `unattributable` record to resolve.

**★ This resolves the last item in MIG-010's stated scope, and the canary still cannot flip.** E7-1 is
gated by **E7-F003** (`unowned` — the capability half: no MCP surface, no instructions bundle, no
workspace, no output capture) and by the execution substrate. Nothing here is an unblock.

## E7-F007 — After a post-pass owner deletion, the reconciliation pass refuses forever while the gate opens

**Status:** open · **Owner:** MIG-010 (`epics/E10-desktop-migration-realtime/tickets/MIG-010-design.md`, no result doc)
**Severity:** MEDIUM
**Filed:** 2026-09-02, by MIG-010 Unit 2.5 Task 1, **measured on a real migrated database** rather than
reasoned — the plan's Task 1 Step 2 said "assert what you observe, not what you expect about the second
pass", and this is what was observed.

**What.** `reconcileCompanyLegacyResources` computes closure over the records it **builds in memory**
during the pass, while `canary-preflight.ts` recomputes closure over the records **persisted** in the
crosswalk. Those two sets can disagree, because the crosswalk is append-only:

1. A lease owned by an agent reconciles as `mapped`; the record lands on disk.
2. The founder deletes the agent. `environment_leases.agent_id` is `ON DELETE SET NULL`, so the lease
   survives with no owner FK and `resolveResourceType` can no longer classify it.
3. Re-run the pass. It builds an `unattributable` record and reports `ok: false` — but
   `insertRecordIfAbsent` is `onConflictDoNothing` on `(company_id, resource_key)`, a record already
   exists, and **nothing is written**. The persisted row is still `mapped`.
4. The gate reads the persisted records, finds closure satisfied, and **opens**. The operator's own pass
   exits non-zero, and will on every future run.

**Why it is not simply E7-F006 again.** E7-F006's trap is a durable `unattributable` record: it refuses
fail-**closed** and Unit 2.5 gives it a remedy. This is the mirror — a divergence in the fail-**open**
direction, with **no** record for the Unit 2.5 command to act on. Widening that command to rewrite a
`mapped` record would be exactly the forgeable transition design §9.2 forbids, so it was deliberately not
done.

**Severity, argued.** MEDIUM, not HIGH. The gate is arguably *right*: the record was true when written,
the underlying provider resource is unchanged, and `mapped` means "left for drain" — which is still what
should happen to it. The concrete harm is operator-facing and real: `pnpm reconcile:legacy-resources`
becomes permanently red for that Organization with no command that can make it green, and a permanently
red operator tool is how this programme has historically taught people to stop reading one. It is also a
live contradiction between two computations of the same predicate, which is the class §2 of the design
exists to keep out.

**Fix — not settled, deliberately.** At least three shapes are plausible and they are not equivalent: let
the pass compare against the persisted record and report a `stale_record` outcome distinct from
`unattributable`; give the pass a reconcile-with-existing path (which reopens "a pass that can rewrite its
own verdict is not evidence", design §9.2 option 2, and is probably wrong); or accept the divergence and
make the pass's verdict read from the same persisted records the gate does, so the two cannot disagree by
construction. MIG-010 owns choosing.

**Not a blocker for E7-1.** E7-1 is gated by E7-F003 and the execution substrate.

## E7-F008 — A task whose assembled prompt exceeds 8,192 characters cannot run distributed, and the ceiling is per-ARGUMENT

**Status:** FIXED (CLI-008 Unit D) · **Owner:** CLI-008
**Severity:** MEDIUM
**Filed:** 2026-09-03, by the Unit B channel sweep, which measured it rather than inferring it.
**Closed:** 2026-09-03, by CLI-008 Unit D — not by the remedy this finding proposed.

> ### Closed by REMOVING the prompt from argv, not by chunking it
>
> The finding's own remedy was chunked argv (`sh -c '<script>' _ c1..c10`, 65,306 characters,
> 8× today's capacity, no new channel). Unit D did not do that, and the reason is worth
> recording: Unit D had to stage the instructions bundle anyway — that is its whole job — so
> once a staging channel is carrying one file it may as well carry the prompt, and then the
> per-element ceiling does not apply at all rather than applying 8× further out.
>
> **What changed.** `workload.command` is now `sh` and `args` is a fixed `-c <script>` plus the
> adapter's binary and two constant paths. The assembled markdown rides CLI-008 Unit B's
> staging channel as bytes and the script reads it with a stdin redirect — which is what the
> legacy adapters have always done (`claude --print -`, `codex exec --json -`). The bound that
> replaces `FROZEN_MAX_ARG_CHARS` is `MAX_STAGED_FILE_BYTES` (1 MiB, 128×), which is a sanity
> ceiling on what the control plane pushes into a tenant sandbox rather than a wire limit.
>
> ★ **The refusal was MOVED, not deleted.** `prompt_too_large` became
> `staged_input_too_large` at a much larger bound. Deleting the last size check on content that
> goes into a sandbox would have been the other half of the same mistake, and a reason nobody
> can trip is a false claim of enforcement.
>
> **Measured, not asserted.** The realistic workload's submission payload went from **790 bytes
> to 295** (`cli-008-unit-b-byte-source.integration.test.ts` pins both numbers and says why the
> drop is the change): the payload no longer grows with the task. Prompts at the old cliff + 1,
> at 8× it, and at 100× it now all build and still parse against the frozen schema. Mutation:
> re-applying `FROZEN_MAX_ARG_CHARS` to the prompt reds all three.

**What.** `buildTaskRunBatchWorkload` refuses with `prompt_too_large` when the assembled task markdown
exceeds `FROZEN_MAX_ARG_CHARS = 8192` (`task-run-batch-workload.ts:80, :237-241`), mirroring the
frozen schema `args: z.array(z.string().max(8192)).max(256)` (`worker-protocol/src/job.ts:290-292`).
It is a **refusal, not a truncation** — which is the right direction, but it means such a task simply
cannot run distributed.

**Measured.** Binary-searching the description length through the real
`buildCurrentTaskMarkdown` → `buildTaskRunBatchWorkload`: minimal framing accepts **7,736** description
characters and refuses 7,737; realistic framing (8-char identifier, 60-char title) accepts 7,676; plus
one wake-comment section, **7,437**. The framing overhead is a variable 450-760+ characters, which is
the whole explanation of the "~7.4 KB" figure that circulated before this was measured. The repo's own
audit cap `MAX_PROMPT_SNAPSHOT_CHARS = 16_000` is **2×** the limit, and its comment says real prompts
do exceed it.

**★ The ceiling is PER ARGUMENT, and that changes the remedy.** The protocol allows 8 KiB per element
and ~64 KiB per job. A chunked shape (`sh -c '<script>' _ c1..c10`) carries **65,306 prompt characters
across 11 arguments** at exactly the 65,536-byte submission bound — **8.0× today's usable capacity** —
and the resulting `shellJoin`'d string is 65,464 bytes, still half of Linux `MAX_ARG_STRLEN`
(131,072). So this is fixable **without** any new channel, and independently of Unit B.

**Why it is filed separately from E7-F003.** F003 is about what the sandbox *lacks* (tools, context,
workspace, output). This is a live refusal on the path that exists: a sufficiently detailed task fails
to dispatch today, and the fix is a different shape from anything in C–F.

## E7-F009 — The staged-input fit check measures the wrong set, so the front door is closed and the side door is not

**Status:** FIXED (CLI-008 Unit D) · **Owner:** CLI-008
**Severity:** MEDIUM (latent) · **Filed:** 2026-09-03, surfaced while designing the fix for a Codex P2.
**Closed:** 2026-09-03, by CLI-008 Unit D — the first unit that stages anything at all, which is
what made it worth fixing then rather than later.

> ### Fixed as the finding specified: the UNION, at the call site
>
> `pointerFitsExtension(existing, files, prefix)` now projects the attempt's POST-CONDITION set
> — everything `listForJob` will return after this stage — instead of `input.files` alone.
> `existing` was already resolved two statements above the call, exactly as the finding said.
> Already-committed PATHS are deduped against, because such a file either replays (adding no
> row) or throws `conflicting_restage`, so counting it twice would refuse a bundle that fits.
>
> **Deduping at the reader stayed rejected**, and there is now a mutation that says so: making
> the projection count duplicates — the shape a reader-side dedupe would leave behind — reds
> both lanes.
>
> **Two lanes, because one was not enough.** `cli-008-unit-d-fit-union.test.ts` measures the
> cliff at runtime and asserts the projection; `cli-008-unit-d-fit-union-callsite.test.ts`
> stubs the tenant transaction and proves `stageJobInputFiles` actually HANDS the check the
> committed rows — a correct projection called with the wrong argument being the defect itself.
> The integration lane (`job-input-staging.integration.test.ts`, embedded Postgres) is the
> third, and is CI-only.
>
> ★ **Mutation-proven both ways.** Reverting the argument to `[]` reds both lanes. The
> dedupe-removal mutant initially SURVIVED — the first draft compared two verdicts that were
> both `true` — so the fixture is now sized at the cliff, where a double-count is exactly what
> tips it.

**What.** `pointerFitsExtension` (`job-input-staging.ts:129-145`, called at `:189`) projects
**`input.files` only** — never the accumulated durable set. But the lease offer is built from **all**
committed rows for the attempt: `job-leasing.ts:628` `listForJob` → `:638`
`stagedInputPointersFromRows` → `:399` `stagedInputExtension`.

So repeated stages against one attempt inflate the **real** extension past
`WIRE_EXTENSION_LIMITS.valueMaxCanonicalBytes` (16,384) while **every individual call reports
"fits"**. Then `jobEnvelopeV1Schema.safeParse` fails, `buildJobEnvelope` returns null
(`job-leasing.ts:402-403`), and `:640` throws `JobLeasingError("internal_unavailable")` — **the job
is permanently unleaseable with nothing naming the cause.**

★ **That is verbatim the cliff the refusal was written to prevent.** Commit `21a9fc4dd` added the
check precisely so an over-large pointer set is refused *before a byte moves*, and its docstring
(`:119-124`) says so. **It closed the front door; this is the side door** — reached by the one route
the check does not measure.

**Reachability.** Latent. It needs a producer that stages more than once for an attempt. Its
consequence is strictly **worse** than the duplicate-row defect it was first spotted beside: a dead
job rather than a wrong file.

> **Reachability CORRECTED, 2026-09-03** — this paragraph originally said F009 was *downstream of*
> the duplicate-path defect (the replay probe matches on path AND sha256, so a changed-bytes restage
> minted a second committed row). **That defect is now closed** — `7d345e8b3` refuses a conflicting
> restage rather than superseding it — and F009 **survives it unchanged**.
>
> ★ The route was never the duplicate: a second stage that adds a **DIFFERENT PATH** (files A, then
> A+B, or just B) appends committed rows for the same attempt without the fit check ever seeing the
> accumulated set. Same-digest restages replay and add nothing; different-digest restages now throw;
> **new paths still accumulate.** The projection measures `input.files` no matter which route
> reaches it, which is why the fix is the union and not a dedupe.
>
> ★★ Recorded because the near-miss is the lesson. Closing the neighbouring defect made it
> tempting to read F009 as closed by consequence — and it was written into this register as a
> dependency it never had. A finding whose stated reachability names another defect must be
> re-derived when that defect closes, not retired with it.

**Fix, when built.** `pointerFitsExtension` must project the **union** of `existing` (already
resolved at `:182`) and the new files, not `input.files` alone — a one-argument change, since the
data is already in scope at the call site.

**Filed separately, deliberately.** Deduping at the reader would make this unreachable *by accident*
and leave the projection still measuring the wrong set for any future multi-stage caller — a guard
that happens to be unreachable is a false claim of enforcement. And moving the fit check into
`buildJobEnvelope` was rejected: that refuses at LEASE time, minutes later, which is exactly the
undiagnosable cliff the check exists to move earlier.

## E7-F010 — The staging metric's label was never registered, so every staged run strands non-terminal

**Status:** FIXED `2e77b300f` (CLI-008 Unit B fix wave) · **Owner:** CLI-008
**Severity:** HIGH (was latent; would have been a P0 on the first Unit C/D content) · **Filed and
closed:** 2026-09-03, surfaced while writing the deadline test for a Codex P1-b.

**What.** `supervisor.ts`'s `emitOp` stamps an `operation` label that `assertBoundedLabels` checks
against a **closed allow-list** (`metrics/metrics.ts:81-94`) whose comment names its source: *"the
frozen PROVIDER_OPERATIONS vocabulary"*. `stage_files` is deliberately **not** in that vocabulary —
growing the non-frozen supervisor port and leaving the wire alone was the Unit B decision — so it
never arrived with the eleven others and was never registered. Every `emitOp("stage_files", …)`
**threw**.

★ **And the throw is not contained by the fail-closed arms — it happens INSIDE them.** The failure
arm re-throws from its own `emitOp`, so the escape reaches `accept()`'s last-resort catch, which
emits **NO TERMINAL**. The success path at the end of a healthy stage threw just as readily.
`dispatch-runtime.ts:205` passes a real registry in production, so **every distributed run carrying
staged files would have been torn down and stranded non-terminal** — precisely the outcome the
staging arms' fail-closed handling exists to prevent, reached by the happy path.

**Why it was invisible.** No staging test composed a real metrics registry. The server-side channel
integration test passes none, so `deps.metrics?.inc` was a silent no-op everywhere the channel was
exercised. ★★★ **A metric that nothing ever emits against a real registry is not a metric; it is a
line of code that has never run** — the [[checks-that-nothing-runs]] family, in the one place the
programme keeps rediscovering it.

**Fix.** `stage_files` registered on the `operation` allow-list with a comment saying why it does not
arrive with the frozen eleven, plus a happy-path test on a REAL `createMetrics()` asserting the
success metric is emitted and a normal terminal is reached. Mutation-proven: unregistering the label
reds all four tests in `supervisor-hung-stage-input.test.ts`.

★ **The general lesson is about the OTHER direction of the Unit B decision.** Choosing the
non-frozen port over the frozen vocabulary was right and remains right — but everything keyed to
that vocabulary (allow-lists, conformance suites, registries mirroring `PROVIDER_OPERATIONS`) then
needs a deliberate entry, because nothing adds it for you. Anywhere a new port method is observed
through a structure derived from the frozen list, check the derivation.

---

## E7-F011 — Unit B's channel has no route on the networked/container lane, and the prerequisite exists only as a comment

**Status:** open · **Owner:** CLI-008 · **Severity:** MEDIUM (**corrected down from HIGH** — see the
correction banner) · **Filed:** 2026-09-03 immediately after CLI-008 Unit B merged as `393f7a251`,
**corrected the same day**. Filed against my own work, and then corrected against my own work.

> ### ★★★ CORRECTION — link 4 of this finding was WRONG, and its own citation did not support it
>
> **As filed, this said "the lane that actually ships" and cited `docker/worker/Dockerfile:13` for
> the claim that the shipped image boots the networked-host root. Both are false.**
>
> `docker/worker/Dockerfile:196` is `CMD ["node", "dist/bin/worker-daemon.js"]` — the **local
> daemon** root. The networked tree is copied to `/worker-net-app` under a comment at `:158-159`
> that says in terms: *"DEP-011 Slice 2b's CONTAINER boot root, in its own pruned tree. **Present
> but NOT entered**"*. Line 13, which I cited, is a comment in the header block establishing
> CONTAINMENT of that root in the image — not entry into it.
>
> Three independent sources say the same, and I checked each: `scripts/boot-roots-expectation.json`
> ("the image `CMD` is UNCHANGED and still enters the daemon bin, so no shipped service runs it"),
> `docs/deploy/environment-variables.md:196` ("**Ships inert.**"), and `DEP-010-design.md:704`
> ("reachable only from the networked-host bin, which this CMD does not enter"). Entering it needs a
> per-service `command:` override, and that override is **actively rejected** by
> `scripts/lib/d1-compose-invariants.mjs:503-523` `checkWorkersEnterTheDaemonBin` — with an
> anti-vacuity test asserting the shipped D1 compose does not enter it.
>
> ★ **A second, independent gate I had also missed:** even if the bin *were* entered,
> `worker-networked-host/src/resolve-provider-url.ts:31` returns `{kind:"none"}` when
> `AOA_WORKER_PROVIDER_URL` is unset, so `make-run-provider.ts:86` — the sole construction site —
> never builds a `NetworkedProviderDriver` at all, and dispatch refuses `no_provider`.
>
> **So there is no shipped boot on which "every container-lane run hard-fails".** The defect is
> real; its present reach is not. Severity drops HIGH → MEDIUM, and the headline no longer claims
> the shipping lane.
>
> ★★ **Why this correction is kept in place rather than edited away.** I wrote a finding warning
> that a constraint recorded only in a comment is invisible — and supported its central claim with a
> citation to a comment that says the opposite of what I used it for. The lesson is not "check
> citations"; it is that **a finding filed in a hurry against your own fresh work inherits that
> work's blind spots**, and the register is exactly where that must not stand uncorrected.

**What.** Unit B's staging channel works on the **E2B/desktop** lane and is structurally unreachable
on the **networked/container** lane — which is the one the shipped worker image boots.

The chain, verified link by link:

| # | fact | evidence |
|---|---|---|
| 1 | `stage_files` is **not** in the frozen operation vocabulary — deliberately; that WAS Unit B's decision | `worker-protocol/src/capabilities.ts:142-153` — 8 core + 3 optional, no `stage_files` |
| 2 | the wire's `#post` is typed to that vocabulary, so the driver has **no route** to a remote `stageFiles` | `provider-wire/src/driver.ts` `#post<R>(op: ProviderOperation, …)` |
| 3 | so `NetworkedProviderDriver` declares `fileStagingMode = "none"` and its `stageFiles` **throws** | `driver.ts:93`, `:193-199` — `throw new UnsupportedProviderOperation("stage_files")` |
| 4 | ~~the shipped worker image boots the networked-host root~~ **— REFUTED, see the correction banner.** The shipped `CMD` enters the LOCAL daemon bin; the networked root is present but not entered, and is gated twice over | `docker/worker/Dockerfile:196` + `:158-159`; `resolve-provider-url.ts:31` |
| 5 | the supervisor **fails closed** on a staging throw | `worker-daemon/src/supervisor/supervisor.ts:700` → `stage_input_failed` + `escalateCleanup` |

**So IF the networked lane is entered — a per-service `command:` override plus
`AOA_WORKER_PROVIDER_URL` — AND a producer supplies a staged file, that run terminates
`stage_input_failed`.** Two independent reasons keep it unreachable today: no shipped boot enters
that root (see the correction), and there is no producer anyway — `lease/staged-input.ts:230`
returns `[]` when there are no pointers, so `staged.length > 0` is false and `stageFiles` is never
called.

★ **The fail-closed behaviour in link 5 is CORRECT and must not be "fixed".** Running an agent
without the files the control plane meant it to have produces a clean terminal for mutilated work —
the one outcome nothing downstream can detect. The defect is the missing route, not the refusal.

★★ **The fix is well-scoped but LARGER than I first wrote.** `E2bSandboxProvider.stageFiles`
genuinely works (`e2b-provider.ts:189` `fileStagingMode = "grant_download"`, real implementation at
`:420-444`) and the adapter-manager host root does hold that object
(`adapter-manager/src/bin/adapter-manager.ts:141`). So the remote side can stage.

But it is **not only the driver's TypeScript type**. `adapter-manager/src/server.ts:115-120` — the
raw handler map — holds only `"create"` and `"execute"`, and `GATE_REQUIRED_OPS` at `:88-97` is the
eight core ops. The route regex `/^\/op\/([a-z_]+)$/` would *match* `stage_files`, but both the
gated branch and the handler lookup miss, so it 404s with a `WireProtocolError`. **A route must be
added to the server AND to its capability gate**, not just to the driver. Still no new provider, and
still no change to the frozen vocabulary.

★★★ **WHY THIS IS FILED AS A FINDING RATHER THAN LEFT AS A COMMENT — THE ACTUAL DEFECT.** The
builder knew. `driver.ts:84-92` says it in terms: *"this driver has no wire route to reach a remote
provider's `stageFiles`. Giving the adapter-manager wire an inbound staging route is its own piece of
work; claiming support without one would silently drop every staged file."* That comment is honest
and correct. **But it was the ONLY record.** No finding, no ticket, no gate clause — nothing any
register, any sweep, or any planning session could see. A prerequisite that exists only as prose in
the file that implements the refusal is [[checks-that-nothing-runs]] wearing its politest disguise:
not a false claim of enforcement, but a **real constraint invisible to every mechanism built to
surface constraints**. Unit B's own PR said "the canary still cannot flip" and listed what was
missing; this was not on that list.

★ **It also means one sentence in Unit B's record needs reading carefully.** The gate clause is
honest — it says `wired` means reachable from a boot root, not "runs today", and names the E2B
driver plus the mock transport as what it proved. That is true. What it does not say, and what this
finding adds, is that **the boot root it is reachable from is not the boot root that ships.**

**Sequencing consequence — survives the correction, at lower urgency.** Units C and D were both
described as "now have a channel to ride". **On the E2B/desktop lane they do, and that is the lane
everything runs on today**, so C and D are NOT blocked by this. What this finding buys is the
knowledge that the networked lane will need the route before it is ever entered — so the work
belongs *before* the container lane is switched on, not necessarily before C and D. **Any plan that
schedules C or D must state which lane it targets**; that sentence is the durable output here.

**Not to be confused with E7-F009**, which is about the fit check measuring the wrong set on a
lane where staging *does* work. Both are open; they are independent.

★★ **RELATIONSHIP TO E6-F003 (HIGH, open, owner DEP-011) — this is its residual, not a duplicate.**
E6-F003 is "the networked worker→provider driver API is unspecified"; the route this finding needs
is literally the work E6-F003 exists to cover. Read them together before building either.

★ **And E6-F003's text is now STALE in one load-bearing sentence.** It says *"`adapter-manager` has
zero implementation … and no worker dispatches"*, and concludes that specifying a wire "against an
unimplemented peer for an unbuilt caller" is why deferring is correct. That was true when filed; it
is not true at HEAD. `packages/adapter-manager/src/server.ts` exists and serves `create` and
`execute` through a gated handler map (`:88-97`, `:115-120`), and `packages/provider-wire/src/driver.ts`
is a working client binding — DEP-011/DEP-012 built them. **The deferral's own stated precondition
has therefore partly arrived**, which is exactly the kind of change a finding's reachability must be
re-derived against rather than inherited. Not corrected here because E6-F003 belongs to DEP-011, not
to CLI-008; flagged so its owner can re-derive it.


## E7-F012 — A relative `instructionsFilePath` resolves against two different directories, so the editor can show one file while the agent reads another

**Status:** open · **Owner:** unowned (see `scripts/finding-ownership.json` for the reason)
**Severity:** LOW · **Filed:** 2026-09-03, by CLI-008 Unit D, which HAD to match the shipped
behaviour rather than fix it — and got that wrong once first.

**What.** `adapterConfig.instructionsFilePath` is read by two consumers that disagree about what a
RELATIVE value means:

- **The adapters** (the path that actually runs an agent) pass the raw string to `fs.readFile`:
  `claude-local/src/server/execute.ts:629` and `codex-local/src/server/execute.ts:503`. Node
  resolves that against the **SERVER PROCESS's working directory**. Neither adapter consults
  `adapterConfig.cwd` for this read — that field is the CHILD process's cwd (`execute.ts:192` /
  `:249`), used for spawning.
- **The route-level bundle service** (`agent-instructions.ts:165-174`,
  `resolveLegacyInstructionsPath`) resolves a relative path against `adapterConfig.cwd`, and
  THROWS `unprocessable` when that is absent or itself relative.

So for any agent whose `instructionsFilePath` is relative and whose `adapterConfig.cwd` differs from
the server's working directory, **the Instructions editor reads, lists and writes one file while the
running agent reads another** — or the editor refuses outright while the agent runs fine.

**Reachability.** LOW, and honestly so: every path the product WRITES is absolute
(`syncInstructionsBundleConfigFromFilePath` stores `path.dirname(resolvedPath)` +
`path.basename`, and the managed root is absolute), so a relative value arrives only by direct
`adapterConfig` authoring — the import/export bundle path, a hand-edited config, or a marketplace
package. It is a real inconsistency with a plausible user-visible symptom, not a live incident.

★ **Why CLI-008 Unit D filed it instead of fixing it.** Unit D stages the bundle bytes into the
sandbox and its entire claim is PARITY: the distributed run must read the file the legacy run would.
An earlier draft resolved relative paths against `adapterConfig.cwd` — matching the *editor* — and
cited `agent-instructions.ts:165-174` as "the legacy contract". That citation is real and it is
about the wrong consumer. **The consequence was the sharpest failure available here: a canary could
read a different bundle from its legacy fallback, or SUCCEED where legacy would have failed — a
canary green for the wrong reason**, which is the class this ticket exists to eliminate. Codex
caught it in review; the resolver now passes the configured string through verbatim.

★★ **A unit that "fixes" the path it is measuring against destroys its own evidence.** Changing the
adapters to resolve against `cwd` may well be the right end state — but it changes the SHIPPED
legacy path for every agent, it is not CLI-008's remit, and doing it inside the unit whose claim is
"we now match legacy" would make that claim untestable. Whoever owns agent instructions should pick
ONE resolution rule and apply it at all three sites at once.

## E7-F013 — The codex bundle separator is one newline or two depending on the staged file's trailing newline, so it matches the legacy adapter only sometimes

**Status:** open · **Owner:** unowned (see `scripts/finding-ownership.json` for the reason)
**Severity:** LOW · **Filed:** 2026-09-03, by the CLI-008 Unit D LIVE verification lane —
**observed in a real Linux `/bin/sh`, not argued from source.**

**What.** `task-run-sandbox-invocation.ts` emits, for `codex_local` with a bundle:

```
{ cat "$2"; echo; cat "$1"; } | "$0" exec --json -
```

and its own comment states the reason: *"The legacy adapter joins the two with a blank line … a bare
`cat "$2" "$1"` gives at most the bundle's own trailing newline … Inserting the blank line at the
point of USE rather than baking it into the staged bytes keeps the staged file byte-identical."*

Measured (`od -c` on the bytes the pipeline actually delivered to `$0`'s stdin, Debian `/bin/sh`):

| staged bundle | delivered separator | matches legacy? |
|---|---|---|
| ends **without** `\n` | `…LAST_LINE_OF_BUNDLE\nFIRST_LINE…` — **one** newline | **no** |
| ends **with** `\n` | `…LAST_LINE_OF_BUNDLE\n\nFIRST_LINE…` — a blank line | yes |

The legacy codex adapter is **unconditional**: `codex-local/src/server/execute.ts:505` builds
`` `${instructionsContents}\n\n` `` regardless of what the file ends with. `echo` contributes exactly
one newline, so the shell shape reproduces legacy's blank line only when `cat` already supplied one.

**★ The case the comment names as the motivating risk is the case that does not match.** The comment
singles out a bundle with *no* trailing newline ("a real possibility for an operator-edited file") —
and that is precisely the branch where the distributed path and the legacy path differ.

**What is NOT wrong.** The disaster the `echo` was added to prevent **does not occur**: in both
branches the bundle's last line and the prompt's first line land on separate lines. A bare
`cat "$2" "$1"` would have fused them; this does not. The defect is a parity claim that is
conditionally true, not a fused prompt.

**Reachability.** LOW. The delta is one newline of separation inside a prompt, on the codex adapter
only, only for bundles lacking a trailing newline, and only on the distributed path — which no
production run reaches yet. It is filed because the commit that shipped it states it "addressed" a
Codex P2 "by matching the shipped adapters", and the match is conditional. A LOW that is written
down beats a LOW that is remembered.

**Why unowned.** The fix is a judgement call about the shape, not a gap in it — normalising in the
script (`{ cat "$2"; echo; echo; cat "$1"; }` would overshoot to two blank lines when the bundle DOES
end in a newline; matching legacy exactly needs a trailing-newline-aware shell idiom) changes shipped
Unit D behaviour, and CLI-008's remaining units are C/E/F. Whoever next touches the codex invocation
shape should settle it. **Both branches are now pinned by the live lane**
(`keyed-cli-008-unit-d-invocation.test.ts`), so the behaviour cannot drift while the finding is open.

## E7-F014 — Against real E2B a non-zero exit is THROWN, not returned, so every failing distributed run terminalizes with `exitCode: null` and no message

**Status:** **resolved** · **Resolved by:** the E7-F014 carrier fix, 2026-09-04 (PR #351) — see
**Resolution** at the end of this block, and the ★ carve-out for the half it did NOT fix.
**Severity:** MEDIUM · **Filed:** 2026-09-03, by the CLI-008 Unit D LIVE verification lane.
**Observed in a real E2B sandbox**, not argued: run `33789547290`, log line
`[cli-008 unit-d] non-zero exit carrier = throw, exitCode = 78`. Confirmed a second time by the
mutation run `33790235730`, whose stack trace names the SDK class and the exact line:

```
CommandExitError: exit status 2
 ❯ CommandHandle.wait  node_modules/e2b@2.30.5/src/sandbox/commands/commandHandle.ts:176:13
 ❯ RealE2bTransport.runCommand  src/real-transport.ts:116:22
```

**What.** `MockE2bTransport.runCommand` RETURNS a crashed terminal —
`{ exitCode: 1, crashed: true }` (`mock-transport.ts:130-137`). The real transport does not: the
`e2b` SDK's `commands.run` THROWS `CommandExitError` on a non-zero exit, and nothing on the way out
converts it back:

1. `RealE2bTransport.runCommand` maps **only** a timeout-named error and rethrows everything else
   (`real-transport.ts:123-131`).
2. `E2bSandboxProvider.execute` classifies **only** `E2bTransportEgressBlockedError` and
   `E2bTransportNotFoundError`, then `throw err` (`e2b-provider.ts:297-303`).
3. `supervisor.ts:742-756` catches it and writes the durable terminal:
   `status: "failed"`, **`exitCode: null`**, `errorCode: "execute_failed"`, **`errorMessage: null`**,
   then `escalateCleanup(run, "execute_error")`.

So against real E2B the `ExecuteResult`'s `exitCode` can only ever be **0**, and
`crashed: exitCode !== 0` in `real-transport.ts:122` is **dead code** — the branch cannot be taken.

**What is NOT wrong.** The run still reaches a durable terminal, and a failure is still recorded as a
failure. Nothing is stranded and nothing succeeds falsely. What is lost is **attribution**: the exit
code, the CLI's stderr, and the distinction between "the agent exited N" and "the provider faulted"
all collapse into one `execute_failed` with two nulls.

**★ It defeats CLI-008 Unit D's own acceptance criterion 5**, which reads: *"A worker that ignores the
pointer (it is `critical: false`) produces an **attributable failure**, not a context-free success:
exit 78 with a named cause on stderr."* Measured: the 78 is **not** recorded on the attempt and the
named cause is **not** recorded. The guard runs correctly inside the sandbox and its attribution is
discarded one layer up. Criterion 5 said this was "Met at the script level; the end-to-end exercise
of that path needs a real sandbox and is NOT met in CI" — the real sandbox now says the script level
was the only level at which it held.

**Reachability.** MEDIUM, and it is the COMMON case rather than an edge: a coding agent exiting
non-zero is a failed build, a failing test, a lint error, or the agent's own error exit. Every such
distributed run loses its exit code. It is not HIGH because no run succeeds falsely and none strands.

**★★ The same class as `real-transport-helpers.ts`'s own founding lesson, one layer up.** That file
exists to close *"the 'the mock never execs a shell, so the real bug hid' gap that the first keyed run
surfaced (8/18 real-E2B failures)"*. Here the mock does not merely fail to exercise the path — it
encodes the **opposite** contract, so no amount of no-key testing can surface this, and the keyed
lane had never run a command that exits non-zero. This finding exists because a lane finally did.

**Why CLI-008 / Unit F.** Unit F is output capture — the run's exit code and stderr ARE its output,
and Unit F is the unit that has to make a distributed run's results legible. The minimal remedy is at
the transport: catch the SDK's `CommandExitError` in `RealE2bTransport.runCommand` and return
`{ exitCode, signal: null, timedOut: false, crashed: true }`, restoring the shape the mock already
models and the provider already expects. That is a change to CLI-001's shipped transport and belongs
with whoever next needs the exit code, not with a verification lane.

★★★ **TRACED ONE LAYER PAST THIS FINDING, 2026-09-04 — and that layer promotes it from "a lost exit
code" to a PREREQUISITE for the entire return path.** `packages/worker-daemon/src/supervisor/supervisor.ts`
catches the throw at `:743` and then, before anything else runs:
`emitOp("execute", "failed")` (`:744`) → `events.terminal({status:"failed", exitCode:null,
errorCode:"execute_failed"})` (`:751-756`) → **`escalateCleanup(run, "execute_error")` (`:757`), which
DESTROYS THE SANDBOX** → **`return` (`:758`)**. The normal path only resumes at `:760`
(`emitOp("execute","success")`), so **every step written after `execute` is skipped on every failing
run, with its sandbox already gone.**

Consequences, both load-bearing:

- **It kills every candidate output-capture mechanism EQUALLY** — a redirected file inside the
  sandbox, a provider-side command wrap, a post-run `readFile`, anything read from the command result.
  So it cannot be used to choose between them; it must be satisfied before any of them can work.
- **The runs it destroys are exactly the runs an operator wants output from.** A non-zero exit is a
  failed build, a failing test, a lint error, or the agent's own error exit — which this finding
  measures as the common case.

★ **Therefore CLI-008 Unit F is blocked on this finding, not merely adjacent to it**
([`CLI-008-unit-f-design.md`](./tickets/CLI-008-unit-f-design.md) §3.7, §5). ★ A repair carrying this
finding's own recommended remedy is in progress on the branch `claude/e7-f014-throw-carrier`
(**MERGED 2026-09-04 as `46c27e38b`, PR #351** — see the Resolution below). It depends on nothing in Unit F's
undesigned supply path and is worth landing on its own: it also takes a branch measured **dead** today
(`crashed: exitCode !== 0`, `real-transport.ts:122`) and makes an already-shipped keyed assertion true
end to end (`keyed-cli-008-unit-d-invocation.test.ts:323-325`).


### Resolution — 2026-09-04, PR #351

`RealE2bTransport.runCommand` now narrows on **`CommandExitError`** and returns
`{ exitCode, signal: null, timedOut: false, crashed: exitCode !== 0 }`. The `crashed` expression is
reused rather than hardcoded to `true` on purpose: it was the dead branch this finding names, and
reusing it is what brings it back to life instead of leaving a second, divergent copy of the rule.
`e2b-provider.ts` and `supervisor.ts` are **unchanged** — the carrier fix alone was sufficient, and
the live lane is what establishes that rather than an argument. A converted result stops being an
exception, so the supervisor's execute-catch never sees it, the run reaches its **ordinary** terminal
(`status` computed from the exit code), and the destroy-and-return path is left for genuine faults.

**★ The distinction the fix is built around, and the reason it is not a bare try/catch.** Two things
the old code conflated are now kept apart:

- **(a) the command RAN and exited non-zero** — a normal outcome (a failed build, a failing test, the
  agent's own error exit). Converted to a result, with the status **read off the error object**, never
  defaulted. A `CommandExitError` whose `exitCode` is not a number carries no status and keeps throwing.
- **(b) the sandbox or transport FAULTED** — no exit status was ever produced. Still an exception.

The narrowing is not a guess about the SDK: `CommandExitError` `implements CommandResult` and exposes
an `exitCode: number` getter, and **e2b@2.30.5 draws this exact line itself** inside the same
`CommandHandle.wait()` that throws it — a command that produced no exit status throws `iterationError`
or a bare `SandboxError("Process exited without a result")`, neither of which is a `CommandExitError`.
`instanceof` is also the SDK's own idiom for the narrowing (`isAuthFailure`, `isMissingUpstream`), and
it fails **closed**: anything that is not that class keeps its pre-fix path. Collapsing (b) into (a)
would manufacture a plausible exit code for an infrastructure failure — strictly worse than the defect
being fixed, by this programme's standing rule that a false claim of a result beats no result only in
the wrong direction.

**Proved LIVE against a real E2B sandbox, with a positive control.** Both dispatched at
`keyed-e2b-unit-d.yml`:

| | run | verdict | the measured line |
|---|---|---|---|
| fix (`claude/e7-f014-throw-carrier`, `5fc11469f`) | `33832930572` | **success**, 5/5 | `[cli-008 unit-d] non-zero exit carrier = result, exitCode = 78` |
| ★★★ mutant control (`claude/e7-f014-mutant-control`) | `33832956461` | **failure**, 2 red / 3 green | `[cli-008 unit-d] non-zero exit carrier = throw, exitCode = 78` |

The mutant reverts **only** `real-transport.ts` to `c48259358` and keeps the cases verbatim. It reds
with `AssertionError: expected 'throw' to be 'result'` and `CommandExitError: exit status 42`. The
**same log line** that filed this finding (`carrier = throw`) now reads `carrier = result` on the fix
and reverts to `carrier = throw` on the mutant — a direct before/after on one measurement, not two
different assertions. Critically the **fault case stays GREEN on both** (`[e7-f014] fault carrier
threw = true, returned = "NOTHING_RETURNED"`), so the mutation is targeted: it moves exactly the two
assertions about (a) and does not move (b).

Three cases carry it, all against a real sandbox: a command exiting **42** arrives as a result
carrying 42 (a fabricated code — the SDK's own `1`, the seam's `null` — cannot pass, so the status was
read and not defaulted); a run against a **TERMINATED** sandbox must still throw and must not resolve
to a number; and the original exit-**78** case now **pins** `carrier === "result"`.
`packages/sandbox-e2b-provider/src/real-transport.ts` was added to the lane's `paths`, so reverting
the conversion re-fires the lane rather than passing silently.

**★ WHAT THIS DID NOT FIX — the "and no message" half of this finding's own title.** The exit code
arrives; the **stderr text still does not**, and that is by design one layer up rather than by defect
here. `ExecuteResult` carries `stdoutRef`/`stderrRef` as **opaque references** because
`e2b-provider.ts` holds the E5 rule that *no customer bytes cross this boundary*, and the frozen
terminal payload has no message field of its own. So a failing run's terminal is now
`status: "failed"`, `exitCode: 78`, `errorCode: null`, `errorMessage: null` — attributable by code,
still silent on cause. Note that `errorCode` changing from `"execute_failed"` to `null` is a
**correction**, not a regression: execute did not fail, the command ran and exited 78, and the old
value asserted the wrong thing. Carrying the cause text is **output capture — CLI-008 Unit F**, which
is unbuilt; no separate finding is filed because the silence is an enforced architectural boundary
with an owner, not an undocumented constraint. Unit D's acceptance criterion 5 is therefore **half
met**: "exit 78" is now recorded on the attempt; "with a named cause on stderr" is not.
## E7-F015 — The capability bar is forgeable: one board POST flips `capabilityProven` with no agent, no worker and no sandbox

**Status:** open · **Owner:** CLI-008 (Unit F — terrain filed, **no fix designed**)
**Severity:** MEDIUM · **Filed:** 2026-09-03, by CLI-008 Unit F's terrain pass, before designing
anything that would make an operator start trusting this gate.

**What.** `capabilityProven` — the programme's headline capability verdict — is an OR over two
counters (`server/src/services/e7-distributed-run-verifier.ts:506`, `:522`). One of the two arms is
writable over HTTP by any company-scoped actor, with no provenance check anywhere on the path.

The chain, verified link by link at `d0b75be19`:

1. `countProducedOutputs`'s task-output arm is **one predicate** —
   `.where(eq(taskOutputs.createdByRunId, run.id))`
   (`server/src/services/e7-distributed-run-verifier-store.ts:213-216`). It selects `id` and returns
   `.length`. There is **no** filter on `type`, `provider`, `created_by_agent_id`, `asset_id`, or any
   projection receipt.
2. `POST /api/issues/:issueId/outputs` passes `req.body` straight into `svc.upsertForIssue`
   (`server/src/routes/task-outputs.ts:45,53`), and the router is mounted unconditionally
   (`server/src/app.ts:566`) — outside the `distributedExecutionEnabled` gate.
3. `upsertTaskOutputSchema` admits `createdByRunId: z.string().uuid().nullable().optional()`
   (`packages/shared/src/validators/task-output.ts:50`). Only `type` and `title` are required;
   `assetId`, `artifactId` and `executionWorkspaceId` are all optional.
4. The **only** guard on the field is
   `assertCompanyOwnedRef(db, heartbeatRuns, input.createdByRunId, companyId, "Heartbeat run")`
   (`server/src/services/task-outputs.ts:123`) — the run must merely belong to the issue's company.
   Nothing checks that the caller *is* that run, that the run produced anything, or that the run is
   distributed at all.

So `{"type":"external_link","title":"x","createdByRunId":"<the canary run>"}` satisfies clause 6.

**Reachability.** MEDIUM, and stated honestly rather than inflated. `--require-capability` is OFF by
default (`server/src/cli/verify-e7-1-distributed-run.ts:65`), no workflow or script runs the
verifier, and GO-BOOK §9 currently tells the operator not to pass it — so nothing is being decided on
this signal **today**. But Unit F exists to make an operator start passing it, and both counters are
structurally 0 until then, which means the first time this gate is trusted is also the first time it
matters that it can be forged. It is filed now, and must close BEFORE the bar is made flippable —
which, as the next block records, has not happened.

★★★ **THE FIX THIS FINDING ORIGINALLY RECOMMENDED IS REFUTED. THE FINDING STANDS.** Recorded here,
in the register, because a register that carries a finding at MEDIUM must not carry its remedy at the
same confidence — and because a remedy left standing beside a live finding is what gets built.

**Why tightening the route does not close it.** Tightening `assertCompanyOwnedRef` into "the caller
must be this run" does not work: an agent can stamp its own real run id, and the board route has
legitimate non-distributed users. That part of the original reasoning survives.

**What does NOT survive is the replacement.** The finding's first draft prescribed: *take the
task-output count out of the clause-6 predicate (leaving it observed and printed) and widen the
artifact arm off its `kind = 'workspace_patch'` filter*, on the argument that *"a `job_artifacts` row
can only be written by `commitArtifactVersion` behind a live fence, a verified device proof, an
attempt-scoped object prefix, and a control-plane `headObject`"*. **That argument is false, and the
counter-example is a producer CLI-008 itself shipped in Unit B.** Measured at `611a78bfb`:

1. `buildSandboxInvocation` stages the prompt **unconditionally** on every task run
   (`server/src/services/task-run-sandbox-invocation.ts:163-164`; only the instructions entry is
   conditional, `:165-173`).
2. `stageJobInput({ …, jobId, …, files: stagedFiles })` runs between convert and placement, before
   the attempt is leasable (`server/src/services/run-execution-owner.ts:361-368`, `jobId` from
   `convert.convertRunToJob` at `:340`).
3. `stageJobInputFiles` commits `job_artifacts` rows **directly and fencelessly** —
   `jobId: input.jobId` (`server/src/services/job-input-staging.ts:374`),
   `kind: STAGED_INPUT_ARTIFACT_KIND` (`:381`, `"staged_input"` at `:64`), `status: "committed"`
   (`:382`), `leaseId: null` (`:383`), `fenceToken: null` (`:384`). Its own comment says why:
   *"NO LEASE, NO FENCE … That is the property that makes an inbound write possible at all"*
   (`:366-369`).
4. That job id is the verifier's: `buildHandoffRunPatch` sets `distributedJobId: owner.jobId`
   (`run-execution-owner.ts:237`), and the counter binds
   `eq(jobArtifacts.jobId, run.distributedJobId)` (`e7-distributed-run-verifier-store.ts:206`).
5. Dropping `eq(jobArtifacts.kind, "workspace_patch")` (`:207`) leaves `jobId` (`:206`) and
   `status = 'committed'` (`:208`) — both satisfied by step 3.

**So the widened arm would be satisfied on every converted distributed run by the run's OWN INPUT** —
the prompt bundle the control plane writes *into* the sandbox — with no export, no worker producer
and no agent output. It is **strictly worse than the arm it replaces**: this finding's forgery needs a
deliberate authenticated POST; that one needs nothing, and `capabilityProven` would be `true` by
construction before the agent starts.

★★★ **And that is the SAME CLASS as this finding itself.** The move — *drop one forgeable arm, widen
the other* — produced a differently-forgeable arm on the first attempt, because the widening was
justified by an argument about a **class of writers** while the predicate binds a **class of rows**
(`kind`, `status`, `job_id`), and the census of who writes rows of that shape was never taken. **The
defect is in the move, not in the filter that was dropped**, so narrowing the widening is not a patch
— it is a fresh attempt that needs its own census first. Full chain and consequences:
[`CLI-008-unit-f-design.md`](./tickets/CLI-008-unit-f-design.md) §4.3.

★★ **The axis this finding turns on is PROVENANCE, not probative value.** Both counters are SQL counts
over control-plane rows and neither reads a byte of an artifact, so provenance — *who can cause the row
to exist* — is the only claim clause 6 can honestly make, and it is the axis on which the two arms
genuinely differ **today** (a `task_outputs` row can be written by anyone who can reach the API; a
`kind = 'workspace_patch'` row has no writer but `commitArtifactVersion`). Naming the axis precisely
is what keeps the finding correct; the looser framing — *"the arm is non-probative"* — would disqualify
any candidate replacement too. See `CLI-008-unit-f-design.md` §0. ★ Naming the axis correctly did
**not** make the predicate change safe, which is the transferable half: getting the principle right is
not the same as getting the census right.

★★★ **Removing the arm from the predicate would not withdraw the question it stands for, and only one
pre-existing owner holds it.** `gate-clause-wiring.json`'s `E3-17-output` (`unwired`, symbol
`jobOutputBridge`, "wire at sink cutover (Sprint 6)", `scripts/gate-clause-wiring.json:21-26`, checked
by the required `policy` job) owns the general distributed-job → `task_outputs` projection. There is no
second owner: clause 6's task-output arm is the only *verify-time* enforcement, and it is the forgeable
one. Any future removal moves enforcement from *a clause a verify run prints* to unit tests — weaker in
a specific way, and it must be priced rather than rediscovered (design §1.7).

★ **A second measured consequence, which binds any future fix's release shape.** The artifact arm has
**zero producers today** — the daemon's `artifactCommit` client method
(`packages/worker-daemon/src/transport/client.ts:266,567`) has no production caller, and both shipped
providers declare `artifactExportMode: "none"`. ★ **Updated 2026-09-04 (PR #353): the E2B provider
now declares `"grant_upload"` and implements export for real. THE ZERO STILL HOLDS and the
consequence below is unchanged — producers are counted by who CALLS the export and the commit, not
by who can serve them, and `artifactCommit` still has no production caller.** So removing the
task-output arm without shipping a
producer converts a forgeable gate into an **unpassable** one, which is CLI-008 Unit A's precedent
inverted. **That pressure is exactly what drove the refuted widening**, and it remains unrelieved
(design §1.8, §6).

**Current disposition: OPEN, unfixed, and with no mechanism.** CLI-008 Unit F is the owner and its
supply mechanism is not yet designed (design §4). The reach stays bounded meanwhile —
`--require-capability` is off by default and no workflow runs the verifier — and it stays bounded
precisely as long as nobody makes the bar flippable.

## E7-F016 — Clause 6's operator-facing text misdescribes its own subject: four blamed links (three of which flip neither counter), and a verdict named for more than it proves

**Status:** open · **Owner:** CLI-008 (Unit F — part (a) repairable, part (b) recorded)
**Severity:** LOW · **Filed:** 2026-09-03, by CLI-008 Unit F's terrain pass — which was sent to size
Unit F against this text and found the text wrong about its own subject.

**What.** The reason string at `server/src/services/e7-distributed-run-verifier.ts:509-515` is
printed to the operator beside every verdict and is the programme's standing answer to "what does
Unit F have to build". It attributes the structural zero to four links:

| the text's link | measured at `d0b75be19` |
|---|---|
| "the E2B driver passes no stream handlers" | True (`packages/sandbox-e2b-provider/src/e2b-provider.ts:261-297`) — but the transport **already implements them**: `RealE2bTransport.runCommand(req, handlers?)` binds `onStdout`/`onStderr` to the E2B SDK (`real-transport.ts:107-120`). And wiring them flips **neither** counter: a `log` event is not a `job_artifacts` row and not a `task_outputs` row |
| "`stdoutRef`/`stderrRef` are fabricated literals" | True (`e2b-provider.ts:276,293`) — but making them real IS exporting bytes to object storage, i.e. the same work as the artifact path counted twice, not an independent link |
| "`observeRun` is uncomposed" | True (`packages/worker-daemon/src/lifecycle/dispatch-runtime.ts:178-181`). `RunObservation` is `{logs?, progress?, usage?}` (`supervisor/supervisor.ts:73-77`) — flips **neither** counter |
| "`buildWorkspacePatch`/`createResultCommitter` have zero production callers" | True, and the only one of the four that touches a counter — but it is blocked behind Unit E **and** behind an in-sandbox manifest capture that does not exist: `buildWorkspaceManifest` imports `node:fs` (`snapshot/build-manifest.ts:24`) and walks the DAEMON's filesystem, which on the E2B lane is not where the agent's files are. The text names neither blocker |

Omitted, and decisive: `artifactExportMode: "none"` on **both** shipped providers
(`e2b-provider.ts:178`, `packages/provider-wire/src/driver.ts:83`) — ★ **as of PR #353 the E2B half
reads `"grant_upload"`; the finding is unaffected, since its subject is what the reason string omits,
not whether an omitted link was later built**; no `artifactPrepared` emitter on
`EventSequencer` (seven emitters at `packages/worker-daemon/src/supervisor/events.ts:147,155,162,170,178,206,220`,
while `artifact_prepared` is already frozen at `packages/worker-protocol/src/events.ts:358`); no
**upload-direction** grant consumer in the daemon (the sole `artifactTransferGrant` caller,
`lease/staged-input.ts:242`, is download-only and explicitly rejects a cross-paired
`upload_granted`); and no control-plane projector from durable evidence onto `task_outputs`.

**Reachability.** LOW: it fails no gate and fails open in no direction. It is filed because it is an
**evidence surface** — printed, quoted, and load-bearing for scheduling. It produced CLI-008's XL
sizing for Unit F. ★ The XL *correction* stands — three of the four links flip neither counter, so the
cheapest honest route is not the one the text names. The **L** that a later pass substituted is
**withdrawn**: it was the size of a slice plan since refuted at the predicate
([`CLI-008-unit-f-design.md`](./tickets/CLI-008-unit-f-design.md) §4.3), and Unit F is now UNSIZED.

★★ **The second half, added on review: the VERDICT'S NAME overclaims too.** `capabilityProven` is
computed from two SQL counts over control-plane rows. A row predicate can assert **provenance** —
*these bytes reached durable storage through an attested path* — and can never assert
**productivity** — *these bytes are the work*. Neither arm reads a byte of the artifact. So the name
promises a capability judgement the predicate structurally cannot make, and no candidate replacement
arm changes that — a captured CLI transcript would be non-empty even for a run in which the model
never spoke. Same defect class as the reason string: operator-facing text asserting more than the code
beneath it.

**Fix, and the deliberate non-fix.** Part **(a)** — rewriting the reason string to name the links that
actually gate the counters — is **independent of any predicate change** and survives the refutation of
Unit F's slice plan; it is available to whoever next edits that module. Part **(b)** is **not** fixed by
a rename: `capabilityProven` appears in 15 files across five epics (`grep -rl capabilityProven`), and a
cross-epic rename is churn Unit F has no mandate for. The name's overclaim is therefore carried HERE,
in the register — recorded rather than silently tolerated. ★ Note that rewriting the reason string is a
**text** repair; it does not make the gate honest, because the gate's defect is E7-F015 and that has no
designed fix.

★ **The transferable part.** A failure reason is a claim like any other, and this one was assembled
from symptoms rather than from the predicate directly above it. Three of its four links are true
statements about the system that are **irrelevant to the counter the clause reads** — which is what
made the list feel comprehensive while pointing at the most expensive route. When a clause explains
itself, check each link against the clause's own predicate, not against the subject area — **and
check the clause's own NAME the same way.**

---

## E7-F017 — `isTransferGrantResponsePairedV1` returns TRUE for `"rejected"`, so the staged-input resolver's refusal branch is unreachable and every server refusal is reported as a malformed grant

**Status:** open · **Owner:** DAT-009 slice 3 (found by it; the repair is a one-line reorder in CLI-008 Unit B's module)
**Severity:** LOW · **Filed:** 2026-09-04, by DAT-009 slice 3's design pass — which was reading
`lease/staged-input.ts` in order to mirror it for the upload direction, and would have mirrored this.

**What.** `isTransferGrantResponsePairedV1`
(`packages/worker-protocol/src/transport.ts:350-358`) answers *"is this response outcome paired
with that request operation"*, and its first line is:

```ts
if (responseOutcome === "rejected") return true;
```

which is correct for what it asks: a refusal is a legitimate answer to either direction. But
`lease/staged-input.ts:252-258` uses its negation as the refusal guard:

```ts
if (!isTransferGrantResponsePairedV1("download", body.outcome)) {
  // A `rejected` lands here, and so would a cross-paired `upload_granted`.
  throw new StagedInputUnavailableError(pointer.artifactId, `outcome ${body.outcome}`);
}
const parsed = artifactDownloadGrantV1Schema.safeParse(body.grant);
if (!parsed.success) {
  throw new StagedInputUnavailableError(pointer.artifactId, "malformed grant");
}
```

**A `rejected` does not land there.** `!true` is false, so it falls through to the schema parse
with `body.grant` undefined, fails, and is reported as `"malformed grant"`. The inline comment
asserts a behaviour the code does not have, and **the server's actual reason —
`stale_fence` / `attempt_terminal` / `target_revoked` / `malformed`, which the frozen `rejected`
arm carries at `transport.ts:342` — is discarded**. The operator is told the control plane sent a
malformed grant when it sent a correct, well-formed refusal.

**Reachability.** LOW, and the direction is what makes it low: it **fails closed**. The throw still
happens, the run still fails, no file is staged from a refusal. Nothing is admitted that should not
be. What is lost is **diagnosability** — and only on a path (a refused staged-input download) that
has never run in production.

★ **Why it is filed rather than shrugged at.** It is the same shape as
[`DAT-009-terrain.md`](../E5-workspaces-secrets/tickets/DAT-009-terrain.md) §9's *"a value computed,
handed to the thing that could act on it, and dropped"* — here the value is the refusal reason and
the actor is the operator. And it is **load-bearing for the sibling direction**: DAT-009 slice 3
mints an **upload** grant, whose most likely refusal is `attempt_terminal`, which means *"this ran
outside the lifecycle window"* — the single most probable defect in that new code. Reported as
"malformed grant", it would send the reader hunting a protocol bug instead.

**Fix.** Check `body.outcome === "rejected"` explicitly and FIRST, and carry `body.reason` into the
error. One reorder, no schema change, no frozen change. It is not taken here because this ticket is
E5 work and the module is CLI-008 Unit B's; changing another unit's failure text inside an E5 PR is
the kind of drive-by that makes a diff unreviewable. `packages/worker-daemon/src/lease/artifact-export.ts`
does it correctly on the upload side and pins it with a test, so the two directions now disagree
until this is closed — which is itself the cheapest possible reminder.

★ **The transferable part.** A predicate's NAME told the truth and the CALL SITE read it as
answering a different question. `isTransferGrantResponsePairedV1` answers *"is this pairing legal"*;
the call site needed *"did I get a grant"*. Those coincide for every outcome except the one that
matters. **Before negating a shared predicate as a guard, check it against the case you are actually
guarding against** — and note that the comment beside it was written from the intent, not from the
function.
