# Blocker A + B fix — design (Unit 1 of 2: "the mechanism")

**Status:** design (2026-08-31) · **Branch:** `docs/replatform-program` · **Tip:** `65eafb34b`
**Purpose:** make a real distributed run POSSIBLE. Today it is not: no lease can ever be offered (A), and no shipped
worker image can construct a provider (B). Both verified against source; see
[`2026-08-31-campaign-blockers-and-fleet-terrain.md`](./2026-08-31-campaign-blockers-and-fleet-terrain.md) §1–§2.

**This is Unit 1 of a deliberate two-unit sequence.** Unit 1 proves the MECHANISM (lease → sandbox → execute →
terminal → projection) with an honestly-degraded agent. **Unit 2 (separate, owed) delivers FULL CAPABILITY** — MCP
tools, the skills/instructions bundle, workspace, and prompt delivery beyond argv. Unit 1 does not pretend to be
Unit 2, and the acceptance language below says so explicitly.

---

## 1. THE CONSTRAINT THAT SHAPES EVERYTHING: argv is the only channel

Verified: `createSpecFor` (`packages/worker-daemon/src/supervisor/supervisor.ts:275-281`) reads **only**
`workload.command` and `workload.args`, producing `{resourceLabels, command, args, env, workloadType}`.
`ExecuteInput` (`packages/worker-daemon/src/supervisor/provider.ts:200-205`) has **no stdin field**.
`stdinArtifactId` has **zero consumers** — every non-test occurrence in the repo is literally `: null`.
`workspace` is hard-coded `null` (`server/src/services/job-leasing.ts:373`). `env` carries only redeemed secret
handles.

The legacy `claude_local` adapter, by contrast, delivers the prompt on **stdin** (`--print -` +
`stdin: prompt`, `packages/adapters/claude-local/src/server/execute.ts:736,879`) and passes `--mcp-config`,
`--append-system-prompt-file`, `--add-dir` — all **host paths that do not exist inside an E2B sandbox**.

⇒ Unit 1 delivers the prompt as an argv element. That is sufficient to execute, and insufficient for full
capability. Unit 2 exists to close exactly that gap.

## 2. ★ The shadow comparator's mapping is NOT reusable (checked first, rejected)

`job-shadow-comparator.ts` does not BUILD a workload — it VALIDATES a caller-supplied one (`:320-325` reads four
fields off `snapshot.workloadCharacterization`). Every call site hand-writes literals, and the task-run one
(`heartbeat.ts:5193-5198`) uses `command: agent.adapterType` = `"claude_local"` — **an adapter-registry key, not a
binary on PATH**. Its own comment concedes the values are placeholders ("faithful, worker-executable synthesis is
refined at MIG-002" — which never landed). Reusing it verbatim would lease a job that dies `exit 127`.
**Mirror its SHAPE; never its VALUES.**

## 3. Blocker A — the fix

**Seam: `heartbeat.ts` at the canary call site (~`:5234`).** The optional `input` parameter is ALREADY plumbed end
to end (`heartbeat-distributed-rollout.ts:83,148` → `run-execution-owner.ts:188,253` → `job-convert-orchestrator.ts:58`
→ `job-admission-bridge.ts:262`); the pipe exists and nothing is pushed into it. **No signature churn.**
Rejected alternatives: the rollout hook has no agent context; `run-execution-owner` sees only
`{source, actor, organizationId, workloadType, idempotencyKey}` (no adapter/config/model) and would need a new DB
read plus an adapter-registry dependency inside the ownership decision; `job-admission-bridge` would apply to
**every** source kind (`task_run`/`commander_turn`/`crew_run`/`one_shot` all map to `batch`) and drag the registry
across the JOB-010 parity boundary. Only the heartbeat seam has `agent`, `adapter`, `runScopedConfig`,
`runtimeCommandSpec`, `executionTarget`, `issueContext` and the rendered prompt in one scope.

**A new PURE helper** `server/src/services/task-run-batch-workload.ts`, unit-testable, self-validating against
`batchWorkloadV1Schema`, returning a discriminated `{ok: true, workload} | {ok: false, reason}`:

| Field | Value | Source / rule |
|---|---|---|
| `command` | `"claude"` | `runtimeCommandSpec.command` — already destructured at `heartbeat.ts:5047`, in scope at the seam. **Honors the founder's `adapterConfig.command` override** (`registry.ts:157`). ★ NOT `agent.adapterType`. |
| `args` | `["--print", <prompt>, "--output-format", "stream-json", "--verbose"]` | Minimum viable executable form. `buildClaudeArgs` is private to the adapter's `execute`; a faithful builder is Unit 2. |
| `stdinArtifactId` | `null` | Correct — nothing consumes it. A non-null value would be inert. |
| `maxRuntimeSeconds` | `clamp(effectiveTimeoutSec, 1, 86400)`, default `600` | `resolveHeartbeatRunTimeoutPolicy` (`heartbeat-stop-metadata.ts:50-78`). ★ The clamp is MANDATORY: `defaultTimeoutSecForAdapter` can return `0` and the schema is `min(1)`. |

★ **Why 600 is both the default and the effective ceiling:** placement demand is
`Math.min(600, provider.maxContinuousRuntimeSeconds)` (`job-placement.ts:198`, `job-leasing.ts:222`) and **ignores**
`job.input.maxRuntimeSeconds`. A larger workload value would set an envelope deadline the negotiated provider demand
does not back.

★ **Determinism is REQUIRED.** `job-submission.ts:131` hashes the whole command *including* `input`; a differing
digest under the same `idempotencyKey` (= `run.id`) throws **409** (`:310-311`). **No timestamps, no nonces, no
`randomUUID()` in the workload.**

### 3.1 ★ The prompt-size rule: REFUSE, never truncate

`args` elements are capped at 8192 chars (`packages/worker-protocol/src/job.ts:292`) and the whole `jobs.input` at
64 KiB. A rendered AoA prompt (system prompt + task + memory) routinely exceeds 8 KiB. **If the prompt does not fit,
the builder MUST refuse** (`{ok: false, reason: "workload_unavailable"}`) → the run falls back to legacy, logged.
**Silent truncation is forbidden** — it would produce a sandbox that runs a mutilated prompt and still terminalizes
`succeeded`, which the E7-1 verifier would PASS (§6). Refusing is the honest failure, and it is the concrete
motivation for Unit 2.

### 3.2 Fail-closed + ★ the reasons are currently DISCARDED

Add `workload_unavailable` to the fallback vocabulary (`run-execution-owner.ts:113-123`, today:
`rollout_not_canary | preflight_refused | convert_failed | placement_not_leasable | transfer_error`).

★ **A new reason ALONE is invisible.** Every consumer of `canaryExecutionOwner` in `heartbeat.ts` reads only
`owner`/`jobId`/`attemptId`; the `reason`/`detail` is **never logged and never persisted** (contrast the CLI-005
seam at `:5275-5278`, which does log). **So the fix MUST add a `logger.warn` at the seam** carrying the reason —
otherwise a refusing canary is indistinguishable from a canary that never fired.

### 3.3 Do NOT promote the `batch` validator slot in this change

`workload-input-validators.ts:59-65` keeps `batch` `not_enforced` by design. Promotion here would (a) break the
**CLI-005 active-mode convert** (`heartbeat.ts:3260-3264`), which deliberately passes no `input` to mint a durable
*non-leasable* job — promotion silently degrades it from "converted, inert" to "not converted"; and (b) newly 400
~18 three-arg `admitAndSubmit` calls in the real-DB integration suites. Validate INSIDE the builder instead.
Promotion is a Unit-2/follow-on decision.

## 4. Blocker B — the fix

**`networked-host.ts` gives BOTH halves** (verified): it wraps `runContainerHost` (⇒ `FileRecordStore` custody ⇒
`resolveCustody("file_record")` ok ⇒ the enrolment block at `worker-daemon.ts:327-331` runs) **and** injects
`makeNetworkedRunProvider(url)` (⇒ gate 1 `no_provider` satisfied). Its only new env is
`AOA_WORKER_PROVIDER_URL`; unset ⇒ `{kind:"none"}` ⇒ byte-identical inert boot.

### 4.1 ★ THE TRAP: `--filter` vs `--filter-prod`

`computeRuntimeClosure` walks **`.dependencies` only** (`scripts/lib/image-deps-stage.mjs:170`). pnpm's `...`
selector walks **dev+prod**. Measured:
```
pnpm list --filter      "@armyofagents/worker-networked-host..."  -> 8 pkgs (adds sandbox-fake-provider)
pnpm list --filter-prod "@armyofagents/worker-networked-host..."  -> 7 pkgs (== computeRuntimeClosure)
```
`sandbox-fake-provider` enters as a **devDep of `sandbox-provider-contract`**. So a plain `--filter` install needs a
manifest the guard forbids copying → the exact Blocker-D asymmetry. **`--filter-prod` in the deps stage is the
resolution** — its traversal is byte-identical to the guard's.

**Rule that cannot break: every stage installs against exactly the manifest set that stage contains.**
Never add `COPY . .` to the worker image (it would also make the `dockerfile-static` exclusion greps vacuous, and
unlike control-plane there is no `copiesWholeBuildTree` anti-vacuity guard on the worker).

- **deps stage:** COPY the 7 closure manifests; `pnpm install --frozen-lockfile --prod --filter-prod
  "@armyofagents/worker-daemon..." --filter-prod "@armyofagents/worker-networked-host..."`.
- **build stage:** additionally COPY `sandbox-fake-provider`'s manifest + the package trees, then re-install
  **non-prod** against the manifest set this stage actually has (8 == the filter's selection), then
  `pnpm --filter "@armyofagents/worker-networked-host..." build` (topological, replaces the hand-rolled `tsc -p`).
- ★ **`apply-workspace-publish-config.mjs` is NEWLY REQUIRED** (today's worker image does not need it):
  `provider-wire`, `provider-capability`, `worker-networked-host` export `./src/*.ts` in dev with `files:["dist"]`;
  without the promotion, `node …/networked-host.js` dies `ERR_MODULE_NOT_FOUND`. **The failure appears at container
  START, not at build** — easy to omit, painful to diagnose.
- **Two deploy trees, deliberately:** keep `/worker-app` untouched (`image-contents.test.mjs:91` and
  `dockerfile-static.test.mjs:211` assert it) and put the new bin at `/worker-net-app/dist/bin/networked-host.js`.
- **production stage:** one added `COPY --chown=node:node --from=build /worker-net-app /worker-net-app`.
  ★ **Leave `CMD` unchanged.**

### 4.2 ★ Never repoint the image CMD

`runContainerHost` constructs `FileRecordStore`s **unconditionally** (`container-host.ts:118-125`) and
`resolveCustody` REFUSES `mounted_secret` with stores present (`device-identity-store.ts:116-133`), exiting **before
the health socket binds** (`worker-daemon.ts:254-259`). Every deployed worker today is `mounted_secret` (both
compose files). A global CMD repoint would **crash-loop the entire fleet**. The new bin is an OPT-IN second
entrypoint via a per-service `command:` override (`entrypoint.sh:16` is `exec "$@"`, so it flows through).

### 4.3 ★ Fix `docker/adapter-manager/Dockerfile` in the same pass (a defect I shipped)

It has the **identical** latent defect: 7 manifests (`:50-56`) + plain `--filter "@armyofagents/adapter-manager..."`
(`:63`) → selects 8 → `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`. It has never been built in CI (the build/sign wiring was
deliberately kept out of the Slice 4+5 PR), so nothing exercised it. **One-word fix: `--filter` → `--filter-prod`.**
★ Note the lesson: Slice 4+5 P1 opted INTO `check-image-deps-stages` for "least-privilege parity", the guard went
GREEN, and the image was still unbuildable — because the guard's model (`.dependencies`) diverges from pnpm's actual
traversal (dev+prod). **A green guard proved the wrong property.**

### 4.4 Guard lockstep (exact)

| File | Change | If skipped |
|---|---|---|
| `scripts/check-image-deps-stages.mjs:41-44` | `entryPackages: ["@armyofagents/worker-daemon", "@armyofagents/worker-networked-host"]` | `policy` red: 5× "COPYs … OUTSIDE the image closure" |
| `scripts/check-image-deps-stages.test.mjs` | add `worker-networked-host` to `WORKSPACE` (`:38-115`); extend `WORKER_DEPS` (`:124-127`) 2 → 7 | `policy` red: entry pkg not in workspace + MISSING manifests; the exact-closure baseline test reds |
| `scripts/boot-roots-expectation.json:24-29` | update the "Ships INERT: no image runs this bin" **prose** | none (prose only — `evaluateBootRoots` never reads `reason`); update for HONESTY |

Unaffected (verified): `dockerfile-static.test.mjs` (its worker exclusion list names none of the new COPYs);
the combined-root awk step (`worker-networked-host` is already at `Dockerfile:79`); `check-guard-inventory`
(no new guard); `check-test-inventory` (`server` is in **floor** mode); the AM/e2b/fake-provider boundary checkers
(package-source scoped). ★ `resolveProviderUrl`'s `return { kind: "none" };` marker must stay literally intact.

### 4.5 Staging stays dispatch-off — touch nothing

`checkDispatchDefaultOff` bans `AOA_WORKER_DISPATCH_ENABLED` / `AOA_WORKER_SANDBOX_PROVIDER` on worker services
(env AND inline in `command:`/`entrypoint:`). **`AOA_WORKER_PROVIDER_URL` is NOT banned** and is already documented.
No staging worker sets it or overrides `command:`, so the image change is **inert on staging** — all four keep
booting the bare daemon. The campaign runs from its own overlay, which no compose checker reads.

### 4.6 Accept + correct: the e2b SDK now ships in the worker image

`provider-wire`'s `driver.ts:50` / `codec.ts:26` are **value** imports of `sandbox-e2b-provider/errors.js` (the
modelled error vocabulary), so `sandbox-e2b-provider` is unavoidably in the worker closure. Structurally safe — the
worker never receives `E2B_API_KEY` and never imports the transport — but **DEP-001's "closure is EXACTLY
worker-daemon + worker-protocol + pino" prose becomes false and must be rewritten**, not left standing.

## 5. File Blocker A as a real finding

It has been carried **verbal-only since BRW-001 F3** ("NOT FIXED HERE, BY DECISION") and is **absent from
`scripts/finding-ownership.json`** — no ticket, no owner. File it with an owning ticket in the same change.
Mind E4-F013: an open finding needs an owner that exists on disk; a completed owner needs a checkable `successor`.

## 6. ★ Acceptance language — what a green run does and does NOT mean

The E7-1 verifier is **terminal-agnostic**: `failed` and `timed_out` PASS, and `producedArtifacts` is reported but
never fails a run. **A sandbox where `claude` exits 127 yields a verifier PASS.** Therefore Unit 1's acceptance is
NOT "the verifier is green". It is:
1. a real **lease** is offered and acked (the thing that is impossible today);
2. a real **E2B sandbox** is created from `aoa-base` (confirm provider identity by hand — the verifier does not);
3. `claude` actually **executes** (confirm a non-127 exit and real stdout, not merely a terminal status);
4. the attempt terminalizes and the **projection receipt** is applied.
Anything less is reported as such. **"E7-1 wired" on Unit 1 means the MECHANISM works with a degraded agent** — and
must be labelled that way in the gate `reason`, because nothing machine-checks that claim (§6 of the terrain doc:
the gate flip is pure prose).

## 7. Sub-slicing (build order)

1. **A1** — the pure `task-run-batch-workload.ts` builder + unit tests (incl. the >8 KiB refusal and determinism).
2. **A2** — the seam: pass `input` at `heartbeat.ts`, add `workload_unavailable` + **the log line**.
3. **B1** — `docker/worker/Dockerfile` (+ the one-word `docker/adapter-manager/Dockerfile` fix) + the
   `check-image-deps-stages` lockstep + fixtures + prose corrections.
4. **F** — file Blocker A in `finding-ownership.json` with an owning ticket.

## 7.5 ★ EMPIRICAL VALIDATION (2026-08-31) — the invocation was TESTED, not assumed

Run against a real `aoa-base` sandbox on the campaign E2B account, with **only `ANTHROPIC_API_KEY`** in env — no MCP
config, no settings file, no `--allowedTools`:

```
sandbox created: izhhtobns40u6a2i7rnmt (1109ms)
claude present: exit=0 :: /usr/local/bin/claude   2.1.251 (Claude Code)
exitCode: 0
stdout: {"type":"system","subtype":"init","cwd":"/home/user","session_id":"…",
         "tools":["Task","Bash","Edit","Read","Write","WebFetch","WebSearch",…],
         "mcp_servers":[], "model":"claude-opus-5[1m]", "permissionMode":"default"}
```

**Proven:** (1) the template is correct — `claude` is on PATH and runs; (2) **the exact argv form in §3 exits 0** and
emits valid `stream-json`; (3) it does NOT hang awaiting stdin and does NOT demand config we are not passing;
(4) `ANTHROPIC_API_KEY` alone authenticates; (5) E2B create→exec→kill works with the campaign credentials.

★ **The degradation is now MEASURED: `"mcp_servers": []`.** Crucially, the **built-in** tools (`Bash`, `Edit`,
`Read`, `Write`, `Task`) ARE present. So Unit 1 yields a genuinely functional *coding* agent inside the sandbox;
what it lacks is the **AoA MCP tool surface** — `ask_human`, memory, skills — i.e. the ability to call back into AoA.
That is the precise, defensible characterization for the gate `reason`, and precisely what Unit 2 closes.

## 8. Open questions for the adversarial review

1. ~~**Executability.**~~ **ANSWERED EMPIRICALLY — see §7.5.** The invocation exits 0 with real output. Remaining
   sub-question for the reviewer: does anything about running it through the *supervisor* (`createSpecFor` → provider
   `execute`, no TTY, env from redeemed handles only) differ from this direct `commands.run` probe in a way that
   would change the outcome?
2. **The 8 KiB refusal.** Is refusing correct, or should Unit 1 ship a bounded, explicitly-labelled prompt
   (e.g. task text only, no memory) so the canary can run? Which is more honest?
3. **Determinism.** Is the prompt rendering at the seam stable across retries under the same `run.id`? Anything
   time/UUID-derived in the rendered prompt would 409 on the idempotency digest.
4. **The Dockerfile.** Does the two-stage `--filter-prod` (deps) / non-prod (build) split actually install and build,
   and does `apply-workspace-publish-config` make `networked-host.js` runnable? Any trap the plan missed?
5. **Guards.** Any guard the §4.4 lockstep missed (the recurring failure class)?
6. **Scope.** Is anything here actually Unit 2 in disguise (i.e. does Unit 1 secretly require MCP/workspace to
   produce a non-127 exit)?
