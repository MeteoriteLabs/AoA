# E2 — Tenant Kernel — Epic Decisions

Chronological, epic-scoped decisions for E2 (TEN-001…TEN-006). Each entry states
context, decision, alternatives, consequences, and affected tickets. Product-wide
decisions are promoted to `docs/architecture/decisions.md` and linked here.

Status legend: `proposed` (planner-authored, awaiting lock) · `locked`
(ratified by the named owner role) · `superseded`.

---

## E2-D01 — RLS/role/GRANT/FORCE DDL is C14 hand-appended raw SQL in a `db:generate`d migration

**Date (UTC):** 2026-08-09
**Status:** `locked` 2026-08-09 (operator = Migration + Security Gate Owner). **Promoted to `docs/architecture/decisions.md` #122.** Resolves finding E2-F001; TEN-002 now unblocked on this axis.
**Owner role:** Migration Custodian / Security Gate Owner
**Affected tickets:** TEN-001, TEN-002, TEN-004, TEN-006

### Context

Rule #1 (CLAUDE.md) / Decision #19 / AGENTS.md §6 require all schema DDL to be
`pnpm db:generate` output; the **C14 narrow exception** permits *only* hand-appended
idempotency guards and data backfills (exemplars `0189`, `0195`). E2 must emit DDL
that `drizzle-kit generate` **provably cannot** produce (verified against the pinned
`drizzle-orm@0.45.2` / `drizzle-kit@0.31.10`):

- `FORCE ROW LEVEL SECURITY` — the string is absent from the entire generator bundle; it is not even introspected.
- `GRANT` / `REVOKE` — no emission path exists.
- `CREATE ROLE … LOGIN PASSWORD` — kit emits at most `CREATE ROLE "x" [WITH CREATEDB CREATEROLE NOINHERIT]`, and only when `entities.roles` is configured (it is not); no `LOGIN`/`PASSWORD` ever.

`ENABLE ROW LEVEL SECURITY` and `CREATE POLICY` are emittable by drizzle-kit **only** when
`pgPolicy`/`.enableRLS()` is declared in schema (and role generation only when `entities.roles`
is configured). This repo's `drizzle.config.ts` sets **neither**, and E2 declares no `pgPolicy`
in schema, so for the new-path tables drizzle-kit 0.31.10 emits **none** of ENABLE / POLICY /
FORCE / GRANT / ROLE — the entire block is C14 hand-authored. (This resolves the apparent
contradiction with `rls-bootstrap.ts:34-36`, which likewise states these are DDL drizzle-kit
"does not emit" under the shipped config.)

The shipped `company_secrets` RLS canary (`server/src/db/rls-bootstrap.ts`) proves the
exact DDL works, but it lives in an idempotent **runtime bootstrap** (`sql.unsafe`) that
has **zero runtime callers** and is deliberately un-`FORCE`d/inert.

### Decision

New-path tenant **tables, columns, indexes, and composite FKs/uniques** are authored in
`packages/db/src/schema/*.ts` and emitted by `pnpm db:generate` (Rule #1, unchanged).

The **RLS enforcement DDL** — non-owner `CREATE ROLE … NOLOGIN NOSUPERUSER NOBYPASSRLS
NOCREATEDB NOCREATEROLE`, `GRANT`, `ENABLE` + **`FORCE ROW LEVEL SECURITY`**, and
`CREATE POLICY` (USING/WITH CHECK on `current_setting('aoa.organization_id', true)::uuid`) — is
**hand-authored idempotent raw SQL in a drizzle `--custom` (delta-free) migration** created by
`cd packages/db && pnpm exec drizzle-kit generate --custom --name=tenant_rls_enforcement`
(drizzle-kit's mechanism for an empty, journaled migration stub — there is **no schema delta**
to generate onto, so the normal `db:generate` diff would emit an empty/"nothing to migrate"
file). The SQL uses the `0195` guard idioms (`DO $$ BEGIN … EXCEPTION WHEN duplicate_object THEN
NULL; WHEN duplicate_table THEN NULL; END $$;`, `DROP … IF EXISTS`, `IF NOT EXISTS`), separated
by `--> statement-breakpoint`, and is applied through the standard `applyPendingMigrations` path
(uniform in tests, dev, and runtime). This **extends the C14 exception** to also cover
*idempotent RLS/role/GRANT/FORCE security DDL that drizzle-kit cannot emit under the shipped
config*.

**FORCE semantics (corrected):** the DB-enforcement guarantee is that the serving pool
authenticates as **`aoa_app` (non-owner, NOSUPERUSER, NOBYPASSRLS)** — plain RLS filters it.
`FORCE ROW LEVEL SECURITY` removes only a **non-superuser table owner's** exemption; superusers
and `BYPASSRLS` roles always bypass RLS regardless of FORCE. FORCE is therefore defense-in-depth
against a non-superuser-owner serving mistake, proved via `pg_class.relforcerowsecurity = true`
plus a dedicated non-superuser-owner behavioral test — **not** by filtering the embedded-PG
superuser owner (see finding E2-F004). Provisioning must never grant SUPERUSER/BYPASSRLS/CREATEDB
to `aoa_app`.

Role credentials never enter git: the migration creates the role **`NOLOGIN`**; a small
privileged provisioning step (`ALTER ROLE … LOGIN PASSWORD <from env/secret>`) sets the login
credential at deploy/boot time (see E2-D03). Role names are validated with the existing
`assertSafeRoleName` (`/^[A-Za-z_][A-Za-z0-9_]*$/`) since roles cannot be bound as parameters.

### Alternatives considered

- **Runtime idempotent bootstrap (extend `rls-bootstrap.ts`)** for all RLS DDL, migration only for tables. Rejected as the *primary* mechanism: it requires wiring a boot step that must run after migrations on every replica, is not versioned/ordered in the migration ledger, and duplicates the apply path. (A minimal privileged step is still used for the role *password* only — see above — because a password must not be committed.)
- **Enable drizzle-kit role generation (`entities.roles`) + `pgPolicy`/`pgRole` in schema.** Rejected: still cannot emit `FORCE`, `GRANT`, or `LOGIN PASSWORD`; would fracture enforcement and change global `drizzle.config` behavior for the whole repo.

### Consequences

- **Compatibility:** additive; the C14 doc language (Rule #1, Decision #19, AGENTS §6) must be amended to name RLS/role/GRANT/FORCE as an allowed hand-append class. Promote to `docs/architecture/decisions.md`.
- **Migration:** applied by the standard advisory-locked `applyPendingMigrations`; DO $$ blocks are single statements under `splitMigrationStatements` (splits only on `--> statement-breakpoint`).
- **Testing:** the migration is exercised by real embedded-Postgres integration tests (TEN-002/004/005) proving idempotent re-apply and forced cross-tenant denial.
- **Security:** `FORCE` closes the owner-bypass hole the canary left open; no secret in git.

### Promotion

Promote to `docs/architecture/decisions.md` as the C14 amendment upon lock. Until then, epic-local and **blocking for TEN-002** per E2-F001.

---

## E2-D02 — Tenant GUC is `aoa.organization_id`

**Date (UTC):** 2026-08-09
**Status:** `proposed`
**Owner role:** Migration Custodian
**Affected tickets:** TEN-002, TEN-003, TEN-005

### Context

The program-design TEN text specifies "one mandatory Organization context" but names **no**
session-variable. The shipped canary already standardizes on the transaction-local GUC
**`aoa.organization_id`** (`with-tenant-tx.ts:28` writes it; the canary policy reads it).

### Decision

All E2 RLS policies and the TEN-003 transaction wrapper use the existing
`current_setting('aoa.organization_id', true)::uuid` GUC, written transaction-local
(`set_config('aoa.organization_id', $org, true)`), parameter-bound. No new GUC name is
introduced; E2 generalizes the existing one.

### Alternatives considered

- Introduce a distinct GUC (e.g. `aoa.tenant`). Rejected: needless divergence from the shipped canary; would leave two GUCs to keep in sync.

### Consequences

Policies on the new-path tables read the same setting `withTenantTx` writes, so the TEN-003
wrapper transparently governs both the canary and the new tables. Epic-local.

### Promotion

`epic-local`.

---

## E2-D03 — "All application queries run as a non-owner role" reconciled with CAV-005

**Date (UTC):** 2026-08-09
**Status:** `locked` 2026-08-09 (operator confirmed the whole-app non-owner role, flag-gated dormant-but-tested). Resolves finding E2-F002.
**Owner role:** Migration Custodian / Security Gate Owner
**Affected tickets:** TEN-002, TEN-003

### Context

TEN-002 outcome: "**Run application queries with a non-owner role** and force RLS on
new-path tenant tables"; acceptance: "owner/superuser credentials are absent from the
application container; migrations use a separate role." The E2 exit gate says "no
application path uses an owner/superuser role." CAV-005 simultaneously forbids retrofitting
the ~129 legacy `companyId` tables to RLS. Today the whole app connects via one
owner/superuser pool (`createDb`, `client.ts:46`) and auto-applies migrations at boot
(`index.ts:246/262`); `assertCompanyAccess` (556 call sites) is the live legacy boundary.

### Decision

The two clauses are reconciled as: **one non-owner application role** used by the serving
process for **all** queries, where —

- **Legacy `companyId` tables** are `GRANT`ed full DML to the non-owner role and carry **no RLS** (behavior-identical to today; CAV-005 preserved — legacy stays on its `assertCompanyAccess` app-layer boundary, *not* retrofitted).
- **New-path tenant tables** carry `ENABLE` + `FORCE ROW LEVEL SECURITY` + org policies (DB-enforced).
- **Migrations and all runtime DDL** (the role-password provisioning of E2-D01, `applyPendingMigrations`, `ensurePostgresDatabase`) run under a **separate privileged role** in a boot-time privileged phase that completes *before* the non-owner serving pool opens — so the serving path holds no owner/superuser authority. In cloud topology this privileged phase is a separate migration step (aligns with the E6/D1 container boundaries); in dev/embedded-PG/`local_trusted` it is a bounded privileged boot phase.
- The whole-app non-owner **serving connection** is introduced behind the FND-005 distributed-execution disable flag (dormant-by-default strangler): the new-path repositories always use the non-owner pool + forced RLS (harmless — legacy code never touches the new tables), while flipping the *entire legacy surface* onto the non-owner role is gated so E2 does not destabilize the live product. Dormant code is still fully tested (FND-005 rule).

**Net E2 deliverable:** the non-owner role, forced RLS on new-path tables, the non-owner
pool used by new-path repositories, migration-role separation, and the adversarial proof —
all real and complete for the DB-enforced distributed path. Full legacy-surface cutover to
the non-owner role rides the same role behind the flag.

**Fail-closed pool (finding E2-F007):** `createTenantAppDb` **throws** on a missing/blank
`AOA_APP_DATABASE_URL` and **never** falls back to `createDb` (the owner pool); a silent
fallback would run new-path queries as a superuser that bypasses RLS entirely — a total H-01
fail-open. Boot asserts the non-owner pool's role reports `NOT rolsuper AND NOT rolbypassrls`.

**Flag-OFF is not "owner creds absent" (finding E2-F002/review R-05):** the flag-OFF default
still serves legacy on the owner pool and migrates as owner in dev/embedded — it does **not**
satisfy TEN-002's unqualified "owner/superuser credentials are absent from the application
container". That acceptance clause + the corresponding gate evidence are certified only in the
**flag-ON** configuration (dormant-but-tested per FND-005); flag-OFF is an explicitly labeled
interim. The E2 gate runs its no-owner-serving assertion in the flag-ON config. This clause is
**not** H-05 (H-05 is the worker/host boundary, `test-gates.md:29`); it is a TEN-002 acceptance
criterion.

### Alternatives considered

- **Bounded (new-path pool only; owner retained for legacy + migrations).** Rejected as the stated deliverable because it literally violates "Run application queries with a non-owner role" (unqualified) and leaves owner creds in the serving container. Kept only as the fallback if the operator wants to minimize blast radius in E2.
- **Full immediate whole-app cutover, flag-off.** Rejected for E2: relocating every legacy query + all boot DDL off owner in one un-flagged step is high blast-radius across all deployment modes and risks the legacy product; the strangler flag is the FND-005-sanctioned safe merge.

### Consequences

- **Migration/ops:** introduces a privileged-vs-non-owner role split and relocates migration-apply out of the serving role; a new `AOA_APP_DB_*` (non-owner) connection config + the privileged migration credential.
- **Testing:** integration tests connect explicitly as the non-owner role (canary precedent, `rls-canary.integration.test.ts:116` cred-swap) to prove forced denial; a boot-sequence test proves the serving pool never holds owner authority when the flag is on.
- **Risk:** boot-sequence change touches all deployment modes — mitigated by the disable flag and explicit tests. **Flagged to operator for scope confirmation.**

### Promotion

`epic-local`; promote the role-split contract to `docs/architecture/decisions.md` if the operator confirms the whole-app cutover in E2.

---

## E2-D04 — TEN-005 adversarial-suite surface scope at E2 vs. the D1 floor

**Date (UTC):** 2026-08-09
**Status:** `proposed`
**Owner role:** Integration Gate Owner
**Affected tickets:** TEN-005

### Context

TEN-005 acceptance names cross-tenant attempts "through repositories, HTTP endpoints,
worker events, WebSockets, and object keys," and the E2 README asks for hostile
identifiers "at the D1 floor." But worker events, WebSockets, placement, object storage,
and restored data are built by **later** epics (E3/E4/E5/E6); the full D1 tenant property
suite (`D1-01`: 20 seeds × 10,000 ops × ≥10 Organizations, `test-gates.md`) runs at the
**D1 gate** (E6-D1-FOUNDATION+), and the D1 hard-invariant preamble explicitly "does not
imply behavior whose owning tickets have not landed."

### Decision

At E2, TEN-005 is a **seed-reproducible, surface-parametrized** property suite exercising
the surfaces that **exist at E2**: (1) the tenant repositories via the non-owner pool +
TEN-003 wrapper; (2) any HTTP endpoint that reads/writes a new-path table; (3) composite-
constraint direct-SQL bypass attempts (TEN-004); (4) the object-key **format/derivation**
where a scheme is already defined. Every operation must **fail closed without disclosing
existence**, and failures are audited where a sink exists.

**Uniform denial (review R1-05):** "no existence disclosure" is only assertable if there is a
single boundary mapping the structurally-distinct raw errors — composite-FK violation, RLS
`WITH CHECK` violation, and ordinary not-found — into **one identical denial shape**. The
tenant repository (§1) is that normalization point; TEN-005 asserts the denial/error shape is
**identical** across a cross-tenant read, a cross-tenant write, and a truly-absent row (not
merely "not the row").

**Platform null-Org rows (review R1-03):** TEN-005 additionally asserts that no tenant GUC ever
returns a null-Organization `platform` worker row, and that `aoa_app` cannot INSERT/UPDATE a row
to `organization_id IS NULL`. Operator reads of platform rows use a distinct operator role /
dedicated policy (never a tenant GUC), established before details are returned (program-design
§Security invariants).

The suite is authored so later epics register their new surfaces (worker events, WebSockets,
object commit, placement, restore) into the same harness; the **full D1-floor cross-surface run
is owned by the D1 gate**, not E2. The E2 gate records this surface scope explicitly (no silent
cap); at E2 the sentinel/unmapped admission denial is a unit/harness proof (end-to-end at E3).

### Alternatives considered

- Attempt the full D1 floor at E2. Rejected: the surfaces do not exist yet; it would either be vacuous or fabricate them.

### Consequences

E2's H-01 proof is complete for the E2-available surfaces (a HARD, non-waivable subset);
the suite is designed to extend. Recorded in the E2 gate QA record and the E6-D1 handoff
inherits it.

### Promotion

`epic-local`.

---

## E2-D05 — E2 gate is Windows-local + ≥1 real Linux run for H-01 (DEC-03); RLS/tenant tests use the AOA_RUN_WIN_INTEGRATION env-hatch + a Windows-visible unit sibling

**Date (UTC):** 2026-08-09
**Status:** `locked` 2026-08-09 (operator: require ≥1 real Linux run for the H-01 suites, in addition to Windows-local). Resolves finding E2-F008 (pending the Linux run at gate time).
**Owner role:** Integration Gate Owner
**Affected tickets:** all E2 tickets + E2 gate

### Context

Per DEC-03, Linux CI (`pr.yml`) is the **formal** authority, but `pr.yml` runs only on PRs
and pushes to `main`; the program commits directly to `docs/replatform-program` (neither),
so CI does not auto-run — exactly as for the E0/E1 gates, which ran **Windows-local per
operator directive** and labeled evidence honestly. All shipped RLS/tenant/MT integration
tests are **Pattern A** (`describe.skipIf(process.platform !== "linux")`, no env hatch);
`AOA_RUN_WIN_INTEGRATION` does **not** control them.

### Decision

E2's new integration suites use the **`AOA_RUN_WIN_INTEGRATION` env-hatch** gate —
`describe.skipIf(process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1")`
— booting embedded-Postgres in `beforeAll` **with `initdbFlags: ["--encoding=UTF8","--locale=C"]`**
and re-throwing a captured `setupError` in the first `it`. This is a `skipIf` (satisfies
`integration-test-hygiene.test.ts`, which bans only the `X ? describe : describe.skip` ternary),
it **runs automatically on Linux CI** (`process.platform !== "win32"` → not skipped), and it is
**Windows-runnable in place** via `AOA_RUN_WIN_INTEGRATION=1` — **no source edit-and-restore
dance** (unlike the shipped MT Pattern-A Linux-only suites). Cross-platform slices (role-name /
GUC / policy-SQL construction, repository export surface) go in Windows-visible `*-unit.test.ts`
siblings (precedent `rls-canary-unit.test.ts`).

Because H-01 is **non-waivable**, the E2 gate does not rest it on Windows-only console output: it
runs the tenant/company-writer suites Windows-local **and** obtains **at least one real Linux
execution** (a `workflow_dispatch` on `pr.yml` or a scratch PR to a throwaway branch) pinned as
the formal H-01 evidence. Everything else follows the E0/E1 precedent: gate run by an independent
gate-owner subagent, labeled `operator-directed (DEC-03: Linux CI = formal authority)`.

### Alternatives considered

- Copy the shipped MT **Pattern-A** (Linux-only `skipIf(process.platform !== "linux")`, run on Windows via a transient `skipIf(false)` + `initdbFlags` edit). Rejected: the env-hatch is strictly better — Windows-runnable **without** a source edit-and-restore, still Linux-CI-runnable, and it is **not** a hygiene violation: `integration-test-hygiene.test.ts` bans only the `X ? describe : describe.skip` ternary, and 18 shipped files already use the env-hatch `skipIf(...)` form (review R#-09).
- Rest H-01 on Windows-local evidence alone. Rejected: H-01 is non-waivable; a company-insert site missed in a Linux-only path would pass a Windows-only gate silently (review R#-05) — hence the mandatory real Linux run.

### Consequences

Local evidence is honestly labeled; a Windows-visible unit lane keeps cross-platform
coverage in the always-on gate. Mirrors E0/E1. Epic-local.

### Promotion

`epic-local`.

---

## E2-D06 — New-path tenant table inventory for E2

**Date (UTC):** 2026-08-09
**Status:** `proposed`
**Owner role:** Migration Custodian
**Affected tickets:** TEN-001, TEN-004

### Context

TEN-001 creates "normalized Organization-owned job/worker/service tables"; TEN-004 adds
composite integrity for "job/company/run, worker/Organization, artifact/job, service/
company, secret-handle ownership." The rich job/worker/artifact/secret/workspace logic is
owned by E3/E4/E5. No distributed-execution tables exist yet (verified).

### Decision

E2 (TEN-001) creates the following **minimal Organization-owned kernel tables** — enough to
establish tenant ownership, the identity chain, and the composite-integrity surface, with
rich columns deferred to E3/E4/E5 (additive, non-breaking):

`jobs`, `job_attempts`, `leases`, `workers`, `services`, `service_instances`, and the
minimal ownership skeletons `job_artifacts` and `job_secret_handles` (id + org/company/job
ownership + identifier, so TEN-004 can constrain artifact/job and secret-handle ownership).

Each carries `organization_id NOT NULL` (no sentinel default) and `company_id` where the row
is Company-scoped; `workers`/platform rows follow the `platform | organization | owner`
scope model (platform rows have null Organization — TEN-004/TEN-002 policies treat null-Org
platform rows as operator-only, never tenant-visible). TEN-004 then adds composite
`(organization_id, company_id)` FKs + the job↔attempt↔lease and service↔instance chains.

### Alternatives considered

- Defer `job_artifacts`/`job_secret_handles` to E5. Rejected: TEN-004 must prove artifact/job + secret-handle composites; minimal ownership skeletons keep E2 faithful and bounded, and E5 extends them additively.

### Consequences

E3/E4/E5 planners inherit these tables + the composite-FK pattern and extend columns.
**TEN-001 splits by default** (review R-10 — 8 modules + repo factory + tests + migration
exceeds the 3-day M bound): **TEN-001a** = `jobs`, `job_attempts`, `leases` + tenant repository
factory + export test; **TEN-001b** = `workers`, `services`, `service_instances`,
`job_artifacts`, `job_secret_handles` + the platform null-Org operator-read policy shape.

**Traceability:** program-design's "job/company/run" composite maps the "run" surface to
`job_attempts` (rich run columns deferred to E3). **Platform null-Org worker rows** are read
operator-only under forced RLS via a distinct operator role / dedicated policy (never a tenant
GUC); rich worker behavior is JOB-002 (E3) — E2 lays only the table + operator-read policy shape
and proves tenants cannot reach null-Org rows (see E2-D04).

### Promotion

`epic-local`.

---

## E2-D07 — Sentinel Organization has a dual identity; TEN-006 removes only fail-open, and splits

**Date (UTC):** 2026-08-09
**Status:** `proposed`
**Owner role:** Migration Custodian
**Affected tickets:** TEN-006 (split into TEN-006a/TEN-006b)

### Context

The value `00000000-0000-0000-0000-000000000001` is **two things at once** (review R-02/R-04/R1-02,
verified against disk):

1. The **forbidden distributed-admission sentinel** — `docs/architecture/distributed-execution-legacy-parity.json:15-19`
   (`forbiddenOrganizationSentinels`; "JOB-010 rejects sentinel/unmapped Organization admission
   before persistence"). This IS present in FND-007 (an earlier review draft wrongly claimed it
   absent — re-verified).
2. The **legitimate single-tenant Default Organization** — `organizations.ts` slug `default`,
   `ensureDefaultOrganization` (`services/organizations.ts:101,108`), and
   `routes/companies.ts:47-61` deliberately resolves it for the **self-hosted / isolation-not-enforced**
   path (the default product deployment; the client sends no `organizationId`).

The plan's original "any company on the sentinel = unresolved blocker" + "remove the `:61`
fallback" would **brick or false-block every self-hosted install**. Separately, dropping the
`companies.organization_id` schema default breaks **~70** company-insert sites that omit
`organization_id` inline (`grep "INSERT INTO companies"` ≈ 106 hits; 13 `.insert(companies)` call
sites; plus source-asserting unit tests that pin the fail-open expression) — far larger than the
6-file list the original plan named, and beyond a single 3-day M ticket.

### Decision

TEN-006 removes **only the fail-OPEN mechanisms**: the `companies.organization_id` **schema
default** and every **silent** `?? DEFAULT_ORGANIZATION_ID` bucketing — so an Organization-omitting
writer **fails closed**. It **preserves** the explicit self-hosted Default-Org resolution
(`resolveCompanyOrganizationId` non-enforced branch, now explicit rather than silent). The
**"sentinel = blocker"** rule is scoped to **distributed/new-path admission** (the FND-007 deny-list
at submit/place/lease), **not** legacy company existence. At E2 the migration backfill is a
**no-op scaffold** (`ALTER COLUMN … DROP DEFAULT`; in the beta every company legitimately sits on
the Default Org and no real target orgs exist to remap to) — program-design's "mapped **or** blocks
rollout" is satisfied by the **blocks-rollout arm**; a real company→org backfill activates only when
a mapping source is provisioned in a later epic.

TEN-006 **splits** (finding E2-F006): **TEN-006a** = exhaustive Company-writer sweep (derived from
a fresh `rg` at execution, not stale line numbers) + fail-closed writers + a shared explicit-org
test factory `insertTestCompany({…, organizationId})`; **TEN-006b** = drop the schema default
(normal `db:generate` delta — it IS a schema change) + the sentinel/unmapped admission-denial
helper (consumes `forbiddenOrganizationSentinels`) + tests.

### Alternatives considered

- Treat all sentinel rows uniformly as blockers. Rejected: false-blocks/bricks self-hosted (R-02).
- Keep TEN-006 as one M ticket. Rejected: the ~70-site sweep exceeds three agent-days (R#-03); the
  3-day exemption does not apply to TEN-006.

### Consequences

TEN-006a is assignable now; TEN-006b lands the reconciliation. Rollback preserves explicit mapping
and never restores the fail-open default. The admission-denial helper is dormant until JOB-001/JOB-010
(E3) wire it end-to-end; at E2 only "cannot own objects" (via `organization_id NOT NULL` on new-path
tables) is runtime-enforced, plus the helper's unit proof.

### Promotion

`epic-local`.
