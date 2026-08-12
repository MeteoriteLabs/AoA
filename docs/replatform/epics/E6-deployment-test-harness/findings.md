# E6 Deployment / test harness — findings

Scoped discoveries and plan-review deltas for the E6-D1-FOUNDATION partial. Source:
Batch A adversarial plan-review (2026-08-12).

## E6-F001 — DEP-001 package path corrected — RESOLVED

**Status:** `resolved` (plan text fixed). The worker package is
`packages/worker-daemon` (`@armyofagents/worker-daemon`), not `packages/worker`.
All DEP-001 image `COPY` targets and the deps-parity validator reference it.

## E6-F002 — DEP-001 worker-image dependency closure corrected — RESOLVED

**Status:** `resolved` (plan text fixed). Per **E4-D01** the worker image closure
is exactly `worker-daemon` + `worker-protocol` + the `pino` runtime dep (zod
transitive); no `adapter-utils`; no server/db/shared/drizzle.

## E6-F003 — DEP-000 networked driver API is unspecified

**Status:** `open` · resolve at **DEP-000** · Severity: HIGH (cross-plan seam; mirrors E4-F002).

DEP-000 defines only the control channel (`/script`, `/reset`, `GET /invocations`).
The driver-facing "fake execute API" workers hit over `provider-ctl-net` (§2.3
matrix) is never specified, and WRK-004 provides only an in-process fake, so
E6F-03's networked smoke has no worker→provider path.

**Resolution:** DEP-000 must specify the networked driver API the worker's provider
driver speaks (or explicitly defer to the WRK-004 pluggable-transport seam,
E4-F002) and reconcile the §2.3 matrix with it.

## E6-F004 — DEP-000 provider-driver port import source

**Status:** `open` · resolve at **DEP-000** · Severity: MED-HIGH (mirrors E4-F003).

DEP-000 must implement WRK-004's port but no import source is given, and
`check-sandbox-fake-provider-boundary.mjs` rejects server/db/tenant imports.

**Resolution:** `@armyofagents/sandbox-fake-provider` imports the port from
`@armyofagents/worker-daemon` (or the shared leaf chosen in E4-F003); the boundary
check ALLOWS that import while still rejecting server/db/tenant.

## E6-F005 — Gate control-plane path transitive deps (nit)

**Status:** `open` · note at **E6-D1-FOUNDATION gate** · Severity: LOW.

Gate closure requires TEN-002/JOB-003/WRK-004 (program-design L700). E6F-01/E6F-04
exercise submit→placement→enroll→lease→ACK, which transitively needs
JOB-001/JOB-002/JOB-009 `complete`. Add one line noting `JOB-003 complete`
transitively implies those via their dep chain so the campaign path is fully backed.

## E6-F006 — DEP-000 missing explicit REDs (nit)

**Status:** `open` · resolve at **DEP-000** · Severity: LOW. Acceptance names
"unschema-valid fixture rejected" and "unknown op rejected" but no dedicated RED
files exist. Add explicit REDs or fold-and-note.

## E6-F007 — DEP-003 RLS migration mechanism citation (nit)

**Status:** `open` · resolve at **DEP-003** · Severity: LOW. Cite the drizzle
`--custom` mechanism (E2-D01 precedent, product Decision #122/C14) for the RLS
marker migration; confirm both slugs (`distributed_cutover_marker` + `_rls`)
generate after `0231`.
