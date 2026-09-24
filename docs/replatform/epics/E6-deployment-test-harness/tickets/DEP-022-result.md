# DEP-022 — The fourteen `M1a-D2-MECHANISM` cases that had no driver: the cross-tenant surfaces, the legacy tables, the cost read and the lease binding — result

**Status:** `gate_review`
**Epic:** E6 · **Plan task:** `M1a` critical path (planning session under F2, 2026-09-24) · **Milestone:** `M1a`
**Date (UTC):** `2026-09-24`
**Implementer:** Claude Opus 5 (M1 build agent)
**Start SHA:** `b12aed2f7e1efaa4d5a5ce16f503b1146174bd25` (`origin/docs/replatform-program`)
**PR:** base `docs/replatform-program` (see the final report)

> `Status` is `gate_review` and may be set to `complete` only by a DISTINCT reviewer, never by this
> author.
>
> ★★★ **NO KEYED RUN WAS DISPATCHED BY THIS SESSION, AND NONE COULD BE.** §8 records the measured
> reason, and it is not a choice: the lane REFUSES a candidate that is not already an ancestor of
> `docs/replatform-program`, so this branch's code cannot run on it before the PR merges. §8 names
> exactly what must be dispatched afterwards, in what order, and what each run shows if it is
> wrong. **Both authorised keyed runs remain unspent.**

---

## 0. What this ticket is

The E5 exit-gate audit `a2`
(`docs/replatform/epics/E5-workspaces-secrets/qa/2026-09-24-d0-e5-exit-gate-audit-7be35ae6b771-a2.md`,
`Result: fail`) failed criterion 7 on two rules, and R5's sentence names this ticket's whole job:

> *"declares nine `d2m.tenant.cross.*` cases and every one is `pending`"*

`DEP-020` gave the lane its fault-matrix step, and it files rows for the three cases the journey
itself observes. The other twenty had **no driver at all**. Measured at the tip: `M1a-D2-MECHANISM`
declared 26 cases, **3 required, 23 pending**.

| Deliverable | Where it stands |
|---|---|
| The nine `d2m.tenant.cross.*` drivers | **BUILT**, flipped to `required` (§2) |
| `d2m.credential.wrong_lease_redemption_refused` (clause 4's D2 observation) | **BUILT**, flipped (§2) |
| The four `d2m.tenant.legacy.*` (the free twins of the same probe) | **BUILT**, flipped (§3.1) |
| `d2m.redaction.planted_canary_scrubbed` (clause 5's floor) | **NOT BUILT** — blocked one layer deeper than a keyed run, re-measured link by link at HEAD (§4) |
| The lane's suppressed-injection control | **BUILT** (§5) |
| A live run showing each injection fire | **NOT DONE** — structurally impossible pre-merge (§8) |

**The profile now stands at 26 declared, 17 required, 9 pending.** Every one of R5's nine is
`required`.

---

## 1. The drivers are the D1 lane's own, not a second set

`scripts/m1-shipped-boot/cross-tenant.mjs` performs no injection of its own. Every one comes from
`tests/d1/lib/e6f-harness.mjs` — the helpers the `M1-D1-SPINE` profile already proves live on the
`m1-fault-matrix` job. What stopped the shipped-boot lane reusing them was one thing: the harness
hardcoded `-f docker-compose.d1.yml` into all seven of its `docker compose` calls, and
`test-runner` (a D1-only service) into all twenty of its HTTP-client `dexec`s.

So DEP-022 made that binding a **parameter**, default-identical:

| Symbol | Default | This lane |
|---|---|---|
| `composeBaseArgs()` (`e6f-harness.mjs`) | `compose -f <the D1 file>` | `compose -p aoa-m1-boot --env-file <state.envFile> -f docker-compose.staging.yml -f docker/m1-boot/docker-compose.m1-boot.yml` |
| `HTTP_SERVICE` (`e6f-harness.mjs`) | `test-runner` | `control-plane` |

★ **Why the HTTP clients may exec into `control-plane`.** The worker-control surface authenticates
a device proof plus a session JWT (`server/src/services/worker-device-proof.ts`); there is no
loopback or origin trust anywhere on that path, so a client inside the control-plane container is
exactly as unprivileged as one inside `test-runner`. What the container supplies is a seat on the
compose network and a `node` with `postgres` present — the same two things `test-runner` supplies
on D1.

Writing a second set of drivers would have given this gate different injections from the ones the
D1 record names. That is how two lanes come to disagree about what "the same case" means.

**The positive control for a default-identical refactor** is
`scripts/lib/__tests__/e6f-harness-binding.test.mjs`: it loads the harness in a child process per
case (the binding is read at module load, so one process could only ever observe one state) and
asserts BOTH directions — the untouched default argv, and that each override takes effect. It also
greps the harness for a surviving hardcoded argv, which is what caught the last one.

---

## 2. The eleven the brief named

Every case asserts its **same-tenant positive control FIRST**, and a failing control fails the
phase **before** the denial is classified. Ruling F10's requirement, and this lane's own history:
`resolveExecutionSecretHttp` once failed `safeParse` on *every* resolve, so a cross-tenant denial
"passed" while nothing worked at all.

| Case | Injection | Same-tenant control |
|---|---|---|
| `cross.lease` | B's session + device key + worker id renew A's live lease | A's own renew returns `renewed` |
| `cross.read` | `job_events` read under B's tenant GUC on the non-owner `aoa_app` pool | the same read under A's scope returns rows |
| `cross.cancel` | the PRODUCTION reconciliation service under B's org/company against A's job | the same service cancels A's own throwaway job |
| `cross.events` | B's worker uploads onto A's fence, and ACKs A's lease (A's org, company, job, lease, fence; B's worker id) | A's own batch is `accepted`; the shared `evaluateCrossTenantIsolation` verdict decides (see §3.4) |
| `cross.secrets` | B's worker redeems A's handle | **A's own redemption RESOLVES** — see below |
| `cross.staged_inputs` | B's worker requests a DOWNLOAD grant on A's committed artifact (see §3.3) | A's own download grant is `download_granted` |
| `cross.outputs` | B's worker commits onto A's attempt | A's own commit is `committed` |
| `cross.cost_rows` | B's companyId reads A's charges through `costService.byAgent` | A's own read returns a NON-ZERO charge |
| `cross.tool_calls` | A's LOCAL run id under B's companyId | the SAME run under A's own companyId is `admit` |
| `credential.wrong_lease_redemption_refused` | the same worker, job and handle, presenting the OTHER attempt's live lease | the identical request with its own lease RESOLVES |

★ **`cross.secrets` is stronger here than its D1 mirror, and that is the point of putting it on
this gate.** The D1 case's own record concedes that its route arm *"carries NO positive control of
its own: a `resolved` reply needs a real credential, which is the KEYED gate's case
(`d2m.tenant.cross.secrets`)"*. Here the handle is written through the server's own
`secretService`, so the owner's redemption really resolves — the route arm finally has the control
the D1 case could not have. The RLS row pair (`job_secret_handles` under each tenant's scope) is
kept as a second, independent arm: its denial is mutation-sensitive to the POLICY rather than to
the fence.

**The denials are PINNED, not "anything that is not 200".** `409 stale_fence` on the fenced
surfaces, `not_found` from the cancellation service, `0` rows under RLS. Accepting a `malformed`
would accept a PROTOCOL refusal that never reaches the tenant boundary; accepting a 500 would prove
no enforcement whatever.

The hostile identity is the half an attacker controls: the attacker's session, device key and
worker id, against the victim's Organization, Company, job, lease and fence — so a refusal cannot
be the session-vs-batch identity check (the DEP-016 lesson).

---

## 3. ★ Sweep the class, never the instance

### 3.1 The four legacy tables — a known twin, not left behind

The brief named eleven. `probeLegacyTableIsolation` — the single probe the `cross.cost_rows` case
needs — returns all four `d2m.tenant.legacy.*` tables with their own `own`/`foreign`/`unscoped`
arms in the same call. **The class:** *a declared case whose driver already runs on this lane and
is still marked `pending`.* Leaving four standing beside ten fixed neighbours is worse than the
original: the next reader sees the fixed ones and assumes the family is handled. So all four are
filed, each with its positive control (`own > 0`) and its **anti-vacuity** control (`unscoped > 0` —
the same read with the tenant predicate REMOVED must return the row, or `foreign === 0` is equally
explained by an empty table).

**Checked all 26 declared cases in the profile; found 14 with a driver available on this lane;
flipped 14. The remaining 9 are named in §6 with the measured reason each is still pending.**

### 3.2 A credential-bearing reply reported whole — found on MY OWN diff

**The class, in one sentence:** *a control-plane reply that MATERIALISES a credential, reported
WHOLE out of the container, where any caller's failure path or evidence write can publish it.*

Found by the self-audit (family 1) before the first push, and E.1(a) is exactly why it was looked
for: this module mints credential-shaped canaries and then asks the control plane to REDEEM one —
the owner's resolve is the positive control, so it SUCCEEDS and the reply carries the value. Every
`fail()` in the new driver was about to embed `truncate(res.stdout)` from that call into an error
message that `journey.mjs` writes into `cross-tenant-observations.json` and tees into the job log.
`journey.mjs`'s own `redactSecrets` could not have caught it: it knows the JOB secrets, and these
values are minted in the driver.

**Both halves fixed, in this PR:**

1. **At the root.** `resolveExecutionSecretHttp` now narrows its reply to `{outcome, reason, code}`
   INSIDE the container. Swept rather than assumed: every `.body` use on a resolve result, in
   `tests/d1/m1-fault-matrix.test.mjs` and in the new driver, reads only those three. The value no
   longer leaves the container on either lane.
2. **Caller-side.** `cross-tenant.mjs` registers everything it mints (`mint()`) and scrubs every
   `fail()` message and every `truncate()`, longest-value-first.

**Enumerated, by a search I can quote** — the eight HTTP clients in the harness that report
`{ status, body }`: three carry credential-bearing bodies. `enroll` returns the session and
`artifactTransferGrant` returns a presigned url, and their callers need exactly those, so they are
deliberately NOT narrowed and are handled at the RECORDING boundary instead (`responseFacts`, four
fields, in both lanes' drivers). Only the resolve had a value no caller reads.

**THE DUAL (E.1b), searched and reported although it found nothing:** a SUCCESS path recording the
same stream. Every `record(…)` detail in the new driver carries narrowed facts only — counts, ids
and `responseFacts` — never a body or a raw stream.

### 3.3 One operation of a two-operation route — RAISED BY CODEX, and its D1 twin fixed with it

**The class:** *a surface certified through ONE operation of a route that has TWO, each with its own
tenant-scoped lookup.*

`d2m.tenant.cross.staged_inputs` originally classified on an **upload** grant — a fence check over
a key PREFIX. Production staged-input resolution asks for a **download** grant on an
ALREADY-COMMITTED artifact, and that branch has its own tenant-scoped
`repos.jobArtifacts.findCommitted` and, verified at source, **the tree's only production
`presignGet` call site** (`server/src/services/artifact-transfer-grant.ts`). A regression in either
would have left a newly-`required` case green.

Fixed by classifying on a **download pair over the artifact the outputs case has just committed** —
free, because the fixture already commits one — with the owner's `download_granted` asserted first.
The upload pair is kept as a recorded second observation, never as the control.

★ **The twin was fixed in the same PR, not filed.** `d1.tenant.cross.staged_inputs`
(`tests/d1/m1-fault-matrix.test.mjs`) certified the same surface the same one-sided way. A known
twin left behind is worse than the original: the next reader sees a fixed neighbour and assumes the
family is handled. Both cases now assert the same download pair, and the D1 one is proven on the
lane's own live `m1-fault-matrix` job.

### 3.4 A second predicate for an injection that already had one — RAISED BY CODEX (round 2)

**The class:** *a driver that restates a shared verdict instead of calling it, so the two drift.*

`d2m.tenant.cross.events` classified on `status !== 200 || ack !== "accepted"`. Under that
predicate a 500, a transport-shaped failure or a malformed 200 all read as a DENIAL while proving
no enforcement whatever — and `evaluateCrossTenantIsolation`
(`scripts/lib/m1-spine-assertions.mjs`) already carries a comment about exactly that trap, from its
own Codex P2 on PR #566.

Fixed by **deleting the second predicate**: the driver now builds DEP-016's own observation shape
and calls `evaluateCrossTenantIsolation`, so both lanes share one verdict. That pins the upload
refusal AND the ack refusal to their exact status+code, requires the owner's own upload to be
accepted, requires the foreign scope to read zero and the owner's to read more, and requires the
hostile batch to have minted no usage event and no cost row. The driver also performs the hostile
ACK the first version never made, and asserts the FULL verdict — not only the two codes the row
classifies on, because a foreign ack that was ACCEPTED is an isolation failure no `cross.events`
classification names. `FOREIGN_STATUS`/`FOREIGN_CODE` are now IMPORTED from that same module rather
than re-chosen: a copy is a thing that drifts.

### 3.5 A control that could never pass — MY OWN ROUND-2 FIX, caught by Codex (round 3)

**The class:** *a control that cannot pass, which is the same failure as a check that cannot fail.*

The round-2 fix added an unconditional `fail()` on the shared isolation verdict. Under
`--suppress-injection` that verdict is guaranteed to be red — which is correct — but the throw
exited **before** the verdict loop emits the `injection_did_not_fire` markers the workflow's
suppression-control step greps for. So the control this file exists to provide would have failed on
**every** dispatch, in both modes.

Two things were wrong, and the second was worse than the one raised:

1. **The throw is deferred.** Isolation violations now go into `deferred` and are folded into the
   one verdict at the end of the function — the single place that emits every per-case marker
   before it fails.
2. ★ **Suppression is a SKIP, not a SUBSTITUTION.** The original design made the "attacker" *be*
   the victim when suppressed. Found while fixing (1), by walking every early `fail()` and asking
   which of them a suppressed run reaches: the suppressed **cancel** would have cancelled the
   victim's own attempt, after which every later case would have failed on `attempt_terminal` —
   another early refusal, before any marker. So `hostileOrSkip` now omits the hostile act entirely
   and returns a sentinel no classifier reads as a denial; the read probes' foreign scope becomes
   `null` rather than the owner's own, so a suppressed run cannot look like isolation; and the
   legacy probe's attacker is the owner, which forces `not_filtered`.

**Swept, both polarities.** Every hostile act: 7 through `hostileOrSkip`, 1 (`cancel`) skipped
explicitly because its sentinel shape differs, 2 read probes gated, 2 in-container probes given a
suppressed attacker, and the lease-binding arm already substituted its own lease (same-tenant, so
non-destructive). **The dual** — an early `fail()` that a suppressed run reaches for some *other*
reason — was walked too: the remaining ones all assert the OWNER's own control, which suppression
does not touch.

★ **This is the third Codex round, past the build rules' two-round cap.** It was fixed rather than
reported because it is not a property converging — it is a regression I introduced in round 2 that
would have shipped a lane whose own positive control could never pass. Reporting it and shipping it
would have been the worse failure. Nothing beyond it was fixed.

### 3.3 A row fact asserted but not measured

Three rows carried `positiveControlPassed: true` as a literal, on the reasoning that the assertion
above them had already stopped a failing control. **The class:** *a recorded fact that an assertion
guarantees rather than a measurement produces.* A later edit that loosened the assertion would ship
a control fact nothing computed. All three now re-derive the boolean from the response.

---

## 4. ★★★ Clause 5: the D2 remedy is false too, and no keyed run can make it true

`d2m.redaction.planted_canary_scrubbed`'s `pendingReason` claimed its remedy was *"a real E2B run
whose redeemed credential is a planted canary"*, and asserted that *"the DEP-017 probe's planted
execute is a real echo whose detection the mechanism a2 record already measured"*. **The brief
inherited that premise** — *"its D1 twin is structurally undriveable, so the D2 observation is what
closes it"*.

`DEP-021` §5 measured a six-link chain that kills the D1 twin. Per E.3.1 the whole chain was
**re-measured on the D2 path at HEAD**, link by link, rather than inherited:

| # | Measured at | Consequence on THIS lane |
|---|---|---|
| 1 | the per-op port | an echo's only channel out of a sandbox is `ExecuteInput.onStdout` |
| 2 | `executeRelayingStdout`, `packages/adapter-manager/src/server.ts` | that callback **is** `createRunOutputCapture`, whose canaries are `Object.values(env)` — so a planted credential is one of them — and which returns only the SCRUBBED `stdoutTail`. **The E2B provider runs behind the SAME adapter-manager as the reference provider**, so nothing about a keyed run changes this link |
| 3 | the `observeRun` call site, `packages/worker-daemon/src/supervisor/supervisor.ts` | the daemon scrubs the tail again with the run's own canaries |
| 4 | `createUsageObserver`, `packages/worker-daemon/src/supervisor/usage-observer.ts` | the tail's ONLY consumer returns `{ usage }` — four integers — and **never populates `obs.logs`**, the one field `supervisor.ts` turns into a log event. It is the only `observeRun` composed in production (`packages/worker-daemon/src/lifecycle/dispatch-runtime.ts`) |
| 5 | the WRK-018 1(b) note at that same call site | the log that WOULD have carried it was built and then **DROPPED by the planning session under ruling F2 (2026-09-23), filed `E4-F019`**. Its own words: *"acceptance 1(b) is not live-provable"* |
| 6 | `envProbeLogMessage` / `envProbeExpectedDigests`, `packages/worker-daemon/src/supervisor/env-probe.ts` | the DEP-017 probe is no alternative surface here either: it serialises **NAMES and DIGESTS**, never values, so neither the canary nor `REDACTION_MARKER` can appear in it |

**So the scrubber's marker terminates in an integer parser and reaches NEITHER declared stream, on
this lane too.** The superseded claim is true about DETECTION *inside the sandbox* and false about
the two declared STREAMS, which is what the case asserts on.

**What was done.** The `pendingReason` is **superseded in place, dated, kept verbatim in
`$supersededPendingReason`, never deleted**; `pendingKind` moves `keyed → structural`; and
`pendingOwner` is re-pointed to *"planning session (F2), which owns the WRK-018 1(b) ruling that
removed the only channel this case could be observed on"* — the same owner `DEP-021` re-pointed the
D1 twin to. Unblocking it is a DECISION to revisit F2, not a build task, so no echo channel was
added: that would ship a secret-echo capability whose every consumer discards it.

★ **This is the E.3 rule paying for itself.** Two greps and four file reads replaced a keyed run
that would have come back red for a reason that says nothing about redaction.

---

## 5. The suppressed-injection control

Mirrors `AOA_M1_FAULT_MATRIX_SUPPRESS_INJECTION` on `d1-merge-train.yml`. With
`--suppress-injection`, every hostile arm is performed by the **victim's own identity** (or, for
the read probes, under the victim's own tenant scope). The controls still pass, every case still
records and classifies, and every row carries `injectionFired: false` — so the phase MUST go red.

The lane runs exactly that, LAST (after the graded run and its verdict, so nothing it seeds can
perturb them), writes to its own `cross-tenant-suppressed.json`, fails the job if the phase
SUCCEEDS, and greps two markers to prove the red came from the injection rather than a bring-up
failure:

- `[cross-tenant:evidence]` — the phase's own verdict, not a crash;
- `injection_did_not_fire case=<id>` — one line per case, so **every** declared case appears in the
  suppressed reds by construction rather than by a list somebody maintains.

---

## 6. What is still `pending`, and why

| Case | Kind | Why |
|---|---|---|
| `d2m.cancellation.leased_attempt` | keyed | needs a real sandbox-bearing attempt |
| `d2m.provider_failure.e2b_create_refused` | keyed | needs a refused real E2B create |
| `d2m.reconcile.daemon_restart_with_live_lease` | keyed | needs the real daemon and a live sandbox |
| `d2m.cleanup.sandbox_destroyed_on_terminal` | keyed | asserts a real sandbox is destroyed |
| `d2m.cleanup.sandbox_destroyed_on_cancel` | keyed | as above |
| `d2m.cleanup.sandbox_destroyed_on_lease_loss` | keyed | as above |
| `d2m.credential.production_reader_company_predicate` | keyed | unchanged by this ticket |
| `d2m.credential.lease_expired_redemption_refused` | keyed | needs the reaper against a real attempt; unchanged by this ticket |
| `d2m.redaction.planted_canary_scrubbed` | **structural** | §4 — re-pointed to F2 |

None of the six provider-dependent cases is buildable without a provider, so none was flipped on
optimism. That restraint is the same rule that flipped the fourteen: a case that cannot be driven
stays `pending` with an honest reason, because flipping it reds the keyed run and spends money to
learn it.

---

## 7. RED, GREEN and the controls

Everything in this section is **pure node**, runnable on any platform, and was run on this tree.

| Control | What was mutated | Observed |
|---|---|---|
| `e6f-harness-binding` — hardcoded-argv grep | (none; it fired on its first run against my own doc comment, which contained the literal argv) | **RED**, then green after the comment was reworded. A guard proving itself on its author |
| `check-m1-shipped-boot-shape` — candidate gate | the five DEP-022 markers added to `CANDIDATE_CONTROL_MARKERS` before the workflow carried the greps | **RED**, 6 violations, each naming its missing grep; green once the workflow carried them |
| `d2m-cross-tenant-coverage` — required-with-no-driver | `d2m.cancellation.leased_attempt` flipped to `required` with no driver | **RED**: *"declared `required` but no driver files a row for them; a keyed run would red with `case_not_run` AFTER it had already spent"*. Reverted |
| `check-m1-shipped-boot-shape.test.mjs` — marker-set pin | five markers added without updating the pinned set | **RED** on `deepStrictEqual`; green once pinned |

```
node --test scripts/lib/__tests__/e6f-harness-binding.test.mjs \
            scripts/lib/__tests__/d2m-cross-tenant-coverage.test.mjs \
            scripts/check-m1-shipped-boot-shape.test.mjs \
            scripts/lib/__tests__/m1-shipped-boot.test.mjs \
            scripts/check-campaign-fault-matrix.test.mjs
# tests 180  pass 180  fail 0
```

★ **`d2m-cross-tenant-coverage.test.mjs` is the E.2.1 SECOND SOURCE.**
`check-campaign-fault-matrix.mjs` validates the declaration against itself, so it is perfectly
happy with a case flipped to `required` that no driver fires — *a guard whose input is the file you
just wrote can only answer "is what I wrote well-formed?", never "is what I wrote complete?"* So
the declaration is diffed against the DRIVER'S SOURCE, two-sided: a `required` case with no driver,
AND a driver for a case still `pending` (which would red the bundle with `pending_case_reported`).
Its own non-vacuity arm asserts the id extraction found ids at all.

The full pre-push guard set (every `scripts/check-*.mjs` named in `pr.yml`, plus
`check-evidence-immutability --base origin/docs/replatform-program`) is **green: `failures: 0`**.

---

## 8. ★★★ What has NOT been observed, and the exact runs that would observe it

**No case in this PR has been seen to fire live.** That is a real gap against the brief's rule —
*"Every declared case must have a run showing its injection FIRED"* — and it is not a choice:

`.github/workflows/m1-shipped-boot.yml`'s *"Bind the run to the candidate"* step runs
`git merge-base --is-ancestor "$CANDIDATE" FETCH_HEAD` against `origin/docs/replatform-program` and
fails otherwise. Checkout then **replaces the workspace with the candidate**. So dispatching the
lane on this branch would run the MERGED tree, not this one — in either mode. **A pre-merge
rehearsal of these drivers on this lane is structurally impossible.** (The dispatch itself is not
the obstacle: `d1-merge-train.yml`'s own trigger comment records `m1-shipped-boot` being dispatched
twice with `--ref docs/replatform-program` while absent from `main`.)

**What the risk of flipping fourteen cases was reduced to instead.** The `cross-tenant` step runs
in **BOTH modes** — nothing in it touches a provider; it seeds its own targets, enrols its own
workers and drives the fenced surface directly — while the `fault-matrix` step that GRADES the
flips stays **keyed-only**. So a **keyless** dispatch after merge exercises all fourteen drivers
end to end for free, and a keyed run is only ever spent confirming rows.

**The sequence to dispatch, after this PR merges** (both keyed runs remain unspent):

1. `m1-shipped-boot` **`mode=keyless`**, candidate = the merge commit.
   *Hypothesis:* the fourteen drivers fire on the shipped stack exactly as they do on D1.
   *If right:* the `cross-tenant` step is green, `cross-tenant-observations.json` carries 14 rows
   each with `injectionFired: true`, and the suppressed control reds with `injection_did_not_fire`.
   *If wrong:* the step fails naming the case and the arm, at zero cost. The most likely wrong
   answers, stated in advance so a null result is not mistaken for success: `seedSpineTarget`'s
   `worker_enrollment_codes` insert colliding with a staging-only constraint, or
   `costService.byAgent` returning `ownCents === 0` because the shipped agent's rate id is not
   `claude-sonnet-4-6`.
2. Only on a green (1): **`mode=keyed`**, the same candidate. *Hypothesis:* the journey's three
   rows and the cross-tenant fourteen combine into a bundle `check-campaign-fault-matrix.mjs`
   accepts at 17 required / 17 fired.
   *If wrong:* `fault-matrix-verdict.json` names the violating case and its violation code.

**What WAS exercised live:** the `m1-fault-matrix` job of `d1-merge-train.yml`, dispatched on this
branch, which runs this tree (it pins no candidate). That is the live control for the risky half of
the diff — the default binding and the narrowed resolve reply — on the lane those drivers already
prove. Its run id is in the final report.

---

## 9. Files changed

| File | Change |
|---|---|
| `tests/d1/lib/e6f-harness.mjs` | `composeBaseArgs()` + `HTTP_SERVICE` + `--env-file` (default-identical); the resolve reply narrowed inside the container |
| `scripts/m1-shipped-boot/cross-tenant.mjs` | **new** — the fourteen drivers, their controls, the suppression arm and the caller-side scrubber |
| `scripts/m1-shipped-boot/journey.mjs` | the `cross-tenant` phase; `faultMatrix` consumes its observations and REFUSES if they are absent or suppressed |
| `.github/workflows/m1-shipped-boot.yml` | the `cross-tenant` step (both modes), the suppressed-injection positive control, five DEP-022 candidate greps |
| `scripts/lib/m1-shipped-boot-shape.mjs` | `cross-tenant` added to `TEED_PHASES`; five markers added to `CANDIDATE_CONTROL_MARKERS` |
| `scripts/check-m1-shipped-boot-shape.test.mjs` | the pinned marker set extended |
| `tests/d1/fault-matrix.json` | 14 cases `pending → required` (each keeping its old reason in `$supersededPendingReason`); the two cost cases' `observedBy` corrected to what is measured; clause 5 superseded in place |
| `scripts/lib/__tests__/e6f-harness-binding.test.mjs` | **new** — the binding's positive control |
| `scripts/lib/__tests__/d2m-cross-tenant-coverage.test.mjs` | **new** — the declaration's second source |
| `.github/workflows/pr.yml`, `scripts/test-execution-census.json`, `scripts/test-inventory.json` | the two new suites wired and declared |

★ The register delta was asserted against the MERGE REF, not against this worktree. The only shared
registers touched are `test-execution-census.json` (two keys ADDED, none dropped) and
`test-inventory.json` (`scripts` pin 72 → 74). `check-test-inventory --write` also proposed raising
the `server` FLOOR 1585 → 1586; that was **reverted**, because it is an unrelated drift this ticket
did not measure and a floor is not a thing to bump in passing.

---

## 10. What this ticket does NOT do

- It does not dispatch a keyed run (§8), and it claims no live observation of the D2 drivers.
- It does not build `d2m.redaction.planted_canary_scrubbed`, and it does not add the echo channel
  that would be needed (§4) — that is a decision on ruling F2.
- It does not touch the six provider-dependent cases, and it does not touch the `M1-D2-CODING`
  profile, whose identical twenty-three pending cases remain the next lane's work.
- It does not edit any immutable record. The E5 exit-gate audit and the two `M1a` gate records were
  read and are cited; none was modified.
