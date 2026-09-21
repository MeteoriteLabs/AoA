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
