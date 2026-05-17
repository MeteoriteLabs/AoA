# AoA Agents Framework — Commander + sub-agents as first-class agents

> **Status:** Draft for review (2026-05-17)
> **Author:** brainstorming session, branch `commander-subagent-1`
> **Supersedes:** DA-27 (partial), Decision #95 (resolves the deferral), Decision #99 (extends)
> **Depends on:** the backend already shipped on `commander-subagent-1` (M1–M6: `agents.kind`, atomic claim, durable extraction sweeper, consumer, platform agent, budget path)

---

## 1. Goal

Make the Commander agent and its sub-agents **first-class, visible, configurable AoA agents** with dedicated pages modeled on the existing worker-agent detail page, so that a growing team of internal automation agents can be added on one consistent foundation.

One sentence: **AoA agents = `agents` rows of `kind='aoa'`, trigger-driven (not heartbeat/task), executed through the proven worker adapter layer via a new no-task runner, surfaced in a Commander-Team sub-tab and per-agent detail pages — reusing pause/budget/config-revision/skills/RBAC/audit machinery rather than rebuilding it.**

## 2. Why this exists (context — read before judging scope)

The backend on this branch (M1–M6) shipped a single, deliberately **hidden**, headless discussion-extraction sub-agent (Decision #99, `kind='platform'`, excluded from all UI). During visual verification the user found there is **no UI** for Commander/sub-agents and that the intended product is a *visible, growing team* of internal agents with worker-agent-style pages.

This was a deliberate re-scope decision: Decision #95 deferred the "team-under-Commander" framework "until a concrete consumer exists … design alongside the actual consumer." That consumer now exists (the extraction sub-agent) and the product need is concrete. This spec is that framework. It consciously **supersedes**:

- **DA-27** stated internal agents deliberately have: (a) a run table separate from `heartbeat_runs`, (b) no queue, (c) no atomic checkout, (d) no adapter abstraction, (e) no wakeup/assignment lifecycle. This framework **supersedes (b), (c), (d), and the *wakeup* half of (e)** — AoA agents get atomic-claim dispatch, the worker adapter layer, and trigger/wakeup. It **keeps (a)** (runs stay in `internal_agent_runs`) and **keeps the *assignment/task* half of (e)** (no founder-managed issue/task lifecycle). Rationale: DA-27's "no adapter / no queue" was correct when internal agents were only Commander's chat loop; a growing automation team needs real agentic execution, the adapter registry is the proven path, and Commander's `cli-mode.ts` is currently not working, which removes it as the basis.
- **Decision #95** — resolved: the access/permission model it deferred is designed here (§9), now that the concrete consumer exists.
- **Decision #99** — extended: the durable transactional-outbox trigger and the per-company platform agent generalize into this framework; the extraction sub-agent becomes the first migrated citizen.

These supersessions are recorded as a new locked decision (§13) — not relitigated silently.

## 3. Locked decisions from brainstorming

| # | Decision |
|---|---|
| L1 | AoA agents are first-class `agents` rows, `kind='aoa'`. Non-heartbeat, non-task; **trigger-driven**. |
| L2 | They **inherit** existing `agents`-keyed machinery: status/pause/resume, budget auto-pause, `agent_config_revisions`, skills, the `AgentDetail` page, RBAC, `activity_log` audit. |
| L3 | **Uniform execution (LOCKED 2026-05-17, §7):** EVERY AoA agent (Commander, extraction, future) runs through the existing **worker CLI adapter** via a new no-task runner (prompt from `instructions + skills + trigger payload`, not an issue). Structured results persisted by the agent calling **MCP tools via the internal-agent bridge** (not stdout parsing). **No hybrid / no `structured_llm` executor.** Provider-SDK is reserved strictly for non-agent **primitives** (embeddings, transcription) as utility services — never agents, never in the registry (Decision #91-consistent). |
| L3b | Commander/member discriminator = `kind='aoa'` + `runtimeConfig.aoa.role` (`'lead'`\|`'member'`). **Do NOT overload `agents.role`** (special-cased: `canCreateAgents===cxo`, 0070 tiers). Skills/instructions are **marketplace-seeded** ("comes with the app"). |
| L4 | **Commander is also a `kind='aoa'` row** — the team lead. Its existing chat loop (`agent-loop.ts` → conversations/SSE) is **preserved untouched** as its `'conversation'` trigger. `internal_agent_config` becomes Commander's linked config payload. |
| L5 | Dispatch substrate = generalized Decision-#99 transactional-outbox poll + Routines (cron) + events + `@mention`/directive → wakeup. One substrate built on existing `agent_wakeup_requests` + `internal_agent_runs`. **No separate task board.** |
| L6 | Commander↔sub-agent delegation = a wakeup/run-request carrying an instruction payload. A "Commander Team activity" view renders over `agent_wakeup_requests` + `internal_agent_runs`. |
| L7 | `@mention` of AoA agents works by **including `kind='aoa'`** in mention-resolution (the inverse of the M1 `kind='org'` filter). |
| L8 | UI: the **Team** page gets a **Commander Team** sub-tab listing Commander + AoA agents; each opens an `AgentDetail`-style page (Overview / Instructions / Skills / Runs / Config / Triggers). |
| L9 | The existing extraction sub-agent is **migrated** onto this framework as the reference citizen; its #99 durable trigger is preserved as one trigger type. |
| L10 | Scope = full-enterprise-v1 **via maximal reuse** (~70–75% is wiring existing infra). |
| L11 | **Forward-compatible:** the trigger taxonomy is additive. A future `task` trigger type (Commander-team work board, or issue integration) can be added later **without** re-architecting the spine. |
| L12 | **Definition of Done = real output (§17).** v1 is done only when Commander + the migrated extraction sub-agent are visible/configurable in the UI and the extraction agent produces **real extracted items end-to-end** through a configured adapter — not a stub. Acceptance requires a provisioned credential/adapter (a gated acceptance, not a credential-less unit test). |

## 4. Architecture overview

```
                    ┌─────────────────────────────────────────────┐
                    │  agents (kind='aoa')                          │
                    │   • Commander  (lead; trigger='conversation') │
                    │   • Extraction (trigger='event'/outbox)       │
                    │   • <future AoA agents…>                      │
                    └───────────────┬───────────────────────────────┘
   triggers ─────────────────────────┤
   • outbox poll (discussion pending) │  AoA Dispatcher (generalized #99 sweeper)
   • routine / cron                   │   - poll trigger sources
   • event                            │   - atomic claim (multi-worker safe)
   • @mention / directive → wakeup    │   - bounded concurrency limiter
   • conversation (Commander chat)    │   - per-company fairness seam
                                      ▼
                       ┌──────────────────────────┐
                       │  No-task Runner            │
                       │  prompt = instructions     │
                       │       + skills             │
                       │       + trigger payload    │
                       └────────────┬───────────────┘
                                    ▼
                       Worker Adapter Registry  (claude_local, codex_local, …)
                                    ▼
                       internal_agent_runs  (+ cost_event → budgetService)
```

Commander's `'conversation'` trigger does **not** go through the no-task runner — it keeps the existing `agent-loop.ts` chat path. The runner is for non-chat triggers (event/routine/delegation). Both write `internal_agent_runs`.

## 5. Data model

Reuse-first. New structures are minimal.

### 5.1 `agents.kind` — add `'aoa'`
Currently `'org' | 'platform'` (migration 0098). Add `'aoa'`. Additive, backfill-safe (existing rows stay `'org'`). The M1 `kind='org'` filter on worker enumerations stays; AoA agents are surfaced only via the Commander-Team sub-tab and mention-resolution (§7, §8).

### 5.2 AoA agent fields (reuse existing `agents` columns)
- `instructions` — reuse the existing agent instructions provision (the `AgentInstructionsTab` already renders/edits agent instructions for `kind='org'`; same column/table applies to `kind='aoa'`).
- skills — reuse company-skills assignment (the existing `Skills` tab on `AgentDetail`).
- adapter — reuse `agents.adapterType` / `adapterConfig`.
- budget — reuse `agents.budgetMonthlyCents` / `spentMonthlyCents` + the `cost_events`→`budgetService.evaluateCostEvent` auto-pause path (already wired in `costs.ts:88-93`).
- status — reuse `agents.status` (`idle|active|paused|terminated`) + `POST /agents/:id/pause`·`/resume`.
- config history — reuse `agent_config_revisions`.

### 5.3 New: `aoa_agent_triggers`
A trigger binding per AoA agent. One agent may have multiple triggers.

```
aoa_agent_triggers
  id            uuid pk
  company_id    uuid  -> companies (cascade)
  agent_id      uuid  -> agents (cascade)          // the kind='aoa' agent
  kind          text  // 'outbox' | 'routine' | 'event' | 'mention' | 'conversation' | 'manual'
                       //  ('task' reserved for future — L11; not implemented v1)
  enabled       boolean default true
  config        jsonb  // kind-specific:
                       //   outbox  -> { source: 'discussion_entry_pending', ... }
                       //   routine -> { cronExpression, timezone }  (or FK to routine_triggers)
                       //   event   -> { eventKey }
                       //   mention -> { } (resolution handled by mention layer)
  created_at    timestamptz
  updated_at    timestamptz
  index (company_id, agent_id), index (company_id, kind, enabled)
```

Routine triggers MAY reference the existing `routine_triggers` (cron) rather than duplicating cron logic — `config` stores the linkage. (Decision in plan phase; both are viable, no schema risk.)

### 5.4 New: dispatch claim columns / table
The Decision-#99 atomic-claim pattern generalizes. Work units already exist per trigger source (e.g. `discussion_entries.extractionStatus='pending'`, `agent_wakeup_requests.status='queued'`). The dispatcher claims them with the existing `UPDATE … WHERE status=… RETURNING` atomic pattern. **No new queue table** — `agent_wakeup_requests` is the delegation/mention/manual queue; per-domain pending columns are the event/outbox queues. The dispatcher is a generalization of the existing sweeper, not new storage.

### 5.5 Commander linkage
`internal_agent_config` gains `agent_id uuid -> agents` (nullable until migrated), linking the per-company Commander config singleton to Commander's `kind='aoa'` row. Commander's chat tables (`internal_agent_conversations`/`messages`) are unchanged.

**Commander vs member discriminator — do NOT overload `agents.role`** (spike-corrected, Finding 4). `agents.role` is special-cased across the codebase: `agent-permissions.ts:11` (`canCreateAgents: role === "cxo"`), `agents.ts:48` (`role === "cxo"`), `ROLE_LABELS`, and migration 0070 collapsed roles to `cxo|lead|general`. Inventing `role='commander_lead'`/`'aoa_member'` risks role-dependent logic/labels. Instead: every AoA agent keeps `role='general'`; the lead/member distinction lives in **`runtimeConfig.aoa = { role: 'lead' | 'member' }`** (the existing free-form `runtimeConfig` JSON — same place the non-dispatchable heartbeat flag lives). `kind='aoa'` + `runtimeConfig.aoa.role` is the discriminator; `agents.role` stays within the existing tier vocabulary.

### 5.6 Two distinct layers (avoid conflation)
`aoa_agent_triggers.kind` is the **dispatch binding** (what causes a run). `internal_agent_runs.trigger_type` is the **recorded provenance** (what *did* cause this run, for observability). They are different fields on different tables with overlapping vocabularies; the kind→trigger_type mapping is a small implementation detail resolved in the plan (e.g. binding `outbox`/`event` → run `event`; `routine` → `routine`; `mention`/`manual` → `mention`; `conversation` → `conversation`).

## 6. Dispatch & triggers (generalized #99)

The extraction sweeper (`extraction-sweeper.ts`) generalizes into an **AoA Dispatcher**:

1. **Poll** enabled triggers across AoA agents (outbox/routine/event/mention/manual).
2. For each, find pending work units (per-domain pending column, or `agent_wakeup_requests.status='queued'`).
3. **Atomic claim** (the multi-worker-safe `UPDATE … RETURNING` from #99) → mark in-flight.
4. Run the **no-task runner** under the existing bounded `concurrency-limiter` (seed already built), with a per-company fairness seam (round-robin across companies; v1 may be FIFO with the seam reserved).
5. Record `internal_agent_runs` (triggerType from the trigger kind) + emit the platform-scoped `cost_event` (existing path).
6. **Orphan recovery** generalizes the #99 reclaim: stuck in-flight (linked run `running` & stale) → terminalize run + reset the work unit. Same proven pattern, framework-wide.

`triggerType` values map to the existing `internal_agent_runs.trigger_type` enum (`conversation|proactive|event|sub_agent`) — extend with `routine`/`mention` (additive text column, no migration risk).

Commander's `conversation` trigger is **not** dispatched here — it stays in `agent-loop.ts`.

## 7. Execution — uniform CLI-adapter runner (no hybrid; LOCKED 2026-05-17)

> **Spike-driven decision (read this — it overrides the earlier draft).** The spike proved: `AdapterExecutionResult` (adapter-utils `types.ts:70`) has **no text-output field** — agentic adapters stream via `onLog`, return only metadata. So a runner **cannot** reliably parse structured extraction from adapter stdout. Resolution (user-locked): **every AoA agent — Commander, extraction, and all future ones — executes through the existing worker CLI adapter, and persists structured results by calling MCP tools through the internal-agent MCP bridge** (the proven Commander `cli-mode.ts --mcp-config` mechanism), **not** by the runner parsing stdout. There is **no hybrid / no `structured_llm` executor**. The provider-SDK is reserved strictly for non-agent **primitives** (embeddings, transcription) as standalone utility services — never agents, never in the adapter registry (consistent with Decision #91 / the CLAUDE.md divergence note).

New module `server/src/services/internal-agent/aoa-agents/runner.ts`:

- Input: `runAoaAgent(db, agentId, triggerPayload)`.
- Load the AoA agent row + its **marketplace-seeded** instructions + assigned skills + `adapterConfig`.
- `buildAoaRunContext()` builds the prompt/context from **instructions + skills + trigger payload** (NOT an issue/goal).
- Resolve the adapter via **`getServerAdapter(agent.adapterType)`** (NOT `getAdapter` — spike-corrected) + `resolveAdapterExecutionContext(config, adapter)` (exported, `heartbeat.ts:172`). Spawn the adapter **with the internal-agent MCP bridge attached** so the agent can call back into AoA.
- **Structured output via MCP tools, not stdout.** The agent persists results by calling a schema-validated tool through the bridge. The discussion-extraction agent calls a **new `submit-extracted-items(items[])` tool** — the framework **linchpin** (no such tool exists today: the write surface has `debrief-push` (input side) but no extracted-items persistence tool; it must be added and exposed via `mcp-bridge.ts`). Persistence happens via the agent's tool call, so the no-text-return adapter limitation is irrelevant.
- Hard error boundary (reuse the consumer's nested try/catch; never rethrow; record run `failed`; notify via Inbox).
- Write `internal_agent_runs` (running→completed|failed) + `cost_event` (agent-scoped → `budgetService`; v1 amounts zeroed per the prior backend §16.3).

**Skills/instructions are seeded via the marketplace** ("comes with the app"): the framework seeds the Commander team + their default skills (e.g. an `extract-discussion` skill) through the existing marketplace seeding mechanism — not hardcoded prompts.

**Honest trade (user-acknowledged):** a CLI agentic session per discussion entry is **less deterministic and heavier** than the old one-shot SDK call. Mitigation: a tight marketplace `extract-discussion` skill + a **schema-validated** `submit-extracted-items` tool keeps output near-deterministic; the durable dispatcher + `concurrency-limiter` absorb cost/backpressure. The new execution code = the runner + the `submit-extracted-items` tool + the bridge wiring; everything else is reuse.

## 8. Coordination & delegation (no task board)

- **Commander → sub-agent:** Commander emits a directive that resolves (via mention-resolution) to an AoA agent and enqueues an `agent_wakeup_requests` row with an instruction payload. The dispatcher's `mention`/`manual` trigger picks it up → runner runs the agent with that payload.
- **`@mention`:** `findMentionedAgents` (`server/src/routes/issues.ts:787`, also discussions/comments) currently resolves only `kind='org'`. Add `kind='aoa'` to resolution so AoA agents (and Commander) are mentionable. A mention → wakeup → dispatch (the existing primitive, extended).
- **Durable, inspectable trail without a board:** `agent_wakeup_requests` (queued→processing→done, payload, `scheduledFor`) + `internal_agent_runs` (execution) already give queue + execution observability. The **"Commander Team" activity view** (§9) renders over these. No `issues`-lite table.
- **Commander `@mention`:** resolves to Commander's `kind='aoa'` row (L4) → its `conversation`/`proactive` path. Uniform with sub-agents at the resolution layer.

## 9. UI

### 9.1 Navigation
The **Team** page (`/team`, COMPANY section) gains a sub-tab: **Commander Team** (alongside the existing human/org team views). It lists:
- **Commander** (lead) — status, last activity, quick link to chat (`/commander`).
- Each **AoA agent** — name, status (with pause indicator), last run, trigger summary.
- **+ New AoA agent** (RBAC-gated, §10).

### 9.2 Detail page
Reuse the `AgentDetail` page pattern for `kind='aoa'`. Tabs:
- **Overview** — identity, status, last runs summary, budget snapshot. (reuse)
- **Instructions** — `AgentInstructionsTab`. (reuse)
- **Skills** — company-skill assignment. (reuse)
- **Runs** — `internal_agent_runs` for this agent (the agent-detail Runs tab generalized to internal runs). (reuse + adapt query)
- **Config** — adapter, budget, model. (reuse `AgentConfigForm`, scoped to AoA-relevant fields)
- **Triggers** — *new small section*: list/add/enable `aoa_agent_triggers` (outbox/routine/event/mention/manual). The only genuinely new UI surface.

Commander's detail page Config tab surfaces the existing `internal_agent_config` (Execution / Capabilities / Budget / Run History — the four sub-tabs that exist today at `/settings?tab=commander`, relocated/reused). Its primary interaction stays the chat page (`/commander`); the detail page is for config/observability.

## 10. Governance (enterprise via reuse)

| Pillar | How (reuse) |
|---|---|
| Pause / resume | existing `agents.status` + `/pause`·`/resume` + `activity_log` |
| Budget caps + auto-pause | existing `cost_events`→`budgetService` + `costs.ts` auto-pause (already wired for the platform agent) |
| Config versioning | existing `agent_config_revisions` |
| RBAC | founders create/disable any AoA agent; team_leads scoped per existing `user_roles`; only founders edit Commander. Reuse the agent routes' authz. |
| Audit | reuse `activity_log` (`aoa_agent.created/paused/config_changed/run_failed`) |
| Least-privilege tool/skill scoping | per-agent skill assignment + per-agent tool allowlist. **This is the Decision #95 access model**, now designed against its concrete consumer: an AoA agent's effective capability = its assigned skills ∩ its tool allowlist; default-deny, founder-granted. |

## 11. Migration plan (sequenced; detail in the implementation plan)

1. `agents.kind` accepts `'aoa'` (additive migration).
2. Create the Commander `kind='aoa'` row per company (idempotent, like `ensurePlatformAgent`); link `internal_agent_config.agent_id`. Chat loop untouched.
3. Reconcile the existing `kind='platform'` extraction agent: it becomes the first `kind='aoa'` agent ("Discussion Extraction"), trigger = `outbox` (the #99 discussion-entry-pending claim, preserved). Cost attribution moves from the hidden platform row to this AoA agent. The `kind='platform'` row is migrated/retired (not left as a parallel concept).
4. Generalize `extraction-sweeper.ts` → AoA Dispatcher; `extraction-consumer.ts` → invoked via the no-task runner (adapter execution replaces the one-shot SDK call; the durable trigger and hard error boundary are preserved).
5. Mention-resolution includes `kind='aoa'`.
6. UI: Team sub-tab + AoA `AgentDetail` reuse + Triggers section.
7. Backfill/no-op safe at every step (fresh installs and existing companies both work).

## 12. Testing strategy

- **Contract/unit (Windows-runnable):** dispatcher claim atomicity, no-task runner prompt assembly, trigger evaluation, mention-resolution includes `kind='aoa'`, RBAC gates, the extraction-as-AoA-agent path (run recorded, cost emitted, error isolated). Reuse the established `vi.hoisted` + explicit `@armyofagents/db` mock harness.
- **Integration (Linux-CI authoritative):** end-to-end — create AoA agent → trigger fires → adapter runs → run+cost recorded → pause halts dispatch → budget cap auto-pauses. `describe.skipIf(win32)`.
- Preserve all existing M1–M6 tests green (the extraction backend is being generalized, not discarded).

## 13. New decision record (to append to `docs/architecture/decisions.md`)

**Decision #100 — AoA Agents framework: Commander + sub-agents as trigger-driven first-class agents.**
- **Uniform CLI-adapter execution (LOCKED 2026-05-17):** every AoA agent runs through the existing worker CLI adapter; structured results are persisted by the agent calling MCP tools via the internal-agent bridge (not stdout parsing — the spike proved adapters return no text). No hybrid/`structured_llm` executor. Provider-SDK stays a non-agent primitive (embeddings, transcription) — **consistent with Decision #91** (no provider adapter re-added to the registry), so #91 is honored, not superseded.
- **Supersedes DA-27 clauses (b) no queue, (c) no atomic checkout, (d) no adapter abstraction, and the *wakeup* half of (e)** — AoA agents use atomic-claim dispatch, the worker adapter layer, and trigger/wakeup. **Keeps** DA-27 (a) separate `internal_agent_runs` table and the *assignment/task* half of (e) (no founder-managed issue/task lifecycle).
- **Resolves Decision #95** — the deferred access model is designed here (§10) against its now-concrete consumer; #95's "revisit when team-under-Commander begins" condition is met.
- **Extends Decision #99** — the durable transactional-outbox trigger, atomic claim, and orphan-recovery generalize framework-wide; the per-company platform agent and zeroed cost path carry forward; the extraction sub-agent becomes the first migrated AoA agent (its #99 correctness preserved).
- **Rationale:** a growing internal automation team needs real agentic execution and a uniform, reusable model; ~70–75% is reuse of existing `agents`-keyed infrastructure.

## 14. Forward extensibility (explicitly designed-in)

The `aoa_agent_triggers.kind` taxonomy is open. A future **`task` trigger** — a Commander-Team work board, or integration with `issues` — is an **additive trigger kind + an optional view**, requiring no change to the runner, dispatcher claim model, agent representation, or UI shell. This is the user's "expand to tasks later if required" requirement, satisfied without spine changes.

## 15. Out of scope (v1)

- Horizontal multi-process dispatcher scale-out (the atomic claim already makes it *possible*; v1 ships the single-loop dispatcher with the seam).
- The `task` trigger kind / Commander-Team work board (L11/§14 — future).
- Fixing Commander's broken `cli-mode.ts` (orthogonal execution bug; tracked separately).
- Per-extraction accurate token/cost accounting (still zeroed per spec §16.3 of the prior backend work; unchanged here).
- Multi-company fairness *tuning* (seam built; round-robin tuning deferred).

## 16. Open implementation questions (resolve in writing-plans, not blockers)

1. `aoa_agent_triggers.config` for routines: own cron fields vs FK to `routine_triggers` (both schema-safe).
2. Exact reuse boundary of `AgentDetail.tsx` (shared component vs `kind`-aware branch) — it is 45K-token large; the plan should split a shared core rather than fork.
3. Tool allowlist storage (new column on `agents` vs a small join table) for §10 least-privilege.

**Spike-resolved (no longer open — see §7/§5.5/L3):** the executor model is LOCKED uniform-CLI-adapter; `agents.role` overload is rejected (use `runtimeConfig.aoa.role`); the registry export is `getServerAdapter`; `resolveAdapterExecutionContext`/`parseExtractedItems` are exported. **The `submit-extracted-items` MCP tool is a CONFIRMED required Plan A task (the linchpin)** — no such tool exists today (`debrief-push` is input-side only); it must be added and exposed via `mcp-bridge.ts`. It is not an open question; it is a planned task.

## 17. Definition of Done (v1 top-level acceptance — REQUIRED)

The implementation plan's overarching goal. v1 is **not done** until **all** of the following are true and verified:

1. **Visible:** Commander and the migrated extraction sub-agent both appear in **Team → Commander Team** sub-tab (status, last run, triggers shown).
2. **Configurable:** each opens a working `AgentDetail`-style page (Overview / Instructions / Skills / Runs / Config / Triggers). Editing config persists and writes an `agent_config_revisions` row.
3. **Real output end-to-end (the hard bar):** a discussion entry → the extraction AoA agent's `outbox` trigger fires → the runner spawns the **configured CLI adapter with the internal-agent MCP bridge** → the agent (driven by its marketplace-seeded `extract-discussion` skill) calls the new **`submit-extracted-items`** tool → **real `discussion_extracted_items` are persisted and visible in the UI**, with the run recorded in `internal_agent_runs` and a `cost_event` emitted. **Not a stub** — a real CLI adapter run producing actual extracted content via the tool.
4. **Lifecycle works:** pause/resume halts/restarts dispatch; a budget cap auto-pauses the agent; `@mention`/delegation enqueues a wakeup that produces a run.
5. **No regression:** all existing M1–M6 backend tests stay green; the extraction backend is generalized, never broken.
6. **Verified by:** an integration test that runs **with a provisioned adapter/credential** AND a documented manual acceptance run (create discussion entry → watch real extraction appear in the Commander-Team UI).

**Honest precondition (non-negotiable consequence of choosing "real output required"):** acceptance step 3 needs a working adapter + LLM credential in the verification environment. This is the **same precondition every worker agent already has** — it is not a defect of this design. Consequence for the plan: this acceptance is a **gated step** (a CI job with a provider secret, or the documented manual run in an environment that has a credential) — it **cannot** be a credential-less, Windows-skippable unit test. The plan must include: provider/credential provisioning steps, and the manual acceptance script. Contract/unit tests still cover the framework logic credential-free; the *real-output* proof is the gated acceptance.

§16(a/b/c) are resolved during planning and do **not** gate this Definition of Done.
