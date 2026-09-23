# WRK-018 Result - the usage producer: an optional stdout channel on the provider port and a composed `observeRun`

**Status:** `gate_review`
**Date (UTC):** `2026-09-21`
**Epic:** `E4-worker-daemon`
**Plan task:** `E4 implementation-plan §4c WRK-018 - the usage producer (M1a Track A)`
**Implementer:** `Claude Opus 5 (M1 build agent)`
**Start SHA:** `e5bc0bc81` (`origin/docs/replatform-program` after the rebase)
**Reviewed revision:** `ad4cdfdf28ddb8bb66b730a4b9f66f7de2e7785f` (code + registers after four Codex fixes; only this record's CI section changes after it). *Superseded value: `5bc5cc71835d0c1ddb01376233c43f298f061f22`, the pre-Codex head.*
**PR:** #546 (base `docs/replatform-program`)

The implementer leaves `Status` at `gate_review`. A separate reviewer is the only role that may
change it to `complete`.

★★★ **The keyed acceptance run (acceptance 1, F8 envelope) is PENDING.** It is not this ticket's to
dispatch; the planning session dispatches it. Everything below is key-less: the fake provider, the
E2B mock transport, and the real gated adapter-manager wire on loopback.

---

## 0. CHECK THIS FIRST (M1 plan §9) - answered from source, PASS

| Question | Source | Answer |
|---|---|---|
| The argv the sandbox runs | `server/src/services/task-run-sandbox-invocation.ts` (the `exec "$0" --print - ...` shell strings) | `--print - --dangerously-skip-permissions --output-format stream-json --verbose` |
| The local adapter's argv | `packages/adapters/claude-local/src/server/execute.ts` (`const args = ["--print", "-", "--output-format", "stream-json", "--verbose"]`) | same output format |
| The existing parser | `parseClaudeStreamJson` (`packages/adapters/claude-local/src/server/parse.ts`), called from `execute.ts` on `proc.stdout` for heartbeat cost events | last `type:"result"` line; `usage.input_tokens -> inputTokens`, `usage.output_tokens -> outputTokens`, `usage.cache_read_input_tokens -> cachedInputTokens`; missing field = 0 |
| Does a REAL transcript carry it? | `server/src/__tests__/fixtures/claude-stream-json-tool-call.jsonl` (real CLI capture, commit `cdc078d56`) | yes - final line `{"type":"result",...,"usage":{"input_tokens":7,...,"cache_read_input_tokens":61348,"output_tokens":352,...}}` |

No paid model call was made. `JOB-016`'s closure is not broken by the format.

## 1. What shipped

| Slice | Change | Files |
|---|---|---|
| A | `ExecuteInput.onStdout?` - the OPTIONAL channel. The supervisor passes it only when an `observeRun` is composed, so without one the input is byte-identical. | `packages/worker-daemon/src/supervisor/provider.ts` |
| A | `createRunOutputCapture` - per run, a bounded (1 MiB) WHOLE-LINE stdout tail, scrubbed at read time with the run's OWN live canary array (the same reference its event sequencer reads), multi-line canaries scrubbed per segment, a residual needle drops the whole tail (fail closed), late chunks dropped; `run_output_dropped{reason}` counted. | `packages/worker-daemon/src/supervisor/run-output.ts` (**create**) |
| A | `parseClaudeStreamJsonUsage` + `createUsageObserver` - the daemon-local port (E4-D13); usage only, never log events; `runtimeMillis` = the supervisor's execute window; no parseable usage -> `usage: null` + `run_usage_missing_total`. | `packages/worker-daemon/src/supervisor/usage-observer.ts` (**create**) |
| A | `runLifecycle` opens the capture before `execute`, closes it on every exit, passes `output: {stdoutTail, runtimeMillis}` to `observeRun` (additive field). | `packages/worker-daemon/src/supervisor/supervisor.ts` |
| A | `composeDispatchRuntime` composes `observeRun: createUsageObserver({ metrics })`. | `packages/worker-daemon/src/lifecycle/dispatch-runtime.ts` |
| A | Barrel exports (the AM reuses the capture). | `packages/worker-daemon/src/index.ts` |
| B | `E2bSandboxProvider.execute` hands `onStdout` to the transport's existing CLI-003/D1 handler; without it the call keeps its one-argument shape. stdout only. | `packages/sandbox-e2b-provider/src/e2b-provider.ts` |
| C | `EXECUTE_CAPTURE_STDOUT_KEY` / `EXECUTE_STDOUT_TAIL_KEY` wire fields. | `packages/provider-wire/src/codec.ts`, `index.ts` |
| C | Driver: `onStdout` -> `captureStdout: true` flag (never the function); replays the returned tail; strips it from `ExecuteResult`; a missing/garbled tail = no output. | `packages/provider-wire/src/driver.ts` |
| C | `executeRelayingStdout` on BOTH the gated and the keyless execute routes: captures with the daemon's own `createRunOutputCapture`, scrubbed with THAT request's env values, before encoding. | `packages/adapter-manager/src/server.ts` |

**Decision recorded:** E4-D13 (`docs/replatform/epics/E4-worker-daemon/decisions.md`) - port the
format rather than import or inject the parser; the channel is an optional callback; per-run,
read-time, whole-line, fail-closed scrubbing on both lanes.

## 2. RED -> GREEN

| Slice | RED (before the implementation) | GREEN |
|---|---|---|
| A | `usage-observer.test.ts`, `usage-stream-redaction.test.ts`: `Cannot find module` (the modules did not exist); `dispatch-runtime.test.ts`: `expected 'undefined' to be 'function'` (the flipped pin) + the not-a-stub case; `supervisor-producers-terminal.test.ts`: `expected undefined to be 'hello\nworld\n'`. 3 failed / 36 passed + 2 files failing to load. | 59/59 (4 files) |
| B | `streaming.test.ts`: `expected [] to deeply equal [...]` (execute never forwarded) and the E2B-lane canary case `expected '' to contain '<canary>'` (the positive control: nothing streamed). 2 failed / 5 passed. | 7/7 |
| C | `driver-usage-stream.test.ts`: 2 failed / 3 passed (`expected undefined to be true` - no flag sent). `server-usage-stream.test.ts`: 4 failed / 1 passed (no tail; the full-lane supervisor run emitted `usage` x0). | 5/5 and 5/5 |

Full suites at the reviewed revision (local, Windows): worker-daemon 1062 passed / 1 skipped;
sandbox-e2b-provider 131 / 31 skipped (keyed); provider-wire 68 / 1 skipped; adapter-manager 160.
Typecheck + build green for worker-protocol, worker-daemon, sandbox-e2b-provider, provider-wire,
adapter-manager, worker-networked-host, worker-keystore, provider-capability.
`pnpm check:worker-daemon-boundary`: PASS.

## 3. Mutation / positive-control table (each reverted afterwards)

| # | Mutation | Reds |
|---|---|---|
| M1 | delete the scrub in `scrubOutputText` | split-chunk canary; supervisor canary (observer input); multi-tenant |
| M1-x | M1 in the daemon, dist rebuilt, then run the OTHER lanes | E2B-lane canary; all 4 adapter-manager canary/lane cases |
| M2 | drop `observeRun` from `makeSupervisor({...})` | both flipped `dispatch-runtime` pins |
| M3 | capture scrubs with `[]` instead of the run's canaries | supervisor canary; drop counter; multi-tenant |
| M4 | FIRST result line wins (pre-P1 scanner; superseded by the final-line rule) | the last-line parity case |
| M5 | one capture shared across runs | 6 cases incl. multi-tenant and byte-identical |
| M6 | pass `onStdout` even with no `observeRun` | the channel-is-inert case |
| MB | E2B provider always passes a handlers object | the one-argument/no-handlers case |
| MC1 | AM scrubs with `[]` | all 4 canary-on-the-wire cases (reads the RAW HTTP body) |
| MC2 | driver never replays the tail | the replay case |
| MC3 | AM captures regardless of the flag | the no-flag byte-identical case |
| MP3 | revert tokenCount's present-non-number rule, or the `corrupt` result sentinel | the respective Codex-P2 #2 case |
| MP4 | drop the `usage`-key marker check | the structural-redaction case |
| MP5 | excuse marker-containing needles again | the exact-marker canary case |
| MP2 | revert the Codex P2 fix (plain `includes` residual check) | the marker-substring canary case (`"red"`, `"redacted"`, `"a"` dropped every tail as `unscrubbable`) |

**Positive controls that stop the canary tests being vacuous:** each lane asserts the canary WAS in
the stream the provider delivered (`delivered` / `transport.stdoutSeen`) before asserting it reached
nothing. The assertions look at what `observeRun` RECEIVES and at the raw HTTP response, not only at
events: the usage event is four integers, so an events-only check would stay green with the scrubber
deleted.

**Codex P2 on `6642aa412` (fixed at source):** the fail-closed residual check used `includes`, so a
canary that is a substring of the marker `«redacted»` (e.g. `"red"`) matched the marker it had just
been replaced by and dropped every tail - usage silently lost. The check now ignores an occurrence
lying WHOLLY inside a marker span and still refuses one that overlaps outside text (the re-formed
`w«redacted»` case stays red). RED first: `expected [ 'unscrubbable' ] to deeply equal []`.

**Codex P2 on `4a56c56e5` (verified, fixed at source):** a present non-numeric count fell back to
0 (server parity), so a count the scrubber hit, or a string count, produced a plausible zero-token
usage event. Verified detail: a bare JSON number hit by redaction makes the line unparseable (the
marker is not a JSON token), so the live variant was that an EARLIER result line could then stand in
for the corrupted final one. Now: a present non-number is no usage, and an unparseable line that
claims `"type":"result"` voids usage unless a later valid result line follows. RED first
(`expected { inputTokens: +0, ... } to be null`; `expected { inputTokens: 1, ... } to be null`).

**Codex P1 on `46e938ecd` (verified, fixed by closing the class):** a canary overlapping a
structural token (`result`, or a `usage` key) can leave valid JSON that is misread - an earlier
result line standing in, or a redacted key reading as 0. The three Codex findings are one class
(redaction interacting with structure), so the fix removes the class rather than the variant:
usage is read ONLY from the final non-empty line, which must be exactly `type:"result"` with no
marker in any `usage` key; otherwise no usage. RED first (`expected { inputTokens: 1, ... } to be
null`); mutation MP4 (drop the key-marker check) reds the structural case.

**Codex P2 on `ef291ded7` (verified, fixed at source):** the inside-a-marker allowance (added for
the first P2) excused a canary EQUAL to the marker, since its every occurrence is "inside a marker".
Needles that contain the marker are now never excused; the exact-marker canary refuses the tail.
RED first (`expected 'secret=«redacted»
' not to contain '«redacted»'`); mutation MP5 (drop the
rule) reds it.

**A vacuous test caught and fixed during the build:** the first "empty tail" case asserted inside
the observer, whose throw the supervisor swallows, so it passed in RED. It now records and asserts
outside. **A flake caught and fixed:** a residual-scrub fixture used the hex needle `"bc"`, which the
sequencer's event scrub also applied to random event ids (~1 run in 10 failed); non-hex needles,
15/15 green.

## 4. Acceptance, clause by clause

| # | Clause | Evidence |
|---|---|---|
| 1 | one real keyed run emits exactly one `usage` equal to the result line — **AMENDED 2026-09-23 into 1(a)/1(b)/1(c); see the final section** | key-less equivalents on all three lanes: `usage-stream-redaction.test.ts` (fake), `streaming.test.ts` "E2B lane end to end", `server-usage-stream.test.ts` "networked LANE end to end" |
| 2 | a planted canary appears in no event, log or evidence, per lane | fake: observer input + events + logger; E2B mock: same; networked: raw HTTP body + observer input + events |
| 3 | no parseable usage -> no `usage` event, run does not fail | "no parseable usage" case: `attempt_started -> terminal(succeeded)`, `run_usage_missing_total 1` |
| 4 | a provider without the channel is byte-identical | "does NOT implement the channel" case (event streams equal minus ids/timestamps/digests); E2B one-arg call; driver body == pre-channel `encodeOpRequest` |
| 5 | pin flipped + a removed composition reds | `dispatch-runtime.test.ts` two cases; mutation M2 |
| 6 | multi-tenant (F10) | two Organizations' concurrent runs on one supervisor (fake lane) and through `makeRunProvider` -> gated AM (networked lane); two AM executes for two orgs; org-a's capability refused on org-b's sandbox |

## 5. CI

PR run `35593307741` on head `ad4cdfdf28ddb8bb66b730a4b9f66f7de2e7785f`: **`ci-required` success**
(job `106317833782`), every job success. *(An earlier record of run `35585686144` on `c9e57bcf9`,
also all-green, predates the last three Codex fixes and is superseded by this run.)*

| `verify` shard (job) | executed | WRK-018 suites in the shard (executed count) |
|---|---|---|
| 106312409044 | 6403 passed / 12 skipped | - |
| 106312409094 | 6229 passed / 33 skipped | `usage-stream-redaction` 15, `supervisor-producers-terminal` 11 |
| 106312409173 | 5904 passed / 29 skipped | `dispatch-runtime` 28, `server-usage-stream` 5, `streaming` 7, `usage-observer` 11, `driver-usage-stream` 5 |
| 106312409202 | 6123 passed / 2 skipped | - |

Every WRK-018 suite executed on Linux with a non-zero count; none is `skipIf(win32)`-gated.

Codex (`chatgpt-codex-connector`): four findings across `6642aa412`, `4a56c56e5`, `46e938ecd` and
`ef291ded7` (three P2, one P1), each verified, fixed at source, replied to and resolved (section 3);
the review on `ad4cdfdf2` completed with no findings.

## 6. What this does NOT do, and records now stale

- **Not proven live** (acceptance 1). The one keyed run is the planning session's.
- **`JOB-016` untouched.** E3-F037 stays open/HIGH, owned by `JOB-016`; the E3-15-budget clause stays
  `unwired`. Dated amendments were appended (old text kept) to E3-F037 in `findings.md` and
  `scripts/finding-ownership.json`, and to `E3-15-budget` in `scripts/gate-clause-wiring.json`.
- **Server text now stale, deliberately NOT edited (the ticket makes no server change):**
  `server/src/cli/verify-e7-1-distributed-run.ts` (comment "observeRun is uncomposed"),
  `server/src/services/e7-distributed-run-verifier.ts` (the operator-facing capability reason names
  an "uncomposed observeRun" as one link; owned by the CLI-015 finding),
  `server/src/services/canary-terminal-projection.ts` (comment "observeRun is default-off").
  Several register reasons in `scripts/finding-ownership.json` justify "not reachable today" with
  "observeRun uncomposed" (the clause-4 job_events and the 64 KiB log-truncation findings). Their
  conclusions still hold - the composed observer emits `usage` only, never `log` - but the stated
  reason is now wrong.
- **No stderr** is carried; the codex adapter (E7-F027), pricing, and transcripts-as-artifacts are
  out of scope.

## Independent review

**Reviewer:** M1 review-batch-2A independent reviewer (Claude Opus 5). I did not author WRK-018, and I am not the planning session.
**Reviewed revision:** ad4cdfdf28ddb8bb66b730a4b9f66f7de2e7785f (the record's own reviewed revision; I re-checked it against the program tip `fc2eb7dde6325803c77950ac4adb1d190db0bd9a`)
**Disposition:** `approved`. The keyed acceptance 1 is **still open**; see below.
**Attempt:** 1 (see *Independent review — attempt 1* and the attempt history)

### Independent review — attempt 1

**Disposition: `approved` (code and record). Acceptance 1, the one keyed F8 run, stays OPEN.**

`ad4cdfdf28ddb8bb66b730a4b9f66f7de2e7785f` is an ancestor of the program tip `fc2eb7dde`. So are the superseded `5bc5cc71835d…`, the start SHA `e5bc0bc81` and the PR #546 merge `07b028845736e57bfc009a7f71a9d3023fc02fa8`.

`git diff ad4cdfdf2 fc2eb7dde` over every WRK-018 file is empty, except two files:
- `supervisor/supervisor.ts`
- `src/index.ts`

Both gained the DAT-009 slice-3c export hook (`79961c97c`, `f5e2aff1f`). That is another ticket's code. It adds an export window **after** `observeRun`, and it does not touch the capture/`observeRun` block (`createRunOutputCapture` … `if (obs.usage) await events.usage(obs.usage)`). I read that block at the tip.

- **§0 CHECK-THIS-FIRST, at source.**
  - `task-run-sandbox-invocation.ts` runs `exec "$0" --print - --dangerously-skip-permissions --output-format stream-json --verbose`.
  - `claude-local/src/server/execute.ts` has `args = ["--print", "-", "--output-format", "stream-json", "--verbose"]`.
  - The final line of the real capture `server/src/__tests__/fixtures/claude-stream-json-tool-call.jsonl` (added in `cdc078d56`) is `type:"result"`, with `input_tokens 7 / output_tokens 352 / cache_read_input_tokens 61348`. Its `modelUsage` block matches.
  - §0 is **true**, and the stop condition did not fire.
- **The channel, at source.**
  - The supervisor opens `createRunOutputCapture({ canaries: runCanaries, … })` only when `deps.observeRun` is set. It spreads `onStdout` into the execute input only in that case.
  - The capture is closed on the timeout, throw and success paths.
  - `observeRun` receives `output: { stdoutTail, runtimeMillis }`, where `runtimeMillis` is `now() - execStartedAt`.
  - `composeDispatchRuntime` composes `observeRun: createUsageObserver({ metrics: deps.metrics })`.
  - `parseClaudeStreamJsonUsage` reads **only** the final non-empty line. That line must parse, be exactly `type:"result"`, and have no `REDACTION_MARKER` in any `usage` key. A present non-integer count is no usage.
  - `createUsageObserver` never emits logs.
  - `scrubOutputText` refuses any residual needle, and never excuses a needle that contains the marker.

  §1 and the three Codex fixes in §3 are **true** as described.
- **CI, by job.** Run `35593307741` (`pull_request`, headSha `ad4cdfdf28dd…`, conclusion `success`, 16 jobs all `success`, `ci-required` `106317833782`). Per-job logs:
  - `verify (1)` `106312409044`: none of these files; 656 files passed / 3 skipped, 6403 tests passed / 12 skipped.
  - `verify (2)` `106312409094`: `usage-stream-redaction.test.ts (15 tests)` ✓ and `supervisor-producers-terminal.test.ts (11 tests)` ✓; 6229 / 33.
  - `verify (3)` `106312409173`: `dispatch-runtime.test.ts (28)`, `server-usage-stream.test.ts (5)`, `streaming.test.ts (7)`, `usage-observer.test.ts (11)` and `driver-usage-stream.test.ts (5)`, all ✓; 5904 / 29.
  - `verify (4)` `106312409202`: none of these files; 6123 / 2.

  Every number in §5 matches.
- **Codex.** `chatgpt-codex-connector` left four findings, on `6642aa412`, `4a56c56e5`, `46e938ecd` and `ef291ded7`. The four review threads are all `isResolved: true`. "Didn't find any major issues" was posted on `c9e57bcf9d`, on `ad4cdfdf28`, and on the final heads `a73f5a4420` and `41b1d244d8`.
- **Focused commands (§3 `WRK-018` row), rerun locally (Windows) at the tip,** after building `worker-protocol`, `worker-daemon`, `provider-wire` and `sandbox-e2b-provider`:

  | Suite | Files | Result |
  |---|---|---|
  | worker | 4 | **65 passed** |
  | e2b | `streaming.test.ts` | **7/7** |
  | wire | `driver-usage-stream.test.ts` | **5/5** |
  | AM | `server-usage-stream.test.ts` | **5/5** |

  `check:worker-daemon-boundary` gives `PASS`. The worker count is 65, not §2's "59/59". The later Codex-fix tests explain the difference, and CI's 15+11+28+11 = 65 agrees.
- **Mutations, reproduced by me and reverted** (the tree was clean after each):
  - **M2** (drop `observeRun: createUsageObserver(...)` from `composeDispatchRuntime`) gives **2 failed / 26 passed**, exactly "both flipped `dispatch-runtime` pins".
  - **M1** (delete the scrub: `scrubOutputText` returns the raw text) gives **9 failed / 56 passed**. The failures include the split-chunk canary, the supervisor-lane canary ("reaches NO event, log, or observeRun input") and the multi-tenant case, which are the three the record names. My variant also disables the fail-closed residual check, so the extra capture-level cases red too. That is consistent.
  - The rest I checked by reading the tests. The canary tests have real positive controls: `delivered` / `transport.stdoutSeen` assert that the canary **was** in the provider's stream before the tests assert it reached nothing. The AM cases read the raw HTTP body.
- **Acceptance, clause by clause (E4 plan WRK-018).**
  1. **One keyed run emits exactly one `usage` equal to the result line.** **OPEN, and PENDING by design** (F8; the planning session dispatches it). The record states this as pending in its header, in §4 and in §6. It does **not** claim it met, so I do not count it as met. The key-less equivalents on the fake, E2B-mock and networked lanes are evidence for the mechanism only.
  2. **Canary in no event, log or evidence, per lane.** **Evidenced** (key-less), and M1 reproduced.
  3. **No parseable usage ⇒ no event, and the run does not fail.** **Evidenced** by the "no parseable usage" case and `run_usage_missing_total`.
  4. **Byte-identical without the channel.** **Evidenced** by the "does NOT implement the channel" case, the one-argument E2B call, and the driver body equalling the pre-channel `encodeOpRequest`.
  5. **Pin flipped, and a removed composition reds.** **Evidenced**, and M2 reproduced.
  6. **Multi-tenant (F10).** **Real.** `usage-stream-redaction.test.ts` "two Organizations' concurrent runs on ONE daemon" asserts the two handoffs' `organizationId`s differ and runs both through `Promise.all` on one supervisor with per-lease canaries. It partitions events by `organizationId` (which accounts for every event) and asserts each side's usage equals its own result line (1/2/3 vs 40/50/60). `server-usage-stream.test.ts` runs `org-a` / `org-b` executes and refuses org-a's capability on org-b's sandbox.
- **Decision.** E4-D13 is in `decisions.md`: a daemon-local port, an optional callback, per-run read-time whole-line fail-closed scrubbing.
- **Not blocking, noted:**
  1. `Start SHA` is a 9-character short SHA (`e5bc0bc81`), not the bare 40-hex that E4 §3 step 1 names. It resolves unambiguously to an ancestor.
  2. §6 lists server comments and `finding-ownership.json` reasons that still say "observeRun uncomposed". The record discloses this and does not edit them. Their conclusions still hold (the observer emits `usage` only), but the stated reason is stale. That belongs to whoever next touches CLI-015 / those findings.
  3. I did not rerun the full package suites or every typecheck/build §2 lists. I reran the focused commands and the four builds above; all exit 0.

**What remains open after this approval:** WRK-018 acceptance 1, the keyed F8 run with its run URL. `E3-F037` stays open (now owned by `DEP-016`, per the JOB-016 record), and `E3-15-budget` stays `unwired`.

## Review attempt history

| Attempt | Reviewer | Reviewed revision | Disposition | Evidence/findings |
|---:|---|---|---|---|
| 1 | M1 review-batch-2A independent reviewer (Claude Opus 5) | `ad4cdfdf28ddb8bb66b730a4b9f66f7de2e7785f` | `approved` | §0 true at source (argv both sides; real fixture's final result line). Run `35593307741` per job: `verify (2)` 15+11, `verify (3)` 28+5+7+11+5 — all match. Four Codex threads resolved, clean on the final heads. Focused rerun 65 + 7 + 5 + 5, boundary PASS. M2 (2 failed) and M1 (9 failed) reproduced. F10 real. **Acceptance 1 (keyed F8 run) OPEN**; not claimed met. |

## Keyed acceptance 1 — the keyed run HAPPENED; acceptance 1 stays **PENDING** (added 2026-09-23, corrected the same day)

Acceptance 1 (*"one real keyed run emits exactly one `usage` equal to the result line"*) was recorded
as **PENDING** above, because the keyed dispatch is the planning session's under founder ruling F8.
It has now run.

**Evidence:** the `m1-shipped-boot` keyed journey, run **`35619555883`**, on candidate
`dd839129bf82347867180133029f242a0b4c9ed5`; `journey.json` `"passed": true`. Both enabled tenants
executed on a real E2B sandbox (ids `iofom0nu25ztf3kc5tte1` and `isqx7nvhgf40txm5vc4b6`, each in its
own tenant's worker log on that tenant's own lease), and each run's `usage_json` carries **real token
counts parsed from the shipped `claude_local` stream**:

| Tenant | inputTokens | outputTokens | durationMs |
|---|---:|---:|---:|
| a | 8 | 734 | 19563 |
| b | 8 | 730 | 19589 |

That is this ticket's producer working end to end on the real lane: the stdout/usage channel, the
per-run canary scrub, the daemon-side parser and the composed `observeRun`, with the usage reaching
the control plane and being stored.

★ **Scope, stated narrowly.** This proves the PRODUCER. It does **not** prove pricing:
`usage_json.costUsd` is `null` on both tenants, so no `cost_events` row is evidenced here. The
priced-row half belongs to `DEP-016`'s end-to-end assertion, and `E3-F037` (owned by `DEP-016`)
stays open until that lands. `E3-15-budget` stays `unwired`.

★ **Exactness caveat.** The lane's evidence shows the stored per-run usage, not a count of `usage`
events on the wire. "Exactly one `usage` event" is pinned by this ticket's keyless tests on all three
lanes; the keyed run corroborates that the one stored usage carries the result line's real numbers.

★★★ **CORRECTION, same day (Codex P1 on PR #564, and it is right).** An earlier revision of this
section marked acceptance 1 **MET** while its own "exactness caveat" conceded that the evidence does
not count `usage` events. That is the programme's own failure class — an acceptance declared met on
evidence that does not establish it — so it is withdrawn here rather than argued.

**What the keyed run DOES establish:** the producer works live. Real `claude_local` token counts,
parsed from the shipped stream inside a real E2B sandbox, reached the control plane and were stored
(the table above). Before this run, nothing proved the channel end to end on the real lane.

**What acceptance 1 additionally requires, and what is still owed:** *"exactly one `usage` equal to
the result line"* is a CARDINALITY claim about the event stream. A stored `usage_json` row cannot
distinguish one event from a duplicate or a replay. What is owed is, for the keyed attempt:
- the count of accepted `usage` events in `job_events` for that attempt — which must be exactly 1; and
- a comparison of that event's numbers with the CLI result line.

**Where that is being collected:** `DEP-016`'s spine assertions run against the real ingest and
already count rows per attempt; the cardinality assertion is added there, and the keyed lane records
it. Until a keyed run carries that assertion, acceptance 1 is **NOT met**.

**Status:** `gate_review`, and it must stay there. The distinct reviewer approved the CODE at attempt
1 and held the flip for exactly this item. A `complete` flip is not available until the cardinality
evidence exists.

---

## Acceptance 1, amended into three parts (2026-09-23, M1 planning session under founder delegation F2)

The section above leaves acceptance 1 `PENDING` on a single sentence — *"one real keyed run emits
exactly one `usage` equal to the result line"* — which names two different claims. `DEP-015`'s keyed
lane then landed (PR #567, `a08de9213`): per enabled tenant it asserts EXACTLY ONE accepted `usage`
event for the attempt, scoped to that tenant, and that `heartbeat_runs.usage_json` matches it. Codex
showed, correctly, that the second half of that assertion proves **projection** fidelity and not
**parser** correctness, because the row is projected from the same event.

So the acceptance is split, with the reason recorded so this is not read as moving goalposts. The
original sentence is kept above, unedited, as the record of what it said.

| Part | Claim | Closed by | State |
|---|---|---|---|
| **1(a)** | exactly one accepted `usage` event per attempt, belonging to that tenant | the keyed lane's `evaluateUsageCardinality` (`scripts/lib/m1-spine-assertions.mjs`), counting the attempt's accepted `usage` rows in `job_events` | closes on the next keyed run; not this ticket's to dispatch |
| **1(b)** | the numbers the worker PARSED equal the numbers accepted and stored | the keyless supervisor suites only (the observer's payload IS the event's payload) | **NOT live-provable — ruled 2026-09-23 (F2); see the section below and E4-F019** |
| **1(c)** | the parser's fidelity to a REAL `claude_local` result line | unit tests against the captured transcript fixture `server/src/__tests__/fixtures/claude-stream-json-tool-call.jsonl` (`usage-observer.test.ts`, the first case) | **met, and NOT live — stated plainly** |

### Why 1(c) is not proven live, and why that is the right trade

Proving 1(c) live would mean emitting the scrubbed result line out of the daemon so the lane could
parse it independently. That pushes tenant **model output** across the daemon boundary, which
conflicts with data minimisation and would pre-empt the still-open **F7** output-mechanism decision.
The M1 planning session ruled (F2 delegation, 2026-09-23) to log the COUNTS and not the line. The
limit that leaves is stated rather than hidden: **no live run demonstrates that the parser read a
real result line correctly**; what the live lane can show is that whatever the parser produced is
what was accepted and stored (1(b)), and the fixture shows the parser reads a real captured line
correctly (1(c)).

### 1(b): what was attempted, what was measured, why it stops (ruled 2026-09-23, F2)

**Attempted.** A worker log line carrying the four counts the parser produced — numbers and the
run's own identifiers only, scrubbed by the run's canaries — so the keyed lane could compare what
the worker PARSED with what the control plane ACCEPTED and STORED (those two being derived from one
another).

**Measured.** Five distinct Codex P1s on that single line, every one real, every one a different
surface on which a per-run canary reaches it:

| # | Surface | Disposition |
|---|---|---|
| 1 | the count KEY NAMES — `createWorkerLogger` redacts any key containing `token`, so `parsedInputTokens` logged as `"[redacted]"` in the live worker while tests using a hand-rolled logger stayed green | fixed (renamed; a case now drives the REAL logger) |
| 2 | a digits-only canary equal to, or inside, a count's decimal text — "numbers cannot carry text" was false | fixed (the set is refused) |
| 3 | the diagnostic shared the producer block's try/catch with `events.usage`, so a throwing logger suppressed the usage EVENT | fixed (its own catch; the event always follows) |
| 4 | the fixed MESSAGE and the KEY names needed the same scrub as the values | fixed in its GENERAL form (`scrubLogRecord`: message + keys + values, refused whole) |
| 5 | the SINK adds `msg` / `time` / `level` AFTER any caller-side scrub, and a redeemed secret may be any non-empty string | **not fixable caller-side** |

**Why it stops.** Proving 1(b) requires a second data path out of the worker. Every such path is
wholly subject to canary redaction, and redaction has no enforceable boundary on the caller side:
each fix moved the surface rather than removing it, and finding 5 is below every scrubber a caller
can run. Checking it would mean serializing the record the way the sink will — re-implementing the
sink, i.e. the same collision one layer down. The M1 planning session therefore DROPPED the line
(F2, 2026-09-23) on the standing rule that **redaction wins over diagnostics**, and 1(b) is recorded
as **NOT LIVE-PROVABLE**, for the same reason as 1(c). Nothing was weakened to keep the line: at
every step the refusal (drop the record) was chosen over emitting.

**Filed, because the property is pre-existing and not this ticket's:** **E4-F019** (E4 `findings.md`,
`unowned` in `scripts/finding-ownership.json`) — canary redaction has no defence when a redeemed
secret collides with a structural token, with the production-logger evidence line and the two
closure routes (constrain what may be redeemed; or serialize-and-scrub at the transport boundary).
Marked NOT introduced by WRK-018 and NOT blocking `M1a`.

**What 1(b) rests on instead:** the keyless supervisor suites, on every lane — the observer's
returned payload IS the emitted event's payload, so parser→event equality is pinned there; what no
test can pin without a live capture is that the SAME numbers survived to the control plane on a real
run. That gap is stated, not closed.

### The hardening that OUTLIVES the dropped line

The line is gone; four of the five findings' fixes are general and stay:

- `scrubLogRecord` (`run-output.ts`) — the whole-record scrub (message, keys, values), refusing a
  record rather than rewriting a message or key. Retained with **no production caller today**, said
  so in its own doc comment; it is the caller-side half of E4-F019's closure route 2.
- the digits-only-canary rule inside `scrubLogFields` — a number is never rewritten (that would
  mangle a count), but a number whose decimal text carries a canary refuses the set.
- the logger-key hazard, kept as a standing regression test: a binding key containing `token` is
  redacted by the production logger, a `…Count` key survives. Any future numeric log field inherits
  that lesson instead of rediscovering it.
- the sink-adds-keys property, kept as a measured test rather than an argument (E4-F019's evidence).

Two of the five fixes could NOT survive the removal, and that is stated rather than implied: the
count-key renames and the diagnostic's own try/catch existed only for the dropped line, so their
CODE is gone with it. Their lessons are the regression test above and E4-F019.

**Status:** unchanged — `gate_review`. A distinct reviewer alone may set `complete`.

