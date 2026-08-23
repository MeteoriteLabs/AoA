# SPIKE — can one real worker daemon receive and execute one real job?

**Status: SPIKE. Throwaway by construction.** No code produced here may merge as production.
Started from `docs/replatform-program` at `43f886bc9`, run locally against the D1 compose stack.

**The single question:** can one real `worker-daemon` process, on the real two-replica D1 stack,
receive one real job offer and execute it to a durable terminal?

**Why this exists.** Five prerequisites for that sentence have now been discovered *mid-implementation*
rather than by the plan — inherited deferral #1, E4-D12, the matchable hello, session renewal
(E4-F007), and a real `SandboxProvider` for the daemon. Three of those surfaced today. The
discovery rate is not falling, and two guards shipped this session turned out to protect states the
system cannot reach. That is the signature of building upward without a proven skeleton.

**The deliverable is a LIST, not code.** Every blocker hit, in the order hit, with what it would
cost to fix properly. That list becomes the real Wave 4 plan, sequenced on verified dependencies
instead of ticket-to-ticket edges.

---

## Rules

1. **Hacks are allowed and expected.** Hardcode the hello, stub the session, inject any provider.
   The point is to reach the next blocker, not to be correct.
2. **Nothing here merges.** Any production change this motivates gets its own ticket, terrain,
   design and review. This document and its scratch code are evidence, not implementation.
3. **Timeboxed.** If the question is not answerable within the box, *that is the answer* and the
   list of what was reached is still the deliverable.
4. **Record every blocker at the moment it is hit**, with the observed error — not a reconstruction
   afterwards. Runtime evidence beat my own reasoning twice today; reconstruction is where that
   advantage is lost.

## The path under test

```
submit job ─► placement ─► lease offer ─► worker poll ─► ack ─► supervisor ─► provider ─► events ─► terminal
                                              ▲
                                       the daemon must first
                                       enrol + build a self-model
```

Each hop is a place the skeleton can stop. The spike walks them in order and records where it does.

## Predicted blockers (stated BEFORE running, so the spike can falsify them)

Writing these down first matters: a spike that only confirms what it expected has usually just
re-read its own notes. Anything the run adds to this list is the real value, and anything it
*removes* is equally valuable.

| # | Predicted blocker | Predicted symptom | Confidence |
|---|---|---|---|
| P1 | The D1 workers never enrol (`mounted_secret` gates the enrolment block) | daemon boots, serves `/healthz`, no enrol traffic | high — verified statically |
| P2 | Nothing composes the poll loop, so no poll is ever issued | no `POST /worker-control/poll` from a worker container | high — verified statically |
| P3 | The server matches on `workers.profile_snapshot` written at enrolment from an unmatchable `buildDesktopHello` | poll answers `no_work` forever, even with a job queued and a live target | high — verified statically |
| P4 | Worker session TTL 15 min, no renewal | loop stops with `reenrollment_required` | high — documented in DSK-001 |
| P5 | Only `createFakeSandboxProvider` is importable under E4-D01 | execution "succeeds" without running anything | high — verified statically |

**What would falsify the plan's current shape:** if P3 is wrong — if a worker CAN be offered a job
with the profile mechanism as built — then WRK-008 slice 2 is close to deliverable and the descope
was unnecessary. That is the single most valuable thing this spike can find out.

## Stop conditions

- **Answered YES:** a job reaches a durable terminal attributable to a real daemon. Record every
  hack required; each hack is a ticket.
- **Answered NO:** a blocker is reached that cannot be hacked past within the box. Record it and
  everything behind it that remains unverified.
- **Timebox exhausted:** record the furthest hop reached and what was still unknown.

## Findings

### ★ F1 — The shipped worker container has NO IDENTITY MECHANISM, only a key (P1, far worse than predicted)

P1 predicted "the D1 workers never enrol because `mounted_secret` gates the enrolment block". That
is true and it is the *shallow* version. The real shape, established from source:

1. The container entry passes **no stores at all**: `bootstrapWorkerDaemon({ env: process.env,
   proc: process })` (`bin/worker-daemon.ts:353`). `docker/worker/Dockerfile:112` runs exactly that.
2. `resolveCustody` **refuses** `mounted_secret` if a store *is* injected
   (`identity/device-identity-store.ts:128-133`) — so you cannot fix (1) by injecting one.
3. And the reason it refuses is the decisive fact: *"`MountedSecretKeyStore` persists PKCS8 DER with
   **no `workerId` slot**"* (`:118-120`). The mode holds a device **key**, not an **identity**.

`workerId` / `targetId` / `deviceGeneration` are minted **by enrolment** and persisted in the
`DeviceIdentityRecord` that only the OS-custody store holds. So a `mounted_secret` container has a
keypair and nothing to be. It cannot enrol, cannot hold a session, and therefore **cannot poll —
ever, under any flag**.

**Why this matters more than the flag framing.** Every plan to date, including my own E4-D12
terrain, treated live dispatch as "compose the loop behind a flag". There is no flag that reaches
this. The shipped container needs a **provisioning path that does not exist**: either a new custody
mode that carries an identity, or enrolment made reachable for containers, or an out-of-band
identity injection. None is designed, none is owned.

**Consequence for WRK-008 slice 2:** composing the loop in the shipped container produces a daemon
that cannot get past step one. The "default OFF" gate the execution plan called a hard requirement
is not merely unprovable in D1 (already recorded) — it is *irrelevant*, because ON is unreachable.

### F2 — Only `desktop-host.ts` can enrol

`packages/worker-keystore/src/bin/desktop-host.ts:254-260` is the sole caller that injects
identity + receipt stores, and it does so with `os_keychain`. So the **only** code path in the repo
that can produce an enrolled worker is the desktop host — not the container the distributed fleet
is built from. That inverts an assumption running through the programme: the containerised fleet is
the *less* provisioned of the two paths, not the more.

## Log

**Established before the D1 stack finished building** (static, from source — recorded here because
the conclusion is structural and does not need the runtime to demonstrate it):

- P1 → **confirmed and deepened** into F1. Not a gate; an absent mechanism.
- F2 → new, not predicted.

*(runtime observations appended below as the stack comes up)*
