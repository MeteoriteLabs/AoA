# WRK-013 — A durable lease-candidate source for the startup reconciler (E4-F009 successor)

**Epic:** E4 · **Plan node:** `docs/replatform/program-design.md`, `#### WRK-013`
**Depends on:** WRK-008 slice 2b, WRK-007 · **Size:** M · **Status:** `gate_review` — built, result at `WRK-013-result.md` (★ *was `design` — task defined, not built; changed 2026-09-21 when the ticket was built*)
(★ *was `scoping`, and **Size:** (scope only); changed 2026-09-21 at M1 Step 0, S0-3, when the task was
written into the E4 implementation plan §4c against founder rulings F4 and F5*)
**Owns:** finding **E4-F009** (`epics/E4-worker-daemon/findings.md`)

---

## Why this ticket exists

WRK-008 slice 2b (Sprint 3) composes the poll loop, supervisor, renewal driver and durable event
outbox, but **deliberately does not compose `createStartupReconciler`** (E4 clause 3,
"survives restart"). §4.2 established there is ONE real blocker:
`StartupReconcilerDeps.leaseCandidates` (`supervisor/startup-reconcile.ts:256-257`) has no durable
local source — the event outbox persists **events**, not offers, so the lease-authority probe would
run over `[]` on every boot: a guard that passes because it evaluated nothing (the failure this
programme has hit five times). Reconstructing offers from the event stream is its own ticket, not a
line in a composition ticket.

The other candidate blocker was **withdrawn** on a re-read of the frozen schema:
`ownershipSelector.organizationId` **is** constructible at boot — it is a field of the registered
target profile the self-model read now surfaces, and the frozen schema's `superRefine` guarantees
it non-null for `scope === "organization"`/`"owner"` targets
(`worker-protocol/src/capabilities.ts:307-321`). So the wiring is **conditional** (available for
org- and owner-scoped targets, skipped with a named reason for platform-scoped ones), not
impossible.

It is filed **now**, at WRK-008's completion, so E4-F009 is not left `owned` by a shipped ticket —
which reads as owned by nobody and fails nothing (finding **E4-F013**). WRK-008 slice 2b's result
doc repoints E4-F009's manifest `ticket` to this id.

## What it must build (design written at sprint start, against the tree as it exists then)

A durable local lease-candidate source — a store of accepted lease offers a restarting daemon can
replay into `StartupReconcilerDeps.leaseCandidates` — so the lease-authority probe runs over real
prior state rather than `[]`. Then compose `createStartupReconciler` at boot, conditionally on
`selfModel.registeredTargetProfile.organizationId !== null`, and promote **E4-3-survives-restart**.

## Precondition — when this becomes REQUIRED, not before

When a composed daemon runs leases for real (post-Sprint-5) and a restart mid-lease is a real
operational event whose recovery must be proven. E4-F009 stays **open** (MED) until then.

## The two founder rulings this ticket builds against (2026-09-21)

Both are recorded in `docs/replatform/qa/2026-09-21-m1-execution-plan.md` §2 and were ruled as
recommended. They settle the two questions a restart-reconciler design could not settle alone.

- **F5 — a candidate the probe finds live is FENCED, not kept.** The reconciler's lease-authority
  probe (`probeLeaseAuthority` in `supervisor/startup-reconcile.ts`) calls `renewLeaseOnce` and maps
  a successful renewal to `live` (`livenessOf`) — so a "live" verdict is itself a renewal. WRK-007's
  decision D2 (`WRK-007-design.md` §4: "NEVER re-attach") forbids re-attaching to a sandbox after
  restart, and today the reconciler's `keep` disposition leaves such a sandbox in place. Keeping the lease renewed with no supervisor
  behind it is the worst of the three options, so the daemon **stops renewing** such a lease and
  lets the control plane's lease reaper (`reapExpiredLeases`, run by `createJobReconciliationService`
  in `server/src/services/job-reconciliation.ts`) end the attempt.
- **F4 — the container-path narrowing, accepted and NAMED.** On the container path a restarted daemon
  cannot enumerate orphan sandboxes: it has no process-level provider, only a per-run
  `makeRunProvider`, and the networked `list` is capability-gated, and that capability has lapsed.
  So no worker-side teardown runs there, and orphan reclamation rests on the adapter-manager reaper
  (`reconcileReaper` in `packages/adapter-manager/src/reconcile-reaper.ts`, looped by
  `startReaperLoop`). **This is a real narrowing of journey item 8's "cleanup/recovery" clause, not a
  residual.** Its owner is **`WRK-013`**, which records it in its result and in the `M1a` gate
  records; M1 plan §8 lists the worker-side pass on the container path as out of M1 scope.

## Status

★ *Superseded text: "Scoping stub. No design steps and no result doc yet — deliberately. Its full
design is written at that sprint's start."*

The task is written: `docs/replatform/epics/E4-worker-daemon/implementation-plan.md` §4c, `WRK-013`
(M1 Step 0, S0-3, 2026-09-21). ★ *Superseded text: "No result doc yet; a distinct reviewer alone sets
`complete`."*

**Built 2026-09-21.** The result is [`WRK-013-result.md`](./WRK-013-result.md), at `gate_review`. It
records the F4 narrowing and its owner, the F5 fence, and one reading this design did not settle: the
"org/owner-scoped" condition gates only the **sandbox** pass, not the whole reconciler (result §4).
A distinct reviewer alone sets `complete`.
