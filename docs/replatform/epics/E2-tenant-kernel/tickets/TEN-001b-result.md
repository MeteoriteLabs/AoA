# TEN-001b Result — New-path tenant schema (workers/services/service_instances/job_artifacts/job_secret_handles) + repository extension

**Status:** `gate_review`
**Date (UTC):** `2026-08-09`
**Epic:** `E2-tenant-kernel`
**Plan task:** `TEN-001 — New-path tenant schema and repository boundary (TEN-001b default split, E2-D06)`
**Implementer:** `claude-opus (implementer subagent)`
**Start SHA:** 629439c71f452202fd8541077b6dd856fa756d96

The Start SHA is the actual `git rev-parse HEAD` of the C:\e2 worktree captured
before the first change (`629439c71` — "docs(e2): TEN-001a reviewed + approved
(complete)"). The plan §0 table lists `df509b946` as the "E2 Start SHA"; that
commit is an ancestor of this HEAD (`git merge-base --is-ancestor df509b946 HEAD`
= true). Per the ticket directive ("run `git rev-parse HEAD` BEFORE your first
change"), the actual current HEAD is recorded here — mirroring the TEN-001a
convention.

## Delivered scope

- Five new-path tenant kernel schema modules under `packages/db/src/schema/`
  (house style; one table per file; `id: uuid().primaryKey().defaultRandom()`;
  timestamps `withTimezone:true` + `.defaultNow().notNull()`; `text` + `check`
  status, **no** `pgEnum`; `.js` local imports):
  - `workers.ts` — `scope` text NOT NULL + check `('platform','organization','owner')`;
    `organization_id` uuid **NULLABLE** (FK → `organizations.id` `onDelete:"restrict"`;
    NULL only for `platform`); `owner_user_id` uuid NULLABLE (**no FK** — reserved
    for JOB-002 owner binding); `label` text NOT NULL; `status` text NOT NULL
    default `'enrolled'` + check `('enrolled','active','draining','revoked')`;
    timestamps. **`workers_scope_org_check`** =
    `(scope='platform' AND organization_id IS NULL) OR (scope IN ('organization','owner') AND organization_id IS NOT NULL)`.
    Index `(organization_id)`.
  - `services.ts` — `organization_id` uuid **NOT NULL, no default** (FK → orgs
    restrict); `company_id` uuid NOT NULL (FK → `companies.id` restrict);
    `desired_state` text NOT NULL default `'running'` + check
    `('running','stopped','deleted')`; `generation` integer NOT NULL default 1;
    timestamps. Indexes `(organization_id)`, `(organization_id, company_id)`.
  - `service_instances.ts` — `organization_id` denorm uuid NOT NULL (FK → orgs
    restrict); `service_id` uuid NOT NULL (FK → `services.id`
    `onDelete:"cascade"`); `generation` integer NOT NULL default 1; `status` text
    NOT NULL default `'pending'` + check
    `('pending','healthy','stopped','lost','interrupted')`; timestamps. Indexes
    `(organization_id)`, `(service_id)`.
  - `job_artifacts.ts` — `organization_id` denorm uuid NOT NULL (FK → orgs
    restrict); `job_id` uuid NOT NULL (FK → `jobs.id` `onDelete:"cascade"`);
    `identifier` text NOT NULL; timestamps. Indexes `(organization_id)`, `(job_id)`.
  - `job_secret_handles.ts` — `organization_id` denorm uuid NOT NULL (FK → orgs
    restrict); `job_id` uuid NOT NULL (FK → `jobs.id` `onDelete:"cascade"`);
    `handle` text NOT NULL; timestamps. Indexes `(organization_id)`, `(job_id)`.
- Named barrel re-exports (`workers`/`services`/`serviceInstances`/`jobArtifacts`/
  `jobSecretHandles` + their `$inferSelect`/`$inferInsert` type aliases) in
  `packages/db/src/schema/index.ts`.
- Tenant repository extension `packages/db/src/repositories/tenant/index.ts`:
  `TenantRepositories` gains `workers`/`services`/`serviceInstances`/`jobArtifacts`/
  `jobSecretHandles` accessors (`insert`/`getById`/`listForOrganization|listForCompany|listForService|listForJob`),
  each operating strictly through the passed `tx`. The module's top-level runtime
  export set stays **exactly** `{ tenantRepositories }` (+ erased types); **no**
  new standalone unscoped/raw cross-tenant reader.
- Generated migration `0208_tenant_kernel_services.sql` (+ `meta/0208_snapshot.json`
  + `_journal.json` idx 208) via `drizzle-kit generate --name=tenant_kernel_services`,
  diffed from compiled `dist/schema/*.js`; C14 `IF NOT EXISTS` hand-added to every
  `CREATE TABLE`/`CREATE INDEX` (header comment matching 0207); `ADD CONSTRAINT`
  left plain (0206/0207 convention).
- New integration test `tenant-kernel-schema-b.integration.test.ts` (embedded-PG,
  E2-D05 env-hatch); one added assertion in `tenant-repository-surface.test.ts`
  (factory-shape guard, plain unit, Windows-visible).

**Non-goals preserved:**
- **NO** RLS/role/GRANT/FORCE/policy DDL, non-owner pool, GUC wiring, or the
  platform null-Org operator-read *policy* (TEN-002). This ticket lays only the
  `workers` table + the `workers_scope_org_check` shape and proves (via direct SQL)
  that platform rows are null-Org and tenant-scoped rows are non-null-Org.
- **NO** composite FK (job↔attempt, service↔instance, artifact↔job,
  secret-handle↔job, service↔company↔org, worker↔org) and **NO** partial-unique
  (TEN-004).
- **NO** sentinel default on any new-path `organization_id` (fail-closed).
- No legacy table, `assertCompanyAccess`, `rls-bootstrap.ts`, or `with-tenant-tx.ts`
  touched. No TEN-001a committed file modified except the two sanctioned extension
  points (`schema/index.ts`, `repositories/tenant/index.ts`) and the surface test.

## Changed files

| File | Responsibility |
|---|---|
| `packages/db/src/schema/workers.ts` | New: worker registration identity; `platform\|organization\|owner` scope; `workers_scope_org_check`. |
| `packages/db/src/schema/services.ts` | New: service desired-state row; mandatory org+company identity. |
| `packages/db/src/schema/service_instances.ts` | New: service instance + generation; denorm org, cascade from service. |
| `packages/db/src/schema/job_artifacts.ts` | New: minimal artifact-ownership index (E5 extends). |
| `packages/db/src/schema/job_secret_handles.ts` | New: minimal opaque secret-handle ownership (E5 extends). |
| `packages/db/src/schema/index.ts` | Add named re-exports for the five modules. |
| `packages/db/src/repositories/tenant/index.ts` | Extend `TenantRepositories` + factory with five accessors; top-level export set unchanged. |
| `packages/db/src/migrations/0208_tenant_kernel_services.sql` | New generated migration + C14 `IF NOT EXISTS` guards. |
| `packages/db/src/migrations/meta/0208_snapshot.json` | New drizzle snapshot. |
| `packages/db/src/migrations/meta/_journal.json` | Journal idx 208 appended. |
| `packages/db/src/__tests__/tenant-kernel-schema-b.integration.test.ts` | New: embedded-PG proof (existence, org-col nullability/default, scope/org check). |
| `packages/db/src/__tests__/tenant-repository-surface.test.ts` | Add factory-shape assertion for the five new accessors. |

## Acceptance evidence

| Acceptance condition | Evidence | Result |
|---|---|---|
| All five tables exist after full migration chain | `tenant-kernel-schema-b.integration.test.ts` "creates the five remaining new-path kernel tables" | `pass` |
| `services`/`service_instances`/`job_artifacts`/`job_secret_handles` `organization_id` = NOT NULL, no default (fail-closed, no sentinel) | Four `is_nullable='NO'` + `column_default IS NULL` assertions | `pass` |
| `workers.organization_id` is nullable | "makes workers.organization_id NULLABLE" (`is_nullable='YES'`) | `pass` |
| `workers_scope_org_check` enforces platform⇒null-org, organization⇒non-null-org via direct SQL (real org seeded so FK passes and only the CHECK fires) | Insert `platform`+null org succeeds; `platform`+non-null org rejected `/workers_scope_org_check/`; `organization`+null org rejected `/workers_scope_org_check/` | `pass` |
| Repository top-level export set unchanged (`['tenantRepositories']`) | `tenant-repository-surface.test.ts` assertion 1 | `pass` |
| Factory returns all eight accessor groups w/ `insert`/`getById` | `tenant-repository-surface.test.ts` factory-shape assertion | `pass` |
| Migration 0208 C14-idempotent (every CREATE has IF NOT EXISTS) | `migration-idempotency.test.ts` (5 tests) | `pass` |
| No new hosted-API/runtime dep; no manifest/lock change | `git status` shows no `package.json`/`pnpm-lock.yaml` change | `pass` |
| No E2 file in server typecheck errors (E2-F009 baseline holds) | server typecheck = 66 errors, all `plugin-*`/plugin-sdk; grep for TEN-001b files = none | `pass` |

## Commands

| Command | Exit code | Result summary |
|---|---:|---|
| `pnpm --filter @armyofagents/db typecheck` | `0` | clean (`tsc --noEmit`) |
| `pnpm --filter @armyofagents/db build` | `0` | `tsc && cp -r src/migrations dist/migrations` |
| `pnpm exec drizzle-kit generate --name=tenant_kernel_services` | `0` | emitted `0208_tenant_kernel_services.sql` + snapshot + journal idx 208 |
| `AOA_RUN_WIN_INTEGRATION=1 pnpm exec vitest run src/__tests__/tenant-kernel-schema-b.integration.test.ts` (RED, pre-impl) | `1` | 7 failed (tables absent — `relation "workers" does not exist`) |
| `AOA_RUN_WIN_INTEGRATION=1 pnpm exec vitest run src/__tests__/tenant-kernel-schema-b.integration.test.ts` (GREEN) | `0` | 7 passed |
| `pnpm exec vitest run src/__tests__/tenant-repository-surface.test.ts` | `0` | 3 passed |
| `pnpm exec vitest run src/__tests__/migration-idempotency.test.ts` | `0` | 5 passed |
| `AOA_RUN_WIN_INTEGRATION=1 pnpm exec vitest run src/__tests__/tenant-kernel-schema.integration.test.ts` (TEN-001a sibling regression) | `0` | 4 passed (0208 in chain does not break TEN-001a) |
| `pnpm --filter @armyofagents/server typecheck` | `2` | 66 errors, ALL pre-existing plugin-sdk baseline (E2-F009); zero reference any TEN-001b file |

## Deviations

None. Scope, table shapes, constraints, indexes, migration invocation, and the
C14 guard follow the plan §1/§2 + the TEN-001b directive and E2-D06 exactly.

## Findings

`E2-F009` (pre-existing plugin-sdk absence → server typecheck/build exit 2) observed
and re-confirmed unchanged: 66 errors, all in `plugin-*`/plugin-sdk-dependent files;
zero reference any E2 file. DEC-03-waivable per the finding disposition; not an
epic-touched defect. No new findings.

## Follow-up tickets

None. TEN-004 (composite FKs + partial-unique) and TEN-002 (RLS/policy incl. the
platform null-Org operator-read policy) consume these tables as already-planned
successors, not follow-ups from this ticket.

## Gate recommendation

`ready for independent review` — all focused acceptance passes (RED→GREEN captured),
no non-goal crossed, C14 idempotency + repository export-surface invariants hold,
and the server-typecheck delta is subset-of-baseline (E2-F009).

## Independent review

**Reviewer:** `pending until first independent review, then agent or human identity; must differ from implementer`
**Reviewed revision:** `pending until first independent review, then 40-character git SHA`
**Disposition:** `pending`
**Review evidence:** `pending until first independent review, then review record, exact commands/exit codes, or finding links`

For `approved`, verify the result describes the reviewed revision, all focused acceptance evidence passes, and every accepted finding is resolved; then change the top-level `Status` to `complete` and commit this disposition separately. Otherwise leave `Status` as `gate_review` or set `blocked`, and link stable findings.

## Review attempt history

| Attempt | Reviewer | Reviewed revision | Disposition | Evidence/findings |
|---:|---|---|---|---|
<!-- First independent reviewer appends attempt 1. -->
