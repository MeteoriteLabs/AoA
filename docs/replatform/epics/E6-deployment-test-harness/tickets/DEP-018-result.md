# DEP-018 — The campaign fault matrix and injection harness — result

**Status:** `gate_review`. Only a DISTINCT reviewer sets `complete`.
**Epic:** E6 · **Plan task:** `E6 implementation-plan §4c DEP-018` (as amended at M1 Step 0, S0-8) · **Milestone:** `M1a`
**Date (UTC):** `2026-09-23`
**Implementer:** Claude Opus 5 (M1 build agent)
**Start SHA:** `b3c5aa417` (`origin/docs/replatform-program`)
**PR:** #TBD (base `docs/replatform-program`)

---

## 1. What shipped

| Piece | File | What it is |
|---|---|---|
| The declaration | `tests/d1/fault-matrix.json` | **3 gate profiles, 71 cases** (25 required, 46 pending). Each case carries `case`, `family`, `injection.{mechanism,target,observedBy}`, `expectedClassification` and — for a tenant case — `tenantCase`. |
| The pure verdicts | `scripts/lib/campaign-fault-matrix.mjs` | `evaluateFaultMatrixDeclaration` (is the matrix complete?) and `evaluateFaultMatrixEvidence` (did each case's injection FIRE, and did the classification match?), plus the enumerated constants `GATE_PROFILES`, `REQUIRED_FAMILIES`, `REQUIRED_TENANT_SURFACES`, `REQUIRED_LEGACY_TABLES`. |
| The checker | `scripts/check-campaign-fault-matrix.mjs` | Thin CLI. Bare = the declaration; `--evidence <bundle>` = a lane's run. Declared in `scripts/guard-inventory.json`. |
| The checker's reds | `scripts/check-campaign-fault-matrix.test.mjs` (23 tests) | One red fixture per violation code, against a zero-violation anchor. Wired into `pr.yml` `policy` → *Campaign fault matrix declaration (DEP-018)*, declared in `scripts/test-execution-census.json`. |
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
(`scripts/lib/m1-spine-assertions.mjs`), called here rather than restated. No verdict needed
extending; none was changed, so the two lanes cannot drift.

## 2. Acceptance → evidence

| # | Acceptance (E6 plan §4c) | Where it is proven |
|---|---|---|
| 1 | Every declared case has a run showing **its injection fired**, with the observed classification matching | §3: **25/25 required cases fired and classified**, twice. The verdict is `evaluateFaultMatrixEvidence`, run by the harness's own last case AND by the checker over the retained bundle. §4's suppressed control is what shows it can say NO. |
| 2 | Every cross-tenant denial is **denied, not merely empty**, with a same-tenant **positive control** | §3a — nine surfaces, each with its control. ★ For the four tables of acceptance 5 the "with RLS" half **cannot** hold and is not claimed; see §3b. |
| 3 | The control tenant is refused distributed execution and stays legacy | §3c, through the REAL placement service with the enabled-tenant positive control. |
| 4 | The checker reds on an undeclared case, a case with no injection evidence, or a profile missing the tenant matrix | §5 — 23 self-tests, one red fixture per violation code, including "drop ANY of the nine surfaces" and "drop ANY of the four legacy tables" as loops. |
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
| `lease` | B renews A's live lease at `/worker-control/leases/:id/renew`: **4xx with a code** (a DENIAL, not merely a non-success — a 5xx or a transport failure would fail this case) | A's own renew of the same lease: **200** |
| `cancel` | the PRODUCTION `requestCancellation` under B's Organization and Company against A's job: A's attempt **untouched** | the same service on a throwaway A job: **cancelled** |
| `secrets` | B resolves A's handle at the fenced route: **`denied`**; and A's `job_secret_handles` row under B's scope: **0 rows** | A's own scope: **1 row**. ★ Bounded claim — see below |
| `staged_inputs` | B requests a transfer grant on A's attempt: **409 `stale_fence`** | A's own grant: **`upload_granted`** |
| `outputs` | B commits an artifact onto A's attempt: **denied** | A's own commit: **`committed`** |
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
| `provider_credentials` | the two predicates the fenced `device_local` arm uses (`resolveExecutionSecret`): `id = refId AND company_id = <the locked lease's companyId>` | 1 row | **0** | > 0 |

The **anti-vacuity** column is the same read with the tenant predicate REMOVED, and it returns the
owner's row every time — so each `foreign = 0` is shown to be the filter's work and not an empty
table. The assertion order in the case is deliberately `own > 0`, then `unscoped > 0`, then
`foreign === 0`: the two controls must hold before the denial means anything.

**Two bounded points, stated rather than discovered later.**
1. `provider_credentials` is planted by owner SQL and read through an equivalent two-predicate
   query on the `aoa_app` pool, not by calling `resolveExecutionSecret` itself — that entry point
   lives in `packages/db` behind `runInTenant` + a live fence, and reaching its `device_local` arm
   needs a real broker. The predicate under test is the one that arm uses, cited by symbol in the
   declaration's `productionPath`.
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
turned it green (23/23). The first RED run also caught a defect in the test itself: a mutation that
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
  the same stack after every harness edit. ★ One intermediate `m1-spine` run — taken immediately
  after a fault-matrix run on the SAME live stack — failed one case; the re-run on a quiesced stack
  was 6/6. Recorded because it is the reason the merge train gives each profile its **own** stack
  and tears it down: the two profiles share a database and a tenant set, and the matrix deliberately
  cancels and reaps.

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
