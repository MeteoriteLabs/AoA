# E4 Worker daemon — findings

Scoped discoveries and plan-review deltas for E4. Each finding names the ticket
that must resolve it. Source: Batch A adversarial plan-review (2026-08-12).

## E4-F001 — Device-proof vectors must be a shared JOB-002 (E3) deliverable — RESOLVED

**Status:** `resolved` (2026-08-12) · unblocks **WRK-002** · Severity: HIGH (H-04/H-05 device-binding proof).

**Resolution:** `tests/fixtures/device-proof/v1/vectors.json` now holds the neutral shared
canonicalization vectors (4 positive + 4 reject), derived from and verified against the SERVER
canonicalizer (`server/src/services/worker-device-proof.ts`). The server test
(`server/src/__tests__/worker-device-proof.test.ts`) was refactored to consume the fixture, and
`scripts/check-device-proof-vectors.mjs` is an independent THIRD reference implementation wired
into CI (`policy`/verify) that fails if the fixture drifts from the algorithm. WRK-002's
sign-side test consumes the SAME file — a worker-local copy is no longer possible, so server
compatibility (not just self-consistency) is proven. The original open text is retained below
for provenance.

---

**Status (original):** `open` · blocks **WRK-002** · Severity: HIGH (H-04/H-05 device-binding proof).

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

## E4-F007 — JOB-002 provides no sustained worker-session renewal (10-min code route < 15-min session) — ESCALATION to E3/JOB-002

**Status:** `open` · escalated to **E3/JOB-002** · Severity: HIGH (blocks long-running workers; does NOT block WRK-002 CORE) · Source: WRK-002 adversarial review (CONFIRMED blocking, reframed per [[E4-D11]]).

The as-built JOB-002 enroll/session contract cannot sustain a worker session beyond the
enrollment code-route window:
- `CODE_TTL_MS = 10 min` (never extended) gates **all** enroll replays (`worker-enrollment.ts:295`),
  and is shorter than `SESSION_TTL_MS = 15 min`.
- `/worker-control/poll` + `/leases/:id/ack` do not re-issue the session (no sliding renewal).
- Enroll always requires the one-time code header; there is no device-proof-only reauth.

Therefore a worker whose 15-min session nears expiry has **no path** to a fresh session: replay
is dead (code route expired at 10 min), poll won't slide it, and it has no live code. A
job-execution platform needs workers to run longer than 10–15 min, so this is a real gap.

**Resolution (E3/JOB-002 follow-up ticket, server-side — NOT WRK-002, which consumes JOB-002 as
an immutable input):** pick one — (a) do NOT gate an already-consumed **replay** on the
code-route TTL (bind it to the enrollment record's own lifetime + a device-proof reauth window
instead); (b) slide/re-issue the session on authenticated `poll`; or (c) add a device-proof-only
reauth endpoint. Each needs its own RED coverage + independent review. Until then, WRK-002 ships
enroll + identity + lost-response recovery + revocation only, and downstream poll (WRK-003) will
observe session expiry as a 401 requiring re-enrollment.

**Does NOT block:** WRK-002 CORE acceptance (per [[E4-D11]]). **Blocks:** any claim that workers
run sustained/long jobs (relevant to WRK-005 lease renewal, DEP journeys, E7+ coding runs).
