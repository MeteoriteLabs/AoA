# E4 — Worker daemon: M1a candidate reachability ledger — FILLED AT CANDIDATE

**Measured at:** **CANDIDATE `7be35ae6b7719877e61f54ab552de84de8491e7d`** (filled 2026-09-23 UTC by the `M1a` QA owner, a distinct
review session, per the README's *Filling a ledger at candidate freeze*). Every caller count in the
`At candidate` column was re-measured at the candidate with `countProductionCallers`
(`scripts/check-gate-clause-wiring.mjs`); no tip value was copied forward. Register statuses are
`scripts/gate-clause-wiring.json` at the candidate, where the guard reports
**`OK (28 wired clause(s), 6 declared dormant, 2 provider-capability claim(s) matched to source)`** —
at the tip it reported 22 wired / 12 dormant.
**Candidate:** `7be35ae6b7719877e61f54ab552de84de8491e7d`
**Campaign evidence this ledger cites** — both records under `../qa/`:
`M1-D1-SPINE` = run `35912752449`, jobs `m1-spine` + `m1-fault-matrix`, at `8c01f4e94f8e25d7abaf524e8b266b809c67b8cb`
(a **tree-equivalent** revision: every product subtree hash is identical to the candidate's; the sole
delta is one added docs file). `M1a-D2-MECHANISM` = run `35920425288`, job `shipped-boot`, at the
candidate exactly.
★ **Both gate records carry `Result: fail`** — spine at `a4`, mechanism at `a5` —
`../qa/2026-09-23-m1-d1-spine-m1a-candidate-7be35ae6b771-a4.md` and
`../qa/2026-09-23-m1a-d2-mechanism-m1a-candidate-7be35ae6b771-a5.md`.
★★★ **The `M1a-D2-MECHANISM` profile of `tests/d1/fault-matrix.json` declares 23 cases and ALL 23 are
`evidence: "pending"` at the candidate**, and `.github/workflows/m1-shipped-boot.yml` contains no
fault-matrix step, so the keyed run fired none of them. Wherever a row below says a clause is
certified by the spine, that is not shorthand for "and also by the mechanism lane".
**Exit gate** (`epics/E4-worker-daemon/README.md`): separate worker image leases through the
protocol, supervises only sandboxes, survives restart, and replays its encrypted event outbox.
**Columns:** see [README](./README.md). `Certified only by M1-D1-SPINE` is `TO MEASURE AT
CANDIDATE FREEZE` on every row, and it is not repeated in the table.

★ **The worker's own deployment gate.** `composeDispatchRuntime`
(`packages/worker-daemon/src/lifecycle/dispatch-runtime.ts`) is called from the daemon bin
(`packages/worker-daemon/src/bin/worker-daemon.ts`). Dispatch is gated by `AOA_WORKER_DISPATCH_ENABLED`
(`ENV.dispatchEnabled`, `packages/worker-daemon/src/config/config.ts`), which is **off unless set to
`"1"`**. The containerised host `runContainerHost` has two production callers:
`packages/worker-daemon/src/bin/container-host.ts` and
`packages/worker-networked-host/src/bin/networked-host.ts`. **"Reachable" below means reachable from
a boot root with dispatch enabled.** It does not mean the mechanism runs by default.

★ **Tenant isolation on the worker side.** A worker's Organization/owner binding is server-assigned,
and a worker cannot self-promote (`workerSatisfiesRequirements` in the frozen `packages/worker-protocol`,
pinned falsifiably since `E1-F009`). The F10 lease-denial cases are therefore server-side (E3-7). The
worker-side question is whether one worker's local state (outbox, lease-candidate store, staged
inputs) can carry another tenant's data between leases. That is measured per row.

★★★ **READING THIS FILLED LEDGER.** The `@tip` columns are kept **verbatim** as the S0-7b tip
measurement and are not rewritten; every `TO MEASURE AT CANDIDATE FREEZE` still visible inside them
is answered in the final **`At candidate`** column, which is the candidate measurement. The
skeleton's sentence *"`Certified only by M1-D1-SPINE` is `TO MEASURE AT CANDIDATE FREEZE` on every
row"* is now discharged: that judgement is folded into each `At candidate` cell, which names the
lane (and the fault-matrix case id) that certifies the row, or says no lane does.

| # | Mechanism | Register key · status @tip | Symbol · file | Present | Callers @tip (where) | Production-reachable @tip | Tenant isolation (F10) @tip | M1 tickets that change this row | At candidate |
|---|---|---|---|---|---|---|---|---|---|
| E4-1 | leases through the protocol | `E4-1-leases-through-protocol` · **wired** | `createPollLoop` · `packages/worker-daemon/src/poll/poll-loop.ts` | yes | 2 (`lifecycle/dispatch-runtime.ts`) | **Reachable from the daemon boot root with dispatch enabled** (guard-checked). The register's promotion evidence is `composed-journey.component.test.ts`, which is in-process against a control-plane double. It is not a deployed boot. | Server-assigned binding (see above). `TO MEASURE AT CANDIDATE FREEZE`: a worker enrolled for Organization A is offered no job of Organization B | `DEP-015` (shipped CI boot), `DEP-018` | **2 callers**. Unchanged, `wired`. ★ **Now reached from a DEPLOYED boot**: run `35920425288` booted three worker containers from the candidate image `sha256:df44724d…`; each enrolled on its own Organization's target and each polled once (`providerEvidence.polls: 1`). Cross-tenant offer denial is `M1-D1-SPINE` only (`d1.tenant.cross.lease`). |
| E4-2 | supervises only sandboxes | `E4-2-supervises-sandboxes` · **wired** | `createSupervisor` · `packages/worker-daemon/src/supervisor/supervisor.ts` | yes | 2 (`lifecycle/dispatch-runtime.ts`) | **Reachable with dispatch enabled** (guard-checked). The register evidence uses the per-op fake provider. A real E2B sandbox is `E7-1-coding-journey` (unwired). | `TO MEASURE AT CANDIDATE FREEZE` | `E7-1-JOURNEY-ARM`, `DEP-015` | **2 callers**. Unchanged, `wired`. ★ **Real E2B sandboxes observed**: `icnga1mdlhrayh683vwcl` (tenant a) and `iw8yiqpx7b0drx4saibqj` (tenant b), each appearing in ITS OWN worker log and in neither other (`grep -c` over `logs-m1-worker-{a,b,c}.txt` gives 1/0/0 and 0/1/0). `E7-1-coding-journey` is `wired` at the candidate. ★★★ **Teardown is NOT certified**: all three `d2m.cleanup.sandbox_destroyed_on_*` cases are `pending`. |
| E4-3 | survives restart | `E4-3-survives-restart` · **unwired** | `createStartupReconciler` · `packages/worker-daemon/src/supervisor/startup-reconcile.ts` | yes | **0** | **Not reachable.** The daemon bin calls `createStartupSteps(deps.reconciler)`, and `deps.reconciler` is never supplied. `StartupReconcilerDeps.leaseCandidates` has no durable source (`E4-F009`). | `TO MEASURE AT CANDIDATE FREEZE`: the lease-candidate store must be per-lease and must not leak across tenants | **`WRK-013`** (rulings F4 and F5: fence a live lease; the container-path narrowing) | ★ **`createStartupReconciler` 0 → 1 caller**; `E4-3-survives-restart` is now **`wired`**. **Its deployed-boot case is still uncertified**: `d1.reconcile.worker_startup_lease_probe` is `pending` on the spine and routed by name to the keyed lane, which fired no fault-matrix case at all. ★★★ **And the spine's `pending` REASON is stale for the lane that was certified**: `docker/d1/m1-spine.override.yml:137` sets `AOA_WORKER_DISPATCH_ENABLED: "1"` on `worker-b`, both `m1-spine` and `m1-fault-matrix` boot that override (`d1-merge-train.yml` :419, :678), and `m1-spine` asserts `dispatch COMPOSED` in worker-b's log (:483). `d1-dispatch-declared.mjs` checks the BASE compose only. So the case was never structurally unavailable there — it was simply not run. So the reconciler's evidence remains the in-process component test, exactly as the tip row said. ★ The **F4 narrowing** (no worker-side sandbox teardown on the container path; orphan reclamation rests on the adapter-manager reaper) stands and is repeated here as required. |
| E4-3 · WRK-013 | survives restart — **update, not a re-measurement** (2026-09-21) | `E4-3-survives-restart` · **wired** in the WRK-013 commit | `createStartupReconciler` · built by `composeDispatchRuntime`'s `start()` (`lifecycle/dispatch-runtime.ts`) | yes | 1 (`lifecycle/dispatch-runtime.ts`) | **Reachable with dispatch enabled**, and it runs to completion **before** the poll loop. Evidence is in-process against the control-plane double (`startup-reconcile-composed.component.test.ts`), not a deployed restart. ★ **Named narrowing (F4), owned by `WRK-013`:** on the container path (`makeRunProvider` only) and on a platform-scoped target the **sandbox** pass is skipped by name, so no worker-side teardown runs there and orphan reclamation rests on the adapter-manager reaper. The candidate-freeze record must repeat this. | The store is keyed per lease; two Organizations' leases on one daemon are probed and fenced independently, each probe carrying only its own lease identity (component test ★ 8). `TO MEASURE AT CANDIDATE FREEZE` on the candidate | `DEP-018` (restart fault) | See E4-3 above: **1 caller**, `wired`, deployed-restart case `pending`. The two-Organization lease-candidate isolation claim rests on `startup-reconcile-composed.component.test.ts` ★ 8, **not** on either campaign. |
| E4-4 | replays its encrypted event outbox | `E4-4-event-outbox-replay` · **wired** | `createEventOutboxDrain` · `packages/worker-daemon/src/events/event-outbox-drain.ts` | yes | 2 (`lifecycle/dispatch-runtime.ts`) | **Reachable from the boot root** (guard-checked). The drain starts at boot, independent of leasing. | `TO MEASURE AT CANDIDATE FREEZE` | `DEP-018` (restart/replay fault) | **2 callers**. Unchanged, `wired`. No campaign case replays the outbox after a worker restart on either lane. |
| E4-4b | event outbox store | `E4-event-outbox-store` · **wired** | `openEventOutboxStore` · `packages/worker-daemon/src/events/event-outbox-store.ts` | yes | 2 (`lifecycle/dispatch-runtime.ts`) | **Reachable from the boot root** (guard-checked). | `TO MEASURE AT CANDIDATE FREEZE` | — | **2 callers**. Unchanged, `wired`. Not separately exercised by either campaign. |
| E4-R | lease renewal driver (supporting) | no register entry | `createLeaseRenewalDriver` · `packages/worker-daemon/src/lease/lease-renewal.ts` | yes | 2 (`lifecycle/dispatch-runtime.ts`) | Composed by `composeDispatchRuntime`. **Reachable with dispatch enabled.** | — | `WRK-013` (F5: stop renewing a fenced lease) | **2 callers**. Unchanged. Renewal exercised on the spine (`d1.tenant.cross.lease`, own arm `renewed`). F5 fencing is asserted by the `WRK-013` component test, not by a campaign. |
| E4-U | usage producer (`observeRun`) | no register entry | `SupervisorDeps.observeRun` (optional) · `packages/worker-daemon/src/supervisor/supervisor.ts` | yes (optional dependency) | the supervisor's own uses only | **Not reachable.** `composeDispatchRuntime` builds the supervisor through `makeSupervisor({...})` **without** `observeRun`: the source comment says *"observeRun stays absent (no sandbox stdout/stderr rides the stream yet)"*. Nothing produces usage, so E3-14 has no input. | Usage must be attributed to the lease's own Organization: `TO MEASURE AT CANDIDATE FREEZE` | **`WRK-018`** | ★★★ **`observeRun` 0 → 5 callers** (`WRK-018`), and the producer demonstrably works: the mechanism lane stored real parsed `claude_local` usage per enabled tenant (a: 8/618 plus `cachedInputTokens` 64287; b: 8/597 plus 77982), exactly **one** usage event each (`usage.events: 1`, `violations: []`, judged by `evaluateUsageCardinality`, `scripts/lib/m1-spine-assertions.mjs`) and **zero** for the control. Attribution is per Organization (`usageEvents[].organizationId` matches each tenant). **What it does NOT show is the priced row** — `costEventsForRun: 0`, `costUsd: null`. `WRK-018-result.md` is `Status: gate_review` at the candidate. |
| E4-I | separate worker image | no register entry | `docker/images/build.sh` + `docker-compose.d1.yml` services `worker-a` and `worker-b` | yes | n/a (image, not symbol) | Built and booted by `d1-merge-train` (see E6-1). | — | — | Unchanged, and now also built by the shipped-boot lane: `candidate.json` records `localhost/aoa/worker:7be35ae6b…`, digest `sha256:df44724d49d4cfb07ab19f266f149fc8c0bf4432540514caecdf6ee99742ecc4`, built from the candidate in-job. |
