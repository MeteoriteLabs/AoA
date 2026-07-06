---
title: Marketplace and Plugins
summary: Catalog, installs, company plugin settings, skill imports, plugin jobs, webhooks, and bridge routes
---

Marketplace routes install AoA catalog items. Plugin routes manage installed plugin manifests, settings, jobs, UI contributions, bridge calls, and version history.

## Marketplace

```
GET /api/marketplace/catalog
POST /api/marketplace/catalog/sync
GET /api/marketplace/catalog/status
GET /api/marketplace/packages
GET /api/companies/{companyId}/marketplace/settings
PATCH /api/companies/{companyId}/marketplace/settings
GET /api/companies/{companyId}/marketplace/updates
POST /api/companies/{companyId}/marketplace/updates/{id}/dismiss
POST /api/companies/{companyId}/marketplace/updates/{id}/apply
GET /api/companies/{companyId}/marketplace/updates/{id}/diff
POST /api/companies/{companyId}/marketplace/updates/{id}/merge
POST /api/companies/{companyId}/marketplace/request-install
GET /api/companies/{companyId}/marketplace/resolve/{catalogItemId}
POST /api/companies/{companyId}/marketplace/install
GET /api/companies/{companyId}/marketplace/install/{operationId}
DELETE /api/companies/{companyId}/marketplace/teams/{teamId}
```

Marketplace catalog data comes from the configured AoA marketplace CDN with a build-time snapshot fallback. Company routes apply company policy and installation state.

## Company Plugins

Mounted under `/api/companies/{companyId}/plugins`:

```
GET /
GET /{pluginId}/config
POST /{pluginId}/config
POST /{pluginId}/upgrade
POST /{pluginId}/upgrade/approve
POST /{pluginId}/upgrade/rollback
PATCH /{pluginId}/settings
```

These routes are company-scoped views over installed plugins and pending upgrades.

## Instance Plugin Routes

```
GET /api/plugins
GET /api/plugins/examples
GET /api/plugins/ui-contributions
GET /api/plugins/tools
POST /api/plugins/tools/execute
POST /api/plugins/install
GET /api/plugins/{pluginId}
DELETE /api/plugins/{pluginId}
POST /api/plugins/{pluginId}/enable
POST /api/plugins/{pluginId}/disable
GET /api/plugins/{pluginId}/health
GET /api/plugins/{pluginId}/logs
POST /api/plugins/{pluginId}/upgrade
GET /api/plugins/{pluginId}/config
POST /api/plugins/{pluginId}/config
POST /api/plugins/{pluginId}/config/test
GET /api/plugins/{pluginId}/jobs
GET /api/plugins/{pluginId}/jobs/{jobId}/runs
POST /api/plugins/{pluginId}/jobs/{jobId}/trigger
POST /api/plugins/{pluginId}/webhooks/{endpointKey}
GET /api/plugins/{pluginId}/dashboard
GET /api/plugins/{pluginId}/version-history
POST /api/plugins/{pluginId}/rollback
```

Bridge routes under `/api/plugins/{pluginId}/bridge/*` and `/api/plugins/{pluginId}/data/*` are for plugin runtime/UI communication and enforce plugin capability and host checks.

## Skills

```
GET /api/companies/{companyId}/skills
GET /api/companies/{companyId}/skills/{skillId}
GET /api/companies/{companyId}/skills/{skillId}/update-status
GET /api/companies/{companyId}/skills/{skillId}/files
POST /api/companies/{companyId}/skills
PATCH /api/companies/{companyId}/skills/{skillId}/files
POST /api/companies/{companyId}/skills/import-package
POST /api/companies/{companyId}/skills/import
POST /api/companies/{companyId}/skills/scan-projects
DELETE /api/companies/{companyId}/skills/{skillId}
POST /api/companies/{companyId}/skills/{skillId}/install-update
```

Skills are company-scoped and may be installed directly, imported from packages, or updated from marketplace sources.
