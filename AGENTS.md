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

## 7. Verification Before Hand-off

Run this full check before claiming done:

```sh
pnpm -r typecheck
pnpm test:run
pnpm build
```

If anything cannot be run, explicitly report what was not run and why.

## 8. API and Auth Expectations

- Base path: `/api`
- Board access is treated as full-control operator context
- Agent access uses bearer API keys (`agent_api_keys`), hashed at rest
- Agent keys must not access other companies

When adding endpoints:
- Apply company access checks
- Enforce actor permissions (board vs agent)
- Write activity log entries for mutations
- Return consistent HTTP errors (`400/401/403/404/409/422/500`)

## 9. UI Expectations

- Keep routes and nav aligned with available API surface
- Use company selection context for company-scoped pages
- Surface failures clearly; do not silently ignore API errors

## 10. Definition of Done

A change is done when all are true:

1. Behavior matches `CLAUDE.md` and relevant V2.5 spec docs
2. Typecheck, tests, and build pass
3. Contracts are synced across db/shared/server/ui
4. Docs updated when behavior or commands change
