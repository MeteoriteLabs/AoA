---
Feature: v2_5_discussions_and_agent
Doc type: permissions
Status: draft
Created: 2026-03-24
Last updated: 2026-03-24
Updated by: agent
Depends on: v2_5_discussions_and_agent_decisions.md
---

# V2.5 Discussions & Internal Agent — Permissions

Access control matrix, role definitions, and enforcement rules.

---

## Role Definitions (Existing — Unchanged)

| Role | Scope | Description |
|------|-------|-------------|
| `founder` | Company-wide | Full access to everything. Sole gatekeeper for identity/domain memory approval. |
| `team_lead` | Department-scoped | Can manage work within their department. Can approve active_context memory for their dept. |
| `team_member` | Department-scoped | Can view and update assigned work. Limited creation rights. |

---

## Internal Agent Permission Model (DA-6)

The internal agent operates with the **logged-in user's role**. It does not have its own RBAC role. When the agent calls a tool that creates or modifies data, the operation is authorized against the user's existing permissions.

If a `team_lead` uses the agent panel and asks "create a department," the agent will attempt the action but RBAC will reject it (only founders can create departments). The agent should detect this and respond: "I can't create departments with your permissions. Ask a founder to do this."

---

## Access Control Matrix

### Discussions

| Action | Founder | Team Lead | Team Member |
|--------|---------|-----------|-------------|
| List discussions | ✅ All | ✅ All | ✅ All |
| View discussion detail | ✅ | ✅ | ✅ |
| Create discussion | ✅ | ✅ | ❌ |
| Update discussion (title, scope, tags) | ✅ | ✅ (own dept) | ❌ |
| Archive discussion | ✅ | ✅ (own dept) | ❌ |
| Add entry to discussion | ✅ | ✅ | ❌ |
| Add annotation | ✅ | ✅ | ❌ |
| Reprocess entry | ✅ | ❌ | ❌ |
| Edit extracted item | ✅ | ✅ (own dept) | ❌ |
| Approve extracted items | ✅ | ❌ | ❌ |
| Link entry between threads | ✅ | ❌ | ❌ |

**Notes:**
- Approval of extracted items is founder-only (same as current brief approval). This is the human-in-the-loop gate.
- Team leads can add entries and annotations to discussions scoped to their department.
- Reprocessing (re-extraction) is founder-only because it triggers the internal agent and costs money.

### Internal Agent

| Action | Founder | Team Lead | Team Member |
|--------|---------|-----------|-------------|
| Use agent panel (chat) | ✅ | ✅ | ✅ |
| View conversation history | ✅ (own) | ✅ (own) | ✅ (own) |
| Reset conversation | ✅ (own) | ✅ (own) | ✅ (own) |
| View agent config/settings | ✅ | ❌ | ❌ |
| Update agent config/settings | ✅ | ❌ | ❌ |
| View run history | ✅ | ❌ | ❌ |
| View reminders | ✅ (own) | ✅ (own) | ✅ (own) |
| Cancel reminders | ✅ (own) | ✅ (own) | ✅ (own) |

**Notes:**
- All users can chat with the agent, but the agent's tool calls are limited by the user's role.
- Agent configuration (model, budget, capabilities) is founder-only.
- Each user has their own conversation — they can't see others' conversations.
- Run history is founder-only (contains all runs including other users' conversations).

### Internal Agent Tool Execution

When the agent calls a tool, the tool's permission check uses the requesting user's role:

| Tool | Founder | Team Lead | Team Member |
|------|---------|-----------|-------------|
| query_tasks | ✅ All | ✅ All | ✅ Own/dept |
| query_goals | ✅ All | ✅ All | ✅ Own/dept |
| query_agents | ✅ All | ✅ Own dept | ✅ Own dept |
| query_departments | ✅ All | ✅ All | ✅ All |
| query_budget | ✅ All | ✅ Own dept | ❌ |
| query_activity | ✅ All | ✅ Own dept | ✅ Own dept |
| query_memory | ✅ All | ✅ All | ✅ All |
| create_task | ✅ | ✅ (own dept) | ❌ |
| update_task | ✅ | ✅ (own dept) | ✅ (assigned) |
| create_department | ✅ | ❌ | ❌ |
| create_goal | ✅ | ✅ (own dept) | ❌ |
| create_agent | ✅ | ❌ | ❌ |
| update_agent | ✅ | ❌ | ❌ |
| assign_task | ✅ | ✅ (own dept) | ❌ |
| wakeup_agent | ✅ | ✅ (own dept agents) | ❌ |
| create_memory | ✅ | ✅ (pending, own dept) | ❌ |
| update_memory | ✅ | ✅ (active_context, own dept) | ❌ |
| find_similar_memory | ✅ | ✅ | ✅ |
| detect_conflicts | ✅ | ✅ | ✅ |
| extract_from_content | ✅ | ❌ | ❌ |
| search_discussions | ✅ | ✅ | ✅ |
| link_discussion_to_project | ✅ | ✅ (own dept) | ❌ |
| create_workflow_template | ✅ | ✅ | ❌ |
| instantiate_workflow | ✅ | ✅ (own dept) | ❌ |
| add_task_dependency | ✅ | ✅ (own dept) | ❌ |
| read_file | ✅ | ✅ (own workspace) | ❌ |
| write_file | ✅ | ❌ | ❌ |
| query_dependency_chain | ✅ | ✅ | ✅ |
| analyze_workload | ✅ | ✅ (own dept) | ❌ |
| suggest_improvements | ✅ | ✅ (own dept) | ❌ |

### Workflow Templates

| Action | Founder | Team Lead | Team Member |
|--------|---------|-----------|-------------|
| List templates | ✅ | ✅ | ✅ |
| View template detail | ✅ | ✅ | ✅ |
| Create template | ✅ | ✅ | ❌ |
| Update template | ✅ | ✅ (own created) | ❌ |
| Delete template | ✅ | ❌ | ❌ |
| Instantiate template | ✅ | ✅ (own dept) | ❌ |

---

## Enforcement Rules

1. **All routes validate company membership** before any operation. User must belong to the company.

2. **RBAC middleware** checks user's role against the action's required role. Same pattern as existing routes.

3. **Internal agent tool execution** passes the user's auth context to each tool. Tools call existing service functions which already have RBAC checks built in.

4. **Department scoping for team leads**: When a team lead uses the agent, tools that filter by "own dept" use the user's department assignments from the `user_roles` table.

5. **Conversation isolation**: Each user's agent conversation is private. The conversation ID is scoped to `(companyId, userId)`. No cross-user conversation access.

6. **Budget enforcement**: Only the founder can set or modify the internal agent's budget. Budget exceeded → agent returns 402 for all users.

7. **Proactive runs**: Proactive runs (morning digest, scheduled checks) execute with system-level read access (can query all data) but cannot create/modify data without user-level authorization. Proactive notifications are read-only summaries.
