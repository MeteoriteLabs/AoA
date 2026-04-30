---
"aoa": minor
---

Add manifest tab YAML editor + cascade-aware save (Slice 5):

- `teamsService.updateManifest(id, manifest)` in `server/src/services/teams.ts` — validates manifest invariants, persists to `teams.manifest` JSONB column, throws notFound on missing team
- `PUT /teams/:id/manifest` route in `teamsRoutes(db)` factory — Zod-validated body via `TeamManifestSchema`, RBAC-gated (founder/team_lead), cascades to `coordSvc.regenerateAutoSections` when a coordination row exists (no-op if missing), activity-logs `team.manifest_updated` with `{schemaVersion, version}` details
- `teamsApi.updateManifest(teamId, manifest)` in `ui/src/api/teams.ts` — uses `api.put`
- `ManifestEditor` component in `ui/src/components/team/ManifestEditor.tsx` — YAML textarea bound to `team.manifest`, live YAML parsing with inline `role="alert"` error pane, shape rejection (scalars/arrays/null disallowed), `aria-invalid` + `aria-describedby` for a11y, `isDirty` tracking guards stale-edits-loss when parent refetches, broad cache invalidation on save (`["teams", companyId]`)
- Wired into `TeamDetail.tsx` Manifest tab (replaces Slice 1's placeholder)
- 4 new server-side tests (mock-DB cases for service `updateManifest`) + 7 new UI tests (component behavior)

All changes additive; existing functionality unaffected for companies with `enableTeams=false`. The cascade is conditional — does NOT scaffold new coordination rows from a manifest update.
