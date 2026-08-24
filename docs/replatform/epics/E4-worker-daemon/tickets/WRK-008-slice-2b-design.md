# WRK-008 slice 2b — Design: compose the poll loop and supervisor so the daemon dispatches

**Status:** DESIGN. **Start SHA:** the commit that adds this file.
**Epic:** `E4-worker-daemon`. **Closes:** the daemon half of E4-D12 that slice 2a left open.
**Predecessors:** [`WRK-008-slice-2-design.md`](./WRK-008-slice-2-design.md) ·
[`WRK-008-slice-2-result.md`](./WRK-008-slice-2-result.md) (landed as **2a**) ·
[`E4-D12-live-dispatch-terrain.md`](./E4-D12-live-dispatch-terrain.md)
**Depends on:** DEP-010 (a provider) · WRK-010 (session renewal) — §3 states which is hard.
**Sprint:** 3 (see `docs/replatform/GO-BOOK.md`)

---

## 0. What this slice is, in one paragraph

Slice 2a made the daemon *explain* why it does not dispatch. This slice makes the
`compose: true` branch **reachable**: it threads a device identity, the production worker hello and
a live session through boot, calls `client.selfModelRead` (zero callers since 2a), assembles the
`WorkerSelfModel`, and constructs the durable event outbox, the supervisor, the lease-renewal
driver and the poll loop behind the existing default-OFF flag. After this slice `createPollLoop`
and `createSupervisor` have their **first production callers in the programme's history**.

**It does not turn dispatch on.** Every gate that holds today still holds for **both** shipped boot
roots, and §8 proves that with executable artifacts rather than a paragraph.

> **★ Read §1.1(b) before §8.** There are **two** production boot roots — the container
> (`bin/worker-daemon.ts:398`) and the desktop (`bin/desktop-host.ts` → `aoa-worker-desktop`) — and
> they do not stand on the same number of gates. The desktop injects OS custody on every boot, so
> the identity gate is **already satisfied there**. The container's four-gate posture is real; it
> is not the whole picture, and an earlier revision of this document asserted it as if it were.

---

## ★ 1. Verified state — where slice 2a actually left the tree

| # | Fact | Evidence |
|---|---|---|
| 1 | `bootstrapWorkerDaemon` composes **no** loop; the **container** invocation injects nothing | `bin/worker-daemon.ts:398` |
| 2 | ★ **There is a SECOND boot root, and it injects both custody stores unconditionally** | `worker-keystore/src/bin/desktop-host.ts:114-125` (built) → `:254-260` (passed to `bootstrap`) |
| 3 | `compose: true` is **unreachable** — the decision is called with two hardcoded literals | `bin/worker-daemon.ts:337-346` (`hasSelfModelReader: false, selfModel: null`) |
| 4 | `createPollLoop` has zero production callers | `poll/poll-loop.ts:469` + one `index.ts` re-export |
| 5 | `createSupervisor` has zero production callers | `supervisor/supervisor.ts:161` |
| 6 | `client.selfModelRead` exists and has zero callers | `transport/client.ts:313` |
| 7 | `SupervisorDeps.provider` REQUIRED; `redactionCanaries` REQUIRED (no `?? []`) | `supervisor/supervisor.ts:88`, `:123` |
| 8 | `PollLoopDeps` needs client, self, key, session, limiter, measure, supervisor, backoff | `poll/poll-loop.ts:438-454` |
| 9 | The startup reconciler is gated on a dep nothing supplies | `bin/worker-daemon.ts:355` |
| 10 | The event outbox is gated the same way | `bin/worker-daemon.ts:363` |
| 11 | `AOA_WORKER_DISPATCH_ENABLED` parses strictly, defaults OFF, throws on an unrecognised value | `config/config.ts:150-162` |

### ★ 1.1 Three things the brief did not have, found by reading rather than citing

**(a) There is no production `CapacityProbes` implementation.** `poll/capacity.ts:45-50` declares
the port; its own header says *"real impl reads `node:os` / `node:fs`"*. No such implementation
exists outside tests. **`PollLoopDeps.measure` cannot be built from what is there.** Step 1 writes
the probes.

**(b) THE CONTAINER HAS NO DEVICE KEY EITHER — a FOURTH gate. But it is a gate for the
CONTAINER ONLY, and the first draft of this document got that boundary wrong.**

For the container the argument holds. `MountedSecretKeyStore` (`identity/key-store.ts:61`) is
constructed **nowhere** outside tests. The only boot path yielding a device key is the enrolment
block, gated on `keyStoreMode === "os_keychain" && deps.identityStore && deps.receiptStore`
(`bin/worker-daemon.ts:267`) — three conditions the container's `bootstrapWorkerDaemon({env, proc})`
invocation (`:398`) satisfies zero of.

> ### ★★★ AND THE DESKTOP ROOT SATISFIES ALL THREE, ON EVERY BOOT.
>
> `packages/worker-keystore/src/bin/desktop-host.ts` builds **both** OS-custody stores
> unconditionally (`:114-125`) and passes **both** to `bootstrapWorkerDaemon` on every
> non-control, non-reset boot (`:254-260`). It is not a developer toy: `aoa-worker-desktop.ts:3`
> calls itself *"the real entry point"*, it is the package's declared `bin`
> (`worker-keystore/package.json:14-16`), and DSK-003 stages `dist/bin/aoa-worker-desktop.js`
> into the signed installer (`scripts/lib/__tests__/staging-manifest.test.mjs:142`).
>
> And the mode cannot save it. `resolveCustody` **fatally refuses** `mounted_secret` with any
> store injected (`identity/device-identity-store.ts:128-133`), and the bin turns that verdict
> into `proc.exit(1)` before the socket opens (`bin/worker-daemon.ts:213-218`). An unknown mode
> refuses too (`:138`). **Therefore any desktop host that boots at all is running `os_keychain`
> with both stores present** — the enrolment block at `:267` is entered, and **gate 3 is not a
> gate there.**
>
> The desktop is standing on **two** gates, not four: no provider, and the flag. The day DEP-010
> lands a provider in a composition root that also builds these stores, the desktop drops to
> **one env var**. That is precisely the risk §8 claims to have retired — and §8's claim is true
> only for the containerised D1 workers.

And `enrollOnce` **deliberately discards the session** (`enrollment/enroll-once.ts:310`, I13)
because `EnrollResult` is a plain literal containing `session.token` and one
`logger.info({ result })` would log a live bearer token.

So "thread a SESSION so `selfModelRead` can be called" is not passing a value along: **no session
exists after boot, by design, on either root.** §4 says where it comes from without regressing I13.

**(c) A composed worker cannot be offered work — and it would REJECT the offer anyway. Neither is
this slice's to fix.** The only production hello builder is `buildDesktopHello`, whose header says
it exists to emit a desktop that *"can never be matched work"* (`enrollment/desktop-hello.ts:7-8`):
its `reportedCapabilities` are `sandbox.*` only (`:144` → `capabilitiesForIsolation`), so
`ceiling ∩ reported` can never contain the `workload.<type>` name the frozen matcher requires, and
its `policyHash` is 64 zeros (`:53`, `:154`).

Two consequences, and the second is the one the first draft missed:

- **Server side.** The matcher runs over `workers.profile_snapshot`, whose only writers are
  `worker-enrollment.ts:444,470` — **there is no update channel**, so no offer is ever produced.
- **★ Worker side.** `poll-loop.ts:538` runs `offerSatisfiesWorker(deps.self, capacity, offer)`
  before ACKing, and that is the SAME frozen `workerSatisfiesRequirements`
  (`poll/capacity.ts:143-157`) over the worker's own `self.report`. Composed with the only hello
  production builds, **the worker's own defense-in-depth check returns `false` for 100% of
  offers** — even a hand-crafted one. Every poll would emit `poll{outcome:"incompatible"}` and
  nothing would ever be ACKed.

**This is why §4.1 and §5 name the hello source explicitly, and why Step 6 asserts it.** The
fixture hello (`__tests__/support/poll-fixtures.ts:88-93` `REPORTED_CAPABILITIES`, which *does*
contain `workload.batch`, and `:134` `policyHash: POLICY_HASH` — the same constant the registered
target profile commits at `:110`) is built precisely so `offerSatisfiesWorker` "returns a
meaningful boolean" (`:10`). Reaching for it
in the composition tests would turn §7 rows 8, 12 and 17 green **over a hello production never
builds** — a suite passing against a worker that does not exist. Filed as a finding (§9).

---

## ★ 2. The flag stays default-OFF — and it holds a different number of gates on each root

| # | Gate (refusal token) | Fixed by | Container (D1) | ★ Desktop (`aoa-worker-desktop`) |
|---|---|---|---|---|
| 1 | a `SandboxProvider` was injected (`no_provider`) | DEP-010 | **no** — E4-D01 makes it unconstructable here | **no**, same reason |
| 2 | `AOA_WORKER_DISPATCH_ENABLED=1` (`dispatch_disabled`) | editing env | yes, but gate 1 refuses first | yes, but gate 1 refuses first |
| 3 | a device identity exists (`no_worker_identity`) | a root injecting OS-custody stores + enrolling | **no** — `mounted_secret`, no stores (§1.1b) | ★ **ALREADY SATISFIED** on every boot (§1.1b) |
| 4 | `AOA_WORKER_EVENT_OUTBOX_PATH` is set (`no_event_outbox_path`) | editing env | yes, but 1/3 refuse first | yes, but gate 1 refuses first |
| 5 | a live session (`no_session`) | a fresh enrolment code (WRK-010 removes the ceiling) | needs 3 first | reachable within 10 min of code issuance (§3.2) |
| 6 | the target has an admin-set placement profile (`no_self_model`) | an org admin | needs 1–5 first | needs 1–5 first |

**The container stands on four gates. The desktop stands on two: gate 1 and the flag.** That is the
correction §1.1(b) makes, and it is the reason §8's "four simultaneous changes" answer is scoped to
D1 and says so.

**The flag is still non-vacuous — and on the desktop it is doing more work than anywhere else.**
Gate 1 is structural and protects *today's* build on both roots; gate 3 protects only the
container. The flag is what stands between "DEP-010 landed a provider in the desktop composition
root" and "every installed desktop running that build starts taking real leases". In tests it is
reached by injection, the only way it is reachable at all.

**Ordering, extending 2a's "deepest fact first."** `no_provider` and `no_worker_identity` are
BUILD/deployment facts no env edit fixes. `dispatch_disabled` is an explicit operator choice —
reporting anything past it for a worker deliberately switched off is noise.
`no_event_outbox_path` is an env edit **on this host**. `no_session` and `no_self_model` both come
out of the same authenticated read, and they are ordered by causality: the session is what
authenticates the read, so a dead session is discovered *before* a missing profile can be. It is
also the fixable-here-first order — a lapsed session is repaired by re-enrolling **this device**,
while `no_self_model` needs a **different person** (an org admin).

**Why `no_event_outbox_path` is a refusal rather than a default.** The supervisor's `eventSink` is
required. Composing with a no-op sink would silently drop every `attempt_started`/`terminal` event
a run emits — an evidence path failing open, invisibly, in exactly the case it matters. Same
defect class that made `redactionCanaries` required rather than `?? []`.

> **★ And the composition must not commit that defect itself, one component over.**
> `LeaseRenewalDriverDeps.eventSink` is **optional** and falls back to a literal
> `NOOP_SINK` (`lease/lease-renewal.ts:305-306`, `:342`, `:361`). The argument above is only
> honest if the driver gets the real sink too — otherwise this section refuses a boot to protect an
> evidence path while the very next line of the composition drops a different one. §4.1.1 and
> Step 6 carry the wiring and the mutant.

---

## ★ 3. Dependencies — hard or soft, answered

### 3.1 DEP-010 (the provider) — **SOFT. Ships behind the flag.**
2b is provable today by injecting `createFakeSandboxProvider` at the existing
`BootstrapDeps.provider` seam. Without DEP-010 the `compose: true` branch stays unreachable in
production — the guarantee, not the gap. DEP-010's own acceptance says the same from the other
side. Neither blocks the other.

> **★ But DEP-010 inherits a decision this slice cannot make for it (finding `E4-F011`).** The
> provider is the *last* structural gate on the desktop root (§1.1b): the moment
> `desktop-host.ts` — or anything that, like it, builds OS custody — also constructs a provider,
> that root goes from two gates to **one env var**. DEP-010 must state, explicitly, which root(s)
> it lands a provider in and what the flag defaults to there. 2b's contribution is that the
> question is on the table with an artifact behind it (Step 8b's positive control) rather than
> being discovered from a desktop that started taking leases after an update.

### 3.2 WRK-010 (session renewal) — **SOFT, and the limit is severe. Document it loudly.**

> **Without WRK-010, a composed worker dies at T0+15min and cannot come back.**

Verified: code route 10 min, session 15 (`worker-enrollment.ts:22-23`); a session is minted
**only** by enrolment; no device-session renewal route. `SessionStore.forceRefresh`
(`identity/session.ts:125`) replays the *enroll* op, so it recovers a session **only while the
code route is live** — ≤10 min from issuance. Past that the replay 401s, the store STOPS,
`reenrollment_required` is emitted, and the poll loop stops permanently
(`poll-loop.ts:697-720`).

Worse for restarts: a worker restarted more than 10 minutes after its code was issued reaches
steady state in `enrollOnce` (identity+receipt present ⇒ `skipped`, no network), so its **first**
`ensureFresh()` 401s. It never obtains a session at all.

**Decision: 2b ships behind the flag with the ceiling documented and does not hard-depend on
WRK-010.** (1) Dispatch is off by construction meanwhile, so the ceiling has no production
exposure. (2) 2b's composition is what makes WRK-010 provable end to end; hard-depending would
invert a sequence that already cost this programme one reversal.

**What 2b owes in exchange — acceptance items, not good intentions:**
- The `renew` thunk is the **named, single-line WRK-010 seam** (Step 2). DSK-001 described this as
  `IdentityLifecycle.acquireSession()`; **that symbol does not exist in code** — it appears only in
  two documents. 2b creates the seam for real.
- Composing emits a **boot WARN naming the ceiling**, so no operator discovers it from a dead
  worker (Step 7).
- The result doc states the ceiling in its first section, not a footnote.

---

## ★ 4. Architecture — where the session comes from without regressing I13

```
enrollOnce (unchanged)              ← still returns NO session (I13 intact)
      │
      ├─ identityStore.load() ──► DeviceIdentityRecord {workerId,targetId,gen,pkcs8}
      │                                   └─ deviceKeyFromPkcs8Der(...) ──► DeviceKey
      ▼
createWorkerIdentity()              ← NEW: identity/worker-identity.ts
      ├─ buildDesktopHello({workerId, targetId, deviceGeneration, platform, arch})
      │       ▲   enrollment/desktop-hello.ts:87 — THE SAME BUILDER enroll-once.ts:255 uses.
      │       └── ★ §1.1(c): this hello makes offerSatisfiesWorker FALSE for every offer.
      │           That is the honest composed worker. A fixture hello here would be a lie.
      ├─ SessionStore({now, renew, metrics, logger}, initial = null)
      │       └── renew: () => enroller.renew({hello, code, idempotencyKey}).session
      │                    ▲          ▲
      │                    │          └── code: readEnrollmentInput(config.enrollmentCodeSource,
      │                    │                      env, readFileText).enrollmentCode — read LAZILY,
      │                    │                      per renew. See "where the code comes from" below.
      │                    └── ★ THE WRK-010 SEAM. One thunk. WRK-010 replaces its body with a
      │                        device-proof renewal call and changes nothing else.
      └─ createSessionProvider(store) ──► SessionProvider
             ├──► readWorkerSelfModel()   (client.selfModelRead)
             │       └─ assembleWorkerSelfModel({response, report: hello, sha256Fn})
             │              ▲                                        ▲
             │              │ identity/self-model.ts:45 (EXISTS)     └─ sha256Hex,
             │              └─ its `report` is the hello above          identity/device-proof.ts:101
             ├──► createEventOutboxDrain()
             └──► createPollLoop()   (deps.self = the assembled model; poll-loop.ts:538 self-checks it)
```

**★ Where the hello and the `sha256Fn` come from — the first draft named neither.**
`assembleWorkerSelfModel` REQUIRES `report: WorkerHelloV1` and `sha256Fn`
(`identity/self-model.ts:32-38`), and `PollLoopDeps.self` is that model. There is exactly one
production hello builder (`buildDesktopHello`) and exactly one production byte-digest helper
(`sha256Hex`), and the composition uses both. Note that `enrollOnce` builds its hello at
`enroll-once.ts:255` only on the ENROLLING path — a steady-state boot returns `skipped` at `:194`
before ever reaching it — so the composition builds its own from the same function and the same
persisted record, rather than receiving one.

**★ Where the renewal CODE comes from, and what that costs.** `Enroller.renew` takes
`RenewInput extends EnrollInput`, which requires `code: string` (`enrollment/enroll.ts:106-113`).
In steady state `enrollOnce` returns `skipped` at `enroll-once.ts:194-204` **before**
`deps.readInput?.()` at `:207`, so **nothing in the composed path is already holding a code**. The
thunk therefore re-invokes `readEnrollmentInput(config.enrollmentCodeSource, env, readFileText)` —
the same reader, the same source, the same lazy-thunk discipline the enrolment block uses at
`bin/worker-daemon.ts:281`.

State the consequence plainly rather than leaving it implied: **the composed daemon re-reads a
bearer credential at arbitrary later times**, not only during the boot window. §4's whole argument
is an I13 argument, so this cost belongs in it and not in a footnote. Four properties keep it
acceptable, and all four are asserted in Step 2:

1. **Lazy** — a daemon never asked for a session never touches the file (a `readCode` spy at 0
   calls after construction).
2. **Named for the redactor** — the reader returns `enrollmentCode`, never `code`, precisely
   because the logger's redactor keys off that field name
   (`enrollment/enrollment-input.ts:11-15`, `:40`, `:124`). The thunk must keep that name all the
   way to `RenewInput` rather than destructuring it into a local `code` in a loggable object.
3. **Never aggregated** — the value goes into `SessionStore`'s private field and never appears in
   a returned literal (I13, the same rule `enroll-once.ts:310` follows for the session).
4. **A read failure is a transient rethrow, not a mint** — the store does not stop, and nothing
   generates a new identity.

WRK-010 removes this entirely: its device-proof renewal needs no code at all. That is the second
reason the seam is worth having, beyond the ceiling in §3.2.

**Why `SessionStore` rather than returning the session from `enrollOnce`.** The store already owns
every property needed — expiry, lazy acquisition (`ensureFresh`, `:103`), recovery
(`forceRefresh`, `:125`), terminal-401 stop with the `reenrollment_required` metric + warn, and
rotation detection. It holds the token in a private field and never returns it in a loggable
aggregate, so **I13 stays intact**. Changing `enrollOnce`'s return type to carry a session would
put a live bearer token one `logger.info` away from the log — the exact defect I13 prevents.

**The session is minted lazily**, on first `ensureFresh()`: a daemon that composes but is never
asked for a session never materialises the enrolment credential.

### 4.1 What gets composed, and what does not

| Piece | Composed? | Why |
|---|---|---|
| `ConcurrencyLimiter` | ✅ | from `config.concurrency` |
| Capacity probes | ✅ **NEW** | §1.1(a) — no production implementation exists |
| `buildDesktopHello(...)` | ✅ | §4 — `assembleWorkerSelfModel` requires a `report`, and this is the only production builder (§1.1c) |
| `SessionStore` + `SessionProvider` | ✅ **NEW** | §4 |
| Self-model **reader** | ✅ **NEW** | `selfModelRead` gets its first caller. ★ The **assembler** is NOT new: `assembleWorkerSelfModel` already exists at `identity/self-model.ts:45` (2a shipped it with zero callers). Only `readWorkerSelfModel` is written here. |
| `sha256Hex` as the assembler's `sha256Fn` | ✅ | `identity/device-proof.ts:101` — the existing production digest helper, not a new one |
| `openEventOutboxStore` + `DurableWorkerEventSink` | ✅ | the sink is required; a no-op sink is a fail-open (§2). ★ **ONE instance, passed to BOTH the supervisor and the renewal driver** — see below |
| `createEventOutboxDrain` | ✅ | **E4 gate clause 4** |
| `createSupervisor` (`eventSink`, `redactionCanaries`, **no** `observeRun`) | ✅ | **E4 gate clause 2** |
| `createLeaseRenewalDriver` (`schedule`, **`eventSink`**) | ✅ | it DECORATES the supervisor seam; omitting it means ACKed leases are never renewed |
| `createRealRenewalSchedule()` | ✅ | ★ `LeaseRenewalDriverDeps.schedule` is **REQUIRED** (`lease/lease-renewal.ts:300`) and has no default; `:238` is the intended production value |
| `createPollLoop` | ✅ | **E4 gate clause 1** |
| `createStartupReconciler` | ❌ **DEFERRED** | §4.2 — one structural blocker (revised) |

### ★ 4.1.1 The renewal driver's `eventSink` is OPTIONAL, and that is a trap

`LeaseRenewalDriverDeps.eventSink` is `eventSink?:` (`lease/lease-renewal.ts:305-306`) and falls
back to `NOOP_SINK` (`:342`) at the one site that consumes it: the per-lease fence-close proxy
factory, `eventSink: deps.eventSink ?? NOOP_SINK` (`:361`).

That sink is where a **post-close governed-egress denial** emits its `network_denied` event — the
evidence that a run tried to reach the network after its lease was lost. Composing the driver
without it does not fail, does not warn, and does not typecheck differently. It **silently drops a
security-evidence stream**, which is the *exact* failure mode §2 uses to justify making
`no_event_outbox_path` a refusal rather than a default, and the same defect class that made
`SupervisorDeps.redactionCanaries` required. Listing `eventSink` only under `createSupervisor` —
as the first draft of §4.1 and Step 6 did — would have shipped it.

**One `DurableWorkerEventSink` instance serves both.** Its `emit` derives the delivery identity
from the event's own fields (`events/durable-event-sink.ts:40-50`, called at `:69`), so it carries
no per-consumer state and there is nothing to keep in step between two instances. Step 6 asserts
the driver's proxy reaches the same store, and carries the mutant that drops it.

### ★ 4.2 The startup reconciler is DEFERRED — for ONE reason, not two

E4's gate clause 3 is *"survives restart"*. Slice 2b **cannot honestly wire it**. The first draft
gave two blockers; **only one survives contact with the code**, and saying so matters because an
over-broad deferral is how a wireable clause stays unwired for a sprint it did not need to.

**THE BLOCKER: `leaseCandidates` has no durable local source.** `StartupReconcilerDeps` requires
`leaseCandidates: readonly LeaseOfferV1[]`, annotated *"reconstructed from durable local state
(test-injected)"* (`supervisor/startup-reconcile.ts:256-257`). There is no durable lease store —
the outbox persists *events*, not offers. The lease-authority probe would run over `[]` every
boot: **a guard that passes because it could not evaluate anything**, the failure this programme
has now hit five times. Reconstructing offers from the event stream is its own ticket, not a line
in this one.

**~~(2) `OwnershipSelector.organizationId` is not constructible at boot.~~ WITHDRAWN — it is.**
`StartupReconcilerDeps.ownershipSelector` (`:248`) requires
`{organizationId: string, targetId, workerId}` (`supervisor/provider.ts:114-119`), and
`labelsMatchSelector` (`:135-141`) requires all three to match. But `organizationId` **is** a field
of the registered target profile this slice now reads:
`RegisteredTargetProfileV1.organizationId`, and the frozen schema's own `superRefine`
**guarantees it is non-null** for `scope === "organization"` and `scope === "owner"`
(`worker-protocol/src/capabilities.ts:307-321`) — it is null only for `scope === "platform"`
(`:300-306`). D1's `worker-b` is exactly the org-scoped case:
`AOA_WORKER_TARGET_SCOPE: "organization"` (`docker-compose.d1.yml:349`) against
`docker/d1/worker-b.profile.json` `"scope": "organization"` with a non-null `organizationId`. The
first draft cited `poll-fixtures.ts:100-102` — which is a **platform-scoped** fixture, and
generalising one fixture into "not constructible" is exactly the inference this programme has been
burned by before.

**So the honest shape is conditional, and the register should say so:** wireable when
`selfModel.registeredTargetProfile.organizationId !== null`, skipped **with a named reason** when
the target is platform-scoped. That is not a placeholder org and not a silent pass. It still does
not happen in 2b, because blocker (1) holds for both scopes.

**Disposition.** `E4-3-survives-restart` stays `unwired` in `scripts/gate-clause-wiring.json`, its
`reason` rewritten to name the ONE real blocker (`leaseCandidates`) and to record that
`organizationId` is available on the self-model for org- and owner-scoped targets. A finding is
filed (§9). Recorded here rather than discovered during implementation, which is what the design
pass is for — including the part where the design pass refuted half of its own first answer.

**Partial credit is deliberately refused.** The reconciler's outbox half *is* constructible. Wiring
only that half would let the clause read as reconciling restart state while the sandbox pass — the
half the clause is about — silently did nothing. Instead Step 6 calls `drain.recover()` directly at
boot, the honest narrowly-scoped subset, attributed to **clause 4, not clause 3**.

---

## 5. Files touched

Paths are relative to `packages/worker-daemon/src` unless the package is named.

**New:** `poll/host-probes.ts` · `identity/worker-identity.ts` · `identity/self-model-read.ts` ·
`lifecycle/dispatch-runtime.ts` · `scripts/check-d1-dispatch-declared.mjs` ·
`scripts/d1-dispatch-expectation.json` · `scripts/check-boot-roots-provider-free.mjs` (Step 9b) ·
`scripts/lib/boot-roots-provider-free.mjs` (its pure half) ·
`scripts/boot-roots-expectation.json` (its declaration)

**Modified:** `lifecycle/compose-dispatch.ts` (retire `no_self_model_reader`; add
`no_worker_identity`, `no_event_outbox_path`, `no_session`; take the read RESULT rather than a bare
`selfModel`) · `config/config.ts` (`AOA_WORKER_EVENT_OUTBOX_PATH`) · `bin/worker-daemon.ts` (thread
identity → decide → read → decide → compose → register lifecycles) · `index.ts` (barrels) ·
`__tests__/support/fake-control-plane.ts` (the self-model route) ·
`scripts/gate-clause-wiring.json` (`E4-1/2/4` → `wired`; `E4-3` reason rewritten per §4.2) ·
`scripts/guard-inventory.json` · `.github/workflows/pr.yml` · `scripts/test-inventory.json`

**Deliberately NOT modified:** `packages/worker-keystore/src/bin/desktop-host.ts`. It passes no
`provider` today and this slice does not add one; Step 9b's guard turns that from a habit into a
checked property, and Step 8b turns it into an assertion.

**New tests:** `host-probes.test.ts` · `worker-identity.test.ts` ·
`self-model-read.component.test.ts` · `dispatch-runtime.test.ts` ·
`dispatch-composition-2b.test.ts` · `shipped-binary-refuses.test.ts` ·
`scripts/lib/__tests__/d1-dispatch-declared.test.mjs` ·
`scripts/lib/__tests__/boot-roots-provider-free.test.mjs` ·
★ `packages/worker-keystore/src/__tests__/desktop-host-refuses-dispatch.test.ts`

**★ Why that last one lives in the keystore package and cannot live beside the others.** The
dependency arrow is keystore → daemon and never back:
`packages/worker-daemon/package.json:27-30` declares exactly
`@armyofagents/worker-protocol` + `pino` (and `worker-keystore/package.json:27-30` is what declares
the arrow the other way), while `check-worker-daemon-boundary.mjs` rejects a bare
specifier under `packages/worker-daemon/src`. A daemon-side test importing `runDesktopHost` would
be an undeclared dependency **and** a workspace cycle. The desktop boot root is therefore proven
from the side that owns it — which is also the side that would break it.

---

## 6. The TDD steps

Each step is **RED → GREEN → mutants**, committed separately.

### Step 1 — the production capacity probes
`createHostCapacityProbes({cpuCount, freeMemoryBytes, diskFree})`, each wrapped in
`zeroOnThrow`. **★ Every probe fails to ZERO.** A throwing probe is a host quirk (an unusual
filesystem, a container without `statfsSync`), not a reason to kill a daemon mid-poll. Zero is
fail-closed: the worker advertises no capacity and is offered nothing. Inventing a number is the
dangerous direction. **★ POSITIVE CONTROL** with working injected probes reporting the real
numbers — without it the throw test would pass equally against a stub that always returns 0.
Plus: the result satisfies the frozen `workerCapacitySchema` through `measureCapacity`.
*Mutants (4):* delete the `try`; `catch` returns 1; delete the `<= 0 → 0` clamp; change
`MILLIS_PER_CORE`.

### Step 2 — the worker identity + session lifecycle (**the WRK-010 seam**)
`createWorkerIdentity({record, platform, arch, now, readCode, renewSession, metrics, logger})` →
`{key, workerId, targetId, deviceGeneration, hello, session, store}`. Re-derives the key from the
**persisted** bytes (the same rule enroll-once follows, so an envelope round-trip bug surfaces on
first boot rather than after the server committed). `SessionStore` with `initial = null`.

**★ It also builds the hello**, via `buildDesktopHello` — the same function `enroll-once.ts:255`
uses, from the same persisted record. It lives here rather than in the reader because both the
reader (`assembleWorkerSelfModel`'s `report`) and any future renewal (`RenewInput.hello`) need the
identical value, and two construction sites are two things to keep byte-identical.

**★ `readCode` is the enrolment-code thunk**, invoked per renew, never at construction — §4's
"where the renewal CODE comes from".

Tests: key re-derived from persisted DER; **★ the hello comes from `buildDesktopHello`, not a
fixture** — asserted by equality against a direct call with the same record (§1.1c: this is what
makes the composed worker's `offerSatisfiesWorker` honestly `false`, and a fixture hello here would
silently make three acceptance rows green over a worker production never builds); **★ mints
LAZILY** (constructing performs no renew **and no code read** — a spy on `readCode` at 0 calls);
**★ POSITIVE CONTROL** — the first `get()` DOES mint, DOES read the code exactly once, and returns
the live session (without it, laziness is indistinguishable from never-wired); same session while
live; **★ E4-F007** — a lapsed code route goes TERMINAL rather than spinning; a **transient**
failure rethrows unchanged and the store does **not** stop (otherwise one blip retires a worker);
**★ I13** — no returned value and no emitted log record contains the session token or the code;
**★ the WRK-010 seam is ONE injected thunk** — swapping it changes nothing else, asserted rather
than promised in prose.
*Mutants (6):* fabricate an `initial` session; drop `now`; swallow the `EnrollmentError`; use
`generateDeviceKey()` instead of the persisted DER; replace `createSessionProvider` with a raw
`{get}` lacking the terminal wrap; **read the code eagerly at construction instead of per renew**.

### Step 3 — the self-model reader (`selfModelRead` gets its first caller)
Harness first: add the self-model route to `fake-control-plane.ts`, mirroring the client's vendored
constant so the proof is verified over the **exact** path it signs — a fake accepting a proof over
a different path would hide the one failure mode the repo-level parity guard exists for.

`readWorkerSelfModel` takes `{report: WorkerHelloV1, sha256Fn}` alongside the client + session — the
values §4 names — and returns a discriminated result: `ok{selfModel}` | `refused{no_profile |
unassemblable | session_terminal | unavailable}`. **★ NOTHING THROWS** — a daemon that throws on a
bad server response dies instead of staying up inert, which is 2a's Q3 state. **One** 401 recovery
then give up (a recover→retry→recover spin with no backoff is how a worker hammers a control plane
with a dead identity). 401/403/404 all collapse to `no_profile` **deliberately**: the route answers
the same coarse code for "no such target", "never configured", "revoked" and "stale generation" so
it is never an oracle — the worker cannot distinguish them and must not pretend it can.

**★ The four-way union is CONSUMED, not decorative.** Step 4 takes this whole result, maps
`session_terminal` to its own refusal token, and puts the remaining sub-reason in the log payload.
Computing a four-way discrimination and then collapsing it into one message was the first draft's
plan, and §3.2 makes `session_terminal` the *most likely* real refusal on any worker older than
ten minutes — so that message would have sent an operator to an org admin for a placement profile
that was fine. A union nothing reads should be deleted, not shipped; this one is read.

Tests: **★ POSITIVE CONTROL** — a live 200 assembles a **branded** self-model **whose `report` is
the hello that was passed in** (identity, not a copy — the composition-level version of that
assertion is Step 6's); **★ the proof is signed over the SAME path** the request is sent to (the
fake verifies independently; a mismatch 401s); **★ a TAMPERED provider profile fails the brand** —
refused, not degraded; a 401 asks the provider to recover **once**; a 404 is `no_profile`, distinct
from transport failure; **★ a terminal session yields `session_terminal`, NOT `no_profile`** — the
discrimination Step 4 depends on; **★ nothing throws** on garbage.
*Mutants (6):* delete the recovery branch; delete the second attempt; change 404 → `unassemblable`;
delete the `selfModel === null` check; remove the `SessionTerminalError` rethrow; **sign over
`client.pollPath` instead of `selfModelReadPath`** — this last one dies with a 401 and is the
mutant that **proves the parity guard's premise is real rather than asserted**.

### Step 4 — retire `no_self_model_reader`; add the three real reasons
**★ The slice-2a placeholder reason is GONE.** 2a's message said this build "cannot read its own
self-model yet (WRK-008 slice 2b)". 2b threads the session, so that sentence is now false. **A
refusal message describing a state the code has left is worse than none** — it sends an operator to
wait for a slice that has landed. The token is retired, not reworded; a test asserts no message
matches `/slice 2b/i`.

**★ `no_worker_identity` is distinct from `no_self_model` — different people fix them.** A daemon
with no device identity cannot AUTHENTICATE a read at all. Reporting `no_self_model` would send an
operator to an org admin for a profile that may already be set, for a host whose real problem is
that no OS-custody store was injected — exactly the mistake 2a's §5 caught, one layer down.

**★ `no_session` is distinct from `no_self_model` for the SAME reason, one layer down again — and
this one bit the first draft of THIS document.** That draft had Step 3 compute a four-way refusal
and Step 4 collapse all four into `no_self_model`, whose message is *"this target has no placement
profile; an admin must set one"* (`lifecycle/compose-dispatch.ts:79-80`). Combined with §3.2 —
where a worker older than its ten-minute code route can obtain **no session at all** — the single
most likely refusal in practice would have printed the single most misleading message available.
This document's own rule, quoted from 2a at `compose-dispatch.ts:43-44`, is that *a message that
points at the wrong person is worse than no message*. Writing the rule and then breaking it one
layer down is worse than not having written it.

So the input becomes the read RESULT rather than a bare model:

```ts
/** `null` = the read was NOT ATTEMPTED (the cheap-gates pass — see Step 7). */
readonly selfModelRead: SelfModelReadResult | null;
```

and the mapping is:

| `selfModelRead` | reason | log payload |
|---|---|---|
| `null` (not attempted) | `no_self_model` | `{ attempted: false }` |
| `refused{session_terminal}` | **`no_session`** | `{ readRefusal: "session_terminal" }` |
| `refused{no_profile}` | `no_self_model` | `{ readRefusal: "no_profile" }` |
| `refused{unassemblable}` | `no_self_model` | `{ readRefusal: "unassemblable" }` |
| `refused{unavailable}` | `no_self_model` | `{ readRefusal: "unavailable" }` |
| `ok{selfModel}` | — composes | — |

`unassemblable` and `unavailable` do **not** get their own tokens: both mean "the control plane
answered something this build could not use", the operator action is the same (retry, then read the
log), and a token per server misbehaviour is how a five-way refusal becomes a fifteen-way one. They
are not discarded either — the sub-reason rides in the structured log payload, so the four-way
discrimination Step 3 computes is never thrown away. `no_session`'s message names re-enrolling
**this device** and points at §3.2's ceiling; it must not mention placement profiles.

Six gates, precedence tested by switching one off at a time against an otherwise-composable input
with every earlier gate **also** off, plus a **★ POSITIVE CONTROL** that all six satisfied
composes, plus **★ a `session_terminal` result never produces a message matching `/admin/i`**.
*Mutants (8):* reorder each adjacent pair (5); collapse the two identity/profile messages; delete
the outbox gate; **map `session_terminal` to `no_self_model`** (the first draft's behaviour — this
mutant is the one that proves the paragraph above is a guard rather than a story).

### Step 5 — `AOA_WORKER_EVENT_OUTBOX_PATH`
Absent → `null`. **★ Not defaulted to a path:** a default the container cannot write turns every
existing deployment's inert boot into a failure. Whitespace is absence — `openEventOutboxStore("")`
would open an anonymous database that vanishes on restart, a durable outbox that is not durable.
*Mutants (2):* `|| null` → `?? null`; default to `"outbox.db"`.

### Step 6 — the dispatch runtime (the composition itself)

`composeDispatchRuntime` is **`async`**, and not by taste: `openEventOutboxStore` returns a
`Promise` (`events/event-outbox-store.ts:197`, async because it dynamically imports `node:sqlite`
under a warning filter). Step 7's call site therefore awaits it, which is also why it sits after
the health server rather than in the synchronous pre-socket block.

**Order is load-bearing, and four edges are not obvious:**
1. The outbox store opens **first** and is **recovered** (`uploading → pending`,
   `events/event-outbox-drain.ts:93`) before anything can emit into it. Recovering after the
   supervisor exists would race a fresh run's rows against the sweep.
2. The poll loop's `supervisor` seam is the **renewal driver**, not the supervisor. The driver is
   itself a `SupervisorSeam` decorating the real one. Wiring the raw supervisor **typechecks
   perfectly and silently never renews a lease** — every lease would expire mid-run and read as a
   server bug.
3. **★ The SAME `DurableWorkerEventSink` goes to BOTH `createSupervisor` and
   `createLeaseRenewalDriver`.** §4.1.1: the driver's `eventSink` is optional and defaults to
   `NOOP_SINK` (`lease/lease-renewal.ts:305-306`, `:342`, `:361`), so omitting it drops the
   post-close `network_denied` evidence stream with no error, no warning and no type change. One
   instance suffices — `emit` derives identity from the event
   (`events/durable-event-sink.ts:40-50`).
4. The KEK derives from the **device key**, not a new secret file, so a re-enrolled device cannot
   open a prior device's rows — they quarantine, fail closed.

`schedule: createRealRenewalSchedule()` is passed explicitly. `LeaseRenewalDriverDeps.schedule` is
**required and has no default** (`lease/lease-renewal.ts:300`); `:238` is the production
implementation (node timers + `Date.now`). It is named here because the first draft's dependency
list omitted it, and a required dep discovered at typecheck time is a dep nobody reasoned about.

**★ `redactionCanaries: []` is a decision, and the first draft's REASON for it was factually
wrong.** That draft said the field is *"read once at construction"*, so a construction-time array
"cannot carry a per-lease secret". It is read **per run**: `supervisor.ts:285` builds a fresh
`EventSequencer` on every accepted lease and reads `deps.redactionCanaries` at `:294`. A mutable
array passed at construction would in fact take effect per-lease. The conclusion happened to be
right; the argument for it was not, and an argument that does not hold is worse than none because
the next reader inherits it.

**The reason `[]` is actually safe today** is that nothing secret-bearing reaches the sequencer.
Every `events.terminal(...)` call in `supervisor.ts` passes `errorMessage: null`
(`:304`, `:314`, `:324`, `:353`, `:371`, `:381`) except `:410-411`, which emits
`signal:${exec.signal}` — a POSIX signal name. The one hook that *would* carry sandbox
stdout/stderr into the event stream is `SupervisorDeps.observeRun` (`:131`, consumed at
`:390-392`), and **this composition does not pass it** — it has zero production callers today. So
`[]` is correct because there is nothing to redact, not because of when the field is read. Step 6
asserts the composition passes no `observeRun`, which is what makes that reason a checked property
rather than a second story.

Capacity clamps to the self-model's **server-owned** provider ceiling
(`verifiedProviderConstraints.resourceCeiling`) — a worker advertising above it is rejected by the
frozen matcher, so composing without the clamp produces a worker that polls forever and is never
matched. `reserved` is zeroed deliberately: the limiter's slot counts are the backpressure
mechanism, and inventing a reservation number would be a second, weaker capacity authority.

Tests: **★ the loop's seam is the renewal driver**; **★ the driver's fence proxy emits into the
SAME durable store the supervisor does** (drive a post-close denial through
`driver.proxyFor(leaseId)` and read the row back — the assertion §4.1.1 exists for); **★ an event
the supervisor emits is DURABLE before it is drainable** (the one property neither component's own
tests can observe); **★ the outbox is recovered at composition**; **★ `redactionCanaries` is `[]`
and `observeRun` is `undefined`**; **★ `self.report` is the hello `createWorkerIdentity` built, and
`offerSatisfiesWorker` over it returns `false` for an otherwise-valid `workload.batch` offer** —
§1.1(c) made executable, and the test that fails the day someone reaches for `poll-fixtures`;
limiter ceilings from config with live slots; **★ capacity clamped**; stop order.
*Mutants (6):* `supervisor: renewal` → `supervisor`; move recovery after the sink; drop `ceiling`;
drop `kek` from the sink but keep it on the drain; **drop the driver's `eventSink`** (it compiles,
it is silent, and only the round-trip test above kills it); constant `limiter.snapshot()`.

> **★ On the mutant that was dropped.** The first draft listed a seventh — "omit
> `redactionCanaries`" — and called it a *documented equivalent*. It is not: it does not compile,
> so it never runs, and a mutant that cannot execute is not a mutant that survived. This repo's
> convention is 2a's *"26 mutants, 26 killed, 0 survivors, 0 false kills"*; counting a compile
> error inflates the denominator with something no harness evaluated — the same "a check that
> nothing runs is not a check" failure this programme keeps hitting, pointed at the mutation score
> instead of at CI. The property is real and is still proven: **the typecheck in Step 11 is its
> artifact**, and §7 row 22 now cites that.

### Step 7 — wire it into `bootstrapWorkerDaemon`
**★ The decision function is called TWICE, and that is the design.** The self-model read is an
authenticated round trip; performing it before the cheap gates would waste it and put a network
result in front of purely local decisions. But the bin must not re-implement the gate ORDER to know
when to skip — two copies of an ordering is how they drift. So the **same pure function** decides
twice: pass `selfModelRead: null` ("not attempted") first, and because both read-derived reasons
are **last** in the refusal order, a first answer of exactly `no_self_model` means every earlier
gate passed and only the read remains. `no_session` can never come out of the first call — it
requires a `refused{session_terminal}` result, which only the read produces.

**★ The identity gate takes a BOOLEAN, not the identity.** `decideDispatchComposition` is pure over
VALUES, so a `workerIdentity: WorkerIdentity | null` field would force `identityStore.load()` +
`deviceKeyFromPkcs8Der` + `createWorkerIdentity` to be constructed **above** the branch on every
boot — including every boot that then refuses with `no_provider`. §10's "zero residue" claim would
be false, and false in the direction that matters: a refusing daemon deriving a private key it will
not use. So the input mirrors what 2a already does for the reader
(`hasSelfModelReader: boolean`, `lifecycle/compose-dispatch.ts:46`):

```ts
readonly hasWorkerIdentity: boolean;
```

**And it costs no extra I/O, because the enrolment block already knows the answer.** Hoist one
`let workerIdentityPresent = false` above the `os_keychain` block and set it true on **both** exits
that imply an identity: the `outcome!` success path (`bin/worker-daemon.ts:311-323`) *and* the
survivable `EnrollmentAuthorityError && !err.minted` path (`:295-299`), which logs *"running idle
with the existing device identity"* and therefore has one. A container leaves it `false` without
touching anything — the block is never entered. **Do not** compute this with a fresh
`deps.identityStore?.load()`: that is a second read of the OS keychain per boot for a fact already
in scope, and the two could disagree.

The identity itself — the record load, the PKCS8 re-derivation, the hello, the `SessionStore` — is
constructed **inside** the `compose: true` branch, in `composeDispatchRuntime`. A test asserts that
a boot refusing with `no_provider` derives **no** device key and constructs **no** `SessionStore`,
and that a `mounted_secret` boot performs **zero** `identityStore` calls of any kind.

`composeDispatchRuntime` is `async` (Step 6), so the call site awaits it. Composing emits the
**★ WRK-010 ceiling WARN**. The loop is **not awaited** — a terminal stop does not exit the
process; the daemon stays up serving health, the same "healthy and inert" degradation every other
failure lands in, and what lets an operator see `/healthz` while diagnosing.

**★ Refuses to start when BOTH a composed runtime and an injected leasing seam exist** — two
leasing lifecycles is a double-lease hazard. Reachable only by injection, tested by injection.

`BootstrapDeps.composeDispatch?` is an **observation seam, deliberately, not a behaviour seam**: it
exists so a test can prove the composition was *not* entered, which is the only way "the shipped
binary still refuses" is falsifiable.
*Mutants (7):* delete the `reason === "no_self_model"` guard; delete the second decision;
**await the loop**; delete the WRK-010 warn; delete `drain.start()`; delete the double-lifecycle
refusal; construct the worker identity above the branch instead of inside `composeDispatchRuntime`.

> **★ How the "await the loop" mutant is killed, and why not by timeout.** The first draft killed
> it by letting the suite **time out**. A timeout is indistinguishable from a flake: it produces
> the same red, on the same job, with the same message, and the standing instruction everywhere
> else in this programme is that two identical failures mean *stop re-running and diagnose*. A
> mutation score that depends on a signal we have trained ourselves to ignore is not a score.
> Instead: inject a `run()` returning a promise that **never settles**, then assert
> `bootstrapWorkerDaemon` **resolves** while that promise is still pending (`ok: true`, a live
> `health` handle, `shutdown` callable). The mutant hangs the awaited bootstrap; the assertion
> fails deterministically at the first tick rather than at the suite deadline.

### ★ Step 8 — prove **both** shipped boot roots still refuse
Its own file, because the Wave-4 plan named this **the largest single risk in the wave**: *"composing
the loop therefore turns dispatch on unconditionally, for every daemon running that build, including
both D1 workers, the moment it merges."* 2a showed the risk did not arise because no provider could
be acquired. **2b adds the pieces that were missing, so the question is live again and deserves an
artifact rather than an argument.** The env is **read from `docker-compose.d1.yml`**, so it cannot
drift.

**★ And there are TWO roots.** The first draft of this step proved one of them. §1.1(b): the
container and the desktop stand on a different number of gates, so a suite that exercises only
`bootstrapWorkerDaemon({env, proc})` proves nothing about the root that ships in the installer.

**8a — the container root** (`packages/worker-daemon/src/__tests__/shipped-binary-refuses.test.ts`).
Cases: the REAL production invocation refuses (`composeDispatch` spy at 0 calls); `it.each` over
both D1 workers, refusing with **exactly** `["no_provider"]`; **D1 with the flag FORCED ON still
refuses** (the counterfactual the plan asked for); **D1 + a provider + the flag STILL refuses** —
`no_worker_identity`, because the third gate is `mounted_secret` with no injected stores, exactly
how both D1 workers are configured (`docker-compose.d1.yml:312`, `:348`); **★ POSITIVE CONTROL** —
the SAME spy IS called once every gate is satisfied, without which all four refusal assertions
would pass against an unreachable spy and "provably inert" would be indistinguishable from "never
wired".
*Mutants (3):* move the provider gate below identity; default `composeDispatch` to a no-op;
hardcode `d1WorkerEnv` instead of parsing (add a fixture assertion that the parsed env contains
`AOA_WORKER_KEY_STORE_MODE: "mounted_secret"` — a hardcoded env would be a fixture asserting itself).

**★ 8b — the desktop root**
(`packages/worker-keystore/src/__tests__/desktop-host-refuses-dispatch.test.ts`; §5 explains why it
cannot live beside 8a). `runDesktopHost` already injects its `bootstrap`
(`DesktopHostDeps.bootstrap?`, `bin/desktop-host.ts:81`), so the whole root is drivable without a
process.

Cases:
- **`runDesktopHost` DOES pass both custody stores** — the fact §1.1(b) turns on, asserted rather
  than cited: spy on `deps.bootstrap`, assert `identityStore` and `receiptStore` are both present
  and are the objects built from `resolveVaultRefs`. Without this, every assertion below is about a
  host that may have stopped injecting them.
- **`runDesktopHost` passes NO `provider`** — `"provider" in call` is `false`. This is gate 1, and
  on this root gate 1 and the flag are the *only* two gates.
- **the composed spy is at 0 calls** for a realistic desktop env (`os_keychain`, no
  `AOA_WORKER_DISPATCH_ENABLED`) driven through the REAL `bootstrapWorkerDaemon` with the real
  stores — refusing with **exactly** `no_provider`.
- **flag FORCED ON, real stores, still refuses** with `no_provider` — the counterfactual that
  proves the desktop's remaining gate is the provider and nothing else.
- **★ POSITIVE CONTROL** — inject a provider *and* the flag and the same spy IS reached. This is
  the load-bearing one: it is the executable statement that **the desktop is two gates from live
  dispatch**, so the day DEP-010 lands a provider in this root, this test's positive control is
  already describing production.
- a control command (`status`) and `--reset-identity` each return **without** calling `bootstrap`
  at all (`bin/desktop-host.ts:132-160`, `:164-245`) — the two argv paths that must never fall
  through to a boot.

*Mutants (3):* make `runDesktopHost` pass `provider: someProvider`; delete the `identityStore`
argument from the `bootstrap` call; let the `control` branch fall through to `bootstrap` instead of
returning.

### Step 9 — the two declaration guards

**9a — the D1 declaration guard.** `scripts/d1-dispatch-expectation.json` declares each D1 worker's
expected dispatch state with a reason. The checker parses `docker-compose.d1.yml` and fails on
**either** divergence direction — declared off but set, **or** declared on but absent. Both matter:
a guard that only caught accidental enabling would let a *deliberate* enable land silently once the
declaration flipped, then quietly regress. This is the plan's *"D1 must enable it in its own compose
file as a separate, attributable change"* made mechanical.

> **★ It must declare ALL FOUR gates, not just the flag.** §8's reason 2 ("no provider is injected")
> is thinner than it reads, and the compose file already shows why:
> `AOA_WORKER_PROVIDER_URL: "http://fake-provider:8080"` is **already set on both D1 workers**
> (`docker-compose.d1.yml:304`, `:343`), pointing at a live `fake-provider` service — and today
> **nothing in the repository reads that variable** (a full-tree grep finds only those two compose
> lines). So the day DEP-010's composition root reads it, D1's gate 1 flips **with zero diff to
> `docker-compose.d1.yml`**, and a checker that parses only `AOA_WORKER_DISPATCH_ENABLED` stays
> green through it. A guard whose green survives the event it exists to catch is not a guard.
>
> The declaration therefore carries a row per gate per worker — `dispatchEnabled`,
> `providerUrl`, `keyStoreMode`, `eventOutboxPath` — each with the expected value and a reason, and
> the checker fails on any divergence in either direction. `providerUrl: "http://fake-provider:8080"`
> is declared **present and inert**, with the reason saying exactly that: *set, unread by any code
> today, and the first thing to re-examine when DEP-010 lands*.

**★ 9b — the boot-roots guard** (`scripts/check-boot-roots-provider-free.mjs`). Step 8b proves the
desktop root passes no provider *at this commit*; this makes it a standing property. The checker
enumerates the repository's `bootstrapWorkerDaemon` call sites — today `bin/worker-daemon.ts:398`
and `bin/desktop-host.ts:254-260` — and fails if any of them passes a `provider` key, **or** if a
call site appears that the declaration does not name. The second half is the important one: a
third boot root added quietly is exactly how a two-gate root becomes a zero-gate one, and an
enumeration that silently ignores what it has not seen before is the "empty result set = pass"
failure mode this repo has hit five times. It is declaration-based for the same reason
`check-guard-inventory.mjs` is: inferring "does this file construct a provider" from source is a
hard inference done badly, while verifying a short declared list against the tree is a cheap one
done well.

Both are registered in `scripts/guard-inventory.json` and invoked from the `policy` job.
*Mutants (6):* 9a — invert each direction (2); return `ok` on an unparseable compose file (an empty
result set must be a broken checker, per the TRACK-001 convention); check only `dispatchEnabled` and
ignore the other three declared gates. 9b — pass on an unreadable source file; accept an
undeclared call site.

### Step 10 — the gate-clause register (**this fails the build if skipped**)
`check-gate-clause-wiring.mjs` treats `unwired_but_now_has_caller` as an **error**, so the moment
Step 6 lands, `createPollLoop`, `createSupervisor` and `createEventOutboxDrain` have production
callers and the guard fails. The register is edited **in the same commit**: `E4-1`, `E4-2`, `E4-4`
→ **`wired`**; `E4-3` stays `unwired` with its reason rewritten per §4.2.

**The nuance goes in the reason fields, not hidden.** That guard's header is explicit that a count
> 0 is *"NECESSARY BUT NOT SUFFICIENT for reachability"*. Here it means "reachable from a boot
root", **not** "runs by default" — dispatch is still off by construction. `E4-1`'s reason will say
so, enumerate the six refusal gates, and — ★ because §1.1(b) makes it materially different per root
— state that the CONTAINER holds four of them and the DESKTOP holds two. A reason field that
averaged the two roots into one number would be the same class of half-truth as the
`unwired_but_now_has_caller` error this guard exists to raise.

### Step 11 — mutation sweep, inventories, result doc
`check-test-inventory.mjs --write` (it must pick up the **keystore-package** test from Step 8b, not
only the daemon ones); the **51** mutants above **plus 2a's 26** must all still die —
4+6+6+8+2+6+7+(3+3)+6 by step, every one of them a mutant that COMPILES and RUNS and is killed by
an ASSERTION rather than by a suite deadline (see Step 6's and Step 7's notes); typecheck **as the
named artifact for §7 row 22**, since `SupervisorDeps.redactionCanaries` being required is a
type-level property and the typecheck is the thing that evaluates it;
`check-worker-daemon-boundary.mjs` (the new daemon files import only `node:os`, `node:fs`,
`node:crypto` and relative modules) and `check-worker-keystore-boundary.mjs` for the keystore side;
`check-worker-path-parity.mjs` — unchanged and now backed by a **live component test** (Step 3's
sixth mutant); the two new guards from Step 9 run in `policy`. **Do not bump
`docker/d1/campaign.env`** — no `server/src` file changes in this slice. Result doc §1 states the
WRK-010 ceiling; §2 states §1.1(c) **including the worker-side self-check**; §3 states the desktop
root's two-gate posture from §1.1(b).

---

## 7. Acceptance table — clause → the test that proves it

| # | Clause | Proving artifact |
|---|---|---|
| 1 | flag stays default-OFF | `dispatch-flag-config.test.ts` (2a) + `compose-dispatch.test.ts` |
| 2 | **the CONTAINER root still refuses** | `shipped-binary-refuses.test.ts` (8a) + the spy at 0 calls |
| 3 | …and the refusal is not vacuous | its **★ POSITIVE CONTROL** |
| 4 | both D1 workers refuse on their real compose env | `it.each(["worker-a","worker-b"])`, env parsed from the compose file |
| 5 | D1 cannot be enabled without an attributable change **on any of the four gates** | `check-d1-dispatch-declared.mjs` (9a) + its self-test |
| 5b | ★ **the DESKTOP root still refuses, and passes no provider** | `desktop-host-refuses-dispatch.test.ts` (8b) — spy on `deps.bootstrap`, `"provider" in call === false`, composed spy at 0 calls |
| 5c | ★ …and it stays that way | `check-boot-roots-provider-free.mjs` (9b) — declared call sites, both directions |
| 5d | ★ **the desktop's remaining gate count is stated, not implied** | 8b's positive control (provider + flag ⇒ composed) + §1.1(b) + §2's per-root column |
| 6 | `no_self_model_reader` retires | `compose-dispatch.test.ts` "the placeholder reason is GONE" |
| 7 | `hasSelfModelReader` becomes real | `dispatch-composition-2b.test.ts` read-attempted + its negative twin |
| 7b | ★ the identity gate leaves **zero residue** on a refusing boot | Step 7's `hasWorkerIdentity` boolean (derived from the enrolment outcome, not a second store read) + "no key derived, no `SessionStore`" on a `no_provider` refusal + zero `identityStore` calls under `mounted_secret` + Step 7 mutant 7 |
| 8 | `client.selfModelRead` acquires a caller | `self-model-read.component.test.ts` — real socket, real proof, branded result |
| 8b | ★ **the composed `self.report` is the PRODUCTION hello** | Step 2's equality-against-`buildDesktopHello` test + Step 6's `offerSatisfiesWorker === false` test |
| 9 | the proof is signed over the served path | same suite + parity guard + Step 3 mutant 6 |
| 10 | a tampered profile fails closed | same suite |
| 11 | a failed read leaves the daemon healthy and inert (2a Q3) | `dispatch-composition-2b.test.ts` |
| 11b | ★ a dead session is reported as `no_session`, never as "ask an admin" | Step 4's precedence test + the `/admin/i` assertion + Step 4 mutant 8 |
| 12 | **E4 clause 1** — leases through the protocol | `dispatch-runtime.test.ts` + `E4-1: wired`. ★ **Reachability only** — row 8b records that the composed worker self-rejects every offer (§1.1c) |
| 13 | **E4 clause 2** — supervises only sandboxes | `dispatch-runtime.test.ts`: `createSupervisor` is composed with the injected provider and NO `observeRun`, and the loop's handoffs reach it through the driver (Step 6 mutant 1) + `E4-2: wired` |
| 14 | **E4 clause 4** — replays its encrypted outbox | durable-before-drainable + recovered-at-composition + `E4-4: wired` |
| 14b | ★ the renewal driver's denial events reach the SAME durable store | Step 6's `proxyFor` round-trip test + Step 6 mutant 5 |
| 15 | **E4 clause 3** — survives restart | **DEFERRED**, §4.2; stays `unwired`; ONE blocker (`leaseCandidates`); finding filed |
| 16 | the renewal driver decorates, not replaces | Step 6 mutant 1 |
| 17 | capacity clamped to the server-owned ceiling | `dispatch-runtime.test.ts` |
| 18 | shutdown stops leasing before draining | stop-order test |
| 19 | WRK-010's ceiling surfaced at boot | the WARN test |
| 20 | WRK-010's integration surface is one thunk | `worker-identity.test.ts` |
| 20b | ★ the renewal code is read lazily and never logged | `worker-identity.test.ts` — `readCode` spy at 0 calls at construction, 1 on first `get()`, I13 assertion |
| 21 | every new guard mutation-checked | **51** mutants, all compiling, all executed, none killed by timeout; recorded in the result doc |
| 22 | `redactionCanaries: []` is a decision | the **typecheck** (Step 11) — a required field is a type-level property; the first draft cited a non-compiling "mutant", see Step 6's note |
| 22b | ★ …and it is safe for the stated reason | Step 6's `observeRun === undefined` assertion |
| 23 | the E4-D01 boundary holds | `check-worker-daemon-boundary.mjs` + `check-worker-keystore-boundary.mjs` |

---

## ★ 8. THE D1 QUESTION, ANSWERED DIRECTLY

> *"Composing the loop changes what the D1 lane observes. What does D1 see, and does anything need
> re-baselining?"*

**D1 sees nothing change, and nothing needs re-baselining.** Five independent reasons, each verified,
each with an artifact:

1. **`AOA_WORKER_DISPATCH_ENABLED` is absent from `docker-compose.d1.yml`** (`worker-a` `:296-313`,
   `worker-b` `:338-349`) → strict parse → `false`. *Artifact:* Step 9a's declaration guard.
2. **No provider is injected, and `no_provider` refuses first.** *Artifact:* Step 8a row 2.
   **★ This reason is thinner than it reads — see the second caveat below.**
3. **Both D1 workers have no device identity** — `AOA_WORKER_KEY_STORE_MODE: "mounted_secret"`
   (`:312`, `:348`) with no injected stores, so the enrolment block (`bin/worker-daemon.ts:267`) is
   never entered. *Artifact:* Step 8a's last case — provider **and** flag both forced on, and it
   **still** refuses. ★ This is the reason that **does not** transfer to the desktop root (§1.1b).
4. **They never enrolled**, so there is no baseline of daemon-originated traffic to shift.
   `tests/d1/e6f-03-networked-smoke.test.mjs:8-9` says it outright: *"There is NO live worker-daemon
   loop — the harness plays the worker with HTTP calls + real proofs."* That stays true.
5. **Even a fully unlocked D1 worker would be offered nothing, and would reject an offer if it
   were** (§1.1c — both the server-side snapshot gap and `poll-loop.ts:538`).

**★ SCOPE, stated because the first draft of this section did not.** Every reason above is about the
**containerised** boot root. Reason 3 is false for `aoa-worker-desktop`, which injects both custody
stores on every boot (§1.1b). "D1 is safe" and "the shipped software is safe" are different claims;
this section makes the first, and §2's per-root column makes the second honestly.

**What WOULD change D1's observations:** enabling dispatch there requires **four** simultaneous
changes — the flag, a provider-bearing composition root in the worker image (DEP-010), OS-custody
stores + a real enrolment (`mounted_secret` → `os_keychain`), and an outbox path on the existing
`d1-worker-*-state:/worker` volume. Not a diff anyone lands accidentally, and Step 9a makes **all
four** reviewable and attributable.

### The honest caveats

**(i) The provider gate can flip with no compose diff at all.**
`AOA_WORKER_PROVIDER_URL: "http://fake-provider:8080"` is **already set on both D1 workers**
(`:304`, `:343`) and points at a live `fake-provider` service that D1 depends on for health. Today
**no code reads that variable** — a full-tree grep finds those two lines and nothing else. The day
DEP-010's composition root reads it, D1's gate 1 flips with a diff to `packages/` and none to
`docker-compose.d1.yml`. That is why Step 9a's declaration covers all four gates rather than the
flag alone: a checker that parsed only `AOA_WORKER_DISPATCH_ENABLED` would have stayed green
straight through the event it exists to catch.

**(ii) If a live daemon ever enrolled on D1, the collision is at ENROLMENT, not at offer-matching.**
The first framing was "a live daemon and the harness would compete for the same offers". The
mechanism is sharper and worse than competition. `findWorkerForBinding` scopes by
`(scope, organizationId, ownerUserId, executionTargetId)` — **per target, not per worker id**
(`server/src/services/worker-enrollment.ts:410-415`) — and then:

- if a worker is already bound to that target and its id differs from the incoming hello's, the
  enrolment is refused outright as `worker_transfer_denied` (`:418-423`) — and
  `findWorkerForBinding` carries no status predicate, so that refusal is permanent;
- if the target is unbound, `insertWorker` takes the binding and writes
  `profileSnapshot: request.hello` (`:459-474`, snapshot at `:470`); a rotation writes it at `:444`.

So a daemon minting a fresh `randomWorkerId()` (`enroll-once.ts:221`) against a target the harness
already holds is **denied**, and against a target the harness has not yet claimed it **takes the
binding and installs the unmatchable desktop hello as that target's `profile_snapshot`** — after
which the harness's own enrolment is denied. Either way the failure is a red at enrol, not a flaky
offer count.

This does not arise today for a further, independent reason: neither D1 worker mounts anything at
`/enrollment-code`, so `readEnrollmentInput` could not produce a code even if gate 3 were open. The
suites are also insulated in practice — E6F-03 seeds fresh per-run ids (`newScenarioIds()`,
`e6f-03-networked-smoke.test.mjs:67`) rather than reusing the compose targets. Recorded so that the
day DEP-010/D1 decides to run a live daemon there, the cost is a known one rather than a surprising
red, and so that nobody re-derives "they just compete for offers" from the earlier framing.

---

## 9. Findings — ALREADY FILED, not filed by this slice

| Id | Severity | Statement |
|---|---|---|
| `E4-F009` | MED | **`createStartupReconciler` is not composable at boot — for ONE reason.** `leaseCandidates` (`supervisor/startup-reconcile.ts:256-257`) has no durable local source: the outbox persists events, not offers, so the lease-authority probe would run over `[]` every boot. `ownershipSelector.organizationId` is **NOT** a blocker — it is on the self-model this slice reads and the frozen schema guarantees it non-null for org- and owner-scoped targets (`worker-protocol/src/capabilities.ts:307-321`); wiring is conditional on scope, not impossible. E4 clause 3 waits on a durable lease-candidate source. |
| `E4-F010` | HIGH | **A composed worker cannot be offered work — and would refuse it if it were.** *Server side:* `workers.profile_snapshot` has no update channel (only writers `worker-enrollment.ts:444,470`). *Worker side:* `poll-loop.ts:538` runs `offerSatisfiesWorker` over the worker's OWN `self.report`, and the only production hello builder emits `sandbox.*` capabilities with a 64-zero `policyHash` (`enrollment/desktop-hello.ts:144`, `:154`) — so the self-check returns `false` for **100% of offers**, independently of anything the server does. A worker can assemble a perfect self-model, self-check correctly, and dispatch nothing, forever. MIG-005/006/007 ACTIVE inherit this on top of E4-F007. |
| `E4-F011` | HIGH | **The desktop boot root is two gates from live dispatch, not four.** `worker-keystore/src/bin/desktop-host.ts:114-125` builds both OS-custody stores and `:254-260` passes them on every boot; `resolveCustody` (`identity/device-identity-store.ts:128-133`) makes `mounted_secret` + stores a fatal refusal, so **any desktop host that boots is running `os_keychain` with custody present** and `bin/worker-daemon.ts:267` is entered. Only `no_provider` and the flag remain. DEP-010 must not land a provider in that root without an explicit decision about the flag's default on desktops. **Owner: DEP-010.** |

**★ These three were filed into `docs/replatform/epics/E4-worker-daemon/findings.md` at planning
time, not deferred to execution**, with entries in `scripts/finding-ownership.json`. They are facts
about the tree as it stands today, and this programme's own worst failure mode is a HIGH that was
noticed, written into a design document, and never reached a register where anything could fail
because of it. E4-F009 and E4-F011 are `owned` (WRK-008 and DEP-010). **E4-F010 is `unowned` on the
record** — neither half of it is fixed by any ticket now in the graph, and force-fitting it onto this
slice would be exactly the false claim of ownership the guard exists to prevent. Do not close it by
shipping 2b.

---

## ★ 10. Rollback — turning dispatch back off in one step

**Unset `AOA_WORKER_DISPATCH_ENABLED`** (or set `0`). `decideDispatchComposition` returns
`dispatch_disabled`, no runtime is composed, no loop runs, no outbox is opened, and the shutdown step
list degrades to exactly the pre-2b `[health-server]`. One restart. No rebuild, no redeploy, no data
unwind.

| Depth | Action | Effect | Cost |
|---|---|---|---|
| **1** | unset the flag, restart | identical to a 2a-era boot | one restart |
| 2 | the composition root stops passing `provider` | `no_provider` regardless of env | a host redeploy |
| 3 | revert the commit | tree returns to 2a; `E4-1/2/4` back to `unwired` | a build |

**Why the flag is a genuine rollback rather than a partial one.** Composition is the *last* thing boot
does before signal registration, and everything it builds is constructed **inside**
`composeDispatchRuntime` and reachable only through the returned handle. Nothing is constructed above
the branch and nothing is registered outside it, so `compose:false` leaves **zero residue**. The one
durable artefact, the SQLite outbox file, is only *opened* inside the branch; a rolled-back daemon does
not touch it and a re-enabled one recovers it rather than discarding it.

> **★ "Zero residue" is a claim Step 7 has to EARN, and the first draft of this document would have
> made it false.** `decideDispatchComposition` is pure over VALUES. Had the identity gate taken a
> `workerIdentity: WorkerIdentity | null`, the record load, the PKCS8 re-derivation and the
> `SessionStore` would all have been built **above** the branch on every boot — including boots that
> immediately refuse with `no_provider`. A refusing daemon would be reading its device key off the
> custody store for nothing, and §10 would be describing a shape the code did not have. Step 7
> passes `hasWorkerIdentity: boolean` instead — mirroring 2a's own `hasSelfModelReader`
> (`lifecycle/compose-dispatch.ts:46`) — and constructs inside the branch, with a test asserting
> zero `identityStore.load()` calls past the presence probe on a refusing boot. The claim above is
> true because of that choice, not in spite of it.

**What rollback does NOT undo:** an event batch already ACKed by the control plane. That is correct —
those events are the record of work that actually ran.

---

## 11. Out of scope, stated

- **The composition root (DEP-010).** 2b ships the seam. ★ It also ships `E4-F011`: DEP-010 owns the
  decision about what the flag defaults to on a desktop root that has only ever had two gates.
- **Session renewal (WRK-010).** 2b names the seam and warns about the ceiling. ★ It also inherits
  §4's admission that the composed daemon re-reads an enrolment code at arbitrary later times —
  WRK-010's device-proof renewal is what retires that, not only the 15-minute ceiling.
- **The startup reconciler** — §4.2, ONE named structural blocker (the second was withdrawn on a
  re-read of the frozen schema).
- **A matchable worker hello / a `profile_snapshot` update channel** — §1.1(c), filed as `E4-F010`.
  This slice deliberately composes the *unmatchable* production hello rather than something that
  would make the acceptance table green.
- **DAT-008 slice 5.** Between 2b and slice 5 a composed daemon starts a CLI with **no credential**
  and the run fails auth. Both the distributed flag and the rollout dial are default-off, so there is
  no production exposure — but the intermediate state is real, and the result doc says so rather than
  leaving it implied.
- **The per-run canary registry** — `redactionCanaries` stays `[]` and stays typed out.
