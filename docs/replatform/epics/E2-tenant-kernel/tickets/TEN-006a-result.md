# TEN-006a Result — Company-writer sweep (make Organization explicit)

**Status:** `gate_review`
**Date (UTC):** `2026-08-09`
**Epic:** `E2-tenant-kernel`
**Plan task:** `TEN-006a — exhaustive Company-writer sweep + fail-closed writers + shared explicit-org test factory (split of TEN-006 per E2-D07)`
**Implementer:** `claude-opus (implementer subagent)`
**Start SHA:** 8f1da300bfdf81bb2854f866e7081ef53fbb2522

Start SHA is the actual `git rev-parse HEAD` of the C:\e2 worktree captured before
the first change (mirrors the TEN-001a/b/TEN-004 convention).

## Delivered scope

TEN-006a removes only the **fail-OPEN** mechanisms in the Company writers — the
**silent** `?? DEFAULT_ORGANIZATION_ID` / `?? undefined`-then-buckets — so an
Organization-omitting write now **fails closed** (throws). It **preserves** the
explicit self-hosted Default-Org resolution and does **not** touch the schema
default or build the admission-denial helper (both TEN-006b).

### 1. Fail-closed Company writers (production) — `server/src/services/companies.ts`

- New module-level guard `requireResolvedOrganizationId(data)` — throws when
  `data.organizationId` is absent/blank (message: *"Company writer requires an
  explicitly resolved organizationId (TEN-006a)…"*); returns the resolved id
  otherwise. It references **no** sentinel — pure fail-closed.
- Removed all four silent `data.organizationId ?? DEFAULT_ORGANIZATION_ID` sinks
  (fresh `rg`-derived, not stale line numbers):
  - `resolveCompanyCreationReplay` (replay lookup key) → `requireResolvedOrganizationId(data)`.
  - `createCompanyWithUniquePrefix` (operator-free `create`) → resolves once at
    the top, insert uses `organizationId`.
  - `createWithOperator` (atomic create) → resolves once at the top **before any
    read/write**, so both the `pg_advisory_xact_lock` key and the insert use the
    resolved `organizationId`.
- Removed the now-unused `DEFAULT_ORGANIZATION_ID` import (companies.ts references
  it only in comments/the guard message now).
- **Preserved:** atomic checkout, replay idempotency, advisory-lock semantics, and
  `companies.update` still stripping `organizationId` (all untouched).

### 2. Explicit self-hosted resolution preserved — `server/src/routes/companies.ts`

- `resolveCompanyOrganizationId` non-enforced branch **still returns
  `DEFAULT_ORGANIZATION_ID`** — but now documented as an **explicit, caller-side
  Default-Org resolution** (comments updated), not a silent writer default. The
  route already passes a concrete `organizationId: string` to the writer in every
  path (POST `/`, POST `/import` new_company), so production behavior is unchanged.

### 3. Import path — `server/src/services/company-portability.ts`

- The `new_company` `createWithOperator` call passes `opts?.organizationId` through
  (comment corrected: the route resolves + authorizes the Org; a direct non-route
  caller now **fails closed** at the writer instead of silently bucketing). The
  `?? undefined` is retained only to normalize a `null` opts value to `undefined`
  for the writer's `organizationId?: string` field — it is not a fallback.

### 4. Shared explicit-org test factory — `server/src/__tests__/helpers/insert-test-company.ts` (NEW)

- `insertTestCompany(db, { …, organizationId })` ALWAYS writes `organization_id`
  explicitly (defaults to the single-tenant Default Org so a test may pass it
  deliberately, but never relies on the schema default). Returns the inserted row.

### 5. Test-site sweep — every company-insert passes `organization_id` explicitly

Derived from a fresh exhaustive sweep (`rg "DEFAULT_ORGANIZATION_ID"`,
`rg "INSERT INTO companies"`, `rg "\.insert\(companies\)"` across `server`,
`packages`, `cli`, incl. all `__tests__`). Inventory at execution:

- Raw `INSERT INTO companies (…)`: **107** occurrences; **37** already had
  `organization_id`; **70** omitted it (1 was a `packages/db/dist` build artifact —
  excluded; 70 source statements swept).
- Drizzle `.insert(companies)`: 14 hits — 2 are the production writers (§1), 2 are
  comments, 2 already passed `organizationId` (`founder-grants`,
  `org-concurrency-claim` ×3), the prod seed already explicit; leaving 4 Drizzle
  test inserts to convert.
- Mocked-service portability unit tests (15 files) mock
  `createWithOperator` → never reach the real writer → unaffected.

**Swept by mechanism:**

- **Raw-SQL inline (70 statements / 52 files)** — injected `organization_id` as the
  first column + the Default-Org sentinel `'00000000-0000-0000-0000-000000000001'`
  as the first value (paired atomically per statement; behavior-identical to the
  current schema default, FK-valid post-0188). Files:
  `packages/db/src/__tests__/revert-0188.integration.test.ts`;
  `server/src/services/__tests__/mcp-connector-token-refresh.integration.test.ts`;
  and under `server/src/__tests__/`: `add-dependency-race`,
  `agents-list-excludes-platform` (×2), `agents-update-concurrency`,
  `blocked-task-scan`, `broker-internal-registry` (×2), `cheap-fallback-integration`,
  `checkout-race`, `commander-turn-claim`, `comment-wakeup-outbox`,
  `companies-remove-provider-connections`, `companies-scope-pushdown` (×2),
  `crew-marketplace-bootstrap` (×6), `crew-org-scope`, `crew-output-capture`,
  `crew-repair` (×3), `crew-run-log-pointer`, `crew-skill-assignment-e2e`,
  `environments-integration` (×2), `execution-workspaces-unique-integration`,
  `hub-curation`, `hub-items-action`, `hub-items-budget-reconcile`,
  `hub-items-counts`, `hub-items-emit`, `hub-items-query`, `hub-items-sweeper`,
  `hub-source-producers`, `issue-attachment-completion-race`,
  `issues-comment-reassign-atomicity`, `mcp-connector-install`,
  `mcp-connector-oauth`, `mcp-connectors-e2e-delivery` (×2), `mcp-connectors-plan2-e2e`,
  `mcp-memory-read-rbac`, `memory-rbac-leakage`, `memory-tools-agent-rbac`,
  `memory-version-race`, `mention-outbox`, `mt-import-authz`,
  `output-detection-confirm-race`, `plugin-broker-cloud` (×2),
  `provider-connections-backfill`, `provider-readiness-upsert` (×2),
  `provider-switching` (×2), `quota-windows-dedup` (×2), `routine-revisions-integration`,
  `secrets-schema-integration`, `suggestions-dedupe-migration`,
  `teams-null-parent-cascade`, `w6-org-reporting` (×3).
- **Factory-converted Drizzle inserts (4 files)** → `insertTestCompany(db, …)`:
  `ask-founder-dogfood` (dropped now-unused `companies` import),
  `home-board-layout`, `mcp-oauth-operator-cli`, `work-questions`.
- **Service-writer `.create()`/`.createWithOperator()` (15 calls / 9 files)** —
  added explicit `organizationId` to the create input:
  `aoa-bootstrap-wiring` (×5, mock db), `aoa-backend`, `aoa-realoutput`,
  `artifact-add-version-parent`, `broker-tool-context` (×3),
  `commander-skill-triggering`, `companies-delete-integration`,
  `companies-prefix-conflict` (mock db), `crew-marketplace-bootstrap`.
  (`company-create-atomicity` already passed `organizationId: orgId` on all 13 of
  its `createWithOperator` calls — verified, left unchanged.)
- **`importBundle` opts (2 direct non-route callers)** — added
  `{ organizationId }` opts so a direct self-hosted `new_company` import resolves
  the Default Org explicitly (previously leaned on the removed writer fallback):
  `w6-org-reporting` (self-hosted import), `mt-import-authz` (H3 self-hosted). The
  `mt-import-authz` H3-threaded-org call already passed `{ organizationId: orgId }`.

### 6. Source-asserting tests re-pointed to the explicit contract

- `company-service-org-scope.test.ts` — **INVERTED**: was pinning the fail-open
  `organizationId: data.organizationId ?? DEFAULT_ORGANIZATION_ID`; now asserts
  that expression is **absent** and the fail-closed `requireResolvedOrganizationId`
  guard is present.
- `companies-create-org-default.test.ts` — reworded to the explicit-resolution
  contract; asserts the route still resolves via `resolveCompanyOrganizationId`
  (assertions preserved — route behavior unchanged).
- `cloud-auth-cutover.test.ts` — reworded ("falls back" → "explicitly resolves");
  the `resolveCompanyOrganizationId({}) === DEFAULT_ORGANIZATION_ID` assertion is
  the PRESERVED behavior, unchanged.
- `companies-org-scope.test.ts` (line ~201) — reviewed: it pins the **route's**
  explicit self-hosted `DEFAULT_ORGANIZATION_ID` stamping (preserved), not the
  service fail-open, so it passes unchanged and was left as-is.

**Non-goals preserved (TEN-006b, untouched):**
- NO `packages/db/src/schema/companies.ts` change — the `organization_id`
  `.default(...)` schema default is intact (verified `git status`: no schema/
  migration/`.sql` change).
- NO migration; NO admission-denial helper; `DEFAULT_ORGANIZATION_ID` and
  `ensureDefaultOrganization` retained.
- `assertCompanyAccess`, `rls-bootstrap.ts`, `with-tenant-tx.ts`, new-path tenant
  tables not touched. No `package.json`/`pnpm-lock.yaml` change.

## Changed files

3 production + 2 new helper/test + 67 test files = **72** files (+ this result doc).

| File | Responsibility |
|---|---|
| `server/src/services/companies.ts` | **Fail-closed writers.** Add `requireResolvedOrganizationId` guard; remove 4 silent `?? DEFAULT_ORGANIZATION_ID` sinks; drop unused import. |
| `server/src/routes/companies.ts` | Comments: non-enforced branch reframed as EXPLICIT Default-Org resolution (behavior unchanged). |
| `server/src/services/company-portability.ts` | Comment: import path fails closed at the writer, no silent bucketing (behavior unchanged). |
| `server/src/__tests__/helpers/insert-test-company.ts` | **NEW** shared `insertTestCompany` factory (always-explicit `organization_id`). |
| `server/src/__tests__/company-writer-fail-closed.test.ts` | **NEW** RED→GREEN behavioral proof: writers throw on an unresolved Organization. |
| `server/src/__tests__/company-service-org-scope.test.ts` | Source-asserting test **inverted** to the fail-closed contract. |
| `server/src/__tests__/companies-create-org-default.test.ts` | Reworded to explicit-resolution contract. |
| `server/src/__tests__/cloud-auth-cutover.test.ts` | Reworded to explicit-resolution (assertion preserved). |
| 64 test files | Test-site sweep (raw-SQL inline / factory / service-create / importBundle opts) — full list in §5. |

## Acceptance evidence

| Acceptance condition | Evidence | Result |
|---|---|---|
| A Company writer reached with no resolvable Organization fails CLOSED (throws), not silent-buckets | `company-writer-fail-closed.test.ts`: `create()` + `createWithOperator()` reject `/explicitly resolved organizationId/` | `pass` (RED→GREEN) |
| Explicit resolution still works (explicit org + Default Org both accepted) | same test, cases 2–3 (org-explicit + `DEFAULT_ORGANIZATION_ID`) | `pass` |
| No silent `?? DEFAULT_ORGANIZATION_ID` remains in the service | `company-service-org-scope.test.ts` (inverted): expression absent, guard present | `pass` |
| Self-hosted route resolution preserved (returns Default Org explicitly) | `companies-org-scope.test.ts` (self-hosted stamps `DEFAULT_ORGANIZATION_ID`), `cloud-auth-cutover` assertion | `pass` (org-scope), baseline-blocked (cutover, see Findings) |
| Raw-SQL sweep parses + FK-valid against real PG | `teams-null-parent-cascade.integration.test.ts` (swept raw insert) GREEN on embedded PG | `pass` |
| Factory works against real PG | `ask-founder-dogfood.integration.test.ts` (`insertTestCompany`) GREEN on embedded PG | `pass` |
| No schema/migration change (TEN-006b boundary) | `git status`: no `schema/` `migrations/` `.sql`; `packages/db` typecheck `0` | `pass` |
| No new error references an E2-changed file (E2-F009 baseline holds) | `server typecheck` 66 errors, all plugin-subsystem; grep of changed files = none | `pass` |

**Structural verification of the raw-SQL sweep:** 70 added `INSERT INTO companies
(organization_id, …` lines; 70 added `VALUES ('00000000-…0001', …` value prefixes;
0 removed sentinel literals; 0 transformed INSERTs left without `organization_id`.
Only statements whose column list lacked `organization_id` were touched (the 37
already-explicit statements untouched).

## Commands

| Command | Exit | Summary |
|---|---:|---|
| `git rev-parse HEAD` (before first change) | `0` | `8f1da300b…` (Start SHA) |
| `pnpm exec vitest run src/__tests__/company-writer-fail-closed.test.ts` (RED, pre-writer-change) | `1` | 2 failed / 2 passed — `create()` resolved instead of rejecting; `createWithOperator()` threw wrong error (silent bucketing present) |
| `pnpm exec vitest run src/__tests__/company-writer-fail-closed.test.ts` (GREEN) | `0` | **4 passed** |
| `pnpm exec vitest run src/__tests__/company-service-org-scope.test.ts src/__tests__/companies-create-org-default.test.ts src/__tests__/companies-org-scope.test.ts src/__tests__/companies-prefix-conflict.test.ts` | `0` | **20 passed** (source-asserting inversions + route resolution + prefix-conflict) |
| `pnpm exec vitest run src/__tests__/companies-*.test.ts src/__tests__/company-*.test.ts src/__tests__/*org*.test.ts` | `1` | **42 files / 390 passed, 4 skipped**; 2 files fail-to-collect = `@armyofagents/plugin-sdk` baseline (E2-F009), confirmed identical on clean stash |
| `AOA_RUN_WIN_INTEGRATION=1 pnpm exec vitest run src/__tests__/teams-null-parent-cascade.integration.test.ts src/__tests__/ask-founder-dogfood.integration.test.ts` | `0` | **6 passed** on embedded PG (raw-SQL sweep + factory both real-PG validated) |
| `pnpm --filter @armyofagents/db typecheck` | `0` | clean |
| `pnpm --filter @armyofagents/server typecheck` | `2` | 66 errors, ALL plugin-subsystem (`@armyofagents/plugin-sdk` absent, E2-F009); zero reference any changed file |

## Deviations

1. **Raw-SQL test sweep uses the literal sentinel value**, not the imported
   `DEFAULT_ORGANIZATION_ID` constant, in the injected SQL text
   (`'00000000-0000-0000-0000-000000000001'`). Rationale: these are raw
   `sql\`…\`` template strings; injecting the literal is behavior-identical to the
   current schema default (same value), FK-valid (0188 seeds the Default Org),
   avoids adding an import to ~50 files, and is consistent + greppable. Service-
   writer `.create()` inline sites use the same literal for uniformity. The Drizzle
   factory + its 4 converted sites use `DEFAULT_ORGANIZATION_ID` via the factory.
2. **`company-portability.ts` has no functional change** — the fail-closed point is
   the writer (§1); the import-path change is a corrected comment + the writer now
   throwing on a missing Org for a direct non-route caller. Production is unchanged
   (the route always resolves the Org).
3. **Two direct-non-route `importBundle` self-hosted callers** (`w6-org-reporting`,
   `mt-import-authz` H3-self-hosted) previously relied on the removed writer
   fallback; they now pass `{ organizationId: DEFAULT_ORGANIZATION_ID / sentinel }`
   explicitly. This is the intended self-hosted **explicit** resolution — reviewer
   should confirm this is the correct interpretation (it preserves each test's
   `orgOnCompany === DEFAULT_ORGANIZATION_ID` assertion while making the resolution
   explicit rather than silent).

## Findings

- `E2-F009` (pre-existing `@armyofagents/plugin-sdk` absence → server typecheck
  exit 2, ~66 errors; a handful of vitest suites fail-to-collect on the transitive
  plugin import) re-confirmed unchanged: all 66 errors in the plugin subsystem,
  zero reference any changed file; the 2 collect-failing suites in the company glob
  (`company-plugin-upgrade-rollback`, `company-portability-preview-export`) fail
  **identically on the clean stash** (proven). DEC-03/E2-F009-waivable; not an
  epic-touched defect. No new findings.

## Fail-closed choices to scrutinize

- No path was chosen fail-closed **in place of** a legitimate Default-Org
  resolution. Every self-hosted create/import path retains an explicit Default-Org
  resolution (route `resolveCompanyOrganizationId`; direct test callers now pass it
  explicitly). Fail-closed fires only when a caller supplies **no** Organization at
  all — the removed silent-bucket case.

## Gate recommendation

`ready for independent review` — the fail-closed behavioral change is RED→GREEN
proven at the unit level and the swept surface is validated against real embedded
PG (raw-SQL + factory); the exhaustive sweep is structurally verified (70/70 paired,
0 stragglers); no schema/migration change (TEN-006b boundary intact); the
server-typecheck delta is subset-of-baseline (E2-F009). **H-01 formal evidence
requires the mandatory ≥1 Linux CI run (E2-D05) across the full swept integration
surface — Windows-local + 2 real-PG spot-runs are recorded here; the full-suite
Linux run is a gate action.**

## Independent review

**Reviewer:** `pending`
**Reviewed revision:** `pending`
**Disposition:** `pending`
**Review evidence:** `pending`

## Review attempt history

| Attempt | Reviewer | Reviewed revision | Disposition | Evidence/findings |
|---:|---|---|---|---|
<!-- First independent reviewer appends attempt 1. -->
