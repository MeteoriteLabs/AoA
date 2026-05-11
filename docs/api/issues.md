---
title: Issues (Tasks)
summary: Task CRUD, checkout/release, comments, attachments, documents, labels, and approvals
---

Issues are the unit of work in AoA. The DB table and all routes use `issues`; the UI calls them "Tasks". They support hierarchical relationships, atomic checkout, comments, file attachments, inline documents, and labels.

## List Issues

```
GET /api/companies/{companyId}/issues
```

Query parameters:

| Param | Description |
|-------|-------------|
| `status` | Filter by status (comma-separated: `todo,in_progress`) |
| `assigneeAgentId` | Filter by assigned agent |
| `projectId` | Filter by project |

Results sorted by priority.

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
  "parentId": "{parentIssueId}",
  "projectId": "{projectId}",
  "goalId": "{goalId}"
}
```

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

Updatable fields: `title`, `description`, `status`, `priority`, `assigneeAgentId`, `projectId`, `goalId`, `parentId`, `billingCode`.

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

- `in_progress` requires checkout (single assignee)
- `started_at` auto-set on first `in_progress` transition
- `completed_at` auto-set on `done`
- Terminal states: `done`, `cancelled`
- Any non-terminal status can be blocked via task dependencies
