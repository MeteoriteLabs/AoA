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
POST /api/companies/{companyId}/marketplace/crew/repair
GET /api/companies/{companyId}/marketplace/resolve/{catalogItemId}
POST /api/companies/{companyId}/marketplace/install
GET /api/companies/{companyId}/marketplace/install/{operationId}
DELETE /api/companies/{companyId}/marketplace/teams/{teamId}
```

Marketplace catalog data comes from the configured AoA marketplace CDN with a build-time snapshot fallback. Company routes apply company policy and installation state.

`GET .../updates/{id}/diff` and `POST .../updates/{id}/merge` accept skill and
agent updates. `/diff` returns a section-level diff (a skill's unit is a `## `
section of its SKILL.md; an agent's is `<file>::<## section>` across its whole
instruction bundle); `/merge` takes a `decisions` map of section → `"mine"` |
`"theirs"`. `/apply` is the unreviewed one-click landing and refuses team
updates.

Both verbs require the update to still be open: like `/apply`, `/merge` answers
409 when the update is not `pending` or `conflict`, so a merge cannot be
replayed against one already applied or dismissed.

Merging a **skill** whose catalog item carries a bundle also re-materializes the
bundle's `references/`, `scripts/` and `assets/` from the upstream commit, into
a new version-scoped directory that the row's
`metadata.catalogBundleInstallPath` is repointed at in the same transaction —
so a file the upstream commit deleted is not delivered to agents afterwards. If
the catalog item has stopped carrying a bundle altogether, the pointer and file
inventory are cleared instead and the row returns to `markdown_only`. The
founder's merged markdown is what lands in `company_skills.markdown`; the
bundle's own SKILL.md is never written over it. The checkout runs before the
transaction, so a failed fetch leaves the pending update untouched and
retryable, and replacing an existing bundle directory is staged and renamed into
place rather than deleted up front — a failed fetch never leaves a skill with no
bundle. The response reports `bundleMaterialized` and, when a bundle was
written, `bundleFileCount`.

`POST .../marketplace/crew/repair` is founder-only. It diagnoses whether the
company's AoA crew is inside the marketplace update pipeline and repairs it if
not — adopting `…@legacy`/unstamped crew agents in place, re-provisioning a
company that has no crew at all, or correcting an install-operation row that
reports failure over a committed crew. It returns `{ diagnosis, result }` and is
a no-op on a healthy company.

Adoption is **pointer-only**: it rewrites `templateOrigin` and `templateVersion`
(to the `0.0.0-legacy` sentinel) and installs the crew team's `company_skills`,
and touches nothing else — instructions, `skillKeys`, `runtimeConfig`, triggers,
adapter and name all stay as the founder has them. The follow-on content update
then arrives through the company's `agentUpdatePolicy` (auto-apply, or a
founder-visible pending update), so repair never discards founder edits. It is
all-or-nothing: if any roster member with a local agent row cannot be adopted,
nothing is written and the company stays repairable.

The same repair runs unattended as part of the boot/24h crew update pass, capped
per pass; the route exists for an operator who already knows a specific company
is stuck. Both share a 6-hour per-company cooldown — send `{"force": true}` to
override it after fixing the underlying cause.

`DELETE .../marketplace/teams/{teamId}` is founder-only and permanently deletes
every agent on the team — **except protected AoA agents** (Commander, Steward),
which are **detached rather than destroyed**: the agent row and its triggers
survive, and only its team membership goes away with the team. The response
reports both sides, so retention is never silent:

```json
{ "success": true,
  "deletedAgentIds": ["…"],
  "retainedAgentIds": ["…"],
  "retainedAgents": [{ "id": "…", "name": "Steward", "role": "steward", "why": "…" }] }
```

Protection is decided server-side from the agent's identity, not from catalog
metadata. It is not a refusal because there would be no way back from one: the
AoA crew team is company-wide (`parentProjectId` is null), and roster edits —
both `addMember` and `removeMember` — are refused on a team with no parent
department, so a founder could neither detach the agent nor remove the team.

`DELETE /api/companies/{companyId}/agents/{agentId}` does refuse outright, with
**409**: deleting a single agent has an obvious alternative (pause it), so there
is no dead end.

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

**Founder edits are never silently overwritten.** Once a skill has been edited through
`PATCH .../skills/{skillId}/files`, `company_skills.customized` is `true` and the
source-re-read paths refuse rather than replace it:

- `POST .../skills/{skillId}/install-update` → **409** with
  `details.code = "SKILL_CUSTOMIZED"`. Nothing in the database or on disk is changed.
- `POST .../skills/import` → **201** with the affected skills listed in
  `refusedCustomized` (and a matching entry in `warnings`); they are absent from
  `imported`. Un-edited skills in the same import still update.

Both also raise a founder hub item. To take the upstream version, delete the skill and
re-import it. This mirrors the catalog apply path, which answers 409 `SKILL_CUSTOMIZED`
and routes the founder to the diff/merge review instead.
