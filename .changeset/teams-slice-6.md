---
"aoa": minor
---

Inject team coordinations into heartbeat `context.skills` (Slice 6):

- `buildTeamCoordinationSkillEntries(db, companyId, agentId)` exported helper in `server/src/services/heartbeat.ts` — pure function with 4 sequential DB queries: (1) `companies.enableTeams` first as the feature-flag gate, short-circuits to `[]` when off; (2) `teamMembers` capped at 10 via `MAX_TEAMS_PER_AGENT_HEARTBEAT` constant (warn-log fires when an agent hits the cap); (3) `teamCoordinations` filtered to `status='published'`; (4) `teams` for names — only when at least one published coord exists. Returns `{ key: "team-coord-${teamId}", name: "${teamName} Coordination", markdown, trustLevel }[]` shaped like existing `RuntimeSkillEntry`s. `trustLevel` is read from the `team_coordinations.trustLevel` column (default `"markdown_only"`), not hardcoded.
- New try/catch block at the heartbeat call site, immediately after the existing skill-injection block. Defensively checks `Array.isArray(context.skills)` before merging; appends team-coord entries with `[...existing, ...teamCoordEntries]` (append-only — never clobbers prior skills). Sanitized error logging (`err: { name, message }` only — never raw `err`).
- **Adapter compatibility**: zero adapter changes needed. `claude-local` and `cursor-local` already iterate `context.skills` and materialize each entry as a markdown file in the temp `skillsDir` exposed to the CLI via `--add-dir`. Team coordinations ride on the existing skill-injection infrastructure automatically.
- 6 new tests in `server/src/__tests__/heartbeat-team-coordination.test.ts` covering happy path, feature-flag-off short-circuit, no memberships, multiple teams aggregation, drafts excluded by `status='published'` filter, and `trustLevel` pass-through from the DB column.

Risk mitigations: feature flag default `false` so existing companies see zero behavioral change; separate try/catch from skill injection means failure isolation in either direction; append-only merge into `context.skills` never clobbers prior skills; sanitized error logging drops stack traces and SQL strings; pre-existing skill-injection logic is UNCHANGED — only ADDED to.
