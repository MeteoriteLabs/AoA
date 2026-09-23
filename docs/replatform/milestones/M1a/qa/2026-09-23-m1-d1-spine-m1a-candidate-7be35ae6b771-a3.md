# QA Result — `M1-D1-SPINE`, M1a candidate, `7be35ae6b771`, attempt 3

**Date (UTC):** `2026-09-23`
**Milestone:** `M1a`
**Record path:** `docs/replatform/milestones/M1a/qa/2026-09-23-m1-d1-spine-m1a-candidate-7be35ae6b771-a3.md`
**Scope slug:** `m1a-candidate`
**Revision:** `7be35ae6b7719877e61f54ab552de84de8491e7d`
**Attempt:** `3`
**Supersedes:** `docs/replatform/milestones/M1a/qa/2026-09-24-m1-d1-spine-m1a-candidate-7be35ae6b771-a2.md`
**Lane:** `M1-D1-SPINE`
**Result:** `fail`
**Failure class:** `harness`
**Campaign start (UTC):** `2026-09-23T20:05:00Z`
**Campaign end (UTC):** `2026-09-23T20:11:00Z`

> This file is immutable from its first commit. A correction, rerun, changed decision, or changed
> revision creates a higher attempt and links this path through `Supersedes`.

**Author:** the `M1a` QA owner — a review session **distinct** from the planning session that took
the M1 decisions and dispatched the runs (founder ruling **F2**). This session dispatched no
workflow and wrote no milestone handoff.

---

---

## 0.0 Why attempt 3 exists, and the accepted debt it cannot repair

Two P2 findings from the Codex review of PR #586 on `f30a0c6a85`, both confirmed at source.

**(1) The UTC date in `a1` and `a2` is wrong.** `artifact-policy.md:115` requires the filename's
date segment to be the **UTC** date. Measured: `TZ=UTC git log -2 --format='%H %cd' --date=iso-local`
returns `f30a0c6a857e345b52370502a21ef133b6a671df 2026-09-23 22:21:12 +0000` and
`3f00c2be118e1c2e94bf0d15ba7b7c2965fb499b 2026-09-23 22:04:53 +0000`. The authoring session's clock
is `+05:30`, so its "2026-09-24" was **2026-09-23 UTC**. Both campaigns also ran on 2026-09-23 UTC
(`20:05`–`20:11` and `21:12`–`21:18`). This attempt uses **`2026-09-23`** in its filename and in
`Date (UTC)`.

★★★ **ACCEPTED DEBT, recorded rather than repaired.** `a1` and `a2` are already committed and are
**immutable**. `qa-handoff-recovery.md` §4 is explicit: where the breach is *"a contract violation
that cannot be repaired without touching an immutable file (a malformed filename …), record it as
accepted debt with its reason — do not rename or edit."* So the four records

- `2026-09-24-m1-d1-spine-m1a-candidate-7be35ae6b771-a1.md`
- `2026-09-24-m1-d1-spine-m1a-candidate-7be35ae6b771-a2.md`
- `2026-09-24-m1a-d2-mechanism-m1a-candidate-7be35ae6b771-a1.md`
- `2026-09-24-m1a-d2-mechanism-m1a-candidate-7be35ae6b771-a2.md`

**keep their non-conforming date segment**, and are hereby added to the debt class that
`qa-handoff-recovery.md`'s amendment banner enumerates. **None of them may be cited as
exact-date evidence without stating this defect.** Their `Supersedes` chain is intact and their
content stands as recorded; only the date token is wrong.

**(2) The `a2` command table was not literally reproducible.** It used ellipses (`node -e "…"`),
prose (`read …`), collective descriptions ("the 38 pure-node guards") and, for shell loops, a
`0`/`1` pair rather than the loop's single exit status. The template requires the **exact** command,
exit code, duration and result summary, so that the record survives its CI artifacts. §3 below is
rewritten with literal, copy-pasteable commands and single exit statuses.

**Nothing else changed.** Every measurement, assertion, clause judgement and the `Result` are
carried forward from `a2` unaltered.

## 0.1 The substantive corrections this chain made (`a1` → `a2`), carried forward unchanged

`a1` recorded `Result: pass`. **It was wrong, in two independent ways** — found in `a2`, restated here because a record must stand alone —, both raised by the Codex
review of PR #586 on commit `3f00c2be11` and both confirmed by me at source before acting. `a1` is
immutable and is not edited; this attempt supersedes it.

**Correction 1 — I repeated a `pending` reason that is FALSE for the lane being certified.**
`a1` §5 item 2 said the three `pending` cases were structurally unavailable on D1 and stated *"I
verified the structural reason at source: `AOA_WORKER_DISPATCH_ENABLED` is declared ABSENT for both
D1 workers (`scripts/lib/d1-dispatch-declared.mjs`), so a D1 worker holds no lease to reconcile."*
**I verified it against the base compose file, which is not the file this campaign boots.** Measured
now:

- `docker/d1/m1-spine.override.yml:137` sets **`AOA_WORKER_DISPATCH_ENABLED: "1"`** on `worker-b`,
  together with `AOA_WORKER_EVENT_OUTBOX_PATH`, `AOA_WORKER_ENV_PROBE: "1"` and
  `AOA_WORKER_PROVIDER_URL`, and overrides its command to
  `node /worker-net-app/dist/bin/networked-host.js` (the `DEP-019` networked container boot root).
- **Both certified jobs boot that override.** `.github/workflows/d1-merge-train.yml` sets
  `SPINE_OVERRIDE_PATH: docker/d1/m1-spine.override.yml` for `m1-spine` (:419) and for
  `m1-fault-matrix` (:678), and each brings the stack up with
  `docker compose -f "$COMPOSE_FILE_PATH" -f "$SPINE_OVERRIDE_PATH" up -d`.
- The `m1-spine` job then **asserts** the daemon composed dispatch: :483 greps `worker-b`'s logs for
  `dispatch COMPOSED` and fails the job otherwise.
- `DEP-019` makes that deployed worker the **executor** (`executor: "worker"` in every profile
  bundle, with a red control if it is not).
- `scripts/lib/d1-dispatch-declared.mjs` takes *"parsed compose env, per service"* for **one** file;
  the declaration it enforces is about the base compose. The guard is not wrong — **my reading of
  its scope was.**

So a lease-holding daemon **does** exist on this lane, its lease-candidate store is **not** empty,
and `d1.reconcile.worker_startup_lease_probe` and `d1.provider.worker_terminal_mapping` are **not
structurally unavailable here**. They could have run. They did not, and — see §8 — their named
destination lane ran none of its own cases either. This is the programme's own
records-disagreeing-with-code class, committed by the QA record that was supposed to catch it.

**Correction 2 — the record omits a campaign element the gate's own plan requires of it.**
`docs/replatform/qa/2026-09-21-m1-execution-plan.md` §6 requires, on the frozen candidate, *"a
`M1-D1-SPINE` record (`DEP-016` profile **as made worker-driven by `DEP-019`**), including the
**rollback rehearsal via the `MIG-009` CLI**, attributed to the rollback owner (criterion 6)."* The
rehearsal is not part of run `35912752449` and is not recorded in `a1` — `a1` §10 said so plainly
and still reported `pass`. A QA record is immutable, so a later handoff cannot add the rehearsal to
it. **A record that concedes a required campaign element is missing cannot carry `Result: pass`.**

**What did not change.** Every assertion in `a1` §4 that I marked `pass` was re-checked and still
holds; §4 below carries them forward unaltered in substance. This attempt does not retract a single
measurement. It corrects one false justification and one missing requirement, and the verdict that
followed from them.

*(Third, minor, corrected here rather than left standing: `a1` §3 said the `gh run download`
produced "40 files". The correct count is **41**.)*

---

## 1. Candidate, and the revision the evidence was produced on

Unchanged from `a1` §1, which is pinned above and remains accurate. In summary:

| | |
|---|---|
| **Frozen candidate** | `7be35ae6b7719877e61f54ab552de84de8491e7d` |
| **Revision the cited run executed** | `8c01f4e94f8e25d7abaf524e8b266b809c67b8cb` |
| **Delta** | one file: `docs/replatform/epics/E6-deployment-test-harness/tickets/DEP-017-result.md`, +120/−0; no root-level file changed |

**Subtree hashes, re-measured with `git rev-parse <rev>:<dir>` at both revisions** (`8c01f4e94` /
`7be35ae6b`):

| Subtree | Hash at both revisions | |
|---|---|---|
| `server` | `0f3beb68836583f6e994c93a1cbb4d12633cad51` | identical |
| `packages` | `e0c74fc0070eea339d7d21d9fbac16416ea9f51f` | identical |
| `ui` | `d21b1b7a26588abd949667fbc70d59a5bb4ba69c` | identical |
| `scripts` | `5b37e11ebac822ab9e1d0828c0c4a3124ca85f20` | identical |
| `.github` | `9a9cf9a424217e829164bfd41558b7f4aaf91194` | identical |
| `docker` | `e765f70c1043ebd9037f72d181e2258ad1bc70bf` | identical |
| `tests` | `bfb4fba5a0e7637a7082489cb7096f5c3296fac2` | identical |
| `e2b` | `bea90c8907042093a0b52cfca07daac63de9bac6` | identical |
| `cli` | `0dd693e752e04eb7513be6628cabae683d592ba3` | identical |
| `docs` | `f76b9677ece0f30c442962120649ae9857b69d8a` → `797b608af3e04d4da355e7c49101b4af5aedfcd8` | **differs** (the one file) |

### 1.1 The tree-equivalence judgement — unchanged, and still mine

**A run on `8c01f4e94` would satisfy this gate for the candidate `7be35ae6b`.** The reason is a
written rule, not a stretched precedent: `epic-regrooming/qa-handoff-recovery.md` §1 permits
*"documentation-only disposition commits [to] follow an independently reviewed implementation
revision"* provided *"the QA record must state both and prove the candidate code is byte-identical
where it carries evidence forward."* The table above is that proof: every directory that can change
what the lane builds, boots or asserts is byte-identical, so the lane's behaviour at `8c01f4e94`
**is** its behaviour at the candidate. The E2 `a6` handoff's byte-identical carry-forward is a
consistent precedent but is not what this rests on.

**Its limits, so it cannot be widened:** it holds because the delta is doc-only **and** measured
subtree by subtree. It would not hold for a one-line source change. **And it is not the reason this
attempt fails** — the failure is §0, and would be identical had the run been on the candidate
exactly.

---

## 2. Topology and environment

| Field | Value |
|---|---|
| Lane | `.github/workflows/d1-merge-train.yml`, run **`35912752449`**, event `push` |
| Jobs consumed | **`d1-merge-train`** (17 steps: 15 `success`, 2 `skipped`), **`m1-spine`** (19/19 `success`), **`m1-fault-matrix`** (18/18 `success`) |
| Compose | `docker-compose.d1.yml` **plus `docker/d1/m1-spine.override.yml`** on both `m1-spine` and `m1-fault-matrix` (★ the fact `a1` missed) |
| Profiles | `m1-spine` (`DEP-016`, worker-driven by `DEP-019`) and the `M1-D1-SPINE` fault matrix (`DEP-018`) |
| Control planes | 1 (`control-plane`) |
| Worker | **1 separately deployed worker** (`worker-b`), boot root `networked-host.js`, **dispatch enabled**, durable event outbox, env probe armed; `executor: "worker"` in every profile bundle |
| Provider | reference/fake provider (`packages/sandbox-fake-provider`) — **not E2B** |
| Database / object store / fault injector | PostgreSQL, MinIO, Toxiproxy |
| Images | built in-job by `docker/images/build.sh`; SBOM, provenance and `trust-root.pub.pem` retained in artifact `d1-image-chain-35912752449` |
| Tenants (**F10**) | 3 Organizations: enabled `0d016a00-0000-4000-8000-00000000000a` and `0d016b00-0000-4000-8000-00000000000b`; control `0d016c00-0000-4000-8000-00000000000c` |
| Rollout digest | `rolloutSha256 02cebb95542abbd49ff4b646d8ee1dc730ce584e49d6287c08b04f1160a9012f`; `resolved` = `canary / canary / off` |
| Crew switch | `crewRaw: null`, `crewEnabled: false` |
| Tool surface | `toolSurfaceRaw: null`, `toolSurfaceArmed: false`, `organizationToolSurface` **false for all three** |

> ★ **`E6-F023` discipline applied.** The run's own conclusion was not relied on. Per-step
> conclusions were read from the jobs API, and every assertion below comes from the **downloaded
> evidence artifacts**.

---

## 3. Commands

Literal and copy-pasteable, run from a checkout of the candidate
`7be35ae6b7719877e61f54ab552de84de8491e7d`. Exit codes are the single status of the command as
written. **No workflow was dispatched.**

| Command | Exit | Duration | Result summary |
|---|---:|---:|---|
| `gh run view 35912752449 --json databaseId,headSha,conclusion,status,displayTitle,workflowName,event,jobs --jq '{id:.databaseId,sha:.headSha,c:.conclusion,w:.workflowName,e:.event,jobs:[.jobs[]\|{name,conclusion,steps:([.steps[]\|.conclusion]\|group_by(.)\|map({(.[0]):length})\|add)}]}'` | `0` | 3 s | `sha 8c01f4e94f8e25d7abaf524e8b266b809c67b8cb`, `w "D1 Merge Train"`, `e push`; `d1-merge-train {"skipped":2,"success":15}`, `m1-spine {"success":19}`, `m1-fault-matrix {"success":18}` |
| `gh run download 35912752449 -D /c/m1a-evid/spine` | `0` | 21 s | artifacts written |
| `find /c/m1a-evid/spine -type f \| wc -l` | `0` | <1 s | `41` |
| `git diff --stat 8c01f4e94f8e25d7abaf524e8b266b809c67b8cb 7be35ae6b7719877e61f54ab552de84de8491e7d` | `0` | <1 s | ` .../tickets/DEP-017-result.md \| 120 +++++++++` / `1 file changed, 120 insertions(+)` |
| `for d in server packages ui scripts .github docker tests e2b cli docs; do a=$(git rev-parse 8c01f4e94:$d); b=$(git rev-parse 7be35ae6b:$d); echo "$d $a $b"; done` | `0` | <1 s | nine pairs equal; `docs` = `f76b9677ece0f30c442962120649ae9857b69d8a` vs `797b608af3e04d4da355e7c49101b4af5aedfcd8` (§1) |
| `git diff --name-only 8c01f4e94 7be35ae6b \| grep -v /` | `1` | <1 s | no output — no root-level file changed (exit 1 is `grep`'s no-match) |
| `node scripts/check-campaign-fault-matrix.mjs` | `0` | 1 s | `OK: tests/d1/fault-matrix.json declares 3 gate profile(s) and 74 case(s) (25 required, 49 pending) …` |
| `node -e "const m=JSON.parse(require('fs').readFileSync('tests/d1/fault-matrix.json','utf8')); for (const p of m.profiles) console.log(p.profile, p.cases.length, p.cases.filter(c=>c.evidence==='pending').length);"` | `0` | <1 s | `M1-D1-SPINE 28 3`; `M1a-D2-MECHANISM 23 23`; `M1-D2-CODING 23 23` |
| `grep -n AOA_WORKER_DISPATCH_ENABLED docker/d1/*.yml docker-compose.d1.yml` | `0` | <1 s | **one setting hit: `docker/d1/m1-spine.override.yml:137:      AOA_WORKER_DISPATCH_ENABLED: "1"`** — the §0 correction |
| `grep -n 'SPINE_OVERRIDE_PATH\|dispatch COMPOSED' .github/workflows/d1-merge-train.yml` | `0` | <1 s | `:419` and `:678` bind the override; `:483` asserts `dispatch COMPOSED` in `worker-b`'s log |
| `node -e "import('./scripts/check-gate-clause-wiring.mjs').then(async m=>{for (const s of ['createDistributedExecutionDrain','createFenceAwareEgressProxy','jobBudgetCostBridge','createStartupReconciler']) console.log(s, (await m.countProductionCallers(process.cwd(), s)).count);})"` | `0` | 6 s | `createDistributedExecutionDrain 1`, `createFenceAwareEgressProxy 0`, `jobBudgetCostBridge 1`, `createStartupReconciler 1` |
| `node scripts/check-gate-clause-wiring.mjs` | `0` | 2 s | `OK (28 wired clause(s), 6 declared dormant, 2 provider-capability claim(s) matched to source)`; dormant list includes `E3-15-budget` and `E5-6-denied-egress` |
| `fail=0; for g in $(grep -oE "node scripts/check-[a-z0-9-]+\.mjs" .github/workflows/pr.yml \| sort -u \| awk '{print $2}'); do case "$g" in *browser-suite-executed*\|*embedded-secrets*\|*schema-migration-drift*\|*worker-protocol-package*\|*verdict-consumer-freshness*\|*evidence-immutability*) continue;; esac; node "$g" >/dev/null 2>&1 \|\| { echo "FAIL $g"; fail=$((fail+1)); }; done; echo "failures: $fail"` | `0` | 3 min | `failures: 0` |
| `node scripts/check-evidence-immutability.mjs --base origin/docs/replatform-program` | `0` | 4 s | `Evidence-ledger immutability OK: 33 base records … all present and byte-identical in the candidate` |
| `TZ=UTC git log -2 --format='%H %cd' --date=iso-local` | `0` | <1 s | `f30a0c6a857e345b52370502a21ef133b6a671df 2026-09-23 22:21:12 +0000` — the §0.0 date correction |

**Evidence files read in full** (under `/c/m1a-evid/spine/`):
`m1-spine-evidence-35912752449/passing/manifest.json`,
`m1-spine-evidence-35912752449/post-controls/manifest.json`,
`m1-spine-evidence-35912752449/positive-control/m1-spine-evidence.json`,
`m1-spine-evidence-35912752449/duplicate-usage-control/m1-spine-evidence.json`,
`m1-fault-matrix-evidence-35912752449/profile/m1-fault-matrix-evidence.json`,
`m1-fault-matrix-evidence-35912752449/suppressed-control/m1-fault-matrix-evidence.json`.

---

## 4. Assertions and evidence

Every row here was re-checked for this attempt. **Nothing that passed in `a1` is retracted.**

| ID | Class | Required | Observed | Result |
|---|---|---|---|---|
| `SPINE-TOPO-1` | REQUIRED | one control plane, one **separately deployed** worker, external PG, object store, reference provider | as required; `executor: "worker"`, with the red control *"with the deployed worker NOT the executor, the claim MUST NOT stand"*; `dispatch COMPOSED` asserted in `worker-b`'s log | `pass` |
| `SPINE-F10-1` | REQUIRED | ≥2 enabled Organizations + 1 control, from the rollout digest | 2 + 1; `resolved` `canary/canary/off` | `pass` |
| `SPINE-F10-2` | REQUIRED | per-tenant journey correctness for each enabled tenant | `d1.tenant.journey.A`/`.B`: `attemptStatus succeeded`, `acceptedThroughSeq 3`, `violations: []` | `pass` |
| `SPINE-F10-3` | REQUIRED | cross-tenant denial on lease, read, cancel, events, secrets, staged inputs, outputs, cost rows, tool calls, each with a same-tenant positive control | all nine `denied_with_same_tenant_positive_control`, `positiveControlPassed: true`. Pairs: events `401 unauthorized` / `200 accepted`, hostile ack `409 stale_fence`; lease `409` / `200 renewed`; staged inputs `409` / `200 upload_granted`; outputs `409` / `200 committed`; cancel `not_found` / `queued` with a fenced command; read `0` / `1` | `pass`, **with the §5.5 secrets caveat** |
| `SPINE-F10-4` | REQUIRED | the four RLS-less legacy tables filtered, with an anti-vacuity foreign row | `cost_events`, `activity_log`, `task_outputs`, `provider_credentials`: each `filtered_by_query_predicate_not_rls`, `positiveControlPassed: true`, **`antiVacuityObservedForeignRow: true`**; own/foreign = 1/0, 2/0, 1/0 (planted id `2e08f22f-…`), 1/0 | `pass` |
| `SPINE-F10-5` | REQUIRED | the control Organization is refused | `d1.tenant.control_refused` → `legacy_for_organization_disabled`; rollout `off` | `pass` |
| `SPINE-COST-1` | REQUIRED | exactly one `cost_events` row with cost > 0 per enabled tenant | `costRows: 1` on both; `ownCents: 83`, `foreign: 0` | `pass` |
| `SPINE-COST-2` | REQUIRED | a suppressed-usage positive control must red | step passed; `positive-control/`, `usageMode: "suppressed"`, `providerUsage: null`, `usageEvents: []`, `costRows: []` | `pass` |
| `SPINE-COST-3` | REQUIRED | a duplicate usage event must red | step passed; `duplicate-usage-control/`, `usageMode: "duplicate"`, `providerUsage 120000/30000` | `pass` |
| `SPINE-AUDIT-1` | REQUIRED | operator-visible audit parity | both journeys `activity: ["job.attempt_started","job.attempt_terminal"]`; applied `activity_audit` receipts with `sourceIdentity activity:<companyId>:<eventId>` | `pass` |
| `SPINE-FENCE-1` | REQUIRED | lifecycle / fence behaviour | `d1.cancel.unleased_attempt` → `cancelled_directly_without_command`; `d1.cancel.leased_attempt` → `cancel_requested_with_fenced_command` | `pass` |
| `SPINE-CLEAN-1` | REQUIRED | cleanup / recovery | truncated upload → `fenced_commit_refuses_unverifiable_object`; orphan → `uncommitted_object_deleted`; expired lease → `single_winner_retry_minted`; CP restart → `durable_lease_state_survives_restart`; both link cuts fired | `pass` **for the cases that ran**, narrowed by §5 |
| `SPINE-MATRIX-1` | REQUIRED | every **required** declared case fires | `summary`: `declared 28, required 25, pending 3, fired 25`, `complete: false` | `pass` **as to the 25**; see `SPINE-MATRIX-3` |
| `SPINE-MATRIX-2` | REQUIRED | a suppress-every-injection control reds | step passed; suppressed arm `fired 16` vs `25` | `pass`, narrowed by §5.3 |
| ★ `SPINE-MATRIX-3` | REQUIRED | a case may be `pending` only for a reason true of the certified lane | **FALSE for two of the three.** `d1.reconcile.worker_startup_lease_probe` and `d1.provider.worker_terminal_mapping` are declared unavailable because the D1 workers do not dispatch; **this lane's worker does** (§0). They are unrun without a valid reason | **`fail`** |
| ★ `SPINE-ROLLBACK-1` | REQUIRED | the record includes the `MIG-009` CLI rollback rehearsal, attributed to the rollback owner (M1 plan §6; criterion 6) | **absent.** No rehearsal is in run `35912752449` and none is recorded here | **`fail`** |
| `SPINE-FLAGS-1` | REQUIRED | crew off, tool surface off, no excluded flag on | `crewEnabled false`; `toolSurfaceArmed false`; `organizationToolSurface` false ×3 | `pass` |
| `H-06` | HARD | metadata / private / worker-control / control-plane denied, incl. direct-IP, redirect, DNS-rebinding | **not exercised on this lane and NOT PASSED** — §7 | **`recorded`, not `pass`** |
| `EVID` | REQUIRED | evidence retained **on pass** | `passing/` collected before any control mutated the stack, plus `post-controls/` | `pass` |

---

## 5. Failures, and what this record does NOT establish

**The two REQUIRED failures are `SPINE-MATRIX-3` and `SPINE-ROLLBACK-1`.** Both are class
**`harness`** — the lane does not exercise what the gate asks of it, and the campaign omits a
required element. **Nothing in the product misbehaved**, and no measurement in §4 was contradicted.
`blocked_external` does not apply: the campaign started and completed with every dependency
available (`qa-handoff-recovery.md` §5).

1. **Two cases unrun without a valid reason** — `SPINE-MATRIX-3`, §0. The consequence is concrete:
   **`WRK-013`'s deployed-boot restart behaviour and the deployed worker's terminal mapping are
   certified by no campaign at all.** `WRK-013`'s evidence remains
   `startup-reconcile-composed.component.test.ts`, an in-process component test against a
   control-plane double.
2. **No rollback rehearsal** — `SPINE-ROLLBACK-1`. `MIG-009` did wire the trigger
   (`runDistributedExecutionDrainTrigger` is `createDistributedExecutionDrain`'s first production
   caller; `E10-1-drain` is `wired`; the operator entrypoint is
   `pnpm drain:distributed-execution --operator <who>`), so the mechanism exists — **it was simply
   never rehearsed on this candidate, by anyone.**
3. **The third `pending` case remains genuinely structural.**
   `d1.credential.production_reader_company_predicate` is routed by `E6-D003` to
   `d2m.credential.production_reader_company_predicate`, and its reason — that
   `failClosedDeviceLocalBroker` is the only implementation in the tree, so an admitted read and a
   denied one are indistinguishable on D1 — is true of this lane. It is still **uncertified**,
   because its destination ran nothing (§8).
4. **No real provider.** Every assertion is on the reference provider. Nothing here is evidence
   about E2B create, execute, teardown, or a real charge.
5. **The suppression control does not cover the 16 tenant cases.** In the `suppressInjection: true`
   arm every `d1.tenant.*` case still reports `injectionFired: true` (16 of 25); the control
   discriminates only the 9 non-tenant fault cases. The tenant cases carry same-tenant positive
   controls, which is a different and adequate control — but it is not the suppression arm.
6. **Three fault cases report the identical `observedClassification` in both arms** —
   `d1.fault.link_cut.worker_to_control_plane`, `d1.fault.link_cut.control_plane_to_postgres` and
   `d1.restart.control_plane_process`. Only `injectionFired` differs, so for those three the
   observed outcome is not caused by the injection.
7. **The cross-tenant secrets case is half-uncontrolled by its own admission**:
   *"the fenced route collapses every refusal to denied/malformed by design and this lane's fixture
   handle is unresolvable, so owner and attacker are indistinguishable here and the arm carries no
   control."* The classified denial is the RLS row read; the route arm is recorded, not certified,
   and its named successor `d2m.tenant.cross.secrets` is `pending`.
8. **This is not `D1`.** `D1-00` requires at least two workers; this lane deploys one. It cannot
   complete `E6` and is **non-promoting**.
9. **Nothing about tools or output.** The tool surface is off by design (`M1a` exempts `tools` +
   `output`). `task_outputs` appears only as a legacy-table isolation surface.
10. **`E3-15-budget` remains `unwired`** at the candidate, deliberately: its register reason says the
    D1 units are canned by the reference provider and promotion waits on the `WRK-018` keyed
    acceptance. `SPINE-COST-1` is a pass of the **spine profile's** assertion, not a promotion of
    that clause. *(That reason cites `cost_cents 81` from the `DEP-016` acceptance run; this run
    measured **83** — different runs, recorded so nobody reconciles them by editing one.)*

---

## 6. Cleanup

Both jobs ran their teardown step (`docker compose … down -v --remove-orphans`), `success`. Evidence
bundles were collected **before** any negative control mutated the stack (`passing/`) and again
afterwards (`post-controls/`), and uploaded on pass. No secrets appear in this record; the ids quoted
are run, job, attempt, lease, command and Organization identifiers, plus one fence token already
present in the public evidence bundle for a disposable fixture attempt.

---

## 7. DE-08 residual, credential taxonomy, and H-06 — required by scope-triage

`scope-triage.md` → *Dormant default-deny egress qualification*: **all three** partial gates must
record the DE-08 residual and the credential-taxonomy mitigation explicitly, and **none** may mark
`H-06` passed. This discharges that for `M1-D1-SPINE`.

- **The DE-08 residual is accepted and unresolved.** The checked-in default-deny / allowlist shape is
  **not** an enforcement claim while the provider path does not enforce it. At the candidate
  `createFenceAwareEgressProxy` (`server/src/services/egress-proxy.ts`) has **zero production
  callers** and `E5-6-denied-egress` is **`unwired`** — re-measured here with
  `countProductionCallers`. **No sandbox-egress-denial claim is made in this record**, and none may
  be derived from it.
- **`H-06` is NOT passed.** It requires metadata, private, worker-control and control-plane
  destinations to remain denied, **including direct-IP, redirect and DNS-rebinding variants**. The
  DE-08 scope decision did **not** amend it. This lane has no sandbox and probes no such
  destination, so it yields **no** H-06 evidence at all; `H-06` is `recorded`, not `pass` (§4).
  ★ The companion `M1a-D2-MECHANISM` record measured metadata as **reachable** from a real sandbox
  (`169.254.169.254`, `reachable: true`, `httpStatus 401`); that belongs to that record and is cited
  here only so no reader infers that silence means denial.
- **The credential-taxonomy mitigation, as it applies here.** The accepted managed-shared model is
  that host, operator, control-plane, cross-tenant and unrelated connector credentials do not enter
  the sandbox, and only the participating Organization's approved runtime credential and scoped data
  are exposed. This lane exercises the **storage-side** half:
  `d1.tenant.legacy.provider_credentials` shows own 1 / foreign 0 with an **observed foreign row**,
  on the non-owner `aoa_app` pool, filtered by query predicate because `provider_credentials` has
  **no RLS**. The **sandbox-side** half — the live env-absence probe over 18 credential classes —
  runs on the mechanism lane only (`DEP-017`, ruling F9) and is **not** evidence this record carries.
- **Consequence.** Full `D1`/`D2` and any `E6` or `E7` completion require live evidence satisfying
  `H-06`, or a separately reviewed and approved amendment to `test-gates.md`. Neither exists.

---

## 8. The cross-record finding

Of the three `M1-D1-SPINE` cases marked `pending`, **all three name the `M1a-D2-MECHANISM` /
`DEP-015` keyed lane as their owner**. Measured at the candidate:

- `tests/d1/fault-matrix.json` declares **23** cases for `M1a-D2-MECHANISM`, and **all 23 carry
  `evidence: "pending"`**.
- `.github/workflows/m1-shipped-boot.yml` has **no fault-matrix step**, and the keyed run's evidence
  artifact contains no fault-matrix bundle (22 files). *Positive control on that measurement: the
  same grep pattern returns a hit for `classifyTenantOutcome` in `scripts/lib/m1-shipped-boot.mjs`
  and 48 hits for `shipped-boot` in the workflow, so the zero is a real zero and not a mistyped
  path.*
- Therefore the keyed run `35920425288` fired **zero** declared cases, and none of the three routed
  spine cases was run at its destination.

Two of those three had no valid reason to be routed at all (§0). The third did. **All three are
uncertified.** See `./2026-09-23-m1a-d2-mechanism-m1a-candidate-7be35ae6b771-a3.md`, which carries
`Result: fail`.

---

## 9. Gate effect

- **Blocks** `M1a` exit criterion 2 and, through criterion 8, the `M1-D1-SPINE` half of the milestone
  on this candidate. Criterion 8 requires a committed `Result: pass` QA record for **each partial
  gate the milestone names**; this attempt is `fail`.
- **Promotes nothing.** `M1-D1-SPINE` is **non-promoting** (scope-triage → *Normative-gate
  boundary*). It is not `D1`, does not change any epic's status, and cannot support an `E3`–`E7`
  completion handoff.
- **Retains, at full strength, everything in §4 marked `pass`.** A future attempt may carry those
  measurements forward on this exact revision. The spine lane works; it is two clauses short.
- **Also unmet on this candidate, and the decision owner's to weigh:** `DEP-015`, `DEP-017` and
  `WRK-018` all carry `Status: gate_review` in their result records at `7be35ae6b`, so exit
  criterion 1 is not met by the tree this record attests. Dispositioning them is a distinct
  reviewer's act, not this QA owner's.

### 9.1 What a passing attempt 4 would need

1. **Run the two wrongly-excused cases** on this lane — `d1.reconcile.worker_startup_lease_probe`
   and `d1.provider.worker_terminal_mapping` — which the override's dispatch-enabled `worker-b`
   makes possible today; **or** re-declare them `pending` with a reason that is true of the lane
   that boots the override, and route them to a lane that will actually run them.
2. **Perform and record the `MIG-009` CLI rollback rehearsal** on this candidate, attributed to the
   named rollback owner.
3. File attempt 4 with `Supersedes` naming this path.

Neither item needs a keyed run or any E2B spend. Both are keyless.
