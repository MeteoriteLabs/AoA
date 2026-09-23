# DEP-019 — The `m1-spine` journey, driven by the DEPLOYED worker — result

**Status:** `gate_review`. Only a DISTINCT reviewer sets `complete`.
**Epic:** E6 · **Plan task:** `E6 implementation-plan §4c DEP-019` (filed by this PR) · **Milestone:** `M1a`
**Date (UTC):** `2026-09-23`
**Implementer:** Claude Opus 5 (M1 build agent)
**Start SHA:** `b3c5aa4178` (`origin/docs/replatform-program`)
**Owns:** no finding. It does not resolve `E3-F037`, which stays `unowned` as `DEP-016` left it.

---

## 0. THE HEADLINE, STATED FIRST: this ticket is PARTIAL

**Unit A is built and proven. Units B and C are NOT built.** The `m1-spine` journey is still
harness-driven at this head, and this PR does not change that. Nothing below may be read as
evidence that the `M1-D1-SPINE` worker clause is now satisfied — §7 says exactly what remains and
why it was not attempted in this session rather than attempted badly.

What this PR does deliver:

| # | Piece | State |
|---|---|---|
| 1 | The ticket, FILED: graph node, executable task section in three units, `M1a` required-set row, the `DEP-016` attempt-history append, and the `M1-D1-SPINE` readiness statements corrected | done |
| 2 | **Unit A** — the reference provider EXECUTES a scripted command deterministically, writing the transcript a deployed worker's own usage observer parses | done, with RED/GREEN and a 10-row mutation table |
| 3 | **Unit A** — the reference provider RUNS the `DEP-017` env-absence probe faithfully, closing the fork `DEP-016` §4b took | done, same evidence |
| 4 | **Unit B** — the worker-driven verdicts | **not built** (§7) |
| 5 | **Unit C** — the topology, and the live worker-driven run | **not built** (§7) |

---

## 1. Why the ticket exists, measured at `b3c5aa4178`

`M1-D1-SPINE` requires the included lifecycle on *"one control-plane instance, one separately
deployed worker"* (`docs/replatform/epic-regrooming/scope-triage.md`). `DEP-016`'s profile has a
deployed worker service and its journey is nevertheless harness-driven. Three facts, each read at
source on this tree:

| Fact | Where |
|---|---|
| The profile plays the worker itself: `enroll`/`poll`/`ack`/`uploadEvents` are HTTP calls the harness makes, and the provider is reached through the fake's `/invoke` control API from `test-runner` | `tests/d1/m1-spine.test.mjs`, the per-tenant journey case; `tests/d1/lib/e6f-harness.mjs`'s own header: *"There is NO live worker-daemon loop"* |
| The D1 workers do not dispatch | `scripts/d1-dispatch-expectation.json` declares `AOA_WORKER_DISPATCH_ENABLED` **absent** for both; `evaluateD1Dispatch` (`scripts/lib/d1-dispatch-declared.mjs`) fails on either divergence direction; `decideDispatchComposition` (`packages/worker-daemon/src/lifecycle/compose-dispatch.ts`) refuses without it |
| The reference provider runs no command, and its canned usage is invisible to a worker | `FakeSandboxProvider`'s `case "execute"` (`packages/sandbox-fake-provider/src/fake-driver.ts`) returns a terminal state plus `usage` on the CONTRACT driver result. The authoritative per-op `ExecuteResult` (`packages/worker-daemon/src/supervisor/provider.ts`) has **no usage field at all** |

`DEP-016-result.md` §5.3 records all of this as a stated limitation and flags it for a D1 topology
ticket. Its distinct reviewer raised it; the planning session accepted it under F2.

★ **The third fact is the one that decided Unit A's shape.** A deployed worker derives usage from
the run's STDOUT — `ExecuteInput.onStdout` (WRK-018), captured by `run-output.ts`, parsed by
`parseClaudeStreamJsonUsage` (`packages/worker-daemon/src/supervisor/usage-observer.ts`), emitted
by `EventSequencer.usage`. `observeRun` **is** composed in production at this head
(`dispatch-runtime.ts`, `observeRun: createUsageObserver({ metrics: deps.metrics })`) — so the
producer exists and the only missing link is a provider that writes a parseable transcript. That is
Unit A, and it is why Unit A is not "canned usage again": it moves the units from a shape only a
harness reads to the shape the SHIPPED worker parses.

## 2. Unit A, part 1 — the scripted command

`packages/sandbox-fake-provider/src/scripted-command.ts`, exported from the package index.

- `executeScriptedCommand(input, options)` returns a real per-op-shaped `ExecuteResult` and streams
  a `claude --output-format stream-json` transcript to `input.onStdout`. The FINAL non-empty line is
  the `type:"result"` event carrying `FAKE_PROVIDER_CANNED_USAGE_V1`'s counts under claude's own
  field names (`input_tokens`, `output_tokens`, `cache_read_input_tokens`) — the three the observer
  maps. The transcript is delivered in more than one chunk on purpose.
- **The script rides the TENANT COMMAND's `args`**, not the fake's `/script` control endpoint.
  `DEP-016`'s usage mode is per PROVIDER ID, and a worker-driven journey mints the provider id
  inside the worker, so the harness has no id to script. `--aoa-fake-usage=canned|suppressed`,
  `--aoa-fake-exit=<n>`, `--aoa-fake-timeout`; anything outside the `--aoa-fake-` namespace is an
  ordinary agent argument and is passed over.
- **`suppressed` removes the result LINE ENTIRELY**, not merely its `usage` object. The observer
  treats both as "no usage", but only a missing line also proves the LINE is what it reads. This is
  `DEP-016`'s usage positive control, relocated from the harness's forwarding to the worker's real
  parser.
- **Fail-closed.** An unrecognised, malformed or REPEATED scripting flag throws
  `ScriptedCommandError`, before any output reaches the channel. A script that degraded to the
  default would make every positive control vacuous — the profile would assert "usage suppressed
  reds" while the provider quietly reported canned units.
- **The exhausted-budget short-circuit precedes everything**, as `E2bSandboxProvider.execute` does:
  `deadlineMs <= 0` returns `{exitCode: null, signal: "SIGKILL", timedOut: true}` and writes
  nothing. `--aoa-fake-timeout` is the OTHER timeout shape — output first, then the verdict — and
  the two are kept distinguishable.
- **Determinism:** no clock, no randomness, no filesystem; `providerOpId` is the caller's.

## 3. Unit A, part 2 — the `DEP-017` probe is RUN, not scripted

`packages/sandbox-fake-provider/src/node-eval.ts`.

`DEP-016` acceptance item 6 offers two forks and §4b took the second one — *"criterion 5 is
observed only in the `DEP-015` lane"* — for a reason that was true when written and is quoted here
as it stands: *"the reference provider's `execute` runs no command"*. §2 removes that reason. But a
probe is not a transcript: it is a PROGRAM whose output must be a genuine observation, and a fake
that printed a clean summary would be exactly the fabricated pass the acceptance forbids. So it is
EXECUTED:

- `classifyShellInvocation(command, args, env)` recognises the probe by the SHAPE of
  `ENV_PROBE_SH_WRAPPER` (`packages/worker-daemon/src/supervisor/env-probe.ts`) and splits `$0`
  (the script) from `$@` (its argv), exactly as `buildEnvProbeInvocation` assembles them.
- `createNodeEvalRunner()` runs `node -e <script> <argv…>` in a child process whose environment is
  **EXACTLY the request's map** — never merged with `process.env`, not even partially. A merge would
  make the probe report on the fake-provider container instead of on the sandbox.
- The child's real stdout goes to the stream channel and its exit code is the run's. stderr is not
  relayed: the port carries an opaque `stderrRef`, and the probe's no-node marker is a stderr
  contract of the daemon's.

**Fail-closed three ways, each with a test:** only the committed wrapper is recognised (every other
`sh` program is refused, so this is not an arbitrary-execution surface); the env is never merged;
and a recognised probe reaching a provider with **no runner THROWS** rather than being answered with
the scripted transcript.

★ **The vacuity trap is the intended behaviour and was not worked around.** A provider that returns
canned output instead of executing leaves the verdict `not_run` and reds the profile. That is
fail-closed working correctly, and Unit C must not loosen the verdict to accommodate it. It also
sharpens this ticket's own acceptance 2: a fake `execute` that answers with canned output is
precisely the "worker-driven claimed vacuously" case the not-the-executor control must catch.

★★ **WHAT THIS LANE CANNOT OBSERVE, so the record cannot be misread.** A reference sandbox is not
an image: it has no baked environment and no provider-host environment. What the probe observes
here is the **stage-in env only**. The template-baked and provider-host credential classes remain
the keyed `DEP-015` lane's to observe. Unit C's evidence must state this narrowing; it is not
discharged by Unit A.

**The mirror is pinned.** This package imports no worker-daemon code (its closure is
worker-protocol + zod + node built-ins, which is what the fake-provider image's closure is built
on), so the wrapper is matched, not imported. `node-eval-wrapper-mirror.test.ts` reconstructs the
daemon's committed `ENV_PROBE_SH_WRAPPER` from its own source and asserts this package's matcher
accepts it, with a non-vacuity case (a wrapper with the node branch removed must NOT match).
Without that test a wrapper rewrite would surface as every worker-driven `m1-spine` run reding
`env_probe_not_run` — a symptom several layers from its cause. Same pattern and same reason as
`docker/d1/__tests__/enrolment-seed.test.mjs`.

## 4. RED → GREEN, and the mutation table

**TDD order, stated plainly rather than implied.** For `scripted-command.ts` the module was written
before its suite, so there is no module-not-found RED to cite for it; the suite was then run and the
ten mutations below are its non-vacuity evidence. For `node-eval.ts` the first run of
`node-eval.test.ts` was RED for a real defect of my own (`1 failed | 13 passed`): the
probe-argv-cannot-steer-the-fake case passed `--aoa-fake-usage=suppressed` as a positional argument
to `node -e`, which node parses as one of its OWN options and exits 9. The daemon's real probe argv
is entirely positional, so the case was rewritten around a stub runner, which isolates the routing
decision from node's CLI parsing. That is recorded rather than smoothed over.

GREEN, on `db0f07b94`:

```
npx vitest run --root packages/sandbox-fake-provider
→ Test Files 8 passed (8) · Tests 50 passed (50)      (was 6 files / 36, and 5 / 20 before DEP-019)
pnpm --filter @armyofagents/sandbox-fake-provider typecheck   → clean
```

Every row below is a real run with ONE thing changed, reverted afterwards. The suite is 16 tests for
`scripted-command.test.ts` and 14 for the two node-eval files.

| Row | The one thing changed | Result |
|---|---|---|
| **M1** | The `suppressed` arm ignored — the result line is always written | `1 failed / 15 passed` — the suppression control |
| **M2** | A trailing non-result line appended after the transcript | `4 failed / 12 passed` — the observer reads the FINAL line only, so "somewhere in the output" is not the claim |
| **M3** | The transcript delivered as ONE chunk | `1 failed / 15 passed` — a first-chunk-only consumer must not pass |
| **M4** | An unrecognised `--aoa-fake-*` flag accepted instead of refused | `2 failed / 14 passed` |
| **M5** | The exhausted-budget short-circuit removed | `2 failed / 14 passed` |
| **M6** | `input_tokens` renamed to `inputTokens` (claude's field names dropped) | `2 failed / 14 passed` — this is what pins the transcript to the parser rather than to my own reading of it |
| **N1** | The child env merged with `process.env` | `1 failed / 13 passed` — the planted host variable becomes visible |
| **N2** | The wrapper check skipped (any `sh -c` program accepted) | `1 failed / 13 passed` |
| **N3** | A recognised probe with no runner falls back to canned output instead of throwing | `1 failed / 13 passed` |
| **N5** | The child's **stderr** relayed to the channel instead of its stdout | `2 failed / 12 passed` |
| **N6** | `NODE_EVAL_WRAPPER_PATTERN` loosened to `/node/` | `1 failed / 13 passed` — the mirror's non-vacuity case |

Reverted: `16 passed (16)` and `14 passed (14)` respectively.

## 5. The filing

- **Graph node** — `docs/replatform/program-design.md`, in the E6 section after `DEP-018`, in that
  file's node format. `Depends on:` names only real nodes: `DEP-016`, `DEP-011`, `WRK-017`,
  `WRK-018`, `JOB-016`.
- **Task section** — `E6 implementation-plan §4c`, in that plan's format (Current state measured /
  Outcome / the three units / Non-goals / Files / Interfaces / Failure behavior / Acceptance /
  Migration / Observability / focused verify command / RED→GREEN / Evidence), plus its `§3`
  verify-command row. §4c's preamble gains a dated note that `DEP-019` was filed later and is not
  one of the S0-3 four.
- **`M1a` required result set** — `scope-triage.md` gains a `DEP-019` row with a truthful
  *"✅ E6 plan §4c"* cell. The *"THE SET IS NOW TWELVE FILED IDS"* note above the table is left
  **exactly as written** and a dated note below records that it is thirteen since 2026-09-23.
  `DEP-016` keeps its own row: `DEP-019` completes that row's gate clause, it does not replace it.
- **`DEP-016-result.md`** — a dated APPEND (§14) to its attempt history. That record is `complete`
  and nothing above §14 is touched; `check-evidence-immutability --base origin/docs/replatform-program`
  is OK (33 base records byte-identical).
- **The `M1-D1-SPINE` readiness statements** — the M1 execution plan's `M1a` campaign bullet now
  reads *"the `DEP-016` profile as made worker-driven by `DEP-019`"*, with the superseded text kept
  verbatim; the E6 plan's `DEP-016` Outcome gains the same dated amendment, explicitly NOT a change
  to `DEP-016`'s own scope.

## 6. Guards, and what a reviewer should re-run

- The full `pr.yml` pure-node guard set: **0 failures**, plus
  `check-evidence-immutability --base origin/docs/replatform-program` OK.
- `check-test-inventory`: OK at 2859 files; the `packages/sandbox-fake-provider` pin is bumped
  5 → 8, and only that one. `--write` also wanted to raise unrelated FLOOR counts
  (`adapter-manager` 11→20, `browser-runtime` 9→11, `db` 58→63, `provider-wire` 3→6); those were
  reverted, as `DEP-016` reverted the same class — they are other tickets' growth.
- `check-execution-census`: OK, unchanged at 92 discovered / 89 running / 3 unrun. This ticket adds
  no `*.test.mjs`; its three new suites are vitest specs in a package the census already covers.

## 7. WHAT IS NOT BUILT, and why it was not attempted badly

Units B and C are one coherent piece of work. Unit B's verdicts assert over an OBSERVATION whose
shape only Unit C produces, so writing them first would mean inventing that shape and then
rewriting the verdict and its fixtures once the live run disagreed — the "a check that evaluates
nothing" class this programme names first. They were therefore left together, and the ticket's task
section carries the design rather than this PR carrying a guess.

**The Unit C design, measured at source in this tree** — every item below was read, not reasoned
about, and each is a real prerequisite that does not exist on the D1 lane today:

| # | What Unit C must do | Measured at |
|---|---|---|
| 1 | Host the per-op provider wire on the reference provider. The worker's driver POSTs `/op/<op>` with `{args, ctx, capability}` to an adapter-manager-shaped server; the fake serves `/invoke`, a different protocol. Needs a per-op `SandboxProvider` façade over the fake plus `createProviderServer` in the fake-provider image | `packages/provider-wire/src/driver.ts` `NetworkedProviderDriver#post`; `packages/adapter-manager/src/server.ts`; `docker/d1/fake-provider-entry.mjs` |
| 2 | Leave the shipped adapter-manager composition root ALONE. `bootAdapterManager` refuses any provider but `"e2b"`; a `fake` arm there would let a DEPLOYED provider host boot with no isolation, which is a fail-open, not a test convenience | `packages/adapter-manager/src/bin/adapter-manager.ts`, `PROVIDER_ENV` |
| 3 | Make the control plane MINT the run capability. Without `AOA_CONTROL_PLANE_SIGNING_KEY_FILE` the mint is inert, no `ownedLabelsCapability` rides the resolve reply, and every networked run terminates `no_run_capability` **before create** | `server/src/config/control-plane-signing-key.ts`; `supervisor.ts`'s `no_run_capability` arm |
| 4 | Seed a job that can HOLD the capability. The cap only arrives attached to a resolved handle whose `materialization.kind === "env"` and `usePolicy === "sandbox_local_only"`, on an allow-listed target name | `packages/worker-daemon/src/lease/secret-redemption.ts` (the `continue` at the handle loop; `PROVIDER_AUTH_ENV_TARGETS`) |
| 4a | …and the broker must resolve it. `createExecutionSecretBrokers(opts.db)` is composed in production, so a seeded handle with a stored value resolves — but **no E6F suite exercises `/worker-control/execution-secrets/resolve` today**, so this path has never run on D1 | `server/src/routes/worker-control.ts`; grep over `tests/d1/lib/e6f-harness.mjs` |
| 5 | Arm dispatch in the OVERRIDE only, and cover it. `check-d1-dispatch-declared` and `shipped-binary-refuses.test.ts` both read only `docker-compose.d1.yml`, so an override is invisible to them — which is why `evaluateSpineOverrideText` must be extended to hold the override's dispatch and probe posture, or the topology under test would be covered by nothing | `scripts/check-d1-dispatch-declared.mjs` (`composePath`); `scripts/lib/m1-spine-assertions.mjs` |
| 6 | Give the one deployed worker a spine tenant. `worker-b`'s committed profile is organization-scoped to `aaaaaaaa-…`, which is NOT a spine tenant; the seed accepts a `platform`-scoped profile with `organizationId: null`, which is the route that needs no organization row before first boot | `docker/d1/worker-b.profile.json`; `docker/control-plane/seed-d1-worker-enrolment.mjs` (`targetAuthorityKey`, the `if (fileProfile.organizationId)` guard) |
| 7 | Reuse the env-probe READ side rather than re-implementing it: `extractEnvProbeSummary` + `evaluateEnvProbeEvidence` are profile-agnostic | `scripts/lib/m1-shipped-boot.mjs` |

**Why not in this session.** Items 1–6 are each a change to a lane or a security surface that has
never run, and the only way to know they are right is a live D1 bring-up: four images built, a real
stack up, and at least three control runs (not-the-executor, usage-suppressed, probe-disarmed). A
topology landed without that run would be a claim with no evidence behind it, and this programme's
dominant failure class is records that outrun their measurements. Unit A is landed because it is
complete, proven and independently correct; the rest is handed over with its blockers named at
source rather than half-built.

**For the planning session, two things that are decisions and not work:**

1. **The provider-wire host's closure.** Serving `createProviderServer` from the fake-provider image
   grows that image's runtime closure from *sandbox-fake-provider + worker-protocol + zod* to the
   adapter-manager's six-package closure, which includes `sandbox-e2b-provider` and therefore the
   `e2b` SDK, in a harness image that must never hold a provider key. `check-image-deps-stages`
   does not cover `docker/d1/fake-provider.Dockerfile`, so nothing would red — which is the argument
   for deciding it deliberately rather than discovering it.
2. **Whether one deployed worker may serve both enabled tenants.** The gate says *"one separately
   deployed worker"*, and F10 wants per-tenant proof. A platform-scoped target (item 6) lets the one
   worker lease both enabled tenants' seeded attempts; an organization-scoped one does not. If the
   gate owner reads "one worker" as excluding a platform-scoped target, then only one enabled tenant
   can be worker-driven and the other stays harness-driven — which is a legitimate outcome but must
   be recorded on the gate record, not decided by a build agent.

## 8. Commits

| Commit | What |
|---|---|
| `e82d4bd37` | `feat(d1): the reference provider executes a scripted command deterministically (DEP-019 Unit A)` |
| `db0f07b94` | `feat(d1): the reference provider RUNS the DEP-017 env-absence probe (DEP-019 Unit A)` — ★ this commit also carries `docs/replatform/program-design.md`'s `DEP-019` node, which the next commit's message describes; the node was staged with it. Stated rather than rewritten |
| `c0ab8a3a3` | `docs(E6): file DEP-019 …` — the task section, the `M1a` row, the `DEP-016` append and the readiness statements |

## 9. CI evidence

To be recorded, by job with its executed count, in an addendum once the PR's run on the reviewed
revision completes. This section is not rewritten.
