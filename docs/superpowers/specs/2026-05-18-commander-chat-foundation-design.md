# Commander Chat Foundation — Design

> **Status:** Approved (brainstorming complete 2026-05-18). Next: implementation plan via writing-plans.
> **Scope one-liner:** Make the sidebar Commander chat a real, context-aware, memory-keeping assistant — seeded + editable instruction bundle, attached + seeded skills, full conversation memory with auto-compaction, and relevance-based company-memory injection — adapter-uniform (claude & codex), graceful under failure. Chat path only.

## Goal

Turn the in-app Commander **chat** (the sidebar internal-agent, `internal_agent_*`) from a context-blind one-shot into an assistant that knows who it is, knows what it can specially do, remembers the conversation, and uses the company knowledge base intelligently — the same architecture that makes an interactive assistant work.

## Background: why this is needed (verified, code-is-truth)

A Commander chat turn today is a one-shot CLI subprocess fed **only the current user message**. Verified:

- `server/src/services/internal-agent/agent-loop.ts:78-157` — `chat()` persists the user message, loads config, calls `cliService.chat(params, config)`, and persists the assistant turn on clean completion. It **never loads prior conversation** and **never assembles context**.
- `server/src/services/internal-agent/cli-mode.ts:396-398` — `safeContent = params.content` (shell-escaped on Windows only). `:213` — claude is spawned `["--mcp-config", cfg, "-p", safeContent, "--output-format", "text"]`. `:240-242` — codex `exec --json -` (prompt via stdin), continuity only via `resume <sessionId>`. No `--system-prompt`, no `--continue`/`--resume` for claude.
- `server/src/services/internal-agent/context-assembly.ts` — a context/persona builder exists (sections: Instructions → Company Identity → Department → Conversation Summary → Page Context, token budget 8000 at `:47`, accepts `conversationSummary` at `:43`), but its persona is a **hardcoded generic string** (`SYSTEM_INSTRUCTIONS`, `:6-20`) and it is **not called** by the chat path (built for the removed API mode, Decision #91).
- `server/src/services/internal-agent/conversation.ts` — memory machinery exists but is unused on the chat path: `getRecentMessages():75` (returns last 50, **ignores** `summarizedUpToMessageId`), `summarizeIfNeeded():85` (compaction: threshold `MESSAGE_THRESHOLD=20` at `:20`, summarizes oldest, writes `summarizedContext`/`summarizedUpToMessageId` at `:147-148`) — but it requires an **API `LLMProvider`** (`:87`, `:131-137`) which the CLI chat path does not have.
- Skills: a grep for any `skill`/`Skill` code in `server/src/services/internal-agent/**` returns **nothing**. The chat path injects no skills.
- `server/src/services/internal-agent/aoa-agents/ensure-commander.ts` — creates the Commander `kind='aoa'` row only; **no instruction bundle is seeded**.

Net: the Commander chat is the most bare-bones path in the system — no persona, no skills, no memory. Worker agents get bundle + skills via `heartbeat.ts`; AoA agents are second-class.

## Scope

**In scope (this spec — Commander chat only):**

1. Seeded + editable Commander instruction bundle wired as the per-turn system persona (claude & codex).
2. Seeded + user-attached skills delivered into the chat run.
3. Full conversation memory fed each turn, with auto-compaction (Notebook 1).
4. Relevance-based company-memory injection (Notebook 2) with graceful fallback.
5. Error handling / graceful degradation; tests; regression protection.

**Out of scope (explicitly deferred — must not be precluded):**

- **Seeding** bundles/skills for non-Commander AoA agents, **and** runner-path bundle + skill **consumption** (`runner.ts:85,144` uses a single free-form `aoaCfg.instruction` string). Separate follow-up spec (different code path; isolates the proven §17 extraction path from risk).
- Instruction/skill **versioning** and **marketplace seeding** of instructions/skills.
- Interactive "ask the user with option buttons" mechanism; new tools (create team, browse/install marketplace); audit logging; autonomy-level wiring. (Separate later specs.)
- Memory **folders** as a retrieval key, and the `active_context`/`working` memory layers in per-turn injection.

**Locked decisions honored:** Decision #15/#52 (agents cannot write company memory directly — only propose `pending`); Decision #91 (API-mode adapters removed; provider SDKs are extraction/embedding only); the prior MX invariant that the claude/codex **spawn shape stays byte-identical** (only prompt content may change). Note: `runtimeConfig.contextMode` (Decision #87) is an AoA-agent *runner* concept; the internal-agent chat is sized by `internal_agent_config.contextTokenBudget` instead — do not conflate them.

## Approach decision

**Option B — AoA owns the conversation in its DB and re-feeds assembled context every turn** (chosen). This is exactly how an interactive assistant works: the model is stateless; the harness replays instructions + history and compacts when large. Adapter-uniform, survives restarts/scaling, inspectable, user-editable.

**Option A — persistent interactive CLI process** (rejected): claude-only (codex `exec` is hard one-shot, `cli-mode.ts:563`), in-RAM state lost on restart/scale, not DB-owned/editable/summarizable, and AoA already has dead abandoned code for it (`cli-mode.ts:468-491`).

## Architecture

A single **chat context assembler** (the revived/extended `context-assembly.ts`) with one responsibility: given conversation + company + Commander bundle, produce the final per-turn prompt. `agent-loop.ts` orchestrates (load bundle, load history-since-marker, call the assembler, materialize skills, trigger post-turn compaction). `cli-mode.ts` sends the assembled prompt through the existing per-adapter channel unchanged in shape. The compaction summarizer sits behind a thin interface with a CLI-backed implementation (testable, swappable).

**Conversation identity:** there is exactly one active conversation per **(companyId, userId)** — `conversation.ts:getOrCreateActive` keys on `(companyId, userId, status='active')`. Different users in the same company have independent histories. Starting a fresh chat uses the existing `reset()` (archives the active conversation, opens a new empty one); this spec adds no new reset UI. The assembler is a **pure function** returning the prompt string (so unit tests inspect it directly).

**Token budget:** the assembler budget is `internal_agent_config.contextTokenBudget` (the configurable per-company value; `assembleContext` already defaults it to `8000` at `:47`). The plan wires the configured value through rather than hardcoding 8000.

### Per-turn assembled prompt

```
[Commander persona — seeded/editable bundle: AGENTS.md entry + SOUL.md + TOOLS.md (+ HEARTBEAT.md)]
[Company memory — the few approved notes most relevant to the user's message]
[Conversation Summary — summarizedContext (compacted older turns)]
[Recent messages — verbatim, since summarizedUpToMessageId]
[The user's new message]
```
Skills are materialized as files in a managed skills directory referenced by `TOOLS.md`.

## Section 1 — Instruction bundle & persona

- **Seed:** add `server/src/onboarding-assets/commander/{AGENTS.md,SOUL.md,TOOLS.md,HEARTBEAT.md}` following the existing role-bundle pattern. Add a `commander` role to `default-agent-instructions.ts` (`DEFAULT_AGENT_BUNDLE_DIRS`/`resolveDefaultAgentInstructionsBundleRole`, currently `cxo`/`lead`/`default` at `:42-44`). The seeding primitive is written generally (so it *can* serve any `kind='aoa'` agent later), but **this spec applies it to Commander only**: `ensure-commander.ts` provisions the bundle on Commander creation **and back-fills existing Commander rows** (idempotent, like the row creation it already does). Seeding for non-Commander AoA agents (e.g. the extraction sub-agent) is deferred to the follow-up spec.
- **Editable:** reuse `agentInstructionsService()` + the existing founder-gated Instructions-bundle routes/UI unchanged (Commander is `kind='aoa'`, already qualifies). The seeding step must provision the `rootPath` that service reads.
- **Wire into chat:** `assembleContext()` gains an optional `systemInstructions` input. `agent-loop.ts` reads Commander's bundle via `agentInstructionsService` and passes it in; if absent/empty, fall back to the existing `SYSTEM_INSTRUCTIONS` constant (backward-safe). All other `assembleContext` sections (company identity, department, summary, page context, token budget) are reused unchanged.
- **`HEARTBEAT.md`:** kept for four-file pattern uniformity; content repurposed to describe Commander's proactive-check behavior (the existing 4-hour proactive scan), not task heartbeats.
- **Memory guidance** lives in `TOOLS.md` (how to use memory tools; that proposed memories are `pending` until the founder approves) plus a `SOUL.md` principle line. No separate `MEMORY.md` (keeps the bundle file-list constant and all consumers unchanged).

## Section 2 — Skills delivery (chat)

Resolve Commander's seeded + user-attached skill keys via the existing `company-skills.ts` resolution (the same path `heartbeat.ts` uses). Materialize them as markdown files in a managed skills directory visible to the chat's CLI run — mirroring the adapter `skillsDir` pattern (`heartbeat.ts:749,3104` — "adapters materialize `context.skills` as files in `skillsDir`"), analogous to how `cli-mode.ts` already manages a per-session `CODEX_HOME`. The Skills UI is reused unchanged for attaching skills. No new skill machinery; this is net-new wiring for the chat path only.

**Lifecycle:** the materialized skills directory is a managed per-session artifact reaped by the **existing** idle/session cleanup that already reaps the codex `CODEX_HOME`/claude tmp config (`cli-session-store`), OR regenerated per turn — the plan picks one at `[verify@exec]`; no new cleanup machinery is introduced.

## Section 3 — Conversation memory & compaction (Notebook 1)

- Each turn carries: `summarizedContext` (compacted older turns) + verbatim messages **since `summarizedUpToMessageId`** + the new message. Add a "messages since marker" query to `conversation.ts` (today `getRecentMessages:75` returns last 50 ignoring the marker, which would overlap the summary).
- After each clean turn, if message count exceeds `MESSAGE_THRESHOLD` (20), run compaction: summarize the pre-window messages, store `summarizedContext` + advance `summarizedUpToMessageId`.
- **Compaction LLM:** `summarizeIfNeeded` currently requires an API `LLMProvider` the CLI path lacks. Change it to summarize **via the same CLI adapter the chat uses, with the cheap model** (`internal_agent_config.cheapModel`, already present in the validator). Behind a thin summarizer interface so it is unit-testable and swappable.
- **The summarization invocation is a plain, tool-less prompt** — it must NOT attach the MCP bridge / `--mcp-config` / tool surface (a summary must never trigger tool calls, and the bridge is a separate process). It is a distinct, minimal CLI spawn from a chat turn.

## Section 4 — Company memory injection (Notebook 2)

- Upgrade the assembler's company-memory section from the blunt "inject all approved identity + department domain" (`context-assembly.ts:81-99,113-129`) to **relevance retrieval**: embed the user's latest message and fetch the top-K most relevant memory items (K = a small configurable count; exact default set in the implementation plan) via the existing `memory.ts` `searchSemantic` (pgvector cosine `<=>` at `:294,300`). **Preserve the current layer/approval scope** — only `status='approved'` items in the `identity` + department `domain` layers (the same scope `context-assembly` uses today), just relevance-ranked instead of dumped wholesale. Do **not** silently widen to all layers.
- **Graceful fallback:** no embedding API key → `searchSemantic` already falls back to keyword `ilike` search (`memory.ts:240,250-251`; `embeddings.ts:28-30` returns null without a key). Reuse this; do not reinvent.
- Folders and the `active_context`/`working` layers in injection are out of scope (folders remain a UI organization concept). The agent retains its on-demand `query_memory`/`find_similar_memory` MCP tools (`memory-tools.ts:26`) for deeper lookups; `create_memory` stays `pending` (Decision #15/#52).

## Section 5 — Prompt wiring (claude & codex, adapter-uniform)

`agent-loop` produces one assembled prompt; `cli-mode.ts` sends it through the **existing** per-adapter channel with **no spawn-shape change**: claude `-p <assembled>`, codex `exec --json -` stdin. No adapter-specific flags (e.g. no claude `--system-prompt`) so the verified-working invocation stays byte-stable for claude *and* codex — only prompt **content** changes.

**Codex `resume` / double-history hazard:** AoA now re-feeds the *full* assembled context (summary + verbatim history) every turn. Codex `resume <sessionId>` also carries codex's own session memory — so naively keeping it would feed the conversation **twice** (token waste + confusion). For the Foundation, treat **both** claude and codex as **stateless per turn**: AoA-owned assembled context is the single source of truth; the chat does not depend on codex `resume` for conversation memory. Whether codex `resume` is dropped for the chat or kept only as a harmless no-op is a `[verify@exec]` decision, but the design intent is uniform stateless + AoA-owned history (no double-feed).

## Section 6 — Error handling & graceful degradation (never hard-fail the chat)

| Condition | Behavior |
|---|---|
| Missing/empty Commander bundle | Fall back to existing `SYSTEM_INSTRUCTIONS` constant |
| No embedding API key | Company-memory retrieval falls back to keyword search (existing `memory.ts` behavior) |
| Compaction summarize fails (CLI error/timeout) | Skip compaction this turn; send raw recent history (budget-capped); log; still reply |
| Over token budget after summary | Existing `assembleContext` truncation logic handles it |
| Empty conversation / after `reset()` | No history/summary sections; assembler returns persona + (any) memory only |
| A skill fails to resolve | Skip that skill, continue the turn |
| Bundle service throws | Treat as missing bundle → constant fallback; never block the turn |

## Section 7 — Testing & regression

- **Windows-runnable contract/unit** (`vi.hoisted` + `@armyofagents/db` named-export mock harness): assembler (bundle persona injection; constant fallback; relevant-memory inclusion; summary inclusion; token-budget truncation), history-since-marker query, compaction trigger at >20, degradation paths (no API key → keyword; missing bundle → constant; summarize failure → raw history).
- **`describe.skipIf(win32)` integration** (Linux-authoritative): end-to-end claude *and* codex chat turn carries persona + relevant memory + history; compaction across the threshold updates `summarizedContext`/marker.
- **Regression:** existing chat tests stay green; assert the CLI **spawn shape is byte-identical** (content-only change) for claude and codex; assert **§17 extraction and the runner path are untouched** (chat-only spec — no edits to `runner.ts`/extraction); other AoA agents unaffected.
- Test command: `cd server && npx vitest run src/__tests__/<file>` (no `test` script in `server/package.json`).

## File map / components

- **New:** `server/src/onboarding-assets/commander/{AGENTS.md,SOUL.md,TOOLS.md,HEARTBEAT.md}`.
- **Modify:**
  - `server/src/services/default-agent-instructions.ts` — `commander` role bundle dir; generalize seeding to `kind='aoa'`.
  - `server/src/services/internal-agent/aoa-agents/ensure-commander.ts` — seed bundle + default skills on creation (idempotent).
  - `server/src/services/internal-agent/context-assembly.ts` — optional `systemInstructions` input; replace naive identity/domain dump with `searchSemantic` + keyword fallback; keep budget logic.
  - `server/src/services/internal-agent/agent-loop.ts` — load bundle (`agentInstructionsService`), load history-since-marker, call assembler, materialize skills, pass assembled prompt to cli-mode, trigger post-turn compaction.
  - `server/src/services/internal-agent/cli-mode.ts` — accept the assembled prompt (replace bare `safeContent`) for claude `-p` and codex stdin; provide a managed per-session skills directory; spawn shape otherwise byte-stable.
  - `server/src/services/internal-agent/conversation.ts` — add messages-since-`summarizedUpToMessageId` query; make `summarizeIfNeeded` summarize via the CLI cheap-model path behind a thin interface (not an API `LLMProvider`).
- **Reuse unchanged:** `server/src/services/company-skills.ts` (skill resolution/materialization), `agentInstructionsService` + Instructions-bundle routes/UI, `server/src/services/memory.ts` `searchSemantic`, the Skills UI.
- **Component boundary:** one "chat context assembler" (single responsibility, isolated, unit-testable); compaction summarizer behind a thin CLI-backed interface.

## Data flow (one turn)

1. User sends a message → SSE route → `agent-loop.chat()`.
2. Persist user message (existing).
3. Load Commander bundle (or constant fallback); load history since `summarizedUpToMessageId`; embed latest message and fetch top-K relevant approved memory (keyword fallback if no key); assemble the prompt; materialize skills into the managed skills dir.
4. `cli-mode` spawns claude/codex with the assembled prompt (skills dir in cwd); stream the reply over SSE (unchanged).
5. Persist assistant message (existing).
6. If message count > threshold, compact: summarize pre-window messages via the CLI cheap model; update `summarizedContext` + `summarizedUpToMessageId`. Failure here never blocks the reply.

## Decisions resolved during brainstorming

1. Surface = the **sidebar Commander chat** only (not the runner-driven agent path).
2. Build approach = **Option B** (DB-owned, re-feed assembled context; the "works like you" architecture).
3. Decomposition = this is the **Commander Chat Foundation**; runner/other-AoA-agent generalization, the ask-user UX, new tools, audit, and autonomy are **separate later specs**.
4. Instruction bundle follows the **onboarding-assets 4-file pattern**; seeded default + user-editable via the existing service; HEARTBEAT.md repurposed for proactive behavior.
5. **Skills** are in scope for the chat (seeded + user-attached), reusing `company-skills.ts` materialization.
6. Compaction summarizes **via the same CLI (cheap model)**, graceful fallback.
7. Company-memory injection upgraded to **semantic retrieval** with keyword fallback; folders + temporary layers deferred.
8. Memory guidance lives in **TOOLS.md + a SOUL.md principle** — no new bundle file.

## Open items to confirm at `[verify@exec]` (plan author)

These are intentionally left for the implementation plan to lock against landed code — none change the design:

1. **No schema migration expected.** Seeding/back-fill reuses the existing instructions-bundle storage (files on disk under the agent's `rootPath` + `adapterConfig` linkage) — confirm no Drizzle migration is required (if one *is*, it goes in `packages/db/src/schema/` via `pnpm db:generate`, never raw SQL).
2. **Exact `agentInstructionsService` read API** (entry file `AGENTS.md`, `listFiles`/`readFile` shape, how `rootPath` resolves for a `kind='aoa'` Commander row) — confirm against `server/src/services/agent-instructions.ts` before wiring.
3. **Skills-dir lifecycle** — per-session-reaped vs regenerated-per-turn (Section 2) — pick one, reusing existing cleanup.
4. **Concurrency policy** — two in-flight turns for the same conversation (history read before the prior assistant message persists; racing compactions): serialize per conversation, or accept last-writer. Pick and test the chosen behavior.
5. **Codex `resume` for the chat** — drop vs harmless no-op (Section 5), preserving uniform stateless behavior.

## Risks & mitigations

- **Per-turn token cost** (re-feeding history): mitigated by compaction (threshold 20) and the configurable `internal_agent_config.contextTokenBudget` (default 8000) + `assembleContext` truncation.
- **Extra CLI call for compaction:** infrequent (only when crossing the threshold); uses the cheap model; failure degrades gracefully.
- **Regression on the proven claude/codex chat path:** mitigated by the byte-identical-spawn-shape invariant (content-only change) and explicit regression assertions; **no edits to `runner.ts` or the §17 extraction path** (chat-only spec).
- **Bundle/skill provisioning on existing companies:** seeding must be idempotent and back-fill existing Commander rows, not only new ones.

## Definition of Done

- A Commander chat turn (claude **and** codex) is fed: seeded/editable persona bundle + materialized skills + relevant approved company memory + conversation summary + verbatim recent history + the new message — verified by integration tests on Linux and inspectable in the assembled prompt.
- Within one thread, Commander remembers earlier turns; crossing 20 messages produces a `summarizedContext` and the chat keeps working (compaction observed in DB).
- The Commander instruction bundle is seeded on creation, back-filled for existing Commander rows, and editable through the existing Instructions UI; edits persist and take effect next turn.
- All graceful-degradation paths (no API key, missing bundle, summarize failure, skill resolution failure) keep the chat replying.
- Full server suite green; CLI spawn shape byte-identical for claude and codex; §17 extraction and the runner path provably untouched.
