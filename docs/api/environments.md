---
title: Environments
summary: Company-scoped execution environments, drivers, targets, and secret bindings
---

Environments describe where agent/runtime work can execute. They are company-scoped and board-controlled.

## Probe

```
POST /api/companies/{companyId}/environments/probe
```

Checks whether a proposed environment target/driver can be reached or configured.

## CRUD

```
GET /api/companies/{companyId}/environments
GET /api/companies/{companyId}/environments/{environmentId}
POST /api/companies/{companyId}/environments
PATCH /api/companies/{companyId}/environments/{environmentId}
DELETE /api/companies/{companyId}/environments/{environmentId}
```

Environment payloads are validated by the shared environment validators. Targets include local-style execution and sandbox targets such as `sandbox-docker`. Secret bindings reference company secrets rather than embedding secret material in the environment record.

Use project-level `GET/PATCH /api/projects/{projectId}/environment` only for legacy project environment variables documented in Goals and Projects.
