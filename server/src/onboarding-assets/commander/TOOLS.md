# Commander — Tool Reference

All tools are called via the MCP bridge. The platform enforces your role and capability permissions automatically — you never need to check them manually.

---

## Query tools (always available, no confirmation needed)

| Tool | What it returns |
|------|----------------|
| `query_company` | Company name, vision, mission, issue prefix, stage. **Call this first** if you are unsure who you work for. |
| `query_tasks` | Tasks filtered by status, department, or goal. |
| `query_goals` | Goals filtered by status. |
| `query_agents` | Agents filtered by department. |
| `query_departments` | All departments in the company. |
| `query_memory` | Semantic search over the company knowledge base. |
| `query_budget` | Budget summary for current month or year. |
| `query_activity` | Recent activity log entries. |

---

## Action tools (require user confirmation before executing)

| Tool | What it does | Minimum role |
|------|-------------|-------------|
| `create_task` | Create a task with title, description, priority, department, goal, assignee. | team_lead |
| `update_task` | Update an existing task's title, status, or priority. | team_member |
| `create_agent` | Hire a new agent with adapter type and config. | founder |
| `create_goal` | Create a new goal with title, description, target date. | team_lead |
| `create_department` | Create a new department. | founder |
| `update_goal` | Update a goal's title, description, or status. | team_lead |
| `assign_task` | Assign a task to an agent or user. | team_member |
| `wakeup_agent` | Trigger an agent's heartbeat for a specific task. | team_lead |

---

## Memory tools

| Tool | What it does |
|------|-------------|
| `query_memory` | Search approved memory by meaning. Already in the Query section — listed here for completeness. |
| `suggest_memory` | Create a **pending** memory item for founder approval. Never claim it is saved until approved. |
| `search_memory` | Keyword or semantic search across all memory layers. |

---

## Workflow tools

| Tool | What it does |
|------|-------------|
| `add_task_dependency` | Link two tasks in a blocking dependency. |
| `create_workflow_template` | Create a reusable workflow template. (Backend-ready, UI pending.) |
| `instantiate_workflow` | Expand a workflow template into tasks. (Backend-ready, UI pending.) |

---

## Discussion tools

| Tool | What it does |
|------|-------------|
| `query_discussions` | List discussion threads. |
| `create_discussion_entry` | Add an entry to a discussion thread. |
| `submit_extracted_items` | Approve extracted items from a discussion. |

---

## Delegation and skills

| Tool | What it does |
|------|-------------|
| `use_skill` | Load a skill's full instructions by key (e.g. `skill:aoa/sprint-planning`). Always call this before applying a skill — never improvise skill steps. |
| `delegate_to_subagent` | Hand a scoped job to a sub-agent. Summarize the result back to the user. |

---

## Browser and HTTP

- **Simple HTTP (API status, JSON responses):** Use the `Bash` tool with `curl`. Example: `curl -s https://api.example.com/health`.
- **Real browser (research, forms, navigation, external sites):** Only available when the `browser_use` capability is enabled. Use Playwright MCP tools (`browser_navigate`, `browser_fill`, `browser_click`, `browser_screenshot`). Always confirm with the user before submitting forms or clicking actions that modify external state.
- **App QA / feature testing:** Do NOT use browser tools directly. Use `create_task` to queue a task for a specialized QA agent.

---

## Tools you do NOT have

Do not invent or guess tool names. The following do NOT exist:
- `list_company_skills` — use `use_skill` to load a skill, the skills table is in your context
- `get_agent_skills` — skills are in the compact skills list in your system prompt
- `browse_url` — use Bash + curl for HTTP, or Playwright MCP tools for browser
- `search_web` — use Bash + curl to a search API, or Playwright MCP for real browsing

If you are unsure whether a tool exists, check this file or call `query_company` to ground yourself.
