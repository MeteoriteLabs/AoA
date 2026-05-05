# AGENTS.md

Guidance for human and AI contributors working in this repository.

## 1. Purpose

AoA (Army of Agents) is a Hybrid Workforce Operating System for solo founders — built on Paperclip (open-source AI agent orchestration). The current implementation is **V2.5**.

## 2. Read This First

Before making changes, read in this order:

1. `CLAUDE.md` — architecture baseline, critical rules, naming map, all implemented tables
2. `docs/aoa/reference/decisions.md` — 90 locked product and architectural decisions. **Do not relitigate.**
3. `docs/aoa/specs/v2_5_changelog.md` — what shipped in V2.5 (Discussions, Internal Agent, Workflow Templates, Notifications)
4. `docs/aoa/v2.5/REVIEW_REPORT.md` — cross-reference audit of V2.5 spec docs against codebase; known deviations

## 3. Repo Map

```
server/src/           → Express 5.x REST API, services, adapters, heartbeat
ui/src/               → React + Vite board UI
packages/db/          → Drizzle schema, migrations, DB clients
packages/shared/      → Shared types, constants, validators, API path constants
packages/adapters/    → Adapter utilities
docs/                 → All documentation
```

Key doc paths:
- `docs/aoa/reference/decisions.md` — locked decisions (#1–90 + DA series)
- `docs/aoa/specs/v2_5_changelog.md` — V2.5 shipped features
- `docs/aoa/v2.5/` — V2.5 architecture, API contracts, schema, flow docs
- `docs/superpowers/` — session plans and design specs

## 4. Dev Setup (Auto DB)

Use embedded PGlite in dev by leaving `DATABASE_URL` unset.

```sh
pnpm install
pnpm dev
```

This starts:

- API + UI: `http://localhost:3100`

Quick checks:

```sh
curl http://localhost:3100/api/health
curl http://localhost:3100/api/companies
```

Reset local dev DB:

```sh
rm -rf data/pglite
pnpm dev
```

## 5. Core Engineering Rules

1. **Keep changes company-scoped.**
   Every domain entity must be scoped to a company. Enforce company boundaries in routes and services.

2. **Keep contracts synchronized.**
   If you change schema or API behavior, update all impacted layers:
   - `packages/db` — schema and exports
   - `packages/shared` — types, constants, validators
   - `server` — routes and services
   - `ui` — API clients and pages

3. **Preserve control-plane invariants.**
   - Single-assignee task model
   - Atomic issue checkout semantics (`SELECT FOR UPDATE NO WAIT`)
   - Approval gates for governed actions
   - Budget hard-stop auto-pause behavior
   - Activity logging for all mutating actions

4. **Naming map — UI says Task/Home/Budget/Team/Discussion, DB/API stay unchanged.**
   See `CLAUDE.md` §Naming Map for the full table. Never rename DB tables or API routes.

5. **MCP inbound always routes through the Discussion pipeline.** Never create raw tasks from MCP input. (Decision #14)

6. **Drizzle ORM only.** Schema changes go in `packages/db/src/schema/`. Run `pnpm db:generate`. Never write raw SQL migration files. (Decision #19)

7. **New services follow `server/src/services/goals.ts`. New routes follow `server/src/routes/goals.ts`.**

## 6. Database Change Workflow

When changing the data model:

1. Edit `packages/db/src/schema/*.ts`
2. Ensure new tables are exported from `packages/db/src/schema/index.ts`
3. Generate migration:

```sh
pnpm db:generate
```

4. Validate compile:

```sh
pnpm -r typecheck
```

Notes:
- `packages/db/drizzle.config.ts` reads compiled schema from `dist/schema/*.js`
- `pnpm db:generate` compiles `packages/db` first

## 7. Dependency Change Workflow

Adding, upgrading, or removing a dep needs special handling because CI blocks any PR that commits `pnpm-lock.yaml` (the policy gate in [`.github/workflows/pr.yml:30-37`](.github/workflows/pr.yml) — *"CI owns lockfile updates"*).

The escape hatch: a PR whose head branch is named **exactly** `chore/refresh-lockfile`. The policy gate is keyed on the literal branch name; any other name (e.g. `chore/refresh-lockfile-2`, `chore/lockfile`) is blocked.

### Manual flow (current)

```sh
# 1. Branch off the target base
git checkout -b chore/refresh-lockfile origin/Porting1.1

# 2. Edit the relevant package.json files (root, server/, ui/, packages/*/)
#    Add/remove deps as needed.

# 3. Regenerate the lockfile
pnpm install --no-frozen-lockfile

# 4. Verify it's in sync — should be a no-op
pnpm install --frozen-lockfile

# 5. Commit BOTH manifest changes and pnpm-lock.yaml
git add package.json '**/package.json' pnpm-lock.yaml
git commit -m "chore(deps): <description>"
git push -u origin chore/refresh-lockfile

# 6. Open PR — policy gate's lockfile-block step is skipped via the
#    branch-name exception. CI's "Validate dependency resolution when
#    manifests change" step runs `pnpm install --lockfile-only
#    --no-frozen-lockfile` to confirm internal consistency.

# 7. Squash-merge after review.
```

### Consuming PRs that need new deps

If a feature PR needs a new dep that isn't on the base yet:

1. Land the `chore/refresh-lockfile` PR **first** (so the dep is on the base lockfile).
2. Rebase the feature PR onto the updated base. Manifest hunks become no-ops; the lockfile rebase WILL conflict — resolve by keeping the base's version:

```sh
git rebase origin/<base>
git checkout --theirs pnpm-lock.yaml package.json '**/package.json'
git add pnpm-lock.yaml package.json '**/package.json'
git rebase --continue
```

The feature PR's verify uses `--frozen-lockfile`; deps are now on the base, so the lockfile is in sync.

### Caveats

- **Single-use branch name.** `chore/refresh-lockfile` is the literal exception token. Only one such branch can be open at a time. If two contributors need to update the lockfile simultaneously, coordinate via Slack.
- **Don't rename the branch after merge** until the post-merge CI passes — GitHub auto-deletes the remote branch on squash-merge with `--delete-branch`.

### Automation: `refresh-lockfile.yml` bot

[`.github/workflows/refresh-lockfile.yml`](.github/workflows/refresh-lockfile.yml) watches `Porting1.1` for manifest changes, regenerates the lockfile in CI, opens (or updates) a `chore/refresh-lockfile` PR automatically, and auto-merges via squash.

**For most contributors this means:** open your feature PR with the manifest change committed (no lockfile). Once you merge, the bot fires, regenerates the lockfile on a separate PR, and auto-merges that PR. The next contributor's feature PR rebases off the new base with the updated lockfile already in place.

**The manual flow above** is still useful when:
- You need to verify the regenerated lockfile locally before pushing.
- You want to ship the manifest + lockfile in one commit (the bot adds a separate commit).
- The bot is broken and you need to bypass it.

### Inline lockfile updates (added 2026-05-05)

The policy gate's `Block manual lockfile edits` step now allows `pnpm-lock.yaml`
commits when **package manifests also changed in the same PR**. The check matches
this regex against the PR diff: `(^|/)package\.json$|^pnpm-workspace\.yaml$|^\.npmrc$|^pnpmfile\.(cjs|js|mjs)$`.

This means you can ship a single PR that adds a dependency:

1. Edit `package.json` (root or workspace) to add the new dep.
2. Run `pnpm install --no-frozen-lockfile` to update `pnpm-lock.yaml`.
3. Commit BOTH files together in any branch.

The gate accepts the lockfile because it's accompanied by manifest changes.
Stealth lockfile-only commits (no manifest change) are still blocked.

The recommended path is still the `chore/refresh-lockfile` bot — it auto-merges
and keeps the lockfile fresh after manifest edits land. Use the inline path
when:
- You're adding a new dep and want the manifest + lockfile in a single
  reviewable commit.
- The bot is broken or has an open chore PR you don't want to interfere with.

The gate's logic is at `.github/workflows/pr.yml` (`Block manual lockfile edits`
step in the `policy` job).

## 8. Verification Before Hand-off

Run this full check before claiming done:

```sh
pnpm -r typecheck
pnpm test:run
pnpm build
```

If anything cannot be run, explicitly report what was not run and why.

## 9. API and Auth Expectations

- Base path: `/api`
- Board access is treated as full-control operator context
- Agent access uses bearer API keys (`agent_api_keys`), hashed at rest
- Agent keys must not access other companies

When adding endpoints:
- Apply company access checks
- Enforce actor permissions (board vs agent)
- Write activity log entries for mutations
- Return consistent HTTP errors (`400/401/403/404/409/422/500`)

## 10. UI Expectations

- Keep routes and nav aligned with available API surface
- Use company selection context for company-scoped pages
- Surface failures clearly; do not silently ignore API errors

## 11. Definition of Done

A change is done when all are true:

1. Behavior matches `CLAUDE.md` and relevant V2.5 spec docs
2. Typecheck, tests, and build pass
3. Contracts are synced across db/shared/server/ui
4. Docs updated when behavior or commands change
