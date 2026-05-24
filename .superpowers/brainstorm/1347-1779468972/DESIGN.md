# Threads — Design Doc (living)

> Status: **Brainstorm / in-progress**. We edit this as we discuss. Nothing here is locked until moved to the spec.
> Mockups: `content/thread-detail-v13.html` is current. v1→v12 are history.

---

## 1. The concept

**Threads** unifies AoA's Discussions + Goals into one neutral container. A Goal becomes an *optional property* of a thread, not a separate feature. Threads are **sequence-agnostic** — they can start from an idea, a goal, agent output, MCP input, voice, a transcript, or an integration message.

A thread is a **group chat with structure layered on top**:
- The **conversation** is human + agent posts in a timeline (Reddit-style nested replies).
- The **structure** (decisions, pre-tasks, memory, artifacts) is maintained by agents and surfaced in a dedicated Scope view.
- Humans stay in control of what gets confirmed and what becomes real work.

### The core reframe: a thread is a *workspace for unstructured data*

AoA already has **Execution Workspaces** — isolated per-task git worktrees where software work gets **done** (code → build → PR). A **Thread is the analog for the fuzzy front-end of work**: an isolated space where **dirty, unstructured input** (ideas, discussions, goals, transcripts, feedback, MCP dumps) gets **refined into structured output** (decisions, tasks, memory, plans, goals).

| | **Execution Workspace** | **Thread** |
|---|---|---|
| For | *doing* — building deliverables | *thinking* — structuring intent |
| Input | a defined task | dirty/unstructured anything |
| Output | code, designs, artifacts | decisions, pre-tasks, memory, plans |
| Shape | git worktree + dev server | conversation + comments |

Threads **feed** execution workspaces: a confirmed pre-task in a thread becomes a real task, which may open its own execution workspace. The thread is where intent becomes structured *before* it becomes work. And the reverse — a worker agent that **stalls or hits ambiguity can open a thread** to get unstuck (future). So thinking ↔ doing hand off *both ways*: thread → task when structured, task → thread when blocked.

**North-star dogfooding test:** *This very brainstorming conversation should run as a thread.* First message = the discussion seed. The heartbeat Thread Agent would interrogate, extract decisions, build scope, and draft the plan — exactly what we're doing by hand now. If the design can't carry this conversation, it's not done.

---

## 2. Layout

Three panes + two center tabs.

```
┌──────────┬─────────────────────────────────┬──────────────┐
│ LEFT NAV │ CENTER PANE                     │ RIGHT VIEWER │
│          │ ┌─────────────────────────────┐ │ (pure viewer)│
│ Unlisted │ │ Origin card (pinned)        │ │              │
│ Threads  │ │  title · chips · phase bar  │ │ Home (default)│
│ Live     │ ├──────────┬──────────────────┤ │ Task form    │
│          │ │ Thread   │ Scope ●          │ │ Viewer       │
│          │ ├──────────┴──────────────────┤ │ Browser      │
│          │ │ timeline  OR  scope items   │ │ Compare      │
│          │ │                             │ │              │
│          │ │ [chat input]                │ │ (resizable)  │
└──────────┴─────────────────────────────────┴──────────────┘
```

- **Left nav** — collapsible to 44px icon strip. Sections: Unlisted (inbound w/o destination), Discussions (thread list), Live (always-open integration threads: Slack/WhatsApp).
- **Center pane** — origin card pinned at top (always visible). Below it, two tabs: **Thread** (timeline) | **Scope** (structured items).
- **Right viewer** — pure viewer. Opens content on demand. Drag-resizable (200–640px, dbl-click → 308px). All tabs closeable.

---

## 3. Thread lifecycle

Four phases. The agent drives them autonomously (per autonomy level); humans can override.

```
DISCUSS  →  SCOPE  →  ASSIGN  →  DONE
```

| Phase | What happens | Agent mode |
|-------|-------------|-----------|
| **Discuss** | Free-form ideas, context, research, options. Agent interrogates (office-hours style) then waits for human. | Interrogate |
| **Scope** | Agent extracts items → builds structured plan. Human approves/edits in Scope tab. | Extract → Plan |
| **Assign** | Confirmed pre-tasks → real AoA tasks, matched to agents/humans. | Delegate |
| **Done** | All scope items resolved. Thread auto-resolves (agent) or human force-resolves. | Resolve |

**Gating:** can't move to Done while pending items remain.

### Reopen / Fork / Link
- **Continue** — resolved thread gets new activity → reopens to Discuss, orange dot on Scope (stale).
- **Fork** — same topic, new initiative → new thread, inherits artifacts + memory, "Forked from: …".
- **Link** — two related threads → bidirectional link under Scope "Related threads".
- The **Router** auto-detects which on new inbound; human confirms. UI shows one button: "Continue thread →".

---

## 4. Autonomy levels (setting: per-thread or company default)

| Level | Agent does autonomously | Needs human |
|-------|------------------------|-------------|
| **L1 — Assist** | Extraction only | Human triggers Scope, Assign, Resolve |
| **L2 — Drive** *(target)* | Discuss → Scope → Plan | Human confirms assignments |
| **L3 — Full** *(shown, "coming soon")* | Everything incl. delegation + resolve | Override after the fact |

---

## 5. Scope tab — Highlights · Plan · Items (one view, no toggle)

Scope = the structured distillation of the conversation (Thread = what was *said*; Scope = what it *amounts to*). One view, top-to-bottom **glance → structure → detail** (the old two-state toggle is dropped):

**① Summary** (renamed from "Highlights") — its *job* is **catch-me-up**, not stats. A Scribe-maintained one-line "where this stands" + a **"Next:"** bottleneck (what's needed to advance — thread-level, NOT user-specific) + two hard chips (**goal %** · **blocked**). *Not* per-user "needs you" (unreliable); a personal "for you" signal only appears when explicitly @mentioned/assigned, and lives in the Inbox.

**② The Plan** (structured + interactive) — confirmed pre-tasks arranged into ordered **steps** (collapsible), each task showing assignee (agent or human) + dependency badges. **Live, not a document:** click a task → Task form; stays in sync with real tasks. Built when the Planner runs (auto at L2 / explicit). Header actions: **Graph** (visual flow via the Graph lens) + **Export .md** (portable doc on demand). Empty before planning.

**③ Items** (granular triage) — **Needs input** (decisions/memory/pre-tasks to approve/reject, incl. **conflict cards** §19.1) · **Confirmed** · **References / Links** (pointers the thread surfaced — competitor mentions, links, cited docs; clickable → Browser/viewer; promotable to Memory) · **Artifacts**.

**Plan representation:** structured/interactive in Scope · visual via the **Graph lens** · optional **.md export** — the live board, the picture, and the doc without maintaining three.

**Versioning:** Scope is **always current** (status-based, not run-based). Re-extraction only adds + dedupes. Item history lives in the item detail (viewer); the **Thread timeline is the history.** Conflicts → conflict cards (§19.1). Orange dot ● on the Scope tab = new activity since last extraction (stale).

---

## 6. Right viewer — pure viewer

Context-driven tabs. Home is default; others open when you click something.

| Tab | Opens when | Shows |
|-----|-----------|-------|
| **Home** | default | Jump To shortcuts, Quick Actions, autonomy banner. *(approvals happen in Scope, not here)* |
| **Task form** | pre-task clicked in Scope | Full pre-filled form: title, desc, assignee, priority, goal, **linked artifacts from thread**, Create Task → |
| **Viewer** | artifact/doc clicked | Renders the file (see §7) |
| **Browser** | "Open in Browser" on artifact | iframe / live port |
| **Compare** | "Compare vN" | side-by-side version diff |

---

## 7. Viewer renderers (NEW — needs design)

The viewer must render many artifact types. These are **UI capabilities**, not agents:

- 🖼 Image (png/jpg/svg/webp)
- 🎬 Video (mp4/webm)
- 📄 Document (md, pdf, docx)
- 💻 Code (syntax-highlighted, diff)
- 🌐 HTML — **static** (sandboxed iframe) and **live** (running dev server on a port)
- 🎨 Design embed (Figma)
- ⇄ Compare (two versions side-by-side)

**Live port browser** connects to AoA's existing **Execution Workspaces** + `workspace_runtime_services` (dev server defs per workspace). When a worker agent produces a web artifact, it runs in a workspace; the Browser tab points at the live port.

---

## 8. Agent architecture (in discussion)

### 8.1 Why Commander agents ≠ worker agents

| | **Worker agents** | **Commander (+ its crew)** |
|---|---|---|
| Analogy | employees | chief of staff / the OS itself |
| Origin | *hired* per company (adapter, function type, API key) | *built-in* to AoA, no hire, no per-company key |
| Scope | department-scoped, assigned discrete tasks | company-wide, cross-cutting |
| Job | **produce** deliverables (code, design, docs) | **orchestrate** the flow of work |
| Where | execution workspaces | everywhere — routing, monitoring, structuring |

So there are **three layers**, not two:
1. **Orchestration** — Commander + crew. Routes, interrogates, extracts, plans, delegates, monitors. *Open question: how granular.*
2. **Production** — worker agents. Make the mocks/images/videos/HTML/code/docs. **Already exists.** Thread Agent delegates to them, at any phase.
3. **Rendering** — viewer UI (§7). Not agents. Shows the artifacts (incl. live port via workspace runtime).

### 8.2 Commander as a set of *roles*, not a fixed roster

Cleanest mental model: there is **one Commander intelligence** with a library of **roles**. A "sub-agent" = *Commander running in a specific role* = one **instruction file + skill loadout** (mirrors `server/src/onboarding-assets/` cxo/lead/default). "Seeding the Commander team" = authoring those role files. Features invoke the subset of roles they need.

### 8.3 Org-wide Commander roles (rough — to refine)

| Role | Job | Org-wide or Threads-only |
|------|-----|--------------------------|
| **Intake / Router** | classify + route all inbound (MCP, integrations, voice, email) | org-wide |
| **Scribe** *(Thread Agent core)* | turn conversation → structure: interrogate (office-hours), extract decisions/tasks/memory | org-wide capability, primary home = Threads |
| **Planner** | structured items + goal → sequenced plan w/ dependencies | org-wide (goals, workflows, threads) |
| **Dispatcher** *(Delegator)* | confirmed work → match to agent/human, create + assign tasks | org-wide |
| **Curator / Monitor** | continuous scan: stale, blocked, conflicts, budget, workload | org-wide, proactive (≈ Commander's existing proactive engine) |
| **Memory Keeper** | memory suggestions, feedback patterns, staleness/conflicts | org-wide |
| **Analyst** | answer queries, summarize, report | org-wide, on-demand |

**Threads uses:** Intake, Scribe, Planner, Dispatcher, Curator, Memory Keeper — i.e. almost all of them, *because Threads is the primary surface where unstructured becomes structured.* That's a signal Threads is central to Commander, not a side feature.

### 8.4 Generation
Production (mocks/images/videos/HTML/docs) = **worker agents + skills**, not a dedicated orchestration role. The Scribe/Thread Agent may produce *lightweight drafts inline* (a markdown brief, a rough HTML mock) via a generation skill, but anything substantial is delegated to a worker agent.

### 8.5 Office-hours = the Scribe's intake mode
The Scribe's *first* response to new content is clarifying questions ("what's the real problem? who's affected? what does success look like in 30 days?"), thread-aware so it never repeats what's known. Higher-quality interrogation → far better downstream extraction/plan. The Router applies a lighter version (interrogate content before routing). "Office hours" was the example; the real deliverable is the **instruction file + skill set per role**, seeded like `onboarding-assets/` (cxo/lead/default).

### 8.6 How the founder experiences the crew — Model B (locked)

The founder sees a **named crew** ("Commander's team" — name TBD), not one opaque assistant. Each teammate (Router, Scribe, Planner, Dispatcher, Curator, Memory Keeper…) is visible, individually tunable, and toggleable. *Built* as one intelligence loading role files (instructions + skills); *presented* as distinct teammates — matches the "army of agents" thesis and makes orchestration legible.

- **Autonomy level = crew activation.** The dial controls how many teammates are on duty: L1 = Scribe only (extract) · L2 = + Planner (drive Discuss→Scope→Plan) · L3 = + Dispatcher + Resolver (delegate + close). Raising autonomy literally lights up more of the crew — turns an abstract slider into something you can see. **Control is hybrid (locked):** L1/L2/L3 presets are the default bundles; power users can override individual teammates underneath (e.g. "L2, but keep Dispatcher manual").
- **The crew is an extensible registry, not a fixed cast.** Add a teammate = add a role file. Grows as the company matures / as capabilities are installed. Add/modify-friendly from day one (already the direction — AoA has Commander-team basics built).

### 8.7 Memory — capture everywhere, curate in one place

Memory is special: it's the company's *compounding asset*, so it must not turn to mush. Split the work:

- **Capture = distributed.** *Every* agent (worker + crew) emits memory candidates as a byproduct of its work — each has the context to notice what's worth remembering. Cheap, parallel, scales with activity.
- **Curate = centralized.** One **Memory Keeper** consumes the candidate stream: dedupes, resolves conflicts, runs **cross-cutting pattern detection no single agent can see** (the existing ≥3-occurrence rule), batches for founder approval (identity/domain stay founder-gated), runs staleness/archival sweeps.
- **Retrieval = shared infrastructure** (semantic search over embeddings) — available to every agent, not an agent itself.
- Producers many, editor one. That's how the knowledge base stays accurate at scale. Larger orgs / higher autonomy may later add specialist memory roles (e.g. per-layer keepers) — the registry allows it.

Maps onto the existing 4-layer (identity/domain/active_context/working), approval-gated, feedback-pattern memory system.

---

## 9. Thread types — Origin & Intent (two dimensions)

Auto-detected by the Scribe at creation, **manually overridable**, and the agent may update later.

**Origin** (how the thread was born — one primary). Modeled as `source` + `medium` for future-proofing:

| Origin | source | medium |
|--------|--------|--------|
| Idea | human | text *(call it "Idea" not "Discussion" to avoid redundancy inside Discussions)* |
| Voice | human | audio |
| Transcript | human/external | transcription (paste OR Fireflies/Otter via MCP) |
| Document | human/external | file (pdf/docx) |
| Goal | human | structured |
| Agent | agent | any (worker-initiated / pushed update) |
| MCP | external | api (non-transcription inbound) |
| Routine | system | scheduled |
| Webhook | external | api (future: Zapier/Make) |
| Integration | external | integration (Slack/WhatsApp) |

**Intent** (what it's for — multi-taggable): Planning · Review · Decision · Research · Problem · Alignment · Feedback · Retrospective.

---

## 10. Visibility · Scoping · Linking · Merging · Templates

- **Scope:** Company-wide 🏢 vs Department-scoped 🏬 — toggle in thread header at creation.
- **Visibility — two states, layered defaults:** **Open** (everyone in the thread's scope) vs **Private** (owner + invited participants). A **per-department default** sets what new threads start as (HR/Finance/Exec → private; others → open); the owner flips any thread open↔private. **"Custom audience" = private + invite** — the participant list *is* the access list (no separate custom level). Integration threads inherit from the connected channel. **Enforced at the query layer (list/board/search/counts) AND the live socket — one rule: a thread you can't see never appears and never pokes you.**
- **Ownership — "owned by action" (always human):** every thread/goal has one **primary human owner** (+ optional co-owners). Human-created → owner instantly; non-human-created (agent/integration/schedule) → **Unclaimed** (in Unlisted), nudging the lineage human (originating task's owner → channel connector → routed dept lead → founder backstop). Becomes owned by **either** an explicit **Claim** OR the first **governance action** (approve / advance phase / assign). Owner can **transfer** ownership and **add/remove** participants. Agents are creator/source, **never** owner.
- **Referencing:** `@[Thread Name]` creates a **bidirectional link**; shown in a Links/Related area; listing surfaces reference counts (hub-thread discovery).
- **Merging:** select two → pick canonical → other archives with "merged into X" note, entries interleaved by timestamp.
- **Templates:** Product Review, Sprint Planning, Research Brief, Problem Investigation, Retrospective. Commander suggests one at thread start; a template seeds intent tags + starter prompts + extraction-schema hints.

---

## 11. Integration threads (Live section)

A permanent thread subtype mapped 1:1 to a Slack channel / WhatsApp group / email inbox.
- Every inbound message → a thread entry automatically; extraction runs continuously.
- **Always Open** — can be Paused / Disconnected, never Resolved.
- Live in the **Live** section of the left nav (teal accent, "Always open", connected indicator).
- **Bypass Unlisted entirely** — inputs route straight to their dedicated thread.
- *Why it matters:* "most real decisions happen in WhatsApp and disappear — this makes AoA the structured record of what was actually discussed."

**Live-thread detail view (differs from a normal thread):**
- **Origin card:** integration chrome — channel name + Slack/WhatsApp icon + "Always-open · connected · last sync 2m" + member count. **No phase bar** (never resolves) → a **Connected/Paused** control instead.
- **Thread tab:** the channel's messages mirrored in, original senders as authors (continuous, high-volume).
- **Scope tab:** the payoff — Scribe **continuously extracts** decisions/tasks from the chatter, and **spins off normal threads** for anything needing real work (e.g. a bug in #bugs → a linked Engineering thread). Turns ephemeral chat into a structured record + feeds the system.
- **Sync = one-way for v1** (mirror in + extract + spin off; no post-back). **Two-way (post back to the channel) is a fast-follow** — needs identity/permissions + write integration.

---

## 12. Unlisted queue & routing

- **Unlisted** sits at the top of the left nav with a count badge. Inbound without a destination lands here.
- Each item: **Make thread** (→ new thread, item = first entry) or **Add to thread ▾** (→ search open threads; item appears with origin noted, e.g. "Added from Unlisted · MCP · via Priya").
- **Router confidence tiers:** >80% → auto-attach + system note (leaves Unlisted) · 40–80% → stays in Unlisted with a one-tap suggestion · <40% → stays for human to pick/create.
- Arrival alert = **silent count badge** (no toast; consistent with Inbox).
- ⚠ **Open:** the *Router confidence UI* affordance — user picked "something else" and hasn't specified. (Re-ask.)

---

## 13. Navigation — the continuum (LOCKED)

The thread index is **one resizable surface**, not two separate views. It breathes by width:

```
44px ───── 220px ──────── (drag / snap) ──────── full width
icon strip  vertical list   columns form          KANBAN BOARD (home)
```

- **Board (wide)** = browse mode. Columns = the **phases** (Discuss · Scope · Assign · Done). Cards = threads. Dragging a card across columns = manually advancing that thread's phase.
- **Click a card → focus.** The index snaps to the narrow list and the thread's detail opens (Thread/Scope + viewer = the v6 three-pane).
- **One thread open at a time** — the board IS the switcher. No tabs.
- **Both drag and a snap button.** The List/Board button snaps to the wide board (discoverable); dragging the index edge gives the fluid in-between (delight).
- Board mode hides the detail/viewer (full width); they return on card click.

**Home / creation surface** (quick-start tiles + recents) — still to design; likely just the board's empty/onboarding state.

### 13.1 Lenses (the index renders multiple ways over the same threads)
- **List** — flat feed.
- **Kanban / Pipeline** — columns = phases (Discuss/Scope/Assign/Done).
- **Graph / Network** *(user idea)* — nodes = goals · sub-goals · threads (· tasks); edges = parent→sub-goal (hierarchy), thread→goal (scoped/related), thread→task (produces). The natural home for the goal + sub-goal + related-thread **web** — shows relationships a tree or list can't. Click a node → open it; hover → highlight its connections. (A goals **tree** is just a constrained graph — may be a mode of this.)

### 13.2 Managing goals/sub-goals *inside* a goal-thread
A goal-thread is the goal's command center. Beyond Thread (discuss) + Scope (structure), it surfaces:
- **Sub-goals** — child goals w/ status; "+ Sub-goal" to add; click → that sub-goal's thread.
- **Related threads** — other threads scoped to this goal (auto, via `scopeType:'goal'`).
- **Tasks toward the goal** — `issues` with `goalId` = this goal.
- **Progress roll-up** — sub-goals achieved / tasks done.

**Sub-goal weight** (lightweight record vs. always-its-own-thread) = **deferred — stress-test with use cases.**

### 13.3 View consistency + refinements
- **Live in the board:** integration (Slack/WhatsApp) threads are always-open and don't fit phase columns → pin a **Live lane** beside the **Unlisted lane** (both special, non-phase). Board = `Unlisted · Live │ Discuss · Scope · Assign · Done`; sidebar = `Unlisted · Discussions · Live`. Both views now cover the same buckets.
- **Sidebar search:** add a thread search/filter to the left nav (board already has one; ⌘K is global).
- **New Thread → relate/add-to:** top control = **New standalone** · **Add to existing ▾** (content becomes an entry) · optional **Relate to ▾** (new thread + bidirectional `@[Thread]` link). Mirrors DiscussionCaptureModal's "add to existing."
- **Graph lens = use a library** (mock uses hand-placed divs). Lean **React Flow** (React-native, custom card nodes, pan/zoom/minimap; dozens–hundreds of nodes) over **Sigma.js** (WebGL, for thousands — overkill) or **Cytoscape** (best algorithms, heavier). Decide at build.

### 13.4 Open design items (turn 12)
- **Home = the board** — the continuum (List/Board/Graph) IS the landing; no separate Home surface. [resolved]
- **Attachments & renderers** — threads are a group chat; posts carry **images · video · audio (voice notes) · files · docs (pdf/docx/md) · code · links**. Viewer renders each — completes §7 with **audio playback**, **inline image/video**, **json**. Voice = both an *origin* (Whisper→text + playable audio) and an in-post attachment.
- **Highlights — rethink (deciding):** "needs *you*" is per-user/unreliable → move to **objective thread status** (phase · N to confirm · blockers · open tasks · goal % · updated). A personal **"for you"** badge appears only when explicitly @mentioned/assigned (else it lives in Inbox).
- **Router (clarified):** crew role that routes external inbound → existing thread / Unlisted by semantic match; tiers >80% auto / 40–80% suggest / <40% human. "Router confidence UI" still open.
- **Still to discuss:** `reference` item destination · integration (Live) thread detail view · Tier-C (live-preview security, merge, worker→thread, L3).
- **Sequencing (per user):** finish design discussion → **verify against the actual platform/codebase** (what exists, what conflicts) → reconcile → *then* foundation (data model, migration) + spec.

---

## 14. Data model & existing systems to reuse

Brainstorm stayed at concept/UX level — **no new schema designed yet.** Known reuse points:

- **Backing tables:** `discussions`, `discussion_entries`, `discussion_extracted_items`, `discussion_annotations` (current DB language = `extracted_items`).
- **Extraction agent:** existing "Discussion Extraction" sub-agent (single tool `submit_extracted_items`, **45s transactional-outbox sweep**) → **rename "Thread Extraction"** / fold into the Scribe role.
- **Goals:** existing status machine `planned → active → at_risk → achieved/cancelled`; origin "Goal" chip → goal surface.
- **Live preview:** **Execution Workspaces** + `workspace_runtime_services` (dev-server defs per workspace) back the live-port Browser renderer. Conceptual parent of the whole "thread = workspace" reframe.
- **Tasks:** confirmed pre-tasks → real `issues` on Assign (Create Task from the pre-filled viewer form); a task may open its own Execution Workspace.
- **Role seeding:** `server/src/onboarding-assets/` (cxo/lead/default) is the pattern for per-role instruction files + skills.
- **Heartbeat:** the Scribe/Thread Agent runs autonomously in its heartbeat.
- **Design system:** brand red `#b82d1c`, warm neutrals, Inter + Geist Mono (numbers/timestamps), 6-color data palette (origin icons use it at 10% bg / 25% border), dotted-pill badges, radial brand wash on headers.

### 14.1 Existing create-task form — the thread Task form must match it
`ui/src/components/NewIssueDialog.tsx`. Wired fields: **title** (req) · **description** (markdown + @mention + image) · **assignee** (agents) · **project/department** (one picker; one table serves both) · **status** (backlog/todo/in_progress/in_review/done) · **priority** (`critical/high/medium/low` — *no "urgent"*) · **work mode** (standard/planning) · **environment** · **workspace mode** (conditional). `goalId`, `parentId`, `labels`, `dueDate` exist in `issues` schema + `createIssueSchema` but are NOT in the create dialog (set contextually). Dependencies live in `task_dependencies`, added post-creation. → **Thread Task form = these exact fields + thread pre-fills** (goal from thread, linked artifacts/transcript as context + dependency candidates). The v7 mock form must be corrected to this.

### 14.2 Goals + sub-goals (real, fully wired)
`packages/db/src/schema/goals.ts`, `NewGoalDialog.tsx`, `GoalTree.tsx`. **Sub-goals exist** via `parentId` self-FK (NewGoalDialog has parentId → "New sub-goal"; GoalTree recurses; GoalDetail has a Sub-Goals tab). *"One level deep" (Decision #20) is doc-only, NOT code-enforced.* Goal fields: title (req) · description · **level** (company/team/agent/task) · **status** (planned→active→at_risk→achieved/cancelled, server-enforced) · **parentId** · ownerAgent · **≥1 department/project** (required; many-to-many via `project_goals`). Goal↔tasks = `issues.goalId`; goal↔memory = `active_context` (goal-scoped, auto-archived on goal completion).

### 14.3 Existing creation flows → the "New Thread" modal
- **No unified creator today.** Three separate dialogs, all centralized through **`DialogContext`** (`ui/src/context/DialogContext.tsx` — `openNewIssue` / `openNewGoal` / `openDiscussionCapture` + defaults payloads). A "New Thread" modal extends this pattern (`openNewThread(defaults?)`). No global "+ New" in the sidebar today — creates live on the Dashboard + ⌘K command palette.
- **Discussion creator** = `DiscussionCaptureModal.tsx` (serves both new + add-to-existing). Fields: "add to existing discussion" dropdown · input-mode tabs (**only Paste/Write + Voice** today; `write`/`mcp` enums exist but UI doesn't emit them) · optional title (auto-gen) · **department** dropdown (only department scope is UI-selectable; project/goal scope only via defaults). Extraction is **manual** ("Reprocess"), not auto-on-create.
- **Goal creator** = `NewGoalDialog.tsx`: title · description · status · level · parent (sub-goal) · **projectIds (≥1 required)**.
- **Shared scope vocabulary:** both discussions + goals use polymorphic `department | project | goal`. **No backend changes needed** for a unified creator — it branches the type and calls `discussions.create` (createDiscussionSchema: title + scopeType/scopeId + entry{inputType,rawContent}) or `goals.create`.
- Backend: `POST /companies/:cid/discussions` + `…/discussions/:id/entries` (`server/src/routes/discussions.ts`); RBAC founder|team_lead.

**Resolutions (this turn):** phase + goal-status are **layered** (phase bar stays; goal status rides the ⚑ chip). New Thread = **one adaptive modal** branching on type (Idea/Discussion/Goal/Transcript/Document), reusing the scope picker + the existing backends. Unlisted on the board = a pinned **Inbox lane** (not a phase column); click = triage, not focus.

---

## 15. Locked decisions

- Posts-with-attachments model: everything is a post; decisions/pre-tasks/artifacts are attachments inside posts. No standalone card types. Icon + color conveys type (no inline type labels).
- Origin card pinned above the Thread/Scope tabs (phase bar always visible).
- Center tabs: **Thread | Scope**. Right viewer = pure viewer.
- Tab name = **Scope** (not Extractions/Items/Outputs).
- Pre-task click → **full pre-filled Task form in the viewer** (one-click create + assign).
- Stale signal = **orange dot on Scope tab**.
- CTAs are **phase indicators + overrides**, not separate-agent triggers. Agent drives at L2.
- Phase override = **clickable phase pills** (click a phase to jump w/ confirm; current phase shows a small Re-run). No cryptic icon cluster.
- A thread is a **workspace for unstructured→structured data** — the thinking-side analog to Execution Workspaces.
- Three agent layers: **Orchestration** (Commander roles) / **Production** (worker agents) / **Rendering** (viewer UI). Generation = worker-agent job (Scribe only does lightweight inline drafts).
- **Model B** — founder sees a **named crew** (built as one intelligence loading role files). Crew = extensible registry.
- **Crew name = "Command Staff"** (the set of Commander roles; "crew" stays lowercase shorthand). (§1)
- **Autonomy = crew activation**, **hybrid control** (L1/L2/L3 presets + per-teammate override). L3 shown but greyed in v1.
- **Memory = capture distributed + curate central** via a single **Memory Keeper**.
- **Thinking ↔ doing handoff both ways** (thread→task; blocked task→thread, future).
- Four product pillars: **Threads** (front door) · **Memory** (compounding asset) · **the Command Staff** (the crew — labor) · **Autonomy** (the dial).
- **Crew is visible & controllable** via a popover off the autonomy pill on the origin card: L1/L2/L3 presets + per-teammate toggles (hybrid). Built in v6.
- **Both** sidebars collapse to a 44–46px **icon rail** (left nav already; right viewer added in v6). No 8px blank strip.
- Phase overrides are the **phase pills themselves** (click to jump; active pill shows ↻ re-run). Cryptic ↩↷→ icons removed.
- **Navigation = continuum** (§13): the left index resizes icon→list→Kanban board; columns = phases; click a card → focus; **one thread at a time**; drag + snap button. No separate Board view, no tabs.
- **Phase + goal-status layered**: goal-threads keep the phase bar AND show goal status on the ⚑ chip (e.g. "Activation goal · Active"). (§10)
- **New Thread = one adaptive modal** (extends DialogContext): type chooser (Idea/Discussion/Goal/Transcript/Document) → fields adapt. Goal type = NewGoalDialog fields (level, parent/sub-goal, projects required). Reuses existing `discussions.create`/`goals.create` backends. Built v8.
- **Unlisted on the board = a pinned Inbox lane** (amber, not a phase column); click = triage (Make thread / Add to ▾ / Dismiss), not focus. Built v8.
- **Thread Task form = NewIssueDialog parity**: title, description, assignee, project/department, status, priority (`critical/high/medium/low`), work mode, environment + thread pre-fills (goal, linked artifacts). Corrected in v8.
- Commander floating button removed from Threads UI (global decision, not here).
- **Ownership = "owned by action"**: one primary human owner (+ co-owners); human-create → instant owner; non-human-create → **Unclaimed** in Unlisted until a human **Claims** it OR takes a governance action (approve/advance/assign); owner can transfer + add/remove participants; agents are creator/source, **never** owner (accountability is always human). (§10, §19)
- **Visibility = open/private, layered**: open (scope) vs private (owner + invited); per-department default; **custom audience = private + invite** (the participant list is the ACL); enforced at the query layer AND the socket (one rule, two points). (§10)
- Commander vs Threads = Option C: Commander is the personal/ephemeral assistant (⌘K, global); Threads are persistent topic workspaces where Commander participates.

---

## 16. Open questions

1. **Crew roster** — Model B locked (founder sees named teammates, §8.6). Still to lock: the exact org-wide role list (§8.3 proposes 7) and which ship in v1.
2. ✓ **Autonomy granularity** — RESOLVED: **Hybrid** (L1/L2/L3 presets as defaults, per-teammate override underneath). (§8.6)
3. **Scope State 1 → State 2 transition** — automatic when "enough confirmed," or explicit? How does the founder perceive the switch?
4. **Live preview security** — sandboxing for arbitrary HTML/web artifacts in the viewer.
5. **Generation line** — where exactly is the boundary between a Scribe lightweight inline draft and a worker-agent deliverable?
6. ✓ **Memory Keeper scope** — RESOLVED: **one Keeper**, capture-distributed; add per-layer specialists later if needed. (§8.7)
7. **Team name** — "Commander's team" / Crew / Cabinet / Desk / …
8. **Worker → thread** — a blocked worker agent opens a discussion to get unstuck (future; confirm roadmap).
9. **Router confidence UI** — user picked "something else" earlier and never specified. (§12)
10. **Phase vs Goal status** — a goal-thread has both a thread *phase* (Discuss→Scope→Assign→Done) and a goal *status* (planned→…→achieved/cancelled). Do they coexist (phase bar + goal-status chip), or does the phase bar swap to goal status for goal-threads?
11. **Creation flow** — one adaptive "New Thread" dialog (type picker → fields per type) for Idea / Goal / Discussion / Transcript / Document; the Goal type reuses NewGoalDialog fields incl. parent (sub-goal). Inbound paths (MCP/voice/integration/agent) bypass it.
12. **Unlisted in the board** — pinned **Inbox lane** (NOT a phase column); click = triage (Make thread / Add to thread ▾ / Dismiss), not the focus 3-pane (no thread exists yet).
13. **Card spec** — board/list card fields: origin icon · title · type/intent chip · dept/project · ⚑ goal (+ goal status if goal-thread) · owner · last activity · unread · pending-scope count; goal-threads add level + sub-goal count.
14. **Sub-goal surfacing** — how prominent in a goal-thread (a Scope/"Sub-goals" surface in focus; expandable children on the board?).

---

## 20. Platform reconciliation (codebase audit)

Audited the design against the real AoA codebase (3 parallel audits: data model · services/infra · locked-decision conflicts). **Headline: the design holds up — reuse-heavy, the orchestration backbone is ~70% already built, only a handful of real issues.**

### Reuse (lean on these; don't rebuild)
- **Conversation backbone:** `discussions` / `discussion_entries` / `discussion_extracted_items` / `discussion_annotations` ARE Threads' backing tables.
- **Orchestration/execution (~70% built):** generalized dispatcher (`runAoaDispatch`), runner (`runAoaAgent`), wakeup queue, **role-file seeding** (`onboarding-assets/` + `seed-commander-bundle`), **crew = `agents.kind='aoa'` + skillKeys + `aoa_agent_triggers`**, `internal_agent_runs(triggerType='sub_agent')`. **Manual @agent and auto-delegate already share one mechanism** (`delegate-to-subagent` → `agent_wakeup_requests` → dispatcher Phase 3).
- **Curator = existing proactive engine** (`internal-agent/proactive.ts`). **Memory curation** + `memory_feedback_patterns` (≥3 rule) + conflict fields exist.
- **Viewer + live preview:** `WorkspacePreviewPanel` already has the tab model + live-port browser via `workspace_runtime_services` — big reuse for the right viewer.
- **Goal-as-property:** zero goal-side schema change (`goals.parentId` + `project_goals` already do sub-goals + dept M2M). Just add `discussions.goalId`.
- Creation (DialogContext + discussions/goals/issues backends), RBAC, notifications, search, adapters → reuse/extend.

### Net-new builds (the real work)
1. **Threads container model** — ALTER `discussions` (origin/intent/phase/visibility/goalId/subtype/fork-merge/summary) + Thread↔Goal↔Discussion unification.
2. **Integration (Live) threads** — Slack/WhatsApp ingest fully greenfield (`thread_channel_bindings`, continuous mirror+extract).
3. **Threads UI shell** — 3-pane + continuum (List/Board/Graph via React Flow); `DiscussionDetail` is a flat list today.
4. **Router + Unlisted + confidence routing** (`thread_inbox_items`).
5. **4 crew role files** (Router/Planner/Dispatcher/Memory Keeper; Scribe ≈ extend Extraction) + **new trigger evaluators** (only `outbox` implemented; mention/routine/event seams exist).
6. **Autonomy = crew-activation UI** (`autonomyLevel` ships at 0 today).
7. **New tables:** `thread_participants` · `thread_links` · `scope_item_dependencies` · `thread_plan_steps` · `thread_channel_bindings` · `thread_inbox_items` · `discussion_entry_attachments`. **ALTER** `discussion_extracted_items` (add artifact + spin_off types; committed assignee **agent|human** + dept + dependency).
8. **Small renderers:** audio, Figma embed, sandboxed HTML (JSON folds into text). Gotcha: priority enum mismatch (`urgent` vs `critical`).

### Conflicts & must-respect (vs locked decisions)
- **🔴 FIXED (design bug):** "Memory Keeper writes the winning memory" → violated #15/#16/#52. Now: Keeper *proposes* (pending), founder approves. (§19.1)
- **🟢 NAMING (resolved):** **"Discussions" stays the sidebar section label** (honors DA-3); **each item is a "Thread."** "Discussions contains Threads." No superseding decision needed.
- **🟢 SUB-GOAL DEPTH (resolved):** **one level of goal nesting, and ENFORCE it** (add the depth guard the code is missing). Deeper structure = spin-off threads + task subtasks, not nested goals. Goals stay the strategic layer; the Graph still shows the full goal→sub-goal→thread→task web. Honors #20.
- **📌 Pin to the locked side (spec):** Router auto-attach lands a thread *entry*, never auto-creates a task except authenticated-write MCP (#14) · only **humans mark tasks done** — thread auto-resolve ≠ task done (#18) · **planning `work_mode` suppresses auto-dispatch** (D8) · concurrency clamp + hire-approval hold for @agent/Dispatcher fan-out (D5/D6) · goal status machine orthogonal to thread phase (#60/#86) · artifacts immutable (#43/#45).
- **Deferred:** Commander's global surface (right-panel DA-4) vs "Commander participates in threads" — reconcile when the global Commander UI is decided.

---

## 17. Changelog
- *(turn 19)* **Pre-plan decisions locked.** Watch/Follow toggle = **v1.1** (v1 notifies via participant + @mention). Embeddings **v1 default = hosted SDK + graceful Postgres-FTS fallback** (provider strategy stays infra #4). **Crew named "Command Staff."** SPEC verified end-to-end; minor consistency fixes (build-sequence, `thread_links` enum). Ready for writing-plans.
- *(turn 18)* **Ownership + visibility model locked.** Ownership = "owned by action": one primary human owner (+ co-owners), human-create → instant, non-human-create → Unclaimed in Unlisted until Claim OR a governance action; transfer + add/remove participants; agents never own (accountability is human). Visibility = open/private, layered: per-department default + custom-audience-via-private-invite, enforced at query layer AND socket. Written into §10, §15, §19 + SPEC §2 / §3 / §5.1.
- *(turn 17)* **Pulled the single-instance slices of infra #3/#5 into v1.** #3 → SPEC §6.2: **per-thread scoping + envelope RBAC** now [v1] (closes the private-thread metadata leak the moment v1 ships private/Unlisted threads; app-level, no Redis). #5 → **per-role model choice** [v1] (§4.2) + **per-call cost-caps on extract/classify** folded into the §4.1 brake. Stays later: push content deltas + payload-RBAC [v1.1], multi-instance fan-out + high-volume batching = app-wide infra. Updated §2 v1-cut + §9b scorecard + trimmed INFRA-FOLLOWUP.md (#3/#5 now mark only their multi-instance/high-volume residue).
- *(turn 16)* Enterprise deep-dives into SPEC: **§6.1 preview/port** (tiered; proxy = enterprise gap; today local-only), **§6.2 real-time collab** (refetch-first→push; reliability foundations; Redis = app-wide), **§4.1 autonomy/cost governance** (audit found it's HALF-built for crew — cost zeroed, in-flight kill misses crew, no kill-switch, autonomyLevel unenforced → required v1 work), **§6.3 Live integrations** (build on routine-webhook + plugin runtime; OAuth/channel-binding/mirror net-new). URL/port + Redis pub-sub flagged as app-wide infra for a separate effort.
- *(turn 15)* Resolved naming (Discussions=section/Thread=item) + sub-goal depth (one level, enforced). **Wrote `SPEC.md`** — full implementation spec (v1 cut, data model, crew, services, UI, locked-decision compliance, migration, build sequence). Ready for review → writing-plans.
- *(turn 14)* **Platform-verification pass** (3 codebase audits → §20). Verdict: reuse-heavy, orchestration ~70% built. Fixed the Memory-Keeper-writes-memory bug (§19.1). Surfaced 2 decisions (naming vs DA-3; sub-goal depth #20) + the must-respect pins for the spec.
- *(turn 13)* **Built v13 — Live-thread detail**: integration chrome (Connected/Pause, members, last-sync), no phase bar, channel-style timeline (real senders), continuous-extraction note + decision card + spin-off note. Click a Live nav item → this view. Design exploration now complete across all surfaces.
- *(turn 12)* Renamed Highlights → **Summary** (Scribe catch-me-up line + "Next:" bottleneck + goal/blocked chips; not per-user). Added **References** group to Scope. Captured **Live-thread detail** (one-way v1, no phase bar, continuous extract + spin-off) + attachments/renderers (image/video/audio/file/json) + Home=board. Built v12.
- *(turn 11)* **Built v11**: Live lane on the board (parity w/ sidebar), sidebar thread search, New Thread relate/add-to control. Graph lib = decide-at-build. (§13.3)
- *(turn 10)* **Built v10 — the boundary model**: Graph lens (goal/sub-goal/thread/spin-off web, 3rd view via List/Board/Graph toggle), participants + @mention on origin card, spin-off-thread item in Scope, per-item human assignment in the Plan, action-first Highlights (⚡ need you · ⊘ blocked · phase · freshness · goal). (Note: viewing must use a clean static port — the AoA app's service worker on :5174 wedges that origin; serving on :7788.)
- *(turn 9)* Reworked §5 Scope to **Highlights → Plan → Items** (dropped the two-state toggle). Plan = structured/interactive (live tasks, agent+human assignees, dependency badges) + Graph + .md export. Resolved G3 (promote→goal=attach), G4 (conflict card), G5 (sub-goal weight = spin-off principle), G6 (Planner-driven), G7 (delegation via @agent). Locked the boundary model (§19: participants+@mention, per-item routing, hybrid fan-out incl. spin-off threads, cross-thread deps v1, crew skills). **Built v9** (new Scope tab).
- *(turn 8)* Grounded creation in code (3 research agents: NewIssueDialog fields, goals+sub-goals model, DiscussionCaptureModal + DialogContext). Resolved: phase+status **layered**, creation = **one adaptive modal**, Unlisted = **Inbox lane**, Task form = **NewIssueDialog parity**. **Built v8**: New Thread modal (Idea + Goal adaptive), Unlisted lane on board, corrected Task form, goal-status on ⚑ chip. Added §14.1–14.3 (code facts).
- *(turn 7)* Locked the **navigation continuum** (§13): index breathes list⟷Kanban by width (no separate Board view), click card→focus, one-thread-at-a-time, columns = phases. **Built v7** — board (phase columns + thread cards), click-card→focus, List/Board snap + nav-edge drag-to-board. Verified working.
- *(turn 6)* Built **v6**: clickable phase pills (cryptic icons gone), **crew & autonomy popover** off the origin card (presets + per-teammate toggles), **right viewer collapses to an icon rail** like the left nav. Open: Board/Kanban view model (how it relates to sidebar + its states).
- *(turn 5)* Resolved autonomy granularity = **Hybrid**, Memory Keeper = **single keeper**. Added "four pillars" framing. Next: lock v1 crew roster + scope cut.
- *(turn 4)* Locked **Model B** (founder sees a named crew; built as roles). Added §8.6 (autonomy = crew activation; crew = extensible registry) + §8.7 (**memory: capture distributed, curate central** via one Memory Keeper). Added thread↔task two-way handoff (§1). New open Qs: autonomy granularity, Memory Keeper scope, team name, worker→thread.
- *(turn 3)* Folded in the full transcript-mining record: added §9 Thread types (origin+intent), §10 visibility/scoping/linking/merging/templates, §11 integration threads, §12 unlisted & routing tiers, §13 views & deferred surfaces, §14 data model & reuse points, §8.5 office-hours intake. Re-surfaced open item: Router confidence UI.
- *(turn 2)* Added **workspace reframe** (§1). Rewrote §8 → 3-layer model + Commander-as-roles + org role map. Locked phase-override = **clickable phase pills**. Launched background agent to mine prior transcript.
- *(turn 1)* Created doc. Captured concept, layout, lifecycle, autonomy, scope two-state, viewer renderers, agent model.

---

## 18. Stress-test results (22 cases → gaps & priorities)

Ran all 22 cases (`USECASES.md`) against the design. **7 hold** (#2, 5, 6, 8, 14, 16, 20) — single-thread lifecycle, Slack/WhatsApp integrations, proactive agent-origin threads, code/PDF viewing, nested-reply convergence. **15 surface gaps/decisions**, consolidated + prioritized:

### Tier 1 — resolve before the spec (core)
- **G1 · Per-item multi-dept fan-out** (#1, 3, 18) — one extraction run can't route different items to different departments; items inherit one thread scope. The most common real pattern (standups, sales calls). Needs a model.
- **G2 · Human (non-agent) assignment** (#11, 18) — create-form/Dispatcher assigns *agents only* (§14.1); AoA is a hybrid workforce — humans must be assignable.
- **G3 · Promote thread → Goal** (#12) — no mechanic to backfill required goal fields (level, ≥1 project) onto an in-flight Idea thread.
- **G4 · Conflict-resolution UI** (#17, 21) — conflicts are only "flagged"; no item-vs-item surface to compare/supersede (Compare = version-diff, not item-vs-item). Trust-critical.

### Tier 2 — decide soon (some may be v1.1)
- **G5 · Sub-goal weight** (#10, 12) — lightweight record vs. always-its-own-thread; decide the spawn rule.
- **G6 · Scope State 1→2 transition** (#11) — auto vs explicit + its UI signal.
- **G7 · Delegation handoff mid-thread** (#13) — how the Scribe picks a worker and posts its output back as an artifact.
- **G8 · Cross-thread dependencies** (#4, 18) — make one thread's pre-tasks block another's; no thread affordance today.

### Tier 3 — defer / easy / known
- **G9 · Graph lens** — a view; v1.1.
- **G10 · JSON + audio renderers** (#7, 9) — easy; fold JSON into Code, add an audio player.
- **G11 · `reference` item destination** (#3) — specify where references land/render.
- **G12 · Worker→thread reverse handoff + write-back** (#15) — explicitly future (open Q #8).
- **G13 · Live-preview security** (#19, open Q #4) — sandbox model; scope when building preview.
- **G14 · Scope reconciliation on merge** (#22) — merge is v1.1; dedupe rules TBD.

---

## 19. Boundary-crossing model (participants · routing · cross-thread · crew)

The hard part of Threads is *boundaries* — human↔human, human↔agent, item→dept, thread→thread.

**Participants & @mention (multi-human + agents) [LOCKED].** A thread has a participant set (humans + agents; avatars on the origin card). **@ is one universal pull-in** over both: **@teammate** → notify + add as participant (human post → real multi-human collaboration); **@agent** → **invokes that worker agent immediately on the thread** (it acts + posts back). @agent = the *manual* delegation path; Dispatcher = the *automated* one. Visibility (Open/Private) + RBAC govern access.

**Ownership & participant roles [LOCKED].** Each thread has one **primary human owner** (accountable) + optional **co-owners**, **collaborators**, **viewers**; agents join as workers, never owner. "Owned by action": human-create → instant owner; non-human-create → **Unclaimed** (Unlisted) until a human **Claims** it or takes a **governance action** (approve/advance/assign); owner can **transfer** + **add/remove** participants. Full model in §10 / §15.

**Per-item routing + human assignment (G1, G2) [LOCKED].** The thread has one home scope, but **each extracted item carries its own department + assignee (agent OR human)**. Output fans out per item. Maps to `issues.projectId` + (agent|user) assignee.

**Fan-out shape — hybrid by granularity [LOCKED].** The Scribe classifies each extracted item:
- concrete work → a **task**, routed to its dept/assignee;
- a chunk that needs its own discussion/planning → a **spin-off thread** (a new *linked* child thread on the target dept's board, seeded with parent context), which runs its own Discuss→Scope→Assign.
*Example:* a Product "collaborative cursors" thread → Design task + Eng task (route out) **+** a "Launch/promo plan" **spin-off thread on Marketing's board** (linked back). "Spin-off thread" is a new **Scope item type**, founder-confirmed (auto at L3). Rationale: every extracted thing is either small enough to be a task or big enough to be a conversation — nothing falls between.

**Cross-thread relationships (G8) [v1 — core].** Three types: `@[Thread]` **link** (bidirectional) · **dependency** (a pre-task here blocks a task there, incl. across threads) · **goal-cluster** (goal-scoped threads gather under a goal). The promo thread's tasks are **blocked-by** the feature build. The **Graph lens** visualizes the web. In-thread dependency linker ships in v1.

**Crew spec (skills per role):**
| Role | Job + key skills |
|------|------------------|
| Router | classify + route inbound to thread/dept/Unlisted; dept-inference |
| Scribe | office-hours interrogate → extract; **classify task vs spin-off-thread**; **per-item dept-tag**; conflict + goal detection |
| Planner | sequence plan; **cross-thread dependency** sequencing; Scope State 2 |
| Dispatcher | match each item to **agent OR human**; route per-dept; **create confirmed spin-off threads** |
| Memory Keeper | curate memory; detect + flag conflicts (≥3 pattern) |

@human = notification only (no crew). @agent = Router/thread invokes the worker on the thread. Crew = orchestration; workers = production.

### 19.1 Tier 1/2 gap resolutions
- **G3 Promote → Goal:** origin-card action **"Make this a goal"** → prompts only missing required goal fields (level, ≥1 project; parent optional) → **attaches a goal property** (origin stays Idea, gains ⚑ status chip); timeline/scope preserved.
- **G4 Conflict resolution:** a **conflict card** in Scope "Needs input" — two contradicting items side-by-side (A vs B + sources); actions Keep A / Keep B / Merge-edit / Keep both are **human actions**; loser archived "superseded by X." Distinct from Compare (version-diff). Works for decisions AND memory — but the **Memory Keeper only *proposes* the winner (status: pending); the founder approves** (identity/domain stay founder-gated per Decisions #15/#16/#52; agents never write memory directly).
- **G5 Sub-goal weight [RESOLVED by the spin-off principle]:** a sub-goal is **lightweight by default** (a record in the parent's sub-goal list); becomes its **own goal-thread when it needs its own conversation** ("Open as thread" / auto when Scribe spins it off). Same granularity rule as fan-out.
- **G6 Scope State 1→2:** **Planner-driven** — auto at L2 when enough items confirmed (or explicit "Plan now" / phase advance); founder sees phase pill advance + scope reorganize, and can toggle **Gathering ⟷ Plan**.
- **G7 Delegation (auto path) [RESOLVED via @agent]:** the Scribe delegates by issuing the **same @agent invocation** (picks worker by function-type + trust); worker posts output back as a thread artifact. Manual (@-typed) and auto (Scribe) share one mechanism.

**Remaining open:** G3 attach-vs-retype, G6 toggle-vs-switch (2 forks). Tier 3 (G9–G14) deferred.
