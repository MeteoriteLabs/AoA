# DEP-017 Result — a live env-absence probe on the distributed stage-in path

**Status:** `gate_review`. The **keyed acceptance is PENDING**: it needs one dispatched keyed run of
`m1-shipped-boot.yml` (the F8 named list), which is the planning session's to dispatch. Nothing here
was dispatched.
**Date (UTC):** `2026-09-23`
**Epic:** `E6-deployment-test-harness`
**Plan task:** `E6 implementation-plan §4c DEP-017 — A live env-absence probe on the distributed stage-in path (M, ≤3 agent-days, M1a)`
**Specification:** founder ruling **F9** (M1 plan §2) — build the probe; criterion 5 observed, with a
planted-canary positive control, the dormant-egress residual (DE-08) recorded and no
egress-enforcement claim. Multi-tenant per ruling **F10**.
**Implementer:** `M1 build agent (Claude Opus 5)`
**Start SHA:** `dd839129b` (program tip `docs/replatform-program`, the candidate the DEP-015 keyed
journey passed on)
**PR:** see the branch `claude/m1-dep-017-probe` (base `docs/replatform-program`)

The implementer leaves `Status` at `gate_review`. Only a DISTINCT reviewer may set `complete`.

---

## 1. What shipped

1. **The probe** — `packages/worker-daemon/src/supervisor/env-probe.ts`.
   - `ENV_PROBE_SCRIPT`: the exact bytes that run **inside the sandbox** under `node -e`. It reads
     its own `process.env`, classifies each NAME against the §9 credential taxonomy
     (`ENV_PROBE_CREDENTIAL_CLASSES`) plus a credential-shape heuristic
     (`ENV_PROBE_UNCLASSIFIED_PATTERN`), and classifies each VALUE only for the public canary marker
     (`ENV_PROBE_CANARY_MARKER`) — a marked value belonging to another Organization is
     `cross_tenant_credential`. It prints ONE line, `DEP017_ENV_PROBE {json}`, of **class names and
     env-var names only**. It never prints a value, a marker tail or an Organization id.
   - `ENV_PROBE_SH_WRAPPER`: the `sh -c` wrapper the invocation actually runs. With `node` present it
     `exec`s the probe; without it, it prints `DEP017_PROBE_NO_NODE` and exits `78`, so "the image
     has no node" is a NAMED cause, not an anonymous non-zero exit.
   - `runEnvProbe`: runs the probe twice in the SAME live sandbox — once with the run's own env, then
     once with the **planted control** (`buildPlantedControl`): `DATABASE_URL` = an own-Organization
     canary (a name-class case) and `OPENAI_API_KEY` = a **foreign Organization's** canary (an
     ALLOWED name whose value only the marker can catch). The planted values are random per run and
     are pushed into the run's live canary array **before** the control executes.
   - The VALUE-IDENTITY check (`envProbeExpectedDigests`, added for Codex P1): the worker hands the
     probe a per-run random salt and `sha256(salt + expectedValue)` for every credential THIS run
     redeemed, and the probe reports, **by NAME only**, which allowed names hold a value that is not
     the expected one. Nothing derived is printed — no digest, no salt, no value — and the digest is
     only ever handed INTO the sandbox that already holds the plaintext, so it discloses nothing.
     The planted control substitutes one redeemed value on every run, so this arm has its own
     positive control.
   - `evaluateEnvProbe` → `absent` | `present` | `blind` | `not_run`, plus two worker-side rules:
     `unredeemed_provider_credential` (an allowed provider-auth NAME present in the sandbox that THIS
     run did not redeem — from the template, the provider or a host) and
     `provider_credential_value_mismatch` (the right name, the wrong value). It also requires the
     probe's `checked` set to EQUAL this build's class list (Codex P2): a short set is `not_run`,
     never `absent`.
   - The metadata observation: the probe records whether `169.254.169.254` answers — reachability, an
     HTTP status, or an error code, and **never a body**. It is recorded, never judged (§5).
2. **The supervisor step** — `createSupervisor` (`supervisor.ts`), a new optional `envProbe` dep.
   Positioned after `stage_files` and `attempt_started` and **before the tenant command**. It emits
   the summary as one `system` `log` event (through the run's canary scrub) and then, on any verdict
   other than `absent`, emits a durable terminal with `ENV_PROBE_ERROR_CODES[verdict]`
   (`env_probe_credential_present` / `env_probe_blind` / `env_probe_not_run`) and escalates cleanup.
   Absent the dep, the lifecycle is byte-identical: no probe execute, no extra event.
3. **The switch** — `AOA_WORKER_ENV_PROBE` (`config.ts` `parseEnvProbe`, the same strict grammar as
   the dispatch switch: exactly `1`, else unset/`0`, else a startup error), forwarded by
   `bootstrapWorkerDaemon` to `composeDispatchRuntime`, which composes `envProbe` into the
   supervisor. Default OFF everywhere.
4. **The lane arms it** — `docker/m1-boot/docker-compose.m1-boot.yml` sets `AOA_WORKER_ENV_PROBE: "1"`
   on all three shipped-boot workers, and `evaluateShippedBootOverlayInvariants`
   (`SHIPPED_BOOT_ENV_PROBE_ENV`) reds an overlay worker that drops it or sets anything else — so the
   probe cannot be silently removed from the paid lane.
5. **The lane reads it back** — `scripts/lib/m1-shipped-boot.mjs`: `extractEnvProbeSummary` +
   `evaluateEnvProbeEvidence` (pure, unit-tested), and `plantedTenantCanary`. The journey's
   `dispatch` phase reads the attempt's own `job_events` `log` rows for each ENABLED tenant, judges
   them, writes `env-probe-<tenant>.json` into the retained bundle, and fails that tenant's outcome
   when the summary is missing, not `absent`, blind, or did not check the cross-tenant class.
6. **The cross-tenant plant on the real path** — the journey's `seed` phase saves a marked canary as
   each tenant's OWN OpenAI provider key (a real secret in that tenant's store, tracked by NAME for
   the pre-upload leak scan). Every other tenant's sandbox must show no value marked with a foreign
   Organization.
7. **`scripts/finding-ownership.json`** — `E8-F012` stays **`unowned`**; only its `reason` is amended
   (S0-8) to record that DEP-017 covers the M1 distributed stage-in path only, and that the other
   stage-in paths (Commander, U13 extraction, warm resume, the non-distributed org/crew paths) and
   the metadata-endpoint half (a-ii) remain without an owner.
8. Docs: `AOA_WORKER_ENV_PROBE` in `docs/deploy/environment-variables.md`.

---

## 2. The recorded choice — where the probe runs, and why

The brief asked for the design to be decided and recorded: inside the journey's sandbox via the
existing distributed path, or as a separate keyed step — whichever measures the REAL stage-in path.

**Chosen: a worker supervisor step inside the run's own sandbox.** Verified at source:

- The ONLY channel that executes anything inside a distributed sandbox is `EffectAuthority.execute`
  (`supervisor/effect-authority.ts`) → the per-run provider. Nothing else can reach a live sandbox.
- The credential stage-in is `materializeRunSecrets` → `synthesiseRunSecrets`
  (`lease/secret-redemption.ts`) → `createSpecFor`'s `env`, which becomes E2B's `envVars` on create
  AND on each `commands.run` (`sandbox-e2b-provider/real-transport.ts`). Only a control-plane TASK
  RUN's envelope carries `secretHandles`.
- Therefore a harness-submitted job (`POST /organizations/:o/companies/:c/jobs`) would carry **no**
  secret handles, and a separate keyed step that created its own sandbox would measure a sandbox the
  product never built. Neither is the stage-in path.
- Running the probe through `run.effect.execute` with `env: spec.env` gives exactly what the tenant
  command is given: the template's baked env ⊕ the provider's own env ⊕ the redeemed env.

**Cost of the choice, stated plainly.** The E6 task section says "Migration/compatibility /
rollback: test/harness only", and this adds code to the worker daemon. The task's own **Files** line
allows the probe under `packages/worker-daemon/src/`, and nothing there could invoke it without a
supervisor step. The step is composed only behind `AOA_WORKER_ENV_PROBE=1`, which only the
shipped-boot overlay sets; rollback is deleting that one env line (the lane then reds at
`check-staging-manifest`, loudly, which is the intended direction). Delta recorded in §6.

**How the probe is delivered:** as argv (`sh -c <wrapper> <script> …`), not as a staged file. The
staged-file channel needs a control-plane-minted download grant per file
(`lease/staged-input.ts`), which is the tenant's input path, not the worker's; argv rides the same
`execute` the tenant command uses and adds no new surface. The script contains no single quote, so
the E2B transport's `shellJoin` (`shSingleQuote`) delivers it verbatim — pinned by a test.

---

## 3. Keyless evidence

All local, all keyless. No `keyed-*` workflow and no `m1-shipped-boot.yml` dispatch.

**The probe tests execute the real bytes.** `packages/worker-daemon/src/__tests__/env-probe.test.ts`
spawns a real `node` (and, where `sh` exists, the real `sh` wrapper) with a crafted env, and the
supervisor cases route the probe's `execute` through a provider that does the same — so the chain
invocation → in-sandbox read → stdout channel → per-run scrub → strict parse → verdict → `log` event
→ terminal runs for real.

| Suite | Result |
|---|---|
| `pnpm --filter @armyofagents/worker-daemon exec vitest run src/__tests__/env-probe.test.ts` | **61 passed** |
| `pnpm --filter @armyofagents/worker-daemon exec vitest run` (whole package) | **1220 passed, 1 skipped, 165 files** (on the tree merged with program tip `1bd5c8bbc`) |
| `pnpm --filter @armyofagents/worker-daemon exec tsc --noEmit` | clean |
| `node --test scripts/check-staging-manifest.test.mjs scripts/lib/__tests__/m1-shipped-boot.test.mjs scripts/check-m1-shipped-boot-shape.test.mjs` | **140 passed, 0 failed** |
| the M1 guard loop (all pure `pr.yml` guards) + `check-evidence-immutability --base origin/docs/replatform-program` | **0 failures** |

CI evidence for the same tree is added in §8 once the PR's `ci-required` completes.

---

## 4. RED → GREEN, positive controls, mutations

**RED (recorded honestly).** The implementation was written before the suite, so the RED was
produced by removing the implementation from the tree and running the suite against it:

- With `supervisor/env-probe.ts` removed and `supervisor.ts` restored to `HEAD`:
  `Error: Cannot find module '../supervisor/env-probe.js' … Test Files 1 failed, Tests no tests`.
- With only the supervisor step disabled (mutation **M7**): **8 failed / 36 passed** — every
  supervisor case reds because no probe ran and no probe event exists.

**GREEN.** The table in §3.

**Positive controls — each is a test, and each one fires:**

| Control | Where |
|---|---|
| One planted credential NAME per taxonomy class turns the probe red as that class (15 rows, one per class, plus a "no class is untested" case) | `env-probe.test.ts` |
| Another tenant's credential under an ALLOWED name (`ANTHROPIC_API_KEY` carrying a foreign Organization's marker) turns it red as `cross_tenant_credential`; the SAME value run as its OWN Organization does not (the same-tenant positive control) | `env-probe.test.ts` |
| An infrastructure credential baked into the sandbox "template" reds the whole run before the tenant command runs (`env_probe_credential_present`, zero tenant executions) | `env-probe.test.ts` |
| A model-provider key the run did NOT redeem reds it (`unredeemed_provider_credential`) | `env-probe.test.ts` |
| MULTI-TENANT (F10): tenant A's marked key inside tenant B's run reds B; inside A's own run it does not; B's evidence never names A's Organization or value | `env-probe.test.ts` |
| A BLIND probe (reports nothing for the planted control) fails the run (`env_probe_blind`) | `env-probe.test.ts` |
| A probe that throws or exits non-zero fails the run (`env_probe_not_run`, reason named) | `env-probe.test.ts` |
| VALUE IDENTITY (Codex P1): an allowed name holding a value the run did NOT redeem is reported by name and reds the run — with the same-value control, and with no value, salt or digest in the output | `env-probe.test.ts` |
| A `checked` set missing ANY expected class is `not_run`, at both the worker and the lane (Codex P2) | `env-probe.test.ts`, `m1-shipped-boot.test.mjs` |
| An image with no `node`: the wrapper names the cause and exits 78 | `env-probe.test.ts` (real `sh`) |
| A doctored probe that smuggles the redeemed key into a free-text report field cannot carry it out | `env-probe.test.ts` |
| An overlay worker that DROPPED `AOA_WORKER_ENV_PROBE`, or set it to `true`, reds the manifest check | `check-staging-manifest.test.mjs` |
| No probe summary on an enabled tenant's attempt FAILS the lane; a present class FAILS and is named; a non-red control FAILS; a report that did not check the cross-tenant class FAILS | `scripts/lib/__tests__/m1-shipped-boot.test.mjs` |
| `AOA_WORKER_ENV_PROBE=true` refuses to boot rather than leaving the probe silently off | `dispatch-flag-config.test.ts` |

**Mutations.** Each was applied in place, the owning suite run, and the mutation reverted.

| # | Mutation | Result |
|---|---|---|
| M1 | the probe ignores the name classes | **killed** — 19 failed / 25 passed |
| M2 | the probe ignores the cross-tenant marker | **killed** — 5 failed |
| M3 | `evaluateEnvProbe` treats the planted control as always red | **killed** — 2 failed |
| M4 | the supervisor does not fail the run on a failing verdict | **killed** — 4 failed |
| M5 | the planted values are not seeded as run canaries | **SURVIVED — equivalent mutant.** See below. |
| M5b | the probe's output is not scrubbed with the run's canaries | **killed** — 1 failed |
| M6 | the `unredeemed_provider_credential` rule removed | **killed** — 2 failed |
| M7 | the probe step is not composed in the supervisor | **killed** — 8 failed |
| M8 | `env_probe` removed from the CLOSED metric-label allow-list | **killed** — 7 failed (see §4a) |
| M9 | the probe's elapsed time is added to the run's budget instead of carved from it | **killed** — 1 failed |
| M10 | the probe's value-identity comparison removed (Codex P1) | **killed** — 6 failed |
| M11 | the worker ignores a reported value mismatch (Codex P1) | **killed** — 1 failed |
| M12 | the checked-set equality relaxed to "non-empty" (Codex P2) | **killed** — 1 failed |
| M13 | the control plants both arms on ONE variable (`allowedNames` ignored) | **killed** — 1 failed |
| M14 | the lane accepts an unexpected checked class | **killed** — 1 failed |
| M15 | the control is judged by CLASS alone, not per planted variable | **killed** — 1 failed |
| M16 | credential-shaped NON-POSIX env names left unclassified | **killed** — 1 failed |
| M17 | the matching key not canonicalised for CASE | **killed** — 1 failed |
| M18 | repeated/edge separators not collapsed in the key | **killed** — 1 failed |
| M19 | the probe serializes the sandbox’s own env NAMES | **killed** — 7 failed |
| M20 | the CROSS-TENANT arm names the raw variable, bypassing the gate | **killed** — 1 failed |
| M21 | the unreported-name count increments per CALL, not per variable | **killed** — 1 failed |

### 4a. Two defects this review caught before the PR, worth recording

1. **`emitOp("env_probe", …)` would have STRANDED every probed run.** `CLOSED_LABEL_VALUES.operation`
   (`metrics/metrics.ts`) is a closed allow-list, and `Metrics.inc` THROWS on a value outside it;
   that throw escapes into `accept()`'s last-resort catch, which emits **no terminal**. The first
   version of the supervisor tests omitted `metrics` (an optional dep), so they were green against
   a step that would have stranded the run in production — a check that evaluated nothing. Fixed by
   registering `env_probe` with the step that emits it (the same reasoning `stage_files` and
   `digest_artifact` carry) and by composing REAL metrics in every supervisor case. Mutation **M8**
   proves the cases now catch it: 7 red.
2. **The probe's time must be CARVED from the run's budget, not added.** `RUN_OP_DEADLINE_CEILING_MS`
   sits exactly one `RUN_TEARDOWN_HEADROOM_MS` under the owned-labels capability window, which is
   never re-minted; a run that overshoots cannot destroy its own sandbox and leaves a BILLABLE one
   recorded `orphaned`. The probe now subtracts its own elapsed time from `run.opDeadlineMs`, which
   `makeCtx` reads LIVE so the supervisor race and the provider's own ctx stay the same number (H1),
   and each probe execution is bounded by `ENV_PROBE_DEFAULT_DEADLINE_MS` (20 s). Mutation **M9**.

**M5, stated rather than hidden.** Seeding the planted canaries into the run's canary array is
defence in depth that no current test can observe: the planted values exist only for the CONTROL
execution, whose report contributes only class tokens to the summary, and the strict report parse
(`parseEnvProbeReport`) already rejects any field a value could ride in. It is kept because the
ordering ("seed before it can be emitted") is the same rule DAT-008 M7 enforces for redeemed
secrets, and a future change that emitted more of the control's report would need it. M5b is the
mutation that proves the scrub itself is load-bearing.

---

## 4b. Limit of this probe (ruled by the M1 planning session, 2026-09-23, under F2)

The probe detects a FOREIGN tenant's credential by VALUE under ANY name, any taxonomy class by name,
an allowed name the run did not redeem, and a value under an allowed name that is not the one the
worker redeemed. It **cannot detect a control-plane MIS-RESOLUTION** — a redemption that hands a
tenant a legitimate-looking credential belonging to another Company — because the expectation is
derived from `spec.env`, i.e. from whatever redemption returned; and in the keyed lane every enabled
tenant is seeded with the SAME repository `ANTHROPIC_API_KEY`, so for that credential mis-resolution
is invisible by value. **`M1a`'s isolation claim built on criterion 5 therefore EXCLUDES
control-plane mis-resolution of a tenant's provider key.** Filed as **`E6-F025`** (`unowned`,
MEDIUM), with both closure routes named: a company-scoped value fingerprint on the resolve reply (a
server + wire change), or tenant-distinct exercised credentials in the keyed lane (a founder/ops
provisioning action). Ruled: FILE IT, DO NOT BUILD IT — neither route belongs to `DEP-017`.

## 5. The DE-08 residual — OBSERVED, not enforced

The probe attempts one `GET http://169.254.169.254/` with a 3-second abort and records
`{attempted, target, reachable, httpStatus | errorCode}`. It **never reads the body**, and a
reachable endpoint does **not** fail the run: `evaluateEnvProbeEvidence` records the observation and
judges nothing, with the note *"OBSERVED, not enforced: DE-08 is an accepted residual that leaves
H-06 unmet; this is a record, not a claim."* — pinned by a test in which IMDS answers `200` and the
tenant still passes.

Nothing in this ticket claims egress enforcement, and nothing here closes `E8-F012`: env-absence is
half of its resolution condition (a-i) for ONE path, and (a-ii) — what a token-bearing guest could
extract from that endpoint — is not measured here.

---

## 6. Deltas against the task section

1. **"test/harness only".** The probe is worker code behind a default-off switch, not harness-only
   code. Reason and rollback in §2. The task's Files line allows `packages/worker-daemon/src/`.
2. **"a small script staged into the sandbox".** Delivered as argv, not as a staged file (§2).
3. **The `DEP-016` profile is not wired — and the plan is explicitly revised, not quietly ignored**
   (raised by Codex on `247ad923d`). `tests/d1/m1-spine.test.mjs` does not exist at this tip:
   `DEP-016` is unbuilt. Measured at source, the D1 lane also runs the FAKE provider, whose
   `execute` returns a canned `executed` result and runs no command
   (`packages/sandbox-fake-provider/src/fake-driver.ts`, the `case "execute"` arm) and streams no
   stdout — so arming the probe there today would fail every D1 distributed run
   `env_probe_not_run` while observing nothing. The E6 plan is therefore amended in this PR: the
   §3 `DEP-017` row and the `DEP-017` Files line record the carry-over, and `DEP-016`'s task
   section gains acceptance item 6 — that profile must arm `AOA_WORKER_ENV_PROBE`, assert the
   per-tenant summary through the same `evaluateEnvProbeEvidence`, and, if it still runs the fake
   provider, either make the fake execute the probe faithfully or record that criterion 5 is
   observed only in the `DEP-015` lane. Criterion 5 is NOT narrowed: it is observed in the shipped
   lane, and the obligation on the other profile is made explicit and checkable rather than
   dropped. **This was a plan edit made by a build agent, flagged for the planning session — and
   RATIFIED by it on 2026-09-23 under founder delegation F2.** The plan carries that ratification
   note, so no reader takes it for a build agent's own authority.
4. **The metadata half** is included (cheap), as the task's non-goal allowed, and is recorded as an
   observation only (§5).
5. **`E8-F012` stays `unowned`**, reason amended only — exactly as the S0-8 amendment requires.

---

## 7. What the keyed run must show (the pending acceptance)

One dispatched keyed `m1-shipped-boot.yml` run on a named candidate containing this change. Per
ENABLED tenant, the retained bundle must carry `env-probe-<tenant>.json` with:

- `observed.verdict = "absent"` and an EMPTY `observed.present`;
- `observed.checked` naming every class, including `cross_tenant_credential`;
- `observed.plantedControl.red = true` (the probe could see, inside that sandbox);
- `observed.allowedPresent` ⊆ `observed.redeemedNames` (in practice `ANTHROPIC_API_KEY`);
- `observed.de08MetadataResidual` recorded either way;
- and `journey.json` passing for every tenant.

**Two ways this can legitimately red on the first keyed run, and both are findings, not bugs to
paper over:**

- the `aoa-base` template bakes a credential-shaped env var (for example an `E2B_*` token) — the
  probe would report it by NAME, which is precisely what criterion 5 asks;
- the template has no `node` on the sandbox `PATH` for `commands.run` — the wrapper reports
  `DEP017_PROBE_NO_NODE` and exit `78`, and the summary's reason is `probe_exit_nonzero`. That is a
  harness fix (the template), not a credential finding.

Either outcome must be recorded here by the reviewer before the gate record cites criterion 5.

---

## 8. The Codex review on `f812e6ab6`, and what it changed

Two findings, both real, both verified at source before fixing:

- **P1 — "compare allowed credential values, not just names."** `redeemed` was `Object.keys(spec.env)`,
  so any value under an expected NAME passed. Fixed by the salted per-run digest comparison above,
  with `provider_credential_value_mismatch` as a reported class and a substituted value in the
  planted control so the arm cannot go dark (mutations M10, M11).
  **The residual Codex also named, recorded rather than closed:** in the keyed lane every tenant is
  seeded with the SAME repository `ANTHROPIC_API_KEY`, so for that one credential a cross-tenant
  leak is undetectable *by value identity* — the values are equal by construction. What covers it
  today: the per-tenant marked canary (a genuinely tenant-distinct credential, caught under ANY
  name), and the digest check against the value the run itself redeemed. What would close it: a
  second, distinct provider key secret for the keyed lane so each enabled tenant holds a different
  real credential. That is a lane-secret change, outside this ticket, and is left for the planning
  session.
- **P2 — "require the complete credential-class set before passing."** `checked` was only tested for
  non-emptiness, at both the worker and the lane, so a drifted probe could observe a fraction of the
  taxonomy and pass. Both now require the full set: `evaluateEnvProbe` compares against
  `envProbeCheckedClasses()`, and the lane compares against `ENV_PROBE_EXPECTED_CLASSES`, whose
  mirror is pinned to the daemon's source by a parity test (mutation M12).

## 8a. The Codex re-review on `b36f55e1e` — two more fixed, one RECORDED and escalated

- **P2 — "exercise digest mismatch for OpenAI-only runs."** Real: the control planted the
  cross-tenant canary on `OPENAI_API_KEY` and skipped the value-identity substitution when that was
  the only redeemed name, so the MARKER alone turned the control red and the digest comparison was
  uncontrolled on that shape. Fixed: `buildPlantedControl` now takes the allowed-name list, puts the
  value-identity substitution on the first REDEEMED name and the cross-tenant canary on a DIFFERENT
  allowed name (preferring an unredeemed one), so neither plant can stand in for the other. Two new
  cases, including an OpenAI-only run judged `absent` end to end on real bytes; mutation **M13**.
- **P2 — "reject unexpected checked classes in the lane."** Real: the lane checked only for missing
  classes, so a drifted taxonomy with an EXTRA class passed while this record claimed parity. The
  lane now compares in both directions and names the unexpected classes; positive control plus
  mutation **M14**.
- **P1 — "anchor expected digests outside the redeemed environment." REAL, NOT FIXED HERE, and
  escalated.** The expectation is `sha256(salt + spec.env[name])`, i.e. the value redemption
  returned, so a control-plane MIS-RESOLUTION that handed this run another company’s credential
  defines its own expectation and passes the check. Verified at source: the worker has no
  company-scoped anchor available — the resolve reply (`classifyResolveResponse`) carries
  `envTarget`, `value` and an optional owned-labels capability, and nothing that binds the VALUE to
  the owning Company. Closing it needs one of two things, both outside this ticket:
  1. a company-scoped value fingerprint minted by the control plane on the resolve reply (a server
     change plus a new reply field), which the worker would compare instead of its own redeemed
     value; or
  2. a genuinely tenant-distinct exercised credential per enabled tenant in the keyed lane (today
     every tenant is seeded with the SAME repository `ANTHROPIC_API_KEY`, so the values are equal by
     construction and no value-based check can separate them) — a lane-secret change.
  What covers the case today, and is not nothing: the per-tenant canary MARKER, which is genuinely
  tenant-distinct and is caught under ANY name, including an allowed one. What is NOT covered is a
  mis-resolution of the one credential the lane shares across tenants. The class doc-comment on
  `ENV_PROBE_VALUE_MISMATCH` states this limit at source so the record cannot be read as more than
  it is, and the planning session is asked to rule on (1) or (2).
  **RULED 2026-09-23 (M1 planning session, F2): file it, do not build it.** Filed as **`E6-F025`**
  (`unowned`, MEDIUM) with both routes named; see §4b for the limit as it now stands in the record.

## 8b. The Codex review on `e301c2d3e`

One finding, real and fixed at source: **"bind each control detection to its planted variable."** The
control was judged by CLASS alone, so a regression that flagged a DIFFERENT allowed credential could
satisfy the value-identity arm while the deliberately substituted variable went unnoticed — a control
red for the wrong reason. `evaluateEnvProbe` now checks each expectation as a (NAME, class) pair
(`allowedMismatch` for the value-identity arm, `presentNames` for the name/marker arms) and records a
per-case `satisfied` flag in the summary, so the evidence shows WHICH arm fired on WHICH variable.
Positive control: the same class set attributed to the wrong variable is `blind`; mutation **M15**.

## 8c. The Codex review on `6961bda87` — one finding, DISPUTED with evidence, and hardened anyway

**"Read probe messages from the stored payload root" (P1): measured FALSE.** The claim is that
`job_events.event` holds the payload alone, so `event->'payload'->>'message'` returns NULL. At
source: `toAcceptInputs` (`server/src/services/job-events.ts`) sets `payload: event as unknown as
Record<string, unknown>` — the WHOLE `WorkerEventV1`, which itself has a `payload` field — and the
repository stores that as `event: event.payload` (`packages/db/src/repositories/tenant/job-control.ts`).
So the column holds the whole envelope. Corroborated end to end, on real PostgreSQL through the real
`/worker-control/events` path: `tests/d1/e6f-10-telemetry.test.mjs` asserts
`started.sandboxId === sandboxId` where the harness reads it as `event->'payload'->>'sandboxId'`
(`tests/d1/lib/e6f-harness.mjs`), and the pre-existing DEP-015 terminal-event query uses the same
nesting. The finding was not accepted.

**Hardened anyway**, because the cost of being wrong lands on a PAID run: the query is now
`COALESCE(event->'payload'->>'message', event->>'message')`, with the evidence written beside it. A
future ingestion change that stored the payload alone would otherwise make the lane report "the probe
did not run" and fail a keyed run for a reason that is not the one under test.

## 8d. The Codex review on `893d185b5`

One finding, real and fixed: **"classify credential-shaped non-POSIX environment names."** A legal
process-environment name outside the POSIX shape — `GITHUB-TOKEN`, `DATABASE-URL` — was counted and
then skipped by both the taxonomy and the heuristic, so a credential injected under such a name was
invisible. The probe now classifies every name, matching on a normalised key (non-`[A-Za-z0-9_]`
characters folded to `_`), and reports a non-POSIX hit as its CLASS plus a count
(`unnamedPresentCount`) — never as a name, because `parseEnvProbeReport` admits only POSIX names and
that is what stops a value masquerading as one. Positive control plants both examples and asserts the
classes, the count, an empty `presentNames` and no value or name in the output; mutation **M16**.

## 8e. The Codex review on `8eb75c46d`

One finding, real and fixed: **"canonicalize case before matching credential classes."** The class
table is written in canonical upper-snake form, and the normalisation folded punctuation but kept
case, so `github_token` or `Database-Url` slipped both the exact-name set and the anchored patterns.
The key is now `name.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase()`, while the report still carries
the name exactly as the sandbox held it. Note the interaction this makes explicit: a lowercase
`anthropic_api_key` is a DIFFERENT variable from the allow-listed `ANTHROPIC_API_KEY` (env names are
case-sensitive to the OS), so it is CLASSIFIED rather than waved through as the tenant's own key —
asserted in the positive control. Mutation **M17**.

## 8f. The Codex review on `34d0de406`

One finding, real and fixed AS A CLASS rather than as the one spelling that prompted it: repeated
separators (`DATABASE--URL`). The canonical key now folds every non-alphanumeric RUN to a single
`_`, drops leading and trailing separators, and upper-cases — so `DATABASE--URL`, `github..token`,
`_AWS_SECRET_ACCESS_KEY_` and `E2B.API-KEY` all reach their classes. The positive control plants all
four at once and asserts the four classes, which name is reported (only the POSIX one) and the count
of the rest; mutation **M18**.

## 8g. The Codex review on the merge head `9360bc26e`

One finding, real and fixed: **"stop serializing raw POSIX environment names."** An env NAME is
sandbox-controlled data — `SECRET_sk_live_ABC123` is a legal POSIX name, matches the credential-shape
heuristic, and, unlike a redeemed VALUE, is not in the run canaries, so nothing downstream would
scrub it out of the persisted probe log. The report now serializes a name ONLY when its canonical
form is one the probe’s OWN table names exactly (the class tables’ `names` plus the allowed set), and
it carries THAT canonical token rather than the sandbox’s spelling; everything else — a
pattern-matched name, a heuristic match, any odd spelling — is a class plus a count
(`unreportedPresentCount`, renamed from `unnamedPresentCount` because the rule is no longer about
POSIX shape). So `presentNames` is now provably a subset of the probe’s own vocabulary. Positive
controls: `SECRET_sk_live_ABC123` and `SOME_VENDOR_PASSWORD` are counted, not echoed, and neither the
value nor the name appears in the output; the per-class table derives its expectation from the table
itself rather than a hand-list. Mutation **M19** (serialize the raw name) reds 7 cases.

## 8h. The Codex review on `5aa787b2a`

One finding, real and fixed: the known-token gate covered the taxonomy arm but **not the
cross-tenant arm**, which fires on a VALUE and can therefore land on any name the sandbox chose —
`SECRET_sk_live_ABC123=aoa-dep017-canary.<foreign-org>…` would have persisted the name verbatim.
There is now ONE name policy for every arm: a single `report()` closure that emits the known
canonical token or increments the count, used by the cross-tenant arm and the taxonomy arm alike.
Positive controls: a foreign-marked value under a neutral name (`BUILD_sk_live_…`) is class + count
with no name; under a credential-shaped name both arms fire and it is still never named; under a
KNOWN name (`ANTHROPIC_API_KEY`) it is still named, so the arm keeps its diagnostics. Mutation
**M20**.

A second finding on the follow-up PR #568, also fixed: a variable hit by BOTH arms incremented
`unreportedPresentCount` twice, corrupting a persisted diagnostic. The unreported names now live in
a SET whose SIZE is serialized — the set itself never leaves the probe, which is the point of not
naming them — so one variable counts once however many arms fire on it. Mutation **M21**.

## 9. CI evidence

**BLOCKED, not skipped.** Every job of PR #565's `pr.yml` runs (`35796310711`, `35797160035`) failed
in 2–3 seconds with no steps executed, on a GitHub **billing** annotation: *"The job was not started
because recent account payments have failed or your spending limit needs to be increased."* That is
an account condition, not a property of this change: `changes`, `policy`, `ci-required` and both
`worker-protocol-contract-bytes` legs never started, and every other job shows `skipping`. A re-run
of the failed jobs reproduced it exactly.

This result therefore records LOCAL evidence only (§3), and `ci-required` must be re-run and cited
here once Actions billing is restored. No claim of CI green is made.

---

## Independent review

**Reviewer:** M1 review-batch-3A independent reviewer (Claude Opus 5). I did not author DEP-017, and I am not the planning session.
**Reviewed revision:** 5aa787b2a6c7c98e8cec321dea371a2cc9f551fa (the final PR #565 head, merged as `60aafb32ec6f8316f92079789cf8814f981f3ed3`, which is the program tip).
**Disposition:** `approved` for the CODE. **`Status` stays `gate_review`:** acceptance 1 — the one dispatched keyed `m1-shipped-boot.yml` run (§7) — is **OPEN by design**, and I do not set `complete` while any acceptance item is pending.
**Attempt:** 1 (see *Independent review — attempt 1* and the attempt history)

### Independent review — attempt 1

**Disposition: `approved` (code); `Status` unchanged.** The probe, its fail-closed wiring, the
switch, the overlay arming and the lane's read-back all hold up at source, and the keyless evidence
reproduces. What is NOT done is the thing the record says is not done: no keyed run has observed the
probe inside a real E2B sandbox. §7 states exactly what that run must show, and until it exists and
is recorded here, this ticket cannot be `complete`.

**What is still open, precisely.** One dispatched keyed run of `m1-shipped-boot.yml` on a named
candidate containing this change, whose retained bundle carries `env-probe-<tenant>.json` per
ENABLED tenant with `observed.verdict = "absent"`, an empty `observed.present`, `observed.checked`
naming every class including `cross_tenant_credential`, `observed.plantedControl.red = true`,
`observed.allowedPresent ⊆ observed.redeemedNames`, `observed.de08MetadataResidual` recorded either
way, and `journey.json` passing for every tenant. §7's two legitimate first-run reds (a template that
bakes a credential-shaped var; a template with no `node` on `PATH`, reported as
`DEP017_PROBE_NO_NODE` / exit 78) are correctly framed as findings, not as things to paper over. **I
dispatched nothing.**

**Fail-closed inside the real sandbox — verified at source, and it is the load-bearing claim.**

- The probe executes through `run.effect.execute` with `env: spec.env`, i.e. the same channel and
  the same environment the tenant command gets. `EffectAuthority.execute`
  (`supervisor/effect-authority.ts`) is the only path into a live sandbox, and the redeemed
  credentials reach it through `materializeRunSecrets` → `synthesiseRunSecrets` → `createSpecFor`'s
  `env` → E2B `envVars`. §2's reasoning for choosing a supervisor step over a separate keyed step is
  therefore correct, not merely plausible: a harness-submitted job carries no `secretHandles`, so a
  separate step would measure a sandbox the product never builds.
- The step sits after `stage_files`/`attempt_started` and **before** the tenant command
  (`supervisor.ts`). On any verdict other than `absent` it emits a durable `terminal` with
  `ENV_PROBE_ERROR_CODES[verdict]`, escalates cleanup and **returns** — the tenant command never
  runs. That is fail-closed, not merely reported.
- `evaluateEnvProbe` requires the reported `checked` set to **equal** `envProbeCheckedClasses()`;
  any difference is `not_run`, i.e. a failure, never `absent`. A short set cannot pass.

**Mutation reproduced by me.** M12 — relaxing that equality to "non-empty"
(`reported.size === 0`) — gives **1 failed / 59 passed** in `env-probe.test.ts`, and the failing case
is *not_run: no clean report, or a report that checked nothing*. Exactly the one case, as the record
says. Reverted; the tree was clean.

**Keyless evidence reproduced.** On the reviewed tree:
`vitest run src/__tests__/env-probe.test.ts` → **60 passed**, matching §3 exactly; and
`node --test scripts/check-staging-manifest.test.mjs scripts/lib/__tests__/m1-shipped-boot.test.mjs scripts/check-m1-shipped-boot-shape.test.mjs`
→ **140 tests, 140 pass, 0 fail**, matching §3's 140. The probe tests spawn a real `node` (and the
real `sh` wrapper), so the chain the record claims — invocation → in-sandbox read → stdout → per-run
scrub → strict parse → verdict → `log` event → terminal — is exercised on real bytes rather than
mocked.

**The plan amendment is RATIFIED, and the ratification is in the plan, not only here.** §6 item 3
claims the E6 plan was amended by a build agent and ratified. At source, the E6
`implementation-plan.md` carries the ratification note **twice** — in the §3 `DEP-017` row and in the
`DEP-017` Files line — each reading *"Amended 2026-09-23 by DEP-017's build, after the Codex review
of PR #565, and RATIFIED by the M1 planning session under founder delegation F2 on 2026-09-23. NOT a
narrowing of criterion 5"*. So no reader takes a build agent's plan edit for its own authority, which
is what the record promises. The carried-in obligation landed: `DEP-016`'s task section gained
acceptance 6, and `DEP-016` took the second fork with a two-directional tripwire — I reviewed that
separately and it holds.

**`E6-F025` is filed, not built, and the record is honest about what that costs.** The finding exists
in `scripts/finding-ownership.json` as `unowned`/MEDIUM and in E6 `findings.md` §`E6-F025`, with both
closure routes named (a company-scoped value fingerprint on the resolve reply, or tenant-distinct
exercised credentials in the keyed lane) and with the explicit statement that `M1a`'s isolation claim
built on criterion 5 **excludes** control-plane mis-resolution of a tenant's provider key. §8a
records the Codex P1 as REAL and NOT FIXED rather than disputing it away, and the limit is stated at
source on `ENV_PROBE_VALUE_MISMATCH`. Filing rather than building is the right call for this ticket —
both routes are a server change or an ops provisioning action — and the ruling under F2 is recorded.
`E8-F012` stays `unowned` with its reason amended only, as S0-8 requires.

**One disputed Codex finding, and I agree with the dispute.** §8c rejects *"read probe messages from
the stored payload root"*. At source, `toAcceptInputs` (`server/src/services/job-events.ts`) sets
`payload: event as unknown as Record<string, unknown>` — the whole `WorkerEventV1` — and the tenant
repository stores `event: event.payload`, so the column holds the envelope and
`event->'payload'->>'message'` is right. Hardening it to
`COALESCE(event->'payload'->>'message', event->>'message')` anyway is the correct response when
being wrong would burn a paid run. Disputing with evidence and hardening anyway is better practice
than either capitulating or ignoring.

**Two record defects, recorded (non-blocking).**

1. **§9 is out of date: CI is no longer blocked.** §9 says every `pr.yml` job failed on a GitHub
   billing annotation with zero steps, and that `ci-required` must be cited here once billing is
   restored. It has been. Run **`35823594587`** (`pull_request`, headSha
   `5aa787b2a6c7c98e8cec321dea371a2cc9f551fa`, conclusion `success`) has `ci-required`
   **`107064489142`** `success`, `policy` `107060470770`, and `verify (1..4)`
   `107060513163` / `107060513059` / `107060513151` / `107060513137` all `success`;
   `env-probe.test.ts` is loaded and run in `verify (4)`. The intermediate head `9360bc26e6` is also
   green (`35821870119`). §9's "No claim of CI green is made" was true when written; a green claim is
   now available and is made here.
2. **A duplicate object key in the probe's own tests.** `env-probe.test.ts` repeats
   `unreportedPresentCount: 0,` inside three object literals (at lines 417, 463–464 and 754–755),
   which vite warns about five times per CI shard run. Both copies are `0`, so no assertion changes
   and nothing is vacuous — but it is a defect in a file whose whole job is to be exact, and the
   warning noise will outlive the memory of why it is harmless. Worth one cleanup commit; it is not a
   reason to withhold approval of the code.

**Acceptance status (E6 plan `### DEP-017`, and the F9 specification).**

| Item | Status |
|---|---|
| The probe, built and running inside the run's own sandbox on the real stage-in path | **Evidenced** (§2's channel argument verified at source; 60 real-bytes tests). |
| Fail-closed: any non-`absent` verdict terminalizes the run before the tenant command | **Evidenced** at source and by mutations M4, M7, M12. |
| Planted-canary positive control, including the cross-tenant arm | **Evidenced**; each control is a test and each one fires, and M13/M15 stop the two plants standing in for each other. |
| Multi-tenant (F10) | **Evidenced keyless**: tenant A's marked key inside B's run reds B and not A, and B's evidence never names A's Organization or value. |
| DE-08 residual OBSERVED, not enforced; no egress-enforcement claim | **Evidenced**: recorded and judged nothing, pinned by a test in which IMDS answers `200` and the tenant still passes. |
| **Criterion 5 observed in the keyed lane** | **OPEN — PENDING by design** (§7, F8 envelope). |

Because that last item is open, I approve the code and **do not** make the `Status`-flip commit.
`Status` stays `gate_review` until the keyed run is dispatched, its outcome recorded here per §7, and
a distinct reviewer re-reviews (attempt 2).

## Review attempt history

The implementation author leaves the table body empty. The first independent reviewer appends attempt 1, and later reviewers append rows with increasing attempt numbers without replacing earlier ones. Do not include a `Review commit` column: a row cannot embed the SHA of the commit that first contains it.

| Attempt | Reviewer | Reviewed revision | Disposition | Evidence/findings |
|---:|---|---|---|---|
| 1 | M1 review-batch-3A independent reviewer (Claude Opus 5) | `5aa787b2a6c7c98e8cec321dea371a2cc9f551fa` | `approved` (code); `Status` stays `gate_review` | Fail-closed verified at source: the step runs through `EffectAuthority.execute` with `spec.env` before the tenant command, and any non-`absent` verdict emits a durable terminal with `ENV_PROBE_ERROR_CODES[verdict]`, escalates cleanup and returns; `evaluateEnvProbe` requires set EQUALITY of `checked`, so a short set is `not_run`. Reruns match §3 exactly: `env-probe.test.ts` **60 passed**; the three pure-node suites **140/140**. Mutation M12 reproduced: 1 failed, *not_run: … a report that checked nothing*. The plan amendment's RATIFIED note is in the E6 plan itself (two places), not only in this record. `E6-F025` is filed `unowned`/MEDIUM with both closure routes and the explicit exclusion from `M1a`'s criterion-5 isolation claim; `E8-F012` reason-amended only. §8c's dispute is correct at source (`toAcceptInputs` stores the whole envelope). Defects recorded: §9's CI-blocked statement is superseded — run `35823594587` is `success` with `ci-required` `107064489142`; and `env-probe.test.ts` has a duplicate `unreportedPresentCount` key in three literals (harmless, 5 vite warnings per shard). **OPEN: acceptance 1, the keyed `m1-shipped-boot.yml` run of §7. Nothing was dispatched.** |
