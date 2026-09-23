# DEP-019 — The `m1-spine` journey, driven by the DEPLOYED worker — result

**Status:** `gate_review`. Only a DISTINCT reviewer sets `complete`.
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
| Keys generated IN the job, never committed, never printed, covered by the leak scan | `docker/d1/runtime-keys/` is git-ignored; the lane generates the ed25519 pair and the master key, `::add-mask::`s the master key before it reaches `GITHUB_ENV`, and prints neither. Two override clauses red on committed PEM material and on a literal master key |
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

## 11. CI evidence

To be recorded, by job with its executed count, in an addendum. This section is not rewritten.

---

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
