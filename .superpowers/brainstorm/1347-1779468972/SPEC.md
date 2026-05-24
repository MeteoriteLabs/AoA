# Threads — Implementation Spec

> Companion to `DESIGN.md` (UX/product design, 20 sections) and `USECASES.md` (22 stress-test cases).
> This spec is the **build contract**: what to build, what to reuse, in what order, marked **[v1]** / **[v1.1]** / **[later]** inline.
> Grounded in the platform-verification audit (`DESIGN.md §20`). Code-truth wins over this doc; flag discrepancies.

---

## 1. Overview

**Threads** unifies AoA's **Discussions + Goals** into one neutral container that turns *unstructured input* (ideas, voice, transcripts, chat, MCP, agent output) into *structured output* (decisions, tasks, memory, plans). It is the "thinking" workspace, analog to Execution Workspaces (the "doing" workspace).

**Naming (locked):** sidebar section label stays **"Discussions"** (honors Decision DA-3); each item is a **"Thread."** "Discussions contains Threads." The crew of Commander roles is the **Command Staff** ("crew" used as lowercase shorthand throughout).

**Four pillars:** Threads (front door) · Memory (compounding asset) · the **Command Staff** (labor) · Autonomy (the dial).

**Backbone reuse:** Threads is `discussions` grown up — it reuses `discussions` / `discussion_entries` / `discussion_extracted_items` / `discussion_annotations`, the generalized AoA dispatcher/runner/wakeup, role-file seeding, and the workspace viewer. ~70% of orchestration already exists.

---

## 2. v1 cut

**[v1] — the core loop** (dirty input → structured Scope → real tasks, on the existing backbone):
- Thread container (ALTER `discussions`) + the 3-pane **focus view** (origin card, Thread tab, Scope tab).
- **Scope:** Summary (Scribe line + Next + chips) · Plan (structured, interactive) · Items (Needs input / Confirmed / References / Artifacts).
- Lifecycle **Discuss → Scope → Assign → Done**; **autonomy L1 + L2** (L3 shown, greyed).
- **Crew (5 roles):** Router, Scribe (≈ extend Extraction agent), Planner, Dispatcher, Memory Keeper.
- **Creation modal** (Idea/Discussion/Goal/Transcript/Document + relate/add-to).
- **Continuum nav:** List + **Board** (Unlisted + Live lanes + phase columns). Sidebar search.
- **Right viewer:** Home · Task form (NewIssueDialog parity) · Viewer (image/md/pdf/code/static-HTML) · Browser (live-port, reuse workspace runtime) · Compare.
- **Boundary model:** participants + @mention (human notify / agent invoke), **ownership** (owned-by-action: Claim or governance action · transfer · add/remove participants), per-item dept + assignee (agent|human), spin-off-thread items, **cross-thread links + dependencies**, **visibility** (open/private + per-dept default).
- **Goal-as-property** (+ "Make this a goal"); sub-goals **one level, enforced**.
- Unlisted queue + Router confidence routing.
- **Real-time:** refetch-on-poke bus + reliability foundations (per-thread `seq`, catch-up, reconnect) + **per-thread scoping + envelope RBAC** (private-thread leak-safe) + presence/typing.
- **Crew governance brakes** (§4.1): real cost accounting (incl. SDK extract/classify + per-call caps) · in-flight kill · company/thread kill-switch · `autonomyLevel` enforcement · per-role model choice.

**[v1.1] — fast-follow:**
- **Graph lens** (React Flow) — the visual node/edge web.
- **Integration (Live) threads** (Slack/WhatsApp ingest) — greenfield; biggest single new area.
- Audio + Figma-embed renderers; merge reconciliation; two-way Live post-back.
- **Real-time push content deltas** (content over socket + payload-RBAC) — optimization over refetch (§6.2).
- **Watch / Follow toggle** — Inbox pings for non-participants (v1 = participant + @mention only).
- Board polish, templates, advanced linking.

**[later]:**
- **L3 autonomy** (full auto delegation + resolution).
- Worker→thread reverse handoff write-back.
- Webhook origins (Zapier/Make).

---

## 3. Data model

### 3.1 ALTER `discussions` (the thread container)
Add columns:
- `origin_source` (enum: human/agent/external/system) + `origin_medium` (enum: text/voice/transcription/file/api/scheduled/integration) — the **Origin** dimension.
- `intent` (jsonb string[] — multi-tag: planning/review/decision/research/problem/alignment/feedback/retrospective).
- `phase` (enum: discuss/scope/assign/done; default discuss) — **distinct from existing `status` active/archived**.
- `goal_id` (uuid → `goals.id`, nullable) — **goal-as-property** (no goal-side change).
- `visibility` (enum: open/private; default open).
- `owner_user_id` (uuid, **nullable**; null = **Unclaimed**) — accountable human (mirrors the `issues.assignee_user_id` user ref); agents/integrations stay creator/source (`origin_source` / `createdBy`), **never** owner.
- `autonomy_level` (smallint 1–3, nullable → falls back to `internal_agent_config.autonomyLevel`).
- `subtype` (enum: normal/live; default normal).
- `forked_from_id` (uuid → discussions.id, nullable) · `merged_into_id` (uuid → discussions.id, nullable).
- `summary_text` · `summary_next` · `summary_updated_at` (the Scribe Summary; denormalized like existing `entryCount`/`pendingItemCount`).
- Reuse existing: `scopeType`/`scopeId`, `tags` (→ intent), `status`, `entryCount`, `pendingItemCount`.
- **Widen** `discussion_entries.inputType` enum (`constants.ts:626`) to cover transcript/document/routine/webhook/integration/agent origins.

### 3.2 ALTER `discussion_entries` (posts)
- `parent_entry_id` (self-FK, nullable) — 2-deep nested replies (cap enforced in service).
- `author_agent_id` (uuid → agents, nullable) — entries currently carry only `createdBy` text.

### 3.3 ALTER `discussion_extracted_items` (scope items)
- Extend type enum: add `artifact`, `spin_off_thread` (existing: decision/task/insight/context/reference/preference).
- Add **committed** routing (today only `suggested*` exist): `assignee_agent_id` · `assignee_user_id` (mirror `issues.ts:36-37` — the agent|human discriminator G2 needs) · `department_id`.
- Reuse: `suggestedDepartmentId`/`suggestedProjectId`/`suggestedAssigneeId`/`suggestedGoalId` (Router/Scribe suggestions), `conflictsWith` jsonb (conflict cards), `resultTaskId`/`resultMemoryId`.
- **Fix enum mismatch:** `suggestedPriority` says `urgent|high|medium|low`; align to `critical|high|medium|low` (matches `issues.priority` + NewIssueDialog).

### 3.3b ALTER `projects` (departments)
- `default_thread_visibility` (enum: open/private; default open) — **per-department default** for new threads (HR/Finance/Exec → private). Projects table serves departments + projects (CLAUDE.md).

### 3.4 NEW tables
- **`thread_participants`** — (thread_id, principal_type agent|user, principal_id, **role** [user: owner|co_owner|collaborator|viewer · agent: worker], added_at). No precedent (team_members is agent-only; company_memberships is company-scoped). `onDelete: cascade` w/ thread.
- **`thread_links`** — (from_thread_id, to_thread_id, kind: link|spinoff|fork|merge|goal_cluster|spawned_from_task [later]). Shape mirrors `memory_relations`. Covers @[Thread] links, spin-offs, fork/merge lineage, goal-cluster, and the [later] worker→thread write-back.
- **`scope_item_dependencies`** — (blocker_item_id, blocked_item_id) — pre-task↔pre-task blocking **before** tasks exist (`task_dependencies` is issue↔issue only). On Assign, these graduate into `task_dependencies`.
- **`thread_plan_steps`** — (thread_id, order, title, collapsed) + step↔item link — the live ordered Plan (`workflow_templates` is a reusable template, not a per-thread plan).
- **`thread_inbox_items`** (Unlisted) — (raw_content, origin, router_confidence float, router_decision auto_attach|suggest|human, suggested_thread_id, status). [v1]
- **`thread_channel_bindings`** (Live) — (thread_id, provider slack|whatsapp, channel_ref, sync_status, last_sync_at). [v1.1]
- **`discussion_entry_attachments`** — link `assets`/`artifacts` to entries (today `issue_attachments` links only to issues; `assets` already stores every content type).

### 3.5 Reuse as-is (no change)
`goals` (parentId sub-goals + status machine), `project_goals` (≥1 dept M2M), `issues` (+`task_dependencies`), `agents` (kind='aoa' + skillKeys), `aoa_agent_triggers`, `internal_agent_runs` (triggerType='sub_agent', relatedEntityType already enumerates 'discussion'), `assets`, `memory_items` + `memory_feedback_patterns`, `notifications`, `user_roles`, `workspace_runtime_services`.
**Do NOT touch** deprecated `debriefs`/`briefs`/`brief_items`.

---

## 4. The Command Staff (the crew — orchestration)

**Two AI mechanisms — FINALIZED (right tool per job):**
- **CLI adapters = agentic work** (multi-step reasoning, tools, conversation): worker agents + the crew's interrogate/plan/route/dispatch. Billing = CLI **subscription** quota. Configured per agent under **Team → Commander team → agent → adapter + model + skills + instructions**.
- **Provider-SDK = atomic AI primitives** (`internal-agent/providers/`): one-shot **structured extraction** + **embeddings**. Billing = **per-token** (provider key). Kept per Decision #91 (API-mode *adapters* removed, but these primitives stayed).
- **Embeddings → ALWAYS SDK / dedicated embedding model** — the CLI literally cannot produce vectors (no embeddings endpoint). Mandatory, not a choice.
- **Extraction → SDK preferred** (fast, lean, deterministic JSON for a high-frequency primitive), **with CLI fallback** for deployments that have only a CLI subscription / no API key (slower, uses subscription). The **Scribe bridges**: interrogate via CLI adapter; extract via the SDK engine (CLI fallback when no key).
- **Why not all-CLI:** don't spawn a whole coding-agent subprocess + agent loop just to turn a paragraph into JSON or a vector — that's slow, heavy, and (for embeddings) impossible.
- **Deployment note:** SDK path needs a provider key (instance- or company-level); embeddings need *some* embedding provider (hosted or local) regardless. **Per-role model choice + per-call cost-caps on extract/classify are v1** (§4.2 / §4.1); only high-volume **batching** is deferred to the infra effort.

### 4.2 AI primitives — prompt ownership, embeddings, usage map
- **Embeddings provider:** an embedding model — **hosted (API)** or **local/self-hosted** (bge/nomic/Ollama; no per-token cost, data stays in — enterprise/privacy option). Never the CLI coding agent. Stored in `memory_items.embedding` (pgvector). **v1 default = the hosted SDK path; if no provider key is configured, semantic features gracefully fall back to the existing Postgres FTS (⌘K search already uses tsvector) — never hard-fail.** Provider *strategy* (which hosted, or local) stays infra #4.
- **Agents READ the vector store via tools** (embed-query → similarity search), they don't compute embeddings. Crew memory `find_similar`/search tools already exist.
- **Extraction prompt = layered:** the **output JSON schema + core extraction instructions live in CODE** (stable, server-parsed, versioned — a role-file edit must not break parsing). The **Scribe role-file + company context supply steering** (priorities, tone, office-hours style, company hints), injected into the call. Schema = code; steering = config.
- **Where extraction is used:** Scribe Scope-item extraction (core) · Router classify (which thread/dept) · voice/transcript post-transcription · Live-channel continuous extract · Summary generation · conflict detection · task-vs-spin-off classification.
- **Where embeddings are used (who reads):** Router thread-matching (auto-attach/suggest) · memory retrieval (Why/What/How context — Scribe/Memory-Keeper/workers) · related-thread + merge suggestions · dedup (memory + Scope items) · semantic search (⌘K/thread search). **Embeddings = the "find relevant/similar" engine; extraction = the "text→structure" engine.**

- **Per-role model choice [v1]** *(pulled fwd from infra #5)*: each crew role names its own model/provider — cheap model for Router classify/sorting, stronger for Scribe extraction — as plain config on the role (no separate infra; it's part of building the roles). Per-call **cost-caps** on those extract/classify calls live with the §4.1 brakes; only high-volume **batching** is deferred (infra #5).

**Model:** one Commander intelligence loading **role files**; each role = `agents.kind='aoa'` + a `skillKeys` loadout + `aoa_agent_triggers` rows. Seeded idempotently via the `onboarding-assets/` + `seed-commander-bundle` pattern (never clobbers edits). Executed via `runAoaAgent`; logged in `internal_agent_runs`.

| Role | v1? | Build | Triggers |
|------|-----|-------|----------|
| **Scribe** | [v1] | **Extend** the existing "Discussion Extraction" agent (`ensure-extraction-agent.ts`) → rename to Thread Extraction; add **office-hours interrogate**, **task-vs-spin-off classification**, **per-item dept-tag**, conflict + goal detection | outbox (exists) |
| **Router** | [v1] | NEW role file + classify-inbound logic (semantic match → thread/Unlisted; tiers >80/40–80/<40) | NEW evaluator (event/mention) |
| **Planner** | [v1] | NEW role file (sequence pre-tasks → `thread_plan_steps` + `scope_item_dependencies`) | NEW evaluator (phase-advance) |
| **Dispatcher** | [v1] | NEW role file (match item → agent OR human; create `issues`; route per-dept; create confirmed spin-offs) | NEW evaluator |
| **Memory Keeper** | [v1] | NEW role file over existing memory + feedback services; **proposes only (status pending)** — never writes identity/domain (Decisions #15/#16/#52) | continuous + ≥3 pattern (exists) |
| **Curator** | [v1] reuse | = the existing `internal-agent/proactive.ts` engine (4h scan → notifications) | exists |

**Trigger evaluators:** `aoa_agent_triggers.kind` supports more than `outbox`, but only `outbox` is implemented (`triggers.ts` — "the seam exists"). v1 builds **mention**, **phase-advance**, and **routine** evaluators.

### 4.1 Autonomy & cost governance — REQUIRED v1 work (half-built today)
**Audit finding:** the machinery exists but is **inert for the crew**. Solid: per-agent **tool allowlist** (default-deny for `kind='aoa'`), capability gates, audit (`internal_agent_runs` + activity log + tool calls), per-agent pause (gates *next* dispatch). **Missing — must build because L2 ships in v1:**
1. **Real token/cost accounting for crew runs** — currently hardcoded `0¢` (`runner.ts:159`, cli-mode; Decision #6 stub). Until real, budgets never accumulate from crew → enforcement can't fire. **Also meter the Provider-SDK primitives** — Scribe extraction + Router classify bill per-token (§4.2); count that spend into the *same* budget so there's no blind spot, and add **per-call cost-caps** on classify/extract *(pulled fwd from infra #5 — build-time config, not scale infra)*. High-volume **batching** stays deferred (infra #5).
2. **Crew-aware in-flight cancellation** — `cancelBudgetScopeWork`/`cancelActiveForAgent` only cancel `heartbeat_runs`; extend to `internal_agent_runs` + the dispatcher's running subprocesses (a budget breach must actually *stop* a running crew agent, not just pause the next).
3. **Company- + thread-level kill-switch** — today only per-agent `status='paused'`. Add "pause this thread's crew" + "pause all crew" (company halt).
4. **`autonomyLevel` enforcement** — stored but no runtime gate (ships at 0). The L1/L2/L3 = crew-activation model requires the dispatcher/triggers to actually read it.
5. (preflight `getInvocationBlock` is dead code — wire it or remove.)

**@mention (both paths share one mechanism):** `delegate-to-subagent` → `agent_wakeup_requests` → dispatcher Phase 3 → `runAoaAgent`. **@human** = notification only. **@agent** = invoke worker on the thread (immediate).

---

## 5. Backend services & routes

- **Creation** [reuse]: extend `DialogContext` with `openNewThread`; the modal branches to `discussions.create` / `goals.create` (`server/src/routes/discussions.ts`, `goals.ts`) — no backend change for the unified creator. Make extraction **auto-on-create** (the durable sweep already drains `pending`; gate it in + drop the manual "Reprocess" UX).
- **Extraction** [reuse]: `extraction.ts` pipeline (atomic claim, dept resolution, conflict field, LiveEvents) + the generalized `runAoaDispatch` (outbox drain, wakeup queue).
- **Thread lifecycle** [new]: a `threads`/`discussions` service layer for phase transitions (state machine, mirror goal-status enforcement), Summary generation, fork/merge, promote-to-goal (`POST` that creates a goal row + sets `discussions.goal_id` + writes `project_goals`).
- **Router** [new]: inbound classifier service → writes `thread_inbox_items` or auto-attaches as a thread entry. **Pin:** auto-attach lands an *entry/extracted item* (founder-gated), never auto-creates a task — except authenticated-write MCP (Decision #14).
- **Dispatcher** [new]: pre-task → `issues` via existing issues service; respects **planning `work_mode` dispatch gate** (D8) and **concurrency clamp** (D5).
- **Goals/Issues/Memory/Workspace-runtime/Search/Notifications** [reuse]: as-is, extended where noted.

### 5.1 Ownership, participants & visibility (RBAC) [v1]
**Ownership — "owned by action" (accountability is always human):**
- `discussions.owner_user_id` (nullable; **null = Unclaimed**). Agents/integrations recorded via `origin_source` / `createdBy`, **never** owner.
- **Human-created** → owner = creator immediately. **Non-human-created** (agent/integration/schedule/MCP) → **Unclaimed**, lands in `thread_inbox_items` (Unlisted); nudge the lineage human in order: originating task's human owner → channel connector → Router-routed dept lead → **founder backstop**. Unclaimed-too-long → escalate to founder.
- **Becomes owned by either path (same result):** explicit **Claim** action, OR first **governance action** (approve a Scope item / advance phase / assign a task). Casual comment = participant only; viewing = nothing (no accidental ownership).
- **Manage:** owner can **transfer** ownership and **add/remove** participants. Promote-to-goal carries `owner_user_id` across; goals use the same field.
- **Participant roles (`thread_participants.role`):** `owner` (1, mirrors `owner_user_id`) · `co_owner` (0..n, shared authority) · `collaborator` (0..n, post/act) · `viewer` (0..n, read). Agents join as `worker`, never owner.
- **Notifications:** participants + @mention → Inbox (existing `notifications`). A non-participant **Watch/Follow** toggle is **[v1.1]** (resolved: later).

**Visibility — layered (per-department default AND custom audience, not either/or):**
- `discussions.visibility`: **open** (everyone in the thread's scope — dept/project/company) · **private** (owner + invited participants only).
- **Per-department default:** `projects.default_thread_visibility` sets what new threads start as (HR/Finance/Exec → private; others → open). Owner flips any thread open↔private anytime.
- **Custom audience = private + invite** — the participant list *is* the ACL; no separate "custom" level in v1 (role-based audiences e.g. "all team leads" = later).
- **Unclaimed** threads are visible only to those who can see the Unlisted queue (founder + routed lead) until claimed/routed.
- **Enforced in two places, one rule:** the **query layer** (list/board/search/⌘K/counts/REST filter private → participants only) **and** the **socket** (the §6.2 envelope-RBAC). Hiding the thread is primary; muting its events follows. Must **compose** with existing department/role RBAC (founder > team_lead > team_member) — never widen it.

---

## 6. UI

- **Threads shell** [new]: the 3-pane focus view + the **continuum** index (icon→list→Board; Graph in v1.1). `DiscussionDetail.tsx` is a flat list today — net-new shell. Reuse the viewer **renderer registry** from `WorkspacePreviewPanel` (which already has the tab model + live-port browser).
- **Origin card** [new]: type/chips/participants/@mention/phase pills/autonomy(L1–L3) crew popover. Live variant = integration chrome, no phase bar.
- **Scope tab** [new]: Summary + Plan (interactive steps, agent|human assignees, dependency badges, Graph/.md actions) + Items (Needs input incl. conflict cards · Confirmed · References · Artifacts) + spin-off item.
- **Board** [new]: Unlisted lane + Live lane + phase columns; card spec (origin icon · title · chips · owner · activity · unread + phase hints).
- **Right viewer** [reuse+extend]: Home/Task-form/Viewer/Browser/Compare; icon-rail collapse; renderers — add audio/Figma/sandboxed-HTML [v1.1].

### 6.1 Preview/Browser model — tiered by artifact type (Threads never own workspaces)
**Audit finding:** the existing workspace preview is **local-only** — iframe loads `localhost:<port>` on the *viewer's* machine; **no reverse proxy, no preview auth, no concurrency/idle management**, and AoA CSP `frame-ancestors:'none'` blocks same-origin framing. Works on a local-trusted laptop; breaks for cloud/multi-user. So most of the preview infra is net-new for enterprise.

**Key reframe: most previews need NO port and NO workspace.** Tier by what's previewed:

| What | Port? | How (best practice) | When |
|------|:---:|------|------|
| **External URL** (Figma/site/link — the high-volume case) | no | **Unfurl card** (server-fetched OG meta, cached) + **sandboxed iframe** if framable, else "open in tab" | [v1] |
| **Static artifact** (self-contained HTML/CSS/JS mock, image, pdf, code) | no | **sandboxed iframe** (`srcdoc`/blob + `sandbox`, no same-origin) / file renderers | [v1] |
| **Live running app** (real app w/ backend/build) | yes | only exists from an **active dev task's** Execution Workspace; thread embeds via ↓ | [v1] local / [v1.1] cloud |

**Live-app routing:**
- **[v1] local-trusted:** direct `localhost:<port>` (current mechanism), flagged local-mode.
- **[v1.1] enterprise:** a **preview proxy with AoA auth** (`/preview/:id/*` or `<id>.preview.app`) + CSP carve-out + WebSocket/HMR proxying + **idle-stop & concurrency cap** for dev servers. This is the **net-new infra** that makes live previews work remotely/securely. Live servers stay owned by the **task's** workspace — the proxy routes to them.
- **[v1.1] durable previews:** deploy-preview (build → hosted URL) for "keep this previewable."
- **[later/optional]:** in-browser sandbox (WebContainer) for FE prototypes; container-per-preview for max isolation.

**Rule (unchanged): Threads *reference* artifacts; execution + live servers stay with tasks/Execution Workspaces. Never provision a workspace per discussion.** Most thread previews resolve as unfurl/static (no port); only active dev tasks yield live servers, reached via localhost (v1) or the auth'd proxy (v1.1).
- **Creation modal** [new] over reused backends.
- **Autonomy = crew-activation** [new]: L1/L2/L3 presets + per-teammate override popover (the `autonomyLevel` int + `enabledCapabilities` substrate exists; ships at 0 today).

---

### 6.2 Real-time multi-user collaboration
**Audit finding:** AoA has a WebSocket event bus (`live-events.ts` + `/events/ws`), **company-scoped**, solid connection-auth, `discussion.entry.created` already fires — but it's **"refetch-on-poke"** (event → client invalidates React Query → RBAC'd REST refetch), **single-process** (in-memory EventEmitter, no pub-sub), with **no replay, no per-thread ordering, company-wide fan-out (no payload RBAC), no presence**.

**Sync model — refetch-first, then push hot paths:**
- **[v1]** Reuse the bus; add thread event types (`thread.entry.created` / `.scope.changed` / `.phase.changed` / `.summary.updated` / `.participant.changed`) + `LiveUpdatesProvider` handlers (keep the **refetch** model — simple, RBAC stays in REST). Build the **reliability foundations**: per-thread monotonic **`seq`** column; **catch-up endpoint** `GET …/threads/:id/entries?sinceSeq=N`; **refetch-on-reconnect**. Add **human presence + typing** (ephemeral TTL channel); reuse `agent.status`/`heartbeat.run.*` for the agent "working" indicator.
- **[v1] Per-thread scoping + envelope RBAC** *(pulled fwd from infra #3 — single-instance, no Redis)*: clients subscribe to the threads they're viewing (in-process subscription registry on the existing EventEmitter), and the server **filters every event by recipient RBAC at fan-out** — a user who can't see a `private`/Unlisted thread never receives even a poke about it. Closes the **private-thread metadata leak** (today's company-wide fan-out broadcasts the existence/ID of threads the recipient may not be allowed to see), which bites the moment v1 ships private/Unlisted threads. App-level work on the current bus; **no infra dependency**. The *cross-instance* version rides on the pub-sub backbone (infra #1).
- **[v1.1 / enterprise] Push content deltas** — with per-thread scoping + envelope RBAC already in place (v1, above), send the new entry/Scope **content over the socket** (instant, no refetch round-trip) plus **payload-level RBAC** (filter the *content* per recipient, since content — not just a poke — now travels) + **throttle/debounce** for noisy streams. An *optimization* over refetch-on-event (already safe); build only if the snappier feel is wanted.
- **[app-wide infra]** **Redis/NATS pub-sub backbone** for multi-instance fan-out (the in-process EventEmitter caps at 1 server) — belongs with the separate infra effort, serves all features. The v1 per-thread scoping + envelope RBAC then ride across servers on this backbone.
- **Concurrency:** entries are append-only (no conflict); Scope approvals = **idempotent server-side transitions** (first wins, rest no-op, broadcast result). **No CRDT/OT** — threads aren't co-edited rich text; revisit only if a shared live-edited doc surface appears.

---

### 6.3 Live integrations (Slack/WhatsApp) — [v1.1], greenfield connector layer
**Build on (exists):** host-side webhook verification — the **routine-trigger** path does HMAC-SHA256 + replay window + idempotency (`routines.ts:1274-1335`), copy it; **plugin runtime** with `webhooks.receive`/`http.outbound`/`secrets.read-ref`/`jobs.schedule`/`issues.create`/`issue.comments.create` (a Slack connector can be a plugin); **per-company encrypted secrets** + binding; `github_installations` company-binding template; the **ingest→entry→extraction→task** pipeline (`debrief-push`/MCP + dispatcher).
**Net-new:** OAuth connector framework (only GitHub App OAuth exists) — Slack OAuth (+ refresh + callbacks); **WhatsApp provider** (Twilio/Meta Cloud API, nothing today); **`thread_channel_bindings`** (§3.4); **continuous mirror** (webhooks are one-shot; need Slack Events API / Socket Mode → stream → `discussion_entry` on the bound thread); **per-channel ordering/dedup cursor**; **outbound rate-limit/backoff**; **backfill** (history import).
**Plan:** Slack first **as a plugin**, **one-way (mirror+extract)** → entries on the bound Live thread → dispatcher extracts → spin-offs; WhatsApp later; **two-way post-back** after, gated behind outbound rate-limits + §4.1 governance.

---

## 7. Locked-decision compliance (must honor — `DESIGN.md §20`)
- "Issues = Tasks in UI only" — never rename `issues`/`/issues`; "pre-task" is a Scope label; Create Task hits `/issues`.
- Per-item routing stays **founder-gated** (write task/memory only inside the approve path).
- **Only humans mark tasks done** (#18) — thread auto-resolve ≠ task `done`.
- **Planning `work_mode` suppresses auto-dispatch** (D8); honor `shouldDispatchIssueWakeup`.
- **Concurrency clamp** DEFAULT=1/MAX=50 (D5); **hire-approval default by deploy mode** (D6).
- **Memory:** agents never write identity/domain; Keeper proposes, founder approves (#15/#16/#52); feedback ≥3 (#46).
- **Goals:** status machine server-enforced (#60/#86), orthogonal to thread phase; ≥1 project via `project_goals` (#13); **sub-goals one level, enforced** (#20).
- **Artifacts immutable** (#43/#45); Compare = read-only diff; conflict "merge" = new version/human pick.
- CLI-only adapters; crew = roles via `kind='aoa'` (#91/#99/#100). Don't revive deprecated tables.
- **Ownership/visibility** (§5.1): owner is always **human** (agents never own); private-thread RBAC enforced at the **query layer + socket**, **composing** with department/role RBAC (founder > team_lead > team_member) — never widening it.
- **Deferred:** reconcile Commander's global surface (right-panel DA-4) when the global Commander UI is decided.

---

## 8. Migration
- Existing `discussions` rows → threads: backfill `origin`, `phase` (active→discuss/scope by heuristics), `subtype='normal'`. Existing `discussion_extracted_items` keep working (status-based Scope is unchanged).
- Existing `goals` are unchanged; surfaced as goal-threads via `discussions.goal_id` link (new threads) — existing standalone goals remain in the Goals tree, linkable.
- No data in deprecated tables to migrate (already superseded).

---

## 9. Build sequence (rough)
1. **Data model** — ALTER `discussions` (`owner_user_id`/`visibility`/`phase`/…) / `entries` / `extracted_items` / **`projects` (`default_thread_visibility`)** + new tables (participants w/ roles, links, plan_steps, scope_item_deps, inbox_items, entry_attachments).
2. **Thread service + lifecycle** (phases, Summary, promote-to-goal, fork/merge) + auto-extraction gate.
3. **Crew role files** (Scribe extend; Router/Planner/Dispatcher/Memory Keeper new) + trigger evaluators (mention/phase/routine).
4. **Threads shell UI** (focus 3-pane, Scope, viewer reuse) + creation modal.
5. **Continuum nav** (List + Board: Unlisted/Live/phase) + sidebar search + Router/Unlisted.
6. **Boundary model** (participants/@mention, **ownership + visibility/RBAC §5.1**, per-item routing, spin-off, cross-thread deps).
7. **[v1.1]** Graph lens (React Flow) · Live integrations · audio/Figma/HTML renderers · merge.
8. **[later]** L3 autonomy · worker→thread write-back · webhooks.

---

## 9b. Enterprise readiness (honest scorecard)
"Enterprise-grade" = gaps known + scoped, no surprises. **Design is enterprise-grade; platform has documented gaps.**
- **✅ Production-solid (reuse):** discussions backbone · orchestration (dispatcher/runner/crew + role-seeding) · extraction pipeline · CLI adapters · audit trail · encrypted per-company secrets · webhook verification (HMAC+replay+idempotency) · WS connection-auth.
- **🔴 MUST-FIX for v1:** *(autonomy brakes — §4.1)* real **cost accounting** for crew incl. SDK extract/classify spend (zeroed today) · **in-flight kill** reaching crew runs · **company/thread pause switch** · **`autonomyLevel` enforcement** · per-call **cost-caps** on extract/classify. *(real-time security — §6.2)* **per-thread scoping + envelope RBAC** — closes the private-thread metadata leak the moment v1 ships private/Unlisted threads.
- **🟢 v1 build (config, not infra):** **per-role model choice** — cheap Router / stronger Scribe (§4.2).
- **🟠 Cloud/multi-instance infra (app-wide — separate effort):** Redis/NATS **pub-sub** (real-time caps at 1 server; the v1 scoping + RBAC then ride across servers on it) · **preview proxy + auth** (§6.1) · **embeddings provider** strategy (hosted key vs local model, §4.2; v1 default = hosted SDK + Postgres-FTS fallback).
- **🟡 v1.1 build:** Live integrations (§6.3) · real-time **push content deltas + payload-RBAC** (§6.2) · **Graph lens** · LLM-at-scale **batching** (high-volume only).

## 10. Open / deferred (Tier-C) — resolutions
- **Live-preview security** → **resolved** (§6.1): static HTML = sandboxed iframe (no same-origin/top-nav); live apps = workspace-isolated; external URLs = sandboxed iframe.
- **Merge reconciliation** [v1.1]: entries interleave by time; **Scope = union → Scribe re-dedup**; contradictions → conflict cards; **canonical plan wins** (other's confirmed pre-tasks fold in unsequenced); both-have-goal → founder picks.
- **Worker→thread write-back** [later]: thread stores originating `issue_id` (`thread_links.kind='spawned_from_task'`); on answer, Dispatcher posts back an `issue_comment` + clears the block.
- **Router confidence UI** [v1]: **no raw %.** Auto-route → system note w/ reason; mid → one-tap "Add to X?" + reason on hover; low → stays in Unlisted. % is internal-only.
- **L3 autonomy** [later]: auto-delegate + auto-advance phase + auto-resolve the *thread*; **task `done` stays human-gated (#18)** — agents → in_review, human confirms. Hands-off completion = separate #18 reopen.
