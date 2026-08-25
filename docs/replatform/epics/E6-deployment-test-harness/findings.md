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

## E6-F003 — the networked worker→provider driver API is unspecified

**Status:** `open` · Severity: HIGH (cross-plan seam; mirrors E4-F002).

★ NARROWED and DEFERRED by DEP-010 (Sprint 2); DEP-010 does not build the wire and
does not pretend to. See `DEP-010-design.md` §2.1.

**What DEP-010 answered.** *Which port* a networked worker→provider driver speaks: the
per-op `SandboxProvider` (`packages/worker-daemon/src/supervisor/provider.ts`),
transport-agnostic by construction, named THE authoritative port by decision D1. The
networked driver is a **binding of that port**, not a third port — which removes the
entanglement with E6-F008/E6-F004 that once made all three look like one question. Those
two are resolved; this one is not.

**What is still open.** The wire itself — the request/response shapes a containerized
worker's provider driver speaks to `adapter-manager`. No transport, no schema, no client.
DEP-010 wires the **desktop/self-hosted lane only**.

**★ Which network, stated correctly — the register carries this sentence, so a wrong name
would be a durable false statement no guard can contradict.** In
`docker-compose.staging.yml` the worker↔adapter-manager conversation is on **`control-net`**:
workers are `[control-net, store-egress-net]`, `adapter-manager` is
`[control-net, provider-ctl-net]` (`scripts/lib/staging-manifest-invariants.mjs`,
`checkWorkerServiceNetworks`). **`provider-ctl-net` is adapter-manager-only** — the
adapter-manager→E2B leg — and a worker attached to it is a hard `PROVIDER-CONTROL
VIOLATION`. ★ The name is OVERLOADED across two compose files: in
`docker-compose.d1.yml` both D1 workers ARE on `provider-ctl-net` (its topology matrix says
so), because D1's fake provider is a container the workers reach directly. Both files are
correct for their own topology; the name is not portable between them.

**Precondition (when this becomes REQUIRED).** The moment a containerized worker under
`docker-compose.staging.yml` must dispatch: §2.5 forbids `E2B_API_KEY` on any worker
surface, so that worker's provider cannot be key-backed and MUST be networked, reaching
`adapter-manager` over `control-net`. There is no consumer today — `adapter-manager` has
**zero implementation** (`DECISION-byte-egress-and-provider-topology.md` §4 residual 4.2)
and no worker dispatches (flag default-off, no `compose:true` branch) — so specifying a wire
against an unimplemented peer for an unbuilt caller is the failure this programme keeps
re-learning. Deferring is correct, not convenient.

**Resolution owner:** filed to a successor at DEP-010 completion (`DEP-011`, the containerized
worker→provider wire) rather than left `owned` by the shipped DEP-010 — an open finding owned
by shipped work reads as owned by nobody (finding **E4-F013**). DEP-010 repoints the manifest
`ticket`, not merely the prose (`DEP-010-design.md` §2.1).

## E6-F004 — DEP-000 provider-driver port import source — RESOLVED

**Status:** `resolved` (DEP-010, Sprint 2) · Severity: MED-HIGH (mirrors E4-F003).

★ RESOLVED with the OPPOSITE answer to the one this finding proposed. The finding said the
fake should import the port from `@armyofagents/worker-daemon` and the boundary should be
widened to ALLOW it. **Rejected.** DEP-010's decision D2 demotes the contract's
`SandboxProviderDriver` to a conformance-harness surface, and the DEP-000 fake
(`packages/sandbox-fake-provider`) already implements THAT harness port **structurally**
(`fake-driver.ts`) — so it needs no import from worker-daemon at all.
`scripts/lib/sandbox-fake-provider-boundary.mjs` therefore stays **exactly**
`["@armyofagents/worker-protocol","zod"]`: widening it would put the daemon's whole provider
surface inside a leaf whose entire point is that it has none. Proved mechanically by
`DEP-010-design.md` Step 9 positive controls 4a (a `worker-daemon` dep in the fake's manifest
fails `check-sandbox-fake-provider-boundary.mjs`) and 4b (an `import type` from worker-daemon
in `fake-driver.ts` is caught lexically) — against the fake's OWN guard, which is the guard
that actually reads the fake.

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

## E6-F008 — DEP-000 contract port is provider-neutral, NOT WRK-004's authoritative `SandboxProvider` — RESOLVED

**Status:** `resolved` (DEP-010, Sprint 2) · Severity: MED (contravened a plan STOP; harness self-consistent). Source: DEP-000 adversarial review (CONFIRMED should-fix).

★ RESOLVED, one direction only. DEP-010's decision **D1** names ONE authoritative port —
worker-daemon's per-op `SandboxProvider` (`packages/worker-daemon/src/supervisor/provider.ts`),
the port the security core speaks and the only one the sole real implementation
(`E2bSandboxProvider`) implements. Decision **D2** states the contract's
`SandboxProviderDriver` is NOT retired and NOT authoritative: it is kept as the surface the two
conformance suites drive (`runSandboxProviderContract`, `runSandboxIsolationConformance`),
reached through the shipped adapter `perOpToInvokeDriver` (`per-op-adapter.ts`, header "CLOSES
finding E6-F008") that shipped in CLI-001. Direction is single and stated: **authoritative
per-op port → adapter → harness driver port**, never the reverse.

**★ Option (b)'s totality bar is SUPERSEDED in writing, not earned by a new test.** This
finding's resolution offered (a) relocate the port to a shared leaf, or (b) a tested
`SandboxProvider → SandboxProviderDriver` adapter *with a totality assertion over all 11 ops +
result shapes*. That bar was written when the adapter was **the** reconciliation. D1 changes
the frame: it demotes the driver port to a harness surface, so per-op coverage of that surface
is the two conformance suites' problem, not the port-authority question's — and the existing
`per-op-adapter.test.ts` already covers the vocabulary case-by-case (routing of the eight
core ops, `reconcile_cleanup`, and the optional trio through the advertisement gate). Naming
one authority is the reconciliation E6-F008 asked for; a `for (const op of PROVIDER_OPERATIONS)`
loop is not part of that decision. (`DEP-010-design.md` §2.2b.)

**★ What this resolution does NOT buy — recorded before the manifest entry is deleted.** The
bridge runs `per-op → driver` only; there is no `driver → per-op` adapter, so the DEP-000 fake
CANNOT stand in as the daemon's provider. The repository therefore keeps **two independent
provider doubles** — `packages/sandbox-fake-provider` for the conformance suites and
`packages/worker-daemon/src/__tests__/support/fake-provider.ts` for the supervisor — and the
DEP-000 harness never drives the daemon's supervisor. Building a `driver → per-op` adapter would
put a fabricating provider one import from a production path (the WRK-009 defect shape), so it is
deliberately NOT done here. Residual, `DEP-010-design.md` §8.9.

The original "reconcile before CLI-001/D2" schedule is moot: CLI-001 shipped, and this is the
composition-root decision the reconciliation was waiting on.

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
