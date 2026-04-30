---
"aoa": patch
---

Pre-release polish for Teams feature (Category D — slice reviews 1-9):

- **fix(teams): retry slug generation on PG 23505 unique-violation** — `teamsService.create` now retries up to 5 times when a concurrent insert wins the unique-slug race. Previously the TOCTOU window between the `select existing slugs` and `insert teams` produced a generic database error; now the user sees the team created successfully with an incremented suffix.
- **fix(teams): consolidate manifest regex validation into TeamManifestSchema.superRefine** — bad-regex routing rules now fail at the Zod schema layer (route middleware + service-level both catch them), eliminating the dual-validation ambiguity from Slice 5. `validateManifest` no longer runs a separate regex loop after `safeParse`.
- **fix(teams): wrap logActivity calls in safe wrapper to avoid 500-after-success** — `routes/teams.ts` had ~10 activity-log calls that, if they threw, would return 500 after the main DB write succeeded. The new `safeLogActivity` helper logs the failure but doesn't propagate, so the client receives the 200/201 the operation actually earned.

All three fixes are scoped to Teams routes/services. None touch other features. Slice 6/7 manual smoke gates remain outstanding from PR #88/#89.
