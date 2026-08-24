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

## E4-F002 — Networked worker→provider driver + wire is OUT of WRK-004 CORE — RESOLVED

**Status:** `resolved` (WRK-004, 2026-08-13) · Severity: HIGH (cross-plan seam; E6F-03 depends on it).

**Resolution:** the `SandboxProvider` port (`packages/worker-daemon/src/supervisor/provider.ts`)
is transport-agnostic — a plain async method surface with no wire assumptions. WRK-004 CORE binds
ONLY the in-process `createFakeSandboxProvider`; the networked worker→provider driver + wire is a
named NON-GOAL owned by a later ticket (reconcile with E6-F003), documented at `provider.ts:24-33`.
Original text below.

---

**Status (original):** `open` · resolve at **WRK-004** · Severity: HIGH (cross-plan seam; E6F-03 depends on it).

WRK-004 CORE builds only an in-process fake provider. E1 froze only the
worker↔control-plane transport; the worker↔provider networked path is unowned,
yet E6/DEP-002 puts workers on `provider-ctl-net` and E6F-03 requires a networked
worker→provider smoke.

**Resolution:** WRK-004's `SandboxProvider` interface gets a **pluggable-transport
seam** (in-process binding in CORE; network binding deferred). WRK-004 Non-goals
must name the owning ticket for the networked driver + wire. Reconcile with E6-F003.

## E4-F003 — `SandboxProvider` port must be importable by DEP-000 — RESOLVED

**Status:** `resolved` (WRK-004, 2026-08-13) · Severity: MED-HIGH.

**Resolution:** the `SandboxProvider` port type + all result/label/authority types DEP-000 needs
are exported from `@armyofagents/worker-daemon`'s public API (`src/index.ts`); the port stays
authoritative in worker-daemon and a future `@armyofagents/sandbox-fake-provider` (DEP-000)
imports + implements it (documented `provider.ts:15-22`). Mirror in E6-F004.
Original text below.

---

**Status (original):** `open` · resolve at **WRK-004** · Severity: MED-HIGH.

DEP-000 (fake provider) must implement WRK-004's provider-driver port, but the
port is planned as internal to `packages/worker-daemon/src/supervisor/provider.ts`.

**Resolution:** export the port type from `@armyofagents/worker-daemon` (and have
`@armyofagents/sandbox-fake-provider` depend on it), OR relocate the port to a
shared leaf both consume. State the choice in WRK-004 Files/Interfaces. Mirror in E6-F004.

## E4-F004 — WRK-004 slice B (cleanup authority) may exceed the 3-day bound — RESOLVED (no split)

**Status:** `resolved` (WRK-004, 2026-08-13) · Severity: MED (sizing).

**Resolution:** slice B fit within the ticket bound — full monotonic-epoch + redaction +
cross-resource-denial + idempotency + escalation + expiry coverage landed in one ticket; **no
split was triggered**. Original watch note below.

---

**Status (original):** `open` · watch at **WRK-004** · Severity: MED (sizing).

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

**WRK-005 addendum (2026-08-14 — resolved-for-now as the session-bound dependency).** WRK-005 built
the client-side lease-renewal driver **bounded by session lifetime** (the E4-F007-recommended scope):
a lease cannot outlive its session, so a `session.get()`/`recover()` that surfaces `SessionTerminalError`
(the lapsed 10-min code route / cap-tripped recovery) is treated as a **lease loss → fence close →
`onLeaseLost` → orphan-output quarantine**, NEVER a session extension. The renewal client behavior is
CORRECT regardless of the server fix. **This finding remains OPEN as the dependency for sustained/long
jobs:** until the E3/JOB-002 fix lands (slide-on-poll / device-proof-only reauth / unbind replay from
the code TTL), a worker whose 15-min session nears expiry has no path to renew a lease beyond it, so
any job longer than the session window will lose its lease and quarantine late output rather than run
to completion. WRK-005 did NOT design around F007 client-side (per the finding's directive).

## E4-F008 — WRK-005 inherits the E4-D12 provisioning-refresh concern (loop-toward-live-dispatch)

**Status:** `open` · resolve at **the live-dispatch wiring ticket (post-WRK-005)** · Severity: LOW
(inert today) · Source: WRK-005.

WRK-005 is "wiring the loop toward live dispatch," so it inherits the E4-D12 provisioning-refresh
concern: a rotated provider-constraint digest can go stale on a long-lived worker. WRK-005 itself adds
no provisioning path (it is inert until the loop is wired for live dispatch), but the renewal driver +
fence-close proxy are the first modules composed at that seam. When live dispatch is wired, the owning
ticket MUST reconcile a rotated provider-constraint digest against in-flight leases. Recorded here so
it is not lost.

## E4-F009 — `createStartupReconciler` is not composable at boot — one blocker, not two

**Status:** `open` · Severity: MED · Source: WRK-008 slice 2b planning pass (2026-08-25), adversarial review round 2.

`leaseCandidates` (`supervisor/startup-reconcile.ts:256-257`) has no durable local source: the
event outbox persists **events**, not offers, so the lease-authority probe would run over `[]` on
every boot — a reconciler that reconciles nothing, which is worse than an absent one because the
gate clause it backs would read as satisfied.

**Recorded because the draft deferral gave TWO reasons and one of them is false.**
`ownershipSelector.organizationId` is **not** a blocker: it is carried on the self-model this slice
already reads, and the frozen schema guarantees it non-null for organization- and owner-scoped
targets (`worker-protocol/src/capabilities.ts:307-321`; D1's `worker-b` is
`AOA_WORKER_TARGET_SCOPE: "organization"`). Wiring is **conditional on scope**, not impossible. A
deferral standing on a false reason is a deferral nobody will re-examine.

**Blocks:** E4 gate clause 3 (`E4-3-survives-restart`) staying `dormant` in the wiring register
until a durable lease-candidate source exists.

## E4-F010 — A composed worker cannot be OFFERED work — and would refuse it if it were

**Status:** `open` · Severity: HIGH · Source: WRK-008 slice 2b planning pass (2026-08-25).

Two independent halves, either of which alone is sufficient to make dispatch produce nothing:

- **Server side.** `workers.profile_snapshot` has no update channel. Its only writers are
  `worker-enrollment.ts:444` and `:470`, both on the enrolment path.
- **Worker side.** `poll-loop.ts:538` runs `offerSatisfiesWorker` against the worker's **own**
  `self.report`, and the only production hello builder emits `sandbox.*` capabilities with a
  64-zero `policyHash` (`enrollment/desktop-hello.ts:144`, `:154`). The self-check therefore
  returns `false` for **100% of offers**, independently of anything the server does.

So a worker can enrol correctly, assemble a valid self-model, self-check correctly, and dispatch
nothing, forever. **This is the finding that separates "dispatch composed" from "dispatch
working".** The fixture hello (`poll-fixtures.ts:88-93`, `:134`) *does* include `workload.batch`,
which is why a suite written against the fixture goes green over a hello production never builds —
the trap is named in WRK-008 slice 2b §1.1(c).

**Blocks:** any claim that a distributed worker executes real work; Sprint 5's single-journey
proof; MIG-005/006/007 ACTIVE, which inherit it on top of [[E4-F007]].

## E4-F011 — The desktop boot root is THREE gates from live dispatch, not four

**Status:** `open` · Severity: HIGH · Source: WRK-008 slice 2b adversarial review (2026-08-25) — the review falsified the plan's own four-gate claim.

`packages/worker-keystore/src/bin/desktop-host.ts:114-125` builds **both** OS-custody stores and
`:254-260` passes them on every non-control, non-reset boot. `resolveCustody`
(`worker-daemon/src/identity/device-identity-store.ts:128-133`) makes `mounted_secret`-plus-a-store
a **fatal** refusal, so any desktop host that boots at all is running `os_keychain` with custody
present, and `bin/worker-daemon.ts:267` is entered. Gate 3 (`no_worker_identity`) is therefore
**already satisfied there**, and gate 5 (`no_session`) is reachable within ten minutes of a code.

**The container stands on four gates. The desktop stands on three: `no_provider`, the flag, and
`no_event_outbox_path`.**

> **★ CORRECTED 2026-08-25.** This entry was filed saying **two**, copying the number from WRK-008
> slice 2b before its own round-2 review caught the contradiction: that plan's gate table marks the
> desktop as gated on `AOA_WORKER_EVENT_OUTBOX_PATH` (`runDesktopHost` forwards `env` verbatim into
> the same bootstrap, so both roots hit that gate identically) and then counted the desktop at two
> in the sentence below the table. The table was right. The finding's *substance* is unchanged — one
> of the container's four gates is already satisfied on the desktop — only the count moved.
DSK-003 ships that root as a signed installer, so the day a provider lands in it, every installed
desktop running the build is one environment variable from taking real leases.

**Consequence for DEP-010:** it may not put a provider in that composition root without an explicit,
written decision about the flag's default on desktops. Its acceptance must prove the shipped desktop
default constructs **no provider at all** — not merely that the flag is off.
