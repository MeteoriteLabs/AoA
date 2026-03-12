# AoA V1 — Development Plan

**Status: ✅ COMPLETE** (March 2026 — 39 commits across 8 phases)

**For:** TK (Founder / PM)
**Purpose:** Step-by-step guide for building V1 using Claude Code sessions. Includes dependencies, session instructions, and checkpoints.

---

## How to Use This Document

Each phase below is a chunk of work. Within each phase, there are **sessions** — individual Claude Code conversations. Each session has:
- **What to tell Claude Code** — the prompt to start with
- **Dependencies** — what must be done before this session
- **Checkpoint** — how to verify it worked before moving on

**Rules:**
1. Complete phases in order (1 → 2 → 3 → ...). Dependencies flow downward.
2. Sessions within a phase can sometimes run in parallel (marked with ‖) but most are sequential.
3. After each session, verify the checkpoint before starting the next.
4. If something breaks, fix it in the same phase before moving on.
5. Always run `pnpm db:generate` after schema changes, never write raw SQL migrations.

---

## Dependency Map

```
Phase 1: Rename & Restructure (UI + DB)
    │
    ├──→ Phase 2: Vision, Mission & Goals (DB + API + UI)
    │       │
    │       └──→ Phase 4: Debrief & Brief Pipeline (DB + API + UI)
    │               │
    │               └──→ Phase 5: MCP Routing (API change)
    │
    ├──→ Phase 3: Memory System (DB + API + UI)
    │       │
    │       └──→ Phase 4 (Brief approval feeds Memory)
    │
    ├──→ Phase 7: Task Dependencies (DB + API + UI)
    │       │
    │       └──→ Phase 8 (dependency context for agents)
    │
    └──→ Phase 6: Home Screen (UI, needs Phases 2+3+4)
            │
            └──→ Phase 8: Polish & Integration (everything wired together)
```

**Key dependency insights:**
- Phase 1 must be first — everything else builds on the renamed structure.
- Phases 2 and 3 can run in parallel (no dependency on each other).
- Phase 7 (dependencies) can also run in parallel with Phases 2-6 since it only needs Phase 1.
- Phase 4 depends on BOTH Phase 2 (goals linked to briefs) and Phase 3 (brief approval feeds memory).
- Phase 5 depends on Phase 4 (MCP routes through the Debrief pipeline that Phase 4 builds).
- Phase 6 depends on Phases 2, 3, 4 (Home screen pulls from goals, memory, briefs, tasks).
- Phase 8 is integration and polish — needs everything including Phase 7.

---

## Phase 1: Rename & Restructure ✅

**Goal:** AoA looks and feels like AoA, not Paperclip. All naming is updated. Departments and Projects both exist.

**Estimated sessions:** 5-6 | **Actual:** 6 | **Branch:** `v1/phase-1`

### Session 1.0 — Database: Add Source and Reviewer to Issues Table
**Dependencies:** None (first session)
**Tell Claude Code:**
> Read /doc/V1.md section 2.1. Add three fields to the issues table: `source` (text, nullable — values: 'manual', 'brief', 'agent_proposal', 'mcp') to track where tasks come from, `reviewerUserId` (uuid, nullable, references users table) to track who reviews task output, and `dueDate` (timestamp, nullable) for task deadlines. Use Drizzle schema, run db:generate. Update shared types.

**Checkpoint:**
- Migration generated
- Types updated in packages/shared
- Existing issues unaffected (nullable fields)

### Session 1.1 — Database: Add Department/Project Type
**Dependencies:** None (first session)
**Tell Claude Code:**
> Read /doc/V1.md and CLAUDE.md. Add a `type` field to the `projects` table with values 'department' or 'project', defaulting to 'department'. Use Drizzle schema, run db:generate. Update the shared types and validators to include the new field. Do not change any UI yet.

**Checkpoint:**
- `pnpm db:generate` succeeds
- New migration file created in packages/db
- TypeScript types updated in packages/shared

### Session 1.2 — API: Update Project Routes for Type
**Dependencies:** Session 1.1
**Tell Claude Code:**
> Read /doc/V1.md. Update the projects service and routes to support the `type` field. The create project endpoint should accept type ('department' | 'project'). The list endpoint should support filtering by type. Follow existing patterns in server/src/services/projects.ts and server/src/routes/projects.ts.

**Checkpoint:**
- API accepts type on create/update
- GET endpoint can filter by type
- Existing projects still work (backward compatible)

### Session 1.3 — UI: Rename Issues → Tasks
**Dependencies:** Session 1.1
**Tell Claude Code:**
> Read CLAUDE.md naming section. Rename all user-facing occurrences of "Issue" and "Issues" to "Task" and "Tasks" across the entire UI codebase (ui/src/). This includes: component text, button labels, page titles, sidebar labels, search placeholders, empty states, tooltips. Do NOT rename the database table or API routes yet — only the UI display text. Also rename "New Issue" to "New Task" everywhere.

**Checkpoint:**
- UI shows "Tasks" everywhere, never "Issues"
- App still functions (routes still use /issues internally, that's fine)
- Kanban board says "Tasks" not "Issues"

### Session 1.4 — UI: Rename Dashboard, Costs, Org
**Dependencies:** Session 1.3
**Tell Claude Code:**
> Continue UI renaming. Rename "Dashboard" to "Home" in the sidebar and page titles. Rename "Costs" to "Budget" in the sidebar and all cost-related pages. Rename "Org" to "Team" in the sidebar. Update the sidebar component to match the AoA sidebar structure from /doc/V1.md. Keep the same functionality, just reorganize the order and labels.

**Checkpoint:**
- Sidebar shows: Home, Inbox, Tasks, Departments section, Projects section, Team, Company section (Budget, Activity, Settings)
- All pages still load and function

### Session 1.5 — UI: Sidebar Restructure + Department/Project Split
**Dependencies:** Sessions 1.2, 1.4
**Tell Claude Code:**
> Read /doc/V1.md sidebar section. Restructure the sidebar to show Departments and Projects as separate sections. Departments are projects with type='department', Projects are type='project'. Add "+ New Department" and "+ New Project" buttons to each section. The creation dialogs should set the type field accordingly. When clicking a department or project, it should open the existing project detail page (we'll add tabs later).

**Checkpoint:**
- Sidebar shows separate DEPARTMENTS and PROJECTS sections
- Can create both types
- Both open to their detail pages
- Existing projects appear in correct section based on type

---

## Phase 2: Vision, Mission & Goals Enhancement ✅

**Goal:** Company has Vision & Mission. Goals are properly scoped to departments/projects.

**Estimated sessions:** 3-4 | **Actual:** 4 | **Branch:** `v1/phase-2`

### Session 2.1 — Database: Vision & Mission Fields
**Dependencies:** Phase 1 complete
**Tell Claude Code:**
> Read /doc/V1.md section on Vision & Mission. Add `vision` (text, nullable) and `mission` (text, nullable) fields to the companies table. Add `values` (text, nullable) for company values/principles. Use Drizzle schema, run db:generate. Update shared types.

**Checkpoint:**
- Migration generated
- Types updated
- Existing companies unaffected (nullable fields)

### Session 2.2 — API + UI: Vision & Mission Page
**Dependencies:** Session 2.1
**Tell Claude Code:**
> Create a Vision & Mission page under the Company section. It should show editable text fields for Vision (one line), Mission (one to two lines), and Values (short list). Use the existing company update endpoint to save changes. Add "Vision & Mission" to the sidebar under COMPANY section. Follow the existing UI patterns for editable text fields.

**Checkpoint:**
- Vision & Mission page accessible from sidebar
- Can edit and save all three fields
- Data persists across page reloads

### Session 2.3 — Goals: Enforce Department/Project Parentage
**Dependencies:** Session 1.5 (departments exist)
**Tell Claude Code:**
> Read /doc/V1.md goals section. Currently goals can float without a department or project. A `project_goals` join table already exists (many-to-many linking goals to projects). Do NOT add a projectId column to the goals table. Instead, update the create goal UI to require selecting at least one department or project — this creates an entry in the project_goals table. Remove the ability to create goals without any department/project link. Update the goal list and detail views to show which departments/projects each goal belongs to. A goal CAN belong to multiple departments/projects — this is intentional. Existing goals without a project_goals entry should show a warning badge prompting the founder to assign them.

**Checkpoint:**
- Cannot create a goal without selecting at least one department/project
- Existing unlinked goals show a warning badge (not broken, just flagged)
- Goals show their parent department(s)/project(s)
- A goal can be linked to multiple departments/projects via the join table

### Session 2.4 — UI: Goals Tab in Department/Project Detail
**Dependencies:** Session 2.3
**Tell Claude Code:**
> Add a "Goals" tab to the department/project detail page. Currently there are "Overview" and "List" tabs. Add "Goals" as a third tab. It should show all goals belonging to this department/project, with sub-goals expandable. Reuse the existing GoalTree component. Include the "+ New Goal" button that pre-fills the department/project association.

**Checkpoint:**
- Department detail page has: Overview, List (Board), Goals tabs
- Goals tab shows department-specific goals
- Creating a goal from this tab auto-links to the department

---

## Phase 3: Memory System ✅

**Goal:** Company knowledge store with approval gate. Agents can receive memory context.

**Estimated sessions:** 4-5 | **Actual:** 4 | **Branch:** `v1/phase-3` (merged at Point A)

### Session 3.1 — Database: Memory Tables
**Dependencies:** Phase 1 complete
**Tell Claude Code:**
> Read /doc/V1.md Memory section. Create new Drizzle schema for memory_items table with fields: id (uuid), companyId (ref companies), title (text), content (text), category (text enum: 'decision', 'reference', 'context', 'insight', 'preference'), source (text enum: 'brief', 'founder', 'agent', 'mcp', 'document'), status (text enum: 'pending', 'approved', 'archived', 'rejected'), tags (jsonb array of strings), departmentId (nullable ref projects), projectId (nullable ref projects), createdBy (text), createdAt, updatedAt. Follow the same patterns as the goals schema. Run db:generate.

**Checkpoint:**
- Migration generated
- Schema follows existing patterns
- Types exported from shared package

### Session 3.2 — API: Memory Service & Routes
**Dependencies:** Session 3.1
**Tell Claude Code:**
> Create memory service (server/src/services/memory.ts) and routes (server/src/routes/memory.ts) following the exact same patterns as goals service and routes. CRUD operations: list (with filters for category, status, source, departmentId, tags), getById, create, update, remove. When source is 'founder', auto-set status to 'approved'. All other sources default to 'pending'. Add activity logging for all mutations.

**Checkpoint:**
- API endpoints work (test with curl or API client)
- Founder-created items are auto-approved
- Filtering works

### Session 3.3 — UI: Memory Page
**Dependencies:** Session 3.2
**Tell Claude Code:**
> Create Memory page accessible from sidebar under COMPANY section. Layout: search bar at top, filter panel on left (by category, status, department, tags), memory items list in main area (reverse chronological). Each item shows: title, category badge, tags, source, date. Click to expand shows full content. Add "+ Add to Memory" button that opens a creation dialog (title, content, category, tags, optional department/project link). Items created by founder are auto-approved. Include a "Pending" filter to show items awaiting approval, with approve/reject buttons.

**Checkpoint:**
- Memory page loads and is navigable from sidebar
- Can create memory items
- Can filter and search
- Can approve/reject pending items

### Session 3.4 — Agent Context Enrichment
**Dependencies:** Session 3.2
**Tell Claude Code:**
> Read /doc/V1.md section on Task Context Package. Modify the heartbeat execution flow in server/src/services/heartbeat.ts to include Memory context when an agent starts a task. Before calling the adapter, query memory_items for approved items that match the task's department/project. Also include company vision and mission. Pass this context to the adapter along with existing issue context. Limit to the 10 most relevant memory items to avoid context overflow. Include items tagged with the task's department and any company-wide preferences.

**Checkpoint:**
- Agent execution logs show memory context being passed
- Vision and mission included in agent context
- Only approved memory items are included

---

## Phase 4: Debrief & Brief Pipeline ✅

**Goal:** The quality gate works end-to-end. Content enters via Debrief, gets structured into Briefs, and flows to tasks + memory after approval.

**Estimated sessions:** 6-7 | **Actual:** 7 (4.5 + 4.6 combined into one session) | **Branch:** `v1/phase-4`

### Session 4.1 — Database: Debrief, Brief, BriefItem Tables
**Dependencies:** Phase 2 + Phase 3 complete
**Tell Claude Code:**
> Read /doc/V1.md Debrief & Brief section. Create three new tables using Drizzle:
>
> 1. `debriefs` — id, companyId, title, inputType ('paste' | 'write' | 'mcp'), rawContent (text), artifactUrl (nullable text for stored artifact), departmentId (nullable), projectId (nullable), sourceInfo (jsonb — for MCP metadata), status ('processing' | 'ready' | 'archived'), createdBy, createdAt.
>
> 2. `briefs` — id, companyId, debriefId (ref debriefs), status ('draft' | 'ready' | 'reviewed' | 'approved' | 'rejected' | 'partially_approved'), departmentId (nullable), projectId (nullable), reviewedAt (nullable), reviewedBy (nullable), createdAt, updatedAt.
>
> 3. `brief_items` — id, briefId (ref briefs), type ('decision' | 'task' | 'insight' | 'context'), title, description, suggestedAssigneeId (nullable), suggestedPriority (nullable), status ('pending' | 'approved' | 'rejected' | 'edited'), resultTaskId (nullable ref issues — for approved task items), resultMemoryId (nullable ref memory_items — for approved knowledge items), createdAt, updatedAt.
>
> Follow existing schema patterns. Run db:generate.

**Checkpoint:**
- All three tables created with proper references
- Migration generated
- Types exported

### Session 4.2 — API: Debrief Service & Routes
**Dependencies:** Session 4.1
**Tell Claude Code:**
> Create debrief service and routes. The create endpoint accepts: title (optional), inputType, rawContent, departmentId (optional), projectId (optional). On creation, it stores the debrief with status 'processing'. For now, the LLM extraction will be a separate step. Include list and getById endpoints. Follow patterns from other services.

**Checkpoint:**
- Can create a debrief via API
- Can list and retrieve debriefs

### Session 4.3 — Service: LLM Extraction
**Dependencies:** Session 4.2
**Tell Claude Code:**
> Create an extraction service (server/src/services/extraction.ts) that takes a debrief's rawContent and uses an LLM to extract structured items. Use the existing adapter pattern — call Claude (or configured LLM) with a prompt that asks it to extract: decisions, tasks, insights, and context items from the raw text. Each extracted item should have: type, title, description, suggestedPriority. The service should create a Brief record and BriefItem records for each extracted item. Update the debrief status to 'ready' and the brief status to 'ready'. Wire this to be called automatically after debrief creation (can be async/background).

**Checkpoint:**
- Creating a debrief triggers extraction
- Brief and BriefItems are created
- Extracted items are reasonable (test with sample text)

### Session 4.4 — API: Brief Service & Routes
**Dependencies:** Session 4.3
**Tell Claude Code:**
> Create brief service and routes. Endpoints: list briefs (filterable by status), getById (include all brief_items), update brief status, update individual brief_item (edit title/description, change status to approved/rejected). The key endpoint is "approve brief" which: iterates through all brief_items, for items with status 'approved' and type 'task' → creates a task (issue) on the relevant board, for items with type 'decision'/'insight'/'context' and status 'approved' → creates a memory_item with status 'approved' and source 'brief'. Update brief status based on item outcomes.

**Checkpoint:**
- Can list and view briefs with items
- Can approve/reject individual items
- Approving a task item creates a real task on the board
- Approving a decision item creates a memory item
- Brief status updates correctly

### Session 4.5 — UI: Debrief Modal
**Dependencies:** Session 4.2
**Tell Claude Code:**
> Create a Debrief modal that opens from the "+ Debrief" button in the sidebar. The modal has two tabs: "Paste/Import" and "Write". Paste tab has a large text area for pasting content. Write tab has a rich text input for free-form writing. Both have an optional department/project selector dropdown. Submit button says "Process Debrief" and calls the create debrief API. After submission, show a brief loading state ("Processing your debrief...") then navigate to the Brief review screen when ready.

**Checkpoint:**
- Debrief button in sidebar opens modal
- Can paste text and submit
- Can write text and submit
- Debrief is created, extraction runs, Brief is generated

### Session 4.6 — UI: Brief Review Screen
**Dependencies:** Sessions 4.4, 4.5
**Tell Claude Code:**
> Create the Brief review screen. Accessible from: sidebar → Briefs list, and directly after Debrief submission. Layout: header shows source debrief info and status. Below: collapsible section showing the original raw content (for reference). Main area: list of extracted brief_items grouped by type (Decisions, Tasks, Insights, Context). Each item shows: title, description, type badge, and three action buttons (Approve, Edit, Reject). Edit opens inline editing of title and description. Add bulk actions at the top: "Approve All", "Reject All". Add a final "Approve Brief" button that processes all approved items. Show a success state after approval with summary of what was created.

**Checkpoint:**
- Brief review screen renders with all items
- Can approve/reject/edit individual items
- "Approve Brief" creates tasks and memory items
- Tasks appear on the correct department/project board
- Memory items appear in Memory page

### Session 4.7 — UI: Briefs List Page
**Dependencies:** Session 4.6
**Tell Claude Code:**
> Create a Briefs list page accessible from sidebar → Briefs. Shows all briefs with: status badge, source debrief type, department/project tag, date, item count. Filter by status. Click a brief to open the review screen. Pending briefs should be visually prominent.

**Checkpoint:**
- Briefs page shows in sidebar
- Lists all briefs with correct info
- Clicking opens the review screen

---

## Phase 5: MCP Routing ✅

**Goal:** External LLM pushes enter through Debrief pipeline, not raw task creation.

**Estimated sessions:** 1-2 | **Actual:** 1 | **Branch:** continued on `v1/phase-4`

### Session 5.1 — Build MCP Endpoint with Debrief Routing
**Dependencies:** Phase 4 complete
**Tell Claude Code:**
> Read /doc/V1.md MCP section. There is NO existing MCP implementation in the codebase (doc/TASKS-mcp.md describes a planned interface but it's not built). Create a new MCP endpoint that receives external LLM pushes. The endpoint should accept: content (text), source metadata (which LLM, session info). It should create a Debrief with inputType='mcp', rawContent=content, sourceInfo=metadata. This triggers the same extraction → Brief pipeline built in Phase 4. The endpoint should return the created debrief ID so the external LLM can confirm receipt. Add the route at a path consistent with existing patterns (e.g., POST /companies/:companyId/debriefs/mcp). Check doc/TASKS-mcp.md for any useful interface design ideas but don't feel bound by it.

**Checkpoint:**
- POST to MCP endpoint creates a Debrief with inputType='mcp'
- Brief is generated from MCP content via extraction pipeline
- Founder can review and approve as normal
- Endpoint returns debrief reference

---

## Phase 6: Home Screen ✅

**Goal:** Replace Dashboard with the founder's daily operating view.

**Estimated sessions:** 3-4 | **Actual:** 3 | **Branch:** `v1/phase-6`

### Session 6.1 — Backend: Home Data Endpoint
**Dependencies:** Phases 2, 3, 4 complete
**Tell Claude Code:**
> Create a Home data endpoint (GET /companies/:id/home or similar) that aggregates: count of briefs with status 'ready' (awaiting review), tasks with status 'in_review' (awaiting approval), tasks assigned to the current user that are due today or overdue, tasks with status 'blocked', pending memory items count, recent activity (last 24h from activity_log, limited to 20 items), active project goals with progress (count of done tasks / total tasks per goal). Return all of this in a single response to minimize frontend API calls.

**Checkpoint:**
- Endpoint returns aggregated data
- Counts are accurate
- Performance is acceptable

### Session 6.2 — UI: Home Screen Layout
**Dependencies:** Session 6.1
**Tell Claude Code:**
> Replace the existing Dashboard page with the new Home screen. Read /doc/V1.md Home Screen section. Layout from top to bottom: 1) Greeting ("Good morning, TK") + Pulse line (one-line summary from the aggregated data). 2) Action Queue — list of actionable items ordered by priority: briefs to review, tasks in review, your tasks due today, blocked items. Each item has a click-through to its detail page. 3) Today's Activity — compact feed of recent activity items. Keep it clean and minimal. No charts or heavy analytics.

**Checkpoint:**
- Home screen loads with real data
- Action Queue shows correct items in priority order
- Clicking items navigates to correct detail pages
- Activity feed shows recent events

### Session 6.3 — UI: Empty State / Onboarding
**Dependencies:** Session 6.2
**Tell Claude Code:**
> Add empty state handling to the Home screen. When the company has no departments, no agents, and no tasks, show a guided setup flow in place of the Action Queue: Step 1 "Set your Vision & Mission" (link to Vision page), Step 2 "Create your first department" (link to create department), Step 3 "Add your first agent" (link to create agent), Step 4 "Create your first goal" (link to goals). Show progress — check off completed steps. When all steps are done, show the normal Home screen.

**Checkpoint:**
- New company sees onboarding flow
- Steps link to correct pages
- Completed steps are checked off
- Normal Home shows once setup is complete

---

## Phase 7: Task Dependencies ✅

**Goal:** Tasks can depend on other tasks. Blocked tasks auto-unblock when dependencies complete.

**Estimated sessions:** 3-4 | **Actual:** 4 | **Branch:** `v1/phase-7` (merged at Point C)

### Session 7.1 — Database: Task Dependencies Table
**Dependencies:** Phase 1 complete (tasks exist)
**Tell Claude Code:**
> Read /doc/V1.md section 2.2 (task_dependencies table). Create a new Drizzle schema for task_dependencies with fields: id (uuid), companyId (ref companies), dependentIssueId (ref issues, cascade — the task that is WAITING), dependencyIssueId (ref issues, cascade — the task it's waiting FOR), createdAt. Add indices on (companyId, dependentIssueId) and (companyId, dependencyIssueId). Add unique constraint on (dependentIssueId, dependencyIssueId) to prevent duplicates. Run db:generate.

**Checkpoint:**
- Migration generated
- Schema follows existing patterns
- Types exported from shared package

### Session 7.2 — Service: Dependencies Logic
**Dependencies:** Session 7.1
**Tell Claude Code:**
> Read /doc/V1.md section 3.1 (dependencies.ts service). Create server/src/services/dependencies.ts with these functions:
>
> 1. `addDependency(companyId, dependentIssueId, dependencyIssueId)` — creates the link. Validates: no self-dependency, no duplicate, no circular dependency (walk the chain from dependencyIssueId to see if we reach dependentIssueId, max depth 50). If the dependency task status is NOT 'done', auto-set the dependent task status to 'blocked'.
>
> 2. `removeDependency(companyId, dependencyId)` — removes the link. Then re-evaluates: query remaining dependencies for the dependent task. If ALL remaining dependencies are 'done' (or there are none left), move the dependent task from 'blocked' to 'todo'.
>
> 3. `getDependencies(companyId, issueId)` — returns all upstream tasks (tasks this one waits for) with their current status.
>
> 4. `getDependents(companyId, issueId)` — returns all downstream tasks (tasks waiting for this one).
>
> 5. `resolveDependencies(companyId, issueId)` — called when a task moves to 'done'. Queries all dependents. For each dependent, checks if ALL of its dependencies are 'done'. If yes: updates status from 'blocked' to 'todo', and if the task has an assigneeAgentId, calls heartbeat.wakeup() to wake the agent. Log activity for each unblocked task.
>
> 6. `handleCancelledDependency(companyId, issueId)` — called when a task is 'cancelled'. Creates an activity log entry for each dependent task: "Dependency [task identifier] was cancelled." Does NOT auto-cancel or auto-unblock dependents.
>
> Follow existing service patterns. Add activity logging for add/remove dependency.

**Checkpoint:**
- Can add dependency between two tasks
- Circular dependency is rejected with error
- Dependent task auto-blocks when dependency is unmet
- When dependency task completes, dependent auto-unblocks
- Cancelled dependency notifies but doesn't auto-cancel dependents

### Session 7.3 — Integration: Hook Dependencies into Issue Status Transitions
**Dependencies:** Session 7.2
**Tell Claude Code:**
> Modify server/src/services/issues.ts to integrate with the dependencies service. In the `applyStatusSideEffects()` function (or wherever status transitions are processed): when a task's status changes to 'done', call `dependencies.resolveDependencies(companyId, issueId)`. When status changes to 'cancelled', call `dependencies.handleCancelledDependency(companyId, issueId)`. Also add a safety check in the checkout flow: before allowing checkout of a task, verify all its dependencies are in 'done' status — if not, reject the checkout with an error message listing the unmet dependencies. Add the dependency routes: GET/POST/DELETE under `/companies/:companyId/issues/:issueId/dependencies`.

**Checkpoint:**
- Completing a task auto-unblocks dependents
- Cancelling a task creates notifications for dependents
- Cannot checkout a task with unmet dependencies
- Dependency API routes work (create, list, delete)

### Session 7.4 — UI: Dependencies on Task Detail + Kanban
**Dependencies:** Session 7.3
**Tell Claude Code:**
> Add dependency UI to the task system. On the task detail page, add a "Dependencies" section showing: upstream dependencies (tasks this one is waiting for) with status badges and checkmarks for completed ones, and downstream dependents (tasks waiting for this one). Include an "Add Dependency" button that opens a searchable task picker dialog — search by task title or identifier. On the Kanban board, show a small chain-link icon on task cards that have unmet dependencies, with a tooltip showing what they're waiting for. Also update the Brief review page: when multiple task items are being approved, allow the founder to drag-connect or select dependencies between items in the same Brief before hitting "Approve Brief."

**Checkpoint:**
- Task detail shows upstream and downstream dependencies
- Can add/remove dependencies from task detail
- Kanban cards show dependency indicator
- Brief review supports setting dependencies between items

---

## Phase 8: Polish & Integration ✅

**Goal:** Everything works together end-to-end. Budget alerts, goal nudges, dependency context for agents.

**Estimated sessions:** 5-6 | **Actual:** 6 + 5 review fix commits | **Branch:** `v1/phase-8`

### Session 8.1 — Budget Alerts
**Dependencies:** Phase 1 (renamed to Budget)
**Tell Claude Code:**
> Add budget alert logic. In the heartbeat service, after an agent completes a run and cost is recorded, check if the agent's total monthly spend has crossed 80% or 100% of budgetMonthlyCents. At 80%, create an activity log entry (type: 'budget_warning'). At 100%, pause the agent (set status to paused) and create an activity log entry (type: 'budget_exceeded'). These should surface in the Home screen's Action Queue.

**Checkpoint:**
- Agent hitting 80% budget generates warning
- Agent hitting 100% is paused
- Alerts show on Home screen

### Session 8.2 — Goal Gap Nudges
**Dependencies:** Phase 2 (goals scoped to departments)
**Tell Claude Code:**
> Add simple goal gap detection. Create a lightweight check that runs when the Home data endpoint is called: for each active goal, check if it has any tasks in statuses other than 'done' or 'cancelled'. If an active goal has zero active tasks, include it in the Home response as a "nudge" item with message "This goal has no active tasks." Display these nudges in the Home Action Queue at lower priority than briefs and reviews.

**Checkpoint:**
- Goals with no tasks show nudge on Home
- Goals with active tasks don't show nudge

### Session 8.3 — Department/Project Detail: Team & Budget Tabs
**Dependencies:** Phases 1, 3
**Tell Claude Code:**
> Add "Team" and "Budget" tabs to the department/project detail page. Team tab shows agents and humans assigned to this department/project, with the ability to assign/unassign. Budget tab shows spending breakdown for agents in this department/project, using existing cost_events data filtered by department.

**Checkpoint:**
- Detail page has 5 tabs: Overview, Board, Goals, Team, Budget
- Team tab shows correct agents
- Budget tab shows spending data

### Session 8.4 — Inbox: Add Briefs Awaiting Review
**Dependencies:** Phase 4 (briefs exist)
**Tell Claude Code:**
> The Inbox page already exists in Paperclip (ui/src/pages/Inbox.tsx) with categories like failed runs, alerts, stale work, approvals. Add a new category to the Inbox: "Briefs awaiting review." This should query briefs with status 'ready' and show them as inbox items. Clicking should navigate to the Brief review page. Also update the sidebar badge count (server/src/routes/sidebar-badges.ts) to include pending briefs in the Inbox badge count.

**Checkpoint:**
- Inbox shows "Briefs awaiting review" category
- Clicking a brief item navigates to the review page
- Sidebar badge count includes pending briefs

### Session 8.5 — Dependency Context for Agents
**Dependencies:** Phase 7 (dependencies exist)
**Tell Claude Code:**
> Enhance the heartbeat context enrichment in server/src/services/heartbeat.ts. When an agent starts a task, check if the task has any dependencies (via task_dependencies table). For each completed dependency task, fetch its attachments/artifacts. Include these in the agent's context package under a "dependency_outputs" section. This lets the agent access the output of upstream tasks — e.g., the Content Writer can see the Research Agent's completed research. Limit to the 5 most recent dependency artifacts to avoid context overflow.

**Checkpoint:**
- Agent executing a task with dependencies receives upstream task artifacts in context
- Context includes dependency task titles and descriptions for reference

### Session 8.6 — End-to-End Testing
**Dependencies:** All phases
**Tell Claude Code:**
> Do a full review of the application. Check that: the sidebar matches the AoA structure, all navigation works, creating a department works, creating an agent works, creating a task works, the debrief → brief → approval → task flow works end-to-end, memory items are created from brief approval, task dependencies work (creating, blocking, auto-unblocking), the Home screen shows correct data, budget and activity pages work. Fix any broken links, missing pages, or UI inconsistencies. Ensure the app starts without errors.

**Checkpoint:**
- Complete user flow works from onboarding to task execution
- Task dependency chain works: create A→B dependency, complete A, B auto-unblocks
- No console errors
- All pages load correctly

---

## Summary Timeline

| Phase | Planned | Actual | Status |
|-------|---------|--------|--------|
| **1. Rename & Restructure** | 6 | 6 | ✅ |
| **2. Vision & Goals** | 4 | 4 | ✅ |
| **3. Memory** | 4 | 4 | ✅ |
| **4. Debrief & Brief** | 7 | 7 | ✅ |
| **5. MCP Routing** | 1-2 | 1 | ✅ |
| **6. Home Screen** | 3 | 3 | ✅ |
| **7. Task Dependencies** | 4 | 4 | ✅ |
| **8. Polish & Integration** | 6 | 6 + 5 fixes | ✅ |
| **Total** | ~35 | 35 sessions + 2 merges + 5 fixes = 39 commits | ✅ |

Phases 2, 3, and 7 ran in parallel on separate branches as planned. Merge Points A and C executed cleanly.

---

## Tips for Each Session

1. **Start every session with:** "Read CLAUDE.md and /doc/V1.md section [X]"
2. **One focused task per session.** Don't ask Claude Code to do Phase 1 + Phase 2 in one session.
3. **Verify the checkpoint before moving on.** Run the app, click through, make sure it works.
4. **If a session breaks something,** fix it in the same session or the next one — don't skip ahead.
5. **Commit after each successful session.** You want clean rollback points.
6. **If Claude Code seems confused about the codebase,** point it to specific files: "Look at server/src/services/goals.ts for the pattern to follow."
