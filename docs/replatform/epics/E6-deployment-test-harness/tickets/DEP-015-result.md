# DEP-015 Result — the shipped CI boot lane

**Status:** `gate_review`. The **keyed acceptance is PENDING**: it needs one dispatched keyed run from the F8 named list, which is the planning session's to dispatch.
**Date (UTC):** `2026-09-21`
**Epic:** `E6-deployment-test-harness`
**Plan task:** `E6 implementation-plan §4c DEP-015 — The shipped CI boot lane (M, ≤3 agent-days, M1a)`
**Specification:** founder ruling **F3** (M1 plan §2), plus the S0-8 amendments (acceptance 6 and 7).
**Implementer:** `M1 build agent (Claude Opus 5)`
**Start SHA:** `28a2dd259ed7bdd8d64d68ad8a5999500d80b69e` (program tip `docs/replatform-program`)
**Reviewed revision (code):** `1ec5533b5b2c80cf2bcbd7e228efa4d11c7b3662` (§3 records exactly which revision each piece of evidence ran at; after the rehearsal, `c3c014bce..1ec5533b5b2c80cf2bcbd7e228efa4d11c7b3662` adds only the `seed` assertion that each created agent is `idle`, from Codex's first review)
**PR:** #554 (base `docs/replatform-program`)

The implementer leaves `Status` at `gate_review`. Only a DISTINCT reviewer may set `complete`.

**Not dispatched.** No run of `m1-shipped-boot.yml` has been dispatched, keyed or keyless, and no `keyed-*` workflow was dispatched. The dispatch-registration blocker (§8) was ruled by the planning session as **E6-D001** (option (b)) and is implemented here. The lane registers when this PR merges.

---

## 1. What shipped

| Acceptance clause (E6 plan §4c) | Where | State |
|---|---|---|
| 1. One dispatched run on a named candidate builds all three images from that candidate, boots them, runs the journey and records the verifier verdict. `capabilityProven=false` is acceptable. | `.github/workflows/m1-shipped-boot.yml`, driving `scripts/m1-shipped-boot/journey.mjs` | **Built, not run keyed. PENDING (F8).** The keyless half ran locally end to end (§3). |
| 2. The keypair exists only inside the job and appears in no artifact or log | `journey.mjs` `prepare` (ed25519, `generateKeyPairSync`, written 0600 under `$RUNNER_TEMP`); `pnpm verify:cp-am-keypair` step; `teardown` deletes it; the upload path is `…/evidence/` only | **Met in design, and measured locally**: 0 of 25 job secrets (the private PEM included) appear in the retained evidence (§3). Keyed confirmation is pending. |
| 3. The default-off invariant still reds on every manifest except the overlay. **Positive control:** the same env on the base staging manifest reds. | `scripts/lib/staging-manifest-invariants.mjs` `checkDispatchDefaultOff` + `evaluateShippedBootOverlayInvariants`; `scripts/check-staging-manifest.mjs` (`--rendered` for the lane) | **Met.** See §2 and §4. |
| 4. The workflow-shape guard proves the lane cannot run on push, pull_request or schedule and refuses to start without a candidate. The guard has its own positive control. | `scripts/check-m1-shipped-boot-shape.mjs` + `scripts/lib/m1-shipped-boot-shape.mjs`; reds in `scripts/check-m1-shipped-boot-shape.test.mjs` | **Met** (27 cases). Per **E6-D001**, the one allowed push only REGISTERS the lane: branch `docs/replatform-program`, paths = the workflow file only, every job gated `if: github.event_name == 'workflow_dispatch'`. Positive controls: an unrestricted push reds; an ungated job reds. |
| 5. Keyed spend happens only inside the F8 envelope, on a named candidate | `mode` input: a choice, **default `keyless`**. `E2B_API_KEY` / `ANTHROPIC_API_KEY` are readable only as `inputs.mode == 'keyed' && secrets.X \|\| ''` (enforced by the shape guard). The candidate must be 40-hex and an ancestor of `docs/replatform-program`. | **Met in design.** The spend itself happens only when the planning session dispatches. |
| 6. F10: two enabled Organizations and one control; the journey runs for each enabled tenant; the control stays on the legacy path | `seed` (three Organizations through the API); `apply-rollout` (`AOA_DISTRIBUTED_EXECUTION_ROLLOUT` on **both** replicas, control absent); `assert-tenants`; `dispatch` + `classifyTenantOutcome` | **Tenant set and control refusal measured locally (§3).** The enabled tenants' journey is keyed and PENDING. |
| 7. The crew switch is off on every control-plane service, and the assertion is recorded in the evidence | overlay pins `AOA_DISTRIBUTED_CREW_ROLLOUT_ENABLED: "false"` on both replicas (static check); `assert-tenants` re-checks the render and each **running** replica (`evaluateMustBeOffFlags`, which also covers `AOA_DISTRIBUTED_TOOL_SURFACE_ENABLED`) → `tenant-set-and-flags.json` | **Met.** Measured locally (§3). |

**Files created:**
- `.github/workflows/m1-shipped-boot.yml`
- `docker/m1-boot/docker-compose.m1-boot.yml` (the worker provider-URL overlay)
- `scripts/m1-shipped-boot/journey.mjs`
- `scripts/lib/m1-shipped-boot.mjs`, with 26 cases in `scripts/lib/__tests__/m1-shipped-boot.test.mjs`
- `scripts/check-m1-shipped-boot-shape.mjs` + `scripts/lib/m1-shipped-boot-shape.mjs`, with 27 cases
- `docs/replatform/epics/E6-deployment-test-harness/decisions.md` (new), recording **E6-D001**

**Files changed:**
- `scripts/lib/staging-manifest-invariants.mjs`
- `scripts/check-staging-manifest.mjs`
- `scripts/check-staging-manifest.test.mjs` (16 new cases; 49 in total)

**Registration:**
- `pr.yml` `policy`: the DEP-006 staging step is renamed *"Staging manifest config contract (DEP-006) + shipped CI boot lane (DEP-015)"* and gains 2 lines. Folding into an existing step keeps every register citation within its ±5 anchor; a separate step would have shifted 20+ `pr.yml:1118` citations.
- `scripts/guard-inventory.json`: new entry, appended at the end so that `guard-inventory.json:201` does not move.
- `scripts/test-execution-census.json`: two new `runs` entries, and the renamed step on the existing one.
- `scripts/test-inventory.json`: the `scripts` pin moves from 66 to 68. Only that tree changed.
- `scripts/workflow-verdict-manifest.json`: `m1-shipped-boot.yml@*` is `not-watched`, because the lane is dispatch-only with a required candidate.

---

## 2. The scoped amendment — why it is safe

`checkDispatchDefaultOff` bans three switches on a worker: `AOA_WORKER_DISPATCH_ENABLED`, `AOA_WORKER_SANDBOX_PROVIDER` and `AOA_WORKER_PROVIDER_URL`.

**What the amendment admits:** exactly `AOA_WORKER_PROVIDER_URL=http://adapter-manager:8090` and `AOA_WORKER_DISPATCH_ENABLED=1`, under all three of these conditions:
- only on the services in `SHIPPED_BOOT_OVERLAY_WORKERS` (`m1-worker-a|b|c`);
- only when the caller passes the module-private `SHIPPED_BOOT_ALLOWANCE` Symbol;
- only when `evaluateShippedBootOverlayInvariants` is evaluating `SHIPPED_BOOT_OVERLAY_PATH`.

`evaluateStagingManifestInvariants`, which every other manifest goes through, has no parameter that can carry the Symbol.

**What is never admitted:**
- `AOA_WORKER_SANDBOX_PROVIDER` (an in-worker provider);
- any switch set inline in `command`/`entrypoint`;
- any other value;
- the four base staging workers;
- a fourth, unlisted overlay worker.

**One tightening beyond the ticket.** Workers are now enumerated by **image or name**, not by the fixed `WORKER_SERVICES` list. The fixed list is exactly how `docker/campaign/docker-compose.campaign.yml`'s `worker` sat outside the ban. The base staging manifest is unaffected: its service set is exactly the four named workers, and it still passes with 0 violations.

**The lane repeats the check on the real merge.** The static check models `base ⊕ overlay` with `mergeComposeModel`. Before anything boots, the lane runs `node scripts/check-staging-manifest.mjs --rendered <docker compose config --format json>`, which asserts two things about the engine's own merge:
- the scoped evaluation passes;
- the **same render reds through the unscoped path** — a positive control at run time.

---

## 3. Keyless evidence — a full local rehearsal (Docker Desktop, 2026-09-21)

**What ran:**
- **Images:** built by `docker/images/build.sh` from `c31dccf876723c11ac046804025f77fd42165198` (the PR's second commit). `digests.env` records `*_REVISION=c31dccf87…` for all three images.
- **Driver:** `scripts/m1-shipped-boot/journey.mjs` at `c3c014bce`. `git diff c31dccf87 c3c014bce` touches only `scripts/m1-shipped-boot/journey.mjs`, which runs on the host and is not in any image.
- **Phases:** every phase, `prepare` through `collect`, in keyless mode.

| Phase | Observed |
|---|---|
| `prepare` | keypair generated in-job; sign/verify probe passes. Separately, `pnpm verify:cp-am-keypair` over the generated pair printed `✓ CP↔AM keypair smoke: PASS`, and a mismatched public key made it exit 1 (positive control). |
| `boot-core` | the render check printed `OK: rendered shipped boot satisfies DEP-015 (scoped), and the unscoped default-off check reds it (6 violation(s))`. postgres, minio and migrate (exit 0) came up, then `control-plane` and `control-plane-b` were healthy. |
| `seed` | board identity seeded as an owner-role SQL fixture (no route mints the first one). Then **through the API**: 3 Organizations, 3 Companies (`companies.organization_id` verified), 3 org agents (`claude_local`), and the anthropic + e2b Company keys (keyless placeholders). |
| `apply-rollout` / `assert-tenants` | both replicas recreated. `tenant-set-and-flags.json` shows `tenantSet: "exact"`, `crewRolloutEnabled: "false"` and `mustBeOff: "off"` for `control-plane:rendered`, `control-plane:running`, `control-plane-b:rendered` and `control-plane-b:running`. |
| `provision-targets` | 3 `aoa-canary-e2b` `dedicated_worker` targets created and **ratified** through the API (each with its own `registeredProfileHash`); 3 enrolment codes issued through the API and encoded as `aoa_tkt_` tickets. |
| `boot-workers` | 3 real worker containers running `networked-host.js`, all healthy. The **adapter-manager was never created** (`compose ps` has no such container). |
| `await-workers` | each tenant has exactly 1 worker, `status=enrolled`, live, on **its own** Organization's target. Worker log: `worker-daemon dispatch COMPOSED; heartbeat seeded; leasing through the poll loop`. |
| `reconcile` | `reconcile-legacy-resources` exits 0 for all three. The canary preflight returns `{ ok: true, credentialAuthority: "company_api_key" }` **for all three, including the control**, so the control differs from A and B only in the rollout. |
| `dispatch` (keyless: control only) | control run `execution_owner=null`, no distributed ids, `jobs` for the control Organization = 0. The control plane logged `[CLI-006] rollout resolved` with `rolloutState: "off"` and `rolloutOrganizationId` equal to the control Organization. The run failed legacy with `Command not found in PATH: "claude"`, as expected: the control-plane image ships no agent CLI. **PASS.** |
| `collect` / `teardown` | 17 evidence files; **0 of 25** job secrets appear in any of them. The stack and its volumes were removed, and the keys, tickets, env and state were deleted. |

The rehearsal found three defects in the first version of the driver. All were fixed before this record:
1. A target created without `capabilities.providerConstraints` ratifies, then gets a 503 on every enrolment.
2. The container prefix in `docker compose logs` blocked extraction of the rollout record.
3. The two-replica boot race (§7).

---

## 4. RED → GREEN, positive controls, mutations

**RED.**
- The new staging-manifest cases, run against the pre-change `staging-manifest-invariants.mjs` (`git show HEAD:…` swapped in), fail: the suite cannot load because the new exports do not exist. That is a trivial RED, so the mutation table below carries the evidence.
- Two driver defects were RED live in the rehearsal before they were fixed (§3).

**GREEN in CI.** PR run `35591595055`, job **`policy`** (`106306988724`), step *"Staging manifest config contract (DEP-006) + shipped CI boot lane (DEP-015)"*:
- `OK: docker/m1-boot/docker-compose.m1-boot.yml satisfies the DEP-015 shipped-boot contract`;
- `check-staging-manifest.test.mjs`: **49 tests, 49 pass**;
- `OK: .github/workflows/m1-shipped-boot.yml is the F3 shipped CI boot…`;
- shape + lib suites: **46 tests, 46 pass**.

**Local.** All 46 pure `pr.yml` guards, run with the M1 guard loop, are green, and `check-evidence-immutability --base origin/docs/replatform-program` is green.

**Positive controls, each asserted by a test:**
- The overlay's worker env grafted onto BASE `worker-a1` reds with `DISPATCH-DEFAULT` for `AOA_WORKER_PROVIDER_URL` and `AOA_WORKER_DISPATCH_ENABLED`.
- `base ⊕ overlay` through the unscoped path reds on all three overlay workers.
- A push trigger without the paths restriction reds the shape guard, and so does a job without the dispatch-only `if` (E6-D001). (Superseded wording, kept as first written: "A re-added `push:` trigger reds the shape guard.")
- A control tenant present in the rollout reds.
- A control run that went distributed reds.

**Mutations.** Code was mutated in place, the owning suite was run, and the mutation was reverted. **15 of 15 were killed** (M13 to M15 were added with E6-D001).

| # | Mutation | Killed by |
|---|---|---|
| M1 | admission ignores the Symbol (unscoped) | 2 cases |
| M2 | admission not bound to the overlay path | 1 |
| M3 | admission ignores the value | 1 |
| M4 | workers enumerated by the fixed list only | 7 |
| M5 | crew switch not checked | 2 |
| M6 | rollout checked on one replica only | 2 |
| M7 | shape guard tolerates `push` | 1 |
| M8 | shape guard ignores ungated secrets | 1 |
| M9 | tenant set tolerates the control in the rollout | 1 |
| M10 | control outcome ignores its jobs | 1 |
| M11 | control outcome ignores the rollout resolution | 1 |
| M12 | flag parser reads `true` as off | 2 |
| M13 | registration push: paths restriction not checked | 2 |
| M14 | job-level dispatch gate not checked | 3 |
| M15 | registration push body ignored entirely | 3 |

M7 ("shape guard tolerates `push`") was run before E6-D001, against the dispatch-only guard.

---

## 5. What the keyed run must show (the pending acceptance)

It is dispatched on a named candidate in `mode=keyed`, and it must retain `journey.json` showing both of the following.

**For each enabled tenant (A, B):**
- `execution_owner="distributed"`, with both distributed ids set;
- `rolloutState: "canary"` logged;
- `verify-e7-1-distributed-run` exit 0 with `ok:true`;
- at least one worker log line naming a provider `sandboxId`, because runbook §11 notes the verifier cannot tell a real provider from a fake;
- `capabilityProven` recorded; `false` is acceptable.

**For the control tenant (C):** as in §3.

**Signals recorded per tenant:**
- **audit:** `activity_log` `job.submitted` and `security.denied.*` rows, plus the `heartbeat_run_events` `distributed_execution_*` rows;
- **cost:** the `cost_events` count for the run, plus `heartbeat_runs.usage_json`. A distributed run writes no `cost_events` today (E3-F037 / JOB-016), so this is **recorded, not judged**;
- **failure classification:** run status/error, `usage_json.terminalErrorCode`, `job_events` terminal payload (status, errorCode, exitCode), and `job_attempts` placement.

---

## 6. Deltas against the task section

**The planning session ACCEPTED the three deviations below (authenticated, the board-key SQL fixture, keyless dispatching only the control tenant) on 2026-09-21.** The keypair-check `pnpm install` is a cost, not a deviation.

- **`authenticated`, not `cloud_auth`.** The overlay runs both control-plane replicas as `authenticated`, overriding the staging manifest's `cloud_auth`. That matches the only deployment in which the distributed journey has been proven (the campaign overlay, run `8dc34e90`, 2026-09-18). Proving `cloud_auth` is not in the ticket; a reviewer may want it named as a residual.
- **The keypair check needs `pnpm install`.** `pnpm verify:cp-am-keypair` cannot run inside the control-plane image, because it imports the adapter-manager package, a server devDependency that `pnpm deploy --prod` strips out. The lane therefore installs dependencies on the runner, roughly 2 minutes.
- **The board identity is a SQL fixture.** No route mints the first board API key in `authenticated` mode without an OAuth session. So the first key (user, `instance_admin` and `board_api_keys`) is seeded with the owner role, and every tenant object after it is created through the API as that user.
- **Keyless mode dispatches only the control tenant, deliberately.** An enabled tenant's run with no adapter-manager would be leased and then fail at the provider hop. The verifier's terminal-agnostic clause 3 could then print a mechanism PASS with no provider ever involved. That is a misleading artifact, so keyless never produces it.

---

## 7. Findings — FILED 2026-09-21 at the planning session's instruction

Both are `unowned`, with reasons in `scripts/finding-ownership.json`. Each id is the true maximum per epic plus one, checked repo-wide and against the open PRs; the `E2-F900` in `check-distributed-execution-foundation.test.mjs` is a fixture.

- **E2-F017** (MEDIUM), E2 `findings.md`: item 1 below. `maybeProvisionDistributedExecutionRoles` is documented in source as the "corrective successor to E2-D03".
- **E3-F040** (MEDIUM), E3 `findings.md`: item 2 below. Both the enrolment service (`1d590ea47`, `feat(job-control): enroll device-bound workers`) and the ratify route are E3 job-control. MEDIUM rather than LOW: it fails closed and leaks nothing, but it blocks every worker on the target, and the documented runbook path reaches it with an unnamed 503.

As first recorded:


1. **Two control-plane replicas booting together crash one of them.** `maybeProvisionDistributedExecutionRoles` runs `ALTER ROLE … LOGIN PASSWORD` on every replica at boot. Run concurrently, the loser dies with `PostgresError: tuple concurrently updated` (XX000, `heapam.c` `simple_heap_update`). This was measured in the rehearsal on the first recreate of both replicas with `--force-recreate`. `docker-compose.staging.yml` declares two replicas with no ordering, so a real staging boot can hit this. The lane works around it by booting the replicas one at a time (`bootCore`, `applyRollout`). The product fix — an advisory lock or an idempotent guard around the provisioning — is not in this ticket.
2. **An execution target created without `capabilities.providerConstraints` ratifies cleanly, then every enrolment returns 503** (`worker_enrollment_internal_unavailable`). The enrolment response is built from `providerConstraints(target.capabilities)` (`server/src/services/worker-enrollment.ts`), while ratification writes only `provider_constraint_profile`. Runbook §7(a) does not mention the field. A founder following the runbook through the API would hit this failure, and the log would not name the cause.

---

## 8. Dispatch registration — RULED: E6-D001, option (b)

The planning session ruled **option (b)** under F2 and recorded it as **E6-D001** (E6 `decisions.md`). Option (a) was rejected because the locked integration strategy forbids any change to `main` before M5. As implemented:

- `on:` = `workflow_dispatch` + `push: { branches: [docs/replatform-program], paths: [".github/workflows/m1-shipped-boot.yml"] }`;
- the one job carries `if: github.event_name == 'workflow_dispatch'`, so a push-created run executes zero steps and touches zero secrets;
- the shape guard enforces exactly this (§1, clause 4);
- the verdict manifest declares `m1-shipped-boot.yml@docs/replatform-program` `not-watched`, because a verdict on a skipped job would be a check that nothing runs.

**Registration.** The lane registers when this PR merges: the merge pushes the file onto `docs/replatform-program`, which matches the push path, so GitHub records one run with the job `skipped`. That run, with all its jobs shown `skipped`, is to be cited here after the merge. The merge is the planning session's, so the citation is a post-merge addendum and is not in this revision.

The original blocker text follows, kept as first written:

### 8 (as first written). BLOCKER for the first dispatch — needs a decision (Codex raised the same on `1ec5533`; its thread was left OPEN for this ruling)

GitHub dispatches a `workflow_dispatch` workflow only in two cases: the file exists on the **default branch**, or the workflow **has already run at least once**. Per the GitHub docs, "This event will only trigger a workflow run if the workflow file exists on the default branch"; the API/CLI can target another ref once the workflow has run.

This file is on `docs/replatform-program` only and has never run. Measured after the push: `gh api repos/MeteoriteLabs/AoA/actions/workflows/m1-shipped-boot.yml` returns **404**, and the workflow is absent from the 20 registered workflows.

Every `keyed-*` lane that was dispatched from this branch has a `push:` trigger on a bump file; that trigger is what registered it. F3 forbids a push trigger for this lane, and the M1 rules forbid targeting `main`. The options, none of which I took:
- **(a)** Land `.github/workflows/m1-shipped-boot.yml` alone on `main`. It registers the workflow; `--ref docs/replatform-program` then runs the branch's own copy.
- **(b)** Rule that a registration-only trigger satisfies F3: a `push` on a never-bumped trigger file, with the job gated `if: github.event_name == 'workflow_dispatch'`. The shape guard would need the matching amendment.
- **(c)** Something else the planning session prefers.

**The dispatch command, once the registration run exists:**

```
gh workflow run m1-shipped-boot.yml --ref docs/replatform-program \
  -f candidate=<40-hex frozen candidate on docs/replatform-program> -f mode=keyed -f e2b_template=aoa-base
```

`mode=keyless` with the same candidate is a free rehearsal of §3 on the Linux runner.

## Independent review

**Reviewer:** M1 review-batch-2A independent reviewer (Claude Opus 5). I did not author DEP-015, and I am not the planning session.
**Reviewed revision:** dbe6f5da2a9316ac3f9762294d87991d7ec6f885 (the final PR #554 head, merged as `947b684d8a5bf1fcdacb20c5ff077668db54c517`). This is not the record's stated `1ec5533b5`; see below.
**Disposition:** `changes_requested`. The request is about the record only; the code needs no change.
**Attempt:** 1 (see *Independent review — attempt 1* and the attempt history)

### Independent review — attempt 1

**Disposition: `changes_requested`.** The lane, the guards and the overlay hold up at source and in CI. The record, however, pins the wrong revision and cites CI that does not cover the code it describes. That is the "record disagreeing with code" class, and it lives in the two fields a later reader relies on. `Status` stays `gate_review`.

**What is wrong in the record (blocking):**

1. **The `Reviewed revision (code)` field is false.** The header names `1ec5533b5b2c80cf2bcbd7e228efa4d11c7b3662`. The last PR commit, `dbe6f5da2a9316ac3f9762294d87991d7ec6f885` (`ci(m1): E6-D001 registration-only push…`), changes code after that revision:
   - `.github/workflows/m1-shipped-boot.yml` (+22/−);
   - `scripts/lib/m1-shipped-boot-shape.mjs` (+52/−);
   - `scripts/check-m1-shipped-boot-shape.mjs`;
   - `scripts/check-m1-shipped-boot-shape.test.mjs` (+61/−);
   - `scripts/workflow-verdict-manifest.json`;
   - `scripts/finding-ownership.json`.

   The record's body already describes that later code: §1 clause 4 "27 cases", the E6-D001 push shape, mutations M13–M15, and §8 "As implemented". So the header pins a revision that does **not** contain what the record says was built. Both SHAs are ancestors of the tip. Only one of them is the right one.
2. **The CI evidence in §4 does not cover the reviewed code.**
   - "GREEN in CI. PR run `35591595055`, job `policy` (`106306988724`)" is a run on headSha `c31dccf87…`, the PR's **second** commit. That run concluded **`cancelled`**: all four `verify` shards, `e2e` and `ci-required` were `cancelled`, and only `policy` and a few other jobs completed.
   - Its `policy` log shows the pre-E6-D001 guard: "dispatch-only, candidate-bound" and **46** shape+lib tests.
   - The run that covers the final code is **`35596651522`** (headSha `dbe6f5da2a…`, conclusion `success`, `ci-required` `106327999223`), and the record never cites it. Its `policy` job **`106322893461`** executed the DEP-015 step:
     - `OK: docker/m1-boot/docker-compose.m1-boot.yml satisfies the DEP-015 shipped-boot contract`;
     - `check-staging-manifest.test.mjs` **49/49**;
     - `OK: .github/workflows/m1-shipped-boot.yml is the F3 shipped CI boot: runs only on dispatch (push = registration only, E6-D001), candidate-bound, …`;
     - shape + lib **53/53** (27 + 26).
3. **The §8 promise is not kept yet.** §8 says the registration run "is to be cited here after the merge", in a post-merge addendum. No addendum exists.

**Required changes.** Append a dated addendum, keeping the existing text as written, that does the following:
- **(a)** Re-points the reviewed revision to `dbe6f5da2a9316ac3f9762294d87991d7ec6f885`, with `1ec5533b5…` kept as superseded.
- **(b)** Cites run `35596651522` by job with the counts above, and records that `35591595055` was a cancelled run on `c31dccf87`.
- **(c)** Cites the registration run and the keyless rehearsal:
  - Registration run **`35598343418`**: `push` on `docs/replatform-program`, headSha `947b684d8a5b…`, conclusion `skipped`, job `shipped-boot` **`106328314759`** `skipped` with **0 steps**. This shows that the E6-D001 push executes nothing.
  - Keyless rehearsal **`35600507289`**: `workflow_dispatch`, candidate `fc2eb7dde6325803c77950ac4adb1d190db0bd9a`, `MODE: keyless`, conclusion `success`, job **`106335219133`** with 28 steps. Its logs show:
    - `prepare` generated the keypair in the job; `✓ CP↔AM keypair smoke: PASS`;
    - both control-plane replicas were healthy;
    - three Organizations were seeded, with distinct org ids;
    - `assert-tenants` "both replicas (rendered AND running) hold exactly {A, B} canary, control … absent; crew + tool surface OFF";
    - three workers were enrolled, each on its own Organization's target, and the adapter-manager was **not** started;
    - `dispatch: tenant c (control) … owner=null … → PASS`;
    - 17 evidence files were uploaded (`m1-shipped-boot-keyless-35600507289`);
    - `teardown` reported "keys dir gone".

    This is the §3 rehearsal repeated on the Linux runner, at a candidate that contains this code.

Once the addendum lands, a re-review should be short. Nothing else I checked needs to change.

**What I verified and found sound (for the next attempt to reuse):**
- **Ancestry.** Start SHA `28a2dd259…`, `c31dccf87…`, `c3c014bce`, `1ec5533b5…` and `dbe6f5da2…` are all ancestors of `fc2eb7dde`.
- **Guards, rerun locally at the tip.**
  - `node scripts/check-m1-shipped-boot-shape.mjs` passes.
  - `node scripts/check-staging-manifest.mjs` passes, including the overlay.
  - `node --test` shows shape + lib **53/53** and `check-staging-manifest.test.mjs` **49/49**.
- **Mutation M13, reproduced by me.** Disabling the registration-push `paths` check in `m1-shipped-boot-shape.mjs` gives **2 failed / 25 passed**, exactly the "2 cases" the record gives. Reverted; the tree was clean.
- **The workflow shape.** `on:` has `workflow_dispatch` plus a push restricted to `docs/replatform-program` / the workflow file. The job is gated `if: github.event_name == 'workflow_dispatch'`. The candidate must be 40-hex, and the mode must be `keyless|keyed` (the "Validate the named candidate" step). E6-D001 is recorded in E6 `decisions.md`.
- **Keypair and evidence.** `journey.mjs` `writeEvidence` passes every retained file through `redactSecrets(text, state.redact)`. `state.redact` includes the generated secrets, the board token, the private PEM and both provider keys. `teardown` deletes `keys/`, the env file and the state file. The "0 of 25 secrets" measurement is the author's local scan. The lane itself has no leak **assertion**: it redacts, but it does not fail on a residual. I did not download the rehearsal artifact, so I have not re-measured it. Acceptance 2 is therefore "met in design", with keyed confirmation pending, as the record says.
- **Codex.** "Didn't find any major issues" on `78f9d85912` and on the final head `dbe6f5da2a`. Both P1 threads (seeded agents idle; workflow registration) are resolved.
- **Multi-tenant (F10): real where it has run.** Three Organizations are seeded through the API. The rollout on **both** replicas is asserted rendered **and** running. The control run stays legacy, with `rolloutState: "off"` for the control org. The **enabled tenants' journey has not run.** That is keyed and pending, and the record says so.

**Acceptance status (E6 plan `DEP-015`).**

| # | Status |
|---|---|
| 1 | **OPEN**: the keyed run is pending (F8), and the record says so. |
| 2 | Met in design; keyed confirmation pending. |
| 3 | **Evidenced**. |
| 4 | **Evidenced** as amended by E6-D001, and the registration run proves the push is inert. |
| 5 | Met in design. The `mode` default is `keyless`, and the keys are gated to `inputs.mode == 'keyed'`. |
| 6 | Control half evidenced (keyless, CI); enabled-tenant half **OPEN** (keyed). |
| 7 | **Evidenced**. |

## Review attempt history

| Attempt | Reviewer | Reviewed revision | Disposition | Evidence/findings |
|---:|---|---|---|---|
| 1 | M1 review-batch-2A independent reviewer (Claude Opus 5) | `dbe6f5da2a9316ac3f9762294d87991d7ec6f885` | `changes_requested` | Record only. The header's reviewed revision `1ec5533b5` predates the E6-D001 code (`dbe6f5da2`) that the record describes. §4's CI run `35591595055` was `cancelled`, on `c31dccf87`, with the pre-E6-D001 guard (46 tests). The covering run `35596651522` (policy `106322893461`: 49/49, 53/53) is uncited, and §8's post-merge citation is missing: registration `35598343418` (job `106328314759` skipped, 0 steps) and keyless rehearsal `35600507289` (job `106335219133` success). Code sound: guards green locally, M13 reproduced (2 failed), Codex clean on `dbe6f5da2a`. Acceptance 1 and the enabled half of 6 are OPEN (keyed). |

---

## 9. Follow-up — the first keyed run failed at `stage_files` (2026-09-21)

The planning session dispatched the first keyed run: **`35601445269`**, on candidate `fc2eb7dde`. Before it, the keyless rehearsal `35600507289` passed. Every step through "Reconcile and preflight every Organization" succeeded. Then "Run the journey" failed for **both enabled tenants**. The control tenant correctly stayed legacy.

**The evidence**, all from the retained bundle:
- **Worker:** the supervisor logged "staging the control plane's input failed", with `stagedCount` 2 and the error `WireProtocolError … (adapter-manager provider operation failed)`.
- **Verifier:** `leases=1`, `attempt_started=0`.
- **adapter-manager:** its log recorded nothing about the operation.

**Root cause, measured at source by the planning session.** The E2B provider redeems the download grant *inside the adapter-manager process* (`fetchGrantBytes`, `packages/sandbox-e2b-provider/src/e2b-provider.ts`). The overlay's presign endpoint is `https://minio:9000`. The adapter-manager had neither of the two things that fetch needs:
- **the network:** it had no `store-egress-net`; the base manifest gives it only `control-net` + `provider-ctl-net`;
- **the CA:** it had no `NODE_EXTRA_CA_CERTS` and no mounted CA.

**Why the rehearsals missed it.** On the Hetzner campaign the adapter-manager fetched real S3 over the internet, so this never surfaced there. The keyless mode never starts the adapter-manager, so it could not see it either. And §3's rehearsal was keyless.

**Fixed in the follow-up PR:**
1. **The overlay.** In `docker/m1-boot/docker-compose.m1-boot.yml` only, the adapter-manager joins `store-egress-net` and gets `NODE_EXTRA_CA_CERTS=/certs/ca.crt` plus the same CA mount as the workers and the control plane. The base staging manifest is untouched; a test asserts that.
2. **A static invariant.** `checkGrantRedeemersReachPresignStore`, inside `evaluateShippedBootOverlayInvariants`, checks that every grant-redeeming service (`GRANT_REDEEMING_SERVICES`, the adapter-manager):
   - shares a network with the presign store;
   - trusts the store's CA through a mounted `NODE_EXTRA_CA_CERTS`, and that CA is the same one the signing control plane trusts.

   It runs statically in `policy` and again on the lane's real render. Run against the unfixed overlay it reports exactly the two defects of run `35601445269`. Positive controls:
   - dropping the network reds it;
   - dropping the CA env reds it;
   - dropping the mount reds it;
   - a different CA reds it;
   - replicas that disagree on the store red it.

   In mutation testing, disabling either arm, or unwiring the check, kills two to six cases.
3. **A keyless runtime probe.** The new phase `probe-presign`, in the workflow step "Probe the presign store from the adapter-manager's seat" before "Run the journey", is a throwaway `docker compose run --no-deps --entrypoint node` of the **adapter-manager service**. It gets the service's networks, env and mounts, but the bin never starts, so no E2B call is possible. It sends an HTTPS `HEAD` to the presign endpoint. Local rehearsal on Docker Desktop:
   - the fixed overlay gives `PRESIGN_PROBE_OK status=200`;
   - **positive control A**, the adapter-manager without `store-egress-net`, gives `PRESIGN_PROBE_FAIL … codes=ENOTFOUND`;
   - **positive control B**, the adapter-manager without `NODE_EXTRA_CA_CERTS`, gives `PRESIGN_PROBE_FAIL … codes=DEPTH_ZERO_SELF_SIGNED_CERT`.
4. **E6-F024, filed and resolved.** A provider-op failure is now classified, logged and relayed from a closed vocabulary. Neither the log nor the wire carries the URL, host, grant or key. See E6 `findings.md`.

---

## 10. Addendum, 2026-09-21: corrections after the distinct review

Independent review attempt 1 (above) requested changes to this record. The sections above are left exactly as written; this addendum makes the required changes (a)–(c).

- **Reviewed revision.** The header names `1ec5533b5b2c80cf2bcbd7e228efa4d11c7b3662`, but that commit predates the E6-D001 code: the registration-only push, the dispatch-only job gate and the matching shape guard. The revision that contains it is **`dbe6f5da2a9316ac3f9762294d87991d7ec6f885`**, the final head of PR #554, which merged as `947b684d8a5bf1fcdacb20c5ff077668db54c517`. It is the reviewed revision. `1ec5533b5…` is kept as superseded.
- **CI run.** §4 cites PR run `35591595055` as the green `policy` evidence. That run is on `c31dccf87` and concluded **`cancelled`**: `e2e` and `verify (4)` were cancelled. It covers neither the code nor the final head. The run that covers the reviewed revision is **`35596651522`** (`pull_request` on `dbe6f5da2`, conclusion `success`). Its jobs `policy`, `verify (1–4)`, `e2e`, `migrations` and `ci-required` (`106327999223`) all concluded `success`. The `policy` job **`106322893461`** executed the DEP-015 step, which printed:
  - `OK: docker/m1-boot/docker-compose.m1-boot.yml satisfies the DEP-015 shipped-boot contract`;
  - `check-staging-manifest.test.mjs` **49/49**;
  - `OK: .github/workflows/m1-shipped-boot.yml is the F3 shipped CI boot: runs only on dispatch (push = registration only, E6-D001), …`;
  - shape + lib **53/53** (27 + 26).

  The cancelled run's `policy` log shows the pre-E6-D001 guard (46 tests).
- **Registration run (E6-D001).** Merging #554 pushed the workflow file to `docs/replatform-program` and fired the registration-only trigger. That run is **`35598343418`** (`push` on `947b684d8`, run conclusion `skipped`): its only job, `shipped-boot` **`106328314759`**, concluded **`skipped` with 0 steps**. This is the post-merge citation §8 promised: nothing ran and no secret was read.
- **Keyless rehearsal on CI.** Run **`35600507289`** (`workflow_dispatch`, candidate `fc2eb7dde`) concluded **`success`**, with job `shipped-boot` **`106335219133`** = `success` over 28 steps. It is the Linux-runner counterpart of §3's local rehearsal, at a candidate that contains the E6-D001 code. Its logs show:
  - the keypair generated in the job, and `✓ CP↔AM keypair smoke: PASS`;
  - both replicas healthy;
  - three Organizations seeded, each with a distinct id;
  - `assert-tenants` holding exactly {A, B} canary, with the control absent and crew + tool surface OFF;
  - three workers enrolled, each on its own Organization's target, and the adapter-manager **not** started;
  - the control dispatch passed, with `owner=null`;
  - 17 evidence files uploaded (`m1-shipped-boot-keyless-35600507289`);
  - `teardown` reported "keys dir gone".
- **First keyed run.** Run **`35601445269`** (`workflow_dispatch`, `mode=keyed`, candidate `fc2eb7dde`) concluded **`failure`**. Every step through "Reconcile and preflight every Organization" passed. The failing step was "Run the journey", for both enabled tenants; the control tenant correctly stayed legacy.
  - **Root cause:** the E2B provider redeems grants inside the adapter-manager (`fetchGrantBytes`). In the m1-boot overlay the adapter-manager had neither the presign store's network (`store-egress-net`) nor its CA.
  - **The fix:** the DEP-015 follow-up PR (§9), which covers the overlay, the GRANT-REACH/TRUST invariant, the keyless `probe-presign` phase and E6-F024.
  - **The keyed acceptance therefore remains PENDING.** It needs a keyed re-run after that PR merges.
- **Ruled in under F2 after this review: a hard pre-upload leak scan.** The lane now has a `leak-scan` phase: the step "Scan the evidence for job secrets (fails the run on any match)", placed after collect and before upload. The upload is gated `if: always() && steps.leak-scan.outcome == 'success'`, and the shape guard enforces both the step and the gate.
  - **What it does.** Every job secret (26 named secrets in a full keyless run) is searched for in every evidence file, in raw, base64 and base64url form. A match fails the run and deletes the bundle. The report names the file and the secret NAME, never the value.
  - **Positive controls.** A planted canary turns the pure check red and turns the phase run end to end red (exit 1, the file and name reported, no value printed, the bundle deleted). Base64 and base64url plantings are found. Mutations that disable the scan, drop the encoded forms or ungate the upload are each killed.
  - **A real bundle stays green.** Over the 13 files of a local keyless bundle it reported `clean`.

---

## 11. Addendum, 2026-09-21: keyed re-run 35613849443 — the mechanism is corroborated; the lane failed on a driver defect

The planning session dispatched keyed run **`35613849443`** on candidate `d0f065b13`, after the
§9 follow-up (#561) merged. It got through every phase the first keyed run failed at.

**What the run showed:**
- **Both enabled tenants reached `verifierExit=0`**, so `verify-e7-1-distributed-run` corroborated the mechanism.
  - Tenant a: run `599e1fd6-86c0-4656-b91a-816598cee0f4`, attempt `a7450882-b475-4c98-ad42-b824313b046b`.
  - Tenant b: run `4e36f912-3da4-4bef-8a29-588e091d4016`, attempt `4fde4236-e1c3-4ec0-9b8a-71175b6394e1`.
- **The control tenant passed, on the legacy path.** Run `04c09414-4d63-40d7-9cad-46192643fedc`.
- **Real provider-sandbox evidence is in the retained worker logs.** Each enabled tenant's worker logged exactly one `supervisor: run complete` line, with `cleanupStatus: "success"`, naming a real E2B sandbox on that tenant's own lease:
  - `logs-m1-worker-a.txt`: `sandboxId: "ir2yj6bc4zh81x258k47b"`, lease `84b237c8-0228-427c-8bf4-08e68e7e04f8`. That lease was acked on `control-plane`, the replica worker A talks to.
  - `logs-m1-worker-b.txt`: `sandboxId: "i1pbzfz6n7y4wb3q5k616"`, lease `2d3d4984-cb59-43ef-bb5b-22e1db4282a6`. That lease was acked on `control-plane-b`.
  - `logs-m1-worker-c.txt`: no sandbox line. The control never leased.

**The lane still failed, and on its own driver's check.** The check reported "no worker log line names a provider sandbox for this tenant", for a and b.

**The defect.** `dispatch` in `scripts/m1-shipped-boot/journey.mjs` filtered worker log lines with `/sandboxId=/`. The worker logs pino JSON (`"sandboxId":"…"`), so that filter could never match a real line. This was a driver bug, not a product failure: the evidence the check wanted was present.

**The fix, in the follow-up PR:**
- **`parseSandboxLogLine`** (`scripts/lib/m1-shipped-boot.mjs`) reads the JSON record through the compose prefix and timestamp. It still accepts a `sandboxId=` text form, in case a logger emits one.
- **`E2B_SANDBOX_ID_SHAPE`, `/^[a-z0-9]{16,32}$/`.** An id counts only if it matches.
  - **Measured at source.** The e2b SDK passes the server's `sandboxID` through opaquely, then embeds it in the DNS label `${port}-${sandboxId}.${domain}`. The two observed ids are 21 characters of `[a-z0-9]`.
  - **Every test double's id has a hyphen, so none can match.** The D1 fake provider's is `${providerId}-res-${n}`, and the mock transport's is `sbx-000001`. A fake provider can therefore never satisfy §11.
- **`extractSandboxEvidence` scopes each id to THIS run.** If a line carries a `leaseId`, it must be one of the run attempt's leases (`leases.attempt_id`). The worker's line does carry one, as measured above. A line without a lease id is scoped by the worker alone: one worker per tenant, on that tenant's own target.
- **Tests** (`scripts/lib/__tests__/m1-shipped-boot.test.mjs`):
  - A redacted minimal replay of this run's three worker logs gives 1 id for a, 1 for b and 0 for c.
  - The original filter finds 0 in the same logs, which pins the defect.
  - The fake-provider and mock-transport ids are rejected on shape.
  - A line with no `sandboxId` does not count.
  - B's real sandbox line replayed against A's leases is rejected as a foreign lease.
- **Mutations:** disabling the shape check, the lease check or the JSON parse each kills at least one case.
- **Polled, not one-shot** (Codex on PR #563, verified at source). The worker emits `terminal` before it destroys the sandbox (`supervisor.ts`: `events.terminal` then `finishRun`), and the lease-and-sandbox line is logged only after `destroy` returns. The worker log is therefore re-read every 5 s, up to 180 s, until the attempt-bound record appears. `providerEvidence.polls` records how many reads it took.

**The keyed acceptance remains PENDING.** It needs one keyed re-run in which the lane's own verdict is green. From this run's evidence, the only thing that stood between it and green was the driver defect.
