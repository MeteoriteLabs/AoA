# MIG-006 — Crew distributed routing seam — design

**Epic:** E10 · **Plan node:** the crew sink cutover (E10-F001 shared prerequisite #1, crew slice)
**Status:** `design` — terrain-verified at HEAD, **ready-to-TDD**. No production code has been written.
**Authored:** 2026-09-18 (post-E7-1), by terrain re-verification against source on `docs/replatform-program`.
**Owner:** unowned — this authors the previously-missing MIG-006 ticket (E10-F001 named it as unwritten).

> ★★★ **AMENDED 2026-09-18 (post-build) — THE SCOPE BELOW IS SUPERSEDED: this is a crew-distributed
> LIFECYCLE EPIC, not a "reuse-heavy, two-piece" seam.** Building it surfaced two decisive facts the
> original terrain (focused on the ownership DECISION machinery) missed:
>
> 1. **`buildCrewBatchWorkload` (slice 1 / §2a) was the WRONG tool and is REMOVED (PR #478).** The crew
>    runner already resolves `agent.adapterType` (`runner.ts:396` `getServerAdapter(agent.adapterType)`) and
>    `runtimeCommandSpec` from it (`:823`), so the seam calls the generic `buildTaskRunBatchWorkload({
>    adapterType: agent.adapterType, … })` **directly**, exactly like the task_run seam (`heartbeat.ts:5303`).
>    The provider-resolving wrapper would re-derive the adapter from the company provider and mismatch the
>    `runtimeCommandSpec` on provider drift.
> 2. **The crew run lives in `internal_agent_runs`, which has NO distributed lifecycle** — no
>    `executionOwner`/distributed columns, and NOTHING projects a distributed terminal onto it. The task_run
>    handoff marker (`markRunHandedOffToDistributed`) and the terminal projection (`canary-terminal-projection`)
>    are **`heartbeat_runs`-ONLY**. So the ownership DECISION reuses, but the LIFECYCLE does not.
>
> **The corrected unit breakdown (each its own scoped build):**
> - **U1 — schema:** distributed markers on `internal_agent_runs` (executionOwner + distributed job/attempt
>   ids) via Drizzle `db:generate` + migration.
> - **U2 — crew handoff marker:** the `internal_agent_runs` analogue of `markRunHandedOffToDistributed`.
> - **U3 — crew terminal projection:** the `internal_agent_runs` analogue of `canary-terminal-projection`
>   (project the distributed attempt's terminal onto the crew run).
> - **U4 — W3a loopback-defer:** record the crew result pending, reconcile when Unit F lands (NEVER drop).
> - **U5 — the seam** (`runAoaAgent`, beside the shadow block at `:842`, before `adapter.execute` `:1165`):
>   `resolveRunRolloutState({companyId, sourceKind:"crew_run"})` → `buildTaskRunBatchWorkload(agent.adapterType)`
>   → `resolveCrewDistributedGate` (**SHIPPED**, slice 2a) → `resolveExecutionOwner` → on `distributed`,
>   `shouldSuppressLegacyExecution` skips the legacy execute + U2 marks handoff + U4 defers the loopback.
>
> **Shipped so far:** the founder-ruled **gate** (separate off-by-default crew flag,
> `AOA_DISTRIBUTED_CREW_ROLLOUT_ENABLED`) — `resolveCrewDistributedGate` + `readDistributedCrewRolloutFlag`
> (slice 2a, **MERGED**). That was the last clean small unit; U1–U5 are the epic.
>
> ★★★ **AMENDED AGAIN 2026-09-20 — THAT LINE IS STALE. FOUR OF THE FIVE UNITS SHIPPED**
> between 2026-09-18 and 2026-09-19, in PRs #486 / #487 / #488, while this document sat
> unmerged. Re-measured at `4df71dada`:
>
> | Unit | State | Where |
> |---|---|---|
> | **U1** schema | ✅ SHIPPED | migration `0282_internal_agent_runs_distributed_marker.sql`; `internal_agent_runs.execution_owner` / `.distributed_job_id` / `.distributed_attempt_id` (`packages/db/src/schema/internal_agent.ts:404-406`) |
> | **U2** handoff marker | ✅ SHIPPED | `crew-handoff-marker.ts` |
> | **U3** terminal projection | ✅ SHIPPED | `crew-terminal-projection.ts` |
> | **U4** loopback-defer | ⚠️ **NOT AS DESIGNED** — see below | — |
> | **U5** seam | ✅ SHIPPED | `runner.ts` MIG-006 block, with a behavioural suppression proof in `crew-seam-suppression.test.ts` (#488) |
>
> ★ **U4 is the one that differs, and the difference is worth stating rather than marking
> done.** The design asked for *"record the crew result pending, reconcile when Unit F lands
> (NEVER drop)"*. What shipped instead fires the W3a loopback ONCE, at terminal time, from
> inside the projector — `crew-terminal-projection.ts` step (2), *"the W3a loopback the
> suppression return skipped"*. The result is **not dropped**, which was the requirement that
> mattered; but it is **not deferred-and-reconciled** either, and its own comment records the
> cost: *"the loopback's own summary shows duration only (the distributed lane surfaces no
> adapter usage to this seam)"*. **There is no mechanism to enrich that loopback when Unit F
> lands.** A founder reading a distributed crew thread sees a completion with no result
> content, permanently.
>
> ★ **This document is therefore the DESIGN and the as-built record**, landed late. MIG-006
> still has no `-result.md`; that remains owed. Until Unit F's emit half exists, the whole
> epic stays mechanism-only and doubly gated (Unit C tool-less, Unit F result-deferred) —
> §4's caveat is unchanged and is the reason none of this is on by default.
>
> **★ CRITICAL CAVEAT (unchanged): a distributed crew run is MECHANISM-ONLY** — tool-less (Unit C) and
> result-deferred (Unit F) — so this whole epic is foundational-but-inert until C+F are closer. Do NOT
> build it ahead of them; the payoff is gated (§4).
>
> **Still valid below (do not re-derive):** §1 terrain (the ownership/convert/placement machinery IS
> source-agnostic and reusable), the seam LOCATION (`:823`/`:842`), the rollout-hook shape, and §4's
> doubly-gated caveats. **Superseded:** §2a (`buildCrewBatchWorkload`) and §6's "two new pieces / first
> slice = (a)" framing.

> **★ Read this first.** This is the crew half of E10-F001's shared prerequisite #1 ("a distributed
> routing seam for non-`task_run` sources"). It is scoped **crew-first** because crew is the one sink
> that already **rides the mint** for a v1-provider company (E10-F001 crew bullet). Two properties of
> this ticket are load-bearing and stated up front so they are not mis-read as omissions:
>
> 1. **This seam delivers DISPATCH + EXECUTE + TERMINAL for crew on the distributed substrate — the
>    same envelope E7-1 proved for `task_run` — and NOTHING MORE.** It is **doubly gated** (§4): the
>    in-sandbox crew agent has **no `aoa` MCP tools** (CLI-008 Unit C, unbuilt) and its **result does
>    not flow back** (CLI-008 Unit F / `jobOutputBridge`, producer-blocked — see E10-F001 crew bullet
>    and the E3-F037 producer-gap finding). A distributed crew run is therefore **mechanism-only**
>    until C + F land, exactly as the proven E7-1 `task_run` run is.
> 2. **The routing seam is SMALLER than "build the routing seam" implies.** The ownership/convert/
>    placement machinery and the workload builder are **already source-agnostic** (§1). The only new
>    code is a thin pure workload adapter (§2a) and the seam in the crew runner (§2b).

---

## 0. Scope

**In scope.** Make a `crew_run` (a `runAoaAgent` dispatch) resolve the **single execution-ownership
decision** and, when it resolves `distributed`, execute on the distributed substrate (lease → sandbox
→ terminal) **instead of** the legacy in-process `adapter.execute`, with the legacy path suppressed —
the crew analogue of the `task_run` seam at `heartbeat.ts:5290-5509`.

**Out of scope (named so they are not silently assumed).**
- The **result loopback** for a distributed crew run (W3a `relayCrewResult` / `postCrewRunSuccess`) —
  gated on **Unit F** (`jobOutputBridge` is producer-blocked). §4.
- The **in-sandbox `aoa` MCP tools** for the crew agent — gated on **Unit C** (unbuilt). §4.
- The **extraction** (`one_shot`, MIG-007) and **Commander** (`commander_turn`, MIG-005) sinks — each
  has its own credential/routing gap (E10-F001). This ticket touches only `crew_run`.
- The **mint-runner generalization** (E10-F001 prerequisite #2) — crew rides the mint as-is for a
  v1-provider company, so it is **not** on crew's path.

---

## 1. Terrain — what is already reusable (measured at HEAD)

The single most important terrain fact: **E10-F001's parenthetical "`run-execution-owner.ts` is
task_run-shaped" is imprecise.** Re-measured, the ownership decision and the workload builder are both
source-agnostic; the only `task_run` coupling is the heartbeat CALLER and the workload builder's
INPUTS (which the caller supplies).

| Reusable as-is | Symbol / location | Why it is generic |
|---|---|---|
| Ownership decision | `createRunExecutionOwnerResolver` → `resolve` (`server/src/services/run-execution-owner.ts:278` / `:284`) | Takes a generic `source: SubmitJobSource` and passes it straight through `convert.convertRunToJob({ source, … })`; there is **no `task_run` branch** in the file (its comment `:162-171` says the workload builder lives in the seam, "not by `resolve`"). |
| Convert orchestrator | `createJobConvertOrchestrator` (`server/src/services/job-convert-orchestrator.ts:45`) | `bridge.admitAndSubmit(source, actor, idempotencyKey, input)` — generic over source. |
| Admission bridge | `job-admission-bridge.ts` | Already maps `crew_run` (and `commander_turn` / `one_shot` / `browser_request` / `service_reconcile`). |
| Workload builder | `buildTaskRunBatchWorkload` (`server/src/services/task-run-batch-workload.ts:267`) | **PURE + synchronous**; takes `{ adapterType, runtimeCommandSpec, adapterConfig, currentTaskMarkdown, instructions }` — none intrinsically task_run — applies the v1-scope gate (`dispositionForAdapter(adapterType).bucket !== "v1"` → `adapter_not_v1_scope`, `:280`) and delegates argv/staging to the generic `buildSandboxInvocation`. |
| Crew adapter resolution | `resolveCrewAdapterFor(provider, modelOverride)` (`server/src/services/internal-agent/aoa-agents/resolve-crew-adapter.ts:31`) | `anthropic→claude_local` / `openai→codex_local` (v1, RIDE); `google→gemini_local` / `opencode→opencode_local` (non-v1). |
| Mint (crew rides it) | E10-F001 crew bullet; principal `{kind:"worker", id:agentId}` | For a v1-provider company the mint issues a Company `provider_key`; `google`/`opencode` refuse `adapter_not_v1_scope`. |

**The `task_run` seam pattern to mirror** (`heartbeat.ts:5290-5509`): resolve the instructions bundle →
`buildTaskRunBatchWorkload(...)` → `distributedRolloutHook.resolveExecutionOwner({ source, actor,
organizationId, idempotencyKey: run.id, rolloutState, input: workload, stagedFiles })` → the DE-20
cutover-selection audit (one site, both arms) → on `distributed`: `markRunHandedOffToDistributed` +
`return; // CLI-006-SUPPRESSION-RETURN` (`:5509`); on `legacy`: fall through to `adapter.execute`.

**The crew runner** `runAoaAgent` (`server/src/services/internal-agent/aoa-agents/runner.ts`, ~1860
lines) executes **legacy in-process today** and has **no ownership seam** (only
`recordDistributedShadow`). Its relevant anchors: `acquireExecutionContext` (`:716`, yields the
adapter execution context incl. the runtime command spec), the issue checkout (`:314`,
`issueService(db).checkout(...)`), the assembled prompt (`triggerPrompt` / `promptTemplate`,
`:812-813`), and the single `adapter.execute` call (`:1165`).

---

## 2. The two new pieces

### 2a. `buildCrewBatchWorkload` — a pure workload adapter (FIRST, standalone, TDD-able)

A pure function that maps crew config to the generic builder's input, then delegates. It reuses
`buildTaskRunBatchWorkload` rather than duplicating it, so the v1-scope gate, the frozen-schema
validation, the staging bounds and the attributable refusals are inherited unchanged.

```ts
// server/src/services/internal-agent/aoa-agents/crew-batch-workload.ts  (new)
export interface CrewBatchWorkloadInput {
  readonly provider: string | null | undefined;   // internal_agent_config.provider
  readonly crewModel?: string | null;             // internal_agent_config.crew_model override
  readonly runtimeCommandSpec: { readonly command?: unknown } | null | undefined; // resolved by caller (pure input)
  readonly currentTaskMarkdown: unknown;          // the crew run's assembled prompt (triggerPrompt)
  readonly instructions?: string | null;          // the crew agent's instructions bundle entry, or null
}

export function buildCrewBatchWorkload(input: CrewBatchWorkloadInput): BuildTaskRunBatchWorkloadResult {
  const { adapterType, adapterConfig } = resolveCrewAdapterFor(input.provider, input.crewModel);
  return buildTaskRunBatchWorkload({
    adapterType,
    runtimeCommandSpec: input.runtimeCommandSpec,
    adapterConfig,
    currentTaskMarkdown: input.currentTaskMarkdown,
    instructions: input.instructions ?? null,
  });
}
```

**Why pure / why `runtimeCommandSpec` is an INPUT, not resolved inside.** `buildTaskRunBatchWorkload`
is pure by contract (the idempotency digest hashes the whole workload; a clock/nonce/registry read
would 409 a retry — `task-run-batch-workload.ts:36-40`). Resolving the binary needs the adapter
registry (I/O). So the caller (the seam, §2b) resolves it via `acquireExecutionContext` and passes it
in, exactly as the heartbeat seam passes `runtimeCommandSpec` at `heartbeat.ts:5304`.

**Why it is a named unit and not two inline lines.** It encapsulates the crew adapter decision and the
v1-scope refusal as one tested contract with an attributable result, matching this repo's idiom
(`toRunExecutionPlacement`, `browser-job-config.ts`). Its `google`/`opencode` arms return
`{ ok:false, reason:"adapter_not_v1_scope" }` through the inherited gate — the same refusal the mint
would give — so the seam has one place to read "this company's crew cannot go distributed".

### 2b. The crew seam in `runAoaAgent`

Insert **before** `adapter.execute` (`runner.ts:1165`), **after** `acquireExecutionContext` (`:716`,
for the runtime command spec) and the issue checkout (`:314`). Mirror the task_run seam:

1. Resolve the crew instructions bundle (the crew analogue of `resolveTaskRunInstructionsBundle`; a
   configured-but-unreadable bundle is a **refusal**, not an absence — `heartbeat.ts:5290-5299`).
2. `const workload = buildCrewBatchWorkload({ provider, crewModel, runtimeCommandSpec, currentTaskMarkdown: triggerPrompt, instructions })`.
3. `const owner = workload.ok ? await resolveExecutionOwner({ source: { kind: "crew_run", … }, actor: { kind: "agent"/"worker", id: agentId, companyId }, organizationId, idempotencyKey: runId, rolloutState, input: workload.workload, stagedFiles: workload.stagedFiles }) : { owner:"legacy", reason:"workload_unavailable", detail }`.
4. Write the DE-20 cutover-selection audit (one site, both arms).
5. `if (shouldSuppressLegacyExecution(owner)) { markRunHandedOffToDistributed(...); /* crew loopback deferral — §4 */ return <suppressed-result>; }` — the crew analogue of `CLI-006-SUPPRESSION-RETURN`.
6. Else fall through to `adapter.execute` exactly as today.

---

## 3. Load-bearing design points (verify each at build time)

- **Fail-safe is ALWAYS legacy.** Every refusal / throw resolves to `owner:"legacy"` and the crew run
  executes in-process as today. Never "neither" (a dropped run), never "both" (double execution) —
  `run-execution-owner.ts` Invariants 1-2.
- **Suppression reads the stored owner, never re-derives** (`shouldSuppressLegacyExecution`,
  `run-execution-owner.ts:204`). One value computed once; placement and suppression cannot disagree.
- **Checkout parity — the one genuinely new reconciliation.** `runAoaAgent` checks out the issue at
  `:314`; the convert's `admitAndSubmit` ALSO drives an **in-transaction** checkout for `task_run`
  (`job-convert-orchestrator.ts:11-14`, Invariant 3), and the heartbeat seam **suppresses** its own
  harness checkout for active runs so the bridge's is the one checkout. **Decision for build:** either
  (a) let the crew convert drive the checkout and suppress the runner's `:314` checkout for a
  converted crew run, or (b) keep the runner's checkout and have the crew `crew_run` submission path
  NOT re-check-out. Whichever, there must be **exactly one** checkout — a double checkout is a 409 or a
  double-assignment window. This is the crew-specific integration risk and must be pinned first.
- **Ordering:** placement is LAST (it is what makes the attempt leasable); nothing that can fail back
  to legacy runs after it (`run-execution-owner.ts:22-27`).
- **Idempotency:** `buildCrewBatchWorkload` is pure; `idempotencyKey = runId`; a byte-identical
  resubmission must produce a byte-identical workload (no clock/nonce).

---

## 4. Doubly-gated caveats — state honestly, do not paper over

1. **Unit C (in-sandbox MCP tools) — the crew agent runs TOOL-LESS.** The distributed sandbox
   invocation carries **no `aoa` MCP config** (Unit C unbuilt), so the crew agent in-sandbox cannot
   call `mcp__aoa__*` (`use_skill`, `ask_human`, `write_memory`, …). This is identical to the proven
   E7-1 `task_run` run. **Design decision for the founder:** accept mechanism-only crew distributed
   runs (like E7-1), OR gate crew-distributed OFF until Unit C so a crew agent never runs stripped of
   its tools. The seam must make this an explicit, single, auditable decision — not an accident.
2. **Unit F (results) — the crew result does NOT flow back.** W3a's loopback
   (`relayCrewResult` / `postCrewRunSuccess`) rides `jobOutputBridge`, which is **producer-blocked**
   (E10-F001 crew bullet; E3-F037 producer-gap finding — the deployed worker emits no artifact/result
   evidence, ~~`observeRun` uncomposed~~ ★ *corrected 2026-09-23 (record custodian): `observeRun` IS
   composed at HEAD — `WRK-018` (PR #546), `composeDispatchRuntime` sets
   `observeRun: createUsageObserver({ metrics })`. **The conclusion is unchanged:** the observer emits
   `usage` only and never re-emits stdout or the transcript, so it produces no ARTIFACT or RESULT
   evidence for `jobOutputBridge` to consume, and the loopback stays producer-blocked on Unit F*). So
   on `owner:"distributed"` the loopback must be **deferred**
   (recorded as pending, reconciled when Unit F lands), NOT silently dropped — a dropped crew result
   is the crew analogue of extraction's "zero extracted items" data-loss bug (E10-F001 extraction
   bullet). Step 5 of the seam owns this deferral.

**Net:** a distributed crew run reaches a terminal on the substrate, tool-less, with its result parked
pending Unit F. That is real (it extends the proven mechanism to `crew_run`) and it is foundational
(every sink needs this seam), but it is **not** an end-to-end crew cutover. The rollout dial must not be
armed for crew traffic until C + F, and the seam should default OFF for crew accordingly.

---

## 5. Acceptance criteria + fail-first test plan

**Environment note (binding).** This worktree has **no `node_modules`** (deep-OneDrive `ENAMETOOLONG`
blocks `pnpm install`); vitest cannot run locally. **CI is the test gate** — TDD is CI-based: land the
failing test (RED on the `verify` shard), then the implementation (GREEN). Do not claim a local green.

**2a `buildCrewBatchWorkload` — pure unit, `crew-batch-workload.test.ts` (8 arms, fail-first):**

| # | arm | assertion |
|---|---|---|
| 1 | `provider:"anthropic"` + valid command + prompt | `ok:true`; workload `command` is the resolved claude binary; argv is the claude shape; `adapterConfig.dangerouslySkipPermissions` rode through |
| 2 | `provider:"openai"` + valid command + prompt | `ok:true`; codex shape |
| 3 | `provider:"google"` | `ok:false, reason:"adapter_not_v1_scope"` (gemini_local is non-v1) |
| 4 | `provider:"opencode"` | `ok:false, reason:"adapter_not_v1_scope"` |
| 5 | empty / whitespace `currentTaskMarkdown` | `ok:false, reason:"empty_prompt"` |
| 6 | `runtimeCommandSpec:null` | `ok:false, reason:"no_runtime_command_spec"` |
| 7 | `crewModel` override that is `SAFE_MODEL_RE`-valid | override lands in the workload; an unsafe override falls back to the adapter default |
| 8 | determinism | two identical inputs → byte-identical workload (idempotency digest) |

**2b the seam — integration (`runner` distributed seam, embedded-PG, CI):** a canary-org crew run
resolves `owner:"distributed"` and does **not** call `adapter.execute`; a non-canary crew run resolves
`owner:"legacy"` and executes in-process unchanged; a `buildCrewBatchWorkload` refusal (google/opencode
company, or empty prompt) resolves `legacy` with the attributable `detail`; exactly one issue checkout
occurs. Every guard **positive-controlled** (a removed suppression / a removed checkout-parity guard
reds a named test).

---

## 6. Build order (slices)

1. **`buildCrewBatchWorkload`** (§2a) — pure, standalone, TDD via CI. Enroll it honestly in
   `scripts/gate-clause-wiring.json` as **dormant** (`unwired`, 0 callers) until slice 2 wires it, so it
   is tracked, not falsely claimed complete (this program's dormant-symbol convention).
2. **The crew seam** (§2b) — wires slice 1 into `runAoaAgent`; resolve the **checkout-parity** decision
   (§3) FIRST; this is the substantive integration.
3. **The Unit-F loopback deferral + the Unit-C gate decision** (§4) — the two founder-facing gates.

---

## 7. Open questions (founder / build-time)

1. **Unit-C gate (§4.1):** accept mechanism-only tool-less crew distributed runs (like E7-1), or keep
   crew-distributed OFF until Unit C?
2. **Unit-F loopback (§4.2):** confirm "defer + reconcile", not "drop", for a distributed crew result.
3. **Checkout parity (§3):** convert-drives-checkout vs. runner-keeps-checkout — pin before slice 2.

---

## 8. Cross-references

- E10-F001 (`../findings.md`) — shared prerequisite #1 (this is its crew slice) + the crew bullet.
- E3-F037 (`../../E3-job-control/findings.md`) — the producer gap that gates the crew result loopback.
- CLI-008 Unit F (`../../E7-coding-e2b/tickets/CLI-008-unit-f-design.md`) + Unit C — the two gates.
- The `task_run` seam pattern this mirrors: `heartbeat.ts:5290-5509`; `run-execution-owner.ts`.
