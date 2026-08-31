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

**Not owned.** Unit 2 ("capability") is scoped in `qa/2026-08-31-blocker-ab-fix-design.md` but has no
ticket on disk. Declared `unowned` in `scripts/finding-ownership.json` rather than pointed at a
plausible-sounding existing ticket: a false claim of ownership converts an open question into a settled
one, which is worse than an honest gap.
