# BRW-004 Result — Browser secrets, network, and human approval (slices (a)–(d))

**Status:** `gate_review`
**Date (UTC):** `2026-09-04`
**Epic:** `E8-browser-automation`
**Plan task:** `program-design.md:984 — #### BRW-004`
**Implementer:** Claude Opus 5 (Track D)
**Start SHA:** 6c2fe6482b425a6a99507bdc53f49e8f94969c31

> The design records `203853b3a` as its own Start SHA. This build began at `6c2fe6482`, which is
> the branch tip after the design (`919fcd3c4`) and its seven-finding amendment (`6f3c6e893`)
> landed. Recorded as measured rather than copied from the design.

**Scope:** slices **(a)–(d)** only. Slice (e) is chartered as **JOB-015** and is not built here
(§1). Slices (f)–(h) are not attempted; (f) is now materially affected by slice (a)'s measurement.

---

## 1. The two open escalations — resolved and re-escalated

The design's header names two escalations that gate the slices below. Both are answered here, with
the evidence, and one is handed back.

### §2 D1 / §7 Q1 — "Does BRW-004 own the control-command delivery hop?" — **RESOLVED: NO.**

Three independent pieces of evidence, in order of weight:

1. **A ticket exists for it, in a different epic.**
   `docs/replatform/epics/E3-job-control/tickets/JOB-015-design.md` is on disk and its §3 slices
   (b) and (c) are precisely the server-side projection and the worker-side consumer the hop needs.
   It is E3's, not E8's.
2. **The finding register already points there.** `scripts/finding-ownership.json` binds the
   delivery-hop finding to `"ticket": "JOB-015"`, with the note that it "exists for exactly this
   defect".
3. **The orchestrator confirmed it in the build brief**, adding that JOB-015 is being built in
   parallel on `claude/job-015-control-delivery` and that this track must neither build (e) nor
   duplicate it.

**Consequence, stated plainly rather than absorbed:** BRW-004 stops at slice (d), and the
acceptance clause **"denial/timeout fails closed" is DEFERRED** — the decision is produced,
classified and durably recorded (slices (c) and (d)); nothing delivers it to a running worker.
JOB-015 §6.3 already lists BRW-004 as a consumer to notify when it lands.

### §7 Q5 — "Who authorises a v2 fixture directory, and will they?" — **RE-ESCALATED, unchanged.**

This is a fixture-owner / Protocol Custodian decision and I have no authority to take it. Nothing
in the repository names that authority: `tests/fixtures/distributed-execution/README.md` states the
rule (a breaking change, including *repurposing a field*, requires a new versioned directory
leaving v1 intact) but names no one who may create one.

It does **not** gate slice (b). Slice (b) take-2 is written to land without it — the divergence is
pinned by value and censused — and it is built and green. **`E8-F001` stays open** and its
disposition is unchanged: it must not be closed by deleting the pin, by weakening the gate, or by
making the gate permanently red (all three were tried and withdrawn in the design's own history).

### The other four §7 questions, answered by measurement

- **Q2 — "Can the sandbox constrain outbound egress at all?"** **NO.** Measured, slice (a). See §3.
- **Q3 — "What is a `browser_request` job's `agentId` when the requester is a founder?"** **NULL**,
  in an all-or-nothing pair with `runId`, enforced by a DB CHECK (slice (d)).
- **Q4 — "Does anything read `agent_runtime_decisions.agentId` unconditionally?"** **YES — NINE
  places, and the design named two of them.** See §4. The UI half is better than feared:
  `ui/src/api/agent-runtime-decisions.ts` already typed both fields nullable and
  `RuntimeDecisionPanel` reads neither.
- **Q6 — "What component turns a broker-resolved credential into browser session state?"** Still
  **none**. Unchanged by this build; slice (g) is not attempted and the login-fixture test remains
  impossible.

---

## 2. Delivered scope

**Delivered**

- **(a)** A keyed real-provider probe that MEASURES whether the sandbox provider can constrain
  outbound egress, with a positive control and an apparatus control. Verdict taken from a real run.
  No product code.
- **(b)** A `policy`-lane check binding every golden-journey fixture's `control` block to the
  **shipped** `describeSourceGovernance` profile, plus an always-printed divergence census as a
  second verdict. Closes the blind spot behind `E8-F001`.
- **(c)** An injected approval seam on `runBrowserSession` gating navigation and downloads, D5's
  refusal of standing grants, and a frozen-source parity test for the mirrored vocabulary.
- **(d)** Migration 0272 relaxing `agent_runtime_decisions.agent_id`/`run_id` to nullable behind an
  all-or-nothing CHECK, plus closure of all NINE null-hazards the relaxation creates.

**Explicit non-goals preserved**

- No `packages/worker-protocol` edit. `check:frozen-worker-protocol-v1` is untouched by design.
- No fixture bytes edited — the README forbids it, including "corrections" in place.
- No Lane A file touched: `job-leasing.ts`, `worker-control.ts`, `execution-secret-*.ts` and
  `job_secret_handles.ts` are unchanged, exactly as design §6 says slices (a)–(d) require.
- Slice (e) not built (JOB-015). Slices (f), (g), (h) not attempted.

---

## 3. ★ Slice (a): the measurement, and what it changes

Run **`33857218680`**, success. Two sandboxes, identical except that A declares
`metadata.egressAllowlist = "example.com"` in production's exact spelling
(`sandbox-provider-runtime.ts:785-789`) and B declares none. Identical target set, run from inside
each guest.

| target | role | A (allowlist declared) | B (control) |
|---|---|---|---|
| `https://example.com/` | positive control | REACHED 200 | REACHED 200 |
| `https://api.github.com/` — **NOT allowlisted** | **the question** | **REACHED 200** | **REACHED 200** |
| `http://169.254.169.254/latest/meta-data/` | observation | **REACHED 401** | **REACHED 401** |
| `https://…invalid/` | apparatus control | FAILED (curl 6) | FAILED (curl 6) |

**VERDICT: the allowlist is INERT.** Design §D3 option (b) is unavailable. **The in-sandbox
enforcement point of D3(c) is the ONLY layer, not defence in depth** — and a browser induced to
reconfigure its own proxy is contained by nothing else. Slice (f) must be written against that
threat statement, not the optimistic one.

**The more serious half** is the observation row: the cloud instance-metadata endpoint ANSWERED
HTTP 401 from inside the guest, in both arms — a live IMDSv2 token challenge, not a dropped packet.
Filed as **`E8-F003` (HIGH, unowned)**.

### ★★ The controls did the work, twice, and both times they changed the outcome

Runs `33855470353` and `33856090430` were reported **INCONCLUSIVE** and no verdict was taken from
either: the apparatus control produced no result row while the three other targets returned
normally. Without it, "not_allowlisted REACHED in both arms" was sitting right there and would have
read as a finished measurement taken from an instrument provably dropping one of its four rows.

The cause, once every target's raw channel was printed: curl writes `-w "%{http_code}"` to stdout
and its error to stderr; `2>&1` interleaves them; on the Linux guest the failing case arrived as
**two lines**. On Windows the same command emits one line — **which is exactly why the local
dry-run passed and the real sandbox did not**. A dry-run on a different platform is not a control
for the real one.

### A reusable CI fact, measured

`workflow_dispatch` does fire from a non-default branch (CLI-008 Unit D, `c48259358`) — but only
for a workflow GitHub has already INDEXED. Dispatching this new lane by name on the branch that
introduced it returned `HTTP 404: workflow ... not found on the default branch`. **A new lane
cannot bootstrap itself with `workflow_dispatch`; its first run must come from a `push` trigger on
the branch that introduces it.** The two older keyed workflows' comments state the rule wrongly in
the other direction.

---

## 4. ★★★ Slice (d): the design named TWO null-hazards of NINE, and two of the seven it missed were lethal

> ★ COUNT CORRECTED, and the correction is itself the point. An earlier draft of this section said
> "one of eight". Both numbers were wrong: E8-F002's disposition names **two** branches — the
> sweeper's `runCanceller` **and** "the bridge's request shape" — and the second (hazard 9) was one
> I had not landed when I first wrote this. It surfaced only because the E4-F013 successor guard
> forced a re-read of the disposition. Leaving a corrected conclusion sitting above an uncorrected
> count is the exact failure this programme keeps paying for, so the count is restated rather than
> patched.

Design §D2 names two branches. Measuring Q3/Q4 found **seven more**. **Two of the seven would have
shipped an approval feature that refuses every one of its own prompts and rejects every answer —
with a completely green typecheck.**

| # | Hazard | Named by design? | Failure shape |
|---:|---|---|---|
| 1 | `createPrompt` zombie-run guard: `getRunStatus(null)` finds no row → "run is terminal" | **no** | **every distributed decision refused at creation** |
| 2 | `answerPrompt` liveness gate: same shape on the answer side | **no** | **every founder answer cancelled + 409'd** |
| 3 | `runCanceller` aimed at a null run | **yes** | swallowed by the catch; indistinguishable from a successful cancel |
| 4 | `sourceUniqueKey` template-interpolates `runId` → the literal string `"null"` | no | an identity that works by accident |
| 5 | connector auto-allow probe scoped to an absent agent | no | a probe against a scope that does not exist |
| 6 | two hub projections claim `relatedEntityType: "heartbeat_run"` beside a null id | no | a row that lies quietly (columns are nullable; nothing crashes) |
| 7 | `listStrandedAnswers` INNER JOIN on `run_id` | no | **silent exclusion** — no type error, no runtime error, no wrong row |
| 8 | `RuntimeDecisionDetail` is `.strict()` with `z.string().uuid()` | no | the decision exists in the DB and is unreadable through the hub |
| 9 | `RuntimeDecisionOpenRequest` — the bridge's ENTRY POINT — still `string`-only | **yes** (§D2: "the bridge's request shape") | the relaxation is unreachable through the only door that matters |

★★ **Hazard 9 was design-named and this build still missed it on the first pass.** It surfaced only
because the E4-F013 successor guard forced a re-read of the finding's own disposition after the
result doc made BRW-004 "shipped" — the guard did not find the defect, it made me look. **Widening
the service beneath an entry point is a silent no-op**, because a widened parameter still accepts a
narrower argument: `tsc` stays perfectly green while the bridge remains string-only and a browser
job can never reach the relaxed aggregate at all.

Fixing it exposed one more thing worth recording. The bridge's `runtimeSourceIdentity` was a SECOND
implementation of the dedupe-key rule, bound to the service's only by a comment saying the two must
be byte-identical — and making `runId` nullable would have required two independent template
literals to render null identically, by accident, forever. **A divergence there does not fail
loudly:** the receipt fast-path simply never hits, so every replay mints a duplicate aggregate. The
bridge already imported that module, so there had never been a dependency reason for the copy. It
now delegates, and mutation D8 reintroduces the copy and is caught by a source-text assertion —
source text, because the function is not exported and the property being protected is "there is only
one implementation", which no value test can see.

Hazards 1 and 2 are the ticket's own worst-case shape: *a guard that cannot pass looks exactly like
a guard that works.* Both are skipped when there is no run, because a distributed decision's
liveness is the **job fence**, checked by the bridge before either is reached.

Hazard 7 is left in place deliberately — the exclusion is correct (that sweep is about a heartbeat
run going terminal before an in-band relay, and a distributed decision has neither) — and the
absence it leaves is filed as **`E8-F004`**, successor JOB-015.

**Every case is a PAIR.** The distributed arm proves the new branch is taken; the LEGACY arm proves
the guard it skips still fires for a heartbeat run. A test that only shows the null path succeeding
cannot tell "correctly skipped" from "accidentally disabled for everyone" — and mutation D2/D4
below proves the pairs catch exactly that.

★ The design also names `job-approval-parity.integration.test.ts` as the place to add a browser case
that does NOT seed a synthetic agent or heartbeat run. That extension is **not** landed: the case it
would assert is the bridge WRITING a null-bound decision, and the bridge composition is unbuilt
(§10). What is landed instead is the layer beneath it —
`brw-004-decision-binding.integration.test.ts` proves the aggregate ACCEPTS the row the bridge would
write, and 13 unit cases prove the service builds it. Saying so rather than implying the design's
named artifact exists.

---

## 5. Changed files

| File | Responsibility |
|---|---|
| `packages/sandbox-e2b-provider/scripts/probe-e2b-egress-constraint.mjs` | (a) the differential outbound-egress probe |
| `.github/workflows/keyed-e2b-egress-constraint-probe.yml` | (a) its keyed lane; push-bootstrapped because a new lane cannot dispatch itself |
| `.github/keyed-e2b-egress-constraint-trigger` | (a) the trigger + the run-by-run record incl. the two INCONCLUSIVE runs |
| `scripts/check-distributed-execution-foundation.mjs` | (b) the control-block↔authority binding, the value-tuple pin, the census |
| `scripts/check-distributed-execution-foundation.test.mjs` | (b) 8 mutation cases + the authority copied into the fixture root |
| `packages/browser-runtime/src/approval.ts` | (c) the seam, D5's refusal, the fail-closed deadline |
| `packages/browser-runtime/src/run-session.ts` | (c) the navigation and download gates, before the action |
| `packages/browser-runtime/src/index.ts` | (c) exports, so the seam is reachable from a consumer |
| `packages/browser-runtime/src/__tests__/approval.test.ts` | (c) 24 cases, every fail-closed one paired with its positive control |
| `packages/browser-runtime/src/__tests__/approval-frozen-parity.test.ts` | (c) binds the mirrored vocabulary to the frozen source |
| `packages/db/src/schema/agent_runtime_decisions.ts` | (d) nullable pair + the all-or-nothing CHECK |
| `packages/db/src/migrations/0272_browser_request_decision_binding.sql` | (d) `db:generate` output, slot re-pinned at generation |
| `packages/shared/src/validators/hub.ts` | (d) hazard 8: the API boundary would have rejected the null |
| `server/src/services/agent-runtime-decisions.ts` | (d) hazards 1–7 |
| `server/src/services/job-approval-bridge.ts` | (d) hazard 9: the entry point, and the duplicate identity implementation removed |
| `server/src/__tests__/brw-004-distributed-decision-binding.test.ts` | (d) 13 unit cases, each a distributed/legacy pair |
| `server/src/__tests__/brw-004-decision-binding.integration.test.ts` | (d) 5 cases proving the CHECK fires against REAL Postgres |
| `packages/db/src/migrations/meta/0272_snapshot.json`, `meta/_journal.json` | (d) `db:generate` output that accompanies the migration |
| `docs/replatform/epics/E8-browser-automation/findings.md` | E8-F003, E8-F004 |
| `scripts/finding-ownership.json` | their `unowned` entries with checkable successors |

---

## 6. Acceptance evidence

| Acceptance condition | Evidence | Result |
|---|---|---|
| "allowed domains … are enforced" | **Not delivered.** Slice (f) not attempted. Slice (a) MEASURED that the provider adds no boundary, so the enforcement point is the only layer | `deferred` |
| "denial/timeout fails closed" — decision produced | (c) `awaitApprovalDecision` refuses on deadline, on denial, on a throwing resolver, on an unknown decision, and on a missing resolver; (d) the aggregate can hold the row | `pass` |
| "denial/timeout fails closed" — decision delivered | **DEFERRED to JOB-015** (§1). Nothing carries a control command to a running worker | `deferred` |
| D5: a browser prompt accepts `allow_once` only | (c) `classifyBrowserPermissionDecision` + frozen-source parity test asserting exactly one frozen decision proceeds | `pass` |
| E8-F001 is visible to a guard | (b) `node scripts/check-distributed-execution-foundation.mjs` prints the census naming E8-F001; a different fixture with the same contradiction is RED | `pass` |
| E8-F002: the aggregate can hold a distributed row | (d) migration 0272 + the CHECK + 13 unit tests + 5 REAL-Postgres integration tests (observed constraint-violation error text), 10 killed mutants | `pass` |
| "session state is destroyed at terminal state" | Slice (h) not attempted | `deferred` |
| "OAuth refresh remains control-plane-owned" | Unchanged by this build; no browser path touches the refresh lease | `pass (by inheritance)` |
| Test: login fixture / connector rotation / log-leak | Slice (g) not attempted; §7 Q6 still unanswered | `deferred` |

---

## 7. Commands

| Command | Exit code | Result summary |
|---|---:|---|
| `node scripts/check-distributed-execution-foundation.mjs` | `0` | PASS; census names E8-F001 + 4 unmodelled values |
| `node --test scripts/check-distributed-execution-foundation.test.mjs` | `0` | 190 pass / 0 fail (182 before, +8) |
| `npx vitest run` (packages/browser-runtime) | `0` | 129 pass / 17 skipped (93 before; +26 approval, +10 frozen-parity) |
| `npx vitest run src/__tests__/brw-004-distributed-decision-binding.test.ts` | `0` | 13 pass |
| `npx vitest run` × 4 neighbouring decision suites | `0` | 90 pass / 0 fail — no regression |
| `AOA_RUN_WIN_INTEGRATION=1 npx vitest run …brw-004-decision-binding.integration.test.ts` | `0` | 5 pass — the CHECK fires against REAL Postgres |
| `AOA_RUN_WIN_INTEGRATION=1 npx vitest run …job-approval-parity.integration.test.ts` | `0` | 13 pass with 0272 applied |
| `npx vitest run --shard=1/4` | `1` | 5762 pass / **2 fail, NOT mine** — see below |
| `npx tsc -p . --noEmit` (server) | `0` | clean (pre-existing `TS18046` noise in `routes/plugins.ts` unrelated) |
| `npx tsc -p . --noEmit` (ui) | `0` | clean |
| `npx tsc --noEmit` (packages/browser-runtime) | `0` | clean |
| `node scripts/check-finding-ownership.mjs` | `0` | OK, 30 open findings across 10 registers |
| `drizzle-kit generate` | `0` | `0272_browser_request_decision_binding.sql`, only the intended table |
| GH run `33857218680` | `0` | the slice (a) measurement, both controls satisfied |

### Mutation log — every guard shown RED, then restored

| # | Mutation | Killed by | Restored |
|---:|---|---|---|
| B1 | slice (b)'s check call replaced by an empty census | 8 tests (182/8) | 190/190 |
| C1 | `allow_always` proceeds (D5 removed) | 5, incl. the frozen-parity pair | ✔ |
| C2 | missing resolver fails OPEN | 1 | ✔ |
| C3 | the gate neutered entirely | 5, incl. the download half | ✔ |
| C4 | a throwing resolver fails OPEN | 1 | ✔ |
| C5 | the timeout returns proceed | 2 | ✔ |
| C6 | an unhandled-rejection guard removed | **SURVIVED — the guard was wrong, see below** | n/a |
| D1 | `createPrompt` guard un-skipped for a null run | 1 | ✔ |
| D2 | `createPrompt` guard removed for **everyone** | 2 (both positive controls) | ✔ |
| D3 | `answerPrompt` gate un-skipped | 1 | ✔ |
| D4 | `answerPrompt` gate removed for **everyone** | 1 (the positive control) | ✔ |
| D5 | canceller aimed at a null run | 1 | ✔ |
| D6 | sentinel replaced by template-null | 3 | ✔ |
| D7 | hub type claim restored unconditionally | 1 | ✔ |
| D8 | the bridge's duplicate identity implementation reintroduced | 1 | ✔ |
| D9 | migration 0272's predicate weakened to `CHECK (true)` | 3 (real PG) | ✔ |
| D10 | 0272's predicate weakened to the one-directional variant | 3 (real PG) | ✔ |

### ★★★ One mutant SURVIVED, and the answer was that my fix was unnecessary

C6 is recorded because a surviving mutant is a question and this one had a useful answer.

Reading `awaitApprovalDecision` end to end before calling the work done, I convinced myself of a
hazard — `Promise.race` settles once, so a resolver rejecting AFTER the deadline wins would leave a
rejected promise with nothing listening, fatal under `--unhandled-rejections=strict` in a module
that runs as the sandbox ENTRYPOINT — and added `void Promise.allSettled([...])` plus a test.

Deleting the guard did not turn the test red. Two possible answers, and I checked both:

1. **The test could not see the property.** True of the first attempt, which listened for
   `process.on("unhandledRejection")` inside vitest — vitest installs its own handler, so Node never
   reports it. That test passed identically with and without the guard: **a check that nothing runs,
   written by me, in the file whose header is about that exact failure mode.**
2. **The guard was unnecessary.** The real answer. Rewritten as a strict-mode child process the
   mutant survived again, and a direct experiment settled it: `Promise.race` calls `.then` on every
   element, so the loser's rejection is already observed.

**The guard was removed** and the belief recorded in the source as measured-and-false. Shipping a
defensive line beside a test that can never fail is a false claim of enforcement — worse than an
absent check, because every later reader takes it for a handled hazard.

### The three shard failures are NOT mine, and I checked rather than said so

`debrief-redirect.test.ts` and `discussions-routes-contract.test.ts` each failed one assertion:
`expect(performance.now() - startedAt).toBeLessThan(3000)` around a dynamic `import()`, measured at
4746ms and 4887ms. A wall-clock budget on a module import, failing while this machine was running
vitest shards, embedded Postgres and a pnpm install concurrently — the same family as E3-F034 and
E3-F036. **Verified, not assumed:** re-run alone on a quiet machine, both files pass 12/12. I touched
no route module, and the assertion that fails is the timing one, not the export check on the next line.

Shard 2's single failure is `workspace-runtime.test.ts` — a `vi.waitFor` on a spawned runtime log
sink, the same timing family. **Verified, not assumed:** re-run alone, 40 pass / 13 skipped, 0 fail.
Shards 3 and 4 were clean (5416 and 5488 pass, 0 fail). Across all four shards, every failure was a
timing assertion in a file this change does not touch, and every one passed on re-run in isolation.

★ A method note worth carrying: the first shard run was piped through `tail`, so the tool reported
`exit 0` — the pipeline's exit is `tail`'s, not vitest's. A red suite read as green. Re-run
unpiped to a file before believing any shard result.

Final restored state verified green, not assumed: 127 (browser-runtime), 190 (foundation), 77
(server decision suites; 78 after the bridge change).

---

## 7a. Gates this touches, and the one deliberate non-action

Design §5's list, each checked rather than assumed:

| Gate | State |
|---|---|
| `policy` — slice (b) extends `check-distributed-execution-foundation.mjs`; slice (d) adds a migration | green locally (`ci-local`, 210s) and in CI |
| `browser` lane — slice (c) | **pass** on PR #356 |
| `check:frozen-worker-protocol-v1` — must stay OK with ZERO `packages/worker-protocol` edits | `worker-protocol-contract-bytes` **pass** on ubuntu AND windows; no worker-protocol file is in the diff |
| `check-guard-inventory.mjs` — every new guard needs a CI invocation | slice (b)'s guard rides `check-distributed-execution-foundation.mjs`, already invoked at `pr.yml:162-163` and `:1267`. The probe is not a guard: it gates nothing |
| `check-gate-clause-wiring.mjs` — composing a previously-uncalled symbol reds `policy` | no gate-clause symbol is composed. The bridge's `openGovernedDecision`/`resolveGovernedDecision` are deliberately NOT wired (§10); the new symbols are new |
| `check-finding-ownership.mjs` | OK, 29 open across 10 registers, with E8-F001/F003/F004 declared |
| `check-ticket-graph-coverage.mjs` — `#### BRW-004` in `program-design.md:984` | present; `policy` green |

### ★ `docker/d1/campaign.env` is deliberately NOT bumped

Design §5 says to bump it if a slice alters runtime behaviour under `server/src`, "and only after
the last such change. Coordinate — the last bump wins and that trap has bitten this programme five
times." Slice (d) does touch `server/src`, and `server/src` is not on the D1 lane's push path
filter, so the rule appears to apply. **It is not bumped, on purpose, for two reasons:**

1. **The change alters no live path.** Every new branch is guarded on a null `runId`/`agentId`, and
   no production writer produces one: nothing submits a `browser_request` job, `jobApprovalBridge`
   has zero production callers and is flag-gated off. A D1 campaign would rebuild the image and
   exercise exactly the same behaviour it does today. A bump that proves nothing is not free — it
   costs a full live 2-replica campaign.
2. **Four tracks are live and the last bump wins.** Bumping for a no-op risks clobbering a
   concurrent track's bump that is not a no-op, which is the exact trap §5 warns about.

Recorded as a decision so a reviewer can overrule it, rather than as an omission. **If any reviewer
judges the `server/src` diff live, bump it — the argument above is about behaviour, not about
convenience.**

---

## 8. Deviations

1. **★★★ Slice (b)'s runtime-decision arm is narrower than the design specifies, and the design as
   written would have red-lit three innocent fixtures.** §3 slice (b) says to bind BOTH
   `control.productApproval` and `control.runtimeDecision` to the shipped profile. That is right for
   `productApproval` — a 3-value enum whose non-`none` values each assert "a product approval
   existed here", which is exactly where E8-F001 lives. It is a **category error** for
   `runtimeDecision`, a 7-value SCENARIO enum spanning unrelated mechanisms:
   `RuntimeDecisionAuthority` has four members and four of the seven scenario values name mechanisms
   it does not model at all. Taken literally, `plaintext-secret-in-argv-rejected`,
   `service-provider-pause-resume` and `service-restart-checkpoint` would each have failed a
   contract they never claimed to satisfy. The arm therefore binds only `egress_denied` and
   `budget_stop`; the other four are declared `unmodelled` **with a written reason** and printed in
   the census. Naming an omission is the `unowned`-with-reason pattern; leaving it silent would be
   the blanket exemption the whole slice exists to avoid.
2. **The design's §D2 null-branch list is incomplete by seven.** It names two branches; there are
   nine. §4 above. Not a disagreement with the decision — the decision is right and is implemented
   as specified, both named branches included — but the work it implies is materially larger than
   "two call sites then need a null branch", and two of the seven it does not name would each have
   made the relaxation useless while every test and typecheck stayed green.
3. **Slice (c) does not emit a `runtime_decision_requested` event, and cannot.** The design says the
   seam emits it "through the worker's existing `EventSequencer`". The sequencer is host-side, in
   the worker daemon; `packages/browser-runtime` is staged into the guest as bare files with no
   `node_modules`. More importantly the frozen event requires a `requestDigest` (SHA-256 over
   canonical bytes) and a `sourceRevision`, and the guest has neither the canonicalizer nor the
   counter. A digest the control plane recomputes differently is **worse** than none: it fails as a
   request that never verifies, which reads as a hung session. The guest therefore produces an
   INTENT of only the fields it is the authority for, pinned field-by-field against the frozen
   schema's source. **The completion step is not built.**
4. **Slice (a)'s workflow carries a build-branch push trigger.** Required, not decorative: without
   it the lane could not run before its own PR merged, and an unrun probe measures nothing (§3).

---

## 9. Findings

- **`E8-F001`** — **still open, now `unowned`.** BRW-004 shipped its half: the divergence is
  VISIBLE to a guard for the first time, pinned by value tuple, and censused on every `policy` run.
  The residual — a v2 fixture directory — is §7 Q5's escalation, handed back (§1), and **no ticket
  in the programme owns the fixture corpus**. Moved to `unowned` with "none exists yet" rather than
  left pointing at a ticket that has now shipped, which is E4-F013's exact failure.
- **`E8-F002`** — **RESOLVED.** Migration 0272 + the all-or-nothing CHECK + both null branches the
  disposition names (the bridge's `RuntimeDecisionOpenRequest` shape and the sweeper's
  `runCanceller`) + the six further hazards the disposition missed. 13 tests, 8 killed mutants.
  Resolved on the MECHANISM: the finding said the aggregate *cannot hold a row*, and it can now. The
  absence of a production writer is BRW-004's own unbuilt scope (§10), not this finding's residual —
  saying otherwise would leave a fixed defect open forever.
- **`E8-F003`** — **NEW, HIGH, unowned.** The sandbox's egress allowlist is inert and the cloud
  instance-metadata endpoint answers from inside the guest. Successor named.
- **`E8-F004`** — **NEW, LOW, unowned.** No stranded-delivery sweep for a distributed decision;
  it cannot exist before JOB-015. Successor named; must not be closed by deleting the join.

---

## 10. ★ Built but NOT wired — read this before believing anything above is live

- **Nothing submits a `browser_request` job** (terrain §12). Every slice here is exercised by tests,
  not by production traffic.
- **Slice (c)'s seam has no real resolver.** It ships `inertRefusingResolver`, and the gate defaults
  **off**, because no control-plane hop delivers a decision to a running worker. Turning the gate on
  today makes every session refuse at its first step.
- **Slice (d) adds no writer.** `jobApprovalBridge` still has zero production callers and is
  flag-gated off. The aggregate is now *able* to hold a distributed row; nothing writes one. The
  bridge's `openGovernedDecision`/`resolveGovernedDecision` composition and the timeout sweeper's
  coupling to it are **not landed** — both are only observable end-to-end once JOB-015 delivers, and
  the sweeper change is a behavioural change to a boot-rooted 30-second loop.
- **Slice (a) is a probe.** It gates nothing and enforces nothing. It answers a question.

### ★★★ Capability: this work does NOT flip the E7-1 gate, and here is exactly what would

`capabilityProven` is cleared by `countProducedOutputs`
(`e7-distributed-run-verifier.ts:506`), an OR over `workspacePatchArtifacts` and `taskOutputs`. The
artifact arm filters `kind = "workspace_patch"`
(`e7-distributed-run-verifier-store.ts:205-209`).

**Nothing in slices (a)–(d) commits a `job_artifact` of any kind, let alone `workspace_patch`, and
nothing writes a `task_output`.** Slice (a) creates no job at all. Slices (b) and (d) are a CI check
and a schema relaxation. Slice (c) produces an approval intent, not an artifact.

So: **this advances the approval and governance path without moving the capability counter.** What
would still be required is unchanged from CLI-008 Unit F §1.6 — a file to export, a real
`exportArtifact`/`digestArtifact`, the worker-side consumer (DAT-009 slice 3), and (for task
projection, though not for the counter) an `artifactPrepared` announcement plus a projector. None of
that is here and none of it is claimed.

---

## 11. Follow-up tickets

- **JOB-015** — the delivery hop. Unblocks "denial/timeout fails closed" end-to-end and is the
  successor for `E8-F004`.
- **BRW-004 slices (f)/(g)/(h)** — egress enforcement, connector materialization, session-state
  destruction. Slice (f) must now be written against slice (a)'s measured threat statement: the
  in-sandbox enforcement point is the ONLY layer.
- **`E8-F003`'s metadata half needs an owner beyond E8** — every sandboxed workload shares the
  reachability, not only browser sessions.

---

## 12. Gate recommendation

**Ready for independent review**, for slices (a)–(d) as scoped.

Every fail-closed clause implemented here has a positive control that was shown to fire, and every
guard was mutated red and restored. The deferrals are named with their reasons rather than implied,
the capability question is answered in the negative rather than avoided, and the two escalations are
reported as resolved (Q1) and handed back (Q5).

**What a reviewer should attack first:** deviation 1 (I narrowed a design-specified binding — check
that the narrowing is honest and not convenient), and §4 hazard 7 (I left an INNER JOIN in place and
filed the gap; check the exclusion really is correct rather than merely convenient).

**Codex verdict: ABSENT.** No independent Codex review was obtained for this build. Recorded in
words rather than read as approval.

---

## 13. Independent review

**Reviewer:** `pending until first independent review`
**Reviewed revision:** `pending until first independent review`
**Disposition:** `pending`
**Review evidence:** `pending until first independent review`

## 14. Review attempt history

| Attempt | Reviewer | Reviewed revision | Disposition | Evidence/findings |
|---:|---|---|---|---|
<!-- First independent reviewer appends attempt 1. -->
