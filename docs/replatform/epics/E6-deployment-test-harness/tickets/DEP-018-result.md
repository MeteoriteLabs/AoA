# DEP-018 — The campaign fault matrix and injection harness — result

**Status:** `complete` (set 2026-09-23 by the M1 review-batch-4 independent reviewer; see *Independent review*).
**Epic:** E6 · **Plan task:** `E6 implementation-plan §4c DEP-018` (as amended at M1 Step 0, S0-8) · **Milestone:** `M1a`
**Date (UTC):** `2026-09-23`
**Implementer:** Claude Opus 5 (M1 build agent)
**Start SHA:** `b3c5aa417` (`origin/docs/replatform-program`)
**PR:** #TBD (base `docs/replatform-program`)

---

## 1. What shipped

| Piece | File | What it is |
|---|---|---|
| The declaration | `tests/d1/fault-matrix.json` | **3 gate profiles, 73 cases** (25 required, 48 pending — the pending count rose during review; see §11b). Each case carries `case`, `family`, `injection.{mechanism,target,observedBy}`, `expectedClassification` and — for a tenant case — `tenantCase`. |
| The pure verdicts | `scripts/lib/campaign-fault-matrix.mjs` | `evaluateFaultMatrixDeclaration` (is the matrix complete?) and `evaluateFaultMatrixEvidence` (did each case's injection FIRE, and did the classification match?), plus the enumerated constants `GATE_PROFILES`, `REQUIRED_FAMILIES`, `REQUIRED_TENANT_SURFACES`, `REQUIRED_LEGACY_TABLES`. |
| The checker | `scripts/check-campaign-fault-matrix.mjs` | Thin CLI. Bare = the declaration; `--evidence <bundle>` = a lane's run. Declared in `scripts/guard-inventory.json`. |
| The checker's reds | `scripts/check-campaign-fault-matrix.test.mjs` (25 tests) | One red fixture per violation code, against a zero-violation anchor. Wired into `pr.yml` `policy` → *Campaign fault matrix declaration (DEP-018)*, declared in `scripts/test-execution-census.json`. |
| The injection harness | `tests/d1/m1-fault-matrix.test.mjs` (20 cases) + 12 additive helpers in `tests/d1/lib/e6f-harness.mjs` | The live `M1-D1-SPINE` lane, on the D1 compose with DEP-016's one-worker override and its F10 tenant set. |
| The lane | `.github/workflows/d1-merge-train.yml` job **`m1-fault-matrix`** | Builds the split images, brings the override up, asserts ONE worker service, runs the matrix, runs the checker over the retained bundle, collects the PASSING bundle, then runs the **suppressed-injection positive control** and fails the lane if it passes. New trigger paths: `tests/d1/fault-matrix.json`, `scripts/lib/campaign-fault-matrix.mjs`, `scripts/check-campaign-fault-matrix.mjs`. |

**New helpers (all additive; nothing existing was modified except the two noted in §6):**
`composeServiceRuntime`, `restartComposeService`, `tcpProbeFromTestRunner`, `leaseRenew`,
`resolveExecutionSecretHttp`, `seedExecutionSecretHandle`, `queryScopedRowsAsApp`,
`requestCancellationInContainer`, `queryJobAttemptsAndCommands`, `probeLegacyTableIsolation`,
`probeToolSurfaceAtUse`, `seedToolSurfaceRuns`.

**Reuse, not a second implementation.** The per-tenant journey verdict
(`evaluateEnabledTenantSpine`), the control-tenant verdict (`evaluateControlTenant`) and the
hostile-isolation verdict (`evaluateCrossTenantIsolation`) are **DEP-016's**
(`scripts/lib/m1-spine-assertions.mjs`), called here rather than restated. No verdict's shape
needed extending, so none was changed.

★ **And that is held, not merely asserted.** The task's reuse clause asks for a test that the lanes
cannot drift. Since nothing was extended, the real drift risk is not a diverging signature — it is
someone later pasting a second `evaluateEnabledTenantSpine` into the lane and quietly asserting
something weaker while both files still claim to prove the same thing. The anti-drift self-test requires
the lane to IMPORT all three symbols from `m1-spine-assertions.mjs` and to define no rival under
those names, **and** requires those three to be genuinely exported there — so the check cannot pass
by searching for a name that does not exist. Positive control, run: removing
`evaluateControlTenant` from the lane's import and defining a local stub in its place reds it with
*"the lane must IMPORT evaluateControlTenant from DEP-016 rather than restate it"* (`23/24`);
reverted, and the suite is green again.

## 2. Acceptance → evidence

| # | Acceptance (E6 plan §4c) | Where it is proven |
|---|---|---|
| 1 | Every declared case has a run showing **its injection fired**, with the observed classification matching | §3: **25/25 required cases fired and classified**, twice. The verdict is `evaluateFaultMatrixEvidence`, run by the harness's own last case AND by the checker over the retained bundle. §4's suppressed control is what shows it can say NO. |
| 2 | Every cross-tenant denial is **denied, not merely empty**, with a same-tenant **positive control** | §3a — nine surfaces, each with its control. ★ For the four tables of acceptance 5 the "with RLS" half **cannot** hold and is not claimed; see §3b. |
| 3 | The control tenant is refused distributed execution and stays legacy | §3c, through the REAL placement service with the enabled-tenant positive control. |
| 4 | The checker reds on an undeclared case, a case with no injection evidence, or a profile missing the tenant matrix | §5 — 25 self-tests, one red fixture per violation code, including "drop ANY of the nine surfaces" and "drop ANY of the four legacy tables" as loops. |
| 5 | ★★★ The four legacy tables are tested **DIRECTLY**, through the production query path, with a positive control **and** an anti-vacuity control | §3b. |

## 3. GREEN — the live run (local, real D1 stack)

Run against `docker-compose.d1.yml` + `docker/d1/m1-spine.override.yml`, with images built from
this branch's base `b3c5aa417` (`docker/images/build.sh`; `CONTROL-PLANE_REVISION` =
`b3c5aa41789a0e775b196bb7dc0eff12377031d3`, i.e. the tree under test).

```
AOA_D1_LIVE=1 AOA_D1_CAMPAIGN=m1-fault-matrix node --test --test-concurrency=1 \
  tests/d1/m1-fault-matrix.test.mjs
→ tests 20, pass 20, fail 0          (run twice; see §4 for the runs in between)

node scripts/check-campaign-fault-matrix.mjs --evidence <bundle>
→ OK: profile M1-D1-SPINE: 25/25 required case(s) fired and classified as declared,
      1 pending. Profile INCOMPLETE (pending cases remain).
```

`INCOMPLETE` is the honest verdict and is by design: one D1 case is declared `pending`
(§7), so the profile is not claimable as complete, and the checker says so rather than
rounding up.

### 3a. The nine cross-tenant surfaces, as measured

Every row is a real request against a **live-fenced** attempt of tenant A, made with tenant B's
own worker session and device key. Where the batch carries an identity, it carries the
**attacker's** worker id with the **victim's** Organization, Company, job, lease and fence — so a
refusal can never be the session-vs-batch identity check (DEP-016's own lesson, applied here).

| Surface | Hostile result | Same-tenant positive control |
|---|---|---|
| `events` | **401 `unauthorized`** on the real fenced ingest | A's own worker's identical upload: **200 `accepted`** |
| `read` | A's `job_events` under **B's** scope on the non-owner `aoa_app` pool with RLS: **0 rows** | the same read under A's own scope: **1 row** |
| `lease` | B renews A's live lease at `/worker-control/leases/:id/renew`: **409 `stale_fence`**, pinned | A's own renew of the same lease: **200 `renewed`** |
| `cancel` | the PRODUCTION `requestCancellation` under B's Organization and Company against A's job: the service returns **`not_found`** and A's attempt is **untouched** | the same service on a throwaway A job: **`queued`**, with a real cancel command |
| `secrets` | B resolves A's handle at the fenced route: **`denied`**; and A's `job_secret_handles` row under B's scope: **0 rows** | A's own scope: **1 row**. ★ Bounded claim — see below |
| `staged_inputs` | B requests a transfer grant on A's attempt: **409 `stale_fence`**, pinned | A's own grant: **200 `upload_granted`** |
| `outputs` | B commits an artifact onto A's attempt: **409 `stale_fence`**, pinned | A's own commit: **200 `committed`** |
| `cost_rows` | B's `companyId` through the production `costService`: **0 of A's charges** | A's own: the journey's real charge, **> 0 cents** |
| `tool_calls` | B's `companyId` with A's run id through the production `createDistributedToolSurfaceUseResolver`: **`deny`** | the SAME resolver on A's own local run under A's own Company: **`admit`** |

- **`secrets`, stated plainly.** The fenced resolve route collapses **every** refusal to
  `{outcome:"denied", reason:"malformed"}` by design, so it cannot be an oracle for which worker,
  lease or handle exists (`worker-control.ts`, the route's catch-all `denyMalformed`). Measured on
  the first live run: the foreign call and the owner's call both read `malformed`. So the HTTP arm
  proves **refusal and nothing finer, and carries no positive control of its own** — a `resolved`
  reply needs a real credential, which is the keyed gate's case. The denial-with-a-control on this
  lane is therefore the **durable row** under forced RLS (`job_secret_handles` is in
  `TENANT_RLS_TABLES`): foreign scope 0, own scope 1, same pool, same table, same row.
- **`tool_calls`, stated plainly.** On M1a the distributed tool surface is disarmed for every
  tenant (the freeze checklist), so "the same call succeeds for the owner" cannot exist. The
  control is instead that the SAME resolver **admits** A's own LOCAL run under A's own Company —
  so `admit` is demonstrably reachable and the cross-tenant `deny` is the company-mismatch arm's
  work, not "the resolver denies everything". The third arm records the freeze posture: A's own
  **distributed** run is also denied, because its Organization is not armed. The ARMED
  cross-tenant case is declared and owned by `CLI-016`/M1b (`d2c.tenant.cross.tool_calls`).

### 3b. Acceptance 5 — the four legacy tables (granted, NO RLS)

Verified at source before writing the case: `TENANT_RLS_TABLES` (`server/src/db/rls-tenant.ts`) is
**eight** tables and contains **none** of these four, while `JOB_CONTROL_LEGACY_GRANTS`
(`server/src/db/job-control-legacy-grants.ts`) gives `aoa_app` `SELECT`/`INSERT` on `cost_events`
and `activity_log`, `SELECT`/`INSERT`/`UPDATE` on `task_outputs`, and `SELECT` on
`provider_credentials`. So acceptance 2's *"denied … with RLS"* cannot hold for them and is not
claimed; the boundary is the **query predicate**, and that is what is measured.

All three reads run on the **same non-owner `aoa_app` pool**, inside the control-plane container.

| Table | Production path (own + foreign) | own | foreign | unscoped (anti-vacuity) |
|---|---|---|---|---|
| `cost_events` | `costService(db).byAgent(companyId)` — over the charge the REAL ingest priced during A's journey | 1 row, **81 cents** | **0** | > 0 |
| `activity_log` | `activityService(db).list({companyId, entityType:"job", entityId})` — over the rows `job-accepted-activity-audit.ts` wrote | 2 rows (`job.attempt_started`, `job.attempt_terminal`) | **0** | > 0 |
| `task_outputs` | `taskOutputService(db).listForIssue(companyId, issueId)` — planted through the production writer `upsertForIssue` | 1 row | **0** | > 0 |
| `provider_credentials` | ★ the two predicates the fenced `device_local` arm uses (`resolveExecutionSecret`), **replicated**, not that reader invoked — see §11b | 1 row | **0** | > 0 |

The **anti-vacuity** column is the same read with the tenant predicate REMOVED, and it returns the
owner's row every time — so each `foreign = 0` is shown to be the filter's work and not an empty
table. The assertion order in the case is deliberately `own > 0`, then `unscoped > 0`, then
`foreign === 0`: the two controls must hold before the denial means anything.

**Two bounded points, stated rather than discovered later.**
1. `provider_credentials` is planted by owner SQL and read through an equivalent two-predicate
   query on the `aoa_app` pool, **not** by calling `resolveExecutionSecret` itself. ★ **This is an
   acceptance-5 GAP, not a satisfied clause** — see §11b, where it is filed as its own declared
   pending case rather than left as a footnote.
2. `task_outputs` is planted through the production **writer**, not by the distributed projector:
   `job-accepted-output-projection.ts` fires only on an `artifact_prepared` event, which this
   lane's reference provider does not produce. The READ under test is the production reader.

### 3c. The control tenant

The REAL placement service, composed on the running control plane exactly as `server/src/index.ts`
composes it, decided **`legacy` / `organization_disabled` / `leaseEligible false`** for tenant C;
its worker's poll returned no work; it has no events, cost rows or receipts. The positive control —
the SAME service on an enabled tenant — returned **`selected` / `active` / `leaseEligible true`**.
`evaluateControlTenant` returned zero violations.

### 3d. The fault cases

| Case | Injection, and how it was observed to fire | Classification observed |
|---|---|---|
| `link_cut.worker_to_control_plane` | Toxiproxy proxy disabled; `probeProxyReachable` **false** while cut and **true** after restore | lease reaped to `expired`, retry minted, late ack refused |
| `link_cut.control_plane_to_postgres` | proxy disabled; a raw TCP connect to `toxiproxy:15432` **ECONNREFUSED** while cut, connected after restore (an HTTP probe cannot serve here — the link carries the PostgreSQL wire protocol) | the control plane answered **500** during the cut (fail closed, never a fabricated offer) and served real queries again after the restore |
| `object_store.truncated_upload` | `limit_data` toxic (64 bytes) on `worker-to-minio`; the presigned PUT **threw** | the fenced commit refused the unverifiable object |
| `restart.control_plane_process` | `docker compose restart control-plane`; the container's `State.StartedAt` **advanced** | the attempt and lease rows were byte-identical across the restart |
| `reconcile.expired_lease_reaped` | `expireLeaseDeadlines` reported `updated: 1` — the durable deadline row actually moved | attempt 1 `expired`, exactly one `pending` retry |
| `cancel.leased_attempt` | the production `requestCancellation` | `cancel_requested` + a `cancel` command bound to the attempt's **ACTIVE** lease |
| `cancel.unleased_attempt` | the same service | `cancelled` outright, **zero** commands |
| `provider.execute_deadline_exceeded` | the reference provider executed with `deadlineMs: 0`; its reply carried `timedOut: true`, `terminalState: "expired"` | the attempt terminated **`failed`** |
| `cleanup.orphan_object_swept` | a NON-CURRENT fence on the commit; the route answered **`stale_fence` at the auth layer** (`code`, no `outcome`) | the uncommitted object was **deleted** |

## 4. RED, and the positive-control table

**TDD order, stated.** The checker's self-test was written and run FIRST, against a module and a
declaration that did not exist: the anchor and all 22 mutation tests passed, and the one test that
reads the committed `tests/d1/fault-matrix.json` failed `ENOENT` — the RED. Writing the declaration
turned it green (23/23; the suite grew to 25 with the anti-drift control of §1 and the duplicate-tenant fixture of §11). The first RED run also caught a defect in the test itself: a mutation that
selected `…fault_control` because it matched the suffix `control`, so it was asserting a violation
code against a non-tenant case. Fixed, with the reason recorded in the file.

**The live harness's positive control.** `AOA_M1_FAULT_MATRIX_SUPPRESS_INJECTION=1` skips every
injection while every case still records and classifies. A matrix that still passed then would be
measuring nothing.

| Run | What changed | Result |
|---|---|---|
| **GREEN-1** | — | `pass 20 / fail 0`; checker: 25/25 fired |
| **PC-1** | every injection suppressed | **`pass 10 / fail 10`** — and the matrix's own verdict reported **9 × `evidence:injection_did_not_fire`** plus **5 × `evidence:classification_mismatch`** (`d1.fault.link_cut.worker_to_control_plane`, `…control_plane_to_postgres`, `…object_store.truncated_upload`, `d1.restart.control_plane_process`, `d1.reconcile.expired_lease_reaped`, `d1.cancel.leased_attempt`, `d1.cancel.unleased_attempt`, `d1.provider.execute_deadline_exceeded`, `d1.cleanup.orphan_object_swept`) |
| **GREEN-2** | injections restored | `pass 20 / fail 0` again — so PC-1 was the suppression, not a stack that had broken |

**Four real defects the live runs found in my own code, each fixed at source and each recorded in
the file where it was found** (they are also why the harness is not a set of assertions that
happened to be green):

| # | What the run measured | Fix |
|---|---|---|
| 1 | `queryJobAttemptsAndCommands` failed with *column "payload" does not exist* — `job_control_commands` has `reason` and `command_seq`, not a `payload` JSON | read the real columns; an empty `jobIds` now substitutes a non-matching id (postgres.js cannot infer an empty array's element type) |
| 2 | the artifact commits answered **`malformed`** — the manifest was missing `organizationId`, `companyId`, `jobId`, `attempt`, `sensitivity`, `retention` and `createdAt` | the full frozen `artifactManifestV1`. The orphan case now requires **`code: "stale_fence"` with no `outcome`**, because a `malformed` is a PROTOCOL refusal that never reaches the fence check — asserting "not committed" would have accepted it (the e6f-14 lesson, re-measured) |
| 3 | the orphan object was **not** swept | the sweep trigger is per-ORGANIZATION and interval-gated (`shouldRunSweep`, `artifact-sweep-trigger.ts`), and the cross-tenant OUTPUTS case a few tests earlier already commits under tenant A. The cleanup case now seeds its own fresh scenario Organization, as `e6f-14` does; cleanup is not a tenancy claim |
| 4 | `seedToolSurfaceRuns` and the `provider_credentials` fixture failed on the real schema (`heartbeat_runs` has no `issue_id`; `owner_user_id` is NOT NULL and references the auth `user` table; `execution_target_id` is NOT NULL) | seed what the schema actually requires. A backtick inside a comment **inside** an in-container script template literal terminated the template — the hazard the agent rules warn about, caught here |

**The checker's own reds** are `scripts/check-campaign-fault-matrix.test.mjs`: a zero-violation
anchor for both halves, then one fixture per violation code — a missing/unknown/duplicate profile,
a caseless profile, a case with no id / a duplicate id / no injection / no mechanism / **no
observer** / no classification / an unknown family, a pending case with no kind / no reason / **no
owner**, a denial with no positive control, a legacy case missing either control or its named
production path, and — as loops over the enumerations — **dropping ANY of the nine surfaces**,
**ANY of the four legacy tables**, and **ANY required family of ANY profile**. On the evidence
half: `injectionFired` false/null/absent/truthy-but-not-`true`, a case with no evidence row, an
**undeclared** case, a classification mismatch, a missing positive control, a missing anti-vacuity
control, and a **pending case that reported evidence** (the record has gone stale — refused in both
directions, the DEP-016 env-probe shape).

## 5. Guards, and the neighbouring suites

- The full `pr.yml` pure-node guard set: **0 failures**, plus
  `check-evidence-immutability --base origin/docs/replatform-program` OK.
- `check-register-citation-integrity`: **PASS, 397 enforced citations**, after re-pointing the five
  `pr.yml` / `guard-inventory.json` anchors my insertions moved, by symbol:
  `pr.yml:781→793` (`image-admission.test.mjs`), `:1616→1628`
  (`check-distributed-execution-foundation.mjs`), `:1135→1147` (`pnpm exec vitest run --shard`, 14
  entries), and `guard-inventory.json:201→209` (`verify-image-admission.mjs`).
- `check-execution-census`: OK — 94 `*.test.mjs` on disk, 91 running, 3 unrun.
- `scripts/test-inventory.json`: the two **pinned** counts bumped (`scripts` 69→70, `tests`
  108→109). `--write` also wanted to raise unrelated FLOOR counts; those were reverted, since they
  are other tickets' growth.
- **Regression on the shared harness:** `tests/d1/m1-spine.test.mjs` **6/6**,
  `tests/d1/e6f-09-lease-faults.test.mjs` + `tests/d1/e6f-14-orphan-sweep.test.mjs` **4/4**, all on
  the same stack after every harness edit — so none of the 12 additive helpers or the two touched
  ones broke a neighbour.

★ **THE TWO PROFILES MUST NOT SHARE A LIVE STACK, and the exact reason is now measured** (it was
first seen as "one intermediate run failed", which was too vague to act on). Running `m1-spine`
immediately AFTER a fault-matrix run on the same database reds exactly one case with:

```
rollback:command_wrong_reason: the cancel command on attempt <id>'s active lease
carries ["m1-fault-matrix-leased"], not distributed_execution_rollback
```

The cause is not a defect in either profile. The fault matrix's `d1.cancel.leased_attempt` case
leaves a LEASED attempt in `cancel_requested` carrying a cancel command with **its own** reason;
`m1-spine`'s rollback rehearsal then takes a pre-drain CENSUS of every non-terminal attempt of the
three Organizations — deliberately, since DEP-016's own Codex round established that judging only
the seeded pair lets a skipped branch pass — sees that attempt, and correctly refuses a cancel
command that does not carry the drain's reason. **In the merge train this cannot arise:** each
profile is its own job, brings its own stack up and tears it down with `down -v`. Recorded here so
nobody later "fixes" the spine's census to ignore foreign reasons, which would delete a real check.

## 6. Deviations from the task section, measured

1. **One commit, not two.** The Evidence line names `test(d1): a declared campaign fault matrix
   with injection evidence` and "the checker commit". They landed as one: the guard wiring
   (`guard-inventory.json`, the census, `pr.yml`) is what makes the checker non-dormant, and
   splitting it would have put a declared-but-unwired guard in the first commit.
2. **`docker/d1/toxiproxy.json` was not changed** — the task allows it "if a new link is needed",
   and no new link was. The three existing links carry every fault control this profile declares.
3. **The `DEP-015` workflow was not touched.** The task names it "for the D2 profiles"; every D2
   case is `pending` under ruling F8 (§7), so there is nothing to wire there yet, and adding an
   unfired step would be the class of check this ticket exists to refuse.
4. **The cleanup case runs in a fresh scenario Organization, not an F10 tenant** (§4 row 3, with
   the measured reason).
5. **The worker is the harness, not the daemon**, as in every E6F suite and as DEP-016 records: the
   D1 workers do not dispatch (`AOA_WORKER_DISPATCH_ENABLED` is declared ABSENT —
   `scripts/lib/d1-dispatch-declared.mjs`). What this profile's fault cases prove is the
   CONTROL-PLANE half; the worker-executed half is the shipped-boot lane's. This is also why one
   declared case is `pending` — §7.

## 7. The one pending D1 case, and the 46 keyed ones

- **`d1.reconcile.worker_startup_lease_probe`** (`pendingKind: structural`). WRK-013's startup
  reconciler needs a daemon that actually HELD a lease. No worker on the D1 lane ever does:
  `AOA_WORKER_DISPATCH_ENABLED` is declared ABSENT for both D1 workers and enforced by
  `check-d1-dispatch-declared`, and every E6F suite plays the worker over the real HTTP endpoints.
  Restarting `worker-b` would reconcile an EMPTY candidate store — a check that evaluates nothing,
  which is precisely what this matrix refuses. WRK-013's composed reconciler is proven behaviourally
  in `packages/worker-daemon/src/__tests__/startup-reconcile-composed.component.test.ts`; its
  DEPLOYED-boot case is declared as `d2m.reconcile.daemon_restart_with_live_lease` and owned by the
  DEP-015 lane.
- **The 46 D2 cases** (`M1a-D2-MECHANISM`, `M1-D2-CODING`) are all `pendingKind: keyed`. Founder
  ruling **F8** reserves keyed E2B dispatch to the planning session, and DEP-018 is not on F8's
  named list, so no keyed run was dispatched and none is claimed. Each carries its reason and its
  owner, and the checker refuses a pending case that reports evidence — so when those runs happen,
  the declaration must be rewritten rather than quietly inheriting a pass.

**For the planning session:** the three D2 cleanup cases, the two credential cases and the armed
`tool_calls` case are the ones that cannot be approximated keylessly at all. Everything else in the
D2 profiles has a keyless analogue proven here, which is worth knowing when the keyed budget is
allocated.

## 8. CI evidence

To be recorded, by job with its executed count, in an addendum once the PR's run on the reviewed
revision completes. This section is not rewritten.

## 9. The merge with the program tip, and the Codex round (2026-09-23)

Merged `origin/docs/replatform-program` at `499ec4d1c` (which brought `CLI-011`'s keyed output
probe and `DEP-017`) into this branch — a merge, not a rebase, so the reviewed revisions stay
ancestors.

- **One conflict**, in `docs/architecture/distributed-execution-threat-controls.json`: my
  line re-points against theirs. Their side was taken, and mine were re-applied onto the merged
  file by SYMBOL — `pr.yml:1151→1163` (`pnpm exec vitest run --shard`, 14 entries), `:781→793`
  (`image-admission.test.mjs`), `:1632→1644` (`check-distributed-execution-foundation.mjs`), and
  `guard-inventory.json:201→209` (`verify-image-admission.mjs`). `check-register-citation-integrity`
  is PASS: **397 enforced citations**.
- **The merge touched nothing in `docker/`, `tests/d1/` or `d1-merge-train.yml`**
  (`git diff --stat` over those paths is empty) and nothing in `server/src` or `packages/db`; its
  only code effect is in `packages/worker-daemon` (DEP-017's env probe and CLI-011's keyed probe
  test). **Even so the whole lane was re-measured on the merged tree** rather than argued from
  that — see below.
- `scripts/test-inventory.json`: the `scripts` pin recomputed on the combined tree (70 → 71).

### 9a. Codex findings, verified at source and fixed

Both were **P1, both were right**, and both were the same underlying defect: a fault that was
*observable* but not *load-bearing*.

| Finding | Verified | Fix |
|---|---|---|
| **P1** — *"Route the timeout injection through the production worker path."* The case handed the ingest a constant `status: "failed"`, so a regression that reported a timeout as a success would still have left it green | **True.** Read at source: the terminal payload was a literal | The payload is now **DERIVED** from the provider's report by `terminalPayloadFor`, and the case grew an **anti-vacuity arm**: the SAME derivation, the SAME code path, with a provider that did NOT time out, must land `succeeded`. Live: failed arm `timedOut: true` → attempt **`failed`**; control arm `timedOut: false` → attempt **`succeeded`**. ★ The remainder of Codex's ask — have the DEPLOYED worker produce the terminal — is **not available on this lane and is not claimed**: `AOA_WORKER_DISPATCH_ENABLED` is declared ABSENT for both D1 workers (`scripts/lib/d1-dispatch-declared.mjs`, enforced by `check-d1-dispatch-declared`), so there is no worker-executed path here at all. That half is `d2m.provider_failure.e2b_create_refused`, already declared and keyed |
| **P1** — *"Drive the link-cut case through the severed proxy."* The case cut `worker-to-control-plane`, proved it severed, and then did everything else over the DIRECT `control-plane:3100` base the harness helpers default to | **True, and the sharper finding of the two.** The cut was observable and **inert**: nothing under test traversed it, so the case could have passed with no worker request interrupted | Every worker request in the case now goes through the Toxiproxy LISTEN address a real worker uses (`toxiproxy:13100`), and `injectionFired` is derived from a REAL request succeeding before the cut, **failing during it**, and succeeding after the restore. `ack()` gained an optional `base` (additive; the default is unchanged). Live: poll **200 `no_work`** → **request failed** → **200 `no_work`**, and the reconnected worker's late ack through the same proxied path is **409 `attempt_terminal`**. Only the reap still goes direct, deliberately: it is the OPERATOR's path, and routing it through the cut would merely prevent the reclaim the case exists to observe |

**A third strengthening, self-found while checking Codex's work.** The `lease`, `staged_inputs`,
`outputs` and `cancel` denials asserted only "not a success", which would equally accept a
`malformed` — a PROTOCOL refusal that never reaches the tenant boundary — or a 500, which proves no
enforcement at all. That is exactly the trap this file's orphan case fell into on its first live
run. The three worker-control surfaces now reuse DEP-016's pinned `EXPECTED_FOREIGN_ACK_STATUS` /
`EXPECTED_FOREIGN_ACK_CODE` (**409 `stale_fence`**, measured), and the cancel surface requires the
production service's own **`not_found`** outcome as well as the untouched row.

### 9b. Re-measured on the merged tree, with the fixes

Images rebuilt from the merged tree (`docker/images/build.sh`; `CONTROL-PLANE_REVISION` =
`2aa3855aa137f31a27c6bb2054482266cd465ebc`, confirmed on the running container's
`org.opencontainers.image.revision` label):

| Run | Result |
|---|---|
| The matrix | `tests 20, pass 20, fail 0`; checker: **25/25 required cases fired and classified**, 1 pending, profile `INCOMPLETE` |
| **Suppressed-injection positive control** | `pass 10 / fail 10`, with **9 × `evidence:injection_did_not_fire`** |
| The matrix again | `tests 20, pass 20, fail 0` — so the control was the suppression, not a broken stack |

Everything in §3, §3a, §3b, §3c and §3d holds on this tree, with the two rows above strengthened as
§9a describes.

## 10. CI evidence

**Run `35833804804`, head `2aa3855aa137f31a27c6bb2054482266cd465ebc` (the merge): `ci-required`
PASS, all 16 checks `success`** — `changes`, `policy`, `lint`, `migrations`,
`distributed-contract`, `browser`, `brand-check`, both `worker-protocol-contract-bytes` lanes,
`e2e`, `e2e-pgvector` and `verify (1..4)`.

- `policy` job **`107092717578`**, step *Campaign fault matrix declaration (DEP-018)*:
  `scripts/check-campaign-fault-matrix.mjs` printed *"3 gate profile(s) and 71 case(s) (25
  required, 46 pending)"*, and `scripts/check-campaign-fault-matrix.test.mjs` ran
  **24 tests, 24 pass, 0 fail** — a non-zero executed count, on Linux.
- **Still not run: the `m1-fault-matrix` job itself.** It lives in `d1-merge-train.yml`, which
  fires on push to `main` / `docs/replatform-program` and on the merge queue — not on pull
  requests. Its first execution will be the merge of this PR. The live half is evidenced here by
  local runs against a real D1 stack (§3, §9b), and the lane's own verdict is owed.
- A later addendum records `ci-required` on the FINAL head, which carries the two Codex P1 fixes
  (§9a). This section is not rewritten.

## 11. The second Codex round — six more findings, all real (2026-09-23)

Head `820b9b4d7`. **`ci-required` PASS** (run on that head; the per-job record is §10's addendum
below). Codex then raised **six** further findings on the same head — **two P1 and four P2** — and
every one was verified at source before being fixed. Five of the six are the SAME defect wearing
different clothes: **an assertion whose control could not detect the guard being removed.**

| Finding | Verified | Fix, and what it now measures |
|---|---|---|
| **P1** — the `tool_calls` control was on a DIFFERENT arm: the hostile call used the DISTRIBUTED run, whose refusal the M1a freeze already guarantees for every tenant, so deleting the company-mismatch guard would have left the case green | **True, and decisive.** `classifyToolSurfaceAtUse` denies a distributed run whenever the Organization is unarmed, which M1a always is | The hostile call and its control are now the **SAME run id under two different Companies**, so the only fact that differs is the one under test and both traverse the same arms up to the mismatch check. Live: `cross: "deny"` / `own: "admit"`. ★ That pair IS the mutation proof: `companyId` is read by exactly one arm (the classifier is four lines), so with the guard removed `cross` falls through to *not distributed → admit* and the case reds. The distributed arms are recorded as freeze posture and explicitly NOT the control |
| **P1** — the `secrets` case classified on the fenced route, whose owner and attacker are indistinguishable (`denied/malformed` both), with an unrelated row read as its "control" | **True.** Measured: both `denied/malformed`, because the route collapses every refusal by design AND this lane's fixture handle is unresolvable — the D1 compose configures no broker that could return a value (I checked: `resolveProviderOrCompanySecret` needs a decryptable `company_secrets` row, and `resolveRunJwt` needs an agent-JWT signing key the D1 compose does not set) | Codex's second option, taken: **the route is no longer the tested boundary.** The case classifies on the DURABLE ROW — `job_secret_handles` is in `TENANT_RLS_TABLES`, so the same query, same `aoa_app` pool, same row returns **1** under the owner's scope and **0** under the attacker's, which drop-the-policy would flip. The route result is recorded under `routeObservationOnly` with the reason it carries no control. A resolvable owner handle is `d2m.tenant.cross.secrets`, keyed |
| **P2** — the truncated-upload commit accepted any non-`committed` answer, so a crashed commit route would have been classified as a successful refusal | True | The EXACT protocol rejection is required: **`200` with `{outcome: "rejected", reason: malformed \| event_hash_mismatch}`**. Live: exactly that |
| **P2** — the database-cut classification rested only on post-restore recovery; `pollDuringCut` was recorded and never asserted | True | A **pre-cut control on the same request** (it must be refused `4xx` while the database is up) and a **fail-closed requirement** during the cut. Live: **`401` → `500` → recovered**, so a control plane answering a fabricated offer during the outage cannot pass |
| **P2** — the restart verdict checked only that a lease with the old id still existed | True | The attempt **and lease** rows are compared byte-for-byte across the restart, so a lease whose status moved reds |
| **P2** — `evaluateFaultMatrixDeclaration` counted journey LABELS, so two journeys for tenant A would satisfy F10 while tenant B was omitted | True | Distinct tenants are tracked; a repeated tenant reds `declaration:duplicate_journey_tenant` **and** `declaration:tenant_matrix_journeys`. A 25th self-test is the red fixture |

### 11a. Re-measured after the six fixes

| Run | Result |
|---|---|
| The matrix | `tests 20, pass 20, fail 0`; checker: **25/25 required cases fired and classified**, 1 pending |
| **Suppressed-injection positive control** | `pass 10 / fail 10`, **9 × `evidence:injection_did_not_fire`** — unchanged, so the strengthened assertions did not weaken the control |
| The matrix again | `tests 20, pass 20, fail 0` |
| `scripts/check-campaign-fault-matrix.test.mjs` | **25/25** |

The declaration's `observedBy` strings were rewritten in the same commit to state what each case now
measures, so the record and the code cannot disagree.

## 11b. Codex round three — two more P1s, and what they changed

Head `0794f44c1`. Both were right, both were about a case **claiming more than it measures**, and
neither is measurable on this lane. So rather than argue the gap away in prose, each claim was
**split**: the measurable half keeps a name that states what it proves, and the unmeasurable half is
**filed as its own declared `pending` case** — which the checker can never report as a pass, and
which therefore keeps the profile honestly `INCOMPLETE`.

| Finding | Verified | What changed |
|---|---|---|
| **P1** — *"Run timeout classification through the production worker mapper."* `terminalPayloadFor` is harness code, so both arms validate that helper and the ingest, not the deployed worker's mapping that the case claimed to protect | **True.** `AOA_WORKER_DISPATCH_ENABLED` is declared ABSENT for both D1 workers, so no worker on this lane maps anything | The measured case is renamed to what it proves — **`ingest_classifies_provider_derived_terminal`** (a real defect class: an ingest that ignored the terminal status reds here, and the success arm is the control that shows the derivation can produce the other answer). The worker's own mapping is now **`d1.provider.worker_terminal_mapping`**, `pendingKind: structural`, owned by the DEP-015 keyed lane |
| **P1** — *"Exercise credential isolation through the production reader."* The `provider_credentials` case hard-codes the two predicates instead of invoking `resolveExecutionSecret`, while the record claimed acceptance 5's production-query-path coverage | **True, and the record was the worse half of it.** I checked whether the reader is drivable here: its `device_local` arm needs `authorizeSecretResolve` to admit, the D1 control plane wires `failClosedDeviceLocalBroker` (the only implementation in the tree), and the fenced route collapses every outcome to `denied/malformed` — so an admitted read and a denied one are indistinguishable at every observable surface on this lane | §3b now states this as an **acceptance-5 gap**, not a satisfied clause, and the reader half is **`d1.credential.production_reader_company_predicate`**, `pendingKind: structural`. ★ **FLAGGED FOR THE PLANNING SESSION: no ticket on disk owns it.** Closing it needs either a D1 `device_local` broker or the keyed lane — a topology decision beyond this ticket. The legacy case still proves the PREDICATE and the grant on the same non-owner pool, and now says only that |

★ **SUPERSEDED, and the sentence above is kept as first written.** The flag was answered: the
planning session ruled it as **`E6-D003`** and the case is no longer unowned. See **§13**. Nothing
else in §11b changes — it is the record of what round three found and what was true when it was
written.

### 11c. Re-measured after the split

```
AOA_D1_LIVE=1 AOA_D1_CAMPAIGN=m1-fault-matrix node --test --test-concurrency=1 \
  tests/d1/m1-fault-matrix.test.mjs
→ tests 20, pass 20, fail 0

node scripts/check-campaign-fault-matrix.mjs --evidence <bundle>
→ OK: profile M1-D1-SPINE: 25/25 required case(s) fired and classified as declared,
      3 pending. Profile INCOMPLETE (pending cases remain).
```

The declaration is now **73 cases (25 required, 48 pending)**, and the three D1 pending cases are
`d1.reconcile.worker_startup_lease_probe`, `d1.provider.worker_terminal_mapping` and
`d1.credential.production_reader_company_predicate` — every one structural, every one with its
blocker cited at source and an owner named. `scripts/check-campaign-fault-matrix.test.mjs`: **25/25**.

★ **What a reviewer should take from this section.** The profile's verdict moved from "complete
except one" to **`INCOMPLETE`, three pending** as a direct result of the review, and that is the
right direction: two of those three were previously being claimed by cases that could not prove
them. A gate record made from this bundle must carry the three, and `d1.credential.production_reader_company_predicate` has **no owner on disk** and needs a planning-session decision.

## 11d. Codex round four — one P1, and a correction worth recording

Head `a0a24e74c`. One finding, on the database-cut probe, and it is the most instructive of the
eleven because **its predicted consequence was wrong while its premise was right, and the premise
is what mattered.**

Codex read `server/src/routes/worker-control.ts` and pointed out that `verifyWorkerOperationProof`
runs BEFORE `pollRateLimiter.admit` and `leasing.poll`, so the probe's `session: "not-a-session"`
never reaches a database-backed operation — and predicted that `pollDuringCut.status >= 500` could
therefore never hold and the live lane would fail at the `failedClosed` assertion.

**The prediction was falsified by two live runs** (`401` before the cut, `500` during it, both
times). **The premise was correct**, and it exposed a defect in my own record: the difference I
measured came from the DENIAL path — with PostgreSQL unreachable the refusal's audit write fails and
the 401 becomes a 500 — not from the authority path, while the code comment claimed *"a poll needs
the database for every step of the authority check"*. The assertion was passing for a reason the
record misstated, which is this programme's records-disagree-with-code class in miniature.

So the fix is Codex's, taken in full: the probe is now an **ENROLLED worker with a VALID session**,
which does reach the shared admission rate limiter and the leasing service. Re-measured:

| | Observed |
|---|---|
| poll before the cut | **`200`** (asserted: a 2xx, else "5xx while cut" proves nothing) |
| poll during the cut | **`500`** — fail closed, never a fabricated offer |
| after the restore | the control plane serves real queries again, 1 poll |

| Run | Result |
|---|---|
| The matrix | `tests 20, pass 20, fail 0`; **25/25 required cases fired**, 3 pending |
| Suppressed-injection control | `pass 10 / fail 10`, **9 × `evidence:injection_did_not_fire`** |
| The matrix again | `tests 20, pass 20, fail 0` |

**Eleven findings over four rounds — 5 P1 and 6 P2 — every one verified at source before being
fixed, and none of them cosmetic.** Nine changed what a case actually proves; the other two changed
what the record is allowed to claim. The recurring shape, worth carrying forward: *an assertion
whose control cannot detect the guard being removed*. It appeared in the link cut (a fault nothing
traversed), the provider terminal (a hard-coded status), the tool surface (a control on a different
arm), the secrets route (owner and attacker indistinguishable), four denials that accepted any
non-success, the database cut (an outage response recorded but never asserted), the restart (a lease
checked for existence only), and the checker itself (journey labels counted instead of tenants).

## 11e. Codex round five — two P2s, both taken

Head `d4efb9d52`.

| Finding | Verified | Fix |
|---|---|---|
| **P2** — the late-ack check accepted **any** non-200 carrying a `code`, so the route's `503 internal_unavailable`, or a malformed/auth refusal, would have been classified as a reclaim | True — and the same trap the four hostile surfaces were already pinned against, left unpinned on this one | The denial is pinned to **`409`** with a code from e6f-09's `NON_DISCLOSING_DENIALS`. Measured live: **`409 attempt_terminal`** — the reclaim has already terminated the attempt by the time the belated ack arrives. The set is used rather than a single code because which of those the fence path yields is a deliberate non-disclosure and must not be over-pinned |
| **P2** — §1's "What shipped" still said **71 cases / 46 pending / 24 tests** while the committed tree reports **73 / 48 / 25** after the review added two structural cases and the duplicate-tenant fixture | True, and the right kind of finding: a reviewer reading the summary would have got numbers contradicting the checker | §1 updated. ★ §10's counts are **deliberately unchanged** — they record what the CI run on head `2aa3855aa` actually printed, and a record of a past run keeps its own numbers |

Re-measured after the pin: matrix **20/20** twice, **25/25 required cases fired**, 3 pending;
suppressed-injection control `pass 10 / fail 10` with **9 × `evidence:injection_did_not_fire`**;
`scripts/check-campaign-fault-matrix.test.mjs` **25/25**.

**Thirteen findings over five rounds — 5 P1 and 8 P2, every one verified at source before being
fixed.** Two things a reviewer should weigh: the profile's verdict moved from "complete except one"
to **`INCOMPLETE`, three pending**, because two claims were being made by cases that could not prove
them; and one round (§11d) falsified its own prediction while its premise still found a real defect,
which is why the record keeps both.

## 11f. Codex round six, and the self-audit

Head `5a4fdb024`. Two findings, both taken.

| Finding | Verified | Fix |
|---|---|---|
| **P1** — on a database outage the poll's shared admission limiter catches the store error and returns `{allowed:false, reason:"unavailable"}` (`worker-admission-rate-limit.ts`: *"FAIL-CLOSED: a shared-store error … DENIES the request"*), which the route renders **429 `throttled`** — so `>= 500` alone would red the lane on a CORRECT fail-closed answer | **True about the mechanism.** This lane measured `500` on every run, so the assertion was passing, but it was pinned to one of two legitimate renderings | The assertion accepts **either** `429` **or** a 5xx, and additionally requires the answer is not an `offer`. The one answer excluded is the defect — a 2xx. A control plane that fabricated an offer during the outage still cannot pass, and a correct 429 no longer reds the required lane |
| **P2** — the proxy-cut's `reached` predicate accepted ANY HTTP response as proof the poll worked before and after the cut, so a broken endpoint could still set `injectionFired` | True | `reached` now requires **`200` with a valid poll outcome**. Live: `200 no_work` before the cut, request failed during it, `200 no_work` after |

### 11g. The self-audit (M1 build-rule A), run before this push — and it found one

Walked against my own diff. Seven of the eight families were already clean (bounds are explicit on
every `dexecModule` and `waitFor`; the evidence verdict refuses duplicates and fails closed on a
missing row, an undeclared case or an unreadable bundle; the hostile batches already carry the
ATTACKER's worker id with the VICTIM's tenant fields, which is the "authenticate the half the
attacker controls" family; citations were re-pointed by symbol and the pins recomputed on the merged
tree). **Family 1 — redaction / secret collision — found a real one:**

Three `record(...)` details and two assertion messages carried a worker-control response **body
wholesale**. Today those are all denial envelopes, so nothing leaks. But the moment a hostile
transfer grant is *not* denied — **which is the exact regression those cases exist to catch** — the
body carries a **presigned URL with signed credentials**, and the bundle is uploaded as a CI
artifact with 14-day retention. A channel that leaks only when the system is broken is still a
channel, and the leak would arrive on the one run a reviewer would read most closely.

Fixed with `responseFacts(r)` — `{status, outcome, code, reason}`, never the body — at all five
sites. Verified on the retained bundle: **zero** matches for `X-Amz-Signature`, `X-Amz-Credential`,
`Bearer ` or a JWT prefix.

### 11h. Final state

| Run | Result |
|---|---|
| The matrix | `tests 20, pass 20, fail 0`, twice; **25/25 required cases fired and classified**, 3 pending |
| Suppressed-injection control | `pass 10 / fail 10`, **9 × `evidence:injection_did_not_fire`** |
| `scripts/check-campaign-fault-matrix.test.mjs` | **25/25** |
| `tests/d1/m1-spine.test.mjs`, on its OWN fresh stack | **6/6** — which also confirms §5: the contamination is cross-profile state on a shared stack, and the merge train gives each profile its own |

★ **Stopped here under M1 build-rule C (hard cap: two Codex rounds).** This PR ran **six** rounds —
the cap was published mid-ticket and is respected from this point. **15 findings, 6 P1 and 9 P2,
every one verified at source before being fixed, none cosmetic.** No further review was requested;
the two round-six findings above are fixed and measured, and nothing is outstanding from any round.

## 12. CI evidence — the final head

**Run `35844176268`, head `460dca4eb78d84cbda99bcd84ea4d2cde085d97e`: `ci-required` PASS, and
ZERO jobs concluded anything other than `success`.**

- `policy`, step *Campaign fault matrix declaration (DEP-018)*:
  `scripts/check-campaign-fault-matrix.mjs` printed *"3 gate profile(s) and 73 case(s) (25
  required, 48 pending)"*, and `scripts/check-campaign-fault-matrix.test.mjs` ran
  **25 tests, 25 pass, 0 fail** — a non-zero executed count, on Linux, matching the committed tree.
- **Still not run: the `m1-fault-matrix` job itself.** It lives in `d1-merge-train.yml`, which fires
  on push to `main` / `docs/replatform-program` and on the merge queue — not on pull requests. Its
  first execution will be the merge of this PR. The live half is evidenced here by repeated runs
  against a real D1 stack (§3, §9b, §11c, §11h) with the suppressed-injection control red every
  time, and the lane's own verdict is owed.

**Reviewed revision (code): `460dca4eb78d84cbda99bcd84ea4d2cde085d97e`.** Everything in §3, §9b,
§11 and §11h was measured on this code against a live D1 stack.

## 13. The two planning-session rulings (2026-09-23)

### 13a. `E6-D003` — the `provider_credentials` production-reader case is ROUTED, not unowned

§11b left it `unowned` and flagged. The planning session ruled it under **F2**, following
**`E6-D002`**'s shape, and it is recorded in
`docs/replatform/epics/E6-deployment-test-harness/decisions.md` as **`E6-D003`**.

★ **Id verified before minting.** `E6-D002` is **taken** — by the unmerged branch
`claude/m1-dep-019`, which is the very ruling whose shape this one follows — so this is `D003`.
`check-register-id-uniqueness` is green (27 da-decision, 125 decision, 25 epic-decision, 209
finding across 26 registers). A grep of the merged tree alone would have shown `E6-D001` as the max
and produced a collision.

| | |
|---|---|
| **Where the case now lives** | `M1a-D2-MECHANISM`, as `d2m.credential.production_reader_company_predicate`, `pendingKind: keyed`, owned by the planning session under **F8** on the DEP-015 lane. It carries its injection (a `device_local` handle naming a **foreign company's** credential) and its expected classification |
| **Why there** | That gate redeems a **real** provider credential, so `authorizeSecretResolve` can ADMIT — and `resolveExecutionSecret` increments the handle's `resolve_count` **only on admit**, which is the one observable that tells an admitted read from a denied one |
| **Why not on D1** | `device-local-broker.ts` holds `failClosedDeviceLocalBroker` and **no other implementation in the tree**, and the fenced route collapses every outcome to `denied/malformed` by design. A case built there could not tell its two arms apart |
| **What the spine keeps** | `d1.credential.production_reader_company_predicate`, `pendingKind: structural`, naming `E6-D003` and the mechanism case as its owner — so its absence there **cannot be read as an oversight**. The checker refuses to report a pending case as a pass and refuses a bundle that reports evidence for one |

★ **The ruling's fallback was NOT taken, and the decision records why.** The instruction was: if it is
not drivable on the keyed lane either, file it `unowned` and say plainly that `M1a`'s isolation
matrix does not cover that table. It **is** drivable there. So `M1a` **does** cover
`provider_credentials` — the predicate and grant on the spine, the production reader on the
mechanism gate — and both halves are named. If a keyed run later shows otherwise, that fallback
stands.

§11b's flag is kept as first written, with a pointer here.

### 13b. The lane PROVEN in CI, on a throwaway probe branch

*"A lane whose first real execution is the merge itself is a lane nobody has seen work."* Following
the `DEP-014` / `DEP-019` pattern: branch `claude/m1-dep-018-lane-probe` carried this PR's code plus
**one** trigger line, the merge train ran, and the branch was deleted. **The PR lands without that
line** — verified: `grep -c 'claude/m1-dep-018-lane-probe' .github/workflows/d1-merge-train.yml` is
**0** on the PR branch.

**Run `35848228046` — `completed` / `success`, all three jobs:**

| Job | Id | Conclusion |
|---|---|---|
| **`m1-fault-matrix`** (this ticket's) | **`107139436790`** | **success** |
| `m1-spine` (DEP-016's — also its first CI execution) | `107139436556` | success |
| `d1-merge-train` (the E6F campaign) | `107139436996` | success |

★ **A green conclusion is not evidence its assertions ran, so here is what the job LOG says** — and
this lane is one where that distinction matters, because `E6-F023` recorded a run concluding
`success` with 8 of 12 jobs failing:

- step *Static preflight*: `scripts/check-campaign-fault-matrix.test.mjs` — **25 tests, 25 pass, 0 fail**.
- step *Run the M1-D1-SPINE fault matrix (live)* — **20 tests, 20 pass, 0 fail**.
- step *The matrix's own verdict over the retained bundle* — *"profile M1-D1-SPINE: **25/25 required
  case(s) fired and classified as declared, 3 pending**"*, matching the local runs exactly.
- step *POSITIVE CONTROL — with every injection suppressed, the matrix MUST go red* — the step
  printed **"positive control: a suppressed injection reds the matrix, as required"**, which it can
  only reach by the suppressed run FAILING and the evidence marker being found. The control reported
  **9 distinct unfired cases**, the same nine as locally: `cancel.leased_attempt`,
  `cancel.unleased_attempt`, `cleanup.orphan_object_swept`, `fault.link_cut.control_plane_to_postgres`,
  `fault.link_cut.worker_to_control_plane`, `fault.object_store.truncated_upload`,
  `provider.execute_deadline_exceeded`, `reconcile.expired_lease_reaped`, `restart.control_plane_process`.
- the evidence bundle `m1-fault-matrix-evidence-35848228046` was uploaded.

So §10 and §12's standing caveat — *"still not run: the `m1-fault-matrix` job itself"* — is now
**discharged**, on a real runner, before the merge rather than by it. Those sections are kept as
written; this is the section that answers them.

---

## Independent review

**Reviewer:** M1 review-batch-4 independent reviewer (Claude Opus 5) — distinct from the DEP-018 build agent and from the M1 planning session. I authored none of this ticket.
**Reviewed revision:** `99bff824d1c4fd641cea3b05ab7fe588f8255b96` (`origin/docs/replatform-program`, the merge of PR #572). The record's own code revision `460dca4eb78d84cbda99bcd84ea4d2cde085d97e`, the `E6-D003` commit `1337ee0b1`, and the PR merge `47ad31ac1` are all ancestors of it.
**Disposition:** `approved`
**Attempt:** 1 (see *Independent review — attempt 1* and the attempt history)

### Independent review — attempt 1

**Disposition: `approved`.** Every load-bearing claim below was re-verified at source at the reviewed
revision, and two of the record's controls were reproduced by me.

- **The declaration, as committed.** `node scripts/check-campaign-fault-matrix.mjs` at the reviewed
  revision prints **3 gate profiles and 74 cases (25 required, 49 pending)**, and its self-test
  `scripts/check-campaign-fault-matrix.test.mjs` runs **25 tests, 25 pass, 0 fail** locally.
- **The nine cross-tenant surfaces, each with a control — verified in the declaration, not only in
  prose.** All three profiles carry `cross_tenant_denial` cases for exactly
  `lease, read, cancel, events, secrets, staged_inputs, outputs, cost_rows, tool_calls`, every one
  with `positiveControl: true`, plus one `control_tenant_refused` case each.
  `REQUIRED_TENANT_SURFACES` in `scripts/lib/campaign-fault-matrix.mjs` enumerates the nine rather
  than counting them.
- **The four no-RLS legacy tables, positive AND anti-vacuity.** All three profiles declare
  `legacy_table_isolation` cases for `cost_events, activity_log, task_outputs, provider_credentials`,
  each with `positiveControl: true`, `antiVacuityControl: true` and a named `productionPath`.
  `evaluateFaultMatrixDeclaration` reds on a missing positive control
  (`declaration:legacy_without_positive_control`), a missing anti-vacuity control
  (`declaration:legacy_without_anti_vacuity`) and a missing production path; the evidence half reds
  on `evidence:anti_vacuity_missing` when the predicate-removed read did not return the foreign row.
  `probeLegacyTableIsolation` (`tests/d1/lib/e6f-harness.mjs`) runs all three reads on the same
  non-owner `aoa_app` pool through `costService`, `activityService` and `taskOutputService`.
- **Mutation, reproduced by me and reverted.** Deleting the `d1.tenant.cross.tool_calls` case from
  `M1-D1-SPINE` reds the checker with
  *"declaration:tenant_matrix_surface_missing: profile M1-D1-SPINE declares no cross-tenant denial
  for `tool_calls`"*, exit 1. Reverted; the tree was clean afterwards.
- **The suppression control, at source in the job log.** Probe-branch run
  [`35848228046`](https://github.com/MeteoriteLabs/AoA/actions/runs/35848228046), branch
  `claude/m1-dep-018-lane-probe`, head `8da5c2e08de63daea77b2b12ba64606a38e0a94e`, conclusion
  `success`; job **`m1-fault-matrix` `107139436790` success**, alongside `m1-spine`
  `107139436556` and `d1-merge-train` `107139436996`. Reading that job's own log rather than its
  conclusion:
  - *Static preflight* — `ℹ tests 25 / pass 25 / fail 0`.
  - *Run the M1-D1-SPINE fault matrix (live)* — `ℹ tests 20 / pass 20 / fail 0`.
  - *The matrix's own verdict over the retained bundle* — *"profile M1-D1-SPINE: **25/25 required
    case(s) fired and classified as declared, 3 pending**. Profile INCOMPLETE"*.
  - *POSITIVE CONTROL* — the suppressed run carries **exactly nine distinct**
    `evidence:injection_did_not_fire` cases, which I extracted from the log and de-duplicated:
    `d1.cancel.leased_attempt`, `d1.cancel.unleased_attempt`, `d1.cleanup.orphan_object_swept`,
    `d1.fault.link_cut.control_plane_to_postgres`, `d1.fault.link_cut.worker_to_control_plane`,
    `d1.fault.object_store.truncated_upload`, `d1.provider.execute_deadline_exceeded`,
    `d1.reconcile.expired_lease_reaped`, `d1.restart.control_plane_process`. §13b's nine are exactly
    these nine.
- **The probe branch measured the FINAL declaration, not an earlier one.** `git diff 8da5c2e08
  460dca4eb` is four files: the one trigger line, `decisions.md` (−80), this record (−23) and
  `tests/d1/fault-matrix.json` (−18) — i.e. the probe head is `460dca4eb` **plus** the `E6-D003`
  commit plus the trigger line. And `git diff 8da5c2e08 47ad31ac1` over `tests/`, `scripts/`,
  `.github/` and `docker/` is **one deleted line** of `d1-merge-train.yml`. So the lane proof stands
  for the merged code. `grep -c 'm1-dep-018-lane-probe' .github/workflows/d1-merge-train.yml` is
  **0** at the reviewed revision.
- **Multi-tenant (F10), real.** Each profile declares `per_tenant_journey` cases for two DISTINCT
  tenants (`A`, `B`) plus a `control_tenant_refused` case;
  `evaluateFaultMatrixDeclaration` tracks distinct tenants and reds
  `declaration:duplicate_journey_tenant` + `declaration:tenant_matrix_journeys` on a repeat, which
  is §11's sixth finding and has its own red fixture. The live surfaces carry the attacker's worker
  id with the victim's Organization/Company/job/lease/fence, so a refusal is not the
  session-vs-batch check.
- **`E6-D003`, read in full.** It is `locked`, decided under F2, states plainly that it **allocates**
  acceptance 5's fourth-table clause between two partial gates and does not weaken it, and is
  matched by the declaration: `M1-D1-SPINE` keeps
  `d1.credential.production_reader_company_predicate` as `pending`/`structural` naming the mechanism
  case and `E6-D003` as its owner, and `M1a-D2-MECHANISM` carries
  `d2m.credential.production_reader_company_predicate` as `pending`/`keyed` owned by the planning
  session under F8. The spine's `d1.tenant.legacy.provider_credentials` case's `productionPath`
  string says in its own words that it is the two predicates **REPLICATED** and *"NOT
  resolveExecutionSecret itself"* — the record and the declaration do not disagree.
- **Acceptance (E6 plan §4c `DEP-018`), clause by clause.**
  1. Every declared case has a run showing its injection fired — **evidenced**, twice locally and
     once in CI, 25/25 with the verdict computed by `evaluateFaultMatrixEvidence`.
  2. Every cross-tenant denial denied, not merely empty, with a same-tenant positive control —
     **evidenced**, with the two bounded claims (`secrets` on the durable row, `tool_calls` on the
     same run id under two Companies) stated in the record rather than glossed.
  3. Control tenant refused and left legacy — **evidenced** through the real placement service with
     an enabled-tenant control.
  4. The checker reds on an undeclared case, a case with no injection evidence, or a profile missing
     the tenant matrix — **evidenced** by 25 self-tests, and I reproduced one of the enumeration
     loops.
  5. The four legacy tables through the production query path, with positive AND anti-vacuity
     controls — **evidenced for this gate's share of the clause.** Three tables go through their
     production readers; the fourth's production-reader half is **allocated to `DEP-015` by locked
     `E6-D003`** and is declared `pending`/`keyed` there, while the spine keeps the predicate + grant
     with both controls and says only that. I am approving on that allocation. ★ **If `E6-D003` is
     ever revisited or its fallback taken, this disposition must be revisited with it** — the
     production-reader obligation is not discharged anywhere today, only owned.
- **Guards.** The full `pr.yml` pure-node guard set is **0 failures** at the reviewed revision, plus
  `check-evidence-immutability --base origin/docs/replatform-program`.
- **CI.** §12's run `35844176268` on head `460dca4eb…` is cited with `ci-required` PASS. §10's and
  §12's counts are deliberately frozen records of past runs and I did not treat their numbers as
  claims about the current tree.
- **★ One finding, not blocking — §1's counts are stale by one case.** §1 says *"**3 gate profiles,
  73 cases** (25 required, 48 pending)"*. The committed `tests/d1/fault-matrix.json` at the PR's own
  merged head reports **74 (25 required, 49 pending)**, because §13a's `E6-D003` commit `1337ee0b1`
  added `d2m.credential.production_reader_company_predicate` after §11e had refreshed §1. This is
  exactly the P2 §11e itself caught one round earlier, recurring at the last edit; §12's and §13b's
  figures are correct for the runs they record. It does not change any verdict — the checker, not
  the prose, is what the lane reads — so it is recorded here rather than held against the flip, and
  the next editor of this file should correct §1 to 74/25/49.
- **Not blocking, noted.** §8 and §10 both carry the heading *"CI evidence"*; §12 is the one that
  stands. The probe head `8da5c2e08` is not an ancestor of HEAD because the throwaway branch was
  deleted by design; it is CI evidence, not a reviewed revision, and I fetched the commit by sha to
  diff it.

**What remains open after this approval:** the three `M1-D1-SPINE` pending cases
(`d1.reconcile.worker_startup_lease_probe`, `d1.provider.worker_terminal_mapping`,
`d1.credential.production_reader_company_predicate`) and the 46 keyed D2 cases. The profile's own
verdict is `INCOMPLETE` and must stay so until those run; a gate record built from this bundle must
carry all three.

## Review attempt history

| Attempt | Reviewer | Reviewed revision | Disposition | Evidence/findings |
|---:|---|---|---|---|
| 1 | M1 review-batch-4 independent reviewer (Claude Opus 5) | `99bff824d1c4fd641cea3b05ab7fe588f8255b96` | `approved` | Checker at HEAD: 74 cases (25 required, 49 pending); self-test 25/25. Nine surfaces + four legacy tables with positive and anti-vacuity controls verified in the declaration and in `evaluateFaultMatrixDeclaration`. Mutation reproduced: dropping `d1.tenant.cross.tool_calls` reds `declaration:tenant_matrix_surface_missing`. Probe run `35848228046`, job `m1-fault-matrix` `107139436790`: preflight 25/25, live 20/20, verdict 25/25 required + 3 pending, suppression control exactly **9 distinct** `evidence:injection_did_not_fire`. Probe head = merged code + one trigger line (verified by diff). `E6-D003` locked and matched by the declaration on both gates. **Finding (non-blocking): §1's "73 cases (25 required, 48 pending)" is stale — the tree says 74/25/49 after `1337ee0b1`.** |
<!-- Later reviewers append attempt 2 below without replacing this row. -->
