# E3 — Durable Job Control — Findings

Planning and execution findings for JOB-001 through JOB-014. Findings are append-only;
resolution changes disposition but does not remove the original evidence.

## E3-F001 — E2 legacy-table grant prose is ahead of migration 0211

**Date:** 2026-08-09
**Status:** `blocked_requires_operator_amendment_or_E2_correction`
**Severity:** P1 STOP — locked-decision/as-built contradiction
**Affected tickets:** all E3 execution; directly JOB-001/JOB-010 through JOB-014

**Finding:** E2 QA prose says the non-owner `aoa_app` role is granted full DML on legacy
tables, but the as-built `packages/db/src/migrations/0211_tenant_rls_enforcement.sql` grants
it only `jobs`, `job_attempts`, `leases`, `workers`, `services`, `service_instances`,
`job_artifacts`, and `job_secret_handles`. E3 therefore cannot call the existing legacy
assignment/approval/budget/cost/audit/output services in the same non-owner tenant
transaction unless their exact tables receive additional grants. Falling back to the owner
pool would bypass the E2 serving-role contract and split the transaction.

**Independent-review correction:** Locked E2-D03 requires one non-owner application role,
full legacy-table DML grants, a flag-on whole-app serving connection, and privileged
migration separation. Migration 0211 and `server/src/index.ts` do not implement that
contract. The draft's least-privilege per-parity grants are a different architecture and
cannot resolve a locked E2 dependency by E3 planner fiat.

**Disposition:** STOP. The operator must choose one reviewed architecture and commit a
corrective E2 gate/handoff before E3 assignment: (A) correct E2 to its locked D03 contract;
(B) approve a successor that permits bounded parity-table grants on `aoa_app` while retaining
application-layer Company isolation for CAV-005; or (C) approve a successor with a distinct
non-owner `aoa_bridge` role/pool for legacy bridges while `aoa_app` remains the RLS-enforced
new-path role. If none is acceptable, order a dedicated E2 security/migration audit rather
than improvising. No E3 ticket is assignable meanwhile.

## E3-F002 — Platform-worker operator policy was described by E2 but not implemented

**Date:** 2026-08-09
**Status:** `blocked_with_E3-F001`
**Severity:** P1 — expected JOB-002 behavior but role model unresolved
**Affected tickets:** JOB-002, JOB-009, JOB-003

**Finding:** E2-D04/E2-D06 describe null-Organization `platform` worker rows as readable via
a distinct operator role/dedicated policy. Migration 0211 contains only the `aoa_app`
tenant policy (`organization_id = current_setting(...)::uuid`), so `aoa_app` correctly sees
and writes no null-Org worker row, but no application-serving operator policy exists yet.
Using the privileged owner connection for platform enrollment/session checks would violate
the non-owner serving contract.

**Disposition:** E2-D04/D06 make the missing operator-only behavior legitimate JOB-002
scope, but a new role/pool must be reconciled with E2-D03's “one non-owner application
role” during E3-F001 resolution. The draft candidate is a dedicated
NOSUPERUSER/NOBYPASSRLS `aoa_operator` role with least-privilege null-Org policies/grants for
both `workers` and `execution_targets`, an explicit fail-closed operator connection, and
tenant non-enumeration tests via a Decision #122 custom migration. The role cannot access
any job/attempt/lease/event/artifact/secret table. Platform polling authenticates the target
and captures a server-verified worker/target/generation principal snapshot through this
metadata-only path, then enters the selected Organization through the approved tenant/bridge
role and `runInTenant` before reading or leasing a job. The in-transaction fence guard must
recheck revocation/generation against authority visible through the chosen E3-F001 grant
model. This candidate is not authorized until the operator resolves E3-F001.

## E3-F003 — Current task checkout mechanism differs from historical shorthand

**Date:** 2026-08-09
**Status:** `resolved_by_canonical_ticket_text`
**Severity:** P2 documentation drift; no implementation blocker
**Affected ticket:** JOB-010

**Finding:** Repository guidance summarizes atomic issue checkout as `SELECT FOR UPDATE NO
WAIT`, while current `server/src/services/issues.ts` implements the single-winner behavior
with an atomic conditional update plus replay/stale-owner rules.

**Disposition:** JOB-010's canonical acceptance text explicitly says the observable
single-winner contract is authoritative and the plan must not freeze a stale SQL detail.
E3 reuses `issueService.checkout` and its current tests/service contract. No program-design
amendment is required.
