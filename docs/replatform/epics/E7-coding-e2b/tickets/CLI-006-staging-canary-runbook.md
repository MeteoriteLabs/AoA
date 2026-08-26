# CLI-006 — Staging-canary campaign RUNBOOK (the E7-1 promoter)

**Audience:** the OPERATOR. **Purpose:** arm ONE canary Organization on the real-E2B staging substrate,
run the distributed coding journey (create → schedule → lease → stage → execute → stream → produce →
review → cancel → audit), capture the evidence, and — only on a cited run — promote `E7-1-coding-journey`.

**Written by the session before touching anything (go-book §4 Sprint 5b, STEP 0). Verified against
source at tip `07f80a165`.** Cite living documents by section+ID; every path below was opened, not
assumed.

---

## ★ 0. The operator/session boundary — read first, hold throughout

- **The SESSION may:** verify wiring against source; build/repair the journey harness (Leg B Part 2 —
  landed, see `CLI-006-D2-legB2-design.md`); run everything that runs without live staging or a real key
  (unit, embedded-PG); prepare these exact steps; and, **once a dispatched staging run exists, READ its
  evidence.**
- **Only the OPERATOR may:** stand up / reach the staging substrate, arm the canary Organization,
  authorize the real E2B spend, and run the campaign. **The `E2B_API_KEY` is a provider secret — never
  ask the session to enter or handle it.**
- **The session cannot reach the live substrate, so it STOPS at that boundary.** Until a cited
  dispatched staging run completes the DISTRIBUTED journey on real E2B, **the E7-1 leg is UNPROVEN and
  `E7-1-coding-journey` stays `unwired`** — an honest state, not a failure.

## ★ 0a. Honest substrate status — the distributed fleet is NOT deployed today

`docker-compose.staging.yml` is a **deployment-INTENT manifest**, render-checked only
(`scripts/check-staging-manifest.mjs`, `tests/d1/e6f-12-staging-render.test.mjs`); `docs/deploy/staging.md`
§ (closing) explicitly **defers real multi-host / external-store bring-up to "the deploy pipeline
(`scripts/deploy/*`) / a REL ticket."** `.github/workflows/deploy-testing.yml` stands up a single-node
**app** at `testing.armyofagents.org` (server + one Postgres; default `deployment_mode: authenticated`,
`cloud_auth` selectable), **NOT** the two-control-plane / four-worker / adapter-manager distributed fleet
this journey needs.

**Consequence:** arming the canary is an operator **infrastructure** step (stand up the fleet against
external DB/S3/realtime), not merely a config flip. This runbook gives the config + campaign steps; the
fleet bring-up itself is owed to a REL/deploy-pipeline task and is called out where it blocks.

---

## 1. STEP 0 — sequence + substrate check (session-verified, `07f80a165`)

| Check | Required | Verified |
|---|---|---|
| `E4-1-leases-through-protocol` | `wired` | ✅ `scripts/gate-clause-wiring.json` |
| `E4-2-supervises-sandboxes` | `wired` | ✅ same |
| `E7-1-coding-journey` | `unwired` (`expectedReferences: 2`) | ✅ same — **must stay until a cited run** |
| `E7-F001` (canary credential gap) | `resolved`, absent from ownership manifest | ✅ `epics/E7-coding-e2b/findings.md`, `scripts/finding-ownership.json` |

If any differ, you are out of sequence — **STOP**.

---

## 2. What arming a canary Organization requires (four things, all verified from source)

### 2.1 The rollout dial (canary mode)

Two env vars, BOTH required (the ENABLED flag is checked **first**, so the map alone does nothing):

- `AOA_DISTRIBUTED_EXECUTION_ENABLED=true` — `server/src/config/distributed-execution.ts`
  (`DISTRIBUTED_EXECUTION_ENABLED_ENV`; default false; gates the map at `resolveRunRolloutState`).
  **Already `"true"` on both `control-plane` and `control-plane-b` in `docker-compose.staging.yml`.**
  When true, `AOA_APP_DATABASE_URL` + `AOA_OPERATOR_DATABASE_URL` become mandatory or startup throws
  (`assertHostedExecutionStartupSafe`) — both are already wired in the compose.
- `AOA_DISTRIBUTED_EXECUTION_ROLLOUT` — `server/src/config/distributed-execution-rollout-source.ts`
  (`DISTRIBUTED_EXECUTION_ROLLOUT_ENV`). The parser (`parseDistributedExecutionRolloutMap`) accepts
  `mode ∈ {shadow, active, canary}`. **This var is ABSENT from `docker-compose.staging.yml`** (grep
  confirms zero matches) — with it unset, every org resolves `off`. **Arming the canary = adding it to
  BOTH control planes**, exactly:

  ```json
  {"organizations":{"<CANARY_ORG_ID>":{"mode":"canary","workloads":["batch"]}}}
  ```

  `"batch"` is the coding workload (the heartbeat seam passes `HEARTBEAT_TASK_RUN_WORKLOAD_TYPE = "batch"`
  — `heartbeat-distributed-rollout.ts` — into `resolveRunRolloutState`; all four cutover sinks resolve to
  `batch`). `["*"]` also works. **Rollback = delete the key or set
  `"active"`** — no code change. (Note the forward-compat trap: an OLD binary predating CLI-006 throws
  on `"canary"` at startup, or on a live edit fails CLOSED to legacy — so roll back by removing the key,
  never by downgrading the binary.)

### 2.2 The preflight's Company provider-key generation (CLI-007's authority)

`canary-preflight.ts` `check()` enumerates **every Company under the canary Organization** and requires,
for each, BOTH:

- **(b) provider-control authority moved:** `currentKeyGeneration !== null` — i.e. the Company has a
  **default `e2b` `runtime_provider_keys` row** whose backing `company_secret` has a `current` version
  (`e2b-credential-authority-wiring.ts` `deriveE2bKeyGeneration`). Absent ⇒ refuse
  `credential_authority_not_moved` ⇒ the canary run falls back to legacy (fail-closed).
- **(a) reconciliation closure:** `assertClosure` over legacy-lease inventory vs. crosswalk records. For
  a **fresh canary Org with no `environment_leases` and no platform-default env, this is trivially
  satisfied** (empty inventory). A Company holding legacy leases needs MIG-008 reconciliation records —
  and `reconcileCompanyLegacyResources` has **no route/job/scheduler wiring today**, so **use a fresh
  Organization with no legacy leases** for the canary.

Provision the per-Company key via the board/operator surface (`server/src/routes/secrets.ts`, both
require board auth + company access):

```bash
# 1) store the E2B provider-control secret for the Company
POST /api/companies/<COMPANY_ID>/secrets
     { "name": "provider:e2b", "provider": "local_encrypted",
       "managedMode": "aoa_managed", "value": "<E2B_API_KEY>" }
# → returns the secret id

# 2) make it the DEFAULT e2b runtime provider key
POST /api/companies/<COMPANY_ID>/runtime-provider-keys
     { "provider": "e2b", "isDefault": true, "secretId": "<from step 1>" }
```

After step 2, `deriveE2bKeyGeneration` returns `"<secretId>:1"` (non-null) and the preflight's clause
(b) passes for that Company. **Do this for every Company under the canary Org.**

> Decision #104: the E2B key value is stored encrypted (AES-256-GCM, `AOA_SECRETS_MASTER_KEY`) and is
> resolved only inside the sandbox. Never paste it into a URL, a log, or the rollout map.

### 2.3 A real enrolled worker

Each staging worker (`worker-a1`…`worker-b2` in the compose) enrolls with a code:

```bash
# operator, board actor with org permission execution_target:manage:
POST /api/organizations/<CANARY_ORG_ID>/execution-targets/<TARGET_ID>/enrollment-codes
# → returns a code aoa_enr_<locator>.<secret>  (10-minute TTL — worker-enrollment.ts CODE_TTL_MS)
```

Write the returned code into the worker's `AOA_WORKER_ENROLLMENT_CODE_FILE`
(`/run/secrets/worker-enrollment-code`, per the compose). The worker's daemon then POSTs
`/worker-control/enroll` with a device proof and receives a device session. The target must be `active`
with a ratified placement profile so placement can select it (WRK-011).

### 2.4 The E2B key on that substrate

`E2B_API_KEY` is injected **only** into `adapter-manager` on `provider-ctl-net`
(`docker-compose.staging.yml` — `E2B_API_KEY: "${AOA_STAGING_E2B_API_KEY}"`), ABSENT from every
control-plane/worker/migrate surface. Supply it as `AOA_STAGING_E2B_API_KEY` in the orchestrator secret
store (rotatable, never baked). Supply every other `AOA_STAGING_*` var (external DB/S3/realtime
pointers, image digests, session signing key) — see `docs/deploy/staging.md` and the compose.

---

## 3. The campaign — exact steps

> **Prerequisite (owed infrastructure):** stand up the `docker-compose.staging.yml` fleet against real
> external DB/S3/realtime with all `AOA_STAGING_*` set (see §0a — this bring-up is itself owed to a
> deploy-pipeline/REL task). The steps below assume the fleet is reachable.

1. **Pick a FRESH canary Organization** (no legacy `environment_leases`), with ≥1 Company.
2. **Provision the per-Company default `e2b` key** (§2.2) for every Company under it.
3. **Arm the rollout dial** (§2.1): add `AOA_DISTRIBUTED_EXECUTION_ROLLOUT` with the canary JSON to BOTH
   control planes and roll them (they already carry `AOA_DISTRIBUTED_EXECUTION_ENABLED=true`).
4. **Enroll the workers** (§2.3).
5. **Set concurrency cap `> 1`** for the canary Org. **This is load-bearing** (CLI-006 seam-plan Task 5,
   R4): at `cap = 1` the suppressed run counts against itself before its attempt claims capacity → 429 →
   `convert_failed` → **silent legacy fallback**, and the canary simply never happens. Use `cap = 2` on
   an otherwise-idle Org, or strictly greater than the Org's concurrent legacy runs.
6. **Create ONE coding task** in a canary-Org Company (a `software_development` project). Watch it
   traverse: create (task→job convert) → schedule (placement + the CLI-007 mint) → lease (a staging
   worker leases the attempt) → stage → execute (the coding CLI authenticates with the redeemed Company
   key **inside** the E2B sandbox) → stream → produce (patch) → review (projector surfaces evidence) →
   cancel (fence-revoking) → audit (JOB-008 inspection, redacted).
7. **Capture the evidence** (§4).
8. **Verify non-canary isolation:** a sibling non-canary Org's run stays byte-identically legacy.

---

## 4. Evidence to capture (what a citation must contain)

- The staging run identifier / URL and the canary `organizationId`.
- The `heartbeat_runs` row shows `execution_owner = "distributed"` + `distributed_job_id` /
  `distributed_attempt_id`; the legacy `adapter.execute` did **not** run for that run.
- The attempt reached a durable terminal state; the projector wrote run events + a run-summary comment.
- The E2B sandbox authenticated with the redeemed Company key (the execute hop produced real output);
  **no `E2B_API_KEY` / redeemed value appears in any log or event** (the S4 redaction canary is armed;
  a planted leak is scrubbed — DAT-008 slice 5).
- Cancel reached a durable terminal (fence-revoking `requestCancellation`); a late worker result is
  rejected `stale_fence`.
- JOB-008 operator inspection shows the canary's rows tenant-scoped + redacted.

**D1/D2 volume gates** (`test-gates.md` D2 §113-122: ≥120 real-E2B jobs, ≥20 across each of six classes,
**three consecutive passing runs**, p95 cancellation ≤30s) are a separate operator campaign record — a
single golden journey does not discharge them; cite them separately when run.

---

## 5. E7-1 promotion — the exact bar

Promote `E7-1-coding-journey` to `wired` in `scripts/gate-clause-wiring.json` **ONLY** on a cited
dispatched real-E2B run that completed the DISTRIBUTED journey (create/schedule/lease/review) end to end
on the staging substrate — **never** on:

- the keyed provider lane (`keyed-e2b-conformance.yml` — proves provider PRIMITIVES only; cited run
  [32995765059](https://github.com/MeteoriteLabs/AoA/actions/runs/32995765059) is GREEN but does NOT
  promote E7-1),
- a D1 fake-provider run (`d1-merge-train.yml`),
- a local harness (including Leg B Part 2 — embedded-PG, synthetic key, no sandbox).

"Any claim of real-E2B coverage must cite a dispatched run" (go-book §4 Sprint 5). Until such a run
exists, **E7-1 stays `unwired`** and the honest end-state is "campaign harness + runbook ready, staging
run owed."

When you have the citation: flip `E7-1-coding-journey` to `wired` with the run id in the `reason`,
update `CLI-006-campaign-result.md` §"E7-1 disposition", and update GO-BOOK §3.1 + §4 Sprint 5. Run the
five registers; commit; push.
