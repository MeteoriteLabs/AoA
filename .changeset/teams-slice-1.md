---
"aoa": minor
---

Add teams architecture foundation (Slice 1):

- New tables: teams, team_members, team_coordinations
- New companies.enable_teams boolean column (default false — opt-in feature flag)
- teamsService + teamCoordinationService factories with full CRUD + membership constraints
- HTTP routes via teamsRoutes(db) factory: 11 endpoints under /companies/:cid/teams and /teams/:id
- Founder-only PATCH /companies/:cid/enable-teams toggle
- UI API client (teamsApi) using canonical api.* methods
- Pure function helpers: team-slug (generateTeamSlug, ensureUniqueSlug), team-manifest (parseManifest, validateManifest, serializeManifest)
- Coverage: pure-function tests + service tests + route conformance test (104+ tests)
- All changes purely additive; existing functionality unaffected (existing companies have enableTeams=false).
