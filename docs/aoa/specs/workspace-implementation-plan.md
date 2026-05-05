# Plan: AoA Universal Workspace System — Phased Implementation

## Context

AoA is evolving into a multi-department hybrid workforce OS. The workspace is the core work surface for ALL departments — where tasks are executed, runs are viewed, artifacts are produced, and progress is tracked. Every department gets workspaces. The shell is universal, the content adapts per department type.

**Key decisions made during planning:**
- All departments get workspaces enabled (universal experience)
- Default mode: isolated for all departments (each task gets its own workspace)
- Shared mode available via workflow templates or manual override
- No "Create Workspace" button — workspace auto-creates on first agent run
- One workspace per task
- `functionType` field on projects determines department behavior
- `enableIsolatedWorkspaces` instance setting defaults to true
- TaskSlideOver converts from Dialog to Sheet (right-side panel)
- TaskSlideOver has two modes: Task Properties and Workspace Chat
- "Send" in workspace = create comment + trigger heartbeat wakeup (chat-like feel, heartbeat underneath)
- Center-right panel (Changes/Preview/Logs) hidden by default, toggle to show
- Memory in right panel Context section: show dependency outputs now, memory placeholder "coming soon"
- Agent skills display in workspace deferred to later
- Commander Agent already in left sidebar — separate from workspace

**Architecture reference:** `memory/project_workspace_architecture.md`

---

## What's Already Done (Backend)

- Execution workspaces table + migration (0050) applied
- workspace_runtime_services + workspace_operations tables created
- Issues schema has executionWorkspaceId, executionWorkspacePreference, executionWorkspaceSettings
- Projects schema has executionWorkspacePolicy (jsonb)
- project_workspaces updated with sourceType, setupCommand, cleanupCommand, etc.
- Heartbeat fully integrated with workspace realization, runtime services, cleanup
- Routes registered in app.ts
- Services: workspace-runtime.ts, execution-workspace-policy.ts, workspace-operations.ts
- Feature-gated by `enableIsolatedWorkspaces` (instance settings)

---

## Phase 1: Backend Gaps + Migration
**Goal:** Add `functionType`, `workspaceMode`, change instance setting default, generate migration.
**Effort:** 1 session, small scope.

### 1.1 Add `functionType` to projects schema
```
File: packages/db/src/schema/projects.ts
Add: functionType: text("function_type").default("general")
```
Values: `"software_development"` | `"marketing"` | `"sales"` | `"operations"` | `"hr"` | `"legal"` | `"research"` | `"finance"` | `"general"` | `"custom"`

What `functionType` controls:
- **software_development**: auto-sets `executionWorkspacePolicy` with `enabled: true`, `defaultMode: "isolated_workspace"`, `workspaceStrategy.type: "git_worktree"`. Shows Git/Terminal tools in workspace right panel. Shows Local/GitHub/Both repo setup in creation.
- **All other types**: auto-sets `executionWorkspacePolicy` with `enabled: true`, `defaultMode: "isolated_workspace"`, no `workspaceStrategy` (simple tracking, no git). Shows optional working directory in creation. Empty Tools section in workspace right panel.
- **custom**: same as general but signals user will configure everything manually.

Also add to:
- Project interface: `packages/shared/src/types/project.ts`
- Project API responses: `server/src/routes/projects.ts`
- Project creation/update validators

### 1.2 Add `workspaceMode` to workflow_templates schema
```
File: packages/db/src/schema/workflow_templates.ts
Add: workspaceMode: text("workspace_mode").default("department_default")
Values: "department_default" | "shared" | "isolated"
```

### 1.3 Update `enableIsolatedWorkspaces` default to true
```
File: server/src/services/instance-settings.ts
Change: enableIsolatedWorkspaces default from false → true
```

### 1.4 Update workflow template instantiation
```
File: server/src/services/workflow-templates.ts
```
When `workspaceMode === "shared"`: create one execution workspace during instantiation, link all created tasks to it via `executionWorkspaceId`.
When `"isolated"` or `"department_default"`: leave as-is (workspaces auto-created on first run per task).

### 1.5 Auto-configure executionWorkspacePolicy on department creation
```
File: server/src/routes/projects.ts (or server/src/services/projects.ts)
```
When creating a project with `type: "department"`:
- Read `functionType` from request body
- If `functionType === "software_development"`:
  ```json
  executionWorkspacePolicy: {
    "enabled": true,
    "defaultMode": "isolated_workspace",
    "allowIssueOverride": true,
    "workspaceStrategy": { "type": "git_worktree", "baseRef": "main" }
  }
  ```
- All other types:
  ```json
  executionWorkspacePolicy: {
    "enabled": true,
    "defaultMode": "isolated_workspace",
    "allowIssueOverride": true
  }
  ```

### 1.6 Generate migration + verify
```bash
cd packages/db && pnpm db:generate
pnpm build
cd server && pnpm test
```

### Files to modify:
- `packages/db/src/schema/projects.ts` — add functionType
- `packages/db/src/schema/workflow_templates.ts` — add workspaceMode
- `packages/shared/src/types/project.ts` — add functionType to interface
- `server/src/services/instance-settings.ts` — change default
- `server/src/services/workflow-templates.ts` — shared workspace on instantiation
- `server/src/services/projects.ts` or `server/src/routes/projects.ts` — auto-configure policy on creation

---

## Phase 2: UI Foundation — Task Detail Panel + Department Config
**Goal:** Convert task detail to right-side Sheet panel with two modes (Task Properties / Workspace Chat). Add department function picker and workspace settings.
**Effort:** 1-2 sessions, medium scope.

### 2.1 Convert TaskSlideOver from Dialog to Sheet
```
File: ui/src/components/TaskSlideOver.tsx
```
**Current:** `<Dialog>` + `<DialogContent>` — centered overlay modal.
**Change to:** `<Sheet>` + `<SheetContent side="right">` — right-side slide-in panel.

- Swap Dialog → Sheet, DialogContent → SheetContent side="right"
- Adjust width: test to find right sizing (480-640px range)
- Keep ALL existing content (4 tabs, live runs, comments, artifacts, dependencies)
- Kanban board stays visible underneath
- Polish: cleaner header, consistent spacing, verify popovers work in Sheet context

### 2.2 Wire TaskSlideOver into ProjectDetail
```
File: ui/src/pages/ProjectDetail.tsx
```
- Import TaskSlideOver
- Add `selectedIssueId` state + handler
- Pass `onSelectIssue` callback to IssuesList (already supported)
- Render TaskSlideOver with selected task
- Clicking task in project board opens right-side panel

### 2.3 Create workspace API client
```
NEW File: ui/src/api/execution-workspaces.ts
Methods: list(companyId, filters), get(id), update(id, data)
```

### 2.4 Add two-mode sidebar to TaskSlideOver
```
File: ui/src/components/TaskSlideOver.tsx
```

**Mode 1 — Task Properties (default):**
All existing content + NEW workspace section:
- Before first run: "No workspace yet — will be created when agent starts work"
- After first run: workspace row with status badge, branch name (code), file changes, PR status, age
- Click workspace row → switches to Mode 2

**Mode 2 — Workspace Chat (triggered by clicking workspace row):**
- Breadcrumb: `← MET-150 / ENG-42-fix-auth` (click task ID to return to Mode 1)
- Scrollable timeline: runs as expandable blocks + inline comments
- Latest run expanded with streaming output, older collapsed
- "Open Workspace" button → navigates to full workspace route (Phase 3)
- Input area at bottom:
  - Text: "Continue working on this task..."
  - Agent selector (reassignment)
  - "Send" = creates comment + triggers `heartbeat.wakeup(agentId, { source: "on_demand" })`
- Agent hire approvals shown inline in timeline (also in Inbox)

### 2.5 Department function picker in NewProjectDialog
```
File: ui/src/components/NewProjectDialog.tsx
```
When `type === "department"`, show function picker grid (10 options):
- 💻 Product (Software) | 📢 Marketing | 💰 Finance
- 🎧 Support | 👥 HR | ⚖ Legal
- 🔬 Research | 📊 Operations | 📋 General | ⚙ Custom

**If Product (Software) selected:**
- Show repo setup: [Local folder] [GitHub repo] [Both]
- Show local path + GitHub URL inputs

**If any other type selected:**
- Show: "Working directory (optional)" with folder browse

**All types show:**
- Workspace mode toggle: [🔒 Isolated (default)] [🔗 Shared]
- Selection sets `functionType` and auto-configures `executionWorkspacePolicy`

### 2.6 Add Policy tab/section to ProjectDetail
```
File: ui/src/pages/ProjectDetail.tsx + ui/src/components/ProjectProperties.tsx
```
New "Policy" tab or section in department settings:
- Default mode: Isolated / Shared toggle
- Allow per-task override: checkbox
- **Advanced (Software Dev only):**
  - Base ref (default: main)
  - Branch template (default: `{{issue.identifier}}-{{slug}}`)
  - Provision command
  - Teardown command

### 2.7 Add "Workspaces" tab to ProjectDetail
```
File: ui/src/pages/ProjectDetail.tsx
```
- Add "workspaces" to ProjectTab type
- List execution workspaces for this department
- Columns: name/branch, status, source task, last used
- Click → navigates to workspace route (Phase 3)

### Files to create:
- `ui/src/api/execution-workspaces.ts`

### Files to modify:
- `ui/src/components/TaskSlideOver.tsx` — Dialog→Sheet + two-mode + workspace section + polish
- `ui/src/pages/ProjectDetail.tsx` — TaskSlideOver wiring + Policy + Workspaces tab
- `ui/src/pages/Issues.tsx` — update if needed for Sheet
- `ui/src/components/NewProjectDialog.tsx` — function picker + workspace mode
- `ui/src/components/ProjectProperties.tsx` — policy settings

### Verification:
- Click task in global Issues → right-side panel slides in
- Click task in project board → same panel
- Kanban visible underneath
- Create "Product (Software)" department → see repo setup, policy settings
- Create any other department → see optional working directory, mode toggle
- Task with workspace → click workspace row → Mode 2 (chat view)
- Type message, click Send → comment created + agent woken
- See run output streaming in timeline

---

## Phase 3: Workspace View — Multi-Panel Layout
**Goal:** Build the full workspace experience — the multi-panel view accessible via "Open Workspace."
**Effort:** 2-3 sessions, large scope. Core build.

### 3.0 Add dependency
```bash
cd ui && pnpm add react-resizable-panels
```

### 3.1 Create workspace route + page
```
NEW File: ui/src/pages/WorkspaceView.tsx
Route: /:companyPrefix/workspaces/:workspaceId
```
- Register in App.tsx
- Full-screen workspace
- App sidebar auto-collapses on entry (modify Layout.tsx)

### 3.2 Build workspace layout shell
```
NEW File: ui/src/components/workspace/WorkspaceLayout.tsx
```
- `react-resizable-panels` (PanelGroup, Panel, PanelResizeHandle)
- 3 zones: left panel + center (splits into center-left + center-right) + right panel
- Panel sizes persisted to localStorage
- Mobile: tab-based (hidden CSS to preserve state)

### 3.3 Build left panel — Task Navigator
```
NEW File: ui/src/components/workspace/WorkspaceTaskNav.tsx
```
- Only tasks WITH workspaces (no "No Workspace" group)
- Grouped: Needs Attention / Running / Idle / Completed
- Search + filter
- Click task → loads its workspace into center + right
- "← Back to Department" at top

### 3.4 Build center panel — Timeline + Dependency Chain
```
NEW Files:
  ui/src/components/workspace/DependencyChain.tsx
  ui/src/components/workspace/WorkspaceTimeline.tsx
  ui/src/components/workspace/RunBlock.tsx
```
- **DependencyChain:** horizontal nodes [✓ Step 1] → [→ Step 2] → [○ Step 3]. Clickable — switches task. Only shown when task has dependencies.
- **WorkspaceTimeline:** runs as expandable blocks (latest expanded, older collapsed) + inline comments between runs. Same components used in sidebar Mode 2 (shared).
- **RunBlock:** expandable with streaming output, collapsed with one-line summary.
- **Input area:** text + agent selector + Send + "Mark Complete" for human tasks.

### 3.5 Build center-right panel — Mode switcher
```
NEW File: ui/src/components/workspace/WorkspacePreviewPanel.tsx
```
- **Hidden by default.** Toggle buttons to show.
- Modes: [Changes] [Preview] [Logs]
- Changes: placeholder for Phase 4 (diff viewer)
- Preview: artifact preview (image, document, iframe)
- Logs: process output (formatted text)
- Only one mode at a time

### 3.6 Build right panel — Context Sections
```
NEW Files:
  ui/src/components/workspace/WorkspaceRightPanel.tsx
  ui/src/components/workspace/sections/ArtifactsSection.tsx
  ui/src/components/workspace/sections/ContextSection.tsx
  ui/src/components/workspace/sections/ProcessSection.tsx
  ui/src/components/workspace/sections/ToolsSection.tsx
  ui/src/components/workspace/sections/NotesSection.tsx
```
- Collapsible sections, persist state to localStorage
- **Artifacts:** list with versions, click to preview in center-right
- **Context:** dependency outputs (working now) + memory placeholder ("Memory integration coming soon — agent memory will appear here once configured")
- **Process:** agent name, status, run count, blockers. No cost breakdown for now. Link to agent detail page.
- **Tools:** Software Dev = Git + Terminal placeholders (Phase 4). Others = empty section initially.
- **Notes:** scratch pad with auto-save

### 3.7 Wire navigation
- "Open Workspace" from sidebar Mode 2 → workspace route
- Workspaces tab in ProjectDetail → workspace route
- Back navigation → previous page
- Breadcrumb: Department > Task > Workspace

### Files to create:
- `ui/src/pages/WorkspaceView.tsx`
- `ui/src/components/workspace/WorkspaceLayout.tsx`
- `ui/src/components/workspace/WorkspaceTaskNav.tsx`
- `ui/src/components/workspace/DependencyChain.tsx`
- `ui/src/components/workspace/WorkspaceTimeline.tsx`
- `ui/src/components/workspace/RunBlock.tsx`
- `ui/src/components/workspace/WorkspacePreviewPanel.tsx`
- `ui/src/components/workspace/WorkspaceRightPanel.tsx`
- `ui/src/components/workspace/sections/ArtifactsSection.tsx`
- `ui/src/components/workspace/sections/ContextSection.tsx`
- `ui/src/components/workspace/sections/ProcessSection.tsx`
- `ui/src/components/workspace/sections/ToolsSection.tsx`
- `ui/src/components/workspace/sections/NotesSection.tsx`

### Files to modify:
- `ui/src/App.tsx` — workspace route
- `ui/src/components/Layout.tsx` — auto-collapse sidebar
- `ui/package.json` — add react-resizable-panels

### Verification:
- "Open Workspace" from task sidebar → full workspace view
- Left panel: department tasks with workspaces, grouped by status
- Center: dependency chain (if deps) + run/comment timeline
- Right: artifacts, context (with memory placeholder), process, notes
- Resize panels, verify persistence
- Click tasks in left panel → center/right update
- Click dependency chain nodes → switch task
- Toggle center-right Changes/Preview/Logs
- Mobile: tab-based layout

---

## Phase 4: Software Development Tools
**Goal:** Git panel, Terminal, Diff viewer, Dev server preview.
**Effort:** 1-2 sessions.

### 4.0 Add dependencies
```bash
cd ui && pnpm add @xterm/xterm @git-diff-view/react
```

### 4.1 Git panel (right panel Tools section)
- Branch, base branch, commit list, PR status, "Create PR"
- Backend: API endpoint for git info per workspace
- Reference: vibe-kanban GitPanelContainer

### 4.2 Terminal panel (right panel Tools section)
- xterm.js for run output
- Tabbed sessions
- Reference: vibe-kanban TerminalPanelContainer

### 4.3 Diff viewer (center-right Changes mode)
- Code changes from selected run
- Syntax-highlighted, virtualized
- @git-diff-view/react

### 4.4 Dev server preview (center-right Preview mode)
- iframe for running dev server
- Device emulation toggle
- Reference: vibe-kanban PreviewBrowserContainer

---

## Phase 5: Polish + Remaining
**Goal:** Refinements, mobile, edge cases.
**Effort:** 1-2 sessions.

### 5.1 Workflow template workspace mode UI
### 5.2 Commander Agent page refinement (already in left sidebar)
### 5.3 Mobile workspace view polish
### 5.4 Workspace lifecycle management (archive/cleanup UI)
### 5.5 Evaluate run view consolidation
### 5.6 Wire memory items into Context section (once MCP memory skill is built)

---

## Implementation Sequence

```
Phase 1 (Backend gaps)       → 1 session
Phase 2 (UI foundation)      → 1-2 sessions
Phase 3 (Workspace view)     → 2-3 sessions (core build)
Phase 4 (Code tools)         → 1-2 sessions
Phase 5 (Polish)             → 1-2 sessions
                              ─────────────
                              ~7-10 sessions total
```

---

## Key Files Reference

### Backend (done):
- `packages/db/src/schema/execution_workspaces.ts`
- `server/src/services/workspace-runtime.ts` (1564 lines)
- `server/src/services/heartbeat.ts` (workspace integration ~lines 1380-1530)
- Migration: `packages/db/src/migrations/0050_elite_spencer_smythe.sql`

### Backend (Phase 1):
- `packages/db/src/schema/projects.ts` — add functionType
- `packages/db/src/schema/workflow_templates.ts` — add workspaceMode
- `server/src/services/instance-settings.ts` — default change

### UI (Phase 2):
- `ui/src/components/TaskSlideOver.tsx` — Dialog→Sheet + two-mode
- `ui/src/pages/ProjectDetail.tsx` — TaskSlideOver + Policy + Workspaces tab
- `ui/src/components/NewProjectDialog.tsx` — function picker

### UI (Phase 3):
- `ui/src/pages/WorkspaceView.tsx` — workspace page
- `ui/src/components/workspace/*.tsx` — all workspace components

### Paperclip reference:
- `paperclip-master/ui/src/components/IssueWorkspaceCard.tsx`
- `paperclip-master/ui/src/components/ProjectProperties.tsx`

### Vibe-kanban reference:
- `vibe-kanban-main/packages/web-core/src/pages/workspaces/WorkspacesLayout.tsx`
- `vibe-kanban-main/packages/web-core/src/pages/kanban/ProjectRightSidebarContainer.tsx`
- `vibe-kanban-main/packages/web-core/src/pages/workspaces/RightSidebar.tsx`

### Architecture decisions:
- `memory/project_workspace_architecture.md`
