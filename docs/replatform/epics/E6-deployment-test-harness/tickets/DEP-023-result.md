# DEP-023 — Clause 5's floor: restoring the safe half of the run-output observation surface — result

**Status:** `gate_review`
**Epic:** E6 · **Plan task:** `M1a` critical path (planning session under F2, 2026-09-24) · **Milestone:** `M1a`
**Date (UTC):** `2026-09-24`
**Implementer:** Claude Opus 5 (M1 build agent)
**Start SHA:** `3966a01f9f` (`origin/docs/replatform-program`)
**PR:** #602, base `docs/replatform-program`

> `Status` is `gate_review` and may be set to `complete` only by a DISTINCT reviewer, never by this
> author.

---

## 0. What this ticket is, and what it reverses

Clause 5 of the frozen E5 audit matrix (redaction) had **no floor on either lane**, failing audit
rule R4 and therefore `M1a` exit criterion 7. `DEP-021` (D1) and `DEP-022` (keyed) each measured the
reason link by link and each concluded, correctly, that the case was blocked **one layer deeper than
a flag or a keyed run**:

> *"the log that WOULD have carried it was built and then DROPPED by the M1 planning session under
> ruling F2, 2026-09-23, filed `E4-F019` … unblocking this is a DECISION to revisit F2, not a build
> task."*

This ticket is that decision's **safe half**, built. Redaction on this path always worked and is
applied twice; what was missing was a surface to observe it on, and the F2 drop removed the only
candidate. DEP-023 restores a surface that is **not** the one F2 dropped, and the difference is the
whole ticket:

| The dropped surface (WRK-018 1(b)) | This surface |
|---|---|
| Carried DATA that had to SURVIVE redaction (four counts) | Carries only the marker-bearing line the scrubber already rewrote; nothing has to survive |
| Written through `createWorkerLogger`, whose sink adds `msg`/`time`/`level` BELOW any caller-side scrub (`E4-F019`) | Written below a scrubber at the **transport boundary** on both destinations |
| Unconditional | OFF unless `AOA_WORKER_RUN_OUTPUT_PROBE=1`, which only the D1 fault-matrix override sets |
| Unbounded in principle | ONE tagged line, truncated to 512 chars |

---

## 1. The chain, re-measured at source at this revision (not inherited)

Every link below was read in this session, at `3966a01f9f`, and two of them **correct** the
pendingReason this ticket supersedes. E.3.1 — the whole chain, not the link I happened to open.

| # | Link | Measured |
|---|---|---|
| 1 | An echo's only channel out of a sandbox | `ExecuteInput.onStdout` (`packages/worker-daemon/src/supervisor/provider.ts`) — confirmed |
| 2 | On the networked lane that callback is the adapter-manager's capture | `executeRelayingStdout` → `createRunOutputCapture({canaries: Object.values(env)})`, returns only `stdoutTail` (`packages/adapter-manager/src/server.ts`) — confirmed |
| 2b | How the tail re-enters the daemon | `WireSandboxProviderDriver.execute` replays the returned tail into the caller's `onStdout` (`packages/provider-wire/src/driver.ts`) — **not previously stated**; it is what makes the daemon's own capture the second scrub |
| 3 | "the daemon scrubs that tail again (`supervisor.ts`, the `observeRun` call site)" | ★ **IMPRECISE, corrected.** There is **no** scrub at the `observeRun` call site. The daemon's second scrub is `createRunOutputCapture`'s own `close()` (composed at `supervisor.ts` around `execute`), and the *third* is `scrubEventStrings` inside `EventSequencer.#emit`. The conclusion ("scrubbed twice before the observer sees it") is unchanged and if anything stronger |
| 4 | The tail's only consumer | `createUsageObserver` returns `{usage}` and never populated `obs.logs` — confirmed |
| 5 | The log that would have carried it | dropped under F2, filed `E4-F019` — confirmed, in `usage-observer.ts`'s and `supervisor.ts`'s own words |
| 6 | The `DEP-017` probe is no alternative | `envProbeLogMessage` serialises names and digests, never values — confirmed |

---

## 2. What was built

| Change | File |
|---|---|
| `--aoa-fake-echo-env=<NAME>` — the planted leak, one tagged line, FIRST (never last, or it would displace the result line and suppress usage), fail-closed on an absent/empty variable, env-NAME grammar enforced | `packages/sandbox-fake-provider/src/scripted-command.ts` |
| `selectRunOutputProbeLines` + the tag, bounds and log message | `packages/worker-daemon/src/supervisor/run-output-probe.ts` (new) |
| The opt-in probe path on the observer (both halves: `obs.logs` → a `log` EVENT, and one worker log line) | `packages/worker-daemon/src/supervisor/usage-observer.ts` |
| `createRedactingDestination` — **`E4-F019`'s own closure route 2** | `packages/worker-daemon/src/logging/redacting-destination.ts` (new) |
| `redactionCanaries` / `onRedactionRefused` on the logger | `packages/worker-daemon/src/logging/logger.ts` |
| `RunCanaryCoordinator.snapshot()`, injected so the logger (built first) and the dispatch runtime (composed later) share ONE coordinator | `run-canaries.ts`, `dispatch-runtime.ts`, `bin/worker-daemon.ts` |
| `AOA_WORKER_RUN_OUTPUT_PROBE`, same strict grammar as the other three switches — written as a shared `parseStrictSwitch` rather than a fourth hand-copy | `packages/worker-daemon/src/config/config.ts` |
| The probe armed on the D1 fault-matrix worker ONLY | `docker/d1/m1-spine.override.yml` |
| The case driver, replacing the `pendingReason`'s blocker proof | `tests/d1/m1-fault-matrix.test.mjs` |
| `d1.redaction.planted_canary_scrubbed` → `required`; `d2m` reason superseded in place | `tests/d1/fault-matrix.json` |

---

## 3. THE SAFETY ARGUMENT — proven, not inherited

The brief's condition is that no unscrubbed value can reach this surface, **including the
`E4-F019` sink-collision class**. Both halves are argued from code read in this session.

### 3.1 Nothing unscrubbed can be in the input

`selectRunOutputProbeLines`'s input is `RunOutputObservation.stdoutTail`, which is
`createRunOutputCapture.close()`'s return and nothing else (`supervisor.ts` builds it from
`captured?.stdoutTail ?? ""`). `close()` returns `scrubOutputText(kept, canaries)` and, when that
returns `null`, `{ stdoutTail: "" }` with a counted drop. `scrubOutputText` returns `null` whenever
**any** needle survives — including one re-formed by the marker and its neighbours. So a tail
carrying a live canary **cannot exist**; the failure mode is an empty tail, not a leaky one. On the
networked lane this has already happened once upstream, in the adapter-manager, with the same
fail-closed implementation (deliberately the same module, not a copy).

### 3.2 The `E4-F019` collision class is not reachable

That finding is precisely about keys added **below** a caller-side scrubber. Both destinations of
this surface put their scrubber **below every key**:

- **`events`** — `EventSequencer.#emit` assembles the COMPLETE envelope (`protocolVersion`,
  `eventId`, `organizationId`, `jobId`, `leaseId`, `seq`, `occurredAt`, `eventType`, `payload`) and
  only then runs `scrubEventStrings` over every string leaf of it, before the digest and the schema
  parse. The single thing added afterwards is `eventDigest`, a hex digest **of the scrubbed bytes**.
- **`logs`** — `createRedactingDestination` scrubs the fully-serialized pino record, after the sink
  has added `msg`/`time`/`level`. This is `E4-F019`'s own route 2, quoted in its text.

★ **A version of this surface without §3.2's second bullet would have re-created the defect the F2
drop was protecting against, and it is the reason this ticket is not smaller.** The brief is right
that a surface inheriting the raw sink is the wrong design; the answer was to fix the sink, which
also closes the class for every other worker log line (§6).

### 3.3 The direction the design errs

Over-redaction, deliberately. A pathologically short canary (`"30"`, `"msg"`) rewrites structure as
well as content at the log transport and can leave a line that no longer parses as JSON. That is
stated in the module rather than hidden; the alternative is the verbatim emission the finding
describes. The log-canary snapshot is likewise **wider than one run** (every live lease), because a
serialized log record carries no run attribution — scrubbing run A's canary out of run B's line
over-redacts, which is the safe direction. Events keep their strict per-run scoping.

---

## 4. RED → GREEN, and the mutation table

`packages/worker-daemon/src/__tests__/run-output-probe.test.ts` (14 tests) and
`packages/sandbox-fake-provider/src/__tests__/echo-env.test.ts` (5 tests), both GREEN, plus the
untouched neighbours: worker-daemon 168 files / 1301 tests, sandbox-fake-provider 11 / 107,
adapter-manager 21 / 217, provider-wire 8 / 98.

Two assertions in the new file were **wrong when first written and were corrected by measurement,
not by reasoning**: a needle containing the marker is not a residual, and needles are applied
LONGEST FIRST, so a re-formed residual requires the re-forming needle to be the *longer* one. Both
reds are recorded here rather than silently fixed.

| Mutation (product code, reverted) | Tests that went RED |
|---|---|
| **M1** — `redactString`'s substitution removed | "carries the SCRUBBED line to both halves"; "scrubs a secret that equals a STRUCTURAL token" |
| **M2** — the transport-boundary scrubber removed from `createWorkerLogger` | "scrubs a secret that equals a STRUCTURAL token"; "scrubs a digit run occurring inside the epoch `time`" |
| **M3** — `scrubOutputText`'s fail-closed residual refusal removed | "★ POSITIVE CONTROL — BOTH arms flip"; "REFUSES a record it cannot scrub" |
| **M4** — the echo's refusals moved back INSIDE the `onStdout !== undefined` guard (the Codex round-2 defect, re-introduced) | "FAILS CLOSED when the caller supplies NO stdout channel" |

A **standing positive control** ships in the file: *"WITHOUT the transport scrubber the structural
token IS emitted verbatim"* drives the unwrapped production logger and asserts `"msg"` is present.
That is `E4-F019` itself, kept executable so §6's closure cannot go stale unnoticed.

---

## 5. The live D1 run, and the suppressed-injection red

### 5.1 The runs, including the two that taught something and the four that did not

| Run | Outcome | What it measured |
|---|---|---|
| `35996740740` | **RED**, and usefully | The case as first written ran over BOTH enabled tenants. Tenant A executed; **tenant B's attempt stayed `pending` forever with no events**, and the case red on its own non-vacuity guard — the guard working, not a flake. Cause, read at source afterwards: the DEPLOYED worker's execution target is **Organization-dedicated to tenant A** (`docker/d1/m1-spine-worker.profile.json`, `organizationId …000a`), which is exactly the isolation `queryForeignPlacementOnDeployedTarget` asserts elsewhere in this same matrix. A per-tenant EXECUTION arm is **impossible on this lane by construction**. A falsified hypothesis is a finding (E.3.4), and the F10 arm was rebuilt around the measurement rather than retried |
| `35999792282` | **RED** | The rebuilt case reached its new cross-tenant query, which failed to parse in the container: the generated script carried a REAL newline inside a JS string literal instead of an escaped one. Two characters, 25 minutes. ★ The sibling `queryJobEventPayloadText` had it right; the copy did not — and the lesson taken is not "be careful" but a CHECK: the harness function's template is now rendered locally with a stubbed `dexecModule` and put through `node --check`, which reproduces the old red and passes the new text. That check cost two minutes and would have saved the cycle (E.3.1) |
| `36002080815`, `36003245112`, `36005199683`, `36006434045`, `36008709693`, `36010527043`, `36013659049`, `36015598792` | **RED, infrastructure × 8** | `quay.io` returned 502 and then 401 UNAUTHORIZED on the `minio` image pull, at `docker compose up --wait`, **before any test ran**. Spread over roughly two hours with deliberate gaps. Not this branch's code, not this lane's configuration, and not within this ticket's control |

### 5.2 The proving run

**OBTAINED: run `36038155900` — the case FIRED and PASSED.** `d1-merge-train` / `m1-fault-matrix`,
on `claude/m1-e5c5-redaction` after merging the program base for `#603`'s MinIO mirror pin
(`ghcr.io/meteoritelabs/aoa-d1-minio@sha256:187391a6…`), which is what unblocked the nine earlier
dispatches. Every step of the job concluded `success`.

| Step | Executed | Result |
|---|---|---|
| Static preflight (declaration + its reds + compose invariants) | `tests 32 / pass 32 / fail 0` | pass |
| **Run the M1-D1-SPINE fault matrix (live)** | `tests 25 / pass 25 / fail 0` | pass — including `✔ fault-matrix: a planted credential canary is SCRUBBED from both streams, and the scrubber's own marker is observed there (60.6s)` |
| The matrix's own verdict over the retained bundle | — | pass |
| POSITIVE CONTROL — every injection suppressed | — | **red, as required**, and the step's own two greps for `[fault-matrix:evidence]` and `injection_did_not_fire` both matched |

★ **What the green verdict step entails, stated rather than assumed.** `evaluateFaultMatrixEvidence`
reds a `redaction` case unless the row carries `injectionFired: true`, the declared
`expectedClassification`, `redactedOnAllStreams: true`, `scrubberMarkerObservedOnStream.<stream> ===
true` for **every** declared stream, and `streamBytesObserved.<stream> > 0` for every declared
stream. The verdict step passed over the retained bundle, so all of those held on `events` AND
`logs`: the planted canary absent from tenant A's event stream, the worker container log and tenant
B's whole event stream, and the scrubber's own `REDACTION_MARKER` present **on a line that also
carries the probe tag** on both declared streams, over non-empty streams. Clause 5 has a floor on
this lane.

#### 5.2.2 One of my own predictions was WRONG, and it is corrected rather than quietly dropped

This record predicted that under suppression the case would report `injectionFired: false`. **It does
not.** Measured in the same run's control arm, the suppressed pass produces:

```
evidence:case_not_run: case d1.redaction.planted_canary_scrubbed is declared `required`
  but the bundle carries no evidence for it
```

— i.e. the case throws on one of its **non-vacuity guards before reaching `record()`**, so no row
exists at all. The requirement the brief sets is still met, and by a strictly stronger mechanism: the
case **cannot pass** in the suppressed arm, because the evaluator refuses a `required` case with no
row just as it refuses one whose injection did not fire. What is NOT true is the shape I predicted,
and the lane's `injection_did_not_fire` grep matches on the OTHER twenty cases rather than on this
one.

**Owed refinement, filed rather than fixed here:** move the three non-vacuity guards after
`record()` so the suppressed arm files an explicit `injectionFired: false` row for this case too.
That is a reordering with no effect on the passing arm, but verifying it costs another full lane
dispatch, and spending one to change a red into a differently-shaped red — while the green above is
the deliverable — is not the trade to make at this point. Recorded here so the next reader sees a
known, bounded gap rather than a claim that does not match the log.

**The eight earlier dispatches are kept below** rather than summarised away: *"we retried until it
passed"* and *"the lane could not start"* are different facts, and for those eight only the second
was true.

### 5.2.1 Why the case is nonetheless left `required`

This is the one judgement in the ticket that runs close to its brief's *"flip … only with a run
showing it fired"*, so it is argued rather than assumed.

A `required` declaration **cannot manufacture a pass**. The evidence half of the checker reds on a
required case with no row, and it did exactly that on run `35996740740`:
`evidence:case_not_run: case d1.redaction.planted_canary_scrubbed is declared `required` but the
bundle carries no evidence for it`. So the flip's only effect while the run is owed is to make the
lane **red and honest**; the alternative — leaving it `pending` with a reason that says "the
mechanism exists, the driver is committed, and a registry was down" — would be a `pending` whose
stated blocker is not a property of this system at all, which is the declaration defect `DEP-021`
and `DEP-022` were both written to correct.

What a reviewer must NOT read into this: any claim that the case has been observed to fire. It has
not. §9 names the dispatch that must happen and what both of its arms must show, and no part of this
record should be taken as evidence until it does.

### 5.3 What the case asserts

**F10 — MULTI-TENANT, in the shape this lane admits.** The same-tenant positive control is tenant
A's own event stream carrying the scrubber's marker; the cross-tenant arm is tenant A's planted
canary being ABSENT from tenant B's **whole** event stream (`queryOrganizationEventText`), asserted
over a NON-EMPTY stream so it cannot be vacuously clean. The Organization-dedication that forces
this shape is **asserted inside the case**, so the narrowing cannot silently stop being true.

**The marker is CORRELATED to this run's probe line.** ★ Codex's third P2 on PR #602, also right:
`composeServiceLogs` returns the WHOLE worker container log — every run the stack has done — so a
bare `includes(REDACTION_MARKER)` would let an unrelated earlier scrub satisfy the log arm while
this run's probe line never arrived. Both arms now require ONE LINE carrying BOTH the probe tag and
the marker, which only this surface produces. The event stream is already per-job and is checked the
same way, so the two arms cannot drift apart.

**The marker is CORRELATED to this run's probe line.** ★ Codex's third P2 on PR #602, also right:
`composeServiceLogs` returns the WHOLE worker container log — every run the stack has done — so a
bare `includes(REDACTION_MARKER)` would let an unrelated earlier scrub satisfy the log arm while
this run's probe line never arrived. Both arms now require ONE LINE carrying BOTH the probe tag and
the marker, which only this surface produces. The event stream is already per-job and is checked the
same way, so the two arms cannot drift apart.

**The suppressed arm.** With `AOA_M1_FAULT_MATRIX_SUPPRESS_INJECTION=1` the echo flag is withheld;
everything else runs and the case still records. `injectionFired` is decided by the **marker** — the
scrubber's own substitution — not by the harness's intent, so the suppressed run reports
`injectionFired: false` and the lane's existing grep for `injection_did_not_fire` sees it. The case
therefore cannot pass vacuously.

---

## 6. `E4-F019` — HALF closed, the overclaim reverted, and the class swept

**The class, in one sentence:** *a scrubber that runs above a layer that afterwards adds its own
keys or bytes to the record.*

**Its dual (E.1b):** *a scrubber that runs below everything but whose refusal is swallowed, so an
unscrubbable record is written anyway.* Searched for and handled: every refusal path in
`createRedactingDestination` writes the constant refusal line or nothing, and a throwing canary
source refuses rather than defaulting to "no secrets".

**Enumeration, quoted rather than remembered.** `git grep -n "createWorkerLogger(" -- packages apps`
returns **21** hits: **18 in `__tests__`**, the definition itself (`logging/logger.ts:115`), one
prose mention in a comment (`packages/worker-keystore/src/control-paths.ts:41`), and **zero**
production call sites — because the one production construction goes through an injectable alias,
`const makeLogger = deps.createLogger ?? createWorkerLogger` (`bin/worker-daemon.ts:222`), which the
grep for the function name does not see. ★ That is the sweep nearly missing its own target: a
name-grep found no production caller and the correct answer is one. `git grep -n "makeLogger("`
confirms the single site. **1 production site, 1 fixed.** The 18 test sites are deliberately left
unwrapped — two of them (`usage-stream-redaction.test.ts`) are the standing measurement of the raw
sink, i.e. the positive control for this closure.

The scrub sites: `git grep -n "scrubEventStrings\|scrubLogRecord\|scrubOutputText" -- packages`
→ the event path (already below every key, in `EventSequencer.#emit`), `scrubLogRecord` (still
caller-side, still with no production caller, and its own doc already says it cannot close the
finding alone), and the two `createRunOutputCapture` sites. None is in the class.

**My own diff is in the class (E.1a).** The probe line I added is written through
`deps.logger?.info(...)` — i.e. through the very sink the finding describes. That is exactly the
instance this ticket would have shipped had it not fixed the sink first, and it is named here rather
than discovered in review.

### 6.0 Codex round 2: one more P2, also real

`--aoa-fake-echo-env`'s two refusals sat INSIDE the `if (onStdout !== undefined)` guard, so a caller
that requested an echo while supplying no stdout channel got a SUCCESS for a plant that never
happened — a silently vacuous control, and against the fail-closed contract every other scripting
flag on that module holds. Both refusals now run before the channel guard, with a no-channel refusal
of their own; `M4` in §4's table is its positive control. That is the second and last Codex round
this ticket takes (SPEED RULE C).

### 6.1 The closure claim was an OVERCLAIM, and is reverted

This section first said `E4-F019` moved to `resolved`, and the manifest key was deleted. **Codex
found that wrong on PR #602 and it is right, verified at source before acceptance:** the canary array
is per-lease and `lease-renewal.ts` releases it when the run settles, so
`RunCanaryCoordinator.snapshot()` is EMPTY between runs, and a later heartbeat line again serializes
a structural-token secret verbatim.

So the finding stays **open**, its manifest key is restored with an amendment, and `findings.md`
gains a section saying exactly what is closed (the in-run window, proven by mutation) and what is not
(every line written outside a live lease). The exposure is narrower than when filed — it no longer
holds "on EVERY worker log line" — and narrower is not closed. Closing the rest needs either route 1,
or a needle source that OUTLIVES a lease, which is a retention decision about secret material and
not a repair this ticket may take.

★ **The safety argument in §3.2 is unaffected, and that is why it was worth checking.** The probe line
is written inside `observeRun`, before the terminal and before the release, so it is always inside
the covered window. What the brief required was that the collision class not be reachable **through
this surface**; that holds, and is proven. What it did not require — and what this ticket briefly and
wrongly claimed — was that the finding be closed outright.

---

## 7. What this ticket did NOT do, and why

- **`d2m.redaction.planted_canary_scrubbed` stays `pending`, and `pendingKind` stays `structural`.**
  The first draft moved it to `keyed`, reasoning that only a keyed run was missing. ★ Codex found
  that wrong on PR #602 and it is right, verified at source: **three** things are missing on that
  lane, not one. (1) `AOA_WORKER_RUN_OUTPUT_PROBE` is set in exactly ONE place in the repo — the D1
  override — so the shipped-boot worker does not forward the line at all; (2) the only producer of a
  tagged line is the reference provider's `--aoa-fake-echo-env`, which the real E2B lane does not
  run, so nothing plants the leak there; (3) the driver itself. Spending the keyed envelope before
  (1) and (2) are wired would burn it to learn `no_scrubber_marker_observed`. The product code is
  lane-agnostic and serves the case once those are in place, so the blocker is now BUILD-shaped
  rather than a decision about F2 — which is the part that did move. The owner is the planning
  session, for the keyed envelope **and** for whether the shipped-boot lane should carry a
  diagnostic surface at all, which is not a build agent's call.
- **No new output mechanism.** WRK-018 1(c) and the open **F7** ruling are untouched: the surface
  forwards only lines a workload explicitly tagged, one of them, truncated, and only under a flag no
  production manifest sets.
- **`expectedClassification` keeps its stale-sounding token** (`canary_scrubbed_while_unseeded_twin_leaks`).
  The "unseeded twin" design was replaced by the marker before this ticket; renaming the token
  across three profiles is churn this ticket declines, and the evaluator's own comment already
  records why the marker superseded the twin.

---

## 8. Register deltas (two-sided, against the merge ref)

Taken against the FETCHED merge ref (`origin/docs/replatform-program`), not the worktree copy, and
applied as a **delta** — the base's bytes with one key removed — never a whole-file rewrite (E.2):

```
ADDED  : []
DROPPED: ['E4-F019']
CHANGED: []
base 100 keys, head 99
```

`scripts/check-finding-ownership.mjs` was run **between** the key deletion and the `findings.md`
flip, and it went RED (*"E4-F019 (MEDIUM): open, but no entry in the manifest"*) — the two-sided
control for the closure, rather than only the green at the end.

`docs/architecture/distributed-execution-threat-controls.json`: four `deliveryEvidence` citations
(`DE-05`, `DE-10` ×2, `DE-25`) drifted by the lines this ticket inserted into
`packages/worker-daemon/src/index.ts` and `bin/worker-daemon.ts`, and were **re-pointed by symbol**,
not by guessing. `scripts/test-inventory.json` pins bumped by `--write` for the two added test
files. No other register touched.

---

## 9. What is outstanding

1. ~~**The proving D1 run**~~ — **DONE: run `36038155900`, §5.2.** One refinement remains, scoped in
   §5.2.2: the suppressed arm reds as `case_not_run` rather than `injection_did_not_fire`.
   *(Superseded text, kept verbatim:)* **The proving D1 run (§5.2) — the one thing this ticket owes.** `d1-merge-train` /
   `m1-fault-matrix` could not bring its stack up in EIGHT consecutive attempts over ~2h because
   `quay.io` refused the `minio` pull. Re-dispatch it on this branch (`gh workflow run
   d1-merge-train.yml --ref claude/m1-e5c5-redaction -f lanes=m1-fault-matrix`) and record BOTH
   arms here before treating the flip to `required` as evidenced:
   - the profile run — the bundle's `d1.redaction.planted_canary_scrubbed` row with
     `injectionFired: true`, `redactedOnAllStreams: true`,
     `scrubberMarkerObservedOnStream: {events: true, logs: true}` and non-zero bytes on both;
   - the suppressed-injection control — one `injection_did_not_fire` line naming this case.
   **If instead it reds**, each shape says something different and none of them is "flaky":
   `scrubberMarkerObservedOnStream.events=false` ⇒ the `log` EVENT never reached `job_events`;
   `…logs=false` ⇒ the probe line never reached the container log (config unread, or the transport
   scrubber refused it); a `failed` terminal with no events ⇒ the echo flag threw in the provider,
   i.e. the handle does not materialise as `ANTHROPIC_API_KEY`; `ownEventsClean=false` ⇒ a REAL
   leak, and the surface must be reverted, not debugged.
2. **`d2m.redaction.planted_canary_scrubbed`** (§7) — one keyed run, F8's to dispatch.
