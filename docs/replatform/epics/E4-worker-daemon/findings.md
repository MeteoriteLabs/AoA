# E4 Worker daemon — findings

Scoped discoveries and plan-review deltas for E4. Each finding names the ticket
that must resolve it. Source: Batch A adversarial plan-review (2026-08-12).

## E4-F001 — Device-proof vectors must be a shared JOB-002 (E3) deliverable — STOP for WRK-002

**Status:** `open` · blocks **WRK-002** · Severity: HIGH (H-04/H-05 device-binding proof).

`server/src/services/worker-device-proof.ts` defines the `AOA-DEVICE-PROOF-V1`
canonical tuple, but **no shared vector fixture exists in the repo** — the server
proves its canonicalizer only via a hardcoded inline array in
`server/src/__tests__/worker-device-proof.test.ts`. A worker-local fixture the
server never reads proves only worker self-consistency, not server compatibility.

**Resolution (do at WRK-002 assignment):**
1. Publish canonical vectors to a **neutral shared path**
   `tests/fixtures/device-proof/v1/vectors.json`. Minting/owning that file is a
   **JOB-002 (E3) deliverable**, not a WRK-002 task — WRK-002 cannot unilaterally
   author a trustworthy fixture.
2. BOTH the server device-proof test AND WRK-002's signer test consume that one
   file, plus a `policy`-job checker that fails if the two consumers diverge.
3. **Hard STOP:** WRK-002 may not be closed by self-authoring a worker-local copy.

## E4-F002 — Networked worker→provider driver + wire is OUT of WRK-004 CORE

**Status:** `open` · resolve at **WRK-004** · Severity: HIGH (cross-plan seam; E6F-03 depends on it).

WRK-004 CORE builds only an in-process fake provider. E1 froze only the
worker↔control-plane transport; the worker↔provider networked path is unowned,
yet E6/DEP-002 puts workers on `provider-ctl-net` and E6F-03 requires a networked
worker→provider smoke.

**Resolution:** WRK-004's `SandboxProvider` interface gets a **pluggable-transport
seam** (in-process binding in CORE; network binding deferred). WRK-004 Non-goals
must name the owning ticket for the networked driver + wire. Reconcile with E6-F003.

## E4-F003 — `SandboxProvider` port must be importable by DEP-000

**Status:** `open` · resolve at **WRK-004** · Severity: MED-HIGH.

DEP-000 (fake provider) must implement WRK-004's provider-driver port, but the
port is planned as internal to `packages/worker-daemon/src/supervisor/provider.ts`.

**Resolution:** export the port type from `@armyofagents/worker-daemon` (and have
`@armyofagents/sandbox-fake-provider` depend on it), OR relocate the port to a
shared leaf both consume. State the choice in WRK-004 Files/Interfaces. Mirror in E6-F004.

## E4-F004 — WRK-004 slice B (cleanup authority) may exceed the 3-day bound

**Status:** `open` · watch at **WRK-004** · Severity: MED (sizing).

The monotonic redacted cleanup authority (epoch, redacted projection, cross-resource
denial, idempotency replay, escalation, expiry) is ~1.5–2 days alone.

**Resolution:** pre-authorize splitting slice B into a follow-on ticket if it slips;
record the split trigger so it is not an improvised scope change.
