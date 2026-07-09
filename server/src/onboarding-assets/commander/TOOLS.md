# Commander — Tool Reference

You have **37 tools** across 9 categories. Only call tools in this list. No other tool names exist.

**Tool naming convention.** Your AoA tools are exposed by the AoA MCP bridge with the namespace prefix `mcp__aoa__`. Inside the prose of this file the tools are written without the prefix for readability (e.g. `query_tasks`), but when you actually invoke a tool you must call it as `mcp__aoa__query_tasks`, `mcp__aoa__create_task`, `mcp__aoa__use_skill`, etc. If a tool in this list appears to be missing at call time, check whether you are using the prefixed form — the bare name (`query_tasks`) is the documentation alias, the callable name is the prefixed form.

---

## Query Tools (read-only, call freely)

| Tool | What it returns |
|------|----------------|
| `query_tasks` | Tasks filtered by status, assignee, department, goal; results include `responsibleUserId` for the responsible human |
| `query_goals` | Company goals with status, progress, linked tasks |
| `query_team_roster` | Unified human + org-agent team roster with readable reporting hierarchy |
| `query_humans` | Human roster with role, title, department, reporting, and admin signal |
| `query_agents` | Agent roster with adapter type, trust score, current assignments |
| `query_departments` | Department list with agent counts and goals |
| `query_budget` | Spend by agent/department, remaining budget, cost events |
| `query_activity` | Recent activity log across all entities |
| `query_company` | Company identity: name, vision, mission, stage, settings |
| `query_company_artifacts` | List the company's recent artifacts (newest first; optional type/status filters) |

---

## Action Tools (confirm before calling)

| Tool | What it does |
|------|-------------|
| `create_task` | Creates a new task (title, description, priority, assignee via `assigneeType` + `assigneeId`, `responsibleUserId`, goalId) |
| `update_task` | Updates an existing task (status, priority, responsible human via `responsibleUserId`; `responsibleUserId` null clears it). Use `assign_task` for assignee reassignment |
| `create_department` | Creates a new department (name, description, parentId) |
| `create_goal` | Creates a company goal (title, description, targetDate) |
| `create_agent` | Provisions a new agent (name, role, adapterType, department) |
| `update_agent` | Updates agent config (name, concurrency, adapterConfig) |
| `assign_task` | Assigns a task to a specific agent or human |
| `wakeup_agent` | Triggers an immediate agent heartbeat run |
| `update_company_identity` | Updates company vision and/or mission — founder must approve |

---

## Memory Tools

| Tool | Notes |
|------|-------|
| `query_memory` | Search or list memory items by layer, department, or keyword |
| `create_memory` | Create a PENDING memory item (not saved until founder approves) |
| `update_memory` | Update an existing approved memory item |
| `find_similar_memory` | Semantic search — find memory items related to a concept |
| `detect_conflicts` | Check whether a new memory item contradicts existing ones |

**Layer reference:** `identity` (company-wide permanent) → `domain` (how we work, semi-permanent) → `active_context` (goal/project-scoped, expires) → `working` (task-chain-scoped, ephemeral, 7-day auto-archive)

---

## Discussion Tools

| Tool | What it does |
|------|-------------|
| `extract_from_content` | Extract structured items (decisions, tasks, insights) from raw text |
| `search_discussions` | Search discussion threads by keyword, department, or date range |
| `link_discussion_to_project` | Link a discussion thread to a department or project |
| `submit_extracted_items` | Submit extracted items for founder review and approval |

---

## Workflow Tools

| Tool | What it does |
|------|-------------|
| `create_workflow_template` | Create a reusable task-chain template with ordered steps |
| `instantiate_workflow` | Expand a workflow template into real tasks for a goal |
| `add_task_dependency` | Add a blocking relationship between two tasks |

---

## File Tools

| Tool | What it does |
|------|-------------|
| `read_file` | Read a file from the execution workspace |

---

## Coordination Tools

| Tool | What it does |
|------|-------------|
| `query_dependency_chain` | Get the full dependency graph for a task or goal |

---

## Analysis Tools

| Tool | What it does |
|------|-------------|
| `analyze_workload` | Summarize agent workload distribution across departments |
| `suggest_improvements` | Generate improvement suggestions based on current company state |

---

## Skills & Delegation Tools

| Tool | What it does |
|------|-------------|
| `use_skill` | Load the full markdown for a named skill and apply its instructions |
| `delegate_to_subagent` | Hand off a subtask to a specialized agent |

---

## Usage Rules

1. **Never guess a tool name.** The 37 tools above are your complete set. If a skill or instruction references a tool not on this list, flag it.
2. **Query before action.** Call read tools to gather current state before any write.
3. **Confirm before write.** All Action and Workflow tools require user confirmation via ⚡OPTIONS⚡ unless a loaded skill explicitly grants auto-execute for the specific step.
4. **Memory governance.** `create_memory` → PENDING. Use `detect_conflicts` before creating new memory that might contradict existing items.

**Task ownership.** The assignee is the agent or human doing the work. The responsible human is the user accountable for the outcome. Use `assigneeType` plus `assigneeId` on `create_task` or `assign_task` when setting who does the task; use `responsibleUserId` on `create_task` or `update_task` when the user names the accountable human; use `query_tasks` to inspect existing responsible human ownership.
