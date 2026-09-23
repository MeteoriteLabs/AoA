# DEP-019 — The `m1-spine` journey, driven by the DEPLOYED worker — result

**Status:** `gate_review`. ★ **The `complete` flip of 2026-09-23 is WITHDRAWN by the M1 planning
session the same day**, on a Codex P1 raised against PR #579 and verified at source. Only a distinct
reviewer may restore it, and not before the fix below lands.
**Epic:** E6 · **Plan task:** `E6 implementation-plan §4c DEP-019` (filed by this PR) · **Milestone:** `M1a`
**Date (UTC):** `2026-09-23`
**Implementer:** Claude Opus 5 (M1 build agent)
**Start SHA:** `b3c5aa4178` (`origin/docs/replatform-program`)
**Owns:** no finding. It does not resolve `E3-F037`, which stays `unowned` as `DEP-016` left it.

> ★★★ **THIS RECORD WAS REWRITTEN ON 2026-09-23, and the version it replaces is kept VERBATIM in
> §12.** The first version reported Units B and C as *not built*, with a measured reason. The M1
> planning session did not overrule the reason — it supplied the verification route the reason said
> was missing (the `DEP-014` throwaway probe-branch pattern) and DECIDED, under F2, that the units be
> built and verified live before landing. They were. §12 keeps what this record said before that
> decision, because a record that quietly becomes a success story is not a record.

---

## 0. THE HEADLINE: the journey is worker-driven, and it was proven on a live D1 stack

`M1-D1-SPINE` requires the included lifecycle on *"one control-plane instance, **one separately
deployed worker**"*. `DEP-016` satisfied the worker half as a **topology**: a deployed worker
existed while the harness performed the journey. It now performs it.

**One run, on a real D1 stack, at the code in this PR** (§3 has the full evidence):

```
attempt          succeeded
job_events       attempt_started · log(dep017.env_probe verdict "absent") · usage · terminal
                 — every one carrying the DEPLOYED worker's enrolled workerId df013cec…
leases           held only by df013cec…
cost_events      1 row, 81 cents = M1_SPINE_EXPECTED_COST_CENTS
```

The worker leased it, created a sandbox on the reference provider **over the gated adapter-manager
wire**, ran the scripted command, ran the `DEP-017` env probe inside that sandbox, parsed the usage
out of the run's own stdout with `parseClaudeStreamJsonUsage`, and uploaded every event through its
durable outbox. The harness only seeded the job and read the rows.

**And the controls red.** The usage control (§4), the not-the-executor control (§5) and the
probe's own arms (§6) each go red for their own named reason.

★★★ **THE COST LINE IS NOW ASSERTED, not merely observed** — corrected 2026-09-23 after the
planning session ruled Codex's P1 a FIX (§13.1). *Superseded text, kept because the record must not
read as though it was always so:* “READ THE COST LINE ABOVE AS AN OBSERVATION, NOT AS AN ASSERTION.
… the profile does not yet assert them ON THE WORKER-DRIVEN ATTEMPT.” It does now: the SHARED
`evaluateEnabledTenantSpine` + `evaluateUsageCardinality` run against the deployed worker's own
attempt, and the usage-suppressed control reds on **the worker's parser** — proven twice
back-to-back (§13.1).

---

## 1. Why the ticket exists, measured

| Fact | Where |
|---|---|
| The profile played the worker itself — `enroll`/`poll`/`ack`/`uploadEvents` were HTTP calls the harness made, and the provider was reached through `/invoke` from `test-runner` | `tests/d1/m1-spine.test.mjs` §2; `tests/d1/lib/e6f-harness.mjs`'s own header: *"There is NO live worker-daemon loop"* |
| The D1 workers did not dispatch | `scripts/d1-dispatch-expectation.json` declares `AOA_WORKER_DISPATCH_ENABLED` **absent** for both; `decideDispatchComposition` refuses without it |
| The reference provider ran no command, and its canned usage was invisible to a worker | `FakeSandboxProvider`'s `case "execute"`; the per-op `ExecuteResult` has **no usage field at all** |

`DEP-016-result.md` §5.3 states all three as a limitation and flags it for a D1 topology ticket. Its
distinct reviewer raised it; the planning session accepted it under F2.

## 2. What shipped

| Unit | Piece | File |
|---|---|---|
| **A** | `executeScriptedCommand` — a deterministic `claude --output-format stream-json` transcript on the stdout channel, ending in the `type:"result"` line carrying `FAKE_PROVIDER_CANNED_USAGE_V1` under claude's own field names. Scripted from the TENANT COMMAND's `args` (`--aoa-fake-usage|exit|timeout`), because a worker-driven journey mints the provider id inside the worker and the harness has no id to `/script` | `packages/sandbox-fake-provider/src/scripted-command.ts` |
| **A** | The `DEP-017` probe is **executed, not scripted**: `node -e` in a child process whose env is EXACTLY the map the provider was handed, with nothing of the host's inherited. Only the committed wrapper is recognised, **and only a PINNED script digest runs** (Codex P1, §8) | `…/node-eval.ts` |
| **A** | The reference provider on the AUTHORITATIVE per-op port — the face a deployed worker reaches | `…/per-op-provider.ts` |
| **B** | `evaluateWorkerDrivenJourney` + `evaluateSpineEnvProbe` + eleven override clauses, **extended in place, never forked** | `scripts/lib/m1-spine-assertions.mjs` |
| **C** | The reference provider hosts `createProviderServer` on a third port, **gated** with the control plane's public key | `docker/d1/fake-provider-entry.mjs`, `docker/d1/fake-provider.Dockerfile` (a second `/wire-app` tree) |
| **C** | The one deployed worker dispatches, on its own committed org-scoped profile+ticket and its own state volume, pointed at the wire | `docker/d1/m1-spine.override.yml`, `docker/d1/m1-spine-worker.{profile.json,enrollment-ticket}` |
| **C** | The capability mint + the secret store, both keyed **per run and never committed** | the override's `AOA_CONTROL_PLANE_SIGNING_KEY_FILE` + `AOA_SECRETS_MASTER_KEY: "${…:?}"` |

### 2a. The shipped adapter-manager composition root is UNTOUCHED

`bootAdapterManager` still refuses any provider but `"e2b"`. Teaching it a `fake` arm was the
obvious shortcut and was rejected: that bin is the only thing standing between a DEPLOYED provider
host and an ungated, isolation-free boot, and a test convenience there is a fail-open. The harness
hosts the wire instead, in its own image.

### 2b. Six facts the live lane taught, each of which cost a run

None of these is in any design document; each was measured.

1. **The run capability rides a RESOLVED secret handle.** No `env` / `sandbox_local_only` handle ⇒
   no resolve round-trip ⇒ `capability === undefined` ⇒ the supervisor terminates
   `no_run_capability` **before** it creates a sandbox.
2. **`job_secret_handles.handle` must be a UUID.** The frozen envelope schema rejects anything else,
   `buildJobEnvelope` returns null, and that is `JobLeasingError("internal_unavailable")` — **the
   poll 503s**, so ONE malformed handle stalls every job that worker could have been offered.
3. **The handle must not be owner-bound here.** `authorizeSecretResolve` re-checks a denormalized
   owner against the locked job's executor and, for a membership-capable owner, an active
   membership; a seeded agent has none, and the resolve is denied → `secret_redemption_failed`.
4. **The job's `policy_hash` must be the target profile's own `policyHash`.**
5. **`gateCreate` strips the idempotency key to `""` on purpose** — see §7, the defect it found.
6. **The migrate seed's target is enrol-ready, not dispatch-ready** in the sense that it must carry
   the profile the placement rows are built from; the harness reads it back rather than restating it.

## 3. GREEN — the live worker-driven run

Local, against `docker-compose.d1.yml` + `docker/d1/m1-spine.override.yml`, images built from this
tree (`docker/images/build.sh` at `47fe0c8d6`; the merge after it touched no `server/`,
`packages/db/`, `packages/shared/` or `packages/worker-protocol/` file).

```
COMPOSE_PROJECT_NAME=aoa-d1-019 AOA_D1_LIVE=1 AOA_D1_CAMPAIGN=m1-spine \
  node --test --test-concurrency=1 tests/d1/m1-spine.test.mjs
→ tests 9 · pass 9 · fail 0
```

All six `DEP-016` cases pass unchanged, plus the three this ticket adds:

| Case | Observed |
|---|---|
| **the DEPLOYED worker performs tenant A's journey** | the table in §0. The worker's own log: `worker-daemon enrolled` (workerId `df013cec…`, target `33333333…`), then `dispatch COMPOSED; heartbeat seeded; startup reconcile complete; leasing through the poll loop` |
| **the deployed worker is offered no work for tenant B or the control tenant** | 0 attempts of another Organization are placed on its target, while the owning tenant's own attempts ARE — the positive control that the zero is isolation and not an empty table |
| **★ the worker-driven verdict REDS on tenant A's HARNESS-driven attempt** | §5 |

The reference provider's own boot line, asserted by the lane:
`fake-provider GATED provider wire on 0.0.0.0:8082 (1 pinned probe-script digest; ownership gate ON)`.

### 3a. The DEP-017 probe — `DEP-016` acceptance item 6, closed POSITIVELY

The attempt carries `dep017.env_probe {"probe":"dep017-env-absence/v1","verdict":"absent",…}`, judged
by the **shared** `extractEnvProbeSummary` + `evaluateEnvProbeEvidence` (`m1-shipped-boot.mjs`) —
not a re-implementation. `DEP-016` §4b took the *"criterion 5 is observed only in the `DEP-015`
lane"* fork for one stated reason, quoted as it stands: *"the reference provider's `execute` runs no
command"*. Unit A removes it. §4b's tripwire (`evaluateEnvProbeObservability`) is **replaced by the
positive assertion and kept in the module**, with a dated note saying so, so a lane that ever
reverts to the harness-driven journey has its honest check back.

★★★ **WHAT THIS LANE CANNOT OBSERVE, and it must not be read as more.** A reference sandbox is not
an image: it has no baked environment and no provider-host environment. What the probe sees here is
the **stage-in env only**. The template-baked and provider-host credential classes remain the keyed
`DEP-015` lane's to observe. This is recorded in the retained bundle as
`criterion5EnvProbe.scope: "stage_in_env_only"`, not only in prose.

## 4. The usage control — red, at the worker's real parser

Same journey, `--aoa-fake-usage=suppressed` on the tenant command. Live:

```
events: attempt_started · log(env_probe) · terminal      ← no `usage` event at all
```

The transcript's `type:"result"` line is absent, so `parseClaudeStreamJsonUsage` finds no usage, so
the worker emits none, so `JOB-016` prices nothing and the cost assertion goes red. `DEP-016`'s
control asserted the same property one layer earlier — at the harness's forwarding. It is now at the
producer the gate actually depends on.

## 5. ★ The not-the-executor control, and the vacuous shape it replaced

**It runs on EVERY execution of the profile**, not only under a mode flag: the case judges tenant
A's **harness-driven** attempt from §2 — the journey `DEP-016` performs — with the SAME verdict, the
SAME deployed-worker identity and `declaredExecutor: "worker"`, and requires it to red on **both**
arms (`worker_driven:events_not_deployed_worker` and `worker_driven:lease_not_deployed_worker`). It
asserts non-vacuity first: the attempt it judges really carries events, and its worker really is not
the deployed one.

★ **Its first shape PASSED, live, and it was vacuous.** That version seeded its own job, drove
nothing, and read empty rows — and "no events at all" is not "somebody else's events", so the
verdict had nothing to object to. The run that exposed it is the one where the whole profile came
back `pass 8 / fail 0` **including** the control, which is exactly what a control must never do.
Recorded rather than quietly fixed, because the failure class — a check that evaluates nothing — is
this programme's first-named one.

The lane additionally runs the profile with `AOA_M1_SPINE_EXECUTOR=harness` and requires that the
worker-driven case be **withdrawn** while the in-test control still runs; that pairing distinguishes
"the claim was withdrawn" from "the profile fell over".

## 6. The pure evidence — RED, GREEN and the mutation table

`packages/sandbox-fake-provider`: **81/81** (20/20 before this ticket), `tsc --noEmit` clean.
`scripts/lib/__tests__/m1-spine-assertions.test.mjs`: **110/110** (77 before).

**TDD order, stated plainly.** `scripted-command.ts` was written before its suite, so there is no
module-not-found RED for it; the mutations below are its non-vacuity evidence. `node-eval.test.ts`'s
first run was RED for a real defect of my own (`1 failed | 13 passed`) — a case that passed
`--aoa-fake-usage=…` positionally to `node -e`, which node parses as its OWN option (exit 9); it was
rewritten around a stub runner. `per-op-provider.test.ts`'s first run was RED because the not-found
throw was SYNCHRONOUS, which a caller's `.catch()` would skip entirely; every op is now `async`.

Each row is a real run with ONE thing changed, reverted afterwards.

| Row | Changed | Result |
|---|---|---|
| **M1** | the `suppressed` arm ignored | `1 failed / 15` |
| **M2** | a trailing line appended after the result line | `4 failed / 12` — the observer reads the FINAL line only |
| **M3** | the transcript delivered as ONE chunk | `1 failed / 15` |
| **M4** | an unrecognised `--aoa-fake-*` flag accepted | `2 failed / 14` |
| **M5** | the exhausted-budget short-circuit removed | `2 failed / 14` |
| **M6** | `input_tokens` renamed `inputTokens` | `2 failed / 14` — what pins the transcript to the parser |
| **N1** | the child env merged with `process.env` | `1 failed / 13` |
| **N2** | the wrapper check skipped | `1 failed / 13` |
| **N3** | a probe with no runner falling back to canned output | `1 failed / 13` |
| **N5** | stderr relayed instead of stdout | `2 failed / 12` |
| **N6** | `NODE_EVAL_WRAPPER_PATTERN` loosened to `/node/` | `1 failed / 13` |

Every new **verdict** clause has its own red fixture in the self-test: the worker-driven arm has
fourteen (including a wholly harness-driven attempt, a foreign lease, a foreign event, a missing
terminal, a wrong target, a non-succeeded attempt, an absent deployed-worker id, and **both**
directions of the executor-mode tripwire), the env probe has five, and the override has twelve —
one per clause, plus a `DEP-016` clause to show this ticket extends that set rather than forking it.

## 7. The defect the live lane found in my own code

`gateCreate` calls `provider.create(spec, { ...ctx, idempotencyKey: "" })` **deliberately** — its
own header records that stripping the key makes the durable ledger the sole idempotency authority.
So every gated create arrives with the same empty key. My façade keyed its replay map on it, handed
the second run the FIRST run's sandbox, and the gate refused it because the ownership labels belong
to another lease. The D1 run died `create_failed` / `errorClass: "other"`.

No unit test caught it: they all passed a real key. An empty key is now not a key, with a test that
creates twice with `""` and asserts two distinct sandboxes with their own labels.

## 8. Codex review, verified at source and fixed

| Finding | Verified | Fix |
|---|---|---|
| **P1** — *"Verify the probe script before executing it"*: a job can reuse the publicly known wrapper while putting arbitrary JavaScript in `$0`; clearing the child environment does not stop that code reading the container filesystem or using its network | **True, and it is the wrong half to authenticate.** `ENV_PROBE_SH_WRAPPER` is published in this repo and `$0` comes from the job envelope's workload args. On this lane the provider container is where the campaign's own evidence lives | `classifyShellInvocation` now takes the set of SHA-256 digests the caller accepts and refuses any script outside it, **before anything is spawned**. An absent or EMPTY set refuses everything — a caller that forgot to pin gets no execution, never a permissive default. Only the digest is compared and only the digest appears in the refusal. The D1 host builds the set from the daemon's own `ENV_PROBE_SCRIPT`, so the pin has no second copy to drift. Four new cases, including a counting stub proving the refusal never reaches the runner |

## 9. Constraints from the planning session, each discharged

| Constraint | How |
|---|---|
| Scope every security-surface change to the spine override only; the base topology unchanged and the global invariants still red on it, **proved by a positive control** | `docker-compose.d1.yml` and `scripts/d1-dispatch-expectation.json` are untouched. Positive control, run: adding `AOA_WORKER_DISPATCH_ENABLED: "1"` to the BASE `worker-b` reds `check-d1-dispatch-declared` (*"declared ABSENT but the compose file sets it to \"1\""*); reverted, it is OK again. Because that guard parses only the base file, the override's posture is held by eleven new `evaluateSpineOverrideText` clauses, each with a red fixture |
| Keys generated IN the job, never committed, never printed, covered by the leak scan | **PARTLY DISCHARGED — see §13.** Generated and never committed: yes (`docker/d1/runtime-keys/` is git-ignored, and two override clauses red on committed PEM material and on a literal master key). Never printed: yes (the master key is `::add-mask::`ed before it reaches `GITHUB_ENV`; neither PEM is echoed). **Covered by a leak scan: NO.** Measured at source after Codex raised it: the `m1-spine` job goes from `collect-d1-evidence` straight to `upload-artifact` with no scanner. **And the private key does cross into the reference provider**, because the mount is the whole directory on both services. Both were claimed here and in the override comment; both claims are now corrected, and both fixes are handed over |
| Dispatch armed on the one deployed worker, provably off everywhere else | the `override:dispatch_armed_beyond_the_deployed_worker` clause walks every other service block; the base guard is the second half |
| Keep `DEP-017`'s fail-closed behaviour — a fake `execute` returning canned output must RED | Not worked around: a recognised probe reaching a provider with no runner THROWS, and a canned answer leaves the verdict `not_run`, which reds. Pinned by test **N3** |
| Keyless | no provider key, no E2B, no keyed workflow dispatched |

## 10. Guards, pins, builds

- The full `pr.yml` pure-node guard set: **0 failures**, plus `check-evidence-immutability --base
  origin/docs/replatform-program`.
- `check-d1-dispatch-declared` OK (2 D1 workers, as declared); `check-ci-lanes` OK;
  `check-execution-census` OK at 92/89/3; `check-test-inventory` OK at 2861 —
  `packages/sandbox-fake-provider` pinned 5 → 10, and **only** that entry (`--write` also wanted to
  raise unrelated FLOOR counts, which were reverted, as `DEP-016` reverted the same class).
- Images built from this tree: control-plane, worker, adapter-manager (`docker/images/build.sh`) and
  the reference provider with its new `/wire-app` stage.

## 10a. Codex review, second round — the per-tenant probe limit, answered rather than widened

| Finding | Verified | Resolution |
|---|---|---|
| **P1** — *"Probe every enabled tenant before closing criterion 5"*: the worker-driven case is hard-coded to tenant A, so a tenant-B-specific stage-in credential leak would not red this lane, although the acceptance said *per enabled tenant* | **True**, and the cause is a collision between two LOCKED requirements, not an oversight. The `DEP-017` probe runs INSIDE a sandbox; only a DISPATCHING worker creates one; and `M1-D1-SPINE` is *"one control-plane instance, ONE SEPARATELY DEPLOYED WORKER"*. One worker drives one tenant's sandbox, and a second worker would satisfy this clause by breaking the gate's own topology clause | A new always-on case asserts, for every OTHER enabled tenant, that the probe is **RECORDED UNOBSERVED** — held in both directions by `evaluateEnvProbeObservability`, the `DEP-016` tripwire this ticket deliberately kept: it reds if a summary EVER appears on such an attempt, and if observation is claimed without one. It also asserts non-vacuity first (the attempt really carries events). The E6 plan's acceptance 4 is amended with the superseded text kept verbatim, and the gate question is **flagged for the planning session**: if criterion 5 must be observed for every enabled tenant on this lane, `M1-D1-SPINE` needs one deployed worker PER enabled tenant. `DEP-019` does not resolve that by widening what it claims |
| **P1** — *"Preserve the harness-mode test exit status"*: `|| true` discarded a failing suite, and the greps match the title on both `ok` and `not ok` | **True for the suite-level half.** The control's own line was already matched as `^(ok\|not ok)` and cased on, but a failure in ANY OTHER case still reached the greps and was announced as a passing control | The step now captures the exit status and requires **0** before it greps anything: under `harness` the worker-driven case is withdrawn and everything else, the in-test control included, must still pass |
| **P2** — *"Append the delivered Units B and C to the result record"* | **Already addressed at the time it was raised.** Codex reviewed `ec0a2d132`; the record was rewritten at `1a5e4f0c2`, and it retains the earlier partial history VERBATIM in §12 as the finding asks | No change beyond this row |

Live after both fixes: **10/10** on the D1 stack (was 9/9), the new criterion-5 case included.

### 10b. The RULING that closed the per-tenant question — `E6-D002`

The planning session ruled it under F2 on 2026-09-23, recorded in
`docs/replatform/epics/E6-deployment-test-harness/decisions.md` as **`E6-D002`**:

> **Criterion 5's PER-TENANT observation is satisfied by the `M1a-D2-MECHANISM` campaign, not by
> `M1-D1-SPINE`.**

The reasons, in the ruling's own terms:

1. **Why the spine lane cannot do it.** The probe runs INSIDE a sandbox; only a **dispatching
   worker** creates one; and `M1-D1-SPINE`'s own topology clause is *"one control-plane instance,
   **one separately deployed worker**"*. One deployed worker drives one tenant's sandbox, so
   per-tenant observation is **structurally unavailable on that lane** — a property of the gate's
   topology, not a shortfall of this build. A second worker would satisfy the probe clause **by
   breaking the topology clause**.
2. **Where it is satisfied instead.** The `DEP-015` shipped-boot lane boots **one worker per
   tenant** (`m1-worker-a`/`-b`/`-c`, each with `AOA_WORKER_ENV_PROBE=1`), which is the topology
   `DEP-017`'s probe was designed for. That lane observes criterion 5 for EVERY enabled tenant, and
   its keyed run is already an `M1a` exit requirement.
3. **Nothing is lost and no clause is weakened.** The obligation is allocated, not dropped: the
   spine lane observes criterion 5 for its single tenant; the mechanism lane observes it per tenant.
   `M1-D1-SPINE`'s topology clause stands unchanged and **no extra workers are added to it**.

Per the ruling, this profile KEEPS its record of the other enabled tenant as **unobserved**, with the
`DEP-016` tripwire holding it in both directions, and does **not** convert that record into a claim.

★ **For a future gate owner:** do not read this ticket's "criterion 5 observed" as per-tenant on the
spine lane. The record names which tenant it observed and why the others cannot be observed there.

## 11. CI evidence — the `m1-spine` lane, RUN

`d1-merge-train` fires only on push to `main` / `docs/replatform-program`, so the `m1-spine` job
cannot run on a pull request. Following the `DEP-014` pattern, the PR tree plus **one** trigger line
was pushed to a throwaway branch, `claude/m1-dep-019-d1-probe`, which has no PR and is never merged.
`git diff claude/m1-dep-019 claude/m1-dep-019-d1-probe` = **1 line** of `d1-merge-train.yml`.

**Run `35839618733`, head `8e86e9797` (= PR head `6190419ac` + the trigger line): `success`.**

| Job | Result |
|---|---|
| `m1-spine` (`107111777063`) | **success** |
| `d1-merge-train` (`107111776808`) | **success** — the existing two-worker `bounded`/`foundation` campaign is undisturbed by this ticket |

From the `m1-spine` job's own log:

```
running worker services: 1
worker-b-1  | "workerId":"62f58aa6-2a19-4686-9537-75a2adae8fd2",
              "targetId":"33333333-3333-4333-8333-333333333333",
              "msg":"worker-daemon dispatch COMPOSED; heartbeat seeded; startup reconcile complete;
                     leasing through the poll loop"
fake-provider-1 | fake-provider GATED provider wire on 0.0.0.0:8082
                  (1 pinned probe-script digest; ownership gate ON)

the profile:                     tests 10 · pass 10 · fail 0
usage-suppressed control:        "the profile went red on the cost assertion, as required"
duplicate-usage control:         "a duplicate usage event reds the cardinality assertion, as required"
not-the-executor control:        "the worker-driven claim is withdrawn and the verdict's red arm
                                  still runs"   (# pass 9 · # fail 0 · # skipped 1)
```

So, in CI and not only locally: exactly one worker service ran, it **composed dispatch**, the
reference provider served a **gated** wire with the probe script **pinned**, the whole profile passed
including the worker-driven journey and its always-on not-the-executor control, and all three
negative controls went red for their own named reason.

**Run `35849990593`, head `edc64517f` (= the RULED-ROUND head `5bad47509` + the trigger line):
`success`** — `m1-spine` job `107145129491`, `d1-merge-train` job `107145129430`, both `success`.
This is the run that covers the four ruled fixes. Its log carries the argv pin:

```
fake-provider-1 | fake-provider GATED provider wire on 0.0.0.0:8082
                  (1 pinned probe-script digest + a pinned probe argv shape; ownership gate ON)
running worker services: 1
the profile:              tests 10 · pass 10
usage-suppressed control: "the profile went red on the cost assertion, as required"
duplicate-usage control:  "a duplicate usage event reds the cardinality assertion, as required"
not-the-executor control: "the worker-driven claim is withdrawn and the verdict's red arm still runs"
```

★ **An earlier probe run, `35837953729` (head `d7e8a167c` = PR head `ec0a2d132` + the trigger line),
also concluded `success` with `m1-spine: success`.** It is cited because it is the run that first
showed the lane green; the run above supersedes it and is the one on the reviewed code.

### 11b. The one probe run that did NOT pass — and what failed in it

Run `35851111524`, head `20b9eadcf` (= `a60fcdc62` + the trigger line), concluded `failure`.
**`m1-spine` PASSED in it (job `107149290449`); the failure is the SIBLING `d1-merge-train` job**
(`107149290663`), in step *"Run the E6F campaign (live)"*:

```
✖ E6F-01 lease races: 100 submit->placement->lease->ACK races across >=2 profiles, one winner each
  ack expected 200, got 503: {"code":"internal_unavailable", "retryAfterMs":1000, …}
```

That is the PRE-EXISTING two-worker foundation campaign, not this ticket's lane, and the evidence
that it is transient rather than caused by this change is threefold: the SAME job passed on
`edc64517f`, whose only delta from this head is a DOCS commit (§13.6/13.7); the failure is a
`retryable` 503 inside a 100-way race; and `m1-spine` passed in the same run, on the same stack.

Stated rather than re-run, because the planning session's instruction for this cycle was to stop.
A reviewer who wants the sibling job green on this exact head should re-fire the probe branch.

### 11c. ★ THE CITED RUNS PREDATE THE `DEP-018` MERGE — stated before anyone has to find it

`DEP-018` landed on the program tip (`4ef301547`) and was merged into this branch at `db24644a2`.
Unlike the earlier program-tip merge (see below), **this one DID change the `m1-spine` lane's own
inputs**: `tests/d1/lib/e6f-harness.mjs` (the shared harness, +720 lines) and
`.github/workflows/d1-merge-train.yml` (+148 lines, the fault-matrix job). Measured, not assumed:
`git diff 8efd0fce1 db24644a2 -- tests/d1 .github/workflows/d1-merge-train.yml`.

So runs `35849990593` and `35839618733` are evidence for the code as it stood BEFORE that merge, and
**not** for this head. A fresh probe was fired on the merged tree for exactly that reason; its
verdict is recorded in §11d. Nothing above is rewritten — those runs happened and are cited for the
trees they ran on.

### 11e. THE FINAL PROBE — all THREE jobs green, including `DEP-018`'s

**Run `35856129644`, head `441b90caa` (= the final PR head + the trigger line): `success`.**

| Job | Result |
|---|---|
| `m1-spine` (`107165160976`) | **success** |
| `d1-merge-train` | **success** |
| `m1-fault-matrix` (`DEP-018`'s) | **success** — restored by the shared key-generation step (§11d) |

From the `m1-spine` job's own log, on the post-merge tree:

```
the verdict self-test:    tests 118 · pass 118 · fail 0
running worker services:  1
fake-provider-1 | GATED provider wire on 0.0.0.0:8082
                  (1 pinned probe-script digest + a pinned probe argv shape; ownership gate ON)
the profile:              tests 10 · pass 10 · fail 0
usage-suppressed control: "the profile went red on the cost assertion, as required"
duplicate-usage control:  "a duplicate usage event reds the cardinality assertion on the HARNESS
                           attempts, as required"          ← narrowed, §13.7
not-the-executor control: "the worker-driven claim is withdrawn and the verdict's red arm still runs"
```

This is the run that stands for the reviewed code: it is on the tree that carries the `DEP-018`
merge, both ruled rounds of fixes, and the cross-ticket repair.

### 11d. ★★★ THE MERGE BROKE A SIBLING JOB, AND IT WAS MY CHANGE THAT BROKE IT

The probe on the merged tree (`35853547516`, head `3d55763d3`) concluded `failure`. **`m1-spine`
PASSED (job `107156617625`) and so did `d1-merge-train` (`107156617274`); the failure is
`m1-fault-matrix` (`107156617510`)** — `DEP-018`'s new job, which arrived in the merge — at its step
*"Bring up the ONE-worker topology"*.

**Cause, measured from that job's own env block: it is MINE.** `m1-fault-matrix` sets
`SPINE_OVERRIDE_PATH: docker/d1/m1-spine.override.yml` and reuses this ticket's override wholesale.
`DEP-019` made the secrets master key a REQUIRED `${…:?}` variable and added the per-run keypair, so
that job's `docker compose up` began failing the RENDER. It was green on the program branch before
this branch merged; the two tickets are only in contact through that file.

**Fixed, and deliberately not by weakening the requirement.** Defaulting the master key would
restore the silent-fresh-key failure the `:?` exists to prevent. Instead the generation moved into
ONE script, `scripts/generate-d1-spine-keys.mjs`, called by BOTH jobs — so the next requirement the
topology gains cannot drift between two inline copies, which is exactly how this one appeared.

★ A redaction defect of my own fell out of writing it, and is fixed here: the first version printed
`::add-mask::<key>` unconditionally. That is a workflow command the RUNNER consumes — outside
Actions nothing consumes it and the line is simply the key on a terminal. The key is now emitted
ONLY into `GITHUB_ENV`, and only when running under Actions; locally the script says so and prints
nothing. Verified both ways.

★ The merge with the program tip (`499ec4d1c`) that sits between those heads touched **no** input of
this lane: `git diff ec0a2d132 13ed9c7f7 -- server/src packages/db/src packages/shared/src
packages/worker-protocol/src packages/sandbox-fake-provider docker docker-compose.d1.yml tests/d1
scripts/lib/m1-spine-assertions.mjs scripts/lib/m1-shipped-boot.mjs
.github/workflows/d1-merge-train.yml` is **empty**.

### 11a. `pr.yml` — and a gap in my own pre-push loop, found by it

Run `35842257449` on `2c291fc02` failed **`brand-check`**, and the cause is worth recording because
it is a gap in the loop rather than a one-off: the pre-push guard set I run is derived from
`grep -oE "node scripts/check-[a-z0-9-]+\.mjs" .github/workflows/pr.yml`, so it covers only the
guards that are SCRIPTS. `brand-check` is an INLINE shell step in `pr.yml` and was therefore never
run locally.

What it caught: guard 9 requires every `process.env.AOA_*` read by a `.ts` file to be documented in
`docs/deploy/environment-variables.md`, and a test fixture of mine planted `AOA_HOST_ONLY` to prove
the probe's child process cannot see the host's environment. Documenting a test fixture there would
have been exactly the drift the guard exists to catch, so the fixture is renamed out of the `AOA_`
namespace (`DEP019_HOST_ONLY_CANARY`) with a comment saying why. The case proves the same thing: the
name is irrelevant to "the child cannot see the host's environment at all".

Guard 9 now reports nothing missing, and guards 1–8 find nothing in any surface this ticket adds.

**`ci-required`: PASS on the FINAL head `a3f68e9c8`**, run `35858398954` — the tree carrying the
`DEP-018` merge, both ruled rounds of fixes and the cross-ticket repair (§11d).

★ One intermediate run (`35856117196`, head `19ad584a3`) failed `verify (1)` on
`distributed-execution-db-startup.integration.test.ts` — *"server startup timed out before health or
exit"*, with `Requested port is busy; using next free port` in its own log. It is a boot-timing
flake and not a regression, and the evidence is that **this branch changes no `server/src` file at
all** (`git diff origin/docs/replatform-program...HEAD -- server/src` is empty), so that test's
subject is untouched by this PR. It was re-run rather than fixed, and the head moved on before the
re-run finished; the verdict above is on the later head.

Earlier passes, kept as recorded: on `a60fcdc62`, run `35851079291`, job `ci-required` =
`success` — the head carrying all four ruled fixes plus the §13.6/13.7 handover. Earlier, and
recorded as written: PASS on `75eb25f9b`, run `35844283361` (job `107132960224`), all
sixteen checks green — `changes`, `policy`, `lint`, `migrations`, `distributed-contract`, `browser`,
`brand-check`, both `worker-protocol-contract-bytes` lanes, `e2e`, `e2e-pgvector` and
`verify (1..4)`. This section is not rewritten.

---

---

## 13. HANDED TO THE PLANNING SESSION — five Codex findings past the two-round cap

**Speed rule C** (`M1-BUILD-RULES.md`): *"After two rounds on a PR, STOP and report."* Rounds 1 and 2
are fixed (§8, §10a). Rounds 3 and 4 produced the five below; each was verified at source and HANDED
OVER rather than fixed.

★★★ **THE PLANNING SESSION RULED ALL FIVE ON 2026-09-23 (F2): FIX FOUR; 13.5 discharged by the
record correction.** What each says below is what was handed over; **“SHIPPED” records what the
ruling produced.** The handover text is kept as written — it is the evidence that the findings were
verified before they were fixed, not after.

★ **Two exceptions were made, and only two, and they are not fixes.** Findings 3 and 5 are FALSE
CLAIMS IN THIS TICKET'S OWN RECORDS — the override comment said the provider gets only the public
half and that a leak scan covers the bundle, and neither is true of the code. Those sentences are
CORRECTED (removed and replaced with what the code does) rather than left standing while the session
rules, because a false claim of enforcement is worse than a missing check. The CODE is untouched.

### 13.1 — P1: the worker-driven attempt's cost and usage are not asserted

*Codex, `tests/d1/m1-spine.test.mjs:447`.* **Verified at source, and it is the most important of the
five.** `evaluateWorkerDrivenJourney` deliberately does not require a `usage` event (§6 explains
why), `querySpineWorkerDriven` returns no usage/cost/receipt/audit rows at all, and the shared
`evaluateEnabledTenantSpine` / `evaluateUsageCardinality` verdicts run ONLY against the earlier
HARNESS-created attempts. So if the deployed worker stopped parsing stdout usage, or the pricing
stopped firing for its attempt, this profile would stay green, and the usage-suppressed control
would still red — on harness activity.

**The consequence for this record:** §0's cost line and §3's `cost_events 1 row, 81 cents` are a
LIVE OBSERVATION I made, not something the profile asserts. A reviewer must read them that way.

**Proposed fix:** extend `querySpineWorkerDriven` to return the deployed attempt's usage events,
cost rows, receipts and audit rows, and apply the shared `evaluateEnabledTenantSpine` +
`evaluateUsageCardinality` to it — the same verdicts, on the worker-driven attempt. The
usage-suppressed control then reds on the WORKER's parser, which is what the ticket claims.


**SHIPPED (ruled FIX, highest priority).** The worker-driven case now runs the SHARED
`querySpineAttempt` probe and the SHARED `evaluateEnabledTenantSpine` + `evaluateUsageCardinality`
against the DEPLOYED worker's own attempt — the same probe and the same verdicts the harness path
uses, never a second implementation. The one narrowing is a new named arm,
`measuredRuntimeMillis`: on this path the WORKER produces the event and takes `runtimeMillis` from
the supervisor's clock (`usage-observer.ts` says so in its header), so the duration is an
observation, while the three token counts stay pinned exactly and the charge is still the derived
81 cents. A missing or negative duration reds as `usage:runtime_not_measured`.

**Proven, live, twice back-to-back:** with `--aoa-fake-usage=suppressed` the worker-driven case now
reds as *"worker-driven cost/audit violations"* with `usage:no_usage_event`, `cost:no_cost_row` and
`cost:receipt_missing` — on the WORKER's parser, which is the thing the ticket claims.

★ **A second defect fell out of proving it, and it is the vacuity family again.** The first
suppressed run red on a TIMEOUT rather than on cost: the deployed worker has ONE batch slot, and a
lease row stays `active` after its attempt is already terminal (measured:
`{status:"active", live:true, attempt_status:"succeeded"}`). The lane runs this profile FOUR times
against ONE stack, so every run after the first would have red for the wrong reason — and the
lane's grep, which only looks for `[m1-spine:cost]` anywhere in the output, would have accepted it.
The seed now releases leases of THIS deployed worker whose attempt is ALREADY terminal, scoped so it
can never touch live work.
### 13.2 — P1: the reference provider is mounted the PRIVATE capability key

*Codex, `docker/d1/m1-spine.override.yml:110`.* **Verified: true.** Both `control-plane` and
`fake-provider` mount `./docker/d1/runtime-keys:/keys:ro` — the whole directory, so the provider
receives `control-plane-signing-key.pem` as well as the public half. It matters more than usual
because that container also hosts the child-process probe execution path.

**Proposed fix:** bind the two PEMs as individual files — the public half only into `fake-provider`,
the private half only into `control-plane` — and add an override clause that reds on a directory
mount of `runtime-keys` into the provider, so the boundary is held by a check and not by a comment.


**SHIPPED (ruled FIX).** Each PEM is bound as an individual FILE: the private half into
`control-plane` only, the public half into `fake-provider` only. Verified on the running stack —
`ls /keys` is `control-plane-signing-key.pem` in the control plane and `control-plane-public-key.pem`
in the provider. The boundary is held by a CHECK, not a comment: `evaluateSpineOverrideText` gains
`override:key_directory_mounted` (a directory mount of `runtime-keys` into any service),
`override:wrong_key_half` (the private half in the provider, or the public half in the control
plane) and `override:key_mounted_into_unexpected_service`. Each has a red fixture.
### 13.3 — P2: the probe's ARGUMENTS are not pinned, only its script

*Codex, `packages/sandbox-fake-provider/src/node-eval.ts:141`.* **Verified: true, and it is the
same class as the round-1 finding one level down.** The digest pin authenticates the script BYTES.
`ENV_PROBE_SCRIPT` reads `argv[2]` as `metaUrl` and `fetch`es it, and a job's `workload.command` /
`workload.args` reach `execute` verbatim — so a job could set `command: "sh"` with the public
wrapper, the pinned script, and an arbitrary `metaUrl`, and use the provider host to probe
reachability of any address on the D1 networks.

**Proposed fix:** validate the whole supervisor-generated argv shape, not only the script: the
metadata URL must equal `ENV_PROBE_METADATA_URL` or be empty, the allowed-names CSV must be a CSV of
POSIX names, and the expected-digests argument must parse as a JSON object.


**SHIPPED (ruled FIX).** `assertProbeArgvShape` pins the supervisor's own shape: exactly five
positional arguments, a non-empty Organization id, a CSV of POSIX env names, the metadata URL equal
to the pinned `ENV_PROBE_METADATA_URL` **or empty** (the planted control passes empty), a non-empty
salt, and a JSON OBJECT of expected digests. Fail-closed: with no pinned URL only the empty value is
admitted, so a host that forgot to pin cannot be made to fetch anything at all. The D1 host takes the
URL from the daemon's own constant — the same no-second-copy reason as the digest — and refuses to
boot if that export is missing. Six new cases, including one proving the refusal precedes any spawn.
### 13.4 — P2: the lane's `push.paths` do not name the new runtime dependencies

*Codex, `.github/workflows/d1-merge-train.yml`.* **Verified: true.** The worker-driven path executes
`worker-networked-host` and traverses `provider-wire`, `worker-daemon`, `adapter-manager` and
`provider-capability`; none of those trees is in the lane's `push.paths`, so a push changing only one
of them skips this profile although it can break the exact boot root and wire this ticket adds.

**Proposed fix:** add `packages/worker-daemon/src/**`, `packages/worker-networked-host/src/**`,
`packages/provider-wire/src/**`, `packages/adapter-manager/src/**` and
`packages/provider-capability/src/**`. (`DEP-016` already recorded that this enumeration cannot be
complete and that the alternative is removing the filter for this gate; that is the session's call.)


**SHIPPED (ruled FIX).** `packages/worker-daemon/src/**`, `packages/worker-networked-host/src/**`,
`packages/provider-wire/src/**`, `packages/adapter-manager/src/**` and
`packages/provider-capability/src/**` are on the lane's `push.paths`. **The queue cost, stated:** a
change to any of those now fires the ~45-minute lane, exactly as a `server/src` edit already does.
That is the correct trade — a lane that cannot see a change to the code it exercises is not a gate.
### 13.5 — P2: the retained evidence is uploaded with no secret scan

*Codex, `.github/workflows/d1-merge-train.yml:457`.* **Verified: true.** The `m1-spine` job runs
`collect-d1-evidence` and then `upload-artifact` with nothing in between, while this ticket
introduced an unmasked private PEM and a per-run master key into the stack. The collector gathers
container LOGS, job events and a SCHEMA-ONLY `pg_dump` — so neither value is captured today — but
that is a property of what the services happen to log, not a control.

**Proposed fix:** a hard scan of both evidence directories for the two generated values before the
upload, failing the job on a match.


**RULED: already handled by the record correction; nothing further.** The false claim is gone from
both the override comment and §9; the collector's actual reach (container logs, job events, a
SCHEMA-ONLY `pg_dump`) is recorded there as a property of what the services log rather than as a
control.
### 13.6 — P2: the not-found error does not reach the gate as the CANONICAL class

*Codex, `packages/sandbox-fake-provider/src/per-op-provider.ts:141`.* **Verified at source: true.**
`gateOwnedOp` converts a vanished sandbox with `if (err instanceof SandboxNotFoundError) throw new
ResourceNotAvailableError()` (`packages/adapter-manager/src/owned-op-gate.ts:176`), and that class is
imported from `@armyofagents/worker-daemon` (`owned-op-gate.ts:44`). This package throws a
PACKAGE-LOCAL class of the same `name` but a different identity, so `instanceof` is false: the error
skips the uniform conversion and escapes the modelled-error fence as a generic wire failure instead
of "already gone". That is the idempotent-cleanup path on the new gated fake-provider lane.

Blast radius, measured: `destroy` and `reconcileCleanup` do not throw at all (they are idempotent
no-ops by design), so this reaches `inspect`, `execute`, `cancel` and `kill` on a sandbox that has
already vanished.

**Proposed fix:** inject the canonical constructor at the boundary, the same no-second-copy pattern
already used for the probe-script digest and the metadata URL —
`createFakeSandboxProviderPort({ notFound: () => new SandboxNotFoundError() })`, with the D1 entry
taking `SandboxNotFoundError` from the wire tree's own `@armyofagents/worker-daemon`. The package
keeps its local class for in-process callers and never imports worker-daemon.

**SHIPPED (ruled FIX, within the bound — no new secret, network path or mount).** Exactly that:
`FakeSandboxProviderPortOptions.notFound`, defaulting to the local class for in-process callers, and
the D1 host passes the canonical one from the wire tree's own worker-daemon build, refusing to serve
the wire if that export is missing.

**The positive control the ruling asked for:** `per-op-provider.test.ts` stands in for the canonical
class (this package may not import worker-daemon) and asserts the MECHANISM the gate depends on —
with the injection the thrown error passes `instanceof`, and **WITHOUT it the default local class
does NOT, although its `name` is identical**. That is the exact shape that slipped past the gate.
Three more cases: the injection reaches every op that can name a vanished sandbox
(`inspect`/`cancel`/`kill`/`execute`), and `destroy`/`reconcile_cleanup` still do not throw at all,
because they are idempotent by contract.

### 13.7 — P2: `duplicate` mode does not reach the worker-driven attempt

*Codex, `tests/d1/m1-spine.test.mjs:431`.* **Verified: true, and it is the same family as 13.1 —
which is why it matters.** `workloadArgs` is `["--aoa-fake-usage=suppressed"]` only for `suppressed`;
under `duplicate` the worker-driven case gets `[]`, so only the harness attempts append the second
usage event. The lane's duplicate step accepts any `[m1-spine:usage]` failure, so it could pass
entirely on the harness assertion even if the worker-driven cardinality arm were removed.

**Why it is not a one-line fix, and why it is the session's call.** The provider cannot produce it:
the worker emits AT MOST ONE usage event, because `createUsageObserver` derives it from the FINAL
stream-json result line, so a transcript carrying two result lines still yields one event. The `> 1`
direction on the worker path is a property of the EVENT UPLOAD, not of the provider — and the only
harness route to a second event on that attempt is a foreign-worker upload, which the fenced ingest
correctly denies (§3a proves that denial). So the options are:
(a) inject the second event server-side in the seed, which asserts the ingest rather than the worker;
(b) narrow the lane's duplicate step to the HARNESS arm explicitly, and record that the
    worker-driven cardinality arm is exercised by the SUPPRESSED control (0 ≠ 1) and by the green
    run (exactly 1) rather than by the `> 1` direction; or
(c) give the worker a way to emit a duplicate, which is a daemon change and out of this ticket.
**My recommendation is (b)** — it is the only one that does not make the control assert something
other than what its name says.

**SHIPPED (ruled FIX, taking recommendation (b); within the bound).** Two changes, both in the lane
step:

1. **It was also too loose in a second way.** The step required any `[m1-spine:usage]` failure — and
   `usage:no_usage_event` carries that marker too, so the duplicate control could pass on the ZERO
   direction while claiming to prove the `> 1` one. It now requires `usage:not_exactly_one`.
2. **What it covers is written into the step**, so nobody re-derives it: this control exercises the
   HARNESS-driven attempts only; the worker-driven attempt's cardinality is covered from the other
   side — the usage-suppressed control reds it at ZERO (`usage:no_usage_event` on the WORKER-DRIVEN
   verdict, §13.1) and the passing profile asserts EXACTLY ONE.

The `> 1` direction on the worker path stays unreachable, and that is a property of the product, not
of this lane: `createUsageObserver` derives the event from the FINAL stream-json result line, so the
worker emits at most one and no provider can make it emit two.

### What a reviewer should take from this section

Findings 13.2 and 13.5 are the `records-disagreeing-with-code` class, and they were in MY records.
13.1 — and 13.7, which is its unfixed twin — is a check that does not evaluate the thing its ticket
is named for. All three are the failure
classes this programme names first, and all three were found by review rather than by me — which is
the argument for the self-audit in `M1-BUILD-RULES.md` §A being run before the first push, not after.

## 12. The superseded record (kept verbatim)

★ What this record said before the planning session's F2 decision to build Units B and C with a
probe-branch verification. It is kept because the trajectory is part of the evidence: the reason it
gave was not wrong, it was answered.

> # DEP-019 — The `m1-spine` journey, driven by the DEPLOYED worker — result
>
> **Status:** `gate_review`. Only a DISTINCT reviewer sets `complete`.
> **Epic:** E6 · **Plan task:** `E6 implementation-plan §4c DEP-019` (filed by this PR) · **Milestone:** `M1a`
> **Date (UTC):** `2026-09-23`
> **Implementer:** Claude Opus 5 (M1 build agent)
> **Start SHA:** `b3c5aa4178` (`origin/docs/replatform-program`)
> **Owns:** no finding. It does not resolve `E3-F037`, which stays `unowned` as `DEP-016` left it.
>
> ---
>
> ## 0. THE HEADLINE, STATED FIRST: this ticket is PARTIAL
>
> **Unit A is built and proven. Units B and C are NOT built.** The `m1-spine` journey is still
> harness-driven at this head, and this PR does not change that. Nothing below may be read as
> evidence that the `M1-D1-SPINE` worker clause is now satisfied — §7 says exactly what remains and
> why it was not attempted in this session rather than attempted badly.
>
> What this PR does deliver:
>
> | # | Piece | State |
> |---|---|---|
> | 1 | The ticket, FILED: graph node, executable task section in three units, `M1a` required-set row, the `DEP-016` attempt-history append, and the `M1-D1-SPINE` readiness statements corrected | done |
> | 2 | **Unit A** — the reference provider EXECUTES a scripted command deterministically, writing the transcript a deployed worker's own usage observer parses | done, with RED/GREEN and a 10-row mutation table |
> | 3 | **Unit A** — the reference provider RUNS the `DEP-017` env-absence probe faithfully, closing the fork `DEP-016` §4b took | done, same evidence |
> | 4 | **Unit B** — the worker-driven verdicts | **not built** (§7) |
> | 5 | **Unit C** — the topology, and the live worker-driven run | **not built** (§7) |
>
> ---
>
> ## 1. Why the ticket exists, measured at `b3c5aa4178`
>
> `M1-D1-SPINE` requires the included lifecycle on *"one control-plane instance, one separately
> deployed worker"* (`docs/replatform/epic-regrooming/scope-triage.md`). `DEP-016`'s profile has a
> deployed worker service and its journey is nevertheless harness-driven. Three facts, each read at
> source on this tree:
>
> | Fact | Where |
> |---|---|
> | The profile plays the worker itself: `enroll`/`poll`/`ack`/`uploadEvents` are HTTP calls the harness makes, and the provider is reached through the fake's `/invoke` control API from `test-runner` | `tests/d1/m1-spine.test.mjs`, the per-tenant journey case; `tests/d1/lib/e6f-harness.mjs`'s own header: *"There is NO live worker-daemon loop"* |
> | The D1 workers do not dispatch | `scripts/d1-dispatch-expectation.json` declares `AOA_WORKER_DISPATCH_ENABLED` **absent** for both; `evaluateD1Dispatch` (`scripts/lib/d1-dispatch-declared.mjs`) fails on either divergence direction; `decideDispatchComposition` (`packages/worker-daemon/src/lifecycle/compose-dispatch.ts`) refuses without it |
> | The reference provider runs no command, and its canned usage is invisible to a worker | `FakeSandboxProvider`'s `case "execute"` (`packages/sandbox-fake-provider/src/fake-driver.ts`) returns a terminal state plus `usage` on the CONTRACT driver result. The authoritative per-op `ExecuteResult` (`packages/worker-daemon/src/supervisor/provider.ts`) has **no usage field at all** |
>
> `DEP-016-result.md` §5.3 records all of this as a stated limitation and flags it for a D1 topology
> ticket. Its distinct reviewer raised it; the planning session accepted it under F2.
>
> ★ **The third fact is the one that decided Unit A's shape.** A deployed worker derives usage from
> the run's STDOUT — `ExecuteInput.onStdout` (WRK-018), captured by `run-output.ts`, parsed by
> `parseClaudeStreamJsonUsage` (`packages/worker-daemon/src/supervisor/usage-observer.ts`), emitted
> by `EventSequencer.usage`. `observeRun` **is** composed in production at this head
> (`dispatch-runtime.ts`, `observeRun: createUsageObserver({ metrics: deps.metrics })`) — so the
> producer exists and the only missing link is a provider that writes a parseable transcript. That is
> Unit A, and it is why Unit A is not "canned usage again": it moves the units from a shape only a
> harness reads to the shape the SHIPPED worker parses.
>
> ## 2. Unit A, part 1 — the scripted command
>
> `packages/sandbox-fake-provider/src/scripted-command.ts`, exported from the package index.
>
> - `executeScriptedCommand(input, options)` returns a real per-op-shaped `ExecuteResult` and streams
>   a `claude --output-format stream-json` transcript to `input.onStdout`. The FINAL non-empty line is
>   the `type:"result"` event carrying `FAKE_PROVIDER_CANNED_USAGE_V1`'s counts under claude's own
>   field names (`input_tokens`, `output_tokens`, `cache_read_input_tokens`) — the three the observer
>   maps. The transcript is delivered in more than one chunk on purpose.
> - **The script rides the TENANT COMMAND's `args`**, not the fake's `/script` control endpoint.
>   `DEP-016`'s usage mode is per PROVIDER ID, and a worker-driven journey mints the provider id
>   inside the worker, so the harness has no id to script. `--aoa-fake-usage=canned|suppressed`,
>   `--aoa-fake-exit=<n>`, `--aoa-fake-timeout`; anything outside the `--aoa-fake-` namespace is an
>   ordinary agent argument and is passed over.
> - **`suppressed` removes the result LINE ENTIRELY**, not merely its `usage` object. The observer
>   treats both as "no usage", but only a missing line also proves the LINE is what it reads. This is
>   `DEP-016`'s usage positive control, relocated from the harness's forwarding to the worker's real
>   parser.
> - **Fail-closed.** An unrecognised, malformed or REPEATED scripting flag throws
>   `ScriptedCommandError`, before any output reaches the channel. A script that degraded to the
>   default would make every positive control vacuous — the profile would assert "usage suppressed
>   reds" while the provider quietly reported canned units.
> - **The exhausted-budget short-circuit precedes everything**, as `E2bSandboxProvider.execute` does:
>   `deadlineMs <= 0` returns `{exitCode: null, signal: "SIGKILL", timedOut: true}` and writes
>   nothing. `--aoa-fake-timeout` is the OTHER timeout shape — output first, then the verdict — and
>   the two are kept distinguishable.
> - **Determinism:** no clock, no randomness, no filesystem; `providerOpId` is the caller's.
>
> ## 3. Unit A, part 2 — the `DEP-017` probe is RUN, not scripted
>
> `packages/sandbox-fake-provider/src/node-eval.ts`.
>
> `DEP-016` acceptance item 6 offers two forks and §4b took the second one — *"criterion 5 is
> observed only in the `DEP-015` lane"* — for a reason that was true when written and is quoted here
> as it stands: *"the reference provider's `execute` runs no command"*. §2 removes that reason. But a
> probe is not a transcript: it is a PROGRAM whose output must be a genuine observation, and a fake
> that printed a clean summary would be exactly the fabricated pass the acceptance forbids. So it is
> EXECUTED:
>
> - `classifyShellInvocation(command, args, env)` recognises the probe by the SHAPE of
>   `ENV_PROBE_SH_WRAPPER` (`packages/worker-daemon/src/supervisor/env-probe.ts`) and splits `$0`
>   (the script) from `$@` (its argv), exactly as `buildEnvProbeInvocation` assembles them.
> - `createNodeEvalRunner()` runs `node -e <script> <argv…>` in a child process whose environment is
>   **EXACTLY the request's map** — never merged with `process.env`, not even partially. A merge would
>   make the probe report on the fake-provider container instead of on the sandbox.
> - The child's real stdout goes to the stream channel and its exit code is the run's. stderr is not
>   relayed: the port carries an opaque `stderrRef`, and the probe's no-node marker is a stderr
>   contract of the daemon's.
>
> **Fail-closed three ways, each with a test:** only the committed wrapper is recognised (every other
> `sh` program is refused, so this is not an arbitrary-execution surface); the env is never merged;
> and a recognised probe reaching a provider with **no runner THROWS** rather than being answered with
> the scripted transcript.
>
> ★ **The vacuity trap is the intended behaviour and was not worked around.** A provider that returns
> canned output instead of executing leaves the verdict `not_run` and reds the profile. That is
> fail-closed working correctly, and Unit C must not loosen the verdict to accommodate it. It also
> sharpens this ticket's own acceptance 2: a fake `execute` that answers with canned output is
> precisely the "worker-driven claimed vacuously" case the not-the-executor control must catch.
>
> ★★ **WHAT THIS LANE CANNOT OBSERVE, so the record cannot be misread.** A reference sandbox is not
> an image: it has no baked environment and no provider-host environment. What the probe observes
> here is the **stage-in env only**. The template-baked and provider-host credential classes remain
> the keyed `DEP-015` lane's to observe. Unit C's evidence must state this narrowing; it is not
> discharged by Unit A.
>
> **The mirror is pinned.** This package imports no worker-daemon code (its closure is
> worker-protocol + zod + node built-ins, which is what the fake-provider image's closure is built
> on), so the wrapper is matched, not imported. `node-eval-wrapper-mirror.test.ts` reconstructs the
> daemon's committed `ENV_PROBE_SH_WRAPPER` from its own source and asserts this package's matcher
> accepts it, with a non-vacuity case (a wrapper with the node branch removed must NOT match).
> Without that test a wrapper rewrite would surface as every worker-driven `m1-spine` run reding
> `env_probe_not_run` — a symptom several layers from its cause. Same pattern and same reason as
> `docker/d1/__tests__/enrolment-seed.test.mjs`.
>
> ## 4. RED → GREEN, and the mutation table
>
> **TDD order, stated plainly rather than implied.** For `scripted-command.ts` the module was written
> before its suite, so there is no module-not-found RED to cite for it; the suite was then run and the
> ten mutations below are its non-vacuity evidence. For `node-eval.ts` the first run of
> `node-eval.test.ts` was RED for a real defect of my own (`1 failed | 13 passed`): the
> probe-argv-cannot-steer-the-fake case passed `--aoa-fake-usage=suppressed` as a positional argument
> to `node -e`, which node parses as one of its OWN options and exits 9. The daemon's real probe argv
> is entirely positional, so the case was rewritten around a stub runner, which isolates the routing
> decision from node's CLI parsing. That is recorded rather than smoothed over.
>
> GREEN, on `db0f07b94`:
>
> ```
> npx vitest run --root packages/sandbox-fake-provider
> → Test Files 8 passed (8) · Tests 50 passed (50)      (was 6 files / 36, and 5 / 20 before DEP-019)
> pnpm --filter @armyofagents/sandbox-fake-provider typecheck   → clean
> ```
>
> Every row below is a real run with ONE thing changed, reverted afterwards. The suite is 16 tests for
> `scripted-command.test.ts` and 14 for the two node-eval files.
>
> | Row | The one thing changed | Result |
> |---|---|---|
> | **M1** | The `suppressed` arm ignored — the result line is always written | `1 failed / 15 passed` — the suppression control |
> | **M2** | A trailing non-result line appended after the transcript | `4 failed / 12 passed` — the observer reads the FINAL line only, so "somewhere in the output" is not the claim |
> | **M3** | The transcript delivered as ONE chunk | `1 failed / 15 passed` — a first-chunk-only consumer must not pass |
> | **M4** | An unrecognised `--aoa-fake-*` flag accepted instead of refused | `2 failed / 14 passed` |
> | **M5** | The exhausted-budget short-circuit removed | `2 failed / 14 passed` |
> | **M6** | `input_tokens` renamed to `inputTokens` (claude's field names dropped) | `2 failed / 14 passed` — this is what pins the transcript to the parser rather than to my own reading of it |
> | **N1** | The child env merged with `process.env` | `1 failed / 13 passed` — the planted host variable becomes visible |
> | **N2** | The wrapper check skipped (any `sh -c` program accepted) | `1 failed / 13 passed` |
> | **N3** | A recognised probe with no runner falls back to canned output instead of throwing | `1 failed / 13 passed` |
> | **N5** | The child's **stderr** relayed to the channel instead of its stdout | `2 failed / 12 passed` |
> | **N6** | `NODE_EVAL_WRAPPER_PATTERN` loosened to `/node/` | `1 failed / 13 passed` — the mirror's non-vacuity case |
>
> Reverted: `16 passed (16)` and `14 passed (14)` respectively.
>
> ## 5. The filing
>
> - **Graph node** — `docs/replatform/program-design.md`, in the E6 section after `DEP-018`, in that
>   file's node format. `Depends on:` names only real nodes: `DEP-016`, `DEP-011`, `WRK-017`,
>   `WRK-018`, `JOB-016`.
> - **Task section** — `E6 implementation-plan §4c`, in that plan's format (Current state measured /
>   Outcome / the three units / Non-goals / Files / Interfaces / Failure behavior / Acceptance /
>   Migration / Observability / focused verify command / RED→GREEN / Evidence), plus its `§3`
>   verify-command row. §4c's preamble gains a dated note that `DEP-019` was filed later and is not
>   one of the S0-3 four.
> - **`M1a` required result set** — `scope-triage.md` gains a `DEP-019` row with a truthful
>   *"✅ E6 plan §4c"* cell. The *"THE SET IS NOW TWELVE FILED IDS"* note above the table is left
>   **exactly as written** and a dated note below records that it is thirteen since 2026-09-23.
>   `DEP-016` keeps its own row: `DEP-019` completes that row's gate clause, it does not replace it.
> - **`DEP-016-result.md`** — a dated APPEND (§14) to its attempt history. That record is `complete`
>   and nothing above §14 is touched; `check-evidence-immutability --base origin/docs/replatform-program`
>   is OK (33 base records byte-identical).
> - **The `M1-D1-SPINE` readiness statements** — the M1 execution plan's `M1a` campaign bullet now
>   reads *"the `DEP-016` profile as made worker-driven by `DEP-019`"*, with the superseded text kept
>   verbatim; the E6 plan's `DEP-016` Outcome gains the same dated amendment, explicitly NOT a change
>   to `DEP-016`'s own scope.
>
> ## 6. Guards, and what a reviewer should re-run
>
> - The full `pr.yml` pure-node guard set: **0 failures**, plus
>   `check-evidence-immutability --base origin/docs/replatform-program` OK.
> - `check-test-inventory`: OK at 2859 files; the `packages/sandbox-fake-provider` pin is bumped
>   5 → 8, and only that one. `--write` also wanted to raise unrelated FLOOR counts
>   (`adapter-manager` 11→20, `browser-runtime` 9→11, `db` 58→63, `provider-wire` 3→6); those were
>   reverted, as `DEP-016` reverted the same class — they are other tickets' growth.
> - `check-execution-census`: OK, unchanged at 92 discovered / 89 running / 3 unrun. This ticket adds
>   no `*.test.mjs`; its three new suites are vitest specs in a package the census already covers.
>
> ## 7. WHAT IS NOT BUILT, and why it was not attempted badly
>
> Units B and C are one coherent piece of work. Unit B's verdicts assert over an OBSERVATION whose
> shape only Unit C produces, so writing them first would mean inventing that shape and then
> rewriting the verdict and its fixtures once the live run disagreed — the "a check that evaluates
> nothing" class this programme names first. They were therefore left together, and the ticket's task
> section carries the design rather than this PR carrying a guess.
>
> **The Unit C design, measured at source in this tree** — every item below was read, not reasoned
> about, and each is a real prerequisite that does not exist on the D1 lane today:
>
> | # | What Unit C must do | Measured at |
> |---|---|---|
> | 1 | Host the per-op provider wire on the reference provider. The worker's driver POSTs `/op/<op>` with `{args, ctx, capability}` to an adapter-manager-shaped server; the fake serves `/invoke`, a different protocol. Needs a per-op `SandboxProvider` façade over the fake plus `createProviderServer` in the fake-provider image | `packages/provider-wire/src/driver.ts` `NetworkedProviderDriver#post`; `packages/adapter-manager/src/server.ts`; `docker/d1/fake-provider-entry.mjs` |
> | 2 | Leave the shipped adapter-manager composition root ALONE. `bootAdapterManager` refuses any provider but `"e2b"`; a `fake` arm there would let a DEPLOYED provider host boot with no isolation, which is a fail-open, not a test convenience | `packages/adapter-manager/src/bin/adapter-manager.ts`, `PROVIDER_ENV` |
> | 3 | Make the control plane MINT the run capability. Without `AOA_CONTROL_PLANE_SIGNING_KEY_FILE` the mint is inert, no `ownedLabelsCapability` rides the resolve reply, and every networked run terminates `no_run_capability` **before create** | `server/src/config/control-plane-signing-key.ts`; `supervisor.ts`'s `no_run_capability` arm |
> | 4 | Seed a job that can HOLD the capability. The cap only arrives attached to a resolved handle whose `materialization.kind === "env"` and `usePolicy === "sandbox_local_only"`, on an allow-listed target name | `packages/worker-daemon/src/lease/secret-redemption.ts` (the `continue` at the handle loop; `PROVIDER_AUTH_ENV_TARGETS`) |
> | 4a | …and the broker must resolve it. `createExecutionSecretBrokers(opts.db)` is composed in production, so a seeded handle with a stored value resolves — but **no E6F suite exercises `/worker-control/execution-secrets/resolve` today**, so this path has never run on D1 | `server/src/routes/worker-control.ts`; grep over `tests/d1/lib/e6f-harness.mjs` |
> | 5 | Arm dispatch in the OVERRIDE only, and cover it. `check-d1-dispatch-declared` and `shipped-binary-refuses.test.ts` both read only `docker-compose.d1.yml`, so an override is invisible to them — which is why `evaluateSpineOverrideText` must be extended to hold the override's dispatch and probe posture, or the topology under test would be covered by nothing | `scripts/check-d1-dispatch-declared.mjs` (`composePath`); `scripts/lib/m1-spine-assertions.mjs` |
> | 6 | Give the one deployed worker a spine tenant. `worker-b`'s committed profile is organization-scoped to `aaaaaaaa-…`, which is NOT a spine tenant; the seed accepts a `platform`-scoped profile with `organizationId: null`, which is the route that needs no organization row before first boot | `docker/d1/worker-b.profile.json`; `docker/control-plane/seed-d1-worker-enrolment.mjs` (`targetAuthorityKey`, the `if (fileProfile.organizationId)` guard) |
> | 7 | Reuse the env-probe READ side rather than re-implementing it: `extractEnvProbeSummary` + `evaluateEnvProbeEvidence` are profile-agnostic | `scripts/lib/m1-shipped-boot.mjs` |
>
> **Why not in this session.** Items 1–6 are each a change to a lane or a security surface that has
> never run, and the only way to know they are right is a live D1 bring-up: four images built, a real
> stack up, and at least three control runs (not-the-executor, usage-suppressed, probe-disarmed). A
> topology landed without that run would be a claim with no evidence behind it, and this programme's
> dominant failure class is records that outrun their measurements. Unit A is landed because it is
> complete, proven and independently correct; the rest is handed over with its blockers named at
> source rather than half-built.
>
> **For the planning session, two things that are decisions and not work:**
>
> 1. **The provider-wire host's closure.** Serving `createProviderServer` from the fake-provider image
>    grows that image's runtime closure from *sandbox-fake-provider + worker-protocol + zod* to the
>    adapter-manager's six-package closure, which includes `sandbox-e2b-provider` and therefore the
>    `e2b` SDK, in a harness image that must never hold a provider key. `check-image-deps-stages`
>    does not cover `docker/d1/fake-provider.Dockerfile`, so nothing would red — which is the argument
>    for deciding it deliberately rather than discovering it.
> 2. **Whether one deployed worker may serve both enabled tenants.** The gate says *"one separately
>    deployed worker"*, and F10 wants per-tenant proof. A platform-scoped target (item 6) lets the one
>    worker lease both enabled tenants' seeded attempts; an organization-scoped one does not. If the
>    gate owner reads "one worker" as excluding a platform-scoped target, then only one enabled tenant
>    can be worker-driven and the other stays harness-driven — which is a legitimate outcome but must
>    be recorded on the gate record, not decided by a build agent.
>
> ## 8. Commits
>
> | Commit | What |
> |---|---|
> | `e82d4bd37` | `feat(d1): the reference provider executes a scripted command deterministically (DEP-019 Unit A)` |
> | `db0f07b94` | `feat(d1): the reference provider RUNS the DEP-017 env-absence probe (DEP-019 Unit A)` — ★ this commit also carries `docs/replatform/program-design.md`'s `DEP-019` node, which the next commit's message describes; the node was staged with it. Stated rather than rewritten |
> | `c0ab8a3a3` | `docs(E6): file DEP-019 …` — the task section, the `M1a` row, the `DEP-016` append and the readiness statements |
>
> ## 9. CI evidence
>
> To be recorded, by job with its executed count, in an addendum once the PR's run on the reviewed
> revision completes. This section is not rewritten.
>

---

## Independent review

**Reviewer:** M1 review-batch-4 independent reviewer (Claude Opus 5) — distinct from the DEP-019 build agent and from the M1 planning session. I authored none of this ticket.
**Reviewed revision:** `99bff824d1c4fd641cea3b05ab7fe588f8255b96` (`origin/docs/replatform-program`, the merge of PR #572). `a3f68e9c8`, `cc85ca7d8`, `19ad584a3` and `5e5c1f196` are all ancestors of it.
**Disposition:** `approved`
**Attempt:** 1 (see *Independent review — attempt 1* and the attempt history)

### Independent review — attempt 1

**Disposition: `approved`.** The headline claim — the journey is performed by the deployed worker and
that is ASSERTED rather than observed — holds at source and in CI. One non-blocking finding is
recorded at the end.

- **The worker-driven attempt is judged by the SHARED verdicts, not a second implementation.**
  In `tests/d1/m1-spine.test.mjs`, the `EXECUTOR === "worker"` block calls the same
  `querySpineAttempt` probe the harness path uses and hands its rows to
  `evaluateEnabledTenantSpine`; `evaluateEnabledTenantSpine`
  (`scripts/lib/m1-spine-assertions.mjs`) itself pushes `...evaluateUsageCardinality({tenant, observation})`,
  so both verdicts do run against the deployed worker's own attempt. There is no rival definition of
  either symbol in the lane.
- **The one narrowing is bounded and is the one the record names.** `measuredRuntimeMillis === true`
  drops `runtimeMillis` from the pinned-field set and nothing else: `inputTokens`, `outputTokens` and
  `cachedInputTokens` stay pinned exactly against `M1_SPINE_CANNED_UNITS`, and a missing or negative
  duration reds `usage:runtime_not_measured`. The reason given (the worker takes `runtimeMillis` from
  the supervisor's clock) is stated in `usage-observer.ts`'s own header.
- **The usage-suppressed control reds on the WORKER's parser.** In the final probe job's log the
  suppressed run fails with `AssertionError … worker-driven cost/audit violations:` carrying
  `usage:no_usage_event`, `cost:no_cost_row` and `cost:receipt_missing` — i.e. on the worker-driven
  verdict, not only on harness activity.
- **The not-the-executor control reds on BOTH arms and is not vacuous.** The case reads tenant A's
  own harness-driven attempt, asserts non-vacuity first (`observation.events.length > 0` and
  `harnessDriven.ids.workerId !== deployed.workerId`), then requires both
  `worker_driven:events_not_deployed_worker` and `worker_driven:lease_not_deployed_worker` in the
  codes. The fix for the vacuous first shape is therefore in the code, not only in the prose: the
  earlier shape seeded its own job and read empty rows, and the committed shape cannot, because the
  attempt it judges is the one the per-tenant case recorded. It runs on every execution of the
  profile, and the lane additionally runs `AOA_M1_SPINE_EXECUTOR=harness` requiring the suite's exit
  status to be **0** before it greps.
- **The private signing key is no longer directory-mounted into the provider.**
  `docker/d1/m1-spine.override.yml` binds
  `./docker/d1/runtime-keys/control-plane-signing-key.pem:/keys/control-plane-signing-key.pem:ro`
  into `control-plane` and `./docker/d1/runtime-keys/control-plane-public-key.pem:…:ro` into
  `fake-provider` — two individual files, no directory bind anywhere in the file. The boundary is
  additionally held by `evaluateSpineOverrideText`'s `override:key_directory_mounted`,
  `override:wrong_key_half` and `override:key_mounted_into_unexpected_service` clauses, each with a
  red fixture; `scripts/lib/__tests__/m1-spine-assertions.test.mjs` runs **118 tests, 118 pass, 0
  fail** locally at the reviewed revision, matching the probe job's own `ℹ tests 118`.
- **`assertProbeArgvShape` pins the supervisor's argv.** It is defined in
  `packages/sandbox-fake-provider/src/node-eval.ts`, exported from the package index, and called from
  `node-eval.ts` before anything is spawned. Its suite includes the fail-closed case: with **no**
  pinned metadata URL only the empty value is admitted, and a good argv carrying the real URL throws
  *"not the pinned endpoint"*.
- **The final probe run, read by job and by log.**
  [`35856129644`](https://github.com/MeteoriteLabs/AoA/actions/runs/35856129644), branch
  `claude/m1-dep-019-d1-probe`, head `441b90caa7290d9ccbeb07544ae3b2b418277144`, conclusion
  `success`: **`m1-spine` `107165160976` success**, `d1-merge-train` `107165160905` success,
  **`m1-fault-matrix` `107165161005` success**. From the `m1-spine` log: the verdict self-test
  `tests 118 / pass 118 / fail 0`; `fake-provider GATED provider wire on 0.0.0.0:8082 (1 pinned
  probe-script digest + a pinned probe argv shape; ownership gate ON)`; `running worker services: 1`;
  the profile `tests 10 / pass 10 / fail 0`; and all three control lines, the duplicate one in its
  narrowed wording. §11e quotes the log accurately.
- **The disclosed cross-ticket breakage is real, and the fix is shared.** Run `35853547516` (head
  `3d55763d3`) concluded `failure` with `m1-spine` `107156617625` and `d1-merge-train` `107156617274`
  **success** and `m1-fault-matrix` `107156617510` **failure** — exactly as §11d states. The repair is
  `scripts/generate-d1-spine-keys.mjs`, called from BOTH jobs (`d1-merge-train.yml` line 475 under
  `m1-spine:`, line 715 under `m1-fault-matrix:`), so the required `${…:?}` master key was not
  defaulted away. The script's own redaction fix is at source: `::add-mask::` is emitted only when
  `GITHUB_ENV` is set, and otherwise the script says so and prints nothing.
- **Multi-tenant (F10), real.** `M1_SPINE_TENANTS` is two enabled Organizations (`A`, `B`) plus a
  separate control Organization (`C`); `evaluateSpineRollout` requires both enabled tenants to
  resolve `canary` and the control to resolve `off`, and the isolation case asserts as a ROW fact
  that no attempt of `B` or `C` is placed on the deployed worker's target while `A`'s are.
- **Acceptance (E6 plan §4c `DEP-019`), clause by clause.**
  1. Worker-driven, provably — **evidenced** by `evaluateWorkerDrivenJourney` against the enrolled
     identity, plus the shared cost/usage verdicts on that attempt.
  2. The not-the-executor control reds — **evidenced**, both arms, always-on, non-vacuity asserted.
  3. The usage positive control reds at the worker's real parser — **evidenced** (see the finding
     below for the one place this is weaker than it reads).
  4. `DEP-016` acceptance item 6 closed properly — **evidenced** for the worker-driven tenant, with
     the per-tenant half amended into the plan **keeping the superseded text verbatim** and ruled to
     `M1a-D2-MECHANISM` by locked `E6-D002`. I checked the plan: the amendment is dated, the old
     sentence is quoted, and nothing was rewritten in place.
  5. Multi-tenant unchanged and re-proven — **evidenced**.
  6. Keyless — **evidenced**; no keyed workflow is dispatched by this lane.
- **Guards.** The full `pr.yml` pure-node guard set is **0 failures** at the reviewed revision, plus
  `check-evidence-immutability --base origin/docs/replatform-program`.
- **★ One finding, not blocking — the usage-suppressed CONTROL STEP is not narrowed to the
  worker-driven arm.** The lane step (`d1-merge-train.yml`, *POSITIVE CONTROL — with usage
  suppressed, the profile MUST go red*) accepts any `[m1-spine:cost]` marker in the output. Under
  `suppressed`, tenants A and B's HARNESS-driven attempts also emit `cost:no_cost_row` — I read all
  three failures in the probe log — so deleting the `EXECUTOR === "worker"` cost block added by
  §13.1 would leave the step printing *"the profile went red on the cost assertion, as required"* and
  passing. This is the same family as §13.7 finding 1, which was fixed for the DUPLICATE control by
  requiring `usage:not_exactly_one`, and was not applied to its sibling. **Why it does not block:**
  the primary gate is the GREEN profile run, which does assert `costViolations` is empty on the
  worker-driven attempt, so a worker that stopped parsing usage still reds the lane. What is loose
  is only the control step's reason-grep. The cheap fix is to require a marker unique to the
  worker-driven arm (e.g. `worker-driven cost/audit violations`) alongside `[m1-spine:cost]`.
- **Not blocking, noted.** The section numbering runs 11 → 11b → 11c → 11e → 11d → 11a → 13 → 12,
  which makes the chronology hard to follow on a first read; §11c and §11d are the two a later
  reader most needs and they sit out of order. §11b's sibling-job failure on head `20b9eadcf` is left
  stated rather than re-run, with its reasons; run `35856129644` supersedes it with all three jobs
  green, so I did not hold it open.

**What remains open after this approval:** nothing at this ticket. `E3-F037` stays `unowned` as this
record says, and `E4-F019` (filed by WRK-018) is the open register entry behind §13.5's disposition.

## Review attempt history

| Attempt | Reviewer | Reviewed revision | Disposition | Evidence/findings |
|---:|---|---|---|---|
| 1 | M1 review-batch-4 independent reviewer (Claude Opus 5) | `99bff824d1c4fd641cea3b05ab7fe588f8255b96` | `approved` | Worker-driven attempt judged by the SHARED `querySpineAttempt` + `evaluateEnabledTenantSpine` (which itself calls `evaluateUsageCardinality`); the only narrowing is `measuredRuntimeMillis`, with `usage:runtime_not_measured` as its floor. Suppressed control reds as `worker-driven cost/audit violations` in the probe log. Not-the-executor control asserts non-vacuity then BOTH arms, always-on. Private PEM bound as an individual file into `control-plane` only; three override clauses hold it. `assertProbeArgvShape` called before any spawn, fail-closed with no pinned URL. Probe run `35856129644`: `m1-spine` `107165160976`, `d1-merge-train` `107165160905`, `m1-fault-matrix` `107165161005`, all success; self-test 118/118, profile 10/10. Broken run `35853547516` and the shared `generate-d1-spine-keys.mjs` fix both verified. F10 real (2 enabled Organizations + 1 control). **Finding (non-blocking): the usage-suppressed control step greps only `[m1-spine:cost]`, which the harness attempts also emit — the §13.7 narrowing was not applied to this sibling.** |
| 2 | M1 independent reviewer (Claude Opus 5) | `c25e78f118eb99304ee114df2eb6221d5cec15b2` | `approved` | The withdrawal's three requirements, all met and re-measured at source — see *Independent review — attempt 2* below. |
<!-- Later reviewers append attempt 2 below without replacing this row. -->

## Withdrawal of the `complete` flip — the worker-driven cost control is not worker-specific

**Raised by** Codex on PR #579 (`DEP-019-result.md:1022`). **Verified at source and UPHELD** by the
M1 planning session on 2026-09-23, under ruling F2.

**The defect.** The suppressed-usage positive control (`d1-merge-train.yml`, *"POSITIVE CONTROL —
with usage suppressed, the profile MUST go red"*) proves the profile went red *for the cost reason*
by grepping `[m1-spine:cost]`. That marker is attached to **every** violation whose code starts with
`cost:` (`scripts/lib/m1-spine-assertions.mjs:141`), and `evaluateEnabledTenantSpine` runs on **both**
paths: the harness-driven attempt of §2 and the worker-driven block guarded by
`EXECUTOR === "worker"` (`tests/d1/m1-spine.test.mjs:468`).

**Therefore the mutation that matters survives.** Delete the whole worker-only cost-verdict block and
the suppressed run still fails, still emits `[m1-spine:cost]` from the harness path, and the control
still reports "the profile went red on the cost assertion, as required". The control is real about
*a* cost assertion and says nothing about **who executed** — which is the only thing this ticket
claims. It is the vacuity class the ticket's own §2b control was written to close, one level up: the
control was hardened against a vacuous *subject* and left vacuous in its *reason check*.

**What is required before `complete` is restored.**
1. A **worker-specific** failure marker, distinct from `[m1-spine:cost]`, emitted only by the
   `EXECUTOR === "worker"` verdict — and the suppressed control greps **that**.
2. The mutation as the positive control: with the worker-only block deleted, the suppressed-usage
   step must **fail** on the missing worker marker. Record the red.
3. A same-shape check that the marker cannot be produced by the harness path — otherwise item 1
   reintroduces the same defect under a new name.

**Scope of the withdrawal.** Acceptance items other than the worker-driven cost one are unaffected,
and no evidence already recorded is retracted. What is retracted is the *disposition*: a ticket with
an unmet acceptance item may not read `complete`.

## 14. The fix for the withdrawal — a WORKER-SPECIFIC marker (2026-09-23)

**Author:** Claude Opus 5 (M1 build agent), a session distinct from both the implementer of §0–§13
and the reviewer who withdrew the flip. **Status stays `gate_review`**: only a DISTINCT reviewer
restores `complete`, and only after this lands.

This section discharges the three requirements the withdrawal names. Nothing above it is retracted
or rewritten.

**Revisions.** The live probe runs of §14.6 were taken at
`1e8e852bfa0b8e70ee2a2a64ff24dad0f5f61b30` on `claude/dep-019-worker-marker`: the probe branch head
`824ec906a220595120643996ad93db64e2db2118` is that commit plus the two-line trigger edit, and the
mutation branch head `0e3ca1e09cb7af8273cc64fb8fe91521e24b3529` is the probe branch plus the
deletion. One later code change followed them — the Codex P2 narrowing in §14.2 item 2, which only
**removes** codes from the marker and so cannot make either probe's verdict weaker: the RED run's
worker arm produced no violation of any kind, and the GREEN run's worker arm reds on `cost:` /
`usage:` codes, which still carry it. The self-test's M7 row covers the narrowing itself.

**Placement.** The section the withdrawal names lives on PR #579, which was still open when this was
written, so this lands at the end of the file rather than immediately under it. If #579 merges
first, this section follows it; the ordering is stated so a reader does not read the gap as a lost
edit.

### 14.1 The diagnosis, re-verified at source before building

| Claim | Verified at |
|---|---|
| `[m1-spine:cost]` is attached to EVERY `cost:` code, by one branch | `violation()`, `scripts/lib/m1-spine-assertions.mjs` |
| `evaluateEnabledTenantSpine` runs on the harness attempts too | the per-tenant case in `tests/d1/m1-spine.test.mjs` §2, and `tests/d1/m1-fault-matrix.test.mjs` |
| …and on the worker-only block | the `EXECUTOR === "worker"` block inside the *"the DEPLOYED worker performs tenant A's journey"* case |
| the suppressed-usage step's only reason check was that one grep | `d1-merge-train.yml`, step *"POSITIVE CONTROL — with usage suppressed, the profile MUST go red"* |
| in suppressed mode the worker-driven attempt still reaches `succeeded`, so the deleted block really is the arm that would have red | §4 of this record: `attempt_started · log(env_probe) · terminal` |

The diagnosis holds exactly as written. It is **upheld, not narrowed**.

### 14.2 What shipped

1. **`M1_SPINE_WORKER_COST_MARKER = "[m1-spine:worker-cost]"`**, defined beside
   `M1_SPINE_COST_MARKER` and `M1_SPINE_USAGE_MARKER` — one source of truth, no hand-written
   literal anywhere else.
2. `evaluateEnabledTenantSpine` attaches it to the worker arm's **`cost:` and `usage:`**
   violations when the caller declares `observation.workerDriven === true`. The pre-existing
   markers are not displaced; the lane requires both reasons. ★ It is scoped to those two code
   families **because the lane's two greps are independent** (Codex P2 on this PR, verified at
   source and fixed): the harness attempts always supply `[m1-spine:cost]`, so a marker riding
   every worker-arm violation would let a run whose worker attempt priced correctly but failed on,
   say, `audit:wrong_actor` satisfy both greps — and the step would announce that the worker's cost
   assertion went red when it had not.
3. **Fail-closed on a malformed declaration.** A truthy non-boolean is not read as "worker": it
   raises `journey:worker_driven_flag_invalid` and mints **no** marker, so a typo reds the control
   rather than silently restoring the vacuity.
4. The profile declares it at **exactly one call site**, inside the `EXECUTOR === "worker"` block.
5. The suppressed-usage step greps **both** literals, the second with a failure message naming what
   was not shown: *"the WORKER-DRIVEN cost/audit verdict produced no failure — the claim under test
   is not the one that failed"*.

### 14.3 Why "the harness path cannot produce it" is a check and not a hope

The marker is minted from a caller's declaration, so the guarantee is held at two levels, both of
which go red under mutation (§14.5):

- **Behavioural** — `worker marker: ★ the HARNESS path CANNOT produce it, however broken the attempt
  is`: every arm of the verdict violated at once, with `workerDriven` absent and with it explicitly
  `false`. Non-vacuity is asserted first (the fixture really violates something, and still carries
  `[m1-spine:cost]`), then every message is required to be free of the worker marker.
- **Structural** — `worker marker: the PROFILE declares it exactly once, inside the
  EXECUTOR === "worker" block`: the self-test reads `tests/d1/m1-spine.test.mjs` and requires
  exactly one declaration, preceded by an `EXECUTOR === "worker"` guard that has not closed before
  it, with the harness call site strictly earlier. Moving the declaration to the harness path, or
  adding a second one, reds here.

And a third, against drift between the code and the grep: `worker marker: the d1 lane's
usage-suppressed control greps BOTH literals` reads the workflow and pins the two `grep -F`
arguments to the **constants**, not to copies of them.

### 14.4 RED and GREEN — the pure self-test

`node --test scripts/lib/__tests__/m1-spine-assertions.test.mjs`

| | tests | pass | fail |
|---|---:|---:|---:|
| before this change (`99bff824d1`) | 118 | 118 | 0 |
| after | **125** | **125** | **0** |

The seven new cases are listed in §14.5; each one's RED is the mutation opposite it.

### 14.5 Mutation table — every new assertion shown going red

Each mutation applied alone to the reviewed tree, then reverted.

| # | Mutation | Result |
|---|---|---|
| M1 | drop the `workerDriven === true` arm, so the marker is never minted | RED — `a worker-driven observation carries it on EVERY violation` (123 pass / 1 fail) |
| M2 | mint the marker unconditionally (`if (true)`) | RED — `★ the HARNESS path CANNOT produce it` (123 / 1) |
| M3 | set `M1_SPINE_WORKER_COST_MARKER` equal to `M1_SPINE_COST_MARKER` | RED — `it is DISTINCT …` **and** `★ the HARNESS path CANNOT produce it` (122 / 2) |
| M4 | delete the profile's `workerDriven` declaration | RED — `the PROFILE declares it exactly once …` (123 / 1) |
| M5 | move that declaration to the HARNESS call site of §2 | RED — `the PROFILE declares it exactly once …` (123 / 1) |
| M6 | delete the workflow's second `grep -F` | RED — `the d1 lane's usage-suppressed control greps BOTH literals` (123 / 1) |
| M7 | attach the marker to **every** worker-arm code, not only `cost:`/`usage:` — i.e. revert the Codex P2 fix | RED — `★ an AUDIT-only worker failure does NOT mint it` (124 / 1) |

M2, M3 and M5 are the three shapes of "item 1 renames the defect under a new name"; all three are
caught. M7 is the fourth shape, found by Codex on this PR: a marker that is worker-specific but not
**reason**-specific lets an unrelated worker-arm failure stand in for the cost one.

### 14.6 ★ THE MUTATION THAT MATTERS, ON THE LIVE LANE

Requirement 2 of the withdrawal is not a unit-test property: it is about what the **lane** does. The
`DEP-014` throwaway-probe-branch pattern was used, exactly as §11 did, because `d1-merge-train`
fires only on push to `main` / `docs/replatform-program` and so cannot run on a pull request.

Two branches, neither with a PR and neither merged:

| Branch | Content | `d1-merge-train` run |
|---|---|---|
| `claude/dep-019-worker-marker-d1-probe` | the PR tree + **one** two-line trigger edit | `35872864106`, head `824ec906a2` — **`m1-spine` job `107221163030`: success** |
| `claude/dep-019-worker-marker-d1-mutation` | that, **plus the whole worker-only cost/audit verdict block deleted** | `35872902394`, head `0e3ca1e09c` — **`m1-spine` job `107221292863`: FAILURE, in the step under test** |

The mutation branch also removes the §14.3 structural self-test, and that is stated rather than
hidden: without removing it the job would fail in its **pure preflight** step and never reach the
live control — which would prove the structural pin works, but not the lane-level one. Removing it
is what makes the mutation reach the step under test, and it makes the branch a faithful model of
the defect as the withdrawal describes it: a tree in which nothing but the lane's grep stands
between the deleted block and a green control.

**RED — run `35872902394`, `m1-spine` job `107221292863`, step *"POSITIVE CONTROL — with usage
suppressed, the profile MUST go red"*.** The profile's own result in that step is the defect,
printed:

```
✖ m1-spine: tenant A — a handed-off attempt through the REAL ingest is priced once and audited
✖ m1-spine: tenant B — a handed-off attempt through the REAL ingest is priced once and audited
✔ m1-spine: the DEPLOYED worker performs tenant A's journey — lease, execute, events, terminal
✔ m1-spine: ★ the worker-driven verdict REDS on tenant A's HARNESS-driven attempt (the control)
ℹ tests 10 · pass 8 · fail 2
    - cost:no_cost_row:     [m1-spine:cost] tenant A: the handed-off attempt wrote NO cost_events row
    - cost:receipt_missing: [m1-spine:cost] tenant A: no authoritative_cost receipt
    - cost:no_cost_row:     [m1-spine:cost] tenant B: the handed-off attempt wrote NO cost_events row
```

Read it exactly: the two failures are the **harness** tenants, and the **worker-driven case PASSED**
— because with the block deleted nothing judges its cost or usage at all. Every `[m1-spine:cost]`
in that output belongs to the harness path, so the **old** step would have found its marker and
announced *"the profile went red on the cost assertion, as required"*. The new grep does not:

```
##[error]m1-spine went red with usage suppressed, but the WORKER-DRIVEN cost/audit verdict
         produced no failure — the claim under test is not the one that failed
##[error]Process completed with exit code 1.
```

That is the withdrawal's requirement 2, discharged on the live lane rather than argued.

**GREEN — run `35872864106`, `m1-spine` job `107221163030`: success.** Same lane, unmutated tree:

```
static preflight (self-test):     tests 124 · pass 124 · fail 0
running worker services:          1
the profile (live):               tests 10 · pass 10 · fail 0
usage-suppressed control:         "the profile went red on the cost assertion, on the
                                   worker-driven arm, as required"
duplicate-usage control:          "a duplicate usage event reds the cardinality assertion on the
                                   HARNESS attempts, as required"
not-the-executor control:         "the worker-driven claim is withdrawn and the verdict's red arm
                                   still runs"
```

and, from that step's own output, the marker on the arm that matters — **both** markers on one
violation, which is what "BOTH reasons must hold" means concretely:

```
- cost:no_cost_row:     [m1-spine:worker-cost] [m1-spine:cost] tenant A: the handed-off attempt
                        wrote NO cost_events row
- cost:receipt_missing: [m1-spine:worker-cost] [m1-spine:cost] tenant A: no authoritative_cost
                        receipt
```

The sibling `d1-merge-train` (`107221162804`) and `m1-fault-matrix` (`107221163187`) jobs are
`success` in the same run, so nothing else in the lane moved. ★ Per `E6-F023`: these are
**per-job** conclusions read off the run, not the run conclusion.

### 14.7 Self-audit before the first push (M1-BUILD-RULES §A)

| Family | Finding |
|---|---|
| 1 redaction | nothing new is logged, serialized or uploaded; the marker is a fixed literal |
| 2 vacuous control | the new behavioural case asserts non-vacuity first, and the lane now requires **two** reasons rather than one |
| 3 bounds | no lock, read, upload or retry is introduced |
| 4 replay | no idempotency key or durable write is touched |
| 5 crash windows | no durable write ordering is touched |
| 6 authenticating the right half | **the live one.** The marker rides a caller declaration, so the "right half" is the call site — pinned structurally by §14.3 and exercised by M4/M5 |
| 7 record rot | code cited by symbol; the 118 → 124 count recomputed from the combined tree |
| 8 fail-closed | an absent declaration mints nothing and a malformed one reds without the marker; both leave the control failing |

### 14.8 Guards

The full `pr.yml` pure-node guard set plus
`check-evidence-immutability --base origin/docs/replatform-program`: **0 failures**, run before
every push. `scripts/check-campaign-fault-matrix.test.mjs` 25/25 — it holds the "one shared verdict,
never a second implementation" rule that this change deliberately does not break: the worker-driven
path still calls `evaluateEnabledTenantSpine`, with one added declaration.

### 14.9 What this does NOT claim

- It does not re-open or re-close any other acceptance item, and it owns no finding.
- It does not make the duplicate-usage control reach the worker-driven attempt; §13.7's recorded
  limit is unchanged.
- It does not set `Status: complete`. That is the distinct reviewer's, after this lands.

## Independent review — attempt 2 (2026-09-23): the withdrawal, dispositioned

**Reviewer:** M1 independent reviewer (Claude Opus 5), distinct from the implementer of §0–§13 and
from the author of §14. **Reviewed revision:** `c25e78f118eb99304ee114df2eb6221d5cec15b2` (PR #580,
an ancestor of this branch's HEAD). **Scope:** the three requirements the *"Withdrawal of the
`complete` flip"* section names. Nothing else in the record is re-opened.

**Currency.** `git diff c25e78f118eb99304ee114df2eb6221d5cec15b2..HEAD` touches none of this
ticket's product files (`scripts/lib/m1-spine-assertions.mjs`, `tests/d1/m1-spine.test.mjs`,
`.github/workflows/d1-merge-train.yml`, `scripts/lib/__tests__/m1-spine-assertions.test.mjs`), so
this disposition certifies code that is still live, not a stale revision.

**Requirement 1 — a worker-specific marker, minted only by the worker arm, and the control greps
it.** Met, at source. `M1_SPINE_WORKER_COST_MARKER` is declared beside the other two markers in
`m1-spine-assertions.mjs`; `evaluateEnabledTenantSpine` attaches it only under
`o.workerDriven === true`, and only to `cost:`/`usage:` codes. A non-boolean declaration raises
`journey:worker_driven_flag_invalid` and returns BEFORE the minting branch, so a typo cannot mint
it. `tests/d1/m1-spine.test.mjs` carries exactly one `workerDriven: true`, inside the
`EXECUTOR === "worker"` block. `d1-merge-train.yml`'s *"POSITIVE CONTROL — with usage suppressed"*
step greps both literals, the second with a message naming what was not shown.

**Requirement 3 — the harness path CANNOT mint it.** Met, and by a check rather than an argument.
The behavioural case `worker marker: ★ the HARNESS path CANNOT produce it…` violates every arm at
once with `workerDriven` absent and explicitly `false`, asserts non-vacuity first (the fixture
really violates, and still carries `[m1-spine:cost]`), then requires the worker marker absent from
every message. The structural case pins one declaration inside an unclosed `EXECUTOR === "worker"`
guard with the harness call site strictly earlier.

**Constants pinned equal by a test, not hand-copied.** Met. `worker marker: the d1 lane's
usage-suppressed control greps BOTH literals` reads `d1-merge-train.yml`, slices the named step,
and asserts `grep -F '<constant>'` for both imported constants — so the workflow and the minting
code cannot drift.

**Reproduced on this revision.** `node --test scripts/lib/__tests__/m1-spine-assertions.test.mjs` →
tests 125 · pass 125 · fail 0. Three mutations applied alone and reverted, each red as the table
claims (counts differ by one from §14.5 only because that table was taken on the pre-M7, 124-test
tree):

| Mutation | Observed |
|---|---|
| mint unconditionally (`if (true)`) | RED — `★ the HARNESS path CANNOT produce it` (124 / 1) |
| `M1_SPINE_WORKER_COST_MARKER` = `M1_SPINE_COST_MARKER` | RED — `it is DISTINCT …` **and** `★ the HARNESS path CANNOT produce it` (123 / 2) |

**Requirement 2 — the mutation on the LIVE lane.** Met, and verified against the API rather than the
record's prose. Every cited job matches:

| Job | Name | Conclusion | `head_sha` |
|---|---|---|---|
| `107221163030` | `m1-spine` | `success` | `824ec906a220595120643996ad93db64e2db2118` |
| `107221292863` | `m1-spine` | **`failure`** | `0e3ca1e09cb7af8273cc64fb8fe91521e24b3529` |
| `107221162804` | `d1-merge-train` | `success` | `824ec906a2…` |
| `107221163187` | `m1-fault-matrix` | `success` | `824ec906a2…` |

And the mutation is precise, not merely red: job `107221292863`'s ONLY failed step is number 11,
`POSITIVE CONTROL — with usage suppressed, the profile MUST go red` — the step under test. So the
worker-driven case passing while the harness attempts red is exactly what the new grep refuses,
which is the claim the old `[m1-spine:cost]` grep could not make.

**Reconciled, not a defect.** §14.4 records 125 after the change while §14.7 recomputes "118 → 124".
The 124 is the self-audit's own timestamped figure, taken before the Codex P2 / M7 case was added;
the live figure at this revision is 125, matching §14.4. Left as written, per the no-rewriting rule.

**Not verified at source:** the live probe runs' step LOGS have expired from my reach, so the quoted
profile output in §14.6 is corroborated by job conclusion, head sha and failed-step identity rather
than by re-reading the text. The quoted text is consistent with the code I did read.

**Disposition: `approved`.** All three withdrawal requirements are met, the rest of the acceptance
was approved at attempt 1 and is unaffected, and `Status` is restored to `complete` in a separate
commit.
