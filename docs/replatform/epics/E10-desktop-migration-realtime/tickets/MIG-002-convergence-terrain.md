# MIG-002 — convergence · terrain (second slice)

**Status: TERRAIN ONLY. No design, no code.** The first slice
([`MIG-002-dial-terrain.md`](./MIG-002-dial-terrain.md) /
[`-design`](./MIG-002-dial-design.md) / [`-result`](./MIG-002-dial-result.md)) made the routing
dial live and per-sink, and explicitly deferred convergence. This is that deferral.

Line references are to `docs/replatform-program` at `d43b1d26f`.

---

## 1. The finding: the machine is complete. It is simply never started.

Inherited deferral #2 says *"JOB-006's lease reaper has no live trigger … an attempt whose lease
expires without emitting a terminal event has no convergence path — its run stays `running`."*
That is true, and it understates how close the fix is.

Everything is built:

| Piece | State |
|---|---|
| `createJobControlSweeper` (`job-control-sweeper.ts:49`) | complete — one in-flight tick, bounded batches, fair rotating cursor, wall-clock tick budget, productive/idle backoff, **flag-off is a no-op that touches no database** |
| `JobReconciliationService.reapOrganization` (`job-reconciliation.ts:115-132`) | complete — `runInTenant` → `repos.jobControl.reapExpiredLeases(...)` under the authoritative locks |
| `createJobReconciliationService({ appDb })` | **already constructed in `index.ts`** (for the cancel port) |
| `listAdmittedOrganizationIds` (`index.ts:586-612`) | **already exists** — cursor-paged, bounded limit, `statement_timeout` capped at 750 ms, skips the platform Organization, requires ≥1 company |
| a scheduled tick loop | **the outbox worker's, 20 lines below at `index.ts:613-625`, is the precedent** |

So the sweeper's two dependencies are already in the file that would register it, and the
registration pattern is immediately adjacent. **Nothing has to be designed; something has to be
started.**

One small adapter is needed: the sweeper's `AdmittedOrganizationPage` is
`{ afterOrganizationId, limit }` (`job-control-sweeper.ts:25-28`) while the existing lister also
takes `statementTimeoutMs`. That is a defaulted argument, not a redesign.

## 2. Why this is safe — three independent reasons, all verified

Scheduling something that terminalizes work deserves more than "it looked fine".

**2.1 It reaps only leases that are already expired, by a DATABASE clock.**
`reapOrganization` takes `const now = await repos.jobControl.currentDatabaseTime()` and passes it
into `reapExpiredLeases` (`job-reconciliation.ts:119-126`). The comment is explicit: *"A FRESH
database clock anchors the immutable backoff (never JavaScript time)."* A healthy worker that
renews its lease is never a candidate, and control-plane clock skew cannot make it one.

**2.2 A superseded worker cannot land anything anyway.** Every worker write path is
fence-guarded and rejects `stale_fence`: the control-command ACK
(`job-control-ack.ts:133-147`), `artifact-commit.ts`, `artifact-transfer-grant.ts`,
`egress-proxy.ts`, `worker-control.ts`. So even if a reaped attempt's worker is still executing,
it cannot commit an artifact, upload an event, or reach the egress proxy. The failure mode is
wasted compute, not corrupted state.

**2.3 The wasted compute already has an owner.** REL-004 clause 3b's warm-sandbox reaper arms
(strand / reclaim / superseded) exist to reclaim provider resources left behind. Convergence and
resource reclamation are separate mechanisms and both now exist.

## 3. What it would actually fix

- **Inherited deferral #2**, by name.
- The stranded-run half of gate clause 3: a handed-off attempt whose worker never reports has,
  today, no path back. `reapExpiredLeases` is also one of the three capacity-release sites
  (`job-control.ts:3251`), so reaping releases the org concurrency slot too — the general case of
  the specific leak fixed in the dial slice.
- It removes the "manual per-run cancel" as the only convergent action named in the rollback
  runbook.

## 4. What it does NOT fix, and must not be claimed to

- **`createDistributedExecutionDrain` stays unwired.** Its `listActiveAttempts` exists only as an
  interface member (`job-distributed-drain.ts:40`) and a call site (`:137`) — **there is no SQL
  implementation at all**, so wiring the drain is a strictly larger piece of work than wiring the
  sweeper, and the two should not be bundled.
- **`createExecutionTargetRevocationFanout` stays unwired**, while its producer is live (the
  Revoke control writes a `status:"pending"` row nothing reads). Filed separately.
- **The kill switch still has no write path** (REL-001/005), so rollback step 1 is still hand-SQL.

## 5. The question a design must answer first

> **Does the sweeper get its own scheduler, or ride the outbox worker's tick?**

Both patterns are in `index.ts` already. A separate loop is more code but independently
observable and independently backed off; sharing a tick couples two cadences whose backoff
policies differ (the sweeper's `nextDelayMs` is its own). The sweeper was written expecting to
own its cadence, which argues for its own registration — but that is a design call, not a
terrain fact.

Secondary, and worth deciding explicitly: **the sweeper is flag-gated internally** (`enabled:
false` → a no-op that touches no database). So it can be registered unconditionally and stay
inert, or registered inside the distributed block. The warm-sandbox reaper precedent (REL-004
Lane D, moved to module scope because it is the only force-kill) and the outbox precedent (inside
the flag block) point in different directions, and the difference is not cosmetic — one of them
governs whether an operator's flag can silently disable convergence.

## 6. Traps

- **Do not bundle the drain with the sweeper.** §4 — the drain needs SQL that does not exist.
- **Do not reap on JavaScript time.** §2.1 — the database clock is what makes the predicate
  skew-proof, and it is easy to "simplify" away.
- **Do not assume registering it is enough.** The sweeper's `enabled` flag is a second door: a
  registration with `enabled` left false is a scheduled no-op, which is this programme's
  signature failure. Whatever the design chooses, a test must prove the composed sweeper actually
  ticks against a database.
- **Check the capacity interaction.** `reapExpiredLeases` releases the org slot; the dial slice
  just added a second release path on the legacy-after-convert exit. Both must be idempotent
  (`releaseAttemptCapacity` matches only `held` rows, so it is — but re-verify rather than assume).
