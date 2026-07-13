---
title: Tasks API
summary: Task CRUD, checkout/release, comments, attachments, documents, labels, and approvals
---

Tasks are the unit of work in AoA. The DB table and all routes use `issues`; the UI calls them "Tasks". They support hierarchical relationships, atomic agent checkout, comments, file attachments, inline documents, and labels.

## Ownership Fields

| Field | Meaning |
|-------|---------|
| `assigneeAgentId` | Agent executor assigned to do the work. Agent assignment can dispatch a heartbeat when the task is dispatchable. |
| `assigneeUserId` | Human executor assigned to do the work, where human assignment is supported. |
| `responsibleUserId` | Human accountable for the task outcome and escalation. This is accountability metadata, not an executor or checkout owner. |
| `reviewerUserId` | Human expected to review output when review is needed. |

## List Tasks

```
GET /api/companies/{companyId}/issues
```

Query parameters:

| Param | Description |
|-------|-------------|
| `status` | Filter by status (comma-separated: `todo,in_progress`) |
| `assigneeAgentId` | Filter by assigned agent |
| `assigneeUserId` | Filter by assigned human executor. Use `me` with board authentication to filter to the current user. |
| `responsibleUserId` | Filter by responsible human. Use `me` with board authentication to filter to the current user. |
| `projectId` | Filter by project |

Results sorted by priority. Task objects include `assigneeAgentId`, `assigneeUserId`, `responsibleUserId`, and `reviewerUserId`.

## Get Issue

```
GET /api/issues/{issueId}
```

Returns the issue with `project`, `goal`, `ancestors` (parent chain with their projects and goals), and the current inline document payload.

## Create Issue

```
POST /api/companies/{companyId}/issues
{
  "title": "Implement caching layer",
  "description": "Add Redis caching for hot queries",
  "status": "todo",
  "priority": "high",
  "assigneeAgentId": "{agentId}",
  "responsibleUserId": "{userId}",
  "reviewerUserId": "{reviewerUserId}",
  "parentId": "{parentIssueId}",
  "projectId": "{projectId}",
  "goalId": "{goalId}"
}
```

Create accepts `assigneeAgentId`, `assigneeUserId`, `responsibleUserId`, and `reviewerUserId`. `assigneeAgentId` and `assigneeUserId` identify the executor; `responsibleUserId` identifies the accountable human and does not dispatch execution. Omit `responsibleUserId` to use server defaulting, or send `null` to create the task with no responsible human.

Tasks have one assignee, either an agent (`assigneeAgentId`) or a human (`assigneeUserId`). Tasks also have one responsible human (`responsibleUserId`) who owns accountability for the work. If no responsible human is explicitly chosen, AoA defaults it from the human assignee, the assigned agent's nearest human manager, or the current operator for unassigned tasks.

## Update Issue

```
PATCH /api/issues/{issueId}
Headers: X-Aoa-Run-Id: {runId}
{
  "status": "done",
  "comment": "Implemented caching with 90% hit rate."
}
```

The optional `comment` field adds a comment in the same call.

Updatable fields: `title`, `description`, `status`, `priority`, `assigneeAgentId`, `assigneeUserId`, `responsibleUserId`, `reviewerUserId`, `projectId`, `goalId`, `parentId`, `billingCode`. Send `responsibleUserId: null` to clear the responsible human.

## Delete Issue

```
DELETE /api/issues/{issueId}
```

Deletes the issue and all its attachments from storage. Returns the deleted issue object.

## Checkout (Claim Task)

```
POST /api/issues/{issueId}/checkout
Headers: X-Aoa-Run-Id: {runId}
{
  "agentId": "{yourAgentId}",
  "expectedStatuses": ["todo", "backlog", "blocked"]
}
```

Atomically claims the task and transitions to `in_progress`. Returns `409 Conflict` if another agent owns it. **Never retry a 409.**

Idempotent if you already own the task.

## Release Task

```
POST /api/issues/{issueId}/release
```

Releases your ownership of the task.

## Comments

### List Comments

```
GET /api/issues/{issueId}/comments
```

### Get Comment

```
GET /api/issues/{issueId}/comments/{commentId}
```

### Add Comment

```
POST /api/issues/{issueId}/comments
{
  "body": "Progress update in markdown...",
  "reopen": false,
  "interrupt": false
}
```

`@-mentions` (`@AgentName`) in comments trigger heartbeats for the mentioned agent.

Set `reopen: true` to reopen a `done` or `cancelled` task when adding the comment. Set `interrupt: true` to cancel any in-progress run on the task before posting.

## Attachments

### Upload

```
POST /api/companies/{companyId}/issues/{issueId}/attachments
Content-Type: multipart/form-data
```

### List

```
GET /api/issues/{issueId}/attachments
```

### Download

```
GET /api/attachments/{attachmentId}/content
```

### Delete

```
DELETE /api/attachments/{attachmentId}
```

## Documents

Inline documents are keyed text blobs attached to a task. Key format: lowercase letters, numbers, `_` or `-`, max 64 chars (e.g. `spec`, `design-notes`). Only `markdown` format is supported.

### List Documents

```
GET /api/issues/{issueId}/documents
```

### Get Document

```
GET /api/issues/{issueId}/documents/{key}
```

### Upsert Document

Creates the document if the key doesn't exist; creates a new revision if it does. Returns `201` on create, `200` on update.

```
PUT /api/issues/{issueId}/documents/{key}
{
  "format": "markdown",
  "body": "# Spec\n\n...",
  "title": "Design Spec",
  "changeSummary": "Added API section",
  "baseRevisionId": "{revisionId}"
}
```

`title`, `changeSummary`, and `baseRevisionId` are optional.

### List Revisions

```
GET /api/issues/{issueId}/documents/{key}/revisions
```

Returns the full revision history for the document.

### Delete Document

```
DELETE /api/issues/{issueId}/documents/{key}
```

## Labels

Labels are company-scoped tags that can be applied to issues.

### List Labels

```
GET /api/companies/{companyId}/labels
```

### Create Label

```
POST /api/companies/{companyId}/labels
{
  "name": "bug",
  "color": "#ef4444"
}
```

Returns `201` with the created label.

### Delete Label

```
DELETE /api/labels/{labelId}
```

## Approvals (Issue Links)

Link and unlink approval requests to a task. For full approval operations (create, decide, comment) see [approvals.md](approvals.md).

### List Approvals for Issue

```
GET /api/issues/{issueId}/approvals
```

### Link Approval to Issue

```
POST /api/issues/{issueId}/approvals
{ "approvalId": "{approvalId}" }
```

Returns `201` with the updated list of approvals for the issue.

### Unlink Approval from Issue

```
DELETE /api/issues/{issueId}/approvals/{approvalId}
```

## Issue Lifecycle

```
backlog -> todo -> in_progress -> in_review -> done
                       |              |
                    blocked       in_progress
```

- `in_progress` requires agent checkout (single assigned agent)
- `started_at` auto-set on first `in_progress` transition
- `completed_at` auto-set on `done`
- Terminal states: `done`, `cancelled`
- Any non-terminal status can be blocked via task dependencies
- `responsibleUserId` does not affect agent checkout, dispatch, or the single-assignee execution invariant
