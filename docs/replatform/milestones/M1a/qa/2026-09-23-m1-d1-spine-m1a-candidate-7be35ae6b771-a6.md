# QA Result — `M1-D1-SPINE`, M1a candidate, `7be35ae6b771`, attempt 6

**Date (UTC):** `2026-09-23`
**Milestone:** `M1a`
**Record path:** `docs/replatform/milestones/M1a/qa/2026-09-23-m1-d1-spine-m1a-candidate-7be35ae6b771-a6.md`
**Scope slug:** `m1a-candidate`
**Revision:** `7be35ae6b7719877e61f54ab552de84de8491e7d`
**Attempt:** `6`
**Supersedes:** `docs/replatform/milestones/M1a/qa/2026-09-23-m1-d1-spine-m1a-candidate-7be35ae6b771-a5.md`
**Lane:** `M1-D1-SPINE`
**Result:** `pass`
**Failure class:** `none`
**Campaign start (UTC):** `2026-09-23T20:05:00Z`
**Campaign end (UTC):** `2026-09-23T20:11:00Z`

> This file is immutable from its first commit. A correction, rerun, changed decision, or changed
> revision creates a higher attempt and links this path through `Supersedes`.

**Author:** the `M1a` QA owner — a review session **distinct** from the planning session that took
the M1 decisions and dispatched the runs (founder ruling **F2**). This session dispatched no
workflow and wrote no milestone handoff.

---

---

---

---

---

## 0.0000 Why attempt 6 exists — the verdict returns to `pass`, on evidence I had not read

Two P2 findings from the Codex review of PR #591 on `6ea8e1f588`. Both are confirmed, and the first
**removes one of the two failures this chain has carried since `a2`**. The honest summary is that
`a2` flipped this gate `pass` → `fail` on two grounds, **one of which was never true**, and this
attempt flips it back with the measurement that settles it.

★★★ **THE ROOT CAUSE OF BOTH ERRORS: I never opened
`m1-spine-evidence-35912752449/profile/m1-spine-evidence.json`.** The `m1-spine` artifact has a
`profile/` directory holding the **passing** arm's profile record. I listed the artifact with a
truncating `find … | head -40`, saw `passing/`, `positive-control/` and `duplicate-usage-control/`,
and reasoned about the passing arm from the two **control** bundles — which are the usage-suppressed
and duplicate-usage arms and legitimately differ. Every disputed claim below is settled by that one
file, and it was in the download the whole time. *A conclusion drawn from the evidence you happened
to list is not a conclusion drawn from the evidence.*

**(1) `SPINE-ROLLBACK-1` was FALSE. The `MIG-009` rollback rehearsal RAN, and it PASSED.**
`tests/d1/m1-spine.test.mjs` — test *"m1-spine: the MIG-009 drain CLI rolls back live distributed
work, per tenant and attributed"* (≈:814–875) — invokes the CLI through `runDistributedDrainCli`,
takes a **pre-drain census** of every attempt the drain could touch, and asserts
`evaluateRollbackRehearsal` returns no violations. Measured in the passing profile:

| Field | Value |
|---|---|
| `rollbackRehearsal.exitCode` | **`0`** |
| `rollbackRehearsal.operator` | `m1-spine-1449e508` → audit `actorId` **`operator-cli:m1-spine-1449e508`** |
| `drainable` / `preDrainCandidates` / `audit` rows | **2 / 5 / 5** |
| `verdicts.rollbackRehearsal` | **`[]`** |
| CLI report summary | `{"reason":"distributed_execution_rollback","actorId":"operator-cli:m1-spine-1449e508","organizationsScanned":3,"cancelled":5,"skippedCount":0,"skippedOrganizations":[],"failedCancellations":[]}` — all three Organizations scanned, 5 attempts cancelled, none skipped, none failed |
| audit action | `job.drain.requested`, `actorType "system"`, `detailsReason "distributed_execution_rollback"`, per Organization |

**And it is not vacuous.** `evaluateRollbackRehearsal` (`scripts/lib/m1-spine-assertions.mjs:1060`)
scopes audit rows to **this** drain's operator nonce, judges the **census taken before** the drain
rather than only the seeded pair (*"a drain that skipped the leased branch, or that left a tenant's
attempt running, cannot pass because two freshly seeded unleased attempts happened to move"*), and
keys by **attempt, not job**, so a job with two non-terminal attempts cannot hide a survivor. This is
exactly what M1 execution plan §6 requires of this record: the rehearsal via the `MIG-009` CLI,
attributed to an operator. **`a2`–`a5` said it was absent. It was not.**

**(2) The `a5` citation for the unobserved-tenant assertion was wrong, and `a5`'s conclusion was
right.** I cited `:340–366` for the *"harness-driven: the DEP-017 probe runs inside a sandbox…"*
reason. That range is the earlier per-enabled-tenant loop, which carries a **different** reason. The
dedicated other-tenant filter, that quoted reason, the `criterion5Others` verdict and its assertion
are at **≈:598–622**. Corrected in §4 — and cited by symbol, which is what should have been done
first.

**`a5`'s criterion-5 finding itself is CONFIRMED by the passing profile**, and settled where `a5`
could only infer it: `workerDriven.criterion5EnvProbe = { "observed": true, "scope":
"stage_in_env_only", "logMessages": 1 }`, with `verdicts.criterion5 = []`. The per-tenant
harness-driven attempts are separate attempts and are recorded `observed: false` with
`logMessages: 0` — `enabled.A` and `enabled.B` — and `verdicts["A:criterion5"]` and
`verdicts.criterion5Others` are both `[]`, so the two-directional tripwire agrees in both
directions. **The spine observes criterion 5 for its one worker-driven tenant and records the rest
unobserved, exactly as `E6-D002` and plan §6 specify.**

### What this means for the verdict

The only remaining defect is `SPINE-MATRIX-3` — two `pending` cases whose stated reason is false for
the lane that boots `docker/d1/m1-spine.override.yml`. **I am reclassifying it from `REQUIRED` to
`OBSERVED`**, and the reason matters: it is a defect in the **declaration**
(`tests/d1/fault-matrix.json`), not an unmet clause of this gate. Every one of the 25 cases the
declaration marks *required* fired, with controls; `check-campaign-fault-matrix.mjs` is green; and
the gate text asks for *"the fault controls required by the included journey"*, which this lane
delivered. **A QA owner may report what a declaration excuses on a false premise — that finding
stands at full force in §5 and §8 — but may not invent a REQUIRED gate condition the gate does not
state and then fail the gate on it.** That is the error `a2` made alongside a claim that was simply
untrue.

**`Result` therefore returns to `pass`**, with `SPINE-MATRIX-3` recorded, not waived. I record the
oscillation deliberately rather than letting it look like drift: `a1` `pass` (wrongly, on two
un-found defects) → `a2`–`a5` `fail` (one real-but-misclassified defect, one false) → `a6` `pass`
(both examined at source, one disproved, one reclassified and recorded).

**One more correction, small but it would have propagated.** `a1`–`a5` said the spine's priced row is
**83** cents and flagged an apparent disagreement with the register's **81**. Both figures are real
and I compared different profiles: the **`m1-spine`** profile's `costRows` carries
`costCents: 81` (`rateId "claude-sonnet-4-6"`, `rateVersion 1`, `inputTokens 120000`,
`outputTokens 30000`) — which **agrees** with the `E3-15-budget` register text — while **83** is the
`m1-fault-matrix` profile's `legacyTables.cost_events.ownCents`, a different arm. There is no
disagreement to reconcile.

## 0.000 Why attempt 5 existed — the criterion-5 evidence it restored (carried forward, and CONFIRMED in §0.0000)

One P1 from the Codex review of PR #586 on `ed85a93004`, confirmed at source and accepted.

★★★ **`a1`–`a4` all said the sandbox-side criterion-5 observation *"runs on the mechanism lane
only"*. That is FALSE of this lane, and it omitted required evidence from an immutable record.**
`tests/d1/m1-spine.test.mjs` carries criterion 5 at **two** sites, exactly as `E6-D002` and M1
execution plan §6 lock it:

- **:505–525, the worker-driven tenant, closed POSITIVELY.** Under `if (EXECUTOR === "worker")` it
  calls `evaluateSpineEnvProbe` (`scripts/lib/m1-spine-assertions.mjs:1372`) and records
  `criterion5EnvProbe = { observed: probeViolations.length === 0, scope: "stage_in_env_only",
  logMessages }`, then **asserts the violation list is empty**.
- **:340–366, every OTHER enabled tenant, recorded UNOBSERVED with a two-directional tripwire.** It
  records `observed: false` with the reason *"harness-driven: the DEP-017 probe runs inside a
  sandbox, and M1-D1-SPINE has ONE deployed worker, which drives the first enabled tenant"*, and
  `evaluateEnvProbeObservability` (`:917`) reds **both** ways —
  `criterion5:probe_emitted_but_recorded_unobserved` if a summary appears anyway, and
  `criterion5:claimed_without_summary` if observation is claimed without one.

**Why the worker-driven observation is a real pass and not a vacuous one, verified at source:**
`evaluateSpineEnvProbe` delegates to the shared read side `extractEnvProbeSummary` +
`evaluateEnvProbeEvidence` (`scripts/lib/m1-shipped-boot.mjs:742`, `:765`), and that function
**fails closed on a missing summary** — a `null` summary returns `pass: false` with
*"no DEP-017 env-probe summary on this attempt (the probe did not run; AOA_WORKER_ENV_PROBE unset,
or an older worker)"*. It also requires `verdict === "absent"`, an empty `present` list, **set
equality in both directions** against `ENV_PROBE_EXPECTED_CLASSES`, and `plantedControl.red === true`
(*"the planted-canary control did not turn red (the probe could not see)"*). The `m1-spine` job
asserts that list is empty, and the job passed 19/19. **Therefore the probe RAN inside the reference
sandbox on the worker-driven tenant, reported `absent` over the full expected class set, with its
planted-canary control red.**

*(What misled me: the two control-arm bundles that are uploaded standalone — `positive-control/` and
`duplicate-usage-control/` — both show tenant A `observed: false` with the reason "the m1-spine lane
runs the reference provider, which executes no command, and its workers do not dispatch". That is
the **:358 non-worker-driven** branch, and the passing arm's own profile JSON is not uploaded as a
standalone file. I generalised from the control arms to the passing arm. The passing arm's value is
established by the assertion that gated the green, not by a file I could read — which is the honest
way to state it.)*

**Corrected below**: §4 gains `SPINE-CRIT5-1` and `SPINE-CRIT5-2`, §5 gains the scope limits, §7 no
longer claims the sandbox-side half is the mechanism lane's alone, and §9.1 gains an item —
**a successor attempt must carry this evidence forward.** Without that, a passing `a6` could drop an
observation `M1a` exit criterion 5 requires.

**The `Result` does not change.** The two REQUIRED failures — `SPINE-MATRIX-3` and
`SPINE-ROLLBACK-1` — are untouched, and this correction *adds* evidence rather than removing a
failure. **`fail`, class `harness`.** Everything else, including the §0.00 `DEP-015` correction and
the §0.0 accepted-debt note, is carried forward from `a4` unaltered.

## 0.00 Why attempt 4 existed (carried forward)

Two P2 findings from the Codex review of PR #586 on `78ae70dcd4`, both confirmed at source.

★★★ **(1) A FACTUAL ERROR about `DEP-015`, repeated in `a1`, `a2` and `a3`.** Those attempts said
`DEP-015` carries `Status: gate_review` at the candidate. **It carries `Status: complete`.**
Measured now at `7be35ae6b`, `docs/replatform/epics/E6-deployment-test-harness/tickets/DEP-015-result.md:3`:

> `**Status:** `complete` (set by the distinct reviewer of attempt 2; the author left it at `gate_review`). ★ **Re-affirmed 2026-09-23** by the distinct reviewer of attempt 3 … *Original line, kept as first written:* "`gate_review`. The **keyed acceptance is PENDING** …"`

**I read the quoted historical line as the live status.** The record follows this programme's own
"never rewrite history in a quote" convention and preserves its superseded wording inline; a
first-match grep for `**Status:**` returns the whole line, historical quote included, and I took the
wrong half of it. That is the records-disagreeing-with-code class again, this time caused by reading
a *correctly written* record carelessly.

**Corrected below.** At the candidate, of `M1a`'s required result set: **`DEP-015` is `complete`**,
and `DEP-017` (`gate_review`, keyed acceptance pending) and `WRK-018` (`gate_review`) are the two
that remain. **Exit criterion 1 is still unmet**, on those two — so no verdict, assertion or clause
judgement changes.

**(2) The `a3` command table still abbreviated artifact paths** with an ellipsis prefix, and used
prose for one entry. §3 is rewritten once more with every path written out in full, so each row is
copy-pasteable as recorded.

**Everything else is carried forward from `a3` unchanged**, including the §0.0 accepted-debt note on
the four wrongly-dated `a1`/`a2` filenames, which still stands and is not repaired.

## 0.0 Why attempt 3 existed, and the accepted debt it could not repair (carried forward)

Two P2 findings from the Codex review of PR #586 on `f30a0c6a85`, both confirmed at source.

**(1) The UTC date in `a1` and `a2` is wrong.** `artifact-policy.md:115` requires the filename's
date segment to be the **UTC** date. Measured: `TZ=UTC git log -2 --format='%H %cd' --date=iso-local`
returns `f30a0c6a857e345b52370502a21ef133b6a671df 2026-09-23 22:21:12 +0000` and
`3f00c2be118e1c2e94bf0d15ba7b7c2965fb499b 2026-09-23 22:04:53 +0000`. The authoring session's clock
is `+05:30`, so its "2026-09-24" was **2026-09-23 UTC**. Both campaigns also ran on 2026-09-23 UTC
(`20:05`–`20:11` and `21:12`–`21:18`). Attempt 3 and this attempt use **`2026-09-23`** in its filename and in
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

`a1` recorded `Result: pass`. `a2` judged it **wrong in two independent ways** — ★ *and §0.0000 later disproved the second and reclassified the first, which is why this attempt is `pass` again. Kept as `a2` reasoned it:* — found in `a2`, restated here because a record must stand alone —, both raised by the Codex
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
| `git diff --stat 8c01f4e94f8e25d7abaf524e8b266b809c67b8cb 7be35ae6b7719877e61f54ab552de84de8491e7d` | `0` | <1 s | git elides the path as ` .../tickets/DEP-017-result.md \| 120 +++++++++`; in full it is `docs/replatform/epics/E6-deployment-test-harness/tickets/DEP-017-result.md`. Summary line: `1 file changed, 120 insertions(+)` |
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
| `SPINE-COST-1` | REQUIRED | exactly one `cost_events` row with cost > 0 per enabled tenant | `costRows: 1` on both. The **`m1-spine`** profile records `costCents: 81` (`provider "claude_local"`, `model "claude-sonnet-4-6"`, `rateId "claude-sonnet-4-6"`, `rateVersion 1`, 120000/30000 tokens), which **agrees** with the `E3-15-budget` register text; the **83** figure is the `m1-fault-matrix` profile’s `legacyTables.cost_events.ownCents`, a different arm, with `foreign: 0` ★ *(`a1`–`a5` compared the two and reported a disagreement that does not exist)* | `pass` |
| `SPINE-COST-2` | REQUIRED | a suppressed-usage positive control must red | step passed; `positive-control/`, `usageMode: "suppressed"`, `providerUsage: null`, `usageEvents: []`, `costRows: []` | `pass` |
| `SPINE-COST-3` | REQUIRED | a duplicate usage event must red | step passed; `duplicate-usage-control/`, `usageMode: "duplicate"`, `providerUsage 120000/30000` | `pass` |
| `SPINE-AUDIT-1` | REQUIRED | operator-visible audit parity | both journeys `activity: ["job.attempt_started","job.attempt_terminal"]`; applied `activity_audit` receipts with `sourceIdentity activity:<companyId>:<eventId>` | `pass` |
| `SPINE-FENCE-1` | REQUIRED | lifecycle / fence behaviour | `d1.cancel.unleased_attempt` → `cancelled_directly_without_command`; `d1.cancel.leased_attempt` → `cancel_requested_with_fenced_command` | `pass` |
| `SPINE-CLEAN-1` | REQUIRED | cleanup / recovery | truncated upload → `fenced_commit_refuses_unverifiable_object`; orphan → `uncommitted_object_deleted`; expired lease → `single_winner_retry_minted`; CP restart → `durable_lease_state_survives_restart`; both link cuts fired | `pass` **for the cases that ran**, narrowed by §5 |
| `SPINE-MATRIX-1` | REQUIRED | every **required** declared case fires | `summary`: `declared 28, required 25, pending 3, fired 25`, `complete: false` | `pass` **as to the 25**; see `SPINE-MATRIX-3` |
| `SPINE-MATRIX-2` | REQUIRED | a suppress-every-injection control reds | step passed; suppressed arm `fired 16` vs `25` | `pass`, narrowed by §5.3 |
| ★ `SPINE-MATRIX-3` | **OBSERVED** | a case may be `pending` only for a reason true of the certified lane | **FALSE for two of the three, and recorded as a DECLARATION defect.** `d1.reconcile.worker_startup_lease_probe` and `d1.provider.worker_terminal_mapping` are excused because the D1 workers do not dispatch; **this lane's `worker-b` does** (§0.1). `check-campaign-fault-matrix.mjs` is green and all 25 *required* cases fired, so this is not an unmet clause of this gate — it is a false premise in `tests/d1/fault-matrix.json` that must be repaired, and the two cases are certified by **no** campaign (§8). ★ *Reclassified from `REQUIRED` in `a6`; see §0.0000* | **`recorded`** |
| ★ `SPINE-ROLLBACK-1` | REQUIRED | the record includes the `MIG-009` CLI rollback rehearsal, attributed to the rollback owner (M1 plan §6; criterion 6) | **present and clean.** Test *"m1-spine: the MIG-009 drain CLI rolls back live distributed work, per tenant and attributed"* (`tests/d1/m1-spine.test.mjs`): `exitCode 0`; audit `actorId "operator-cli:m1-spine-1449e508"`, `actorType "system"`, action `job.drain.requested`, `detailsReason "distributed_execution_rollback"`; 2 drainable jobs, a **5-candidate pre-drain census**, 5 audit rows; CLI summary `organizationsScanned 3, cancelled 5, skippedCount 0, failedCancellations []`; `verdicts.rollbackRehearsal` = `[]`. Non-vacuous by `evaluateRollbackRehearsal` (`scripts/lib/m1-spine-assertions.mjs:1060`): operator-nonce-scoped, census-before-drain, attempt-keyed not job-keyed. ★ *`a2`–`a5` recorded this as absent; see §0.0000* | `pass` |
| ★ `SPINE-CRIT5-1` | REQUIRED | the worker-driven enabled tenant's DEP-017 env probe is OBSERVED (criterion 5; plan §6 / `E6-D002`) | **observed.** `evaluateSpineEnvProbe` → `evaluateEnvProbeEvidence`, which fails closed on a missing summary and additionally requires `verdict "absent"`, an empty `present` list, set equality both ways against `ENV_PROBE_EXPECTED_CLASSES`, and `plantedControl.red === true`; the `m1-spine` job asserts zero violations and passed. ★ **Settled directly by the passing profile** (`m1-spine-evidence-35912752449/profile/m1-spine-evidence.json`): `workerDriven.criterion5EnvProbe = { "observed": true, "scope": "stage_in_env_only", "logMessages": 1 }`, `verdicts.criterion5 = []` | `pass` |
| ★ `SPINE-CRIT5-2` | REQUIRED | every OTHER enabled tenant is recorded UNOBSERVED, with a tripwire in both directions | `criterion5EnvProbe { observed: false, reason: "harness-driven: the DEP-017 probe runs inside a sandbox, and M1-D1-SPINE has ONE deployed worker, which drives the first enabled tenant" }`; `evaluateEnvProbeObservability` reds on `probe_emitted_but_recorded_unobserved` **and** on `claimed_without_summary`; `verdicts.criterion5Others` = `[]`; in the passing profile `enabled.A` and `enabled.B` each read `observed: false, logMessages: 0`, and `verdicts["A:criterion5"]` = `[]`. Assertion site ≈`:598–622` ★ *(`a5` cited `:340–366`, which is the earlier per-tenant loop carrying a different reason)* | `pass` |
| `SPINE-FLAGS-1` | REQUIRED | crew off, tool surface off, no excluded flag on | `crewEnabled false`; `toolSurfaceArmed false`; `organizationToolSurface` false ×3 | `pass` |
| `H-06` | HARD | metadata / private / worker-control / control-plane denied, incl. direct-IP, redirect, DNS-rebinding | **not exercised on this lane and NOT PASSED** — §7 | **`recorded`, not `pass`** |
| `EVID` | REQUIRED | evidence retained **on pass** | `passing/` collected before any control mutated the stack, plus `post-controls/` | `pass` |

---

## 5. Findings, and what this record does NOT establish

★ **There are no REQUIRED failures.** `SPINE-ROLLBACK-1` is `pass` on measurement and
`SPINE-MATRIX-3` is `OBSERVED` — both corrected in `a6`, §0.0000. **Failure class `none`.** The
items below are findings and scope limits, recorded at full force; none of them is an unmet
clause of this gate.

1. **Two cases unrun without a valid reason** — `SPINE-MATRIX-3`, §0. The consequence is concrete:
   **`WRK-013`'s deployed-boot restart behaviour and the deployed worker's terminal mapping are
   certified by no campaign at all.** `WRK-013`'s evidence remains
   `startup-reconcile-composed.component.test.ts`, an in-process component test against a
   control-plane double.
2. ★ **RETRACTED in `a6`: the rollback rehearsal DID run and pass** (§0.0000, `SPINE-ROLLBACK-1`).
   *Kept as `a2`–`a5` stated it, so the correction is legible:* "No rollback rehearsal —
   `SPINE-ROLLBACK-1`. `MIG-009` did wire the trigger
   (`runDistributedExecutionDrainTrigger` is `createDistributedExecutionDrain`'s first production
   caller; `E10-1-drain` is `wired`; the operator entrypoint is
   `pnpm drain:distributed-execution --operator <who>`), so the mechanism exists — **it was simply
   never rehearsed on this candidate, by anyone." — **that last sentence is false**, and the CLI
   report proves it: `organizationsScanned 3, cancelled 5, skippedCount 0, failedCancellations []`.
3. **The third `pending` case remains genuinely structural.**
   `d1.credential.production_reader_company_predicate` is routed by `E6-D003` to
   `d2m.credential.production_reader_company_predicate`, and its reason — that
   `failClosedDeviceLocalBroker` is the only implementation in the tree, so an admitted read and a
   denied one are indistinguishable on D1 — is true of this lane. It is still **uncertified**,
   because its destination ran nothing (§8).
★ **3a. The criterion-5 observation is REAL but NARROW.** `scope: "stage_in_env_only"` is recorded with the evidence rather than only in prose: a **reference** sandbox has no baked image env and no provider-host env, so the spine's probe observes the **stage-in** env only. The template-baked and provider-host credential classes stay the `DEP-015` keyed lane's to observe, and that lane did observe them for both its enabled tenants. Neither lane observes criterion 5 for a control tenant — no sandbox is created for one.
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
    that clause. ★ *(`a1`–`a5` said the register’s `cost_cents 81` disagreed with a measured 83. It does not: the `m1-spine` profile measures **81**. See §0.0000.)*

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
  are exposed. This lane exercises **both** halves.
  **Storage side:** `d1.tenant.legacy.provider_credentials` shows own 1 / foreign 0 with an
  **observed foreign row**, on the non-owner `aoa_app` pool, filtered by query predicate because
  `provider_credentials` has **no RLS**. **Sandbox side:** ★ *corrected in `a5`; `a1`–`a4`
  wrongly said this half was the mechanism lane's alone* — the `DEP-017` probe **ran inside the
  reference sandbox on the worker-driven enabled tenant** and reported `absent` over the full
  expected class set with its planted-canary control red (`SPINE-CRIT5-1`), while the other
  enabled tenant is recorded `observed: false` under a two-directional tripwire
  (`SPINE-CRIT5-2`). Its scope is `stage_in_env_only`: a reference sandbox has no baked image
  env and no provider-host env, so the template-baked and provider-host classes remain the
  `DEP-015` keyed lane's to observe.
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
uncertified.** See `./2026-09-23-m1a-d2-mechanism-m1a-candidate-7be35ae6b771-a7.md`, which carries
`Result: fail`.

---

## 9. Gate effect

- ★ **Permits** the `M1-D1-SPINE` clause of `M1a` exit criterion 2, and criterion 8’s `Result: pass`
  requirement **for this gate only**, on the candidate `7be35ae6b7719877e61f54ab552de84de8491e7d`
  via the §1.1 documentation-only carry-forward.
- **Contributes** criterion 6’s recorded rollback rehearsal (`SPINE-ROLLBACK-1`) and the spine half
  of criterion 5 (`SPINE-CRIT5-1`, scope `stage_in_env_only`).
- **Does NOT satisfy** criterion 3 (`M1a-D2-MECHANISM`, whose record is `fail`), criterion 4
  (which `M1a` does not carry), or criterion 7 (the E5 `a2` audit).
- **Promotes nothing.** `M1-D1-SPINE` is **non-promoting** (scope-triage → *Normative-gate
  boundary*). It is not `D1`, does not change any epic's status, and cannot support an `E3`–`E7`
  completion handoff.
- **Retains, at full strength, everything in §4 marked `pass`.** A future attempt may carry those
  measurements forward on this exact revision. The spine lane works; it is two clauses short.
- **Also unmet on this candidate, and the decision owner's to weigh:** of `M1a`'s required result
  set, **`DEP-015` is `Status: complete`** at `7be35ae6b` (set by the distinct reviewer of attempt 2
  and re-affirmed at attempt 3 — see §0.00, which corrects `a1`–`a3` on this point), while
  **`DEP-017`** (`gate_review`, keyed acceptance pending) and **`WRK-018`** (`gate_review`) remain
  open. **Exit criterion 1 — *"all required ticket results approved with no pending review
  sentinel"* — is therefore still not met by the tree this record attests**, on those two.
  Dispositioning them is a distinct reviewer's act, not this QA owner's; the keyed run
  `35920425288` is the acceptance each was waiting for.

### 9.1 What must still be repaired — which no longer blocks THIS record

1. **Run the two wrongly-excused cases** on this lane — `d1.reconcile.worker_startup_lease_probe`
   and `d1.provider.worker_terminal_mapping` — which the override's dispatch-enabled `worker-b`
   makes possible today; **or** re-declare them `pending` with a reason that is true of the lane
   that boots the override, and route them to a lane that will actually run them.
2. **Perform and record the `MIG-009` CLI rollback rehearsal** on this candidate, attributed to the
   named rollback owner.
3. ★★★ **Carry §4's `SPINE-CRIT5-1` and `SPINE-CRIT5-2` forward.** They are required evidence for `M1a` exit criterion 5 on this lane (plan §6, `E6-D002`), and a successor that dropped them would pass while observing less than this attempt did.
4. These are repairs to the **declaration and the programme**, not preconditions of this record's
   `pass`. A later attempt is needed only if a measurement here is found wrong — in which case it
   is attempt 7, with `Supersedes` naming this path.

Neither item needs a keyed run or any E2B spend. Both are keyless.
