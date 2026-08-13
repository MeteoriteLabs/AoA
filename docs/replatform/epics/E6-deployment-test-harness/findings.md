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

## E6-F008 — DEP-000 contract port is provider-neutral, NOT WRK-004's authoritative `SandboxProvider` — reconcile before CLI-001/D2

**Status:** `open` · resolve before **CLI-001/D2** (real-provider conformance) · does NOT block `E6-D1-FOUNDATION` · Severity: MED (contravened a plan STOP; harness self-consistent). Source: DEP-000 adversarial review (CONFIRMED should-fix).

DEP-000's `@armyofagents/sandbox-provider-contract` defines a provider-neutral
`SandboxProviderDriver` (single `invoke(op, args)` over the frozen worker-protocol
`PROVIDER_OPERATIONS` vocabulary). This is **structurally unrelated** to WRK-004's authoritative
`SandboxProvider` (`packages/worker-daemon/src/supervisor/provider.ts`, a per-op method surface
exported per E4-F003). The DEP-000 boundary forbids importing `@armyofagents/worker-daemon`, so
the two ports cannot be mechanically linked as built.

**Why it happened:** the E6 plan has an internal tension — §2.1 wants DEP-000 provider-neutral
with deps limited to worker-protocol+zod+Node (no worker-daemon), while §0 (lines 66-74) STOPs on
"inventing a second provider-driver interface" as requiring an E4 amendment. The orchestrator
resolved toward §2.1 (provider-neutral) when directing DEP-000; the review flagged that this
improvised past the §0 STOP.

**Impact:** NONE on `E6-D1-FOUNDATION` — real-provider conformance is explicitly out of that
gate's scope (plan lines 37-38, 83, 102-103); the harness is internally consistent (deterministic
fixture replay against the fake, which conforms to the driver). The gap is that a real E2B
provider implementing `SandboxProvider` cannot be passed to `runSandboxProviderContract` as-is, so
a green contract does not (yet) prove real-supervisor conformance.

**Resolution (do at CLI-001/D2, before a real provider is validated by this suite):** either
(a) relocate the `SandboxProvider` port + result types to a shared worker-protocol-only leaf that
BOTH `@armyofagents/worker-daemon` and the contract import (the E4-F003 "shared leaf" option), so
the contract validates the authoritative per-op port; OR (b) add a tested
`SandboxProvider → SandboxProviderDriver` adapter with a totality assertion over all 11 ops + their
result shapes. The misleading "satisfies this shape" comment in `port.ts` was corrected in the
DEP-000 fix round; this finding records the deferred reconciliation.

## E6-F009 — D1 worker↔data isolation is direct-path + no-credentials + RLS; toxiproxy is a deliberate multi-homed bridge — RESOLVED

**Status:** `resolved` (DEP-002 fix round, 2026-08-13) · Severity: MED (harness-claim honesty) · Source: DEP-002 adversarial review (2 confirmed: control-endpoint static coverage; toxiproxy porosity).

The DEP-002 review found that the "workers cannot reach PostgreSQL" claim was porous: the plan §2.3
specifies a SINGLE toxiproxy multi-homed on data-net + worker-net, whose control-plane→postgres
proxy listens `0.0.0.0:15432`, so a worker can reach `toxiproxy:15432 → postgres:5432` indirectly
even though it is off data-net. The direct-path live test passed but the indirect path was
unprobed, so the gate would falsely advertise full network isolation.

**Decision (proportionate — no plan deviation):** the D1 harness does NOT split toxiproxy (the
plan deliberately specifies one multi-homed instance). Instead the enforced worker↔data isolation
is defined precisely as the conjunction of:
1. **No DIRECT worker→postgres path** — worker services are off data-net (static invariant
   `checkWorkerNotOnDataNet`) and a direct `connect(5432,'postgres')` is refused (live test).
2. **Workers carry NO database credentials** — a new static invariant asserts worker services
   declare no `DATABASE_URL`/`*_DATABASE_URL`/`aoa_app` credential env, so even reaching
   `toxiproxy:15432` a worker cannot AUTHENTICATE to postgres. (Reject fixture: a worker with a
   `DATABASE_URL` fails the validator.)
3. **E2 FORCE-RLS** gates any data access regardless of network path.

toxiproxy's `:15432` listener being TCP-reachable from workers is documented as **by design** (a
deliberate data-tier bridge), not a hidden port; a CI-deferred live assertion documents that a
worker reaching it without `aoa_app` credentials cannot authenticate. The control-plane-must-not-
script-the-fake boundary also gained a static invariant (fake `AOA_FAKE_PROVIDER_CTL_ALLOW`
non-empty + excludes control-plane) and the fake control endpoint now fails CLOSED on an empty
allowlist. A stricter network-layer split (dedicated cp↔pg toxiproxy on a control-plane-only net +
interface-bound listener) is a possible E6 follow-up but is NOT required — the credential + RLS
boundary is the meaningful guarantee.
