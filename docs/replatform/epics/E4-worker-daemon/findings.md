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

## E4-F005 — WRK-001 dependency-boundary gate was blind to `require()` — RESOLVED

**Status:** `resolved` (WRK-001 fix round) · Severity: HIGH (supply-chain bypass).

To permit Node runtime globals (`process`/`Buffer`) for a daemon, the initial
`worker-daemon-boundary.mjs` dropped the shared `findForbiddenGlobals` scan, which
also silently removed CommonJS-`require` detection. A runtime source could
`require("child_process")` or `createRequire` via `node:module` and pass the gate —
defeating the static import allow-list the gate exists to enforce.

**Resolution:** re-imported `findForbiddenGlobals`; the gate rejects any `require(`
token and the `module`/`node:module` bridge builtins while still allowing Node
globals. REDs B1a/B1b/B1c in `check-worker-daemon-boundary.test.mjs` lock it.

## E4-F006 — WRK-001 boundary/config/metrics hardening — RESOLVED

**Status:** `resolved` (WRK-001 fix round) · Severity: MED (defense-in-depth + one leak).

Adversarial review of the WRK-001 bootstrap found four should-fix + three nit issues,
all resolved except one deferred defense-in-depth nit:
- **S1** manifest union now covers optional/peer/bundled/bundle dependencies (REDs added).
- **S2** config error no longer echoes the raw control-plane URL (names the var + protocol only).
- **S3** invented custody↔scope coupling removed; orthogonality ratified as **E4-D10**.
- **S4** bare-import allow-list rejects any `..` traversal (`pino/..` RED added).
- **N2** loopback set is numeric-only; the remappable name `localhost` is rejected.
- **N3** metric labels validate VALUES against a bounded token, not just keys.
- **N1 (deferred)** logger passes `Error` through untouched — a blanket message scrub is
  deferred to WRK-002+; the one reachable instance (S2) is fixed. Tracked, not lost.
