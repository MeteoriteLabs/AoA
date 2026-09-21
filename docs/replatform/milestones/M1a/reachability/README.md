# M1a candidate reachability ledgers — E3, E4, E5, E6 (skeletons)

One ledger per epic: [E3](./E3-job-control.md) · [E4](./E4-worker-daemon.md) ·
[E5](./E5-workspaces-secrets.md) · [E6](./E6-deployment-test-harness.md).

**Status: SKELETON.** Measured at the program tip `b71f0dd539fe713c776f3935932be33af1a24fae`
by a distinct review session (M1 plan §3, unit S0-7b). **Not yet candidate-specific.** Every cell
that depends on the candidate reads `TO MEASURE AT CANDIDATE FREEZE`. A cell filled at the tip is a
starting point to re-verify. It is **not** carried over to the candidate.

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
