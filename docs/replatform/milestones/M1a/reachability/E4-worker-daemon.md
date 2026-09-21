# E4 — Worker daemon: M1a candidate reachability ledger (SKELETON)

**Measured at:** program tip `b71f0dd539fe713c776f3935932be33af1a24fae` (not a candidate)
**Candidate:** `TO MEASURE AT CANDIDATE FREEZE`
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

| # | Mechanism | Register key · status @tip | Symbol · file | Present | Callers @tip (where) | Production-reachable @tip | Tenant isolation (F10) @tip | M1 tickets that change this row | At candidate |
|---|---|---|---|---|---|---|---|---|---|
| E4-1 | leases through the protocol | `E4-1-leases-through-protocol` · **wired** | `createPollLoop` · `packages/worker-daemon/src/poll/poll-loop.ts` | yes | 2 (`lifecycle/dispatch-runtime.ts`) | **Reachable from the daemon boot root with dispatch enabled** (guard-checked). The register's promotion evidence is `composed-journey.component.test.ts`, which is in-process against a control-plane double. It is not a deployed boot. | Server-assigned binding (see above). `TO MEASURE AT CANDIDATE FREEZE`: a worker enrolled for Organization A is offered no job of Organization B | `DEP-015` (shipped CI boot), `DEP-018` | `TO MEASURE AT CANDIDATE FREEZE` |
| E4-2 | supervises only sandboxes | `E4-2-supervises-sandboxes` · **wired** | `createSupervisor` · `packages/worker-daemon/src/supervisor/supervisor.ts` | yes | 2 (`lifecycle/dispatch-runtime.ts`) | **Reachable with dispatch enabled** (guard-checked). The register evidence uses the per-op fake provider. A real E2B sandbox is `E7-1-coding-journey` (unwired). | `TO MEASURE AT CANDIDATE FREEZE` | `E7-1-JOURNEY-ARM`, `DEP-015` | `TO MEASURE AT CANDIDATE FREEZE` |
| E4-3 | survives restart | `E4-3-survives-restart` · **unwired** | `createStartupReconciler` · `packages/worker-daemon/src/supervisor/startup-reconcile.ts` | yes | **0** | **Not reachable.** The daemon bin calls `createStartupSteps(deps.reconciler)`, and `deps.reconciler` is never supplied. `StartupReconcilerDeps.leaseCandidates` has no durable source (`E4-F009`). | `TO MEASURE AT CANDIDATE FREEZE`: the lease-candidate store must be per-lease and must not leak across tenants | **`WRK-013`** (rulings F4 and F5: fence a live lease; the container-path narrowing) | `TO MEASURE AT CANDIDATE FREEZE` |
| E4-4 | replays its encrypted event outbox | `E4-4-event-outbox-replay` · **wired** | `createEventOutboxDrain` · `packages/worker-daemon/src/events/event-outbox-drain.ts` | yes | 2 (`lifecycle/dispatch-runtime.ts`) | **Reachable from the boot root** (guard-checked). The drain starts at boot, independent of leasing. | `TO MEASURE AT CANDIDATE FREEZE` | `DEP-018` (restart/replay fault) | `TO MEASURE AT CANDIDATE FREEZE` |
| E4-4b | event outbox store | `E4-event-outbox-store` · **wired** | `openEventOutboxStore` · `packages/worker-daemon/src/events/event-outbox-store.ts` | yes | 2 (`lifecycle/dispatch-runtime.ts`) | **Reachable from the boot root** (guard-checked). | `TO MEASURE AT CANDIDATE FREEZE` | — | `TO MEASURE AT CANDIDATE FREEZE` |
| E4-R | lease renewal driver (supporting) | no register entry | `createLeaseRenewalDriver` · `packages/worker-daemon/src/lease/lease-renewal.ts` | yes | 2 (`lifecycle/dispatch-runtime.ts`) | Composed by `composeDispatchRuntime`. **Reachable with dispatch enabled.** | — | `WRK-013` (F5: stop renewing a fenced lease) | `TO MEASURE AT CANDIDATE FREEZE` |
| E4-U | usage producer (`observeRun`) | no register entry | `SupervisorDeps.observeRun` (optional) · `packages/worker-daemon/src/supervisor/supervisor.ts` | yes (optional dependency) | the supervisor's own uses only | **Not reachable.** `composeDispatchRuntime` builds the supervisor through `makeSupervisor({...})` **without** `observeRun`: the source comment says *"observeRun stays absent (no sandbox stdout/stderr rides the stream yet)"*. Nothing produces usage, so E3-14 has no input. | Usage must be attributed to the lease's own Organization: `TO MEASURE AT CANDIDATE FREEZE` | **`WRK-018`** | `TO MEASURE AT CANDIDATE FREEZE` |
| E4-I | separate worker image | no register entry | `docker/images/build.sh` + `docker-compose.d1.yml` services `worker-a` and `worker-b` | yes | n/a (image, not symbol) | Built and booted by `d1-merge-train` (see E6-1). | — | — | `TO MEASURE AT CANDIDATE FREEZE` |
