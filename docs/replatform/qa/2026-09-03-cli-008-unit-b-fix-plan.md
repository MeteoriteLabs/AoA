# CLI-008 Unit B — the CI failure and five Codex findings

> **For agentic workers:** implement task-by-task, in order. Steps use checkbox (`- [ ]`) syntax.
> Branch `claude/cli-008-unit-b-channel`, on top of PR #340.

**Goal:** Make `verify (1)` green, and close five confirmed Codex findings **while the path still has
zero production callers** — every one of them goes live the moment Unit C or D supplies content.

★ **All five are LATENT and that is exactly why they get fixed now.** The only production caller of
`resolveExecutionOwner` is `heartbeat-distributed-rollout.ts:142`, whose input type has **no
`stagedFiles` field**, so `stageJobInput` is never invoked in production today. The change is free
now and expensive later — and later is the first moment the wrong outcome becomes *unobservable*,
because an agent running with no MCP config still produces plausible output.

---

## Task 1: The CI failure — a measurement test pinned a platform-dependent measurement

`verify (1)` failed with `expected 26351 to be 26568`. Nothing about the channel is wrong.

**Diagnosed:** git stores the instruction bundles **LF** (`AGENTS.md` 4752, `HEARTBEAT.md` 3185,
`SOUL.md` 2139); a Windows checkout with `core.autocrlf=true` expands them to CRLF (4862, 3250,
2181). **110 + 65 + 42 = 217** — exactly the discrepancy. The second failure is a cascade:
`cPlusDBytes` stayed 0 because the first case threw.

- [ ] **Step 1: Pin the bundle files `eol=lf` in `.gitattributes`.**

★ This is a **correctness fix, not a test fix**: these bytes are delivered into a **Linux sandbox** as
an agent's system prompt, so shipping CRLF there is wrong on its own terms. It changes no committed
bytes — the blobs are already LF.

The precedent is **one line away**: `.gitattributes:19` already pins
`server/src/onboarding-assets/commander/TOOLS.md`, and its comment says why — *"Pin LF so a Windows
checkout with autocrlf=true can't rewrite them to CRLF and make the drift check falsely fail."* That
is why `TOOLS.md` was the only file in the bundle with zero CRLF. Extend the pin to the sibling
files; follow the existing comment style.

- [ ] **Step 2: Make the measurement CR-independent anyway.** Strip `\r` before counting, citing
  `security-definer-manifest.ts:56`, which solved this identical class for `bodySha256`. A pin alone
  leaves the test able to re-break on an unpinned sibling added later.

- [ ] **Step 3: Correct the expected numbers to the LF values** — CI's, not Windows'. `commander`
  becomes **26,351** and C+D **26,597**. Recompute the other four rather than deriving them.

★ **Keep the exact-equality assertions.** They are the point of a measurement test. What was wrong
was measuring a platform-dependent quantity, not asserting one.

- [ ] **Step 4:** Update the quoted figures in
  `qa/2026-09-03-cli-008-unit-b-channel-decision.md` §8 and the Task 1 table. **The decision is
  unaffected** — 26,597 against a 48,960 ceiling still fits with margin, and the channel choice never
  rested on capacity. Say that explicitly rather than silently editing numbers.

- [ ] **Step 5:** Run the byte-source suite; commit.

---

## Task 2 ★: P1-a — a refusal must not reach placement

`run-execution-owner.ts:320` discards the result. `stageJobInputFiles` has **three** non-throwing
`{staged:false}` exits and only one is benign.

| exit | meaning |
|---|---|
| `:164` `no_files` | **benign** — the caller asked for nothing, postcondition holds vacuously |
| `:180` `unknown_attempt` | **refusal** — row absent, invisible under RLS, or job/attempt mismatch |
| `:190` `pointer_too_large` | **refusal** — projected extension exceeds 16,384 canonical bytes |

Today a refusal lets placement run, the attempt becomes leasable, the legacy adapter is **suppressed**,
and a worker runs the agent with no MCP config and no instructions — a silent wrong-content execution
that reports success.

- [ ] **Step 1: Throw at the CALLEE, where the reason exists.** Add an exported
  `StagedInputRefusedError` carrying the cause, and throw it at `:180` and `:190`. `:164` stays a
  return.

★ **Do NOT check the result at the call site.** It cannot discriminate: the dep type is
`Promise<{staged: boolean}>` (`run-execution-owner.ts:117`) and the composition root **narrows the
reason away** at `index.ts:1283`. A blanket `if (!result.staged) throw` would also turn every
`no_files` run into a legacy run.

- [ ] **Step 2 ★ (the load-bearing half): narrow the union type** to
  `{ staged: false; reason: "no_files" } | { staged: true; … }`. The type then *states* that a
  non-throwing `{staged:false}` can only mean "nothing was asked for", so a future reason cannot be
  added as a silent refusal by accident — there is nowhere to put it that the caller ignores.

- [ ] **Step 3:** `run-execution-owner.ts:320-322` needs **no change**. Its comment already says
  *"A throw here is a LEGACY run, not a broken one"* — this makes that true instead of aspirational.
  Verify the catch releases claimed capacity and returns `transfer_error`, and that placement never
  ran, so no attempt is left leasable.

- [ ] **Step 4:** Downgrade the `index.ts` `!result.staged` log to `debug`/"nothing to stage" — it now
  fires only for `no_files`, and a warn meaning "nothing happened, correctly" trains operators to
  ignore this channel. **Keep it**: it is the positive control that makes the drift visible if the
  caller's `length > 0` guard is ever tidied away.

- [ ] **Step 5:** Test both refusals produce `transfer_error` with an attributable message, and that
  an empty bundle does **not**. Commit.

---

## Task 3: P1-b — bound the staged write by a deadline

`supervisor.ts:620` awaits `run.effect.stageFiles(…)` bare, while every neighbour uses `withDeadline`
(`:494` secrets, `:561` create, `:656` the exec race). A stalled fetch or filesystem write means
`accept()` never terminalizes and an active sandbox is retained.

- [ ] **Step 1:** Race it with `withDeadline`, and handle the `TIMEOUT` sentinel the way `:561` does —
  the timeout path must terminalize **and** clean up, or it trades a hang for a leak.
- [ ] **Step 2:** The adjacent `deps.resolveStagedInput` at `:598` has the same shape. Bound it too.
- [ ] **Step 3:** `E2bSandboxProvider.stageFiles` ignores its context. **Racing the promise first is
  the smaller change**; honouring the signal end to end needs the transport's `writeFiles`/`fetch` to
  accept one. Do the race now and record the signal gap in the file, rather than half-building it.
- [ ] **Step 4:** Test that a hanging stage terminalizes rather than hanging. Commit.

---

## Task 4: P1-c — the activity entry (and why the last rejection does not apply)

★ **I rejected an identically-shaped Codex finding on Unit 2.5.** That writer ran as `aoa_operator`,
which holds `[]` on `activity_log` in a boot-enforced ACL certificate, so the fix would have been a
tenant-boundary widening. **This writer is the control plane on `appDb` inside `runInTenant`, and
`aoa_app` holds `["SELECT","INSERT"]`.** No widening, no certificate change. The finding is right.

- [ ] **Step 1:** One **bundle-level** entry, not one per file — a large bundle must not flood a
  tenant's feed.
- [ ] **Step 2 ★:** The payload carries **no file bytes and no secret material**: paths, digests and a
  count only. Assert that in the test.
- [ ] **Step 3:** Write it in the **same transaction** as the artifact rows. Of the two failure modes,
  an audit row with no artifacts is worse than artifacts with no audit row — but same-transaction
  avoids both, and the rows are already written inside one `runInTenant`.
- [ ] **Step 4:** Commit.

---

## Task 5: P2-a and P2-b — the object/row lifecycle

- [ ] **Step 1 (P2-a):** Move the `putObject` loop (`:195-219`) **inside** the compensation `try`, so
  a later upload failure deletes the objects already stored. Check what the existing cleanup deletes
  so the widened scope covers the right set. ★ These orphans are **permanent and undiscoverable** —
  the storage abstraction cannot list them.

- [ ] **Step 2 (P2-b):** The replay probe matches on `path` **and** `sha256`, so a changed-bytes
  restage mints a **second committed row for the same path**. Confirmed: `listForJob`
  (`repositories/tenant/index.ts:261-263`) has **no `ORDER BY`**, so which row wins is genuinely
  unspecified. Enforce one active artifact per `(attempt, path)`, or explicitly supersede.

★ The table is append-only in spirit and has **no DELETE grant**. Whichever shape you choose, say what
happens to the superseded row's already-uploaded object — an orphan there is the same permanent,
unlistable leak as P2-a.

- [ ] **Step 3:** Test both: a failed second upload leaves no objects, and a restage with new bytes
  yields exactly one effective file. Commit.

---

## Task 6: Verification

- [ ] **Step 1:** `node scripts/ci-local.mjs` — a first filter, not a verdict.
- [ ] **Step 2:** The Unit B suites, then the sharded suite. Reproduce any failure in isolation.
- [ ] **Step 3:** `check-worker-daemon-boundary`, `check-gate-clause-wiring`, and confirm
  `git diff packages/worker-protocol/src` is still **EMPTY**.
- [ ] **Step 4:** Report back — do not push. Include the corrected Task 1 numbers and the Task 2/3/5
  test results.

---

## Not in this plan

**E7-F009** — `pointerFitsExtension` projects `input.files` only, while the lease offer is built from
**all** committed rows, so repeated stages inflate the real extension past the limit while every call
reports "fits", and the job becomes permanently unleaseable with nothing naming the cause. **Filed as
its own finding, deliberately**: fixing it as part of P2-b would make it unreachable *by accident*
and leave the projection still measuring the wrong set for any future multi-stage caller. A guard
that happens to be unreachable is a false claim of enforcement.

## Self-review

**Placeholders.** None. Task 5 Step 2 states the required property rather than the shape, because
choosing between "one active per path" and "explicit supersede" depends on what the reader does, and
Task 5 Step 2's own investigation settles it.
