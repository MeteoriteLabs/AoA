---
title: Activity
summary: Activity log queries and manual log entries
---

Query the audit trail of all mutations across the company. Issue identifiers (`PROJ-123` format) are accepted wherever issue IDs are required.

## List Company Activity

```
GET /api/companies/{companyId}/activity
```

Query parameters:

| Param | Description |
|-------|-------------|
| `agentId` | Filter by actor agent |
| `entityType` | Filter by entity type (`issue`, `agent`, `approval`, etc.) |
| `entityId` | Filter by specific entity |

## Log Manual Activity Entry

```
POST /api/companies/{companyId}/activity
{
  "actorType": "user",
  "actorId": "{userId}",
  "action": "custom.note",
  "entityType": "issue",
  "entityId": "{issueId}",
  "details": { "note": "Manual observation" }
}
```

Creates a custom activity log entry. Board access required. Returns `201` with the created entry. `details` values are sanitized before storage.

## Issue Activity

```
GET /api/issues/{issueId}/activity
```

Returns all activity log entries for a specific issue, **scoped to the company that owns the issue**. Accepts issue ID or identifier format (`PROJ-123`).

The company scope is a security predicate, not a convenience: `entityType`/`entityId` are free text on some writers, so before it existed a row recorded against another tenant but typed `issue` with this issue's id was returned here. Rows with no company are never returned by this route.

## Security Denial Evidence (operator only)

```
GET /api/instance/security-denials
```

Returns durable `security.denied.*` audit rows **across all tenants**, newest first. This is the reader for the security-denial namespace written by the deny paths in `services/security-denial-audit.ts`.

Requires **instance-operator** access (the same gate as `/api/instance/settings/*`). It is not reachable by any company member, founders included, and there is deliberately **no company-scoped denial feed**: a cross-tenant probe is attributed to the *actor's* own tenant and is never surfaced to the probed tenant. Whether a probed tenant is entitled to know it was probed is an open programme decision; this surface does not pre-empt it.

Query parameters (all optional; every one narrows, none widens):

| Param | Description |
|-------|-------------|
| `crossing` | Threat-control crossing id, e.g. `DE-19` (matched on `details.crossing`) |
| `surface` | Denial surface slug — the `action` suffix, e.g. `memory_read` |
| `actorId` | The refused identity (agent id, user id, worker id) |
| `entityType` / `entityId` | The refused resource |
| `companyId` | Narrow to one tenant's refusals |
| `since` | ISO-8601 timestamp lower bound |
| `limit` | 1–500, default 100 |

Rows carry the full attribution the recorder wrote: who was refused, in which tenant, on which resource, by which control, and why (`details.reason`, a stable machine code).

## Issue Heartbeat Runs

```
GET /api/issues/{issueId}/runs
```

Returns the heartbeat run history for a specific issue — all runs that worked on it. Accepts issue ID or identifier format.

## Issues for a Run

```
GET /api/heartbeat-runs/{runId}/issues
```

Returns the issues that a specific heartbeat run touched or was working on.

---

## Activity Record Fields

| Field | Description |
|-------|-------------|
| `actor` | Agent or user who performed the action |
| `action` | What was done (e.g. `issue.created`, `agent.paused`, `approval.approved`) |
| `entityType` | Type of entity affected |
| `entityId` | ID of the affected entity |
| `details` | Specifics of the change |
| `createdAt` | When the action occurred |

The activity log is append-only and immutable. All mutations are automatically recorded:

- Issue creation, updates, status transitions, assignments, checkouts
- Agent creation, configuration changes, pausing, resuming, termination
- Approval creation, decisions, comments
- Comment creation and feedback votes
- Budget and company configuration changes
- Label, secret, and memory item changes
