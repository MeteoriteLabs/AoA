---
title: MCP Server
summary: AoA as an MCP server — 36 tools and 4 resources, RBAC-scoped
---

AoA exposes a JSON-RPC 2.0 MCP endpoint at `/companies/:companyId/mcp`. Agents, Commander, the board UI, and external MCP clients can call it to read and write company data.

## Authentication

Two actor types are accepted:

| Actor | How it authenticates |
|-------|---------------------|
| `mcp` | `Authorization: Bearer <mcp_api_key>` matching an `mcp_api_keys` row |
| `board` | Valid board session cookie (or synthetic `local-board` actor in `local_trusted` mode) |

Requests with neither → `401`. In `local_trusted` mode, writes from loopback succeed without a token.

## Tool Call Format

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "list-tasks",
    "arguments": { "status": "in_progress" }
  }
}
```

## Tools — Read (11)

| Tool | Description |
|------|-------------|
| `me` | Return the authenticated caller's identity and role |
| `list-agents` | List agents in the company, RBAC-scoped. Filter: `status` |
| `get-agent` | Get a single agent by id. Required: `agentId` |
| `list-projects` | List departments + projects. Filter: `type` (`department` \| `project`) |
| `get-project` | Get a single project by id. Required: `projectId` |
| `list-tasks` | List tasks with RBAC scoping. Filters: `status`, `projectId`, `assigneeAgentId`, `assigneeUserId`, `touchedByUserId`, `unreadForUserId`, `labelId`, `q` |
| `get-heartbeat-context` | Compact `{ task, recentComments }` payload for a task (last 10 comments). Required: `taskId` |
| `list-task-comments` | List comments on a task. Required: `taskId` |
| `get-task-comment` | Get a single comment by id. Required: `commentId` |
| `memory.search` | Multi-pathway retrieval (semantic + keyword + temporal). RRF + trust ranking, RBAC-scoped. Required: `query`. Optional: `layer`, `category`, `departmentId`, `projectId`, `limit` (1–50) |
| `memory.get` | Fetch a single approved memory item. Returns `404` outside RBAC scope. Required: `id` |

## Tools — Write (10)

| Tool | Description |
|------|-------------|
| `debrief-push` | Push unstructured content into the Discussion pipeline for LLM extraction. Required: `content`. Optional: `title`, `departmentId`, `projectId`, `source` |
| `suggest-memory` | Create a pending memory suggestion (awaits founder approval). Required: `title`, `content`, `category`. Optional: `layer`, `tags`, `departmentId`, `projectId`, `goalId`, `taskId` |
| `memory.write` | Create a structured memory item and enqueue it for RAG embedding. Always `status='pending'` — the founder must approve before it enters the Knowledge Base (Critical Rule #6). Use for structured knowledge; use `debrief-push` for unstructured content needing extraction first. Required: `title`, `content`, `category`, `layer`, `sourceContext`. Optional: `tags`, `departmentId`, `projectId`, `goalId`, `taskId` |
| `memory.retain` | Persist an observation to memory. When called by an agent with `scopeToSelf: true`, auto-approved into agent's personal scope. All other writes create a pending item (Critical Rule #6). Required: `title`, `content`, `category`, `layer`, `sourceContext`. Optional: `tags`, `departmentId`, `projectId`, `goalId`, `taskId`, `scopeToSelf` |
| `update-task-status` | Update a task's status with permission checks. Required: `taskId`, `status` |
| `create-task` | Create a task directly (RBAC-scoped). Does not route through Discussion. Required: `title`. Optional: `description`, `projectId`, `goalId`, `parentId`, `status`, `priority`, `assigneeAgentId`, `assigneeUserId`, `labelIds` |
| `update-task` | Update task fields. Required: `taskId`. Optional: `title`, `description`, `projectId`, `goalId`, `status`, `priority`, `assigneeAgentId`, `assigneeUserId`, `labelIds` |
| `add-task-comment` | Add a comment to a task. Required: `taskId`, `body` |
| `attach-artifact-version` | Add an immutable version to an artifact. Required: `artifactId`, `sourceDetail`. Optional: `changelog`, `parentVersionId`, `content`, `fileUrl` |
| `ask_founder` | Ask the founder a question and block (~5 min) for the answer. **Org/heartbeat task-execution agents during an active run ONLY** (`403` otherwise; crew/internal-agent are out of scope — their channel is the in-thread reply). Surfaces in the Inbox hub as a `work_question` the founder answers (free-text, or one of your `options`). On timeout the run is parked → returns `{answered:false, status:"parked"}` — stop gracefully, do not retry. Required: `question`. Optional: `options` (`[{label,value}]`, values unique), `context` |

## Tools — Document (5)

| Tool | Description |
|------|-------------|
| `upsert-task-document` | Create or update the task's document artifact. Appends a new immutable version if document exists; creates artifact + links if not. Required: `taskId`, `body`. Optional: `title`, `changeSummary`, `baseRevisionId` |
| `list-task-documents` | List document artifacts on a task (0 or 1 — AoA has 1:1 task↔artifact). Required: `taskId` |
| `get-task-document` | Return the task's document with its latest version content. Required: `taskId` |
| `list-task-document-revisions` | List all immutable revisions of the task document, ordered by version ascending. Required: `taskId` |
| `restore-task-document-revision` | Create a new version copying content from an older revision. Does not mutate the original (Decisions #43, #45). Required: `taskId`, `revisionId` |

## Tools — Approval (10)

| Tool | Description |
|------|-------------|
| `list-approvals` | List approvals, RBAC-scoped. Filters: `status`, `type` |
| `get-approval` | Get an approval by id. Required: `approvalId` |
| `get-approval-tasks` | List tasks linked to an approval. Required: `approvalId` |
| `list-approval-comments` | List comments on an approval. Required: `approvalId` |
| `list-task-approvals` | List approvals linked to a task. Required: `taskId` |
| `create-approval` | Create an approval request. Founders + team leads only. Required: `type`, `payload`. Optional: `requestedByAgentId`, `issueIds` |
| `approval-decision` | Approve, reject, request revision, or resubmit. Founders + team leads only. Required: `approvalId`, `action` (`approve` \| `reject` \| `requestRevision` \| `resubmit`). Optional: `decisionNote`, `payloadJson` |
| `add-approval-comment` | Add a comment to an approval (any role). Required: `approvalId`, `body` |
| `link-task-approval` | Link an approval to a task. Founders + team leads only. Required: `taskId`, `approvalId` |
| `unlink-task-approval` | Unlink an approval from a task. Founders + team leads only. Required: `taskId`, `approvalId` |

## Resources (4)

MCP resources are read via `resources/list` and `resources/read`. They are separate from tools and are not counted in the tool total.

| URI | Description |
|-----|-------------|
| `aoa://tasks` | List all tasks or read a single task (`aoa://tasks/{id}`) |
| `aoa://goals` | List all goals or read a single goal (`aoa://goals/{id}`) |
| `aoa://memory` | List approved memory items or read one (`aoa://memory/{id}`) |
| `aoa://artifacts` | List artifacts with versions or read one (`aoa://artifacts/{id}`) |

## Actor Gate

Most tools are open to all actor types. Three tools have explicit actor gates:

| Tool | Allowed actors |
|------|---------------|
| `memory.search` | All actors (`board`, `agent`, `commander`, `mcp`) |
| `memory.get` | All actors |
| `memory.retain` | All actors — but agent + `scopeToSelf: true` auto-approves; all others create pending items |

## Key Behaviors

- **`debrief-push` vs `create-task`:** Use `debrief-push` for unstructured content that needs LLM extraction into tasks + memory. Use `create-task` when the task title/fields are already known (Decision #14).
- **Memory write gate:** Agents cannot write memory directly to approved status except into their own personal scope via `memory.retain` + `scopeToSelf: true`. All other memory writes land in `pending` status awaiting founder review (Critical Rule #6).
- **Artifact immutability:** `attach-artifact-version` and `upsert-task-document` always create new versions. Existing versions are never modified (Decisions #43, #45).
- **RBAC enforcement:** All tools enforce company isolation. `team_member` actors see only their project-scoped data. Cross-company access returns `404`.
