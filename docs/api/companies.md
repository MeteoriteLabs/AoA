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
  "budgetMonthlyCents": 100000
}
```

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
| `createdAt` | string | ISO timestamp |
| `updatedAt` | string | ISO timestamp |
