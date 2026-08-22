# REL-004 Lane D — reconcile active provider resources on kill (clause 3b) · design

**Ticket** REL-004 · **Clause** 3b · **Epic** E11 · **Branch** `docs/replatform-program` (PR #323)
**Terrain** [`REL-004-lane-D-terrain.md`](./REL-004-lane-D-terrain.md) — read it first; this design
only makes sense against it.
**Depends on** Lane C ([result](./REL-004-lane-C-result.md)), landed and CI-green.

**Goal:** when a provider is killed, its active resources are accounted for and the ones the
control plane can actually reclaim *are* reclaimed — without contradicting Lane C's guarantee that
in-flight work finishes.

**Architecture:** the warm-sandbox reaper — the only scheduled force-kill in the system, already
running, already the owner of the claim→kill sequence — learns to read the kill-switch document
and treat a killed provider's paused leases as immediately reclaimable instead of waiting out the
idle TTL. MIG-008's reconciler stops stranding the rows that path depends on. Nothing new is
scheduled, no new grant is taken, and the distributed platform's limit is stated rather than
faked.

---

## 1. The design is small because the terrain says most of it is impossible

Three families of "active provider resource", and only one is reclaimable by the control plane.

| Family | Can the control plane reclaim it? | Why |
|---|---|---|
| Distributed sandboxes (worker-side) | **No, by construction** | `server/package.json` declares `@armyofagents/worker-protocol` **only** — no worker-daemon, no sandbox provider — so there is no provider API to call. `leases` carries `providerConstraintHash` (a policy digest) and **no sandbox id**, so there is no handle to release. Verified directly. |
| Legacy E2B leases, **live/active** | **No, and must not** | Lane C's I12 pins that in-flight work finishes; MIG-008's Invariant #2 says the same. Killing these is the failure, not the feature. |
| Legacy E2B leases, **paused** | **Yes — and this is the whole ticket** | `warm-sandbox-reaper.ts` already force-kills them via `releaseRunLease(forceDestroy)`, on a 5-minute schedule, on the owner `db` handle. |

So clause 3b is not "build a reconciler". It is: **make sure a kill does not break the one reclaim
path that exists, and make that path act promptly for a killed provider.**

## 2. Decisions

**D1 — The warm-sandbox reaper is the owner. Nothing new is scheduled.**
It is already the only scheduled force-kill (`index.ts:1292`, 5-minute interval, gated on
`enableWarmSandboxReaper`); it already performs exactly the claim→kill sequence this ticket needs
(`expireLeaseIfPaused` as a CAS latch, *then* `releaseRunLease(forceDestroy)`); it runs on the
owner `db` handle, so it needs **no `aoa_app` grant** — and terrain §2.3 showed
`environment_leases` has none and getting one costs the 21-surface coupling dance Lane C just paid.
It is also flag-independent, which matters: terrain §2.1 showed a poll-triggered reconcile would
run over a structurally empty set on any deployment that has E2B sandboxes but no distributed
fleet.

**D2 — For a killed provider, the idle grace period is zero.**
`listPausedLeasesOlderThan(cutoff)` waits out the instance idle TTL (~30 min). That is the right
default for a merely-idle snapshot and the wrong one for a provider an operator has just declared
compromised. For a killed provider the cutoff becomes "now": the same query, the same kill, no
grace. `environment_leases.provider` is on the row (the reaper already filters on it via
`notInArray(..., NON_SANDBOX_LEASE_PROVIDERS)`), so scoping is direct.

**D3 — Fix MIG-008's orphan, minimally, and do not touch its classification.**
Terrain §1: `casClaimPaused` flips `paused → expired` with `cleanupStatus: 'pending'` and does not
kill, while the reaper selects *exclusively* `status = 'paused'` — so a claimed row leaves the only
reclaim path forever, sandbox still running.

The CAS is load-bearing for MIG-008's own correctness (it is what stops a concurrent warm-resume
from resuming a lease the crosswalk has called terminal), so removing it is wrong. Killing inside
the store seam is also wrong — it is a DB seam, and MIG-008 deliberately has no provider dependency.

The minimal correct fix is to make the reclaim path able to see the post-CAS state: the reaper
additionally sweeps rows that are `expired` **and** `cleanup_status = 'pending'` **and** still
carry a `provider_lease_id`. That is precisely the set "terminally reconciled, never killed", it
is exactly what the reaper exists for, and it also cleans up any rows a future MIG-008 run creates.

*Rejected:* teaching MIG-008 not to claim (changes reviewed, mutation-tested classification
semantics); killing in `casClaimPaused` (puts provider IO in a DB store and contradicts its own
documented contract).

**D4 — The distributed limit is STATED, not simulated.**
No code will pretend to reclaim a distributed sandbox. Clause 3b's result doc says plainly that
the control plane holds no handle, that stopping placement (3a) plus draining (3a/I12) is the
whole of its distributed authority, and that reclaiming a leaked distributed sandbox belongs to
CLI-004's provider-side sweep running **on the worker**. Terrain §1 also records that whether that
sweep can even see a *legacy*-created sandbox is unverified — that question is called out, not
answered by assertion.

**D5 — Reuse the Lane C reader verbatim.**
The reaper reads the same `instance_settings.kill_switches` document through the same
`createKillSwitchPolicyReader`, and evaluates with the same `evaluateKillSwitches`. One document,
one evaluator, one vocabulary. But note D6 — the *verdict* is not the right input here.

**D6 — The reaper keys on the SWITCH LIST, not on a `killed` verdict.**
Terrain §2.2: `evaluateKillSwitches` returns `{killed:true, dimension:null, value:null}` for an
unreadable document — including on a transient database error — and the same shape for every
template switch. Fail-closed is right for *leasing*; it is fail-**destructive** for a reaper. So
the reaper needs to answer a different question: *"which provider values has an operator
explicitly killed?"* That is a new, narrow, pure accessor over the same document
(`killedProviders(document)`), which returns a set and returns **empty** for an absent, malformed
or unreadable document. Refusing to reclaim is the safe direction here, exactly inverted from
leasing, and that inversion is the single most important thing in this design.

---

## 3. Invariants

| # | Invariant | Proven by |
|---|---|---|
| J1 | A killed provider's PAUSED legacy leases are force-killed without waiting out the idle TTL | reaper unit + integration |
| J2 | A live/active legacy lease is never killed by this path, killed provider or not | reaper unit, both directions |
| J3 | An unreadable, malformed or absent kill-switch document reclaims NOTHING (inverted from leasing, deliberately) | `killedProviders` unit, incl. the read-failure sentinel |
| J4 | A row stranded by MIG-008 (`expired` + `cleanup_status='pending'` + live handle) is reclaimed | reaper unit + a regression test that reproduces the strand |
| J5 | An unkilled provider's behaviour is byte-for-byte unchanged (idle TTL still applies) | reaper unit, non-vacuity |
| J6 | No new grant, no new migration, no new scheduled loop | the diff; `job-control-legacy-grants.contract.test.ts` frozen pins stay green |
| J7 | The control plane attempts no distributed-sandbox reclaim | structural test: the reaper and any new module import no provider package |
| J8 | Reaping is idempotent under repeated sweeps while the switch stays thrown | integration, two consecutive sweeps |

Every guard mutation-tested, per the standing process.

---

## 4. Out of scope, stated as limits

- **Reclaiming distributed sandboxes.** Impossible from the control plane (§1). Belongs to
  CLI-004's provider-side sweep, worker-side.
- **Whether CLI-004's sweep can see a legacy-created sandbox.** Terrain §1 flags it as unverified.
  Answering it needs the keyed real-E2B lane and an operator's key (programme limit D2).
- **A write path or UI for throwing a switch.** Still REL-001/005, unchanged from Lane C.
- **Widening the grant-option ACL sweep to the ten relations it still omits** — recorded in Lane
  C's result §4.2, not this ticket.
- **A per-provider reclaim for `pooled_gvisor`.** The reaper's `NON_SANDBOX_LEASE_PROVIDERS`
  filter and the gVisor pool's own lifecycle are a separate question; this lane covers the E2B
  family the kill switch was written for.
