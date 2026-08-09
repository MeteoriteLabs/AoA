# Prerequisite P1 Result — E2 bounded serving/operator-role correction

**Status:** `needs_changes`
**Date (UTC):** `2026-08-10`
**Implementer:** `Codex implementer agent (/root/e2_role_correction_impl)`
**Start SHA:** `2c33cb220a4a3cdcd8423f6018258011a24090d7`
**RED test commit:** `e3c681421`
**Implementation revision:** `920e55de5a6557577bed9d228e9a00c4d49beadc`
**Reviewed revision:** `ed1887bf29c688a0d0d83018a2f63144fb027041`
**Fix-round 1 RED commit:** `2db268b01`
**Fix-round 1 candidate code revision:** `d5abd1a53`
**Fix-round 1 review:** `awaiting distinct re-review`
**Scope:** Corrective E2 prerequisite resolving the premises of E3-F001/E3-F002 only. No JOB-001 or other E3 ticket behavior is implemented.

## Attempt 1 delivered behavior (superseded by the candidate below)

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

## Review attempt 1

**Reviewer:** `Codex distinct reviewer (/root/e2_role_correction_review)`

**Reviewed revision:** `ed1887bf29c688a0d0d83018a2f63144fb027041`

**Disposition:** `needs_changes`

**Findings:** the traced `aoa_app` matrix does not serve the actual checkout/runtime-decision paths; `aoa_operator` receives table-wide credential/routing/revocation/destructive authority beyond the metadata-only seam; forced RLS can alter the non-superuser-owner flag-off legacy target path; exact-named roles can retain/inherit authority outside the bounded matrices; bounded pools are not awaited by the shared shutdown sequence.

**Verification:** operator-directed Windows embedded-Postgres focused lanes passed (`15/15`, `22/22`, `5/5`, and `21/21`); affected and recursive typecheck/build passed. Repository `pnpm test:run` remained exit `1`: the known Windows worker-protocol transform/collection failure was independently reproduced, and one unrelated opencode environment-scrub test timed out under full-suite load but passed `3/3` immediately in isolation. Linux CI remains the formal DEC-03 authority. Passing focused ACL tests did not override the confirmed service-path/spec findings.

**Required next action:** fix the Important findings without owner fallback or E3 ticket implementation, add real service-path/non-superuser-owner/adversarial-role acceptance coverage, then submit a new exact revision for distinct review. Corrective E2 QA and the superseding completion handoff remain non-passing.

## Fix round 1 candidate

**Disposition:** `needs_changes` pending distinct re-review. This implementer record
does not pass or complete prerequisite P1.

### Corrected behavior

- Migration `0214_e2_serving_role_hardening.sql` is an additive, idempotent Drizzle
  `--custom` successor under Decision #122/C14; applied migration 0213 is unchanged.
- The `aoa_app` operation map includes the real transitive dependencies exercised by
  checkout stale-hub reconciliation and runtime-decision prompt creation, including
  owner/membership/preference reads, notification/digest writes, and hub counter
  reconciliation. It remains bounded and `company_secrets` remains denied.
- `aoa_operator` receives `SELECT` only on named safe metadata columns of `workers`
  and `execution_targets`. It receives no writes, `DELETE`, `owner_user_id`, routing
  `config`, `worker_token_hash`, or future JOB-002 enrollment/proof/revocation power.
- Both roles converge to NOSUPERUSER/NOBYPASSRLS/NOINHERIT/NOREPLICATION with no
  inherited roles, stale schema/table/column/sequence grants, or application-object
  ownership. Migration and startup both fail closed on unreconcilable drift.
- `execution_targets` remains RLS-enabled but is not forced. A real flag-off server
  backed by its non-superuser table owner continues to read/write the legacy target
  route. There is no permissive `PUBLIC` policy and no distributed owner fallback.
- The app/operator pools close inside the sole awaited shutdown sequence, after
  plugin/host cleanup and before embedded PostgreSQL; close failures are logged and
  do not prevent the other pool or remaining cleanup from being attempted.

### Fix-round strict TDD evidence

RED commit `2db268b01` captured all production gaps before correction:

- Real-service/authority lane: exit `1`, `5 failed / 13 passed`; real checkout and
  prompt creation failed with SQLSTATE `42501`, stale role posture survived reapply,
  role-owned objects were accepted, and an unsafe operator column was exposed.
- Startup lane: exit `1`, `5 failed / 4 passed`; the flag-off non-superuser owner
  failed on forced RLS, while inherited/stale/owned/replication authority passed.
- Shutdown lane: exit `1`, `2 failed / 1 passed`; bounded pools were neither ordered
  in the shared shutdown path nor failure-logged.

GREEN candidate `fc32f1d1adc7c5e0688a235b83e3791c6efb7794`, plus test-harness
cleanup `d5abd1a53`, produced:

- `AOA_RUN_WIN_INTEGRATION=1 pnpm exec vitest run` over the two integration and three
  focused unit files: exit `0`, 5 files and `49/49` tests passed in 56.51 s. This
  invokes representative real services, the flag-off real server, adversarial role
  drift, exact column authority, migration reapplication, and shutdown behavior.
- A root-invocation hygiene RED first exposed package-cwd-dependent test paths; both
  touched integration tests now anchor files to `import.meta.url`, and the exact same
  root command passes.

Migration idempotency passes `5/5`; recursive typecheck (24/25 workspace projects)
and production build exit `0`. `pnpm test:run` completes exit `1` in 181.9 seconds
only on the independently reproduced Windows worker-protocol transform/collection
SyntaxError at `packages/worker-protocol/src/cross-version.test.ts:12`; no P1 lane
failed, and the repository command is not converted into a pass. Linux CI remains
formal DEC-03 authority. A distinct reviewer must independently review the final docs
revision and decide the gate.
