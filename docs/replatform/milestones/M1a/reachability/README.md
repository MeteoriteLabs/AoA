# M1a candidate reachability ledgers — E3, E4, E5, E6 (FILLED AT CANDIDATE)

One ledger per epic: [E3](./E3-job-control.md) · [E4](./E4-worker-daemon.md) ·
[E5](./E5-workspaces-secrets.md) · [E6](./E6-deployment-test-harness.md).

**Status: FILLED AT THE `M1a` CANDIDATE `7be35ae6b7719877e61f54ab552de84de8491e7d`**, 2026-09-23 UTC,
by the `M1a` QA owner — a review session distinct from the planning session that took the decisions
and dispatched the runs (founder ruling F2). Every caller count in the `At candidate` column was
re-measured at the candidate with `countProductionCallers`; no tip value was copied forward. At the
candidate the wiring guard reports `OK (28 wired clause(s), 6 declared dormant, 2
provider-capability claim(s) matched to source)`; at the tip it reported 22 wired / 12 dormant.

*(Superseded status line, kept as first written: "**Status: SKELETON.** Measured at the program tip
`b71f0dd539fe713c776f3935932be33af1a24fae` by a distinct review session (M1 plan §3, unit S0-7b).
**Not yet candidate-specific.** Every cell that depends on the candidate reads `TO MEASURE AT
CANDIDATE FREEZE`. A cell filled at the tip is a starting point to re-verify. It is **not** carried
over to the candidate.")*

★★★ **The `@tip` columns are preserved verbatim** and are not rewritten. A `TO MEASURE AT CANDIDATE
FREEZE` still visible inside a `@tip` cell is answered in that row's `At candidate` cell.

★★★ **The `Certified only by M1-D1-SPINE` judgement is now determinate — and it has THREE
values, not two.** The `M1a-D2-MECHANISM` profile of `tests/d1/fault-matrix.json` declares **23**
cases at the candidate and **all 23 carry `evidence: "pending"`**; `.github/workflows/m1-shipped-boot.yml`
has no fault-matrix step, so the keyed run `35920425288` fired none of them. Read every row against
this three-way split, and **never collapse the third bucket into the first**:

| Bucket | Meaning | Examples |
|---|---|---|
| **Certified by `M1-D1-SPINE` only** | the case **ran**, on the spine lane, with its control — and the mechanism lane did not repeat it | the nine `d1.tenant.cross.*` denials, the four `d1.tenant.legacy.*` predicates, both cancellation cases, `d1.provider.execute_deadline_exceeded`, the object-store and orphan-sweep cases, both link cuts, `d1.reconcile.expired_lease_reaped`, `d1.restart.control_plane_process` |
| **Observed on the mechanism lane** | measured on real E2B, but not as a declared fault case | real-sandbox create/execute, secret redemption, usage cardinality, the `DEP-017` env probe |
| ★★★ **Certified by NO campaign** | declared and **never run anywhere** — missing evidence, not coverage | `d2m.provider_failure.e2b_create_refused`; all three `d2m.cleanup.sandbox_destroyed_on_*`; `d2m.cancellation.leased_attempt`; `d2m.reconcile.daemon_restart_with_live_lease`; every `d2m.tenant.*`; `d1.reconcile.worker_startup_lease_probe`; `d1.provider.worker_terminal_mapping`; `d1.credential.production_reader_company_predicate` |

★ **The spine lane ran the REFERENCE provider.** It therefore proves nothing about E2B create,
execute, teardown or a real charge, and no spine case may be cited for a provider-specific claim.

★★★ **The spine's own `pending` reason for two of its three cases is STALE.**
`docker/d1/m1-spine.override.yml:137` sets `AOA_WORKER_DISPATCH_ENABLED: "1"` on `worker-b`, both
`m1-spine` and `m1-fault-matrix` boot that override (`d1-merge-train.yml` :419, :678), and `m1-spine`
asserts `dispatch COMPOSED` in worker-b's log (:483). `d1-dispatch-declared.mjs` parses the BASE
compose only. So `d1.reconcile.worker_startup_lease_probe` and `d1.provider.worker_terminal_mapping`
were never structurally unavailable on the certified lane — they can be run there, keylessly.

## Where the rows come from

- Each epic's `gate-clause-wiring` entries (`scripts/gate-clause-wiring.json`, checked by
  `scripts/check-gate-clause-wiring.mjs`). At the tip the guard reports
  `OK (22 wired clause(s), 12 declared dormant …)`.
- Each epic's **exit gate** sentence in `epics/<epic>/README.md`. Clauses with no register entry
  still get a row, marked `no register entry`.
- The M1 tickets in `qa/2026-09-21-m1-execution-plan.md` §4 that change a row. They are named in
  the row, and the row is re-measured after the ticket merges.

## Columns

| Column | Meaning | How it is measured |
|---|---|---|
| **Present** | The mechanism's symbol exists in non-test source | The symbol is found by name at the stated file |
| **Callers** | Production callers, as the guard counts them | `countProductionCallers(root, symbol)` exported from `scripts/check-gate-clause-wiring.mjs` (non-test files under `server/src`, `packages`, `cli`; static imports blanked). The file names were listed by the same scan. ★ *The count is lines, not call sites.* A dynamic `await import` destructure counts as one, so `2` in `server/src/index.ts` is usually one composition site. |
| **Production-reachable** | A deployed process reaches the mechanism on a real request or tick | The call chain was read up to a composition root: `server/src/index.ts`, `server/src/app.ts`, or the worker daemon's `composeDispatchRuntime`. The flags it sits behind are named. `wired` in the register counts as reachable **only** because the guard checks it. **A non-zero caller count alone is not reachability.** |
| **Certified only by `M1-D1-SPINE`** | The clause's only milestone evidence is the spine campaign, not `M1a-D2-MECHANISM` | **Only knowable once the campaign scopes and fault matrix (`DEP-016`, `DEP-018`) are frozen.** Every row reads `TO MEASURE AT CANDIDATE FREEZE`. |
| **Tenant isolation (F10)** | How cross-tenant separation is enforced for this mechanism's data | Read at source: RLS on a kernel or `*_rls` table, a query predicate on a legacy table, or a deployment-wide `process.env` switch with no per-Organization dimension. M1 is multi-tenant (ruling F10), so every campaign proves isolation for ≥2 enabled Organizations plus 1 control Organization. |
| **Evidence** | What the tip measurement rests on | File and symbol, CI job, or register key |

## Measurements that apply to every ledger

- **Deployment gate.** Every server-side distributed mechanism is composed only inside
  `if (config.distributedExecutionEnabled && distributedExecutionDatabases)` in
  `server/src/index.ts` (two blocks). The routes are mounted only inside `if (opts.distributedExecutionEnabled)` in
  `createApp` (`server/src/app.ts`), which throws without verified `aoa_app` and `aoa_operator` pools. That
  flag is **deployment-wide**.
- **Per-Organization gate.** Heartbeat task-run submission is gated per Organization by
  `createHeartbeatDistributedRolloutHook` plus `createDistributedExecutionRolloutSource`
  (`AOA_DISTRIBUTED_EXECUTION_ROLLOUT`), composed in the `index.ts` flag block.
- **Deployment-wide switches that have no per-Organization dimension at the tip** (F10: *"every
  deployment-wide switch gets a per-Organization dimension before M1b"*):
  `readDistributedToolSurfaceFlag(process.env)` in `heartbeatService` (`server/src/services/heartbeat.ts`),
  and `readDistributedCrewRolloutFlag(process.env)` in `runAoaAgent`
  (`server/src/services/internal-agent/aoa-agents/runner.ts`).
- **RLS covers the kernel and `*_rls` job tables only.** `aoa_app` also holds grants on 40 legacy
  tables through `JOB_CONTROL_LEGACY_GRANTS` (`server/src/db/job-control-legacy-grants.ts`), among
  them `cost_events`, `activity_log`, `issues`, `artifacts`, `task_outputs` and `provider_credentials`.
  **None of them has RLS**, and `runInTenant` passes its raw transaction to legacy service code.
  Isolation on those rows is by query predicate. See the E0–E2 delta review §4.

## Filling a ledger at candidate freeze

1. Replace the tip SHA with the frozen candidate SHA in the ledger header.
2. Re-run the caller scan and re-read each chain to its composition root for every row. **Do not
   copy a tip value forward.**
3. Fill **Certified only by `M1-D1-SPINE`** from the frozen `DEP-016` and `DEP-018` profiles.
4. Fill **Evidence** with the campaign record paths under `milestones/M1a/qa/` once they exist.
