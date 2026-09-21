# MIG-009 Wiring Result — the rollback drain gets an honest operator trigger (M1a)

**Status:** `gate_review`
**Date (UTC):** `2026-09-21`
**Epic:** `E10-desktop-migration-realtime`
**Plan task:** E10 implementation plan §8.1, *"`MIG-009` — wire the rollback drain to an honest operator trigger"*
**Implementer:** M1 build agent (Claude Opus 5)
**Start SHA:** `66d1f917619f5b201a27f378dc62ebd81bb5bb38` (`origin/docs/replatform-program`)
**Reviewed revision (implementation):** `de2664b3d4695ed2ffcb19316e9f220cc483b8fd` (the feature) + `6687b23cd405881d23149be08ee023b9bbd544d7` (the DE-20 tripwire fix, §6a); CI evidence in §7 is on merge head `b911376ea7444f9c119e56301312d1dc2b6e3cde`
**PR:** #544 (base `docs/replatform-program`)

The implementer leaves `Status` at `gate_review`. A separate reviewer is the only role that may
change it to `complete`.

★★★ **This is a NEW record.** The frozen [`MIG-009-drain-result.md`](./MIG-009-drain-result.md)
records the trigger as deliberately `unwired` and may not be reused for `M1a` criterion 1
(`scope-triage.md`). It is not edited. [`MIG-009-B1-result.md`](./MIG-009-B1-result.md) (the `M0`
evidence-currency half) is not edited either.

---

## 0. The summary line

`createDistributedExecutionDrain` now has exactly one production caller, and that caller **reaches
`drainAll` exactly once per run**: `pnpm drain:distributed-execution --operator <who>`. `E10-1-drain`
moves `unwired → wired` in the same commit. It is an **operator** action, never automatic, and the
kill-switch **UI** is **not** delivered here (REL-005).

## 1. The approval the task stopped on

§8.1 was marked *"STOP for controller approval before implementation"* on the trigger split. That
approval is **founder ruling F6** (`scope-triage.md`, "M1 rulings"): *a CLI now, the kill-switch UI
later (REL-005); the audit write is atomic with each attempt's cancel.* The two `decisions.md`
choices §8.1 owes are recorded in the new
[`../decisions.md`](../decisions.md), decided under founder delegation **F2**:

- **E10-D001** — the silent-cancel dead lever is closed by a per-attempt failure **ledger at the
  drain's `requestCancellation` seam** (option 1, widen the result, realized in the trigger's
  report rather than the service). **No** convergence recheck.
- **E10-D002** — each attempt's cancel and its `job.drain.requested` `activity_log` row commit in
  **one** `runInTenant` transaction bound to that attempt's own Organization; the actor is
  `system` / `operator-cli:<who>`.

## 2. What was built

| File | Role |
|---|---|
| `server/src/services/distributed-execution-drain-trigger.ts` (new) | Testable core. `createAuditedDrainCancellation` (the adapter: tenant binding, derived `commandId`, audit in the same transaction, failure ledger), `runDistributedExecutionDrainTrigger` (composes `createDistributedExecutionDrain`, calls `drainAll` once), `drainExitCode`, `formatDrainReport`, `runDrainDistributedExecutionCli`. |
| `server/src/services/distributed-execution-drain-trigger-store.ts` (new) | `composeDistributedExecutionDrainTriggerDeps` — the real composition: `createAdmittedOrganizationIdsLister`, `createDistributedExecutionDrainStore`, `jobBudgetCostBridge(...).assertRollbackSafe`, `runInTenant` + `recordJobDrainActivity`. |
| `server/src/services/admitted-organizations.ts` (new) | The `index.ts` admitted-Organization enumerator, **extracted verbatim** so the trigger reuses it (§8.1: *"reused rather than re-derived"*). `index.ts` now composes it. |
| `server/src/cli/drain-distributed-execution.ts` (new) | Process wiring only: `loadConfig`, `openDistributedExecutionDatabases`, `process.exit`. |
| root `package.json` | `"drain:distributed-execution"` beside `reconcile:legacy-resources`. |
| `scripts/gate-clause-wiring.json` | `E10-1-drain` → `wired` (reason rewritten; the superseded reason is kept verbatim inside it). `E3-15-budget` gains `expectedReferences: 1` — see §6. |
| `docs/architecture/distributed-execution-threat-controls.json` | Eleven `server/src/index.ts` citations re-pointed by symbol (the extraction moved them −25 lines); one previously bare `:1355` given its anchor. Census unchanged at 397. |
| `docs/deploy/environment-variables.md` | The rollback section gains **Step 3**, the command. |
| `docs/replatform/epics/E10-desktop-migration-realtime/decisions.md` (new) | E10-D001, E10-D002. |
| tests | `drain-distributed-execution-cli.test.ts` (new, 13); `job-distributed-drain.integration.test.ts` (+6); `job-control-runtime.test.ts` (its enumerator source assertions re-pointed to the file the code moved to). |
| DE-20 records (commit `6687b23cd`, §6a) | `de-20-cutover-selection-audit.integration.test.ts` census arm pinned by file; dated fact-only amendments to DE-20, `E0-F014`, `cutover-selection-audit.ts`, `heartbeat.ts` (same line count). |

**Not modified:** `server/src/services/job-distributed-drain.ts`, `job-distributed-drain-store.ts`
(`git diff 66d1f9176 -- <both>` is empty). No migration, schema, or `packages/worker-protocol` change.

## 3. RED → GREEN

All runs are local (Windows, `C:\b009`), `pnpm --filter`-equivalent `pnpm exec vitest run` from
`server/`. Integration runs set `AOA_RUN_WIN_INTEGRATION=1`, which that suite honours (its
`describe.skipIf` opts Windows in); the Linux CI shard evidence is in §7.

| Step | Invocation | Native exit | Result |
|---|---|---|---|
| RED 1 — interface scaffold, every export `throw new Error("not implemented")` | `vitest run src/__tests__/drain-distributed-execution-cli.test.ts` | 1 | **13 failed (13)**, each `Error: not implemented` — behavioural, not a compile error (tests are not type-checked). |
| RED 2 — the full trigger with the NAIVE exit code (`skippedOrganizations` only, as §8.1's earlier revisions implied) | same | 1 | **3 failed \| 10 passed.** `SILENT-CANCEL (i)` fails `expected +0 not to be +0` — **the dead lever, reproduced**: a thrown cancel, an empty skip list, exit 0. `AUDIT ATOMICITY` and `MULTI-TENANT` fail for the same reason. |
| GREEN — exit code reads the ledger too (E10-D001) | `vitest run job-distributed-drain.test.ts drain-distributed-execution-cli.test.ts` | 0 | **21 passed (21)** (8 existing drain + 13 new). |
| GREEN — embedded PG | `vitest run src/__tests__/job-distributed-drain.integration.test.ts` | 0 | **11 passed (11)** (5 existing + 6 new). |
| GREEN — re-pointed source test | `vitest run job-control-runtime.test.ts` | 0 | 25 passed (25). |
| typecheck | `pnpm --filter @armyofagents/server typecheck` | 0 | — |
| build | `pnpm --filter @armyofagents/server build` | 0 | — |
| registers | `node scripts/check-gate-clause-wiring.mjs` | 0 | `OK (23 wired clause(s), 11 declared dormant, …)`; `E10-1-drain` no longer in the DORMANT list. |
| full guard set (M1-AGENT-RULES) + `check-evidence-immutability --base origin/docs/replatform-program` | — | 0 | `failures: 0` |

The integration arm was written after the unit GREEN, not before; its bite is proven by mutation (§4),
not by a pre-implementation RED. Said plainly so the table is not read as more than it is.

**CLI smoke (flag off, and usage):** `pnpm -s drain:distributed-execution --operator smoke-test` with
`AOA_DISTRIBUTED_EXECUTION_ENABLED` unset prints the refusal and exits 1 without opening a pool;
`tsx server/src/cli/drain-distributed-execution.ts` with no `--operator` prints usage and exits **2**.
A flag-on run of the entrypoint against a real deployment was **not** performed here (it needs the
three production credentials); the composition root it hands off to is what §3's embedded-PG arm runs.

## 4. Mutation sweep — every guard deleted, positive control first

Runner: a script that applies each mutant to the committed tree (`de2664b3d`), runs the unit file and
the embedded-PG file, restores with `git checkout --`, and asserts `git status --porcelain` is empty
before the next mutant. File under mutation: `distributed-execution-drain-trigger.ts` unless noted.

| Mutant (a DELETION or weakening) | Unit (13) | Embedded PG (11) | Killed by |
|---|---|---|---|
| **M0** (positive control) — drop the summary's `cancelled` propagation | 1 failed | 3 failed | `POSITIVE CONTROL`; PG positive control, terminal-only, leased |
| **M-reach** — compose the drain, never call `drainAll` | 10 failed | 5 failed | **`REACH` (drainAll exactly once)** and every behavioural test. ★ This is the mutant §8.1 says must not survive. |
| **M-commandId** — a fresh random id instead of the derived one | 2 failed | 1 failed | `COMMAND ID` (asserted on the id **at the adapter boundary**); PG leased arm's `command_id = deriveDrainCommandId(jobId)` |
| **M-exit** — always exit 0 | 4 failed | 3 failed | `SKIP`, `SILENT-CANCEL (i)`, `AUDIT ATOMICITY`, `MULTI-TENANT`; PG sibling-receipt, atomicity, multi-tenant |
| **M-ledger** — exit code reads `skippedOrganizations` only | 3 failed | 2 failed | `SILENT-CANCEL (i)` — the dead lever |
| **M-flagoff** — remove the flag-off guard | 1 failed | 0 (not its lane) | `FLAG-OFF` (the `openPools`-never-called assertion) |
| **M-skiplist** — print a count, not `skippedOrganizations` | 3 failed | 4 failed | `SKIP` (verbatim ids) and every test reading the summary |
| **M-audit-besteffort** — `recordDrainAudit(...).catch(() => {})` | 1 failed | 1 failed | `AUDIT ATOMICITY`; **PG atomicity** (a real cancel committed with no row) |
| **M-audit-delete** — no audit write | 3 failed | 4 failed | `AUDIT`; PG positive control, leased, multi-tenant |
| **M-tenant** — bind every cancel to the first-seen Organization | 6 failed | 1 failed | `MULTI-TENANT` (per-call binding); **PG multi-tenant** (the second tenant's job reads `not_found` under the wrong RLS binding and is never cancelled) |
| **M-naive-recheck** — an immediate terminal-state recheck after the sweep | 6 failed | 3 failed | `SILENT-CANCEL (ii)` — the positive control for §8.1's fourteenth-round correction; PG leased arm (`cancel_requested` at return) |
| **M-register** — `E10-1-drain` back to `unwired` with the CLI present | — | — | `check-gate-clause-wiring.mjs` exit 1: `declared unwired but it now HAS a caller` |

Every mutant killed; the tree was clean after each restore.

## 5. The `commandId` derivation

`deriveDrainCommandId(jobId)` = the first 16 bytes of `sha256("aoa.distributed-execution-drain.cancel.v1:" + jobId)`
with RFC 4122 version-5 and variant bits set, formatted as a UUID. Deterministic per job, distinct per
job, and never equal to the jobId, so it is distinguishable from the budget bridge's
`commandId: jobId` in `job_control_commands`.

★ Per §8.1's ninth/eleventh-round correction, this is **not** what dedups a re-run:
`requestCancellation` returns `already_requested` for an existing cancel on the lease before the id is
used. The PG leased arm shows exactly that — the second run writes an audit row with outcome
`already_requested` and still exactly **one** cancel command — and the id is asserted at the adapter
boundary, which is the only place a random id would be caught.

## 6. The register transitions

- **`E10-1-drain`: `unwired → wired`.** New reason names the caller (`runDistributedExecutionDrainTrigger`),
  the entrypoint, the reached-exactly-once test and `M-reach`, the two seam additions (E10-D001/D002),
  and the boundary: operator action, not automatic; the kill-switch UI and any automatic trigger stay
  REL-005's. The superseded reason is kept verbatim at the end of the new one.
- **`E3-15-budget`: stays `unwired`, gains `expectedReferences: 1`.** The trigger's composition
  constructs `jobBudgetCostBridge` **only** to call `assertRollbackSafe`, which §8.1 requires (*"the
  real budget-cost bridge"*). That made the guard report the billing clause as newly having a caller.
  It does not: `priceAcceptedUsage` is still unreferenced and a handed-off run is still unbilled.
  Raising the expected count to 1, with a dated amendment appended to the reason (the old opening is
  left unedited), keeps the clause honest **and** keeps it biting: a second reference — JOB-016's
  accepted-usage pricing — reds the guard and forces the promotion decision. Before the amendment the
  guard reported exactly this (`jobBudgetCostBridge has 1 reference(s), expected 0`), which is the
  positive control for the amendment.

## 6a. The DE-20 tripwire, and the records that said "zero callers"

The first CI run on this PR (run `35583977116`, head `1b39212613323b18df43a92a9e418e8ba983d27f`)
failed **`verify (3)`** on exactly one test:
`de-20-cutover-selection-audit.integration.test.ts` > *"THE ROLLBACK CONJUNCT IS STILL VACUOUS … createDistributedExecutionDrain still has ZERO production callers"* —
`AssertionError: expected 1 to be +0` (shard totals `1 failed | 5880 passed | 29 skipped (5910)`).
That arm was written to do exactly this: go red **naming** the change the day a caller appears. I
did not find it before pushing, because I searched `*.json`/`*.ts` for register mentions but never ran
that suite locally. Recorded as a miss.

What `6687b23cd` does, and deliberately does not do:

- **The arm now pins the caller BY FILE** (`services/distributed-execution-drain-trigger.ts`, and
  nothing else) instead of pinning zero. The meaning it protects is unchanged: the only caller is
  operator-invoked and whole-fleet, **not** bound to the rollout dial, so a dial change still
  cancels nothing. Positive control: a temporary second caller file reds it (`1 failed | 9 passed`);
  removed afterwards, tree clean.
- **Dated, FACT-ONLY amendments, the old text kept**, wherever a record stated "zero production
  callers" of the drain: DE-20 `revocation` and `audit` in the threat-controls register;
  `E0-F014` item (2) in `scripts/finding-ownership.json`; the `cutover-selection-audit.ts` header;
  the `heartbeat.ts` comment (rewritten in place with the **same line count**, because that file is
  line-cited throughout the register).
- **NOT changed:** DE-20's `deliveryStatus` (`partial`), `E0-F014`'s status, and E0-F013
  Decision 1's disposition of DE-20's rollback-audit conjunct (4b). Whether an audited, operator-run,
  whole-fleet rollback now satisfies the conjunct Decision 1 dropped as vacuous is **a decision this
  ticket does not own**; it is raised in the PR for the planning session. `E0` `findings.md`'s DE-20
  table row still says "zero production callers" and was not edited, for the same reason.

The other red job in that run, **`verify (1)`**, failed
`service-reconciler.integration.test.ts` > *T1b(ii)* on `canceling statement due to lock timeout`
(`55P03`) — a timing-sensitive advisory-lock test in a file this PR does not touch. It passes locally
(`17 passed (17)`). Its result on the next run is in §7.

## 7. CI evidence

Run `35585928427` (workflow `PR`) on head `b911376ea7444f9c119e56301312d1dc2b6e3cde` — every job
green, `ci-required` **pass**. The Linux `verify` shards are the formal authority for the embedded-PG
suites (DEC-03); each file below is cited by the shard that executed it, with a non-zero count.

| Job | File | Executed | Shard totals |
|---|---|---|---|
| `verify (2)` (job `106289186394`) | `job-distributed-drain.integration.test.ts` | **11 tests** ✓ | 655 files passed, 2 skipped; 6205 tests passed, 33 skipped |
| `verify (3)` (job `106289186363`) | `de-20-cutover-selection-audit.integration.test.ts` | **10 tests** ✓ | 653 files passed, 4 skipped; 5881 tests passed, 29 skipped |
| `verify (3)` | `job-distributed-drain.test.ts` | **8 tests** ✓ | (same shard) |
| `verify (4)` (job `106289186374`) | `drain-distributed-execution-cli.test.ts` | **13 tests** ✓ | 657 files passed; 6114 tests passed, 2 skipped |
| `verify (4)` | `job-control-runtime.test.ts` | **25 tests** ✓ | (same shard) |
| `verify (1)` (job `106289186409`) | `service-reconciler.integration.test.ts` (the §6a lock-timeout red) | **17 tests** ✓ | 654 files passed, 3 skipped; 6386 tests passed, 12 skipped |

`policy` (which runs `check-gate-clause-wiring`, `check-register-citation-integrity`,
`check-finding-ownership` and the rest of the guard set), `migrations`, `e2e`, `e2e-pgvector`,
`distributed-contract`, `lint`, `browser`, `brand-check` and both `worker-protocol-contract-bytes`
lanes: pass.

## 8. Multi-tenant (ruling F10)

- **Unit:** two Organizations (three Companies). Every cancel's tenant binding equals its attempt's
  Organization (`MULTI-TENANT` asserts the full `(boundOrg, jobId)` sequence); a failure injected for
  one Organization is reported on that Organization's line only, and the other still drains.
- **Embedded PG:** a second real Organization (`ORG_2`) with its own Company. Same-tenant positive
  control: both tenants' attempts are cancelled and each audit row carries its own Company. Then
  `ORG_2`'s tenant transaction is made to fail: exit 1, `failedCancellations` names only `ORG_2`'s job,
  `ORG`'s attempt is still cancelled, `ORG_2`'s is still `running`. `M-tenant` proves the binding is
  load-bearing against real RLS.
- There is no "control Organization that is refused" arm, deliberately: the drain is a rollback and
  must reach **every** admitted Organization. The admitted set is the one shared enumerator the server
  uses.

## 9. What this does NOT do, and what I found that disagrees with the plan

- **No kill-switch UI and no automatic trigger** (REL-005). No convergence check (E10-D001). The
  operator identity is a declared label, not an authenticated one (E10-D002).
- **Plan vs code — execution census.** §8.1 says *"the new test file moves the execution census, so
  the census manifest is updated in the same commit."* It does not: `check-execution-census.mjs`
  censuses `*.test.mjs` under `scripts/` and `docker/` only. A vitest `.ts` file does not move it, and
  the guard is green unchanged. No manifest was edited.
- **Plan vs code — the docs step.** §8.1 says to *"replace the hand-executed-SQL rollback step with the
  command."* The hand-executed SQL in `environment-variables.md` is **Step 1, the kill-switch**, which
  the drain does not replace (it stops new leases; the drain cancels in-flight work). The drain
  replaces the **manual per-run cancel**, so it was added as **Step 3** and the per-run-cancel sentence
  was rewritten. Step 1's text (including its "there is no write path" claim, which §8.1 says is stale)
  is untouched — that is not this ticket's to correct.
- **Plan vs code — `index.ts` reuse.** §8.1 lists `listAdmittedOrganizationIds` at `index.ts` as
  *"reused rather than re-derived"*, but it was an inline closure a CLI cannot import. It was extracted
  verbatim (`admitted-organizations.ts`) and `index.ts` now composes the extracted function, which is
  why `index.ts` and the threat-controls citations appear in this diff.
- **The service's own comment is now stale.** `job-distributed-drain.ts` still says the wiring
  adapter is *"REL-005"* and repeats the false duplicate-cancel rationale §8.1 corrected. It was not
  edited, because §8.1 forbids editing that file.
