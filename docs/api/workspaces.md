---
title: Workspaces
summary: Execution workspaces, runtime services, workspace git operations, and project git graph
---

Execution workspaces are per-task git worktrees and runtime surfaces for software-development work. They are company-scoped through the owning task/project and enforce workspace authorization.

## Execution Workspaces

```
GET /api/companies/{companyId}/execution-workspaces
GET /api/execution-workspaces/{id}
PATCH /api/execution-workspaces/{id}
GET /api/execution-workspaces/{id}/runtime-services
GET /api/execution-workspaces/{id}/close-readiness
GET /api/execution-workspaces/{id}/workspace-operations
POST /api/execution-workspaces/{id}/runtime-services/{action}
POST /api/execution-workspaces/{id}/runtime-commands/{action}
```

Runtime actions start, stop, restart, or inspect configured services for a workspace.

## Workspace Git

```
GET /api/execution-workspaces/{id}/git/status
GET /api/execution-workspaces/{id}/git/safety
GET /api/execution-workspaces/{id}/git/log
POST /api/execution-workspaces/{id}/git/commit
POST /api/execution-workspaces/{id}/git/push
```

Git write operations require permission to operate on the workspace and are guarded by safety checks.

## Project Git

```
GET /api/companies/{companyId}/projects/{projectId}/git/graph
GET /api/companies/{companyId}/projects/{projectId}/git/enrich
```

These routes power project-level git graph visualizations and enrichment.

