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
`compose: true` branch **reachable**: it threads a device identity and a live session through
boot, calls `client.selfModelRead` (zero callers since 2a), assembles the `WorkerSelfModel`, and
constructs the durable event outbox, the supervisor, the lease-renewal driver and the poll loop
behind the existing default-OFF flag. After this slice `createPollLoop` and `createSupervisor`
have their **first production callers in the programme's history**.

**It does not turn dispatch on.** Every gate that holds today still holds for the shipped binary,
and §8 proves that with an executable artifact rather than a paragraph.

---

## ★ 1. Verified state — where slice 2a actually left the tree

| # | Fact | Evidence |
|---|---|---|
| 1 | `bootstrapWorkerDaemon` composes **no** loop; the real invocation injects nothing | `bin/worker-daemon.ts:398` |
| 2 | `compose: true` is **unreachable** — the decision is called with two hardcoded literals | `bin/worker-daemon.ts:337-346` (`hasSelfModelReader: false, selfModel: null`) |
| 3 | `createPollLoop` has zero production callers | `poll/poll-loop.ts:469` + one `index.ts` re-export |
| 4 | `createSupervisor` has zero production callers | `supervisor/supervisor.ts:161` |
| 5 | `client.selfModelRead` exists and has zero callers | `transport/client.ts:313` |
| 6 | `SupervisorDeps.provider` REQUIRED; `redactionCanaries` REQUIRED (no `?? []`) | `supervisor/supervisor.ts:87`, `:123` |
| 7 | `PollLoopDeps` needs client, self, key, session, limiter, measure, supervisor, backoff | `poll/poll-loop.ts:438-454` |
| 8 | The startup reconciler is gated on a dep nothing supplies | `bin/worker-daemon.ts:355` |
| 9 | The event outbox is gated the same way | `bin/worker-daemon.ts:363` |
| 10 | `AOA_WORKER_DISPATCH_ENABLED` parses strictly, defaults OFF, throws on an unrecognised value | `config/config.ts:150-162` |

### ★ 1.1 Three things the brief did not have, found by reading rather than citing

**(a) There is no production `CapacityProbes` implementation.** `poll/capacity.ts:45-50` declares
the port; its own header says *"real impl reads `node:os` / `node:fs`"*. No such implementation
exists outside tests. **`PollLoopDeps.measure` cannot be built from what is there.** Step 1 writes
the probes.

**(b) THE COMPOSED PATH HAS NO DEVICE KEY EITHER — there is a FOURTH gate, not three.**
`MountedSecretKeyStore` (`identity/key-store.ts:61`) is constructed **nowhere** outside tests. The
only boot path yielding a device key is the enrolment block, gated on
`keyStoreMode === "os_keychain" && deps.identityStore && deps.receiptStore`
(`bin/worker-daemon.ts:267`) — three conditions the shipped `{env, proc}` invocation satisfies
zero of. And `enrollOnce` **deliberately discards the session**
(`enrollment/enroll-once.ts:310`, I13) because `EnrollResult` is a plain literal containing
`session.token` and one `logger.info({ result })` would log a live bearer token.

So "thread a SESSION so `selfModelRead` can be called" is not passing a value along: **no session
exists after boot, by design.** §4 says where it comes from without regressing I13.

**(c) A composed worker still cannot be OFFERED work, and that is not this slice's to fix.** The
only production hello builder is `buildDesktopHello`, whose header says it exists to emit a
desktop that *"can never be matched work"* (`enrollment/desktop-hello.ts:7-8`): its
`reportedCapabilities` carry no `workload.*` name, so `ceiling ∩ reported` can never contain the
capability the frozen matcher requires, and its `policyHash` is 64 zeros. Server-side the matcher
runs over `workers.profile_snapshot`, whose only writers are `worker-enrollment.ts:444,470` —
**there is no update channel.** This is a fifth inertness, it is structural, and this slice states
it rather than letting "dispatch composed" be read as "dispatch working". Filed as a finding (§9).

---

## ★ 2. The flag stays default-OFF, and it now has company

| # | Gate | Fixed by | Reachable for the shipped binary? |
|---|---|---|---|
| 1 | a `SandboxProvider` was injected | DEP-010 | **no** — E4-D01 makes it unconstructable here |
| 2 | `AOA_WORKER_DISPATCH_ENABLED=1` | editing env | yes, but gate 1 refuses first |
| 3 | a device identity + session exists | a host injecting OS-custody stores + enrolling | **no** — §1.1(b) |
| 4 | `AOA_WORKER_EVENT_OUTBOX_PATH` is set | editing env | yes, but 1/3 refuse first |
| 5 | the target has an admin-set placement profile | an org admin | needs 1–4 first |

**The flag is still non-vacuous.** Gates 1 and 3 are structural and protect *today's* build; the
flag is what stands between "DEP-010 landed a host" and "every daemon running that build starts
taking real leases". It is reached in tests by injection, the only way it is reachable at all.

**Ordering, extending 2a's "deepest fact first."** `no_provider` and `no_worker_identity` are
BUILD/deployment facts no env edit fixes. `dispatch_disabled` is an explicit operator choice —
reporting anything past it for a worker deliberately switched off is noise.
`no_event_outbox_path` is an env edit **on this host**; `no_self_model` needs a **different
person** (an org admin). Fixable-here before fixable-by-someone-else.

**Why `no_event_outbox_path` is a refusal rather than a default.** The supervisor's `eventSink` is
required. Composing with a no-op sink would silently drop every `attempt_started`/`terminal` event
a run emits — an evidence path failing open, invisibly, in exactly the case it matters. Same
defect class that made `redactionCanaries` required rather than `?? []`.

---

## ★ 3. Dependencies — hard or soft, answered

### 3.1 DEP-010 (the provider) — **SOFT. Ships behind the flag.**
2b is provable today by injecting `createFakeSandboxProvider` at the existing
`BootstrapDeps.provider` seam. Without DEP-010 the `compose: true` branch stays unreachable in
production — the guarantee, not the gap. DEP-010's own acceptance says the same from the other
side. Neither blocks the other.

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
      ├─ SessionStore({now, renew, metrics, logger}, initial = null)
      │       └── renew: () => enroller.renew(...).session
      │                    ▲
      │                    └── ★ THE WRK-010 SEAM. One thunk. WRK-010 replaces its body with a
      │                        device-proof renewal call and changes nothing else.
      └─ createSessionProvider(store) ──► SessionProvider
             ├──► readWorkerSelfModel()   (client.selfModelRead)
             ├──► createEventOutboxDrain()
             └──► createPollLoop()
```

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
| `SessionStore` + `SessionProvider` | ✅ **NEW** | §4 |
| Self-model read + assembly | ✅ **NEW** | `selfModelRead` gets its first caller |
| `openEventOutboxStore` + `DurableWorkerEventSink` | ✅ | the sink is required; a no-op sink is a fail-open (§2) |
| `createEventOutboxDrain` | ✅ | **E4 gate clause 4** |
| `createSupervisor` | ✅ | **E4 gate clause 2** |
| `createLeaseRenewalDriver` | ✅ | it DECORATES the supervisor seam; omitting it means ACKed leases are never renewed |
| `createPollLoop` | ✅ | **E4 gate clause 1** |
| `createStartupReconciler` | ❌ **DEFERRED** | §4.2 — two structural blockers |

### ★ 4.2 The startup reconciler is DEFERRED, and the reason is a finding

E4's gate clause 3 is *"survives restart"*. Slice 2b **cannot honestly wire it**, for two reasons
that are properties of the code rather than of scope:

**(1) `OwnershipSelector.organizationId` is not constructible at boot.**
`StartupReconcilerDeps.ownershipSelector` (`startup-reconcile.ts:248`) requires
`{organizationId: string, targetId, workerId}`. The daemon learns target/worker at enrolment, but
**`organizationId` is not a property of the worker** — it arrives on a job envelope. The registered
target profile carries it, and for a platform-scoped target it is **`null`**
(`__tests__/support/poll-fixtures.ts:100-102`). `labelsMatchSelector` (`provider.ts:135`) requires
**all three** to match. Composing with a placeholder org would make `provider.list` return
nothing, the reconciler would scan zero sandboxes, report a clean pass, and be **a guard that
passes because it could not evaluate anything** — the failure this programme has now hit five
times. Deferring is strictly safer than wiring it wrong.

**(2) `leaseCandidates` has no durable local source.** Annotated *"reconstructed from durable
local state (test-injected)"* (`startup-reconcile.ts:256-257`). There is no durable lease store —
the outbox persists *events*, not offers. The lease-authority probe would run over `[]` every boot.

**Disposition.** `E4-3-survives-restart` stays `unwired` in `scripts/gate-clause-wiring.json`, its
`reason` updated to name these two blockers. A finding is filed (§9). Recorded here rather than
discovered during implementation, which is what the design pass is for.

**Partial credit is deliberately refused.** The reconciler's outbox half *is* constructible. Wiring
only that half would let the clause read as reconciling restart state while the sandbox pass — the
half the clause is about — silently did nothing. Instead Step 6 calls `drain.recover()` directly at
boot, the honest narrowly-scoped subset, attributed to **clause 4, not clause 3**.

---

## 5. Files touched

**New:** `poll/host-probes.ts` · `identity/worker-identity.ts` · `identity/self-model-read.ts` ·
`lifecycle/dispatch-runtime.ts` · `scripts/check-d1-dispatch-declared.mjs` ·
`scripts/d1-dispatch-expectation.json`

**Modified:** `lifecycle/compose-dispatch.ts` (retire `no_self_model_reader`; add
`no_worker_identity`, `no_event_outbox_path`) · `config/config.ts`
(`AOA_WORKER_EVENT_OUTBOX_PATH`) · `bin/worker-daemon.ts` (thread identity → decide → read →
decide → compose → register lifecycles) · `index.ts` (barrels) ·
`__tests__/support/fake-control-plane.ts` (the self-model route) ·
`scripts/gate-clause-wiring.json` (`E4-1/2/4` → `wired`; `E4-3` reason updated) ·
`scripts/guard-inventory.json` · `.github/workflows/pr.yml` · `scripts/test-inventory.json`

**New tests:** `host-probes.test.ts` · `worker-identity.test.ts` ·
`self-model-read.component.test.ts` · `dispatch-runtime.test.ts` ·
`dispatch-composition-2b.test.ts` · `shipped-binary-refuses.test.ts` ·
`scripts/lib/__tests__/d1-dispatch-declared.test.mjs`

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
`createWorkerIdentity({record, now, renewSession, metrics, logger})` → `{key, workerId, targetId,
deviceGeneration, session, store}`. Re-derives the key from the **persisted** bytes (the same rule
enroll-once follows, so an envelope round-trip bug surfaces on first boot rather than after the
server committed). `SessionStore` with `initial = null`.

Tests: key re-derived from persisted DER; **★ mints LAZILY** (constructing performs no renew);
**★ POSITIVE CONTROL** — the first `get()` DOES mint and returns the live session (without it,
laziness is indistinguishable from never-wired); same session while live; **★ E4-F007** — a lapsed
code route goes TERMINAL rather than spinning; a **transient** failure rethrows unchanged and the
store does **not** stop (otherwise one blip retires a worker); **★ the WRK-010 seam is ONE injected
thunk** — swapping it changes nothing else, asserted rather than promised in prose.
*Mutants (5):* fabricate an `initial` session; drop `now`; swallow the `EnrollmentError`; use
`generateDeviceKey()` instead of the persisted DER; replace `createSessionProvider` with a raw
`{get}` lacking the terminal wrap.

### Step 3 — the self-model reader (`selfModelRead` gets its first caller)
Harness first: add the self-model route to `fake-control-plane.ts`, mirroring the client's vendored
constant so the proof is verified over the **exact** path it signs — a fake accepting a proof over
a different path would hide the one failure mode the repo-level parity guard exists for.

`readWorkerSelfModel` returns a discriminated result: `ok` | `refused{no_profile |
unassemblable | session_terminal | unavailable}`. **★ NOTHING THROWS** — a daemon that throws on a
bad server response dies instead of staying up inert, which is 2a's Q3 state. **One** 401 recovery
then give up (a recover→retry→recover spin with no backoff is how a worker hammers a control plane
with a dead identity). 401/403/404 all collapse to `no_profile` **deliberately**: the route answers
the same coarse code for "no such target", "never configured", "revoked" and "stale generation" so
it is never an oracle — the worker cannot distinguish them and must not pretend it can.

Tests: **★ POSITIVE CONTROL** — a live 200 assembles a **branded** self-model; **★ the proof is
signed over the SAME path** the request is sent to (the fake verifies independently; a mismatch
401s); **★ a TAMPERED provider profile fails the brand** — refused, not degraded; a 401 asks the
provider to recover **once**; a 404 is `no_profile`, distinct from transport failure; **★ nothing
throws** on garbage.
*Mutants (6):* delete the recovery branch; delete the second attempt; change 404 → `unassemblable`;
delete the `selfModel === null` check; remove the `SessionTerminalError` rethrow; **sign over
`client.pollPath` instead of `selfModelReadPath`** — this last one dies with a 401 and is the
mutant that **proves the parity guard's premise is real rather than asserted**.

### Step 4 — retire `no_self_model_reader`; add the two real reasons
**★ The slice-2a placeholder reason is GONE.** 2a's message said this build "cannot read its own
self-model yet (WRK-008 slice 2b)". 2b threads the session, so that sentence is now false. **A
refusal message describing a state the code has left is worse than none** — it sends an operator to
wait for a slice that has landed. The token is retired, not reworded; a test asserts no message
matches `/slice 2b/i`.

**★ `no_worker_identity` is distinct from `no_self_model` — different people fix them.** A daemon
with no device identity cannot AUTHENTICATE a read at all. Reporting `no_self_model` would send an
operator to an org admin for a profile that may already be set, for a host whose real problem is
that no OS-custody store was injected — exactly the mistake 2a's §5 caught, one layer down.

Five gates, precedence tested by switching one off at a time against an otherwise-composable input
with every earlier gate **also** off, plus a **★ POSITIVE CONTROL** that all five satisfied
composes.
*Mutants (7):* reorder each adjacent pair (5); collapse the two identity/profile messages; delete
the outbox gate.

### Step 5 — `AOA_WORKER_EVENT_OUTBOX_PATH`
Absent → `null`. **★ Not defaulted to a path:** a default the container cannot write turns every
existing deployment's inert boot into a failure. Whitespace is absence — `openEventOutboxStore("")`
would open an anonymous database that vanishes on restart, a durable outbox that is not durable.
*Mutants (2):* `|| null` → `?? null`; default to `"outbox.db"`.

### Step 6 — the dispatch runtime (the composition itself)
**Order is load-bearing, and three edges are not obvious:**
1. The outbox store opens **first** and is **recovered** (`uploading → pending`) before anything can
   emit into it. Recovering after the supervisor exists would race a fresh run's rows against the
   sweep.
2. The poll loop's `supervisor` seam is the **renewal driver**, not the supervisor. The driver is
   itself a `SupervisorSeam` decorating the real one. Wiring the raw supervisor **typechecks
   perfectly and silently never renews a lease** — every lease would expire mid-run and read as a
   server bug.
3. The KEK derives from the **device key**, not a new secret file, so a re-enrolled device cannot
   open a prior device's rows — they quarantine, fail closed.

`redactionCanaries: []` is **a decision, not an omission** — which is the entire reason the field
stopped being optional. It is read **once** at construction while a Supervisor is long-lived and
multi-run, so a construction-time array **cannot** carry a per-lease secret. No secret-bearing
supervisor string exists yet, so `[]` is correct today, and DAT-008 slice 5 must make the registry
per-run before it can seed anything.

Capacity clamps to the self-model's **server-owned** provider ceiling — a worker advertising above
it is rejected by the frozen matcher, so composing without the clamp produces a worker that polls
forever and is never matched. `reserved` is zeroed deliberately: the limiter's slot counts are the
backpressure mechanism, and inventing a reservation number would be a second, weaker capacity
authority.

Tests: **★ the loop's seam is the renewal driver**; **★ an event the supervisor emits is DURABLE
before it is drainable** (the one property neither component's own tests can observe); **★ the
outbox is recovered at composition**; **★ `redactionCanaries` is `[]`**; limiter ceilings from
config with live slots; **★ capacity clamped**; stop order.
*Mutants (6):* `supervisor: renewal` → `supervisor`; move recovery after the sink; drop `ceiling`;
drop `kek` from the sink but keep it on the drain; omit `redactionCanaries` (compile error — kept
as a **documented equivalent** proving the required field does its job); constant `limiter.snapshot()`.

### Step 7 — wire it into `bootstrapWorkerDaemon`
**★ The decision function is called TWICE, and that is the design.** The self-model read is an
authenticated round trip; performing it before the cheap gates would waste it and put a network
result in front of purely local decisions. But the bin must not re-implement the gate ORDER to know
when to skip — two copies of an ordering is how they drift. So the **same pure function** decides
twice: pass `selfModel: null` first, and because `no_self_model` is **last** in the refusal order, a
first answer of exactly `no_self_model` means every earlier gate passed and only the read remains.

Composing emits the **★ WRK-010 ceiling WARN**. The loop is **not awaited** — a terminal stop does
not exit the process; the daemon stays up serving health, the same "healthy and inert" degradation
every other failure lands in, and what lets an operator see `/healthz` while diagnosing.

**★ Refuses to start when BOTH a composed runtime and an injected leasing seam exist** — two
leasing lifecycles is a double-lease hazard. Reachable only by injection, tested by injection.

`BootstrapDeps.composeDispatch?` is an **observation seam, deliberately, not a behaviour seam**: it
exists so a test can prove the composition was *not* entered, which is the only way "the shipped
binary still refuses" is falsifiable.
*Mutants (7):* delete the `reason === "no_self_model"` guard; delete the second decision; await the
loop (the suite **times out** — recorded as a kill); delete the WRK-010 warn; delete
`drain.start()`; delete the double-lifecycle refusal; register lifecycles out of order.

### ★ Step 8 — prove the shipped binary still refuses
Its own file, because the Wave-4 plan named this **the largest single risk in the wave**: *"composing
the loop therefore turns dispatch on unconditionally, for every daemon running that build, including
both D1 workers, the moment it merges."* 2a showed the risk did not arise because no provider could
be acquired. **2b adds the pieces that were missing, so the question is live again and deserves an
artifact rather than an argument.** The env is **read from `docker-compose.d1.yml`**, so it cannot
drift.

Cases: the REAL production invocation refuses (`composeDispatch` spy at 0 calls); `it.each` over
both D1 workers, refusing with **exactly** `["no_provider"]`; **D1 with the flag FORCED ON still
refuses** (the counterfactual the plan asked for); **D1 + a provider + the flag STILL refuses** —
`no_worker_identity`, because the fourth gate is `mounted_secret` with no injected stores, exactly
how both D1 workers are configured; **★ POSITIVE CONTROL** — the SAME spy IS called once every gate
is satisfied, without which all five assertions would pass against an unreachable spy and "provably
inert" would be indistinguishable from "never wired".
*Mutants (3):* move the provider gate below identity; default `composeDispatch` to a no-op;
hardcode `d1WorkerEnv` instead of parsing (add a fixture assertion that the parsed env contains
`AOA_WORKER_KEY_STORE_MODE: "mounted_secret"` — a hardcoded env would be a fixture asserting itself).

### Step 9 — the D1 declaration guard
`scripts/d1-dispatch-expectation.json` declares each D1 worker's expected dispatch state with a
reason. The checker parses `docker-compose.d1.yml` and fails on **either** divergence direction —
declared off but set, **or** declared on but absent. Both matter: a guard that only caught accidental
enabling would let a *deliberate* enable land silently once the declaration flipped, then quietly
regress. This is the plan's *"D1 must enable it in its own compose file as a separate, attributable
change"* made mechanical.
*Mutants (3):* invert each direction; return `ok` on an unparseable compose file (an empty result set
must be a broken checker, per the TRACK-001 convention).

### Step 10 — the gate-clause register (**this fails the build if skipped**)
`check-gate-clause-wiring.mjs` treats `unwired_but_now_has_caller` as an **error**, so the moment
Step 6 lands, `createPollLoop`, `createSupervisor` and `createEventOutboxDrain` have production
callers and the guard fails. The register is edited **in the same commit**: `E4-1`, `E4-2`, `E4-4`
→ **`wired`**; `E4-3` stays `unwired` with its reason rewritten per §4.2.

**The nuance goes in the reason fields, not hidden.** That guard's header is explicit that a count
> 0 is *"NECESSARY BUT NOT SUFFICIENT for reachability"*. Here it means "reachable from a boot
root", **not** "runs by default" — dispatch is still off by construction. `E4-1`'s reason will say
so and enumerate the five gates.

### Step 11 — mutation sweep, inventories, result doc
`check-test-inventory.mjs --write`; the ~43 mutants above **plus 2a's 26** must all still die;
typecheck; `check-worker-daemon-boundary.mjs` (the new files import only `node:os`, `node:fs`,
`node:crypto` and relative modules); `check-worker-path-parity.mjs` — unchanged and now backed by a
**live component test** (Step 3's sixth mutant). **Do not bump `docker/d1/campaign.env`** — no
`server/src` file changes in this slice. Result doc §1 states the WRK-010 ceiling; §2 states
§1.1(c).

---

## 7. Acceptance table — clause → the test that proves it

| # | Clause | Proving artifact |
|---|---|---|
| 1 | flag stays default-OFF | `dispatch-flag-config.test.ts` (2a) + `compose-dispatch.test.ts` |
| 2 | **the shipped binary still refuses** | `shipped-binary-refuses.test.ts` + the spy at 0 calls |
| 3 | …and the refusal is not vacuous | its **★ POSITIVE CONTROL** |
| 4 | both D1 workers refuse on their real compose env | `it.each(["worker-a","worker-b"])`, env parsed from the compose file |
| 5 | D1 cannot be enabled without an attributable change | `check-d1-dispatch-declared.mjs` + its self-test |
| 6 | `no_self_model_reader` retires | `compose-dispatch.test.ts` "the placeholder reason is GONE" |
| 7 | `hasSelfModelReader` becomes real | `dispatch-composition-2b.test.ts` read-attempted + its negative twin |
| 8 | `client.selfModelRead` acquires a caller | `self-model-read.component.test.ts` — real socket, real proof, branded result |
| 9 | the proof is signed over the served path | same suite + parity guard + Step 3 mutant 6 |
| 10 | a tampered profile fails closed | same suite |
| 11 | a failed read leaves the daemon healthy and inert (2a Q3) | `dispatch-composition-2b.test.ts` |
| 12 | **E4 clause 1** — leases through the protocol | `dispatch-runtime.test.ts` + `E4-1: wired` |
| 13 | **E4 clause 2** — supervises only sandboxes | renewal-driver test + `E4-2: wired` |
| 14 | **E4 clause 4** — replays its encrypted outbox | durable-before-drainable + recovered-at-composition + `E4-4: wired` |
| 15 | **E4 clause 3** — survives restart | **DEFERRED**, §4.2; stays `unwired`; finding filed |
| 16 | the renewal driver decorates, not replaces | Step 6 mutant 1 |
| 17 | capacity clamped to the server-owned ceiling | `dispatch-runtime.test.ts` |
| 18 | shutdown stops leasing before draining | stop-order test |
| 19 | WRK-010's ceiling surfaced at boot | the WARN test |
| 20 | WRK-010's integration surface is one thunk | `worker-identity.test.ts` |
| 21 | every new guard mutation-checked | ~43 mutants, recorded in the result doc |
| 22 | `redactionCanaries: []` is a decision | Step 6 mutant 5 (documented equivalent) |
| 23 | the E4-D01 boundary holds | `check-worker-daemon-boundary.mjs` |

---

## ★ 8. THE D1 QUESTION, ANSWERED DIRECTLY

> *"Composing the loop changes what the D1 lane observes. What does D1 see, and does anything need
> re-baselining?"*

**D1 sees nothing change, and nothing needs re-baselining.** Five independent reasons, each verified,
each with an artifact:

1. **`AOA_WORKER_DISPATCH_ENABLED` is absent from `docker-compose.d1.yml`** (`worker-a` `:297-313`,
   `worker-b` `:339-349`) → strict parse → `false`. *Artifact:* Step 9's declaration guard.
2. **No provider is injected, and `no_provider` refuses first.** *Artifact:* Step 8 row 2.
3. **Both D1 workers have no device identity** — `AOA_WORKER_KEY_STORE_MODE: "mounted_secret"`
   (`:312`, `:348`) with no injected stores, so the enrolment block is never entered. *Artifact:*
   Step 8 row 5 — provider **and** flag both forced on, and it **still** refuses.
4. **They never enrolled**, so there is no baseline of daemon-originated traffic to shift.
   `tests/d1/e6f-03-networked-smoke.test.mjs:8-9` says it outright: *"There is NO live worker-daemon
   loop — the harness plays the worker with HTTP calls + real proofs."* That stays true.
5. **Even a fully unlocked D1 worker would be offered nothing** (§1.1c).

**What WOULD change D1's observations:** enabling dispatch there requires **four** simultaneous
changes — the flag, a provider-bearing composition root in the worker image (DEP-010), OS-custody
stores + a real enrolment (`mounted_secret` → `os_keychain`), and an outbox path on the existing
`d1-worker-*-state:/worker` volume. Not a diff anyone lands accidentally, and Step 9 makes the first
of the four reviewable and attributable.

**The one honest caveat.** D1's lease-race suites drive the control plane through the harness. If
dispatch is *ever* enabled there, a live daemon and the harness would compete for the same offers and
those suites **would** need re-baselining. That is a DEP-010/D1 decision, not this slice's — recorded
so the day it arrives it is a known cost rather than a surprising red.

---

## 9. Findings this slice files

| Id | Severity | Statement |
|---|---|---|
| `E4-F0xx` | MED | **`createStartupReconciler` is not composable at boot.** `OwnershipSelector.organizationId` is a required `string` and a platform-scoped target's is `null`; `leaseCandidates` has no durable local source. E4 clause 3 cannot be wired until both are owned. |
| `E4-F0yy` | HIGH | **A composed worker still cannot be offered work.** The only production hello builder is deliberately unmatchable, and `workers.profile_snapshot` has no update channel — so a worker can assemble a perfect self-model, self-check correctly, and be offered nothing, forever. MIG-005/006/007 ACTIVE inherit this on top of E4-F007. |

Both filed per the convention `check-finding-ownership.mjs` enforces: each names an owner or
explicitly says it has none.

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

**What rollback does NOT undo:** an event batch already ACKed by the control plane. That is correct —
those events are the record of work that actually ran.

---

## 11. Out of scope, stated

- **The composition root (DEP-010).** 2b ships the seam.
- **Session renewal (WRK-010).** 2b names the seam and warns about the ceiling.
- **The startup reconciler** — §4.2, two named structural blockers.
- **A matchable worker hello / a `profile_snapshot` update channel** — §1.1(c), filed as `E4-F0yy`.
- **DAT-008 slice 5.** Between 2b and slice 5 a composed daemon starts a CLI with **no credential**
  and the run fails auth. Both the distributed flag and the rollout dial are default-off, so there is
  no production exposure — but the intermediate state is real, and the result doc says so rather than
  leaving it implied.
- **The per-run canary registry** — `redactionCanaries` stays `[]` and stays typed out.
