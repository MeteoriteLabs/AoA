# Prerequisite P1 Result — E2 bounded serving/operator-role correction

**Status:** `awaiting_review`
**Date (UTC):** `2026-08-10`
**Implementer:** `Codex implementer agent (/root/e2_role_correction_impl)`
**Start SHA:** `2c33cb220a4a3cdcd8423f6018258011a24090d7`
**RED test commit:** `e3c681421`
**Implementation revision:** `920e55de5a6557577bed9d228e9a00c4d49beadc`
**Reviewed revision:** `TBD — distinct prerequisite reviewer must pin a bare 40-hex revision`
**Scope:** Corrective E2 prerequisite resolving the premises of E3-F001/E3-F002 only. No JOB-001 or other E3 ticket behavior is implemented.

## Delivered behavior

- `aoa_app` retains the eight E2 new-path DML grants and receives the operation-level legacy table allowlist traced from the current JOB-010–014 checkout/heartbeat, approval/runtime-decision, budget/cost/concurrency, and output-summary engines.
- `aoa_operator` is a distinct NOSUPERUSER/NOBYPASSRLS role with DML only on `workers` and `execution_targets`; forced policies restrict it to null-Organization platform metadata and prevent tenant-row enumeration/writes.
- Flag-off startup creates neither bounded pool and requires neither URL. Flag-on startup requires `AOA_APP_DATABASE_URL` and `AOA_OPERATOR_DATABASE_URL`, opens both connections, verifies the exact authenticated role and non-privileged attributes, and aborts before serving on connection, credential, role, or privilege failure. There is no owner fallback.
- `runInTenant(appDb, organizationId, fn(repos))` remains the mandatory tenant boundary. No unscoped tenant repository was added; CAV-005 legacy Company isolation is unchanged.
- Optional role passwords are provisioned only in the migration/bootstrap phase from environment secrets. No credential is committed.

## Strict TDD evidence

### RED (before production changes)

1. `AOA_RUN_WIN_INTEGRATION=1 pnpm --filter @armyofagents/server exec vitest run src/__tests__/config.test.ts src/__tests__/e2-serving-role-correction.integration.test.ts src/__tests__/distributed-execution-db-startup.integration.test.ts`
   - Exit `1`; `6 failed / 27 passed` in the first combined behavior run.
   - Intended failures: both missing bounded URLs were accepted; `aoa_app` lacked `issues:SELECT`; `aoa_operator` was denied `workers`. The first child-process attempt also exposed an unrelated local-auth harness requirement and was corrected before using that lane as evidence.
2. After adding only `AOA_DEV_LOCAL_IDENTITY=1` to the child-process harness: `AOA_RUN_WIN_INTEGRATION=1 pnpm --filter @armyofagents/server exec vitest run src/__tests__/distributed-execution-db-startup.integration.test.ts`
   - Exit `1`; `2 failed / 0 passed`. Both bad-credential child processes reached `/api/health` (`exited:false`), proving the pre-correction server did not gate startup on either bounded connection.

### GREEN (implementation revision)

- `AOA_RUN_WIN_INTEGRATION=1 pnpm --filter @armyofagents/server exec vitest run src/__tests__/e2-serving-role-correction.integration.test.ts src/__tests__/distributed-execution-databases-unit.test.ts`: exit `0`, `15 passed`. This performs every traced table operation, checks unapproved-table denial, exercises `runInTenant` H-01 RLS/composite-FK behavior, bounds operator metadata, denies job/event/artifact/secret surfaces, and directly reapplies migration 0213 twice.
- `AOA_RUN_WIN_INTEGRATION=1 pnpm --filter @armyofagents/server exec vitest run src/__tests__/distributed-execution-db-startup.integration.test.ts src/__tests__/config.test.ts`: exit `0`, `22 passed` (bad app/operator credentials, owner-role fallback for both pools, missing URL failures, and default-off behavior).
- Decision #122/C14 lanes: `pnpm --filter @armyofagents/db exec vitest run src/__tests__/migration-idempotency.test.ts` exits `0`, `5 passed`; `pnpm --filter @armyofagents/server exec vitest run src/__tests__/tenant-rls-enforcement-unit.test.ts` exits `0`, `16 passed`.
- `@armyofagents/db` and `@armyofagents/server` typecheck/build: exit `0`.
- Environment label: `operator-directed windows-local`; Linux CI remains the formal DEC-03 authority.
- Repository-wide AGENTS §8 verification: recursive typecheck and production build exited `0`; `pnpm test:run` completed with `1 failed / 2,005 passed / 118 skipped` files and `18,800 passed / 680 skipped` tests. The sole failed suite is the documented pre-existing Windows transform failure at `packages/worker-protocol/src/cross-version.test.ts:12`; reviewer must independently classify it.

## Migration

`0213_e2_serving_role_correction.sql` was created by the repository's working drizzle custom-migration invocation. It has no schema-authored delta, CREATE TABLE, or CREATE INDEX. Role/GRANT/FORCE-RLS/POLICY statements are builder-backed, individually C14-commented, and idempotent. Migration 0211 was not edited. The migration transaction applies the complete role/grant/policy correction atomically.

## Changed files

| Area | Files |
|---|---|
| DB factories | `packages/db/src/client.ts`, `packages/db/src/index.ts` |
| Migration | `packages/db/src/migrations/0213_e2_serving_role_correction.sql`, journal + generated 0213 snapshot |
| Startup/config | `server/src/index.ts`, `server/src/config/distributed-execution.ts`, `server/src/db/distributed-execution-databases.ts` |
| Grant/policy source | `server/src/db/job-control-legacy-grants.ts`, `server/src/db/rls-tenant.ts` |
| Tests | `config.test.ts`, `distributed-execution-databases-unit.test.ts`, `distributed-execution-db-startup.integration.test.ts`, `e2-serving-role-correction.integration.test.ts`, `tenant-rls-enforcement-unit.test.ts`, `distributed-execution-exclusions.test.ts` |
| Decisions/evidence | Decision #123, E2-D10, E2-F014/F015, environment-variable guide, this result, corrective QA and handoff candidates |

## Review placeholder

**Reviewer:** `TBD (must be distinct from implementer)`

**Reviewed revision:** `TBD`

**Disposition:** `awaiting_review`

**Required reviewer action:** independently rerun/inspect the prerequisite, then update or supersede the corrective QA/handoff. The implementer does not mark this result `complete` and does not decide the prerequisite gate.
