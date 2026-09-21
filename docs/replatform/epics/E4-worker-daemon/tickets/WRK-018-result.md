# WRK-018 Result - the usage producer: an optional stdout channel on the provider port and a composed `observeRun`

**Status:** `gate_review`
**Date (UTC):** `2026-09-21`
**Epic:** `E4-worker-daemon`
**Plan task:** `E4 implementation-plan §4c WRK-018 - the usage producer (M1a Track A)`
**Implementer:** `Claude Opus 5 (M1 build agent)`
**Start SHA:** `e5bc0bc81` (`origin/docs/replatform-program` after the rebase)
**Reviewed revision:** `5bc5cc71835d0c1ddb01376233c43f298f061f22` (code + registers; this record is committed on top)
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

**A vacuous test caught and fixed during the build:** the first "empty tail" case asserted inside
the observer, whose throw the supervisor swallows, so it passed in RED. It now records and asserts
outside. **A flake caught and fixed:** a residual-scrub fixture used the hex needle `"bc"`, which the
sequencer's event scrub also applied to random event ids (~1 run in 10 failed); non-hex needles,
15/15 green.

## 4. Acceptance, clause by clause

| # | Clause | Evidence |
|---|---|---|
| 1 | one real keyed run emits exactly one `usage` equal to the result line | **PENDING** - key-less equivalents on all three lanes: `usage-stream-redaction.test.ts` (fake), `streaming.test.ts` "E2B lane end to end", `server-usage-stream.test.ts` "networked LANE end to end" |
| 2 | a planted canary appears in no event, log or evidence, per lane | fake: observer input + events + logger; E2B mock: same; networked: raw HTTP body + observer input + events |
| 3 | no parseable usage -> no `usage` event, run does not fail | "no parseable usage" case: `attempt_started -> terminal(succeeded)`, `run_usage_missing_total 1` |
| 4 | a provider without the channel is byte-identical | "does NOT implement the channel" case (event streams equal minus ids/timestamps/digests); E2B one-arg call; driver body == pre-channel `encodeOpRequest` |
| 5 | pin flipped + a removed composition reds | `dispatch-runtime.test.ts` two cases; mutation M2 |
| 6 | multi-tenant (F10) | two Organizations' concurrent runs on one supervisor (fake lane) and through `makeRunProvider` -> gated AM (networked lane); two AM executes for two orgs; org-a's capability refused on org-b's sandbox |

## 5. CI

PR run `35585686144` on head `c9e57bcf9d1cd209902ce7d2a206f25e5cef8597` (code at that head = the
reviewed code; this CI section is the only later change): **`ci-required` success**, every job
success (`policy`, `lint`, `migrations`, `e2e`, `e2e-pgvector`, `browser`, `distributed-contract`,
`brand-check`, both `worker-protocol-contract-bytes`, `verify` 1-4).

| `verify` shard (job) | executed | WRK-018 suites in the shard (executed count) |
|---|---|---|
| 106288509907 | 6106 passed / 2 skipped | - |
| 106288509922 | 6392 passed / 12 skipped | - |
| 106288510027 | 5895 passed / 29 skipped | `dispatch-runtime` 28, `server-usage-stream` 5, `streaming` 7, `usage-observer` 7, `driver-usage-stream` 5 |
| 106288510073 | 6211 passed / 33 skipped | `usage-stream-redaction` 14, `supervisor-producers-terminal` 11 |

Every WRK-018 suite executed on Linux with a non-zero count; none is `skipIf(win32)`-gated.

Codex (`chatgpt-codex-connector`): one P2 on `6642aa412` (fixed, replied, resolved - section 3);
review on `c9e57bcf9` completed with no findings.

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
