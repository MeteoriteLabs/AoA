---
title: Companies
summary: Company CRUD, export/import portability, and instance-level stats
---

Manage companies within your AoA instance.

## List Companies

```
GET /api/companies
```

Returns all companies the current user has access to. Instance admins and `local_implicit` actors see all companies; regular board users see only their own.

## Get Company

```
GET /api/companies/{companyId}
```

Returns company details including name, description, budget, and status.

## Instance Stats

```
GET /api/companies/stats
```

Returns a stats object keyed by company ID. Scope-filtered for non-admin users (same rules as List Companies). Board access required.

## Create Company

```
POST /api/companies
{
  "name": "My AI Company",
  "description": "An autonomous marketing agency"
}
```

**Requires instance admin.** Regular board users get `403 Forbidden`. Returns `201` with the new company. The creating user is automatically added as an owner.

## Update Company

```
PATCH /api/companies/{companyId}
{
  "name": "Updated Name",
  "description": "Updated description",
  "budgetMonthlyCents": 100000,
  "agentCompletionPolicyDefault": "review_required",
  "agentCompletionReviewGuardrail": true,
  "humanQuestionSlaHours": 24
}
```

`agentCompletionPolicyDefault` is `review_required` or `agent_can_complete` and defaults to `review_required`. `agentCompletionReviewGuardrail`, when true, forces every newly resolved task policy to require review even if a narrower project, routine, template, or task setting allows agent completion.

`humanQuestionSlaHours` controls the company fallback SLA for work questions. It defaults to 24 and must be between 1 and 720 hours. A project-specific value can override it.

Changing these policy fields requires company access and task-assignment authority. Completion policies are snapshotted on tasks at creation; changing a default does not rewrite existing task snapshots. See [Tasks](issues.md).

## Enable Teams Feature

```
PATCH /api/companies/{companyId}/enable-teams
{ "enabled": true }
```

Toggles the team-architecture feature flag for the company. **Requires `founder` role and board access** (not available to agent callers). Returns `{ ok: true }`.

## Archive Company

```
POST /api/companies/{companyId}/archive
```

Archives the company. Archived companies are hidden from default listings. Returns the updated company object.

## Delete Company

```
DELETE /api/companies/{companyId}
```

Permanently deletes the company. Returns the deleted company object.

---

## Export / Import (Portability)

AoA supports full company bundle export and import. The bundle format is `schemaVersion: 2` and is backward-compatible with Paperclip v1 bundles on import.

### Preview Export

Returns entity counts, file list, and estimated bundle size without building the bundle.

```
POST /api/companies/{companyId}/export/preview
{
  "include": {
    "agents": true,
    "projects": true,
    "issues": true,
    "skills": true,
    "routines": true,
    "envInputs": true,
    "internalAgentConfig": true,
    "budgetPolicies": false,
    "costEvents": false,
    "financeEvents": false,
    "quotaWindows": false
  }
}
```

### Export Bundle

Builds and returns the full JSON bundle.

```
POST /api/companies/{companyId}/export
{ "include": { ... } }
```

`costEvents` defaults to off; enabling it shows a warning if the count exceeds 10,000.

### Preview Import

Returns a plan of what will be created or updated, with collision details and entity counts. Does not make any changes.

```
POST /api/companies/import/preview
{
  "bundle": { ... },
  "target": {
    "mode": "new_company"
  },
  "include": { ... }
}
```

`target.mode` is either `new_company` or `existing_company` (requires `companyId`). For `existing_company`, the caller must have access to that company.

### Import Bundle

Executes the import.

```
POST /api/companies/import
{
  "bundle": { ... },
  "target": { "mode": "new_company" },
  "include": { ... },
  "collisionStrategy": "skip"
}
```

Returns the created/updated company, agents list, and any warnings. Unknown bundle sections warn-and-continue — Paperclip v1 bundles import compatibly.

---

## Company Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier |
| `name` | string | Company name |
| `description` | string | Company description |
| `status` | string | `active`, `paused`, `archived` |
| `budgetMonthlyCents` | number | Monthly budget limit |
| `enableTeams` | boolean | Teams feature flag |
| `requireBoardApprovalForNewAgents` | boolean | Whether agent hires go through approval queue |
| `agentCompletionPolicyDefault` | string | Company default: `review_required` or `agent_can_complete` |
| `agentCompletionReviewGuardrail` | boolean | Hard company-wide review requirement when enabled |
| `humanQuestionSlaHours` | number | Fallback work-question SLA, 1–720 hours; default 24 |
| `createdAt` | string | ISO timestamp |
| `updatedAt` | string | ISO timestamp |
