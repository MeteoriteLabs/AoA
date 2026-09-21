# WRK-013 Result - a durable lease-candidate store, and the startup reconciler composed before the first poll

**Status:** `gate_review`
**Date (UTC):** `2026-09-21`
**Epic:** `E4-worker-daemon`
**Plan task:** `E4 implementation-plan ### WRK-013 - A durable lease-candidate source for the startup reconciler (M1a)` (§4c)
**Implementer:** `M1 WRK-013 build agent (Claude Opus 5)`
**Start SHA:** `28a2dd259` (program tip at start); rebased onto `4904c75e3`, then onto `fc2eb7dde` (which brought WRK-018 and JOB-016; the merge into `dispatch-runtime.ts` was clean)
**Implementation commit:** `cd071fa083999d386aa7837e7b9a480b105dec8a`, plus the `start()` fix (§4 item 4) and the Codex P2 fix `4a66606d1d0594bb21583013e016e0d371f70dce` (§4 item 5)
**Resolves:** `E4-F009` (MED). Its `findings.md` Status is flipped to `resolved` and its manifest key is
deleted in the implementation commit. `E4-3-survives-restart` moves to `wired` in the same commit.

The implementer leaves `Status` at `gate_review`. A separate reviewer completes the review section
and is the only role that may change it to `complete`.

★★★ **A NAMED NARROWING, NOT A RESIDUAL (founder ruling F4, owner `WRK-013`).** On the **container**
path a restarted daemon cannot enumerate orphan sandboxes. It has no process-level provider, only a
per-run `makeRunProvider`, and the networked `list` needs a capability that lapsed with the previous
process. So **no worker-side sandbox teardown runs on the container path**, and orphan reclamation
rests on the adapter-manager reaper (`reconcileReaper`, `packages/adapter-manager/src/reconcile-reaper.ts`,
looped by `startReaperLoop`). This narrows journey item 8's "cleanup/recovery" clause. The code says
so at runtime: the reconciler logs `reason: sandbox_pass_skipped_container_path_f4`
(`SANDBOX_PASS_SKIP_REASONS.containerPathNoEnumeration`). **The `M1a` candidate-freeze records must
repeat this narrowing.** It is also recorded in the `M1a` E4 reachability ledger row `E4-3 · WRK-013`.

---

## 1. What was found before building

All of the task's measured facts held at `28a2dd259`:

- `createStartupReconciler` (`supervisor/startup-reconcile.ts`) was fully built and had zero
  production callers. `bootstrapWorkerDaemon` passed `createStartupSteps` only an injected
  `deps.reconciler`, which no production root supplies.
- `probeLeaseAuthority` renews through `renewLeaseOnce`, and `livenessOf` maps `renewed` to `live`.
  **A live verdict is itself a renewal.**
- The poll loop was armed by `heartbeatLoop.firstBeat.then(() => composed.start())`. The startup
  steps ran afterwards on the boot path, so they could not order themselves before the first poll.
- `leaseCandidates` had no durable source.

Two further facts were measured and changed the build:

1. **The probe must run after the first heartbeat.** The server's renew path
   (`server/src/services/job-fencing.ts`, `renew`) refuses with `target_revoked` when
   `ackAuthorityCurrent` fails, and that check needs a fresh worker heartbeat. `livenessOf` maps
   `target_revoked` to `dead`. After a long enough outage, a probe issued before the first beat
   would read every live lease as revoked. So the reconcile runs inside `start()`, which the bin
   calls after the first successful beat, and `start()` arms the poll loop only after the reconcile
   completes. The order is: heartbeat, then reconcile, then poll.
2. **The fixture target is platform-scoped, and so is every target that can hold two
   Organizations' leases.** See §4, item 2.

## 2. What shipped

| File | Change |
|---|---|
| `packages/worker-daemon/src/lease/lease-candidate-store.ts` | **New.** `openLeaseCandidateStore` / `SqliteLeaseCandidateStore` follow the `event-outbox-store.ts` pattern: `node:sqlite` is loaded dynamically through the outbox's warning-filtered `loadDatabaseSync`, with no npm SQLite dependency (E4-D01). There is one row per **lease** (`lease_id` primary key), and each row carries its Organization. The interface is `put(offer)`, `remove(leaseId)`, `list()`, `clear()` and `close()`. `list()` **throws** `LeaseCandidateStoreCorruptError` if any row fails to decode to the offer its key names (a parse failure, a schema failure, a `leaseId` mismatch or an Organization mismatch). It never returns a partial or empty list. A file that is not a database fails at open with the same error. `openLeaseCandidateStoreFailClosed` sets such a file aside as `<path>.corrupt-<ms>`, opens a fresh store, and **returns** the fault rather than throwing. `LEASE_CANDIDATE_REASONS` holds the named log tokens. |
| `packages/worker-daemon/src/poll/poll-loop.ts` | New optional `PollLoopDeps.leaseCandidates`. The candidate is **written just before the ACK** in `handleOffer` and **withdrawn** on every non-ACK outcome. It is **pruned** in `trackHandoff`'s settle `finally`. ★ *It was written AFTER `acknowledged` until Codex's P2 on `4b83ba9f9` (§4 item 5).* A store fault is logged as `lease_candidate_write_failed` and never fails the lease. That lease is then simply not probed at restart, and the control-plane reaper ends it. |
| `packages/worker-daemon/src/lifecycle/dispatch-runtime.ts` | Opens the store (fail-closed) after the outbox recovers and passes it to the poll loop. **`start()` is now `Promise<void>`**. It runs the reconcile through `runStartupSteps(createStartupSteps(...))`, so it inherits the await and swallow-and-log contract. Only then does it call `drain.start()` and `pollLoop.run()`. A `stopLeasing()` or `stopDrain()` during the reconcile prevents the poll loop from starting. `readCandidates()` names every empty answer. It then **claims** each candidate (removes it from the store) **before** probing. A candidate that cannot be claimed is not probed. `sandboxPassDeps()` passes a provider and an Organization-scoped selector only for a process-level provider on an Organization-scoped target. Otherwise it passes the F4 or platform skip reason. After the pass, each probed lease is logged with `leaseId`, `jobId`, `attempt`, `organizationId` and a reason: `lease_candidate_fenced` (live), `lease_candidate_ended` (dead) or `lease_candidate_unreachable`. `closeStore` now closes both local stores. |
| `packages/worker-daemon/src/supervisor/startup-reconcile.ts` | `provider`, `ownershipSelector` and `makeCtx` are now **optional**. The sandbox pass runs only when all three are present. Otherwise it is skipped under `sandboxPassSkipReason`, or `sandbox_pass_skipped_no_provider` if none is given, and the reason is logged. The lease and outbox passes always run. The result adds `fencedLeaseIds` (F5) and `sandboxPassSkipped`. The `keep` log line now says the lease is fenced, not renewed. The `createStartupReconciler(deps)` signature is unchanged, and the change to its deps is additive. |
| `packages/worker-daemon/src/bin/worker-daemon.ts` | Passes `leaseCandidatePath` and calls `void composed.start().then(...)` after the first beat (see §1, item 1). The seam comment is updated. |
| `packages/worker-daemon/src/lifecycle/startup-steps.ts` | Comment only. |
| `packages/worker-daemon/src/config/config.ts` | Adds `leaseCandidatePath` (`AOA_WORKER_LEASE_CANDIDATE_PATH`). When unset, it defaults beside the outbox: `defaultLeaseCandidatePath`, `<outbox minus .db>.lease-candidates.db`, on the same writable volume. The campaign compose therefore needs no change. The value is `null` only when there is no outbox path, and dispatch is already refused in that case. |
| Tests | **New:** `lease-candidate-store.test.ts` (10 tests) and `startup-reconcile-composed.component.test.ts` (12 tests). **Extended:** `startup-lease-authority.test.ts` (+2, F5), `startup-reconcile-lifecycle.test.ts` (+3, named sandbox-pass skips), `dispatch-runtime.test.ts` (+2, ordering and shutdown-during-reconcile; one existing test now awaits `start()`), `config.test.ts` (+3). The fake plane gains `renewRequests()`, which records every well-formed renew body. |
| `scripts/gate-clause-wiring.json` | `E4-3-survives-restart` → **`wired`**, with a promotion reason cited by symbol. The old reason is kept as `Superseded reason (unwired)`. |
| `scripts/finding-ownership.json` | The `E4-F009` key is deleted. `E0-F011` gets a dated amendment (see §5). |
| `docs/architecture/distributed-execution-threat-controls.json` | DE-05 and DE-10 `startup-reconcile.ts` / `worker-daemon.ts` citations are re-pointed by symbol, with dated amendments (§5). |
| `docs/replatform/epics/E4-worker-daemon/findings.md` | `E4-F009` is `resolved`, with a resolution note. The old status line is kept. |
| `docs/replatform/epics/E0-foundation/findings.md` | `E0-F011` item 3 has a dated amendment. The finding stays open. |
| `docs/replatform/epics/E4-worker-daemon/tickets/WRK-013-design.md`, `docs/replatform/milestones/M1a/reachability/E4-worker-daemon.md`, `docs/deploy/environment-variables.md` | The design status is updated, with the old text kept. The ledger has an update row with the F4 narrowing. The new env var is documented. |
| `scripts/test-inventory.json` | Only the `packages/worker-daemon` pin changes, 165 → 167. |

## 3. Evidence

### RED, before implementation (test files written first, at `28a2dd259` plus the tests)

The focused command (§3 of the plan) was run with the new and extended tests and no implementation:

- `lease-candidate-store.test.ts`, `startup-reconcile-composed.component.test.ts` and
  `startup-reconcile-lifecycle.test.ts` **failed to collect**. The modules and exports they import
  (`lease/lease-candidate-store.js`, `SANDBOX_PASS_SKIP_REASONS`) did not exist.
- `startup-lease-authority.test.ts`: **2 failed**, both F5 cases, because `result.fencedLeaseIds`
  was `undefined`.
- `dispatch-runtime.test.ts`: **2 failed**. These were *start() COMPLETES the startup reconcile
  before …* and *a shutdown that begins DURING the reconcile …*. `start()` never called the reconciler
  and started the poll loop synchronously.
- Totals: 5 files failed. **4 tests failed and 30 passed** among the files that collected.

### GREEN, local on Windows, at `171cc8d9c` (pre-rebase; the rebase onto `4904c75e3` touched no worker-daemon file)

- Focused (the plan's §3 `WRK-013` row, all five files): **5 files, 65 tests passed.**
- The whole `@armyofagents/worker-daemon` suite: **160 files, 1081 passed, 1 skipped.** Before a test
  fix, the suite showed a load-only race in the component test: the plane records an ACK before the
  worker reads the response, and at that revision the write came after the ACK, so a crash taken at
  "ACK recorded" could precede the write. The test now crashes only after every run has reached
  `create`, and it then ran green 3 times in a row under full-suite load. ★ *That window was real in
  the code too. Codex flagged it (P2), and it is now closed: see §4 item 5.*
- After the Codex fix (write before ACK, withdraw on non-ACK): focused **5 files, 67 tests**; whole
  suite **160 files, 1083 passed, 1 skipped**, with no `Errors` line. After the rebase onto
  `fc2eb7dde`: **163 files, 1133 passed, 1 skipped**, no `Errors` line; `tsc --noEmit` clean.
- `tsc --noEmit` and `build` for `worker-daemon`, the `worker-protocol` build, and
  `tsc --noEmit` for `worker-networked-host` all passed.
- `node scripts/check-gate-clause-wiring.mjs` → OK, with 23 wired clauses, including `E4-3-survives-restart`.
  Before the flip it was red: *"E4-3-survives-restart: declared unwired but it now HAS a caller"*.
- `pnpm check:worker-daemon-boundary` → PASS.

### What each acceptance item is proven by (`startup-reconcile-composed.component.test.ts` unless named)

Each restart case uses **two lifetimes of one enrolled device over the same files**. Lifetime A ACKs
over the real lease-ack POST, hangs in `create`, and **crashes** (stores closed, no drain, no settle).
Lifetime B then composes and `start()`s. The candidate B probes therefore comes from A's
write-on-ACK, never from a test `put()`.

| # | Acceptance | Proven by |
|---|---|---|
| 1 | a stored candidate is probed, not `[]` | ★ 1: exactly one renew for A's lease, whose body carries A's `leaseId`/`jobId`/`attempt`/`fenceToken`; and no `empty` reason |
| 2 | a live candidate is fenced; no renewal after the probe | ★ 2: the renew count stays **1** through a 2 s wait on a 3 s lease window (a re-attached lease would renew at half-window); `activeRenewalCount() === 0`; the `lease_candidate_fenced` line carries lease, job, attempt and Organization. **A third lifetime probes nothing** (claim-before-probe: a crash loop cannot renew it again). Unit: `startup-lease-authority` F5 cases |
| 3 | an attempt that ended before the crash is pruned | ★ 3: the run completes in A, and B issues **0** renews and logs `empty` |
| 4 | empty store / platform target: named reason | ★ 4 ×3: `lease_candidate_store_empty`; `sandbox_pass_skipped_platform_scoped_target` with `list` never called; and a **positive control**: an Organization-scoped target runs the pass under `{organizationId, targetId, workerId}`. Also ★ F4: the container path logs `sandbox_pass_skipped_container_path_f4` and builds no provider. Unit: `startup-reconcile-lifecycle` named-skip cases |
| 5 | reconcile completes before the first poll | ★ 1: B's own client call log shows `renew:start` first, and `renew:end` before the first `poll:start`. This is an order, not a sleep. Unit: `dispatch-runtime` gate test (the reconcile is held open, so neither `drainStart` nor `pollRun` happens until it is released) |
| 6 | corrupt store: no renewal, named distinct reason, polling starts | ★ 6 ×2: a garbage file, and an undecodable row. Each shows **0** renews for the pre-crash lease, `lease_candidate_store_unreadable` (not `empty`), and poll count rising. The garbage file is set aside as `lease-candidates.db.corrupt-*`, and a fresh store exists |
| 7 | positive control: removing write-on-ACK reds case 1 | Mutation **M1** below (5 cases red). In-suite control ★ 7: lifetime A without a store, so B probes nothing and says `empty`. Also ★ 7: no path configured logs `lease_candidate_store_not_configured` |
| 8 | two Organizations, independent | ★ 8: A ACKs one lease for Organization X and one for Y. At restart, X is live and Y is dead. Each is probed **once**, with **only its own** job and fence. X is fenced and Y ended, each attributed to its own Organization, and the driver holds neither. Store unit: pruning X leaves Y |
| 9 | *(Codex P2)* no crash window between ACK and write | ★ 9 ×2: the ACK reaches the plane and the worker never reads the response, then crashes, and the restart still probes and fences the lease. A **refused** ACK withdraws the candidate, so the restart probes nothing |

### Mutation and positive-control table (each mutation reverted afterwards; focused command, 65 tests)

| # | Mutation | Red |
|---|---|---|
| M1 | **remove the candidate write** (positive control 7) | **5** (re-run after the Codex fix): ★ 1+5, ★ 2, ★ 6 (row), ★ 8, ★ 9 (lost response). At first commit: 4, without ★ 9 |
| M2 | remove the prune-on-settle | 1: ★ 3 |
| M3 | reconcile **after** the poll loop starts | 3: ★ 1+5, and both `dispatch-runtime` WRK-013 ordering tests |
| M4 | do not claim before probing | 1: ★ 2 (the third lifetime renews again) |
| M5 | re-attach a fenced lease to the renewal driver (F5 violation) | 2: ★ 2, ★ 8 |
| M6 | treat a set-aside (unreadable-at-open) store as clean | 1: ★ 6 (garbage file) |
| M7 | skip an undecodable row instead of failing | 2: ★ 6 (row), and the store unit test *an undecodable row makes list() THROW* |
| M8 | drop the key/offer consistency check | 1: the store unit test *a row whose offer no longer matches its key* |
| M9 | probe every candidate under the **first** lease's identity (cross-tenant) | 2: ★ 8, and the `startup-lease-authority` F5 case |
| M10 | run the sandbox pass on a platform-scoped target | 1: ★ 4 (platform) |
| M11 | log the empty store with no named reason | 4: ★ 2, ★ 3, ★ 4 (empty), ★ 7 |
| M12 | start polling even if a shutdown began during the reconcile | 1: the `dispatch-runtime` shutdown-during-reconcile test |
| M13 | write the candidate **after** the ACK (the Codex P2 window) | 1: ★ 9 (lost response) |
| M14 | do not withdraw on a non-ACK outcome | 1: ★ 9 (refused ACK) |

### CI

See §7.

## 4. Choices and contradictions recorded

1. **The build brief and the task section disagree about the probe, and I followed the task section.**
   The brief said that the probe renewing *"conflicts with F5 and must be changed so a restart probe
   never renews"*. The task section, which is this ticket's contract, says the opposite in four
   places:
   - *"the probe's own renewal is the last one"* (Outcome, F5);
   - acceptance 2, *"no renewal after the probe"*;
   - acceptance 6, *"no `lease_renew`, **including the probe's**"*, which marks the corrupt case as
     the one where even the probe is withheld;
   - the non-goal *"there is still no lease-state query op, so authority stays inferred by renewal"*.

   A probe that never renews cannot exist without a protocol change, which is a non-goal. It would
   also make acceptance 1 and 8 unsatisfiable, because there would be no probe to run over a
   candidate and no probe identity to check. So the shipped behaviour is **exactly one renewal per
   lease, ever: the probe**. Nothing renews after it. The candidate is claimed before the probe, so a
   crash loop cannot repeat it, and the renewal driver never holds it. **If the planning session meant
   "zero renewals at restart", it needs a successor decision: a protocol query op, or dropping the
   live/dead distinction at restart. Until then this is flagged, not guessed.**
2. **The "org/owner-scoped" condition gates the sandbox pass, not the whole reconciler.** The task
   says to compose the reconciler *"conditionally on `organizationId !== null` (platform-scoped
   targets skip with a named reason)"*. Acceptance 8 needs two Organizations' leases on one daemon.
   An Organization-scoped target admits only its own Organization, so acceptance 8 is reachable
   **only** on a platform-scoped target. Read literally, the condition would therefore make acceptance
   8 unreachable. E4-F009 gives the condition's own rationale: *`ownershipSelector.organizationId` is
   constructible*. The selector is used **only** by the sandbox pass's `provider.list`. The lease probe
   and the outbox pass need no Organization. So on a platform-scoped target the **sandbox pass** is
   skipped under a named reason, and the lease and outbox passes still run. That satisfies both
   acceptance 4 (*"so does a platform-scoped target"*) and acceptance 8.
3. **`keep` still leaves the sandbox in place.** F5 is about the **lease**, and the task says only
   that *"keep must not keep a lease alive"*. On the desktop path (process-level provider,
   Organization-scoped target) a live same-generation sandbox is still `keep` (WRK-007 D2, never
   re-attached). Its lease is fenced, so the reaper ends the attempt. But the sandbox itself is not
   torn down by this boot, and the candidate is claimed, so a later boot sees it as
   `unknown_sandbox`. Whether F5 should also tear down a fenced lease's sandbox is **not decided
   here**. It does not affect the M1 container path, where the pass is skipped (F4).
4. **`start()` became `Promise<void>`.** ★ *CI caught a defect here.* The first CI run on
   `1b7a8a4ff` (run `35591729825`) passed every test but failed `verify (2)`, `verify (3)` and
   `verify (4)` on **5 unhandled rejections**. They came from `bin/worker-daemon.ts`, where
   `composed.start().then` read `.then` of `undefined`: the `composeDispatch` observation seam
   injects fake runtimes whose `start` returns nothing (`dispatch-composition-2b.test.ts`,
   `dep-011-slice-2b-bin.test.ts`, `shipped-binary-refuses.test.ts`). My local GREEN had grepped only
   the pass counts, and vitest's `Errors` line was never read. The fix is
   `void Promise.resolve(composed.start()).then(...)`. It was reproduced locally first:
   `dispatch-composition-2b.test.ts` shows **4 errors** without the fix and **0** with it. The whole
   worker-daemon suite is now clean, with no `Errors` line.
   Original item: This was needed to order the reconcile before the poll loop
   from inside the runtime, which the task allowed (*"dispatch-runtime.ts and/or bin"*). The bin
   `void`s it. Existing callers that did not await it still work.
5. **Codex P2 on `4b83ba9f9`: persist the candidate before acknowledging.** Checked at source: in
   `handleOffer` the write followed `ack.kind === "acknowledged"`. A crash after the control plane
   recorded the ACK, but before the worker read the response, left the lease active with no row, so
   the restart could not account for it. The write now happens **before** `ackLease`, and every
   non-ACK outcome **withdraws** it. A crash between the write and the ACK leaves a row for a lease
   that was never ACKed. The restart's renew for it is refused, so it probes `dead` and is pruned,
   which is harmless. ★ *One ambiguity remains, and it is recorded, not closed:* a **transient** ACK
   outcome, where the response was lost but the worker survived, is treated as a failure and
   withdrawn. If the server did record that ACK, the lease is not probed at a later restart, and the
   control-plane reaper ends it. That renews nothing, so it is the fail-safe direction. Keeping the
   row instead would mean probing (renewing) a lease the worker never ran.

## 5. Records amended because the code changed under them

Two other records claimed `createStartupReconciler` has *zero production callers*. That is now false,
so each gets a **dated amendment**, and the earlier text is kept as measured:

- **DE-10** in the threat-control register. The destroy half's worker-side factory is now called. The
  row's verdict does not move, because on the container path, the M1 path, the pass is skipped (F4).
  **DE-05**: the factory's layer is gone. The verdict does not move, because the composition supplies
  no `quarantineCandidates`. The anchored citations for both rows were re-pointed by symbol, and
  `check-register-citation-integrity` is green.
- **E0-F011**, item 3, in `findings.md` and in its manifest reason. The finding stays **open**,
  because items 1, 2 and 4 and the server-side arming gap in item 3 are untouched.

## 6. Not proven here

- **A deployed restart.** Every case runs against the in-process, protocol-faithful control-plane
  double. None runs against a real server restart or real E2B. The restart fault on a deployed boot
  is `DEP-018`'s fault matrix. No keyed workflow was dispatched.
- **That the control-plane reaper ends a fenced attempt.** That is server-side (`reapExpiredLeases`,
  JOB-006) and is proven there. Here, what is proven is that the **worker** issues no renewal after
  the probe.
- **The container path's orphan reclamation.** That is the F4 narrowing above. It rests on the
  adapter-manager reaper, whose own arming gap is recorded in E0-F011 and DE-10.

## 7. CI evidence

PR #553, CI run `35593652746`, on head `9b3838c43` (the implementation commit `54daff9b7` plus the
`start()` fix in §4 item 4). **`ci-required`: pass**, with no unhandled errors on any shard. The
earlier run `35591729825` on `1b7a8a4ff` failed on those errors (§4 item 4).

| Job | This ticket's files it executed | Shard totals |
|---|---|---|
| `verify (1)` (job `106313504269`) | `startup-reconcile-lifecycle.test.ts`: **9 tests** | 655 files passed, 3 skipped; 6400 tests passed, 12 skipped |
| `verify (3)` (job `106313504295`) | `dispatch-runtime.test.ts`: **29 tests**; `startup-lease-authority.test.ts`: **5 tests** | 654 files passed, 4 skipped; 5889 tests passed, 29 skipped |
| `verify (4)` (job `106313504210`) | `startup-reconcile-composed.component.test.ts`: **12 tests**; `lease-candidate-store.test.ts`: **10 tests**; `config.test.ts`: **9 tests** | 658 files passed; 6144 tests passed, 2 skipped |
| `verify (2)` (job `106313504270`) | none of this ticket's files | 656 files passed, 2 skipped; 6216 tests passed, 33 skipped |

None of these suites is Windows-skipped. All of them also ran green locally on Windows (§3).

## Independent review

**Reviewer:** _pending_
**Reviewed revision:** _pending_
**Disposition:** _pending_
**Attempt:** _none yet_

For `approved`, check each claim above against its named source at the reviewed revision. In
particular, confirm three things: that §4 item 1 is a contradiction between the build brief and the
task section, and that the shipped one-renewal behaviour matches the task text; that the F4 narrowing
is named at runtime and in the `M1a` ledger; and that §6's "not proven" is accepted as such. Then
change the top-level `Status` to `complete` and commit that disposition separately.

## Review attempt history

The implementation author leaves the table body empty. The first independent reviewer appends attempt 1, and later reviewers append rows with increasing attempt numbers without replacing earlier ones. Do not include a `Review commit` column: a row cannot embed the SHA of the commit that first contains it.

| Attempt | Reviewer | Reviewed revision | Disposition | Evidence/findings |
|---:|---|---|---|---|
<!-- The first reviewer appends attempt 1 below. -->
