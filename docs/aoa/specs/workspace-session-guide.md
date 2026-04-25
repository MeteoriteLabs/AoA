# Workspace Implementation — Session Guide

Each session below is designed to produce a committable increment. Run each session in a new Claude session targeted at the **AoA-2.5 folder**.

**Before starting each session:** Tell Claude to read `docs/aoa/specs/workspace-implementation-plan.md` and `docs/aoa/reference/workspace-decisions.md`.

**Important framework note:** The backend uses **Express 5.x** (not Hono). CLAUDE.md has been corrected. Routes use `Router()` from Express. All route files follow this pattern.

**Testing framework:** Vitest (not Jest). Server tests use Proxy-based table stubs for Drizzle ORM mocks. UI tests use @testing-library/react. Follow existing test patterns in `server/src/__tests__/` and `ui/src/__tests__/`.

**Reference codebases (outside the AoA folder, for reading only):**
- Paperclip: `C:/Users/TK/OneDrive/Desktop/Claude Data/Paperclip-AoA/paperclip-master/paperclip-master/`
- Vibe-kanban: `C:/Users/TK/OneDrive/Desktop/Claude Data/Paperclip-AoA/vibe-kanban-main/`

---

## Session 1: Backend — functionType + workspaceMode + instance setting default

**Commit message:** "feat: add functionType to projects, workspaceMode to workflow templates, enable workspaces by default"

### Prompt:

```
Read docs/aoa/specs/workspace-implementation-plan.md (Phase 1) and docs/aoa/reference/workspace-decisions.md for full context.

IMPORTANT: The backend uses Express 5.x (not Hono). Routes use Router() from Express. Follow existing patterns in the codebase.

Phase 1 backend changes needed:

1. Add `functionType` field to projects schema (packages/db/src/schema/projects.ts):
   - `functionType: text("function_type").default("general")`
   - Values: "software_development" | "marketing" | "sales" | "operations" | "hr" | "legal" | "research" | "finance" | "general" | "custom"

2. Add `functionType` to Project interface (packages/shared/src/types/project.ts)

3. Add `functionType` to project validators (packages/shared/src/validators/project.ts):
   - Add to create and update schemas
   - Follow the pattern of existing fields in that file

4. Add `workspaceMode` to workflow_templates schema (packages/db/src/schema/workflow_templates.ts):
   - `workspaceMode: text("workspace_mode").default("department_default")`
   - Values: "department_default" | "shared" | "isolated"

5. Add `workspaceMode` to workflow template validators (packages/shared/src/validators/workflow-template.ts):
   - Add to create and update schemas

6. Change `enableIsolatedWorkspaces` default from false to true in server/src/services/instance-settings.ts

7. Auto-configure executionWorkspacePolicy when creating a department:
   - In the project creation route/service (check server/src/routes/projects.ts and server/src/services/projects.ts)
   - When type="department" and functionType is provided:
   - If functionType === "software_development": set executionWorkspacePolicy to { enabled: true, defaultMode: "isolated_workspace", allowIssueOverride: true, workspaceStrategy: { type: "git_worktree", baseRef: "main" } }
   - All other functionTypes: set executionWorkspacePolicy to { enabled: true, defaultMode: "isolated_workspace", allowIssueOverride: true }

8. Update workflow template instantiation (server/src/services/workflow-templates.ts):
   - Current instantiate() signature: `instantiate(companyId, templateId, goalId, projectId) → { templateId, tasksCreated, dependenciesCreated }`
   - It creates issues + task_dependencies inside a DB transaction (lines 144-237)
   - For shared workspace support:
     a) Add workspaceMode to the template lookup (read template.workspaceMode)
     b) When workspaceMode === "shared": AFTER the transaction completes, create one execution workspace using executionWorkspaceService.create() (at server/src/services/execution-workspaces.ts), then update all created tasks to set executionWorkspaceId
     c) Don't create the workspace inside the transaction — keep it separate for cleaner error handling
     d) executionWorkspaceService.create() requires: { companyId, projectId, sourceIssueId (use first task), mode: "shared_workspace", status: "active", name: template.name }
   - When "isolated" or "department_default": leave as-is (workspaces auto-created per task on first heartbeat run)

9. Return functionType in project API responses (server/src/routes/projects.ts)

10. Generate migration: cd packages/db && pnpm db:generate

11. Write tests:
    - New file: server/src/__tests__/function-type-policy.test.ts
    - Test: auto-configuration of executionWorkspacePolicy based on functionType
    - Test: software_development gets git_worktree strategy, others don't
    - Test: workspaceMode "shared" creates shared execution workspace on workflow instantiation
    - Follow the test pattern in server/src/__tests__/routines-service.test.ts (Proxy-based Drizzle mocks with vitest)

12. Verify: pnpm build (or tsc --noEmit), cd server && pnpm test
```

---

## Session 2: UI — TaskSlideOver Dialog to Sheet conversion

**Commit message:** "feat: convert TaskSlideOver from Dialog to Sheet (right-side panel)"

### Prompt:

```
Read docs/aoa/specs/workspace-implementation-plan.md (Phase 2.1) for context.

Convert TaskSlideOver from a centered Dialog modal to a right-side Sheet panel.

Current state: ui/src/components/TaskSlideOver.tsx uses <Dialog> + <DialogContent> rendering as a centered overlay modal (max-w-4xl). It's 1609 lines.

The Sheet component exists at ui/src/components/ui/sheet.tsx. It accepts:
- side: "top" | "right" | "bottom" | "left" (default: "right")
- showCloseButton: boolean (default: true)

Changes needed:

1. In TaskSlideOver.tsx:
   - Replace Dialog import with Sheet from "@/components/ui/sheet"
   - Replace DialogContent with SheetContent side="right"
   - Remove DialogHeader/DialogTitle wrappers, keep the custom header
   - Set width on SheetContent: try className="w-[560px] sm:w-[600px] p-0 gap-0 overflow-hidden flex flex-col"
   - Keep ALL existing content unchanged — 4 tabs (comments, subissues, activity, artifacts), live runs, comments, artifacts, dependencies
   - The kanban board should stay visible underneath when panel is open

2. Handle popovers carefully:
   - StatusIcon, PriorityIcon, assignee picker, label picker all use Popover
   - The onPointerDownOutside handler (currently at line ~726) prevents closing when clicking popover content — make sure this still works with Sheet
   - Sheet uses Radix Dialog internally, same as Dialog, so the handler pattern should transfer

3. Update ui/src/pages/Issues.tsx if the open/close handler needs changes for Sheet vs Dialog

4. Polish the UI:
   - Cleaner header spacing
   - Consistent border treatment
   - Ensure ScrollArea works well in Sheet context

5. Write tests:
   - New file: ui/src/__tests__/TaskSlideOver.test.tsx (does not exist yet)
   - Test: panel opens on task click, closes on X button
   - Test: all tabs render correctly in Sheet context
   - Test: popovers work within Sheet
   - Follow the test pattern in ui/src/__tests__/AgentCard.test.tsx (vitest + @testing-library/react)
   - Use helpers from ui/src/__tests__/test-utils.tsx:
     - `renderWithProviders(ui)` — wraps in QueryClient (retry: false, gcTime: 0) + MemoryRouter
     - `mockCompanyContext` — pre-configured company context mock
     - `makeAgent(overrides)` — factory for test agent objects
   - Mock router: `vi.mock("@/lib/router", async () => { const actual = await vi.importActual("react-router-dom"); return { ...actual, useNavigate: () => mockNavigate }; })`
   - Mock context: `vi.mock("../context/CompanyContext", () => ({ useCompany: () => mockCompanyContext }))`
   - Mock queries: `vi.mock("@tanstack/react-query", async () => { const actual = await vi.importActual(...); return { ...actual, useQuery: vi.fn(({ queryKey }) => ({ data: mockData, isLoading: false })) }; })`

Reference for Sheet usage: ui/src/components/InternalAgentPanel.tsx already uses Sheet on mobile.

Verify: The app should compile. Click a task in the global Issues page → right-side panel slides in from right. All existing functionality (tabs, comments, artifacts, dependencies, live runs) should work. Popovers render correctly.
```

---

## Session 3: UI — Wire TaskSlideOver into ProjectDetail

**Commit message:** "feat: wire TaskSlideOver into ProjectDetail board tab"

### Prompt:

```
Read docs/aoa/specs/workspace-implementation-plan.md (Phase 2.2) for context.

Wire the TaskSlideOver component into ProjectDetail so clicking a task in the project board opens the right-side panel.

Current state:
- ui/src/pages/ProjectDetail.tsx (838 lines) renders IssuesList in the board tab
- IssuesList (ui/src/components/IssuesList.tsx) already supports an `onSelectIssue` callback prop — if provided, clicking a task calls it instead of navigating away
- But ProjectDetail doesn't provide this callback, so clicking a task navigates away to /issues/:id

Changes:

1. In ProjectDetail.tsx:
   - Import TaskSlideOver from "../components/TaskSlideOver"
   - Add state: const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null)
   - Pass onSelectIssue={setSelectedIssueId} to the IssuesList component in the board ("list") tab
   - Render: <TaskSlideOver issueId={selectedIssueId} open={!!selectedIssueId} onClose={() => setSelectedIssueId(null)} />
   - Handle: clear selectedIssueId when changing tabs or navigating away (useEffect cleanup)

2. Write/update tests:
   - Update ui/src/__tests__/ProjectDetailDiscussions.test.tsx or create new test file for ProjectDetail board tab
   - Test: clicking a task in IssuesList calls onSelectIssue
   - Test: TaskSlideOver renders when selectedIssueId is set
   - Test: closing TaskSlideOver clears selectedIssueId

Verify: Navigate to a department/project → Board tab → click a task card → Sheet panel slides in from right showing task details. Close panel → returns to board. Kanban board stays visible and functional underneath.
```

---

## Session 4: UI — Workspace API client + workspace section in TaskSlideOver

**Commit message:** "feat: add workspace section to TaskSlideOver with two-mode sidebar"

### Prompt:

```
Read docs/aoa/specs/workspace-implementation-plan.md (Phase 2.3 and 2.4) for context.

Two things to build:

PART 1: Create workspace API client + query keys

New file: ui/src/api/execution-workspaces.ts
- Methods: list(companyId, filters?), get(id), update(id, data)
- Follow the pattern of existing API clients (e.g., ui/src/api/artifacts.ts or ui/src/api/issues.ts)
- The backend routes already exist at:
  - GET /companies/:companyId/execution-workspaces (list with filters: projectId, status, reuseEligible)
  - GET /execution-workspaces/:id (get by ID)
  - PATCH /execution-workspaces/:id (update)
- Reference Paperclip's implementation at: C:/Users/TK/OneDrive/Desktop/Claude Data/Paperclip-AoA/paperclip-master/paperclip-master/ui/src/api/execution-workspaces.ts

Also add query keys to ui/src/lib/queryKeys.ts:
```typescript
executionWorkspaces: {
  list: (companyId: string) => ["executionWorkspaces", companyId] as const,
  listForProject: (companyId: string, projectId: string) => ["executionWorkspaces", companyId, projectId] as const,
  detail: (id: string) => ["executionWorkspaces", "detail", id] as const,
},
```
Follow the existing pattern in that file.

PART 2: Add two-mode sidebar to TaskSlideOver

File: ui/src/components/TaskSlideOver.tsx

The TaskSlideOver should have two modes controlled by a state variable (e.g., `const [sidebarMode, setSidebarMode] = useState<"task" | "workspace">("task")`):

MODE 1 — Task Properties (default, sidebarMode === "task"):
- Everything that exists today
- NEW: Add a "Workspace" section between the header/properties area and the tabs
- Query workspace: if issue has executionWorkspaceId, fetch it with executionWorkspacesApi.get()
- Before first run (no executionWorkspaceId): Show muted text "No workspace yet — will be created when agent starts work"
- After first run (has executionWorkspaceId): Show a clickable workspace row with:
  - Status badge (active/idle/archived)
  - Branch name with copy button (if workspace has branchName — for software_development departments)
  - Age (relative time from workspace.lastUsedAt)
- Clicking the workspace row: setSidebarMode("workspace")

MODE 2 — Workspace Chat (sidebarMode === "workspace"):
- Breadcrumb header: "← {issue.identifier} / {workspace.name or workspace.branchName}" — clicking the issue identifier calls setSidebarMode("task") to return
- Scrollable timeline showing:
  - Runs as expandable blocks (latest run expanded, older collapsed with one-line summary)
  - Comments shown inline between runs (chat-style)
  - Use existing data: heartbeatsApi.liveRunsForIssue() for active runs, activityApi.runsForIssue() for historical runs, issuesApi.listComments() for comments
  - Merge runs and comments by timestamp
- "Open Workspace" button at bottom — for now, just show a disabled button "Open Workspace (coming soon)" — wired in Session 10
- Input area at bottom:
  - Text input: "Continue working on this task..."
  - Agent selector dropdown: show current assignee agent name, dropdown lists other agents
  - "Send" button that:
    a) Creates a comment on the task: issuesApi.addComment(issueId, { content: text })
    b) Triggers agent wakeup: POST /agents/{agentId}/wakeup (this endpoint exists at server/src/routes/agents.ts line ~1129, uses wakeAgentSchema validator)
    c) The UI API client ui/src/api/agents.ts does NOT have a wakeup method — add one:
       ```typescript
       wakeup: (agentId: string, payload?: {
         source?: "timer" | "assignment" | "on_demand" | "automation";
         triggerDetail?: "manual" | "ping" | "callback" | "system";
         reason?: string | null;
         payload?: Record<string, unknown> | null;
       }) => api.post(`/agents/${agentId}/wakeup`, payload ?? {})
       ```
       All fields are optional. source defaults to "on_demand" server-side. The wakeAgentSchema is in packages/shared/src/validators/agent.ts lines 95-101.
  - After send: invalidate queries for comments and live runs, clear input

TESTS:
- New file: server/src/__tests__/execution-workspaces-api.test.ts
  - Test execution workspace list/get/update API responses
  - Follow pattern from server/src/__tests__/discussions-service.test.ts
- Update ui/src/__tests__/TaskSlideOver.test.tsx:
  - Test: workspace section renders "No workspace yet" when no executionWorkspaceId
  - Test: workspace section renders workspace row when executionWorkspaceId exists
  - Test: clicking workspace row switches to Mode 2
  - Test: breadcrumb in Mode 2 returns to Mode 1

Verify: Open a task → see workspace section (empty state or with data). If task has a workspace, click the row → mode switches to chat view with timeline. Type a message and Send → comment appears + agent wakes. Click breadcrumb → returns to task properties.
```

---

## Session 5: UI — Department function picker + workspace settings

**Commit message:** "feat: add department function picker and workspace policy settings"

### Prompt:

```
Read docs/aoa/specs/workspace-implementation-plan.md (Phase 2.5 and 2.6) for context.

PART 1: Department function picker in NewProjectDialog

File: ui/src/components/NewProjectDialog.tsx (481 lines)

When type === "department" (check how type is currently set — it comes from newProjectDefaults in the dialog context), show a function picker grid AFTER name/description, BEFORE the existing workspace setup section.

10 options in a 3-column grid (use Button variant="outline" or custom card-like buttons):
- Product (Software) | Marketing | Finance
- Support | HR | Legal
- Research | Operations | General | Custom

Each option: icon + label, clickable, selected state highlighted.

Conditional behavior based on selection:
- If "Product (Software)" (functionType === "software_development"):
  - Show the existing workspace setup (Local folder / GitHub repo / Both) — it already exists in the dialog
- If any other type:
  - Replace the workspace setup with a simpler "Working directory (optional)" single folder input
- ALL types: Add a workspace mode toggle below: two buttons [Isolated (default)] [Shared]

When submitting the form:
- Include functionType in the projectsApi.create() call
- Include the workspace mode choice (isolated/shared) — this gets auto-configured into executionWorkspacePolicy by the backend (from Session 1)

PART 2: Policy settings in ProjectProperties

File: ui/src/components/ProjectProperties.tsx (532 lines)

Add a new "Workspace Policy" section after the existing Workspaces section:
- Only show when the project has executionWorkspacePolicy (check project data)
- Default mode toggle: Isolated / Shared (two buttons or select)
  - Updates executionWorkspacePolicy.defaultMode via projectsApi.update()
- Allow per-task override: checkbox
  - Updates executionWorkspacePolicy.allowIssueOverride
- If functionType === "software_development", show collapsible "Advanced" section:
  - Base ref input (placeholder: "main")
  - Branch template input (placeholder: "{{issue.identifier}}-{{slug}}")
  - Provision command input (placeholder: "npm install")
  - Teardown command input
  - Each field saves immediately on blur (follow existing pattern — ProjectProperties uses immediate mutations)

TESTS:
- New file: ui/src/__tests__/NewProjectDialog-functionType.test.tsx
  - Test: function picker renders for departments
  - Test: selecting "Product (Software)" shows repo setup
  - Test: selecting other types shows optional working directory
  - Test: workspace mode toggle works
- Update or create test for ProjectProperties workspace policy section

Reference for advanced settings UI: Paperclip's ProjectProperties at C:/Users/TK/OneDrive/Desktop/Claude Data/Paperclip-AoA/paperclip-master/paperclip-master/ui/src/components/ProjectProperties.tsx — search for "executionWorkspacePolicy" around lines 858-1097.

Verify: Create a new department → see function picker → select "Product (Software)" → see repo setup + mode toggle. Select "Marketing" → see working directory + mode toggle. After creation, check department properties → see Policy section with mode toggle + advanced settings for software dev.
```

---

## Session 6: UI — Workspaces tab in ProjectDetail

**Commit message:** "feat: add Workspaces tab to ProjectDetail"

### Prompt:

```
Read docs/aoa/specs/workspace-implementation-plan.md (Phase 2.7) for context.

Add a "Workspaces" tab to ProjectDetail alongside the existing tabs.

File: ui/src/pages/ProjectDetail.tsx

1. Add "workspaces" to the ProjectTab type (currently: "overview" | "list" | "goals" | "team" | "budget" | "discussions")

2. Add case in resolveProjectTab function for "workspaces"

3. Add TabsTrigger in the TabsList for Workspaces

4. Add TabsContent for the workspaces tab with a workspace list component

Tab content:
- Fetch workspaces: use executionWorkspacesApi.list(companyId, { projectId }) with query key from queryKeys.executionWorkspaces.listForProject()
- Display as a list with columns:
  - Name (workspace name or branchName)
  - Status badge (active / idle / in_review / archived) with color coding
  - Source task (link showing task identifier, e.g., "MET-150")
  - Last used (relative time)
  - Mode (isolated/shared badge)
- Click a workspace row → for now, no navigation (workspace view comes in Phase 3). Just show selected state.
- Empty state: "No workspaces yet. Workspaces are automatically created when agents start working on tasks."

Tab visibility: Show for all departments (all have workspaces enabled). If executionWorkspacePolicy is null/undefined, still show the tab with the empty state.

TESTS:
- New or updated test: verify Workspaces tab renders, shows workspace list or empty state
- Test: workspace data fetched correctly with project filter

Verify: Navigate to a department → see Workspaces tab. Click it → see workspace list (empty or with data). All departments show the tab.
```

---

## Session 7: Workspace View — Route + Layout Shell + Left Panel

**Commit message:** "feat: workspace view route, resizable panel layout, and task navigator"

### Prompt:

```
Read docs/aoa/specs/workspace-implementation-plan.md (Phase 3.0, 3.1, 3.2, 3.3) for context.

Build the foundation of the full workspace view.

1. Install dependency:
   cd ui && pnpm add react-resizable-panels

2. Create workspace route and page:
   - New file: ui/src/pages/WorkspaceView.tsx
   - Route: /:companyPrefix/workspaces/:workspaceId
   - Register in ui/src/App.tsx following existing route patterns (uses react-router-dom, check how other routes are registered)
   - The page fetches workspace data by ID, resolves the linked task (sourceIssueId) and department (projectId)

3. Auto-collapse sidebar:
   - In ui/src/components/Layout.tsx, detect workspace route using useLocation()
   - When pathname matches /workspaces/, auto-set collapsed = true via useSidebar() context
   - Sidebar can still be manually opened via hamburger

4. Create layout shell:
   - New file: ui/src/components/workspace/WorkspaceLayout.tsx
   - Use react-resizable-panels (^4.0.13 — same version vibe-kanban uses)
   - The library exports: Group, Panel, Separator (NOT PanelGroup/PanelResizeHandle — check actual exports)
   - Vibe-kanban's exact usage pattern (WorkspacesLayout.tsx lines 337-403):
     ```tsx
     <Group orientation="horizontal" defaultLayout={defaultLayout} onLayoutChange={onLayoutChange}>
       <Panel id="left-main" minSize="20%">{content}</Panel>
       <Separator id="separator" className="w-1 bg-transparent hover:bg-brand/50 transition-colors cursor-col-resize" />
       <Panel id="right-main" minSize="20%">{content}</Panel>
     </Group>
     ```
   - defaultLayout is an object: `{ 'left-main': 50, 'right-main': 50 }` (percentages)
   - Three outer panels: left nav (~250px fixed), center Group (resizable split), right context (~280px fixed)
   - Panel sizes persisted to localStorage key "aoa:workspace:panel-sizes" with 150ms debounce
   - Reference: vibe-kanban's WorkspacesLayout at C:/Users/TK/OneDrive/Desktop/Claude Data/Paperclip-AoA/vibe-kanban-main/packages/web-core/src/pages/workspaces/WorkspacesLayout.tsx

5. Create left panel — Task Navigator:
   - New file: ui/src/components/workspace/WorkspaceTaskNav.tsx
   - Header: "← Back to Department" button (navigates to /:companyPrefix/projects/:projectId)
   - Department name
   - Search input (filters tasks client-side)
   - Task list grouped by status: Needs Attention / Running / Idle / Completed (collapsible groups)
   - Only show tasks that have workspaces (executionWorkspaceId is not null)
   - Fetch: issuesApi.list(companyId, { projectId }) then filter client-side
   - Each task row: StatusIcon + identifier + title (truncated)
   - Selected task highlighted with accent background
   - Clicking updates parent state (which task is active)

6. Center and right panels: render placeholder content for now ("Timeline coming in next session", "Context sections coming soon")

TESTS:
- New file: ui/src/__tests__/WorkspaceView.test.tsx
  - Test: route resolves and page renders
  - Test: sidebar auto-collapses on workspace route
  - Test: three panels render with resizable handles
  - Test: left panel shows task list grouped by status
  - Test: clicking a task highlights it

Verify: Navigate to /:companyPrefix/workspaces/:id → sidebar auto-collapses → see three-panel layout → left panel shows task navigator → panels are resizable → sizes persist on reload.
```

---

## Session 8: Workspace View — Center Panel Timeline

**Commit message:** "feat: workspace center panel with dependency chain and run/comment timeline"

### Prompt:

```
Read docs/aoa/specs/workspace-implementation-plan.md (Phase 3.4) for context.

Build the center panel of the workspace view.

1. Dependency Chain component:
   - New file: ui/src/components/workspace/DependencyChain.tsx
   - Horizontal flow of task nodes: [✓ Step 1] → [→ Step 2] → [○ Step 3]
   - Fetch dependencies via dependenciesApi.list(issueId)
   - Each node: StatusIcon + task identifier or short title
   - Current task highlighted (border/background accent)
   - Nodes are clickable — clicking updates the selected task in parent state
   - Connected with arrow/line between nodes (CSS borders or SVG)
   - Horizontally scrollable if chain is long (overflow-x-auto)
   - Only rendered when task has dependencies (empty deps = don't show)

2. WorkspaceTimeline component:
   - New file: ui/src/components/workspace/WorkspaceTimeline.tsx
   - IMPORTANT: Design for REUSE — this same component renders in TaskSlideOver Mode 2 (compact) AND in the full workspace view (wide). Accept a className or compact prop.
   - Scrollable vertical timeline combining runs and comments chronologically
   - Fetch: heartbeatsApi for runs + issuesApi.listComments for comments
   - Merge by timestamp, render in order
   - Auto-scroll to bottom when new content arrives (useRef + scrollIntoView)

3. RunBlock component:
   - New file: ui/src/components/workspace/RunBlock.tsx
   - REUSABLE component (used in timeline and sidebar Mode 2)
   - Collapsed state: one line — agent icon + "Agent Name · Run N · status · duration" + expand chevron
   - Expanded state: shows run output (stdout from heartbeatsApi.events or heartbeatsApi.log)
   - Latest/active run: auto-expanded, shows streaming output (poll heartbeatsApi.events every 3s while status=running)
   - Older runs: collapsed by default, click to expand
   - Status indicators: running (spinner), succeeded (check icon green), failed (x icon red)

4. Comments rendered inline between run blocks:
   - "👤 UserName · relative time" with comment text
   - Styled as plain text flow (no card/border), visually distinct from run blocks

5. Input area at bottom (fixed):
   - Same as TaskSlideOver Mode 2 input: text + agent selector + Send
   - "Send" = create comment + POST /agents/:agentId/wakeup
   - "Mark Complete" button shown when task is assigned to a human (assigneeUserId set, no assigneeAgentId)

6. Wire into WorkspaceLayout: replace center placeholder with DependencyChain (top) + WorkspaceTimeline (scrollable middle) + input (bottom)

7. Go back to TaskSlideOver Mode 2 (from Session 4) and replace its inline timeline with the shared WorkspaceTimeline and RunBlock components.

TESTS:
- New file: ui/src/__tests__/DependencyChain.test.tsx
  - Test: renders nodes for dependencies, highlights current task, clicking switches task
- New file: ui/src/__tests__/WorkspaceTimeline.test.tsx
  - Test: renders runs and comments in chronological order
  - Test: latest run expanded, older collapsed
  - Test: Send creates comment and triggers wakeup
- New file: ui/src/__tests__/RunBlock.test.tsx
  - Test: collapsed shows summary, expanded shows output
  - Test: running state shows spinner

Verify: In workspace view, center panel shows dependency chain at top (if task has deps) + timeline of runs and comments + input at bottom. Type and send → comment appears + agent triggered. Runs display correctly (expanded/collapsed). Also verify TaskSlideOver Mode 2 still works with shared components.
```

---

## Session 9: Workspace View — Center-Right Panel + Right Panel Sections

**Commit message:** "feat: workspace right panels — preview mode switcher and context sections"

### Prompt:

```
Read docs/aoa/specs/workspace-implementation-plan.md (Phase 3.5 and 3.6) for context.

PART 1: Center-Right Panel (mode switcher)

New file: ui/src/components/workspace/WorkspacePreviewPanel.tsx

- Hidden by default. Add toggle buttons in a toolbar at the top of the center panel (or floating buttons)
- Three modes: [Changes] [Preview] [Logs] — rendered as small toggle buttons
- When a mode is activated, the center PanelGroup splits: add a second Panel for the preview content
- Changes mode: show placeholder "Diff viewer coming in Phase 4"
- Preview mode: if task has artifacts (fetch via artifactsApi.getByIssueId), show a basic viewer:
  - Images: <img> tag
  - Text/code: <pre> with content
  - Other: download link
- Logs mode: show run stdout/stderr in a scrollable <pre> block (fetch from heartbeatsApi.log)
- Only one mode at a time. Clicking active mode toggles it off (preview panel closes, timeline takes full width)

PART 2: Right Panel Sections

Container: New file: ui/src/components/workspace/WorkspaceRightPanel.tsx
- Renders sections as collapsible blocks
- Uses Collapsible from ui/src/components/ui/collapsible.tsx
- Persist expand/collapse state to localStorage (key per section: "aoa:workspace:section:{name}")

Section files under ui/src/components/workspace/sections/:

a) ArtifactsSection.tsx:
   - Fetch: artifactsApi.getByIssueId(issueId)
   - List: artifact name, type icon (FileCode for code, FileText for doc, Image for image), version number, source badge
   - Click artifact → activate Preview mode in center-right with that artifact

b) ContextSection.tsx:
   - Show dependency outputs: if task has dependencies, fetch upstream completed tasks and their artifacts
   - Below: Memory placeholder card with brain icon and text "Memory integration coming soon — agent memory will appear here once configured"
   - Style placeholder as muted/dashed border card

c) ProcessSection.tsx:
   - Show: assigned agent name + link to agent detail page (/:companyPrefix/agents/:agentId)
   - Adapter type badge
   - Current run status (running/idle)
   - Total run count for this task
   - Blockers: check if task status is "blocked" and show blocking tasks

d) ToolsSection.tsx:
   - Check department functionType (passed from workspace context)
   - If "software_development": show placeholder cards for "Git" and "Terminal" with labels "Coming in Phase 4"
   - All other types: show "No tools configured for this department type" with muted text

e) NotesSection.tsx:
   - Textarea with auto-save to localStorage (key: "aoa:workspace:notes:{workspaceId}")
   - Debounced save (500ms after typing stops)
   - Load saved content on mount
   - Placeholder: "Add notes about this workspace..."

TESTS:
- New file: ui/src/__tests__/WorkspaceRightPanel.test.tsx
  - Test: all 5 sections render in collapsible containers
  - Test: expand/collapse persists
  - Test: ArtifactsSection shows artifacts list
  - Test: ContextSection shows memory placeholder
  - Test: ProcessSection shows agent info
  - Test: ToolsSection shows Git/Terminal placeholders for software_development
  - Test: NotesSection saves and loads from localStorage

Verify: Right panel shows 5 collapsible sections. Artifacts show linked items. Context shows dependency outputs + memory placeholder. Process shows agent info. Tools shows placeholders for Software Dev. Notes auto-saves. Toggle buttons show/hide center-right preview panel.
```

---

## Session 10: Wire navigation + "Open Workspace" button

**Commit message:** "feat: wire Open Workspace navigation between task sidebar and workspace view"

### Prompt:

```
Read docs/aoa/specs/workspace-implementation-plan.md (Phase 3.7) for context.

Wire up all navigation between task detail and workspace view.

1. TaskSlideOver Mode 2 "Open Workspace" button:
   - Currently a placeholder from Session 4
   - Make it functional: navigate to /:companyPrefix/workspaces/:workspaceId using react-router-dom navigate()
   - Get companyPrefix from useCompany() context
   - Close the Sheet when navigating (call onClose before navigating)

2. ProjectDetail Workspaces tab:
   - From Session 6, workspace rows should navigate to workspace view on click
   - Add onClick: navigate to /:companyPrefix/workspaces/:workspaceId

3. Workspace view back navigation:
   - "← Back to Department" in left panel: navigate to /:companyPrefix/projects/:projectId
   - Browser back button works naturally (react-router handles this)

4. Breadcrumb in workspace view:
   - Show at top: "DepartmentName > TaskIdentifier > WorkspaceName"
   - Department link → /:companyPrefix/projects/:projectId
   - Task link → /:companyPrefix/issues?selected=:issueId (opens task in global issues with slide-over)

5. When workspace view loads:
   - Fetch workspace by ID from route params
   - Get linked task via workspace.sourceIssueId
   - Get department via task.projectId
   - Pre-select linked task in left panel
   - Load that task's timeline in center panel

TESTS:
- Test: "Open Workspace" navigates to correct route
- Test: Workspaces tab rows navigate on click
- Test: Back to Department navigates correctly
- Test: Breadcrumb links work

Verify: Full navigation flow: task board → click task → Sheet → click workspace → Mode 2 → click "Open Workspace" → full workspace view → click "Back to Department" → returns. All breadcrumb links work. Browser back button works.
```

---

## Session 11: Software Dev Tools — Git Panel + Terminal

**Commit message:** "feat: git panel and terminal for software development workspaces"

### Prompt:

```
Read docs/aoa/specs/workspace-implementation-plan.md (Phase 4) for context.

1. Install dependency:
   cd ui && pnpm add @xterm/xterm

2. Git Panel (replaces placeholder in ToolsSection for software_development):
   - New file: ui/src/components/workspace/tools/GitPanel.tsx
   - Shows workspace data: workspace.branchName, workspace.baseRef, workspace.repoUrl
   - Branch name with copy-to-clipboard button
   - Base branch display
   - Repo URL as clickable external link (if http/https)
   - PR status: if workspace has PR data, show status badge + link. Otherwise show "No PR created"
   - "Create PR" button: placeholder for now (no backend endpoint yet)
   - Note: git info comes from the execution workspace record itself (already fetched). No new backend endpoint needed for basic display.

3. Terminal Panel:
   - New file: ui/src/components/workspace/tools/TerminalPanel.tsx
   - Uses @xterm/xterm for terminal-style output rendering
   - Displays run stdout/stderr for the current/latest run
   - Fetch: heartbeatsApi.log(runId) for completed runs, heartbeatsApi.events(runId) for streaming
   - Read-only display (not an interactive shell)
   - ANSI color support (xterm handles this natively)
   - Scroll to bottom on new output

4. Update ToolsSection.tsx:
   - When functionType === "software_development", render GitPanel + TerminalPanel instead of placeholders
   - Each in its own collapsible sub-section

TESTS:
- New file: ui/src/__tests__/GitPanel.test.tsx
  - Test: renders branch name, base ref, repo URL
  - Test: copy button works
- New file: ui/src/__tests__/TerminalPanel.test.tsx
  - Test: renders with xterm (may need to mock xterm)
  - Test: displays run output

Reference: vibe-kanban's git panel at C:/Users/TK/OneDrive/Desktop/Claude Data/Paperclip-AoA/vibe-kanban-main/packages/web-core/src/pages/workspaces/GitPanelContainer.tsx

Verify: Open workspace for a Software Dev task → right panel Tools section shows Git panel with branch info and Terminal with run output.
```

---

## Session 12: Software Dev Tools — Diff Viewer + Dev Server Preview

**Commit message:** "feat: diff viewer and dev server preview for software development workspaces"

### Prompt:

```
Read docs/aoa/specs/workspace-implementation-plan.md (Phase 4) for context.

1. Install dependency:
   cd ui && pnpm add @git-diff-view/react

2. Diff Viewer (center-right Changes mode):
   - Replace the "coming in Phase 4" placeholder in WorkspacePreviewPanel.tsx
   - When Changes mode is active and functionType === "software_development":
   - Fetch diff data: check heartbeat runs for detectedOutputs or use workspace git state
   - If run has detectedOutputs with file paths, show file-level diff summary
   - Use @git-diff-view/react for syntax-highlighted rendering
   - For non-code departments: show "No code changes to display" message

3. Dev Server Preview (center-right Preview mode enhancement):
   - Check if workspace has runtime services: query workspace_runtime_services table via API
   - If a running service exists with a port/URL: show iframe pointing to that URL
   - Basic controls: refresh button, URL display
   - If no dev server: show "No dev server running" message with explanation
   - Note: workspace-runtime.ts service manages dev servers during heartbeat runs. The UI just needs to check if one is running.

TESTS:
- Test: Changes mode renders diff viewer for code workspaces
- Test: Changes mode shows "no changes" for non-code workspaces
- Test: Preview mode shows iframe when dev server URL available
- Test: Preview mode shows "no dev server" when none running

Verify: Open workspace for a Software Dev task with code changes → toggle Changes → see diffs. Toggle Preview → see dev server (if configured) or "no dev server" message.
```

---

## Session 13: Polish — Mobile + Lifecycle + Cleanup

**Commit message:** "feat: mobile workspace view, lifecycle management, and polish"

### Prompt:

```
Read docs/aoa/specs/workspace-implementation-plan.md (Phase 5) for context.

Polish pass across the workspace system.

1. Mobile workspace view:
   - In WorkspaceLayout.tsx, detect mobile: use the isMobile pattern from useSidebar() context (uses window.matchMedia for 768px breakpoint)
   - On mobile: replace resizable panels with tab-based navigation
   - Tabs: [Tasks] [Timeline] [Preview] [Context]
   - Use CSS hidden class to preserve state across tab switches (NOT conditional rendering — preserves scroll position and any WebSocket connections)
   - Each tab shows corresponding panel content at full width/height

2. Workspace lifecycle:
   - In ProjectDetail Workspaces tab: add "Archive" action to workspace rows (dropdown menu or button)
   - Archive calls executionWorkspacesApi.update(id, { status: "archived" })
   - Show archived workspaces in a collapsed section at bottom of list
   - In workspace view: if workspace.status === "archived", show a banner at top: "This workspace is archived"

3. General polish:
   - Loading states: use Skeleton components from ui/components/ui/skeleton.tsx in all panels while data loads
   - Error handling: show error messages if API calls fail (use existing toast system from useToast context)
   - Empty states: ensure all sections have proper empty state messages
   - Keyboard: Escape closes TaskSlideOver Sheet
   - Transitions: smooth panel resize, smooth tab switching on mobile

4. Update CLAUDE.md with workspace architecture:
   - Add a "Workspace System" section describing the architecture
   - Mention: functionType, executionWorkspacePolicy, two-mode TaskSlideOver, workspace view route

TESTS:
- Test: mobile layout renders tabs instead of panels
- Test: archive workspace updates status
- Test: archived workspaces shown in collapsed section
- Test: loading skeletons render while fetching

Verify: Test on mobile viewport → tab-based layout works. Archive a workspace → status changes, appears in archived section. All loading/error/empty states work. CLAUDE.md updated.
```

---

## Summary

| Session | Phase | What | Key Files |
|---------|-------|------|-----------|
| 1 | 1 | Backend: functionType + workspaceMode + defaults | projects.ts, workflow-templates.ts, instance-settings.ts |
| 2 | 2.1 | UI: TaskSlideOver Dialog → Sheet | TaskSlideOver.tsx |
| 3 | 2.2 | UI: Wire TaskSlideOver into ProjectDetail | ProjectDetail.tsx |
| 4 | 2.3-2.4 | UI: Workspace API + two-mode sidebar | execution-workspaces.ts, TaskSlideOver.tsx, queryKeys.ts |
| 5 | 2.5-2.6 | UI: Department function picker + policy | NewProjectDialog.tsx, ProjectProperties.tsx |
| 6 | 2.7 | UI: Workspaces tab in ProjectDetail | ProjectDetail.tsx |
| 7 | 3.0-3.3 | Workspace: Route + layout + left panel | WorkspaceView.tsx, WorkspaceLayout.tsx, WorkspaceTaskNav.tsx |
| 8 | 3.4 | Workspace: Center panel timeline | DependencyChain.tsx, WorkspaceTimeline.tsx, RunBlock.tsx |
| 9 | 3.5-3.6 | Workspace: Preview panel + right sections | WorkspacePreviewPanel.tsx, 5 section files |
| 10 | 3.7 | Workspace: Navigation wiring | TaskSlideOver, ProjectDetail, WorkspaceView |
| 11 | 4.1-4.2 | Tools: Git panel + Terminal | GitPanel.tsx, TerminalPanel.tsx |
| 12 | 4.3-4.4 | Tools: Diff viewer + Preview | WorkspacePreviewPanel, @git-diff-view |
| 13 | 5 | Polish: Mobile + lifecycle + CLAUDE.md | WorkspaceLayout, ProjectDetail, CLAUDE.md |
